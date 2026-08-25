/**
 * Client-only AIS hide-no-destination toggle.
 *
 * Uses `destination` already present on each in-memory vessel (HUD `→ dest`).
 * Never fetches AISStream and adds no endpoint.
 * Persistence rides `ais-live-vessels` layerState (`hideNoDestination`).
 *
 * When on, skip vessels whose destination is missing, empty, or
 * whitespace-only. A selected vessel stays. AND with Plan 153 type chips,
 * Plan 157 Hide parked, Plan 162 min-speed, and Plan 170 destination field
 * happens at the AIS layer, not here. The destination field still hides
 * blanks when it is non-empty; this toggle hides blanks even when the
 * field is empty.
 */

export const DEFAULT_AIS_HIDE_NO_DESTINATION = false;
export const AIS_HIDE_NO_DEST_CHIP_LABEL = 'Hide no dest';
export const AIS_HIDE_NO_DEST_CHIP_TITLE = 'Hide vessels with no destination';

/**
 * Canonical on/off. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeAisHideNoDestination(value) {
  if (value == null || value === '') return DEFAULT_AIS_HIDE_NO_DESTINATION;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Destination text from the AIS adapter field (`record.destination`).
 * Missing, empty, and whitespace-only collapse to empty.
 * @param {object|null|undefined} record
 * @returns {string}
 */
export function vesselDestinationText(record) {
  return String(record?.destination ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/**
 * Whether one in-memory vessel reports a filled destination.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function vesselHasDestination(record) {
  return Boolean(vesselDestinationText(record));
}

/**
 * Whether one in-memory vessel clears Hide no dest.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} hideNoDestination
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function vesselMatchesHideNoDestFilter(record, hideNoDestination, { selectedId = null } = {}) {
  if (normalizeAisHideNoDestination(hideNoDestination) !== true) return true;
  const id = String(record?.mmsi || record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return vesselHasDestination(record);
}

/**
 * Keep vessels with a filled destination when Hide no dest is on.
 * Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [hideNoDestination=DEFAULT_AIS_HIDE_NO_DESTINATION]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterVesselsByHideNoDest(
  records,
  hideNoDestination = DEFAULT_AIS_HIDE_NO_DESTINATION,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeAisHideNoDestination(hideNoDestination) !== true) return records.slice();
  return records.filter((record) => (
    vesselMatchesHideNoDestFilter(record, true, { selectedId })
  ));
}

/**
 * Data-row chip model. Params carry the flipped boolean.
 * @param {unknown} [current=DEFAULT_AIS_HIDE_NO_DESTINATION]
 * @returns {object}
 */
export function aisHideNoDestChipModel(current = DEFAULT_AIS_HIDE_NO_DESTINATION) {
  const hide = normalizeAisHideNoDestination(current) === true;
  return {
    id: 'hide-no-dest',
    label: AIS_HIDE_NO_DEST_CHIP_LABEL,
    title: AIS_HIDE_NO_DEST_CHIP_TITLE,
    active: hide,
    group: 'Destination',
    params: { hideNoDestination: !hide },
  };
}
