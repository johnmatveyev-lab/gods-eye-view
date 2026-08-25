/**
 * Client-only earthquake reviewed-status filter. Uses properties.status
 * already present on USGS all_day GeoJSON (automatic | reviewed | deleted).
 * Does not change the product or fetch.
 */

export const DEFAULT_EARTHQUAKE_REVIEWED_ONLY = false;
export const EARTHQUAKE_REVIEWED_CHIP_LABEL = 'Reviewed only';
export const EARTHQUAKE_REVIEWED_CHIP_TITLE = 'Show only reviewed earthquakes';

/**
 * Canonical on/off. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeEarthquakeReviewedOnly(value) {
  if (value == null || value === '') return DEFAULT_EARTHQUAKE_REVIEWED_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * USGS review status, compared case-insensitively.
 * @param {unknown} value
 * @returns {string}
 */
export function earthquakeReviewStatus(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Keep reviewed events when the toggle is on.
 * USGS `properties.status === 'reviewed'` (any case) stays; missing,
 * automatic, deleted, or other values hide.
 * A selected event stays visible even when it is not reviewed.
 * Off returns a shallow copy (current view).
 * @param {Array<object>|null|undefined} features
 * @param {unknown} [reviewedOnly=DEFAULT_EARTHQUAKE_REVIEWED_ONLY]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterEarthquakeFeaturesByReviewedStatus(
  features,
  reviewedOnly = DEFAULT_EARTHQUAKE_REVIEWED_ONLY,
  { selectedId = null } = {},
) {
  if (!Array.isArray(features)) return [];
  const only = normalizeEarthquakeReviewedOnly(reviewedOnly) === true;
  if (!only) return features.slice();
  const keepId = selectedId == null || selectedId === '' ? null : String(selectedId);
  return features.filter((feature) => {
    if (keepId && String(feature?.id) === keepId) return true;
    return earthquakeReviewStatus(feature?.properties?.status) === 'reviewed';
  });
}
