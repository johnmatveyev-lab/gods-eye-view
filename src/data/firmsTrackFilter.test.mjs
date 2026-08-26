// PLAN 211 — FIRMS track-size ceiling. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_TRACK_CEILING,
  FIRMS_TRACK_CEILING_CHIPS,
  FIRMS_TRACK_STORAGE_KEY,
  filterFiresByTrackCeiling,
  fireMeetsTrackCeiling,
  firmsTrackChipModels,
  normalizeTrackCeiling,
  readFirmsTrackCeiling,
  writeFirmsTrackCeiling,
} from './firmsTrackFilter.js';
import {
  FIRMS_SCAN_STORAGE_KEY,
  fireMeetsScanCeiling,
  writeFirmsScanCeiling,
} from './firmsScanFilter.js';
import { fireMeetsBrightnessTi5Floor } from './firmsBrightnessTi5Filter.js';
import { fireMeetsBrightnessFloor } from './firmsBrightnessFloor.js';
import {
  createFirmsHeatmapLayer,
} from './firmsHeatmap.js';
import { adaptFirmsRecords } from './firmsAdapt.js';
import { parseFirmsCsv } from './firmsCsv.js';
import { unregisterSpriteCollection } from './spriteOrder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUSTIN = { lon: -97.7, lat: 30.2 };
const TOKYO = { lon: 139.7, lat: 35.7 };
const DETECTION_HEIGHT_M = 1_500_000;
const CELL_HEIGHT_M = 10_000_000;
const HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';

const MIXED_FIRES = [
  rawFire(AUSTIN.lat, AUSTIN.lon, 80, 300, 'h', { track: 0.36 }),
  rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 81, 325, 'h', { track: 0.45 }),
  rawFire(TOKYO.lat, TOKYO.lon, 82, 345, 'h', { track: 0.80 }),
  rawFire(TOKYO.lat + 3, TOKYO.lon + 3, 83, 360, 'h', { track: 1.0, instrument: 'MODIS' }),
];

const AND_FIRES = [
  rawFire(AUSTIN.lat, AUSTIN.lon, 4.2, 360, 'h', { track: 0.36, brightnessTi5: 330 }),
  rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 62, 360, 'l', { track: 1.0, instrument: 'MODIS', brightnessTi5: 330 }),
  rawFire(TOKYO.lat, TOKYO.lon, 62, 360, 'n', { track: 0.80, brightnessTi5: 270 }),
  rawFire(TOKYO.lat + 3, TOKYO.lon + 3, 140, 360, 'h', { track: 0.36, brightnessTi5: 330 }),
];

function recentAcqFields(hoursAgo = 2) {
  const date = new Date(Date.now() - hoursAgo * 3600000);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return { acqDate: `${yyyy}-${mm}-${dd}`, acqTime: `${hh}${min}` };
}

function rawFire(lat, lon, frp, brightness = 340, confidence = 'h', overrides = {}) {
  return {
    lat,
    lon,
    frp,
    confidence,
    brightness,
    brightnessTi5: 300,
    scan: 0.39,
    track: 0.36,
    daynight: 'D',
    ...recentAcqFields(),
    instrument: 'VIIRS',
    satellite: 'N20',
    ...overrides,
  };
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    snapshot: () => ({ ...data }),
  };
}

function canvasStub() {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }),
      fillStyle: null,
      fillRect() {},
    }),
    toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=',
  };
}

class MockEvent {
  constructor() { this.listeners = new Set(); }
  addEventListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function createHarness(rawFires, { height = DETECTION_HEIGHT_M } = {}) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalProject = Cesium.SceneTransforms.worldToWindowCoordinates;
  let fetchCount = 0;
  let lastUrl = '';
  let nextResponse = {
    ok: true,
    status: 200,
    json: async () => ({ fires: rawFires, fetchedAt: Date.now() }),
  };

  globalThis.fetch = async (url) => {
    fetchCount += 1;
    lastUrl = String(url);
    if (typeof nextResponse === 'function') return nextResponse();
    return nextResponse;
  };
  globalThis.window = globalThis.window || {};
  globalThis.document = { createElement: () => canvasStub() };

