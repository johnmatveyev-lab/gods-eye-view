// PLAN 104 — FIRMS FRP floor. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  createFirmsHeatmapLayer,
  filterFiresByFrpFloor,
  normalizeFrpFloor,
} from './firmsHeatmap.js';
import { adaptFirmsRecords } from './firmsAdapt.js';
import { unregisterSpriteCollection } from './spriteOrder.js';

const AUSTIN = { lon: -97.7, lat: 30.2 };
const TOKYO = { lon: 139.7, lat: 35.7 };
const DETECTION_HEIGHT_M = 1_500_000;
const CELL_HEIGHT_M = 10_000_000;

const MIXED_FIRES = [
  rawFire(AUSTIN.lat, AUSTIN.lon, 4.2),
  rawFire(AUSTIN.lat + 3, AUSTIN.lon + 3, 18),
  rawFire(TOKYO.lat, TOKYO.lon, 62),
  rawFire(TOKYO.lat + 3, TOKYO.lon + 3, 140),
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

function rawFire(lat, lon, frp, overrides = {}) {
  return {
    lat,
    lon,
    frp,
    confidence: 'h',
    brightness: 340,
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
    failNextFetch() {
      nextResponse = {
        ok: false,
        status: 502,
        json: async () => ({ error: 'upstream' }),
      };
    },
    staleNextFetch(fires = rawFires) {
      nextResponse = {
        ok: true,
        status: 200,
        json: async () => ({ fires, fetchedAt: Date.now() - 3_600_000, stale: true }),
      };
    },
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

test('normalizeFrpFloor: All / 10 / 50 / 100 only; anything else is All', () => {
  assert.equal(normalizeFrpFloor('all'), 'all');
  assert.equal(normalizeFrpFloor(0), 'all');
  assert.equal(normalizeFrpFloor(10), '10');
  assert.equal(normalizeFrpFloor('10'), '10');
  assert.equal(normalizeFrpFloor(50), '50');
  assert.equal(normalizeFrpFloor('50'), '50');
  assert.equal(normalizeFrpFloor(100), '100');
  assert.equal(normalizeFrpFloor('100'), '100');
  assert.equal(normalizeFrpFloor('25'), 'all');
  assert.equal(normalizeFrpFloor(undefined), 'all');
  assert.equal(normalizeFrpFloor(null), 'all');
});

test('filterFiresByFrpFloor: All keeps every detection; 50+ and 100+ drop small FRP', () => {
  const fires = MIXED_FIRES.map((fire, index) => ({ ...fire, index }));
  assert.equal(filterFiresByFrpFloor(fires, 'all').length, 4);
  assert.deepEqual(filterFiresByFrpFloor(fires, 'all').map((fire) => fire.frp), [4.2, 18, 62, 140]);
  assert.deepEqual(filterFiresByFrpFloor(fires, '10').map((fire) => fire.frp), [18, 62, 140]);
  assert.deepEqual(filterFiresByFrpFloor(fires, '50').map((fire) => fire.frp), [62, 140]);
  assert.deepEqual(filterFiresByFrpFloor(fires, '100').map((fire) => fire.frp), [140]);
});

test('All is the default and matches the unfiltered heatmap', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.getParams().frpFloor, 'all');
    assert.equal(harness.layer.getParams().sensors, 'all');
    assert.equal(harness.layer.getStats().count, 4);
    assert.equal(harness.detectionCount(), 4);
    const frps = harness.layer.getAnalystRecords().map((row) => row.frp).sort((a, b) => a - b);
    assert.deepEqual(frps, [4.2, 18, 62, 140]);
  } finally {
    harness.cleanup();
  }
});

test('50+ and 100+ drop small detections and shrink cells', async () => {
  const detections = createHarness(MIXED_FIRES);
  try {
    detections.layer.init(detections.viewer);
    await detections.layer.enable(detections.viewer);
    const allDetections = detections.detectionCount();
    assert.equal(allDetections, 4);

    assert.equal(detections.layer.setParams({ frpFloor: '50' }), true);
    assert.equal(detections.detectionCount(), 2, '50+ keeps 62 and 140 MW');
    assert.equal(detections.layer.getStats().count, 2);
    assert.ok(
      detections.layer.getAnalystRecords().every((row) => row.frp >= 50),
      'analyst records only include detections at or above the floor',
    );
    const listed50 = detections.layer.getNearbyFires({ origin: AUSTIN });
    assert.equal(listed50.length, 2);
    assert.ok(listed50.every((row) => row.frp >= 50), 'Plan 70 list only includes detections at or above the floor');
    const view50 = detections.layer.getFireListView({ camera: AUSTIN });
    assert.equal(view50.status, 'ready');
    assert.equal(view50.rows.length, 2);
    assert.ok(view50.rows.every((row) => !/▲ 4\.2 MW|▲ 18 MW/.test(row.title)));

    assert.equal(detections.layer.setParams({ frpFloor: '100' }), true);
    assert.equal(detections.detectionCount(), 1, '100+ keeps only 140 MW');
    assert.equal(detections.layer.getStats().count, 1);
    assert.deepEqual(detections.layer.getAnalystRecords().map((row) => row.frp), [140]);
    assert.deepEqual(detections.layer.getNearbyFires({ origin: AUSTIN }).map((row) => row.frp), [140]);
    assert.equal(detections.layer.getFireListView({ camera: AUSTIN }).rows.length, 1);
  } finally {
    detections.cleanup();
  }

  const cells = createHarness(MIXED_FIRES, { height: CELL_HEIGHT_M });
  try {
    cells.layer.init(cells.viewer);
    await cells.layer.enable(cells.viewer);
    const allCells = cells.layer.getStats().cells;
    assert.ok(allCells >= 4, `All should keep one cell per detection, got ${allCells}`);

    cells.layer.setParams({ frpFloor: '50' });
    const cells50 = cells.layer.getStats().cells;
    assert.ok(cells50 < allCells, `50+ must shrink cells (${cells50} vs ${allCells})`);
    assert.equal(cells50, 2);

    cells.layer.setParams({ frpFloor: '100' });
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

    harness.layer.setParams({ frpFloor: '50' });
    harness.layer.setParams({ frpFloor: '100' });
    harness.layer.setParams({ frpFloor: 'all' });
    assert.equal(harness.fetchCount, 1, 'floor chips must not refetch NASA FIRMS');
    assert.equal(harness.detectionCount(), 4);
  } finally {
    harness.cleanup();
  }
});

