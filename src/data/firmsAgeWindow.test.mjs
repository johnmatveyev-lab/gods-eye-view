// PLAN 141 — FIRMS age window. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  createFirmsHeatmapLayer,
  filterFiresByAgeWindow,
  fireMeetsAgeWindow,
  normalizeAgeWindow,
} from './firmsHeatmap.js';
import { parseAcquisitionMs } from './firmsAdapt.js';
import { unregisterSpriteCollection } from './spriteOrder.js';

const AUSTIN = { lon: -97.7, lat: 30.2 };
const TOKYO = { lon: 139.7, lat: 35.7 };
const DETECTION_HEIGHT_M = 1_500_000;
const CELL_HEIGHT_M = 10_000_000;
const NOW = Date.UTC(2026, 7, 25, 16, 0);

const MIXED_FIRES = [
  rawFire(AUSTIN.lat, AUSTIN.lon, 80, { hoursAgo: 2, daynight: 'N' }),
  rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 81, { hoursAgo: 8, daynight: 'D' }),
  rawFire(TOKYO.lat, TOKYO.lon, 82, { hoursAgo: 20, daynight: 'N' }),
  rawFire(TOKYO.lat + 3, TOKYO.lon + 3, 83, { hoursAgo: 20, daynight: 'D' }),
];

const AND_FIRES = [
  rawFire(AUSTIN.lat, AUSTIN.lon, 4.2, { hoursAgo: 2, daynight: 'N' }),
  rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 62, { hoursAgo: 2, daynight: 'N' }),
  rawFire(TOKYO.lat, TOKYO.lon, 62, { hoursAgo: 2, daynight: 'D' }),
  rawFire(TOKYO.lat + 3, TOKYO.lon + 3, 140, { hoursAgo: 20, daynight: 'N' }),
];

function acqFields(hoursAgo) {
  const ms = NOW - hoursAgo * 3600000;
  const date = new Date(ms);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return { acqDate: `${yyyy}-${mm}-${dd}`, acqTime: `${hh}${min}` };
}

function rawFire(lat, lon, frp, { hoursAgo = 2, daynight = 'D', confidence = 'h' } = {}) {
  return {
    lat,
    lon,
    frp,
    confidence,
    brightness: 340,
    daynight,
    ...acqFields(hoursAgo),
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

function createHarness(rawFires, { height = DETECTION_HEIGHT_M, now = NOW } = {}) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNow = Date.now;
  const originalProject = Cesium.SceneTransforms.worldToWindowCoordinates;
  let fetchCount = 0;
  let lastUrl = '';
  let nextResponse = {
    ok: true,
    status: 200,
    json: async () => ({ fires: rawFires, fetchedAt: now }),
  };

  Date.now = () => now;
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
      Date.now = originalNow;
      globalThis.fetch = originalFetch;
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
    },
  };
}

test('normalizeAgeWindow: 6 / 12 / 24 only; anything else is 24h', () => {
  assert.equal(normalizeAgeWindow('24'), '24');
  assert.equal(normalizeAgeWindow(24), '24');
  assert.equal(normalizeAgeWindow(6), '6');
  assert.equal(normalizeAgeWindow('6'), '6');
  assert.equal(normalizeAgeWindow(12), '12');
  assert.equal(normalizeAgeWindow('12'), '12');
  assert.equal(normalizeAgeWindow('all'), '24');
  assert.equal(normalizeAgeWindow('48'), '24');
  assert.equal(normalizeAgeWindow(undefined), '24');
  assert.equal(normalizeAgeWindow(null), '24');
});

test('filterFiresByAgeWindow: 24h keeps current overlay; 6h and 12h drop older detections', () => {
  const fires = [
    { acqMs: NOW - 2 * 3600000, frp: 10 },
    { acqMs: NOW - 8 * 3600000, frp: 20 },
    { acqMs: NOW - 20 * 3600000, frp: 30 },
  ];
  assert.deepEqual(filterFiresByAgeWindow(fires, '24', NOW).map((fire) => fire.frp), [10, 20, 30]);
  assert.deepEqual(filterFiresByAgeWindow(fires, '12', NOW).map((fire) => fire.frp), [10, 20]);
  assert.deepEqual(filterFiresByAgeWindow(fires, '6', NOW).map((fire) => fire.frp), [10]);
});

