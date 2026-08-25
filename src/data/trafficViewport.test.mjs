// src/data/trafficViewport.test.mjs
// Viewport-first paint order + jump-to-city neighbor-ring planner.
//
// Dense downtown tiles can hold roads the camera cannot see. Those extras
// must not paint (or consume MAX_DOTS) before in-view majors. After a
// city jump the layer asks for one Moore ring of adjacent tiles so a
// fast pan hits cache without a second zoom.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clampBoundsAroundCenter } from './trafficBounds.js';
import {
  CITY_JUMP_SHIFT_KM,
  assignFairDotBudgets,
  assignViewportFirstBudgets,
  boundsCacheKey,
  neighborRingBounds,
  orderRoadsViewportFirst,
  partitionRoadsByViewport,
  planNeighborPrefetch,
  pointInViewport,
  roadIntersectsViewport,
  segmentIntersectsViewport,
  shouldPrefetchNeighborRing,
} from './trafficViewport.js';

// Downtown Austin tile — matches trafficBounds.test.mjs / TomTom fixtures.
const AUSTIN = { lat: 30.2672, lon: -97.7431 };
const SF = { lat: 37.7749, lon: -122.4194 };
const VIEWPORT = { south: 30.260, west: -97.750, north: 30.275, east: -97.735 };

function road(id, coords, type = 'primary') {
  return { id, type, coords };
}

const IN_PRIMARY = road('in-primary', [[-97.744, 30.268], [-97.742, 30.269]], 'primary');
const IN_MOTORWAY = road('in-motorway', [[-97.746, 30.262], [-97.740, 30.264]], 'motorway');
const OFF_RESIDENTIAL = road('off-residential', [[-97.800, 30.320], [-97.810, 30.330]], 'residential');
const OFF_MOTORWAY = road('off-motorway', [[-97.820, 30.350], [-97.830, 30.360]], 'motorway');

test('pointInViewport is inclusive on the rectangle edges', () => {
  assert.equal(pointInViewport(-97.750, 30.260, VIEWPORT), true);
  assert.equal(pointInViewport(-97.735, 30.275, VIEWPORT), true);
  assert.equal(pointInViewport(-97.751, 30.268, VIEWPORT), false);
});

test('a segment that crosses a corner without a vertex inside still counts', () => {
  assert.equal(
    segmentIntersectsViewport(-97.760, 30.268, -97.740, 30.280, VIEWPORT),
    true,
  );
  assert.equal(
    segmentIntersectsViewport(-97.900, 30.400, -97.880, 30.410, VIEWPORT),
    false,
  );
});

test('roadIntersectsViewport: vertex inside, crossing, and fully off-view', () => {
  assert.equal(roadIntersectsViewport(IN_PRIMARY.coords, VIEWPORT), true);
  assert.equal(
    roadIntersectsViewport([[-97.760, 30.268], [-97.740, 30.280]], VIEWPORT),
    true,
  );
  assert.equal(roadIntersectsViewport(OFF_RESIDENTIAL.coords, VIEWPORT), false);
  assert.equal(roadIntersectsViewport(IN_PRIMARY.coords, null), false);
});

test('viewport-first ordering puts in-view majors ahead of off-view extras', () => {
  const ordered = orderRoadsViewportFirst(
    [OFF_RESIDENTIAL, IN_PRIMARY, OFF_MOTORWAY, IN_MOTORWAY],
    VIEWPORT,
  );
  assert.deepEqual(ordered.map((r) => r.id), [
    'in-primary',
    'in-motorway',
    'off-residential',
    'off-motorway',
  ]);
});

test('viewport-first ordering is stable inside each group', () => {
  const a = road('in-a', [[-97.744, 30.268], [-97.743, 30.269]]);
  const b = road('in-b', [[-97.742, 30.270], [-97.741, 30.271]]);
  const c = road('off-c', [[-97.80, 30.32], [-97.81, 30.33]]);
  const d = road('off-d', [[-97.82, 30.34], [-97.83, 30.35]]);
  assert.deepEqual(
    orderRoadsViewportFirst([c, a, d, b], VIEWPORT).map((r) => r.id),
    ['in-a', 'in-b', 'off-c', 'off-d'],
  );
});

test('a missing viewport leaves road order unchanged (fair allocator path)', () => {
  const roads = [OFF_RESIDENTIAL, IN_PRIMARY, OFF_MOTORWAY];
  const { inView, offView } = partitionRoadsByViewport(roads, null);
  assert.deepEqual(inView.map((r) => r.id), roads.map((r) => r.id));
  assert.equal(offView.length, 0);
  assert.deepEqual(orderRoadsViewportFirst(roads, null).map((r) => r.id), roads.map((r) => r.id));
});

test('fair MAX_DOTS allocation never exceeds the cap', () => {
  const planned = [400, 300, 200, 100, 50];
  const budgets = assignFairDotBudgets(planned, 80);
  const total = budgets.reduce((sum, n) => sum + n, 0);
  assert.ok(total <= 80, `allocated ${total}`);
  assert.equal(budgets.length, planned.length);
  for (let i = 0; i < planned.length; i++) {
    assert.ok(budgets[i] <= planned[i], `road ${i} over-allocated`);
  }
});

