// PLAN 233 — FIRMS Hide no day/night toggle. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_HIDE_NO_DAYNIGHT,
  FIRMS_HIDE_NO_DAYNIGHT_CHIP_ID,
  FIRMS_HIDE_NO_DAYNIGHT_CHIP_LABEL,
  FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY,
  filterFiresByHideNoDaynight,
  fireHasLabeledDayNight,
  fireMeetsHideNoDaynight,
  firmsHideNoDaynightChipModel,
  normalizeFirmsHideNoDaynight,
  readFirmsHideNoDaynight,
  writeFirmsHideNoDaynight,
} from './firmsHideNoDaynightFilter.js';
import { FIRMS_AREA_STORAGE_KEY, fireMeetsAreaCeiling } from './firmsAreaFilter.js';
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

const DAY = { id: 'day', daynight: 'D', frp: 20 };
const NIGHT = { id: 'night', daynight: 'N', frp: 18 };
const MISSING = { id: 'missing', frp: 16 };
const EMPTY = { id: 'empty', daynight: '', frp: 14 };
const WHITESPACE = { id: 'ws', daynight: '   ', frp: 12 };
const OTHER = { id: 'x', daynight: 'X', frp: 10 };
const NIGHT_FLAG = { id: 'flag-n', night: true, frp: 9 };
const DAY_FLAG = { id: 'flag-d', night: false, frp: 8 };

test('Off keeps D / N / missing', () => {
  assert.equal(DEFAULT_FIRMS_HIDE_NO_DAYNIGHT, false);
  assert.equal(FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY, 'meridian.firmsHideNoDaynight');
  assert.equal(normalizeFirmsHideNoDaynight(undefined), false);
  assert.equal(normalizeFirmsHideNoDaynight(null), false);
  assert.equal(normalizeFirmsHideNoDaynight(false), false);
  assert.equal(normalizeFirmsHideNoDaynight(true), true);
  assert.equal(normalizeFirmsHideNoDaynight('1'), true);
  assert.equal(normalizeFirmsHideNoDaynight(1), true);

  for (const fire of [DAY, NIGHT, MISSING, EMPTY, WHITESPACE, OTHER]) {
    assert.equal(fireMeetsHideNoDaynight(fire, false), true, `off keeps ${fire.id}`);
  }
  assert.deepEqual(
    filterFiresByHideNoDaynight([DAY, NIGHT, MISSING, EMPTY], false).map((fire) => fire.id),
    ['day', 'night', 'missing', 'empty'],
  );
  assert.equal(FIRMS_HIDE_NO_DAYNIGHT_CHIP_LABEL, 'Hide no day/night');
  const chip = firmsHideNoDaynightChipModel(false);
  assert.equal(chip.id, FIRMS_HIDE_NO_DAYNIGHT_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoDaynight: true });
  assert.deepEqual(firmsHideNoDaynightChipModel(true).params, { hideNoDaynight: false });
});

test('On keeps D and N, drops empty / whitespace / X', () => {
  assert.equal(fireHasLabeledDayNight(DAY), true);
  assert.equal(fireHasLabeledDayNight(NIGHT), true);
  assert.equal(fireHasLabeledDayNight(NIGHT_FLAG), true, 'boolean night true is labeled');
  assert.equal(fireHasLabeledDayNight(DAY_FLAG), true, 'boolean night false without daynight is day');
  assert.equal(fireHasLabeledDayNight(MISSING), false);
  assert.equal(fireHasLabeledDayNight(EMPTY), false);
  assert.equal(fireHasLabeledDayNight(WHITESPACE), false);
  assert.equal(fireHasLabeledDayNight(OTHER), false);

  assert.equal(fireMeetsHideNoDaynight(DAY, true), true);
  assert.equal(fireMeetsHideNoDaynight(NIGHT, true), true);
  assert.equal(fireMeetsHideNoDaynight({ daynight: ' d ' }, true), true);
  assert.equal(fireMeetsHideNoDaynight(NIGHT_FLAG, true), true);
  assert.equal(fireMeetsHideNoDaynight(DAY_FLAG, true), true);
  assert.equal(fireMeetsHideNoDaynight(MISSING, true), false);
  assert.equal(fireMeetsHideNoDaynight(EMPTY, true), false, 'empty daynight is a hide when on');
  assert.equal(fireMeetsHideNoDaynight(WHITESPACE, true), false);
  assert.equal(fireMeetsHideNoDaynight(OTHER, true), false);
  assert.deepEqual(
    filterFiresByHideNoDaynight(
      [DAY, NIGHT, MISSING, EMPTY, WHITESPACE, OTHER, NIGHT_FLAG],
      true,
    ).map((fire) => fire.id),
    ['day', 'night', 'flag-n'],
  );
});

