/**
 * Double-click fly-to for hosted Meridian.
 *
 * Empty terrain / photoreal pick → fly there with the existing landmark
 * helper (reasonable height and tilt). A contact sprite or contact card
 * keeps the current track path. Wheel zoom-to-pointer is unchanged.
 *
 * Persistence key is `meridian.doubleClickFly`. Default on. No /api.
 */

import * as Cesium from 'cesium';
import { flyToLandmark } from './locations.js';
import { isOwnedByOtherLayer, resolvePickId } from './data/pickRegistry.js';
import { isPickedWorldPosition } from './data/scenePick.js';

export const DOUBLE_CLICK_FLY_STORAGE_KEY = 'meridian.doubleClickFly';
/** Hosted default is on — double-click flies to the pick. */
export const DOUBLE_CLICK_FLY_DEFAULT = true;

/** Existing landmark framing: close enough to read terrain, not nadir. */
export const DOUBLE_CLICK_FLY_RANGE_M = 800;
export const DOUBLE_CLICK_FLY_PITCH_DEG = -30;
export const DOUBLE_CLICK_FLY_DURATION_S = 1.6;
export const DOUBLE_CLICK_FLY_MIN_KEEP_RANGE_M = 80;

/** Dummy pick-registry asker so any registered layer counts as "owned". */
export const DOUBLE_CLICK_FLY_PICK_ASKER = 'double-click-fly';

export const DOUBLE_CLICK_FLY_ACTION = Object.freeze({
  FLY: 'fly',
  TRACK: 'track',
  IGNORE: 'ignore',
});

/**
 * Parse a stored double-click-fly flag. Missing or garbage values stay on.
 * @param {unknown} value
 * @returns {boolean}
 */
export function doubleClickFlyEnabledFromStoredValue(value) {
  if (value === '0' || value === 'false' || value === false || value === 0) return false;
  if (value === '1' || value === 'true' || value === true || value === 1) return true;
  return DOUBLE_CLICK_FLY_DEFAULT;
}

/**
 * Read `meridian.doubleClickFly`. Unreadable storage fails open to on.
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {boolean}
 */
export function readDoubleClickFlyPreference(storage) {
  try {
    return doubleClickFlyEnabledFromStoredValue(storage?.getItem?.(DOUBLE_CLICK_FLY_STORAGE_KEY));
  } catch {
    return DOUBLE_CLICK_FLY_DEFAULT;
  }
}

/**
 * Persist `meridian.doubleClickFly` as `'1'` / `'0'`.
 * @param {{setItem?: Function}|null|undefined} storage
 * @param {boolean} enabled
 * @returns {boolean}
 */
