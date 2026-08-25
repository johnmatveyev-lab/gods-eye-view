/**
 * Client-only AIS hide-no-IMO toggle.
 *
 * Uses `imo` already present on each in-memory vessel
 * (`String(row.imo || '')`). Never fetches AISStream and adds no endpoint.
 * Persistence rides `ais-live-vessels` layerState (`hideNoImo`) and the
 * local key `meridian.aisHideNoImo`.
 *
 * When on, skip vessels whose IMO is missing, empty, or whitespace-only
 * (trim first). A selected vessel stays. AND with Plan 153 type chips,
 * Plan 157 Hide parked, Plan 162 min-speed, Plan 170 destination field,
 * Plan 175 Hide no dest, and Plan 180 Hide unnamed happens at the AIS
 * layer, not here.
 */

export const DEFAULT_AIS_HIDE_NO_IMO = false;
export const AIS_HIDE_NO_IMO_STORAGE_KEY = 'meridian.aisHideNoImo';
export const AIS_HIDE_NO_IMO_CHIP_LABEL = 'Hide no IMO';
export const AIS_HIDE_NO_IMO_CHIP_TITLE = 'Hide vessels with no IMO';

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Canonical on/off. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeAisHideNoImo(value) {
  if (value == null || value === '') return DEFAULT_AIS_HIDE_NO_IMO;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * IMO text from the AIS adapter field (`record.imo`).
 * Missing, empty, and whitespace-only collapse to empty. Trim first.
 * @param {object|null|undefined} record
 * @returns {string}
 */
export function vesselImoText(record) {
  return String(record?.imo ?? '').trim();
}

/**
 * Whether one in-memory vessel reports a filled IMO.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function vesselHasImo(record) {
  return Boolean(vesselImoText(record));
}

/**
 * Whether one in-memory vessel clears Hide no IMO.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} hideNoImo
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function vesselMatchesHideNoImoFilter(record, hideNoImo, { selectedId = null } = {}) {
  if (normalizeAisHideNoImo(hideNoImo) !== true) return true;
  const id = String(record?.mmsi || record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return vesselHasImo(record);
}

/**
 * Keep vessels with a filled IMO when Hide no IMO is on. Off returns a
 * shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [hideNoImo=DEFAULT_AIS_HIDE_NO_IMO]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterVesselsByHideNoImo(
  records,
  hideNoImo = DEFAULT_AIS_HIDE_NO_IMO,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeAisHideNoImo(hideNoImo) !== true) return records.slice();
  return records.filter((record) => (
    vesselMatchesHideNoImoFilter(record, true, { selectedId })
  ));
}

/**
 * Read `meridian.aisHideNoImo`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readAisHideNoImo(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(AIS_HIDE_NO_IMO_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_AIS_HIDE_NO_IMO;
    return normalizeAisHideNoImo(raw) === true;
  } catch {
    return DEFAULT_AIS_HIDE_NO_IMO;
  }
}

/**
 * Write `meridian.aisHideNoImo` as `'1'` / `'0'`.
 * @param {unknown} hideNoImo
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeAisHideNoImo(hideNoImo, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      AIS_HIDE_NO_IMO_STORAGE_KEY,
      normalizeAisHideNoImo(hideNoImo) === true ? '1' : '0',
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Data-row chip model. Params carry the flipped boolean.
 * @param {unknown} [current=DEFAULT_AIS_HIDE_NO_IMO]
 * @returns {object}
 */
export function aisHideNoImoChipModel(current = DEFAULT_AIS_HIDE_NO_IMO) {
  const hide = normalizeAisHideNoImo(current) === true;
  return {
    id: 'hide-no-imo',
    label: AIS_HIDE_NO_IMO_CHIP_LABEL,
    title: AIS_HIDE_NO_IMO_CHIP_TITLE,
    active: hide,
    group: 'IMO',
    params: { hideNoImo: !hide },
  };
}
