// PLAN 226 — FIRMS pixel-area ceiling chips. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_AREA_CEILING,
  FIRMS_AREA_CEILING_CHIPS,
  FIRMS_AREA_STORAGE_KEY,
  filterFiresByAreaCeiling,
  fireMeetsAreaCeiling,
  firePixelAreaKm2,
  firmsAreaChipModels,
  normalizeAreaCeiling,
  readFirmsAreaCeiling,
  writeFirmsAreaCeiling,
} from './firmsAreaFilter.js';
import { FIRMS_VERSION_STORAGE_KEY } from './firmsVersionFilter.js';
import { FIRMS_TRACK_STORAGE_KEY } from './firmsTrackFilter.js';
import { FIRMS_SCAN_STORAGE_KEY } from './firmsScanFilter.js';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';
import { adaptFirmsRecords } from './firmsAdapt.js';
import { unregisterSpriteCollection } from './spriteOrder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUSTIN = { lon: -97.7, lat: 30.2 };
const TOKYO = { lon: 139.7, lat: 35.7 };
const DETECTION_HEIGHT_M = 1_500_000;

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
    version: '2.0NRT',
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

const NADIR = { id: 'nadir', scanKm: 0.4, trackKm: 0.4, frp: 20 };
const ONE_KM = { id: 'one', scanKm: 1, trackKm: 1, frp: 15 };
const EDGE = { id: 'edge', scanKm: 2, trackKm: 2, frp: 10 };

test('All keeps 0.4×0.4 / 1×1 / 2×2', () => {
  assert.equal(DEFAULT_FIRMS_AREA_CEILING, 'all');
  assert.equal(normalizeAreaCeiling('all'), 'all');
  assert.equal(firePixelAreaKm2(NADIR), 0.4 * 0.4);
  assert.equal(firePixelAreaKm2(ONE_KM), 1);
  assert.equal(firePixelAreaKm2(EDGE), 4);
  assert.equal(fireMeetsAreaCeiling(NADIR, 'all'), true);
  assert.equal(fireMeetsAreaCeiling(ONE_KM, 'all'), true);
  assert.equal(fireMeetsAreaCeiling(EDGE, 'all'), true);
  assert.deepEqual(
    filterFiresByAreaCeiling([NADIR, ONE_KM, EDGE], 'all').map((fire) => fire.id),
    ['nadir', 'one', 'edge'],
  );
  assert.deepEqual(FIRMS_AREA_CEILING_CHIPS.map((chip) => chip.id), ['all', '2', '1']);
  assert.deepEqual(FIRMS_AREA_CEILING_CHIPS.map((chip) => chip.label), ['All', '<2 km²', '<1 km²']);
});

test('2 km² keeps 1×1 drops 2×2', () => {
  assert.equal(normalizeAreaCeiling(2), '2');
  assert.equal(normalizeAreaCeiling('2'), '2');
  assert.equal(fireMeetsAreaCeiling(NADIR, '2'), true);
  assert.equal(fireMeetsAreaCeiling(ONE_KM, '2'), true, '1×1 is 1 km² and stays under <2');
  assert.equal(fireMeetsAreaCeiling(EDGE, '2'), false, '2×2 is 4 km² and drops');
  assert.deepEqual(
    filterFiresByAreaCeiling([NADIR, ONE_KM, EDGE], '2').map((fire) => fire.id),
    ['nadir', 'one'],
  );
});

test('1 km² keeps 0.4×0.4 drops 1×1', () => {
  assert.equal(normalizeAreaCeiling(1), '1');
  assert.equal(normalizeAreaCeiling('1'), '1');
  assert.equal(fireMeetsAreaCeiling(NADIR, '1'), true, '0.4×0.4 is 0.16 km²');
  assert.equal(fireMeetsAreaCeiling(ONE_KM, '1'), false, '1×1 is 1 km² and is not <1');
  assert.equal(fireMeetsAreaCeiling(EDGE, '1'), false);
  assert.deepEqual(
    filterFiresByAreaCeiling([NADIR, ONE_KM, EDGE], '1').map((fire) => fire.id),
    ['nadir'],
  );
});

test('Missing scan stays', () => {
  const missingScan = { id: 'miss-scan', trackKm: 2, frp: 8 };
  const missingTrack = { id: 'miss-track', scanKm: 2, frp: 7 };
  const blankScan = { id: 'blank', scanKm: '', trackKm: 1, frp: 6 };
  const zeroScan = { id: 'zero', scanKm: 0, trackKm: 2, frp: 5 };
  const nanTrack = { id: 'nan', scanKm: 2, trackKm: Number.NaN, frp: 4 };
  assert.equal(fireMeetsAreaCeiling(missingScan, '1'), true);
  assert.equal(fireMeetsAreaCeiling(missingTrack, '1'), true);
  assert.equal(fireMeetsAreaCeiling(blankScan, '2'), true);
  assert.equal(fireMeetsAreaCeiling(zeroScan, '1'), true, 'adapter 0 is unknown, not a zero-area pixel');
  assert.equal(fireMeetsAreaCeiling(nanTrack, '1'), true);
  assert.deepEqual(
    filterFiresByAreaCeiling([EDGE, missingScan, missingTrack], '1').map((fire) => fire.id),
    ['miss-scan', 'miss-track'],
  );
});