test('missing and non-finite acquisition time stay visible at every window', () => {
  const missing = { frp: 40 };
  const zero = { acqMs: 0, frp: 41 };
  const nan = { acqMs: Number.NaN, frp: 42 };
  const inf = { acqMs: Number.POSITIVE_INFINITY, frp: 43 };
  assert.equal(fireMeetsAgeWindow(missing, '6', NOW), true);
  assert.equal(fireMeetsAgeWindow(zero, '6', NOW), true);
  assert.equal(fireMeetsAgeWindow(nan, '12', NOW), true);
  assert.equal(fireMeetsAgeWindow(inf, '24', NOW), true);
  assert.deepEqual(
    filterFiresByAgeWindow([missing, zero, nan, { acqMs: NOW - 20 * 3600000, frp: 1 }], '6', NOW)
      .map((fire) => fire.frp),
    [40, 41, 42],
  );
});

test('24h is the default and matches the current overlay', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.getParams().ageWindow, '24');
    assert.equal(harness.layer.getParams().frpFloor, 'all');
    assert.equal(harness.layer.getStats().count, 4);
    assert.equal(harness.detectionCount(), 4);
    const frps = harness.layer.getAnalystRecords().map((row) => row.frp).sort((a, b) => a - b);
    assert.deepEqual(frps, [80, 81, 82, 83]);
  } finally {
    harness.cleanup();
  }
});

test('6h and 12h drop older detections and keep newer ones', async () => {
  const detections = createHarness(MIXED_FIRES);
  try {
    detections.layer.init(detections.viewer);
    await detections.layer.enable(detections.viewer);
    assert.equal(detections.detectionCount(), 4);

    assert.equal(detections.layer.setParams({ ageWindow: '12' }), true);
    assert.equal(detections.detectionCount(), 2, '12h keeps 2h and 8h');
    assert.equal(detections.layer.getStats().count, 2);
    const listed12 = detections.layer.getNearbyFires({ origin: AUSTIN });
    assert.equal(listed12.length, 2);
    assert.ok(
      listed12.every((row) => row.acqMs >= NOW - 12 * 3600000),
      'Plan 70 list only includes detections that pass the age window',
    );
    assert.equal(detections.layer.getFireListView({ camera: AUSTIN, now: NOW }).rows.length, 2);

    assert.equal(detections.layer.setParams({ ageWindow: '6' }), true);
    assert.equal(detections.detectionCount(), 1, '6h keeps only the 2h detection');
    assert.equal(detections.layer.getStats().count, 1);
    assert.deepEqual(detections.layer.getAnalystRecords().map((row) => row.frp), [80]);
    assert.equal(detections.layer.getNearbyFires({ origin: AUSTIN }).length, 1);
    assert.equal(detections.layer.getFireListView({ camera: AUSTIN, now: NOW }).rows.length, 1);
  } finally {
    detections.cleanup();
  }

  const cells = createHarness(MIXED_FIRES, { height: CELL_HEIGHT_M });
  try {
    cells.layer.init(cells.viewer);
    await cells.layer.enable(cells.viewer);
    const allCells = cells.layer.getStats().cells;
    assert.ok(allCells >= 4, `24h should keep one cell per detection, got ${allCells}`);

    cells.layer.setParams({ ageWindow: '12' });
    const cells12 = cells.layer.getStats().cells;
    assert.ok(cells12 < allCells, `12h must shrink cells (${cells12} vs ${allCells})`);
    assert.equal(cells12, 2);

    cells.layer.setParams({ ageWindow: '6' });
    assert.equal(cells.layer.getStats().cells, 1);
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

    harness.layer.setParams({ ageWindow: '12' });
    harness.layer.setParams({ ageWindow: '6' });
    harness.layer.setParams({ ageWindow: '24' });
    assert.equal(harness.fetchCount, 1, 'age chips must not refetch NASA FIRMS');
    assert.equal(harness.detectionCount(), 4);
  } finally {
    harness.cleanup();
  }
});

