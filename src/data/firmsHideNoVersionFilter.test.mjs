// PLAN 245 — FIRMS globe Hide no version toggle. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_HIDE_NO_VERSION,
  FIRMS_HIDE_NO_VERSION_CHIP_ID,
  FIRMS_HIDE_NO_VERSION_CHIP_LABEL,
  FIRMS_HIDE_NO_VERSION_STORAGE_KEY,
  filterFiresByHideNoVersion,
  fireHasNamedVersion,
  fireMeetsHideNoVersion,
  firmsHideNoVersionChipModel,
  normalizeFirmsHideNoVersion,
  readFirmsHideNoVersion,
  writeFirmsHideNoVersion,
} from './firmsHideNoVersionFilter.js';
import { FIRMS_AREA_STORAGE_KEY, fireMeetsAreaCeiling } from './firmsAreaFilter.js';
import { FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY } from './firmsHideNoDaynightFilter.js';
import { FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY } from './firmsHideNoSatelliteFilter.js';
import { FIRMS_HIDE_NO_SENSOR_STORAGE_KEY } from './firmsHideNoSensorFilter.js';
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

const C2 = { id: 'c2', version: '2.0NRT', frp: 20 };
const C1 = { id: 'c1', version: '1.0NRT', frp: 18 };
const MISSING = { id: 'missing', frp: 16 };
const EMPTY = { id: 'empty', version: '', frp: 14 };
const WHITESPACE = { id: 'ws', version: '   ', frp: 12 };

test('off keeps empty version', () => {
  assert.equal(DEFAULT_FIRMS_HIDE_NO_VERSION, false);
  assert.equal(FIRMS_HIDE_NO_VERSION_STORAGE_KEY, 'meridian.firmsHideNoVersion');
  assert.equal(normalizeFirmsHideNoVersion(undefined), false);
  assert.equal(normalizeFirmsHideNoVersion(null), false);
  assert.equal(normalizeFirmsHideNoVersion(false), false);
  assert.equal(normalizeFirmsHideNoVersion(true), true);
  assert.equal(normalizeFirmsHideNoVersion('1'), true);
  assert.equal(normalizeFirmsHideNoVersion(1), true);

  for (const fire of [C2, C1, MISSING, EMPTY, WHITESPACE]) {
    assert.equal(fireMeetsHideNoVersion(fire, false), true, `off keeps ${fire.id}`);
  }
  assert.deepEqual(
    filterFiresByHideNoVersion([C2, EMPTY, MISSING], false).map((fire) => fire.id),
    ['c2', 'empty', 'missing'],
  );
  assert.equal(FIRMS_HIDE_NO_VERSION_CHIP_LABEL, 'Hide no version');
  const chip = firmsHideNoVersionChipModel(false);
  assert.equal(chip.id, FIRMS_HIDE_NO_VERSION_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoVersion: true });
  assert.deepEqual(firmsHideNoVersionChipModel(true).params, { hideNoVersion: false });
});

test('on keeps 2.0NRT, drops empty', () => {
  assert.equal(fireHasNamedVersion(C2), true);
  assert.equal(fireHasNamedVersion(C1), true);
  assert.equal(fireHasNamedVersion({ version: ' 2.0NRT ' }), true);
  assert.equal(fireHasNamedVersion(MISSING), false);
  assert.equal(fireHasNamedVersion(EMPTY), false);
  assert.equal(fireHasNamedVersion(WHITESPACE), false);
  assert.equal(fireHasNamedVersion(null), false);

  assert.equal(fireMeetsHideNoVersion(C2, true), true);
  assert.equal(fireMeetsHideNoVersion({ version: ' 2.0NRT ' }, true), true);
  assert.equal(fireMeetsHideNoVersion(C1, true), true);
  assert.equal(fireMeetsHideNoVersion(EMPTY, true), false, 'empty version is a hide when on');
  assert.equal(fireMeetsHideNoVersion(WHITESPACE, true), false);
  assert.equal(fireMeetsHideNoVersion(MISSING, true), false, 'missing version fails closed when on');
  assert.deepEqual(
    filterFiresByHideNoVersion([C2, EMPTY, WHITESPACE, MISSING, C1], true).map((fire) => fire.id),
    ['c2', 'c1'],
  );
});

test('selected id always kept', () => {
  assert.equal(fireMeetsHideNoVersion(EMPTY, true, { selectedId: 'empty' }), true);
  assert.equal(fireMeetsHideNoVersion(MISSING, true, 'missing'), true);
  assert.deepEqual(
    filterFiresByHideNoVersion([C2, EMPTY, MISSING], true, { selectedId: 'empty' }).map((fire) => fire.id),
    ['c2', 'empty'],
  );
  assert.deepEqual(
    filterFiresByHideNoVersion([C2, MISSING], true, 'missing').map((fire) => fire.id),
    ['c2', 'missing'],
  );
  const byIndex = { index: 7, version: '', frp: 4 };
  assert.equal(fireMeetsHideNoVersion(byIndex, true, { selectedId: '7' }), true);
});

