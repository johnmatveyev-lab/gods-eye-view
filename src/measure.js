/**
 * Two-click geodesic measure on the globe.
 *
 * Operators pick two terrain/ellipsoid points. Distance is Cesium's
 * EllipsoidGeodesic surface length, formatted with the Plan 44 km/nm/mi
 * preference. This is not a route, person-search, or extra /api.
 */

import * as Cesium from 'cesium';
import { isPickedWorldPosition } from './data/scenePick.js';
import { setSceneClickCapture } from './data/pickRegistry.js';
import { governorRequestRender } from './renderGovernor.js';
import { formatDistanceMeters, subscribeDistanceUnit } from './units.js';

export const MEASURE_SOURCE_ID = 'meridian-measure';
export const MEASURE_LINE_ID = 'meridian-measure-line';
export const MEASURE_LABEL_ID = 'meridian-measure-label';

const LINE_COLOR = Cesium.Color.fromCssColorString('#7ee0c8');
const GEODESIC_STEP_M = 75_000;
const GEODESIC_MAX_STEPS = 32;

/** @typedef {{ lon: number, lat: number, height: number }} MeasurePoint */

let _viewer = null;
let _active = false;
let _points = /** @type {MeasurePoint[]} */ ([]);
let _dataSource = null;
let _handler = null;
let _unitsUnsub = null;
let _keydown = null;
let _cockpitListener = null;
let _onChange = null;

/**
 * WGS84 ellipsoidal surface distance between two lon/lat degree points.
 * Uses the same Cesium.EllipsoidGeodesic helper as launch/installation code.
 * @param {number} lon1
 * @param {number} lat1
 * @param {number} lon2
 * @param {number} lat2
 * @param {Cesium.EllipsoidGeodesic} [geodesic]
 * @returns {number}
 */
export function geodesicSurfaceDistanceM(lon1, lat1, lon2, lat2, geodesic = new Cesium.EllipsoidGeodesic()) {
  if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) return Number.NaN;
  const start = Cesium.Cartographic.fromDegrees(lon1, lat1);
  const end = Cesium.Cartographic.fromDegrees(lon2, lat2);
  geodesic.setEndPoints(start, end);
  return geodesic.surfaceDistance;
}

/**
 * Sampled geodesic polyline in lon/lat degrees for a simple clamped line.
 * @param {number} lon1
 * @param {number} lat1
 * @param {number} lon2
 * @param {number} lat2
 * @returns {number[][]} [lon, lat] pairs
 */
export function geodesicLineDegrees(lon1, lat1, lon2, lat2) {
  const geodesic = new Cesium.EllipsoidGeodesic();
  const start = Cesium.Cartographic.fromDegrees(lon1, lat1);
  const end = Cesium.Cartographic.fromDegrees(lon2, lat2);
  geodesic.setEndPoints(start, end);
  const distanceM = geodesic.surfaceDistance;
  const steps = Number.isFinite(distanceM)
    ? Cesium.Math.clamp(Math.ceil(distanceM / GEODESIC_STEP_M), 1, GEODESIC_MAX_STEPS)
    : 1;
  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    const cartographic = geodesic.interpolateUsingFraction(index / steps, new Cesium.Cartographic());
    points.push([
      Cesium.Math.toDegrees(cartographic.longitude),
      Cesium.Math.toDegrees(cartographic.latitude),
    ]);
  }
  return points;
}

/**
 * Pick a globe/terrain point. Never uses scene.pick — contacts and people
 * are not measure endpoints.
 * @param {object} viewer
 * @param {{x: number, y: number}} screenPosition
 * @returns {MeasurePoint|null}
 */
