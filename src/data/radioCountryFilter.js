/**
 * Client-side Radio Browser country field.
 *
 * Filters stations the client already received by `station.countryCode`.
 * Playback still uses the existing `/api/radio` broker; this module never
 * fetches Radio Browser or adds an endpoint. Persistence is local only
 * (`meridian.radioCountry`).
 */

import { normalizeRadioCountryInput } from './radioCountry.js';

export const RADIO_COUNTRY_STORAGE_KEY = 'meridian.radioCountry';
export const DEFAULT_RADIO_COUNTRY = '';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Bound the operator-typed country field. Empty is all countries.
 * Non-strings stay a closed invalid token so they cannot broaden.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeRadioCountryQuery(value) {
  if (value === undefined || value === null) return DEFAULT_RADIO_COUNTRY;
  if (typeof value !== 'string') return '\u0000';
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/**
 * Whether one directory station clears the country field.
 * Empty matches every station. Invalid input matches none.
 * Filter uses `countryCode` only. A playing station can be kept.
 * @param {object} station
 * @param {unknown} query
 * @param {{keepStationId?: string|null}} [options]
 * @returns {boolean}
 */
export function stationMatchesRadioCountry(station, query, { keepStationId = null } = {}) {
  if (keepStationId && station?.id === keepStationId) return true;
  const normalized = normalizeRadioCountryInput(normalizeRadioCountryQuery(query));
  if (normalized.empty) return true;
  if (!normalized.valid) return false;
  const stationCode = String(station?.countryCode || '').trim().toUpperCase();
  return stationCode === normalized.code;
}

/**
 * Current-list stations that still match the country field.
 * @param {Array<object>} stations
 * @param {unknown} query
 * @param {{keepStationId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterRadioStationsByCountry(stations, query, options = {}) {
  return (Array.isArray(stations) ? stations : [])
    .filter((station) => stationMatchesRadioCountry(station, query, options));
}

/**
 * Read the durable country field. Storage failures fail open to empty (all).
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function readRadioCountry(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(RADIO_COUNTRY_STORAGE_KEY);
    if (raw == null) return DEFAULT_RADIO_COUNTRY;
    return normalizeRadioCountryQuery(raw);
  } catch {
    return DEFAULT_RADIO_COUNTRY;
  }
}

/**
 * Persist the country field. Best-effort; never throws.
 * Invalid text is stored as-is so reload still fails closed.
 * @param {unknown} query
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function writeRadioCountry(query, storage) {
  const next = normalizeRadioCountryQuery(query);
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(RADIO_COUNTRY_STORAGE_KEY, next);
    }
  } catch {
    // Fail open: the session can still hold the field in memory.
  }
  return next;
}