export function writeDoubleClickFlyPreference(storage, enabled) {
  if (!storage?.setItem) return false;
  try {
    storage.setItem(DOUBLE_CLICK_FLY_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/**
 * World position under a window pick, or null on a miss / degenerate depth read.
 * Same cascade as the existing view-target and annotation pick helpers.
 * @param {object} viewer
 * @param {{x: number, y: number}|null|undefined} windowPosition
 * @returns {object|null}
 */
export function pickWorldPositionAt(viewer, windowPosition) {
  const scene = viewer?.scene;
  const camera = viewer?.camera;
  if (!scene || !camera || !Number.isFinite(windowPosition?.x) || !Number.isFinite(windowPosition?.y)) {
    return null;
  }
  const pos = new Cesium.Cartesian2(windowPosition.x, windowPosition.y);
  let position = null;

  if (scene.pickPositionSupported && typeof scene.pickPosition === 'function') {
    try {
      position = scene.pickPosition(pos);
    } catch {
      position = null;
    }
  }

  if (!isPickedWorldPosition(position) && typeof camera.pickEllipsoid === 'function') {
    try {
      position = camera.pickEllipsoid(pos, Cesium.Ellipsoid.WGS84);
    } catch {
      position = null;
    }
  }

  if (!isPickedWorldPosition(position) && typeof camera.getPickRay === 'function') {
    try {
      const ray = camera.getPickRay(pos);
      position = ray ? (scene.globe?.pick(ray, scene) || null) : null;
    } catch {
      position = null;
    }
  }

  return isPickedWorldPosition(position) ? position : null;
}

/**
 * Decide whether a double-click should fly, defer to contact tracking, or ignore.
 * Contact cards and registered contact/layer picks win. Empty terrain flies.
 * @param {object} input
 * @returns {{action: string, reason: string}}
 */
export function resolveDoubleClickFlyAction({
  enabled = true,
  cockpitActive = false,
  measureActive = false,
  overlayHit = null,
  picked = null,
  worldPosition = null,
} = {}) {
  if (!enabled) return { action: DOUBLE_CLICK_FLY_ACTION.IGNORE, reason: 'disabled' };
  if (cockpitActive) return { action: DOUBLE_CLICK_FLY_ACTION.IGNORE, reason: 'cockpit' };
  if (measureActive) return { action: DOUBLE_CLICK_FLY_ACTION.IGNORE, reason: 'measure' };
  if (overlayHit) return { action: DOUBLE_CLICK_FLY_ACTION.TRACK, reason: 'contact-card' };
  const pickedId = resolvePickId(picked);
  if (pickedId && isOwnedByOtherLayer(DOUBLE_CLICK_FLY_PICK_ASKER, pickedId)) {
    return { action: DOUBLE_CLICK_FLY_ACTION.TRACK, reason: 'contact' };
  }
  if (!isPickedWorldPosition(worldPosition)) {
    return { action: DOUBLE_CLICK_FLY_ACTION.IGNORE, reason: 'miss' };
  }
  return { action: DOUBLE_CLICK_FLY_ACTION.FLY, reason: 'terrain' };
}

/**
 * Keep current height/tilt when they are already a readable look-at; otherwise
 * use the landmark helper defaults.
 * @param {object} viewer
 * @returns {{range: number, pitch: number, heading: number, buildingHeight: number, duration: number}}
 */
export function doubleClickFlyFraming(viewer) {
  const camera = viewer?.camera;
  const currentHeight = camera?.positionCartographic?.height;
  const range = Number.isFinite(currentHeight)
    && currentHeight >= DOUBLE_CLICK_FLY_MIN_KEEP_RANGE_M
    && currentHeight < DOUBLE_CLICK_FLY_RANGE_M
    ? currentHeight
    : DOUBLE_CLICK_FLY_RANGE_M;
  const heading = Number.isFinite(camera?.heading)
    ? Cesium.Math.toDegrees(camera.heading)
    : 0;
  const rawPitch = Number.isFinite(camera?.pitch)
    ? Cesium.Math.toDegrees(camera.pitch)
    : DOUBLE_CLICK_FLY_PITCH_DEG;
  const pitch = (rawPitch <= -60 || rawPitch >= -15)
    ? DOUBLE_CLICK_FLY_PITCH_DEG
    : rawPitch;
  return {
    range,
    pitch,
    heading,
    buildingHeight: 0,
    duration: DOUBLE_CLICK_FLY_DURATION_S,
  };
}

/**
 * Fly to a picked Cartesian with the existing landmark helper.
 * @param {object} viewer
 * @param {object} position
 * @param {{flyTo?: Function}} [options]
 * @returns {object|null}
 */
export function flyToDoubleClickPick(viewer, position, options = {}) {
  if (!viewer || !isPickedWorldPosition(position)) return null;
  let carto = null;
  try {
    carto = Cesium.Cartographic.fromCartesian(position);
  } catch {
    return null;
  }
  if (!carto) return null;
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const lon = Cesium.Math.toDegrees(carto.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const framing = doubleClickFlyFraming(viewer);
  const flyTo = typeof options.flyTo === 'function' ? options.flyTo : flyToLandmark;
  const result = flyTo(viewer, lat, lon, framing);
  return {
    lat,
    lon,
    framing,
    result,
  };
}

/**
 * Handle one Cesium LEFT_DOUBLE_CLICK. Contact picks do not fly.
 * @param {object} viewer
 * @param {{position?: {x: number, y: number}}} click
 * @param {object} [options]
 * @returns {{action: string, reason: string, flight?: object|null}}
 */
export function handleDoubleClickFly(viewer, click, options = {}) {
  const enabled = typeof options.getEnabled === 'function'
    ? !!options.getEnabled()
    : options.enabled !== false;
  const cockpitActive = typeof options.isCockpitActive === 'function'
    ? !!options.isCockpitActive()
    : !!options.cockpitActive;
  const measureActive = typeof options.isMeasureActive === 'function'
    ? !!options.isMeasureActive()
    : !!options.measureActive;
  const position = click?.position;
  const overlayHit = typeof options.hitTestOverlay === 'function' && position
    ? options.hitTestOverlay(position.x, position.y)
    : options.overlayHit || null;
  const picked = typeof options.pick === 'function'
    ? options.pick(position)
    : (position && typeof viewer?.scene?.pick === 'function' ? viewer.scene.pick(position) : null);
  const worldPosition = typeof options.pickWorld === 'function'
    ? options.pickWorld(position)
    : pickWorldPositionAt(viewer, position);
  const decision = resolveDoubleClickFlyAction({
    enabled,
    cockpitActive,
    measureActive,
    overlayHit,
    picked,
    worldPosition,
  });
  if (decision.action !== DOUBLE_CLICK_FLY_ACTION.FLY) return decision;
  const flyTo = typeof options.flyTo === 'function' ? options.flyTo : undefined;
  const navigate = typeof options.navigate === 'function'
    ? options.navigate
    : (run) => run();
  let flight = null;
  const granted = navigate(() => {
    flight = flyToDoubleClickPick(viewer, worldPosition, { flyTo });
    return flight;
  });
  if (granted === false) {
    return { action: DOUBLE_CLICK_FLY_ACTION.IGNORE, reason: 'refused' };
  }
  return { ...decision, flight };
}

/**
 * Bind LEFT_DOUBLE_CLICK on the globe canvas. Returns an idempotent disposer.
 * Does not bind wheel — zoom-to-pointer stays the camera controller.
 * @param {object} viewer
 * @param {object} [options]
 * @returns {() => void}
 */
export function bindDoubleClickFly(viewer, options = {}) {
  const canvas = viewer?.scene?.canvas;
  const CesiumApi = options.Cesium || Cesium;
  if (!canvas || typeof CesiumApi.ScreenSpaceEventHandler !== 'function') return () => {};
  const handler = new CesiumApi.ScreenSpaceEventHandler(canvas);
  handler.setInputAction((click) => {
    handleDoubleClickFly(viewer, click, options);
  }, CesiumApi.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    handler.destroy?.();
  };
}
