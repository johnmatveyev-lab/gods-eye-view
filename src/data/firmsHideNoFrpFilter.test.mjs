// PLAN 281 — FIRMS globe Hide no FRP toggle. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_HIDE_NO_FRP,
  FIRMS_HIDE_NO_FRP_CHIP_ID,
  FIRMS_HIDE_NO_FRP_CHIP_LABEL,
  FIRMS_HIDE_NO_FRP_STORAGE_KEY,
  filterFiresByHideNoFrp,
  fireHasFrp,
  fireMeetsHideNoFrp,
  firmsHideNoFrpChipModel,
  normalizeFirmsHideNoFrp,
  readFirmsHideNoFrp,
  writeFirmsHideNoFrp,
} from './firmsHideNoFrpFilter.js';
import { FIRMS_AREA_STORAGE_KEY } from './firmsAreaFilter.js';
import { FIRMS_HIDE_NO_ACQ_STORAGE_KEY } from './firmsHideNoAcqFilter.js';
import { FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY } from './firmsHideNoBrightnessFilter.js';
import { FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY } from './firmsHideNoConfidenceFilter.js';
import { FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY } from './firmsHideNoDaynightFilter.js';
import { FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY } from './firmsHideNoSatelliteFilter.js';
import { FIRMS_HIDE_NO_SCAN_STORAGE_KEY } from './firmsHideNoScanFilter.js';
import { FIRMS_HIDE_NO_SENSOR_STORAGE_KEY } from './firmsHideNoSensorFilter.js';
import { FIRMS_HIDE_NO_VERSION_STORAGE_KEY } from './firmsHideNoVersionFilter.js';
import { FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY } from './firmsListHideNoScanFilter.js';
import { FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY } from './firmsListHideNoTrackFilter.js';
import { createFirmsHeatmapLayer, filterFiresByFrpFloor } from './firmsHeatmap.js';
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
    scan: 1.0,
    track: 1.0,
    daynight: 'D',
    ...recentAcqFields(),
    instrument: 'VIIRS',
    satellite: 'NOAA-20',
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

const REAL = { id: 'real', frp: 20 };
const ZERO = { id: 'zero', frp: 0 };
const MISSING = { id: 'missing' };
const NANED = { id: 'naned', frp: Number.NaN };
const INF = { id: 'inf', frp: Number.POSITIVE_INFINITY };
const NEG = { id: 'neg', frp: -1 };
const LOW = { id: 'low', frp: 4.2 };

test('Off keeps missing / non-finite / frp <= 0', () => {
  assert.equal(DEFAULT_FIRMS_HIDE_NO_FRP, false);
  assert.equal(FIRMS_HIDE_NO_FRP_STORAGE_KEY, 'meridian.firmsHideNoFrp');
  assert.notEqual(FIRMS_HIDE_NO_FRP_STORAGE_KEY, FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY);
  assert.notEqual(FIRMS_HIDE_NO_FRP_STORAGE_KEY, FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY);
  assert.equal(normalizeFirmsHideNoFrp(undefined), false);
  assert.equal(normalizeFirmsHideNoFrp(null), false);
  assert.equal(normalizeFirmsHideNoFrp(false), false);
  assert.equal(normalizeFirmsHideNoFrp(true), true);
  assert.equal(normalizeFirmsHideNoFrp('1'), true);
  assert.equal(normalizeFirmsHideNoFrp(1), true);

  for (const fire of [REAL, ZERO, MISSING, NANED, INF, NEG, LOW]) {
    assert.equal(fireMeetsHideNoFrp(fire, false), true, `off keeps ${fire.id}`);
  }
  assert.deepEqual(
    filterFiresByHideNoFrp([REAL, ZERO, MISSING], false).map((fire) => fire.id),
    ['real', 'zero', 'missing'],
  );
  assert.equal(FIRMS_HIDE_NO_FRP_CHIP_LABEL, 'Hide no FRP');
  const chip = firmsHideNoFrpChipModel(false);
  assert.equal(chip.id, FIRMS_HIDE_NO_FRP_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoFrp: true });
  assert.deepEqual(firmsHideNoFrpChipModel(true).params, { hideNoFrp: false });
  assert.deepEqual(
    filterFiresByFrpFloor([ZERO, MISSING, NANED], 'all').map((fire) => fire.id),
    ['zero', 'missing', 'naned'],
    'FRP floor All still fail-opens missing / 0 / non-finite',
  );
});

