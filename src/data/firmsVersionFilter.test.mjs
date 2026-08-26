// PLAN 217 — FIRMS product-version chips. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_VERSION_FILTER,
  FIRMS_VERSION_C2_NRT,
  FIRMS_VERSION_CHIPS,
  FIRMS_VERSION_STORAGE_KEY,
  classifyFirmsVersion,
  filterFiresByVersion,
  fireMeetsVersionFilter,
  firmsVersionChipModels,
  normalizeFirmsVersionFilter,
  readFirmsVersionFilter,
  writeFirmsVersionFilter,
} from './firmsVersionFilter.js';
import { FIRMS_TRACK_STORAGE_KEY } from './firmsTrackFilter.js';
import { FIRMS_SCAN_STORAGE_KEY } from './firmsScanFilter.js';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';
import { adaptFirmsRecords } from './firmsAdapt.js';
import { parseFirmsCsv } from './firmsCsv.js';
import { unregisterSpriteCollection } from './spriteOrder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUSTIN = { lon: -97.7, lat: 30.2 };
const TOKYO = { lon: 139.7, lat: 35.7 };
const DETECTION_HEIGHT_M = 1_500_000;
const HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';

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

test('Parse keeps version', () => {
  const csv = [
    HEADER,
    '38.99488,-121.67046,303.6,0.39,0.36,2026-07-16,1006,N20,VIIRS,n,2.0NRT,290.73,0.53,N',
    '32.44483,-116.96709,301.45,0.80,0.47,2026-07-16,1009,N20,VIIRS,n,1.0NRT,289.55,0.4,N',
    '10.0,20.0,330.0,1.00,1.00,2026-07-16,1010,Aqua,MODIS,h,6.1NRT,290.0,12.0,D',
  ].join('\n');
  const parsed = parseFirmsCsv(csv);
  assert.deepEqual(parsed.map((row) => row.version), ['2.0NRT', '1.0NRT', '6.1NRT']);
  assert.deepEqual(parsed.map((row) => row.scan), [0.39, 0.80, 1], 'scan sibling stays parsed');
  assert.deepEqual(parsed.map((row) => row.track), [0.36, 0.47, 1], 'track sibling stays parsed');
  const adapted = adaptFirmsRecords(parsed);
  assert.deepEqual(adapted.map((fire) => fire.version), ['2.0NRT', '1.0NRT', '6.1NRT']);
  const [missing] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', { version: undefined })]);
  assert.equal(missing.version, '');
});

test('All keeps 2.0NRT and 1.0NRT', () => {
  const c2 = { id: 'c2', version: '2.0NRT', frp: 20 };
  const c1 = { id: 'c1', version: '1.0NRT', frp: 15 };
  const missing = { id: 'miss', frp: 10 };
  assert.equal(DEFAULT_FIRMS_VERSION_FILTER, 'all');
  assert.equal(normalizeFirmsVersionFilter('all'), 'all');
  assert.equal(fireMeetsVersionFilter(c2, 'all'), true);
  assert.equal(fireMeetsVersionFilter(c1, 'all'), true);
  assert.equal(fireMeetsVersionFilter(missing, 'all'), true, 'missing version fails open on All');
  assert.deepEqual(
    filterFiresByVersion([c2, c1, missing], 'all').map((fire) => fire.id),
    ['c2', 'c1', 'miss'],
  );
  assert.deepEqual(FIRMS_VERSION_CHIPS.map((chip) => chip.id), ['all', '2.0NRT', 'other']);
  assert.deepEqual(FIRMS_VERSION_CHIPS.map((chip) => chip.label), ['All', '2.0NRT', 'Other']);
});

test('2.0NRT drops 1.0NRT', () => {
  const c2 = { id: 'c2', version: '2.0NRT', frp: 20 };
  const c1 = { id: 'c1', version: '1.0NRT', frp: 15 };
  const folded = { id: 'fold', version: '2.0 nrt', frp: 18 };
  assert.equal(normalizeFirmsVersionFilter('2.0NRT'), FIRMS_VERSION_C2_NRT);
  assert.equal(normalizeFirmsVersionFilter('2.0nrt'), FIRMS_VERSION_C2_NRT);
  assert.equal(classifyFirmsVersion(c2), '2.0NRT');
  assert.equal(classifyFirmsVersion(c1), 'other');
  assert.equal(fireMeetsVersionFilter(c2, '2.0NRT'), true);
  assert.equal(fireMeetsVersionFilter(folded, '2.0NRT'), true);
  assert.equal(fireMeetsVersionFilter(c1, '2.0NRT'), false);
  assert.equal(fireMeetsVersionFilter({ frp: 1 }, '2.0NRT'), false);
  assert.deepEqual(
    filterFiresByVersion([c2, c1, folded], '2.0NRT').map((fire) => fire.id),
    ['c2', 'fold'],
  );
});

