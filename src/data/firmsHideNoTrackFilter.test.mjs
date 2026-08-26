// PLAN 286 — FIRMS globe Hide no track toggle. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_HIDE_NO_TRACK,
  FIRMS_HIDE_NO_TRACK_CHIP_ID,
  FIRMS_HIDE_NO_TRACK_CHIP_LABEL,
  FIRMS_HIDE_NO_TRACK_STORAGE_KEY,
  filterFiresByHideNoTrack,
  fireHasTrack,
  fireMeetsHideNoTrack,
  firmsHideNoTrackChipModel,
  normalizeFirmsHideNoTrack,
  readFirmsHideNoTrack,
  writeFirmsHideNoTrack,
} from './firmsHideNoTrackFilter.js';
import { FIRMS_TRACK_STORAGE_KEY, fireMeetsTrackCeiling } from './firmsTrackFilter.js';
import { FIRMS_AREA_STORAGE_KEY } from './firmsAreaFilter.js';
import { FIRMS_HIDE_NO_ACQ_STORAGE_KEY } from './firmsHideNoAcqFilter.js';
import { FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY } from './firmsHideNoBrightnessFilter.js';
import { FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY } from './firmsHideNoConfidenceFilter.js';
import { FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY } from './firmsHideNoDaynightFilter.js';
import { FIRMS_HIDE_NO_FRP_STORAGE_KEY } from './firmsHideNoFrpFilter.js';
import { FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY } from './firmsHideNoSatelliteFilter.js';
import { FIRMS_HIDE_NO_SCAN_STORAGE_KEY } from './firmsHideNoScanFilter.js';
import { FIRMS_HIDE_NO_SENSOR_STORAGE_KEY } from './firmsHideNoSensorFilter.js';
import { FIRMS_HIDE_NO_VERSION_STORAGE_KEY } from './firmsHideNoVersionFilter.js';
import { FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY } from './firmsListHideNoFrpFilter.js';
import { FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY } from './firmsListHideNoScanFilter.js';
import { FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY } from './firmsListHideNoTrackFilter.js';
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

const ONE_KM = { id: 'one-km', trackKm: 1.0, frp: 20 };
const ZERO = { id: 'zero', trackKm: 0, frp: 18 };
const MISSING = { id: 'missing', frp: 16 };
const NANED = { id: 'naned', trackKm: Number.NaN, frp: 14 };
const INF = { id: 'inf', trackKm: Number.POSITIVE_INFINITY, frp: 12 };
const NEG = { id: 'neg', trackKm: -1, frp: 10 };
const NARROW = { id: 'narrow', trackKm: 0.375, frp: 8 };

test('Off keeps missing / non-finite / trackKm <= 0', () => {
  assert.equal(DEFAULT_FIRMS_HIDE_NO_TRACK, false);
  assert.equal(FIRMS_HIDE_NO_TRACK_STORAGE_KEY, 'meridian.firmsHideNoTrack');
  assert.notEqual(FIRMS_HIDE_NO_TRACK_STORAGE_KEY, FIRMS_TRACK_STORAGE_KEY);
  assert.notEqual(FIRMS_HIDE_NO_TRACK_STORAGE_KEY, FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY);
  assert.notEqual(FIRMS_HIDE_NO_TRACK_STORAGE_KEY, FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY);
  assert.notEqual(FIRMS_HIDE_NO_TRACK_STORAGE_KEY, FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY);
  assert.equal(normalizeFirmsHideNoTrack(undefined), false);
  assert.equal(normalizeFirmsHideNoTrack(null), false);
  assert.equal(normalizeFirmsHideNoTrack(false), false);
  assert.equal(normalizeFirmsHideNoTrack(true), true);
  assert.equal(normalizeFirmsHideNoTrack('1'), true);
  assert.equal(normalizeFirmsHideNoTrack(1), true);

  for (const fire of [ONE_KM, ZERO, MISSING, NANED, INF, NEG, NARROW]) {
    assert.equal(fireMeetsHideNoTrack(fire, false), true, `off keeps ${fire.id}`);
  }
  assert.deepEqual(
    filterFiresByHideNoTrack([ONE_KM, ZERO, MISSING], false).map((fire) => fire.id),
    ['one-km', 'zero', 'missing'],
  );
  assert.equal(FIRMS_HIDE_NO_TRACK_CHIP_LABEL, 'Hide no track');
  const chip = firmsHideNoTrackChipModel(false);
  assert.equal(chip.id, FIRMS_HIDE_NO_TRACK_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoTrack: true });
  assert.deepEqual(firmsHideNoTrackChipModel(true).params, { hideNoTrack: false });
  assert.equal(fireMeetsTrackCeiling(ZERO, '0.5'), true, 'track ceiling still fails open on 0');
  assert.equal(fireMeetsTrackCeiling(MISSING, '0.5'), true, 'track ceiling still fails open on missing');
  assert.equal(fireMeetsTrackCeiling(NANED, '0.5'), true, 'track ceiling still fails open on non-finite');
});

