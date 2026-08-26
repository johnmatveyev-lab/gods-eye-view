/**
 * Client-only AIS Hide no last pos toggle.
 *
 * Uses `lastPositionEpoch` (unix seconds or ms) and `lastPositionUtc`
 * already present on each in-memory vessel — the same fields Plan 200
 * last-pos freshness reads. Never fetches AISStream and adds no
 * endpoint. Persistence is local only (`meridian.aisHideNoLastPos` as
 * `'1'` / `'0'`) and is never written into share URLs.
 * LayerStateCoordinator restore re-reads the key.
 *
 * Off is the current view (missing both timestamps stay). On keeps a
 * finite `lastPositionEpoch` or a parseable `lastPositionUtc`. Both
 * missing fail closed (drop). A selected vessel stays. AND with Plan
 * 153 type chips, Plan 157 Hide parked, Plan 162 min-speed, Plan 170
 * destination field, Plan 175 Hide no dest, Plan 180 Hide unnamed,
 * Plan 189 Hide no IMO, Plan 200 last-pos freshness, Plan 237 Hide no
 * heading, Plan 246 Hide no type, and Plan 254 Hide no speed happens
 * at the AIS layer, not here. Distinct from those chips: Plan 200
 * fail-opens when both timestamps are missing; this is presence-only
 * and fail-closes.
 */

export const DEFAULT_AIS_HIDE_NO_LAST_POS = false;
export const AIS_HIDE_NO_LAST_POS_STORAGE_KEY = 'meridian.aisHideNoLastPos';
export const AIS_HIDE_NO_LAST_POS_CHIP_LABEL = 'Hide no last pos';
export const AIS_HIDE_NO_LAST_POS_CHIP_TITLE = 'Hide vessels with no last position';

/** Values at or above this magnitude are treated as epoch milliseconds. */
const EPOCH_MS_THRESHOLD = 1e11;

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
export function normalizeAisHideNoLastPos(value) {
  if (value == null || value === '') return DEFAULT_AIS_HIDE_NO_LAST_POS;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Epoch milliseconds from `lastPositionEpoch` (seconds or ms) with
 * `lastPositionUtc` Date / ISO fallback. Missing both is null.
 * @param {object|null|undefined} record
 * @returns {number|null}
 */
export function vesselLastPositionStampMs(record) {
  const epoch = record?.lastPositionEpoch;
  if (Number.isFinite(epoch)) {
    return epoch >= EPOCH_MS_THRESHOLD ? epoch : epoch * 1000;
  }
  const utc = record?.lastPositionUtc;
  if (utc instanceof Date) {
    const ms = utc.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (utc == null || utc === '') return null;
  const parsed = Date.parse(utc);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Whether one in-memory vessel already reports a last position.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function vesselHasLastPosition(record) {
  return vesselLastPositionStampMs(record) != null;
}

/**
 * Whether one in-memory vessel clears Hide no last pos.
 * Off always passes. A selected id stays. Both missing fail closed.
 * @param {object|null|undefined} record
 * @param {unknown} hideNoLastPos
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function vesselMatchesHideNoLastPosFilter(record, hideNoLastPos, { selectedId = null } = {}) {
  if (normalizeAisHideNoLastPos(hideNoLastPos) !== true) return true;
  const id = String(record?.mmsi || record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return vesselHasLastPosition(record);
}

/**
 * Keep vessels with a last-position stamp when Hide no last pos is on.
 * Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [hideNoLastPos=DEFAULT_AIS_HIDE_NO_LAST_POS]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterVesselsByHideNoLastPos(
  records,
  hideNoLastPos = DEFAULT_AIS_HIDE_NO_LAST_POS,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeAisHideNoLastPos(hideNoLastPos) !== true) return records.slice();
  return records.filter((record) => (
    vesselMatchesHideNoLastPosFilter(record, true, { selectedId })
  ));
}

/**
 * Read `meridian.aisHideNoLastPos`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readAisHideNoLastPos(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(AIS_HIDE_NO_LAST_POS_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_AIS_HIDE_NO_LAST_POS;
    return normalizeAisHideNoLastPos(raw) === true;
  } catch {
    return DEFAULT_AIS_HIDE_NO_LAST_POS;
  }
}

/**
 * Write `meridian.aisHideNoLastPos` as `'1'` / `'0'`.
 * @param {unknown} hideNoLastPos
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeAisHideNoLastPos(hideNoLastPos, storage) {
  const normalized = normalizeAisHideNoLastPos(hideNoLastPos);
  if (normalized == null) return false;
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(AIS_HIDE_NO_LAST_POS_STORAGE_KEY, normalized ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/**
 * Data-row chip model. Params carry the flipped boolean.
 * @param {unknown} [current=DEFAULT_AIS_HIDE_NO_LAST_POS]
 * @returns {object}
 */
export function aisHideNoLastPosChipModel(current = DEFAULT_AIS_HIDE_NO_LAST_POS) {
  const hide = normalizeAisHideNoLastPos(current) === true;
  return {
    id: 'hide-no-last-pos',
    label: AIS_HIDE_NO_LAST_POS_CHIP_LABEL,
    title: AIS_HIDE_NO_LAST_POS_CHIP_TITLE,
    active: hide,
    group: 'Position',
    params: { hideNoLastPos: !hide },
  };
}
