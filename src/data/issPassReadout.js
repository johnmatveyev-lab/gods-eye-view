/**
 * @module issPassReadout
 * @description Operator chrome for the next ISS pass on the Satellites row.
 *
 * Uses the already-loaded ISS satrec via `getNextIssPass` — no extra
 * CelesTrak fetch. Observer is the current camera cartographic. Recalc is
 * on-demand (moveEnd, clock toggle, layer/catalog) — never per frame.
 * Not an alert service.
 */
import {
  CLOCK_CHANGE_EVENT,
  formatChromeClock,
  formatHudClock,
  getClockMode,
} from '../clockPreference.js';
import {
  getIssPassMinElev,
  issPassMinElevChipModels,
  issPassMinElevDeg,
  resetIssPassMinElevCache,
  setIssPassMinElev,
} from './issPassMinElevFilter.js';

export const ISS_PASS_READOUT_ID = 'iss-pass-readout';
export const ISS_PASS_READOUT_PARK_ID = 'iss-pass-readout-park';
export const ISS_PASS_UNAVAILABLE = 'UNAVAILABLE';
export const ISS_PASS_READOUT_TITLE = 'Next ISS pass at the camera location. Not an alert service.';

const RAD_TO_DEG = 180 / Math.PI;
const ISS_PASS_MIN_ELEV_ROW_INSTALLED = Symbol('issPassMinElevRowControls');

/** @type {object|null} */
let _viewer = null;
/** @type {Function|null} */
let _getPass = null;
/** @type {Function|null} */
let _isVisible = null;
/** @type {Function|null} */
let _getFromMs = null;
/** @type {Function|null} */
let _getClockMode = null;
/** @type {{hidden?: boolean, textContent?: string, title?: string, setAttribute?: Function}|null} */
let _root = null;
/** @type {Function|null} */
let _moveEndRemove = null;
/** @type {Function|null} */
let _clockRemove = null;
/** @type {{status: string, pass: object|null}|null} */
let _lastResult = null;
/** @type {{latDeg: number, lonDeg: number}|null} */
let _lastObserver = null;
/** @type {{getItem?: Function, setItem?: Function}|null} */
let _storage = null;

/**
 * Camera-center observer from Cesium `positionCartographic` (radians).
 * @param {object} [cameraOrPose]
 * @returns {{latDeg: number, lonDeg: number}|null}
 */
export function observerFromCamera(cameraOrPose) {
  if (!cameraOrPose) return null;
  if (Number.isFinite(cameraOrPose.latDeg) && Number.isFinite(cameraOrPose.lonDeg)) {
    return { latDeg: cameraOrPose.latDeg, lonDeg: cameraOrPose.lonDeg };
  }
  const carto = cameraOrPose.positionCartographic
    || cameraOrPose.camera?.positionCartographic;
  if (!carto) return null;
  const latDeg = Number(carto.latitude) * RAD_TO_DEG;
  const lonDeg = Number(carto.longitude) * RAD_TO_DEG;
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
  if (Math.abs(latDeg) > 90 || Math.abs(lonDeg) > 180) return null;
  return { latDeg, lonDeg };
}

/**
 * @param {'ok'|'none'|'no-tle'|string} status
 * @returns {'ok'|'unavailable'}
 */
function readoutKind(status) {
  switch (status) {
    case 'ok':
      return 'ok';
    case 'none':
    case 'no-tle':
      return 'unavailable';
    default: {
      const _exhaustive = status;
      void _exhaustive;
      return 'unavailable';
    }
  }
}

/**
 * Format a pass (or UNAVAILABLE) for the satellites-row chrome.
 * Rise time follows the existing UTC | Local clock toggle.
 * @param {{status?: string, pass?: {riseMs: number, maxElevDeg: number, riseAzDeg: number}|null, clockMode?: string}} input
 * @returns {{text: string, available: boolean, rise: string|null, peakElevDeg: number|null, riseAzDeg: number|null, title: string}}
 */