test('Other keeps 1.0NRT and missing', () => {
  const c2 = { id: 'c2', version: '2.0NRT', frp: 20 };
  const c1 = { id: 'c1', version: '1.0NRT', frp: 15 };
  const missing = { id: 'miss', frp: 10 };
  const blank = { id: 'blank', version: '', frp: 9 };
  const modis = { id: 'modis', version: '6.1NRT', frp: 8 };
  assert.equal(normalizeFirmsVersionFilter('other'), 'other');
  assert.equal(classifyFirmsVersion(missing), 'other');
  assert.equal(fireMeetsVersionFilter(c1, 'other'), true);
  assert.equal(fireMeetsVersionFilter(missing, 'other'), true);
  assert.equal(fireMeetsVersionFilter(blank, 'other'), true);
  assert.equal(fireMeetsVersionFilter(modis, 'other'), true);
  assert.equal(fireMeetsVersionFilter(c2, 'other'), false);
  assert.deepEqual(
    filterFiresByVersion([c2, c1, missing, blank, modis], 'other').map((fire) => fire.id),
    ['c1', 'miss', 'blank', 'modis'],
  );
});

test('Selected id always kept', () => {
  const c2 = { id: 'c2', version: '2.0NRT', frp: 20 };
  const c1 = { id: 'c1', version: '1.0NRT', frp: 15 };
  const missing = { id: 'miss', frp: 10 };
  assert.equal(fireMeetsVersionFilter(c1, '2.0NRT', { selectedId: 'c1' }), true);
  assert.equal(fireMeetsVersionFilter(c2, 'other', 'c2'), true);
  assert.deepEqual(
    filterFiresByVersion([c2, c1, missing], '2.0NRT', { selectedId: 'c1' }).map((fire) => fire.id),
    ['c2', 'c1'],
  );
  assert.deepEqual(
    filterFiresByVersion([c2, c1], 'other', 'c2').map((fire) => fire.id),
    ['c2', 'c1'],
  );
  const byIndex = { index: 7, version: '1.0NRT', frp: 4 };
  assert.equal(fireMeetsVersionFilter(byIndex, '2.0NRT', { selectedId: '7' }), true);
});

test('Invalid storage reads as All', () => {
  const storage = memoryStorage({ [FIRMS_VERSION_STORAGE_KEY]: '3.0NRT' });
  assert.equal(FIRMS_VERSION_STORAGE_KEY, 'meridian.firmsVersion');
  assert.equal(readFirmsVersionFilter(storage), 'all');
  assert.equal(readFirmsVersionFilter(memoryStorage({ [FIRMS_VERSION_STORAGE_KEY]: 'nrt' })), 'all');
  assert.equal(readFirmsVersionFilter(memoryStorage({ [FIRMS_VERSION_STORAGE_KEY]: 'bogus' })), 'all');
  assert.equal(readFirmsVersionFilter(memoryStorage()), 'all');
  assert.equal(normalizeFirmsVersionFilter('1.0NRT'), 'all');
  assert.equal(normalizeFirmsVersionFilter(undefined), 'all');
  assert.equal(normalizeFirmsVersionFilter(null), 'all');
});

