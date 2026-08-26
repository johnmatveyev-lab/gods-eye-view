/**
 * Client-only Launches panel Hide no mission toggle.
 *
 * Filters already-fetched Launch Library 2 panel rows by the `mission`
 * string `launchesPanelRows` copies (`mission.name` or string `mission`,
 * else `mission_name`). Never fetches Launch Library 2 and adds no
 * endpoint. Persistence is local only
 * (`meridian.launchListHideNoMission`) and is never written into share
 * URLs. LayerStateCoordinator restore of globe / LSP-type / mapped-only
 * / status / hide-no-provider / hide-no-site / hide-no-time /
 * hide-no-vehicle / hide-no-orbit / webcast-only options does not wipe
 * this key; the hosted list re-reads it when painting rows.
 *
 * Off is the current panel list (missing + empty + named mission stay).
 * On keeps a non-empty trimmed mission (Starlink Group 10-1 stays).
 * Empty / whitespace / missing fail closed. A selected id stays.
 * Distinct from Plan 207 LSP-type chips, Plan 215 mapped-only, Plan
 * 223 status chips, Plan 232 Hide no provider, Plan 239 Hide no site,
 * Plan 248 Hide no time, Plan 257 Hide no vehicle, Plan 264 Hide no
 * orbit, and Plan 272 Webcast only. This is presence-only, not a
 * mission-name chip.
 */

export const DEFAULT_LAUNCH_LIST_HIDE_NO_MISSION = false;
export const LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY = 'meridian.launchListHideNoMission';
export const LAUNCH_LIST_HIDE_NO_MISSION_CHIP_LABEL = 'Hide no mission';
export const LAUNCH_LIST_HIDE_NO_MISSION_CHIP_TITLE =
  'Hide missions without a named mission';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function trimmedMissionField(value) {
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
export function normalizeLaunchListHideNoMission(value) {
  if (value == null || value === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_MISSION;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Read the copied panel `mission` (string or `{ name }`, else
 * `mission_name`). Empty / whitespace collapse to ''.
 * @param {{
 *   mission?: unknown,
 *   mission_name?: unknown
 * }|null|undefined} row
 * @returns {string}
 */
export function launchListMissionName(row) {
  const copied = trimmedMissionField(row?.mission);
  if (copied) return copied;
  return trimmedMissionField(row?.mission_name);
}

/**
 * Whether a panel row already has a named mission.
 * @param {{
 *   mission?: unknown,
 *   mission_name?: unknown
 * }|null|undefined} row
 * @returns {boolean}
 */
export function launchListRowHasMission(row) {
  return launchListMissionName(row) !== '';
}

/**
 * Whether one panel row clears Hide no mission.
 * Off always passes. A selected id stays.
 * Empty / whitespace / missing fail closed when on.
 * @param {{
 *   id?: unknown,
 *   mission?: unknown,
 *   mission_name?: unknown
 * }|null|undefined} row
 * @param {unknown} hideNoMission
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function launchListRowMatchesMissionFilter(row, hideNoMission, { selectedId = null } = {}) {
  if (normalizeLaunchListHideNoMission(hideNoMission) !== true) return true;
  const id = String(row?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return launchListRowHasMission(row);
}

/**
 * Drop missing / empty-mission rows when Hide no mission is on. Off
 * returns a shallow copy.
 * @param {Array<object>|null|undefined} rows
 * @param {unknown} [hideNoMission=DEFAULT_LAUNCH_LIST_HIDE_NO_MISSION]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterLaunchListByMission(
  rows,
  hideNoMission = DEFAULT_LAUNCH_LIST_HIDE_NO_MISSION,
  selectedId = null,
) {
  if (!Array.isArray(rows)) return [];
  if (normalizeLaunchListHideNoMission(hideNoMission) !== true) return rows.slice();
  return rows.filter((row) => launchListRowMatchesMissionFilter(row, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_LAUNCH_LIST_HIDE_NO_MISSION]
 * @returns {object}
 */
export function launchListHideNoMissionChipModel(current = DEFAULT_LAUNCH_LIST_HIDE_NO_MISSION) {
  const hide = normalizeLaunchListHideNoMission(current) === true;
  return {
    id: 'hide-no-mission',
    label: LAUNCH_LIST_HIDE_NO_MISSION_CHIP_LABEL,
    title: LAUNCH_LIST_HIDE_NO_MISSION_CHIP_TITLE,
    active: hide,
    group: 'Mission',
    params: { hideNoMission: !hide },
  };
}

/**
 * Read `meridian.launchListHideNoMission`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readLaunchListHideNoMission(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_MISSION;
    return normalizeLaunchListHideNoMission(raw) === true;
  } catch {
    return DEFAULT_LAUNCH_LIST_HIDE_NO_MISSION;
  }
}

/**
 * Write `meridian.launchListHideNoMission` as `'1'` / `'0'`.
 * @param {unknown} hideNoMission
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchListHideNoMission(hideNoMission, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeLaunchListHideNoMission(hideNoMission);
    if (next == null) return false;
    store.setItem(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
