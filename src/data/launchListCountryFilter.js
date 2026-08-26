/**
 * Client-only Launches panel Hide no country toggle.
 *
 * Filters already-fetched Launch Library 2 panel rows by the trimmed
 * `country` string `launchesPanelRows` copies (`pad.country.name` else
 * `pad.location.country.name`). Never fetches Launch Library 2 and adds
 * no endpoint. Persistence is local only
 * (`meridian.launchListHideNoCountry`) and is never written into share
 * URLs. LayerStateCoordinator restore of globe / LSP-type / mapped-only
 * / status / hide-no-provider / hide-no-site / hide-no-time /
 * hide-no-vehicle / hide-no-orbit / webcast-only / hide-no-mission /
 * hide-no-probability options does not wipe this key; the hosted list
 * re-reads it when painting rows.
 *
 * Off is the current panel list (missing + whitespace + named country
 * stay). On keeps a non-empty trimmed country (United States stays).
 * Empty / whitespace / missing fail closed. A selected id stays.
 * Distinct from Plan 207 LSP-type chips, Plan 215 mapped-only, Plan
 * 223 status chips, Plan 232 Hide no provider, Plan 239 Hide no site
 * (`pad.name` / `location.name`), Plan 248 Hide no time, Plan 257 Hide
 * no vehicle, Plan 264 Hide no orbit, Plan 272 Webcast only, Plan 283
 * Hide no mission, Plan 289 Hide no probability, and the globe launch
 * layer. This is presence-only, not a country-name chip.
 */

export const DEFAULT_LAUNCH_LIST_HIDE_NO_COUNTRY = false;
export const LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY = 'meridian.launchListHideNoCountry';
export const LAUNCH_LIST_HIDE_NO_COUNTRY_CHIP_LABEL = 'Hide no country';
export const LAUNCH_LIST_HIDE_NO_COUNTRY_CHIP_TITLE =
  'Hide missions without a pad country';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function trimmedCountryField(value) {
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
export function normalizeLaunchListHideNoCountry(value) {
  if (value == null || value === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_COUNTRY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Read the copied panel `country`, else `pad.country.name`, else
 * `pad.location.country.name`. Empty / whitespace collapse to ''.
 * @param {{
 *   country?: unknown,
 *   pad?: {country?: unknown, location?: {country?: unknown}}
 * }|null|undefined} row
 * @returns {string}
 */
export function launchListCountryName(row) {
  const copied = trimmedCountryField(row?.country);
  if (copied) return copied;
  const padCountry = trimmedCountryField(row?.pad?.country);
  if (padCountry) return padCountry;
  return trimmedCountryField(row?.pad?.location?.country);
}

/**
 * Whether a panel row already has a named pad country.
 * @param {{
 *   country?: unknown,
 *   pad?: {country?: unknown, location?: {country?: unknown}}
 * }|null|undefined} row
 * @returns {boolean}
 */
export function launchListRowHasCountry(row) {
  return launchListCountryName(row) !== '';
}

/**
 * Whether one panel row clears Hide no country.
 * Off always passes. A selected id stays.
 * Empty / whitespace / missing fail closed when on.
 * @param {{
 *   id?: unknown,
 *   country?: unknown,
 *   pad?: {country?: unknown, location?: {country?: unknown}}
 * }|null|undefined} row
 * @param {unknown} hideNoCountry
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function launchListRowMatchesCountryFilter(row, hideNoCountry, { selectedId = null } = {}) {
  if (normalizeLaunchListHideNoCountry(hideNoCountry) !== true) return true;
  const id = String(row?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return launchListRowHasCountry(row);
}

/**
 * Drop missing / whitespace-country rows when Hide no country is on.
 * Off returns a shallow copy. A trimmed country stays.
 * @param {Array<object>|null|undefined} rows
 * @param {unknown} [hideNoCountry=DEFAULT_LAUNCH_LIST_HIDE_NO_COUNTRY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterLaunchListByCountry(
  rows,
  hideNoCountry = DEFAULT_LAUNCH_LIST_HIDE_NO_COUNTRY,
  selectedId = null,
) {
  if (!Array.isArray(rows)) return [];
  if (normalizeLaunchListHideNoCountry(hideNoCountry) !== true) return rows.slice();
  return rows.filter((row) => launchListRowMatchesCountryFilter(row, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_LAUNCH_LIST_HIDE_NO_COUNTRY]
 * @returns {object}
 */
export function launchListHideNoCountryChipModel(current = DEFAULT_LAUNCH_LIST_HIDE_NO_COUNTRY) {
  const hide = normalizeLaunchListHideNoCountry(current) === true;
  return {
    id: 'hide-no-country',
    label: LAUNCH_LIST_HIDE_NO_COUNTRY_CHIP_LABEL,
    title: LAUNCH_LIST_HIDE_NO_COUNTRY_CHIP_TITLE,
    active: hide,
    group: 'Country',
    params: { hideNoCountry: !hide },
  };
}

/**
 * Read `meridian.launchListHideNoCountry`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readLaunchListHideNoCountry(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_COUNTRY;
    return normalizeLaunchListHideNoCountry(raw) === true;
  } catch {
    return DEFAULT_LAUNCH_LIST_HIDE_NO_COUNTRY;
  }
}

/**
 * Write `meridian.launchListHideNoCountry` as `'1'` / `'0'`.
 * @param {unknown} hideNoCountry
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchListHideNoCountry(hideNoCountry, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeLaunchListHideNoCountry(hideNoCountry);
    if (next == null) return false;
    store.setItem(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
