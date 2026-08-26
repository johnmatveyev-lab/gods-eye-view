// PLAN 238 — FIRMS globe Hide no satellite toggle. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_HIDE_NO_SATELLITE,
  FIRMS_HIDE_NO_SATELLITE_CHIP_ID,
  FIRMS_HIDE_NO_SATELLITE_CHIP_LABEL,
  FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY,
  filterFiresByHideNoSatellite,
  fireHasNamedSatellite,
  fireMeetsHideNoSatellite,
  firmsHideNoSatelliteChipModel,
  normalizeFirmsHideNoSatellite,
  readFirmsHideNoSatellite,
  writeFirmsHideNoSatellite,
} from './firmsHideNoSatelliteFilter.js';
import { FIRMS_AREA_STORAGE_KEY, fireMeetsAreaCeiling } from './firmsAreaFilter.js';
import { FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY } from './firmsHideNoDaynightFilter.js';
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

const NOAA20 = { id: 'noaa-20', satellite: 'NOAA-20', frp: 20 };
const N20 = { id: 'n20', satellite: 'N20', frp: 18 };
const MISSING = { id: 'missing', frp: 16 };
const EMPTY = { id: 'empty', satellite: '', frp: 14 };
const WHITESPACE = { id: 'ws', satellite: '   ', frp: 12 };

test('off keeps empty satellite', () => {
  assert.equal(DEFAULT_FIRMS_HIDE_NO_SATELLITE, false);
  assert.equal(FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY, 'meridian.firmsHideNoSatellite');
  assert.equal(normalizeFirmsHideNoSatellite(undefined), false);
  assert.equal(normalizeFirmsHideNoSatellite(null), false);
  assert.equal(normalizeFirmsHideNoSatellite(false), false);
  assert.equal(normalizeFirmsHideNoSatellite(true), true);
  assert.equal(normalizeFirmsHideNoSatellite('1'), true);
  assert.equal(normalizeFirmsHideNoSatellite(1), true);

  for (const fire of [NOAA20, N20, MISSING, EMPTY, WHITESPACE]) {
    assert.equal(fireMeetsHideNoSatellite(fire, false), true, `off keeps ${fire.id}`);
  }
  assert.deepEqual(
    filterFiresByHideNoSatellite([NOAA20, EMPTY, MISSING], false).map((fire) => fire.id),
    ['noaa-20', 'empty', 'missing'],
  );
  assert.equal(FIRMS_HIDE_NO_SATELLITE_CHIP_LABEL, 'Hide no satellite');
  const chip = firmsHideNoSatelliteChipModel(false);
  assert.equal(chip.id, FIRMS_HIDE_NO_SATELLITE_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoSatellite: true });
  assert.deepEqual(firmsHideNoSatelliteChipModel(true).params, { hideNoSatellite: false });
});

test('on keeps NOAA-20, drops empty', () => {
  assert.equal(fireHasNamedSatellite(NOAA20), true);
  assert.equal(fireHasNamedSatellite(N20), true);
  assert.equal(fireHasNamedSatellite({ satellite: ' NOAA-20 ' }), true);
  assert.equal(fireHasNamedSatellite(MISSING), false);
  assert.equal(fireHasNamedSatellite(EMPTY), false);
  assert.equal(fireHasNamedSatellite(WHITESPACE), false);
  assert.equal(fireHasNamedSatellite(null), false);

  assert.equal(fireMeetsHideNoSatellite(NOAA20, true), true);
  assert.equal(fireMeetsHideNoSatellite({ satellite: ' NOAA-20 ' }, true), true);
  assert.equal(fireMeetsHideNoSatellite(N20, true), true);
  assert.equal(fireMeetsHideNoSatellite(EMPTY, true), false, 'empty satellite is a hide when on');
  assert.equal(fireMeetsHideNoSatellite(WHITESPACE, true), false);
  assert.equal(fireMeetsHideNoSatellite(MISSING, true), false, 'missing satellite fails closed when on');
  assert.deepEqual(
    filterFiresByHideNoSatellite([NOAA20, EMPTY, WHITESPACE, MISSING, N20], true).map((fire) => fire.id),
    ['noaa-20', 'n20'],
  );
});

