// PLAN 253 — FIRMS globe Hide no confidence toggle. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_HIDE_NO_CONFIDENCE,
  FIRMS_HIDE_NO_CONFIDENCE_CHIP_ID,
  FIRMS_HIDE_NO_CONFIDENCE_CHIP_LABEL,
  FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY,
  filterFiresByHideNoConfidence,
  fireHasFiniteConfidence,
  fireMeetsHideNoConfidence,
  firmsHideNoConfidenceChipModel,
  normalizeFirmsHideNoConfidence,
  readFirmsHideNoConfidence,
  writeFirmsHideNoConfidence,
} from './firmsHideNoConfidenceFilter.js';
import { FIRMS_AREA_STORAGE_KEY, fireMeetsAreaCeiling } from './firmsAreaFilter.js';
import { FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY } from './firmsHideNoDaynightFilter.js';
import { FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY } from './firmsHideNoSatelliteFilter.js';
import { FIRMS_HIDE_NO_SENSOR_STORAGE_KEY } from './firmsHideNoSensorFilter.js';
import { FIRMS_HIDE_NO_VERSION_STORAGE_KEY } from './firmsHideNoVersionFilter.js';
import { createFirmsHeatmapLayer, fireMeetsConfidenceFloor } from './firmsHeatmap.js';
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

const RATED = { id: 'rated', confidence: 0.8, frp: 20 };
const LOW = { id: 'low', confidence: 0.2, frp: 18 };
const MISSING = { id: 'missing', frp: 16 };
const NULLED = { id: 'nulled', confidence: null, frp: 14 };
const NANED = { id: 'naned', confidence: Number.NaN, frp: 12 };
const INF = { id: 'inf', confidence: Number.POSITIVE_INFINITY, frp: 10 };

test('Off keeps null confidence', () => {
  assert.equal(DEFAULT_FIRMS_HIDE_NO_CONFIDENCE, false);
  assert.equal(FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY, 'meridian.firmsHideNoConfidence');
  assert.equal(normalizeFirmsHideNoConfidence(undefined), false);
  assert.equal(normalizeFirmsHideNoConfidence(null), false);
  assert.equal(normalizeFirmsHideNoConfidence(false), false);
  assert.equal(normalizeFirmsHideNoConfidence(true), true);
  assert.equal(normalizeFirmsHideNoConfidence('1'), true);
  assert.equal(normalizeFirmsHideNoConfidence(1), true);

  for (const fire of [RATED, LOW, MISSING, NULLED, NANED, INF]) {
    assert.equal(fireMeetsHideNoConfidence(fire, false), true, `off keeps ${fire.id}`);
  }
  assert.deepEqual(
    filterFiresByHideNoConfidence([RATED, NULLED, MISSING], false).map((fire) => fire.id),
    ['rated', 'nulled', 'missing'],
  );
  assert.equal(FIRMS_HIDE_NO_CONFIDENCE_CHIP_LABEL, 'Hide no confidence');
  const chip = firmsHideNoConfidenceChipModel(false);
  assert.equal(chip.id, FIRMS_HIDE_NO_CONFIDENCE_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoConfidence: true });
  assert.deepEqual(firmsHideNoConfidenceChipModel(true).params, { hideNoConfidence: false });
  assert.equal(fireMeetsConfidenceFloor(NULLED, '0.8'), true, 'globe floor still fails open on null');
});

test('On keeps 0.8, drops null', () => {
  assert.equal(fireHasFiniteConfidence(RATED), true);
  assert.equal(fireHasFiniteConfidence(LOW), true);
  assert.equal(fireHasFiniteConfidence({ confidence: 0 }), true);
  assert.equal(fireHasFiniteConfidence(MISSING), false);
  assert.equal(fireHasFiniteConfidence(NULLED), false);
  assert.equal(fireHasFiniteConfidence(NANED), false);
  assert.equal(fireHasFiniteConfidence(INF), false);
  assert.equal(fireHasFiniteConfidence(null), false);

  assert.equal(fireMeetsHideNoConfidence(RATED, true), true);
  assert.equal(fireMeetsHideNoConfidence({ confidence: 0.8 }, true), true);
  assert.equal(fireMeetsHideNoConfidence(LOW, true), true, 'presence-only: 0.2 stays');
  assert.equal(fireMeetsHideNoConfidence(NULLED, true), false, 'null confidence is a hide when on');
  assert.equal(fireMeetsHideNoConfidence(MISSING, true), false, 'missing confidence fails closed when on');
  assert.equal(fireMeetsHideNoConfidence(NANED, true), false);
  assert.equal(fireMeetsHideNoConfidence(INF, true), false);
  assert.deepEqual(
    filterFiresByHideNoConfidence([RATED, NULLED, NANED, MISSING, LOW], true).map((fire) => fire.id),
    ['rated', 'low'],
  );
});

