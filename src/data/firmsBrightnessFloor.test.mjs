// PLAN 155 — FIRMS brightness floor. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_BRIGHTNESS_FLOOR,
  FIRMS_BRIGHTNESS_FLOOR_CHIPS,
  filterFiresByBrightnessFloor,
  fireMeetsBrightnessFloor,
  normalizeBrightnessFloor,
} from './firmsBrightnessFloor.js';
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
  rawFire(AUSTIN.lat, AUSTIN.lon, 80, 300),
  rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 81, 325),
  rawFire(TOKYO.lat, TOKYO.lon, 82, 345),
  rawFire(TOKYO.lat + 3, TOKYO.lon + 3, 83, 360),
];

const AND_FIRES = [
  rawFire(AUSTIN.lat, AUSTIN.lon, 4.2, 360, 'h'),
  rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 62, 360, 'l'),
  rawFire(TOKYO.lat, TOKYO.lon, 62, 310, 'n'),
  rawFire(TOKYO.lat + 3, TOKYO.lon + 3, 140, 360, 'h'),
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
    daynight: 'D',
    ...recentAcqFields(),
    instrument: 'VIIRS',
    satellite: 'N20',
    ...overrides,
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

test('normalizeBrightnessFloor: All / 320 / 340 only; anything else is All', () => {
  assert.equal(DEFAULT_FIRMS_BRIGHTNESS_FLOOR, 'all');
  assert.equal(normalizeBrightnessFloor('all'), 'all');
  assert.equal(normalizeBrightnessFloor(0), 'all');
  assert.equal(normalizeBrightnessFloor(320), '320');
  assert.equal(normalizeBrightnessFloor('320'), '320');
  assert.equal(normalizeBrightnessFloor(340), '340');
  assert.equal(normalizeBrightnessFloor('340'), '340');
  assert.equal(normalizeBrightnessFloor('330'), 'all');
  assert.equal(normalizeBrightnessFloor(undefined), 'all');
  assert.equal(normalizeBrightnessFloor(null), 'all');
  assert.deepEqual(FIRMS_BRIGHTNESS_FLOOR_CHIPS.map((chip) => chip.id), ['all', '320', '340']);
  assert.deepEqual(FIRMS_BRIGHTNESS_FLOOR_CHIPS.map((chip) => chip.label), ['All', '320+', '340+']);
});

test('filterFiresByBrightnessFloor: All keeps every detection; 320+ and 340+ hide cooler pixels', () => {
  const fires = [
    { brightness: 300, frp: 10 },
    { brightness: 325, frp: 20 },
    { brightness: 345, frp: 30 },
  ];
  assert.equal(filterFiresByBrightnessFloor(fires, 'all').length, 3);
  assert.deepEqual(filterFiresByBrightnessFloor(fires, '320').map((fire) => fire.brightness), [325, 345]);
  assert.deepEqual(filterFiresByBrightnessFloor(fires, '340').map((fire) => fire.brightness), [345]);
});

test('missing and non-finite brightness stay visible at every floor', () => {
  const missing = { frp: 40 };
  const nulled = { brightness: null, frp: 43 };
  const zero = { brightness: 0, frp: 44 };
  const nan = { brightness: Number.NaN, frp: 41 };
  const inf = { brightness: Number.POSITIVE_INFINITY, frp: 42 };
  assert.equal(fireMeetsBrightnessFloor(missing, '320'), true);
  assert.equal(fireMeetsBrightnessFloor(nulled, '340'), true);
  assert.equal(fireMeetsBrightnessFloor(zero, '340'), true);
  assert.equal(fireMeetsBrightnessFloor(missing, '340'), true);
  assert.equal(fireMeetsBrightnessFloor(nan, '340'), true);
  assert.equal(fireMeetsBrightnessFloor(inf, '340'), true);
  assert.deepEqual(
    filterFiresByBrightnessFloor([missing, nan, nulled, zero, { brightness: 300, frp: 1 }], '320')
      .map((fire) => fire.frp),
    [40, 41, 43, 44],
  );
});

test('adapted missing brightness stays visible because the adapter stores 0', () => {
  const [fire] = adaptFirmsRecords([
    rawFire(AUSTIN.lat, AUSTIN.lon, 70, 340, 'h', { brightness: undefined }),
  ]);
  assert.equal(fire.brightness, 0);
  assert.equal(fireMeetsBrightnessFloor(fire, '320'), true);
  assert.equal(fireMeetsBrightnessFloor(fire, '340'), true);
});

test('All is the default and matches the unfiltered heatmap', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.getParams().brightnessFloor, 'all');
    assert.equal(harness.layer.getParams().frpFloor, 'all');
    assert.equal(harness.layer.getStats().count, 4);
    assert.equal(harness.detectionCount(), 4);
  } finally {
    harness.cleanup();
  }
});

