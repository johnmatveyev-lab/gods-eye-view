/**
 * @module launchProbabilityFilter
 * @description Client-side All | 50+ | 80+ chips for the existing Space
 * Missions roster and globe markers. Filters already-normalized `probability`
 * (Launch Library 2 `probability`, finite 0–100 or null) on the in-memory
 * 30-day roster. Persistence is local only (`meridian.launchProbability`).
 * No /api and no new LL2 query.
 */

export const LAUNCH_PROBABILITY_STORAGE_KEY = 'meridian.launchProbability';
export const LAUNCH_PROBABILITY_CHIP_IDS = Object.freeze(['all', '50', '80']);
export const LAUNCH_PROBABILITY_CHIP_LABELS = Object.freeze({
  all: 'All',
  50: '50+',
  80: '80+',
});
export const DEFAULT_LAUNCH_PROBABILITY_FILTER = 'all';

/** @typedef {'all'|'50'|'80'} LaunchProbabilityChipId */

let sessionFilter = DEFAULT_LAUNCH_PROBABILITY_FILTER;
const listeners = new Set();

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * LL2 2.3.0 ships `probability` as an integer 0–100, null, or historically
 * -1 for unknown. Keep only a finite 0–100 value; everything else is null.
 * @param {object|null|undefined} launch Raw LL2 row or normalized launch.
 * @returns {number|null}
 */
export function launchProbabilityFromPayload(launch) {
  if (!launch || typeof launch !== 'object') return null;
  const raw = launch.probability;
  if (raw == null || raw === '') return null;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

/**
 * Canonical exclusive chip. Invalid input becomes the all default.
 * @param {unknown} value
 * @returns {LaunchProbabilityChipId}
 */
export function normalizeLaunchProbabilityFilter(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === '50' || text === '50+') return '50';
  if (text === '80' || text === '80+') return '80';
  if (text === 'all' || text === '0' || text === '') return DEFAULT_LAUNCH_PROBABILITY_FILTER;
  return DEFAULT_LAUNCH_PROBABILITY_FILTER;
}

/**
 * Numeric floor for a chip. All has no floor.
 * @param {unknown} floorId
 * @returns {number|null}
 */
export function launchProbabilityFloor(floorId) {
  switch (normalizeLaunchProbabilityFilter(floorId)) {
    case 'all':
      return null;
    case '50':
      return 50;
    case '80':
      return 80;
    default: {
      const unexpected = /** @type {never} */ (normalizeLaunchProbabilityFilter(floorId));
      throw new Error(`unexpected launch probability floor: ${unexpected}`);
    }
  }
}

/**
 * Keep a launch when the chip is All, or when `probability` is missing /
 * non-finite, or when the finite value is at or above the floor.
 * Selected mission stays even when its probability is below the floor.
 * @param {{id?: string, probability?: unknown}|null|undefined} launch
 * @param {unknown} floorId
 * @param {string|null} [selectedLaunchId]
 * @returns {boolean}
 */
export function launchPassesProbabilityFilter(launch, floorId, selectedLaunchId = null) {
  if (selectedLaunchId && launch?.id === selectedLaunchId) return true;
  const floor = launchProbabilityFloor(floorId);
  if (floor == null) return true;
  const probability = launchProbabilityFromPayload(launch);
  if (probability == null) return true;
  return probability >= floor;
}

/**
 * @param {Array<{id?: string, probability?: unknown}>|null|undefined} launches
 * @param {unknown} floorId
 * @param {string|null} [selectedLaunchId]
 * @returns {Array}
 */
export function filterLaunchesByProbability(launches, floorId, selectedLaunchId = null) {
  const list = Array.isArray(launches) ? launches : [];
  if (launchProbabilityFloor(floorId) == null) return list.slice();
  return list.filter((launch) => launchPassesProbabilityFilter(launch, floorId, selectedLaunchId));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {LaunchProbabilityChipId}
 */
export function readLaunchProbabilityFilter(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(LAUNCH_PROBABILITY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_PROBABILITY_FILTER;
    return normalizeLaunchProbabilityFilter(raw);
  } catch {
    return DEFAULT_LAUNCH_PROBABILITY_FILTER;
  }
}

/**
 * @param {unknown} floorId
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchProbabilityFilter(floorId, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      LAUNCH_PROBABILITY_STORAGE_KEY,
      normalizeLaunchProbabilityFilter(floorId),
    );
    return true;
  } catch {
    return false;
  }
}

/** @returns {LaunchProbabilityChipId} */
export function getLaunchProbabilityFilter() {
  return sessionFilter;
}

/**
 * Exclusive chip set. Clicking All, 50+, or 80+ replaces the current floor.
 * @param {unknown} floorId
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {LaunchProbabilityChipId}
 */
export function setLaunchProbabilityFilter(floorId, { persist = true, storage } = {}) {
  const next = normalizeLaunchProbabilityFilter(floorId);
  sessionFilter = next;
  if (persist) writeLaunchProbabilityFilter(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {LaunchProbabilityChipId}
 */
export function hydrateLaunchProbabilityFilter(storage) {
  return setLaunchProbabilityFilter(readLaunchProbabilityFilter(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(floorId: LaunchProbabilityChipId) => void} listener
 * @returns {() => void}
 */
export function subscribeLaunchProbabilityFilter(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore All without clearing subscribers. */
export function resetLaunchProbabilityFilterForTest() {
  sessionFilter = DEFAULT_LAUNCH_PROBABILITY_FILTER;
}
