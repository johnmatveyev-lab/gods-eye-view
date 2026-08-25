/**
 * @module bikeshareMinDocks
 * @description Client-only min-open-docks floor for already-fetched GBFS stations.
 *
 * All | 3+ | 5+ re-filters cached `docksAvailable`. It never fetches `/api/gbfs`
 * and does not add an endpoint. Missing / non-finite counts stay visible.
 */

export const DEFAULT_BIKESHARE_MIN_DOCKS = 'all';

/** @typedef {'all'|'3'|'5'} BikeshareMinDocksId */

export const BIKESHARE_MIN_DOCKS_FLOORS = Object.freeze([
  Object.freeze({ id: 'all', floor: 0, label: 'All', title: 'Show every station regardless of dock count' }),
  Object.freeze({ id: '3', floor: 3, label: '3+', title: 'Hide stations with fewer than 3 open docks' }),
  Object.freeze({ id: '5', floor: 5, label: '5+', title: 'Hide stations with fewer than 5 open docks' }),
]);

const FLOOR_BY_ID = Object.freeze(Object.fromEntries(
  BIKESHARE_MIN_DOCKS_FLOORS.map((entry) => [entry.id, entry]),
));
void FLOOR_BY_ID;

/**
 * Accept only the shipped chip ids.
 * @param {unknown} value
 * @returns {BikeshareMinDocksId|null}
 */
export function normalizeBikeshareMinDocks(value) {
  if (value === 3 || value === '3') return '3';
  if (value === 5 || value === '5') return '5';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return null;
}

/**
 * Numeric dock floor for a chip. All is 0 (no numeric floor).
 * @param {unknown} floorId
 * @returns {number}
 */
export function bikeshareMinDocksFloor(floorId) {
  const id = normalizeBikeshareMinDocks(floorId) || DEFAULT_BIKESHARE_MIN_DOCKS;
  switch (id) {
    case 'all':
      return 0;
    case '3':
      return 3;
    case '5':
      return 5;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      void _exhaustive;
      return 0;
    }
  }
}

/**
 * Whether one cached station clears the min-docks floor.
 * Missing / non-finite `docksAvailable` stays visible. A selected station
 * can be kept even when it is below the floor.
 * @param {Object|null|undefined} record
 * @param {unknown} floorId
 * @param {{ selectedKey?: string|null }} [options]
 * @returns {boolean}
 */
export function stationMatchesBikeshareMinDocks(record, floorId, { selectedKey = null } = {}) {
  if (selectedKey && record?.key === selectedKey) return true;
  const floor = bikeshareMinDocksFloor(floorId);
  if (floor <= 0) return true;
  if (!Number.isFinite(record?.docksAvailable)) return true;
  return record.docksAvailable >= floor;
}