export function formatIssPassReadout({ status = 'none', pass = null, clockMode } = {}) {
  const kind = readoutKind(status);
  if (kind !== 'ok' || !pass || !Number.isFinite(pass.riseMs)) {
    return {
      text: ISS_PASS_UNAVAILABLE,
      available: false,
      rise: null,
      peakElevDeg: null,
      riseAzDeg: null,
      title: ISS_PASS_READOUT_TITLE,
    };
  }
  const rise = formatChromeClock(new Date(pass.riseMs), clockMode);
  const peakElevDeg = Math.round(Number(pass.maxElevDeg));
  const riseAzDeg = Math.round((((Number(pass.riseAzDeg) % 360) + 360) % 360));
  const when = formatHudClock(new Date(pass.riseMs), clockMode);
  return {
    text: `ISS ${rise} · PEAK ${peakElevDeg}° · AZ ${riseAzDeg}°`,
    available: true,
    rise,
    peakElevDeg,
    riseAzDeg,
    title: `Next ISS rise ${when} · peak ${peakElevDeg}° · az ${riseAzDeg}°. Not an alert service.`,
  };
}

/**
 * @param {{latDeg?: number, lonDeg?: number, clockMode?: string, fromMs?: number, getPass?: Function, minElevDeg?: number}} [input]
 */
export function computeIssPassReadout({
  latDeg,
  lonDeg,
  clockMode,
  fromMs,
  getPass,
  minElevDeg,
} = {}) {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg) || typeof getPass !== 'function') {
    return formatIssPassReadout({ status: 'no-tle', clockMode });
  }
  const floor = issPassMinElevDeg(
    Number.isFinite(minElevDeg) ? minElevDeg : getIssPassMinElev(),
  );
  const result = getPass({ latDeg, lonDeg, fromMs, minElevDeg: floor }) || { status: 'none' };
  return {
    ...formatIssPassReadout({ ...result, clockMode }),
    status: result.status,
    pass: result.pass || null,
  };
}

/**
 * Append exclusive 10° | 30° | 40° chips to a layer's getRowControls without
 * editing satellites.js. Chip clicks write `issPassMinElev` through setParams;
 * the wrap persists locally and re-runs the already-loaded satrec.
 * @param {{
 *   getRowControls?: Function,
 *   setParams?: Function,
 *   getParams?: Function,
 * }|null|undefined} layer
 * @returns {object|null|undefined}
 */
export function installIssPassMinElevRowControls(layer) {
  if (!layer || layer[ISS_PASS_MIN_ELEV_ROW_INSTALLED]) return layer;
  const origGetRowControls = typeof layer.getRowControls === 'function'
    ? layer.getRowControls.bind(layer)
    : null;
  const origSetParams = typeof layer.setParams === 'function'
    ? layer.setParams.bind(layer)
    : null;
  const origGetParams = typeof layer.getParams === 'function'
    ? layer.getParams.bind(layer)
    : null;

  layer.getRowControls = function getRowControlsWithIssPassMinElev() {
    const controls = origGetRowControls ? (origGetRowControls() || {}) : {};
    return {
      ...controls,
      chips: [
        ...(controls.chips || []),
        ...issPassMinElevChipModels(getIssPassMinElev()),
      ],
    };
  };

  layer.setParams = function setParamsWithIssPassMinElev(params = {}, options) {
    if (params && Object.hasOwn(params, 'issPassMinElev')) {
      setIssPassMinElev(params.issPassMinElev, options?.storage || _storage || undefined);
      syncIssPassReadout({ recompute: true });
    }
    return origSetParams ? origSetParams(params, options) : true;
  };

  layer.getParams = function getParamsWithIssPassMinElev() {
    const params = origGetParams ? (origGetParams() || {}) : {};
    return {
      ...params,
      issPassMinElev: getIssPassMinElev(),
    };
  };

  layer[ISS_PASS_MIN_ELEV_ROW_INSTALLED] = true;
  return layer;
}

function resolveRoot() {
  if (_root && typeof _root === 'object') return _root;
  return globalThis.document?.getElementById?.(ISS_PASS_READOUT_ID) || null;
}

