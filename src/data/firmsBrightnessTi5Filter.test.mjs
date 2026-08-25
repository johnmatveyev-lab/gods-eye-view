// PLAN 192 — FIRMS TI5 brightness floor. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_BRIGHTNESS_TI5_FLOOR,
  FIRMS_BRIGHTNESS_TI5_FLOOR_CHIPS,
  FIRMS_BRIGHTNESS_TI5_STORAGE_KEY,
  filterFiresByBrightnessTi5Floor,
  fireMeetsBrightnessTi5Floor,
  firmsBrightnessTi5ChipModels,
  normalizeBrightnessTi5Floor,
  readFirmsBrightnessTi5Floor,
  writeFirmsBrightnessTi5Floor,
} from './firmsBrightnessTi5Filter.js';
import { fireMeetsBrightnessFloor } from './firmsBrightnessFloor.js';
import {
  createFirmsHeatmapLayer,
} from './firmsHeatmap.js';
import { adaptFirmsRecords } from './firmsAdapt.js';
import { unregisterSpriteCollection } from './spriteOrder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUSTIN = { lon: -97.7, lat: 30.2 };
const TOKYO = { lon: 139.7, lat: 35.7 };
const DETECTION_HEIGHT_M = 1_500_000;
const CELL_HEIGHT_M = 10_000_000;

const MIXED_FIRES = [
  rawFire(AUSTIN.lat, AUSTIN.lon, 80, 300, 'h', { brightnessTi5: 270 }),
  rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 81, 325, 'h', { brightnessTi5: 295 }),
  rawFire(TOKYO.lat, TOKYO.lon, 82, 345, 'h', { brightnessTi5: 320 }),
  rawFire(TOKYO.lat + 3, TOKYO.lon + 3, 83, 360, 'h', { brightnessTi5: 330 }),
];

const AND_FIRES = [
  rawFire(AUSTIN.lat, AUSTIN.lon, 4.2, 360, 'h', { brightnessTi5: 330 }),
  rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 62, 360, 'l', { brightnessTi5: 330 }),
  rawFire(TOKYO.lat, TOKYO.lon, 62, 360, 'n', { brightnessTi5: 270 }),
  rawFire(TOKYO.lat + 3, TOKYO.lon + 3, 140, 360, 'h', { brightnessTi5: 330 }),
];

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
    daynight: 'D',
    ...recentAcqFields(),
    instrument: 'VIIRS',
    satellite: 'N20',
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
    billboards: () => primitives[0],
    latestEntries: () => entryCalls[entryCalls.length - 1] || [],
    detectionCount() {
      const bb = primitives[0];
      return bb ? bb.length : 0;
    },
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

test('normalizeBrightnessTi5Floor: All / 290 / 310 only; anything else is All', () => {
  assert.equal(DEFAULT_FIRMS_BRIGHTNESS_TI5_FLOOR, 'all');
  assert.equal(normalizeBrightnessTi5Floor('all'), 'all');
  assert.equal(normalizeBrightnessTi5Floor(0), 'all');
  assert.equal(normalizeBrightnessTi5Floor(290), '290');
  assert.equal(normalizeBrightnessTi5Floor('290'), '290');
  assert.equal(normalizeBrightnessTi5Floor(310), '310');
  assert.equal(normalizeBrightnessTi5Floor('310'), '310');
  assert.equal(normalizeBrightnessTi5Floor('300'), 'all');
  assert.equal(normalizeBrightnessTi5Floor('320'), 'all');
  assert.equal(normalizeBrightnessTi5Floor(undefined), 'all');
  assert.equal(normalizeBrightnessTi5Floor(null), 'all');
  assert.deepEqual(FIRMS_BRIGHTNESS_TI5_FLOOR_CHIPS.map((chip) => chip.id), ['all', '290', '310']);
  assert.deepEqual(FIRMS_BRIGHTNESS_TI5_FLOOR_CHIPS.map((chip) => chip.label), ['All', '290+', '310+']);
});

test('brightnessTi5 320 matches 310+ and stays on All; 270 hides on 290+', () => {
  const hot = { brightnessTi5: 320, frp: 20 };
  const cool = { brightnessTi5: 270, frp: 10 };
  assert.equal(fireMeetsBrightnessTi5Floor(hot, 'all'), true);
  assert.equal(fireMeetsBrightnessTi5Floor(hot, '290'), true);
  assert.equal(fireMeetsBrightnessTi5Floor(hot, '310'), true);
  assert.equal(fireMeetsBrightnessTi5Floor(cool, 'all'), true);
  assert.equal(fireMeetsBrightnessTi5Floor(cool, '290'), false);
  assert.equal(fireMeetsBrightnessTi5Floor(cool, '310'), false);
  const fires = [cool, { brightnessTi5: 295, frp: 15 }, hot];
  assert.equal(filterFiresByBrightnessTi5Floor(fires, 'all').length, 3);
  assert.deepEqual(filterFiresByBrightnessTi5Floor(fires, '290').map((fire) => fire.brightnessTi5), [295, 320]);
  assert.deepEqual(filterFiresByBrightnessTi5Floor(fires, '310').map((fire) => fire.brightnessTi5), [320]);
});

