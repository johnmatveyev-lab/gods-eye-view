/**
 * Hosted Power preference — Cesium frame-budget only.
 *
 * Reduce-motion (DISPLAY Still) cuts decoration, not the render loop.
 * Models/trails toggles are per-feature. Hosted laptops still cook at the
 * current 60 fps Cesium cap on ProMotion panels.
 *
 * This module writes the existing `viewer.targetFrameRate` only:
 *   - Normal restores today's default (60)
 *   - Low caps at 30
 *
 * It does not change data polls, does not add a renderer, and does not
 * fight the idle render governor's `requestRenderMode`. Preference lives
 * in localStorage `meridian.power` and is never written into share URLs.
 */

export const POWER_STORAGE_KEY = 'meridian.power';
export const POWER_NORMAL = 'normal';
export const POWER_LOW = 'low';
export const DEFAULT_POWER_MODE = POWER_NORMAL;
export const TARGET_FRAME_RATE_NORMAL = 60;
export const TARGET_FRAME_RATE_LOW = 30;

/** @typedef {'normal'|'low'} PowerMode */

/**
 * @param {unknown} value
 * @returns {PowerMode}
 */
export function normalizePowerMode(value) {
  return String(value || '').trim().toLowerCase() === POWER_LOW
    ? POWER_LOW
    : POWER_NORMAL;
}

/**
 * @param {unknown} mode
 * @returns {number}
 */
export function targetFrameRateForPowerMode(mode) {
  switch (normalizePowerMode(mode)) {
    case POWER_LOW:
      return TARGET_FRAME_RATE_LOW;
    case POWER_NORMAL:
      return TARGET_FRAME_RATE_NORMAL;
    default: {
      const _exhaustive = /** @type {never} */ (normalizePowerMode(mode));
      void _exhaustive;
      return TARGET_FRAME_RATE_NORMAL;
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

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {PowerMode}
 */
export function readStoredPowerMode(storage) {
  try {
    return normalizePowerMode(resolveStore(storage)?.getItem?.(POWER_STORAGE_KEY));
  } catch {
    return DEFAULT_POWER_MODE;
  }
}

/**
 * @param {unknown} mode
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {PowerMode}
 */
export function writeStoredPowerMode(mode, storage) {
  const normalized = normalizePowerMode(mode);
  try {
    resolveStore(storage)?.setItem?.(POWER_STORAGE_KEY, normalized);
  } catch {
    /* privacy-restricted storage should not block the in-session toggle */
  }
  return normalized;
}

/**
 * Apply a power mode to an existing Cesium viewer. Render pacing only.
 * @param {{targetFrameRate?: number, scene?: {requestRenderMode?: boolean}}|null|undefined} viewer
 * @param {unknown} mode
 * @returns {PowerMode}
 */
export function applyPowerMode(viewer, mode) {
  const normalized = normalizePowerMode(mode);
  if (viewer) viewer.targetFrameRate = targetFrameRateForPowerMode(normalized);
  return normalized;
}

/**
 * Restore `meridian.power` onto the viewer. Missing or invalid storage keeps
 * today's production default (60 fps).
 * @param {{targetFrameRate?: number}|null|undefined} viewer
 * @param {{storage?: {getItem?: Function}|null}} [options]
 * @returns {PowerMode}
 */
export function installPowerMode(viewer, { storage } = {}) {
  return applyPowerMode(viewer, readStoredPowerMode(storage));
}

/**
 * Persist and apply a power mode.
 * @param {{targetFrameRate?: number}|null|undefined} viewer
 * @param {unknown} mode
 * @param {{storage?: {getItem?: Function, setItem?: Function}|null, persist?: boolean}} [options]
 * @returns {PowerMode}
 */
export function setPowerMode(viewer, mode, { storage, persist = true } = {}) {
  const normalized = persist ? writeStoredPowerMode(mode, storage) : normalizePowerMode(mode);
  return applyPowerMode(viewer, normalized);
}

/**
 * @param {{targetFrameRate?: number}|null|undefined} viewer
 * @returns {PowerMode}
 */
export function getPowerMode(viewer) {
  if (viewer?.targetFrameRate === TARGET_FRAME_RATE_LOW) return POWER_LOW;
  return POWER_NORMAL;
}