test('Selected id always kept', () => {
  assert.equal(fireMeetsHideNoConfidence(NULLED, true, { selectedId: 'nulled' }), true);
  assert.equal(fireMeetsHideNoConfidence(MISSING, true, 'missing'), true);
  assert.deepEqual(
    filterFiresByHideNoConfidence([RATED, NULLED, MISSING], true, { selectedId: 'nulled' }).map((fire) => fire.id),
    ['rated', 'nulled'],
  );
  assert.deepEqual(
    filterFiresByHideNoConfidence([RATED, MISSING], true, 'missing').map((fire) => fire.id),
    ['rated', 'missing'],
  );
  const byIndex = { index: 7, confidence: null, frp: 4 };
  assert.equal(fireMeetsHideNoConfidence(byIndex, true, { selectedId: '7' }), true);
});

test('Invalid storage reads as off', () => {
  const storage = memoryStorage({ [FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY]: 'nope' });
  assert.equal(readFirmsHideNoConfidence(storage), false);
  assert.equal(readFirmsHideNoConfidence(memoryStorage({ [FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY]: '2' })), false);
  assert.equal(readFirmsHideNoConfidence(memoryStorage({ [FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY]: 'true' })), true);
  assert.equal(readFirmsHideNoConfidence(memoryStorage()), false);
  assert.equal(normalizeFirmsHideNoConfidence('bogus'), false);
  assert.equal(normalizeFirmsHideNoConfidence(0), false);
  assert.equal(normalizeFirmsHideNoConfidence('0'), false);
});

test('Persist flip survives reload', () => {
  const originalStorage = globalThis.localStorage;
  const storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => storage,
  });
  try {
    assert.equal(writeFirmsHideNoConfidence(true, storage), true);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY), '1');
    assert.equal(readFirmsHideNoConfidence(storage), true);
    const first = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
    assert.equal(first.getParams().hideNoConfidence, true);
    first.setParams({ hideNoConfidence: false });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY), '0');
    const reloaded = createFirmsHeatmapLayer({ id: 'firms-reload', name: 'FIRMS' });
    assert.equal(reloaded.getParams().hideNoConfidence, false);
    reloaded.setParams({ hideNoConfidence: true });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY), '1');
    const again = createFirmsHeatmapLayer({ id: 'firms-again', name: 'FIRMS' });
    assert.equal(again.getParams().hideNoConfidence, true);
    assert.equal(again.getParams().hideNoVersion, false);
    assert.equal(again.getParams().hideNoSensor, false);
    assert.equal(again.getParams().hideNoSatellite, false);
    assert.equal(again.getParams().hideNoDaynight, false);
    assert.equal(again.getParams().confidenceFloor, 'all');
    assert.equal(again.getParams().versionFilter, 'all');
    assert.equal(again.getParams().areaCeiling, 'all');
    writeFirmsHideNoConfidence(false, storage);
    assert.equal(storage.getItem(FIRMS_AREA_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SENSOR_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_VERSION_STORAGE_KEY), null);
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
    assert.doesNotMatch(source, /hideNoConfidence|firmsHideNoConfidence|Hide no confidence/, `${name} must stay off the hide path`);
    assert.doesNotMatch(source, /FIRMS_HIDE_NO_CONFIDENCE|fireMeetsHideNoConfidence/, `${name} must stay off the hide path`);
  }
  const [adaptedHigh] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h')]);
  assert.equal(fireHasFiniteConfidence(adaptedHigh), true);
  assert.equal(fireMeetsHideNoConfidence(adaptedHigh, true), true);
});

