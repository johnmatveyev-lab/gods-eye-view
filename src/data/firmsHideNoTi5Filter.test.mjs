// PLAN 290 — FIRMS globe Hide no TI5 toggle. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_HIDE_NO_TI5,
  FIRMS_HIDE_NO_TI5_CHIP_ID,
  FIRMS_HIDE_NO_TI5_CHIP_LABEL,
  FIRMS_HIDE_NO_TI5_STORAGE_KEY,
  filterFiresByHideNoTi5,
  fireHasBrightnessTi5,
  fireMeetsHideNoTi5,
  firmsHideNoTi5ChipModel,
  normalizeFirmsHideNoTi5,
  readFirmsHideNoTi5,
  writeFirmsHideNoTi5,
} from './firmsHideNoTi5Filter.js';
import {
  FIRMS_BRIGHTNESS_TI5_STORAGE_KEY,
  fireMeetsBrightnessTi5Floor,
} from './firmsBrightnessTi5Filter.js';
import { fireMeetsBrightnessFloor } from './firmsBrightnessFloor.js';
import { fireHasBrightness, FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY } from './firmsHideNoBrightnessFilter.js';
import { FIRMS_AREA_STORAGE_KEY } from './firmsAreaFilter.js';
import { FIRMS_HIDE_NO_ACQ_STORAGE_KEY } from './firmsHideNoAcqFilter.js';
import { FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY } from './firmsHideNoConfidenceFilter.js';
import { FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY } from './firmsHideNoDaynightFilter.js';
import { FIRMS_HIDE_NO_FRP_STORAGE_KEY } from './firmsHideNoFrpFilter.js';
import { FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY } from './firmsHideNoSatelliteFilter.js';
import { FIRMS_HIDE_NO_SCAN_STORAGE_KEY } from './firmsHideNoScanFilter.js';
import { FIRMS_HIDE_NO_SENSOR_STORAGE_KEY } from './firmsHideNoSensorFilter.js';
import { FIRMS_HIDE_NO_TRACK_STORAGE_KEY } from './firmsHideNoTrackFilter.js';
import { FIRMS_HIDE_NO_VERSION_STORAGE_KEY } from './firmsHideNoVersionFilter.js';
import { FIRMS_TRACK_STORAGE_KEY } from './firmsTrackFilter.js';
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

const KELVIN = { id: 'kelvin', brightnessTi5: 300, brightness: 340, frp: 20 };
const COOL = { id: 'cool', brightnessTi5: 270, brightness: 340, frp: 18 };
const ZERO = { id: 'zero', brightnessTi5: 0, brightness: 340, frp: 16 };
const MISSING = { id: 'missing', brightness: 340, frp: 14 };
const NANED = { id: 'naned', brightnessTi5: Number.NaN, brightness: 340, frp: 12 };
const INF = { id: 'inf', brightnessTi5: Number.POSITIVE_INFINITY, brightness: 340, frp: 10 };
const NEG = { id: 'neg', brightnessTi5: -1, brightness: 340, frp: 8 };
const TI4_ONLY = { id: 'ti4-only', brightness: 360, brightnessTi5: 0, frp: 6 };

test('Off keeps missing / non-finite / brightnessTi5 <= 0', () => {
  assert.equal(DEFAULT_FIRMS_HIDE_NO_TI5, false);
  assert.equal(FIRMS_HIDE_NO_TI5_STORAGE_KEY, 'meridian.firmsHideNoTi5');
  assert.notEqual(FIRMS_HIDE_NO_TI5_STORAGE_KEY, FIRMS_BRIGHTNESS_TI5_STORAGE_KEY);
  assert.notEqual(FIRMS_HIDE_NO_TI5_STORAGE_KEY, FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY);
  assert.notEqual(FIRMS_HIDE_NO_TI5_STORAGE_KEY, FIRMS_HIDE_NO_TRACK_STORAGE_KEY);
  assert.equal(normalizeFirmsHideNoTi5(undefined), false);
  assert.equal(normalizeFirmsHideNoTi5(null), false);
  assert.equal(normalizeFirmsHideNoTi5(false), false);
  assert.equal(normalizeFirmsHideNoTi5(true), true);
  assert.equal(normalizeFirmsHideNoTi5('1'), true);
  assert.equal(normalizeFirmsHideNoTi5(1), true);

  for (const fire of [KELVIN, COOL, ZERO, MISSING, NANED, INF, NEG, TI4_ONLY]) {
    assert.equal(fireMeetsHideNoTi5(fire, false), true, `off keeps ${fire.id}`);
  }
  assert.deepEqual(
    filterFiresByHideNoTi5([KELVIN, ZERO, MISSING], false).map((fire) => fire.id),
    ['kelvin', 'zero', 'missing'],
  );
  assert.equal(FIRMS_HIDE_NO_TI5_CHIP_LABEL, 'Hide no TI5');
  const chip = firmsHideNoTi5ChipModel(false);
  assert.equal(chip.id, FIRMS_HIDE_NO_TI5_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoTi5: true });
  assert.deepEqual(firmsHideNoTi5ChipModel(true).params, { hideNoTi5: false });
  assert.equal(fireMeetsBrightnessTi5Floor(ZERO, '290'), true, 'TI5 floor still fails open on 0');
  assert.equal(fireMeetsBrightnessTi5Floor(MISSING, '290'), true, 'TI5 floor still fails open on missing');
  assert.equal(fireMeetsBrightnessTi5Floor(NANED, '290'), true, 'TI5 floor still fails open on non-finite');
});

