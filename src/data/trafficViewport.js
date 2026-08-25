/**
 * @file Pure viewport-first ordering, neighbor-tile planning, and fair
 * MAX_DOTS allocation for the street-traffic layer.
 *
 * Cesium-free so node:test can pin paint order and jump-to-city prefetch
 * without a viewer. The layer still fetches through the existing Overpass
 * wrapper (`traffic.js` `fetchRoads`) and does not add an API route.
 *
 * @module data/trafficViewport
 */

import { greatCircleKm } from './trafficBounds.js';

/**
 * Km — treat a camera-center move at or above this distance as a city jump
 * (or equivalent teleport). Local pans stay under the existing
 * MIN_CENTER_SHIFT_KM gate (0.35 km) and must not start a neighbor ring.
 */
export const CITY_JUMP_SHIFT_KM = 2.5;

/** First-order Moore neighborhood (8 adjacent tiles; the center is omitted). */
const RING_OFFSETS = Object.freeze([
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
]);

/**
 * Stable cache key used by the traffic tile map.
 * Must stay byte-identical to the `toFixed(4)` key in `traffic.js`.
 *
 * @param {{south:number, west:number, north:number, east:number}} bounds
 * @returns {string}
 */
export function boundsCacheKey(bounds) {
  return `${bounds.south.toFixed(4)},${bounds.west.toFixed(4)},${bounds.north.toFixed(4)},${bounds.east.toFixed(4)}`;
}

/**
 * True when a lon/lat point sits inside the inclusive viewport rectangle.
 *
 * @param {number} lon
 * @param {number} lat
 * @param {{south:number, west:number, north:number, east:number}} bounds
 * @returns {boolean}
 */
export function pointInViewport(lon, lat, bounds) {
  return lat >= bounds.south && lat <= bounds.north
    && lon >= bounds.west && lon <= bounds.east;
}

/**
 * Liang-Barsky segment vs axis-aligned lon/lat box. Traffic tiles are 0.05°
 * so this does not wrap the antimeridian.
 *
 * @param {number} lon1
 * @param {number} lat1
 * @param {number} lon2
 * @param {number} lat2
 * @param {{south:number, west:number, north:number, east:number}} bounds
 * @returns {boolean}
 */
