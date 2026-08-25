/**
 * Client-side Radio Browser hide-offline chip.
 *
 * Filters stations the client already received using `lastCheckOk` from
 * Radio Browser's `lastcheckok` field. Playback still uses the existing
 * `/api/radio` broker; this module never fetches Radio Browser or adds an
 * endpoint. Persistence is local only (`meridian.radioHideOffline`).
 */

export const RADIO_HIDE_OFFLINE_STORAGE_KEY = 'meridian.radioHideOffline';
export const DEFAULT_RADIO_HIDE_OFFLINE = false;

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
 * Map Radio Browser `lastcheckok` / client `lastCheckOk` onto a boolean.
 * `1` / `true` is online. `0` / `false` is known-offline. Anything else is
 * unknown and must not be treated as dead.
 * @param {unknown} value
 * @returns {boolean|undefined}
 */
export function normalizeRadioLastCheckOk(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return undefined;
}

/**
 * Last-check flag kept on one in-memory directory station.
 * @param {object} station
 * @returns {boolean|undefined}
 */
export function stationLastCheckOk(station) {
  if (!station || typeof station !== 'object') return undefined;
  if (Object.hasOwn(station, 'lastCheckOk')) {
    return normalizeRadioLastCheckOk(station.lastCheckOk);
  }
  return normalizeRadioLastCheckOk(station.lastcheckok);
}

/**
 * Accept a chip or stored flag. Invalid values fail open to off.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeRadioHideOffline(value) {
  return value === true || value === 'true' || value === '1' || value === 'on';
}

/**
 * Whether one directory station clears the hide-offline chip.
 * Off keeps every station already in the current list. Known-offline
 * (`lastCheckOk === false`) is skipped when the chip is on. Missing /
 * unknown stays visible. A playing or selected station can be kept.
 * @param {object} station
 * @param {unknown} hideOffline
 * @param {{keepStationId?: string|string[]|null}} [options]
 * @returns {boolean}
 */
export function stationMatchesRadioOfflineFilter(station, hideOffline, { keepStationId = null } = {}) {
  if (stationIsKept(station, keepStationId)) return true;
  if (!normalizeRadioHideOffline(hideOffline)) return true;
  return stationLastCheckOk(station) !== false;
}

/**
 * Current-list stations that still match the hide-offline chip.
 * @param {Array<object>} stations
 * @param {unknown} hideOffline
 * @param {{keepStationId?: string|string[]|null}} [options]
 * @returns {Array<object>}
 */
export function filterRadioStationsByOffline(stations, hideOffline, options = {}) {
  return (Array.isArray(stations) ? stations : [])
    .filter((station) => stationMatchesRadioOfflineFilter(station, hideOffline, options));
}

/**
 * Read the durable hide-offline chip. Storage failures fail open to off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readRadioHideOffline(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(RADIO_HIDE_OFFLINE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_RADIO_HIDE_OFFLINE;
    return normalizeRadioHideOffline(JSON.parse(raw));
  } catch {
    return DEFAULT_RADIO_HIDE_OFFLINE;
  }
}

/**
 * Persist the hide-offline chip. Best-effort; never throws.
 * @param {unknown} hideOffline
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeRadioHideOffline(hideOffline, storage) {
  const next = normalizeRadioHideOffline(hideOffline);
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(RADIO_HIDE_OFFLINE_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Fail open: the session can still hold the chip in memory.
  }
  return next;
}