function paintNode(formatted, visible) {
  const root = resolveRoot();
  if (!root) return formatted;
  if (!visible) {
    root.hidden = true;
    return formatted;
  }
  if (root.textContent !== formatted.text) root.textContent = formatted.text;
  root.title = formatted.title;
  root.hidden = false;
  root.setAttribute?.('aria-label', formatted.available
    ? formatted.title
    : 'Next ISS pass unavailable');
  return formatted;
}

/**
 * Recompute from the live camera (or reformat the cached pass on clock-only).
 * @param {{recompute?: boolean}} [options]
 */
export function syncIssPassReadout({ recompute = true } = {}) {
  const visible = _isVisible ? _isVisible() === true : false;
  const clockMode = (_getClockMode || getClockMode)();
  if (!visible) {
    const root = resolveRoot();
    if (root) root.hidden = true;
    return { visible: false, text: ISS_PASS_UNAVAILABLE, available: false };
  }

  if (!recompute && _lastResult) {
    const formatted = formatIssPassReadout({ ..._lastResult, clockMode });
    paintNode(formatted, true);
    return { visible: true, ...formatted, observer: _lastObserver };
  }

  const observer = observerFromCamera(_viewer?.camera);
  const fromMs = typeof _getFromMs === 'function' ? _getFromMs() : Date.now();
  const computed = computeIssPassReadout({
    latDeg: observer?.latDeg,
    lonDeg: observer?.lonDeg,
    clockMode,
    fromMs,
    getPass: _getPass,
    minElevDeg: getIssPassMinElev(_storage || undefined),
  });
  _lastObserver = observer;
  _lastResult = { status: computed.status || (computed.available ? 'ok' : 'none'), pass: computed.pass || null };
  paintNode(computed, true);
  return { visible: true, ...computed, observer };
}

/**
 * Wire the satellites-row readout. Camera-driven recalc is moveEnd only.
 * @param {{
 *   viewer?: object,
 *   getPass?: Function,
 *   isVisible?: Function,
 *   root?: object,
 *   getFromMs?: Function,
 *   getClockMode?: Function,
 *   clockTarget?: {addEventListener?: Function, removeEventListener?: Function},
 *   layer?: {getRowControls?: Function, setParams?: Function, getParams?: Function}|null,
 *   storage?: {getItem?: Function, setItem?: Function}|null,
 * }} [options]
 */
export function initIssPassReadout(options = {}) {
  destroyIssPassReadout();
  _storage = options.storage || null;
  if (_storage) {
    resetIssPassMinElevCache();
    getIssPassMinElev(_storage);
  }
  if (options.layer) installIssPassMinElevRowControls(options.layer);
  _viewer = options.viewer || null;
  _getPass = typeof options.getPass === 'function' ? options.getPass : null;
  _isVisible = typeof options.isVisible === 'function' ? options.isVisible : null;
  _getFromMs = typeof options.getFromMs === 'function' ? options.getFromMs : null;
  _getClockMode = typeof options.getClockMode === 'function' ? options.getClockMode : null;
  _root = options.root || null;

  _moveEndRemove = _viewer?.camera?.moveEnd?.addEventListener?.(() => {
    syncIssPassReadout({ recompute: true });
  }) || null;

  const clockTarget = options.clockTarget || globalThis;
  if (typeof clockTarget?.addEventListener === 'function') {
    const onClock = () => syncIssPassReadout({ recompute: false });
    clockTarget.addEventListener(CLOCK_CHANGE_EVENT, onClock);
    _clockRemove = () => clockTarget.removeEventListener?.(CLOCK_CHANGE_EVENT, onClock);
  }

  return syncIssPassReadout({ recompute: true });
}

/** Tear down listeners and hide the readout. */
export function destroyIssPassReadout() {
  _moveEndRemove?.();
  _clockRemove?.();
  _moveEndRemove = null;
  _clockRemove = null;
  const root = resolveRoot();
  if (root) root.hidden = true;
  _viewer = null;
  _getPass = null;
  _isVisible = null;
  _getFromMs = null;
  _getClockMode = null;
  _root = null;
  _lastResult = null;
  _lastObserver = null;
  _storage = null;
}

/** Last painted observer, or null. Test seam. */
export function getIssPassReadoutObserverForTest() {
  return _lastObserver ? { ..._lastObserver } : null;
}