test('fair allocator seeds one dot to every road that wants one before leftover', () => {
  const planned = [20, 1, 1, 1];
  const budgets = assignFairDotBudgets(planned, 4);
  assert.deepEqual(budgets, [1, 1, 1, 1]);
});

test('viewport-first budgets spend the cap on in-view roads before off-view extras', () => {
  const roads = [OFF_RESIDENTIAL, IN_PRIMARY, OFF_MOTORWAY, IN_MOTORWAY];
  const ordered = orderRoadsViewportFirst(roads, VIEWPORT);
  const planned = ordered.map((r) => (r.type === 'motorway' || r.type === 'primary' ? 40 : 10));
  const inViewFlags = ordered.map((r) => r.id.startsWith('in-'));
  const cap = 50;
  const budgets = assignViewportFirstBudgets(planned, inViewFlags, cap);
  const total = budgets.reduce((sum, n) => sum + n, 0);
  assert.ok(total <= cap, `allocated ${total}`);

  let inViewDots = 0;
  let offViewDots = 0;
  for (let i = 0; i < ordered.length; i++) {
    if (inViewFlags[i]) inViewDots += budgets[i];
    else offViewDots += budgets[i];
  }
  assert.ok(inViewDots > 0, 'in-view majors must receive dots');
  assert.equal(inViewDots, cap, 'in-view demand should consume the whole cap');
  assert.equal(offViewDots, 0, 'off-view extras must wait for leftover');
});

test('viewport-first leftover still respects MAX_DOTS when in-view demand is small', () => {
  const planned = [2, 2, 40, 40];
  const inViewFlags = [true, true, false, false];
  const budgets = assignViewportFirstBudgets(planned, inViewFlags, 20);
  const total = budgets.reduce((sum, n) => sum + n, 0);
  assert.ok(total <= 20);
  assert.equal(budgets[0] + budgets[1], 4);
  assert.equal(budgets[2] + budgets[3], 16);
});

test('neighbor ring is eight adjacent tiles of the same span, center omitted', () => {
  const center = clampBoundsAroundCenter(
    { south: 29.5, north: 30.5, west: -98.5, east: -97.5 },
    AUSTIN,
    0.05,
  );
  const ring = neighborRingBounds(center);
  assert.equal(ring.length, 8);
  const centerKey = boundsCacheKey(center);
  const keys = new Set(ring.map((b) => boundsCacheKey(b)));
  assert.equal(keys.size, 8);
  assert.equal(keys.has(centerKey), false);

  const latSpan = center.north - center.south;
  const lonSpan = center.east - center.west;
  for (const tile of ring) {
    assert.ok(Math.abs((tile.north - tile.south) - latSpan) < 1e-12);
    assert.ok(Math.abs((tile.east - tile.west) - lonSpan) < 1e-12);
    const dLat = Math.round((tile.south - center.south) / latSpan);
    const dLon = Math.round((tile.west - center.west) / lonSpan);
    assert.ok(Math.abs(dLat) <= 1 && Math.abs(dLon) <= 1);
    assert.ok(!(dLat === 0 && dLon === 0));
  }
});

test('neighbor ring is requested after a jump-to-city, not after a small pan', () => {
  const downtown = clampBoundsAroundCenter(
    { south: 30.0, north: 30.5, west: -98.0, east: -97.5 },
    AUSTIN,
    0.05,
  );
  const jump = planNeighborPrefetch(AUSTIN, SF, downtown);
  assert.equal(jump.requested.length, 8);
  assert.equal(jump.requested.some((item) => item.key === boundsCacheKey(downtown)), false);
  for (const item of jump.requested) {
    assert.equal(item.key, boundsCacheKey(item.bounds));
  }

  const panCenter = { lat: AUSTIN.lat + 0.003, lon: AUSTIN.lon + 0.003 }; // ~0.45 km
  const pan = planNeighborPrefetch(AUSTIN, panCenter, downtown);
  assert.equal(pan.requested.length, 0);
});

test('first arrival (no previous center) is a jump; invalid next center is not', () => {
  assert.equal(shouldPrefetchNeighborRing(null, AUSTIN), true);
  assert.equal(shouldPrefetchNeighborRing(undefined, AUSTIN), true);
  assert.equal(shouldPrefetchNeighborRing(AUSTIN, { lat: NaN, lon: -97.7 }), false);
  assert.equal(shouldPrefetchNeighborRing(AUSTIN, null), false);
});

test('city-jump threshold sits well above the 0.35 km pan gate', () => {
  const nearby = { lat: AUSTIN.lat + 0.002, lon: AUSTIN.lon }; // ~0.22 km
  assert.equal(shouldPrefetchNeighborRing(AUSTIN, nearby), false);
  assert.ok(CITY_JUMP_SHIFT_KM > 0.35);
  const far = { lat: AUSTIN.lat + 0.04, lon: AUSTIN.lon }; // ~4.4 km
  assert.equal(shouldPrefetchNeighborRing(AUSTIN, far), true);
});
