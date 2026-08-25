/**
 * Client-only AIS hide-unnamed toggle.
 *
 * Uses `name` already present on each in-memory vessel (HUD / cards).
 * Never fetches AISStream and adds no endpoint.
 * Persistence rides `ais-live-vessels` layerState (`hideUnnamed`).
 *
 * When on, skip vessels whose name is missing, empty, whitespace-only,
 * the generic VESSEL label (case-insensitive), the live-feed `MMSI n`
 * fallback, or the MMSI string itself. A selected vessel stays. AND
 * with Plan 153 type chips, Plan 157 Hide parked, Plan 162 min-speed,
 * Plan 170 destination field, and Plan 175 Hide no dest happens at the
 * AIS layer, not here.
 */

export const DEFAULT_AIS_HIDE_UNNAMED = false;
export const AIS_GENERIC_VESSEL_LABEL = 'VESSEL';
export const AIS_HIDE_UNNAMED_CHIP_LABEL = 'Hide unnamed';
export const AIS_HIDE_UNNAMED_CHIP_TITLE = 'Hide vessels with no name';

/**
 * Canonical on/off. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeAisHideUnnamed(value) {
  if (value == null || value === '') return DEFAULT_AIS_HIDE_UNNAMED;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Name text from the AIS adapter field (`record.name`).
 * Missing, empty, and whitespace-only collapse to empty.
 * @param {object|null|undefined} record
 * @returns {string}
 */
export function vesselNameText(record) {
  return String(record?.name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/**
 * Whether one in-memory vessel is MMSI-only or blank-named.
 * Live rows without a ship name arrive as `MMSI ${mmsi}` or the MMSI
 * itself; HUD/cards still always have a display string.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function vesselIsUnnamed(record) {
  const text = vesselNameText(record);
  if (!text) return true;
  if (text.toLowerCase() === AIS_GENERIC_VESSEL_LABEL.toLowerCase()) return true;
  if (/^MMSI\s*\d+$/i.test(text)) return true;
  const mmsi = String(record?.mmsi || '').trim();
  return Boolean(mmsi && text === mmsi);
}

/**
 * Whether one in-memory vessel reports a useful name.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function vesselHasName(record) {
  return vesselIsUnnamed(record) !== true;
}

/**
 * Whether one in-memory vessel clears Hide unnamed.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} hideUnnamed
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function vesselMatchesHideUnnamedFilter(record, hideUnnamed, { selectedId = null } = {}) {
  if (normalizeAisHideUnnamed(hideUnnamed) !== true) return true;
  const id = String(record?.mmsi || record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return vesselHasName(record);
}

/**
 * Keep named vessels when Hide unnamed is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [hideUnnamed=DEFAULT_AIS_HIDE_UNNAMED]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterVesselsByHideUnnamed(
  records,
  hideUnnamed = DEFAULT_AIS_HIDE_UNNAMED,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeAisHideUnnamed(hideUnnamed) !== true) return records.slice();
  return records.filter((record) => (
    vesselMatchesHideUnnamedFilter(record, true, { selectedId })
  ));
}

/**
 * Data-row chip model. Params carry the flipped boolean.
 * @param {unknown} [current=DEFAULT_AIS_HIDE_UNNAMED]
 * @returns {object}
 */
export function aisHideUnnamedChipModel(current = DEFAULT_AIS_HIDE_UNNAMED) {
  const hide = normalizeAisHideUnnamed(current) === true;
  return {
    id: 'hide-unnamed',
    label: AIS_HIDE_UNNAMED_CHIP_LABEL,
    title: AIS_HIDE_UNNAMED_CHIP_TITLE,
    active: hide,
    group: 'Name',
    params: { hideUnnamed: !hide },
  };
}