test('On hides missing / non-finite / brightnessTi5 <= 0 and keeps real TI5 Kelvin', () => {
  assert.equal(fireHasBrightnessTi5(KELVIN), true);
  assert.equal(fireHasBrightnessTi5({ brightnessTi5: 300 }), true);
  assert.equal(fireHasBrightnessTi5(COOL), true, 'real cool TI5 stays — not a floor');
  assert.equal(fireHasBrightnessTi5(ZERO), false);
  assert.equal(fireHasBrightnessTi5(MISSING), false);
  assert.equal(fireHasBrightnessTi5(NANED), false);
  assert.equal(fireHasBrightnessTi5(INF), false);
  assert.equal(fireHasBrightnessTi5(NEG), false);
  assert.equal(fireHasBrightnessTi5(null), false);

  assert.equal(fireMeetsHideNoTi5(KELVIN, true), true);
  assert.equal(fireMeetsHideNoTi5({ brightnessTi5: 300 }, true), true);
  assert.equal(fireMeetsHideNoTi5(COOL, true), true, 'presence keeps a real 270 K TI5');
  assert.equal(fireMeetsHideNoTi5(ZERO, true), false, 'brightnessTi5 0 is a hide when on');
  assert.equal(fireMeetsHideNoTi5(MISSING, true), false, 'missing TI5 fails closed when on');
  assert.equal(fireMeetsHideNoTi5(NANED, true), false);
  assert.equal(fireMeetsHideNoTi5(INF, true), false);
  assert.equal(fireMeetsHideNoTi5(NEG, true), false, 'brightnessTi5 <= 0 fails closed');
  assert.deepEqual(
    filterFiresByHideNoTi5([KELVIN, ZERO, NANED, MISSING, INF, COOL], true).map((fire) => fire.id),
    ['kelvin', 'cool'],
  );
  assert.equal(fireMeetsBrightnessTi5Floor(ZERO, '290'), true, 'not a TI5 floor — 290+ still fail-opens 0');
  assert.equal(fireMeetsBrightnessTi5Floor(KELVIN, '290'), true);
  assert.equal(fireMeetsBrightnessTi5Floor(COOL, '290'), false, '290+ floor still hides a cool 270 K');
  assert.equal(fireMeetsHideNoTi5(COOL, true), true, 'presence keeps a real cool TI5');
});

test('Selected no-TI5 still lists', () => {
  assert.equal(fireMeetsHideNoTi5(ZERO, true, { selectedId: 'zero' }), true);
  assert.equal(fireMeetsHideNoTi5(MISSING, true, 'missing'), true);
  assert.deepEqual(
    filterFiresByHideNoTi5([KELVIN, ZERO, MISSING], true, { selectedId: 'zero' }).map((fire) => fire.id),
    ['kelvin', 'zero'],
  );
  assert.deepEqual(
    filterFiresByHideNoTi5([KELVIN, MISSING], true, 'missing').map((fire) => fire.id),
    ['kelvin', 'missing'],
  );
  const byIndex = { index: 7, brightnessTi5: 0, frp: 4 };
  assert.equal(fireMeetsHideNoTi5(byIndex, true, { selectedId: '7' }), true);
});

