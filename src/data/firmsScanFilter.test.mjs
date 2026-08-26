// PLAN 204 — FIRMS scan-size ceiling. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_SCAN_CEILING,
  FIRMS_SCAN_CEILING_CHIPS,
  FIRMS_SCAN_STORAGE_KEY,
  filterFiresByScanCeiling,
  fireMeetsScanCeiling,
  firmsScanChipModels,
  normalizeScanCeiling,
  readFirmsScanCeiling,
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
  rawFire(AUSTIN.lat, AUSTIN.lon, 80, 300, 'h', { scan: 0.375 }),
  rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 81, 325, 'h', { scan: 0.45 }),
  rawFire(TOKYO.lat, TOKYO.lon, 82, 345, 'h', { scan: 0.80 }),
  rawFire(TOKYO.lat + 3, TOKYO.lon + 3, 83, 360, 'h', { scan: 1.0, instrument: 'MODIS' }),
];

const AND_FIRES = [
  rawFire(AUSTIN.lat, AUSTIN.lon, 4.2, 360, 'h', { scan: 0.375, brightnessTi5: 330 }),
  rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 62, 360, 'l', { scan: 1.0, instrument: 'MODIS', brightnessTi5: 330 }),
  rawFire(TOKYO.lat, TOKYO.lon, 62, 360, 'n', { scan: 0.80, brightnessTi5: 270 }),
  rawFire(TOKYO.lat + 3, TOKYO.lon + 3, 140, 360, 'h', { scan: 0.375, brightnessTi5: 330 }),
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

test('normalizeScanCeiling: All / 0.5 / 0.4 only; anything else is All', () => {
  assert.equal(DEFAULT_FIRMS_SCAN_CEILING, 'all');
  assert.equal(normalizeScanCeiling('all'), 'all');
  assert.equal(normalizeScanCeiling(0), 'all');
  assert.equal(normalizeScanCeiling(0.5), '0.5');
  assert.equal(normalizeScanCeiling('0.5'), '0.5');
  assert.equal(normalizeScanCeiling(0.4), '0.4');
  assert.equal(normalizeScanCeiling('0.4'), '0.4');
  assert.equal(normalizeScanCeiling('0.6'), 'all');
  assert.equal(normalizeScanCeiling('1'), 'all');
  assert.equal(normalizeScanCeiling(undefined), 'all');
  assert.equal(normalizeScanCeiling(null), 'all');
  assert.deepEqual(FIRMS_SCAN_CEILING_CHIPS.map((chip) => chip.id), ['all', '0.5', '0.4']);
  assert.deepEqual(FIRMS_SCAN_CEILING_CHIPS.map((chip) => chip.label), ['All', '<0.5km', '<0.4km']);
});

test('All keeps current detections; <0.5km hides MODIS and wide-scan VIIRS; <0.4km keeps near-nadir', () => {
  const nadir = { scanKm: 0.375, frp: 20 };
  const mid = { scanKm: 0.45, frp: 15 };
  const wide = { scanKm: 0.80, frp: 12 };
  const modis = { scanKm: 1.0, frp: 10 };
  assert.equal(fireMeetsScanCeiling(nadir, 'all'), true);
  assert.equal(fireMeetsScanCeiling(nadir, '0.5'), true);
  assert.equal(fireMeetsScanCeiling(nadir, '0.4'), true);
  assert.equal(fireMeetsScanCeiling(mid, 'all'), true);
  assert.equal(fireMeetsScanCeiling(mid, '0.5'), true);
  assert.equal(fireMeetsScanCeiling(mid, '0.4'), false);
  assert.equal(fireMeetsScanCeiling(wide, 'all'), true);
  assert.equal(fireMeetsScanCeiling(wide, '0.5'), false);
  assert.equal(fireMeetsScanCeiling(modis, '0.5'), false);
  assert.equal(fireMeetsScanCeiling(modis, '0.4'), false);
  const fires = [nadir, mid, wide, modis];
  assert.equal(filterFiresByScanCeiling(fires, 'all').length, 4);
  assert.deepEqual(filterFiresByScanCeiling(fires, '0.5').map((fire) => fire.scanKm), [0.375, 0.45]);
  assert.deepEqual(filterFiresByScanCeiling(fires, '0.4').map((fire) => fire.scanKm), [0.375]);
});

