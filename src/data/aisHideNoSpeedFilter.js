/**
 * Client-only AIS Hide no speed toggle.
 *
 * Uses `speed` (knots, nullable) already present on each in-memory
 * vessel — the same field Plan 157 Hide parked and Plan 162 min-speed
 * read. Never fetches AISStream and adds no endpoint. Persistence is
 * local only (`meridian.aisHideNoSpeed` as `'1'` / `'0'`) and is never
 * written into share URLs. LayerStateCoordinator restore re-reads the
 * key.
 *
 * Off is the current view (null / missing / non-finite speed stay). On
 * keeps a finite speed (0 stays — parked, not missing). Missing /
 * non-finite fails closed (drop). A selected vessel stays. AND with
 * Plan 153 type chips, Plan 157 Hide parked, Plan 162 min-speed, Plan
 * 170 destination field, Plan 175 Hide no dest, Plan 180 Hide unnamed,
 * Plan 189 Hide no IMO, Plan 200 last-pos freshness, Plan 237 Hide no
 * heading, and Plan 246 Hide no type happens at the AIS layer, not
 * here. Distinct from those chips: parked is `speed === 0`; the
 * min-speed floor fails open on missing; this is presence-only.
 */

export const DEFAULT_AIS_HIDE_NO_SPEED = false;
export const AIS_HIDE_NO_SPEED_STORAGE_KEY = 'meridian.aisHideNoSpeed';
export const AIS_HIDE_NO_SPEED_CHIP_LABEL = 'Hide no speed';
export const AIS_HIDE_NO_SPEED_CHIP_TITLE = 'Hide vessels with no speed';

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
export function normalizeAisHideNoSpeed(value) {
  if (value == null || value === '') return DEFAULT_AIS_HIDE_NO_SPEED;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Knots from the AIS adapter field (`record.speed`). Non-finite is
 * missing. 0 is a real parked speed, not missing.
 * @param {object|null|undefined} record
 * @returns {number|null}
 */
export function vesselSpeedKnots(record) {
  const speed = record?.speed;
  return Number.isFinite(speed) ? speed : null;
}

/**
 * Whether one in-memory vessel already reports a finite speed.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function vesselHasFiniteSpeed(record) {
  return vesselSpeedKnots(record) != null;
}

/**
 * Whether one in-memory vessel clears Hide no speed.
 * Off always passes. A selected id stays. Missing / non-finite
 * fails closed.
 * @param {object|null|undefined} record
 * @param {unknown} hideNoSpeed
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function vesselMatchesHideNoSpeedFilter(record, hideNoSpeed, { selectedId = null } = {}) {
  if (normalizeAisHideNoSpeed(hideNoSpeed) !== true) return true;
  const id = String(record?.mmsi || record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return vesselHasFiniteSpeed(record);
}

/**
 * Keep vessels with a finite speed when Hide no speed is on.
 * Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [hideNoSpeed=DEFAULT_AIS_HIDE_NO_SPEED]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterVesselsByHideNoSpeed(
  records,
  hideNoSpeed = DEFAULT_AIS_HIDE_NO_SPEED,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeAisHideNoSpeed(hideNoSpeed) !== true) return records.slice();
  return records.filter((record) => (
    vesselMatchesHideNoSpeedFilter(record, true, { selectedId })
  ));
}

/**
 * Read `meridian.aisHideNoSpeed`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readAisHideNoSpeed(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(AIS_HIDE_NO_SPEED_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_AIS_HIDE_NO_SPEED;
    return normalizeAisHideNoSpeed(raw) === true;
  } catch {
    return DEFAULT_AIS_HIDE_NO_SPEED;
  }
}

/**
 * Write `meridian.aisHideNoSpeed` as `'1'` / `'0'`.
 * @param {unknown} hideNoSpeed
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeAisHideNoSpeed(hideNoSpeed, storage) {
  const normalized = normalizeAisHideNoSpeed(hideNoSpeed);
  if (normalized == null) return false;
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(AIS_HIDE_NO_SPEED_STORAGE_KEY, normalized ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/**
 * Data-row chip model. Params carry the flipped boolean.
 * @param {unknown} [current=DEFAULT_AIS_HIDE_NO_SPEED]
 * @returns {object}
 */
export function aisHideNoSpeedChipModel(current = DEFAULT_AIS_HIDE_NO_SPEED) {
  const hide = normalizeAisHideNoSpeed(current) === true;
  return {
    id: 'hide-no-speed',
    label: AIS_HIDE_NO_SPEED_CHIP_LABEL,
    title: AIS_HIDE_NO_SPEED_CHIP_TITLE,
    active: hide,
    group: 'Reported',
    params: { hideNoSpeed: !hide },
  };
}
