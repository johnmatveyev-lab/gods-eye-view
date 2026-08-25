/**
 * Hosted wheel zoom: optional map-style zoom toward the globe pick under the
 * cursor. Off (production default) keeps Cesium's current center zoom.
 *
 * Invert scroll is a sign flip only — it does not change the pivot.
 * Lock-tilt / look / rotate are out of scope.
 */
import { isPickedWorldPosition } from './data/scenePick.js';
import {
  INVERT_SCROLL_STORAGE_KEY,
  readInvertScroll,
  signedWheelZoomDelta,
} from './invertScroll.js';

export const ZOOM_TO_POINTER_STORAGE_KEY = 'meridian.zoomToPointer';
export const ZOOM_TO_POINTER_DEFAULT = 'off';
export { INVERT_SCROLL_STORAGE_KEY };

/**
 * @param {unknown} value
 * @returns {'on'|'off'}
 */
export function normalizeZoomToPointer(value) {
  if (value === 'on' || value === true || value === 1 || value === '1') return 'on';
  if (value === 'off' || value === false || value === 0 || value === '0') return 'off';
  return ZOOM_TO_POINTER_DEFAULT;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function zoomToPointerEnabled(value) {
  return normalizeZoomToPointer(value) === 'on';
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {'on'|'off'|null}
 */
export function peekZoomToPointerPreference(storage) {
  try {
    const raw = storage?.getItem?.(ZOOM_TO_POINTER_STORAGE_KEY);
    if (raw === 'on' || raw === 'off') return raw;
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {'on'|'off'}
 */
export function readZoomToPointerPreference(storage) {
  return peekZoomToPointerPreference(storage) ?? ZOOM_TO_POINTER_DEFAULT;
}

/**
 * @param {{setItem?: Function}|null|undefined} storage
 * @param {unknown} value
 * @returns {'on'|'off'}
 */
export function writeZoomToPointerPreference(storage, value) {
  const normalized = normalizeZoomToPointer(value);
  try {
    storage?.setItem?.(ZOOM_TO_POINTER_STORAGE_KEY, normalized);
  } catch {
    /* locked / private-mode stores still return the in-session choice */
  }
  return normalized;
}

/**
 * Compose with invert-scroll if that preference is present. Missing key = off.
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {boolean}
 */
export function invertScrollEnabled(storage) {
  return readInvertScroll(storage);
}

/**
 * @param {unknown} deltaY
 * @param {boolean} [invertScroll]
 * @returns {number}
 */
export function signedWheelDelta(deltaY, invertScroll = false) {
  return signedWheelZoomDelta(deltaY, invertScroll);
}

/**
 * Negative signed delta (scroll up) returns positive meters toward the target.
 * @param {number} signedDeltaY
 * @param {number} distanceM
 * @returns {number}
 */
export function wheelZoomMeters(signedDeltaY, distanceM) {
  if (!Number.isFinite(signedDeltaY) || signedDeltaY === 0) return 0;
  const distance = Number.isFinite(distanceM) && distanceM > 0 ? distanceM : 1000;
  const fraction = Math.min(0.35, Math.max(0.02, Math.abs(signedDeltaY) / 400));
  const meters = Math.max(20, distance * fraction);
  return signedDeltaY < 0 ? meters : -meters;
}

/**
 * @param {{zoomToPointer?: boolean, pick?: {x:number,y:number,z:number}|null}} input
 * @returns {'pointer'|'center'}
 */
export function resolveWheelZoomMode({ zoomToPointer, pick } = {}) {
  return zoomToPointer && isPickedWorldPosition(pick) ? 'pointer' : 'center';
}

function vec(value) {
  return { x: Number(value?.x) || 0, y: Number(value?.y) || 0, z: Number(value?.z) || 0 };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a, factor) {
  return { x: a.x * factor, y: a.y * factor, z: a.z * factor };
}

function magnitude(a) {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize(a) {
  const length = magnitude(a);
  return length > 0 ? scale(a, 1 / length) : { x: 0, y: 0, z: 0 };
}

function writeCartesian(target, next) {
  if (!target) return next;
  target.x = next.x;
  target.y = next.y;
  target.z = next.z;
  return target;
}

/**
 * Existing globe pick cascade at a window position. Degenerate depth picks
 * fall through; a miss is null so callers can use center zoom.
 * @param {{scene?: object, camera?: object}|null|undefined} viewer
 * @param {{x:number,y:number}|null|undefined} windowPosition
 * @returns {{x:number,y:number,z:number}|null}
 */
export function pickGlobeAtWindow(viewer, windowPosition) {
  const scene = viewer?.scene;
  const camera = viewer?.camera;
  if (!scene || !windowPosition) return null;

  let position = null;
  if (scene.pickPositionSupported && typeof scene.pickPosition === 'function') {
    try { position = scene.pickPosition(windowPosition); } catch { position = null; }
  }
  if (!isPickedWorldPosition(position) && typeof camera?.pickEllipsoid === 'function') {
    try {
      position = camera.pickEllipsoid(windowPosition, scene.globe?.ellipsoid);
    } catch {
      position = null;
    }
  }
  if (!isPickedWorldPosition(position) && typeof camera?.getPickRay === 'function') {
    try {
      const ray = camera.getPickRay(windowPosition);
      position = ray ? (scene.globe?.pick?.(ray, scene) || null) : null;
    } catch {
      position = null;
    }
  }
  return isPickedWorldPosition(position) ? position : null;
}

/**
 * @param {{
 *   camera?: object,
 *   pick?: {x:number,y:number,z:number}|null,
 *   zoomToPointer?: boolean,
 *   deltaY?: number,
 *   invertScroll?: boolean,
 * }} input
 */
export function applyWheelZoom({
  camera,
  pick,
  zoomToPointer,
  deltaY,
  invertScroll = false,
} = {}) {
  const mode = resolveWheelZoomMode({ zoomToPointer, pick });
  if (!camera) return { mode, amount: 0, invertScroll: Boolean(invertScroll) };

  camera.cancelFlight?.();
  const signed = signedWheelDelta(deltaY, invertScroll);
  const position = camera.positionWC || camera.position;
  const toward = mode === 'pointer'
    ? subtract(vec(pick), vec(position))
    : vec(camera.directionWC || camera.direction);
  const distance = magnitude(toward) || Math.abs(camera.positionCartographic?.height) || 1000;
  const amount = wheelZoomMeters(signed, distance);
  if (amount === 0) return { mode, amount, invertScroll: Boolean(invertScroll) };

  const direction = normalize(toward);
  if (mode === 'pointer') {
    if (typeof camera.move === 'function') camera.move(direction, amount);
    else writeCartesian(position, add(vec(position), scale(direction, amount)));
  } else if (amount > 0 && typeof camera.zoomIn === 'function') {
    camera.zoomIn(amount);
  } else if (amount < 0 && typeof camera.zoomOut === 'function') {
    camera.zoomOut(-amount);
  } else {
    writeCartesian(position, add(vec(position), scale(direction, amount)));
  }

  return { mode, amount, invertScroll: Boolean(invertScroll) };
}

/**
 * When pointer zoom is on, strip Cesium's WHEEL so we do not double-zoom.
 * Off restores the default center wheel.
 * @param {{zoomEventTypes?: unknown}|null|undefined} controller
 * @param {boolean} enabled
 * @param {unknown} wheelType
 */
export function setWheelZoomEventEnabled(controller, enabled, wheelType = 3) {
  if (!controller) return;
  const type = wheelType ?? 3;
  const current = controller.zoomEventTypes;
  const list = Array.isArray(current) ? current.slice() : (current == null ? [] : [current]);
  if (enabled) {
    if (!list.includes(type)) list.push(type);
    controller.zoomEventTypes = list;
    return;
  }
  controller.zoomEventTypes = list.filter((entry) => entry !== type);
}

/**
 * @param {{classList?: {toggle?: Function}, setAttribute?: Function}|null|undefined} button
 * @param {boolean} enabled
 */
export function syncZoomToPointerButton(button, enabled) {
  if (!button) return;
  const on = Boolean(enabled);
  button.classList?.toggle?.('active', on);
  button.setAttribute?.('aria-pressed', String(on));
}

function windowPositionFromEvent(canvas, event) {
  const rect = canvas?.getBoundingClientRect?.();
  const left = rect?.left || 0;
  const top = rect?.top || 0;
  return {
    x: Number(event?.clientX) - left,
    y: Number(event?.clientY) - top,
  };
}

/**
 * @param {object} viewer
 * @param {{
 *   storage?: {getItem?: Function, setItem?: Function}|null,
 *   canvas?: {addEventListener?: Function, removeEventListener?: Function}|null,
 *   wheelType?: unknown,
 *   invertScroll?: boolean,
 *   onZoom?: Function,
 * }} [options]
 * @returns {() => void}
 */
export function bindZoomToPointerWheel(viewer, options = {}) {
  const canvas = options.canvas || viewer?.canvas || viewer?.scene?.canvas;
  const controller = options.controller
    || viewer?.scene?.screenSpaceCameraController;
  const storage = options.storage;
  const wheelType = options.wheelType;

  const pointerOn = () => zoomToPointerEnabled(readZoomToPointerPreference(storage));
  const syncController = () => {
    setWheelZoomEventEnabled(controller, !pointerOn(), wheelType);
  };
  syncController();

  const onWheel = (event) => {
    syncController();
    if (!pointerOn()) return;
    if (event?.ctrlKey) return;
    event?.preventDefault?.();
    const invert = options.invertScroll ?? invertScrollEnabled(storage);
    applyWheelZoom({
      camera: viewer?.camera,
      pick: pickGlobeAtWindow(viewer, windowPositionFromEvent(canvas, event)),
      zoomToPointer: true,
      deltaY: event?.deltaY,
      invertScroll: invert,
    });
    viewer?.scene?.requestRender?.();
    options.onZoom?.();
  };

  canvas?.addEventListener?.('wheel', onWheel, { passive: false });
  return () => {
    canvas?.removeEventListener?.('wheel', onWheel);
    setWheelZoomEventEnabled(controller, true, wheelType);
  };
}
