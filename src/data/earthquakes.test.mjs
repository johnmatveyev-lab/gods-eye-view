// src/data/earthquakes.test.mjs
// Focused tests for the pure analyst-record mapper (analyst query engine seam).
// Pure function — no viewer/DOM needed; imported directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  DEFAULT_EARTHQUAKE_MAGNITUDE_FLOOR,
  EARTHQUAKE_MAGNITUDE_FLOORS,
  EARTHQUAKE_OVERLAY_COHORT_LIMIT,
  EARTHQUAKE_OVERLAY_COLLISION_CAPACITY,
  USGS_ALL_DAY_URL,
  createEarthquakeOverlayEntry,
  createEarthquakesLayer,
  filterEarthquakeFeaturesByMagnitudeFloor,
  isSignificantEarthquake,
  mapAnalystRecord,
  selectEarthquakeOverlayCohort,
} from './earthquakes.js';
import { DataLayerManager } from './manager.js';
import {
  getRenderGovernorDiagnostics,
  installRenderGovernor,
  _resetRenderGovernorForTest,
} from '../renderGovernor.js';

const FULL_RAW = {
  id: 'us7000abcd',
  mag: 5.2,
  place: '42 km SW of Anchorage, Alaska',
  time: 1_753_600_000_000,
  depth: 41.7,
  lat: 61.02,
  lon: -150.41,
};

test('earthquake analyst record: full record maps every contract field', () => {
  const r = mapAnalystRecord(FULL_RAW, 3);
  assert.deepEqual(r, {
    id: 'us7000abcd',
    magnitude: 5.2,
    depthKm: 41.7,
    lat: 61.02,
    lon: -150.41,
    timeMs: 1_753_600_000_000,
    place: '42 km SW of Anchorage, Alaska',
  });
});

test('earthquake analyst record: missing USGS id falls back to index-based id', () => {
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: null }, 3).id, 'QUAKE-0003');
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: '  ' }, 41).id, 'QUAKE-0041');
  assert.equal(mapAnalystRecord(undefined).id, 'QUAKE-0000');
});

