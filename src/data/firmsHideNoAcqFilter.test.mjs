// PLAN 262 — FIRMS globe Hide no acq toggle. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_HIDE_NO_ACQ,
  FIRMS_HIDE_NO_ACQ_CHIP_ID,
  FIRMS_HIDE_NO_ACQ_CHIP_LABEL,
  FIRMS_HIDE_NO_ACQ_STORAGE_KEY,
  filterFiresByHideNoAcq,
  fireHasAcquisitionTime,
  fireMeetsHideNoAcq,
  firmsHideNoAcqChipModel,
  normalizeFirmsHideNoAcq,
  readFirmsHideNoAcq,
  writeFirmsHideNoAcq,
} from './firmsHideNoAcqFilter.js';
import { fireMeetsAgeWindow } from './firmsAgeWindow.js';
import { FIRMS_AREA_STORAGE_KEY, fireMeetsAreaCeiling } from './firmsAreaFilter.js';
import { FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY } from './firmsHideNoConfidenceFilter.js';
import { FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY } from './firmsHideNoDaynightFilter.js';
import { FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY } from './firmsHideNoSatelliteFilter.js';
import { FIRMS_HIDE_NO_SENSOR_STORAGE_KEY } from './firmsHideNoSensorFilter.js';
import { FIRMS_HIDE_NO_VERSION_STORAGE_KEY } from './firmsHideNoVersionFilter.js';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';
import { adaptFirmsRecords, parseAcquisitionMs } from './firmsAdapt.js';
import { unregisterSpriteCollection } from './spriteOrder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUSTIN = { lon: -97.7, lat: 30.2 };
const TOKYO = { lon: 139.7, lat: 35.7 };
const DETECTION_HEIGHT_M = 1_500_000;
const DATED_EPOCH = 1_753_600_000_000;

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

const DATED = { id: 'dated', acqMs: DATED_EPOCH, frp: 20 };
const ZERO = { id: 'zero', acqMs: 0, frp: 18 };
const MISSING = { id: 'missing', frp: 16 };
const NANED = { id: 'naned', acqMs: Number.NaN, frp: 14 };
const INF = { id: 'inf', acqMs: Number.POSITIVE_INFINITY, frp: 12 };
const NEG = { id: 'neg', acqMs: -1, frp: 10 };

test('Off keeps missing-acq rows', () => {
  assert.equal(DEFAULT_FIRMS_HIDE_NO_ACQ, false);
  assert.equal(FIRMS_HIDE_NO_ACQ_STORAGE_KEY, 'meridian.firmsHideNoAcq');
  assert.equal(normalizeFirmsHideNoAcq(undefined), false);
  assert.equal(normalizeFirmsHideNoAcq(null), false);
  assert.equal(normalizeFirmsHideNoAcq(false), false);
  assert.equal(normalizeFirmsHideNoAcq(true), true);
  assert.equal(normalizeFirmsHideNoAcq('1'), true);
  assert.equal(normalizeFirmsHideNoAcq(1), true);

  for (const fire of [DATED, ZERO, MISSING, NANED, INF, NEG]) {
    assert.equal(fireMeetsHideNoAcq(fire, false), true, `off keeps ${fire.id}`);
  }
  assert.deepEqual(
    filterFiresByHideNoAcq([DATED, ZERO, MISSING], false).map((fire) => fire.id),
    ['dated', 'zero', 'missing'],
  );
  assert.equal(FIRMS_HIDE_NO_ACQ_CHIP_LABEL, 'Hide no acq');
  const chip = firmsHideNoAcqChipModel(false);
  assert.equal(chip.id, FIRMS_HIDE_NO_ACQ_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoAcq: true });
  assert.deepEqual(firmsHideNoAcqChipModel(true).params, { hideNoAcq: false });
  assert.equal(fireMeetsAgeWindow(ZERO, '6', Date.now()), true, 'age window still fails open on acqMs 0');
  assert.equal(fireMeetsAgeWindow(MISSING, '6', Date.now()), true, 'age window still fails open on missing acq');
  assert.equal(fireMeetsAgeWindow(NANED, '6', Date.now()), true, 'age window still fails open on non-finite acq');
});

