/**
 * Live sun vs fixed well-lit globe lighting.
 *
 * Sun on: Cesium globe lighting follows the real-time clock (terminator).
 * Sun off: the existing well-lit look (`enableLighting = false`). The Cesium
 * clock is left alone so HUD/entity time keep moving.
 *
 * Persistence key is `meridian.liveSun`. This module does not add imagery,
 * styles, weather, or API routes. UTC | Local chrome lives in
 * `clockPreference.js` and only reformats the HUD clock.
 */

export const LIVE_SUN_STORAGE_KEY = 'meridian.liveSun';
/** Hosted default is the already-used well-lit globe, not a dark terminator. */
export const LIVE_SUN_DEFAULT = false;

/** Parse a stored live-sun flag. Missing or garbage values keep the well-lit default. */
export function liveSunEnabledFromStoredValue(value) {
  return value === '1' || value === 'true';
}

/** Read `meridian.liveSun` from storage. Unreadable storage fails open to well-lit. */
export function readLiveSunPreference(storage) {
  try {
    return liveSunEnabledFromStoredValue(storage?.getItem?.(LIVE_SUN_STORAGE_KEY));
  } catch {
    return LIVE_SUN_DEFAULT;
  }
}

/** Persist `meridian.liveSun` as `'1'` / `'0'`. */
export function writeLiveSunPreference(storage, enabled) {
  if (!storage?.setItem) return false;
  try {
    storage.setItem(LIVE_SUN_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/**
 * Solar noon on the given UTC calendar day at `lonDeg`.
 * UTC hour ≈ 12 − lon/15.
 */
export function noonDateAtLongitude(lonDeg, now = new Date()) {
  const lon = Number(lonDeg);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const noonUtcMs = Date.UTC(year, month, day, 12, 0, 0, 0);
  if (!Number.isFinite(lon)) return new Date(noonUtcMs);
  return new Date(noonUtcMs - (lon / 15) * 3_600_000);
}

/**
 * Apply live-sun or well-lit lighting to a Cesium-like viewer.
 * Does not create imagery, styles, or weather state.
 *
 * @param {object} viewer
 * @param {boolean} liveSun
 * @param {{now?: *, clockStep?: *}} [options]
 *   `now` is written to `clock.currentTime` only when live sun is on.
 */
export function applyLiveSunLighting(viewer, liveSun, options = {}) {
  const globe = viewer?.scene?.globe;
  const clock = viewer?.clock;
  const enabled = !!liveSun;
  if (globe) {
    globe.enableLighting = enabled;
    globe.dynamicAtmosphereLighting = enabled;
  }
  if (clock && enabled) {
    clock.shouldAnimate = true;
    if (options.clockStep != null) clock.clockStep = options.clockStep;
    if (options.now != null) clock.currentTime = options.now;
  }
  viewer?.scene?.requestRender?.();
  return {
    liveSun: enabled,
    enableLighting: !!globe?.enableLighting,
    dynamicAtmosphereLighting: !!globe?.dynamicAtmosphereLighting,
    shouldAnimate: !!clock?.shouldAnimate,
    clockStep: clock?.clockStep,
    currentTime: clock?.currentTime,
  };
}
