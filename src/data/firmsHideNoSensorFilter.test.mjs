// PLAN 241 — FIRMS globe Hide no sensor toggle. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_HIDE_NO_SENSOR,
  FIRMS_HIDE_NO_SENSOR_CHIP_ID,
  FIRMS_HIDE_NO_SENSOR_CHIP_LABEL,
  FIRMS_HIDE_NO_SENSOR_STORAGE_KEY,
  filterFiresByHideNoSensor,
  fireHasNamedSensor,
  fireMeetsHideNoSensor,
  firmsHideNoSensorChipModel,
  normalizeFirmsHideNoSensor,
  readFirmsHideNoSensor,
  writeFirmsHideNoSensor,
} from './firmsHideNoSensorFilter.js';
import { FIRMS_AREA_STORAGE_KEY, fireMeetsAreaCeiling } from './firmsAreaFilter.js';
import { FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY } from './firmsHideNoDaynightFilter.js';
import { FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY } from './firmsHideNoSatelliteFilter.js';
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

const VIIRS = { id: 'viirs', sensor: 'VIIRS', frp: 20 };
const MODIS = { id: 'modis', sensor: 'MODIS', frp: 18 };
const MISSING = { id: 'missing', frp: 16 };
const EMPTY = { id: 'empty', sensor: '', frp: 14 };
const WHITESPACE = { id: 'ws', sensor: '   ', frp: 12 };

test('off keeps empty sensor', () => {
  assert.equal(DEFAULT_FIRMS_HIDE_NO_SENSOR, false);
  assert.equal(FIRMS_HIDE_NO_SENSOR_STORAGE_KEY, 'meridian.firmsHideNoSensor');
  assert.equal(normalizeFirmsHideNoSensor(undefined), false);
  assert.equal(normalizeFirmsHideNoSensor(null), false);
  assert.equal(normalizeFirmsHideNoSensor(false), false);
  assert.equal(normalizeFirmsHideNoSensor(true), true);
  assert.equal(normalizeFirmsHideNoSensor('1'), true);
  assert.equal(normalizeFirmsHideNoSensor(1), true);

  for (const fire of [VIIRS, MODIS, MISSING, EMPTY, WHITESPACE]) {
    assert.equal(fireMeetsHideNoSensor(fire, false), true, `off keeps ${fire.id}`);
  }
  assert.deepEqual(
    filterFiresByHideNoSensor([VIIRS, EMPTY, MISSING], false).map((fire) => fire.id),
    ['viirs', 'empty', 'missing'],
  );
  assert.equal(FIRMS_HIDE_NO_SENSOR_CHIP_LABEL, 'Hide no sensor');
  const chip = firmsHideNoSensorChipModel(false);
  assert.equal(chip.id, FIRMS_HIDE_NO_SENSOR_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoSensor: true });
  assert.deepEqual(firmsHideNoSensorChipModel(true).params, { hideNoSensor: false });
});

test('on keeps VIIRS, drops empty', () => {
  assert.equal(fireHasNamedSensor(VIIRS), true);
  assert.equal(fireHasNamedSensor(MODIS), true);
  assert.equal(fireHasNamedSensor({ sensor: ' VIIRS ' }), true);
  assert.equal(fireHasNamedSensor(MISSING), false);
  assert.equal(fireHasNamedSensor(EMPTY), false);
  assert.equal(fireHasNamedSensor(WHITESPACE), false);
  assert.equal(fireHasNamedSensor(null), false);

  assert.equal(fireMeetsHideNoSensor(VIIRS, true), true);
  assert.equal(fireMeetsHideNoSensor({ sensor: ' VIIRS ' }, true), true);
  assert.equal(fireMeetsHideNoSensor(MODIS, true), true);
  assert.equal(fireMeetsHideNoSensor(EMPTY, true), false, 'empty sensor is a hide when on');
  assert.equal(fireMeetsHideNoSensor(WHITESPACE, true), false);
  assert.equal(fireMeetsHideNoSensor(MISSING, true), false, 'missing sensor fails closed when on');
  assert.deepEqual(
    filterFiresByHideNoSensor([VIIRS, EMPTY, WHITESPACE, MISSING, MODIS], true).map((fire) => fire.id),
    ['viirs', 'modis'],
  );
});

test('selected id always kept', () => {
  assert.equal(fireMeetsHideNoSensor(EMPTY, true, { selectedId: 'empty' }), true);
  assert.equal(fireMeetsHideNoSensor(MISSING, true, 'missing'), true);
  assert.deepEqual(
    filterFiresByHideNoSensor([VIIRS, EMPTY, MISSING], true, { selectedId: 'empty' }).map((fire) => fire.id),
    ['viirs', 'empty'],
  );
  assert.deepEqual(
    filterFiresByHideNoSensor([VIIRS, MISSING], true, 'missing').map((fire) => fire.id),
    ['viirs', 'missing'],
  );
  const byIndex = { index: 7, sensor: '', frp: 4 };
  assert.equal(fireMeetsHideNoSensor(byIndex, true, { selectedId: '7' }), true);
});