test('On hides missing / non-finite / frp <= 0 and keeps real MW', () => {
  assert.equal(fireHasFrp(REAL), true);
  assert.equal(fireHasFrp({ frp: 20 }), true);
  assert.equal(fireHasFrp(LOW), true, 'real low MW stays — not a floor');
  assert.equal(fireHasFrp(ZERO), false);
  assert.equal(fireHasFrp(MISSING), false);
  assert.equal(fireHasFrp(NANED), false);
  assert.equal(fireHasFrp(INF), false);
  assert.equal(fireHasFrp(NEG), false);
  assert.equal(fireHasFrp(null), false);

  assert.equal(fireMeetsHideNoFrp(REAL, true), true);
  assert.equal(fireMeetsHideNoFrp({ frp: 20 }, true), true);
  assert.equal(fireMeetsHideNoFrp(LOW, true), true, 'presence keeps a real 4.2 MW');
  assert.equal(fireMeetsHideNoFrp(ZERO, true), false, 'frp 0 is a hide when on');
  assert.equal(fireMeetsHideNoFrp(MISSING, true), false, 'missing FRP fails closed when on');
  assert.equal(fireMeetsHideNoFrp(NANED, true), false);
  assert.equal(fireMeetsHideNoFrp(INF, true), false);
  assert.equal(fireMeetsHideNoFrp(NEG, true), false, 'frp <= 0 fails closed');
  assert.deepEqual(
    filterFiresByHideNoFrp([REAL, ZERO, NANED, MISSING, INF, LOW], true).map((fire) => fire.id),
    ['real', 'low'],
  );
  assert.deepEqual(
    filterFiresByFrpFloor([LOW], '10').map((fire) => fire.id),
    [],
    '10+ floor still hides a real 4.2 MW — this chip is not that floor',
  );
  assert.equal(fireMeetsHideNoFrp({ frp: 4.2 }, true), true, 'presence keeps a real cool MW');
});

test('Selected no-FRP still draws', () => {
  assert.equal(fireMeetsHideNoFrp(ZERO, true, { selectedId: 'zero' }), true);
  assert.equal(fireMeetsHideNoFrp(MISSING, true, 'missing'), true);
  assert.deepEqual(
    filterFiresByHideNoFrp([REAL, ZERO, MISSING], true, { selectedId: 'zero' }).map((fire) => fire.id),
    ['real', 'zero'],
  );
  assert.deepEqual(
    filterFiresByHideNoFrp([REAL, MISSING], true, 'missing').map((fire) => fire.id),
    ['real', 'missing'],
  );
  const byIndex = { index: 7, frp: 0, brightness: 340 };
  assert.equal(fireMeetsHideNoFrp(byIndex, true, { selectedId: '7' }), true);
});