test('On hides missing / non-finite / trackKm <= 0 and keeps real trackKm', () => {
  assert.equal(fireHasTrack(ONE_KM), true);
  assert.equal(fireHasTrack({ trackKm: 1.0 }), true);
  assert.equal(fireHasTrack(NARROW), true, 'real narrow track stays — not a ceiling');
  assert.equal(fireHasTrack(ZERO), false);
  assert.equal(fireHasTrack(MISSING), false);
  assert.equal(fireHasTrack(NANED), false);
  assert.equal(fireHasTrack(INF), false);
  assert.equal(fireHasTrack(NEG), false);
  assert.equal(fireHasTrack(null), false);

  assert.equal(fireMeetsHideNoTrack(ONE_KM, true), true);
  assert.equal(fireMeetsHideNoTrack({ trackKm: 1.0 }, true), true);
  assert.equal(fireMeetsHideNoTrack(NARROW, true), true, 'presence keeps a real 0.375 km');
  assert.equal(fireMeetsHideNoTrack(ZERO, true), false, 'trackKm 0 is a hide when on');
  assert.equal(fireMeetsHideNoTrack(MISSING, true), false, 'missing track fails closed when on');
  assert.equal(fireMeetsHideNoTrack(NANED, true), false);
  assert.equal(fireMeetsHideNoTrack(INF, true), false);
  assert.equal(fireMeetsHideNoTrack(NEG, true), false, 'trackKm <= 0 fails closed');
  assert.deepEqual(
    filterFiresByHideNoTrack([ONE_KM, ZERO, NANED, MISSING, INF, NARROW], true).map((fire) => fire.id),
    ['one-km', 'narrow'],
  );
  assert.equal(fireMeetsTrackCeiling(ZERO, '0.5'), true, 'not a track-size ceiling — <0.5km still fail-opens 0');
  assert.equal(fireMeetsTrackCeiling(ONE_KM, '0.5'), false, 'track ceiling still hides a 1.0 km MODIS pixel');
  assert.equal(fireMeetsHideNoTrack({ trackKm: 1.0 }, true), true, 'presence keeps a real 1.0 km track');
});

test('Selected no-track still lists', () => {
  assert.equal(fireMeetsHideNoTrack(ZERO, true, { selectedId: 'zero' }), true);
  assert.equal(fireMeetsHideNoTrack(MISSING, true, 'missing'), true);
  assert.deepEqual(
    filterFiresByHideNoTrack([ONE_KM, ZERO, MISSING], true, { selectedId: 'zero' }).map((fire) => fire.id),
    ['one-km', 'zero'],
  );
  assert.deepEqual(
    filterFiresByHideNoTrack([ONE_KM, MISSING], true, 'missing').map((fire) => fire.id),
    ['one-km', 'missing'],
  );
  const byIndex = { index: 7, trackKm: 0, frp: 4 };
  assert.equal(fireMeetsHideNoTrack(byIndex, true, { selectedId: '7' }), true);
});

