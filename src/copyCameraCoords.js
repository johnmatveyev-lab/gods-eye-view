/**
 * @module copyCameraCoords
 * @description Copy the already-computed camera-center lat/lon for a Slack pin.
 *
 * Source is `camera.positionCartographic` — the same pose the share link and
 * HUD already read. This is the camera-center (not a cursor pick). Copy writes
 * numeric `lat,lon` (share-link order) plus an MGRS line from the same pair
 * via the existing `mgrs` package. Polar / undefined conversions stay blank —
 * no fake grid. `lon,lat` is the secondary GIS order already used by Cesium
 * `fromDegrees`. No height, so no units toggle. No /api and no geocoding.
 */

import * as mgrsNs from 'mgrs';

export const CAMERA_COORDS_ROOT_ID = 'camera-coords';
export const CAMERA_COORDS_VALUE_ID = 'camera-coords-value';
export const CAMERA_COORDS_MGRS_ID = 'camera-coords-mgrs';
export const CAMERA_COORDS_COPY_ID = 'camera-coords-copy';
export const COORD_DECIMALS = 4;

/** 10 m square — same precision the cinematic HUD already prints. */
const MGRS_ACCURACY = 4;

function mgrsForward(lonLat, accuracy) {
  const forward = mgrsNs.forward || mgrsNs.default?.forward;
  if (typeof forward !== 'function') {
    throw new TypeError('mgrs.forward is unavailable');
  }
  return forward(lonLat, accuracy);
}

const RAD_TO_DEG = 180 / Math.PI;

let _viewer = null;
let _showToast = null;
let _root = null;
let _valueButton = null;
let _mgrsEl = null;
let _copyButton = null;
let _clipboard = null;
let _active = null;
let _changedRemove = null;
let _moveEndRemove = null;

/**
 * @param {number} radians
 * @returns {number}
 */
function toDegrees(radians) {
  return radians * RAD_TO_DEG;
}

function roundCoord(value) {
  const factor = 10 ** COORD_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * Camera-center pose from Cesium `positionCartographic` or a {lat,lon} pose.
 * @param {object} [cameraOrPose]
 * @returns {{lat: number, lon: number}|null}
 */
export function cameraCenterCoords(cameraOrPose) {
  if (!cameraOrPose) return null;
  if (Number.isFinite(cameraOrPose.lat) && Number.isFinite(cameraOrPose.lon)) {
    return { lat: cameraOrPose.lat, lon: cameraOrPose.lon };
  }
  const carto = cameraOrPose.positionCartographic
    || cameraOrPose.camera?.positionCartographic;
  if (!carto) return null;
  const lat = roundCoord(toDegrees(carto.latitude));
  const lon = roundCoord(toDegrees(carto.longitude));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * Share-link / Slack-pin order.
 * @param {number} lat
 * @param {number} lon
 * @param {number} [decimals=COORD_DECIMALS]
 * @returns {string}
 */
export function formatLatLon(lat, lon, decimals = COORD_DECIMALS) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  return `${lat.toFixed(decimals)},${lon.toFixed(decimals)}`;
}

/**
 * Secondary GIS order (Cesium `fromDegrees(lon, lat)`).
 * @param {number} lat
 * @param {number} lon
 * @param {number} [decimals=COORD_DECIMALS]
 * @returns {string}
 */
export function formatLonLat(lat, lon, decimals = COORD_DECIMALS) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  return `${lon.toFixed(decimals)},${lat.toFixed(decimals)}`;
}

/**
 * Insert spaces into a raw MGRS string for the chrome readout.
 * @param {string} raw
 * @returns {string}
 */
function formatMgrsGrid(raw) {
  const match = String(raw).match(/^(\d{1,2}[A-Z])\s*([A-Z]{2})\s*(\d+)$/);
  if (!match) return String(raw);
  const [, zone, square, coords] = match;
  const half = coords.length / 2;
  return `${zone} ${square} ${coords.slice(0, half)} ${coords.slice(half)}`;
}

/**
 * MGRS from the same lat/lon Copy coords already shows. Polar / undefined
 * conversions stay blank — the `mgrs` package does not invent a UPS grid.
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function formatMgrs(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  try {
    const raw = mgrsForward([lon, lat], MGRS_ACCURACY);
    return raw ? `MGRS ${formatMgrsGrid(raw)}` : '';
  } catch {
    return '';
  }
}

/**
 * Clipboard payload: lat,lon, then the MGRS line when a grid exists.
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function formatCopiedCoords(lat, lon) {
  const latLon = formatLatLon(lat, lon);
  if (!latLon) return '';
  const mgrsLine = formatMgrs(lat, lon);
  return mgrsLine ? `${latLon}\n${mgrsLine}` : latLon;
}

/**
 * @param {string} latLon
 * @returns {string}
 */
export function copiedCoordsToast(latLon) {
  return `Copied ${latLon}`;
}

/**
 * Copy numeric lat,lon of the camera center (or an explicit pose).
 * @param {object} cameraOrPose
 * @param {object} [options]
 * @returns {Promise<boolean>}
 */
