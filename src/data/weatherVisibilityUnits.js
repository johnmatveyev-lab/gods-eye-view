/**
 * Client-side km | mi chips for already-fetched Open-Meteo visibility.
 *
 * This module only reformats stored metre observations (`visibilityM`).
 * It does not fetch `/api/weather-effects` or `/api/regional-brief`, add an
 * endpoint, or change WX on/off. Persistence is local only
 * (`meridian.weatherVisibility`) and is separate from °C/°F
 * (`meridian.weatherUnits`), wind (`meridian.weatherWind`), precip
 * (`meridian.weatherPrecipUnits`), feels (`meridian.weatherFeels`), and the
 * Plan 44 km/nm/mi distance key. Same hosted Open-Meteo observation — display
 * conversion only, not an alert service.
 */

export const VISIBILITY_UNITS = Object.freeze(['km', 'mi']);
export const DEFAULT_VISIBILITY_UNIT = 'km';
export const WEATHER_VISIBILITY_STORAGE_KEY = 'meridian.weatherVisibility';
/** International kilometre. */
export const METERS_PER_KILOMETER = 1000;
/** Statute mile — same constant neighboring distance units already use. */
export const METERS_PER_STATUTE_MILE = 1609.344;

/** @typedef {'km'|'mi'} VisibilityUnit */

let sessionUnit = DEFAULT_VISIBILITY_UNIT;
const listeners = new Set();

/**
 * Resolve an untrusted unit token to a shipped unit, or null.
 * @param {unknown} value
 * @returns {VisibilityUnit|null}
 */
export function normalizeVisibilityUnit(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'km' || normalized === 'kilometer' || normalized === 'kilometre'
    || normalized === 'kilometers' || normalized === 'kilometres') return 'km';
  if (normalized === 'mi' || normalized === 'mile' || normalized === 'miles') return 'mi';
  return null;
}

/**
 * @param {number} meters
 * @returns {number}
 */
export function metersToKm(meters) {
  if (!Number.isFinite(meters)) return Number.NaN;
  return meters / METERS_PER_KILOMETER;
}

/**
 * @param {number} meters
 * @returns {number}
 */
export function metersToMiles(meters) {
  if (!Number.isFinite(meters)) return Number.NaN;
  return meters / METERS_PER_STATUTE_MILE;
}

/**
 * Convert a stored metre observation into the selected display unit.
 * @param {number} meters
 * @param {unknown} [unit]
 * @returns {{ unit: VisibilityUnit, value: number, suffix: string }}
 */
export function convertVisibilityM(meters, unit = getVisibilityUnit()) {
  const resolved = normalizeVisibilityUnit(unit) || DEFAULT_VISIBILITY_UNIT;
  switch (resolved) {
    case 'mi':
      return { unit: resolved, value: metersToMiles(meters), suffix: 'mi' };
    case 'km':
      return { unit: resolved, value: metersToKm(meters), suffix: 'km' };
    default: {
      const _exhaustive = /** @type {never} */ (resolved);
      void _exhaustive;
      return { unit: DEFAULT_VISIBILITY_UNIT, value: metersToKm(meters), suffix: 'km' };
    }
  }
}

/**
 * Format stored visibility metres for the Local Info / HUD readout.
 * Default km matches today's first-visit string. Missing or non-finite stays
 * UNAVAILABLE — this helper does not invent a range.
 * @param {unknown} visibilityM
 * @param {unknown} [unit]
 * @returns {string}
 */
export function formatVisibilityM(visibilityM, unit = getVisibilityUnit()) {
  if (visibilityM === null || visibilityM === undefined || visibilityM === '') {
    return 'UNAVAILABLE';
  }
  const meters = Number(visibilityM);
  if (!Number.isFinite(meters) || meters < 0) return 'UNAVAILABLE';
  const converted = convertVisibilityM(meters, unit);
  switch (converted.unit) {
    case 'km':
    case 'mi':
      return `${Math.round(converted.value)} ${converted.suffix}`;
    default: {
      const _exhaustive = /** @type {never} */ (converted.unit);
      void _exhaustive;
      return `${Math.round(converted.value)} km`;
    }
  }
}

