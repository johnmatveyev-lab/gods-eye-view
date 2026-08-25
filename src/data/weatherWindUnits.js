/**
 * Client-only weather wind-speed units for Meridian Local Info / HUD.
 *
 * Converts already-fetched Open-Meteo `windKph`. Does not fetch
 * `/api/weather-effects` or `/api/regional-brief`, change direction, or
 * share storage with °C/°F or km/nm/mi.
 */

export const WIND_UNITS = Object.freeze(['kmh', 'mph', 'kt']);
export const DEFAULT_WIND_UNIT = 'kmh';
export const WIND_UNITS_STORAGE_KEY = 'meridian.weatherWind';
export const WIND_UNIT_CHANGE_EVENT = 'meridian:weather-wind';

/** Statute miles per kilometre (mph = windKph × this). */
export const MPH_PER_KMH = 0.621371;
/** International knots per kilometre per hour (kt = windKph × this). */
export const KT_PER_KMH = 0.539957;

/** @typedef {'kmh'|'mph'|'kt'} WindUnit */

let sessionUnit = DEFAULT_WIND_UNIT;
const listeners = new Set();

/**
 * Resolve an untrusted unit token to a shipped wind unit, or null.
 * @param {unknown} value
 * @returns {WindUnit|null}
 */
export function normalizeWindUnit(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  if (normalized === 'kmh' || normalized === 'km/h' || normalized === 'kph' || normalized === 'kmph') {
    return 'kmh';
  }
  if (normalized === 'mph' || normalized === 'mi/h' || normalized === 'mile' || normalized === 'miles') {
    return 'mph';
  }
  if (normalized === 'kt' || normalized === 'kn' || normalized === 'knot' || normalized === 'knots') {
    return 'kt';
  }
  return null;
}

/**
 * Suffix printed on the existing Local Info wind readout.
 * Default `kmh` matches today's `18 KM/H` string.
 * @param {WindUnit} unit
 * @returns {'KM/H'|'MPH'|'KT'}
 */
export function windUnitSuffix(unit) {
  switch (unit) {
    case 'kmh': return 'KM/H';
    case 'mph': return 'MPH';
    case 'kt': return 'KT';
    default: {
      const _exhaustive = /** @type {never} */ (unit);
      void _exhaustive;
      return 'KM/H';
    }
  }
}

/**
 * Convert already-fetched windKph into the selected display unit.
 * @param {number} windKph
 * @param {unknown} [unit]
 * @returns {{ unit: WindUnit, value: number, suffix: string }}
 */
export function convertWindKph(windKph, unit = getWindUnit()) {
  const resolved = normalizeWindUnit(unit) || DEFAULT_WIND_UNIT;
  switch (resolved) {
    case 'kmh':
      return { unit: resolved, value: windKph, suffix: windUnitSuffix(resolved) };
    case 'mph':
      return { unit: resolved, value: windKph * MPH_PER_KMH, suffix: windUnitSuffix(resolved) };
    case 'kt':
      return { unit: resolved, value: windKph * KT_PER_KMH, suffix: windUnitSuffix(resolved) };
    default: {
      const _exhaustive = /** @type {never} */ (resolved);
      void _exhaustive;
      return { unit: DEFAULT_WIND_UNIT, value: windKph, suffix: windUnitSuffix(DEFAULT_WIND_UNIT) };
    }
  }
}

/**
 * Format the existing Local Info wind speed. Default km/h matches production.
 * @param {unknown} windKph
 * @param {unknown} [unit]
 * @returns {string}
 */
export function formatWindSpeed(windKph, unit = getWindUnit()) {
  if (!Number.isFinite(Number(windKph))) return '—';
  const converted = convertWindKph(Number(windKph), unit);
  return `${Math.round(converted.value)} ${converted.suffix}`;
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
    return normalizeWindUnit(resolveStore(storage)?.getItem?.(WIND_UNITS_STORAGE_KEY))
      || DEFAULT_WIND_UNIT;
  } catch {
    return DEFAULT_WIND_UNIT;
  }
}

/**
 * Restore the hosted wind-unit preference. Missing or invalid storage keeps
 * today's production default (`kmh`) so first-visit readouts do not change.
 * @param {{storage?: {getItem?: Function}|null}} [options]
 * @returns {WindUnit}
 */
export function initWindUnits({ storage } = {}) {
  const resolved = readStoredUnit(storage);
  if (storage === undefined) sessionUnit = resolved;
  return resolved;
}

/** @returns {WindUnit} */
export function getWindUnit() {
  try {
    const stored = normalizeWindUnit(globalThis.localStorage?.getItem?.(WIND_UNITS_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    /* privacy-restricted storage falls through to the session default */
  }
  return sessionUnit;
}

/**
 * @param {unknown} unit
 * @param {{storage?: {getItem?: Function, setItem?: Function}|null, persist?: boolean}} [options]
 * @returns {WindUnit}
 */
export function setWindUnit(unit, { storage, persist = true } = {}) {
  const next = normalizeWindUnit(unit);
  if (!next) return storage === undefined ? getWindUnit() : readStoredUnit(storage);
  const previous = storage === undefined ? getWindUnit() : readStoredUnit(storage);
  if (storage === undefined) sessionUnit = next;
  if (persist) {
    try {
      resolveStore(storage)?.setItem?.(WIND_UNITS_STORAGE_KEY, next);
    } catch {
      /* privacy-restricted storage should not block the in-session toggle */
    }
  }
  if (next !== previous) {
    for (const listener of listeners) listener(next, previous);
    if (storage === undefined
      && typeof globalThis.dispatchEvent === 'function'
      && typeof globalThis.CustomEvent === 'function') {
      globalThis.dispatchEvent(new CustomEvent(WIND_UNIT_CHANGE_EVENT, {
        detail: { unit: next, previous },
      }));
    }
  }
  return next;
}

/**
 * @param {(unit: WindUnit, previous: WindUnit) => void} listener
 * @returns {() => void}
 */
export function subscribeWindUnit(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * @param {{querySelectorAll?: Function}|null|undefined} root
 * @param {unknown} unit
 */
export function syncWindUnitButtons(root, unit) {
  const normalized = normalizeWindUnit(unit) || DEFAULT_WIND_UNIT;
  const buttons = root?.querySelectorAll?.('[data-wind-unit]') ?? [];
  for (const button of buttons) {
    const active = button.dataset?.windUnit === normalized;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute('aria-checked', active ? 'true' : 'false');
    button.classList?.toggle?.('active', active);
  }
}

/**
 * @param {{addEventListener?: Function, removeEventListener?: Function, contains?: Function, querySelectorAll?: Function}|null|undefined} root
 * @param {{storage?: object, onChange?: Function}} [options]
 * @returns {() => void}
 */
export function bindWindUnitToggle(root, { storage, onChange } = {}) {
  if (!root?.addEventListener) return () => {};
  const initial = storage === undefined ? getWindUnit() : readStoredUnit(storage);
  syncWindUnitButtons(root, initial);
  const handler = (event) => {
    const button = event.target?.closest?.('[data-wind-unit]');
    if (!button || (typeof root.contains === 'function' && !root.contains(button))) return;
    const unit = setWindUnit(button.dataset.windUnit, { storage });
    syncWindUnitButtons(root, unit);
    onChange?.(unit);
  };
  root.addEventListener('click', handler);
  return () => root.removeEventListener?.('click', handler);
}

/** Test-only: restore the first-visit default without touching storage. */
export function resetWindUnitsForTests() {
  sessionUnit = DEFAULT_WIND_UNIT;
  listeners.clear();
}
