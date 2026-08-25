/**
 * @module flightAltitudeBand
 * @description Client-side min–max altitude filter for the existing Flights
 * layer. Uses the current adsb.lol payload's aviation altitude (baro feet
 * converted to metres, or `alt_baro === 'ground'`). Persistence is local
 * only (`meridian.altBand`). No /api and no new feed.
 */

import { formatDistanceMeters, normalizeDistanceUnit } from '../units.js';

/** 10,000 ft in metres — same FOOT_TO_M adsb.lol already uses. */
export const ALT_BAND_10K_M = 10000 * 0.3048;
/** 30,000 ft in metres. */
export const ALT_BAND_30K_M = 30000 * 0.3048;

export const ALT_BAND_STORAGE_KEY = 'meridian.altBand';
export const ALT_BAND_DEFAULT_ID = 'all';
export const ALT_BAND_IDS = Object.freeze(['all', 'surface', 'lt10k', 'mid', 'gt30k']);

/** @typedef {'all'|'surface'|'lt10k'|'mid'|'gt30k'} AltBandId */
/**
 * @typedef {object} AltBand
 * @property {AltBandId|'custom'} id
 * @property {number|null} minM Inclusive lower bound in metres; null is unbounded.
 * @property {number|null} maxM Exclusive upper bound in metres; null is unbounded.
 * @property {boolean} [surfaceOnly]
 */

const PRESETS = Object.freeze({
  all: Object.freeze({ id: 'all', minM: null, maxM: null }),
  surface: Object.freeze({ id: 'surface', minM: 0, maxM: 0, surfaceOnly: true }),
  lt10k: Object.freeze({ id: 'lt10k', minM: 0, maxM: ALT_BAND_10K_M }),
  mid: Object.freeze({ id: 'mid', minM: ALT_BAND_10K_M, maxM: ALT_BAND_30K_M }),
  gt30k: Object.freeze({ id: 'gt30k', minM: ALT_BAND_30K_M, maxM: null }),
});

let sessionBand = PRESETS.all;
const listeners = new Set();

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {AltBandId|null}
 */
export function normalizeAltitudeBandId(value) {
  const id = String(value || '').trim().toLowerCase();
  return ALT_BAND_IDS.includes(id) ? /** @type {AltBandId} */ (id) : null;
}

/**
 * Resolve a preset id, custom min/max, or stored token to a band.
 * Meter math never follows the display-unit toggle.
 * @param {unknown} value
 * @returns {AltBand}
 */
export function normalizeAltitudeBand(value) {
  if (value == null || value === '') return { ...PRESETS.all };
  if (typeof value === 'string') {
    const id = normalizeAltitudeBandId(value);
    if (id) return { ...PRESETS[id] };
    try {
      return normalizeAltitudeBand(JSON.parse(value));
    } catch {
      return { ...PRESETS.all };
    }
  }
  if (typeof value !== 'object') return { ...PRESETS.all };

  const id = normalizeAltitudeBandId(value.id);
  const minM = finiteOrNull(value.minM);
  const maxM = finiteOrNull(value.maxM);
  const hasCustomBounds = minM != null || maxM != null;
  if (id && !hasCustomBounds) return { ...PRESETS[id] };
  if (value.surfaceOnly === true) return { ...PRESETS.surface };
  if (minM == null && maxM == null) return { ...PRESETS.all };
  return { id: id || 'custom', minM, maxM };
}

/**
 * Aviation altitude used by the filter: baro metres, or 0 when on the ground.
 * @param {{altitudeM?: number|null, onGround?: boolean}|null|undefined} aircraft
 * @returns {number|null}
 */
export function flightFilterAltitudeM(aircraft) {
  if (aircraft?.onGround === true) return 0;
  return Number.isFinite(aircraft?.altitudeM) ? aircraft.altitudeM : null;
}

/**
 * @param {{altitudeM?: number|null, onGround?: boolean}|null|undefined} aircraft
 * @param {unknown} band
 * @returns {boolean}
 */