  const slots = new Map();
  Cesium.SceneTransforms.worldToWindowCoordinates = (scene, position, result) => {
    if (!slots.has(position)) slots.set(position, slots.size);
    const slot = slots.get(position);
    const out = result || new Cesium.Cartesian2();
    out.x = 100 + (slot % 10) * 200;
    out.y = 100 + Math.floor(slot / 10) * 200;
    return out;
  };

  const preRender = new MockEvent();
  const moveEnd = new MockEvent();
  const primitives = [];
  const entryCalls = [];
  const viewer = {
    dataSources: { add: (value) => value, remove: () => {} },
    camera: {
      moveEnd,
      positionWC: Cesium.Cartesian3.fromDegrees(AUSTIN.lon, AUSTIN.lat, height),
      directionWC: new Cesium.Cartesian3(0, 0, -1),
      positionCartographic: { height },
    },
    scene: {
      canvas: { clientWidth: 2000, clientHeight: 2000 },
      preRender,
      primitives: {
        add: (value) => { primitives.push(value); return value; },
        remove: () => {},
        contains: () => false,
      },
      frameState: { mode: Cesium.SceneMode.SCENE3D, mapProjection: new Cesium.GeographicProjection() },
      mapProjection: new Cesium.GeographicProjection(),
    },
  };

  const layer = createFirmsHeatmapLayer({
    id: 'firms',
    name: 'FIRMS',
    overlayHost: {
      setEntries: (_sourceId, entries) => entryCalls.push(entries),
      setVisible: () => {},
      clearSource: () => {},
    },
    screenSpaceEventHandlerFactory: () => ({ setInputAction() {}, destroy() {} }),
  });

  return {
    layer,
    viewer,
    get fetchCount() { return fetchCount; },
    get lastUrl() { return lastUrl; },
    billboards: () => primitives[0],
    latestEntries: () => entryCalls[entryCalls.length - 1] || [],
    detectionCount() {
      const bb = primitives[0];
      return bb ? bb.length : 0;
    },
    cleanup() {
      layer.destroy(viewer);
      unregisterSpriteCollection('firms');
      Cesium.SceneTransforms.worldToWindowCoordinates = originalProject;
      globalThis.fetch = originalFetch;
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
    },
  };
}

test('normalizeTrackCeiling: All / 0.5 / 0.4 only; anything else is All', () => {
  assert.equal(DEFAULT_FIRMS_TRACK_CEILING, 'all');
  assert.equal(normalizeTrackCeiling('all'), 'all');
  assert.equal(normalizeTrackCeiling(0), 'all');
  assert.equal(normalizeTrackCeiling(0.5), '0.5');
  assert.equal(normalizeTrackCeiling('0.5'), '0.5');
  assert.equal(normalizeTrackCeiling(0.4), '0.4');
  assert.equal(normalizeTrackCeiling('0.4'), '0.4');
  assert.equal(normalizeTrackCeiling('0.6'), 'all');
  assert.equal(normalizeTrackCeiling('1'), 'all');
  assert.equal(normalizeTrackCeiling(undefined), 'all');
  assert.equal(normalizeTrackCeiling(null), 'all');
  assert.deepEqual(FIRMS_TRACK_CEILING_CHIPS.map((chip) => chip.id), ['all', '0.5', '0.4']);
  assert.deepEqual(FIRMS_TRACK_CEILING_CHIPS.map((chip) => chip.label), ['All', '<0.5km', '<0.4km']);
});

