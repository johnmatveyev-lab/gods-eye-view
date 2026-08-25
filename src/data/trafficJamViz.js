/**
 * @module data/trafficJamViz
 * @description Street Traffic jam-viz chrome. Wires the existing
 * `setParams({ jamViz })` contract — density bunching, heatline corridors,
 * both, or shipped-main off. Live mode only (sim has no `road.flow`).
 * Preference lives in localStorage `meridian.trafficJamViz` because traffic
 * is still `enabled-only` (no cheap layer-option slot). Never written into
 * share URLs. Independent of Live | Sim and Uncovered Sim | Hide.
 */

export const JAM_VIZ_STORAGE_KEY = 'meridian.trafficJamViz';
export const DEFAULT_JAM_VIZ = 'density';
export const JAM_VIZ_MODES = Object.freeze(['none', 'density', 'heatline', 'both']);
export const JAM_VIZ_CHANGE_EVENT = 'meridian:trafficJamViz';

const JAM_VIZ_CHIPS = Object.freeze([
  {
    id: 'jam-viz-density',
    mode: 'density',
    label: 'Density',
    title: 'Jam bunching and stop-and-go (current view)',
  },
  {
    id: 'jam-viz-heatline',
    mode: 'heatline',
    label: 'Heatline',
    title: 'Congestion corridor polylines without density boost',
  },
  {
    id: 'jam-viz-both',
    mode: 'both',
    label: 'Both',
    title: 'Density bunching plus corridor polylines',
  },
  {
    id: 'jam-viz-off',
    mode: 'none',
    label: 'Off',
    title: 'Shipped-main dots with no jam extras',
  },
]);

/** @type {'none'|'density'|'heatline'|'both'|null} */
let cachedJamViz = null;

/** Clear the in-memory preference so the next read hits storage (reload / tests). */
export function resetJamVizCache() {
  cachedJamViz = null;
}

/**
 * @param {unknown} value
 * @returns {'none'|'density'|'heatline'|'both'}
 */
export function normalizeJamViz(value) {
  const normalized = String(value || '').toLowerCase();
  return JAM_VIZ_MODES.includes(normalized) ? normalized : DEFAULT_JAM_VIZ;
}

/**
 * Visual extras each jamViz mode turns on. Density is today's default view:
 * deep-jam bunching + platoon queues + stop-and-go. Heatline drapes corridor
 * polylines and leaves the shipped density curve alone. Off is shipped-main.
 * @param {unknown} mode
 * @returns {{jamViz: 'none'|'density'|'heatline'|'both', densityBoost: boolean, heatline: boolean, queuePlatoons: boolean, stopAndGo: boolean}}
 */
export function jamVizEffects(mode) {
  const jamViz = normalizeJamViz(mode);
  const densityBoost = jamViz === 'density' || jamViz === 'both';
  return {
    jamViz,
    densityBoost,
    heatline: jamViz === 'heatline' || jamViz === 'both',
    queuePlatoons: densityBoost,
    stopAndGo: densityBoost,
  };
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {'none'|'density'|'heatline'|'both'}
 */
export function readJamViz(storage) {
  try {
    const raw = storage?.getItem?.(JAM_VIZ_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_JAM_VIZ;
    return normalizeJamViz(raw);
  } catch {
    return DEFAULT_JAM_VIZ;
  }
}

/**
 * @param {unknown} mode
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {'none'|'density'|'heatline'|'both'}
 */
export function writeJamViz(mode, storage) {
  const normalized = normalizeJamViz(mode);
  try {
    storage?.setItem?.(JAM_VIZ_STORAGE_KEY, normalized);
  } catch {
    // Fail open: the session can still use the chosen mode.
  }
  return normalized;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {'none'|'density'|'heatline'|'both'}
 */
export function getJamViz(storage = globalThis.localStorage) {
  if (cachedJamViz) return cachedJamViz;
  cachedJamViz = readJamViz(storage);
  return cachedJamViz;
}

/**
 * @param {unknown} mode
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {'none'|'density'|'heatline'|'both'}
 */
export function setJamViz(mode, storage = globalThis.localStorage) {
  cachedJamViz = writeJamViz(mode, storage);
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent(JAM_VIZ_CHANGE_EVENT, {
      detail: { jamViz: cachedJamViz },
    }));
  }
  return cachedJamViz;
}

/**
 * DATA LAYERS chips for Street Traffic: Jam Density | Heatline | Both | Off.
 * Hidden in Sim — every jamViz path is unreachable without `road.flow`.
 * Chip params are `{ jamViz }` only; Live | Sim and Uncovered stay independent.
 * @param {{jamViz?: unknown, liveMode?: boolean}} [input]
 * @returns {{heading: string, chips: Array<object>}}
 */
export function jamVizControls({
  jamViz = DEFAULT_JAM_VIZ,
  liveMode = false,
} = {}) {
  if (!liveMode) return { heading: 'Jam', chips: [] };
  const mode = normalizeJamViz(jamViz);
  return {
    heading: 'Jam',
    chips: JAM_VIZ_CHIPS.map((chip) => {
      const active = chip.mode === mode;
      return {
        id: chip.id,
        label: chip.label,
        title: chip.title,
        active,
        disabled: false,
        state: active ? 'active' : 'idle',
        group: 'Jam',
        params: { jamViz: chip.mode },
      };
    }),
  };
}
