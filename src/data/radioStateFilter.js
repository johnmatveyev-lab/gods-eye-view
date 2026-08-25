/**
 * Client-side Radio Browser state/region field.
 *
 * Filters stations the client already received by `station.state`.
 * Playback still uses the existing `/api/radio` broker; this module never
 * fetches Radio Browser or adds an endpoint. Persistence is local only
 * (`meridian.radioState`).
 */

export const RADIO_STATE_STORAGE_KEY = 'meridian.radioState';
export const DEFAULT_RADIO_STATE = '';
const RADIO_STATE_MAX_LENGTH = 80;
const INVALID_RADIO_STATE = '\u0000';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Bound the operator-typed state field. Empty is all states/regions.
 * Non-strings and control characters stay a closed invalid token so they
 * cannot broaden. Matching is case-insensitive exact or contains.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeRadioStateQuery(value) {
  if (value === undefined || value === null) return DEFAULT_RADIO_STATE;
  if (typeof value !== 'string') return INVALID_RADIO_STATE;
  if (/[\u0000-\u001f\u007f]/.test(value) || value.length > RADIO_STATE_MAX_LENGTH) {
    return INVALID_RADIO_STATE;
  }
  const trimmed = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (trimmed.length > RADIO_STATE_MAX_LENGTH) return INVALID_RADIO_STATE;
  return trimmed;
}

/**
 * Whether one directory station clears the state field.
 * Empty matches every station. Invalid input matches none.
 * Empty / missing `station.state` hides when the field is non-empty.
 * A playing station can be kept.
 * @param {object} station
 * @param {unknown} query
 * @param {{keepStationId?: string|null}} [options]
 * @returns {boolean}
 */
export function stationMatchesRadioState(station, query, { keepStationId = null } = {}) {
  if (keepStationId && station?.id === keepStationId) return true;
  const normalized = normalizeRadioStateQuery(query);
  if (normalized === DEFAULT_RADIO_STATE) return true;
  if (normalized === INVALID_RADIO_STATE) return false;
  const stationState = String(station?.state ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!stationState) return false;
  const needle = normalized.toLocaleLowerCase();
  const haystack = stationState.toLocaleLowerCase();
  return haystack === needle || haystack.includes(needle);
}

/**
 * Current-list stations that still match the state field.
 * @param {Array<object>} stations
 * @param {unknown} query
 * @param {{keepStationId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterRadioStationsByState(stations, query, options = {}) {
  return (Array.isArray(stations) ? stations : [])
    .filter((station) => stationMatchesRadioState(station, query, options));
}

/**
 * Read the durable state field. Storage failures fail open to empty (all).
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function readRadioState(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(RADIO_STATE_STORAGE_KEY);
    if (raw == null) return DEFAULT_RADIO_STATE;
    return normalizeRadioStateQuery(raw);
  } catch {
    return DEFAULT_RADIO_STATE;
  }
}

/**
 * Persist the state field. Best-effort; never throws.
 * Invalid text is stored as-is so reload still fails closed.
 * @param {unknown} query
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function writeRadioState(query, storage) {
  const next = normalizeRadioStateQuery(query);
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(RADIO_STATE_STORAGE_KEY, next);
    }
  } catch {
    // Fail open: the session can still hold the field in memory.
  }
  return next;
}
