/**
 * Keep the map camera above terrain after it moves.
 *
 * Height-datum / aircraft floors stay in groundFloor.js. This module only
 * lifts the viewer camera when an existing helper already knows the ground:
 * `viewer.scene.globe.getHeight` or the warm `/api/terrain/heights` cache
 * (`cachedGroundFloor`). It does not add an API.
 *
 * Persistence is `meridian.keepAbove`. Default ON (cheap: sync cache +
 * already-loaded globe height). Cockpit interior keeps the existing cockpit
 * camera — this clamp stands down while cockpit is active.
 */

import {
  cachedGroundFloor,
  resolveGroundFloorCellsBounded,
} from './data/groundFloor.js';

export const KEEP_ABOVE_STORAGE_KEY = 'meridian.keepAbove';
export const KEEP_ABOVE_DEFAULT = true;
/** Small clearance so the near plane does not z-fight the mesh. */
export const KEEP_ABOVE_MARGIN_M = 2;

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function cartographicDegrees(carto) {
  return {
    lat: carto.latitude * (180 / Math.PI),
    lon: carto.longitude * (180 / Math.PI),
  };
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit off is off;
 * missing or corrupt values keep the product default ON.
 * @param {unknown} value
 * @returns {boolean}
 */
export function keepAboveEnabledFromStoredValue(value) {
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return KEEP_ABOVE_DEFAULT;
}

/**
 * Read the durable Keep-above preference. Storage failures fail open to ON.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readKeepAbovePreference(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(KEEP_ABOVE_STORAGE_KEY);
    if (raw == null) return KEEP_ABOVE_DEFAULT;
    return keepAboveEnabledFromStoredValue(raw);
  } catch {
    return KEEP_ABOVE_DEFAULT;
  }
}

/**
 * Persist `meridian.keepAbove`. Best-effort; never throws.
 * @param {{setItem?: Function}|null|undefined} storage
 * @param {boolean} enabled
 * @returns {boolean} true only when the write landed
 */
export function writeKeepAbovePreference(storage, enabled) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(KEEP_ABOVE_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = KEEP_ABOVE_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getKeepAboveEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setKeepAboveEnabled(enabled, { persist = true, storage } = {}) {
  const next = keepAboveEnabledFromStoredValue(enabled);
  currentEnabled = next;
  if (persist) writeKeepAbovePreference(storage, next);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateKeepAboveEnabled(storage) {
  return setKeepAboveEnabled(readKeepAbovePreference(storage), { persist: false, storage });
}

/** Test-only: restore the default ON preference. */
export function resetKeepAboveEnabledForTest() {
  currentEnabled = KEEP_ABOVE_DEFAULT;
  for (const listener of listeners) listener(currentEnabled);
}

/**
 * Pick a ground height from helpers already in play.
 * Prefer globe.getHeight (loaded tiles), then the warm terrain-heights cache.
 * @param {{globeHeight?: number|null, cachedFloor?: number|null}} [input]
 * @returns {number|null}
 */
export function resolveCameraGroundHeightM({ globeHeight, cachedFloor } = {}) {
  if (Number.isFinite(globeHeight)) return globeHeight;
  if (Number.isFinite(cachedFloor)) return cachedFloor;
  return null;
}

/**
 * If the camera is below ground + margin, return the lifted height; else null.
 * @param {number} cameraHeightM
 * @param {number} groundHeightM
 * @param {number} [marginM]
 * @returns {number|null}
 */
export function cameraLiftHeightM(cameraHeightM, groundHeightM, marginM = KEEP_ABOVE_MARGIN_M) {
  if (!Number.isFinite(cameraHeightM) || !Number.isFinite(groundHeightM)) return null;
  const clearance = Number.isFinite(marginM) ? Math.max(0, marginM) : 0;
  const lifted = groundHeightM + clearance;
  return cameraHeightM < lifted ? lifted : null;
}

/**
 * Decide whether a camera pose should be lifted.
 * Unknown ground and cockpit ownership both skip — never invent a floor.
 * @param {object} [input]
 * @returns {{lifted: boolean, heightM: number|undefined, reason: string}}
 */
export function decideCameraAboveGround({
  enabled = KEEP_ABOVE_DEFAULT,
  cockpitActive = false,
  cameraHeightM,
  groundHeightM,
  marginM = KEEP_ABOVE_MARGIN_M,
} = {}) {
  if (enabled === false) {
    return { lifted: false, heightM: cameraHeightM, reason: 'disabled' };
  }
  if (cockpitActive) {
    return { lifted: false, heightM: cameraHeightM, reason: 'cockpit' };
  }
  if (!Number.isFinite(groundHeightM)) {
    return { lifted: false, heightM: cameraHeightM, reason: 'no-ground' };
  }
  const next = cameraLiftHeightM(cameraHeightM, groundHeightM, marginM);
  if (next == null) return { lifted: false, heightM: cameraHeightM, reason: 'clear' };
  return { lifted: true, heightM: next, reason: 'below-ground' };
}

function readGlobeHeight(globeGetHeight, carto) {
  try {
    return globeGetHeight?.(carto);
  } catch {
    return undefined;
  }
}

function readCachedFloor(cachedFloor, lat, lon) {
  try {
    return cachedFloor?.(lat, lon);
  } catch {
    return null;
  }
}

function writeCameraHeight(viewer, carto, heightM, setCameraCartesian) {
  if (typeof setCameraCartesian === 'function') {
    setCameraCartesian({
      longitude: carto.longitude,
      latitude: carto.latitude,
      height: heightM,
    });
  }
  if (viewer?.camera?.positionCartographic) {
    viewer.camera.positionCartographic.height = heightM;
  }
}

/**
 * After a camera move: sample existing terrain helpers and lift if buried.
 * Terrain errors (including HTTP 503) skip the lift and never throw.
 * @param {object} input
 * @returns {Promise<{lifted: boolean, heightM?: number, reason: string}>}
 */
export async function clampCameraAboveGround({
  camera,
  viewer,
  globeGetHeight,
  cachedFloor = cachedGroundFloor,
  warmFloor,
  enabled = currentEnabled,
  cockpitActive = false,
  marginM = KEEP_ABOVE_MARGIN_M,
  setHeight,
  setCameraCartesian,
  requestRender,
  allowWarm = true,
} = {}) {
  try {
    const carto = camera?.positionCartographic;
    if (!carto) return { lifted: false, reason: 'no-camera' };

    const { lat, lon } = cartographicDegrees(carto);
    const globeHeight = readGlobeHeight(globeGetHeight, carto);
    const floor = readCachedFloor(cachedFloor, lat, lon);
    const ground = resolveCameraGroundHeightM({ globeHeight, cachedFloor: floor });
    const decision = decideCameraAboveGround({
      enabled,
      cockpitActive,
      cameraHeightM: carto.height,
      groundHeightM: ground,
      marginM,
    });

    if (decision.reason === 'no-ground' && allowWarm && typeof warmFloor === 'function') {
      try {
        await warmFloor([{ lat, lon }]);
      } catch {
        return decision;
      }
      return clampCameraAboveGround({
        camera,
        viewer,
        globeGetHeight,
        cachedFloor,
        warmFloor,
        enabled,
        cockpitActive,
        marginM,
        setHeight,
        setCameraCartesian,
        requestRender,
        allowWarm: false,
      });
    }

    if (!decision.lifted) return decision;
    if (typeof setHeight === 'function') setHeight(carto, decision.heightM);
    else writeCameraHeight(viewer || { camera }, carto, decision.heightM, setCameraCartesian);
    try { requestRender?.(); } catch { /* render is best-effort */ }
    return decision;
  } catch {
    return { lifted: false, heightM: camera?.positionCartographic?.height, reason: 'error' };
  }
}

/**
 * Subscribe to camera.changed + moveEnd and lift when the camera is buried.
 * @param {object} viewer
 * @param {object} [options]
 * @returns {() => void} disposer
 */
export function installKeepAboveGround(viewer, options = {}) {
  const {
    isEnabled = () => currentEnabled,
    isCockpitActive = () => false,
    getCachedFloor = cachedGroundFloor,
    warmFloor = resolveGroundFloorCellsBounded,
    requestRender = () => viewer?.scene?.requestRender?.(),
    setCameraCartesian,
  } = options;

  let disposed = false;
  const onMove = () => {
    if (disposed) return;
    void clampCameraAboveGround({
      camera: viewer?.camera,
      viewer,
      globeGetHeight: (carto) => viewer?.scene?.globe?.getHeight?.(carto),
      cachedFloor: getCachedFloor,
      warmFloor,
      enabled: isEnabled() !== false,
      cockpitActive: isCockpitActive() === true,
      setCameraCartesian,
      requestRender,
    });
  };

  const removers = [];
  const changed = viewer?.camera?.changed;
  if (changed?.addEventListener) removers.push(changed.addEventListener(onMove));
  const moveEnd = viewer?.camera?.moveEnd;
  if (moveEnd?.addEventListener) removers.push(moveEnd.addEventListener(onMove));

  return () => {
    disposed = true;
    for (const remove of removers) {
      try { remove?.(); } catch { /* mid-teardown */ }
    }
  };
}
