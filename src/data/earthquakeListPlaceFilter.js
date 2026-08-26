/**
 * Client-only Hide no place toggle for the hosted Quakes list.
 *
 * Filters already-fetched USGS list rows (`record.place`) inside
 * `selectEarthquakeListRows` after the Plan 208 magnitude floor, Plan
 * 216 depth ceiling, Plan 228 age ceiling, and Plan 236 range ceiling,
 * and before the 50-row cap. Place is a USGS region string, never a
 * person name. Distinct from the globe SID / time / tsunami / felt /
 * type / net / PAGER chips (locked on earthquakes.js). Persistence is
 * local only
 * (`meridian.quakeListHideNoPlace`, `1` / `0`). LayerStateCoordinator
 * restore re-reads the key. No share-URL write, no extra fetch, no
 * new /api.
 *
 * Off is the current 50-row list (named place + UNAVAILABLE). On keeps
 * a non-empty place that is not the UNAVAILABLE fallback. Empty /
 * whitespace / UNAVAILABLE / missing fail closed when on. The selected
 * row always stays if it passed the other filters.
 */

export const EARTHQUAKE_LIST_HIDE_NO_PLACE_STORAGE_KEY = 'meridian.quakeListHideNoPlace';
export const EARTHQUAKE_LIST_HIDE_NO_PLACE_CHIP_ID = 'hide-no-place';
export const EARTHQUAKE_LIST_HIDE_NO_PLACE_CHIP_LABEL = 'Hide no place';
export const EARTHQUAKE_LIST_HIDE_NO_PLACE_CHIP_TITLE =
  'Hide listed earthquakes that have no named USGS place';
export const DEFAULT_EARTHQUAKE_LIST_HIDE_NO_PLACE = false;

/** Matches `EARTHQUAKE_LIST_UNAVAILABLE` without importing earthquakeList.js. */
const UNAVAILABLE_PLACE = 'UNAVAILABLE';

let sessionHide = DEFAULT_EARTHQUAKE_LIST_HIDE_NO_PLACE;
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
export function normalizeEarthquakeListHideNoPlace(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return DEFAULT_EARTHQUAKE_LIST_HIDE_NO_PLACE;
}

/**
 * Trimmed USGS region string, or '' when missing / empty / whitespace.
 * Place is a region string, never a person name.
 * @param {{place?: unknown}|null|undefined} record
 * @returns {string}
 */
export function earthquakeListPlaceName(record) {
  const raw = record?.place;
  if (raw == null) return '';
  return String(raw).trim();
}

/**
 * Whether one list row already carries a named USGS place.
 * Empty, whitespace, missing, and the UNAVAILABLE fallback fail closed.
 * @param {{place?: unknown}|null|undefined} record
 * @returns {boolean}
 */
export function earthquakeListRowHasNamedPlace(record) {
  const place = earthquakeListPlaceName(record);
  return place !== '' && place !== UNAVAILABLE_PLACE;
}

/**
 * Whether Hide no place allows this list row. Off is a pass-through.
 * On requires a non-empty place that is not UNAVAILABLE. The selected
 * id always stays.
 * @param {{id?: unknown, place?: unknown}|null|undefined} record
 * @param {unknown} hideNoPlace
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function earthquakeListRowMatchesPlaceFilter(record, hideNoPlace, {
  selectedId = null,
} = {}) {
  if (normalizeEarthquakeListHideNoPlace(hideNoPlace) !== true) return true;
  const keepId = selectedId == null || selectedId === '' ? null : String(selectedId);
  if (keepId && String(record?.id ?? '') === keepId) return true;
  return earthquakeListRowHasNamedPlace(record);
}

/**
 * Drop placeless rows when Hide no place is on. Off returns a shallow copy.
 * @param {Array<{id?: unknown, place?: unknown}>|null|undefined} records
 * @param {unknown} [hideNoPlace=DEFAULT_EARTHQUAKE_LIST_HIDE_NO_PLACE]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array}
 */
export function filterEarthquakeListRowsByPlace(
  records,
  hideNoPlace = DEFAULT_EARTHQUAKE_LIST_HIDE_NO_PLACE,
  { selectedId = null } = {},
) {
  const list = Array.isArray(records) ? records : [];
  if (normalizeEarthquakeListHideNoPlace(hideNoPlace) !== true) return list.slice();
  return list.filter((record) => (
    earthquakeListRowMatchesPlaceFilter(record, true, { selectedId })
  ));
}

/**
 * Toggle-chip model for the hosted Quakes list row. Params carry the
 * flipped boolean so a click writes the opposite value.
 * @param {unknown} [current=DEFAULT_EARTHQUAKE_LIST_HIDE_NO_PLACE]
 * @returns {object}
 */
export function earthquakeListHideNoPlaceChipModel(
  current = DEFAULT_EARTHQUAKE_LIST_HIDE_NO_PLACE,
) {
  const hide = normalizeEarthquakeListHideNoPlace(current) === true;
  return {
    id: EARTHQUAKE_LIST_HIDE_NO_PLACE_CHIP_ID,
    label: EARTHQUAKE_LIST_HIDE_NO_PLACE_CHIP_LABEL,
    title: EARTHQUAKE_LIST_HIDE_NO_PLACE_CHIP_TITLE,
    active: hide,
    group: 'Place',
    params: { hideNoPlace: !hide },
  };
}

/**
 * Read `meridian.quakeListHideNoPlace`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readEarthquakeListHideNoPlace(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(EARTHQUAKE_LIST_HIDE_NO_PLACE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_EARTHQUAKE_LIST_HIDE_NO_PLACE;
    return normalizeEarthquakeListHideNoPlace(raw);
  } catch {
    return DEFAULT_EARTHQUAKE_LIST_HIDE_NO_PLACE;
  }
}

/**
 * Write `meridian.quakeListHideNoPlace` as `'1'` / `'0'`.
 * @param {unknown} hideNoPlace
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeEarthquakeListHideNoPlace(hideNoPlace, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      EARTHQUAKE_LIST_HIDE_NO_PLACE_STORAGE_KEY,
      normalizeEarthquakeListHideNoPlace(hideNoPlace) ? '1' : '0',
    );
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getEarthquakeListHideNoPlace() {
  return sessionHide;
}

/**
 * Toggle set. Clicking Hide no place writes the opposite boolean.
 * @param {unknown} hideNoPlace
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setEarthquakeListHideNoPlace(hideNoPlace, { persist = true, storage } = {}) {
  const next = normalizeEarthquakeListHideNoPlace(hideNoPlace);
  sessionHide = next;
  if (persist) writeEarthquakeListHideNoPlace(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateEarthquakeListHideNoPlace(storage) {
  return setEarthquakeListHideNoPlace(readEarthquakeListHideNoPlace(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(hideNoPlace: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeEarthquakeListHideNoPlace(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetEarthquakeListHideNoPlaceForTest() {
  sessionHide = DEFAULT_EARTHQUAKE_LIST_HIDE_NO_PLACE;
}
