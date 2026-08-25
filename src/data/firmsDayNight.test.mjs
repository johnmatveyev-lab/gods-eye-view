// PLAN 137 — FIRMS Day | Night chips. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';
import { unregisterSpriteCollection } from './spriteOrder.js';

const AUSTIN = { lon: -97.7, lat: 30.2 };
const TOKYO = { lon: 139.7, lat: 35.7 };
const DETECTION_HEIGHT_M = 1_500_000;

const MIXED_FIRES = [
  rawFire(AUSTIN.lat, AUSTIN.lon, 4.2, 'h', 'D'),
  rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 18, 'n', 'N'),
  rawFire(TOKYO.lat, TOKYO.lon, 62, 'n', 'D'),
  rawFire(TOKYO.lat + 3, TOKYO.lon + 3, 140, 'h', 'N'),
];

const AND_FIRES = [
  rawFire(AUSTIN.lat, AUSTIN.lon, 4.2, 'h', 'D'),
  rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 62, 'l', 'D'),
  rawFire(TOKYO.lat, TOKYO.lon, 62, 'n', 'N'),
  rawFire(TOKYO.lat + 3, TOKYO.lon + 3, 140, 'h', 'D'),
  rawFire(TOKYO.lat + 6, TOKYO.lon + 6, 80, 'h', ''),
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

function rawFire(lat, lon, frp, confidence = 'h', daynight = 'D') {
  return {
    lat,
    lon,
    frp,
    confidence,
    brightness: 340,
    daynight,
    ...recentAcqFields(),
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

test('both Day and Night on is the default and matches the unfiltered overlay', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.getParams().showDay, true);
    assert.equal(harness.layer.getParams().showNight, true);
    assert.equal(harness.layer.getStats().count, 4);
    assert.equal(harness.detectionCount(), 4);
    const frps = harness.layer.getAnalystRecords().map((row) => row.frp).sort((a, b) => a - b);
    assert.deepEqual(frps, [4.2, 18, 62, 140]);
  } finally {
    harness.cleanup();
  }
});

test('Night off hides N detections and keeps day', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.setParams({ showNight: false }), true);
    assert.equal(harness.detectionCount(), 2, 'Night off keeps the two D detections');
    assert.equal(harness.layer.getStats().count, 2);
    const frps = harness.layer.getAnalystRecords().map((row) => row.frp).sort((a, b) => a - b);
    assert.deepEqual(frps, [4.2, 62]);
    const listed = harness.layer.getNearbyFires({ origin: AUSTIN });
    assert.equal(listed.length, 2);
    assert.ok(listed.every((row) => row.night !== true), 'Plan 70 list hides nighttime detections');
    const view = harness.layer.getFireListView({ camera: AUSTIN });
    assert.equal(view.status, 'ready');
    assert.equal(view.rows.length, 2);
  } finally {
    harness.cleanup();
  }
});

test('chip change re-filters cached fires without a new /api/firms call', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.fetchCount, 1);
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ showNight: false });
    harness.layer.setParams({ showDay: false });
    harness.layer.setParams({ showDay: true, showNight: true });
    assert.equal(harness.fetchCount, 1, 'Day | Night chips must not refetch NASA FIRMS');
    assert.equal(harness.detectionCount(), 4);
  } finally {
    harness.cleanup();
  }
});

test('FRP 50+ and confidence 0.5+ still AND with Day | Night', async () => {
  const harness = createHarness(AND_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.detectionCount(), 5);

    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 4, 'FRP 50+ drops 4.2 MW');

    harness.layer.setParams({ confidenceFloor: '0.5' });
    assert.equal(harness.layer.getStats().count, 3, '50+ AND 0.5+ drops low-confidence 62 MW day');
    const andFloors = harness.layer.getAnalystRecords();
    assert.ok(andFloors.every((row) => row.frp >= 50 && row.confidence >= 0.5));

    harness.layer.setParams({ showNight: false });
    const listed = harness.layer.getNearbyFires({ origin: AUSTIN });
    assert.equal(listed.length, 2, 'Night off drops the 62 MW night detection; unknown 80 MW stays');
    assert.ok(
      listed.every((row) => row.frp >= 50 && row.confidence >= 0.5 && row.night !== true),
      'Plan 70 list only includes detections that pass all three',
    );
    assert.deepEqual(listed.map((row) => row.frp).sort((a, b) => a - b), [80, 140]);
    assert.equal(harness.layer.getFireListView({ camera: AUSTIN }).rows.length, 2);
    assert.equal(harness.fetchCount, 1, 'AND chip changes still do not refetch');
  } finally {
    harness.cleanup();
  }
});

test('missing daynight stays visible when Night is off', async () => {
  const harness = createHarness([
    rawFire(AUSTIN.lat, AUSTIN.lon, 70, 'h', ''),
    rawFire(TOKYO.lat, TOKYO.lon, 71, 'h', 'N'),
  ]);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    harness.layer.setParams({ showNight: false });
    const records = harness.layer.getAnalystRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0].frp, 70);
    assert.equal(harness.layer.getNearbyFires({ origin: AUSTIN }).length, 1);
  } finally {
    harness.cleanup();
  }
});

test('row chips are Day | Night next to FRP and confidence and write toggle params', () => {
  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const controls = layer.getRowControls();
  const dayNight = controls.chips.filter((chip) => chip.id.startsWith('daynight-'));
  const frp = controls.chips.filter((chip) => chip.params.frpFloor);
  const conf = controls.chips.filter((chip) => chip.params.confidenceFloor);
  assert.deepEqual(dayNight.map((chip) => chip.label), ['Day', 'Night']);
  assert.equal(dayNight.every((chip) => chip.active), true);
  assert.equal(dayNight.every((chip) => chip.group === 'Day/Night'), true);
  assert.deepEqual(frp.map((chip) => chip.params.frpFloor), ['all', '10', '50', '100']);
  assert.deepEqual(conf.map((chip) => chip.params.confidenceFloor), ['all', '0.5', '0.8']);
  assert.equal(frp.every((chip) => chip.group === 'FRP'), true);
  assert.equal(conf.every((chip) => chip.group === 'Conf'), true);

  layer.setParams({ showNight: false });
  const after = layer.getRowControls().chips.filter((chip) => chip.id.startsWith('daynight-'));
  assert.equal(after.find((chip) => chip.label === 'Day').active, true);
  assert.equal(after.find((chip) => chip.label === 'Night').active, false);
  assert.deepEqual(after.find((chip) => chip.label === 'Night').params, { showNight: true });
});
