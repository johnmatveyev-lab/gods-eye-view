// Import-annotations chrome — hosted users load whiteboard marks from GeoJSON.
// Trails and tracking stay on a separate store. No geocode, no /api.
//
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createAnnotationEngine } from './annotationEngine.js';
import { annotationsToExportCollection } from './annotationExport.js';
import { initAnnotationImportControl, IMPORT_INVALID_STATUS } from './importControl.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const css = readFileSync(join(ROOT, 'style.css'), 'utf8');
const license = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
const engineSrc = readFileSync(join(ROOT, 'src', 'annotations', 'annotationEngine.js'), 'utf8');
const importSrc = readFileSync(join(ROOT, 'src', 'annotations', 'annotationImport.js'), 'utf8');
const controlSrc = readFileSync(join(ROOT, 'src', 'annotations', 'importControl.js'), 'utf8');
const indexSrc = readFileSync(join(ROOT, 'src', 'annotations', 'index.js'), 'utf8');
const voiceActionsSrc = readFileSync(join(ROOT, 'src', 'voice', 'gevActions.js'), 'utf8');
const voiceToolsSrc = readFileSync(join(ROOT, 'src', 'voice', 'realtimeTools.js'), 'utf8');

const MAX_LIVE = 120;

function installAnimationFrameStubs(t) {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => {
    if (originalRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    if (originalCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });
}

function fakeRenderer() {
  return {
    add() {},
    update() {},
    remove() {},
    sync() {},
  };
}

function fakeButton() {
  const attrs = new Map();
  const listeners = new Map();
  return {
    disabled: false,
    hidden: false,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    setAttribute(name, value) { attrs.set(name, value); },
    getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
    async click() { await listeners.get('click')?.({ preventDefault() {} }); },
  };
}

function fixtureEngine() {
  return createAnnotationEngine({
    viewer: { trackedEntity: { id: 'plane-1' } },
    renderer: fakeRenderer(),
    resolveTarget: async ({ target, latitude, longitude }) => ({
      lon: Number.isFinite(longitude) ? longitude : 0,
      lat: Number.isFinite(latitude) ? latitude : 0,
      height: 0,
      label: target,
      source: 'fixture',
    }),
  });
}

function exportedBoard() {
  return annotationsToExportCollection([
    { type: 'pin', id: 'a', label: 'First', color: 'cyan', anchor: { lon: -122.42, lat: 37.77 } },
    { type: 'pin', id: 'b', label: 'Second', color: 'amber', anchor: { lon: -122.45, lat: 37.80 } },
    {
      type: 'arrow',
      id: 'c',
      label: 'Connector',
      color: 'primary',
      anchor: { lon: -122.45, lat: 37.80 },
      to: { lon: -122.44, lat: 37.81 },
    },
    {
      type: 'area',
      id: 'd',
      label: 'The Presidio',
      color: 'green',
      anchor: { lon: -122.45, lat: 37.80 },
      ring: [[-122.46, 37.79], [-122.44, 37.81], [-122.43, 37.79]],
    },
  ]);
}

test('empty board: Import annotations control stays enabled', (t) => {
  installAnimationFrameStubs(t);
  const engine = fixtureEngine();
  const button = fakeButton();
  const calls = [];
  initAnnotationImportControl(engine, {
    button,
    pickFile: async () => { calls.push('pick'); return null; },
    showStatus: () => {},
  });

  assert.equal(engine.count(), 0);
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-disabled'), 'false');
});

test('export then import on a cleared board restores pins, lines, and areas with labels', async (t) => {
  installAnimationFrameStubs(t);
  const engine = fixtureEngine();
  const button = fakeButton();
  const statuses = [];
  initAnnotationImportControl(engine, {
    button,
    pickFile: async () => ({ name: 'meridian-annotations.geojson' }),
    readText: async () => JSON.stringify(exportedBoard()),
    showStatus: (msg) => statuses.push(msg),
  });

  await button.click();

  assert.equal(engine.count(), 4);
  assert.deepEqual(engine.list().map((anno) => anno.type), ['pin', 'pin', 'arrow', 'area']);
  assert.deepEqual(engine.list().map((anno) => anno.label), ['First', 'Second', 'Connector', 'The Presidio']);
  assert.deepEqual(engine.list()[0].anchor, { lon: -122.42, lat: 37.77, height: 0 });
  assert.deepEqual(engine.list()[2].to, { lon: -122.44, lat: 37.81, height: 0 });
  assert.equal(engine.list()[3].ring.length, 3);
  assert.deepEqual(statuses, []);
});

test('import appends and does not wipe existing marks', async (t) => {
  installAnimationFrameStubs(t);
  const engine = fixtureEngine();
  await engine.annotate([{ type: 'pin', label: 'Keep', latitude: 1, longitude: 2 }]);
  assert.equal(engine.count(), 1);

  const button = fakeButton();
  const annotateOpts = [];
  const original = engine.annotate.bind(engine);
  engine.annotate = async (specs, opts) => {
    annotateOpts.push(opts);
    return original(specs, opts);
  };
  initAnnotationImportControl(engine, {
    button,
    pickFile: async () => ({ name: 'board.geojson' }),
    readText: async () => JSON.stringify(annotationsToExportCollection([
      { type: 'pin', id: 'n', label: 'New', color: 'cyan', anchor: { lon: 3, lat: 4 } },
    ])),
    showStatus: () => {},
  });

  await button.click();

  assert.equal(engine.count(), 2);
  assert.deepEqual(engine.list().map((anno) => anno.label), ['Keep', 'New']);
  assert.deepEqual(annotateOpts, [{ clearPrevious: false, persist: true, flyTo: false }]);
});

test('features without coords are skipped; malformed file is a no-op with a short status', async (t) => {
  installAnimationFrameStubs(t);
  const engine = fixtureEngine();
  await engine.annotate([{ type: 'pin', label: 'Keep', latitude: 1, longitude: 1 }]);
  const button = fakeButton();
  const statuses = [];
  let text = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [] }, properties: { label: 'Skip' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [9, 8] }, properties: { type: 'pin', label: 'Added' } },
    ],
  });
  initAnnotationImportControl(engine, {
    button,
    pickFile: async () => ({ name: 'mixed.geojson' }),
    readText: async () => text,
    showStatus: (msg) => statuses.push(msg),
  });

  await button.click();
  assert.equal(engine.count(), 2);
  assert.deepEqual(engine.list().map((anno) => anno.label), ['Keep', 'Added']);
  assert.deepEqual(statuses, []);

  text = '{not json';
  await button.click();
  assert.equal(engine.count(), 2);
  assert.deepEqual(statuses, [IMPORT_INVALID_STATUS]);
  assert.equal(IMPORT_INVALID_STATUS, 'Invalid GeoJSON');
});

