/**
 * Client-side Radio Browser hide-no-tags chip.
 *
 * Filters stations the client already received using the `tags` array
 * kept on every in-memory roster item. Playback still uses the existing
 * `/api/radio` broker; this module never fetches Radio Browser or adds an
 * endpoint. Persistence is local only (`meridian.radioHideNoTags`).
 *
 * Empty `tags: []` is directory junk and hides when the chip is on.
 * Missing / null / undefined tags are unknown and stay visible.
 */

export const RADIO_HIDE_NO_TAGS_STORAGE_KEY = 'meridian.radioHideNoTags';
export const DEFAULT_RADIO_HIDE_NO_TAGS = false;

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function stationIsKept(station, keepStationId) {
  if (Array.isArray(keepStationId)) return keepStationId.includes(station?.id);
  return Boolean(keepStationId && station?.id === keepStationId);
}

/**
 * Whether one directory station has a known-empty tags array.
 * Only `Array.isArray(tags) && tags.length === 0` counts as empty.
 * Missing, null, undefined, and non-array tags stay unknown.
 * @param {object} station
 * @returns {boolean}
 */
export function stationHasEmptyRadioTags(station) {
  if (station == null || typeof station !== 'object') return false;
  if (!Object.hasOwn(station, 'tags')) return false;
  return Array.isArray(station.tags) && station.tags.length === 0;
}

/**
 * Accept a chip or stored flag. Invalid values fail open to off.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeRadioHideNoTags(value) {
  return value === true || value === 'true' || value === '1' || value === 'on';
}

/**
 * Whether one directory station clears the hide-no-tags chip.
 * Off keeps every station already in the current list. Known-empty
 * `tags: []` is skipped when the chip is on. Missing / unknown stays
 * visible. A playing or selected station can be kept.
 * @param {object} station
 * @param {unknown} hideNoTags
 * @param {{keepStationId?: string|string[]|null}} [options]
 * @returns {boolean}
 */
export function stationMatchesRadioTagsFilter(station, hideNoTags, { keepStationId = null } = {}) {
  if (stationIsKept(station, keepStationId)) return true;
  if (!normalizeRadioHideNoTags(hideNoTags)) return true;
  return !stationHasEmptyRadioTags(station);
}

/**
 * Current-list stations that still match the hide-no-tags chip.
 * @param {Array<object>} stations
 * @param {unknown} hideNoTags
 * @param {{keepStationId?: string|string[]|null}} [options]
 * @returns {Array<object>}
 */
export function filterRadioStationsByTags(stations, hideNoTags, options = {}) {
  return (Array.isArray(stations) ? stations : [])
    .filter((station) => stationMatchesRadioTagsFilter(station, hideNoTags, options));
}

/**
 * Read the durable hide-no-tags chip. Storage failures fail open to off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readRadioHideNoTags(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(RADIO_HIDE_NO_TAGS_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_RADIO_HIDE_NO_TAGS;
    return normalizeRadioHideNoTags(JSON.parse(raw));
  } catch {
    return DEFAULT_RADIO_HIDE_NO_TAGS;
  }
}

/**
 * Persist the hide-no-tags chip. Best-effort; never throws.
 * @param {unknown} hideNoTags
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeRadioHideNoTags(hideNoTags, storage) {
  const next = normalizeRadioHideNoTags(hideNoTags);
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(RADIO_HIDE_NO_TAGS_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Fail open: the session can still hold the chip in memory.
  }
  return next;
}
