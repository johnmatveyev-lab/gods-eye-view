/**
 * Client-only military installations OSM primitive-type chips
 * (All | Way | Node | Relation).
 *
 * Uses `osmType` already stamped at normalize time from the Overpass
 * element (`node` | `way` | `relation`). Google Places search rows have
 * none. Never fetches Overpass or Places and adds no endpoint.
 * Persistence is local only (`meridian.milOsmType`) and is never written
 * into share URLs. LayerStateCoordinator restore re-reads the persist
 * key on layer init; other military options do not wipe it.
 *
 * All is the current view. A selected installation stays. Missing
 * `osmType` stays visible. AND with Plan 151 class chips, Plan 165
 * Footprints only, and Plan 186 Named only happens at the installations
 * layer, not here.
 */

export const INSTALLATION_OSM_TYPE_CHIPS = Object.freeze([
  Object.freeze({
    id: 'all',
    label: 'All',
    title: 'Show every mapped installation regardless of OSM primitive',
  }),
  Object.freeze({
    id: 'way',
    label: 'Way',
    title: 'Show OSM ways',
  }),
  Object.freeze({
    id: 'node',
    label: 'Node',
    title: 'Show OSM point nodes',
  }),
  Object.freeze({
    id: 'relation',
    label: 'Relation',
    title: 'Show OSM relations',
  }),
]);

export const INSTALLATION_OSM_TYPE_CHIP_IDS = Object.freeze(
  INSTALLATION_OSM_TYPE_CHIPS.map((chip) => chip.id),
);
export const DEFAULT_INSTALLATION_OSM_TYPE = 'all';
export const MILITARY_OSM_TYPE_STORAGE_KEY = 'meridian.milOsmType';

/** @typedef {'all'|'way'|'node'|'relation'} InstallationOsmTypeId */

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Canonical exclusive chip. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {InstallationOsmTypeId|null}
 */
export function normalizeInstallationOsmType(value) {
  if (value == null || value === '' || value === true) {
    return DEFAULT_INSTALLATION_OSM_TYPE;
  }
  if (value === false) return null;
  const text = String(value).trim().toLowerCase();
  if (text === 'all' || text === '0') return DEFAULT_INSTALLATION_OSM_TYPE;
  if (text === 'way' || text === 'node' || text === 'relation') return text;
  return null;
}

/**
 * Overpass primitive already stamped on the record. Missing / unknown is null
 * so Places candidates and unlabeled rows stay visible.
 * @param {unknown} value
 * @returns {'way'|'node'|'relation'|null}
 */
export function installationOsmType(value) {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'way' || token === 'node' || token === 'relation') return token;
  return null;
}

/**
 * Whether one in-memory installation clears the exclusive OSM-type chips.
 * All always passes. Missing osmType stays visible. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} filter
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function installationMatchesOsmTypeFilter(record, filter, { selectedId = null } = {}) {
  const id = String(record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  const chip = normalizeInstallationOsmType(filter) ?? DEFAULT_INSTALLATION_OSM_TYPE;
  switch (chip) {
    case 'all':
      return true;
    case 'way':
    case 'node':
    case 'relation': {
      const type = installationOsmType(record?.osmType);
      if (type == null) return true;
      return type === chip;
    }
    default: {
      const _exhaustive = /** @type {never} */ (chip);
      void _exhaustive;
      return true;
    }
  }
}

/**
 * Keep records whose osmType matches the exclusive chip. All returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [filter=DEFAULT_INSTALLATION_OSM_TYPE]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterInstallationsByOsmType(
  records,
  filter = DEFAULT_INSTALLATION_OSM_TYPE,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  const token = normalizeInstallationOsmType(filter) ?? DEFAULT_INSTALLATION_OSM_TYPE;
  if (token === DEFAULT_INSTALLATION_OSM_TYPE) return records.slice();
  return records.filter((record) => installationMatchesOsmTypeFilter(record, token, { selectedId }));
}

/**
 * Exclusive-chip models for the Mapped Sites list.
 * @param {unknown} [current=DEFAULT_INSTALLATION_OSM_TYPE]
 * @returns {Array<object>}
 */
export function installationOsmTypeChipModels(current = DEFAULT_INSTALLATION_OSM_TYPE) {
  const floor = normalizeInstallationOsmType(current) ?? DEFAULT_INSTALLATION_OSM_TYPE;
  return INSTALLATION_OSM_TYPE_CHIPS.map((chip) => {
    switch (chip.id) {
      case 'all':
      case 'way':
      case 'node':
      case 'relation':
        return {
          id: `osm-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: floor === chip.id,
          group: 'OSM',
          params: { osmType: chip.id },
        };
      default: {
        const _exhaustive = /** @type {never} */ (chip.id);
        void _exhaustive;
        return {
          id: `osm-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: false,
          group: 'OSM',
          params: { osmType: floor },
        };
      }
    }
  });
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {InstallationOsmTypeId}
 */
export function readMilitaryOsmType(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(MILITARY_OSM_TYPE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_INSTALLATION_OSM_TYPE;
    return normalizeInstallationOsmType(raw) ?? DEFAULT_INSTALLATION_OSM_TYPE;
  } catch {
    return DEFAULT_INSTALLATION_OSM_TYPE;
  }
}

/**
 * @param {unknown} osmType
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeMilitaryOsmType(osmType, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeInstallationOsmType(osmType);
    if (next == null) return false;
    store.setItem(MILITARY_OSM_TYPE_STORAGE_KEY, next);
    return true;
  } catch {
    return false;
  }
}