test('failed and stale proxy still filter the last-good payload', async () => {
  const harness = createHarness(MIXED_FIRES);
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.getStats().count, 4);

    harness.failNextFetch();
    await harness.layer.update();
    assert.equal(harness.layer.getStats().error, 'live feed unavailable');
    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 2, 'failed refresh keeps last-good and still filters');
    assert.deepEqual(harness.layer.getAnalystRecords().map((row) => row.frp).sort((a, b) => a - b), [62, 140]);

    harness.staleNextFetch();
    await harness.layer.update();
    assert.equal(harness.layer.getStats().stale, true);
    harness.layer.setParams({ frpFloor: '100' });
    assert.equal(harness.layer.getStats().count, 1, 'stale last-good still filters');
    assert.equal(harness.fetchCount, 3, 'chip change after stale load still does not fetch');
  } finally {
    harness.cleanup();
  }
});

test('row chips are All | 10+ | 50+ | 100+ MW and write frpFloor params', () => {
  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const controls = layer.getRowControls();
  const frp = controls.chips.filter((chip) => chip.id.startsWith('frp-'));
  assert.deepEqual(frp.map((chip) => chip.label), ['All', '10+', '50+', '100+ MW']);
  assert.deepEqual(frp.map((chip) => chip.params.frpFloor), ['all', '10', '50', '100']);
  assert.equal(frp[0].active, true);
  layer.setParams({ frpFloor: '50' });
  const after = layer.getRowControls().chips.filter((chip) => chip.id.startsWith('frp-'));
  assert.equal(after.find((chip) => chip.params.frpFloor === '50').active, true);
  assert.equal(after.filter((chip) => chip.active).length, 1);
});

function mixedSensorFires() {
  return [
    rawFire(AUSTIN.lat, AUSTIN.lon, 80, { instrument: 'VIIRS', daynight: 'D' }),
    rawFire(AUSTIN.lat + 1, AUSTIN.lon + 1, 90, { instrument: 'MODIS', daynight: 'N' }),
    rawFire(TOKYO.lat, TOKYO.lon, 70, { instrument: 'AVHRR', daynight: 'N' }),
    rawFire(TOKYO.lat + 1, TOKYO.lon + 1, 12, { instrument: 'VIIRS', daynight: 'N' }),
    rawFire(TOKYO.lat + 2, TOKYO.lon + 2, 65, { instrument: '', daynight: 'N' }),
  ];
}

test('All sensor chips on matches the current overlay; MODIS off keeps VIIRS', async () => {
  const harness = createHarness(mixedSensorFires());
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.getParams().sensors, 'all');
    assert.equal(harness.layer.getStats().count, 5);
    assert.equal(harness.detectionCount(), 5);

    assert.equal(harness.layer.setParams({ sensors: 'VO' }), true);
    assert.equal(harness.detectionCount(), 4, 'MODIS off hides the MODIS detection');
    assert.equal(harness.layer.getStats().count, 4);
    const listed = harness.layer.getNearbyFires({ origin: AUSTIN });
    assert.ok(listed.every((row) => row.sensor !== 'MODIS'), 'Plan 70 list hides MODIS when its chip is off');
    assert.ok(listed.some((row) => row.sensor === 'VIIRS'));
    assert.ok(listed.some((row) => row.sensor === ''), 'blank sensor stays listed');
  } finally {
    harness.cleanup();
  }
});

test('sensor chip change re-filters cached fires without a new /api/firms call', async () => {
  const harness = createHarness(mixedSensorFires());
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.fetchCount, 1);
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ sensors: 'VO' });
    harness.layer.setParams({ sensors: 'V' });
    harness.layer.setParams({ sensors: 'all' });
    assert.equal(harness.fetchCount, 1, 'sensor chips must not refetch NASA FIRMS');
    assert.equal(harness.detectionCount(), 5);
  } finally {
    harness.cleanup();
  }
});

test('FRP 50+ and Night detections still AND with sensor chips', async () => {
  const harness = createHarness(mixedSensorFires());
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.setParams({ frpFloor: '50', sensors: 'VO' }), true);
    assert.equal(harness.fetchCount, 1, 'combined floors still reuse the cached payload');
    assert.equal(harness.layer.getStats().count, 3);
    const rows = harness.layer.getNearbyFires({ origin: AUSTIN });
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.frp >= 50), 'Plan 70 list only includes detections that pass all floors');
    assert.ok(rows.every((row) => row.sensor !== 'MODIS'));
    assert.ok(rows.some((row) => row.night === true), 'night detections that pass FRP + sensor stay');
    assert.ok(rows.some((row) => row.sensor === 'VIIRS'));
    assert.ok(rows.some((row) => row.sensor === ''));
    const adapted = adaptFirmsRecords(mixedSensorFires());
    assert.equal(adapted.filter((fire) => fire.night).length, 4);
  } finally {
    harness.cleanup();
  }
});
