// PLAN 127 — FIRMS confidence floor. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  createFirmsHeatmapLayer,
  filterFiresByConfidenceFloor,
  fireMeetsConfidenceFloor,
  normalizeConfidenceFloor,
} from './firmsHeatmap.js';
import { unregisterSpriteCollection } from './spriteOrder.js';

const AUSTIN = { lon: -97.7, lat: 30.2 };
const TOKYO = { lon: 139.7, lat: 35.7 };
const DETECTION_HEIGHT_M = 1_500_000;
const CELL_HEIGHT_M = 10_000_000;

const MIXED_FIRES = [
  rawFire(AUSTIN.lat, AUSTIN.lon, 80, 'l'),
  rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 81, 'n'),
  rawFire(TOKYO.lat, TOKYO.lon, 82, 'h'),
  rawFire(TOKYO.lat + 3, TOKYO.lon + 3, 83, 'h'),
];

const AND_FIRES = [
  rawFire(AUSTIN.lat, AUSTIN.lon, 4.2, 'h'),
  rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 62, 'l'),
  rawFire(TOKYO.lat, TOKYO.lon, 62, 'n'),
  rawFire(TOKYO.lat + 3, TOKYO.lon + 3, 140, 'h'),
];

function rawFire(lat, lon, frp, confidence = 'h') {
  return {
    lat,
    lon,
    frp,
    confidence,
    brightness: 340,
    daynight: 'D',
    acqDate: '2026-08-03',
    acqTime: '0412',
    instrument: 'VIIRS',
    satellite: 'N20',
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

test('normalizeConfidenceFloor: All / 0.5 / 0.8 only; anything else is All', () => {
  assert.equal(normalizeConfidenceFloor('all'), 'all');
  assert.equal(normalizeConfidenceFloor(0), 'all');
  assert.equal(normalizeConfidenceFloor(0.5), '0.5');
  assert.equal(normalizeConfidenceFloor('0.5'), '0.5');
  assert.equal(normalizeConfidenceFloor(0.8), '0.8');
  assert.equal(normalizeConfidenceFloor('0.8'), '0.8');
  assert.equal(normalizeConfidenceFloor('0.6'), 'all');
  assert.equal(normalizeConfidenceFloor(undefined), 'all');
  assert.equal(normalizeConfidenceFloor(null), 'all');
});

test('filterFiresByConfidenceFloor: All keeps every detection; 0.5+ and 0.8+ drop low confidence', () => {
  const fires = [
    { confidence: 0.3, frp: 10 },
    { confidence: 0.6, frp: 20 },
    { confidence: 0.9, frp: 30 },
  ];
  assert.equal(filterFiresByConfidenceFloor(fires, 'all').length, 3);
  assert.deepEqual(filterFiresByConfidenceFloor(fires, '0.5').map((fire) => fire.confidence), [0.6, 0.9]);
  assert.deepEqual(filterFiresByConfidenceFloor(fires, '0.8').map((fire) => fire.confidence), [0.9]);
});

test('missing and non-finite confidence stay visible at every floor', () => {
  const missing = { frp: 40 };
  const nulled = { confidence: null, frp: 43 };
  const nan = { confidence: Number.NaN, frp: 41 };
  const inf = { confidence: Number.POSITIVE_INFINITY, frp: 42 };
  assert.equal(fireMeetsConfidenceFloor(missing, '0.5'), true);
  assert.equal(fireMeetsConfidenceFloor(nulled, '0.8'), true);
  assert.equal(fireMeetsConfidenceFloor(missing, '0.8'), true);
  assert.equal(fireMeetsConfidenceFloor(nan, '0.8'), true);
  assert.equal(fireMeetsConfidenceFloor(inf, '0.8'), true);
  assert.deepEqual(
    filterFiresByConfidenceFloor([missing, nan, nulled, { confidence: 0.2, frp: 1 }], '0.5')
      .map((fire) => fire.frp),
    [40, 41, 43],
  );
});

test('All is the default and matches the unfiltered heatmap', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.getParams().confidenceFloor, 'all');
    assert.equal(harness.layer.getParams().frpFloor, 'all');
    assert.equal(harness.layer.getStats().count, 4);
    assert.equal(harness.detectionCount(), 4);
    const confs = harness.layer.getAnalystRecords().map((row) => row.confidence).sort((a, b) => a - b);
    assert.deepEqual(confs, [0.3, 0.6, 0.9, 0.9]);
  } finally {
    harness.cleanup();
  }
});

