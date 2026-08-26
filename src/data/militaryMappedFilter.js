/**
 * Client-only military installations Mapped only toggle (globe).
 *
 * Uses `kind` already stamped at normalize time (`installation` from OSM)
 * or Places search (`place_candidate` unless Google classified the row as
 * military land). Never fetches Overpass or Places and adds no endpoint.
 * Persistence is local only (`meridian.milMappedOnly`) and is never written
 * into share URLs. LayerStateCoordinator restore re-reads the persist
 * key on layer init; other military options do not wipe it.
 *
 * Off is the current view (OSM installations + Google Places extras).
 * On skips records with `kind === 'place_candidate'`. Missing kind and
 * `installation` stay. A selected site stays. AND with Plan 151 class
 * chips, Plan 165 Footprints only, Plan 186 Named only, and Plan 202
 * OSM-type chips happens at the installations layer, not here.
 *
 * Distinct from Plan 209 (Sites list only). This filter is the globe
 * installations surface.
 */

export const DEFAULT_INSTALLATION_MAPPED_ONLY = false;
export const MILITARY_MAPPED_ONLY_STORAGE_KEY = 'meridian.milMappedOnly';
export const INSTALLATION_MAPPED_ONLY_CHIP_LABEL = 'Mapped only';
export const INSTALLATION_MAPPED_ONLY_CHIP_TITLE =
  'Show only OSM-mapped installations, hiding Google Places extras';

function resolveStorage(injected) {
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
export function normalizeInstallationMappedOnly(value) {
  if (value == null || value === '') return DEFAULT_INSTALLATION_MAPPED_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Whether this row is a Google Places extra, not an OSM installation.
 * Missing kind is not a candidate.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function installationIsPlaceCandidate(record) {
  return record?.kind === 'place_candidate';
}

/**
 * Whether one in-memory installation clears Mapped only.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} mappedOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function installationMatchesMappedFilter(record, mappedOnly, { selectedId = null } = {}) {
  if (normalizeInstallationMappedOnly(mappedOnly) !== true) return true;
  const id = String(record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return !installationIsPlaceCandidate(record);
}

/**
 * Drop Google Places extras when Mapped only is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [mappedOnly=DEFAULT_INSTALLATION_MAPPED_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterInstallationsByMapped(
  records,
  mappedOnly = DEFAULT_INSTALLATION_MAPPED_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeInstallationMappedOnly(mappedOnly) !== true) return records.slice();
  return records.filter((record) => installationMatchesMappedFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean.
 * @param {unknown} [current=DEFAULT_INSTALLATION_MAPPED_ONLY]
 * @returns {object}
 */
export function installationMappedOnlyChipModel(current = DEFAULT_INSTALLATION_MAPPED_ONLY) {
  const only = normalizeInstallationMappedOnly(current) === true;
  return {
    id: 'mapped-only',
    label: INSTALLATION_MAPPED_ONLY_CHIP_LABEL,
    title: INSTALLATION_MAPPED_ONLY_CHIP_TITLE,
    active: only,
    group: 'Mapped',
    params: { mappedOnly: !only },
  };
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readMilitaryMappedOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(MILITARY_MAPPED_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_INSTALLATION_MAPPED_ONLY;
    return normalizeInstallationMappedOnly(raw) === true;
  } catch {
    return DEFAULT_INSTALLATION_MAPPED_ONLY;
  }
}

/**
 * @param {unknown} mappedOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeMilitaryMappedOnly(mappedOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeInstallationMappedOnly(mappedOnly);
    if (next == null) return false;
    store.setItem(MILITARY_MAPPED_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