test('Distinct from the TI5 floor and from TI4 hide-no-brightness', () => {
  assert.equal(FIRMS_HIDE_NO_TI5_STORAGE_KEY, 'meridian.firmsHideNoTi5');
  assert.equal(FIRMS_BRIGHTNESS_TI5_STORAGE_KEY, 'meridian.firmsBrightnessTi5');
  assert.equal(FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY, 'meridian.firmsHideNoBrightness');
  assert.notEqual(FIRMS_HIDE_NO_TI5_STORAGE_KEY, FIRMS_BRIGHTNESS_TI5_STORAGE_KEY);
  assert.notEqual(FIRMS_HIDE_NO_TI5_STORAGE_KEY, FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY);

  assert.equal(fireHasBrightness(TI4_ONLY), true, 'TI4 hide-no-brightness keeps a real TI4 even with no TI5');
  assert.equal(fireHasBrightnessTi5(TI4_ONLY), false, 'Hide no TI5 looks at brightnessTi5, not TI4 brightness');
  assert.equal(fireMeetsHideNoTi5(TI4_ONLY, true), false);
  assert.equal(fireMeetsHideNoTi5({ brightness: 0, brightnessTi5: 300 }, true), true, 'real TI5 stays even with no TI4');
  assert.equal(fireHasBrightness({ brightness: 0, brightnessTi5: 300 }), false);

  assert.equal(fireMeetsBrightnessTi5Floor(TI4_ONLY, '290'), true, 'TI5 floor fail-opens the adapter 0 sentinel');
  assert.equal(fireMeetsBrightnessTi5Floor(COOL, '290'), false);
  assert.equal(fireMeetsHideNoTi5(COOL, true), true);
  assert.equal(fireMeetsBrightnessFloor({ brightness: 300, brightnessTi5: 0 }, '320'), false, 'TI4 floor still uses brightness');
});

test('Invalid / corrupt storage reads as off', () => {
  const storage = memoryStorage({ [FIRMS_HIDE_NO_TI5_STORAGE_KEY]: 'nope' });
  assert.equal(readFirmsHideNoTi5(storage), false);
  assert.equal(readFirmsHideNoTi5(memoryStorage({ [FIRMS_HIDE_NO_TI5_STORAGE_KEY]: '2' })), false);
  assert.equal(readFirmsHideNoTi5(memoryStorage({ [FIRMS_HIDE_NO_TI5_STORAGE_KEY]: 'true' })), true);
  assert.equal(readFirmsHideNoTi5(memoryStorage()), false);
  assert.equal(normalizeFirmsHideNoTi5('bogus'), false);
  assert.equal(normalizeFirmsHideNoTi5(0), false);
  assert.equal(normalizeFirmsHideNoTi5('0'), false);
  assert.equal(readFirmsHideNoTi5({
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
    assert.equal(writeFirmsHideNoTi5(true, storage), true);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_TI5_STORAGE_KEY), '1');
    assert.equal(readFirmsHideNoTi5(storage), true);
    const first = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
    assert.equal(first.getParams().hideNoTi5, true, 'LayerStateCoordinator restore / init re-reads the key');
    first.setParams({ hideNoTi5: false });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_TI5_STORAGE_KEY), '0');
    const reloaded = createFirmsHeatmapLayer({ id: 'firms-reload', name: 'FIRMS' });
    assert.equal(reloaded.getParams().hideNoTi5, false);
    reloaded.setParams({ hideNoTi5: true });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_TI5_STORAGE_KEY), '1');
    const again = createFirmsHeatmapLayer({ id: 'firms-again', name: 'FIRMS' });
    assert.equal(again.getParams().hideNoTi5, true);
    assert.equal(again.getParams().hideNoTrack, false);
    assert.equal(again.getParams().hideNoFrp, false);
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
    assert.equal(again.getParams().brightnessTi5Floor, 'all');
    assert.equal(again.getParams().frpFloor, 'all');
    assert.equal(again.getParams().scanCeiling, 'all');
    assert.equal(again.getParams().trackCeiling, 'all');
    assert.equal(again.getParams().versionFilter, 'all');
    writeFirmsHideNoTi5(false, storage);
    assert.equal(storage.getItem(FIRMS_AREA_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_TRACK_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_BRIGHTNESS_TI5_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_TRACK_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_FRP_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SCAN_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_ACQ_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SENSOR_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_VERSION_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY), null);
    const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
    assert.doesNotMatch(layerState, /hideNoTi5|firmsHideNoTi5/);
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
    assert.doesNotMatch(source, /from '\.\/firmsHideNoTi5Filter\.js'/, `${rel} must stay off the globe hide path`);
    assert.doesNotMatch(source, /meridian\.firmsHideNoTi5'/, `${rel} must stay off the globe hide path`);
    assert.doesNotMatch(source, /FIRMS_HIDE_NO_TI5/, `${rel} must stay off the globe hide path`);
    assert.doesNotMatch(source, /fireMeetsHideNoTi5\(/, `${rel} must stay off the globe hide path`);
  }
  const [adaptedReal] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h')]);
  assert.equal(adaptedReal.brightnessTi5, 300);
  assert.equal(fireHasBrightnessTi5(adaptedReal), true);
  assert.equal(fireMeetsHideNoTi5(adaptedReal, true), true);
  const [adaptedMissing] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', {
    brightnessTi5: 'not-kelvin',
  })]);
  assert.equal(adaptedMissing.brightnessTi5, 0);
  assert.equal(fireMeetsHideNoTi5(adaptedMissing, true), false);
  assert.equal(fireMeetsBrightnessTi5Floor(adaptedMissing, '290'), true, 'TI5 floor still fail-opens the adapter 0 sentinel');
});