test('invalid storage reads as off', () => {
  const storage = memoryStorage({ [FIRMS_HIDE_NO_SENSOR_STORAGE_KEY]: 'nope' });
  assert.equal(readFirmsHideNoSensor(storage), false);
  assert.equal(readFirmsHideNoSensor(memoryStorage({ [FIRMS_HIDE_NO_SENSOR_STORAGE_KEY]: '2' })), false);
  assert.equal(readFirmsHideNoSensor(memoryStorage({ [FIRMS_HIDE_NO_SENSOR_STORAGE_KEY]: 'true' })), true);
  assert.equal(readFirmsHideNoSensor(memoryStorage()), false);
  assert.equal(normalizeFirmsHideNoSensor('bogus'), false);
  assert.equal(normalizeFirmsHideNoSensor(0), false);
  assert.equal(normalizeFirmsHideNoSensor('0'), false);
});

test('Persist flip survives reload', () => {
  const originalStorage = globalThis.localStorage;
  const storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => storage,
  });
  try {
    assert.equal(writeFirmsHideNoSensor(true, storage), true);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SENSOR_STORAGE_KEY), '1');
    assert.equal(readFirmsHideNoSensor(storage), true);
    const first = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
    assert.equal(first.getParams().hideNoSensor, true);
    first.setParams({ hideNoSensor: false });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SENSOR_STORAGE_KEY), '0');
    const reloaded = createFirmsHeatmapLayer({ id: 'firms-reload', name: 'FIRMS' });
    assert.equal(reloaded.getParams().hideNoSensor, false);
    reloaded.setParams({ hideNoSensor: true });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SENSOR_STORAGE_KEY), '1');
    const again = createFirmsHeatmapLayer({ id: 'firms-again', name: 'FIRMS' });
    assert.equal(again.getParams().hideNoSensor, true);
    assert.equal(again.getParams().hideNoSatellite, false);
    assert.equal(again.getParams().hideNoDaynight, false);
    assert.equal(again.getParams().areaCeiling, 'all');
    writeFirmsHideNoSensor(false, storage);
    assert.equal(storage.getItem(FIRMS_AREA_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY), null);
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
    assert.doesNotMatch(source, /hideNoSensor|firmsHideNoSensor|Hide no sensor/, `${name} must stay off the hide path`);
    assert.doesNotMatch(source, /FIRMS_HIDE_NO_SENSOR|fireMeetsHideNoSensor/, `${name} must stay off the hide path`);
  }
  const [adaptedNamed] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', { instrument: 'VIIRS' })]);
  const [adaptedEmpty] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', { instrument: '' })]);
  const [adaptedMissing] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', { instrument: undefined })]);
  assert.equal(adaptedNamed.sensor, 'VIIRS', 'adapt already stores VIIRS');
  assert.equal(adaptedEmpty.sensor, '');
  assert.equal(adaptedMissing.sensor, '');
  assert.equal(fireMeetsHideNoSensor(adaptedNamed, true), true);
  assert.equal(fireMeetsHideNoSensor(adaptedEmpty, true), false);
  assert.equal(fireMeetsHideNoSensor(adaptedMissing, true), false);
});

