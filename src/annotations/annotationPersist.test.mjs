// Persist whiteboard marks across reload — localStorage only.
// Restore uses the same lat/lon annotate() path as Import (Plan 115).
// Clear / Undo / Import / Export stay the source of truth. No /api.
//
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createAnnotationEngine, MAX_LIVE_ANNOTATIONS } from './annotationEngine.js';
import { annotationsToExportCollection } from './annotationExport.js';
import { featureCollectionToAnnotateSpecs } from './annotationImport.js';
import {
  ANNOTATION_PERSIST_KEY,
  ANNOTATION_PERSIST_VERSION,
  compactPersistentAnnotation,
  initAnnotationPersist,
  isPersistentAnnotation,
  persistedMarkToAnnotateSpec,
  readAnnotationSnapshot,
  snapshotPersistentAnnotations,
  snapshotToAnnotateSpecs,
  writeAnnotationSnapshot,
} from './annotationPersist.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const license = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
const persistSrc = readFileSync(join(ROOT, 'src', 'annotations', 'annotationPersist.js'), 'utf8');
const indexSrc = readFileSync(join(ROOT, 'src', 'annotations', 'index.js'), 'utf8');
const engineSrc = readFileSync(join(ROOT, 'src', 'annotations', 'annotationEngine.js'), 'utf8');
const voiceActionsSrc = readFileSync(join(ROOT, 'src', 'voice', 'gevActions.js'), 'utf8');
const voiceToolsSrc = readFileSync(join(ROOT, 'src', 'voice', 'realtimeTools.js'), 'utf8');

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.hasOwn(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
    snapshot() {
      return { ...data };
    },
  };
}

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

function trackingResolver(calls) {
  return async (opts) => {
    calls.push(opts);
    return {
      lon: Number.isFinite(opts.longitude) ? opts.longitude : 0,
      lat: Number.isFinite(opts.latitude) ? opts.latitude : 0,
      height: 0,
      label: opts.target,
      source: 'should-not-run',
    };
  };
}

function engineWith(resolveTarget) {
  return createAnnotationEngine({
    viewer: {},
    renderer: fakeRenderer(),
    resolveTarget,
  });
}

async function placePins(engine, labels) {
  const specs = labels.map((label, i) => ({
    type: 'pin',
    label,
    color: i === 0 ? 'cyan' : 'amber',
    latitude: 37.77 + i * 0.01,
    longitude: -122.42 - i * 0.01,
  }));
  return engine.annotate(specs, { persist: true, flyTo: false });
}

test('the stored key is meridian.annotations and TTL marks are skipped', () => {
  assert.equal(ANNOTATION_PERSIST_KEY, 'meridian.annotations');
  assert.equal(ANNOTATION_PERSIST_VERSION, 1);
  assert.equal(MAX_LIVE_ANNOTATIONS, 120);

  const pin = {
    id: 'anno-1',
    type: 'pin',
    label: 'First',
    color: 'cyan',
    ttlMs: null,
    expiring: false,
    anchor: { lon: -122.42, lat: 37.77, height: 12 },
  };
  const fading = { ...pin, id: 'anno-2', label: 'Fade', ttlMs: 22000 };
  const expiring = { ...pin, id: 'anno-3', label: 'Out', expiring: true, ttlMs: 0 };

  assert.equal(isPersistentAnnotation(pin), true);
  assert.equal(isPersistentAnnotation(fading), false);
  assert.equal(isPersistentAnnotation(expiring), false);

  const compact = compactPersistentAnnotation(pin);
  assert.deepEqual(compact, {
    id: 'anno-1',
    type: 'pin',
    label: 'First',
    color: 'cyan',
    anchor: { lon: -122.42, lat: 37.77 },
  });
  assert.equal(compactPersistentAnnotation(fading), null);

  const snapshot = snapshotPersistentAnnotations([pin, fading, expiring]);
  assert.deepEqual(snapshot, { v: 1, marks: [compact] });
});

