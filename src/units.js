/**
 * Hosted distance-unit preference for Meridian display labels.
 *
 * This module only reformats existing meter-based readouts. It does not
 * invent measurements, change Cesium internals, or add layers.
 */

/** International nautical mile. */
export const METERS_PER_NAUTICAL_MILE = 1852;
/** Statute mile. */
export const METERS_PER_STATUTE_MILE = 1609.344;
export const METERS_PER_KILOMETER = 1000;

export const DISTANCE_UNITS = Object.freeze(['km', 'nm', 'mi']);
export const DEFAULT_DISTANCE_UNIT = 'km';
export const UNITS_STORAGE_KEY = 'meridian.units';

/** @typedef {'km'|'nm'|'mi'} DistanceUnit */

let sessionUnit = DEFAULT_DISTANCE_UNIT;
const listeners = new Set();

/**
 * Resolve an untrusted unit token to a shipped unit, or null.
 * @param {unknown} value
 * @returns {DistanceUnit|null}
 */
export function normalizeDistanceUnit(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'km' || normalized === 'kilometer' || normalized === 'kilometre') return 'km';
  if (normalized === 'nm' || normalized === 'nmi' || normalized === 'nautical') return 'nm';
  if (normalized === 'mi' || normalized === 'mile' || normalized === 'miles') return 'mi';
  return null;
}

/**
 * Suffix printed on range labels. The control says `nm`; labels read `nmi`.
 * @param {DistanceUnit} unit
 * @returns {string}
 */
export function distanceUnitSuffix(unit) {
  switch (unit) {
    case 'km': return 'km';
    case 'nm': return 'nmi';
    case 'mi': return 'mi';
    default: {
      const _exhaustive = /** @type {never} */ (unit);
      void _exhaustive;
      return 'km';
    }
  }
}

/**
 * @param {DistanceUnit} unit
 * @returns {number}
 */
function metersPerUnit(unit) {
  switch (unit) {
    case 'km': return METERS_PER_KILOMETER;
    case 'nm': return METERS_PER_NAUTICAL_MILE;
    case 'mi': return METERS_PER_STATUTE_MILE;
    default: {
      const _exhaustive = /** @type {never} */ (unit);
      void _exhaustive;
      return METERS_PER_KILOMETER;
    }
  }
}

/**
 * Convert a meter distance into the selected display unit.
 * @param {number} meters
 * @param {unknown} [unit]
 * @returns {{ unit: DistanceUnit, value: number, suffix: string }}
 */
export function convertMeters(meters, unit = getDistanceUnit()) {
  const resolved = normalizeDistanceUnit(unit) || DEFAULT_DISTANCE_UNIT;
  return {
    unit: resolved,
    value: meters / metersPerUnit(resolved),
    suffix: distanceUnitSuffix(resolved),
  };
}

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readStoredUnit(storage) {
  try {
    return normalizeDistanceUnit(resolveStore(storage)?.getItem?.(UNITS_STORAGE_KEY))
      || DEFAULT_DISTANCE_UNIT;
  } catch {
    return DEFAULT_DISTANCE_UNIT;
  }
}

/**
 * Restore the hosted unit preference. Missing or invalid storage keeps today's
 * production default (`km`) so first visit labels do not change.
 * @param {{storage?: {getItem?: Function}|null}} [options]
 * @returns {DistanceUnit}
 */
export function initDistanceUnits({ storage } = {}) {
  const resolved = readStoredUnit(storage);
  if (storage === undefined) sessionUnit = resolved;
  return resolved;
}