test('FRP 50+ and Night still AND with the age window', async () => {
  const harness = createHarness(AND_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.detectionCount(), 4);

    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 3, 'FRP 50+ keeps 62/62/140');
    assert.ok(harness.layer.getAnalystRecords().every((row) => row.frp >= 50));

    harness.layer.setParams({ showDay: false, showNight: true });
    assert.equal(harness.layer.getStats().count, 2, '50+ AND Night drops the daytime 62 MW');
    const night50 = harness.layer.getAnalystRecords();
    assert.ok(night50.every((row) => row.frp >= 50));
    assert.deepEqual(night50.map((row) => row.frp).sort((a, b) => a - b), [62, 140]);

    harness.layer.setParams({ ageWindow: '6' });
    assert.equal(harness.layer.getStats().count, 1, '50+ AND Night AND 6h drops the 20h night 140 MW');
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp), [62]);
    const listed = harness.layer.getNearbyFires({ origin: AUSTIN });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].frp, 62);
    assert.equal(listed[0].night, true);
    assert.ok(
      listed[0].acqMs >= NOW - 6 * 3600000,
      'Plan 70 list only includes detections that pass all floors',
    );
    assert.equal(harness.layer.getFireListView({ camera: AUSTIN, now: NOW }).rows.length, 1);
    assert.equal(harness.fetchCount, 1, 'AND chip changes still do not refetch');
  } finally {
    harness.cleanup();
  }
});

test('in-memory missing acquisition stays listed after a 6h chip', async () => {
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
        night: true,
        acqMs: 0,
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
        night: false,
        acqMs: NOW - 20 * 3600000,
        sensor: 'VIIRS',
        satellite: 'N20',
      },
    ];
    harness.layer._bindInteractionForTest(harness.viewer, fires);
    harness.layer.setParams({ ageWindow: '6' });
    const records = harness.layer.getAnalystRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0].frp, 70);
    assert.equal(records[0].acqTime, null);
    assert.equal(harness.layer.getNearbyFires({ origin: AUSTIN }).length, 1);
  } finally {
    harness.cleanup();
  }
});

test('row chips are 6h | 12h | 24h next to FRP and write ageWindow params', () => {
  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const controls = layer.getRowControls();
  const age = controls.chips.filter((chip) => chip.params.ageWindow);
  const frp = controls.chips.filter((chip) => chip.params.frpFloor);
  assert.deepEqual(age.map((chip) => chip.label), ['6h', '12h', '24h']);
  assert.deepEqual(age.map((chip) => chip.params.ageWindow), ['6', '12', '24']);
  assert.deepEqual(frp.map((chip) => chip.params.frpFloor), ['all', '10', '50', '100']);
  assert.equal(age.find((chip) => chip.params.ageWindow === '24').active, true);
  assert.equal(age.every((chip) => chip.group === 'Age'), true);
  assert.equal(frp.every((chip) => chip.group === 'FRP'), true);
  layer.setParams({ ageWindow: '6' });
  const after = layer.getRowControls().chips.filter((chip) => chip.params.ageWindow);
  assert.equal(after.find((chip) => chip.params.ageWindow === '6').active, true);
  assert.equal(after.filter((chip) => chip.active).length, 1);
});

test('adapter parseAcquisitionMs feeds the same numbers the age window filters', () => {
  const recent = parseAcquisitionMs(...Object.values(acqFields(2)));
  const older = parseAcquisitionMs(...Object.values(acqFields(20)));
  assert.equal(fireMeetsAgeWindow({ acqMs: recent }, '6', NOW), true);
  assert.equal(fireMeetsAgeWindow({ acqMs: older }, '6', NOW), false);
  assert.equal(fireMeetsAgeWindow({ acqMs: older }, '24', NOW), true);
});