test('On hides acqMs 0 / non-finite / missing and keeps a real epoch', () => {
  assert.equal(fireHasAcquisitionTime(DATED), true);
  assert.equal(fireHasAcquisitionTime({ acqMs: Date.now() }), true);
  assert.equal(fireHasAcquisitionTime(ZERO), false);
  assert.equal(fireHasAcquisitionTime(MISSING), false);
  assert.equal(fireHasAcquisitionTime(NANED), false);
  assert.equal(fireHasAcquisitionTime(INF), false);
  assert.equal(fireHasAcquisitionTime(NEG), false);
  assert.equal(fireHasAcquisitionTime(null), false);

  assert.equal(fireMeetsHideNoAcq(DATED, true), true);
  assert.equal(fireMeetsHideNoAcq({ acqMs: DATED_EPOCH }, true), true);
  assert.equal(fireMeetsHideNoAcq(ZERO, true), false, 'acqMs 0 is a hide when on');
  assert.equal(fireMeetsHideNoAcq(MISSING, true), false, 'missing acq fails closed when on');
  assert.equal(fireMeetsHideNoAcq(NANED, true), false);
  assert.equal(fireMeetsHideNoAcq(INF, true), false);
  assert.equal(fireMeetsHideNoAcq(NEG, true), false, 'acqMs <= 0 fails closed');
  assert.deepEqual(
    filterFiresByHideNoAcq([DATED, ZERO, NANED, MISSING, INF], true).map((fire) => fire.id),
    ['dated'],
  );
  assert.equal(parseAcquisitionMs('', '1006'), 0, 'adapter still writes the 0 sentinel');
  assert.equal(parseAcquisitionMs('not-a-date', '1006'), 0);
  assert.equal(fireMeetsHideNoAcq({ acqMs: parseAcquisitionMs('', '1006') }, true), false);
  assert.equal(fireMeetsAgeWindow({ acqMs: parseAcquisitionMs('', '1006') }, '6', Date.now()), true);
});

test('Selected id always kept', () => {
  assert.equal(fireMeetsHideNoAcq(ZERO, true, { selectedId: 'zero' }), true);
  assert.equal(fireMeetsHideNoAcq(MISSING, true, 'missing'), true);
  assert.deepEqual(
    filterFiresByHideNoAcq([DATED, ZERO, MISSING], true, { selectedId: 'zero' }).map((fire) => fire.id),
    ['dated', 'zero'],
  );
  assert.deepEqual(
    filterFiresByHideNoAcq([DATED, MISSING], true, 'missing').map((fire) => fire.id),
    ['dated', 'missing'],
  );
  const byIndex = { index: 7, acqMs: 0, frp: 4 };
  assert.equal(fireMeetsHideNoAcq(byIndex, true, { selectedId: '7' }), true);
});

test('Invalid storage reads as off', () => {
  const storage = memoryStorage({ [FIRMS_HIDE_NO_ACQ_STORAGE_KEY]: 'nope' });
  assert.equal(readFirmsHideNoAcq(storage), false);
  assert.equal(readFirmsHideNoAcq(memoryStorage({ [FIRMS_HIDE_NO_ACQ_STORAGE_KEY]: '2' })), false);
  assert.equal(readFirmsHideNoAcq(memoryStorage({ [FIRMS_HIDE_NO_ACQ_STORAGE_KEY]: 'true' })), true);
  assert.equal(readFirmsHideNoAcq(memoryStorage()), false);
  assert.equal(normalizeFirmsHideNoAcq('bogus'), false);
  assert.equal(normalizeFirmsHideNoAcq(0), false);
  assert.equal(normalizeFirmsHideNoAcq('0'), false);
});

