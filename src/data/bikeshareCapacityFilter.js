/**
 * @module bikeshareCapacityFilter
 * @description Client-only hub-capacity floor chips for already-fetched
 * GBFS stations.
 *
 * All | 10+ | 20+ re-filters cached `record.capacity` from
 * station_information. It never fetches `/api/gbfs` and does not add an
 * endpoint. Missing / non-finite capacity stays visible. The 15-dock
 * render-size fallback is not treated as real capacity.
 */

export const DEFAULT_BIKESHARE_CAPACITY = 'all';
export const BIKESHARE_CAPACITY_STORAGE_KEY = 'meridian.bikeshareCapacity';

/** @typedef {'all'|'10'|'20'} BikeshareCapacityId */

export const BIKESHARE_CAPACITY_FLOORS = Object.freeze([
  Object.freeze({
    id: 'all',
    floor: 0,
    label: 'All',
    title: 'Show every station regardless of hub capacity',
  }),
  Object.freeze({
    id: '10',
    floor: 10,
    label: '10+',
    title: 'Hide stations with fewer than 10 docks of capacity',
  }),
  Object.freeze({
    id: '20',
    floor: 20,
    label: '20+',
    title: 'Hide stations with fewer than 20 docks of capacity',
  }),
]);

/**
 * Accept only the shipped chip ids.
 * @param {unknown} value
 * @returns {BikeshareCapacityId|null}
 */
export function normalizeBikeshareCapacity(value) {
  if (value === 10 || value === '10' || value === '10+') return '10';
  if (value === 20 || value === '20' || value === '20+') return '20';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return null;
}

/**
 * Numeric capacity floor for a chip. All is 0 (no numeric floor).
 * @param {unknown} floorId
 * @returns {number}
 */
export function bikeshareCapacityFloor(floorId) {
  const id = normalizeBikeshareCapacity(floorId) || DEFAULT_BIKESHARE_CAPACITY;
  switch (id) {
    case 'all':
      return 0;
    case '10':
      return 10;
    case '20':
      return 20;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      void _exhaustive;
      return 0;
    }
  }
}

/**
 * Whether one cached station clears the capacity floor.
 * Missing / non-finite `capacity` stays visible. A selected station
 * can be kept even when it is below the floor. Filter on the
 * station_information field — never the 15-dock render-size fallback.
 * @param {Object|null|undefined} record
 * @param {unknown} floorId
 * @param {{ selectedKey?: string|null }} [options]
 * @returns {boolean}
 */
export function stationMatchesBikeshareCapacity(record, floorId, { selectedKey = null } = {}) {
  if (selectedKey && record?.key === selectedKey) return true;
  const floor = bikeshareCapacityFloor(floorId);
  if (floor <= 0) return true;
  if (!Number.isFinite(record?.capacity)) return true;
  return record.capacity >= floor;
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {BikeshareCapacityId|null}
 */
export function readPersistedBikeshareCapacity(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    return normalizeBikeshareCapacity(storage.getItem(BIKESHARE_CAPACITY_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {BikeshareCapacityId|null}
 */
export function writePersistedBikeshareCapacity(value, storage) {
  const normalized = normalizeBikeshareCapacity(value);
  if (normalized == null || !storage || typeof storage.setItem !== 'function') return null;
  try {
    storage.setItem(BIKESHARE_CAPACITY_STORAGE_KEY, normalized);
    return normalized;
  } catch {
    return null;
  }
}