test('missing, non-finite, and non-positive scan stays visible at every ceiling', () => {
  const missing = { frp: 40 };
  const nulled = { scanKm: null, frp: 43 };
  const zero = { scanKm: 0, frp: 44 };
  const nan = { scanKm: Number.NaN, frp: 41 };
  const inf = { scanKm: Number.POSITIVE_INFINITY, frp: 42 };
  assert.equal(fireMeetsScanCeiling(missing, '0.5'), true);
  assert.equal(fireMeetsScanCeiling(nulled, '0.4'), true);
  assert.equal(fireMeetsScanCeiling(zero, '0.4'), true);
  assert.equal(fireMeetsScanCeiling(missing, '0.4'), true);
  assert.equal(fireMeetsScanCeiling(nan, '0.4'), true);
  assert.equal(fireMeetsScanCeiling(inf, '0.4'), true);
  assert.deepEqual(
    filterFiresByScanCeiling([missing, nan, nulled, zero, { scanKm: 1.0, frp: 1 }], '0.5')
      .map((fire) => fire.frp),
    [40, 41, 43, 44],
  );
});

test('adapted missing scan stays visible because the adapter stores 0', () => {
  const [fire] = adaptFirmsRecords([
    rawFire(AUSTIN.lat, AUSTIN.lon, 70, 340, 'h', { scan: undefined }),
  ]);
  assert.equal(fire.scanKm, 0);
  assert.equal(fireMeetsScanCeiling(fire, '0.5'), true);
  assert.equal(fireMeetsScanCeiling(fire, '0.4'), true);
});

test('CSV scan column is parsed and scanKm is on the adapted record', () => {
  const csv = [
    HEADER,
    '38.99488,-121.67046,303.6,0.39,0.36,2026-07-16,1006,N20,VIIRS,n,2.0NRT,290.73,0.53,N',
    '32.44483,-116.96709,301.45,0.80,0.47,2026-07-16,1009,N20,VIIRS,n,2.0NRT,289.55,0.4,N',
    '10.0,20.0,330.0,1.00,1.00,2026-07-16,1010,Aqua,MODIS,h,6.1NRT,290.0,12.0,D',
  ].join('\n');
  const parsed = parseFirmsCsv(csv);
  assert.deepEqual(parsed.map((row) => row.scan), [0.39, 0.80, 1]);
  const adapted = adaptFirmsRecords(parsed);
  assert.deepEqual(adapted.map((fire) => fire.scanKm), [0.39, 0.80, 1]);
  assert.equal(fireMeetsScanCeiling(adapted[0], '0.4'), true);
  assert.equal(fireMeetsScanCeiling(adapted[1], '0.5'), false);
  assert.equal(fireMeetsScanCeiling(adapted[2], '0.5'), false);
});