test('Invalid / corrupt storage reads as off', () => {
  const storage = memoryStorage({ [FIRMS_HIDE_NO_TRACK_STORAGE_KEY]: 'nope' });
  assert.equal(readFirmsHideNoTrack(storage), false);
  assert.equal(readFirmsHideNoTrack(memoryStorage({ [FIRMS_HIDE_NO_TRACK_STORAGE_KEY]: '2' })), false);
  assert.equal(readFirmsHideNoTrack(memoryStorage({ [FIRMS_HIDE_NO_TRACK_STORAGE_KEY]: 'true' })), true);
  assert.equal(readFirmsHideNoTrack(memoryStorage()), false);
  assert.equal(normalizeFirmsHideNoTrack('bogus'), false);
  assert.equal(normalizeFirmsHideNoTrack(0), false);
  assert.equal(normalizeFirmsHideNoTrack('0'), false);
  assert.equal(readFirmsHideNoTrack({
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
    assert.equal(writeFirmsHideNoTrack(true, storage), true);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_TRACK_STORAGE_KEY), '1');
    assert.equal(readFirmsHideNoTrack(storage), true);
    const first = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
    assert.equal(first.getParams().hideNoTrack, true, 'LayerStateCoordinator restore / init re-reads the key');
    first.setParams({ hideNoTrack: false });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_TRACK_STORAGE_KEY), '0');
    const reloaded = createFirmsHeatmapLayer({ id: 'firms-reload', name: 'FIRMS' });
    assert.equal(reloaded.getParams().hideNoTrack, false);
    reloaded.setParams({ hideNoTrack: true });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_TRACK_STORAGE_KEY), '1');
    const again = createFirmsHeatmapLayer({ id: 'firms-again', name: 'FIRMS' });
    assert.equal(again.getParams().hideNoTrack, true);
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
    assert.equal(again.getParams().frpFloor, 'all');
    assert.equal(again.getParams().scanCeiling, 'all');
    assert.equal(again.getParams().trackCeiling, 'all');
    assert.equal(again.getParams().versionFilter, 'all');
    writeFirmsHideNoTrack(false, storage);
    assert.equal(storage.getItem(FIRMS_AREA_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_TRACK_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_FRP_STORAGE_KEY), null);
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
    assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY), null);
    const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
    assert.doesNotMatch(layerState, /hideNoTrack|firmsHideNoTrack/);
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
    assert.doesNotMatch(source, /from '\.\/firmsHideNoTrackFilter\.js'/, `${rel} must stay off the globe hide path`);
    assert.doesNotMatch(source, /meridian\.firmsHideNoTrack'/, `${rel} must stay off the globe hide path`);
    assert.doesNotMatch(source, /FIRMS_HIDE_NO_TRACK[^_]/, `${rel} must stay off the globe hide path`);
    assert.doesNotMatch(source, /fireMeetsHideNoTrack\(/, `${rel} must stay off the globe hide path`);
  }
  const [adaptedReal] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h')]);
  assert.equal(adaptedReal.trackKm, 1);
  assert.equal(fireHasTrack(adaptedReal), true);
  assert.equal(fireMeetsHideNoTrack(adaptedReal, true), true);
  const [adaptedMissing] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', {
    track: 'not-a-track',
    trackKm: 'not-a-track',
  })]);
  assert.equal(adaptedMissing.trackKm, 0);
  assert.equal(fireMeetsHideNoTrack(adaptedMissing, true), false);
  assert.equal(fireMeetsTrackCeiling(adaptedMissing, '0.5'), true, 'track ceiling still fail-opens the adapter 0 sentinel');
});

