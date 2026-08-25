/**
 * Invert Cesium wheel-zoom sign for trackpad users.
 *
 * Production (`meridian.invertScroll` unset / `0`) keeps today's wheel
 * direction. On (`1`) flips only the existing WHEEL movement Y that
 * ScreenSpaceCameraController.handleZoom already reads. Pinch, pan, and
 * tilt stay on their Cesium event types.
 */

export const INVERT_SCROLL_STORAGE_KEY = 'meridian.invertScroll';
export const INVERT_SCROLL_DEFAULT = false;
export const INVERT_SCROLL_CHANGE_EVENT = 'meridian:invertScroll';

/** @type {boolean|null} */
let cachedInvert = null;

/** Clear the in-memory preference so the next read hits storage (reload / tests). */
export function resetInvertScrollCache() {
  cachedInvert = null;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeInvertScroll(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {boolean}
 */
export function readInvertScroll(storage) {
  try {
    const raw = storage?.getItem?.(INVERT_SCROLL_STORAGE_KEY);
    if (raw == null || raw === '') return INVERT_SCROLL_DEFAULT;
    return normalizeInvertScroll(raw);
  } catch {
    return INVERT_SCROLL_DEFAULT;
  }
}

/**
 * @param {{setItem?: Function}|null|undefined} storage
 * @param {unknown} value
 * @returns {boolean}
 */
export function writeInvertScroll(storage, value) {
  const normalized = normalizeInvertScroll(value);
  try {
    storage?.setItem?.(INVERT_SCROLL_STORAGE_KEY, normalized ? '1' : '0');
  } catch {
    // Fail open: the session can still invert without a durable store.
  }
  return normalized;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function getInvertScroll(storage = globalThis.localStorage) {
  if (cachedInvert !== null) return cachedInvert;
  cachedInvert = readInvertScroll(storage);
  return cachedInvert;
}

/**
 * @param {unknown} value
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function setInvertScroll(value, storage = globalThis.localStorage) {
  cachedInvert = writeInvertScroll(storage, value);
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent(INVERT_SCROLL_CHANGE_EVENT, {
      detail: { invert: cachedInvert },
    }));
  }
  return cachedInvert;
}

/**
 * Flip Cesium's existing wheel-zoom sign. Production (invert=false) is identity.
 * @param {unknown} nativeDeltaY
 * @param {unknown} invert
 * @returns {number}
 */
export function signedWheelZoomDelta(nativeDeltaY, invert) {
  const delta = Number(nativeDeltaY);
  if (!Number.isFinite(delta)) return 0;
  return invert ? -delta : delta;
}

/**
 * Cesium handleZoom uses movement.endPosition.y - startPosition.y.
 * Invert flips that Y delta only. Pinch / pan / tilt types are identity.
 * @param {{startPosition?: {x: number, y: number}, endPosition?: {x: number, y: number}}|null|undefined} movement
 * @param {{invert?: unknown, type?: unknown, wheelType?: unknown}} [options]
 */
export function applyZoomMovementSign(movement, { invert = false, type, wheelType } = {}) {
  if (!invert || type !== wheelType || !movement?.startPosition || !movement?.endPosition) {
    return movement;
  }
  const dy = movement.endPosition.y - movement.startPosition.y;
  return {
    ...movement,
    endPosition: {
      x: movement.endPosition.x,
      y: movement.startPosition.y - dy,
    },
  };
}

function movementHost(controller) {
  if (controller?._aggregator && typeof controller._aggregator.getMovement === 'function') {
    return controller._aggregator;
  }
  if (typeof controller?.getMovement === 'function') return controller;
  return null;
}

/**
 * Wrap Cesium's existing WHEEL getMovement so handleZoom sees the flipped sign.
 * Pinch (PINCH), pan (LEFT_DRAG), and tilt stay on the original movement.
 * @param {{_aggregator?: {getMovement?: Function}, getMovement?: Function}|null|undefined} controller
 * @param {() => boolean} [getInvert]
 * @param {unknown} [wheelType]
 * @returns {() => void}
 */
export function installWheelZoomSign(controller, getInvert, wheelType) {
  const host = movementHost(controller);
  if (!host) return () => {};
  const original = host.getMovement.bind(host);
  host.getMovement = function getMovement(type, modifier) {
    return applyZoomMovementSign(original(type, modifier), {
      invert: getInvert?.(),
      type,
      wheelType,
    });
  };
  return () => {
    host.getMovement = original;
  };
}

/**
 * @param {{setAttribute?: Function, classList?: {toggle?: Function}}|null|undefined} button
 * @param {unknown} invert
 */
export function syncInvertScrollButton(button, invert) {
  if (!button) return;
  const on = Boolean(invert);
  button.setAttribute?.('aria-pressed', String(on));
  button.classList?.toggle?.('active', on);
}

/**
 * @param {{addEventListener?: Function, removeEventListener?: Function}|null|undefined} button
 * @param {{storage?: object, onChange?: Function}} [options]
 * @returns {() => void}
 */
export function bindInvertScrollToggle(button, { storage, onChange } = {}) {
  if (!button?.addEventListener) return () => {};
  syncInvertScrollButton(button, getInvertScroll(storage));
  const handler = (event) => {
    event?.preventDefault?.();
    const next = setInvertScroll(!getInvertScroll(storage), storage);
    syncInvertScrollButton(button, next);
    onChange?.(next);
  };
  button.addEventListener('click', handler);
  return () => button.removeEventListener?.('click', handler);
}
