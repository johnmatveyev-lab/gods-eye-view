/**
 * @module copyCameraCoords
 * @description Copy the already-computed camera-center lat/lon for a Slack pin.
 *
 * Source is `camera.positionCartographic` — the same pose the share link and
 * HUD already read. This is the camera-center (not a cursor pick). Copy writes
 * numeric `lat,lon` (share-link order). `lon,lat` is the secondary GIS order
 * already used by Cesium `fromDegrees`. No height, so no units toggle. No
 * /api and no geocoding.
 */

export const CAMERA_COORDS_ROOT_ID = 'camera-coords';
export const CAMERA_COORDS_VALUE_ID = 'camera-coords-value';
export const CAMERA_COORDS_COPY_ID = 'camera-coords-copy';
export const COORD_DECIMALS = 4;

const RAD_TO_DEG = 180 / Math.PI;

let _viewer = null;
let _showToast = null;
let _root = null;
let _valueButton = null;
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
  const latLon = coords ? formatLatLon(coords.lat, coords.lon) : '';
  if (!latLon) return false;
  const toast = options.showToast || _showToast;
  const ok = await writeClipboardText(latLon, options.clipboard || _clipboard);
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
    delete _root.dataset?.lonlat;
    return;
  }
  const latLon = formatLatLon(coords.lat, coords.lon);
  const lonLat = formatLonLat(coords.lat, coords.lon);
  _active = { ...coords, latLon, lonLat };
  _root.hidden = false;
  _valueButton.textContent = latLon;
  _valueButton.dataset.lonlat = lonLat;
  _root.dataset.lonlat = lonLat;
  _valueButton.setAttribute('aria-label', `Copy ${latLon}`);
  _copyButton.setAttribute('aria-label', `Copy ${latLon}`);
  _copyButton.title = `Copy ${latLon}`;
  _valueButton.title = `Copy ${latLon}`;
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