/** @returns {DistanceUnit} */
export function getDistanceUnit() {
  try {
    const stored = normalizeDistanceUnit(globalThis.localStorage?.getItem?.(UNITS_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    /* privacy-restricted storage falls through to the session default */
  }
  return sessionUnit;
}

/**
 * @param {unknown} unit
 * @param {{storage?: {getItem?: Function, setItem?: Function}|null, persist?: boolean}} [options]
 * @returns {DistanceUnit}
 */
export function setDistanceUnit(unit, { storage, persist = true } = {}) {
  const next = normalizeDistanceUnit(unit);
  if (!next) return storage === undefined ? getDistanceUnit() : readStoredUnit(storage);
  const previous = storage === undefined ? getDistanceUnit() : readStoredUnit(storage);
  if (storage === undefined) sessionUnit = next;
  if (persist) {
    try {
      resolveStore(storage)?.setItem?.(UNITS_STORAGE_KEY, next);
    } catch {
      /* privacy-restricted storage should not block the in-session toggle */
    }
  }
  if (next !== previous) {
    for (const listener of listeners) listener(next, previous);
  }
  return next;
}

/**
 * @param {(unit: DistanceUnit, previous: DistanceUnit) => void} listener
 * @returns {() => void}
 */
export function subscribeDistanceUnit(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Format an existing meter distance for range / contact labels.
 *
 * Default `km` output matches the production awareness formatter:
 * metres below 1 km, one decimal below 10 km, whole kilometres after that.
 *
 * @param {number} meters
 * @param {unknown} [unit]
 * @param {{style?: 'range'|'compact', decimals?: number}} [options]
 * @returns {string}
 */
export function formatDistanceMeters(meters, unit = getDistanceUnit(), options = {}) {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  const resolved = normalizeDistanceUnit(unit) || DEFAULT_DISTANCE_UNIT;
  const style = options.style === 'compact' ? 'compact' : 'range';
  const converted = convertMeters(meters, resolved);

  if (style === 'range' && resolved === 'km' && meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  const text = options.decimals === 0
    ? String(Math.round(converted.value))
    : (converted.value < 10 ? converted.value.toFixed(1) : String(Math.round(converted.value)));
  const suffix = style === 'compact' ? converted.suffix.toUpperCase() : converted.suffix;
  return `${text} ${suffix}`;
}

/**
 * Format stored Open-Meteo visibility (metres) with the Plan 44 distance
 * toggle. Missing or non-finite values stay UNAVAILABLE — this helper does
 * not invent a range or fetch weather.
 *
 * @param {unknown} visibilityM
 * @param {unknown} [unit]
 * @returns {string}
 */
export function formatWeatherVisibility(visibilityM, unit = getDistanceUnit()) {
  if (visibilityM === null || visibilityM === undefined || visibilityM === '') {
    return 'UNAVAILABLE';
  }
  const meters = Number(visibilityM);
  if (!Number.isFinite(meters) || meters < 0) return 'UNAVAILABLE';
  return formatDistanceMeters(meters, unit);
}

/**
 * Format an existing MSL altitude that is already held in metres.
 * Default `km` output matches the current HUD corner / summary strings.
 *
 * @param {number} altMslM
 * @param {{compact?: boolean, unit?: unknown}} [options]
 * @returns {string}
 */
export function formatHudAltitude(altMslM, { compact = false, unit = getDistanceUnit() } = {}) {
  if (!Number.isFinite(altMslM)) return compact ? '—' : '-----';
  const resolved = normalizeDistanceUnit(unit) || DEFAULT_DISTANCE_UNIT;
  const sign = altMslM < 0 ? '-' : '';
  const abs = Math.abs(altMslM);
  if (resolved === 'km') {
    if (compact) {
      return abs >= 1000
        ? `${sign}${(abs / 1000).toFixed(1)}KM`
        : `${sign}${Math.round(abs)}M`;
    }
    return `${sign}${Math.round(abs)}m`;
  }
  const converted = convertMeters(abs, resolved);
  const text = converted.value < 1
    ? converted.value.toFixed(2)
    : (converted.value < 10 ? converted.value.toFixed(1) : String(Math.round(converted.value)));
  const suffix = compact ? converted.suffix.toUpperCase() : converted.suffix;
  return `${sign}${text}${suffix}`;
}

/** Test-only: restore the first-visit default without touching storage. */
export function resetDistanceUnitsForTests() {
  sessionUnit = DEFAULT_DISTANCE_UNIT;
}
