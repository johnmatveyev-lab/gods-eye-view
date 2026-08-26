/**
 * Client-only exclusive All | <70 km | <20 km chips for the hosted Quakes list.
 *
 * Filters already-fetched USGS list rows (`record.depthKm`) inside
 * `selectEarthquakeListRows` after the Plan 208 magnitude floor and before
 * the 50-row cap. Distinct from the globe SID depth bands (default all-on)
 * and from the list magnitude floor. Persistence is local only
 * (`meridian.quakeListDepth`). No share-URL write, no extra fetch, no new /api.
 */

export const EARTHQUAKE_LIST_DEPTH_STORAGE_KEY = 'meridian.quakeListDepth';
export const EARTHQUAKE_LIST_DEPTH_CHIP_IDS = Object.freeze(['all', '70', '20']);
export const EARTHQUAKE_LIST_DEPTH_CHIP_LABELS = Object.freeze({
  all: 'All',
  70: '<70 km',
  20: '<20 km',
});
export const EARTHQUAKE_LIST_DEPTH_CHIP_TITLES = Object.freeze({
  all: 'Show every listed earthquake regardless of depth',
  70: 'Hide listed earthquakes 70 km deep and deeper',
  20: 'Hide listed earthquakes 20 km deep and deeper',
});
export const DEFAULT_EARTHQUAKE_LIST_DEPTH_FILTER = 'all';

/** @typedef {'all'|'70'|'20'} EarthquakeListDepthChipId */

let sessionFilter = DEFAULT_EARTHQUAKE_LIST_DEPTH_FILTER;
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
 * @returns {EarthquakeListDepthChipId}
 */
export function normalizeEarthquakeListDepthFilter(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (text === '70' || text === '<70' || text === '<70km' || text === '70km') return '70';
  if (text === '20' || text === '<20' || text === '<20km' || text === '20km') return '20';
  if (text === 'all' || text === '0' || text === '') return DEFAULT_EARTHQUAKE_LIST_DEPTH_FILTER;
  return DEFAULT_EARTHQUAKE_LIST_DEPTH_FILTER;
}

/**
 * Depth ceiling in kilometres for a chip. All has no ceiling.
 * @param {unknown} ceilingId
 * @returns {number|null}
 */
export function earthquakeListDepthCeilingKm(ceilingId) {
  switch (normalizeEarthquakeListDepthFilter(ceilingId)) {
    case 'all':
      return null;
    case '70':
      return 70;
    case '20':
      return 20;
    default: {
      const unexpected = /** @type {never} */ (normalizeEarthquakeListDepthFilter(ceilingId));
      throw new Error(`unexpected quake list depth ceiling: ${unexpected}`);
    }
  }
}

/**
 * Keep a list row when the chip is All, depth is missing / non-finite
 * (fail open), the row is the selected event, or depth is strictly below
 * the ceiling.
 * @param {{id?: unknown, depthKm?: unknown, depth?: unknown}|null|undefined} record
 * @param {unknown} ceilingId
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function earthquakeListRowMatchesDepthCeiling(record, ceilingId, { selectedId = null } = {}) {
  const ceiling = earthquakeListDepthCeilingKm(ceilingId);
  if (ceiling == null) return true;
  const keepId = selectedId == null || selectedId === '' ? null : String(selectedId);
  if (keepId && String(record?.id) === keepId) return true;
  const raw = record?.depthKm ?? record?.depth;
  if (raw == null || raw === '') return true;
  const depthKm = Number(raw);
  if (!Number.isFinite(depthKm)) return true;
  return depthKm < ceiling;
}

/**
 * @param {Array<{id?: unknown, depthKm?: unknown, depth?: unknown}>|null|undefined} records
 * @param {unknown} [ceilingId]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array}
 */
export function filterEarthquakeListRowsByDepth(records, ceilingId, { selectedId = null } = {}) {
  const list = Array.isArray(records) ? records : [];
  if (earthquakeListDepthCeilingKm(ceilingId) == null) return list.slice();
  return list.filter((record) => (
    earthquakeListRowMatchesDepthCeiling(record, ceilingId, { selectedId })
  ));
}

/**
 * Exclusive-chip models for the hosted Quakes list row.
 * @param {unknown} [current]
 * @returns {Array<object>}
 */
export function earthquakeListDepthChipModels(current = DEFAULT_EARTHQUAKE_LIST_DEPTH_FILTER) {
  const ceiling = normalizeEarthquakeListDepthFilter(current);
  return EARTHQUAKE_LIST_DEPTH_CHIP_IDS.map((id) => ({
    id,
    label: EARTHQUAKE_LIST_DEPTH_CHIP_LABELS[id],
    title: EARTHQUAKE_LIST_DEPTH_CHIP_TITLES[id],
    active: ceiling === id,
  }));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {EarthquakeListDepthChipId}
 */
export function readEarthquakeListDepthFilter(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(EARTHQUAKE_LIST_DEPTH_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_EARTHQUAKE_LIST_DEPTH_FILTER;
    return normalizeEarthquakeListDepthFilter(raw);
  } catch {
    return DEFAULT_EARTHQUAKE_LIST_DEPTH_FILTER;
  }
}

/**
 * @param {unknown} ceilingId
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeEarthquakeListDepthFilter(ceilingId, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      EARTHQUAKE_LIST_DEPTH_STORAGE_KEY,
      normalizeEarthquakeListDepthFilter(ceilingId),
    );
    return true;
  } catch {
    return false;
  }
}

/** @returns {EarthquakeListDepthChipId} */
export function getEarthquakeListDepthFilter() {
  return sessionFilter;
}

/**
 * Exclusive chip set. Clicking All, <70 km, or <20 km replaces the ceiling.
 * @param {unknown} ceilingId
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {EarthquakeListDepthChipId}
 */
export function setEarthquakeListDepthFilter(ceilingId, { persist = true, storage } = {}) {
  const next = normalizeEarthquakeListDepthFilter(ceilingId);
  sessionFilter = next;
  if (persist) writeEarthquakeListDepthFilter(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {EarthquakeListDepthChipId}
 */
export function hydrateEarthquakeListDepthFilter(storage) {
  return setEarthquakeListDepthFilter(readEarthquakeListDepthFilter(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(ceilingId: EarthquakeListDepthChipId) => void} listener
 * @returns {() => void}
 */
export function subscribeEarthquakeListDepthFilter(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore All without clearing subscribers. */
export function resetEarthquakeListDepthFilterForTest() {
  sessionFilter = DEFAULT_EARTHQUAKE_LIST_DEPTH_FILTER;
}
