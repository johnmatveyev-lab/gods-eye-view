/**
 * Client-only Sites list Named only toggle.
 *
 * Uses `hasName` already stamped on each viewport record (real OSM
 * `tags.name` / `name:en`, or a Places name). Class-fallback rows carry
 * `hasName === false` so "Military land" labels fill the 50-cap. Never
 * fetches Overpass or Places and adds no endpoint.
 * Persistence is local only (`meridian.sitesNamedOnly`) and is never
 * written into share URLs. LayerStateCoordinator restore of class /
 * footprints / named / osmType / mapped does not wipe this key; the
 * hosted list re-reads it when painting rows.
 *
 * Off is the current 50-row list (named + unnamed). On keeps
 * `hasName === true` and drops class-fallback rows. Missing `hasName`
 * fails open (keep). AND with Plan 209 Mapped only happens in
 * `listViewportInstallations`. Distinct from Plan 151 class chips,
 * Plan 165 Footprints only, Plan 186 globe Named only, Plan 202
 * OSM-type chips, Plan 209 list Mapped only, and Plan 212 globe
 * Mapped only.
 */

export const DEFAULT_SITES_NAMED_ONLY = false;
export const SITES_NAMED_ONLY_STORAGE_KEY = 'meridian.sitesNamedOnly';
export const SITES_NAMED_ONLY_CHIP_LABEL = 'Named only';
export const SITES_NAMED_ONLY_CHIP_TITLE =
  'Hide unnamed class-fallback sites from this list';

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
export function normalizeSitesNamedOnly(value) {
  if (value == null || value === '') return DEFAULT_SITES_NAMED_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Whether this viewport record already has a real OSM or Places name.
 * Missing `hasName` is not a name.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function installationListHasName(record) {
  return record?.hasName === true;
}

/**
 * Whether one viewport record clears Named only.
 * Off always passes. Missing `hasName` stays (fail open).
 * @param {object|null|undefined} record
 * @param {unknown} namedOnly
 * @returns {boolean}
 */
export function installationMatchesNamedListFilter(record, namedOnly) {
  if (normalizeSitesNamedOnly(namedOnly) !== true) return true;
  if (record == null || !Object.hasOwn(record, 'hasName') || record.hasName == null) return true;
  return record.hasName === true;
}

/**
 * Drop class-fallback rows when Named only is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [namedOnly=DEFAULT_SITES_NAMED_ONLY]
 * @returns {Array<object>}
 */
export function filterInstallationsByNamedOnly(
  records,
  namedOnly = DEFAULT_SITES_NAMED_ONLY,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeSitesNamedOnly(namedOnly) !== true) return records.slice();
  return records.filter((record) => installationMatchesNamedListFilter(record, true));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_SITES_NAMED_ONLY]
 * @returns {object}
 */
export function sitesNamedOnlyChipModel(current = DEFAULT_SITES_NAMED_ONLY) {
  const only = normalizeSitesNamedOnly(current) === true;
  return {
    id: 'named-only',
    label: SITES_NAMED_ONLY_CHIP_LABEL,
    title: SITES_NAMED_ONLY_CHIP_TITLE,
    active: only,
    group: 'Name',
    params: { namedOnly: !only },
  };
}

/**
 * Read `meridian.sitesNamedOnly`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readSitesNamedOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(SITES_NAMED_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_SITES_NAMED_ONLY;
    return normalizeSitesNamedOnly(raw) === true;
  } catch {
    return DEFAULT_SITES_NAMED_ONLY;
  }
}

/**
 * Write `meridian.sitesNamedOnly` as `'1'` / `'0'`.
 * @param {unknown} namedOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeSitesNamedOnly(namedOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeSitesNamedOnly(namedOnly);
    if (next == null) return false;
    store.setItem(SITES_NAMED_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

export const filterViewportSitesListNamed = filterInstallationsByNamedOnly;
export const readSitesListNamedPref = readSitesNamedOnly;