test('missing, non-finite, and non-positive TI5 stay visible at every floor', () => {
  const missing = { frp: 40 };
  const nulled = { brightnessTi5: null, frp: 43 };
  const zero = { brightnessTi5: 0, frp: 44 };
  const nan = { brightnessTi5: Number.NaN, frp: 41 };
  const inf = { brightnessTi5: Number.POSITIVE_INFINITY, frp: 42 };
  assert.equal(fireMeetsBrightnessTi5Floor(missing, '290'), true);
  assert.equal(fireMeetsBrightnessTi5Floor(nulled, '310'), true);
  assert.equal(fireMeetsBrightnessTi5Floor(zero, '310'), true);
  assert.equal(fireMeetsBrightnessTi5Floor(missing, '310'), true);
  assert.equal(fireMeetsBrightnessTi5Floor(nan, '310'), true);
  assert.equal(fireMeetsBrightnessTi5Floor(inf, '310'), true);
  assert.deepEqual(
    filterFiresByBrightnessTi5Floor([missing, nan, nulled, zero, { brightnessTi5: 270, frp: 1 }], '290')
      .map((fire) => fire.frp),
    [40, 41, 43, 44],
  );
});

test('adapted missing brightnessTi5 stays visible because the adapter stores 0', () => {
  const [fire] = adaptFirmsRecords([
    rawFire(AUSTIN.lat, AUSTIN.lon, 70, 340, 'h', { brightnessTi5: undefined }),
  ]);
  assert.equal(fire.brightnessTi5, 0);
  assert.equal(fireMeetsBrightnessTi5Floor(fire, '290'), true);
  assert.equal(fireMeetsBrightnessTi5Floor(fire, '310'), true);
});

test('adapter copies brightnessTi5 onto the heatmap fire record', () => {
  const [fire] = adaptFirmsRecords([
    rawFire(AUSTIN.lat, AUSTIN.lon, 70, 303.6, 'n', { brightnessTi5: 290.73 }),
  ]);
  assert.equal(fire.brightness, 303.6);
  assert.equal(fire.brightnessTi5, 290.73);
  assert.equal(fireMeetsBrightnessTi5Floor(fire, '290'), true);
  assert.equal(fireMeetsBrightnessTi5Floor(fire, '310'), false);
});

test('meridian.firmsBrightnessTi5 persists separately from the TI4 brightness floor', () => {
  const storage = memoryStorage();
  assert.equal(FIRMS_BRIGHTNESS_TI5_STORAGE_KEY, 'meridian.firmsBrightnessTi5');
  assert.equal(readFirmsBrightnessTi5Floor(storage), DEFAULT_FIRMS_BRIGHTNESS_TI5_FLOOR);
  assert.equal(writeFirmsBrightnessTi5Floor('290', storage), '290');
  assert.equal(storage.getItem(FIRMS_BRIGHTNESS_TI5_STORAGE_KEY), '290');
  assert.equal(readFirmsBrightnessTi5Floor(storage), '290');
  assert.equal(writeFirmsBrightnessTi5Floor('310', storage), '310');
  assert.equal(storage.getItem(FIRMS_BRIGHTNESS_TI5_STORAGE_KEY), '310');
  writeFirmsBrightnessTi5Floor('all', storage);
  assert.equal(storage.getItem(FIRMS_BRIGHTNESS_TI5_STORAGE_KEY), 'all');
  assert.equal(storage.snapshot()['meridian.firmsBrightness'], undefined);
  assert.equal(Object.keys(storage.snapshot()).join(','), FIRMS_BRIGHTNESS_TI5_STORAGE_KEY);
});

test('All is the default and matches the unfiltered heatmap', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.getParams().brightnessTi5Floor, 'all');
    assert.equal(harness.layer.getParams().brightnessFloor, 'all');
    assert.equal(harness.layer.getParams().frpFloor, 'all');
    assert.equal(harness.layer.getStats().count, 4);
    assert.equal(harness.detectionCount(), 4);
  } finally {
    harness.cleanup();
  }
});

