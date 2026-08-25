/**
 * Client-side CCTV feed-type chips.
 *
 * Filters the already-loaded catalog. Image = stills, MJPEG = motion JPEG,
 * Video = mp4 | hls | webm. Persistence is local only (`meridian.cctvFeedTypes`).
 * No extra /api/cctv/sources or /frame fetch.
 */

import { sourceMatchesCityFilter, sourceMatchesHideNoFeed as sourceMatchesLandedHideNoFeed } from './cctvCityFilter.js';

export const CCTV_FEED_TYPE_STORAGE_KEY = 'meridian.cctvFeedTypes';
export const CCTV_FEED_TYPE_IDS = Object.freeze(['image', 'mjpeg', 'video']);
export const DEFAULT_CCTV_FEED_TYPE_FILTER = Object.freeze({
  image: true,
  mjpeg: true,
  video: true,
});

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Map a catalog feed type onto Image | MJPEG | Video.
 * Unknown or missing values stay visible.
 * @param {unknown} feedType
 * @returns {'image'|'mjpeg'|'video'|null}
 */
export function cctvFeedTypeFamily(feedType) {
  const raw = String(feedType ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'mjpg' || raw === 'mjpeg') return 'mjpeg';
  if (
    raw === 'image'
    || raw === 'jpeg'
    || raw === 'jpg'
    || raw === 'png'
    || raw === 'gif'
  ) return 'image';
  if (
    raw === 'mp4'
    || raw === 'hls'
    || raw === 'webm'
    || raw === 'video'
    || raw === 'stream'
  ) return 'video';
  return null;
}

/**
 * Accept chip maps, 'all' / family ids, or a partial object.
 * Missing chip keys stay on so a single-chip toggle does not hide the others.
 * @param {unknown} value
 * @returns {{image: boolean, mjpeg: boolean, video: boolean}}
 */
export function normalizeCctvFeedTypeFilter(value) {
  if (value == null || value === '' || value === 'all' || value === true) {
    return { image: true, mjpeg: true, video: true };
  }
  if (value === 'none' || value === false) {
    return { image: false, mjpeg: false, video: false };
  }
  if (value === 'image') return { image: true, mjpeg: false, video: false };
  if (value === 'mjpeg') return { image: false, mjpeg: true, video: false };
  if (value === 'video') return { image: false, mjpeg: false, video: true };
  if (Array.isArray(value)) {
    const next = { image: false, mjpeg: false, video: false };
    for (const raw of value) {
      const id = String(raw || '').trim().toLowerCase();
      if (id === 'image' || id === 'mjpeg' || id === 'video') next[id] = true;
    }
    return next;
  }
  if (typeof value === 'object') {
    return {
      image: value.image !== false,
      mjpeg: value.mjpeg !== false,
      video: value.video !== false,
    };
  }
  return { image: true, mjpeg: true, video: true };
}

/**
 * Whether one catalog row has a configured feed.
 * Delegates to the landed Hide no feed helper (feedConfigured === false hides).
 * @param {object|null|undefined} source
 * @returns {boolean}
 */
export function sourceHasCctvFeed(source) {
  return sourceMatchesLandedHideNoFeed(source, true);
}

/**
 * Whether one catalog row clears the feed-type chips.
 * Unknown/missing feed types stay visible. A selected camera can be kept.
 * @param {object|null|undefined} source
 * @param {unknown} filter
 * @param {{keepCameraId?: string|null}} [options]
 * @returns {boolean}
 */
export function sourceMatchesFeedTypeFilter(source, filter, { keepCameraId = null } = {}) {
  if (keepCameraId && source?.id === keepCameraId) return true;
  const family = cctvFeedTypeFamily(source?.feedType);
  if (family == null) return true;
  const enabled = normalizeCctvFeedTypeFilter(filter);
  return enabled[family] === true;
}

/**
 * @param {Array<object>|null|undefined} sources
 * @param {unknown} filter
 * @param {{keepCameraId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterCctvSourcesByFeedType(sources, filter, options = {}) {
  return (Array.isArray(sources) ? sources : [])
    .filter((source) => sourceMatchesFeedTypeFilter(source, filter, options));
}

/**
 * City/source, feed-type chips, and Hide no feed AND on the in-memory catalog.
 * @param {Array<object>|null|undefined} sources
 * @param {{
 *   city?: unknown,
 *   feedTypes?: unknown,
 *   hideNoFeed?: unknown,
 *   keepCameraId?: string|null,
 * }} [options]
 * @returns {Array<object>}
 */
export function filterVisibleCctvCatalog(sources, {
  city = '',
  feedTypes = DEFAULT_CCTV_FEED_TYPE_FILTER,
  hideNoFeed = false,
  keepCameraId = null,
} = {}) {
  return (Array.isArray(sources) ? sources : []).filter((source) => (
    sourceMatchesCityFilter(source, city)
    && sourceMatchesFeedTypeFilter(source, feedTypes, { keepCameraId })
    && sourceMatchesLandedHideNoFeed(source, hideNoFeed === true, { selectedId: keepCameraId })
  ));
}

/**
 * Read the durable feed-type chips. Storage failures fail open to all on.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {{image: boolean, mjpeg: boolean, video: boolean}}
 */
export function readCctvFeedTypeFilter(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(CCTV_FEED_TYPE_STORAGE_KEY);
    if (raw == null || raw === '') return { ...DEFAULT_CCTV_FEED_TYPE_FILTER };
    return normalizeCctvFeedTypeFilter(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CCTV_FEED_TYPE_FILTER };
  }
}

/**
 * Persist feed-type chips. Best-effort; never throws.
 * @param {unknown} filter
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {{image: boolean, mjpeg: boolean, video: boolean}}
 */
export function writeCctvFeedTypeFilter(filter, storage) {
  const next = normalizeCctvFeedTypeFilter(filter);
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(CCTV_FEED_TYPE_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Fail open: the session can still hold the chips in memory.
  }
  return next;
}