test('All keeps current detections; <0.5km hides MODIS and wide-track VIIRS; <0.4km keeps near-nadir', () => {
  const nadir = { trackKm: 0.36, frp: 20 };
  const mid = { trackKm: 0.45, frp: 15 };
  const wide = { trackKm: 0.80, frp: 12 };
  const modis = { trackKm: 1.0, frp: 10 };
  assert.equal(fireMeetsTrackCeiling(nadir, 'all'), true);
  assert.equal(fireMeetsTrackCeiling(nadir, '0.5'), true);
  assert.equal(fireMeetsTrackCeiling(nadir, '0.4'), true);
  assert.equal(fireMeetsTrackCeiling(mid, 'all'), true);
  assert.equal(fireMeetsTrackCeiling(mid, '0.5'), true);
  assert.equal(fireMeetsTrackCeiling(mid, '0.4'), false);
  assert.equal(fireMeetsTrackCeiling(wide, 'all'), true);
  assert.equal(fireMeetsTrackCeiling(wide, '0.5'), false);
  assert.equal(fireMeetsTrackCeiling(modis, '0.5'), false);
  assert.equal(fireMeetsTrackCeiling(modis, '0.4'), false);
  const fires = [nadir, mid, wide, modis];
  assert.equal(filterFiresByTrackCeiling(fires, 'all').length, 4);
  assert.deepEqual(filterFiresByTrackCeiling(fires, '0.5').map((fire) => fire.trackKm), [0.36, 0.45]);
  assert.deepEqual(filterFiresByTrackCeiling(fires, '0.4').map((fire) => fire.trackKm), [0.36]);
});

test('track chips are distinct from Plan 204 scan chips', () => {
  const nadirScanWideTrack = { scanKm: 0.375, trackKm: 0.80, frp: 20 };
  const wideScanNadirTrack = { scanKm: 0.80, trackKm: 0.36, frp: 15 };
  assert.equal(fireMeetsScanCeiling(nadirScanWideTrack, '0.4'), true, 'narrow scan still passes scan <0.4km');
  assert.equal(fireMeetsTrackCeiling(nadirScanWideTrack, '0.5'), false, 'wide track fails track <0.5km');
  assert.equal(fireMeetsScanCeiling(wideScanNadirTrack, '0.5'), false, 'wide scan fails scan <0.5km');
  assert.equal(fireMeetsTrackCeiling(wideScanNadirTrack, '0.4'), true, 'narrow track still passes track <0.4km');
  assert.notEqual(FIRMS_TRACK_STORAGE_KEY, FIRMS_SCAN_STORAGE_KEY);
});

test('missing, non-finite, and non-positive track stays visible at every ceiling', () => {
  const missing = { frp: 40 };
  const nulled = { trackKm: null, frp: 43 };
  const zero = { trackKm: 0, frp: 44 };
  const nan = { trackKm: Number.NaN, frp: 41 };
  const inf = { trackKm: Number.POSITIVE_INFINITY, frp: 42 };
  assert.equal(fireMeetsTrackCeiling(missing, '0.5'), true);
  assert.equal(fireMeetsTrackCeiling(nulled, '0.4'), true);
  assert.equal(fireMeetsTrackCeiling(zero, '0.4'), true);
  assert.equal(fireMeetsTrackCeiling(missing, '0.4'), true);
  assert.equal(fireMeetsTrackCeiling(nan, '0.4'), true);
  assert.equal(fireMeetsTrackCeiling(inf, '0.4'), true);
  assert.deepEqual(
    filterFiresByTrackCeiling([missing, nan, nulled, zero, { trackKm: 1.0, frp: 1 }], '0.5')
      .map((fire) => fire.frp),
    [40, 41, 43, 44],
  );
});

test('adapted missing track stays visible because the adapter stores 0', () => {
  const [fire] = adaptFirmsRecords([
    rawFire(AUSTIN.lat, AUSTIN.lon, 70, 340, 'h', { track: undefined }),
  ]);
  assert.equal(fire.trackKm, 0);
  assert.equal(fireMeetsTrackCeiling(fire, '0.5'), true);
  assert.equal(fireMeetsTrackCeiling(fire, '0.4'), true);
});

