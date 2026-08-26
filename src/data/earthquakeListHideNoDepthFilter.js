/**
 * Client-only Hide no depth toggle for the hosted Quakes list.
 *
 * Filters already-fetched USGS list rows (`record.depthKm`) inside
 * `selectEarthquakeListRows` after the Plan 208 magnitude floor, Plan
 * 216 depth ceiling, Plan 228 age ceiling, Plan 236 range ceiling, and
 * Plan 242 Hide no place, and before the 50-row cap. Distinct from the
 * Plan 216 fail-open depth ceiling (missing depth stays on that
 * matcher) and from the globe SID / time / tsunami / felt / type / net
 * / PAGER chips (locked on earthquakes.js). Persistence is local only
 * (`meridian.quakeListHideNoDepth`, `1` / `0`). LayerStateCoordinator
 * restore re-reads the key. No share-URL write, no extra fetch, no
 * new /api.
 *
 * Off is the current 50-row list (finite depth + null / missing). On
 * keeps a finite depthKm (12 km stays). Missing / null / non-finite
 * fail closed when on. The selected row always stays if it passed the
 * other filters. Place is a USGS region string, never a person name.
 */

export const EARTHQUAKE_LIST_HIDE_NO_DEPTH_STORAGE_KEY = 'meridian.quakeListHideNoDepth';
export const EARTHQUAKE_LIST_HIDE_NO_DEPTH_CHIP_ID = 'hide-no-depth';
export const EARTHQUAKE_LIST_HIDE_NO_DEPTH_CHIP_LABEL = 'Hide no depth';
export const EARTHQUAKE_LIST_HIDE_NO_DEPTH_CHIP_TITLE =
  'Hide listed earthquakes that have no depth';
export const DEFAULT_EARTHQUAKE_LIST_HIDE_NO_DEPTH = false;

let sessionHide = DEFAULT_EARTHQUAKE_LIST_HIDE_NO_DEPTH;
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
 * Canonical on/off. Only an explicit on is on; missing or corrupt values
 * keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeEarthquakeListHideNoDepth(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return DEFAULT_EARTHQUAKE_LIST_HIDE_NO_DEPTH;
}

/**
 * Finite depth in kilometres, or null when missing / null / non-finite.
 * 0 is a real surface depth and stays finite.
 * @param {{depthKm?: unknown, depth?: unknown}|null|undefined} record
 * @returns {number|null}
 */
export function earthquakeListFiniteDepthKm(record) {
  const raw = record?.depthKm ?? record?.depth;
  if (raw == null || raw === '') return null;
  const depthKm = Number(raw);
  return Number.isFinite(depthKm) ? depthKm : null;
}

/**
 * Whether one list row already carries a finite depthKm.
 * Missing, null, empty, NaN, and non-finite values fail closed.
 * @param {{depthKm?: unknown, depth?: unknown}|null|undefined} record
 * @returns {boolean}
 */
export function earthquakeListRowHasFiniteDepth(record) {
  return earthquakeListFiniteDepthKm(record) != null;
}

/**
 * Whether Hide no depth allows this list row. Off is a pass-through.
 * On requires a finite depthKm. The selected id always stays.
 * @param {{id?: unknown, depthKm?: unknown, depth?: unknown}|null|undefined} record
 * @param {unknown} hideNoDepth
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function earthquakeListRowMatchesHideNoDepthFilter(record, hideNoDepth, {
  selectedId = null,
} = {}) {
  if (normalizeEarthquakeListHideNoDepth(hideNoDepth) !== true) return true;
  const keepId = selectedId == null || selectedId === '' ? null : String(selectedId);
  if (keepId && String(record?.id ?? '') === keepId) return true;
  return earthquakeListRowHasFiniteDepth(record);
}

/**
 * Drop depth-less rows when Hide no depth is on. Off returns a shallow copy.
 * @param {Array<{id?: unknown, depthKm?: unknown, depth?: unknown}>|null|undefined} records
 * @param {unknown} [hideNoDepth=DEFAULT_EARTHQUAKE_LIST_HIDE_NO_DEPTH]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array}
 */
export function filterEarthquakeListRowsByHideNoDepth(
  records,
  hideNoDepth = DEFAULT_EARTHQUAKE_LIST_HIDE_NO_DEPTH,
  { selectedId = null } = {},
) {
  const list = Array.isArray(records) ? records : [];
  if (normalizeEarthquakeListHideNoDepth(hideNoDepth) !== true) return list.slice();
  return list.filter((record) => (
    earthquakeListRowMatchesHideNoDepthFilter(record, true, { selectedId })
  ));
}

/**
 * Toggle-chip model for the hosted Quakes list row. Params carry the
 * flipped boolean so a click writes the opposite value.
 * @param {unknown} [current=DEFAULT_EARTHQUAKE_LIST_HIDE_NO_DEPTH]
 * @returns {object}
 */
export function earthquakeListHideNoDepthChipModel(
  current = DEFAULT_EARTHQUAKE_LIST_HIDE_NO_DEPTH,
) {
  const hide = normalizeEarthquakeListHideNoDepth(current) === true;
  return {
    id: EARTHQUAKE_LIST_HIDE_NO_DEPTH_CHIP_ID,
    label: EARTHQUAKE_LIST_HIDE_NO_DEPTH_CHIP_LABEL,
    title: EARTHQUAKE_LIST_HIDE_NO_DEPTH_CHIP_TITLE,
    active: hide,
    group: 'Depth',
    params: { hideNoDepth: !hide },
  };
}

/**
 * Read `meridian.quakeListHideNoDepth`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readEarthquakeListHideNoDepth(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(EARTHQUAKE_LIST_HIDE_NO_DEPTH_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_EARTHQUAKE_LIST_HIDE_NO_DEPTH;
    return normalizeEarthquakeListHideNoDepth(raw);
  } catch {
    return DEFAULT_EARTHQUAKE_LIST_HIDE_NO_DEPTH;
  }
}

/**
 * Write `meridian.quakeListHideNoDepth` as `'1'` / `'0'`.
 * @param {unknown} hideNoDepth
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeEarthquakeListHideNoDepth(hideNoDepth, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      EARTHQUAKE_LIST_HIDE_NO_DEPTH_STORAGE_KEY,
      normalizeEarthquakeListHideNoDepth(hideNoDepth) ? '1' : '0',
    );
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getEarthquakeListHideNoDepth() {
  return sessionHide;
}

/**
 * Toggle set. Clicking Hide no depth writes the opposite boolean.
 * @param {unknown} hideNoDepth
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setEarthquakeListHideNoDepth(hideNoDepth, { persist = true, storage } = {}) {
  const next = normalizeEarthquakeListHideNoDepth(hideNoDepth);
  sessionHide = next;
  if (persist) writeEarthquakeListHideNoDepth(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateEarthquakeListHideNoDepth(storage) {
  return setEarthquakeListHideNoDepth(readEarthquakeListHideNoDepth(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(hideNoDepth: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeEarthquakeListHideNoDepth(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetEarthquakeListHideNoDepthForTest() {
  sessionHide = DEFAULT_EARTHQUAKE_LIST_HIDE_NO_DEPTH;
}