test('stored marks become Import-style lat/lon annotate specs', () => {
  const specs = snapshotToAnnotateSpecs({
    v: 1,
    marks: [
      { id: 'a', type: 'pin', label: 'First', color: 'cyan', anchor: { lon: -122.42, lat: 37.77 } },
      { id: 'b', type: 'pin', label: 'Second', color: 'amber', anchor: { lon: -122.45, lat: 37.80 } },
      {
        id: 'c',
        type: 'arrow',
        label: 'Connector',
        color: 'primary',
        anchor: { lon: -122.45, lat: 37.80 },
        to: { lon: -122.44, lat: 37.81 },
      },
      {
        id: 'd',
        type: 'area',
        label: 'The Presidio',
        color: 'green',
        anchor: { lon: -122.45, lat: 37.80 },
        ring: [[-122.46, 37.79], [-122.44, 37.81], [-122.43, 37.79]],
      },
    ],
  });
  assert.equal(specs.length, 4);
  assert.deepEqual(specs[0], {
    type: 'pin',
    label: 'First',
    color: 'cyan',
    latitude: 37.77,
    longitude: -122.42,
  });
  assert.equal(specs[2].toLatitude, 37.81);
  assert.equal(specs[3].footprint, false);
  assert.equal(specs[3].ring.length, 3);
  for (const spec of specs) {
    assert.equal(spec.target, undefined);
    assert.equal(spec.toTarget, undefined);
  }

  const viaImport = featureCollectionToAnnotateSpecs(annotationsToExportCollection([
    { type: 'pin', id: 'a', label: 'First', color: 'cyan', anchor: { lon: -122.42, lat: 37.77 } },
  ]));
  assert.deepEqual(persistedMarkToAnnotateSpec({
    type: 'pin', label: 'First', color: 'cyan', anchor: { lon: -122.42, lat: 37.77 },
  }), viaImport[0]);
});

test('place two pins, reload → both return with labels', async (t) => {
  installAnimationFrameStubs(t);
  const storage = memoryStorage();
  const firstCalls = [];
  const first = engineWith(trackingResolver(firstCalls));
  initAnnotationPersist(first, { storage });
  await placePins(first, ['First', 'Second']);
  assert.equal(first.count(), 2);
  assert.match(storage.getItem(ANNOTATION_PERSIST_KEY), /First/);
  assert.match(storage.getItem(ANNOTATION_PERSIST_KEY), /Second/);

  const secondCalls = [];
  const second = engineWith(trackingResolver(secondCalls));
  const persist = initAnnotationPersist(second, { storage });
  const restored = await persist.restorePromise;
  assert.equal(restored.restored, 2);
  assert.equal(second.count(), 2);
  assert.deepEqual(second.list().map((anno) => anno.label), ['First', 'Second']);
  assert.deepEqual(secondCalls, [], 'restore must use coordinate-only annotate, not resolveTarget');
});

test('Undo then reload → only the remaining mark returns', async (t) => {
  installAnimationFrameStubs(t);
  const storage = memoryStorage();
  const first = engineWith(trackingResolver([]));
  initAnnotationPersist(first, { storage });
  await placePins(first, ['First', 'Second']);
  first.removeLast();
  assert.equal(first.count(), 1);
  assert.equal(first.list()[0].label, 'First');

  const second = engineWith(trackingResolver([]));
  await initAnnotationPersist(second, { storage }).restorePromise;
  assert.equal(second.count(), 1);
  assert.deepEqual(second.list().map((anno) => anno.label), ['First']);
});

test('Clear then reload → empty', async (t) => {
  installAnimationFrameStubs(t);
  const storage = memoryStorage();
  const first = engineWith(trackingResolver([]));
  initAnnotationPersist(first, { storage });
  await placePins(first, ['First', 'Second']);
  first.clear();
  assert.equal(first.count(), 0);
  assert.equal(storage.getItem(ANNOTATION_PERSIST_KEY), null, 'Clear empties storage');

  const second = engineWith(trackingResolver([]));
  await initAnnotationPersist(second, { storage }).restorePromise;
  assert.equal(second.count(), 0);
});

