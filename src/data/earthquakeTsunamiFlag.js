/**
 * Client-only earthquake tsunami-flag filter. Uses properties.tsunami
 * already present on USGS all_day GeoJSON. Does not change the product
 * or fetch.
 */

export const DEFAULT_EARTHQUAKE_TSUNAMI_ONLY = false;
export const EARTHQUAKE_TSUNAMI_CHIP_LABEL = 'Tsunami only';
export const EARTHQUAKE_TSUNAMI_CHIP_TITLE = 'Show only tsunami-flagged earthquakes';

/**
 * Canonical on/off. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeEarthquakeTsunamiOnly(value) {
  if (value == null || value === '') return DEFAULT_EARTHQUAKE_TSUNAMI_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Keep tsunami-flagged events when the toggle is on.
 * USGS `properties.tsunami === 1` stays; missing or 0 hide.
 * A selected event stays visible even when it is not flagged.
 * Off returns a shallow copy (current view).
 * @param {Array<object>|null|undefined} features
 * @param {unknown} [tsunamiOnly=DEFAULT_EARTHQUAKE_TSUNAMI_ONLY]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterEarthquakeFeaturesByTsunamiFlag(
  features,
  tsunamiOnly = DEFAULT_EARTHQUAKE_TSUNAMI_ONLY,
  { selectedId = null } = {},
) {
  if (!Array.isArray(features)) return [];
  const only = normalizeEarthquakeTsunamiOnly(tsunamiOnly) === true;
  if (!only) return features.slice();
  const keepId = selectedId == null || selectedId === '' ? null : String(selectedId);
  return features.filter((feature) => {
    if (keepId && String(feature?.id) === keepId) return true;
    return feature?.properties?.tsunami === 1;
  });
}