test('Hide no track ANDs with existing floors + hide-no chips including 277 hide-no-scan and 281 hide-no-FRP', async () => {
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
  const missingTrackNadir = {
    ...realNadir,
    id: 'missing-track-nadir',
    index: 1,
    lat: AUSTIN.lat + 1,
    lon: AUSTIN.lon + 1,
    trackKm: 0,
  };
  const missingFrpReal = {
    ...realNadir,
    id: 'missing-frp-real',
    index: 2,
    lat: AUSTIN.lat + 2,
    lon: AUSTIN.lon + 2,
    frp: 0,
  };
  const missingScanReal = {
    ...realNadir,
    id: 'missing-scan-real',
    index: 3,
    lat: AUSTIN.lat + 3,
    lon: AUSTIN.lon + 3,
    scanKm: 0,
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
      missingTrackNadir,
      missingFrpReal,
      missingScanReal,
      missingAcqReal,
      lowNight,
    ]);
    assert.equal(harness.layer.getParams().hideNoTrack, false);
    assert.equal(harness.layer.getStats().count, 6, 'off keeps trackKm 0 + real track');

    harness.layer.setParams({ trackCeiling: '0.5' });
    assert.equal(harness.layer.getStats().count, 1, 'track ceiling still drops 1.0 km and fail-opens the 0 sentinel');
    harness.layer.setParams({ trackCeiling: 'all' });
    assert.equal(harness.layer.getStats().count, 6, 'All restores the 1.0 km rows the ceiling hid');
    assert.equal(harness.layer.setParams({ hideNoTrack: true }), true);
    assert.equal(harness.layer.getStats().count, 5, 'on drops the trackKm-0 nadir that the ceiling kept');
    assert.equal(harness.fetchCount, 1, 'hide chip must not refetch NASA FIRMS');
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ hideNoFrp: true });
    assert.equal(harness.layer.getStats().count, 4, 'AND 281 Hide no FRP drops the missing-FRP real track');
    harness.layer.setParams({ hideNoScan: true });
    assert.equal(harness.layer.getStats().count, 3, 'AND 277 Hide no scan drops the missing-scan real track');
    harness.layer.setParams({ hideNoAcq: true });
    assert.equal(harness.layer.getStats().count, 2, 'hide AND Hide no acq drops the missing-acq real track');
    harness.layer.setParams({ hideNoDaynight: true });
    harness.layer.setParams({ hideNoSatellite: true });
    harness.layer.setParams({ hideNoSensor: true });
    harness.layer.setParams({ hideNoVersion: true });
    harness.layer.setParams({ hideNoConfidence: true });
    harness.layer.setParams({ hideNoBrightness: true });
    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 1, 'AND FRP 50+ keeps the 1.0 km 140 MW nadir');
    harness.layer.setParams({ brightnessFloor: '320' });
    harness.layer.setParams({ ageWindow: '6' });
    harness.layer.setParams({ versionFilter: '2.0NRT' });
    harness.layer.setParams({ showNight: false });
    harness.layer.setParams({ confidenceFloor: '0.8' });
    harness.layer.setParams({ sensors: 'V' });
    harness.layer.setParams({ satelliteFilter: 'AQUA' });
    assert.equal(harness.layer.getParams().hideNoTrack, true, 'sibling chips must not overwrite hide');
    assert.equal(harness.layer.getParams().hideNoFrp, true, '281 hide-no-FRP stays on');
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
    assert.equal(harness.layer.getParams().trackCeiling, 'all', 'track-size ceiling stays All');
    assert.equal(harness.layer.getStats().count, 1);
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1);

    harness.layer.setParams({ hideNoTrack: false });
    assert.equal(harness.layer.getStats().count, 2, 'off restores the trackKm-0 nadir under the fail-open ceiling');
    assert.equal(fireMeetsTrackCeiling({ trackKm: 0 }, '0.5'), true);
  } finally {
    harness.cleanup();
  }
});

