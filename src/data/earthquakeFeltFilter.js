/**
 * Client-only earthquake felt-report filter. Uses properties.felt
 * already present on USGS all_day GeoJSON (DYFI report count, number or
 * null). Does not change the product or fetch.
 */

export const DEFAULT_EARTHQUAKE_FELT_ONLY = false;
export const EARTHQUAKE_FELT_CHIP_LABEL = 'Felt only';
export const EARTHQUAKE_FELT_CHIP_TITLE = 'Show only earthquakes people reported as felt';

/**
 * Canonical on/off. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeEarthquakeFeltOnly(value) {
  if (value == null || value === '') return DEFAULT_EARTHQUAKE_FELT_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * DYFI felt-report count. Missing or non-numeric values become NaN so
 * the toggle hides them.
 * @param {unknown} value
 * @returns {number}
 */
export function earthquakeFeltReportCount(value) {
  return Number(value);
}

/**
 * Keep events people reported via DYFI when the toggle is on.
 * USGS `Number(properties.felt) > 0` stays; missing, 0, or NaN hide.
 * A selected event stays visible even when it has no felt reports.
 * Off returns a shallow copy (current view).
 * @param {Array<object>|null|undefined} features
 * @param {unknown} [feltOnly=DEFAULT_EARTHQUAKE_FELT_ONLY]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterEarthquakeFeaturesByFeltReports(
  features,
  feltOnly = DEFAULT_EARTHQUAKE_FELT_ONLY,
  { selectedId = null } = {},
) {
  if (!Array.isArray(features)) return [];
  const only = normalizeEarthquakeFeltOnly(feltOnly) === true;
  if (!only) return features.slice();
  const keepId = selectedId == null || selectedId === '' ? null : String(selectedId);
  return features.filter((feature) => {
    if (keepId && String(feature?.id) === keepId) return true;
    return earthquakeFeltReportCount(feature?.properties?.felt) > 0;
  });
}
