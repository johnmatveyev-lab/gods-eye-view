/**
 * Client-side Radio Browser hide-no-homepage chip.
 *
 * Filters stations the client already received using the `homepage` field
 * kept on every in-memory roster item. Playback still uses the existing
 * `/api/radio` broker; this module never fetches Radio Browser or adds an
 * endpoint. Persistence is local only (`meridian.radioHideNoHomepage`).
 */

export const RADIO_HIDE_NO_HOMEPAGE_STORAGE_KEY = 'meridian.radioHideNoHomepage';
export const DEFAULT_RADIO_HIDE_NO_HOMEPAGE = false;

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
 * Whether one directory station has a usable homepage URL.
 * Missing, null, empty, and whitespace-only values count as no homepage.
 * @param {object} station
 * @returns {boolean}
 */
export function stationHasRadioHomepage(station) {
  if (station == null || typeof station !== 'object') return false;
  if (!Object.hasOwn(station, 'homepage')) return false;
  const homepage = station.homepage;
  if (homepage == null) return false;
  return String(homepage).trim().length > 0;
}

/**
 * Accept a chip or stored flag. Invalid values fail open to off.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeRadioHideNoHomepage(value) {
  return value === true || value === 'true' || value === '1' || value === 'on';
}

/**
 * Whether one directory station clears the hide-no-homepage chip.
 * Off keeps every station already in the current list. Missing / empty /
 * whitespace-only homepage is skipped when the chip is on. A playing or
 * selected station can be kept.
 * @param {object} station
 * @param {unknown} hideNoHomepage
 * @param {{keepStationId?: string|string[]|null}} [options]
 * @returns {boolean}
 */
export function stationMatchesRadioHomepageFilter(station, hideNoHomepage, { keepStationId = null } = {}) {
  if (stationIsKept(station, keepStationId)) return true;
  if (!normalizeRadioHideNoHomepage(hideNoHomepage)) return true;
  return stationHasRadioHomepage(station);
}

/**
 * Current-list stations that still match the hide-no-homepage chip.
 * @param {Array<object>} stations
 * @param {unknown} hideNoHomepage
 * @param {{keepStationId?: string|string[]|null}} [options]
 * @returns {Array<object>}
 */
export function filterRadioStationsByHomepage(stations, hideNoHomepage, options = {}) {
  return (Array.isArray(stations) ? stations : [])
    .filter((station) => stationMatchesRadioHomepageFilter(station, hideNoHomepage, options));
}

/**
 * Read the durable hide-no-homepage chip. Storage failures fail open to off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readRadioHideNoHomepage(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(RADIO_HIDE_NO_HOMEPAGE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_RADIO_HIDE_NO_HOMEPAGE;
    return normalizeRadioHideNoHomepage(JSON.parse(raw));
  } catch {
    return DEFAULT_RADIO_HIDE_NO_HOMEPAGE;
  }
}

/**
 * Persist the hide-no-homepage chip. Best-effort; never throws.
 * @param {unknown} hideNoHomepage
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeRadioHideNoHomepage(hideNoHomepage, storage) {
  const next = normalizeRadioHideNoHomepage(hideNoHomepage);
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(RADIO_HIDE_NO_HOMEPAGE_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Fail open: the session can still hold the chip in memory.
  }
  return next;
}