test('meridian.firmsScan persists separately from TI4 / TI5 / satellite chips', () => {
  const storage = memoryStorage();
  assert.equal(FIRMS_SCAN_STORAGE_KEY, 'meridian.firmsScan');
  assert.equal(readFirmsScanCeiling(storage), DEFAULT_FIRMS_SCAN_CEILING);
  assert.equal(writeFirmsScanCeiling('0.5', storage), '0.5');
  assert.equal(storage.getItem(FIRMS_SCAN_STORAGE_KEY), '0.5');
  assert.equal(readFirmsScanCeiling(storage), '0.5');
  assert.equal(writeFirmsScanCeiling('0.4', storage), '0.4');
  assert.equal(storage.getItem(FIRMS_SCAN_STORAGE_KEY), '0.4');
  writeFirmsScanCeiling('all', storage);
  assert.equal(storage.getItem(FIRMS_SCAN_STORAGE_KEY), 'all');
  assert.equal(storage.snapshot()['meridian.firmsBrightness'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsBrightnessTi5'], undefined);
  assert.equal(Object.keys(storage.snapshot()).join(','), FIRMS_SCAN_STORAGE_KEY);
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
    assert.equal(first.getParams().scanCeiling, 'all');
    first.setParams({ scanCeiling: '0.4' });
    assert.equal(storage.getItem(FIRMS_SCAN_STORAGE_KEY), '0.4');
    const reloaded = createFirmsHeatmapLayer({ id: 'firms-reload', name: 'FIRMS' });
    assert.equal(reloaded.getParams().scanCeiling, '0.4');
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

test('<0.5km and <0.4km drop wide-scan detections and shrink cells', async () => {
  const detections = createHarness(MIXED_FIRES);
  try {
    detections.layer.init(detections.viewer);
    await detections.layer.enable(detections.viewer);
    assert.equal(detections.detectionCount(), 4);

    assert.equal(detections.layer.setParams({ scanCeiling: '0.5' }), true);
    assert.equal(detections.detectionCount(), 2, '<0.5km hides 0.80 VIIRS and 1 km MODIS');
    assert.equal(detections.layer.getStats().count, 2);
    assert.equal(detections.layer.getNearbyFires({ origin: AUSTIN }).length, 2);
    assert.equal(detections.layer.getFireListView({ camera: AUSTIN }).rows.length, 2);

    assert.equal(detections.layer.setParams({ scanCeiling: '0.4' }), true);
    assert.equal(detections.detectionCount(), 1, '<0.4km keeps only near-nadir 0.375 km VIIRS');
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

    cells.layer.setParams({ scanCeiling: '0.5' });
    const cells05 = cells.layer.getStats().cells;
    assert.ok(cells05 < allCells, `<0.5km must shrink cells (${cells05} vs ${allCells})`);
    assert.equal(cells05, 2);

    cells.layer.setParams({ scanCeiling: '0.4' });
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

    harness.layer.setParams({ scanCeiling: '0.5' });
    harness.layer.setParams({ scanCeiling: '0.4' });
    harness.layer.setParams({ scanCeiling: 'all' });
    assert.equal(harness.fetchCount, 1, 'scan ceiling chips must not refetch NASA FIRMS');
    assert.equal(harness.detectionCount(), 4);
  } finally {
    harness.cleanup();
  }
});

test('FRP, confidence, TI4, and TI5 still AND with the scan ceiling', async () => {
  const harness = createHarness(AND_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.detectionCount(), 4);

    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 3, 'FRP 50+ keeps 62/62/140');

    harness.layer.setParams({ scanCeiling: '0.5' });
    assert.equal(harness.layer.getStats().count, 1, '50+ AND <0.5km keeps only the 0.375 km 140 MW');
    const andScan = harness.layer.getAnalystRecords();
    assert.ok(andScan.every((row) => row.frp >= 50));
    assert.deepEqual(andScan.map((row) => row.frp), [140]);

    harness.layer.setParams({ brightnessFloor: '320' });
    assert.equal(harness.layer.getStats().count, 1, 'TI4 320+ still keeps the remaining 360 K TI4 detection');

    harness.layer.setParams({ brightnessTi5Floor: '290' });
    assert.equal(harness.layer.getStats().count, 1, 'TI5 290+ still keeps the remaining 330 K TI5 detection');

    harness.layer.setParams({ confidenceFloor: '0.5' });
    assert.equal(harness.layer.getStats().count, 1, '50+ AND <0.5km AND TI4 320+ AND TI5 290+ AND 0.5+ keeps 140 MW');
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1, 'AND chip changes still do not refetch');
  } finally {
    harness.cleanup();
  }
});

test('in-memory missing scan stays listed after a <0.4km chip', async () => {
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
        scanKm: Number.NaN,
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
        night: false,
        acqMs: Date.now(),
        sensor: 'MODIS',
        satellite: 'Aqua',
      },
    ];
    harness.layer._bindInteractionForTest(harness.viewer, fires);
    harness.layer.setParams({ scanCeiling: '0.4' });
    const records = harness.layer.getAnalystRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0].frp, 70);
    assert.equal(harness.layer.getNearbyFires({ origin: AUSTIN }).length, 1);
  } finally {
    harness.cleanup();
  }
});

test('refresh keeps the scan ceiling and still does not invent a FIRMS endpoint', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    harness.layer.setParams({ scanCeiling: '0.5' });
    assert.equal(harness.layer.getParams().scanCeiling, '0.5');
    assert.equal(harness.layer.getStats().count, 2);
    await harness.layer.update();
    assert.equal(harness.fetchCount, 2, 'scheduled refresh may refetch the same /api/firms payload');
    assert.match(harness.lastUrl, /\/api\/firms$/);
    assert.equal(harness.layer.getParams().scanCeiling, '0.5');
    assert.equal(harness.layer.getStats().count, 2);
    assert.doesNotMatch(harness.lastUrl, /scan|brightness|ti5/i);
  } finally {
    harness.cleanup();
  }
});