test('selected id always kept', () => {
  assert.equal(fireMeetsHideNoSatellite(EMPTY, true, { selectedId: 'empty' }), true);
  assert.equal(fireMeetsHideNoSatellite(MISSING, true, 'missing'), true);
  assert.deepEqual(
    filterFiresByHideNoSatellite([NOAA20, EMPTY, MISSING], true, { selectedId: 'empty' }).map((fire) => fire.id),
    ['noaa-20', 'empty'],
  );
  assert.deepEqual(
    filterFiresByHideNoSatellite([NOAA20, MISSING], true, 'missing').map((fire) => fire.id),
    ['noaa-20', 'missing'],
  );
  const byIndex = { index: 7, satellite: '', frp: 4 };
  assert.equal(fireMeetsHideNoSatellite(byIndex, true, { selectedId: '7' }), true);
});

test('invalid storage reads as off', () => {
  const storage = memoryStorage({ [FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY]: 'nope' });
  assert.equal(readFirmsHideNoSatellite(storage), false);
  assert.equal(readFirmsHideNoSatellite(memoryStorage({ [FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY]: '2' })), false);
  assert.equal(readFirmsHideNoSatellite(memoryStorage({ [FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY]: 'true' })), true);
  assert.equal(readFirmsHideNoSatellite(memoryStorage()), false);
  assert.equal(normalizeFirmsHideNoSatellite('bogus'), false);
  assert.equal(normalizeFirmsHideNoSatellite(0), false);
  assert.equal(normalizeFirmsHideNoSatellite('0'), false);
});

test('Persist flip survives reload', () => {
  const originalStorage = globalThis.localStorage;
  const storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => storage,
  });
  try {
    assert.equal(writeFirmsHideNoSatellite(true, storage), true);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY), '1');
    assert.equal(readFirmsHideNoSatellite(storage), true);
    const first = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
    assert.equal(first.getParams().hideNoSatellite, true);
    first.setParams({ hideNoSatellite: false });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY), '0');
    const reloaded = createFirmsHeatmapLayer({ id: 'firms-reload', name: 'FIRMS' });
    assert.equal(reloaded.getParams().hideNoSatellite, false);
    reloaded.setParams({ hideNoSatellite: true });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY), '1');
    const again = createFirmsHeatmapLayer({ id: 'firms-again', name: 'FIRMS' });
    assert.equal(again.getParams().hideNoSatellite, true);
    assert.equal(again.getParams().hideNoDaynight, false);
    assert.equal(again.getParams().areaCeiling, 'all');
    writeFirmsHideNoSatellite(false, storage);
    assert.equal(storage.getItem(FIRMS_AREA_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY), null);
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
    assert.doesNotMatch(source, /hideNoSatellite|firmsHideNoSatellite|Hide no satellite/, `${name} must stay off the hide path`);
    assert.doesNotMatch(source, /FIRMS_HIDE_NO_SATELLITE|fireMeetsHideNoSatellite/, `${name} must stay off the hide path`);
  }
  const [adaptedNamed] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', { satellite: 'NOAA-20' })]);
  const [adaptedEmpty] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', { satellite: '' })]);
  const [adaptedMissing] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', { satellite: undefined })]);
  assert.equal(adaptedNamed.satellite, 'NOAA-20', 'adapt already stores NOAA-20');
  assert.equal(adaptedEmpty.satellite, '');
  assert.equal(adaptedMissing.satellite, '');
  assert.equal(fireMeetsHideNoSatellite(adaptedNamed, true), true);
  assert.equal(fireMeetsHideNoSatellite(adaptedEmpty, true), false);
  assert.equal(fireMeetsHideNoSatellite(adaptedMissing, true), false);
});