test('Hide no confidence ANDs with the fail-open floor, 245 hide-no-version, and existing FIRMS floors', async () => {
  const now = Date.now();
  const ratedNadir = {
    id: 'rated-nadir',
    index: 0,
    lat: AUSTIN.lat,
    lon: AUSTIN.lon,
    frp: 140,
    confidence: 0.9,
    brightness: 360,
    brightnessTi5: 330,
    scanKm: 0.4,
    trackKm: 0.4,
    version: '2.0NRT',
    night: false,
    daynight: 'D',
    acqMs: now,
    sensor: 'VIIRS',
    satellite: 'NOAA-20',
  };
  const unratedNadir = {
    ...ratedNadir,
    id: 'unrated-nadir',
    index: 1,
    lat: AUSTIN.lat + 1,
    lon: AUSTIN.lon + 1,
    confidence: null,
  };
  const ratedWide = {
    ...ratedNadir,
    id: 'rated-wide',
    index: 2,
    lat: AUSTIN.lat + 3,
    lon: AUSTIN.lon + 3,
    scanKm: 2,
    trackKm: 2,
  };
  const lowNight = {
    id: 'low-night',
    index: 3,
    lat: TOKYO.lat,
    lon: TOKYO.lon,
    frp: 4.2,
    confidence: 0.3,
    brightness: 300,
    brightnessTi5: 270,
    scanKm: 0.4,
    trackKm: 0.4,
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
    harness.layer._bindInteractionForTest(harness.viewer, [ratedNadir, unratedNadir, ratedWide, lowNight]);
    assert.equal(harness.layer.getParams().hideNoConfidence, false);
    assert.equal(harness.layer.getStats().count, 4, 'off keeps null + rated confidence');

    harness.layer.setParams({ confidenceFloor: '0.8' });
    assert.equal(harness.layer.getStats().count, 3, '0.8+ still fails open on the unrated nadir');
    assert.equal(harness.layer.setParams({ hideNoConfidence: true }), true);
    assert.equal(harness.layer.getStats().count, 2, 'on drops the unrated nadir that the floor kept');
    assert.equal(harness.fetchCount, 1, 'hide chip must not refetch NASA FIRMS');
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ areaCeiling: '1' });
    assert.equal(harness.layer.getStats().count, 1, 'hide AND <1 km² drops the 2×2 C2 row and the unrated nadir');
    harness.layer.setParams({ hideNoDaynight: true });
    harness.layer.setParams({ hideNoSatellite: true });
    harness.layer.setParams({ hideNoSensor: true });
    harness.layer.setParams({ hideNoVersion: true });
    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 1, 'AND FRP 50+ keeps the rated 140 MW nadir');
    harness.layer.setParams({ brightnessFloor: '320' });
    harness.layer.setParams({ brightnessTi5Floor: '290' });
    harness.layer.setParams({ scanCeiling: '0.5' });
    harness.layer.setParams({ trackCeiling: '0.5' });
    harness.layer.setParams({ versionFilter: '2.0NRT' });
    harness.layer.setParams({ showNight: false });
    harness.layer.setParams({ ageWindow: '24' });
    harness.layer.setParams({ sensors: 'V' });
    assert.equal(harness.layer.getParams().hideNoConfidence, true, 'sibling chips must not overwrite hide');
    assert.equal(harness.layer.getParams().hideNoVersion, true, '245 hide-no-version stays on');
    assert.equal(harness.layer.getParams().hideNoSensor, true, '241 hide-no-sensor stays on');
    assert.equal(harness.layer.getParams().hideNoSatellite, true, '238 hide-no-satellite stays on');
    assert.equal(harness.layer.getParams().hideNoDaynight, true, '233 hide-no-daynight stays on');
    assert.equal(harness.layer.getParams().confidenceFloor, '0.8', 'globe floor stays 0.8+');
    assert.equal(harness.layer.getParams().versionFilter, '2.0NRT', '217 version identity stays 2.0NRT');
    assert.equal(harness.layer.getParams().areaCeiling, '1');
    assert.equal(harness.layer.getStats().count, 1);
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1);

    harness.layer.setParams({ hideNoConfidence: false });
    assert.equal(harness.layer.getStats().count, 2, 'off restores the unrated nadir under the fail-open floor');
    assert.equal(fireMeetsAreaCeiling({ scanKm: 0.4, trackKm: 0.4 }, '1'), true);
  } finally {
    harness.cleanup();
  }
});