export async function copyCameraCenterCoords(cameraOrPose, options = {}) {
  const coords = cameraCenterCoords(cameraOrPose);
  const text = coords ? formatCopiedCoords(coords.lat, coords.lon) : '';
  if (!text) return false;
  const latLon = formatLatLon(coords.lat, coords.lon);
  const toast = options.showToast || _showToast;
  const ok = await writeClipboardText(text, options.clipboard || _clipboard);
  if (typeof toast === 'function') toast(ok ? copiedCoordsToast(latLon) : 'Copy failed');
  return ok;
}

/**
 * Show live camera-center lat/lon and copy them on click.
 * @param {object} [options]
 * @returns {void}
 */
export function initCameraCoords(options = {}) {
  if (_root && !options.force) return;
  if (_root) destroyCameraCoords();

  _viewer = options.viewer || null;
  _showToast = typeof options.showToast === 'function' ? options.showToast : null;
  _clipboard = options.clipboard || globalThis.navigator?.clipboard || null;
  _root = options.root || globalThis.document?.getElementById(CAMERA_COORDS_ROOT_ID);
  _valueButton = options.valueButton || globalThis.document?.getElementById(CAMERA_COORDS_VALUE_ID);
  _mgrsEl = options.mgrsEl || globalThis.document?.getElementById(CAMERA_COORDS_MGRS_ID) || null;
  _copyButton = options.copyButton || globalThis.document?.getElementById(CAMERA_COORDS_COPY_ID);
  if (!_root || !_valueButton || !_copyButton) return;

  _valueButton.addEventListener('click', onCopyClick);
  _copyButton.addEventListener('click', onCopyClick);

  _changedRemove = _viewer?.camera?.changed?.addEventListener?.(() => syncCameraCoords()) || null;
  _moveEndRemove = _viewer?.camera?.moveEnd?.addEventListener?.(() => syncCameraCoords()) || null;

  syncCameraCoords();
}

/** Tear down listeners and clear the readout. */
export function destroyCameraCoords() {
  _valueButton?.removeEventListener?.('click', onCopyClick);
  _copyButton?.removeEventListener?.('click', onCopyClick);
  _changedRemove?.();
  _moveEndRemove?.();
  _changedRemove = null;
  _moveEndRemove = null;
  _viewer = null;
  _showToast = null;
  _root = null;
  _valueButton = null;
  _mgrsEl = null;
  _copyButton = null;
  _clipboard = null;
  _active = null;
}

/** Re-read the live camera and paint lat,lon. */
export function syncCameraCoords() {
  if (!_root || !_valueButton || !_copyButton) return;
  const coords = cameraCenterCoords(_viewer?.camera);
  if (!coords) {
    _active = null;
    _valueButton.textContent = '—, —';
    _valueButton.removeAttribute?.('aria-label');
    _copyButton.setAttribute?.('aria-label', 'Copy camera coordinates');
    _copyButton.title = 'Copy lat,lon';
    paintMgrs('');
    delete _root.dataset?.lonlat;
    delete _root.dataset?.mgrs;
    return;
  }
  const latLon = formatLatLon(coords.lat, coords.lon);
  const lonLat = formatLonLat(coords.lat, coords.lon);
  const mgrsLabel = formatMgrs(coords.lat, coords.lon);
  _active = { ...coords, latLon, lonLat, mgrs: mgrsLabel };
  _root.hidden = false;
  _valueButton.textContent = latLon;
  _valueButton.dataset.lonlat = lonLat;
  _root.dataset.lonlat = lonLat;
  if (mgrsLabel) _root.dataset.mgrs = mgrsLabel;
  else delete _root.dataset?.mgrs;
  paintMgrs(mgrsLabel);
  _valueButton.setAttribute('aria-label', `Copy ${latLon}`);
  _copyButton.setAttribute('aria-label', `Copy ${latLon}`);
  _copyButton.title = `Copy ${latLon}`;
  _valueButton.title = `Copy ${latLon}`;
}

function paintMgrs(mgrsLabel) {
  if (!_mgrsEl) return;
  _mgrsEl.textContent = mgrsLabel || '';
  _mgrsEl.hidden = !mgrsLabel;
}

/** Current painted camera-center coords, or null. */
export function getCameraCoordsForTest() {
  return _active ? { ..._active } : null;
}

function onCopyClick(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const pose = _active || cameraCenterCoords(_viewer?.camera);
  return copyCameraCenterCoords(pose);
}

async function writeClipboardText(text, clipboard) {
  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to execCommand */
  }
  const documentRef = globalThis.document;
  if (!documentRef?.body || typeof documentRef.execCommand !== 'function') return false;
  const field = documentRef.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.left = '-9999px';
  documentRef.body.appendChild(field);
  field.select();
  let ok = false;
  try {
    ok = documentRef.execCommand('copy');
  } catch {
    ok = false;
  }
  field.remove();
  return ok;
}