test('row chips are exclusive All | <0.5km | <0.4km and write scanCeiling', () => {
  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const controls = layer.getRowControls();
  const scan = controls.chips.filter((chip) => chip.params.scanCeiling);
  const ti5 = controls.chips.filter((chip) => chip.params.brightnessTi5Floor);
  const ti4 = controls.chips.filter((chip) => chip.params.brightnessFloor);
  const frp = controls.chips.filter((chip) => chip.params.frpFloor);
  assert.deepEqual(scan.map((chip) => chip.label), ['All', '<0.5km', '<0.4km']);
  assert.deepEqual(scan.map((chip) => chip.params.scanCeiling), ['all', '0.5', '0.4']);
  assert.deepEqual(ti5.map((chip) => chip.params.brightnessTi5Floor), ['all', '290', '310']);
  assert.deepEqual(ti4.map((chip) => chip.params.brightnessFloor), ['all', '320', '340']);
  assert.deepEqual(frp.map((chip) => chip.params.frpFloor), ['all', '10', '50', '100']);
  assert.equal(scan[0].active, true);
  assert.equal(scan.every((chip) => chip.group === 'Scan'), true);
  layer.setParams({ scanCeiling: '0.5' });
  const after = layer.getRowControls().chips.filter((chip) => chip.params.scanCeiling);
  assert.equal(after.find((chip) => chip.params.scanCeiling === '0.5').active, true);
  assert.equal(after.filter((chip) => chip.active).length, 1);
  layer.setParams({ brightnessTi5Floor: '290' });
  assert.equal(layer.getParams().scanCeiling, '0.5', 'TI5 chip must not overwrite scan');
  assert.equal(layer.getParams().brightnessTi5Floor, '290');
  layer.setParams({ brightnessFloor: '320' });
  assert.equal(layer.getParams().scanCeiling, '0.5', 'TI4 chip must not overwrite scan');
  assert.equal(layer.getParams().brightnessFloor, '320');
  layer.setParams({ satelliteFilter: 'N20' });
  assert.equal(layer.getParams().scanCeiling, '0.5', 'satellite chip must not overwrite scan');
  assert.deepEqual(firmsScanChipModels('0.4').map((chip) => chip.active), [false, false, true]);
});

test('FIRMS panel exposes All | <0.5km | <0.4km scan chips and hides them when Fires is off', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const adapt = readFileSync(path.join(ROOT, 'src/data/firmsAdapt.js'), 'utf8');
  const csv = readFileSync(path.join(ROOT, 'src/data/firmsCsv.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const firstRun = readFileSync(path.join(ROOT, 'src/firstRunExperience.js'), 'utf8');
  const panel = html.match(/<div id="fires-panel"[\s\S]*?<p id="fires-list-ack"/);
  assert.ok(panel, 'fires-panel markup is missing');
  assert.match(panel[0], /id="fires-scan-chips"/);
  assert.match(panel[0], /data-firms-scan="all"[^>]*>All</);
  assert.match(panel[0], /data-firms-scan="0\.5"[^>]*>&lt;0\.5km</);
  assert.match(panel[0], /data-firms-scan="0\.4"[^>]*>&lt;0\.4km</);
  assert.ok(
    panel[0].indexOf('id="fires-brightness-ti5-chips"') < panel[0].indexOf('id="fires-scan-chips"'),
    'scan chips sit after the TI5 brightness chips',
  );
  assert.ok(
    panel[0].indexOf('id="fires-scan-chips"') < panel[0].indexOf('id="fires-list-meta"'),
    'scan chips sit on the FIRES panel above the list meta',
  );
  assert.match(ui, /data-firms-scan/);
  assert.match(ui, /scanCeiling/);
  assert.match(ui, /isEnabled\?\.\('local-firms'\)/);
  assert.match(heatmap, /FIRMS_SCAN_CEILING_CHIPS|firmsScanChipModels/);
  assert.match(heatmap, /readFirmsScanCeiling|writeFirmsScanCeiling/);
  assert.match(adapt, /scanKm:\s*finiteNumber\(record\.scanKm \?\? record\.scan\)/);
  assert.match(csv, /scan:\s*finiteOrZero\(parts\[iScan\]\)/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/scan|\/api\/firms\/scanKm/);
  assert.doesNotMatch(layerState, /scanCeiling|firmsScan/);
  assert.match(firstRun, /meridian\.firmsScan/);
  assert.doesNotMatch(firstRun, /writeFirmsScanCeiling|setFirmsScanCeiling/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/scan.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/scanKm.js')), false);
  assert.ok(fireMeetsBrightnessFloor({ brightness: 300 }, '320') === false);
  assert.ok(fireMeetsBrightnessTi5Floor({ brightnessTi5: 270 }, '290') === false);
});
