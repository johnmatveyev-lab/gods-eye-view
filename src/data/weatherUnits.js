/**
 * Client-side °C | °F chips for already-fetched Open-Meteo temperatures.
 *
 * This module only reformats stored Celsius observations (`temperatureC`,
 * `apparentTemperatureC`). It does not fetch `/api/weather-effects` or
 * `/api/regional-brief`, add an endpoint, or change WX on/off. Persistence
 * is local only (`meridian.weatherUnits`) and is separate from the Plan 44
 * km/nm/mi distance key. Same hosted Open-Meteo observation — display
 * conversion only, not an alert service.
 */

export const TEMPERATURE_UNITS = Object.freeze(['C', 'F']);
export const DEFAULT_TEMPERATURE_UNIT = 'C';
export const WEATHER_UNITS_STORAGE_KEY = 'meridian.weatherUnits';

/** @typedef {'C'|'F'} TemperatureUnit */

let sessionUnit = DEFAULT_TEMPERATURE_UNIT;
const listeners = new Set();

/**
 * Resolve an untrusted unit token to a shipped unit, or null.
 * @param {unknown} value
 * @returns {TemperatureUnit|null}
 */
export function normalizeTemperatureUnit(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'c' || normalized === 'celsius' || normalized === 'metric') return 'C';
  if (normalized === 'f' || normalized === 'fahrenheit' || normalized === 'imperial') return 'F';
  return null;
}

/**
 * @param {number} celsius
 * @returns {number}
 */
export function celsiusToFahrenheit(celsius) {
  if (!Number.isFinite(celsius)) return Number.NaN;
  return celsius * (9 / 5) + 32;
}

/**
 * Convert a stored Celsius observation into the selected display unit.
 * @param {number} celsius
 * @param {unknown} [unit]
 * @returns {{ unit: TemperatureUnit, value: number, suffix: string }}
 */
export function convertTemperatureC(celsius, unit = getTemperatureUnit()) {
  const resolved = normalizeTemperatureUnit(unit) || DEFAULT_TEMPERATURE_UNIT;
  switch (resolved) {
    case 'F':
      return { unit: resolved, value: celsiusToFahrenheit(celsius), suffix: '°F' };
    case 'C':
      return { unit: resolved, value: celsius, suffix: '°C' };
    default: {
      const _exhaustive = /** @type {never} */ (resolved);
      void _exhaustive;
      return { unit: DEFAULT_TEMPERATURE_UNIT, value: celsius, suffix: '°C' };
    }
  }
}

/**
 * Format a stored Celsius value the way the Local Info / HUD readout does.
 * Default °C matches the current rounded production string.
 * @param {unknown} celsius
 * @param {unknown} [unit]
 * @returns {string}
 */
export function formatTemperatureC(celsius, unit = getTemperatureUnit()) {
  const value = Number(celsius);
  if (!Number.isFinite(value)) return '—';
  const converted = convertTemperatureC(value, unit);
  return `${Math.round(converted.value)}${converted.suffix}`;
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
    return normalizeTemperatureUnit(resolveStore(storage)?.getItem?.(WEATHER_UNITS_STORAGE_KEY))
      || DEFAULT_TEMPERATURE_UNIT;
  } catch {
    return DEFAULT_TEMPERATURE_UNIT;
  }
}

/**
 * Restore the hosted temperature-unit preference. Missing or invalid storage
 * keeps today's production default (`C`) so first-visit readouts stay °C.
 * @param {{storage?: {getItem?: Function}|null}} [options]
 * @returns {TemperatureUnit}
 */
export function initWeatherUnits({ storage } = {}) {
  const resolved = readStoredUnit(storage);
  if (storage === undefined) sessionUnit = resolved;
  return resolved;
}

/** @returns {TemperatureUnit} */
export function getTemperatureUnit() {
  try {
    const stored = normalizeTemperatureUnit(
      globalThis.localStorage?.getItem?.(WEATHER_UNITS_STORAGE_KEY),
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
 * @returns {TemperatureUnit}
 */
export function setTemperatureUnit(unit, { storage, persist = true } = {}) {
  const next = normalizeTemperatureUnit(unit);
  if (!next) return storage === undefined ? getTemperatureUnit() : readStoredUnit(storage);
  const previous = storage === undefined ? getTemperatureUnit() : readStoredUnit(storage);
  if (storage === undefined) sessionUnit = next;
  if (persist) {
    try {
      resolveStore(storage)?.setItem?.(WEATHER_UNITS_STORAGE_KEY, next);
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
 * @param {(unit: TemperatureUnit, previous: TemperatureUnit) => void} listener
 * @returns {() => void}
 */
export function subscribeWeatherUnits(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * @param {{querySelectorAll?: Function}|null|undefined} root
 * @param {unknown} unit
 */
export function syncWeatherUnitButtons(root, unit) {
  const normalized = normalizeTemperatureUnit(unit) || DEFAULT_TEMPERATURE_UNIT;
  const buttons = root?.querySelectorAll?.('[data-weather-units]') ?? [];
  for (const button of buttons) {
    button.setAttribute(
      'aria-pressed',
      button.dataset?.weatherUnits === normalized ? 'true' : 'false',
    );
  }
}

/**
 * @param {{addEventListener?: Function, removeEventListener?: Function, contains?: Function, querySelectorAll?: Function}|null|undefined} root
 * @param {{storage?: object, onChange?: Function}} [options]
 * @returns {() => void}
 */
export function bindWeatherUnitToggle(root, { storage, onChange, persist = true } = {}) {
  if (!root?.addEventListener) return () => {};
  syncWeatherUnitButtons(root, storage === undefined ? getTemperatureUnit() : readStoredUnit(storage));
  const handler = (event) => {
    const button = event.target?.closest?.('[data-weather-units]');
    if (!button || (typeof root.contains === 'function' && !root.contains(button))) return;
    const unit = setTemperatureUnit(button.dataset.weatherUnits, { storage, persist });
    syncWeatherUnitButtons(root, unit);
    onChange?.(unit);
  };
  root.addEventListener('click', handler);
  return () => root.removeEventListener?.('click', handler);
}

/** Test-only: restore the first-visit default without touching storage. */
export function resetWeatherUnitsForTests() {
  sessionUnit = DEFAULT_TEMPERATURE_UNIT;
}
