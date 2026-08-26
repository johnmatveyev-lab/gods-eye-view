/**
 * Client-only AIS Hide no type toggle.
 *
 * Uses `type_specific || type` already present on each in-memory vessel
 * (the same source Plan 153 type-name chips read after normalizeVessel
 * collapses `type_specific || type` onto `type`). Never fetches AISStream
 * and adds no endpoint. Persistence is local only
 * (`meridian.aisHideNoType` as `'1'` / `'0'`) and is never written into
 * share URLs. LayerStateCoordinator restore re-reads the key.
 *
 * Off is the current view (empty / missing type stay). On keeps a
 * non-empty trimmed type (Cargo stays). Missing / empty / whitespace-only
 * fails closed (drop). A selected vessel stays. AND with Plan 153 type
 * chips, Plan 157 Hide parked, Plan 162 min-speed, Plan 170 destination
 * field, Plan 175 Hide no dest, Plan 180 Hide unnamed, Plan 189 Hide no
 * IMO, Plan 200 last-pos freshness, and Plan 237 Hide no heading happens
 * at the AIS layer, not here. Distinct from those chips: type-name chips
 * pick a class; this is presence-only.
 */

export const DEFAULT_AIS_HIDE_NO_TYPE = false;
export const AIS_HIDE_NO_TYPE_STORAGE_KEY = 'meridian.aisHideNoType';
export const AIS_HIDE_NO_TYPE_CHIP_LABEL = 'Hide no type';
export const AIS_HIDE_NO_TYPE_CHIP_TITLE = 'Hide vessels with no type';

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
export function normalizeAisHideNoType(value) {
  if (value == null || value === '') return DEFAULT_AIS_HIDE_NO_TYPE;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Type text from the same source type-name chips already read
 * (`type_specific || type`). Missing, empty, and whitespace-only
 * collapse to empty. Trim first.
 * @param {object|null|undefined} record
 * @returns {string}
 */
export function vesselTypeText(record) {
  return String(record?.type_specific || record?.type || '').trim();
}

/**
 * Whether one in-memory vessel already reports a non-empty trimmed type.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function vesselHasType(record) {
  return Boolean(vesselTypeText(record));
}

/**
 * Whether one in-memory vessel clears Hide no type.
 * Off always passes. A selected id stays. Missing / empty / whitespace
 * fails closed.
 * @param {object|null|undefined} record
 * @param {unknown} hideNoType
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function vesselMatchesHideNoTypeFilter(record, hideNoType, { selectedId = null } = {}) {
  if (normalizeAisHideNoType(hideNoType) !== true) return true;
  const id = String(record?.mmsi || record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return vesselHasType(record);
}

/**
 * Keep vessels with a non-empty trimmed type when Hide no type is on.
 * Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [hideNoType=DEFAULT_AIS_HIDE_NO_TYPE]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterVesselsByHideNoType(
  records,
  hideNoType = DEFAULT_AIS_HIDE_NO_TYPE,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeAisHideNoType(hideNoType) !== true) return records.slice();
  return records.filter((record) => (
    vesselMatchesHideNoTypeFilter(record, true, { selectedId })
  ));
}

/**
 * Read `meridian.aisHideNoType`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readAisHideNoType(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(AIS_HIDE_NO_TYPE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_AIS_HIDE_NO_TYPE;
    return normalizeAisHideNoType(raw) === true;
  } catch {
    return DEFAULT_AIS_HIDE_NO_TYPE;
  }
}

/**
 * Write `meridian.aisHideNoType` as `'1'` / `'0'`.
 * @param {unknown} hideNoType
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeAisHideNoType(hideNoType, storage) {
  const normalized = normalizeAisHideNoType(hideNoType);
  if (normalized == null) return false;
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(AIS_HIDE_NO_TYPE_STORAGE_KEY, normalized ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/**
 * Data-row chip model. Params carry the flipped boolean.
 * @param {unknown} [current=DEFAULT_AIS_HIDE_NO_TYPE]
 * @returns {object}
 */
export function aisHideNoTypeChipModel(current = DEFAULT_AIS_HIDE_NO_TYPE) {
  const hide = normalizeAisHideNoType(current) === true;
  return {
    id: 'hide-no-type',
    label: AIS_HIDE_NO_TYPE_CHIP_LABEL,
    title: AIS_HIDE_NO_TYPE_CHIP_TITLE,
    active: hide,
    group: 'Typed',
    params: { hideNoType: !hide },
  };
}
