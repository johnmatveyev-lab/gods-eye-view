/**
 * @module data/trafficMotion
 * @description Street Traffic Density and Speed sliders. Wires the existing
 * `setParams({ densityScale, speedScale })` contract — density 0.2–2.5
 * (default 1.0) changes dot spawn; speed 0.3–3.0 (default 1.0) scales
 * ambient/live dot motion. Preference lives in localStorage because traffic
 * is still `enabled-only` (no cheap numeric layer-option slot). Never written
 * into share URLs. Independent of Live | Sim, Uncovered Sim | Hide, and Jam viz.
 */

export const TRAFFIC_DENSITY_STORAGE_KEY = 'meridian.trafficDensity';
export const TRAFFIC_SPEED_STORAGE_KEY = 'meridian.trafficSpeed';
export const DEFAULT_TRAFFIC_DENSITY = 1.0;
export const DEFAULT_TRAFFIC_SPEED = 1.0;
export const TRAFFIC_DENSITY_MIN = 0.2;
export const TRAFFIC_DENSITY_MAX = 2.5;
export const TRAFFIC_SPEED_MIN = 0.3;
export const TRAFFIC_SPEED_MAX = 3.0;

/** @type {number|null} */
let cachedDensity = null;
/** @type {number|null} */
let cachedSpeed = null;

/** Clear in-memory prefs so the next read hits storage (reload / tests). */
export function resetTrafficMotionCache() {
  cachedDensity = null;
  cachedSpeed = null;
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampScale(value, min, max, fallback) {
  if (value == null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

/** @param {unknown} value @returns {number} */
export function clampTrafficDensity(value) {
  return clampScale(value, TRAFFIC_DENSITY_MIN, TRAFFIC_DENSITY_MAX, DEFAULT_TRAFFIC_DENSITY);
}

/** @param {unknown} value @returns {number} */
export function clampTrafficSpeed(value) {
  return clampScale(value, TRAFFIC_SPEED_MIN, TRAFFIC_SPEED_MAX, DEFAULT_TRAFFIC_SPEED);
}

/**
 * @param {unknown} raw
 * @param {number} fallback
 * @param {(value: unknown) => number} clamp
 * @returns {number}
 */
function readStoredScale(raw, fallback, clamp) {
  if (raw == null || raw === '') return fallback;
  return clamp(raw);
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {number}
 */
export function readTrafficDensity(storage) {
  try {
    return readStoredScale(
      storage?.getItem?.(TRAFFIC_DENSITY_STORAGE_KEY),
      DEFAULT_TRAFFIC_DENSITY,
      clampTrafficDensity,
    );
  } catch {
    return DEFAULT_TRAFFIC_DENSITY;
  }
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {number}
 */
export function readTrafficSpeed(storage) {
  try {
    return readStoredScale(
      storage?.getItem?.(TRAFFIC_SPEED_STORAGE_KEY),
      DEFAULT_TRAFFIC_SPEED,
      clampTrafficSpeed,
    );
  } catch {
    return DEFAULT_TRAFFIC_SPEED;
  }
}

/**
 * @param {unknown} value
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {number}
 */
export function writeTrafficDensity(value, storage) {
  const normalized = clampTrafficDensity(value);
  try {
    storage?.setItem?.(TRAFFIC_DENSITY_STORAGE_KEY, String(normalized));
  } catch {
    // Fail open: the session can still use the chosen density.
  }
  return normalized;
}

/**
 * @param {unknown} value
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {number}
 */
export function writeTrafficSpeed(value, storage) {
  const normalized = clampTrafficSpeed(value);
  try {
    storage?.setItem?.(TRAFFIC_SPEED_STORAGE_KEY, String(normalized));
  } catch {
    // Fail open: the session can still use the chosen speed.
  }
  return normalized;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {number}
 */
export function getTrafficDensity(storage = globalThis.localStorage) {
  if (cachedDensity != null) return cachedDensity;
  cachedDensity = readTrafficDensity(storage);
  return cachedDensity;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {number}
 */
export function getTrafficSpeed(storage = globalThis.localStorage) {
  if (cachedSpeed != null) return cachedSpeed;
  cachedSpeed = readTrafficSpeed(storage);
  return cachedSpeed;
}

/**
 * @param {unknown} value
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {number}
 */
export function setTrafficDensity(value, storage = globalThis.localStorage) {
  cachedDensity = writeTrafficDensity(value, storage);
  return cachedDensity;
}

/**
 * @param {unknown} value
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {number}
 */
export function setTrafficSpeed(value, storage = globalThis.localStorage) {
  cachedSpeed = writeTrafficSpeed(value, storage);
  return cachedSpeed;
}

/**
 * DATA LAYERS range inputs for Street Traffic: Density and Speed.
 * Slider params are `{ densityScale }` / `{ speedScale }` only.
 * @param {{densityScale?: unknown, speedScale?: unknown}} [input]
 * @returns {Array<object>}
 */
export function trafficMotionSliders({
  densityScale = DEFAULT_TRAFFIC_DENSITY,
  speedScale = DEFAULT_TRAFFIC_SPEED,
} = {}) {
  const density = clampTrafficDensity(densityScale);
  const speed = clampTrafficSpeed(speedScale);
  return [
    {
      id: 'traffic-density',
      label: 'Density',
      title: 'Dot spawn density. Applies on the next camera-driven load.',
      param: 'densityScale',
      min: TRAFFIC_DENSITY_MIN,
      max: TRAFFIC_DENSITY_MAX,
      step: 0.1,
      value: density,
      params: { densityScale: density },
    },
    {
      id: 'traffic-speed',
      label: 'Speed',
      title: 'Dot motion speed. Applies on the next camera-driven load.',
      param: 'speedScale',
      min: TRAFFIC_SPEED_MIN,
      max: TRAFFIC_SPEED_MAX,
      step: 0.1,
      value: speed,
      params: { speedScale: speed },
    },
  ];
}