export function pickTerrainPoint(viewer, screenPosition) {
  const camera = viewer?.camera;
  const scene = viewer?.scene;
  if (!camera || !scene || !screenPosition) return null;

  let cartesian = null;
  if (typeof camera.getPickRay === 'function' && typeof scene.globe?.pick === 'function') {
    try {
      const ray = camera.getPickRay(screenPosition);
      cartesian = ray ? scene.globe.pick(ray, scene) : null;
    } catch {
      cartesian = null;
    }
  }
  if (!isPickedWorldPosition(cartesian) && typeof camera.pickEllipsoid === 'function') {
    try {
      cartesian = camera.pickEllipsoid(screenPosition, Cesium.Ellipsoid.WGS84);
    } catch {
      cartesian = null;
    }
  }
  if (!isPickedWorldPosition(cartesian)) return null;
  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  if (!cartographic) return null;
  return {
    lon: Cesium.Math.toDegrees(cartographic.longitude),
    lat: Cesium.Math.toDegrees(cartographic.latitude),
    height: Number.isFinite(cartographic.height) ? cartographic.height : 0,
  };
}

/**
 * @param {number} meters
 * @param {unknown} [unit]
 * @returns {string}
 */
export function formatMeasureLabel(meters, unit) {
  return formatDistanceMeters(meters, unit);
}

/** @returns {boolean} */
export function isMeasureActive() {
  return _active;
}

/**
 * @returns {{
 *   active: boolean,
 *   points: MeasurePoint[],
 *   distanceM: number|null,
 *   label: string|null,
 *   prompt: string,
 *   line: number[][]|null,
 * }}
 */
export function getMeasureState() {
  const distanceM = _points.length === 2
    ? geodesicSurfaceDistanceM(_points[0].lon, _points[0].lat, _points[1].lon, _points[1].lat)
    : null;
  let prompt = 'Click two globe points';
  if (_points.length === 1) prompt = 'Click the second point';
  else if (_points.length === 2) prompt = formatMeasureLabel(distanceM);
  return {
    active: _active,
    points: _points.map((point) => ({ ...point })),
    distanceM: Number.isFinite(distanceM) ? distanceM : null,
    label: Number.isFinite(distanceM) ? formatMeasureLabel(distanceM) : null,
    prompt: _active ? prompt : '',
    line: _points.length === 2
      ? geodesicLineDegrees(_points[0].lon, _points[0].lat, _points[1].lon, _points[1].lat)
      : null,
  };
}

function emitChange() {
  _onChange?.(getMeasureState());
}