test('0.5+ and 0.8+ drop low-confidence detections and shrink cells', async () => {
  const detections = createHarness(MIXED_FIRES);
  try {
    detections.layer.init(detections.viewer);
    await detections.layer.enable(detections.viewer);
    assert.equal(detections.detectionCount(), 4);

    assert.equal(detections.layer.setParams({ confidenceFloor: '0.5' }), true);
    assert.equal(detections.detectionCount(), 3, '0.5+ drops categorical low (0.3)');
    assert.equal(detections.layer.getStats().count, 3);
    assert.ok(
      detections.layer.getAnalystRecords().every((row) => row.confidence >= 0.5),
      'analyst records only include detections at or above the floor',
    );
    const listed50 = detections.layer.getNearbyFires({ origin: AUSTIN });
    assert.equal(listed50.length, 3);
    assert.ok(
      listed50.every((row) => row.confidence >= 0.5),
      'Plan 70 list only includes detections at or above the floor',
    );
    const view50 = detections.layer.getFireListView({ camera: AUSTIN });
    assert.equal(view50.status, 'ready');
    assert.equal(view50.rows.length, 3);
    assert.ok(view50.rows.every((row) => !/low/.test(row.detail)));

    assert.equal(detections.layer.setParams({ confidenceFloor: '0.8' }), true);
    assert.equal(detections.detectionCount(), 2, '0.8+ keeps only high (0.9)');
    assert.equal(detections.layer.getStats().count, 2);
    assert.ok(detections.layer.getAnalystRecords().every((row) => row.confidence >= 0.8));
    assert.equal(detections.layer.getNearbyFires({ origin: AUSTIN }).length, 2);
    assert.equal(detections.layer.getFireListView({ camera: AUSTIN }).rows.length, 2);
    assert.ok(detections.latestEntries().every((entry) => !/low/.test((entry.details || []).join(' '))));
  } finally {
    detections.cleanup();
  }

  const cells = createHarness(MIXED_FIRES, { height: CELL_HEIGHT_M });
  try {
    cells.layer.init(cells.viewer);
    await cells.layer.enable(cells.viewer);
    const allCells = cells.layer.getStats().cells;
    assert.ok(allCells >= 4, `All should keep one cell per detection, got ${allCells}`);

    cells.layer.setParams({ confidenceFloor: '0.5' });
    const cells50 = cells.layer.getStats().cells;
    assert.ok(cells50 < allCells, `0.5+ must shrink cells (${cells50} vs ${allCells})`);
    assert.equal(cells50, 3);

    cells.layer.setParams({ confidenceFloor: '0.8' });
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

    harness.layer.setParams({ confidenceFloor: '0.5' });
    harness.layer.setParams({ confidenceFloor: '0.8' });
    harness.layer.setParams({ confidenceFloor: 'all' });
    assert.equal(harness.fetchCount, 1, 'floor chips must not refetch NASA FIRMS');
    assert.equal(harness.detectionCount(), 4);
  } finally {
    harness.cleanup();
  }
});

test('FRP 50+ still ANDs with the confidence floor', async () => {
  const harness = createHarness(AND_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.detectionCount(), 4);

    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 3, 'FRP 50+ keeps 62/62/140');
    assert.ok(harness.layer.getAnalystRecords().every((row) => row.frp >= 50));

    harness.layer.setParams({ confidenceFloor: '0.5' });
    assert.equal(harness.layer.getStats().count, 2, '50+ AND 0.5+ drops low-confidence 62 MW');
    const and50 = harness.layer.getAnalystRecords();
    assert.ok(and50.every((row) => row.frp >= 50 && row.confidence >= 0.5));
    assert.deepEqual(and50.map((row) => row.frp).sort((a, b) => a - b), [62, 140]);
    const listed = harness.layer.getNearbyFires({ origin: AUSTIN });
    assert.equal(listed.length, 2);
    assert.ok(
      listed.every((row) => row.frp >= 50 && row.confidence >= 0.5),
      'Plan 70 list only includes detections at or above both floors',
    );
    assert.equal(harness.layer.getFireListView({ camera: AUSTIN }).rows.length, 2);

    harness.layer.setParams({ confidenceFloor: '0.8' });
    assert.equal(harness.layer.getStats().count, 1);
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.equal(harness.fetchCount, 1, 'AND chip changes still do not refetch');
  } finally {
    harness.cleanup();
  }
});

test('in-memory missing confidence stays listed after a 0.8+ chip', async () => {
  const harness = createHarness([]);
  try {
    harness.layer.init(harness.viewer);
    const fires = [
      {
        index: 0,
        lat: AUSTIN.lat,
        lon: AUSTIN.lon,
        frp: 70,
        confidence: Number.NaN,
        brightness: 340,
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
        confidence: 0.2,
        brightness: 340,
        night: false,
        acqMs: Date.now(),
        sensor: 'VIIRS',
        satellite: 'N20',
      },
    ];
    harness.layer._bindInteractionForTest(harness.viewer, fires);
    harness.layer.setParams({ confidenceFloor: '0.8' });
    const records = harness.layer.getAnalystRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0].frp, 70);
    assert.equal(records[0].confidence, null);
    assert.equal(harness.layer.getNearbyFires({ origin: AUSTIN }).length, 1);
  } finally {
    harness.cleanup();
  }
});

test('row chips are All | 0.5+ | 0.8+ next to FRP and write confidenceFloor params', () => {
  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const controls = layer.getRowControls();
  const conf = controls.chips.filter((chip) => chip.params.confidenceFloor);
  const frp = controls.chips.filter((chip) => chip.params.frpFloor);
  assert.deepEqual(conf.map((chip) => chip.label), ['All', '0.5+', '0.8+']);
  assert.deepEqual(conf.map((chip) => chip.params.confidenceFloor), ['all', '0.5', '0.8']);
  assert.deepEqual(frp.map((chip) => chip.params.frpFloor), ['all', '10', '50', '100']);
  assert.equal(conf[0].active, true);
  assert.equal(conf.every((chip) => chip.group === 'Conf'), true);
  assert.equal(frp.every((chip) => chip.group === 'FRP'), true);
  layer.setParams({ confidenceFloor: '0.5' });
  const after = layer.getRowControls().chips.filter((chip) => chip.params.confidenceFloor);
  assert.equal(after.find((chip) => chip.params.confidenceFloor === '0.5').active, true);
  assert.equal(after.filter((chip) => chip.active).length, 1);
});
