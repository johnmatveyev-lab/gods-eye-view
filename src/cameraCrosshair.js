/**
 * Camera-center crosshair overlay.
 *
 * A CSS plus at the same viewport center copy-coords and measure already pick
 * (`getViewportCenterPx` — canvas clientWidth/2, clientHeight/2). Not a Cesium
 * layer, not a geo entity, no `/api`.
 *
 * Persist: `meridian.crosshair` as `'1'` / `'0'`. Default off.
 * Clean view may keep the plus; credits stay on.
 */

export const CROSSHAIR_STORAGE_KEY = 'meridian.crosshair';
/** Hosted default is a clean globe — the plus is opt-in. */
export const CROSSHAIR_DEFAULT = false;
export const CROSSHAIR_ELEMENT_ID = 'camera-crosshair';

let _el = null;
let _enabled = CROSSHAIR_DEFAULT;

function storageHandle(storage) {
  if (storage) return storage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    if (typeof globalThis.localStorage !== 'undefined') return globalThis.localStorage;
  } catch {
    // Privacy-restricted storage fails open to the default.
  }
  return null;
}

/** Parse a stored crosshair flag. Missing or garbage values stay off. */
export function crosshairEnabledFromStoredValue(value) {
  return value === '1' || value === 'true';
}

/** Read `meridian.crosshair`. Unreadable storage keeps the overlay off. */
export function readCrosshairPreference(storage) {
  try {
    return crosshairEnabledFromStoredValue(storageHandle(storage)?.getItem?.(CROSSHAIR_STORAGE_KEY));
  } catch {
    return CROSSHAIR_DEFAULT;
  }
}

/** Persist `meridian.crosshair` as `'1'` / `'0'`. */
export function writeCrosshairPreference(storage, enabled) {
  const store = storageHandle(storage);
  if (!store?.setItem) return false;
  try {
    store.setItem(CROSSHAIR_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/**
 * CSS-pixel center of the Cesium canvas — the aim point copy-coords, measure,
 * and `getViewTargetCartesian` already use.
 *
 * @param {{clientWidth?: number, clientHeight?: number, width?: number, height?: number}|null|undefined} canvas
 * @returns {{x: number, y: number}}
 */
export function getViewportCenterPx(canvas) {
  const width = canvas?.clientWidth || canvas?.width || 0;
  const height = canvas?.clientHeight || canvas?.height || 0;
  return { x: width / 2, y: height / 2 };
}

/**
 * Format the view-center lat/lon the same way copy-coords writes to the clipboard.
 * @param {number} latDeg
 * @param {number} lonDeg
 * @returns {string|null}
 */
export function formatViewCenterCoords(latDeg, lonDeg) {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
  return `${latDeg.toFixed(6)}, ${lonDeg.toFixed(6)}`;
}

/**
 * Copy view-center coordinates. Callers pass the lat/lon already picked at
 * {@link getViewportCenterPx} so the text matches the plus.
 *
 * @param {{latitudeDeg?: number, longitudeDeg?: number, clipboard?: {writeText: Function}}} input
 * @returns {Promise<{ok: boolean, text?: string, error?: string}>}
 */
export async function copyViewCenterCoords({ latitudeDeg, longitudeDeg, clipboard } = {}) {
  const text = formatViewCenterCoords(latitudeDeg, longitudeDeg);
  if (!text) return { ok: false, error: 'No view-center coordinates' };
  if (typeof clipboard?.writeText !== 'function') {
    return { ok: false, error: 'Clipboard unavailable', text };
  }
  await clipboard.writeText(text);
  return { ok: true, text };
}

/** Create the overlay node. Hidden until enabled. */
export function createCrosshairElement(doc = globalThis.document) {
  const el = doc.createElement('div');
  el.id = CROSSHAIR_ELEMENT_ID;
  el.setAttribute('aria-hidden', 'true');
  el.hidden = true;
  return el;
}

/** Show or hide the plus. Does not persist. */
export function syncCrosshairOverlay(el, enabled) {
  if (!el) return false;
  const next = Boolean(enabled);
  el.hidden = !next;
  return next;
}

/**
 * Install the plus into the viewer container. Idempotent. Default off.
 * @param {{container?: HTMLElement}|null|undefined} viewer
 * @param {{enabled?: boolean, document?: Document}} [options]
 * @returns {HTMLElement|null}
 */
export function installCameraCrosshair(viewer, { enabled = CROSSHAIR_DEFAULT, document: doc } = {}) {
  const container = viewer?.container;
  if (!container) return null;
  const documentRef = doc || container.ownerDocument || globalThis.document;
  let el = typeof container.querySelector === 'function'
    ? container.querySelector(`#${CROSSHAIR_ELEMENT_ID}`)
    : null;
  if (!el) {
    el = createCrosshairElement(documentRef);
    container.appendChild(el);
  }
  _el = el;
  _enabled = syncCrosshairOverlay(el, enabled);
  return el;
}

/** @returns {boolean} */
export function isCameraCrosshairEnabled() {
  return _el ? !_el.hidden : _enabled;
}

/**
 * @param {boolean} enabled
 * @returns {boolean}
 */
export function setCameraCrosshairEnabled(enabled) {
  _enabled = Boolean(enabled);
  if (_el) syncCrosshairOverlay(_el, _enabled);
  return _enabled;
}

/** Tear down the overlay node. */
export function destroyCameraCrosshair() {
  _el?.remove?.();
  _el = null;
  _enabled = CROSSHAIR_DEFAULT;
}

/** Test seam. */
export function _resetCameraCrosshairForTest() {
  destroyCameraCrosshair();
}
