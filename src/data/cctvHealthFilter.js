/**
 * Hide-unhealthy filter for the existing CCTV catalog.
 *
 * Uses the latest in-memory /api/cctv/health row (or sourceStatus already
 * copied onto a catalog camera). Known-unhealthy tokens hide; missing and
 * unknown stay visible. Selected camera stays. Default off.
 *
 * ANDs with city/source, Hide no feed, feed type, and heading-confidence
 * chips. No extra /api.
 */

import { sourceMatchesCityFilter } from './cctvCityFilter.js';
import { sourceMatchesHeadingConfidence } from './cctvHeadingConfidenceFilter.js';

export const CCTV_HIDE_UNHEALTHY_STORAGE_KEY = 'meridian.cctvHideUnhealthy';

/** Status tokens the hosted health map already uses for a down camera. */
export const CCTV_UNHEALTHY_STATUS_TOKENS = Object.freeze([
  'error',
  'down',
  'stale',
  'offline',
  'unavailable',
  'failed',
]);

const UNHEALTHY_STATUS = new Set(CCTV_UNHEALTHY_STATUS_TOKENS);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeCctvHideUnhealthy(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeCctvHealthStatus(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * True only for a known-unhealthy token. Empty / unknown / ok / degraded stay visible.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isKnownUnhealthyCctvStatus(value) {
  const raw = normalizeCctvHealthStatus(value);
  if (!raw || raw === 'unknown') return false;
  if (UNHEALTHY_STATUS.has(raw)) return true;
  return raw.split(/[^a-z0-9]+/).some((token) => UNHEALTHY_STATUS.has(token));
}

/**
 * @param {Map<string, {status?: string}|string>|Record<string, {status?: string}|string>|null|undefined} healthById
 * @param {string|null|undefined} cameraId
 * @returns {unknown}
 */
export function healthStatusFromMap(healthById, cameraId) {
  if (!healthById || cameraId == null || cameraId === '') return undefined;
  const key = String(cameraId);
  const row = typeof healthById.get === 'function'
    ? healthById.get(key)
    : healthById[key];
  if (row == null) return undefined;
  if (typeof row === 'string') return row;
  return row.status;
}

/**
 * Hide-no-feed uses the catalog's existing feedConfigured flag.
 * Unknown / missing stays visible. Selected camera stays.
 * @param {{id?: string, feedConfigured?: boolean}|null|undefined} source
 * @param {unknown} hideNoFeed
 * @param {unknown} selectedId
 * @returns {boolean}
 */
export function sourceMatchesNoFeedFilter(source, hideNoFeed, selectedId) {
  if (!normalizeCctvHideUnhealthy(hideNoFeed)) return true;
  if (selectedId && source?.id === selectedId) return true;
  if (source?.feedConfigured == null) return true;
  return source.feedConfigured !== false;
}

/**
 * Feed-type chip: empty / all keeps the catalog. `video` is mp4/hls/webm.
 * @param {{feedType?: string}|null|undefined} source
 * @param {unknown} feedType
 * @returns {boolean}
 */
export function sourceMatchesFeedTypeFilter(source, feedType) {
  const want = String(feedType || '').trim().toLowerCase();
  if (!want || want === 'all') return true;
  const actual = String(source?.feedType || '').trim().toLowerCase();
  const isVideo = actual === 'mp4' || actual === 'hls' || actual === 'webm';
  if (want === 'video') return isVideo;
  if (want === 'image') return !isVideo;
  return actual === want;
}

/**
 * @param {{id?: string, sourceStatus?: string, status?: string}|null|undefined} source
 * @param {unknown} hideUnhealthy
 * @param {unknown} selectedId
 * @param {Map<string, {status?: string}|string>|Record<string, {status?: string}|string>|null|undefined} [healthById]
 * @returns {boolean}
 */
export function sourceMatchesHealthFilter(source, hideUnhealthy, selectedId, healthById) {
  if (!normalizeCctvHideUnhealthy(hideUnhealthy)) return true;
  if (selectedId && source?.id === selectedId) return true;
  const mapped = healthStatusFromMap(healthById, source?.id);
  const status = mapped !== undefined
    ? mapped
    : (source?.sourceStatus ?? source?.status);
  if (status == null || status === '') return true;
  return !isKnownUnhealthyCctvStatus(status);
}

/**
 * @param {object|null|undefined} source
 * @param {{
 *   city?: unknown,
 *   hideUnhealthy?: unknown,
 *   hideNoFeed?: unknown,
 *   feedType?: unknown,
 *   headingConfidence?: unknown,
 *   selectedId?: unknown,
 *   healthById?: Map<string, {status?: string}|string>|Record<string, {status?: string}|string>|null,
 * }} [prefs]
 * @returns {boolean}
 */
export function sourceMatchesVisibleCctvFilters(source, prefs = {}) {
  if (!sourceMatchesCityFilter(source, prefs.city)) return false;
  if (!sourceMatchesHealthFilter(source, prefs.hideUnhealthy, prefs.selectedId, prefs.healthById)) {
    return false;
  }
  if (!sourceMatchesNoFeedFilter(source, prefs.hideNoFeed, prefs.selectedId)) return false;
  if (!sourceMatchesFeedTypeFilter(source, prefs.feedType)) return false;
  if (!sourceMatchesHeadingConfidence(source, prefs.headingConfidence, {
    selectedId: prefs.selectedId,
  })) {
    return false;
  }
  return true;
}

/**
 * @param {Array<object>|null|undefined} sources
 * @param {{
 *   city?: unknown,
 *   hideUnhealthy?: unknown,
 *   hideNoFeed?: unknown,
 *   feedType?: unknown,
 *   headingConfidence?: unknown,
 *   selectedId?: unknown,
 *   healthById?: Map<string, {status?: string}|string>|Record<string, {status?: string}|string>|null,
 * }} [prefs]
 * @returns {Array<object>}
 */
export function filterVisibleCctvSources(sources, prefs = {}) {
  return (Array.isArray(sources) ? sources : []).filter((source) => (
    sourceMatchesVisibleCctvFilters(source, prefs)
  ));
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {boolean}
 */
export function readCctvHideUnhealthy(storage) {
  try {
    return normalizeCctvHideUnhealthy(storage?.getItem?.(CCTV_HIDE_UNHEALTHY_STORAGE_KEY));
  } catch {
    return false;
  }
}

/**
 * @param {{setItem?: Function}|null|undefined} storage
 * @param {unknown} value
 * @returns {boolean}
 */
export function writeCctvHideUnhealthy(storage, value) {
  const normalized = normalizeCctvHideUnhealthy(value);
  try {
    storage?.setItem?.(CCTV_HIDE_UNHEALTHY_STORAGE_KEY, normalized ? '1' : '0');
  } catch {
    // Fail open: the session can still apply the toggle.
  }
  return normalized;
}
