/**
 * Client-only AIS hide-parked toggle.
 *
 * Uses `speed` (knots) already present on each in-memory vessel.
 * Never fetches AISStream and adds no endpoint.
 * Persistence rides `ais-live-vessels` layerState (`hideParked`).
 *
 * When on, skip vessels with a finite speed < 0.5 kt. Missing / non-finite
 * speed stays visible. A selected vessel stays. AND with Plan 153 type chips
 * happens at the AIS layer, not here.
 */

export const DEFAULT_AIS_HIDE_PARKED = false;
export const AIS_PARKED_SPEED_KT = 0.5;
export const AIS_HIDE_PARKED_CHIP_LABEL = 'Hide parked';
export const AIS_HIDE_PARKED_CHIP_TITLE =
  'Hide anchored and parked vessels slower than 0.5 knots';

/**
 * Canonical on/off. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeAisHideParked(value) {
  if (value == null || value === '') return DEFAULT_AIS_HIDE_PARKED;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
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
 * Finite speed strictly under 0.5 kt. Missing speed is not parked.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function vesselIsParked(record) {
  const speed = vesselSpeedKnots(record);
  return speed != null && speed < AIS_PARKED_SPEED_KT;
}

/**
 * Whether one in-memory vessel clears Hide parked.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} hideParked
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function vesselMatchesParkedFilter(record, hideParked, { selectedId = null } = {}) {
  if (normalizeAisHideParked(hideParked) !== true) return true;
  const id = String(record?.mmsi || record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return vesselIsParked(record) !== true;
}

/**
 * Keep moving vessels when Hide parked is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [hideParked=DEFAULT_AIS_HIDE_PARKED]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterVesselsByParked(
  records,
  hideParked = DEFAULT_AIS_HIDE_PARKED,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeAisHideParked(hideParked) !== true) return records.slice();
  return records.filter((record) => vesselMatchesParkedFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean.
 * @param {unknown} [current=DEFAULT_AIS_HIDE_PARKED]
 * @returns {object}
 */
export function aisHideParkedChipModel(current = DEFAULT_AIS_HIDE_PARKED) {
  const hide = normalizeAisHideParked(current) === true;
  return {
    id: 'hide-parked',
    label: AIS_HIDE_PARKED_CHIP_LABEL,
    title: AIS_HIDE_PARKED_CHIP_TITLE,
    active: hide,
    group: 'Parked',
    params: { hideParked: !hide },
  };
}
