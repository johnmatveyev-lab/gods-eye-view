/**
 * Client-only earthquake time window. Filters already-fetched USGS all_day
 * GeoJSON by properties.time. Does not change the product or fetch.
 */

export const EARTHQUAKE_TIME_WINDOWS_HOURS = Object.freeze([1, 6, 24]);
export const DEFAULT_EARTHQUAKE_TIME_WINDOW_HOURS = 24;
export const EARTHQUAKE_TIME_WINDOW_LABELS = Object.freeze({
  1: '1h',
  6: '6h',
  24: '24h',
});
export const EARTHQUAKE_TIME_WINDOW_TITLES = Object.freeze({
  1: 'Show earthquakes from the last 1 hour',
  6: 'Show earthquakes from the last 6 hours',
  24: 'Show earthquakes from the last 24 hours',
});

const HOUR_MS = 60 * 60 * 1000;

/**
 * Canonical chip hours. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {1|6|24|null}
 */
export function normalizeEarthquakeTimeWindowHours(value) {
  const hours = Number(value);
  if (!EARTHQUAKE_TIME_WINDOWS_HOURS.includes(hours)) return null;
  return /** @type {1|6|24} */ (hours);
}

/**
 * Keep events whose USGS epoch ms is inside the window.
 * 24h is the all_day product, so it does not clip further (matches current discs).
 * Missing/non-finite time stays visible.
 * @param {Array<object>|null|undefined} features
 * @param {unknown} [windowHours=DEFAULT_EARTHQUAKE_TIME_WINDOW_HOURS]
 * @param {number} [now=Date.now()]
 * @returns {Array<object>}
 */
export function filterEarthquakeFeaturesByTimeWindow(
  features,
  windowHours = DEFAULT_EARTHQUAKE_TIME_WINDOW_HOURS,
  now = Date.now(),
) {
  if (!Array.isArray(features)) return [];
  const hours = normalizeEarthquakeTimeWindowHours(windowHours)
    ?? DEFAULT_EARTHQUAKE_TIME_WINDOW_HOURS;
  if (hours === DEFAULT_EARTHQUAKE_TIME_WINDOW_HOURS) return features.slice();
  const cutoff = Number(now) - hours * HOUR_MS;
  return features.filter((feature) => {
    const time = feature?.properties?.time;
    if (!Number.isFinite(time)) return true;
    return time >= cutoff;
  });
}
