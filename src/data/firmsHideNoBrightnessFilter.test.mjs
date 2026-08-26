// PLAN 267 — FIRMS globe Hide no brightness toggle. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_HIDE_NO_BRIGHTNESS,
  FIRMS_HIDE_NO_BRIGHTNESS_CHIP_ID,
  FIRMS_HIDE_NO_BRIGHTNESS_CHIP_LABEL,
  FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY,
  filterFiresByHideNoBrightness,
  fireHasBrightness,
  fireMeetsHideNoBrightness,
  firmsHideNoBrightnessChipModel,
  normalizeFirmsHideNoBrightness,
  readFirmsHideNoBrightness,
  writeFirmsHideNoBrightness,
} from './firmsHideNoBrightnessFilter.js';
import { fireMeetsBrightnessFloor } from './firmsBrightnessFloor.js';
import { FIRMS_AREA_STORAGE_KEY } from './firmsAreaFilter.js';
import { FIRMS_HIDE_NO_ACQ_STORAGE_KEY } from './firmsHideNoAcqFilter.js';
import { FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY } from './firmsHideNoConfidenceFilter.js';
import { FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY } from './firmsHideNoDaynightFilter.js';
import { FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY } from './firmsHideNoSatelliteFilter.js';
import { FIRMS_HIDE_NO_SENSOR_STORAGE_KEY } from './firmsHideNoSensorFilter.js';
import { FIRMS_HIDE_NO_VERSION_STORAGE_KEY } from './firmsHideNoVersionFilter.js';
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

const KELVIN = { id: 'kelvin', brightness: 320, frp: 20 };
const ZERO = { id: 'zero', brightness: 0, frp: 18 };
const MISSING = { id: 'missing', frp: 16 };
const NANED = { id: 'naned', brightness: Number.NaN, frp: 14 };
const INF = { id: 'inf', brightness: Number.POSITIVE_INFINITY, frp: 12 };
const NEG = { id: 'neg', brightness: -1, frp: 10 };

test('Off keeps brightness 0 / non-finite / missing', () => {
  assert.equal(DEFAULT_FIRMS_HIDE_NO_BRIGHTNESS, false);
  assert.equal(FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY, 'meridian.firmsHideNoBrightness');
  assert.equal(normalizeFirmsHideNoBrightness(undefined), false);
  assert.equal(normalizeFirmsHideNoBrightness(null), false);
  assert.equal(normalizeFirmsHideNoBrightness(false), false);
  assert.equal(normalizeFirmsHideNoBrightness(true), true);
  assert.equal(normalizeFirmsHideNoBrightness('1'), true);
  assert.equal(normalizeFirmsHideNoBrightness(1), true);

  for (const fire of [KELVIN, ZERO, MISSING, NANED, INF, NEG]) {
    assert.equal(fireMeetsHideNoBrightness(fire, false), true, `off keeps ${fire.id}`);
  }
  assert.deepEqual(
    filterFiresByHideNoBrightness([KELVIN, ZERO, MISSING], false).map((fire) => fire.id),
    ['kelvin', 'zero', 'missing'],
  );
  assert.equal(FIRMS_HIDE_NO_BRIGHTNESS_CHIP_LABEL, 'Hide no brightness');
  const chip = firmsHideNoBrightnessChipModel(false);
  assert.equal(chip.id, FIRMS_HIDE_NO_BRIGHTNESS_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoBrightness: true });
  assert.deepEqual(firmsHideNoBrightnessChipModel(true).params, { hideNoBrightness: false });
  assert.equal(fireMeetsBrightnessFloor(ZERO, '320'), true, 'brightness floor still fails open on 0');
  assert.equal(fireMeetsBrightnessFloor(MISSING, '320'), true, 'brightness floor still fails open on missing');
  assert.equal(fireMeetsBrightnessFloor(NANED, '320'), true, 'brightness floor still fails open on non-finite');
});