test('Invalid / corrupt storage reads as off', () => {
  const storage = memoryStorage({ [FIRMS_HIDE_NO_FRP_STORAGE_KEY]: 'nope' });
  assert.equal(readFirmsHideNoFrp(storage), false);
  assert.equal(readFirmsHideNoFrp(memoryStorage({ [FIRMS_HIDE_NO_FRP_STORAGE_KEY]: '2' })), false);
  assert.equal(readFirmsHideNoFrp(memoryStorage({ [FIRMS_HIDE_NO_FRP_STORAGE_KEY]: 'true' })), true);
  assert.equal(readFirmsHideNoFrp(memoryStorage()), false);
  assert.equal(normalizeFirmsHideNoFrp('bogus'), false);
  assert.equal(normalizeFirmsHideNoFrp(0), false);
  assert.equal(normalizeFirmsHideNoFrp('0'), false);
  assert.equal(readFirmsHideNoFrp({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');
});

test('Persist / hydrate, no share-URL write', () => {
  const originalStorage = globalThis.localStorage;
  const storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => storage,
  });
  try {
    assert.equal(writeFirmsHideNoFrp(true, storage), true);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_FRP_STORAGE_KEY), '1');
    assert.equal(readFirmsHideNoFrp(storage), true);
    const first = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
    assert.equal(first.getParams().hideNoFrp, true, 'LayerStateCoordinator restore / init re-reads the key');
    first.setParams({ hideNoFrp: false });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_FRP_STORAGE_KEY), '0');
    const reloaded = createFirmsHeatmapLayer({ id: 'firms-reload', name: 'FIRMS' });
    assert.equal(reloaded.getParams().hideNoFrp, false);
    reloaded.setParams({ hideNoFrp: true });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_FRP_STORAGE_KEY), '1');
    const again = createFirmsHeatmapLayer({ id: 'firms-again', name: 'FIRMS' });
    assert.equal(again.getParams().hideNoFrp, true);
    assert.equal(again.getParams().hideNoScan, false);
    assert.equal(again.getParams().hideNoBrightness, false);
    assert.equal(again.getParams().hideNoAcq, false);
    assert.equal(again.getParams().hideNoConfidence, false);
    assert.equal(again.getParams().hideNoVersion, false);
    assert.equal(again.getParams().hideNoSensor, false);
    assert.equal(again.getParams().hideNoSatellite, false);
    assert.equal(again.getParams().hideNoDaynight, false);
    assert.equal(again.getParams().ageWindow, '24');
    assert.equal(again.getParams().confidenceFloor, 'all');
    assert.equal(again.getParams().brightnessFloor, 'all');
    assert.equal(again.getParams().frpFloor, 'all');
    assert.equal(again.getParams().scanCeiling, 'all');
    assert.equal(again.getParams().versionFilter, 'all');
    writeFirmsHideNoFrp(false, storage);
    assert.equal(storage.getItem(FIRMS_AREA_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SCAN_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_ACQ_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SENSOR_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_VERSION_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY), null);
    const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
    assert.doesNotMatch(layerState, /hideNoFrp|firmsHideNoFrp/);
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
  const stayOff = [
    'src/data/firmsList.js',
    'src/data/firmsCsv.js',
    'src/data/firmsAdapt.js',
    'src/data/flights.js',
    'src/data/militaryFlights.js',
    'src/data/damsList.js',
    'src/data/datacenterList.js',
    'src/data/launchesPanel.js',
    'src/data/militaryAwareness.js',
    'src/data/militaryAwarenessEngine.js',
    'src/data/localGeojson.js',
    'src/data/rocketLaunches.js',
    'src/data/earthquakes.js',
  ];
  for (const rel of stayOff) {
    const source = readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(source, /from '\.\/firmsHideNoFrpFilter\.js'/, `${rel} must stay off the globe hide path`);
    assert.doesNotMatch(source, /meridian\.firmsHideNoFrp'/, `${rel} must stay off the globe hide path`);
    assert.doesNotMatch(source, /FIRMS_HIDE_NO_FRP[^_]/, `${rel} must stay off the globe hide path`);
    assert.doesNotMatch(source, /fireMeetsHideNoFrp\(/, `${rel} must stay off the globe hide path`);
  }
  const [adaptedReal] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h')]);
  assert.equal(adaptedReal.frp, 12);
  assert.equal(fireHasFrp(adaptedReal), true);
  assert.equal(fireMeetsHideNoFrp(adaptedReal, true), true);
  const [adaptedMissing] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 'not-an-frp', 340, 'h')]);
  assert.equal(adaptedMissing.frp, 0);
  assert.equal(fireMeetsHideNoFrp(adaptedMissing, true), false);
  assert.deepEqual(
    filterFiresByFrpFloor([adaptedMissing], 'all').map((fire) => fire.frp),
    [0],
    'FRP floor All still fail-opens the adapter 0 sentinel',
  );
});

