/**
 * Client-only exclusive All | <6 h | <1 h chips for the hosted Quakes list.
 *
 * Filters already-fetched USGS list rows (`record.timeMs`) inside
 * `selectEarthquakeListRows` after the Plan 208 magnitude floor and Plan
 * 216 depth ceiling, and before the 50-row cap. Distinct from the globe
 * 1h / 6h / 24h time-window chips (locked on earthquakes.js). Persistence
 * is local only (`meridian.quakeListAge`). No share-URL write, no extra
 * fetch, no new /api.
 */

export const EARTHQUAKE_LIST_AGE_STORAGE_KEY = 'meridian.quakeListAge';
export const EARTHQUAKE_LIST_AGE_CHIP_IDS = Object.freeze(['all', '6', '1']);
export const EARTHQUAKE_LIST_AGE_CHIP_LABELS = Object.freeze({
  all: 'All',
  6: '<6 h',
  1: '<1 h',
});
export const EARTHQUAKE_LIST_AGE_CHIP_TITLES = Object.freeze({
  all: 'Show every listed earthquake regardless of age',
  6: 'Hide listed earthquakes 6 hours old and older',
  1: 'Hide listed earthquakes 1 hour old and older',
});
export const DEFAULT_EARTHQUAKE_LIST_AGE_FILTER = 'all';
export const EARTHQUAKE_LIST_AGE_HOUR_MS = 60 * 60 * 1000;

/** @typedef {'all'|'6'|'1'} EarthquakeListAgeChipId */

let sessionFilter = DEFAULT_EARTHQUAKE_LIST_AGE_FILTER;
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
 * Canonical exclusive chip. Invalid input becomes the All default.
 * @param {unknown} value
 * @returns {EarthquakeListAgeChipId}
 */
export function normalizeEarthquakeListAgeFilter(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (text === '6' || text === '<6' || text === '<6h' || text === '6h') return '6';
  if (text === '1' || text === '<1' || text === '<1h' || text === '1h') return '1';
  if (text === 'all' || text === '0' || text === '') return DEFAULT_EARTHQUAKE_LIST_AGE_FILTER;
  return DEFAULT_EARTHQUAKE_LIST_AGE_FILTER;
}

/**
 * Age ceiling in milliseconds for a chip. All has no ceiling.
 * @param {unknown} ceilingId
 * @returns {number|null}
 */
export function earthquakeListAgeCeilingMs(ceilingId) {
  switch (normalizeEarthquakeListAgeFilter(ceilingId)) {
    case 'all':
      return null;
    case '6':
      return 6 * EARTHQUAKE_LIST_AGE_HOUR_MS;
    case '1':
      return 1 * EARTHQUAKE_LIST_AGE_HOUR_MS;
    default: {
      const unexpected = /** @type {never} */ (normalizeEarthquakeListAgeFilter(ceilingId));
      throw new Error(`unexpected quake list age ceiling: ${unexpected}`);
    }
  }
}

/**
 * Keep a list row when the chip is All, timeMs is missing / non-finite
 * (fail open), the row is the selected event, or age is strictly below
 * the ceiling.
 * @param {{id?: unknown, timeMs?: unknown, time?: unknown}|null|undefined} record
 * @param {unknown} ceilingId
 * @param {{selectedId?: string|null, now?: number}} [options]
 * @returns {boolean}
 */
export function earthquakeListRowMatchesAgeCeiling(record, ceilingId, {
  selectedId = null,
  now = Date.now(),
} = {}) {
  const ceilingMs = earthquakeListAgeCeilingMs(ceilingId);
  if (ceilingMs == null) return true;
  const keepId = selectedId == null || selectedId === '' ? null : String(selectedId);
  if (keepId && String(record?.id) === keepId) return true;
  const raw = record?.timeMs ?? record?.time;
  if (raw == null || raw === '') return true;
  const timeMs = Number(raw);
  if (!Number.isFinite(timeMs)) return true;
  const clock = Number(now);
  const nowMs = Number.isFinite(clock) ? clock : Date.now();
  return (nowMs - timeMs) < ceilingMs;
}

/**
 * @param {Array<{id?: unknown, timeMs?: unknown, time?: unknown}>|null|undefined} records
 * @param {unknown} [ceilingId]
 * @param {{selectedId?: string|null, now?: number}} [options]
 * @returns {Array}
 */
export function filterEarthquakeListRowsByAge(records, ceilingId, {
  selectedId = null,
  now = Date.now(),
} = {}) {
  const list = Array.isArray(records) ? records : [];
  if (earthquakeListAgeCeilingMs(ceilingId) == null) return list.slice();
  return list.filter((record) => (
    earthquakeListRowMatchesAgeCeiling(record, ceilingId, { selectedId, now })
  ));
}

/**
 * Exclusive-chip models for the hosted Quakes list row.
 * @param {unknown} [current]
 * @returns {Array<object>}
 */
export function earthquakeListAgeChipModels(current = DEFAULT_EARTHQUAKE_LIST_AGE_FILTER) {
  const ceiling = normalizeEarthquakeListAgeFilter(current);
  return EARTHQUAKE_LIST_AGE_CHIP_IDS.map((id) => ({
    id,
    label: EARTHQUAKE_LIST_AGE_CHIP_LABELS[id],
    title: EARTHQUAKE_LIST_AGE_CHIP_TITLES[id],
    active: ceiling === id,
  }));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {EarthquakeListAgeChipId}
 */
export function readEarthquakeListAgeFilter(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(EARTHQUAKE_LIST_AGE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_EARTHQUAKE_LIST_AGE_FILTER;
    return normalizeEarthquakeListAgeFilter(raw);
  } catch {
    return DEFAULT_EARTHQUAKE_LIST_AGE_FILTER;
  }
}

/**
 * @param {unknown} ceilingId
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeEarthquakeListAgeFilter(ceilingId, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      EARTHQUAKE_LIST_AGE_STORAGE_KEY,
      normalizeEarthquakeListAgeFilter(ceilingId),
    );
    return true;
  } catch {
    return false;
  }
}

/** @returns {EarthquakeListAgeChipId} */
export function getEarthquakeListAgeFilter() {
  return sessionFilter;
}

/**
 * Exclusive chip set. Clicking All, <6 h, or <1 h replaces the ceiling.
 * @param {unknown} ceilingId
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {EarthquakeListAgeChipId}
 */
export function setEarthquakeListAgeFilter(ceilingId, { persist = true, storage } = {}) {
  const next = normalizeEarthquakeListAgeFilter(ceilingId);
  sessionFilter = next;
  if (persist) writeEarthquakeListAgeFilter(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {EarthquakeListAgeChipId}
 */
export function hydrateEarthquakeListAgeFilter(storage) {
  return setEarthquakeListAgeFilter(readEarthquakeListAgeFilter(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(ceilingId: EarthquakeListAgeChipId) => void} listener
 * @returns {() => void}
 */
export function subscribeEarthquakeListAgeFilter(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore All without clearing subscribers. */
export function resetEarthquakeListAgeFilterForTest() {
  sessionFilter = DEFAULT_EARTHQUAKE_LIST_AGE_FILTER;
}