test('Selected id always kept', () => {
  assert.equal(fireMeetsHideNoDaynight(EMPTY, true, { selectedId: 'empty' }), true);
  assert.equal(fireMeetsHideNoDaynight(OTHER, true, 'x'), true);
  assert.deepEqual(
    filterFiresByHideNoDaynight([DAY, EMPTY, OTHER], true, { selectedId: 'empty' }).map((fire) => fire.id),
    ['day', 'empty'],
  );
  assert.deepEqual(
    filterFiresByHideNoDaynight([DAY, OTHER], true, 'x').map((fire) => fire.id),
    ['day', 'x'],
  );
  const byIndex = { index: 7, daynight: '', frp: 4 };
  assert.equal(fireMeetsHideNoDaynight(byIndex, true, { selectedId: '7' }), true);
});

test('Invalid storage reads as off', () => {
  const storage = memoryStorage({ [FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY]: 'nope' });
  assert.equal(readFirmsHideNoDaynight(storage), false);
  assert.equal(readFirmsHideNoDaynight(memoryStorage({ [FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY]: '2' })), false);
  assert.equal(readFirmsHideNoDaynight(memoryStorage({ [FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY]: 'true' })), true);
  assert.equal(readFirmsHideNoDaynight(memoryStorage()), false);
  assert.equal(normalizeFirmsHideNoDaynight('bogus'), false);
  assert.equal(normalizeFirmsHideNoDaynight(0), false);
  assert.equal(normalizeFirmsHideNoDaynight('0'), false);
});

test('Persist flip survives reload', () => {
  const originalStorage = globalThis.localStorage;
  const storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => storage,
  });
  try {
    assert.equal(writeFirmsHideNoDaynight(true, storage), true);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY), '1');
    assert.equal(readFirmsHideNoDaynight(storage), true);
    const first = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
    assert.equal(first.getParams().hideNoDaynight, true);
    first.setParams({ hideNoDaynight: false });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY), '0');
    const reloaded = createFirmsHeatmapLayer({ id: 'firms-reload', name: 'FIRMS' });
    assert.equal(reloaded.getParams().hideNoDaynight, false);
    reloaded.setParams({ hideNoDaynight: true });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY), '1');
    const again = createFirmsHeatmapLayer({ id: 'firms-again', name: 'FIRMS' });
    assert.equal(again.getParams().hideNoDaynight, true);
    assert.equal(again.getParams().areaCeiling, 'all');
    writeFirmsHideNoDaynight(false, storage);
    assert.equal(storage.getItem(FIRMS_AREA_STORAGE_KEY), null);
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
    assert.doesNotMatch(source, /hideNoDaynight|firmsHideNoDaynight|Hide no day/, `${name} must stay off the hide path`);
    assert.doesNotMatch(source, /FIRMS_HIDE_NO_DAYNIGHT|fireMeetsHideNoDaynight/, `${name} must stay off the hide path`);
  }
  const [adaptedD] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', { daynight: 'D' })]);
  const [adaptedN] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', { daynight: 'N' })]);
  const [adaptedX] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', { daynight: 'X' })]);
  const [adaptedEmpty] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', { daynight: '' })]);
  assert.equal(adaptedD.daynight, 'D', 'adapt already stores D');
  assert.equal(adaptedN.daynight, 'N', 'adapt already stores N');
  assert.equal(adaptedN.night, true);
  assert.equal(adaptedX.daynight, '', 'adapt already blanks unlabeled X');
  assert.equal(adaptedEmpty.daynight, '');
  assert.equal(fireMeetsHideNoDaynight(adaptedD, true), true);
  assert.equal(fireMeetsHideNoDaynight(adaptedN, true), true);
  assert.equal(fireMeetsHideNoDaynight(adaptedX, true), false);
  assert.equal(fireMeetsHideNoDaynight(adaptedEmpty, true), false);
});