test('Hide no satellite ANDs with 226 area, 233 hide-no-daynight, and existing FIRMS floors', async () => {
  const fires = [
    rawFire(AUSTIN.lat, AUSTIN.lon, 140, 360, 'h', {
      scan: 0.4, track: 0.4, version: '2.0NRT', brightnessTi5: 330, daynight: 'D', satellite: 'NOAA-20',
    }),
    rawFire(AUSTIN.lat + 1, AUSTIN.lon + 1, 140, 360, 'h', {
      scan: 0.4, track: 0.4, version: '2.0NRT', brightnessTi5: 330, daynight: 'D', satellite: '',
    }),
    rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 140, 360, 'h', {
      scan: 2, track: 2, version: '2.0NRT', brightnessTi5: 330, daynight: 'D', satellite: 'NOAA-20',
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
    assert.equal(harness.layer.getParams().hideNoSatellite, false);
    assert.equal(harness.layer.getStats().count, 4, 'off keeps empty + named satellite');

    assert.equal(harness.layer.setParams({ hideNoSatellite: true }), true);
    assert.equal(harness.layer.getStats().count, 3, 'on drops the empty satellite nadir');
    assert.equal(harness.fetchCount, 1, 'hide chip must not refetch NASA FIRMS');
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ areaCeiling: '1' });
    assert.equal(harness.layer.getStats().count, 2, 'hide AND <1 km² drops the 2×2 C2 row and the unlabeled nadir');
    harness.layer.setParams({ hideNoDaynight: true });
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
    assert.equal(harness.layer.getParams().hideNoSatellite, true, 'sibling chips must not overwrite hide');
    assert.equal(harness.layer.getParams().hideNoDaynight, true, '233 hide-no-daynight stays on');
    assert.equal(harness.layer.getParams().areaCeiling, '1');
    assert.equal(harness.layer.getStats().count, 1);
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1);

    harness.layer.setParams({ hideNoSatellite: false });
    assert.equal(harness.layer.getStats().count, 2, 'off restores the unlabeled nadir under the other floors');
    assert.equal(fireMeetsAreaCeiling({ scanKm: 0.4, trackKm: 0.4 }, '1'), true);
  } finally {
    harness.cleanup();
  }
});

test('FIRMS row exposes Hide no satellite from getRowControls() without a new /api', () => {
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const firstRun = readFileSync(path.join(ROOT, 'src/firstRunExperience.js'), 'utf8');
  const list = readFileSync(path.join(ROOT, 'src/data/firmsList.js'), 'utf8');
  const csv = readFileSync(path.join(ROOT, 'src/data/firmsCsv.js'), 'utf8');
  const adapt = readFileSync(path.join(ROOT, 'src/data/firmsAdapt.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  assert.match(heatmap, /firmsHideNoSatelliteChipModel/);
  assert.match(heatmap, /readFirmsHideNoSatellite|writeFirmsHideNoSatellite/);
  assert.match(heatmap, /filterFiresByHideNoSatellite/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/satellite/);
  assert.doesNotMatch(layerState, /hideNoSatellite|firmsHideNoSatellite/);
  assert.doesNotMatch(firstRun, /writeFirmsHideNoSatellite\(/);
  assert.doesNotMatch(list, /hideNoSatellite|firmsHideNoSatellite/);
  assert.doesNotMatch(csv, /hideNoSatellite|firmsHideNoSatellite/);
  assert.doesNotMatch(adapt, /hideNoSatellite|firmsHideNoSatellite/);
  assert.doesNotMatch(html, /hide-no-satellite|firmsHideNoSatellite/);
  assert.doesNotMatch(ui, /hideNoSatellite|firmsHideNoSatellite|Hide no satellite/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/satellite.js')), false);

  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const chips = layer.getRowControls().chips;
  const hide = chips.find((chip) => chip.id === FIRMS_HIDE_NO_SATELLITE_CHIP_ID);
  const hideDaynight = chips.find((chip) => chip.id === 'hide-no-daynight');
  assert.ok(hide, 'Hide no satellite must come from getRowControls()');
  assert.ok(hideDaynight, '233 Hide no day/night stays on the row');
  assert.equal(hide.label, 'Hide no satellite');
  assert.equal(hide.active, false);
  assert.deepEqual(hide.params, { hideNoSatellite: true });
  const hideIndex = chips.findIndex((chip) => chip.id === FIRMS_HIDE_NO_SATELLITE_CHIP_ID);
  const daynightIndex = chips.findIndex((chip) => chip.id === 'hide-no-daynight');
  assert.ok(hideIndex === daynightIndex + 1, 'Hide no satellite sits after Hide no day/night');
  layer.setParams({ hideNoSatellite: true });
  assert.equal(
    layer.getRowControls().chips.find((chip) => chip.id === FIRMS_HIDE_NO_SATELLITE_CHIP_ID).active,
    true,
  );
  layer.setParams({ hideNoDaynight: true });
  assert.equal(layer.getParams().hideNoSatellite, true, '233 hide-no-daynight stays distinct');
  assert.equal(layer.getParams().hideNoDaynight, true);
});
