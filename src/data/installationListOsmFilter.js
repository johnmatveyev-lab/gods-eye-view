/**
 * Client-only Sites list OSM-type chips (All | Node | Way).
 *
 * Uses `osmType` already present on each viewport record (`node` /
 * `way` / `relation` from Overpass). Google Places extras have none.
 * Never fetches Overpass or Places and adds no endpoint.
 * Persistence is local only (`meridian.sitesListOsmType`) and is never
 * written into share URLs. LayerStateCoordinator restore of class /
 * footprints / named / osmType / mapped does not wipe this key; the
 * hosted list re-reads it when painting rows.
 *
 * All is the current 50-row list (node + way + relation). Node keeps
 * `osmType === node` and drops way. Way keeps way or relation and drops
 * node. Missing `osmType` fails open (Places extras stay). A selected
 * id stays when passed. AND with Plan 209 Mapped only and Plan 220
 * Named only happens in `listViewportInstallations`. Distinct from
 * Plan 151 class chips, Plan 165 Footprints only, Plan 186 / 220 named,
 * Plan 202 globe OSM-type, Plan 209 list Mapped only, Plan 212 globe
 * Mapped only, and hide-ground.
 */

export const SITES_LIST_OSM_TYPE_CHIPS = Object.freeze([
  Object.freeze({
    id: 'all',
    label: 'All',
    title: 'Show every listed site regardless of OSM primitive',
  }),
  Object.freeze({
    id: 'node',
    label: 'Node',
    title: 'Show OSM point nodes in this list',
  }),
  Object.freeze({
    id: 'way',
    label: 'Way',
    title: 'Show OSM ways and relations in this list',
  }),
]);

export const SITES_LIST_OSM_TYPE_CHIP_IDS = Object.freeze(
  SITES_LIST_OSM_TYPE_CHIPS.map((chip) => chip.id),
);
export const DEFAULT_SITES_LIST_OSM_TYPE = 'all';
export const SITES_LIST_OSM_TYPE_STORAGE_KEY = 'meridian.sitesListOsmType';

/** @typedef {'all'|'node'|'way'} SitesListOsmTypeId */

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
 * @returns {SitesListOsmTypeId|null}
 */
export function normalizeSitesListOsmType(value) {
  if (value == null || value === '' || value === true) {
    return DEFAULT_SITES_LIST_OSM_TYPE;
  }
  if (value === false) return null;
  const text = String(value).trim().toLowerCase();
  if (text === 'all' || text === '0') return DEFAULT_SITES_LIST_OSM_TYPE;
  if (text === 'node' || text === 'way') return text;
  return null;
}

/**
 * Overpass primitive already stamped on the viewport record. Missing /
 * unknown is null so Places extras and unlabeled rows stay visible.
 * @param {unknown} value
 * @returns {'way'|'node'|'relation'|null}
 */
export function installationListOsmType(value) {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'way' || token === 'node' || token === 'relation') return token;
  return null;
}

/**
 * Whether one viewport record clears the exclusive list OSM-type chips.
 * All always passes. Missing osmType stays. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} filter
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function installationMatchesListOsmFilter(record, filter, { selectedId = null } = {}) {
  const id = String(record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  const chip = normalizeSitesListOsmType(filter) ?? DEFAULT_SITES_LIST_OSM_TYPE;
  switch (chip) {
    case 'all':
      return true;
    case 'node': {
      const type = installationListOsmType(record?.osmType);
      if (type == null) return true;
      return type === 'node';
    }
    case 'way': {
      const type = installationListOsmType(record?.osmType);
      if (type == null) return true;
      return type === 'way' || type === 'relation';
    }
    default: {
      const _exhaustive = /** @type {never} */ (chip);
      void _exhaustive;
      return true;
    }
  }
}

/**
 * Keep records whose osmType matches the exclusive list chip.
 * All returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [filter=DEFAULT_SITES_LIST_OSM_TYPE]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterInstallationsByListOsmType(
  records,
  filter = DEFAULT_SITES_LIST_OSM_TYPE,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  const token = normalizeSitesListOsmType(filter) ?? DEFAULT_SITES_LIST_OSM_TYPE;
  if (token === DEFAULT_SITES_LIST_OSM_TYPE) return records.slice();
  return records.filter((record) => installationMatchesListOsmFilter(record, token, { selectedId }));
}

/**
 * Exclusive-chip models for the hosted Sites list.
 * @param {unknown} [current=DEFAULT_SITES_LIST_OSM_TYPE]
 * @returns {Array<object>}
 */
export function sitesListOsmTypeChipModels(current = DEFAULT_SITES_LIST_OSM_TYPE) {
  const floor = normalizeSitesListOsmType(current) ?? DEFAULT_SITES_LIST_OSM_TYPE;
  return SITES_LIST_OSM_TYPE_CHIPS.map((chip) => {
    switch (chip.id) {
      case 'all':
      case 'node':
      case 'way':
        return {
          id: `list-osm-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: floor === chip.id,
          group: 'OSM',
          params: { listOsmType: chip.id },
        };
      default: {
        const _exhaustive = /** @type {never} */ (chip.id);
        void _exhaustive;
        return {
          id: `list-osm-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: false,
          group: 'OSM',
          params: { listOsmType: floor },
        };
      }
    }
  });
}

/**
 * Read `meridian.sitesListOsmType`. Missing or invalid storage is All.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {SitesListOsmTypeId}
 */
export function readSitesListOsmType(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(SITES_LIST_OSM_TYPE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_SITES_LIST_OSM_TYPE;
    return normalizeSitesListOsmType(raw) ?? DEFAULT_SITES_LIST_OSM_TYPE;
  } catch {
    return DEFAULT_SITES_LIST_OSM_TYPE;
  }
}

/**
 * Write `meridian.sitesListOsmType`. Invalid values are refused.
 * @param {unknown} osmType
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeSitesListOsmType(osmType, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeSitesListOsmType(osmType);
    if (next == null) return false;
    store.setItem(SITES_LIST_OSM_TYPE_STORAGE_KEY, next);
    return true;
  } catch {
    return false;
  }
}

export const filterViewportSitesListOsm = filterInstallationsByListOsmType;
export const readSitesListOsmPref = readSitesListOsmType;
