/**
 * Client-only Launches panel Hide no orbit toggle.
 *
 * Filters already-fetched Launch Library 2 panel rows by the `orbit`
 * string `launchesPanelRows` already copies (`orbit.name` or string
 * `orbit`, else `mission.orbit`). Never fetches Launch Library 2 and
 * adds no endpoint. Persistence is local only
 * (`meridian.launchListHideNoOrbit`) and is never written into share
 * URLs. LayerStateCoordinator restore of globe / LSP-type / mapped-only
 * / status / hide-no-provider / hide-no-site / hide-no-time /
 * hide-no-vehicle options does not wipe this key; the hosted list
 * re-reads it when painting rows.
 *
 * Off is the current panel list (missing + empty + named orbit stay).
 * On keeps a non-empty trimmed orbit (Low Earth Orbit stays). Empty /
 * whitespace / missing fail closed. A selected id stays. Distinct from
 * Plan 207 LSP-type chips, Plan 215 mapped-only, Plan 223 status chips,
 * Plan 232 Hide no provider, Plan 239 Hide no site, Plan 248 Hide no
 * time, Plan 257 Hide no vehicle, and globe `meridian.launchOrbit`
 * class chips (LEO / MEO / GEO / Polar / Other, which map missing to
 * Other). This is presence-only, not an orbit-class chip.
 */

export const DEFAULT_LAUNCH_LIST_HIDE_NO_ORBIT = false;
export const LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY = 'meridian.launchListHideNoOrbit';
export const LAUNCH_LIST_HIDE_NO_ORBIT_CHIP_LABEL = 'Hide no orbit';
export const LAUNCH_LIST_HIDE_NO_ORBIT_CHIP_TITLE =
  'Hide missions without a named orbit';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function trimmedOrbitField(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && typeof value.name === 'string') {
    return value.name.trim();
  }
  if (value != null && value !== '') return String(value).trim();
  return '';
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeLaunchListHideNoOrbit(value) {
  if (value == null || value === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_ORBIT;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Read the copied panel `orbit` (string or `{ name }`, else
 * `mission.orbit`). Empty / whitespace collapse to ''.
 * @param {{
 *   orbit?: unknown,
 *   mission?: {orbit?: unknown}
 * }|null|undefined} row
 * @returns {string}
 */
export function launchListOrbitName(row) {
  const copied = trimmedOrbitField(row?.orbit);
  if (copied) return copied;
  return trimmedOrbitField(row?.mission?.orbit);
}

/**
 * Whether a panel row already has a named orbit.
 * @param {{
 *   orbit?: unknown,
 *   mission?: {orbit?: unknown}
 * }|null|undefined} row
 * @returns {boolean}
 */
export function launchListRowHasOrbit(row) {
  return launchListOrbitName(row) !== '';
}

/**
 * Whether one panel row clears Hide no orbit.
 * Off always passes. A selected id stays.
 * Empty / whitespace / missing fail closed when on.
 * @param {{
 *   id?: unknown,
 *   orbit?: unknown,
 *   mission?: {orbit?: unknown}
 * }|null|undefined} row
 * @param {unknown} hideNoOrbit
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function launchListRowMatchesOrbitFilter(row, hideNoOrbit, { selectedId = null } = {}) {
  if (normalizeLaunchListHideNoOrbit(hideNoOrbit) !== true) return true;
  const id = String(row?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return launchListRowHasOrbit(row);
}

/**
 * Drop missing / empty-orbit rows when Hide no orbit is on. Off
 * returns a shallow copy.
 * @param {Array<object>|null|undefined} rows
 * @param {unknown} [hideNoOrbit=DEFAULT_LAUNCH_LIST_HIDE_NO_ORBIT]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterLaunchListByOrbit(
  rows,
  hideNoOrbit = DEFAULT_LAUNCH_LIST_HIDE_NO_ORBIT,
  selectedId = null,
) {
  if (!Array.isArray(rows)) return [];
  if (normalizeLaunchListHideNoOrbit(hideNoOrbit) !== true) return rows.slice();
  return rows.filter((row) => launchListRowMatchesOrbitFilter(row, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_LAUNCH_LIST_HIDE_NO_ORBIT]
 * @returns {object}
 */
export function launchListHideNoOrbitChipModel(current = DEFAULT_LAUNCH_LIST_HIDE_NO_ORBIT) {
  const hide = normalizeLaunchListHideNoOrbit(current) === true;
  return {
    id: 'hide-no-orbit',
    label: LAUNCH_LIST_HIDE_NO_ORBIT_CHIP_LABEL,
    title: LAUNCH_LIST_HIDE_NO_ORBIT_CHIP_TITLE,
    active: hide,
    group: 'Orbit',
    params: { hideNoOrbit: !hide },
  };
}

/**
 * Read `meridian.launchListHideNoOrbit`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readLaunchListHideNoOrbit(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_ORBIT;
    return normalizeLaunchListHideNoOrbit(raw) === true;
  } catch {
    return DEFAULT_LAUNCH_LIST_HIDE_NO_ORBIT;
  }
}

/**
 * Write `meridian.launchListHideNoOrbit` as `'1'` / `'0'`.
 * @param {unknown} hideNoOrbit
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchListHideNoOrbit(hideNoOrbit, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeLaunchListHideNoOrbit(hideNoOrbit);
    if (next == null) return false;
    store.setItem(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
