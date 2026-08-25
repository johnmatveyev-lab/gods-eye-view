/**
 * Client-only Actual | Feels chips for already-fetched Open-Meteo temperatures.
 *
 * This module only reformats stored Celsius observations. Feels uses
 * apparentTemperatureC through the existing °C/°F converter. Missing or
 * non-finite apparent stays UNAVAILABLE — it does not fall back to actual.
 * It does not fetch `/api/weather-effects` or `/api/regional-brief`, add an
 * endpoint, or change WX on/off. Persistence is local only
 * (`meridian.weatherFeels`) and is separate from °C/°F, wind, precip, and
 * km/nm/mi. Same hosted Open-Meteo observation — display conversion only,
 * not an alert service.
 */

import { formatTemperatureC } from './weatherUnits.js';

export const WEATHER_FEELS_MODES = Object.freeze(['actual', 'feels']);
export const DEFAULT_WEATHER_FEELS_MODE = 'actual';
export const WEATHER_FEELS_STORAGE_KEY = 'meridian.weatherFeels';

/** @typedef {'actual'|'feels'} WeatherFeelsMode */

let sessionMode = DEFAULT_WEATHER_FEELS_MODE;
const listeners = new Set();

/**
 * Resolve an untrusted feel-mode token to a shipped mode, or null.
 * @param {unknown} value
 * @returns {WeatherFeelsMode|null}
 */
export function normalizeWeatherFeelsMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'actual' || normalized === 'observed' || normalized === 'temperature') {
    return 'actual';
  }
  if (
    normalized === 'feels'
    || normalized === 'feel'
    || normalized === 'apparent'
    || normalized === 'feels-like'
    || normalized === 'feelslike'
  ) {
    return 'feels';
  }
  return null;
}

/**
 * Format already-fetched apparentTemperatureC. Missing/non-finite stays
 * UNAVAILABLE so operators never see a silent fallback to actual.
 * @param {unknown} celsius
 * @param {unknown} [unit]
 * @returns {string}
 */
export function formatApparentTemperatureC(celsius, unit) {
  if (celsius === null || celsius === undefined || celsius === '') return 'UNAVAILABLE';
  const value = Number(celsius);
  if (!Number.isFinite(value)) return 'UNAVAILABLE';
  return formatTemperatureC(value, unit);
}

/**
 * Local Info / HUD temperature string for the selected Actual | Feels mode.
 * Default Actual matches today's temperatureC readout.
 * @param {{temperatureC?: unknown, apparentTemperatureC?: unknown}|null|undefined} weather
 * @param {unknown} [mode]
 * @param {unknown} [unit]
 * @returns {string}
 */
export function formatWeatherHudTemperature(weather, mode = getWeatherFeelsMode(), unit) {
  const resolved = normalizeWeatherFeelsMode(mode) || DEFAULT_WEATHER_FEELS_MODE;
  switch (resolved) {
    case 'feels':
      return formatApparentTemperatureC(weather?.apparentTemperatureC, unit);
    case 'actual':
      return formatTemperatureC(weather?.temperatureC, unit);
    default: {
      const _exhaustive = /** @type {never} */ (resolved);
      void _exhaustive;
      return formatTemperatureC(weather?.temperatureC, unit);
    }
  }
}

/**
 * Hide Actual | Feels when the HUD is off or weather is not on screen.
 * @param {{weather?: {temperatureC?: unknown}|null, hudHidden?: boolean}} [state]
 * @returns {boolean}
 */
export function weatherFeelsChipsHidden({ weather, hudHidden } = {}) {
  if (hudHidden === true) return true;
  return !(weather && Number.isFinite(weather.temperatureC));
}

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readStoredMode(storage) {
  try {
    return normalizeWeatherFeelsMode(resolveStore(storage)?.getItem?.(WEATHER_FEELS_STORAGE_KEY))
      || DEFAULT_WEATHER_FEELS_MODE;
  } catch {
    return DEFAULT_WEATHER_FEELS_MODE;
  }
}

/**
 * Restore the hosted Actual | Feels preference. Missing or invalid storage
 * keeps today's production default (`actual`) so first-visit readouts stay
 * on temperatureC.
 * @param {{storage?: {getItem?: Function}|null}} [options]
 * @returns {WeatherFeelsMode}
 */
export function initWeatherFeelsMode({ storage } = {}) {
  const resolved = readStoredMode(storage);
  if (storage === undefined) sessionMode = resolved;
  return resolved;
}

/** @returns {WeatherFeelsMode} */
export function getWeatherFeelsMode() {
  try {
    const stored = normalizeWeatherFeelsMode(
      globalThis.localStorage?.getItem?.(WEATHER_FEELS_STORAGE_KEY),
    );
    if (stored) return stored;
  } catch {
    /* privacy-restricted storage falls through to the session default */
  }
  return sessionMode;
}

/**
 * @param {unknown} mode
 * @param {{storage?: {getItem?: Function, setItem?: Function}|null, persist?: boolean}} [options]
 * @returns {WeatherFeelsMode}
 */
export function setWeatherFeelsMode(mode, { storage, persist = true } = {}) {
  const next = normalizeWeatherFeelsMode(mode);
  if (!next) return storage === undefined ? getWeatherFeelsMode() : readStoredMode(storage);
  const previous = storage === undefined ? getWeatherFeelsMode() : readStoredMode(storage);
  if (storage === undefined) sessionMode = next;
  if (persist) {
    try {
      resolveStore(storage)?.setItem?.(WEATHER_FEELS_STORAGE_KEY, next);
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
 * @param {(mode: WeatherFeelsMode, previous: WeatherFeelsMode) => void} listener
 * @returns {() => void}
 */
export function subscribeWeatherFeelsMode(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * @param {{querySelectorAll?: Function}|null|undefined} root
 * @param {unknown} mode
 */
export function syncWeatherFeelsButtons(root, mode) {
  const normalized = normalizeWeatherFeelsMode(mode) || DEFAULT_WEATHER_FEELS_MODE;
  const buttons = root?.querySelectorAll?.('[data-weather-feels]') ?? [];
  for (const button of buttons) {
    button.setAttribute(
      'aria-pressed',
      button.dataset?.weatherFeels === normalized ? 'true' : 'false',
    );
  }
}

/**
 * @param {{addEventListener?: Function, removeEventListener?: Function, contains?: Function, querySelectorAll?: Function}|null|undefined} root
 * @param {{storage?: object, onChange?: Function, persist?: boolean}} [options]
 * @returns {() => void}
 */
export function bindWeatherFeelsToggle(root, { storage, onChange, persist = true } = {}) {
  if (!root?.addEventListener) return () => {};
  syncWeatherFeelsButtons(root, storage === undefined ? getWeatherFeelsMode() : readStoredMode(storage));
  const handler = (event) => {
    const button = event.target?.closest?.('[data-weather-feels]');
    if (!button || (typeof root.contains === 'function' && !root.contains(button))) return;
    const mode = setWeatherFeelsMode(button.dataset.weatherFeels, { storage, persist });
    syncWeatherFeelsButtons(root, mode);
    onChange?.(mode);
  };
  root.addEventListener('click', handler);
  return () => root.removeEventListener?.('click', handler);
}

/** Test-only: restore the first-visit default without touching storage. */
export function resetWeatherFeelsModeForTests() {
  sessionMode = DEFAULT_WEATHER_FEELS_MODE;
}