test('CSV track column is parsed and trackKm is on the adapted record', () => {
  const csv = [
    HEADER,
    '38.99488,-121.67046,303.6,0.39,0.36,2026-07-16,1006,N20,VIIRS,n,2.0NRT,290.73,0.53,N',
    '32.44483,-116.96709,301.45,0.80,0.47,2026-07-16,1009,N20,VIIRS,n,2.0NRT,289.55,0.4,N',
    '10.0,20.0,330.0,1.00,1.00,2026-07-16,1010,Aqua,MODIS,h,6.1NRT,290.0,12.0,D',
  ].join('\n');
  const parsed = parseFirmsCsv(csv);
  assert.deepEqual(parsed.map((row) => row.track), [0.36, 0.47, 1]);
  assert.deepEqual(parsed.map((row) => row.scan), [0.39, 0.80, 1], 'scan sibling stays parsed');
  const adapted = adaptFirmsRecords(parsed);
  assert.deepEqual(adapted.map((fire) => fire.trackKm), [0.36, 0.47, 1]);
  assert.deepEqual(adapted.map((fire) => fire.scanKm), [0.39, 0.80, 1]);
  assert.equal(fireMeetsTrackCeiling(adapted[0], '0.4'), true);
  assert.equal(fireMeetsTrackCeiling(adapted[1], '0.5'), true);
  assert.equal(fireMeetsTrackCeiling(adapted[1], '0.4'), false);
  assert.equal(fireMeetsTrackCeiling(adapted[2], '0.5'), false);
});

test('meridian.firmsTrack persists separately from scan / TI4 / TI5 chips', () => {
  const storage = memoryStorage();
  assert.equal(FIRMS_TRACK_STORAGE_KEY, 'meridian.firmsTrack');
  assert.equal(readFirmsTrackCeiling(storage), DEFAULT_FIRMS_TRACK_CEILING);
  assert.equal(writeFirmsTrackCeiling('0.5', storage), '0.5');
  assert.equal(storage.getItem(FIRMS_TRACK_STORAGE_KEY), '0.5');
  assert.equal(readFirmsTrackCeiling(storage), '0.5');
  assert.equal(writeFirmsTrackCeiling('0.4', storage), '0.4');
  assert.equal(storage.getItem(FIRMS_TRACK_STORAGE_KEY), '0.4');
  writeFirmsTrackCeiling('all', storage);
  assert.equal(storage.getItem(FIRMS_TRACK_STORAGE_KEY), 'all');
  writeFirmsScanCeiling('0.4', storage);
  assert.equal(storage.getItem(FIRMS_SCAN_STORAGE_KEY), '0.4');
  assert.equal(storage.getItem(FIRMS_TRACK_STORAGE_KEY), 'all');
  assert.equal(storage.snapshot()['meridian.firmsBrightness'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsBrightnessTi5'], undefined);
  assert.deepEqual(Object.keys(storage.snapshot()).sort(), [FIRMS_SCAN_STORAGE_KEY, FIRMS_TRACK_STORAGE_KEY].sort());
});

test('flip persist survives reload of a new layer instance', () => {
  const originalStorage = globalThis.localStorage;
  const storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => storage,
  });
  try {
    const first = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
    assert.equal(first.getParams().trackCeiling, 'all');
    first.setParams({ trackCeiling: '0.4' });
    assert.equal(storage.getItem(FIRMS_TRACK_STORAGE_KEY), '0.4');
    const reloaded = createFirmsHeatmapLayer({ id: 'firms-reload', name: 'FIRMS' });
    assert.equal(reloaded.getParams().trackCeiling, '0.4');
    assert.equal(reloaded.getParams().scanCeiling, 'all');
    assert.equal(reloaded.getParams().brightnessTi5Floor, 'all');
    assert.equal(reloaded.getParams().brightnessFloor, 'all');
  } finally {
    if (originalStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalStorage,
      });
    }
  }
});

test('All is the default and matches the unfiltered heatmap', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.getParams().trackCeiling, 'all');
    assert.equal(harness.layer.getParams().scanCeiling, 'all');
    assert.equal(harness.layer.getParams().brightnessTi5Floor, 'all');
    assert.equal(harness.layer.getParams().brightnessFloor, 'all');
    assert.equal(harness.layer.getParams().frpFloor, 'all');
    assert.equal(harness.layer.getStats().count, 4);
    assert.equal(harness.detectionCount(), 4);
  } finally {
    harness.cleanup();
  }
});