test('On hides brightness 0 / non-finite / missing and keeps 320 K', () => {
  assert.equal(fireHasBrightness(KELVIN), true);
  assert.equal(fireHasBrightness({ brightness: 320 }), true);
  assert.equal(fireHasBrightness(ZERO), false);
  assert.equal(fireHasBrightness(MISSING), false);
  assert.equal(fireHasBrightness(NANED), false);
  assert.equal(fireHasBrightness(INF), false);
  assert.equal(fireHasBrightness(NEG), false);
  assert.equal(fireHasBrightness(null), false);

  assert.equal(fireMeetsHideNoBrightness(KELVIN, true), true);
  assert.equal(fireMeetsHideNoBrightness({ brightness: 320 }, true), true);
  assert.equal(fireMeetsHideNoBrightness(ZERO, true), false, 'brightness 0 is a hide when on');
  assert.equal(fireMeetsHideNoBrightness(MISSING, true), false, 'missing brightness fails closed when on');
  assert.equal(fireMeetsHideNoBrightness(NANED, true), false);
  assert.equal(fireMeetsHideNoBrightness(INF, true), false);
  assert.equal(fireMeetsHideNoBrightness(NEG, true), false, 'brightness <= 0 fails closed');
  assert.deepEqual(
    filterFiresByHideNoBrightness([KELVIN, ZERO, NANED, MISSING, INF], true).map((fire) => fire.id),
    ['kelvin'],
  );
  assert.equal(fireMeetsBrightnessFloor(ZERO, '320'), true, 'not a Kelvin floor — 320+ still fail-opens 0');
  assert.equal(fireMeetsBrightnessFloor(KELVIN, '320'), true);
  assert.equal(fireMeetsBrightnessFloor({ brightness: 300 }, '320'), false, '320+ floor still hides a cool 300 K');
  assert.equal(fireMeetsHideNoBrightness({ brightness: 300 }, true), true, 'presence keeps a real cool Kelvin');
});

test('Selected id always kept', () => {
  assert.equal(fireMeetsHideNoBrightness(ZERO, true, { selectedId: 'zero' }), true);
  assert.equal(fireMeetsHideNoBrightness(MISSING, true, 'missing'), true);
  assert.deepEqual(
    filterFiresByHideNoBrightness([KELVIN, ZERO, MISSING], true, { selectedId: 'zero' }).map((fire) => fire.id),
    ['kelvin', 'zero'],
  );
  assert.deepEqual(
    filterFiresByHideNoBrightness([KELVIN, MISSING], true, 'missing').map((fire) => fire.id),
    ['kelvin', 'missing'],
  );
  const byIndex = { index: 7, brightness: 0, frp: 4 };
  assert.equal(fireMeetsHideNoBrightness(byIndex, true, { selectedId: '7' }), true);
});

test('Invalid storage reads as off', () => {
  const storage = memoryStorage({ [FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY]: 'nope' });
  assert.equal(readFirmsHideNoBrightness(storage), false);
  assert.equal(readFirmsHideNoBrightness(memoryStorage({ [FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY]: '2' })), false);
  assert.equal(readFirmsHideNoBrightness(memoryStorage({ [FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY]: 'true' })), true);
  assert.equal(readFirmsHideNoBrightness(memoryStorage()), false);
  assert.equal(normalizeFirmsHideNoBrightness('bogus'), false);
  assert.equal(normalizeFirmsHideNoBrightness(0), false);
  assert.equal(normalizeFirmsHideNoBrightness('0'), false);
  assert.equal(readFirmsHideNoBrightness({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');
});

test('Persist flip survives reload and does not write a share URL', () => {
  const originalStorage = globalThis.localStorage;
  const storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => storage,
  });
  try {
    assert.equal(writeFirmsHideNoBrightness(true, storage), true);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY), '1');
    assert.equal(readFirmsHideNoBrightness(storage), true);
    const first = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
    assert.equal(first.getParams().hideNoBrightness, true);
    first.setParams({ hideNoBrightness: false });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY), '0');
    const reloaded = createFirmsHeatmapLayer({ id: 'firms-reload', name: 'FIRMS' });
    assert.equal(reloaded.getParams().hideNoBrightness, false);
    reloaded.setParams({ hideNoBrightness: true });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY), '1');
    const again = createFirmsHeatmapLayer({ id: 'firms-again', name: 'FIRMS' });
    assert.equal(again.getParams().hideNoBrightness, true);
    assert.equal(again.getParams().hideNoAcq, false);
    assert.equal(again.getParams().hideNoConfidence, false);
    assert.equal(again.getParams().hideNoVersion, false);
    assert.equal(again.getParams().hideNoSensor, false);
    assert.equal(again.getParams().hideNoSatellite, false);
    assert.equal(again.getParams().hideNoDaynight, false);
    assert.equal(again.getParams().ageWindow, '24');
    assert.equal(again.getParams().confidenceFloor, 'all');
    assert.equal(again.getParams().brightnessFloor, 'all');
    assert.equal(again.getParams().versionFilter, 'all');
    writeFirmsHideNoBrightness(false, storage);
    assert.equal(storage.getItem(FIRMS_AREA_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_ACQ_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SENSOR_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_VERSION_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY), null);
    const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
    assert.doesNotMatch(layerState, /hideNoBrightness|firmsHideNoBrightness/);
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
    assert.doesNotMatch(source, /hideNoBrightness|firmsHideNoBrightness|Hide no brightness/, `${name} must stay off the hide path`);
    assert.doesNotMatch(source, /FIRMS_HIDE_NO_BRIGHTNESS|fireMeetsHideNoBrightness/, `${name} must stay off the hide path`);
  }
  const [adaptedKelvin] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 320, 'h')]);
  assert.equal(adaptedKelvin.brightness, 320);
  assert.equal(fireHasBrightness(adaptedKelvin), true);
  assert.equal(fireMeetsHideNoBrightness(adaptedKelvin, true), true);
  const [adaptedMissing] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', {
    brightness: 'not-kelvin',
  })]);
  assert.equal(adaptedMissing.brightness, 0);
  assert.equal(fireMeetsHideNoBrightness(adaptedMissing, true), false);
  assert.equal(fireMeetsBrightnessFloor(adaptedMissing, '320'), true);
});

