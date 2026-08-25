/**
 * On-globe scale bar for Meridian.
 *
 * Local overlay only: it converts the camera-height / pixel scale the viewer
 * already uses (the same focal-length math as the aircraft billboard path)
 * into a nice km / nmi / mi bar. No /api, no new layers, no grid coupling.
 */

import {
  DEFAULT_DISTANCE_UNIT,
  convertMeters,
  getDistanceUnit,
  normalizeDistanceUnit,
  subscribeDistanceUnit,
} from './units.js';

export const SCALE_BAR_STORAGE_KEY = 'meridian.scaleBar';
export const SCALE_BAR_DEFAULT = 'on';
export const SCALE_BAR_TARGET_PX = 96;
export const SCALE_BAR_ID = 'scale-bar';

/** @typedef {'on'|'off'} ScaleBarPreference */

let sessionEnabled = true;
const listeners = new Set();

let _viewer = null;
let _root = null;
let _credits = null;
let _removeCamera = null;
let _removeUnits = null;
let _lastSignature = '';

/**
 * @param {unknown} value
 * @returns {ScaleBarPreference}
 */
export function normalizeScaleBarPreference(value) {
  if (value === 'off' || value === false || value === 0 || value === '0') return 'off';
  if (value === 'on' || value === true || value === 1 || value === '1') return 'on';
  return SCALE_BAR_DEFAULT;
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
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {ScaleBarPreference|null}
 */
export function peekScaleBarPreference(storage) {
  try {
    const raw = storage?.getItem?.(SCALE_BAR_STORAGE_KEY);
    if (raw === 'on' || raw === 'off') return raw;
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {ScaleBarPreference}
 */
export function readScaleBarPreference(storage) {
  return peekScaleBarPreference(storage) ?? SCALE_BAR_DEFAULT;
}

/**
 * @param {{setItem?: Function}|null|undefined} storage
 * @param {unknown} value
 * @returns {ScaleBarPreference}
 */
export function writeScaleBarPreference(storage, value) {
  const normalized = normalizeScaleBarPreference(value);
  try {
    storage?.setItem?.(SCALE_BAR_STORAGE_KEY, normalized);
  } catch {
    /* privacy-restricted storage should not block the in-session toggle */
  }
  return normalized;
}

/**
 * @param {{storage?: {getItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function initScaleBarPreference({ storage } = {}) {
  const resolved = readScaleBarPreference(storage === undefined ? resolveStore() : storage);
  if (storage === undefined) sessionEnabled = resolved === 'on';
  return resolved === 'on';
}

/** @returns {boolean} */
export function isScaleBarEnabled() {
  try {
    const stored = peekScaleBarPreference(globalThis.localStorage);
    if (stored) return stored === 'on';
  } catch {
    /* privacy-restricted storage falls through to the session default */
  }
  return sessionEnabled;
}

/**
 * @param {unknown} enabled
 * @param {{storage?: {getItem?: Function, setItem?: Function}|null, persist?: boolean}} [options]
 * @returns {boolean}
 */
export function setScaleBarEnabled(enabled, { storage, persist = true } = {}) {
  const next = normalizeScaleBarPreference(enabled) === 'on';
  const previous = storage === undefined ? isScaleBarEnabled() : readScaleBarPreference(storage) === 'on';
  if (storage === undefined) sessionEnabled = next;
  if (persist) writeScaleBarPreference(storage === undefined ? resolveStore() : storage, next ? 'on' : 'off');
  if (next !== previous) {
    for (const listener of listeners) listener(next, previous);
  }
  return next;
}

/**
 * @param {(enabled: boolean, previous: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeScaleBar(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore the first-visit default without touching storage. */
export function resetScaleBarForTests() {
  sessionEnabled = true;
  _lastSignature = '';
}

/**
 * Camera-height pixel scale already used by the fleet path:
 * `focalLengthPx = viewportHeight / (2 * tan(fovy/2))`, then
 * `metersPerPixel = height / focalLengthPx` for a nadir-looking camera.
 *
 * @param {{heightM?: number, fovyRad?: number, viewportHeightPx?: number}} input
 * @returns {number}
 */
export function metersPerPixelFromCamera({ heightM, fovyRad, viewportHeightPx } = {}) {
  if (!Number.isFinite(heightM) || heightM <= 0) return Number.NaN;
  if (!Number.isFinite(fovyRad) || fovyRad <= 0 || fovyRad >= Math.PI) return Number.NaN;
  if (!Number.isFinite(viewportHeightPx) || viewportHeightPx <= 0) return Number.NaN;
  const focalLengthPx = viewportHeightPx / (2 * Math.tan(fovyRad / 2));
  if (!Number.isFinite(focalLengthPx) || focalLengthPx <= 0) return Number.NaN;
  return heightM / focalLengthPx;
}

/**
 * 1-2-5 cartographic nice number. Keeps the painted bar near the target width.
 * @param {number} value
 * @returns {number}
 */
export function niceScaleNumber(value) {
  if (!Number.isFinite(value) || value <= 0) return Number.NaN;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const fraction = value / magnitude;
  let nice;
  if (fraction < 1.5) nice = 1;
  else if (fraction < 3.5) nice = 2;
  else if (fraction < 7.5) nice = 5;
  else nice = 10;
  return nice * magnitude;
}

function formatNice(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 10 || Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value));
  if (value >= 1) return value.toFixed(1).replace(/\.0$/, '');
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * @param {{metersPerPixel?: number, unit?: unknown, targetPx?: number}} input
 * @returns {{unit: string, lengthMeters: number, widthPx: number, label: string}|null}
 */
export function computeScaleBar({
  metersPerPixel,
  unit = getDistanceUnit(),
  targetPx = SCALE_BAR_TARGET_PX,
} = {}) {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
  if (!Number.isFinite(targetPx) || targetPx <= 0) return null;
  const resolved = normalizeDistanceUnit(unit) || DEFAULT_DISTANCE_UNIT;
  const targetMeters = metersPerPixel * targetPx;
  if (!Number.isFinite(targetMeters) || targetMeters <= 0) return null;

  let lengthMeters;
  let label;

  if (resolved === 'km' && targetMeters < 1000) {
    const niceMeters = niceScaleNumber(targetMeters);
    if (!Number.isFinite(niceMeters) || niceMeters <= 0) return null;
    if (niceMeters >= 1000) {
      lengthMeters = niceMeters;
      label = `${formatNice(niceMeters / 1000)} km`;
    } else {
      lengthMeters = niceMeters;
      label = `${formatNice(niceMeters)} m`;
    }
  } else {
    const converted = convertMeters(targetMeters, resolved);
    const niceValue = niceScaleNumber(converted.value);
    if (!Number.isFinite(niceValue) || niceValue <= 0 || converted.value <= 0) return null;
    lengthMeters = niceValue * (targetMeters / converted.value);
    label = `${formatNice(niceValue)} ${converted.suffix}`;
  }

  const widthPx = lengthMeters / metersPerPixel;
  if (!Number.isFinite(widthPx) || widthPx <= 0) return null;
  return {
    unit: resolved,
    lengthMeters,
    widthPx,
    label,
  };
}

/**
 * @param {{camera?: {positionCartographic?: {height?: number}, frustum?: {fovy?: number}}, scene?: {canvas?: {clientHeight?: number}}}} [viewer]
 * @param {{unit?: unknown, targetPx?: number}} [options]
 */
export function scaleBarFromViewer(viewer, options = {}) {
  const metersPerPixel = metersPerPixelFromCamera({
    heightM: viewer?.camera?.positionCartographic?.height,
    fovyRad: viewer?.camera?.frustum?.fovy,
    viewportHeightPx: viewer?.scene?.canvas?.clientHeight,
  });
  return computeScaleBar({
    metersPerPixel,
    unit: options.unit ?? getDistanceUnit(),
    targetPx: options.targetPx,
  });
}

function ensureOverlay(root) {
  if (root) return root;
  if (typeof document === 'undefined') return null;
  let el = document.getElementById(SCALE_BAR_ID);
  if (el) return el;
  el = document.createElement('div');
  el.id = SCALE_BAR_ID;
  el.className = 'scale-bar';
  el.setAttribute('role', 'img');
  el.innerHTML = '<div class="scale-bar-track" aria-hidden="true"><span class="scale-bar-tick"></span><span class="scale-bar-shaft"></span><span class="scale-bar-tick"></span></div><span class="scale-bar-label">—</span>';
  document.body.appendChild(el);
  return el;
}

function placeNextToCredits(root, credits) {
  if (!root) return { left: 0, bottom: 0 };
  if (!credits || typeof credits.getBoundingClientRect !== 'function') {
    root.style.left = '36px';
    root.style.bottom = '68px';
    root.style.right = 'auto';
    return { left: 36, bottom: 68 };
  }
  const rect = credits.getBoundingClientRect();
  const left = Number.isFinite(rect.left) ? Math.round(rect.left) : 36;
  const gap = 6;
  const bottom = Number.isFinite(rect.top)
    ? Math.max(0, Math.round((globalThis.innerHeight || 0) - rect.top + gap))
    : 68;
  root.style.left = `${left}px`;
  root.style.bottom = `${bottom}px`;
  root.style.right = 'auto';
  return { left, bottom };
}

function paintOverlay(root, model, credits) {
  if (!root) return;
  const enabled = isScaleBarEnabled();
  if (!enabled || !model) {
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    return;
  }
  root.hidden = false;
  root.removeAttribute('aria-hidden');
  const shaft = root.querySelector('.scale-bar-shaft');
  const label = root.querySelector('.scale-bar-label');
  if (shaft) shaft.style.width = `${Math.max(1, Math.round(model.widthPx))}px`;
  if (label) label.textContent = model.label;
  root.setAttribute('aria-label', `Scale ${model.label}`);
  placeNextToCredits(root, credits);
}

/**
 * Recompute the painted bar from the live camera and the current unit.
 * Cheap when the quantized signature has not changed.
 * @param {{viewer?: object, root?: HTMLElement|null, credits?: HTMLElement|null, unit?: unknown}} [options]
 * @returns {{unit: string, lengthMeters: number, widthPx: number, label: string}|null}
 */
export function refreshScaleBar({ viewer = _viewer, root = _root, credits = _credits, unit } = {}) {
  const model = isScaleBarEnabled() ? scaleBarFromViewer(viewer, { unit }) : null;
  const creditBox = credits && typeof credits.getBoundingClientRect === 'function'
    ? credits.getBoundingClientRect()
    : null;
  const signature = [
    isScaleBarEnabled() ? 'on' : 'off',
    model?.label || '',
    model ? Math.round(model.widthPx) : 0,
    creditBox ? Math.round(creditBox.left) : 0,
    creditBox ? Math.round(creditBox.top) : 0,
  ].join('|');
  if (signature !== _lastSignature) {
    _lastSignature = signature;
    paintOverlay(root, model, credits);
  }
  return model;
}

/**
 * @param {object} viewer
 * @param {{root?: HTMLElement|null, credits?: HTMLElement|null}} [options]
 */
export function installScaleBar(viewer, { root, credits } = {}) {
  uninstallScaleBar();
  _viewer = viewer || null;
  _root = ensureOverlay(root);
  _credits = credits || (typeof document === 'undefined' ? null : document.getElementById('cesium-credits'));
  initScaleBarPreference();
  if (_viewer?.camera?.changed?.addEventListener) {
    _removeCamera = _viewer.camera.changed.addEventListener(() => {
      refreshScaleBar();
    });
  }
  if (_viewer?.scene?.postRender?.addEventListener) {
    const removePost = _viewer.scene.postRender.addEventListener(() => {
      refreshScaleBar();
    });
    const removeCamera = _removeCamera;
    _removeCamera = () => {
      removeCamera?.();
      removePost?.();
    };
  }
  _removeUnits = subscribeDistanceUnit(() => {
    refreshScaleBar();
  });
  refreshScaleBar();
}

export function uninstallScaleBar() {
  _removeCamera?.();
  _removeCamera = null;
  _removeUnits?.();
  _removeUnits = null;
  _viewer = null;
  _root = null;
  _credits = null;
  _lastSignature = '';
}