test('Persist flip survives reload', () => {
  const originalStorage = globalThis.localStorage;
  const storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => storage,
  });
  try {
    assert.equal(writeFirmsVersionFilter('2.0NRT', storage), '2.0NRT');
    assert.equal(storage.getItem(FIRMS_VERSION_STORAGE_KEY), '2.0NRT');
    assert.equal(readFirmsVersionFilter(storage), '2.0NRT');
    const first = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
    assert.equal(first.getParams().versionFilter, '2.0NRT');
    first.setParams({ versionFilter: 'other' });
    assert.equal(storage.getItem(FIRMS_VERSION_STORAGE_KEY), 'other');
    const reloaded = createFirmsHeatmapLayer({ id: 'firms-reload', name: 'FIRMS' });
    assert.equal(reloaded.getParams().versionFilter, 'other');
    assert.equal(reloaded.getParams().trackCeiling, 'all');
    assert.equal(reloaded.getParams().scanCeiling, 'all');
    writeFirmsVersionFilter('all', storage);
    writeFirmsVersionFilter('2.0NRT', memoryStorage(storage.snapshot()));
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

test('firmsList.js is unchanged', () => {
  const list = readFileSync(path.join(ROOT, 'src/data/firmsList.js'), 'utf8');
  assert.doesNotMatch(list, /firmsVersion|versionFilter|meridian\.firmsVersion/);
  assert.doesNotMatch(list, /FIRMS_VERSION|classifyFirmsVersion|fireMeetsVersionFilter/);
  assert.doesNotMatch(list, /2\.0NRT|1\.0NRT/);
});

test('version chips AND with FRP / confidence / brightness / scan / track / day-night / age / sensor / satellite', async () => {
  const fires = [
    rawFire(AUSTIN.lat, AUSTIN.lon, 140, 360, 'h', { version: '2.0NRT', brightnessTi5: 330 }),
    rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 140, 360, 'h', { version: '1.0NRT', brightnessTi5: 330 }),
    rawFire(TOKYO.lat, TOKYO.lon, 4.2, 300, 'l', { version: '2.0NRT', brightnessTi5: 270, instrument: 'MODIS', satellite: 'Aqua' }),
  ];
  const harness = createHarness(fires);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.getParams().versionFilter, 'all');
    assert.equal(harness.layer.getStats().count, 3);

    assert.equal(harness.layer.setParams({ versionFilter: '2.0NRT' }), true);
    assert.equal(harness.layer.getStats().count, 2, '2.0NRT drops 1.0NRT');
    assert.equal(harness.fetchCount, 1, 'version chips must not refetch NASA FIRMS');
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 1, '2.0NRT AND FRP 50+ keeps the 140 MW C2 row');
    harness.layer.setParams({ confidenceFloor: '0.5' });
    harness.layer.setParams({ brightnessFloor: '320' });
    harness.layer.setParams({ brightnessTi5Floor: '290' });
    harness.layer.setParams({ scanCeiling: '0.5' });
    harness.layer.setParams({ trackCeiling: '0.5' });
    harness.layer.setParams({ showNight: false });
    harness.layer.setParams({ ageWindow: '24' });
    harness.layer.setParams({ sensors: 'V' });
    assert.equal(harness.layer.getParams().versionFilter, '2.0NRT', 'sibling chips must not overwrite version');
    assert.equal(harness.layer.getStats().count, 1);
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1);

    harness.layer.setParams({ versionFilter: 'other' });
    assert.equal(harness.layer.getStats().count, 1, 'Other plus the AND floors keeps the 140 MW 1.0NRT row');
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
  } finally {
    harness.cleanup();
  }
});

test('FIRMS panel exposes exclusive All | 2.0NRT | Other chips without a new /api', () => {
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
  assert.match(panel[0], /id="fires-version-chips"/);
  assert.match(panel[0], /data-firms-version="all"[^>]*>All</);
  assert.match(panel[0], /data-firms-version="2\.0NRT"[^>]*>2\.0NRT</);
  assert.match(panel[0], /data-firms-version="other"[^>]*>Other</);
  assert.ok(
    panel[0].indexOf('id="fires-track-chips"') < panel[0].indexOf('id="fires-version-chips"'),
    'version chips sit after the track chips',
  );
  assert.ok(
    panel[0].indexOf('id="fires-version-chips"') < panel[0].indexOf('id="fires-list-conf-chips"'),
    'version chips sit above the list-confidence chips',
  );
  assert.match(html, /We acknowledge the use of data and\/or imagery from NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.match(ui, /data-firms-version/);
  assert.match(ui, /versionFilter/);
  assert.match(ui, /isEnabled\?\.\('local-firms'\)/);
  assert.match(heatmap, /FIRMS_VERSION_CHIPS|firmsVersionChipModels/);
  assert.match(heatmap, /readFirmsVersionFilter|writeFirmsVersionFilter/);
  assert.match(adapt, /version:\s*normalizeVersionField\(record\.version\)|version:\s*typeof record\.version/);
  assert.match(csv, /version:\s*cell\(parts,\s*iVersion\)/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/version/);
  assert.doesNotMatch(layerState, /versionFilter|firmsVersion/);
  assert.match(firstRun, /meridian\.firmsVersion/);
  assert.doesNotMatch(firstRun, /writeFirmsVersionFilter|setFirmsVersionFilter/);
  assert.doesNotMatch(list, /versionFilter|firmsVersion|2\.0NRT/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/version.js')), false);
  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const version = layer.getRowControls().chips.filter((chip) => chip.params.versionFilter);
  assert.deepEqual(version.map((chip) => chip.label), ['All', '2.0NRT', 'Other']);
  assert.deepEqual(version.map((chip) => chip.params.versionFilter), ['all', '2.0NRT', 'other']);
  assert.equal(version.every((chip) => chip.group === 'Version'), true);
  layer.setParams({ versionFilter: '2.0NRT' });
  const after = layer.getRowControls().chips.filter((chip) => chip.params.versionFilter);
  assert.equal(after.find((chip) => chip.params.versionFilter === '2.0NRT').active, true);
  assert.equal(after.filter((chip) => chip.active).length, 1);
  assert.deepEqual(firmsVersionChipModels('other').map((chip) => chip.active), [false, false, true]);
});