test('320+ and 340+ drop cooler detections and shrink cells', async () => {
  const detections = createHarness(MIXED_FIRES);
  try {
    detections.layer.init(detections.viewer);
    await detections.layer.enable(detections.viewer);
    assert.equal(detections.detectionCount(), 4);

    assert.equal(detections.layer.setParams({ brightnessFloor: '320' }), true);
    assert.equal(detections.detectionCount(), 3, '320+ hides the 300 K detection');
    assert.equal(detections.layer.getStats().count, 3);
    assert.equal(detections.layer.getNearbyFires({ origin: AUSTIN }).length, 3);
    assert.equal(detections.layer.getFireListView({ camera: AUSTIN }).rows.length, 3);

    assert.equal(detections.layer.setParams({ brightnessFloor: '340' }), true);
    assert.equal(detections.detectionCount(), 2, '340+ keeps only 345 K and 360 K');
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

    cells.layer.setParams({ brightnessFloor: '320' });
    const cells320 = cells.layer.getStats().cells;
    assert.ok(cells320 < allCells, `320+ must shrink cells (${cells320} vs ${allCells})`);
    assert.equal(cells320, 3);

    cells.layer.setParams({ brightnessFloor: '340' });
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

    harness.layer.setParams({ brightnessFloor: '320' });
    harness.layer.setParams({ brightnessFloor: '340' });
    harness.layer.setParams({ brightnessFloor: 'all' });
    assert.equal(harness.fetchCount, 1, 'floor chips must not refetch NASA FIRMS');
    assert.equal(harness.detectionCount(), 4);
  } finally {
    harness.cleanup();
  }
});

test('FRP 50+ still ANDs with the brightness floor', async () => {
  const harness = createHarness(AND_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.detectionCount(), 4);

    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 3, 'FRP 50+ keeps 62/62/140');

    harness.layer.setParams({ brightnessFloor: '320' });
    assert.equal(harness.layer.getStats().count, 2, '50+ AND 320+ drops the 310 K 62 MW');
    const and320 = harness.layer.getAnalystRecords();
    assert.ok(and320.every((row) => row.frp >= 50));
    assert.deepEqual(and320.map((row) => row.frp).sort((a, b) => a - b), [62, 140]);

    harness.layer.setParams({ confidenceFloor: '0.5' });
    assert.equal(harness.layer.getStats().count, 1, '50+ AND 320+ AND 0.5+ keeps only 140 MW');
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1, 'AND chip changes still do not refetch');
  } finally {
    harness.cleanup();
  }
});

test('in-memory missing brightness stays listed after a 340+ chip', async () => {
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
        brightness: Number.NaN,
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
        brightness: 300,
        night: false,
        acqMs: Date.now(),
        sensor: 'VIIRS',
        satellite: 'N20',
      },
    ];
    harness.layer._bindInteractionForTest(harness.viewer, fires);
    harness.layer.setParams({ brightnessFloor: '340' });
    const records = harness.layer.getAnalystRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0].frp, 70);
    assert.equal(harness.layer.getNearbyFires({ origin: AUSTIN }).length, 1);
  } finally {
    harness.cleanup();
  }
});

test('refresh keeps the brightness floor and still does not invent a FIRMS endpoint', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    harness.layer.setParams({ brightnessFloor: '320' });
    assert.equal(harness.layer.getParams().brightnessFloor, '320');
    assert.equal(harness.layer.getStats().count, 3);
    await harness.layer.update();
    assert.equal(harness.fetchCount, 2, 'scheduled refresh may refetch the same /api/firms payload');
    assert.match(harness.lastUrl, /\/api\/firms$/);
    assert.equal(harness.layer.getParams().brightnessFloor, '320');
    assert.equal(harness.layer.getStats().count, 3);
    assert.doesNotMatch(harness.lastUrl, /brightness/);
  } finally {
    harness.cleanup();
  }
});

test('row chips are All | 320+ | 340+ next to FRP and write brightnessFloor params', () => {
  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const controls = layer.getRowControls();
  const bright = controls.chips.filter((chip) => chip.params.brightnessFloor);
  const frp = controls.chips.filter((chip) => chip.params.frpFloor);
  assert.deepEqual(bright.map((chip) => chip.label), ['All', '320+', '340+']);
  assert.deepEqual(bright.map((chip) => chip.params.brightnessFloor), ['all', '320', '340']);
  assert.deepEqual(frp.map((chip) => chip.params.frpFloor), ['all', '10', '50', '100']);
  assert.equal(bright[0].active, true);
  assert.equal(bright.every((chip) => chip.group === 'Bright'), true);
  layer.setParams({ brightnessFloor: '320' });
  const after = layer.getRowControls().chips.filter((chip) => chip.params.brightnessFloor);
  assert.equal(after.find((chip) => chip.params.brightnessFloor === '320').active, true);
  assert.equal(after.filter((chip) => chip.active).length, 1);
});

test('FIRMS panel exposes All | 320+ | 340+ chips and hides them when Fires is off', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const panel = html.match(/<div id="fires-panel"[\s\S]*?<p id="fires-list-ack"/);
  assert.ok(panel, 'fires-panel markup is missing');
  assert.match(panel[0], /id="fires-brightness-chips"/);
  assert.match(panel[0], /data-firms-brightness="all"[^>]*>All</);
  assert.match(panel[0], /data-firms-brightness="320"[^>]*>320\+</);
  assert.match(panel[0], /data-firms-brightness="340"[^>]*>340\+</);
  assert.ok(
    panel[0].indexOf('id="fires-brightness-chips"') < panel[0].indexOf('id="fires-list-meta"'),
    'brightness chips sit on the FIRES panel above the list meta',
  );
  assert.match(ui, /data-firms-brightness/);
  assert.match(ui, /brightnessFloor/);
  assert.match(ui, /isEnabled\?\.\('local-firms'\)/);
  assert.match(heatmap, /FIRMS_BRIGHTNESS_FLOOR_CHIPS|firmsBrightnessChipModels/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/brightness/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/brightness.js')), false);
});