test('Selected id always kept', () => {
  assert.equal(fireMeetsAreaCeiling(EDGE, '1', { selectedId: 'edge' }), true);
  assert.equal(fireMeetsAreaCeiling(ONE_KM, '1', 'one'), true);
  assert.deepEqual(
    filterFiresByAreaCeiling([NADIR, ONE_KM, EDGE], '1', { selectedId: 'edge' }).map((fire) => fire.id),
    ['nadir', 'edge'],
  );
  assert.deepEqual(
    filterFiresByAreaCeiling([NADIR, ONE_KM], '1', 'one').map((fire) => fire.id),
    ['nadir', 'one'],
  );
  const byIndex = { index: 7, scanKm: 2, trackKm: 2, frp: 4 };
  assert.equal(fireMeetsAreaCeiling(byIndex, '1', { selectedId: '7' }), true);
});

test('Invalid storage reads as All', () => {
  const storage = memoryStorage({ [FIRMS_AREA_STORAGE_KEY]: '3' });
  assert.equal(FIRMS_AREA_STORAGE_KEY, 'meridian.firmsArea');
  assert.equal(readFirmsAreaCeiling(storage), 'all');
  assert.equal(readFirmsAreaCeiling(memoryStorage({ [FIRMS_AREA_STORAGE_KEY]: '0.5' })), 'all');
  assert.equal(readFirmsAreaCeiling(memoryStorage({ [FIRMS_AREA_STORAGE_KEY]: 'bogus' })), 'all');
  assert.equal(readFirmsAreaCeiling(memoryStorage()), 'all');
  assert.equal(normalizeAreaCeiling('4'), 'all');
  assert.equal(normalizeAreaCeiling(undefined), 'all');
  assert.equal(normalizeAreaCeiling(null), 'all');
});

test('Persist flip survives reload', () => {
  const originalStorage = globalThis.localStorage;
  const storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => storage,
  });
  try {
    assert.equal(writeFirmsAreaCeiling('2', storage), '2');
    assert.equal(storage.getItem(FIRMS_AREA_STORAGE_KEY), '2');
    assert.equal(readFirmsAreaCeiling(storage), '2');
    const first = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
    assert.equal(first.getParams().areaCeiling, '2');
    first.setParams({ areaCeiling: '1' });
    assert.equal(storage.getItem(FIRMS_AREA_STORAGE_KEY), '1');
    const reloaded = createFirmsHeatmapLayer({ id: 'firms-reload', name: 'FIRMS' });
    assert.equal(reloaded.getParams().areaCeiling, '1');
    assert.equal(reloaded.getParams().versionFilter, 'all');
    assert.equal(reloaded.getParams().trackCeiling, 'all');
    assert.equal(reloaded.getParams().scanCeiling, 'all');
    writeFirmsAreaCeiling('all', storage);
    writeFirmsAreaCeiling('2', memoryStorage(storage.snapshot()));
    assert.equal(storage.getItem(FIRMS_VERSION_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_TRACK_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_SCAN_STORAGE_KEY), null);
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

test('firmsList.js / firmsCsv.js / firmsAdapt.js are unchanged', () => {
  const list = readFileSync(path.join(ROOT, 'src/data/firmsList.js'), 'utf8');
  const csv = readFileSync(path.join(ROOT, 'src/data/firmsCsv.js'), 'utf8');
  const adapt = readFileSync(path.join(ROOT, 'src/data/firmsAdapt.js'), 'utf8');
  for (const [name, source] of [['firmsList.js', list], ['firmsCsv.js', csv], ['firmsAdapt.js', adapt]]) {
    assert.doesNotMatch(source, /firmsArea|areaCeiling|meridian\.firmsArea/, `${name} must stay off the area path`);
    assert.doesNotMatch(source, /FIRMS_AREA|fireMeetsAreaCeiling|filterFiresByAreaCeiling/, `${name} must stay off the area path`);
  }
  const [adapted] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', { scan: 0.4, track: 0.4 })]);
  assert.equal(adapted.scanKm, 0.4, 'adapt already stores scanKm — do not re-parse');
  assert.equal(adapted.trackKm, 0.4, 'adapt already stores trackKm — do not re-parse');
  assert.equal(firePixelAreaKm2(adapted), 0.4 * 0.4);
});

test('area chips AND with FRP / confidence / brightness / scan / track / version / day-night / age / sensor / satellite', async () => {
  const fires = [
    rawFire(AUSTIN.lat, AUSTIN.lon, 140, 360, 'h', { scan: 0.4, track: 0.4, version: '2.0NRT', brightnessTi5: 330 }),
    rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 140, 360, 'h', { scan: 2, track: 2, version: '2.0NRT', brightnessTi5: 330 }),
    rawFire(TOKYO.lat, TOKYO.lon, 4.2, 300, 'l', { scan: 0.4, track: 0.4, version: '1.0NRT', brightnessTi5: 270, instrument: 'MODIS', satellite: 'Aqua' }),
  ];
  const harness = createHarness(fires);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.getParams().areaCeiling, 'all');
    assert.equal(harness.layer.getStats().count, 3);

    assert.equal(harness.layer.setParams({ areaCeiling: '1' }), true);
    assert.equal(harness.layer.getStats().count, 2, '<1 km² drops the 2×2 edge pixel');
    assert.equal(harness.fetchCount, 1, 'area chips must not refetch NASA FIRMS');
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 1, '<1 km² AND FRP 50+ keeps the 140 MW nadir row');
    harness.layer.setParams({ confidenceFloor: '0.5' });
    harness.layer.setParams({ brightnessFloor: '320' });
    harness.layer.setParams({ brightnessTi5Floor: '290' });
    harness.layer.setParams({ scanCeiling: '0.5' });
    harness.layer.setParams({ trackCeiling: '0.5' });
    harness.layer.setParams({ versionFilter: '2.0NRT' });
    harness.layer.setParams({ showNight: false });
    harness.layer.setParams({ ageWindow: '24' });
    harness.layer.setParams({ sensors: 'V' });
    assert.equal(harness.layer.getParams().areaCeiling, '1', 'sibling chips must not overwrite area');
    assert.equal(harness.layer.getStats().count, 1);
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1);

    harness.layer.setParams({ areaCeiling: '2' });
    assert.equal(harness.layer.getStats().count, 1, '<2 km² plus the AND floors still keeps the nadir row');
    harness.layer.setParams({ areaCeiling: 'all' });
    harness.layer.setParams({ scanCeiling: 'all' });
    harness.layer.setParams({ trackCeiling: 'all' });
    assert.equal(harness.layer.getStats().count, 2, 'All area plus scan/track All restores the 2×2 C2 row');
  } finally {
    harness.cleanup();
  }
});

