/**
 * Client-only exclusive All | <500 km | <100 km chips for the hosted Quakes list.
 *
 * Filters already-fetched USGS list rows (`record.distanceKm`) inside
 * `selectEarthquakeListRows` after the Plan 208 magnitude floor, Plan
 * 216 depth ceiling, and Plan 228 age ceiling, and before the 50-row
 * cap. Distinct from the globe SID / time / tsunami / felt / type / net
 * / PAGER chips (locked on earthquakes.js). Persistence is local only
 * (`meridian.quakeListRange`). No share-URL write, no extra fetch, no
 * new /api.
 */

export const EARTHQUAKE_LIST_RANGE_STORAGE_KEY = 'meridian.quakeListRange';
export const EARTHQUAKE_LIST_RANGE_CHIP_IDS = Object.freeze(['all', '500', '100']);
export const EARTHQUAKE_LIST_RANGE_CHIP_LABELS = Object.freeze({
  all: 'All',
  500: '<500 km',
  100: '<100 km',
});
export const EARTHQUAKE_LIST_RANGE_CHIP_TITLES = Object.freeze({
  all: 'Show every listed earthquake regardless of range',
  500: 'Hide listed earthquakes 500 km away and farther',
  100: 'Hide listed earthquakes 100 km away and farther',
});
export const DEFAULT_EARTHQUAKE_LIST_RANGE_FILTER = 'all';

/** @typedef {'all'|'500'|'100'} EarthquakeListRangeChipId */

let sessionFilter = DEFAULT_EARTHQUAKE_LIST_RANGE_FILTER;
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
 * @returns {EarthquakeListRangeChipId}
 */
export function normalizeEarthquakeListRangeFilter(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (text === '500' || text === '<500' || text === '<500km' || text === '500km') return '500';
  if (text === '100' || text === '<100' || text === '<100km' || text === '100km') return '100';
  if (text === 'all' || text === '0' || text === '') return DEFAULT_EARTHQUAKE_LIST_RANGE_FILTER;
  return DEFAULT_EARTHQUAKE_LIST_RANGE_FILTER;
}

/**
 * Range ceiling in kilometres for a chip. All has no ceiling.
 * @param {unknown} ceilingId
 * @returns {number|null}
 */
export function earthquakeListRangeCeilingKm(ceilingId) {
  switch (normalizeEarthquakeListRangeFilter(ceilingId)) {
    case 'all':
      return null;
    case '500':
      return 500;
    case '100':
      return 100;
    default: {
      const unexpected = /** @type {never} */ (normalizeEarthquakeListRangeFilter(ceilingId));
      throw new Error(`unexpected quake list range ceiling: ${unexpected}`);
    }
  }
}

/**
 * Keep a list row when the chip is All, origin is missing, distance is
 * missing / non-finite (fail open), the row is the selected event, or
 * distance is strictly below the ceiling.
 * @param {{id?: unknown, distanceKm?: unknown, distance?: unknown}|null|undefined} record
 * @param {unknown} ceilingId
 * @param {{selectedId?: string|null, hasOrigin?: boolean}} [options]
 * @returns {boolean}
 */
export function earthquakeListRowMatchesRangeCeiling(record, ceilingId, {
  selectedId = null,
  hasOrigin,
} = {}) {
  const ceiling = earthquakeListRangeCeilingKm(ceilingId);
  if (ceiling == null) return true;
  const keepId = selectedId == null || selectedId === '' ? null : String(selectedId);
  if (keepId && String(record?.id) === keepId) return true;
  if (hasOrigin === false) return true;
  const raw = record?.distanceKm ?? record?.distance;
  if (raw == null || raw === '') return true;
  const distanceKm = Number(raw);
  if (!Number.isFinite(distanceKm)) return true;
  return distanceKm < ceiling;
}

/**
 * @param {Array<{id?: unknown, distanceKm?: unknown, distance?: unknown}>|null|undefined} records
 * @param {unknown} [ceilingId]
 * @param {{selectedId?: string|null, hasOrigin?: boolean}} [options]
 * @returns {Array}
 */
export function filterEarthquakeListRowsByRange(records, ceilingId, {
  selectedId = null,
  hasOrigin,
} = {}) {
  const list = Array.isArray(records) ? records : [];
  if (earthquakeListRangeCeilingKm(ceilingId) == null) return list.slice();
  return list.filter((record) => (
    earthquakeListRowMatchesRangeCeiling(record, ceilingId, { selectedId, hasOrigin })
  ));
}

/**
 * Exclusive-chip models for the hosted Quakes list row.
 * @param {unknown} [current]
 * @returns {Array<object>}
 */
export function earthquakeListRangeChipModels(current = DEFAULT_EARTHQUAKE_LIST_RANGE_FILTER) {
  const ceiling = normalizeEarthquakeListRangeFilter(current);
  return EARTHQUAKE_LIST_RANGE_CHIP_IDS.map((id) => ({
    id,
    label: EARTHQUAKE_LIST_RANGE_CHIP_LABELS[id],
    title: EARTHQUAKE_LIST_RANGE_CHIP_TITLES[id],
    active: ceiling === id,
  }));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {EarthquakeListRangeChipId}
 */
export function readEarthquakeListRangeFilter(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(EARTHQUAKE_LIST_RANGE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_EARTHQUAKE_LIST_RANGE_FILTER;
    return normalizeEarthquakeListRangeFilter(raw);
  } catch {
    return DEFAULT_EARTHQUAKE_LIST_RANGE_FILTER;
  }
}

/**
 * @param {unknown} ceilingId
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeEarthquakeListRangeFilter(ceilingId, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      EARTHQUAKE_LIST_RANGE_STORAGE_KEY,
      normalizeEarthquakeListRangeFilter(ceilingId),
    );
    return true;
  } catch {
    return false;
  }
}

/** @returns {EarthquakeListRangeChipId} */
export function getEarthquakeListRangeFilter() {
  return sessionFilter;
}

/**
 * Exclusive chip set. Clicking All, <500 km, or <100 km replaces the ceiling.
 * @param {unknown} ceilingId
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {EarthquakeListRangeChipId}
 */
export function setEarthquakeListRangeFilter(ceilingId, { persist = true, storage } = {}) {
  const next = normalizeEarthquakeListRangeFilter(ceilingId);
  sessionFilter = next;
  if (persist) writeEarthquakeListRangeFilter(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {EarthquakeListRangeChipId}
 */
export function hydrateEarthquakeListRangeFilter(storage) {
  return setEarthquakeListRangeFilter(readEarthquakeListRangeFilter(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(ceilingId: EarthquakeListRangeChipId) => void} listener
 * @returns {() => void}
 */
export function subscribeEarthquakeListRangeFilter(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore All without clearing subscribers. */
export function resetEarthquakeListRangeFilterForTest() {
  sessionFilter = DEFAULT_EARTHQUAKE_LIST_RANGE_FILTER;
}