test('invalid storage reads as off', () => {
  const storage = memoryStorage({ [FIRMS_HIDE_NO_VERSION_STORAGE_KEY]: 'nope' });
  assert.equal(readFirmsHideNoVersion(storage), false);
  assert.equal(readFirmsHideNoVersion(memoryStorage({ [FIRMS_HIDE_NO_VERSION_STORAGE_KEY]: '2' })), false);
  assert.equal(readFirmsHideNoVersion(memoryStorage({ [FIRMS_HIDE_NO_VERSION_STORAGE_KEY]: 'true' })), true);
  assert.equal(readFirmsHideNoVersion(memoryStorage()), false);
  assert.equal(normalizeFirmsHideNoVersion('bogus'), false);
  assert.equal(normalizeFirmsHideNoVersion(0), false);
  assert.equal(normalizeFirmsHideNoVersion('0'), false);
});

test('Persist flip survives reload', () => {
  const originalStorage = globalThis.localStorage;
  const storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => storage,
  });
  try {
    assert.equal(writeFirmsHideNoVersion(true, storage), true);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_VERSION_STORAGE_KEY), '1');
    assert.equal(readFirmsHideNoVersion(storage), true);
    const first = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
    assert.equal(first.getParams().hideNoVersion, true);
    first.setParams({ hideNoVersion: false });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_VERSION_STORAGE_KEY), '0');
    const reloaded = createFirmsHeatmapLayer({ id: 'firms-reload', name: 'FIRMS' });
    assert.equal(reloaded.getParams().hideNoVersion, false);
    reloaded.setParams({ hideNoVersion: true });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_VERSION_STORAGE_KEY), '1');
    const again = createFirmsHeatmapLayer({ id: 'firms-again', name: 'FIRMS' });
    assert.equal(again.getParams().hideNoVersion, true);
    assert.equal(again.getParams().hideNoSensor, false);
    assert.equal(again.getParams().hideNoSatellite, false);
    assert.equal(again.getParams().hideNoDaynight, false);
    assert.equal(again.getParams().versionFilter, 'all');
    assert.equal(again.getParams().areaCeiling, 'all');
    writeFirmsHideNoVersion(false, storage);
    assert.equal(storage.getItem(FIRMS_AREA_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SENSOR_STORAGE_KEY), null);
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
    assert.doesNotMatch(source, /hideNoVersion|firmsHideNoVersion|Hide no version/, `${name} must stay off the hide path`);
    assert.doesNotMatch(source, /FIRMS_HIDE_NO_VERSION|fireMeetsHideNoVersion/, `${name} must stay off the hide path`);
  }
  const [adaptedNamed] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', { version: '2.0NRT' })]);
  const [adaptedEmpty] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', { version: '' })]);
  const [adaptedMissing] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', { version: undefined })]);
  assert.equal(adaptedNamed.version, '2.0NRT', 'adapt already stores 2.0NRT');
  assert.equal(adaptedEmpty.version, '');
  assert.equal(adaptedMissing.version, '');
  assert.equal(fireMeetsHideNoVersion(adaptedNamed, true), true);
  assert.equal(fireMeetsHideNoVersion(adaptedEmpty, true), false);
  assert.equal(fireMeetsHideNoVersion(adaptedMissing, true), false);
});

test('Hide no version ANDs with 217 version, 226 area, 233/238/241 hide chips, and existing FIRMS floors', async () => {
  const fires = [
    rawFire(AUSTIN.lat, AUSTIN.lon, 140, 360, 'h', {
      scan: 0.4, track: 0.4, version: '2.0NRT', brightnessTi5: 330, daynight: 'D',
      instrument: 'VIIRS', satellite: 'NOAA-20',
    }),
    rawFire(AUSTIN.lat + 1, AUSTIN.lon + 1, 140, 360, 'h', {
      scan: 0.4, track: 0.4, version: '', brightnessTi5: 330, daynight: 'D',
      instrument: 'VIIRS', satellite: 'NOAA-20',
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
    assert.equal(harness.layer.getParams().hideNoVersion, false);
    assert.equal(harness.layer.getStats().count, 4, 'off keeps empty + named version');

    assert.equal(harness.layer.setParams({ hideNoVersion: true }), true);
    assert.equal(harness.layer.getStats().count, 3, 'on drops the empty version nadir');
    assert.equal(harness.fetchCount, 1, 'hide chip must not refetch NASA FIRMS');
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ areaCeiling: '1' });
    assert.equal(harness.layer.getStats().count, 2, 'hide AND <1 km² drops the 2×2 C2 row and the unlabeled nadir');
    harness.layer.setParams({ hideNoDaynight: true });
    harness.layer.setParams({ hideNoSatellite: true });
    harness.layer.setParams({ hideNoSensor: true });
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
    assert.equal(harness.layer.getParams().hideNoVersion, true, 'sibling chips must not overwrite hide');
    assert.equal(harness.layer.getParams().hideNoSensor, true, '241 hide-no-sensor stays on');
    assert.equal(harness.layer.getParams().hideNoSatellite, true, '238 hide-no-satellite stays on');
    assert.equal(harness.layer.getParams().hideNoDaynight, true, '233 hide-no-daynight stays on');
    assert.equal(harness.layer.getParams().versionFilter, '2.0NRT', '217 version identity stays 2.0NRT');
    assert.equal(harness.layer.getParams().areaCeiling, '1');
    assert.equal(harness.layer.getStats().count, 1);
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1);

    harness.layer.setParams({ hideNoVersion: false });
    assert.equal(harness.layer.getStats().count, 1, '217 2.0NRT still drops the empty-version nadir when hide is off');
    harness.layer.setParams({ versionFilter: 'all' });
    assert.equal(harness.layer.getStats().count, 2, 'off + All restores the unlabeled nadir under the other floors');
    assert.equal(fireMeetsAreaCeiling({ scanKm: 0.4, trackKm: 0.4 }, '1'), true);
  } finally {
    harness.cleanup();
  }
});

