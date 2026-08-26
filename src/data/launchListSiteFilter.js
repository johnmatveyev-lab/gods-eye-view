/**
 * Client-only Launches panel Hide no site toggle.
 *
 * Filters already-fetched Launch Library 2 panel rows by the `launchSite`
 * string `launchesPanelRows` already copies (`pad.name` /
 * `location.name`, else the Unknown launch site fallback). Never fetches
 * Launch Library 2 and adds no endpoint. Persistence is local only
 * (`meridian.launchListHideNoSite`) and is never written into share
 * URLs. LayerStateCoordinator restore of globe / LSP-type / mapped-only
 * / status / hide-no-provider options does not wipe this key; the hosted
 * list re-reads it when painting rows.
 *
 * Off is the current panel list (named + Unknown launch site stay).
 * On keeps a non-empty launchSite that is not the Unknown launch site
 * fallback. Empty / whitespace / Unknown launch site drop. Missing
 * launchSite fails closed. A selected id stays. Distinct from Plan 207
 * LSP-type chips, Plan 215 mapped-only, Plan 223 status chips, Plan 232
 * Hide no provider, and Plan 181 hide-unknown-site.
 */

export const DEFAULT_LAUNCH_LIST_HIDE_NO_SITE = false;
export const LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY = 'meridian.launchListHideNoSite';
export const LAUNCH_LIST_HIDE_NO_SITE_CHIP_LABEL = 'Hide no site';
export const LAUNCH_LIST_HIDE_NO_SITE_CHIP_TITLE =
  'Hide missions without a named launch site';
export const LAUNCH_LIST_UNKNOWN_SITE_LABEL = 'Unknown launch site';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function compactLabel(value) {
  if (value == null || value === '') return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeLaunchListHideNoSite(value) {
  if (value == null || value === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_SITE;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Read the copied panel `launchSite` (string or nested pad / location name).
 * Empty / whitespace collapse to ''.
 * @param {{launchSite?: unknown, pad?: {name?: unknown, location?: {name?: unknown}}}|null|undefined} row
 * @returns {string}
 */
export function launchListSiteName(row) {
  const direct = compactLabel(row?.launchSite);
  if (direct) return direct;
  const pad = compactLabel(row?.pad?.name);
  if (pad) return pad;
  return compactLabel(row?.pad?.location?.name);
}

/**
 * Whether a panel row already has a named pad (not the Unknown fallback).
 * @param {{launchSite?: unknown, pad?: {name?: unknown, location?: {name?: unknown}}}|null|undefined} row
 * @returns {boolean}
 */
export function launchListRowHasNamedSite(row) {
  const name = launchListSiteName(row);
  if (!name) return false;
  return name.toLowerCase() !== LAUNCH_LIST_UNKNOWN_SITE_LABEL.toLowerCase();
}

/**
 * Whether one panel row clears Hide no site.
 * Off always passes. A selected id stays.
 * Missing / empty / Unknown launch site fail closed when on.
 * @param {{id?: unknown, launchSite?: unknown, pad?: {name?: unknown, location?: {name?: unknown}}}|null|undefined} row
 * @param {unknown} hideNoSite
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function launchListRowMatchesSiteFilter(row, hideNoSite, { selectedId = null } = {}) {
  if (normalizeLaunchListHideNoSite(hideNoSite) !== true) return true;
  const id = String(row?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return launchListRowHasNamedSite(row);
}

/**
 * Drop unknown-site rows when Hide no site is on. Off returns a
 * shallow copy.
 * @param {Array<object>|null|undefined} rows
 * @param {unknown} [hideNoSite=DEFAULT_LAUNCH_LIST_HIDE_NO_SITE]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterLaunchListBySite(
  rows,
  hideNoSite = DEFAULT_LAUNCH_LIST_HIDE_NO_SITE,
  selectedId = null,
) {
  if (!Array.isArray(rows)) return [];
  if (normalizeLaunchListHideNoSite(hideNoSite) !== true) return rows.slice();
  return rows.filter((row) => launchListRowMatchesSiteFilter(row, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_LAUNCH_LIST_HIDE_NO_SITE]
 * @returns {object}
 */
export function launchListHideNoSiteChipModel(current = DEFAULT_LAUNCH_LIST_HIDE_NO_SITE) {
  const hide = normalizeLaunchListHideNoSite(current) === true;
  return {
    id: 'hide-no-site',
    label: LAUNCH_LIST_HIDE_NO_SITE_CHIP_LABEL,
    title: LAUNCH_LIST_HIDE_NO_SITE_CHIP_TITLE,
    active: hide,
    group: 'Site',
    params: { hideNoSite: !hide },
  };
}

/**
 * Read `meridian.launchListHideNoSite`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readLaunchListHideNoSite(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_SITE;
    return normalizeLaunchListHideNoSite(raw) === true;
  } catch {
    return DEFAULT_LAUNCH_LIST_HIDE_NO_SITE;
  }
}

/**
 * Write `meridian.launchListHideNoSite` as `'1'` / `'0'`.
 * @param {unknown} hideNoSite
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchListHideNoSite(hideNoSite, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeLaunchListHideNoSite(hideNoSite);
    if (next == null) return false;
    store.setItem(LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
