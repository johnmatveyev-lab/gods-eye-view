/**
 * Client-only military installations Named only toggle.
 *
 * Uses `hasName` stamped at normalize time from Overpass `tags.name` /
 * `tags['name:en']` (non-empty after trim). Places search rows already have
 * a name and carry `hasName: true`. Never fetches Overpass or Places and
 * adds no endpoint.
 * Persistence rides `military-installations` layerState (`namedOnly`) and
 * the local key `meridian.militaryNamedOnly`.
 *
 * Off is the current view (named + class-labeled pins). On skips records
 * with `hasName === false`. A selected installation stays. AND with Plan
 * 151 class chips and Plan 165 Footprints only happens at the
 * installations layer, not here.
 */

export const DEFAULT_INSTALLATION_NAMED_ONLY = false;
export const MILITARY_NAMED_ONLY_STORAGE_KEY = 'meridian.militaryNamedOnly';
export const INSTALLATION_NAMED_ONLY_CHIP_LABEL = 'Named only';
export const INSTALLATION_NAMED_ONLY_CHIP_TITLE =
  'Show only installations that already have an OSM or Places name';

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
export function normalizeInstallationNamedOnly(value) {
  if (value == null || value === '') return DEFAULT_INSTALLATION_NAMED_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Whether normalize (or Places) stamped a real name on this record.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function installationHasName(record) {
  return record?.hasName === true;
}

/**
 * Whether one in-memory installation clears Named only.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} namedOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function installationMatchesNamedFilter(record, namedOnly, { selectedId = null } = {}) {
  if (normalizeInstallationNamedOnly(namedOnly) !== true) return true;
  const id = String(record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return installationHasName(record);
}

/**
 * Keep named records when Named only is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [namedOnly=DEFAULT_INSTALLATION_NAMED_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterInstallationsByNamed(
  records,
  namedOnly = DEFAULT_INSTALLATION_NAMED_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeInstallationNamedOnly(namedOnly) !== true) return records.slice();
  return records.filter((record) => installationMatchesNamedFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean.
 * @param {unknown} [current=DEFAULT_INSTALLATION_NAMED_ONLY]
 * @returns {object}
 */
export function installationNamedOnlyChipModel(current = DEFAULT_INSTALLATION_NAMED_ONLY) {
  const only = normalizeInstallationNamedOnly(current) === true;
  return {
    id: 'named-only',
    label: INSTALLATION_NAMED_ONLY_CHIP_LABEL,
    title: INSTALLATION_NAMED_ONLY_CHIP_TITLE,
    active: only,
    group: 'Name',
    params: { namedOnly: !only },
  };
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readMilitaryNamedOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(MILITARY_NAMED_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_INSTALLATION_NAMED_ONLY;
    return normalizeInstallationNamedOnly(raw) === true;
  } catch {
    return DEFAULT_INSTALLATION_NAMED_ONLY;
  }
}

/**
 * @param {unknown} namedOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeMilitaryNamedOnly(namedOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeInstallationNamedOnly(namedOnly);
    if (next == null) return false;
    store.setItem(MILITARY_NAMED_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