export function aircraftMatchesAltitudeBand(aircraft, band) {
  const resolved = normalizeAltitudeBand(band);
  if (resolved.id === 'all' && resolved.minM == null && resolved.maxM == null && !resolved.surfaceOnly) {
    return true;
  }
  if (resolved.surfaceOnly || resolved.id === 'surface') {
    return aircraft?.onGround === true;
  }

  const minM = resolved.minM;
  const maxM = resolved.maxM;
  if (minM != null && maxM != null && minM > maxM) return false;

  if (aircraft?.onGround === true) {
    if (resolved.id === 'lt10k' || resolved.id === 'mid' || resolved.id === 'gt30k') return false;
    const altitudeM = 0;
    if (minM != null && altitudeM < minM) return false;
    if (maxM != null && altitudeM >= maxM) return false;
    return true;
  }

  const altitudeM = flightFilterAltitudeM(aircraft);
  if (altitudeM == null) return false;
  if (minM != null && altitudeM < minM) return false;
  if (maxM != null && altitudeM >= maxM) return false;
  return true;
}

/**
 * @param {Array<{altitudeM?: number|null, onGround?: boolean}>|null|undefined} flights
 * @param {unknown} band
 * @returns {Array}
 */
export function filterFlightsByAltitudeBand(flights, band) {
  const list = Array.isArray(flights) ? flights : [];
  const resolved = normalizeAltitudeBand(band);
  return list.filter((flight) => aircraftMatchesAltitudeBand(flight, resolved));
}

/**
 * Apply the band to a payload snapshot. An empty match is a finished empty
 * layer — never a hang or a retry.
 * @param {Array|null|undefined} flights
 * @param {unknown} band
 * @returns {{visible: Array, hidden: Array, hang: false, band: AltBand}}
 */
export function applyAltitudeBandToFlights(flights, band) {
  const list = Array.isArray(flights) ? flights : [];
  const resolved = normalizeAltitudeBand(band);
  const visible = [];
  const hidden = [];
  for (const flight of list) {
    if (aircraftMatchesAltitudeBand(flight, resolved)) visible.push(flight);
    else hidden.push(flight);
  }
  return { visible, hidden, hang: false, band: resolved };
}

/**
 * Stop labels follow the current km | nm | mi toggle. Thresholds stay metres.
 * @param {unknown} [unit]
 * @returns {{all: string, surface: string, lt10k: string, mid: string, gt30k: string}}
 */
export function altitudeBandStopLabels(unit) {
  const resolved = normalizeDistanceUnit(unit) || 'km';
  const lo = formatDistanceMeters(ALT_BAND_10K_M, resolved);
  const hi = formatDistanceMeters(ALT_BAND_30K_M, resolved);
  return {
    all: 'All',
    surface: 'Surface',
    lt10k: `<${lo}`,
    mid: `${lo}–${hi}`,
    gt30k: `>${hi}`,
  };
}

function persistToken(band) {
  const resolved = normalizeAltitudeBand(band);
  if (resolved.id !== 'custom' && ALT_BAND_IDS.includes(resolved.id)) return resolved.id;
  return JSON.stringify({ minM: resolved.minM, maxM: resolved.maxM });
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {AltBand}
 */
export function readAltitudeBand(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(ALT_BAND_STORAGE_KEY);
    if (raw == null || raw === '') return { ...PRESETS.all };
    return normalizeAltitudeBand(raw);
  } catch {
    return { ...PRESETS.all };
  }
}

/**
 * @param {unknown} band
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeAltitudeBand(band, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(ALT_BAND_STORAGE_KEY, persistToken(band));
    return true;
  } catch {
    return false;
  }
}

/** @returns {AltBand} */
export function getAltitudeBand() {
  return { ...sessionBand };
}

/**
 * @param {unknown} band
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {AltBand}
 */
export function setAltitudeBand(band, { persist = true, storage } = {}) {
  const next = normalizeAltitudeBand(band);
  sessionBand = next;
  if (persist) writeAltitudeBand(next, storage);
  for (const listener of listeners) listener(next);
  return { ...next };
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {AltBand}
 */
export function hydrateAltitudeBand(storage) {
  return setAltitudeBand(readAltitudeBand(storage), { persist: false, storage });
}

/**
 * @param {(band: AltBand) => void} listener
 * @returns {() => void}
 */
export function subscribeAltitudeBand(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Watchlist highlighting stays payload-local: the ident must be in the
 * current adsb.lol snapshot and inside the active altitude band.
 * @param {{watched?: boolean, inPayload?: boolean, inBand?: boolean}} input
 * @returns {boolean}
 */
export function watchlistHighlightAllowed({
  watched = false,
  inPayload = false,
  inBand = false,
} = {}) {
  return watched === true && inPayload === true && inBand === true;
}

/** Test-only: restore All without clearing subscribers. */
export function resetAltitudeBandForTest() {
  sessionBand = { ...PRESETS.all };
}