test('Hide no TI5 ANDs with existing floors + hide-no chips including 267 TI4 hide-no-brightness and 286 hide-no-track', async () => {
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
  const missingTi5Nadir = {
    ...realNadir,
    id: 'missing-ti5-nadir',
    index: 1,
    lat: AUSTIN.lat + 1,
    lon: AUSTIN.lon + 1,
    brightnessTi5: 0,
  };
  const missingBrightnessReal = {
    ...realNadir,
    id: 'missing-brightness-real',
    index: 2,
    lat: AUSTIN.lat + 2,
    lon: AUSTIN.lon + 2,
    brightness: 0,
  };
  const missingTrackReal = {
    ...realNadir,
    id: 'missing-track-real',
    index: 3,
    lat: AUSTIN.lat + 3,
    lon: AUSTIN.lon + 3,
    trackKm: 0,
  };
  const missingAcqReal = {
    ...realNadir,
    id: 'missing-acq-real',
    index: 4,
    lat: AUSTIN.lat + 4,
    lon: AUSTIN.lon + 4,
    acqMs: 0,
  };
  const lowNight = {
    id: 'low-night',
    index: 5,
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
      missingTi5Nadir,
      missingBrightnessReal,
      missingTrackReal,
      missingAcqReal,
      lowNight,
    ]);
    assert.equal(harness.layer.getParams().hideNoTi5, false);
    assert.equal(harness.layer.getStats().count, 6, 'off keeps brightnessTi5 0 + real TI5');

    harness.layer.setParams({ brightnessTi5Floor: '290' });
    assert.equal(harness.layer.getStats().count, 5, 'TI5 floor still drops 270 K and fail-opens the 0 sentinel');
    harness.layer.setParams({ brightnessTi5Floor: 'all' });
    assert.equal(harness.layer.getStats().count, 6, 'All restores the 270 K row the floor hid');
    assert.equal(harness.layer.setParams({ hideNoTi5: true }), true);
    assert.equal(harness.layer.getStats().count, 5, 'on drops the brightnessTi5-0 nadir that the floor kept');
    assert.equal(harness.fetchCount, 1, 'hide chip must not refetch NASA FIRMS');
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ hideNoBrightness: true });
    assert.equal(harness.layer.getStats().count, 4, 'AND 267 Hide no brightness drops the missing-TI4 real TI5');
    harness.layer.setParams({ hideNoTrack: true });
    assert.equal(harness.layer.getStats().count, 3, 'AND 286 Hide no track drops the missing-track real TI5');
    harness.layer.setParams({ hideNoAcq: true });
    assert.equal(harness.layer.getStats().count, 2, 'hide AND Hide no acq drops the missing-acq real TI5');
    harness.layer.setParams({ hideNoDaynight: true });
    harness.layer.setParams({ hideNoSatellite: true });
    harness.layer.setParams({ hideNoSensor: true });
    harness.layer.setParams({ hideNoVersion: true });
    harness.layer.setParams({ hideNoConfidence: true });
    harness.layer.setParams({ hideNoFrp: true });
    harness.layer.setParams({ hideNoScan: true });
    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 1, 'AND FRP 50+ keeps the 330 K 140 MW nadir');
    harness.layer.setParams({ brightnessFloor: '320' });
    harness.layer.setParams({ ageWindow: '6' });
    harness.layer.setParams({ versionFilter: '2.0NRT' });
    harness.layer.setParams({ showNight: false });
    harness.layer.setParams({ confidenceFloor: '0.8' });
    harness.layer.setParams({ sensors: 'V' });
    harness.layer.setParams({ satelliteFilter: 'AQUA' });
    assert.equal(harness.layer.getParams().hideNoTi5, true, 'sibling chips must not overwrite hide');
    assert.equal(harness.layer.getParams().hideNoTrack, true, '286 hide-no-track stays on');
    assert.equal(harness.layer.getParams().hideNoBrightness, true, '267 hide-no-brightness stays on');
    assert.equal(harness.layer.getParams().hideNoFrp, true);
    assert.equal(harness.layer.getParams().hideNoScan, true);
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
    assert.equal(harness.layer.getParams().brightnessTi5Floor, 'all', 'TI5 floor stays All');
    assert.equal(harness.layer.getParams().frpFloor, '50', 'FRP floor stays 50+');
    assert.equal(harness.layer.getParams().trackCeiling, 'all', 'track-size ceiling stays All');
    assert.equal(harness.layer.getStats().count, 1);
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1);

    harness.layer.setParams({ hideNoTi5: false });
    assert.equal(harness.layer.getStats().count, 2, 'off restores the brightnessTi5-0 nadir under the fail-open floor');
    assert.equal(fireMeetsBrightnessTi5Floor({ brightnessTi5: 0 }, '290'), true);
  } finally {
    harness.cleanup();
  }
});

