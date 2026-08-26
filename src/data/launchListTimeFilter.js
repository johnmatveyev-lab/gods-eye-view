/**
 * Client-only Launches panel Hide no time toggle.
 *
 * Filters already-fetched Launch Library 2 panel rows by the `launchTime`
 * string `launchesPanelRows` already copies (`net` / `window_start`, else
 * null when unparseable). Never fetches Launch Library 2 and adds no
 * endpoint. Persistence is local only
 * (`meridian.launchListHideNoTime`) and is never written into share
 * URLs. LayerStateCoordinator restore of globe / LSP-type / mapped-only
 * / status / hide-no-provider / hide-no-site options does not wipe this
 * key; the hosted list re-reads it when painting rows.
 *
 * Off is the current panel list (ISO times + null / missing stay).
 * On keeps a non-empty parseable launchTime (ISO stays). Missing /
 * null / unparseable fail closed. A selected id stays. Distinct from
 * Plan 207 LSP-type chips, Plan 215 mapped-only, Plan 223 status chips,
 * Plan 232 Hide no provider, and Plan 239 Hide no site.
 */

export const DEFAULT_LAUNCH_LIST_HIDE_NO_TIME = false;
export const LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY = 'meridian.launchListHideNoTime';
export const LAUNCH_LIST_HIDE_NO_TIME_CHIP_LABEL = 'Hide no time';
export const LAUNCH_LIST_HIDE_NO_TIME_CHIP_TITLE =
  'Hide missions without a launch time';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeLaunchListHideNoTime(value) {
  if (value == null || value === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_TIME;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Read the copied panel `launchTime` (string or net / window_start).
 * Empty / whitespace collapse to ''. Does not rewrite ISO.
 * @param {{launchTime?: unknown, net?: unknown, window_start?: unknown}|null|undefined} row
 * @returns {string}
 */
export function launchListLaunchTime(row) {
  if (typeof row?.launchTime === 'string') {
    const trimmed = row.launchTime.trim();
    if (trimmed) return trimmed;
  }
  const raw = row?.net || row?.window_start;
  if (typeof raw === 'string') return raw.trim();
  if (raw != null && raw !== '') return String(raw).trim();
  return '';
}

/**
 * Whether a panel row already has a non-empty parseable launchTime.
 * ISO strings stay. Missing / null / unparseable fail closed.
 * @param {{launchTime?: unknown, net?: unknown, window_start?: unknown}|null|undefined} row
 * @returns {boolean}
 */
export function launchListRowHasParseableTime(row) {
  const raw = launchListLaunchTime(row);
  if (!raw) return false;
  return Number.isFinite(Date.parse(raw));
}

/**
 * Whether one panel row clears Hide no time.
 * Off always passes. A selected id stays.
 * Missing / null / unparseable fail closed when on.
 * @param {{id?: unknown, launchTime?: unknown, net?: unknown, window_start?: unknown}|null|undefined} row
 * @param {unknown} hideNoTime
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function launchListRowMatchesTimeFilter(row, hideNoTime, { selectedId = null } = {}) {
  if (normalizeLaunchListHideNoTime(hideNoTime) !== true) return true;
  const id = String(row?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return launchListRowHasParseableTime(row);
}

/**
 * Drop missing / unparseable-time rows when Hide no time is on. Off
 * returns a shallow copy.
 * @param {Array<object>|null|undefined} rows
 * @param {unknown} [hideNoTime=DEFAULT_LAUNCH_LIST_HIDE_NO_TIME]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterLaunchListByTime(
  rows,
  hideNoTime = DEFAULT_LAUNCH_LIST_HIDE_NO_TIME,
  selectedId = null,
) {
  if (!Array.isArray(rows)) return [];
  if (normalizeLaunchListHideNoTime(hideNoTime) !== true) return rows.slice();
  return rows.filter((row) => launchListRowMatchesTimeFilter(row, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_LAUNCH_LIST_HIDE_NO_TIME]
 * @returns {object}
 */
export function launchListHideNoTimeChipModel(current = DEFAULT_LAUNCH_LIST_HIDE_NO_TIME) {
  const hide = normalizeLaunchListHideNoTime(current) === true;
  return {
    id: 'hide-no-time',
    label: LAUNCH_LIST_HIDE_NO_TIME_CHIP_LABEL,
    title: LAUNCH_LIST_HIDE_NO_TIME_CHIP_TITLE,
    active: hide,
    group: 'Time',
    params: { hideNoTime: !hide },
  };
}

/**
 * Read `meridian.launchListHideNoTime`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readLaunchListHideNoTime(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_TIME;
    return normalizeLaunchListHideNoTime(raw) === true;
  } catch {
    return DEFAULT_LAUNCH_LIST_HIDE_NO_TIME;
  }
}

/**
 * Write `meridian.launchListHideNoTime` as `'1'` / `'0'`.
 * @param {unknown} hideNoTime
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchListHideNoTime(hideNoTime, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeLaunchListHideNoTime(hideNoTime);
    if (next == null) return false;
    store.setItem(LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