test('FIRMS row exposes Hide no confidence from getRowControls() without a new /api', () => {
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const firstRun = readFileSync(path.join(ROOT, 'src/firstRunExperience.js'), 'utf8');
  const list = readFileSync(path.join(ROOT, 'src/data/firmsList.js'), 'utf8');
  const csv = readFileSync(path.join(ROOT, 'src/data/firmsCsv.js'), 'utf8');
  const adapt = readFileSync(path.join(ROOT, 'src/data/firmsAdapt.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'src/../index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  assert.match(heatmap, /firmsHideNoConfidenceChipModel/);
  assert.match(heatmap, /readFirmsHideNoConfidence|writeFirmsHideNoConfidence/);
  assert.match(heatmap, /filterFiresByHideNoConfidence/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/confidence\/hide/);
  assert.doesNotMatch(layerState, /hideNoConfidence|firmsHideNoConfidence/);
  assert.doesNotMatch(firstRun, /writeFirmsHideNoConfidence\(/);
  assert.doesNotMatch(list, /hideNoConfidence|firmsHideNoConfidence/);
  assert.doesNotMatch(csv, /hideNoConfidence|firmsHideNoConfidence/);
  assert.doesNotMatch(adapt, /hideNoConfidence|firmsHideNoConfidence/);
  assert.doesNotMatch(html, /hide-no-confidence|firmsHideNoConfidence/);
  assert.doesNotMatch(ui, /hideNoConfidence|firmsHideNoConfidence|Hide no confidence/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/confidence.js')), false);

  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const chips = layer.getRowControls().chips;
  const hide = chips.find((chip) => chip.id === FIRMS_HIDE_NO_CONFIDENCE_CHIP_ID);
  const hideVersion = chips.find((chip) => chip.id === 'hide-no-version');
  const hideSensor = chips.find((chip) => chip.id === 'hide-no-sensor');
  const hideSatellite = chips.find((chip) => chip.id === 'hide-no-satellite');
  const hideDaynight = chips.find((chip) => chip.id === 'hide-no-daynight');
  const confFloor = chips.filter((chip) => chip.params.confidenceFloor);
  assert.ok(hide, 'Hide no confidence must come from getRowControls()');
  assert.ok(hideVersion, '245 Hide no version stays on the row');
  assert.ok(hideSensor, '241 Hide no sensor stays on the row');
  assert.ok(hideSatellite, '238 Hide no satellite stays on the row');
  assert.ok(hideDaynight, '233 Hide no day/night stays on the row');
  assert.deepEqual(confFloor.map((chip) => chip.label), ['All', '0.5+', '0.8+']);
  assert.equal(hide.label, 'Hide no confidence');
  assert.equal(hide.active, false);
  assert.deepEqual(hide.params, { hideNoConfidence: true });
  const hideIndex = chips.findIndex((chip) => chip.id === FIRMS_HIDE_NO_CONFIDENCE_CHIP_ID);
  const versionIndex = chips.findIndex((chip) => chip.id === 'hide-no-version');
  assert.ok(hideIndex === versionIndex + 1, 'Hide no confidence sits after Hide no version');
  layer.setParams({ hideNoConfidence: true });
  assert.equal(
    layer.getRowControls().chips.find((chip) => chip.id === FIRMS_HIDE_NO_CONFIDENCE_CHIP_ID).active,
    true,
  );
  layer.setParams({ hideNoVersion: true });
  layer.setParams({ hideNoSensor: true });
  layer.setParams({ hideNoSatellite: true });
  layer.setParams({ hideNoDaynight: true });
  layer.setParams({ confidenceFloor: '0.8' });
  assert.equal(layer.getParams().hideNoConfidence, true, '245 hide-no-version stays distinct');
  assert.equal(layer.getParams().hideNoVersion, true);
  assert.equal(layer.getParams().hideNoSensor, true);
  assert.equal(layer.getParams().hideNoSatellite, true);
  assert.equal(layer.getParams().hideNoDaynight, true);
  assert.equal(layer.getParams().confidenceFloor, '0.8', 'globe confidence floor stays distinct');
});