test('Import then reload → imported marks return', async (t) => {
  installAnimationFrameStubs(t);
  const storage = memoryStorage();
  const firstCalls = [];
  const first = engineWith(trackingResolver(firstCalls));
  initAnnotationPersist(first, { storage });

  const collection = annotationsToExportCollection([
    { type: 'pin', id: 'a', label: 'Imported A', color: 'cyan', anchor: { lon: -122.42, lat: 37.77 } },
    { type: 'pin', id: 'b', label: 'Imported B', color: 'amber', anchor: { lon: -122.45, lat: 37.80 } },
  ]);
  const specs = featureCollectionToAnnotateSpecs(collection);
  await first.annotate(specs, { clearPrevious: false, persist: true, flyTo: false });
  assert.equal(first.count(), 2);
  assert.deepEqual(firstCalls, [], 'Import-style annotate stays coordinate-only');

  const secondCalls = [];
  const second = engineWith(trackingResolver(secondCalls));
  await initAnnotationPersist(second, { storage }).restorePromise;
  assert.equal(second.count(), 2);
  assert.deepEqual(second.list().map((anno) => anno.label), ['Imported A', 'Imported B']);
  assert.deepEqual(secondCalls, []);
});

test('storage write does not fire Places or annotate', async () => {
  const resolveCalls = [];
  const annotateCalls = [];
  let listener = null;
  const store = {
    list: () => ([
      {
        id: 'anno-1',
        type: 'pin',
        label: 'First',
        color: 'cyan',
        ttlMs: null,
        anchor: { lon: -122.42, lat: 37.77 },
      },
    ]),
    annotate: async (specs) => {
      annotateCalls.push(specs);
      throw new Error('write must not annotate');
    },
    onChange(fn) {
      listener = fn;
      return () => { listener = null; };
    },
    resolveTarget: async (opts) => {
      resolveCalls.push(opts);
      throw new Error('Places must not run');
    },
  };
  const storage = memoryStorage();
  const persist = initAnnotationPersist(store, { storage });
  await persist.restorePromise;
  listener({ count: 1 });
  const snap = readAnnotationSnapshot(storage);
  assert.equal(snap.marks.length, 1);
  assert.equal(snap.marks[0].label, 'First');
  assert.deepEqual(annotateCalls, []);
  assert.deepEqual(resolveCalls, []);
});

test('restore honors MAX_LIVE_ANNOTATIONS and ignores corrupt storage', async (t) => {
  installAnimationFrameStubs(t);
  const overflow = [];
  for (let i = 0; i < MAX_LIVE_ANNOTATIONS + 5; i += 1) {
    overflow.push({
      id: `anno-${i}`,
      type: 'pin',
      label: `P${i}`,
      color: 'primary',
      anchor: { lon: -122 - i * 0.001, lat: 37 + i * 0.001 },
    });
  }
  const storage = memoryStorage();
  writeAnnotationSnapshot(storage, { v: 1, marks: overflow });
  const parsed = JSON.parse(storage.getItem(ANNOTATION_PERSIST_KEY));
  assert.equal(parsed.marks.length, MAX_LIVE_ANNOTATIONS);

  const engine = engineWith(trackingResolver([]));
  await initAnnotationPersist(engine, { storage }).restorePromise;
  assert.equal(engine.count(), MAX_LIVE_ANNOTATIONS);

  const bad = memoryStorage({ [ANNOTATION_PERSIST_KEY]: '{not json' });
  const emptyEngine = engineWith(trackingResolver([]));
  await initAnnotationPersist(emptyEngine, { storage: bad }).restorePromise;
  assert.equal(emptyEngine.count(), 0);
});

test('the hook stays client-only — no new API, voice, or Places', () => {
  assert.match(indexSrc, /initAnnotationPersist\(/);
  assert.match(persistSrc, /meridian\.annotations/);
  assert.match(persistSrc, /clearPrevious:\s*false/);
  assert.match(persistSrc, /persist:\s*true/);
  assert.match(persistSrc, /flyTo:\s*false/);
  assert.doesNotMatch(persistSrc, /\/api\/[a-z]|fetch\(|opensky|teleGeography|google news|placesTextSearch|quantum-earth/i);
  assert.doesNotMatch(engineSrc, /\/api\/annotations|opensky/i);
  assert.doesNotMatch(voiceActionsSrc, /persist_annotations|localStorage/);
  assert.doesNotMatch(voiceToolsSrc, /persist_annotations/);
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);

  const apiFiles = readdirSync(join(ROOT, 'api'), { withFileTypes: true })
    .flatMap((entry) => (entry.isFile() ? [entry.name] : []));
  assert.equal(apiFiles.includes('annotations.js'), false);
});
