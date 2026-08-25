// Export-annotations chrome — hosted users take whiteboard marks out as GeoJSON.
// Trails and tracking stay on a separate store. No upload, no /api.
//
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createAnnotationEngine } from './annotationEngine.js';
import { initAnnotationClearControl } from './clearControl.js';
import { initAnnotationExportControl } from './exportControl.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const css = readFileSync(join(ROOT, 'style.css'), 'utf8');
const license = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
const engineSrc = readFileSync(join(ROOT, 'src', 'annotations', 'annotationEngine.js'), 'utf8');
const exportSrc = readFileSync(join(ROOT, 'src', 'annotations', 'annotationExport.js'), 'utf8');
const controlSrc = readFileSync(join(ROOT, 'src', 'annotations', 'exportControl.js'), 'utf8');
const indexSrc = readFileSync(join(ROOT, 'src', 'annotations', 'index.js'), 'utf8');
const voiceActionsSrc = readFileSync(join(ROOT, 'src', 'voice', 'gevActions.js'), 'utf8');
const voiceToolsSrc = readFileSync(join(ROOT, 'src', 'voice', 'realtimeTools.js'), 'utf8');

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
    click() { listeners.get('click')?.({ preventDefault() {} }); },
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

test('zero marks: Export annotations control is disabled', (t) => {
  installAnimationFrameStubs(t);
  const engine = fixtureEngine();
  const button = fakeButton();
  const downloads = [];
  initAnnotationExportControl(engine, { button, download: (payload) => downloads.push(payload) });

  assert.equal(engine.count(), 0);
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  button.click();
  assert.equal(downloads.length, 0);
});

test('two pins + one arrow: Export downloads 3 valid GeoJSON features', async (t) => {
  installAnimationFrameStubs(t);
  const engine = fixtureEngine();
  const button = fakeButton();
  const downloads = [];
  initAnnotationExportControl(engine, { button, download: (payload) => downloads.push(payload) });

  await engine.annotate([
    { type: 'pin', target: 'First', label: 'First', latitude: 37.77, longitude: -122.42 },
    { type: 'pin', target: 'Second', label: 'Second', latitude: 37.80, longitude: -122.45 },
    {
      type: 'arrow',
      target: 'Palace',
      toTarget: 'Marina',
      label: 'Connector',
      latitude: 37.80,
      longitude: -122.45,
      toLatitude: 37.81,
      toLongitude: -122.44,
    },
  ]);
  assert.equal(engine.count(), 3);
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-disabled'), 'false');

  button.click();

  assert.equal(downloads.length, 1);
  const collection = downloads[0];
  assert.equal(collection.type, 'FeatureCollection');
  assert.equal(collection.features.length, 3);
  assert.deepEqual(collection.features.map((f) => f.geometry.type), ['Point', 'Point', 'LineString']);
  assert.equal(collection.features[0].properties.label, 'First');
  assert.equal(collection.features[1].properties.label, 'Second');
  assert.match(String(collection.features[2].properties.label), /^Connector/);
  assert.deepEqual(collection.features[0].geometry.coordinates, [-122.42, 37.77]);
  assert.deepEqual(collection.features[1].geometry.coordinates, [-122.45, 37.80]);
  assert.deepEqual(collection.features[2].geometry.coordinates, [[-122.45, 37.80], [-122.44, 37.81]]);
  for (const feature of collection.features) {
    assert.deepEqual(Object.keys(feature.properties).sort(), ['color', 'id', 'label', 'type']);
  }
  const parsed = JSON.parse(JSON.stringify(collection));
  assert.equal(parsed.type, 'FeatureCollection');
});

test('Clear and a later board-empty onChange disable Export', async (t) => {
  installAnimationFrameStubs(t);
  const engine = fixtureEngine();
  const exportBtn = fakeButton();
  const clearBtn = fakeButton();
  const downloads = [];
  initAnnotationExportControl(engine, { button: exportBtn, download: (payload) => downloads.push(payload) });
  initAnnotationClearControl(engine, { button: clearBtn });

  await engine.annotate([{ type: 'pin', target: 'First', label: 'First', latitude: 1, longitude: 1 }]);
  assert.equal(exportBtn.disabled, false);
  assert.equal(clearBtn.disabled, false);

  clearBtn.click();
  assert.equal(engine.count(), 0);
  assert.equal(exportBtn.disabled, true);
  assert.equal(clearBtn.disabled, true);
  exportBtn.click();
  assert.equal(downloads.length, 0);

  await engine.annotate([
    { type: 'pin', target: 'Keep', label: 'Keep', latitude: 2, longitude: 2 },
    { type: 'pin', target: 'Drop', label: 'Drop', latitude: 3, longitude: 3 },
  ]);
  assert.equal(engine.count(), 2);
  assert.equal(exportBtn.disabled, false);

  // Undo is Plan 113 (PR 118). Export listens to the same onChange Clear uses,
  // so a board-empty snapshot — what Undo emits when the last mark goes —
  // disables the control without a new /api or voice tool.
  engine.clear();
  assert.equal(engine.count(), 0);
  assert.equal(exportBtn.disabled, true);
});

test('a later empty onChange (Undo/Clear) disables Export', () => {
  let count = 1;
  const listeners = new Set();
  const store = {
    count: () => count,
    list: () => [{ type: 'pin', id: 'a', label: 'A', color: 'primary', anchor: { lon: 1, lat: 2 } }],
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const button = fakeButton();
  initAnnotationExportControl(store, { button, download() {} });
  assert.equal(button.disabled, false);

  count = 0;
  for (const listener of listeners) listener({ count: 0 });
  assert.equal(button.disabled, true);
});

test('the chrome button sits next to Clear annotations', () => {
  const nav = html.match(/<nav id="top-center-actions"[\s\S]*?<\/nav>/);
  assert.ok(nav, 'top-center globe actions are missing');
  assert.match(
    nav[0],
    /id="clear-annotations"[\s\S]*?id="undo-annotations"[\s\S]*?id="export-annotations"[^>]*type="button"[^>]*aria-label="Export annotations"[^>]*disabled/,
  );
  assert.equal((html.match(/id="export-annotations"/g) || []).length, 1);
  assert.match(indexSrc, /initAnnotationExportControl\(/);
});

test('the control stays client-only — no new API, voice, or upload', () => {
  assert.match(controlSrc, /annotationsToExportCollection\(annotations\.list\(\)\)/);
  assert.match(exportSrc, /meridian-annotations\.geojson/);
  assert.doesNotMatch(controlSrc, /\/api\/|fetch\(|FormData|opensky|teleGeography|google news/i);
  assert.doesNotMatch(exportSrc, /\/api\/|fetch\(|FormData|opensky|teleGeography|google news/i);
  assert.doesNotMatch(engineSrc, /\/api\/annotations|exportGeoJson|opensky/i);
  assert.doesNotMatch(voiceActionsSrc, /export_annotations|exportGeoJson|toGeoJSON/);
  assert.doesNotMatch(voiceToolsSrc, /export_annotations|export_geojson/);
  assert.match(css, /#export-annotations:disabled/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
});
