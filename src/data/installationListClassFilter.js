/**
 * Client-only Sites list class chips (All | Airfield | Naval).
 *
 * Uses `class` already present on each viewport record (`airfield` /
 * `naval_base` / `range` / `military_land`). Never fetches Overpass or
 * Places and adds no endpoint.
 * Persistence is local only (`meridian.sitesListClass`) and is never
 * written into share URLs. LayerStateCoordinator restore of class /
 * footprints / named / osmType / mapped does not wipe this key; the
 * hosted list re-reads it when painting rows.
 *
 * All is the current 50-row list (including range / military_land).
 * Airfield keeps `class === airfield` and drops naval_base. Naval keeps
 * `class === naval_base` and drops airfield. Other known classes drop on
 * those chips. Missing / empty / unknown class fails open. A selected
 * id stays when passed. AND with Plan 209 Mapped only, Plan 220 Named
 * only, and Plan 235 OSM-type happens in `listViewportInstallations`.
 * Distinct from Plan 151 globe class chips, Plan 165 Footprints only,
 * Plan 186 / 220 named, Plan 202 / 235 OSM-type, Plan 209 list Mapped
 * only, and Plan 212 globe Mapped only.
 */

export const SITES_LIST_CLASS_CHIPS = Object.freeze([
  Object.freeze({
    id: 'all',
    label: 'All',
    title: 'Show every listed site regardless of class',
  }),
  Object.freeze({
    id: 'airfield',
    label: 'Airfield',
    title: 'Show military airfields in this list',
  }),
  Object.freeze({
    id: 'naval',
    label: 'Naval',
    title: 'Show naval bases in this list',
  }),
]);

export const SITES_LIST_CLASS_CHIP_IDS = Object.freeze(
  SITES_LIST_CLASS_CHIPS.map((chip) => chip.id),
);
export const DEFAULT_SITES_LIST_CLASS = 'all';
export const SITES_LIST_CLASS_STORAGE_KEY = 'meridian.sitesListClass';

/** @typedef {'all'|'airfield'|'naval'} SitesListClassId */

let sessionFilter = DEFAULT_SITES_LIST_CLASS;
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
 * Canonical exclusive chip. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {SitesListClassId|null}
 */
export function normalizeSitesListClass(value) {
  if (value == null || value === '' || value === true) {
    return DEFAULT_SITES_LIST_CLASS;
  }
  if (value === false) return null;
  const text = String(value).trim().toLowerCase();
  if (text === 'all' || text === '0') return DEFAULT_SITES_LIST_CLASS;
  if (text === 'airfield') return 'airfield';
  if (text === 'naval' || text === 'naval_base') return 'naval';
  return null;
}

/**
 * Record class already stamped on the viewport record. Missing /
 * empty / unknown is null so those rows stay visible on every chip.
 * @param {unknown} value
 * @returns {'airfield'|'naval_base'|'range'|'military_land'|null}
 */
export function installationListClass(value) {
  const token = String(value || '').trim().toLowerCase();
  switch (token) {
    case 'airfield':
    case 'naval_base':
    case 'range':
    case 'military_land':
      return token;
    default:
      return null;
  }
}

/**
 * Whether one viewport record clears the exclusive list class chips.
 * All always passes. Missing / empty / unknown class stays. A selected
 * id stays.
 * @param {object|null|undefined} record
 * @param {unknown} filter
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function installationMatchesListClassFilter(record, filter, { selectedId = null } = {}) {
  const id = String(record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  const chip = normalizeSitesListClass(filter) ?? DEFAULT_SITES_LIST_CLASS;
  switch (chip) {
    case 'all':
      return true;
    case 'airfield': {
      const klass = installationListClass(record?.class);
      if (klass == null) return true;
      return klass === 'airfield';
    }
    case 'naval': {
      const klass = installationListClass(record?.class);
      if (klass == null) return true;
      return klass === 'naval_base';
    }
    default: {
      const _exhaustive = /** @type {never} */ (chip);
      void _exhaustive;
      return true;
    }
  }
}

/**
 * Keep records whose class matches the exclusive list chip.
 * All returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [filter=DEFAULT_SITES_LIST_CLASS]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterInstallationsByListClass(
  records,
  filter = DEFAULT_SITES_LIST_CLASS,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  const token = normalizeSitesListClass(filter) ?? DEFAULT_SITES_LIST_CLASS;
  if (token === DEFAULT_SITES_LIST_CLASS) return records.slice();
  return records.filter((record) => installationMatchesListClassFilter(record, token, { selectedId }));
}

/**
 * Exclusive-chip models for the hosted Sites list.
 * @param {unknown} [current=DEFAULT_SITES_LIST_CLASS]
 * @returns {Array<object>}
 */
export function sitesListClassChipModels(current = DEFAULT_SITES_LIST_CLASS) {
  const floor = normalizeSitesListClass(current) ?? DEFAULT_SITES_LIST_CLASS;
  return SITES_LIST_CLASS_CHIPS.map((chip) => {
    switch (chip.id) {
      case 'all':
      case 'airfield':
      case 'naval':
        return {
          id: `list-class-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: floor === chip.id,
          group: 'Class',
          params: { listClass: chip.id },
        };
      default: {
        const _exhaustive = /** @type {never} */ (chip.id);
        void _exhaustive;
        return {
          id: `list-class-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: false,
          group: 'Class',
          params: { listClass: floor },
        };
      }
    }
  });
}

/**
 * Read `meridian.sitesListClass`. Missing or invalid storage is All.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {SitesListClassId}
 */
export function readSitesListClass(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(SITES_LIST_CLASS_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_SITES_LIST_CLASS;
    return normalizeSitesListClass(raw) ?? DEFAULT_SITES_LIST_CLASS;
  } catch {
    return DEFAULT_SITES_LIST_CLASS;
  }
}

/**
 * Write `meridian.sitesListClass`. Invalid values are refused.
 * @param {unknown} listClass
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeSitesListClass(listClass, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeSitesListClass(listClass);
    if (next == null) return false;
    store.setItem(SITES_LIST_CLASS_STORAGE_KEY, next);
    return true;
  } catch {
    return false;
  }
}

/** @returns {SitesListClassId} */
export function getSitesListClassFilter() {
  return sessionFilter;
}

/**
 * Exclusive chip set. Clicking All, Airfield, or Naval replaces the class.
 * @param {unknown} listClass
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {SitesListClassId}
 */
export function setSitesListClassFilter(listClass, { persist = true, storage } = {}) {
  const next = normalizeSitesListClass(listClass) ?? DEFAULT_SITES_LIST_CLASS;
  sessionFilter = next;
  if (persist) writeSitesListClass(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {SitesListClassId}
 */
export function hydrateSitesListClassFilter(storage) {
  return setSitesListClassFilter(readSitesListClass(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(listClass: SitesListClassId) => void} listener
 * @returns {() => void}
 */
export function subscribeSitesListClassFilter(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore All without clearing subscribers. */
export function resetSitesListClassFilterForTest() {
  sessionFilter = DEFAULT_SITES_LIST_CLASS;
}

export const filterViewportSitesListClass = filterInstallationsByListClass;
export const readSitesListClassPref = readSitesListClass;
