/**
 * Client-only exclusive All | 5+ | 6+ chips for the hosted Quakes list.
 *
 * Filters already-fetched USGS list rows (`record.magnitude`) inside
 * `selectEarthquakeListRows` before the 50-row cap. Distinct from the globe
 * 2.5+ floor and Plan 183 significance chips. Persistence is local only
 * (`meridian.quakeListMag`). No share-URL write, no extra fetch, no new /api.
 */

export const EARTHQUAKE_LIST_MAG_STORAGE_KEY = 'meridian.quakeListMag';
export const EARTHQUAKE_LIST_MAG_CHIP_IDS = Object.freeze(['all', '5', '6']);
export const EARTHQUAKE_LIST_MAG_CHIP_LABELS = Object.freeze({
  all: 'All',
  5: '5+',
  6: '6+',
});
export const EARTHQUAKE_LIST_MAG_CHIP_TITLES = Object.freeze({
  all: 'Show every listed earthquake regardless of magnitude',
  5: 'Hide listed earthquakes below magnitude 5',
  6: 'Hide listed earthquakes below magnitude 6',
});
export const DEFAULT_EARTHQUAKE_LIST_MAG_FILTER = 'all';

/** @typedef {'all'|'5'|'6'} EarthquakeListMagChipId */

let sessionFilter = DEFAULT_EARTHQUAKE_LIST_MAG_FILTER;
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
 * @returns {EarthquakeListMagChipId}
 */
export function normalizeEarthquakeListMagFilter(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === '5' || text === '5+') return '5';
  if (text === '6' || text === '6+') return '6';
  if (text === 'all' || text === '0' || text === '') return DEFAULT_EARTHQUAKE_LIST_MAG_FILTER;
  return DEFAULT_EARTHQUAKE_LIST_MAG_FILTER;
}

/**
 * Numeric floor for a chip. All has no floor.
 * @param {unknown} floorId
 * @returns {number|null}
 */
export function earthquakeListMagFloor(floorId) {
  switch (normalizeEarthquakeListMagFilter(floorId)) {
    case 'all':
      return null;
    case '5':
      return 5;
    case '6':
      return 6;
    default: {
      const unexpected = /** @type {never} */ (normalizeEarthquakeListMagFilter(floorId));
      throw new Error(`unexpected quake list mag floor: ${unexpected}`);
    }
  }
}

/**
 * Keep a list row when the chip is All, or when magnitude is >= the floor.
 * Missing / non-finite magnitude does not pass a raised floor (the list
 * already drops those rows during format).
 * @param {{magnitude?: unknown, mag?: unknown}|null|undefined} record
 * @param {unknown} floorId
 * @returns {boolean}
 */
export function earthquakeListRowMatchesMagFloor(record, floorId) {
  const floor = earthquakeListMagFloor(floorId);
  if (floor == null) return true;
  const magnitude = Number(record?.magnitude ?? record?.mag);
  if (!Number.isFinite(magnitude)) return false;
  return magnitude >= floor;
}

/**
 * @param {Array<{magnitude?: unknown, mag?: unknown}>|null|undefined} records
 * @param {unknown} [floorId]
 * @returns {Array}
 */
export function filterEarthquakeListRowsByMag(records, floorId) {
  const list = Array.isArray(records) ? records : [];
  if (earthquakeListMagFloor(floorId) == null) return list.slice();
  return list.filter((record) => earthquakeListRowMatchesMagFloor(record, floorId));
}

/**
 * Exclusive-chip models for the hosted Quakes list row.
 * @param {unknown} [current]
 * @returns {Array<object>}
 */
export function earthquakeListMagChipModels(current = DEFAULT_EARTHQUAKE_LIST_MAG_FILTER) {
  const floor = normalizeEarthquakeListMagFilter(current);
  return EARTHQUAKE_LIST_MAG_CHIP_IDS.map((id) => ({
    id,
    label: EARTHQUAKE_LIST_MAG_CHIP_LABELS[id],
    title: EARTHQUAKE_LIST_MAG_CHIP_TITLES[id],
    active: floor === id,
  }));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {EarthquakeListMagChipId}
 */
export function readEarthquakeListMagFilter(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(EARTHQUAKE_LIST_MAG_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_EARTHQUAKE_LIST_MAG_FILTER;
    return normalizeEarthquakeListMagFilter(raw);
  } catch {
    return DEFAULT_EARTHQUAKE_LIST_MAG_FILTER;
  }
}

/**
 * @param {unknown} floorId
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeEarthquakeListMagFilter(floorId, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      EARTHQUAKE_LIST_MAG_STORAGE_KEY,
      normalizeEarthquakeListMagFilter(floorId),
    );
    return true;
  } catch {
    return false;
  }
}

/** @returns {EarthquakeListMagChipId} */
export function getEarthquakeListMagFilter() {
  return sessionFilter;
}

/**
 * Exclusive chip set. Clicking All, 5+, or 6+ replaces the current floor.
 * @param {unknown} floorId
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {EarthquakeListMagChipId}
 */
export function setEarthquakeListMagFilter(floorId, { persist = true, storage } = {}) {
  const next = normalizeEarthquakeListMagFilter(floorId);
  sessionFilter = next;
  if (persist) writeEarthquakeListMagFilter(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {EarthquakeListMagChipId}
 */
export function hydrateEarthquakeListMagFilter(storage) {
  return setEarthquakeListMagFilter(readEarthquakeListMagFilter(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(floorId: EarthquakeListMagChipId) => void} listener
 * @returns {() => void}
 */
export function subscribeEarthquakeListMagFilter(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore All without clearing subscribers. */
export function resetEarthquakeListMagFilterForTest() {
  sessionFilter = DEFAULT_EARTHQUAKE_LIST_MAG_FILTER;
}