test('<0.5km and <0.4km drop wide-track detections and shrink cells', async () => {
  const detections = createHarness(MIXED_FIRES);
  try {
    detections.layer.init(detections.viewer);
    await detections.layer.enable(detections.viewer);
    assert.equal(detections.detectionCount(), 4);

    assert.equal(detections.layer.setParams({ trackCeiling: '0.5' }), true);
    assert.equal(detections.detectionCount(), 2, '<0.5km hides 0.80 VIIRS and 1 km MODIS');
    assert.equal(detections.layer.getStats().count, 2);
    assert.equal(detections.layer.getNearbyFires({ origin: AUSTIN }).length, 2);
    assert.equal(detections.layer.getFireListView({ camera: AUSTIN }).rows.length, 2);

    assert.equal(detections.layer.setParams({ trackCeiling: '0.4' }), true);
    assert.equal(detections.detectionCount(), 1, '<0.4km keeps only near-nadir 0.36 km VIIRS');
    assert.equal(detections.layer.getStats().count, 1);
    assert.equal(detections.layer.getNearbyFires({ origin: AUSTIN }).length, 1);
    assert.equal(detections.layer.getFireListView({ camera: AUSTIN }).rows.length, 1);
  } finally {
    detections.cleanup();
  }

  const cells = createHarness(MIXED_FIRES, { height: CELL_HEIGHT_M });
  try {
    cells.layer.init(cells.viewer);
    await cells.layer.enable(cells.viewer);
    const allCells = cells.layer.getStats().cells;
    assert.ok(allCells >= 4, `All should keep one cell per detection, got ${allCells}`);

    cells.layer.setParams({ trackCeiling: '0.5' });
    const cells05 = cells.layer.getStats().cells;
    assert.ok(cells05 < allCells, `<0.5km must shrink cells (${cells05} vs ${allCells})`);
    assert.equal(cells05, 2);

    cells.layer.setParams({ trackCeiling: '0.4' });
    assert.equal(cells.layer.getStats().cells, 1);
  } finally {
    cells.cleanup();
  }
});

test('chip change re-filters cached fires without a new /api/firms call', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.fetchCount, 1);
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ trackCeiling: '0.5' });
    harness.layer.setParams({ trackCeiling: '0.4' });
    harness.layer.setParams({ trackCeiling: 'all' });
    assert.equal(harness.fetchCount, 1, 'track ceiling chips must not refetch NASA FIRMS');
    assert.equal(harness.detectionCount(), 4);
  } finally {
    harness.cleanup();
  }
});

test('FRP, confidence, TI4, TI5, and scan still AND with the track ceiling', async () => {
  const harness = createHarness(AND_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.detectionCount(), 4);

    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 3, 'FRP 50+ keeps 62/62/140');

    harness.layer.setParams({ trackCeiling: '0.5' });
    assert.equal(harness.layer.getStats().count, 1, '50+ AND <0.5km track keeps only the 0.36 km 140 MW');
    const andTrack = harness.layer.getAnalystRecords();
    assert.ok(andTrack.every((row) => row.frp >= 50));
    assert.deepEqual(andTrack.map((row) => row.frp), [140]);

    harness.layer.setParams({ scanCeiling: '0.5' });
    assert.equal(harness.layer.getStats().count, 1, 'scan <0.5km still keeps the remaining nadir-scan detection');
    assert.equal(harness.layer.getParams().trackCeiling, '0.5', 'scan chip must not overwrite track');

    harness.layer.setParams({ brightnessFloor: '320' });
    assert.equal(harness.layer.getStats().count, 1, 'TI4 320+ still keeps the remaining 360 K TI4 detection');

    harness.layer.setParams({ brightnessTi5Floor: '290' });
    assert.equal(harness.layer.getStats().count, 1, 'TI5 290+ still keeps the remaining 330 K TI5 detection');

    harness.layer.setParams({ confidenceFloor: '0.5' });
    assert.equal(harness.layer.getStats().count, 1, '50+ AND track <0.5km AND scan <0.5km AND TI4 320+ AND TI5 290+ AND 0.5+ keeps 140 MW');
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1, 'AND chip changes still do not refetch');
  } finally {
    harness.cleanup();
  }
});

