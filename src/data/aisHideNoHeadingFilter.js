/**
 * Client-only AIS Hide no heading toggle.
 *
 * Uses `heading` and `course` already present on each in-memory vessel
 * (HUD is `heading ?? course`; icons rotate on the same pair). Never
 * fetches AISStream and adds no endpoint. Persistence is local only
 * (`meridian.aisHideNoHeading` as `'1'` / `'0'`) and is never written
 * into share URLs. LayerStateCoordinator restore re-reads the key.
 *
 * Off is the current view (heading-null / course-null stay). On keeps a
 * vessel when heading or course is finite. Both missing fails closed
 * (drop). A selected vessel stays. AND with Plan 153 type chips, Plan
 * 157 Hide parked, Plan 162 min-speed, Plan 170 destination field,
 * Plan 175 Hide no dest, Plan 180 Hide unnamed, Plan 189 Hide no IMO,
 * and Plan 200 last-pos freshness happens at the AIS layer, not here.
 * Distinct from those chips and from flights Hide no heading (234).
 */

export const DEFAULT_AIS_HIDE_NO_HEADING = false;
export const AIS_HIDE_NO_HEADING_STORAGE_KEY = 'meridian.aisHideNoHeading';
export const AIS_HIDE_NO_HEADING_CHIP_LABEL = 'Hide no heading';
export const AIS_HIDE_NO_HEADING_CHIP_TITLE = 'Hide vessels with no heading or course';

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
export function normalizeAisHideNoHeading(value) {
  if (value == null || value === '') return DEFAULT_AIS_HIDE_NO_HEADING;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Finite heading or course from the AIS adapter field. Missing, empty,
 * and non-finite collapse to null (same gate as `finiteNumber`).
 * @param {unknown} value
 * @returns {number|null}
 */
export function vesselFiniteDirection(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Whether one in-memory vessel already has a finite heading or course.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function vesselHasHeadingOrCourse(record) {
  return vesselFiniteDirection(record?.heading) != null
    || vesselFiniteDirection(record?.course) != null;
}

/**
 * Whether one in-memory vessel clears Hide no heading.
 * Off always passes. A selected id stays. Both missing fails closed.
 * @param {object|null|undefined} record
 * @param {unknown} hideNoHeading
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function vesselMatchesHideNoHeadingFilter(record, hideNoHeading, { selectedId = null } = {}) {
  if (normalizeAisHideNoHeading(hideNoHeading) !== true) return true;
  const id = String(record?.mmsi || record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return vesselHasHeadingOrCourse(record);
}

/**
 * Keep vessels with a finite heading or course when Hide no heading is
 * on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [hideNoHeading=DEFAULT_AIS_HIDE_NO_HEADING]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterVesselsByHideNoHeading(
  records,
  hideNoHeading = DEFAULT_AIS_HIDE_NO_HEADING,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeAisHideNoHeading(hideNoHeading) !== true) return records.slice();
  return records.filter((record) => (
    vesselMatchesHideNoHeadingFilter(record, true, { selectedId })
  ));
}

/**
 * Read `meridian.aisHideNoHeading`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readAisHideNoHeading(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(AIS_HIDE_NO_HEADING_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_AIS_HIDE_NO_HEADING;
    return normalizeAisHideNoHeading(raw) === true;
  } catch {
    return DEFAULT_AIS_HIDE_NO_HEADING;
  }
}

/**
 * Write `meridian.aisHideNoHeading` as `'1'` / `'0'`.
 * @param {unknown} hideNoHeading
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeAisHideNoHeading(hideNoHeading, storage) {
  const normalized = normalizeAisHideNoHeading(hideNoHeading);
  if (normalized == null) return false;
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(AIS_HIDE_NO_HEADING_STORAGE_KEY, normalized ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/**
 * Data-row chip model. Params carry the flipped boolean.
 * @param {unknown} [current=DEFAULT_AIS_HIDE_NO_HEADING]
 * @returns {object}
 */
export function aisHideNoHeadingChipModel(current = DEFAULT_AIS_HIDE_NO_HEADING) {
  const hide = normalizeAisHideNoHeading(current) === true;
  return {
    id: 'hide-no-heading',
    label: AIS_HIDE_NO_HEADING_CHIP_LABEL,
    title: AIS_HIDE_NO_HEADING_CHIP_TITLE,
    active: hide,
    group: 'Heading',
    params: { hideNoHeading: !hide },
  };
}