test('FIRMS row exposes Hide no track from getRowControls() without a new /api', () => {
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
  const trackCeiling = readFileSync(path.join(ROOT, 'src/data/firmsTrackFilter.js'), 'utf8');
  const listHideTrack = readFileSync(path.join(ROOT, 'src/data/firmsListHideNoTrackFilter.js'), 'utf8');
  const hideFrp = readFileSync(path.join(ROOT, 'src/data/firmsHideNoFrpFilter.js'), 'utf8');
  const hideScan = readFileSync(path.join(ROOT, 'src/data/firmsHideNoScanFilter.js'), 'utf8');
  assert.match(heatmap, /firmsHideNoTrackChipModel/);
  assert.match(heatmap, /readFirmsHideNoTrack|writeFirmsHideNoTrack/);
  assert.match(heatmap, /filterFiresByHideNoTrack/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/track\/hide/);
  assert.doesNotMatch(layerState, /hideNoTrack|firmsHideNoTrack/);
  assert.doesNotMatch(firstRun, /writeFirmsHideNoTrack\(/);
  assert.doesNotMatch(list, /from '\.\/firmsHideNoTrackFilter\.js'|meridian\.firmsHideNoTrack'|FIRMS_HIDE_NO_TRACK[^_]|fireMeetsHideNoTrack\(/);
  assert.doesNotMatch(csv, /hideNoTrack|firmsHideNoTrack/);
  assert.doesNotMatch(adapt, /hideNoTrack|firmsHideNoTrack/);
  assert.doesNotMatch(html, /hide-no-track|firmsHideNoTrack/);
  assert.doesNotMatch(ui, /hideNoTrack|firmsHideNoTrack|Hide no track/);
  assert.doesNotMatch(css, /hide-no-track|firmsHideNoTrack|Hide no track/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/trackHide.js')), false);
  assert.match(sources, /We acknowledge the use of data and\/or imagery from NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.match(credits, /NASA FIRMS|FIRMS/);
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(heatmap, /God'?s Eye View|GEV rebrand|quantum-earth|opensky|telegeography|google news|googlenews/i);
  assert.match(trackCeiling, /FIRMS_TRACK_STORAGE_KEY = 'meridian\.firmsTrack'/);
  assert.match(listHideTrack, /FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY = 'meridian\.firmsListHideNoTrack'/);
  assert.match(hideFrp, /FIRMS_HIDE_NO_FRP_STORAGE_KEY = 'meridian\.firmsHideNoFrp'/);
  assert.match(hideScan, /FIRMS_HIDE_NO_SCAN_STORAGE_KEY = 'meridian\.firmsHideNoScan'/);
  assert.notEqual(FIRMS_HIDE_NO_TRACK_STORAGE_KEY, 'meridian.firmsTrack');
  assert.notEqual(FIRMS_HIDE_NO_TRACK_STORAGE_KEY, FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY);
  assert.notEqual(FIRMS_HIDE_NO_TRACK_STORAGE_KEY, FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY);
  assert.notEqual(FIRMS_HIDE_NO_TRACK_STORAGE_KEY, FIRMS_HIDE_NO_FRP_STORAGE_KEY);
  assert.notEqual(FIRMS_HIDE_NO_TRACK_STORAGE_KEY, FIRMS_HIDE_NO_SCAN_STORAGE_KEY);

  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const chips = layer.getRowControls().chips;
  const hide = chips.find((chip) => chip.id === FIRMS_HIDE_NO_TRACK_CHIP_ID);
  const hideFrpChip = chips.find((chip) => chip.id === 'hide-no-frp');
  const hideScanChip = chips.find((chip) => chip.id === 'hide-no-scan');
  const hideBrightness = chips.find((chip) => chip.id === 'hide-no-brightness');
  const hideAcq = chips.find((chip) => chip.id === 'hide-no-acq');
  const hideConfidence = chips.find((chip) => chip.id === 'hide-no-confidence');
  const hideVersion = chips.find((chip) => chip.id === 'hide-no-version');
  const hideSensor = chips.find((chip) => chip.id === 'hide-no-sensor');
  const hideSatellite = chips.find((chip) => chip.id === 'hide-no-satellite');
  const hideDaynight = chips.find((chip) => chip.id === 'hide-no-daynight');
  const trackChips = chips.filter((chip) => chip.group === 'Track');
  const ageChips = chips.filter((chip) => chip.params.ageWindow);
  assert.ok(hide, 'Hide no track must come from getRowControls()');
  assert.ok(hideFrpChip, '281 Hide no FRP stays on the row');
  assert.ok(hideScanChip, '277 Hide no scan stays on the row');
  assert.ok(hideBrightness, '267 Hide no brightness stays on the row');
  assert.ok(hideAcq, '262 Hide no acq stays on the row');
  assert.ok(hideConfidence, '253 Hide no confidence stays on the row');
  assert.ok(hideVersion, '245 Hide no version stays on the row');
  assert.ok(hideSensor, '241 Hide no sensor stays on the row');
  assert.ok(hideSatellite, '238 Hide no satellite stays on the row');
  assert.ok(hideDaynight, '233 Hide no day/night stays on the row');
  assert.deepEqual(trackChips.map((chip) => chip.label), ['All', '<0.5km', '<0.4km']);
  assert.deepEqual(ageChips.map((chip) => chip.label), ['6h', '12h', '24h']);
  assert.equal(hide.label, 'Hide no track');
  assert.equal(hide.active, false);
  assert.deepEqual(hide.params, { hideNoTrack: true }, 'globe chip writes hideNoTrack, not firmsListHideNoTrack');
  const hideIndex = chips.findIndex((chip) => chip.id === FIRMS_HIDE_NO_TRACK_CHIP_ID);
  const frpIndex = chips.findIndex((chip) => chip.id === 'hide-no-frp');
  assert.ok(hideIndex === frpIndex + 1, 'Hide no track sits after Hide no FRP');
  layer.setParams({ hideNoTrack: true });
  assert.equal(
    layer.getRowControls().chips.find((chip) => chip.id === FIRMS_HIDE_NO_TRACK_CHIP_ID).active,
    true,
  );
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
  layer.setParams({ trackCeiling: '0.5' });
  assert.equal(layer.getParams().hideNoTrack, true, '281 hide-no-FRP stays distinct');
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
  assert.equal(layer.getParams().trackCeiling, '0.5', 'track-size ceiling stays distinct');
});