test('Persist flip survives reload and does not write a share URL', () => {
  const originalStorage = globalThis.localStorage;
  const storage = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => storage,
  });
  try {
    assert.equal(writeFirmsHideNoAcq(true, storage), true);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_ACQ_STORAGE_KEY), '1');
    assert.equal(readFirmsHideNoAcq(storage), true);
    const first = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
    assert.equal(first.getParams().hideNoAcq, true);
    first.setParams({ hideNoAcq: false });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_ACQ_STORAGE_KEY), '0');
    const reloaded = createFirmsHeatmapLayer({ id: 'firms-reload', name: 'FIRMS' });
    assert.equal(reloaded.getParams().hideNoAcq, false);
    reloaded.setParams({ hideNoAcq: true });
    assert.equal(storage.getItem(FIRMS_HIDE_NO_ACQ_STORAGE_KEY), '1');
    const again = createFirmsHeatmapLayer({ id: 'firms-again', name: 'FIRMS' });
    assert.equal(again.getParams().hideNoAcq, true);
    assert.equal(again.getParams().hideNoConfidence, false);
    assert.equal(again.getParams().hideNoVersion, false);
    assert.equal(again.getParams().hideNoSensor, false);
    assert.equal(again.getParams().hideNoSatellite, false);
    assert.equal(again.getParams().hideNoDaynight, false);
    assert.equal(again.getParams().ageWindow, '24');
    assert.equal(again.getParams().confidenceFloor, 'all');
    assert.equal(again.getParams().versionFilter, 'all');
    assert.equal(again.getParams().areaCeiling, 'all');
    writeFirmsHideNoAcq(false, storage);
    assert.equal(storage.getItem(FIRMS_AREA_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_SENSOR_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_VERSION_STORAGE_KEY), null);
    assert.equal(storage.getItem(FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY), null);
    const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
    assert.doesNotMatch(layerState, /hideNoAcq|firmsHideNoAcq/);
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
  for (const [name, source] of [['firmsCsv.js', csv], ['firmsAdapt.js', adapt]]) {
    assert.doesNotMatch(source, /hideNoAcq|firmsHideNoAcq|Hide no acq/, `${name} must stay off the hide path`);
    assert.doesNotMatch(source, /FIRMS_HIDE_NO_ACQ|fireMeetsHideNoAcq/, `${name} must stay off the hide path`);
  }
  assert.doesNotMatch(list, /from '\.\/firmsHideNoAcqFilter\.js'/, 'firmsList.js must stay off the globe hide path');
  assert.doesNotMatch(list, /meridian\.firmsHideNoAcq'/, 'firmsList.js must stay off the globe hide path');
  assert.doesNotMatch(list, /FIRMS_HIDE_NO_ACQ[^_]/, 'firmsList.js must stay off the globe hide path');
  assert.doesNotMatch(list, /fireMeetsHideNoAcq\(/, 'firmsList.js must stay off the globe hide path');
  const [adaptedDated] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h')]);
  assert.equal(fireHasAcquisitionTime(adaptedDated), true);
  assert.equal(fireMeetsHideNoAcq(adaptedDated, true), true);
  const [adaptedMissing] = adaptFirmsRecords([rawFire(AUSTIN.lat, AUSTIN.lon, 12, 340, 'h', {
    acqDate: '',
    acqTime: '',
  })]);
  assert.equal(adaptedMissing.acqMs, 0);
  assert.equal(fireMeetsHideNoAcq(adaptedMissing, true), false);
  assert.equal(fireMeetsAgeWindow(adaptedMissing, '6', Date.now()), true);
});