test('Hide no sensor ANDs with 226 area, 233 hide-no-daynight, 238 hide-no-satellite, and existing FIRMS floors', async () => {
  const fires = [
    rawFire(AUSTIN.lat, AUSTIN.lon, 140, 360, 'h', {
      scan: 0.4, track: 0.4, version: '2.0NRT', brightnessTi5: 330, daynight: 'D',
      instrument: 'VIIRS', satellite: 'NOAA-20',
    }),
    rawFire(AUSTIN.lat + 1, AUSTIN.lon + 1, 140, 360, 'h', {
      scan: 0.4, track: 0.4, version: '2.0NRT', brightnessTi5: 330, daynight: 'D',
      instrument: '', satellite: 'NOAA-20',
    }),
    rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 140, 360, 'h', {
      scan: 2, track: 2, version: '2.0NRT', brightnessTi5: 330, daynight: 'D',
      instrument: 'VIIRS', satellite: 'NOAA-20',
    }),
    rawFire(TOKYO.lat, TOKYO.lon, 4.2, 300, 'l', {
      scan: 0.4, track: 0.4, version: '1.0NRT', brightnessTi5: 270,
      instrument: 'MODIS', satellite: 'Aqua', daynight: 'N',
    }),
  ];
  const harness = createHarness(fires);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.getParams().hideNoSensor, false);
    assert.equal(harness.layer.getStats().count, 4, 'off keeps empty + named sensor');

    assert.equal(harness.layer.setParams({ hideNoSensor: true }), true);
    assert.equal(harness.layer.getStats().count, 3, 'on drops the empty sensor nadir');
    assert.equal(harness.fetchCount, 1, 'hide chip must not refetch NASA FIRMS');
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ areaCeiling: '1' });
    assert.equal(harness.layer.getStats().count, 2, 'hide AND <1 km² drops the 2×2 C2 row and the unlabeled nadir');
    harness.layer.setParams({ hideNoDaynight: true });
    harness.layer.setParams({ hideNoSatellite: true });
    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 1, 'AND FRP 50+ keeps the labeled 140 MW nadir');
    harness.layer.setParams({ confidenceFloor: '0.5' });
    harness.layer.setParams({ brightnessFloor: '320' });
    harness.layer.setParams({ brightnessTi5Floor: '290' });
    harness.layer.setParams({ scanCeiling: '0.5' });
    harness.layer.setParams({ trackCeiling: '0.5' });
    harness.layer.setParams({ versionFilter: '2.0NRT' });
    harness.layer.setParams({ showNight: false });
    harness.layer.setParams({ ageWindow: '24' });
    harness.layer.setParams({ sensors: 'V' });
    assert.equal(harness.layer.getParams().hideNoSensor, true, 'sibling chips must not overwrite hide');
    assert.equal(harness.layer.getParams().hideNoSatellite, true, '238 hide-no-satellite stays on');
    assert.equal(harness.layer.getParams().hideNoDaynight, true, '233 hide-no-daynight stays on');
    assert.equal(harness.layer.getParams().areaCeiling, '1');
    assert.equal(harness.layer.getStats().count, 1);
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1);

    harness.layer.setParams({ hideNoSensor: false });
    assert.equal(harness.layer.getStats().count, 2, 'off restores the unlabeled nadir under the other floors');
    assert.equal(fireMeetsAreaCeiling({ scanKm: 0.4, trackKm: 0.4 }, '1'), true);
  } finally {
    harness.cleanup();
  }
});

test('FIRMS row exposes Hide no sensor from getRowControls() without a new /api', () => {
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const firstRun = readFileSync(path.join(ROOT, 'src/firstRunExperience.js'), 'utf8');
  const list = readFileSync(path.join(ROOT, 'src/data/firmsList.js'), 'utf8');
  const csv = readFileSync(path.join(ROOT, 'src/data/firmsCsv.js'), 'utf8');
  const adapt = readFileSync(path.join(ROOT, 'src/data/firmsAdapt.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  assert.match(heatmap, /firmsHideNoSensorChipModel/);
  assert.match(heatmap, /readFirmsHideNoSensor|writeFirmsHideNoSensor/);
  assert.match(heatmap, /filterFiresByHideNoSensor/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/sensor/);
  assert.doesNotMatch(layerState, /hideNoSensor|firmsHideNoSensor/);
  assert.doesNotMatch(firstRun, /writeFirmsHideNoSensor\(/);
  assert.doesNotMatch(list, /hideNoSensor|firmsHideNoSensor/);
  assert.doesNotMatch(csv, /hideNoSensor|firmsHideNoSensor/);
  assert.doesNotMatch(adapt, /hideNoSensor|firmsHideNoSensor/);
  assert.doesNotMatch(html, /hide-no-sensor|firmsHideNoSensor/);
  assert.doesNotMatch(ui, /hideNoSensor|firmsHideNoSensor|Hide no sensor/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/sensor.js')), false);

  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const chips = layer.getRowControls().chips;
  const hide = chips.find((chip) => chip.id === FIRMS_HIDE_NO_SENSOR_CHIP_ID);
  const hideSatellite = chips.find((chip) => chip.id === 'hide-no-satellite');
  const hideDaynight = chips.find((chip) => chip.id === 'hide-no-daynight');
  assert.ok(hide, 'Hide no sensor must come from getRowControls()');
  assert.ok(hideSatellite, '238 Hide no satellite stays on the row');
  assert.ok(hideDaynight, '233 Hide no day/night stays on the row');
  assert.equal(hide.label, 'Hide no sensor');
  assert.equal(hide.active, false);
  assert.deepEqual(hide.params, { hideNoSensor: true });
  const hideIndex = chips.findIndex((chip) => chip.id === FIRMS_HIDE_NO_SENSOR_CHIP_ID);
  const satelliteIndex = chips.findIndex((chip) => chip.id === 'hide-no-satellite');
  assert.ok(hideIndex === satelliteIndex + 1, 'Hide no sensor sits after Hide no satellite');
  layer.setParams({ hideNoSensor: true });
  assert.equal(
    layer.getRowControls().chips.find((chip) => chip.id === FIRMS_HIDE_NO_SENSOR_CHIP_ID).active,
    true,
  );
  layer.setParams({ hideNoSatellite: true });
  layer.setParams({ hideNoDaynight: true });
  assert.equal(layer.getParams().hideNoSensor, true, '238 hide-no-satellite stays distinct');
  assert.equal(layer.getParams().hideNoSatellite, true);
  assert.equal(layer.getParams().hideNoDaynight, true);
});
