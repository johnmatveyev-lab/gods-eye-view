/**
 * Local lat/lon graticule for Meridian.
 *
 * Cesium's built-in tile-grid imagery is a cartesian checkerboard on each
 * tile, not geographic meridians/parallels. This helper draws a coarse
 * ellipsoid polyline overlay and thins the step as the camera pulls out so a
 * planet view never floods with lines.
 *
 * Persist: `meridian.grid` = on|off. Default off. Not a data layer, not a
 * share-link field, and not an /api route.
 */

export const GRID_STORAGE_KEY = 'meridian.grid';
export const GRID_PREF_DEFAULT = 'off';
export const MAX_GRID_LINES = 72;
export const GRID_STEPS_DEG = Object.freeze([1, 2, 5, 10, 15, 30]);

const FULL_GLOBE = Object.freeze({
  westDeg: -180,
  southDeg: -90,
  eastDeg: 180,
  northDeg: 90,
});

/**
 * @param {unknown} value
 * @returns {'on'|'off'}
 */
export function normalizeGridPreference(value) {
  if (value === 'on' || value === true || value === 1 || value === '1') return 'on';
  return GRID_PREF_DEFAULT;
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {'on'|'off'|null}
 */
export function peekGridPreference(storage) {
  try {
    const raw = storage?.getItem?.(GRID_STORAGE_KEY);
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
export function readGridPreference(storage) {
  return peekGridPreference(storage) ?? GRID_PREF_DEFAULT;
}

/**
 * @param {{setItem?: Function}|null|undefined} storage
 * @param {unknown} value
 * @returns {'on'|'off'}
 */
export function writeGridPreference(storage, value) {
  const normalized = normalizeGridPreference(value);
  try {
    storage?.setItem?.(GRID_STORAGE_KEY, normalized);
  } catch {
    /* locked / private-mode storage still returns the in-session choice */
  }
  return normalized;
}

function niceDeg(value) {
  const rounded = Math.round(Number(value) * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clampLat(value) {
  return Math.max(-90, Math.min(90, value));
}

/**
 * Coarse lat/lon step from camera height. Larger height → fewer lines.
 * @param {number} cameraHeightM
 * @returns {number}
 */
export function gridStepDegrees(cameraHeightM) {
  if (!Number.isFinite(cameraHeightM) || cameraHeightM >= 12_000_000) return 30;
  if (cameraHeightM >= 6_000_000) return 15;
  if (cameraHeightM >= 2_500_000) return 10;
  if (cameraHeightM >= 800_000) return 5;
  if (cameraHeightM >= 200_000) return 2;
  return 1;
}

function lonSpans(westDeg, eastDeg) {
  const west = niceDeg(westDeg);
  const east = niceDeg(eastDeg);
  if (!(Number.isFinite(west) && Number.isFinite(east))) {
    return [{ west: -180, east: 180 }];
  }
  if (east >= west) return [{ west, east }];
  return [{ west, east: 180 }, { west: -180, east }];
}

function steppedValues(min, max, step) {
  if (!(step > 0) || max < min) return [];
  const values = [];
  const first = Math.ceil((min - 1e-9) / step) * step;
  for (let value = first; value <= max + 1e-9; value += step) {
    if (value < min - 1e-9 || value > max + 1e-9) continue;
    values.push(niceDeg(value));
  }
  return values;
}

/**
 * @param {{westDeg:number,southDeg:number,eastDeg:number,northDeg:number,stepDeg:number}} input
 * @returns {{meridians:number[],parallels:number[],stepDeg:number,lineCount:number,southDeg:number,northDeg:number,westDeg:number,eastDeg:number,wraps:boolean}}
 */
export function describeGridLines({
  westDeg = -180,
  southDeg = -90,
  eastDeg = 180,
  northDeg = 90,
  stepDeg = 30,
} = {}) {
  const step = GRID_STEPS_DEG.includes(stepDeg) ? stepDeg : 30;
  const south = clampLat(southDeg);
  const north = clampLat(northDeg);
  const spans = lonSpans(westDeg, eastDeg);
  const meridianSet = new Set();
  for (const span of spans) {
    for (const lon of steppedValues(span.west, span.east, step)) {
      const wrapped = lon === 180 ? -180 : lon;
      meridianSet.add(wrapped);
    }
  }
  const meridians = [...meridianSet].sort((a, b) => a - b);
  const parallels = steppedValues(south, north, step).filter((lat) => lat > -90 && lat < 90);
  return {
    meridians,
    parallels,
    stepDeg: step,
    lineCount: meridians.length + parallels.length,
    southDeg: south,
    northDeg: north,
    westDeg: niceDeg(westDeg),
    eastDeg: niceDeg(eastDeg),
    wraps: eastDeg < westDeg,
  };
}

/**
 * Pick a step that stays readable for this height and viewport.
 * @param {number} cameraHeightM
 * @param {{westDeg:number,southDeg:number,eastDeg:number,northDeg:number}} view
 * @returns {number}
 */
export function resolveGridStep(cameraHeightM, view = FULL_GLOBE) {
  const floor = gridStepDegrees(cameraHeightM);
  for (const stepDeg of GRID_STEPS_DEG) {
    if (stepDeg < floor) continue;
    const desc = describeGridLines({ ...view, stepDeg });
    if (desc.lineCount <= MAX_GRID_LINES) return stepDeg;
  }
  return 30;
}

function sampleLine(start, end, sampleStep, project) {
  const positions = [];
  const span = end - start;
  const step = Math.min(sampleStep, Math.max(span, sampleStep));
  if (!(span >= 0)) return [project(start), project(end)].filter(Boolean);
  for (let value = start; value < end - 1e-9; value += step) {
    positions.push(project(value));
  }
  positions.push(project(end));
  return positions;
}

function sampleMeridian(lon, south, north, sampleStep) {
  return sampleLine(south, north, sampleStep, (lat) => ({ lat: niceDeg(lat), lon }));
}

function sampleParallel(lat, west, east, sampleStep) {
  return sampleLine(west, east, sampleStep, (lon) => ({ lat, lon: niceDeg(lon) }));
}

/**
 * @param {ReturnType<typeof describeGridLines>} desc
 * @returns {{kind:'meridian'|'parallel',value:number,positions:{lat:number,lon:number}[]}[]}
 */
export function buildGridPolylines(desc) {
  const sampleStep = Math.min(5, Math.max(1, desc.stepDeg));
  const lines = [];
  for (const lon of desc.meridians) {
    const positions = sampleMeridian(lon, desc.southDeg, desc.northDeg, sampleStep);
    if (positions.length >= 2) lines.push({ kind: 'meridian', value: lon, positions });
  }
  for (const lat of desc.parallels) {
    for (const span of lonSpans(desc.westDeg, desc.eastDeg)) {
      const positions = sampleParallel(lat, span.west, span.east, sampleStep);
      if (positions.length >= 2) lines.push({ kind: 'parallel', value: lat, positions });
    }
  }
  return lines;
}

/**
 * @param {object} [camera]
 * @param {{toDegrees?: (rad:number)=>number}} [math]
 */
export function readCameraGridView(camera, math = {}) {
  const toDegrees = typeof math.toDegrees === 'function'
    ? math.toDegrees
    : (rad) => (Number(rad) * 180) / Math.PI;
  const heightM = Number(camera?.positionCartographic?.height);
  const rect = typeof camera?.computeViewRectangle === 'function'
    ? camera.computeViewRectangle()
    : null;
  if (!rect || ![rect.west, rect.south, rect.east, rect.north].every(Number.isFinite)) {
    return {
      heightM: Number.isFinite(heightM) ? heightM : 20_000_000,
      ...FULL_GLOBE,
    };
  }
  return {
    heightM: Number.isFinite(heightM) ? heightM : 20_000_000,
    westDeg: toDegrees(rect.west),
    southDeg: toDegrees(rect.south),
    eastDeg: toDegrees(rect.east),
    northDeg: toDegrees(rect.north),
  };
}

/**
 * @param {{
 *   getView?: () => {heightM:number,westDeg:number,southDeg:number,eastDeg:number,northDeg:number},
 *   setLines?: (lines: object[]) => void,
 *   setVisible?: (visible: boolean) => void,
 *   requestRender?: () => void,
 *   onCameraChanged?: (fn: () => void) => (() => void),
 *   destroy?: () => void,
 * }} host
 * @param {{storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 */
export function attachGridOverlay(host, { storage } = {}) {
  let enabled = readGridPreference(storage) === 'on';
  let stopCamera = null;

  function paint() {
    if (!enabled) {
      host?.setLines?.([]);
      host?.setVisible?.(false);
      host?.requestRender?.();
      return;
    }
    const view = host?.getView?.() || { heightM: 20_000_000, ...FULL_GLOBE };
    const stepDeg = resolveGridStep(view.heightM, view);
    host?.setLines?.(buildGridPolylines(describeGridLines({ ...view, stepDeg })));
    host?.setVisible?.(true);
    host?.requestRender?.();
  }

  function listen() {
    if (stopCamera || !enabled || typeof host?.onCameraChanged !== 'function') return;
    stopCamera = host.onCameraChanged(() => paint()) || null;
  }

  function unlisten() {
    try { stopCamera?.(); } catch { /* already detached */ }
    stopCamera = null;
  }

  function setEnabled(next) {
    enabled = normalizeGridPreference(next === true || next === 'on' || next === 1 || next === '1'
      ? 'on'
      : 'off') === 'on';
    writeGridPreference(storage, enabled ? 'on' : 'off');
    if (enabled) listen();
    else unlisten();
    paint();
    return enabled;
  }

  if (enabled) {
    listen();
    paint();
  } else {
    host?.setLines?.([]);
    host?.setVisible?.(false);
  }

  return {
    isEnabled: () => enabled,
    setEnabled,
    refresh: paint,
    destroy() {
      unlisten();
      enabled = false;
      host?.setLines?.([]);
      host?.setVisible?.(false);
      host?.destroy?.();
    },
  };
}

/**
 * Cesium primitive host. Cesium is injected so unit tests never load it.
 * @param {object} viewer
 * @param {object} Cesium
 * @param {() => void} [requestRender]
 */
export function createCesiumGridHost(viewer, Cesium, requestRender) {
  let collection = null;

  function ensureCollection() {
    if (collection || !viewer?.scene?.primitives || !Cesium?.PolylineCollection) return collection;
    collection = new Cesium.PolylineCollection();
    collection.show = false;
    viewer.scene.primitives.add(collection);
    return collection;
  }

  return {
    getView() {
      return readCameraGridView(viewer?.camera, { toDegrees: Cesium?.Math?.toDegrees });
    },
    setLines(lines) {
      const col = ensureCollection();
      if (!col) return;
      col.removeAll();
      const color = Cesium.Color.fromCssColorString('#8fd4e8').withAlpha(0.45);
      const material = Cesium.Material.fromType('Color', { color });
      for (const line of lines || []) {
        const degrees = [];
        for (const point of line.positions || []) {
          degrees.push(point.lon, point.lat);
        }
        if (degrees.length < 4) continue;
        col.add({
          positions: Cesium.Cartesian3.fromDegreesArray(degrees),
          width: 1.25,
          material,
        });
      }
    },
    setVisible(visible) {
      if (!collection && !visible) return;
      const col = ensureCollection();
      if (col) col.show = visible === true;
    },
    requestRender() {
      requestRender?.();
    },
    onCameraChanged(fn) {
      const remove = viewer?.camera?.changed?.addEventListener?.(fn);
      return typeof remove === 'function' ? remove : () => {
        viewer?.camera?.changed?.removeEventListener?.(fn);
      };
    },
    destroy() {
      if (!collection) return;
      try { viewer?.scene?.primitives?.remove?.(collection); } catch { /* already gone */ }
      collection = null;
    },
  };
}
