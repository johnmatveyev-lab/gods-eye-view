/**
 * Client-only Sites list Mapped only toggle.
 *
 * Uses `kind` already present on each viewport record
 * (`installation` from OSM, `place_candidate` from Google Places extras).
 * Never fetches Overpass or Places and adds no endpoint.
 * Persistence is local only (`meridian.sitesMappedOnly`) and is never
 * written into share URLs. LayerStateCoordinator restore of class /
 * footprints / named / osmType does not wipe this key; the hosted list
 * re-reads it when painting rows.
 *
 * Off is the current 50-row list. On drops `kind === 'place_candidate'`.
 * Missing kind and `installation` stay. Distinct from Plan 151 class
 * chips, Plan 165 Footprints only, Plan 186 Named only, Plan 202
 * OSM-type chips, and the globe Mapped only chip (those filter globe
 * stems).
 */

export const DEFAULT_SITES_MAPPED_ONLY = false;
export const SITES_MAPPED_ONLY_STORAGE_KEY = 'meridian.sitesMappedOnly';
export const SITES_MAPPED_ONLY_CHIP_LABEL = 'Mapped only';
export const SITES_MAPPED_ONLY_CHIP_TITLE =
  'Hide Google Places candidates from this list';

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
export function normalizeSitesMappedOnly(value) {
  if (value == null || value === '') return DEFAULT_SITES_MAPPED_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Whether this viewport record is a Google Places extra.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function installationIsPlaceCandidate(record) {
  return String(record?.kind || '') === 'place_candidate';
}

/**
 * Whether one viewport record clears Mapped only.
 * Off always passes. Missing kind and `installation` stay.
 * @param {object|null|undefined} record
 * @param {unknown} mappedOnly
 * @returns {boolean}
 */
export function installationMatchesMappedFilter(record, mappedOnly) {
  if (normalizeSitesMappedOnly(mappedOnly) !== true) return true;
  return installationIsPlaceCandidate(record) !== true;
}

/**
 * Drop Google Places extras when Mapped only is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [mappedOnly=DEFAULT_SITES_MAPPED_ONLY]
 * @returns {Array<object>}
 */
export function filterInstallationsByMappedOnly(
  records,
  mappedOnly = DEFAULT_SITES_MAPPED_ONLY,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeSitesMappedOnly(mappedOnly) !== true) return records.slice();
  return records.filter((record) => installationMatchesMappedFilter(record, true));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_SITES_MAPPED_ONLY]
 * @returns {object}
 */
export function sitesMappedOnlyChipModel(current = DEFAULT_SITES_MAPPED_ONLY) {
  const only = normalizeSitesMappedOnly(current) === true;
  return {
    id: 'mapped-only',
    label: SITES_MAPPED_ONLY_CHIP_LABEL,
    title: SITES_MAPPED_ONLY_CHIP_TITLE,
    active: only,
    group: 'Mapped',
    params: { mappedOnly: !only },
  };
}

/**
 * Read `meridian.sitesMappedOnly`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readSitesMappedOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(SITES_MAPPED_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_SITES_MAPPED_ONLY;
    return normalizeSitesMappedOnly(raw) === true;
  } catch {
    return DEFAULT_SITES_MAPPED_ONLY;
  }
}

/**
 * Write `meridian.sitesMappedOnly` as `'1'` / `'0'`.
 * @param {unknown} mappedOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeSitesMappedOnly(mappedOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeSitesMappedOnly(mappedOnly);
    if (next == null) return false;
    store.setItem(SITES_MAPPED_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

export const filterViewportSitesList = filterInstallationsByMappedOnly;
export const readSitesListMappedPref = readSitesMappedOnly;