test('Hide no brightness ANDs with FRP / confidence / age / sat / sensor / version / daynight / acq', async () => {
  const now = Date.now();
  const kelvinNadir = {
    id: 'kelvin-nadir',
    index: 0,
    lat: AUSTIN.lat,
    lon: AUSTIN.lon,
    frp: 140,
    confidence: 0.9,
    brightness: 320,
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
  const missingBrightNadir = {
    ...kelvinNadir,
    id: 'missing-bright-nadir',
    index: 1,
    lat: AUSTIN.lat + 1,
    lon: AUSTIN.lon + 1,
    brightness: 0,
  };
  const missingAcqKelvin = {
    ...kelvinNadir,
    id: 'missing-acq-kelvin',
    index: 2,
    lat: AUSTIN.lat + 2,
    lon: AUSTIN.lon + 2,
    acqMs: 0,
  };
  const lowNight = {
    id: 'low-night',
    index: 3,
    lat: TOKYO.lat,
    lon: TOKYO.lon,
    frp: 4.2,
    confidence: 0.3,
    brightness: 320,
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
    harness.layer._bindInteractionForTest(harness.viewer, [kelvinNadir, missingBrightNadir, missingAcqKelvin, lowNight]);
    assert.equal(harness.layer.getParams().hideNoBrightness, false);
    assert.equal(harness.layer.getStats().count, 4, 'off keeps brightness 0 + 320 K');

    harness.layer.setParams({ brightnessFloor: '320' });
    assert.equal(harness.layer.getStats().count, 4, '320+ floor still fails open on brightness 0');
    harness.layer.setParams({ brightnessFloor: 'all' });
    assert.equal(harness.layer.setParams({ hideNoBrightness: true }), true);
    assert.equal(harness.layer.getStats().count, 3, 'on drops the brightness-0 nadir that the floor kept');
    assert.equal(harness.fetchCount, 1, 'hide chip must not refetch NASA FIRMS');
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ hideNoAcq: true });
    assert.equal(harness.layer.getStats().count, 2, 'hide AND Hide no acq drops the missing-acq 320 K row');
    harness.layer.setParams({ hideNoDaynight: true });
    harness.layer.setParams({ hideNoSatellite: true });
    harness.layer.setParams({ hideNoSensor: true });
    harness.layer.setParams({ hideNoVersion: true });
    harness.layer.setParams({ hideNoConfidence: true });
    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 1, 'AND FRP 50+ keeps the 320 K 140 MW nadir');
    harness.layer.setParams({ ageWindow: '6' });
    harness.layer.setParams({ versionFilter: '2.0NRT' });
    harness.layer.setParams({ showNight: false });
    harness.layer.setParams({ confidenceFloor: '0.8' });
    harness.layer.setParams({ sensors: 'V' });
    harness.layer.setParams({ satelliteFilter: 'AQUA' });
    assert.equal(harness.layer.getParams().hideNoBrightness, true, 'sibling chips must not overwrite hide');
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
    assert.equal(harness.layer.getStats().count, 1);
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1);

    harness.layer.setParams({ hideNoBrightness: false });
    assert.equal(harness.layer.getStats().count, 2, 'off restores the brightness-0 nadir under the fail-open floor');
    assert.equal(fireMeetsBrightnessFloor({ brightness: 0 }, '320'), true);
  } finally {
    harness.cleanup();
  }
});