function syncGraphics() {
  const entities = _dataSource?.entities;
  if (!entities?.removeAll) return;
  entities.removeAll();
  const state = getMeasureState();
  if (!state.line || !state.label) {
    governorRequestRender('measure-clear');
    return;
  }
  const positions = Cesium.Cartesian3.fromDegreesArray(state.line.flat());
  entities.add({
    id: MEASURE_LINE_ID,
    polyline: {
      positions,
      width: 3,
      material: LINE_COLOR,
      clampToGround: true,
    },
  });
  const mid = state.line[Math.floor(state.line.length / 2)];
  entities.add({
    id: MEASURE_LABEL_ID,
    position: Cesium.Cartesian3.fromDegrees(mid[0], mid[1]),
    label: {
      text: state.label,
      font: '14px "IBM Plex Mono", "SF Mono", monospace',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -18),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  governorRequestRender('measure-line');
}

/**
 * Accept one terrain click while Measure is armed.
 * @param {{x: number, y: number}} screenPosition
 * @returns {ReturnType<typeof getMeasureState>|null}
 */
export function acceptMeasureClick(screenPosition) {
  if (!_active || !_viewer) return null;
  const point = pickTerrainPoint(_viewer, screenPosition);
  if (!point) return getMeasureState();
  if (_points.length >= 2) _points = [];
  _points.push(point);
  syncGraphics();
  emitChange();
  return getMeasureState();
}

/**
 * Exit Measure and remove the line. Safe when idle.
 * @returns {ReturnType<typeof getMeasureState>}
 */
export function clearMeasure() {
  _active = false;
  _points = [];
  _dataSource?.entities?.removeAll?.();
  governorRequestRender('measure-exit');
  emitChange();
  return getMeasureState();
}

/**
 * @param {boolean} active
 * @returns {ReturnType<typeof getMeasureState>}
 */
export function setMeasureActive(active) {
  const next = Boolean(active);
  if (next === _active && (next || _points.length === 0)) {
    emitChange();
    return getMeasureState();
  }
  if (!next) return clearMeasure();
  _active = true;
  _points = [];
  _dataSource?.entities?.removeAll?.();
  emitChange();
  return getMeasureState();
}

/**
 * Escape exits Measure. Other keys are ignored.
 * @param {KeyboardEvent|{key?: string}} event
 * @returns {boolean} True when the event was consumed.
 */
export function handleMeasureKeydown(event) {
  if (!_active || event?.key !== 'Escape') return false;
  event.preventDefault?.();
  event.stopImmediatePropagation?.();
  clearMeasure();
  return true;
}

function onCanvasClick(click) {
  if (!_active) return;
  acceptMeasureClick(click?.position);
}

function ensureDataSource(viewer, createDataSource) {
  if (_dataSource) return _dataSource;
  if (typeof createDataSource === 'function') {
    _dataSource = createDataSource();
    return _dataSource;
  }
  _dataSource = new Cesium.CustomDataSource(MEASURE_SOURCE_ID);
  viewer?.dataSources?.add?.(_dataSource);
  return _dataSource;
}

/**
 * Bind Measure to a viewer. Idempotent.
 * @param {object} viewer
 * @param {{
 *   onChange?: (state: ReturnType<typeof getMeasureState>) => void,
 *   createDataSource?: () => object,
 *   bindClicks?: boolean,
 *   bindKeys?: boolean,
 * }} [options]
 * @returns {void}
 */
export function initMeasure(viewer, options = {}) {
  destroyMeasure();
  _viewer = viewer || null;
  _onChange = typeof options.onChange === 'function' ? options.onChange : null;
  if (!_viewer) return;
  ensureDataSource(_viewer, options.createDataSource);
  setSceneClickCapture(() => _active);
  if (options.bindClicks !== false && _viewer.scene?.canvas && Cesium.ScreenSpaceEventHandler) {
    _handler = new Cesium.ScreenSpaceEventHandler(_viewer.scene.canvas);
    _handler.setInputAction(onCanvasClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }
  if (options.bindKeys !== false && typeof document !== 'undefined') {
    _keydown = (event) => { handleMeasureKeydown(event); };
    document.addEventListener('keydown', _keydown, true);
  }
  _unitsUnsub = subscribeDistanceUnit(() => {
    if (_points.length === 2) syncGraphics();
    emitChange();
  });
  if (typeof window !== 'undefined') {
    _cockpitListener = (event) => {
      if (event?.detail?.active) clearMeasure();
    };
    window.addEventListener('gev:cockpit-mode-changed', _cockpitListener);
  }
}

/** Tear down handlers, graphics, and the click-capture claim. */
export function destroyMeasure() {
  _active = false;
  _points = [];
  _onChange = null;
  if (_handler) {
    _handler.destroy?.();
    _handler = null;
  }
  if (_keydown && typeof document !== 'undefined') {
    document.removeEventListener('keydown', _keydown, true);
    _keydown = null;
  }
  if (_cockpitListener && typeof window !== 'undefined') {
    window.removeEventListener('gev:cockpit-mode-changed', _cockpitListener);
    _cockpitListener = null;
  }
  _unitsUnsub?.();
  _unitsUnsub = null;
  if (_dataSource && _viewer?.dataSources?.remove) {
    _viewer.dataSources.remove(_dataSource, true);
  } else {
    _dataSource?.entities?.removeAll?.();
  }
  _dataSource = null;
  _viewer = null;
  setSceneClickCapture(null);
}

/** Test-only reset. */
export function resetMeasureForTests() {
  destroyMeasure();
}
