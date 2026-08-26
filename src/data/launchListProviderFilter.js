/**
 * Client-only Launches panel Hide no provider toggle.
 *
 * Filters already-fetched Launch Library 2 panel rows by the `provider`
 * string `launchesPanelRows` already copies (`provider` or
 * `launch_service_provider.name`). Never fetches Launch Library 2 and
 * adds no endpoint. Persistence is local only
 * (`meridian.launchListHideNoProvider`) and is never written into share
 * URLs. LayerStateCoordinator restore of globe / LSP-type / mapped-only
 * / status options does not wipe this key; the hosted list re-reads it
 * when painting rows.
 *
 * Off is the current panel list (missing + present provider stay).
 * On drops rows whose provider is missing / empty / whitespace after
 * trim. Named providers such as SpaceX stay. A selected id stays.
 * Distinct from Plan 207 LSP-type chips, Plan 215 mapped-only,
 * Plan 223 status chips, and Plan 181 hide-unknown-site (not hide-ground).
 */

export const DEFAULT_LAUNCH_LIST_HIDE_NO_PROVIDER = false;
export const LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY = 'meridian.launchListHideNoProvider';
export const LAUNCH_LIST_HIDE_NO_PROVIDER_CHIP_LABEL = 'Hide no provider';
export const LAUNCH_LIST_HIDE_NO_PROVIDER_CHIP_TITLE =
  'Hide missions without a named launch service provider';

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
export function normalizeLaunchListHideNoProvider(value) {
  if (value == null || value === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_PROVIDER;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Read the copied panel `provider` (string or nested LSP name).
 * Empty / whitespace collapse to ''.
 * @param {{provider?: unknown, launch_service_provider?: {name?: unknown}}|null|undefined} row
 * @returns {string}
 */
export function launchListProviderName(row) {
  const direct = row?.provider;
  if (typeof direct === 'string') return direct.trim();
  if (direct != null && direct !== '') return String(direct).trim();
  const nested = row?.launch_service_provider?.name;
  if (typeof nested === 'string') return nested.trim();
  if (nested != null && nested !== '') return String(nested).trim();
  return '';
}

/**
 * Whether a panel row already has a named provider.
 * @param {{provider?: unknown, launch_service_provider?: {name?: unknown}}|null|undefined} row
 * @returns {boolean}
 */
export function launchListRowHasProvider(row) {
  return launchListProviderName(row) !== '';
}

/**
 * Whether one panel row clears Hide no provider.
 * Off always passes. A selected id stays.
 * @param {{id?: unknown, provider?: unknown, launch_service_provider?: {name?: unknown}}|null|undefined} row
 * @param {unknown} hideNoProvider
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function launchListRowMatchesProviderFilter(row, hideNoProvider, { selectedId = null } = {}) {
  if (normalizeLaunchListHideNoProvider(hideNoProvider) !== true) return true;
  const id = String(row?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return launchListRowHasProvider(row);
}

/**
 * Drop missing-provider rows when Hide no provider is on. Off returns a
 * shallow copy.
 * @param {Array<object>|null|undefined} rows
 * @param {unknown} [hideNoProvider=DEFAULT_LAUNCH_LIST_HIDE_NO_PROVIDER]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterLaunchListByProvider(
  rows,
  hideNoProvider = DEFAULT_LAUNCH_LIST_HIDE_NO_PROVIDER,
  selectedId = null,
) {
  if (!Array.isArray(rows)) return [];
  if (normalizeLaunchListHideNoProvider(hideNoProvider) !== true) return rows.slice();
  return rows.filter((row) => launchListRowMatchesProviderFilter(row, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_LAUNCH_LIST_HIDE_NO_PROVIDER]
 * @returns {object}
 */
export function launchListHideNoProviderChipModel(current = DEFAULT_LAUNCH_LIST_HIDE_NO_PROVIDER) {
  const hide = normalizeLaunchListHideNoProvider(current) === true;
  return {
    id: 'hide-no-provider',
    label: LAUNCH_LIST_HIDE_NO_PROVIDER_CHIP_LABEL,
    title: LAUNCH_LIST_HIDE_NO_PROVIDER_CHIP_TITLE,
    active: hide,
    group: 'Provider',
    params: { hideNoProvider: !hide },
  };
}

/**
 * Read `meridian.launchListHideNoProvider`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readLaunchListHideNoProvider(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_PROVIDER;
    return normalizeLaunchListHideNoProvider(raw) === true;
  } catch {
    return DEFAULT_LAUNCH_LIST_HIDE_NO_PROVIDER;
  }
}

/**
 * Write `meridian.launchListHideNoProvider` as `'1'` / `'0'`.
 * @param {unknown} hideNoProvider
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchListHideNoProvider(hideNoProvider, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeLaunchListHideNoProvider(hideNoProvider);
    if (next == null) return false;
    store.setItem(LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