test('Hide no FRP ANDs with existing floors + hide-no chips including 277 hide-no-scan', async () => {
  const now = Date.now();
  const realNadir = {
    id: 'real-nadir',
    index: 0,
    lat: AUSTIN.lat,
    lon: AUSTIN.lon,
    frp: 140,
    confidence: 0.9,
    brightness: 360,
    brightnessTi5: 330,
    scanKm: 1.0,
    trackKm: 1.0,
    version: '2.0NRT',
    night: false,
    daynight: 'D',
    acqMs: now,
    sensor: 'VIIRS',
    satellite: 'NOAA-20',
  };
  const missingFrpNadir = {
    ...realNadir,
    id: 'missing-frp-nadir',
    index: 1,
    lat: AUSTIN.lat + 1,
    lon: AUSTIN.lon + 1,
    frp: 0,
  };
  const missingScanReal = {
    ...realNadir,
    id: 'missing-scan-real',
    index: 2,
    lat: AUSTIN.lat + 2,
    lon: AUSTIN.lon + 2,
    scanKm: 0,
  };
  const missingAcqReal = {
    ...realNadir,
    id: 'missing-acq-real',
    index: 3,
    lat: AUSTIN.lat + 3,
    lon: AUSTIN.lon + 3,
    acqMs: 0,
  };
  const lowNight = {
    id: 'low-night',
    index: 4,
    lat: TOKYO.lat,
    lon: TOKYO.lon,
    frp: 4.2,
    confidence: 0.3,
    brightness: 300,
    brightnessTi5: 270,
    scanKm: 1.0,
    trackKm: 1.0,
    version: '1.0NRT',
    night: true,
    daynight: 'N',
    acqMs: now,
    sensor: 'MODIS',
    satellite: 'Aqua',
  };
  const harness = createHarness([]);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    harness.layer._bindInteractionForTest(harness.viewer, [
      realNadir,
      missingFrpNadir,
      missingScanReal,
      missingAcqReal,
      lowNight,
    ]);
    assert.equal(harness.layer.getParams().hideNoFrp, false);
    assert.equal(harness.layer.getStats().count, 5, 'off keeps frp 0 + real MW');

    harness.layer.setParams({ frpFloor: 'all' });
    assert.equal(harness.layer.getStats().count, 5, 'All FRP floor still fail-opens the 0 sentinel');
    assert.equal(harness.layer.setParams({ hideNoFrp: true }), true);
    assert.equal(harness.layer.getStats().count, 4, 'on drops the frp-0 nadir that All kept');
    assert.equal(harness.fetchCount, 1, 'hide chip must not refetch NASA FIRMS');
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ hideNoScan: true });
    assert.equal(harness.layer.getStats().count, 3, 'AND 277 Hide no scan drops the missing-scan real MW');
    harness.layer.setParams({ hideNoAcq: true });
    assert.equal(harness.layer.getStats().count, 2, 'hide AND Hide no acq drops the missing-acq real MW');
    harness.layer.setParams({ hideNoDaynight: true });
    harness.layer.setParams({ hideNoSatellite: true });
    harness.layer.setParams({ hideNoSensor: true });
    harness.layer.setParams({ hideNoVersion: true });
    harness.layer.setParams({ hideNoConfidence: true });
    harness.layer.setParams({ hideNoBrightness: true });
    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 1, 'AND FRP 50+ keeps the 140 MW nadir');
    harness.layer.setParams({ brightnessFloor: '320' });
    harness.layer.setParams({ ageWindow: '6' });
    harness.layer.setParams({ versionFilter: '2.0NRT' });
    harness.layer.setParams({ showNight: false });
    harness.layer.setParams({ confidenceFloor: '0.8' });
    harness.layer.setParams({ sensors: 'V' });
    harness.layer.setParams({ satelliteFilter: 'AQUA' });
    assert.equal(harness.layer.getParams().hideNoFrp, true, 'sibling chips must not overwrite hide');
    assert.equal(harness.layer.getParams().hideNoScan, true, '277 hide-no-scan stays on');
    assert.equal(harness.layer.getParams().hideNoBrightness, true, '267 hide-no-brightness stays on');
    assert.equal(harness.layer.getParams().hideNoAcq, true, '262 hide-no-acq stays on');
    assert.equal(harness.layer.getParams().hideNoConfidence, true, '253 hide-no-confidence stays on');
    assert.equal(harness.layer.getParams().hideNoVersion, true);
    assert.equal(harness.layer.getParams().hideNoSensor, true);
    assert.equal(harness.layer.getParams().hideNoSatellite, true);
    assert.equal(harness.layer.getParams().hideNoDaynight, true);
    assert.equal(harness.layer.getParams().ageWindow, '6', 'age window stays 6h');
    assert.equal(harness.layer.getParams().confidenceFloor, '0.8', 'globe confidence floor stays 0.8+');
    assert.equal(harness.layer.getParams().sensors, 'V', 'VIIRS-only stays on');
    assert.equal(harness.layer.getParams().satelliteFilter, 'AQUA', 'Aqua stays disabled');
    assert.equal(harness.layer.getParams().versionFilter, '2.0NRT');
    assert.equal(harness.layer.getParams().brightnessFloor, '320');
    assert.equal(harness.layer.getParams().frpFloor, '50', 'FRP floor stays 50+');
    assert.equal(harness.layer.getStats().count, 1);
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1);

    harness.layer.setParams({ frpFloor: 'all' });
    harness.layer.setParams({ hideNoFrp: false });
    assert.equal(harness.layer.getStats().count, 2, 'off restores the frp-0 nadir under the fail-open All floor');
    assert.deepEqual(
      filterFiresByFrpFloor([{ frp: 0 }], 'all').map((fire) => fire.frp),
      [0],
    );
  } finally {
    harness.cleanup();
  }
});