test('Hide no acq ANDs with the fail-open age window and existing FIRMS chips', async () => {
  const now = Date.now();
  const datedNadir = {
    id: 'dated-nadir',
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
  const missingAcqNadir = {
    ...datedNadir,
    id: 'missing-acq-nadir',
    index: 1,
    lat: AUSTIN.lat + 1,
    lon: AUSTIN.lon + 1,
    acqMs: 0,
  };
  const datedWide = {
    ...datedNadir,
    id: 'dated-wide',
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
    harness.layer._bindInteractionForTest(harness.viewer, [datedNadir, missingAcqNadir, datedWide, lowNight]);
    assert.equal(harness.layer.getParams().hideNoAcq, false);
    assert.equal(harness.layer.getStats().count, 4, 'off keeps missing + dated acquisition');

    harness.layer.setParams({ ageWindow: '6' });
    assert.equal(harness.layer.getStats().count, 4, '6h still fails open on acqMs 0');
    assert.equal(harness.layer.setParams({ hideNoAcq: true }), true);
    assert.equal(harness.layer.getStats().count, 3, 'on drops the missing-acq nadir that the age window kept');
    assert.equal(harness.fetchCount, 1, 'hide chip must not refetch NASA FIRMS');
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ areaCeiling: '1' });
    assert.equal(harness.layer.getStats().count, 2, 'hide AND <1 km² drops the 2×2 C2 row and the missing-acq nadir');
    harness.layer.setParams({ hideNoDaynight: true });
    harness.layer.setParams({ hideNoSatellite: true });
    harness.layer.setParams({ hideNoSensor: true });
    harness.layer.setParams({ hideNoVersion: true });
    harness.layer.setParams({ hideNoConfidence: true });
    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 1, 'AND FRP 50+ keeps the dated 140 MW nadir');
    harness.layer.setParams({ brightnessFloor: '320' });
    harness.layer.setParams({ brightnessTi5Floor: '290' });
    harness.layer.setParams({ scanCeiling: '0.5' });
    harness.layer.setParams({ trackCeiling: '0.5' });
    harness.layer.setParams({ versionFilter: '2.0NRT' });
    harness.layer.setParams({ showNight: false });
    harness.layer.setParams({ confidenceFloor: '0.8' });
    harness.layer.setParams({ sensors: 'V' });
    harness.layer.setParams({ satelliteFilter: 'AQUA' });
    assert.equal(harness.layer.getParams().hideNoAcq, true, 'sibling chips must not overwrite hide');
    assert.equal(harness.layer.getParams().hideNoConfidence, true, '253 hide-no-confidence stays on');
    assert.equal(harness.layer.getParams().hideNoVersion, true, '245 hide-no-version stays on');
    assert.equal(harness.layer.getParams().hideNoSensor, true, '241 hide-no-sensor stays on');
    assert.equal(harness.layer.getParams().hideNoSatellite, true, '238 hide-no-satellite stays on');
    assert.equal(harness.layer.getParams().hideNoDaynight, true, '233 hide-no-daynight stays on');
    assert.equal(harness.layer.getParams().ageWindow, '6', 'age window stays 6h');
    assert.equal(harness.layer.getParams().confidenceFloor, '0.8', 'globe confidence floor stays 0.8+');
    assert.equal(harness.layer.getParams().sensors, 'V', 'VIIRS-only stays on');
    assert.equal(harness.layer.getParams().satelliteFilter, 'AQUA', 'Aqua stays disabled');
    assert.equal(harness.layer.getParams().versionFilter, '2.0NRT', '217 version identity stays 2.0NRT');
    assert.equal(harness.layer.getParams().areaCeiling, '1');
    assert.equal(harness.layer.getStats().count, 1);
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1);

    harness.layer.setParams({ hideNoAcq: false });
    assert.equal(harness.layer.getStats().count, 2, 'off restores the missing-acq nadir under the fail-open age window');
    assert.equal(fireMeetsAreaCeiling({ scanKm: 0.4, trackKm: 0.4 }, '1'), true);
    assert.equal(fireMeetsAgeWindow({ acqMs: 0 }, '6', now), true);
  } finally {
    harness.cleanup();
  }
});

