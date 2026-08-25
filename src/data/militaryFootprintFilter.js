/**
 * Client-only military installations footprints-only toggle.
 *
 * Uses `footprint` already present on each in-memory OSM/Places record
 * (`[lon, lat]` ring from normalize, or null). Never fetches Overpass or
 * Places and adds no endpoint.
 * Persistence rides `military-installations` layerState (`footprintsOnly`).
 *
 * Off is the current view (points + polygons). On skips records with no
 * usable footprint polygon. A selected installation stays. AND with Plan
 * 151 class chips happens at the installations layer, not here.
 */

export const DEFAULT_INSTALLATION_FOOTPRINTS_ONLY = false;
export const INSTALLATION_FOOTPRINTS_ONLY_CHIP_LABEL = 'Footprints only';
export const INSTALLATION_FOOTPRINTS_ONLY_CHIP_TITLE =
  'Show only bases that already have a drawn footprint polygon';

/**
 * Canonical on/off. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeInstallationFootprintsOnly(value) {
  if (value == null || value === '') return DEFAULT_INSTALLATION_FOOTPRINTS_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Whether `record.footprint` is a drawable polygon ring.
 * Missing, empty, or fewer than three finite [lon, lat] vertices is a pin.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function installationHasUsableFootprint(record) {
  const ring = record?.footprint;
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let usable = 0;
  for (const point of ring) {
    const lon = Number(Array.isArray(point) ? point[0] : undefined);
    const lat = Number(Array.isArray(point) ? point[1] : undefined);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    usable += 1;
    if (usable >= 3) return true;
  }
  return false;
}

/**
 * Whether one in-memory installation clears Footprints only.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} footprintsOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function installationMatchesFootprintFilter(record, footprintsOnly, { selectedId = null } = {}) {
  if (normalizeInstallationFootprintsOnly(footprintsOnly) !== true) return true;
  const id = String(record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return installationHasUsableFootprint(record);
}

/**
 * Keep outlined bases when Footprints only is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [footprintsOnly=DEFAULT_INSTALLATION_FOOTPRINTS_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterInstallationsByFootprint(
  records,
  footprintsOnly = DEFAULT_INSTALLATION_FOOTPRINTS_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeInstallationFootprintsOnly(footprintsOnly) !== true) return records.slice();
  return records.filter((record) => installationMatchesFootprintFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean.
 * @param {unknown} [current=DEFAULT_INSTALLATION_FOOTPRINTS_ONLY]
 * @returns {object}
 */
export function installationFootprintsOnlyChipModel(current = DEFAULT_INSTALLATION_FOOTPRINTS_ONLY) {
  const only = normalizeInstallationFootprintsOnly(current) === true;
  return {
    id: 'footprints-only',
    label: INSTALLATION_FOOTPRINTS_ONLY_CHIP_LABEL,
    title: INSTALLATION_FOOTPRINTS_ONLY_CHIP_TITLE,
    active: only,
    group: 'Footprint',
    params: { footprintsOnly: !only },
  };
}