test('in-memory missing track stays listed after a <0.4km chip', async () => {
  const harness = createHarness([]);
  try {
    harness.layer.init(harness.viewer);
    const fires = [
      {
        index: 0,
        lat: AUSTIN.lat,
        lon: AUSTIN.lon,
        frp: 70,
        confidence: 0.9,
        brightness: 340,
        brightnessTi5: 330,
        scanKm: 0.39,
        trackKm: Number.NaN,
        night: false,
        acqMs: Date.now(),
        sensor: 'VIIRS',
        satellite: 'N20',
      },
      {
        index: 1,
        lat: TOKYO.lat,
        lon: TOKYO.lon,
        frp: 71,
        confidence: 0.9,
        brightness: 340,
        brightnessTi5: 330,
        scanKm: 1.0,
        trackKm: 1.0,
        night: false,
        acqMs: Date.now(),
        sensor: 'MODIS',
        satellite: 'Aqua',
      },
    ];
    harness.layer._bindInteractionForTest(harness.viewer, fires);
    harness.layer.setParams({ trackCeiling: '0.4' });
    const records = harness.layer.getAnalystRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0].frp, 70);
    assert.equal(harness.layer.getNearbyFires({ origin: AUSTIN }).length, 1);
  } finally {
    harness.cleanup();
  }
});

test('refresh keeps the track ceiling and still does not invent a FIRMS endpoint', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    harness.layer.setParams({ trackCeiling: '0.5' });
    assert.equal(harness.layer.getParams().trackCeiling, '0.5');
    assert.equal(harness.layer.getStats().count, 2);
    await harness.layer.update();
    assert.equal(harness.fetchCount, 2, 'scheduled refresh may refetch the same /api/firms payload');
    assert.match(harness.lastUrl, /\/api\/firms$/);
    assert.equal(harness.layer.getParams().trackCeiling, '0.5');
    assert.equal(harness.layer.getStats().count, 2);
    assert.doesNotMatch(harness.lastUrl, /track|scan|brightness|ti5/i);
  } finally {
    harness.cleanup();
  }
});

test('row chips are exclusive All | <0.5km | <0.4km and write trackCeiling', () => {
  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const controls = layer.getRowControls();
  const track = controls.chips.filter((chip) => chip.params.trackCeiling);
  const scan = controls.chips.filter((chip) => chip.params.scanCeiling);
  const ti5 = controls.chips.filter((chip) => chip.params.brightnessTi5Floor);
  const ti4 = controls.chips.filter((chip) => chip.params.brightnessFloor);
  const frp = controls.chips.filter((chip) => chip.params.frpFloor);
  assert.deepEqual(track.map((chip) => chip.label), ['All', '<0.5km', '<0.4km']);
  assert.deepEqual(track.map((chip) => chip.params.trackCeiling), ['all', '0.5', '0.4']);
  assert.deepEqual(scan.map((chip) => chip.params.scanCeiling), ['all', '0.5', '0.4']);
  assert.deepEqual(ti5.map((chip) => chip.params.brightnessTi5Floor), ['all', '290', '310']);
  assert.deepEqual(ti4.map((chip) => chip.params.brightnessFloor), ['all', '320', '340']);
  assert.deepEqual(frp.map((chip) => chip.params.frpFloor), ['all', '10', '50', '100']);
  assert.equal(track[0].active, true);
  assert.equal(track.every((chip) => chip.group === 'Track'), true);
  assert.equal(scan.every((chip) => chip.group === 'Scan'), true);
  layer.setParams({ trackCeiling: '0.5' });
  const after = layer.getRowControls().chips.filter((chip) => chip.params.trackCeiling);
  assert.equal(after.find((chip) => chip.params.trackCeiling === '0.5').active, true);
  assert.equal(after.filter((chip) => chip.active).length, 1);
  layer.setParams({ scanCeiling: '0.4' });
  assert.equal(layer.getParams().trackCeiling, '0.5', 'scan chip must not overwrite track');
  assert.equal(layer.getParams().scanCeiling, '0.4');
  layer.setParams({ brightnessTi5Floor: '290' });
  assert.equal(layer.getParams().trackCeiling, '0.5', 'TI5 chip must not overwrite track');
  assert.equal(layer.getParams().brightnessTi5Floor, '290');
  layer.setParams({ brightnessFloor: '320' });
  assert.equal(layer.getParams().trackCeiling, '0.5', 'TI4 chip must not overwrite track');
  assert.equal(layer.getParams().brightnessFloor, '320');
  layer.setParams({ satelliteFilter: 'N20' });
  assert.equal(layer.getParams().trackCeiling, '0.5', 'satellite chip must not overwrite track');
  assert.deepEqual(firmsTrackChipModels('0.4').map((chip) => chip.active), [false, false, true]);
});

