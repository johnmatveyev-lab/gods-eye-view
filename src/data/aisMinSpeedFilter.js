/**
 * Client-only AIS min-speed chips.
 *
 * Uses `speed` (knots) already present on each in-memory vessel.
 * Never fetches AISStream and adds no endpoint.
 * Persistence rides `ais-live-vessels` layerState (`minSpeed`).
 *
 * All is the current unfiltered view. 5+ skips vessels with a finite speed
 * < 5 kt. 10+ is stricter (< 10 kt). Missing / non-finite speed stays
 * visible. A selected vessel stays. AND with Plan 153 type chips and Plan
 * 157 Hide parked happens at the AIS layer, not here.
 */

export const DEFAULT_AIS_MIN_SPEED = 'all';

/** @typedef {'all'|'5'|'10'} AisMinSpeedId */

export const AIS_MIN_SPEED_CHIPS = Object.freeze([
  Object.freeze({
    id: 'all',
    floor: 0,
    label: 'All',
    title: 'Show every vessel regardless of speed',
  }),
  Object.freeze({
    id: '5',
    floor: 5,
    label: '5+',
    title: 'Hide vessels slower than 5 knots',
  }),
  Object.freeze({
    id: '10',
    floor: 10,
    label: '10+',
    title: 'Hide vessels slower than 10 knots',
  }),
]);

/**
 * Canonical chip id. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {AisMinSpeedId|null}
 */
export function normalizeAisMinSpeed(value) {
  if (value == null || value === '') return DEFAULT_AIS_MIN_SPEED;
  if (value === 5 || value === '5') return '5';
  if (value === 10 || value === '10') return '10';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return null;
}

/**
 * Knots floor for a chip. All is 0 (no numeric floor).
 * @param {unknown} floorId
 * @returns {number}
 */
export function aisMinSpeedFloor(floorId) {
  const id = normalizeAisMinSpeed(floorId) || DEFAULT_AIS_MIN_SPEED;
  switch (id) {
    case 'all':
      return 0;
    case '5':
      return 5;
    case '10':
      return 10;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      void _exhaustive;
      return 0;
    }
  }
}

/**
 * Knots from the AIS adapter field (`record.speed`). Non-finite is missing.
 * @param {object|null|undefined} record
 * @returns {number|null}
 */
export function vesselSpeedKnots(record) {
  const speed = record?.speed;
  return Number.isFinite(speed) ? speed : null;
}

/**
 * Whether one in-memory vessel clears the min-speed floor.
 * All always passes. A selected id stays. Missing speed stays.
 * @param {object|null|undefined} record
 * @param {unknown} minSpeed
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function vesselMatchesMinSpeedFilter(record, minSpeed, { selectedId = null } = {}) {
  const id = String(record?.mmsi || record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  const floor = aisMinSpeedFloor(minSpeed);
  if (floor <= 0) return true;
  const speed = vesselSpeedKnots(record);
  if (speed == null) return true;
  return speed >= floor;
}

/**
 * Keep vessels at or above the floor. All returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [minSpeed=DEFAULT_AIS_MIN_SPEED]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterVesselsByMinSpeed(
  records,
  minSpeed = DEFAULT_AIS_MIN_SPEED,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (aisMinSpeedFloor(minSpeed) <= 0) return records.slice();
  return records.filter((record) => vesselMatchesMinSpeedFilter(record, minSpeed, { selectedId }));
}

/**
 * Exclusive All | 5+ | 10+ chip models. Params carry the chosen floor.
 * @param {unknown} [current=DEFAULT_AIS_MIN_SPEED]
 * @returns {Array<object>}
 */
export function aisMinSpeedChipModels(current = DEFAULT_AIS_MIN_SPEED) {
  const floor = normalizeAisMinSpeed(current) || DEFAULT_AIS_MIN_SPEED;
  return AIS_MIN_SPEED_CHIPS.map((chip) => ({
    id: `min-speed-${chip.id}`,
    label: chip.label,
    title: chip.title,
    active: floor === chip.id,
    group: 'Speed',
    params: { minSpeed: chip.id },
  }));
}