test('earthquake analyst record: missing fields become null, never NaN/undefined', () => {
  const r = mapAnalystRecord({ id: 'us1', mag: NaN, depth: undefined, place: '' }, 0);
  assert.equal(r.magnitude, null);
  assert.equal(r.depthKm, null);
  assert.equal(r.place, null);
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('earthquake analyst record: output is JSON-safe (no Cesium types)', () => {
  const r = mapAnalystRecord(FULL_RAW, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

test('earthquake overlay copy keeps source-side magnitude formatting and bounded priority', () => {
  const position = Cesium.Cartesian3.fromDegrees(-150.41, 61.02);
  const entry = createEarthquakeOverlayEntry({
    id: 'us7000abcd',
    position,
    magnitude: 5.24,
    accent: '#ff0000',
  });
  assert.equal(entry.title, 'M5.2');
  assert.equal(entry.position, position);
  assert.equal(entry.variant, 'label');
  assert.equal(entry.paintLane, 'ambient-label');
  assert.equal(entry.collisionGroup, 'ambient-label');
  assert.equal(entry.protected, undefined);
  assert.equal(entry.edgeFade, 'keyhole');
  assert.equal(entry.horizonCull, true);

  const entries = Array.from({ length: EARTHQUAKE_OVERLAY_COHORT_LIMIT + 20 }, (_, index) => ({
    id: `quake-${String(index).padStart(3, '0')}`,
    priority: index,
  }));
  const cohort = selectEarthquakeOverlayCohort(entries);
  assert.equal(cohort.length, EARTHQUAKE_OVERLAY_COHORT_LIMIT);
  assert.equal(cohort[0].id, `quake-${EARTHQUAKE_OVERLAY_COHORT_LIMIT + 19}`);
  assert.equal(cohort.at(-1).id, 'quake-020');
});

test('real earthquake lifecycle publishes host labels while runtime entities carry no label graphic', async () => {
  const originalFetch = globalThis.fetch;
  const hostCalls = [];
  const dataSources = [];
  const overlayHost = {
    setEntries: (...args) => hostCalls.push(['entries', ...args]),
    setVisible: (...args) => hostCalls.push(['visible', ...args]),
    clearSource: (...args) => hostCalls.push(['clear', ...args]),
  };
  const viewer = {
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      features: [
        {
          id: 'us-runtime-1',
          geometry: { coordinates: [-150.41, 61.02, 41.7] },
          properties: { mag: 5.24, place: 'Runtime One', time: 1_753_600_000_000 },
        },
        {
          id: 'us-runtime-2',
          geometry: { coordinates: [139.7, 35.6, 310] },
          properties: { mag: 3.01, place: 'Runtime Two', time: 1_753_600_100_000 },
        },
      ],
    }),
  });
  const layer = createEarthquakesLayer({ overlayHost });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);

    const entities = dataSources[0].entities.values;
    assert.equal(entities.length, 2, 'runtime guard requires populated real source entities');
    assert.ok(entities.every((entity) => entity.label === undefined));
    const publication = hostCalls.find(([type]) => type === 'entries');
    assert.ok(publication, 'real update path must publish the overlay source');
    assert.deepEqual(publication[2].map(({ title }) => title), ['M5.2', 'M3.0']);
    assert.deepEqual(publication[3], {
      cohortLimit: EARTHQUAKE_OVERLAY_COHORT_LIMIT,
      collisionCapacity: EARTHQUAKE_OVERLAY_COLLISION_CAPACITY,
      moving: false,
    });

    layer.disable(viewer);
    assert.equal(dataSources[0].show, false);
    assert.deepEqual(hostCalls.slice(-2), [
      ['clear', 'earthquakes'],
      ['visible', 'earthquakes', false],
    ]);
    layer.destroy(viewer);
    assert.equal(dataSources.length, 0);
    assert.deepEqual(hostCalls.slice(-2), [
      ['clear', 'earthquakes'],
      ['visible', 'earthquakes', false],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Perf pin: the 2026-08-20 earthquakes frame-rate cliff ────────────────────
// Every disc is a CLAMP_TO_GROUND ellipse. When its axes were a
// `CallbackProperty`, Cesium re-tessellated all 58 ground primitives on EVERY
// frame: 32.4 ms/frame and 30 fps for 58 contacts, against 1.4 ms/60 fps with
// the layer off. Static axes restored 60 fps. Both halves of the fix are
// pinned — the runtime property shape, and the source-level guards.
test('quake disc axes are STATIC — a per-frame callback re-tessellates ground geometry', async () => {
  const originalFetch = globalThis.fetch;
  const dataSources = [];
  const viewer = {
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove() { return true; },
    },
  };
  const layer = createEarthquakesLayer({
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      features: [{
        id: 'us-static-1',
        geometry: { coordinates: [-122.4, 37.79, 8.2] },
        properties: { mag: 5.5, place: 'Static One', time: 1_753_600_000_000 },
      }],
    }),
  });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);

    const [entity] = dataSources[0].entities.values;
    assert.ok(entity.ellipse, 'the disc is an ellipse graphic');
    for (const axis of ['semiMajorAxis', 'semiMinorAxis']) {
      const property = entity.ellipse[axis];
      assert.equal(
        property instanceof Cesium.CallbackProperty,
        false,
        `${axis} must not be a CallbackProperty — it rebuilds the ground primitive every frame`,
      );
      assert.equal(property.isConstant, true, `${axis} must be a constant property`);
      // Magnitude 5.5 → 2^5.5 * 1000 m, unchanged by the dropped pulse.
      assert.equal(property.getValue(Cesium.JulianDate.now()), Math.pow(2, 5.5) * 1000);
    }
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

// Dropping the continuous-render hold is only safe if new poll data still reaches
// the screen. In idle mode nothing repaints on its own, so the manager's one-shot
// request after each tick is now load-bearing for this layer. Wires the REAL layer
// into the REAL manager with the governor installed, rather than trusting the
// arrangement by inspection.
test('a quake poll still reaches the screen with the render loop idle', async () => {
  const originalFetch = globalThis.fetch;
  const renderRequests = [];
  const dataSources = [];
  const viewer = {
    scene: { requestRenderMode: false, requestRender: () => renderRequests.push(Date.now()) },
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove() { return true; },
    },
  };
  const layer = createEarthquakesLayer({
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      features: [{
        id: 'us-idle-1',
        geometry: { coordinates: [-122.4, 37.79, 8.2] },
        properties: { mag: 4.2, place: 'Idle One', time: 1_753_600_000_000 },
      }],
    }),
  });

  _resetRenderGovernorForTest();
  installRenderGovernor(viewer);
  // Installing the governor enters idle mode, which itself paints one settling
  // frame. Drop that from the baseline or the enable assertion below can pass on
  // the install alone, without the manager ever requesting anything.
  renderRequests.length = 0;
  const manager = new DataLayerManager(viewer);
  // updateInterval -1 keeps the poll loop unarmed; we drive one tick by hand.
  manager.register({ ...layer, updateInterval: -1 });
  try {
    await manager.setEnabled('earthquakes', true, { origin: 'test' });

    // The whole point of the change: enabling quakes must not pin the loop on.
    assert.equal(getRenderGovernorDiagnostics().mode, 'idle', 'quakes must not force continuous render');
    assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
    assert.equal(viewer.scene.requestRenderMode, true, 'the governor really is in idle mode');

    // ...and the poll that populated the discs must still have asked for a frame,
    // because in idle mode nothing repaints on its own.
    assert.ok(dataSources[0].entities.values.length > 0, 'the enable poll produced discs');
    assert.ok(renderRequests.length > 0, 'enabling the layer must request a render in idle mode');
    // Named, not merely counted: the frame has to come from the manager's
    // visibility request, not from some incidental repaint.
    assert.ok(
      getRenderGovernorDiagnostics().recentRequests.some(({ reason }) => reason === 'layer-visibility'),
      'the enable frame must be the manager\'s layer-visibility request',
    );

    // A LATER poll must request its own frame too — the enable-time
    // 'layer-visibility' request cannot cover refreshes that arrive minutes later.
    const beforeRefresh = renderRequests.length;
    await manager._runPeriodicUpdate('earthquakes', manager.layers.get('earthquakes'));
    assert.ok(
      renderRequests.length > beforeRefresh,
      'each refresh tick must request its own render while the loop is idle',
    );
    const reasons = getRenderGovernorDiagnostics().recentRequests.map(({ reason }) => reason);
    assert.ok(
      reasons.includes('layer-tick:earthquakes'),
      `the tick request must be attributed to the layer, got ${JSON.stringify(reasons)}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await manager.setEnabled('earthquakes', false, { origin: 'test' }).catch(() => {});
    _resetRenderGovernorForTest();
  }
});

test('the earthquakes layer installs no per-frame callback and no continuous-render hold', () => {
  const source = readFileSync(new URL('./earthquakes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(
    source,
    /new Cesium\.CallbackProperty/,
    'reverting the discs to a per-frame axis callback must fail this pin',
  );
  assert.doesNotMatch(
    source,
    /holdContinuousRender/,
    'static discs have no per-frame animator, so the layer must not pin the render loop on',
  );
});

test('earthquake refresh reports failure and clears it only after a successful response', async () => {
  const originalFetch = globalThis.fetch;
  const dataSources = [];
  const viewer = {
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove() { return true; },
    },
  };
  const layer = createEarthquakesLayer({
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'USGS HTTP 503');

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ features: [] }),
    });
    assert.equal(await layer.update(viewer), true);
    assert.equal(layer.getStats().error, null);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

// ── Plan 103: operator magnitude floor (client-side, same USGS all_day) ───────

function quakeFeature(id, mag, coords = [-122.4, 37.79, 8.2]) {
  return {
    id,
    geometry: { coordinates: coords },
    properties: { mag, place: String(id), time: 1_753_600_000_000 },
  };
}

const MIXED_DAY = Object.freeze({
  features: Object.freeze([
    quakeFeature('micro', 2.4),
    quakeFeature('floor-25', 2.5),
    quakeFeature('clutter', 3.2),
    quakeFeature('floor-40', 4.0),
    quakeFeature('mid', 4.9),
    quakeFeature('sig-lo', 5.0),
    quakeFeature('sig-mid', 5.4),
    quakeFeature('floor-60', 6.0),
    quakeFeature('great', 6.8),
  ]),
});

function stubUsgs(geojson) {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async (url) => {
    fetches += 1;
    assert.equal(String(url), USGS_ALL_DAY_URL);
    return { ok: true, json: async () => geojson };
  };
  return {
    get fetches() { return fetches; },
    restore() { globalThis.fetch = originalFetch; },
  };
}

function stubUsgsFailure(kind = 'network') {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    if (kind === 'http') return { ok: false, status: 503 };
    throw new Error('USGS network error');
  };
  return {
    get fetches() { return fetches; },
    restore() { globalThis.fetch = originalFetch; },
  };
}

function makeViewer() {
  const dataSources = [];
  return {
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
    _dataSources: dataSources,
  };
}

function makeHost() {
  const hostCalls = [];
  return {
    hostCalls,
    overlayHost: {
      setEntries: (...args) => hostCalls.push(['entries', ...args]),
      setVisible: (...args) => hostCalls.push(['visible', ...args]),
      clearSource: (...args) => hostCalls.push(['clear', ...args]),
    },
  };
}

function entityIds(dataSource) {
  return dataSource.entities.values.map((entity) => String(entity.id).replace(/^earthquake:/, '')).sort();
}

function overlayTitles(hostCalls) {
  const publication = [...hostCalls].reverse().find(([type]) => type === 'entries');
  return publication ? publication[2].map(({ title }) => title) : [];
}

test('2.5+ is the default floor and matches the current M2.5+ view', async () => {
  assert.equal(DEFAULT_EARTHQUAKE_MAGNITUDE_FLOOR, 2.5);
  assert.deepEqual([...EARTHQUAKE_MAGNITUDE_FLOORS], [2.5, 4.0, 5.0, 6.0]);

  const expected = filterEarthquakeFeaturesByMagnitudeFloor(MIXED_DAY.features, 2.5)
    .map((feature) => feature.id);
  assert.deepEqual(expected, ['floor-25', 'clutter', 'floor-40', 'mid', 'sig-lo', 'sig-mid', 'floor-60', 'great']);
  assert.ok(!expected.includes('micro'), 'micro-quakes below 2.5 stay hidden');

  const viewer = makeViewer();
  const { overlayHost, hostCalls } = makeHost();
  const layer = createEarthquakesLayer({ overlayHost });
  const feed = stubUsgs(MIXED_DAY);
  try {
    layer.init(viewer);
    layer.enable(viewer);
    assert.equal(layer.getParams().magnitudeFloor, 2.5);
    assert.equal(await layer.update(viewer), true);
    assert.deepEqual(entityIds(viewer._dataSources[0]), [...expected].sort());
    assert.equal(layer.getStats().count, expected.length);
    assert.ok(overlayTitles(hostCalls).includes('M2.5'));
    assert.ok(!overlayTitles(hostCalls).includes('M2.4'));
  } finally {
    feed.restore();
    layer.destroy(viewer);
  }
});

test('5.0+ shows only the existing isSignificant cohort', async () => {
  const significant = MIXED_DAY.features.filter((feature) => isSignificantEarthquake(feature.properties.mag));
  assert.deepEqual(significant.map((feature) => feature.properties.mag), [5.0, 5.4, 6.0, 6.8]);
  assert.deepEqual(
    filterEarthquakeFeaturesByMagnitudeFloor(MIXED_DAY.features, 5.0).map((feature) => feature.id),
    significant.map((feature) => feature.id),
  );

  const viewer = makeViewer();
  const { overlayHost, hostCalls } = makeHost();
  const layer = createEarthquakesLayer({ overlayHost });
  const feed = stubUsgs(MIXED_DAY);
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);
    assert.equal(layer.setParams({ magnitudeFloor: 5.0 }), true);
    const ids = entityIds(viewer._dataSources[0]);
    assert.deepEqual(ids, ['floor-60', 'great', 'sig-lo', 'sig-mid']);
    assert.equal(ids.length, significant.length);
    assert.ok(overlayTitles(hostCalls).every((title) => {
      const mag = Number(title.slice(1));
      return isSignificantEarthquake(mag);
    }));
    const records = layer.getAnalystRecords();
    assert.ok(records.every((record) => isSignificantEarthquake(record.magnitude)));
  } finally {
    feed.restore();
    layer.destroy(viewer);
  }
});

test('6.0+ is quieter than 5.0+ and 2.5+', async () => {
  const viewer = makeViewer();
  const { overlayHost } = makeHost();
  const layer = createEarthquakesLayer({ overlayHost });
  const feed = stubUsgs(MIXED_DAY);
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);
    const atDefault = layer.getStats().count;
    layer.setParams({ magnitudeFloor: 5.0 });
    const atFive = layer.getStats().count;
    layer.setParams({ magnitudeFloor: 6.0 });
    const atSix = layer.getStats().count;
    assert.deepEqual(entityIds(viewer._dataSources[0]), ['floor-60', 'great']);
    assert.ok(atSix < atFive, `6.0+ (${atSix}) must be quieter than 5.0+ (${atFive})`);
    assert.ok(atFive < atDefault, `5.0+ (${atFive}) must be quieter than 2.5+ (${atDefault})`);
  } finally {
    feed.restore();
    layer.destroy(viewer);
  }
});

test('chip change redraws from cached geojson without a new USGS fetch', async () => {
  const viewer = makeViewer();
  const { overlayHost } = makeHost();
  const layer = createEarthquakesLayer({ overlayHost });
  const feed = stubUsgs(MIXED_DAY);
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);
    assert.equal(feed.fetches, 1);
    assert.equal(layer.setParams({ magnitudeFloor: 4.0 }), true);
    assert.equal(feed.fetches, 1, 'floor chips must not refetch the already-cached all_day feed');
    assert.deepEqual(entityIds(viewer._dataSources[0]), ['floor-40', 'floor-60', 'great', 'mid', 'sig-lo', 'sig-mid']);
    assert.equal(layer.setParams({ magnitudeFloor: 6.0 }), true);
    assert.equal(feed.fetches, 1);
    assert.deepEqual(entityIds(viewer._dataSources[0]), ['floor-60', 'great']);
  } finally {
    feed.restore();
    layer.destroy(viewer);
  }
});

test('Plan 71 list sources only include events at or above the floor', async () => {
  const viewer = makeViewer();
  const { overlayHost, hostCalls } = makeHost();
  const layer = createEarthquakesLayer({ overlayHost });
  const feed = stubUsgs(MIXED_DAY);
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);
    const atDefault = layer.getListRecords();
    assert.ok(atDefault.some((row) => row.magnitude === 3.2), 'default 2.5+ list still includes clutter');
    layer.setParams({ magnitudeFloor: 5.0 });

    const rows = layer.getListRecords();
    assert.deepEqual(rows.map((row) => row.id).sort(), ['floor-60', 'great', 'sig-lo', 'sig-mid']);
    assert.ok(rows.every((row) => row.magnitude >= 5.0), 'Plan 71 list must not include events below the floor');

    const ids = entityIds(viewer._dataSources[0]);
    assert.ok(ids.every((id) => ['sig-lo', 'sig-mid', 'floor-60', 'great'].includes(id)));
    assert.ok(overlayTitles(hostCalls).every((title) => Number(title.slice(1)) >= 5.0));
    assert.ok(layer.getAnalystRecords().every((record) => record.magnitude >= 5.0));
  } finally {
    feed.restore();
    layer.destroy(viewer);
  }
});

test('failed USGS fetch still shows last-good events above the floor', async () => {
  const viewer = makeViewer();
  const { overlayHost } = makeHost();
  const layer = createEarthquakesLayer({ overlayHost });
  const feed = stubUsgs(MIXED_DAY);
  try {
    layer.init(viewer);
    layer.enable(viewer);
    assert.equal(await layer.update(viewer), true);
    layer.setParams({ magnitudeFloor: 5.0 });
    assert.deepEqual(entityIds(viewer._dataSources[0]), ['floor-60', 'great', 'sig-lo', 'sig-mid']);
    feed.restore();
    const fail = stubUsgsFailure('http');
    try {
      assert.equal(await layer.update(viewer), false);
      assert.equal(layer.getStats().error, 'USGS HTTP 503');
      assert.deepEqual(
        entityIds(viewer._dataSources[0]),
        ['floor-60', 'great', 'sig-lo', 'sig-mid'],
        'a failed poll must keep the last-good discs already filtered to the floor',
      );
      assert.equal(layer.setParams({ magnitudeFloor: 6.0 }), true);
      assert.equal(fail.fetches, 1, 'raising the floor after a failed poll must reuse last-good geojson');
      assert.deepEqual(entityIds(viewer._dataSources[0]), ['floor-60', 'great']);
    } finally {
      fail.restore();
    }
  } finally {
    feed.restore();
    layer.destroy(viewer);
  }
});

test('earthquake floor chips stay on the existing USGS all_day feed with no new endpoint', async () => {
  const source = readFileSync(new URL('./earthquakes.js', import.meta.url), 'utf8');
  assert.equal(
    USGS_ALL_DAY_URL,
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
  );
  assert.match(source, /USGS_ALL_DAY_URL|all_day\.geojson/);
  assert.doesNotMatch(source, /\/api\//);
  assert.doesNotMatch(source, /significant_day|4\.5_day|2\.5_day|M1\.0_day/);
  assert.doesNotMatch(source, /news\.google|opensky|telegeography|quantum-earth/i);

  const viewer = makeViewer();
  const { overlayHost } = makeHost();
  const layer = createEarthquakesLayer({ overlayHost });
  try {
    const chips = layer.getRowControls().chips;
    assert.deepEqual(chips.map((chip) => chip.label), ['2.5+', '4.0+', '5.0+', '6.0+']);
    assert.deepEqual(chips.map((chip) => chip.params.magnitudeFloor), [2.5, 4.0, 5.0, 6.0]);
    assert.equal(chips.find((chip) => chip.active)?.label, '2.5+');
    assert.equal(layer.setParams({ magnitudeFloor: 4.0 }), true);
    assert.equal(layer.getRowControls().chips.find((chip) => chip.active)?.label, '4.0+');
    assert.equal(layer.setParams({ magnitudeFloor: 7.0 }), false);
    assert.equal(layer.getParams().magnitudeFloor, 4.0);
  } finally {
    layer.destroy(viewer);
  }
});