test('Hide no day/night ANDs with 226 area and existing FIRMS floors', async () => {
  const fires = [
    rawFire(AUSTIN.lat, AUSTIN.lon, 140, 360, 'h', {
      scan: 0.4, track: 0.4, version: '2.0NRT', brightnessTi5: 330, daynight: 'D',
    }),
    rawFire(AUSTIN.lat + 1, AUSTIN.lon + 1, 140, 360, 'h', {
      scan: 0.4, track: 0.4, version: '2.0NRT', brightnessTi5: 330, daynight: '',
    }),
    rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 140, 360, 'h', {
      scan: 2, track: 2, version: '2.0NRT', brightnessTi5: 330, daynight: 'D',
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
    assert.equal(harness.layer.getParams().hideNoDaynight, false);
    assert.equal(harness.layer.getStats().count, 4, 'off keeps D / N / missing');

    assert.equal(harness.layer.setParams({ hideNoDaynight: true }), true);
    assert.equal(harness.layer.getStats().count, 3, 'on drops the empty daynight nadir');
    assert.equal(harness.fetchCount, 1, 'hide chip must not refetch NASA FIRMS');
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ areaCeiling: '1' });
    assert.equal(harness.layer.getStats().count, 2, 'hide AND <1 km² drops the 2×2 C2 row and the unlabeled nadir');
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
    assert.equal(harness.layer.getParams().hideNoDaynight, true, 'sibling chips must not overwrite hide');
    assert.equal(harness.layer.getParams().areaCeiling, '1');
    assert.equal(harness.layer.getStats().count, 1);
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1);

    harness.layer.setParams({ hideNoDaynight: false });
    assert.equal(harness.layer.getStats().count, 2, 'off restores the unlabeled nadir under the other floors');
    assert.equal(fireMeetsAreaCeiling({ scanKm: 0.4, trackKm: 0.4 }, '1'), true);
  } finally {
    harness.cleanup();
  }
});

test('FIRMS row exposes Hide no day/night next to Day | Night without a new /api', () => {
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const firstRun = readFileSync(path.join(ROOT, 'src/firstRunExperience.js'), 'utf8');
  const list = readFileSync(path.join(ROOT, 'src/data/firmsList.js'), 'utf8');
  const csv = readFileSync(path.join(ROOT, 'src/data/firmsCsv.js'), 'utf8');
  const adapt = readFileSync(path.join(ROOT, 'src/data/firmsAdapt.js'), 'utf8');
  assert.match(heatmap, /firmsHideNoDaynightChipModel/);
  assert.match(heatmap, /readFirmsHideNoDaynight|writeFirmsHideNoDaynight/);
  assert.match(heatmap, /filterFiresByHideNoDaynight/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/daynight/);
  assert.doesNotMatch(layerState, /hideNoDaynight|firmsHideNoDaynight/);
  assert.match(firstRun, /meridian\.firmsHideNoDaynight/);
  assert.doesNotMatch(firstRun, /writeFirmsHideNoDaynight\(/);
  assert.doesNotMatch(list, /hideNoDaynight|firmsHideNoDaynight/);
  assert.doesNotMatch(csv, /hideNoDaynight|firmsHideNoDaynight/);
  assert.doesNotMatch(adapt, /hideNoDaynight|firmsHideNoDaynight/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/daynight.js')), false);

  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const chips = layer.getRowControls().chips;
  const hide = chips.find((chip) => chip.id === FIRMS_HIDE_NO_DAYNIGHT_CHIP_ID);
  const dayNight = chips.filter((chip) => chip.id.startsWith('daynight-'));
  assert.ok(hide, 'Hide no day/night must come from getRowControls()');
  assert.equal(hide.label, 'Hide no day/night');
  assert.equal(hide.active, false);
  assert.deepEqual(hide.params, { hideNoDaynight: true });
  assert.deepEqual(dayNight.map((chip) => chip.label), ['Day', 'Night']);
  const hideIndex = chips.findIndex((chip) => chip.id === FIRMS_HIDE_NO_DAYNIGHT_CHIP_ID);
  const nightIndex = chips.findIndex((chip) => chip.id === 'daynight-night');
  assert.ok(hideIndex === nightIndex + 1, 'Hide no day/night sits next to Day | Night');
  layer.setParams({ hideNoDaynight: true });
  assert.equal(
    layer.getRowControls().chips.find((chip) => chip.id === FIRMS_HIDE_NO_DAYNIGHT_CHIP_ID).active,
    true,
  );
  layer.setParams({ showNight: false });
  assert.equal(layer.getParams().hideNoDaynight, true, 'Day | Night chips stay distinct');
  assert.equal(layer.getParams().showNight, false);
});
