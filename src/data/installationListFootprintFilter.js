/**
 * Client-only Sites list Footprints only toggle.
 *
 * Uses `footprint` already present on each viewport record (polygon
 * ring array from Overpass/Places, or null). Never fetches Overpass or
 * Places and adds no endpoint.
 * Persistence is local only (`meridian.sitesListFootprintsOnly`) and is
 * never written into share URLs. LayerStateCoordinator restore of class
 * / footprints / named / osmType / mapped does not wipe this key; the
 * hosted list re-reads it when painting rows.
 *
 * Off is the current 50-row list (including null / empty footprint).
 * On keeps a non-empty footprint array (a ring stays). Missing / null /
 * empty fails closed. A selected id stays when passed. AND with Plan
 * 209 Mapped only, Plan 220 Named only, Plan 235 OSM-type, and Plan
 * 243 class happens in `listViewportInstallations`. Distinct from
 * Plan 151 / 243 class, Plan 165 globe Footprints only, Plan 186 / 220
 * named, Plan 202 / 235 OSM-type, Plan 209 list Mapped only, and
 * Plan 212 globe Mapped only.
 */

export const DEFAULT_SITES_LIST_FOOTPRINTS_ONLY = false;
export const SITES_LIST_FOOTPRINTS_ONLY_STORAGE_KEY = 'meridian.sitesListFootprintsOnly';
export const SITES_LIST_FOOTPRINTS_ONLY_CHIP_ID = 'list-footprints-only';
export const SITES_LIST_FOOTPRINTS_ONLY_CHIP_LABEL = 'Footprints only';
export const SITES_LIST_FOOTPRINTS_ONLY_CHIP_TITLE =
  'Hide listed sites that have no footprint polygon';

let sessionFilter = DEFAULT_SITES_LIST_FOOTPRINTS_ONLY;
const listeners = new Set();

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeSitesListFootprintsOnly(value) {
  if (value == null || value === '') return DEFAULT_SITES_LIST_FOOTPRINTS_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Whether this viewport record already carries a non-empty footprint
 * ring. Missing / null / empty is not a footprint.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function installationListHasFootprint(record) {
  const ring = record?.footprint;
  return Array.isArray(ring) && ring.length > 0;
}

/**
 * Whether one viewport record clears Footprints only.
 * Off always passes. Missing / null / empty fails closed when on.
 * A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} footprintsOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function installationMatchesListFootprintFilter(
  record,
  footprintsOnly,
  { selectedId = null } = {},
) {
  if (normalizeSitesListFootprintsOnly(footprintsOnly) !== true) return true;
  const id = String(record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return installationListHasFootprint(record);
}

/**
 * Drop pin-only rows when Footprints only is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [footprintsOnly=DEFAULT_SITES_LIST_FOOTPRINTS_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterInstallationsByListFootprint(
  records,
  footprintsOnly = DEFAULT_SITES_LIST_FOOTPRINTS_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeSitesListFootprintsOnly(footprintsOnly) !== true) return records.slice();
  return records.filter((record) => (
    installationMatchesListFootprintFilter(record, true, { selectedId })
  ));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_SITES_LIST_FOOTPRINTS_ONLY]
 * @returns {object}
 */
export function sitesListFootprintsOnlyChipModel(
  current = DEFAULT_SITES_LIST_FOOTPRINTS_ONLY,
) {
  const only = normalizeSitesListFootprintsOnly(current) === true;
  return {
    id: SITES_LIST_FOOTPRINTS_ONLY_CHIP_ID,
    label: SITES_LIST_FOOTPRINTS_ONLY_CHIP_LABEL,
    title: SITES_LIST_FOOTPRINTS_ONLY_CHIP_TITLE,
    active: only,
    group: 'Footprint',
    params: { listFootprintsOnly: !only },
  };
}

/**
 * Read `meridian.sitesListFootprintsOnly`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readSitesListFootprintsOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(SITES_LIST_FOOTPRINTS_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_SITES_LIST_FOOTPRINTS_ONLY;
    return normalizeSitesListFootprintsOnly(raw) === true;
  } catch {
    return DEFAULT_SITES_LIST_FOOTPRINTS_ONLY;
  }
}

/**
 * Write `meridian.sitesListFootprintsOnly` as `'1'` / `'0'`.
 * @param {unknown} footprintsOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeSitesListFootprintsOnly(footprintsOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeSitesListFootprintsOnly(footprintsOnly);
    if (next == null) return false;
    store.setItem(SITES_LIST_FOOTPRINTS_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getSitesListFootprintsOnlyFilter() {
  return sessionFilter;
}

/**
 * Toggle set. Clicking Footprints only writes the opposite boolean.
 * @param {unknown} footprintsOnly
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setSitesListFootprintsOnlyFilter(
  footprintsOnly,
  { persist = true, storage } = {},
) {
  const next = normalizeSitesListFootprintsOnly(footprintsOnly)
    ?? DEFAULT_SITES_LIST_FOOTPRINTS_ONLY;
  sessionFilter = next;
  if (persist) writeSitesListFootprintsOnly(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateSitesListFootprintsOnlyFilter(storage) {
  return setSitesListFootprintsOnlyFilter(readSitesListFootprintsOnly(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(footprintsOnly: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeSitesListFootprintsOnlyFilter(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetSitesListFootprintsOnlyFilterForTest() {
  sessionFilter = DEFAULT_SITES_LIST_FOOTPRINTS_ONLY;
}

export const filterViewportSitesListFootprint = filterInstallationsByListFootprint;
export const readSitesListFootprintsPref = readSitesListFootprintsOnly;