test('FIRMS row exposes Hide no brightness from getRowControls() without a new /api', () => {
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
  assert.match(heatmap, /firmsHideNoBrightnessChipModel/);
  assert.match(heatmap, /readFirmsHideNoBrightness|writeFirmsHideNoBrightness/);
  assert.match(heatmap, /filterFiresByHideNoBrightness/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/brightness\/hide/);
  assert.doesNotMatch(layerState, /hideNoBrightness|firmsHideNoBrightness/);
  assert.doesNotMatch(firstRun, /writeFirmsHideNoBrightness\(/);
  assert.doesNotMatch(list, /hideNoBrightness|firmsHideNoBrightness/);
  assert.doesNotMatch(csv, /hideNoBrightness|firmsHideNoBrightness/);
  assert.doesNotMatch(adapt, /hideNoBrightness|firmsHideNoBrightness/);
  assert.doesNotMatch(html, /hide-no-brightness|firmsHideNoBrightness/);
  assert.doesNotMatch(ui, /hideNoBrightness|firmsHideNoBrightness|Hide no brightness/);
  assert.doesNotMatch(css, /hide-no-brightness|firmsHideNoBrightness|Hide no brightness/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/brightness.js')), false);
  assert.match(sources, /We acknowledge the use of data and\/or imagery from NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.match(credits, /NASA FIRMS|FIRMS/);
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(heatmap, /God'?s Eye View|GEV rebrand|quantum-earth|opensky|telegeography/i);

  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const chips = layer.getRowControls().chips;
  const hide = chips.find((chip) => chip.id === FIRMS_HIDE_NO_BRIGHTNESS_CHIP_ID);
  const hideAcq = chips.find((chip) => chip.id === 'hide-no-acq');
  const hideConfidence = chips.find((chip) => chip.id === 'hide-no-confidence');
  const hideVersion = chips.find((chip) => chip.id === 'hide-no-version');
  const hideSensor = chips.find((chip) => chip.id === 'hide-no-sensor');
  const hideSatellite = chips.find((chip) => chip.id === 'hide-no-satellite');
  const hideDaynight = chips.find((chip) => chip.id === 'hide-no-daynight');
  const ageChips = chips.filter((chip) => chip.params.ageWindow);
  assert.ok(hide, 'Hide no brightness must come from getRowControls()');
  assert.ok(hideAcq, '262 Hide no acq stays on the row');
  assert.ok(hideConfidence, '253 Hide no confidence stays on the row');
  assert.ok(hideVersion, '245 Hide no version stays on the row');
  assert.ok(hideSensor, '241 Hide no sensor stays on the row');
  assert.ok(hideSatellite, '238 Hide no satellite stays on the row');
  assert.ok(hideDaynight, '233 Hide no day/night stays on the row');
  assert.deepEqual(ageChips.map((chip) => chip.label), ['6h', '12h', '24h']);
  assert.equal(hide.label, 'Hide no brightness');
  assert.equal(hide.active, false);
  assert.deepEqual(hide.params, { hideNoBrightness: true });
  const hideIndex = chips.findIndex((chip) => chip.id === FIRMS_HIDE_NO_BRIGHTNESS_CHIP_ID);
  const acqIndex = chips.findIndex((chip) => chip.id === 'hide-no-acq');
  assert.ok(hideIndex === acqIndex + 1, 'Hide no brightness sits after Hide no acq');
  layer.setParams({ hideNoBrightness: true });
  assert.equal(
    layer.getRowControls().chips.find((chip) => chip.id === FIRMS_HIDE_NO_BRIGHTNESS_CHIP_ID).active,
    true,
  );
  layer.setParams({ hideNoAcq: true });
  layer.setParams({ hideNoConfidence: true });
  layer.setParams({ hideNoVersion: true });
  layer.setParams({ hideNoSensor: true });
  layer.setParams({ hideNoSatellite: true });
  layer.setParams({ hideNoDaynight: true });
  layer.setParams({ ageWindow: '6' });
  assert.equal(layer.getParams().hideNoBrightness, true, '262 hide-no-acq stays distinct');
  assert.equal(layer.getParams().hideNoAcq, true);
  assert.equal(layer.getParams().hideNoConfidence, true);
  assert.equal(layer.getParams().hideNoVersion, true);
  assert.equal(layer.getParams().hideNoSensor, true);
  assert.equal(layer.getParams().hideNoSatellite, true);
  assert.equal(layer.getParams().hideNoDaynight, true);
  assert.equal(layer.getParams().ageWindow, '6', 'age window stays distinct');
});