test('FIRMS panel exposes All | <0.5km | <0.4km track chips and hides them when Fires is off', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const adapt = readFileSync(path.join(ROOT, 'src/data/firmsAdapt.js'), 'utf8');
  const csv = readFileSync(path.join(ROOT, 'src/data/firmsCsv.js'), 'utf8');
  const list = readFileSync(path.join(ROOT, 'src/data/firmsList.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const firstRun = readFileSync(path.join(ROOT, 'src/firstRunExperience.js'), 'utf8');
  const panel = html.match(/<div id="fires-panel"[\s\S]*?<p id="fires-list-ack"/);
  assert.ok(panel, 'fires-panel markup is missing');
  assert.match(panel[0], /id="fires-track-chips"/);
  assert.match(panel[0], /data-firms-track="all"[^>]*>All</);
  assert.match(panel[0], /data-firms-track="0\.5"[^>]*>&lt;0\.5km</);
  assert.match(panel[0], /data-firms-track="0\.4"[^>]*>&lt;0\.4km</);
  assert.ok(
    panel[0].indexOf('id="fires-scan-chips"') < panel[0].indexOf('id="fires-track-chips"'),
    'track chips sit after the scan chips',
  );
  assert.ok(
    panel[0].indexOf('id="fires-track-chips"') < panel[0].indexOf('id="fires-list-meta"'),
    'track chips sit on the FIRES panel above the list meta',
  );
  assert.match(panel[0], /We acknowledge the use of data and\/or imagery from NASA's Fire Information for Resource Management System/);
  assert.match(ui, /data-firms-track/);
  assert.match(ui, /trackCeiling/);
  assert.match(ui, /isEnabled\?\.\('local-firms'\)/);
  assert.match(heatmap, /FIRMS_TRACK_CEILING_CHIPS|firmsTrackChipModels/);
  assert.match(heatmap, /readFirmsTrackCeiling|writeFirmsTrackCeiling/);
  assert.match(adapt, /trackKm:\s*finiteNumber\(record\.trackKm \?\? record\.track\)/);
  assert.match(csv, /track:\s*finiteOrZero\(parts\[iTrack\]\)/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/track|\/api\/firms\/trackKm/);
  assert.doesNotMatch(layerState, /trackCeiling|firmsTrack/);
  assert.match(firstRun, /meridian\.firmsTrack/);
  assert.doesNotMatch(firstRun, /writeFirmsTrackCeiling|setFirmsTrackCeiling/);
  assert.doesNotMatch(list, /trackCeiling|trackKm|firmsTrack/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/track.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/trackKm.js')), false);
  assert.ok(fireMeetsBrightnessFloor({ brightness: 300 }, '320') === false);
  assert.ok(fireMeetsBrightnessTi5Floor({ brightnessTi5: 270 }, '290') === false);
});