test('cap stops adding at MAX_LIVE', async (t) => {
  installAnimationFrameStubs(t);
  const engine = fixtureEngine();
  const existing = [];
  for (let i = 0; i < MAX_LIVE - 1; i += 1) {
    existing.push({
      type: 'pin',
      target: `keep-${i}`,
      label: `Keep ${i}`,
      latitude: i,
      longitude: i,
    });
  }
  await engine.annotate(existing);
  assert.equal(engine.count(), MAX_LIVE - 1);

  const extras = annotationsToExportCollection([
    { type: 'pin', id: 'n1', label: 'New 1', color: 'cyan', anchor: { lon: 200, lat: 200 } },
    { type: 'pin', id: 'n2', label: 'New 2', color: 'amber', anchor: { lon: 201, lat: 201 } },
  ]);
  const button = fakeButton();
  initAnnotationImportControl(engine, {
    button,
    pickFile: async () => ({ name: 'over.geojson' }),
    readText: async () => JSON.stringify(extras),
    showStatus: () => {},
  });

  await button.click();
  assert.equal(engine.count(), MAX_LIVE);
  assert.equal(engine.list().some((anno) => anno.label === 'New 1'), true);
  assert.equal(engine.list().some((anno) => anno.label === 'New 2'), false);
});

test('import does not call Places, Overpass, or any fetch', async (t) => {
  installAnimationFrameStubs(t);
  const fetches = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    fetches.push(args);
    throw new Error('network should not run during import');
  };
  t.after(() => {
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
  });

  const resolveCalls = [];
  const engine = createAnnotationEngine({
    viewer: {},
    renderer: fakeRenderer(),
    resolveTarget: async (opts) => {
      resolveCalls.push(opts);
      return { lon: 0, lat: 0, height: 0, source: 'should-not-run' };
    },
  });
  const button = fakeButton();
  initAnnotationImportControl(engine, {
    button,
    pickFile: async () => ({ name: 'board.geojson' }),
    readText: async () => JSON.stringify(exportedBoard()),
    showStatus: () => {},
  });

  await button.click();
  assert.equal(engine.count(), 4);
  assert.deepEqual(resolveCalls, []);
  assert.deepEqual(fetches, []);
});

test('the chrome button sits next to Export and stays enabled when empty', () => {
  const nav = html.match(/<nav id="top-center-actions"[\s\S]*?<\/nav>/);
  assert.ok(nav, 'top-center globe actions are missing');
  assert.match(
    nav[0],
    /id="clear-annotations"[\s\S]*?id="undo-annotations"[\s\S]*?id="export-annotations"[\s\S]*?id="import-annotations"[^>]*type="button"[^>]*aria-label="Import annotations"/,
  );
  assert.doesNotMatch(nav[0], /id="import-annotations"[^>]*disabled/);
  assert.equal((html.match(/id="import-annotations"/g) || []).length, 1);
  assert.match(indexSrc, /initAnnotationImportControl\(/);
});

test('the control stays client-only — no new API, voice, or geocode', () => {
  assert.match(controlSrc, /clearPrevious:\s*false/);
  assert.match(controlSrc, /persist:\s*true/);
  assert.match(controlSrc, /flyTo:\s*false/);
  assert.match(controlSrc, /parseAnnotationImportText/);
  assert.doesNotMatch(controlSrc, /\/api\/|opensky|teleGeography|google news/i);
  assert.doesNotMatch(importSrc, /\/api\/|fetch\(|opensky|teleGeography|google news|geocode|overpass|placesTextSearch/i);
  assert.doesNotMatch(engineSrc, /\/api\/annotations|importGeoJson|opensky/i);
  assert.doesNotMatch(voiceActionsSrc, /import_annotations|importGeoJson|fromGeoJSON/);
  assert.doesNotMatch(voiceToolsSrc, /import_annotations|import_geojson/);
  assert.match(css, /#import-annotations:disabled/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
});