test('FIRMS row exposes Hide no FRP from getRowControls() without a new /api', () => {
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const firstRun = readFileSync(path.join(ROOT, 'src/firstRunExperience.js'), 'utf8');
  const list = readFileSync(path.join(ROOT, 'src/data/firmsList.js'), 'utf8');
  const csv = readFileSync(path.join(ROOT, 'src/data/firmsCsv.js'), 'utf8');
  const adapt = readFileSync(path.join(ROOT, 'src/data/firmsAdapt.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'src/../index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'src/../style.css'), 'utf8');
  const sources = readFileSync(path.join(ROOT, 'DATA_SOURCES.md'), 'utf8');
  const credits = readFileSync(path.join(ROOT, 'src/data/dataCredits.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const scanHide = readFileSync(path.join(ROOT, 'src/data/firmsHideNoScanFilter.js'), 'utf8');
  const listHideScan = readFileSync(path.join(ROOT, 'src/data/firmsListHideNoScanFilter.js'), 'utf8');
  const listHideTrack = readFileSync(path.join(ROOT, 'src/data/firmsListHideNoTrackFilter.js'), 'utf8');
  const brightness = readFileSync(path.join(ROOT, 'src/data/firmsHideNoBrightnessFilter.js'), 'utf8');
  assert.match(heatmap, /firmsHideNoFrpChipModel/);
  assert.match(heatmap, /readFirmsHideNoFrp|writeFirmsHideNoFrp/);
  assert.match(heatmap, /filterFiresByHideNoFrp/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/frp\/hide/);
  assert.doesNotMatch(layerState, /hideNoFrp|firmsHideNoFrp/);
  assert.doesNotMatch(firstRun, /writeFirmsHideNoFrp\(/);
  assert.doesNotMatch(list, /from '\.\/firmsHideNoFrpFilter\.js'|meridian\.firmsHideNoFrp'|FIRMS_HIDE_NO_FRP[^_]|fireMeetsHideNoFrp\(/);
  assert.doesNotMatch(csv, /hideNoFrp|firmsHideNoFrp/);
  assert.doesNotMatch(adapt, /hideNoFrp|firmsHideNoFrp/);
  assert.doesNotMatch(html, /hide-no-frp|firmsHideNoFrp/);
  assert.doesNotMatch(ui, /hideNoFrp|firmsHideNoFrp|Hide no FRP/);
  assert.doesNotMatch(css, /hide-no-frp|firmsHideNoFrp|Hide no FRP/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/frpHide.js')), false);
  assert.match(sources, /We acknowledge the use of data and\/or imagery from NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.match(credits, /NASA FIRMS|FIRMS/);
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(heatmap, /God'?s Eye View|GEV rebrand|quantum-earth|opensky|telegeography|google news|googlenews/i);
  assert.match(scanHide, /FIRMS_HIDE_NO_SCAN_STORAGE_KEY = 'meridian\.firmsHideNoScan'/);
  assert.match(listHideScan, /FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY = 'meridian\.firmsListHideNoScan'/);
  assert.match(listHideTrack, /FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY = 'meridian\.firmsListHideNoTrack'/);
  assert.match(brightness, /FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY = 'meridian\.firmsHideNoBrightness'/);
  assert.notEqual(FIRMS_HIDE_NO_FRP_STORAGE_KEY, 'meridian.firmsScan');
  assert.notEqual(FIRMS_HIDE_NO_FRP_STORAGE_KEY, FIRMS_HIDE_NO_SCAN_STORAGE_KEY);
  assert.notEqual(FIRMS_HIDE_NO_FRP_STORAGE_KEY, FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY);
  assert.notEqual(FIRMS_HIDE_NO_FRP_STORAGE_KEY, FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY);
  assert.notEqual(FIRMS_HIDE_NO_FRP_STORAGE_KEY, FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY);

  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const chips = layer.getRowControls().chips;
  const hide = chips.find((chip) => chip.id === FIRMS_HIDE_NO_FRP_CHIP_ID);
  const hideScan = chips.find((chip) => chip.id === 'hide-no-scan');
  const hideBrightness = chips.find((chip) => chip.id === 'hide-no-brightness');
  const hideAcq = chips.find((chip) => chip.id === 'hide-no-acq');
  const hideConfidence = chips.find((chip) => chip.id === 'hide-no-confidence');
  const hideVersion = chips.find((chip) => chip.id === 'hide-no-version');
  const hideSensor = chips.find((chip) => chip.id === 'hide-no-sensor');
  const hideSatellite = chips.find((chip) => chip.id === 'hide-no-satellite');
  const hideDaynight = chips.find((chip) => chip.id === 'hide-no-daynight');
  const frpChips = chips.filter((chip) => chip.group === 'FRP');
  const ageChips = chips.filter((chip) => chip.params.ageWindow);
  assert.ok(hide, 'Hide no FRP must come from getRowControls()');
  assert.ok(hideScan, '277 Hide no scan stays on the row');
  assert.ok(hideBrightness, '267 Hide no brightness stays on the row');
  assert.ok(hideAcq, '262 Hide no acq stays on the row');
  assert.ok(hideConfidence, '253 Hide no confidence stays on the row');
  assert.ok(hideVersion, '245 Hide no version stays on the row');
  assert.ok(hideSensor, '241 Hide no sensor stays on the row');
  assert.ok(hideSatellite, '238 Hide no satellite stays on the row');
  assert.ok(hideDaynight, '233 Hide no day/night stays on the row');
  assert.deepEqual(frpChips.map((chip) => chip.label), ['All', '10+', '50+', '100+ MW']);
  assert.deepEqual(ageChips.map((chip) => chip.label), ['6h', '12h', '24h']);
  assert.equal(hide.label, 'Hide no FRP');
  assert.equal(hide.active, false);
  assert.deepEqual(hide.params, { hideNoFrp: true });
  const hideIndex = chips.findIndex((chip) => chip.id === FIRMS_HIDE_NO_FRP_CHIP_ID);
  const scanIndex = chips.findIndex((chip) => chip.id === 'hide-no-scan');
  assert.ok(hideIndex === scanIndex + 1, 'Hide no FRP sits after Hide no scan');
  assert.ok(!chips.some((chip) => chip.id === 'hide-no-track'), 'list Hide no track is not a globe chip');
  layer.setParams({ hideNoFrp: true });
  assert.equal(
    layer.getRowControls().chips.find((chip) => chip.id === FIRMS_HIDE_NO_FRP_CHIP_ID).active,
    true,
  );
  layer.setParams({ hideNoScan: true });
  layer.setParams({ hideNoBrightness: true });
  layer.setParams({ hideNoAcq: true });
  layer.setParams({ hideNoConfidence: true });
  layer.setParams({ hideNoVersion: true });
  layer.setParams({ hideNoSensor: true });
  layer.setParams({ hideNoSatellite: true });
  layer.setParams({ hideNoDaynight: true });
  layer.setParams({ ageWindow: '6' });
  layer.setParams({ frpFloor: '50' });
  assert.equal(layer.getParams().hideNoFrp, true, '277 hide-no-scan stays distinct');
  assert.equal(layer.getParams().hideNoScan, true);
  assert.equal(layer.getParams().hideNoBrightness, true);
  assert.equal(layer.getParams().hideNoAcq, true);
  assert.equal(layer.getParams().hideNoConfidence, true);
  assert.equal(layer.getParams().hideNoVersion, true);
  assert.equal(layer.getParams().hideNoSensor, true);
  assert.equal(layer.getParams().hideNoSatellite, true);
  assert.equal(layer.getParams().hideNoDaynight, true);
  assert.equal(layer.getParams().ageWindow, '6', 'age window stays distinct');
  assert.equal(layer.getParams().frpFloor, '50', 'FRP floor chips stay distinct');
});