export function segmentIntersectsViewport(lon1, lat1, lon2, lat2, bounds) {
  let t0 = 0;
  let t1 = 1;
  const dx = lon2 - lon1;
  const dy = lat2 - lat1;
  const clips = [
    [-dx, lon1 - bounds.west],
    [dx, bounds.east - lon1],
    [-dy, lat1 - bounds.south],
    [dy, bounds.north - lat1],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

/**
 * True when any vertex or segment of an OSM polyline meets the viewport.
 *
 * @param {number[][]} coords - `[lon, lat]` vertices.
 * @param {{south:number, west:number, north:number, east:number}|null|undefined} viewport
 * @returns {boolean}
 */
export function roadIntersectsViewport(coords, viewport) {
  if (!viewport || !coords?.length) return false;
  for (let i = 0; i < coords.length; i++) {
    const [lon, lat] = coords[i];
    if (pointInViewport(lon, lat, viewport)) return true;
    if (i > 0) {
      const prev = coords[i - 1];
      if (segmentIntersectsViewport(prev[0], prev[1], lon, lat, viewport)) return true;
    }
  }
  return false;
}

/**
 * Split roads into currently visible vs off-center extras. Relative order
 * inside each group is preserved (stable). A missing viewport treats every
 * road as in-view so the existing fair allocator stays unchanged.
 *
 * @param {Array<{coords?:number[][]}>} roads
 * @param {{south:number, west:number, north:number, east:number}|null|undefined} viewport
 * @returns {{inView:Array, offView:Array}}
 */
export function partitionRoadsByViewport(roads, viewport) {
  const inView = [];
  const offView = [];
  if (!roads?.length) return { inView, offView };
  if (!viewport) {
    for (const road of roads) inView.push(road);
    return { inView, offView };
  }
  for (const road of roads) {
    if (roadIntersectsViewport(road.coords, viewport)) inView.push(road);
    else offView.push(road);
  }
  return { inView, offView };
}

/**
 * Viewport-first paint order: in-view roads, then off-center extras.
 *
 * @param {Array<{coords?:number[][]}>} roads
 * @param {{south:number, west:number, north:number, east:number}|null|undefined} viewport
 * @returns {Array}
 */
export function orderRoadsViewportFirst(roads, viewport) {
  const { inView, offView } = partitionRoadsByViewport(roads, viewport);
  return inView.concat(offView);
}

/**
 * Fair per-road allocation of a hard dot cap (verbatim from the previous
 * `allocateRoadDotBudgets` body): seed one dot to every road that wants one,
 * then proportional remainder, then largest-remainder leftovers.
 *
 * @param {number[]} planned - Ideal counts, one per road.
 * @param {number} dotCap - Maximum total dots.
 * @returns {number[]} Budgets, same length as `planned`. Sum is ≤ `dotCap`.
 */
export function assignFairDotBudgets(planned, dotCap) {
  const budgets = new Array(planned.length).fill(0);
  let remaining = Math.max(0, dotCap);

  const firstPassOrder = planned
    .map((count, index) => ({ count, index }))
    .sort((a, b) => b.count - a.count);

  for (const entry of firstPassOrder) {
    if (remaining <= 0) break;
    if (entry.count <= 0) continue;
    budgets[entry.index] = 1;
    remaining -= 1;
  }

  if (remaining <= 0) return budgets;

  let totalRemainder = 0;
  for (let i = 0; i < planned.length; i++) {
    totalRemainder += Math.max(0, planned[i] - budgets[i]);
  }
  if (totalRemainder <= 0) return budgets;

  const residuals = [];
  let assigned = 0;
  for (let i = 0; i < planned.length; i++) {
    const cap = Math.max(0, planned[i] - budgets[i]);
    if (cap <= 0) continue;
    const ideal = (cap / totalRemainder) * remaining;
    const add = Math.min(cap, Math.floor(ideal));
    budgets[i] += add;
    assigned += add;
    residuals.push({ index: i, residual: ideal - add });
  }

  let leftover = remaining - assigned;
  if (leftover > 0 && residuals.length > 0) {
    residuals.sort((a, b) => b.residual - a.residual);
    let cursor = 0;
    while (leftover > 0 && residuals.length > 0) {
      const idx = residuals[cursor % residuals.length].index;
      if (budgets[idx] < planned[idx]) {
        budgets[idx] += 1;
        leftover -= 1;
      }
      cursor += 1;
      if (cursor > residuals.length * 3 && leftover > 0) break;
    }
  }

  return budgets;
}

/**
 * Two-phase fair allocation: in-view roads consume `dotCap` first; leftover
 * (if any) is shared fairly among off-center extras. Sum never exceeds cap.
 *
 * @param {number[]} planned - Ideal counts, aligned with `inViewFlags`.
 * @param {boolean[]} inViewFlags - True when that road meets the viewport.
 * @param {number} dotCap
 * @returns {number[]}
 */
export function assignViewportFirstBudgets(planned, inViewFlags, dotCap) {
  const primaryPlanned = [];
  const primaryIndex = [];
  const secondaryPlanned = [];
  const secondaryIndex = [];
  for (let i = 0; i < planned.length; i++) {
    if (inViewFlags[i]) {
      primaryIndex.push(i);
      primaryPlanned.push(planned[i]);
    } else {
      secondaryIndex.push(i);
      secondaryPlanned.push(planned[i]);
    }
  }

  const budgets = new Array(planned.length).fill(0);
  const primaryBudgets = assignFairDotBudgets(primaryPlanned, dotCap);
  let used = 0;
  for (let i = 0; i < primaryBudgets.length; i++) {
    budgets[primaryIndex[i]] = primaryBudgets[i];
    used += primaryBudgets[i];
  }

  const leftover = Math.max(0, dotCap - used);
  if (leftover > 0 && secondaryPlanned.length) {
    const secondaryBudgets = assignFairDotBudgets(secondaryPlanned, leftover);
    for (let i = 0; i < secondaryBudgets.length; i++) {
      budgets[secondaryIndex[i]] = secondaryBudgets[i];
    }
  }
  return budgets;
}

/**
 * Eight adjacent tiles of the same span as the already-clamped center tile.
 * Does not include the center. Empty when the center has a non-positive span.
 *
 * @param {{south:number, west:number, north:number, east:number}} centerBounds
 * @returns {Array<{south:number, west:number, north:number, east:number}>}
 */
export function neighborRingBounds(centerBounds) {
  const latSpan = centerBounds.north - centerBounds.south;
  const lonSpan = centerBounds.east - centerBounds.west;
  if (!(latSpan > 0) || !(lonSpan > 0)) return [];
  return RING_OFFSETS.map(([dLat, dLon]) => ({
    south: centerBounds.south + dLat * latSpan,
    north: centerBounds.north + dLat * latSpan,
    west: centerBounds.west + dLon * lonSpan,
    east: centerBounds.east + dLon * lonSpan,
  }));
}

/**
 * Whether a camera-center move should prefetch the neighbor ring.
 * A missing previous center (high-altitude clear / first enable after a
 * city fly) counts as a jump. Small pans do not.
 *
 * @param {{lat:number, lon:number}|null|undefined} prevCenter
 * @param {{lat:number, lon:number}|null|undefined} nextCenter
 * @param {number} [thresholdKm=CITY_JUMP_SHIFT_KM]
 * @returns {boolean}
 */
export function shouldPrefetchNeighborRing(prevCenter, nextCenter, thresholdKm = CITY_JUMP_SHIFT_KM) {
  if (!nextCenter || !Number.isFinite(nextCenter.lat) || !Number.isFinite(nextCenter.lon)) {
    return false;
  }
  if (!prevCenter || !Number.isFinite(prevCenter.lat) || !Number.isFinite(prevCenter.lon)) {
    return true;
  }
  return greatCircleKm(prevCenter.lat, prevCenter.lon, nextCenter.lat, nextCenter.lon) >= thresholdKm;
}

/**
 * Fixture/planner: the neighbor tiles the layer should request after a jump.
 * A local pan returns an empty `requested` list.
 *
 * @param {{lat:number, lon:number}|null|undefined} prevCenter
 * @param {{lat:number, lon:number}} nextCenter
 * @param {{south:number, west:number, north:number, east:number}} centerBounds
 * @param {number} [thresholdKm]
 * @returns {{requested: Array<{key:string, bounds:object}>}}
 */
export function planNeighborPrefetch(prevCenter, nextCenter, centerBounds, thresholdKm = CITY_JUMP_SHIFT_KM) {
  if (!shouldPrefetchNeighborRing(prevCenter, nextCenter, thresholdKm)) {
    return { requested: [] };
  }
  return {
    requested: neighborRingBounds(centerBounds).map((bounds) => ({
      key: boundsCacheKey(bounds),
      bounds,
    })),
  };
}
