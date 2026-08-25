/**
 * Client-side mm | in chips for already-fetched Open-Meteo precipitation.
 *
 * This module only reformats stored millimetre observations (`precipitationMm`).
 * It does not fetch weather-effects or regional-brief, add an
 * endpoint, or change WX on/off. Persistence is local only
 * (`meridian.weatherPrecipUnits`) and is separate from °C/°F
 * (`meridian.weatherUnits`), wind units (`meridian.weatherWind`), and the
 * Plan 44 km/nm/mi distance key. Same hosted Open-Meteo observation — display
 * conversion only, not an alert service.
 */

export const PRECIP_UNITS = Object.freeze(['mm', 'in']);
export const DEFAULT_PRECIP_UNIT = 'mm';
export const WEATHER_PRECIP_UNITS_STORAGE_KEY = 'meridian.weatherPrecipUnits';
/** International inch. */
export const MM_PER_INCH = 25.4;

/** @typedef {'mm'|'in'} PrecipUnit */

let sessionUnit = DEFAULT_PRECIP_UNIT;
const listeners = new Set();

/**
 * Resolve an untrusted unit token to a shipped unit, or null.
 * @param {unknown} value
 * @returns {PrecipUnit|null}
 */
export function normalizePrecipUnit(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'mm' || normalized === 'millimeter' || normalized === 'millimetre'
    || normalized === 'millimeters' || normalized === 'millimetres') return 'mm';
  if (normalized === 'in' || normalized === 'inch' || normalized === 'inches') return 'in';
  return null;
}

/**
 * @param {number} millimetres
 * @returns {number}
 */
export function mmToInches(millimetres) {
  if (!Number.isFinite(millimetres)) return Number.NaN;
  return millimetres / MM_PER_INCH;
}

/**
 * Convert a stored millimetre observation into the selected display unit.
 * @param {number} millimetres
 * @param {unknown} [unit]
 * @returns {{ unit: PrecipUnit, value: number, suffix: string }}
 */
export function convertPrecipitationMm(millimetres, unit = getPrecipUnit()) {
  const resolved = normalizePrecipUnit(unit) || DEFAULT_PRECIP_UNIT;
  switch (resolved) {
    case 'in':
      return { unit: resolved, value: mmToInches(millimetres), suffix: 'in' };
    case 'mm':
      return { unit: resolved, value: millimetres, suffix: 'mm' };
    default: {
      const _exhaustive = /** @type {never} */ (resolved);
      void _exhaustive;
      return { unit: DEFAULT_PRECIP_UNIT, value: millimetres, suffix: 'mm' };
    }
  }
}

/**
 * Format a stored millimetre value the way the Local Info / HUD readout does.
 * Default mm matches the current one-decimal production string.
 * @param {unknown} millimetres
 * @param {unknown} [unit]
 * @returns {string}
 */
export function formatPrecipitationMm(millimetres, unit = getPrecipUnit()) {
  if (millimetres === null || millimetres === undefined || millimetres === '') return '—';
  const value = Number(millimetres);
  if (!Number.isFinite(value)) return '—';
  const converted = convertPrecipitationMm(value, unit);
  switch (converted.unit) {
    case 'mm':
      return converted.value.toFixed(1);
    case 'in':
      return converted.value.toFixed(2);
    default: {
      const _exhaustive = /** @type {never} */ (converted.unit);
      void _exhaustive;
      return converted.value.toFixed(1);
    }
  }
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
    return normalizePrecipUnit(resolveStore(storage)?.getItem?.(WEATHER_PRECIP_UNITS_STORAGE_KEY))
      || DEFAULT_PRECIP_UNIT;
  } catch {
    return DEFAULT_PRECIP_UNIT;
  }
}

/**
 * Restore the hosted precipitation-unit preference. Missing or invalid storage
 * keeps today's production default (`mm`) so first-visit readouts stay mm.
 * @param {{storage?: {getItem?: Function}|null}} [options]
 * @returns {PrecipUnit}
 */
export function initWeatherPrecipUnits({ storage } = {}) {
  const resolved = readStoredUnit(storage);
  if (storage === undefined) sessionUnit = resolved;
  return resolved;
}

/** @returns {PrecipUnit} */
export function getPrecipUnit() {
  try {
    const stored = normalizePrecipUnit(
      globalThis.localStorage?.getItem?.(WEATHER_PRECIP_UNITS_STORAGE_KEY),
    );
    if (stored) return stored;
  } catch {
    /* privacy-restricted storage falls through to the session default */
  }
  return sessionUnit;
}

/**
 * @param {unknown} unit
 * @param {{storage?: {getItem?: Function, setItem?: Function}|null, persist?: boolean}} [options]
 * @returns {PrecipUnit}
 */
export function setPrecipUnit(unit, { storage, persist = true } = {}) {
  const next = normalizePrecipUnit(unit);
  if (!next) return storage === undefined ? getPrecipUnit() : readStoredUnit(storage);
  const previous = storage === undefined ? getPrecipUnit() : readStoredUnit(storage);
  if (storage === undefined) sessionUnit = next;
  if (persist) {
    try {
      resolveStore(storage)?.setItem?.(WEATHER_PRECIP_UNITS_STORAGE_KEY, next);
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
 * @param {(unit: PrecipUnit, previous: PrecipUnit) => void} listener
 * @returns {() => void}
 */
export function subscribeWeatherPrecipUnits(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * @param {{querySelectorAll?: Function}|null|undefined} root
 * @param {unknown} unit
 */
export function syncWeatherPrecipUnitButtons(root, unit) {
  const normalized = normalizePrecipUnit(unit) || DEFAULT_PRECIP_UNIT;
  const buttons = root?.querySelectorAll?.('[data-weather-precip-units]') ?? [];
  for (const button of buttons) {
    button.setAttribute(
      'aria-pressed',
      button.dataset?.weatherPrecipUnits === normalized ? 'true' : 'false',
    );
  }
}

/**
 * @param {{addEventListener?: Function, removeEventListener?: Function, contains?: Function, querySelectorAll?: Function}|null|undefined} root
 * @param {{storage?: object, onChange?: Function, persist?: boolean}} [options]
 * @returns {() => void}
 */
export function bindWeatherPrecipUnitToggle(root, { storage, onChange, persist = true } = {}) {
  if (!root?.addEventListener) return () => {};
  syncWeatherPrecipUnitButtons(root, storage === undefined ? getPrecipUnit() : readStoredUnit(storage));
  const handler = (event) => {
    const button = event.target?.closest?.('[data-weather-precip-units]');
    if (!button || (typeof root.contains === 'function' && !root.contains(button))) return;
    const unit = setPrecipUnit(button.dataset.weatherPrecipUnits, { storage, persist });
    syncWeatherPrecipUnitButtons(root, unit);
    onChange?.(unit);
  };
  root.addEventListener('click', handler);
  return () => root.removeEventListener?.('click', handler);
}

/** Test-only: restore the first-visit default without touching storage. */
export function resetWeatherPrecipUnitsForTests() {
  sessionUnit = DEFAULT_PRECIP_UNIT;
}