test('290+ and 310+ drop cooler TI5 detections and shrink cells', async () => {
  const detections = createHarness(MIXED_FIRES);
  try {
    detections.layer.init(detections.viewer);
    await detections.layer.enable(detections.viewer);
    assert.equal(detections.detectionCount(), 4);

    assert.equal(detections.layer.setParams({ brightnessTi5Floor: '290' }), true);
    assert.equal(detections.detectionCount(), 3, '290+ hides the 270 K TI5 detection');
    assert.equal(detections.layer.getStats().count, 3);
    assert.equal(detections.layer.getNearbyFires({ origin: AUSTIN }).length, 3);
    assert.equal(detections.layer.getFireListView({ camera: AUSTIN }).rows.length, 3);

    assert.equal(detections.layer.setParams({ brightnessTi5Floor: '310' }), true);
    assert.equal(detections.detectionCount(), 2, '310+ keeps only 320 K and 330 K TI5');
    assert.equal(detections.layer.getStats().count, 2);
    assert.equal(detections.layer.getNearbyFires({ origin: AUSTIN }).length, 2);
    assert.equal(detections.layer.getFireListView({ camera: AUSTIN }).rows.length, 2);
  } finally {
    detections.cleanup();
  }

  const cells = createHarness(MIXED_FIRES, { height: CELL_HEIGHT_M });
  try {
    cells.layer.init(cells.viewer);
    await cells.layer.enable(cells.viewer);
    const allCells = cells.layer.getStats().cells;
    assert.ok(allCells >= 4, `All should keep one cell per detection, got ${allCells}`);

    cells.layer.setParams({ brightnessTi5Floor: '290' });
    const cells290 = cells.layer.getStats().cells;
    assert.ok(cells290 < allCells, `290+ must shrink cells (${cells290} vs ${allCells})`);
    assert.equal(cells290, 3);

    cells.layer.setParams({ brightnessTi5Floor: '310' });
    assert.equal(cells.layer.getStats().cells, 2);
  } finally {
    cells.cleanup();
  }
});

test('chip change re-filters cached fires without a new /api/firms call', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.fetchCount, 1);
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ brightnessTi5Floor: '290' });
    harness.layer.setParams({ brightnessTi5Floor: '310' });
    harness.layer.setParams({ brightnessTi5Floor: 'all' });
    assert.equal(harness.fetchCount, 1, 'TI5 floor chips must not refetch NASA FIRMS');
    assert.equal(harness.detectionCount(), 4);
  } finally {
    harness.cleanup();
  }
});

test('FRP, confidence, and TI4 brightness still AND with the TI5 floor', async () => {
  const harness = createHarness(AND_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.detectionCount(), 4);

    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 3, 'FRP 50+ keeps 62/62/140');

    harness.layer.setParams({ brightnessTi5Floor: '290' });
    assert.equal(harness.layer.getStats().count, 2, '50+ AND 290+ drops the 270 K TI5 62 MW');
    const and290 = harness.layer.getAnalystRecords();
    assert.ok(and290.every((row) => row.frp >= 50));
    assert.deepEqual(and290.map((row) => row.frp).sort((a, b) => a - b), [62, 140]);

    harness.layer.setParams({ brightnessFloor: '320' });
    assert.equal(harness.layer.getStats().count, 2, 'TI4 320+ still keeps both remaining 360 K TI4 detections');

    harness.layer.setParams({ confidenceFloor: '0.5' });
    assert.equal(harness.layer.getStats().count, 1, '50+ AND TI5 290+ AND TI4 320+ AND 0.5+ keeps only 140 MW');
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1, 'AND chip changes still do not refetch');
  } finally {
    harness.cleanup();
  }
});

test('in-memory missing TI5 stays listed after a 310+ chip', async () => {
  const harness = createHarness([]);
  try {
    harness.layer.init(harness.viewer);
    const fires = [
      {
        index: 0,
        lat: AUSTIN.lat,
        lon: AUSTIN.lon,
        frp: 70,
        confidence: 0.9,
        brightness: 340,
        brightnessTi5: Number.NaN,
        night: false,
        acqMs: Date.now(),
        sensor: 'VIIRS',
        satellite: 'N20',
      },
      {
        index: 1,
        lat: TOKYO.lat,
        lon: TOKYO.lon,
        frp: 71,
        confidence: 0.9,
        brightness: 340,
        brightnessTi5: 270,
        night: false,
        acqMs: Date.now(),
        sensor: 'VIIRS',
        satellite: 'N20',
      },
    ];
    harness.layer._bindInteractionForTest(harness.viewer, fires);
    harness.layer.setParams({ brightnessTi5Floor: '310' });
    const records = harness.layer.getAnalystRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0].frp, 70);
    assert.equal(harness.layer.getNearbyFires({ origin: AUSTIN }).length, 1);
  } finally {
    harness.cleanup();
  }
});