test('FIRMS row exposes Hide no TI5 from getRowControls() without a new /api', () => {
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
  const ti5Floor = readFileSync(path.join(ROOT, 'src/data/firmsBrightnessTi5Filter.js'), 'utf8');
  const hideBrightness = readFileSync(path.join(ROOT, 'src/data/firmsHideNoBrightnessFilter.js'), 'utf8');
  const hideTrack = readFileSync(path.join(ROOT, 'src/data/firmsHideNoTrackFilter.js'), 'utf8');
  assert.match(heatmap, /firmsHideNoTi5ChipModel/);
  assert.match(heatmap, /readFirmsHideNoTi5|writeFirmsHideNoTi5/);
  assert.match(heatmap, /filterFiresByHideNoTi5/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/ti5\/hide/);
  assert.doesNotMatch(layerState, /hideNoTi5|firmsHideNoTi5/);
  assert.doesNotMatch(firstRun, /writeFirmsHideNoTi5\(/);
  assert.doesNotMatch(list, /from '\.\/firmsHideNoTi5Filter\.js'|meridian\.firmsHideNoTi5'|FIRMS_HIDE_NO_TI5|fireMeetsHideNoTi5\(/);
  assert.doesNotMatch(csv, /hideNoTi5|firmsHideNoTi5/);
  assert.doesNotMatch(adapt, /hideNoTi5|firmsHideNoTi5/);
  assert.doesNotMatch(html, /hide-no-ti5|firmsHideNoTi5/);
  assert.doesNotMatch(ui, /hideNoTi5|firmsHideNoTi5|Hide no TI5/);
  assert.doesNotMatch(css, /hide-no-ti5|firmsHideNoTi5|Hide no TI5/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/ti5Hide.js')), false);
  assert.match(sources, /We acknowledge the use of data and\/or imagery from NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.match(credits, /NASA FIRMS|FIRMS/);
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(heatmap, /God'?s Eye View|GEV rebrand|quantum-earth|opensky|telegeography|google news|googlenews/i);
  assert.match(ti5Floor, /FIRMS_BRIGHTNESS_TI5_STORAGE_KEY = 'meridian\.firmsBrightnessTi5'/);
  assert.match(hideBrightness, /FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY = 'meridian\.firmsHideNoBrightness'/);
  assert.match(hideTrack, /FIRMS_HIDE_NO_TRACK_STORAGE_KEY = 'meridian\.firmsHideNoTrack'/);
  assert.notEqual(FIRMS_HIDE_NO_TI5_STORAGE_KEY, 'meridian.firmsBrightnessTi5');
  assert.notEqual(FIRMS_HIDE_NO_TI5_STORAGE_KEY, FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY);
  assert.notEqual(FIRMS_HIDE_NO_TI5_STORAGE_KEY, FIRMS_HIDE_NO_TRACK_STORAGE_KEY);

  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const chips = layer.getRowControls().chips;
  const hide = chips.find((chip) => chip.id === FIRMS_HIDE_NO_TI5_CHIP_ID);
  const hideTrackChip = chips.find((chip) => chip.id === 'hide-no-track');
  const hideFrpChip = chips.find((chip) => chip.id === 'hide-no-frp');
  const hideScanChip = chips.find((chip) => chip.id === 'hide-no-scan');
  const hideBrightnessChip = chips.find((chip) => chip.id === 'hide-no-brightness');
  const hideAcq = chips.find((chip) => chip.id === 'hide-no-acq');
  const hideConfidence = chips.find((chip) => chip.id === 'hide-no-confidence');
  const hideVersion = chips.find((chip) => chip.id === 'hide-no-version');
  const hideSensor = chips.find((chip) => chip.id === 'hide-no-sensor');
  const hideSatellite = chips.find((chip) => chip.id === 'hide-no-satellite');
  const hideDaynight = chips.find((chip) => chip.id === 'hide-no-daynight');
  const ti5Chips = chips.filter((chip) => chip.group === 'TI5');
  const ageChips = chips.filter((chip) => chip.params.ageWindow);
  assert.ok(hide, 'Hide no TI5 must come from getRowControls()');
  assert.ok(hideTrackChip, '286 Hide no track stays on the row');
  assert.ok(hideFrpChip, '281 Hide no FRP stays on the row');
  assert.ok(hideScanChip, '277 Hide no scan stays on the row');
  assert.ok(hideBrightnessChip, '267 Hide no brightness stays on the row');
  assert.ok(hideAcq, '262 Hide no acq stays on the row');
  assert.ok(hideConfidence, '253 Hide no confidence stays on the row');
  assert.ok(hideVersion, '245 Hide no version stays on the row');
  assert.ok(hideSensor, '241 Hide no sensor stays on the row');
  assert.ok(hideSatellite, '238 Hide no satellite stays on the row');
  assert.ok(hideDaynight, '233 Hide no day/night stays on the row');
  assert.deepEqual(ti5Chips.map((chip) => chip.label), ['All', '290+', '310+']);
  assert.deepEqual(ageChips.map((chip) => chip.label), ['6h', '12h', '24h']);
  assert.equal(hide.label, 'Hide no TI5');
  assert.equal(hide.active, false);
  assert.deepEqual(hide.params, { hideNoTi5: true }, 'globe chip writes hideNoTi5, not brightnessTi5Floor');
  const hideIndex = chips.findIndex((chip) => chip.id === FIRMS_HIDE_NO_TI5_CHIP_ID);
  const trackIndex = chips.findIndex((chip) => chip.id === 'hide-no-track');
  assert.ok(hideIndex === trackIndex + 1, 'Hide no TI5 sits after Hide no track');
  layer.setParams({ hideNoTi5: true });
  assert.equal(
    layer.getRowControls().chips.find((chip) => chip.id === FIRMS_HIDE_NO_TI5_CHIP_ID).active,
    true,
  );
  layer.setParams({ hideNoTrack: true });
  layer.setParams({ hideNoFrp: true });
  layer.setParams({ hideNoScan: true });
  layer.setParams({ hideNoBrightness: true });
  layer.setParams({ hideNoAcq: true });
  layer.setParams({ hideNoConfidence: true });
  layer.setParams({ hideNoVersion: true });
  layer.setParams({ hideNoSensor: true });
  layer.setParams({ hideNoSatellite: true });
  layer.setParams({ hideNoDaynight: true });
  layer.setParams({ ageWindow: '6' });
  layer.setParams({ brightnessTi5Floor: '290' });
  assert.equal(layer.getParams().hideNoTi5, true, '286 hide-no-track stays distinct');
  assert.equal(layer.getParams().hideNoTrack, true);
  assert.equal(layer.getParams().hideNoFrp, true);
  assert.equal(layer.getParams().hideNoScan, true);
  assert.equal(layer.getParams().hideNoBrightness, true);
  assert.equal(layer.getParams().hideNoAcq, true);
  assert.equal(layer.getParams().hideNoConfidence, true);
  assert.equal(layer.getParams().hideNoVersion, true);
  assert.equal(layer.getParams().hideNoSensor, true);
  assert.equal(layer.getParams().hideNoSatellite, true);
  assert.equal(layer.getParams().hideNoDaynight, true);
  assert.equal(layer.getParams().ageWindow, '6', 'age window stays distinct');
  assert.equal(layer.getParams().brightnessTi5Floor, '290', 'TI5 floor stays distinct');
});