test('FIRMS panel exposes exclusive All | <2 km² | <1 km² chips without a new /api', () => {
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
  assert.match(panel[0], /id="fires-area-chips"/);
  assert.match(panel[0], /data-firms-area="all"[^>]*>All</);
  assert.match(panel[0], /data-firms-area="2"[^>]*>&lt;2 km²</);
  assert.match(panel[0], /data-firms-area="1"[^>]*>&lt;1 km²</);
  assert.ok(
    panel[0].indexOf('id="fires-version-chips"') < panel[0].indexOf('id="fires-area-chips"'),
    'area chips sit after the version chips',
  );
  assert.ok(
    panel[0].indexOf('id="fires-area-chips"') < panel[0].indexOf('id="fires-list-conf-chips"'),
    'area chips sit above the list-confidence chips',
  );
  assert.match(html, /We acknowledge the use of data and\/or imagery from NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.match(ui, /data-firms-area/);
  assert.match(ui, /areaCeiling/);
  assert.match(ui, /isEnabled\?\.\('local-firms'\)/);
  assert.match(heatmap, /FIRMS_AREA_CEILING_CHIPS|firmsAreaChipModels/);
  assert.match(heatmap, /readFirmsAreaCeiling|writeFirmsAreaCeiling/);
  assert.match(adapt, /scanKm:\s*finiteNumber\(record\.scanKm \?\? record\.scan\)/);
  assert.match(adapt, /trackKm:\s*finiteNumber\(record\.trackKm \?\? record\.track\)/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/area/);
  assert.doesNotMatch(layerState, /areaCeiling|firmsArea/);
  assert.match(firstRun, /meridian\.firmsArea/);
  assert.doesNotMatch(firstRun, /writeFirmsAreaCeiling|setFirmsAreaCeiling/);
  assert.doesNotMatch(list, /areaCeiling|firmsArea/);
  assert.doesNotMatch(csv, /areaCeiling|firmsArea|scanKm \* trackKm/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/area.js')), false);
  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const area = layer.getRowControls().chips.filter((chip) => chip.params.areaCeiling);
  assert.deepEqual(area.map((chip) => chip.label), ['All', '<2 km²', '<1 km²']);
  assert.deepEqual(area.map((chip) => chip.params.areaCeiling), ['all', '2', '1']);
  assert.equal(area.every((chip) => chip.group === 'Area'), true);
  layer.setParams({ areaCeiling: '2' });
  const after = layer.getRowControls().chips.filter((chip) => chip.params.areaCeiling);
  assert.equal(after.find((chip) => chip.params.areaCeiling === '2').active, true);
  assert.equal(after.filter((chip) => chip.active).length, 1);
  assert.deepEqual(firmsAreaChipModels('1').map((chip) => chip.active), [false, false, true]);
});