test('FIRMS row exposes Hide no version from getRowControls() without a new /api', () => {
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const firstRun = readFileSync(path.join(ROOT, 'src/firstRunExperience.js'), 'utf8');
  const list = readFileSync(path.join(ROOT, 'src/data/firmsList.js'), 'utf8');
  const csv = readFileSync(path.join(ROOT, 'src/data/firmsCsv.js'), 'utf8');
  const adapt = readFileSync(path.join(ROOT, 'src/data/firmsAdapt.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  assert.match(heatmap, /firmsHideNoVersionChipModel/);
  assert.match(heatmap, /readFirmsHideNoVersion|writeFirmsHideNoVersion/);
  assert.match(heatmap, /filterFiresByHideNoVersion/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/version\/hide/);
  assert.doesNotMatch(layerState, /hideNoVersion|firmsHideNoVersion/);
  assert.doesNotMatch(firstRun, /writeFirmsHideNoVersion\(/);
  assert.doesNotMatch(list, /hideNoVersion|firmsHideNoVersion/);
  assert.doesNotMatch(csv, /hideNoVersion|firmsHideNoVersion/);
  assert.doesNotMatch(adapt, /hideNoVersion|firmsHideNoVersion/);
  assert.doesNotMatch(html, /hide-no-version|firmsHideNoVersion/);
  assert.doesNotMatch(ui, /hideNoVersion|firmsHideNoVersion|Hide no version/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/version.js')), false);

  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const chips = layer.getRowControls().chips;
  const hide = chips.find((chip) => chip.id === FIRMS_HIDE_NO_VERSION_CHIP_ID);
  const hideSensor = chips.find((chip) => chip.id === 'hide-no-sensor');
  const hideSatellite = chips.find((chip) => chip.id === 'hide-no-satellite');
  const hideDaynight = chips.find((chip) => chip.id === 'hide-no-daynight');
  const versionIdentity = chips.filter((chip) => chip.params.versionFilter);
  assert.ok(hide, 'Hide no version must come from getRowControls()');
  assert.ok(hideSensor, '241 Hide no sensor stays on the row');
  assert.ok(hideSatellite, '238 Hide no satellite stays on the row');
  assert.ok(hideDaynight, '233 Hide no day/night stays on the row');
  assert.deepEqual(versionIdentity.map((chip) => chip.label), ['All', '2.0NRT', 'Other']);
  assert.equal(hide.label, 'Hide no version');
  assert.equal(hide.active, false);
  assert.deepEqual(hide.params, { hideNoVersion: true });
  const hideIndex = chips.findIndex((chip) => chip.id === FIRMS_HIDE_NO_VERSION_CHIP_ID);
  const sensorIndex = chips.findIndex((chip) => chip.id === 'hide-no-sensor');
  assert.ok(hideIndex === sensorIndex + 1, 'Hide no version sits after Hide no sensor');
  layer.setParams({ hideNoVersion: true });
  assert.equal(
    layer.getRowControls().chips.find((chip) => chip.id === FIRMS_HIDE_NO_VERSION_CHIP_ID).active,
    true,
  );
  layer.setParams({ hideNoSensor: true });
  layer.setParams({ hideNoSatellite: true });
  layer.setParams({ hideNoDaynight: true });
  layer.setParams({ versionFilter: '2.0NRT' });
  assert.equal(layer.getParams().hideNoVersion, true, '241 hide-no-sensor stays distinct');
  assert.equal(layer.getParams().hideNoSensor, true);
  assert.equal(layer.getParams().hideNoSatellite, true);
  assert.equal(layer.getParams().hideNoDaynight, true);
  assert.equal(layer.getParams().versionFilter, '2.0NRT', '217 version identity stays distinct');
});
