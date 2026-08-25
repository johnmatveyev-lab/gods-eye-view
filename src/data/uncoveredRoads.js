/**
 * @module data/uncoveredRoads
 * @description Street Traffic Uncovered: Sim | Hide. Sim keeps today's white
 * ambient dots on roads TomTom has no flow for. Hide spawns nothing on those
 * roads. Distinct from Plan 69 Live | Sim, which changes the whole feed.
 * Preference lives in localStorage `meridian.uncoveredRoads` and is never
 * written into share URLs.
 */

export const UNCOVERED_ROADS_STORAGE_KEY = 'meridian.uncoveredRoads';
export const DEFAULT_UNCOVERED_ROADS = 'sim';
export const UNCOVERED_ROADS_CHANGE_EVENT = 'meridian:uncoveredRoads';

/** @type {'sim'|'hide'|null} */
let cachedMode = null;

/** Clear the in-memory preference so the next read hits storage (reload / tests). */
export function resetUncoveredRoadsCache() {
  cachedMode = null;
}

/**
 * @param {unknown} value
 * @returns {'sim'|'hide'}
 */
export function normalizeUncoveredRoads(value) {
  return String(value || '').toLowerCase() === 'hide' ? 'hide' : 'sim';
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {'sim'|'hide'}
 */
export function readUncoveredRoads(storage) {
  try {
    const raw = storage?.getItem?.(UNCOVERED_ROADS_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_UNCOVERED_ROADS;
    return normalizeUncoveredRoads(raw);
  } catch {
    return DEFAULT_UNCOVERED_ROADS;
  }
}

/**
 * @param {unknown} mode
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {'sim'|'hide'}
 */
export function writeUncoveredRoads(mode, storage) {
  const normalized = normalizeUncoveredRoads(mode);
  try {
    storage?.setItem?.(UNCOVERED_ROADS_STORAGE_KEY, normalized);
  } catch {
    // Fail open: the session can still use the chosen treatment.
  }
  return normalized;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {'sim'|'hide'}
 */
export function getUncoveredRoads(storage = globalThis.localStorage) {
  if (cachedMode) return cachedMode;
  cachedMode = readUncoveredRoads(storage);
  return cachedMode;
}

/**
 * @param {unknown} mode
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {'sim'|'hide'}
 */
export function setUncoveredRoads(mode, storage = globalThis.localStorage) {
  cachedMode = writeUncoveredRoads(mode, storage);
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent(UNCOVERED_ROADS_CHANGE_EVENT, {
      detail: { uncoveredRoads: cachedMode },
    }));
  }
  return cachedMode;
}

/**
 * Whether an unmatched road still gets ambient dots.
 * Hide only applies while the layer is actually on Live flow.
 * Plan 69 whole-feed Sim (`liveMode` false) still paints every road.
 * @param {{liveMode?: boolean, hasFlow?: boolean, uncoveredRoads?: unknown}} [input]
 * @returns {boolean}
 */
export function uncoveredRoadSpawns({
  liveMode = false,
  hasFlow = false,
  uncoveredRoads = DEFAULT_UNCOVERED_ROADS,
} = {}) {
  return !(liveMode && !hasFlow && normalizeUncoveredRoads(uncoveredRoads) === 'hide');
}

/**
 * DATA LAYERS chips for Uncovered: Sim | Hide.
 * @param {{uncoveredRoads?: unknown}} [input]
 * @returns {{heading: string, chips: Array<object>}}
 */
export function uncoveredRoadsControls({ uncoveredRoads = DEFAULT_UNCOVERED_ROADS } = {}) {
  const mode = normalizeUncoveredRoads(uncoveredRoads);
  return {
    heading: 'Uncovered',
    chips: [
      {
        id: 'uncovered-sim',
        label: 'Sim',
        title: 'Paint white ambient dots on roads without live TomTom flow',
        active: mode === 'sim',
        disabled: false,
        state: mode === 'sim' ? 'active' : 'idle',
        group: 'Uncovered',
        params: { uncoveredRoads: 'sim' },
      },
      {
        id: 'uncovered-hide',
        label: 'Hide',
        title: 'Hide roads TomTom has no flow for (colored live flow stays)',
        active: mode === 'hide',
        disabled: false,
        state: mode === 'hide' ? 'active' : 'idle',
        group: 'Uncovered',
        params: { uncoveredRoads: 'hide' },
      },
    ],
  };
}
