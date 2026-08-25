/**
 * @module data/trafficJamFilter
 * @description Street Traffic Jams-only chrome. Live TomTom already stamps
 * `road.flow.level`; this reuses `flowBucket()` so free / slow hide and jam
 * stays. Live mode only (sim has no usable `road.flow`). Preference lives
 * in localStorage `meridian.trafficJamsOnly` because traffic is still
 * `enabled-only` (no cheap layer-option slot). Never written into share
 * URLs. Independent of Live | Sim, Uncovered Sim | Hide, and Jam viz.
 * Closures and uncovered-road hide still AND in front of this matcher.
 */

import { flowBucket } from './trafficFlowStyle.js';
import {
  DEFAULT_UNCOVERED_ROADS,
  uncoveredRoadSpawns,
} from './uncoveredRoads.js';

export const TRAFFIC_JAMS_ONLY_STORAGE_KEY = 'meridian.trafficJamsOnly';
export const DEFAULT_TRAFFIC_JAMS_ONLY = false;
export const TRAFFIC_JAMS_ONLY_CHANGE_EVENT = 'meridian:trafficJamsOnly';
export const TRAFFIC_JAMS_ONLY_CHIP_LABEL = 'Jams only';
export const TRAFFIC_JAMS_ONLY_CHIP_TITLE =
  'Hide free-flow and slow roads — show jammed traffic only';

/** @type {boolean|null} */
let cachedJamsOnly = null;

/** Clear the in-memory preference so the next read hits storage (reload / tests). */
export function resetTrafficJamsOnlyCache() {
  cachedJamsOnly = null;
}

/**
 * Canonical on/off. Invalid input returns null so setParams can refuse.
 * Empty / missing keeps the shipped default (off).
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeTrafficJamsOnly(value) {
  if (value == null || value === '') return DEFAULT_TRAFFIC_JAMS_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {boolean}
 */
export function readTrafficJamsOnly(storage) {
  try {
    const raw = storage?.getItem?.(TRAFFIC_JAMS_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_TRAFFIC_JAMS_ONLY;
    return normalizeTrafficJamsOnly(raw) === true;
  } catch {
    return DEFAULT_TRAFFIC_JAMS_ONLY;
  }
}

/**
 * @param {unknown} jamsOnly
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {boolean}
 */
export function writeTrafficJamsOnly(jamsOnly, storage) {
  const normalized = normalizeTrafficJamsOnly(jamsOnly) === true;
  try {
    storage?.setItem?.(TRAFFIC_JAMS_ONLY_STORAGE_KEY, normalized ? '1' : '0');
  } catch {
    // Fail open: the session can still use the chosen filter.
  }
  return normalized;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function getTrafficJamsOnly(storage = globalThis.localStorage) {
  if (cachedJamsOnly !== null) return cachedJamsOnly;
  cachedJamsOnly = readTrafficJamsOnly(storage);
  return cachedJamsOnly;
}

/**
 * @param {unknown} jamsOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function setTrafficJamsOnly(jamsOnly, storage = globalThis.localStorage) {
  cachedJamsOnly = writeTrafficJamsOnly(jamsOnly, storage);
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent(TRAFFIC_JAMS_ONLY_CHANGE_EVENT, {
      detail: { jamsOnly: cachedJamsOnly },
    }));
  }
  return cachedJamsOnly;
}

/**
 * Live spawn matcher. Sim / keyless always pass (no `road.flow` to classify).
 * Off restores every live road, including free-flow. On keeps only
 * `flowBucket(level) === 'jam'`. Missing / non-finite level is free, so it
 * hides. Closures and uncovered-road hide are applied by the caller (AND).
 * @param {{flow?: {level?: unknown}|null}|null|undefined} road
 * @param {{jamsOnly?: unknown, liveMode?: boolean}} [input]
 * @returns {boolean}
 */
export function roadPassesJamFilter(road, {
  jamsOnly = DEFAULT_TRAFFIC_JAMS_ONLY,
  liveMode = false,
} = {}) {
  if (liveMode !== true) return true;
  if (normalizeTrafficJamsOnly(jamsOnly) !== true) return true;
  return flowBucket(road?.flow?.level) === 'jam';
}

/**
 * Full live spawn gate: closure skip AND uncovered-road hide AND jams-only.
 * Sim / keyless (`liveMode` false) always spawn — the built-in model is
 * unchanged even when the toggle is on.
 * @param {{flow?: {level?: unknown, closure?: boolean}|null}|null|undefined} road
 * @param {{liveMode?: boolean, jamsOnly?: unknown, uncoveredRoads?: unknown}} [input]
 * @returns {boolean}
 */
export function trafficRoadSpawnsDots(road, {
  liveMode = false,
  jamsOnly = DEFAULT_TRAFFIC_JAMS_ONLY,
  uncoveredRoads = DEFAULT_UNCOVERED_ROADS,
} = {}) {
  const flow = liveMode === true ? road?.flow : null;
  if (flow?.closure) return false;
  if (!uncoveredRoadSpawns({
    liveMode,
    hasFlow: Boolean(flow),
    uncoveredRoads,
  })) return false;
  return roadPassesJamFilter(road, { jamsOnly, liveMode });
}

/**
 * DATA LAYERS chip for Street Traffic: Jams only.
 * Hidden in Sim — `road.flow.level` is unreachable without live tiles.
 * Chip params are `{ jamsOnly }` only; Live | Sim, Uncovered, and Jam viz
 * stay independent.
 * @param {{jamsOnly?: unknown, liveMode?: boolean}} [input]
 * @returns {{heading: string, chips: Array<object>}}
 */
export function trafficJamsOnlyControls({
  jamsOnly = DEFAULT_TRAFFIC_JAMS_ONLY,
  liveMode = false,
} = {}) {
  if (!liveMode) return { heading: 'Jams', chips: [] };
  const on = normalizeTrafficJamsOnly(jamsOnly) === true;
  return {
    heading: 'Jams',
    chips: [
      {
        id: 'traffic-jams-only',
        label: TRAFFIC_JAMS_ONLY_CHIP_LABEL,
        title: TRAFFIC_JAMS_ONLY_CHIP_TITLE,
        active: on,
        disabled: false,
        state: on ? 'active' : 'idle',
        group: 'Jams',
        params: { jamsOnly: !on },
      },
    ],
  };
}