test('refresh keeps the TI5 floor and still does not invent a FIRMS endpoint', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    harness.layer.setParams({ brightnessTi5Floor: '290' });
    assert.equal(harness.layer.getParams().brightnessTi5Floor, '290');
    assert.equal(harness.layer.getStats().count, 3);
    await harness.layer.update();
    assert.equal(harness.fetchCount, 2, 'scheduled refresh may refetch the same /api/firms payload');
    assert.match(harness.lastUrl, /\/api\/firms$/);
    assert.equal(harness.layer.getParams().brightnessTi5Floor, '290');
    assert.equal(harness.layer.getStats().count, 3);
    assert.doesNotMatch(harness.lastUrl, /brightness|ti5/i);
  } finally {
    harness.cleanup();
  }
});

test('row chips are exclusive All | 290+ | 310+ next to TI4 and write brightnessTi5Floor', () => {
  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const controls = layer.getRowControls();
  const ti5 = controls.chips.filter((chip) => chip.params.brightnessTi5Floor);
  const ti4 = controls.chips.filter((chip) => chip.params.brightnessFloor);
  const frp = controls.chips.filter((chip) => chip.params.frpFloor);
  assert.deepEqual(ti5.map((chip) => chip.label), ['All', '290+', '310+']);
  assert.deepEqual(ti5.map((chip) => chip.params.brightnessTi5Floor), ['all', '290', '310']);
  assert.deepEqual(ti4.map((chip) => chip.params.brightnessFloor), ['all', '320', '340']);
  assert.deepEqual(frp.map((chip) => chip.params.frpFloor), ['all', '10', '50', '100']);
  assert.equal(ti5[0].active, true);
  assert.equal(ti5.every((chip) => chip.group === 'TI5'), true);
  layer.setParams({ brightnessTi5Floor: '290' });
  const after = layer.getRowControls().chips.filter((chip) => chip.params.brightnessTi5Floor);
  assert.equal(after.find((chip) => chip.params.brightnessTi5Floor === '290').active, true);
  assert.equal(after.filter((chip) => chip.active).length, 1);
  layer.setParams({ brightnessFloor: '320' });
  assert.equal(layer.getParams().brightnessTi5Floor, '290', 'TI4 chip must not overwrite TI5');
  assert.equal(layer.getParams().brightnessFloor, '320');
  assert.deepEqual(firmsBrightnessTi5ChipModels('310').map((chip) => chip.active), [false, false, true]);
});

test('FIRMS panel exposes All | 290+ | 310+ TI5 chips and hides them when Fires is off', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const adapt = readFileSync(path.join(ROOT, 'src/data/firmsAdapt.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const firstRun = readFileSync(path.join(ROOT, 'src/firstRunExperience.js'), 'utf8');
  const panel = html.match(/<div id="fires-panel"[\s\S]*?<p id="fires-list-ack"/);
  assert.ok(panel, 'fires-panel markup is missing');
  assert.match(panel[0], /id="fires-brightness-ti5-chips"/);
  assert.match(panel[0], /data-firms-brightness-ti5="all"[^>]*>All</);
  assert.match(panel[0], /data-firms-brightness-ti5="290"[^>]*>290\+</);
  assert.match(panel[0], /data-firms-brightness-ti5="310"[^>]*>310\+</);
  assert.ok(
    panel[0].indexOf('id="fires-brightness-chips"') < panel[0].indexOf('id="fires-brightness-ti5-chips"'),
    'TI5 chips sit after the TI4 brightness chips',
  );
  assert.ok(
    panel[0].indexOf('id="fires-brightness-ti5-chips"') < panel[0].indexOf('id="fires-list-meta"'),
    'TI5 chips sit on the FIRES panel above the list meta',
  );
  assert.match(ui, /data-firms-brightness-ti5/);
  assert.match(ui, /brightnessTi5Floor/);
  assert.match(ui, /isEnabled\?\.\('local-firms'\)/);
  assert.match(heatmap, /FIRMS_BRIGHTNESS_TI5_FLOOR_CHIPS|firmsBrightnessTi5ChipModels/);
  assert.match(heatmap, /readFirmsBrightnessTi5Floor|writeFirmsBrightnessTi5Floor/);
  assert.match(adapt, /brightnessTi5:\s*finiteNumber\(record\.brightnessTi5\)/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/brightness|\/api\/firms\/ti5/);
  assert.doesNotMatch(layerState, /brightnessTi5Floor|firmsBrightnessTi5/);
  assert.match(firstRun, /meridian\.firmsBrightnessTi5/);
  assert.doesNotMatch(firstRun, /writeFirmsBrightnessTi5Floor|setFirmsBrightnessTi5Floor/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/brightnessTi5.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/ti5.js')), false);
  assert.ok(fireMeetsBrightnessFloor({ brightness: 300 }, '320') === false);
});