test('FIRMS row exposes Hide no acq from getRowControls() without a new /api', () => {
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const firstRun = readFileSync(path.join(ROOT, 'src/firstRunExperience.js'), 'utf8');
  const list = readFileSync(path.join(ROOT, 'src/data/firmsList.js'), 'utf8');
  const csv = readFileSync(path.join(ROOT, 'src/data/firmsCsv.js'), 'utf8');
  const adapt = readFileSync(path.join(ROOT, 'src/data/firmsAdapt.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'src/../index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'src/../style.css'), 'utf8');
  assert.match(heatmap, /firmsHideNoAcqChipModel/);
  assert.match(heatmap, /readFirmsHideNoAcq|writeFirmsHideNoAcq/);
  assert.match(heatmap, /filterFiresByHideNoAcq/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/acq\/hide/);
  assert.doesNotMatch(layerState, /hideNoAcq|firmsHideNoAcq/);
  assert.doesNotMatch(firstRun, /writeFirmsHideNoAcq\(/);
  assert.doesNotMatch(list, /from '\.\/firmsHideNoAcqFilter\.js'|meridian\.firmsHideNoAcq'|FIRMS_HIDE_NO_ACQ[^_]|fireMeetsHideNoAcq\(/);
  assert.doesNotMatch(csv, /hideNoAcq|firmsHideNoAcq/);
  assert.doesNotMatch(adapt, /hideNoAcq|firmsHideNoAcq/);
  assert.doesNotMatch(html, /hide-no-acq|firmsHideNoAcq/);
  assert.doesNotMatch(ui, /hideNoAcq|firmsHideNoAcq|Hide no acq/);
  assert.doesNotMatch(css, /hide-no-acq|firmsHideNoAcq|Hide no acq/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/acq.js')), false);

  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const chips = layer.getRowControls().chips;
  const hide = chips.find((chip) => chip.id === FIRMS_HIDE_NO_ACQ_CHIP_ID);
  const hideConfidence = chips.find((chip) => chip.id === 'hide-no-confidence');
  const hideVersion = chips.find((chip) => chip.id === 'hide-no-version');
  const hideSensor = chips.find((chip) => chip.id === 'hide-no-sensor');
  const hideSatellite = chips.find((chip) => chip.id === 'hide-no-satellite');
  const hideDaynight = chips.find((chip) => chip.id === 'hide-no-daynight');
  const ageChips = chips.filter((chip) => chip.params.ageWindow);
  assert.ok(hide, 'Hide no acq must come from getRowControls()');
  assert.ok(hideConfidence, '253 Hide no confidence stays on the row');
  assert.ok(hideVersion, '245 Hide no version stays on the row');
  assert.ok(hideSensor, '241 Hide no sensor stays on the row');
  assert.ok(hideSatellite, '238 Hide no satellite stays on the row');
  assert.ok(hideDaynight, '233 Hide no day/night stays on the row');
  assert.deepEqual(ageChips.map((chip) => chip.label), ['6h', '12h', '24h']);
  assert.equal(hide.label, 'Hide no acq');
  assert.equal(hide.active, false);
  assert.deepEqual(hide.params, { hideNoAcq: true });
  const hideIndex = chips.findIndex((chip) => chip.id === FIRMS_HIDE_NO_ACQ_CHIP_ID);
  const confidenceIndex = chips.findIndex((chip) => chip.id === 'hide-no-confidence');
  assert.ok(hideIndex === confidenceIndex + 1, 'Hide no acq sits after Hide no confidence');
  layer.setParams({ hideNoAcq: true });
  assert.equal(
    layer.getRowControls().chips.find((chip) => chip.id === FIRMS_HIDE_NO_ACQ_CHIP_ID).active,
    true,
  );
  layer.setParams({ hideNoConfidence: true });
  layer.setParams({ hideNoVersion: true });
  layer.setParams({ hideNoSensor: true });
  layer.setParams({ hideNoSatellite: true });
  layer.setParams({ hideNoDaynight: true });
  layer.setParams({ ageWindow: '6' });
  assert.equal(layer.getParams().hideNoAcq, true, '253 hide-no-confidence stays distinct');
  assert.equal(layer.getParams().hideNoConfidence, true);
  assert.equal(layer.getParams().hideNoVersion, true);
  assert.equal(layer.getParams().hideNoSensor, true);
  assert.equal(layer.getParams().hideNoSatellite, true);
  assert.equal(layer.getParams().hideNoDaynight, true);
  assert.equal(layer.getParams().ageWindow, '6', 'age window stays distinct');
});