/**
 * Hide km | mi when the HUD is off or visibility is not on screen.
 * @param {{weather?: {visibilityM?: unknown}|null, hudHidden?: boolean}} [state]
 * @returns {boolean}
 */
export function weatherVisibilityChipsHidden({ weather, hudHidden } = {}) {
  if (hudHidden === true) return true;
  return !Number.isFinite(Number(weather?.visibilityM));
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
    return normalizeVisibilityUnit(resolveStore(storage)?.getItem?.(WEATHER_VISIBILITY_STORAGE_KEY))
      || DEFAULT_VISIBILITY_UNIT;
  } catch {
    return DEFAULT_VISIBILITY_UNIT;
  }
}

/**
 * Restore the hosted visibility-unit preference. Missing or invalid storage
 * keeps today's production default (`km`) so first-visit readouts stay km.
 * @param {{storage?: {getItem?: Function}|null}} [options]
 * @returns {VisibilityUnit}
 */
export function initWeatherVisibilityUnits({ storage } = {}) {
  const resolved = readStoredUnit(storage);
  if (storage === undefined) sessionUnit = resolved;
  return resolved;
}

/** @returns {VisibilityUnit} */
export function getVisibilityUnit() {
  try {
    const stored = normalizeVisibilityUnit(
      globalThis.localStorage?.getItem?.(WEATHER_VISIBILITY_STORAGE_KEY),
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
 * @returns {VisibilityUnit}
 */
export function setVisibilityUnit(unit, { storage, persist = true } = {}) {
  const next = normalizeVisibilityUnit(unit);
  if (!next) return storage === undefined ? getVisibilityUnit() : readStoredUnit(storage);
  const previous = storage === undefined ? getVisibilityUnit() : readStoredUnit(storage);
  if (storage === undefined) sessionUnit = next;
  if (persist) {
    try {
      resolveStore(storage)?.setItem?.(WEATHER_VISIBILITY_STORAGE_KEY, next);
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
 * @param {(unit: VisibilityUnit, previous: VisibilityUnit) => void} listener
 * @returns {() => void}
 */
export function subscribeWeatherVisibilityUnits(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * @param {{querySelectorAll?: Function}|null|undefined} root
 * @param {unknown} unit
 */
export function syncWeatherVisibilityUnitButtons(root, unit) {
  const normalized = normalizeVisibilityUnit(unit) || DEFAULT_VISIBILITY_UNIT;
  const buttons = root?.querySelectorAll?.('[data-weather-visibility]') ?? [];
  for (const button of buttons) {
    button.setAttribute(
      'aria-pressed',
      button.dataset?.weatherVisibility === normalized ? 'true' : 'false',
    );
  }
}

/**
 * @param {{addEventListener?: Function, removeEventListener?: Function, contains?: Function, querySelectorAll?: Function}|null|undefined} root
 * @param {{storage?: object, onChange?: Function, persist?: boolean}} [options]
 * @returns {() => void}
 */
export function bindWeatherVisibilityUnitToggle(root, { storage, onChange, persist = true } = {}) {
  if (!root?.addEventListener) return () => {};
  syncWeatherVisibilityUnitButtons(
    root,
    storage === undefined ? getVisibilityUnit() : readStoredUnit(storage),
  );
  const handler = (event) => {
    const button = event.target?.closest?.('[data-weather-visibility]');
    if (!button || (typeof root.contains === 'function' && !root.contains(button))) return;
    const unit = setVisibilityUnit(button.dataset.weatherVisibility, { storage, persist });
    syncWeatherVisibilityUnitButtons(root, unit);
    onChange?.(unit);
  };
  root.addEventListener('click', handler);
  return () => root.removeEventListener?.('click', handler);
}

/** Test-only: restore the first-visit default without touching storage. */
export function resetWeatherVisibilityUnitsForTests() {
  sessionUnit = DEFAULT_VISIBILITY_UNIT;
}
