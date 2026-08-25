/**
 * @module data/trafficSource
 * @description Street Traffic Live | Sim source. Live uses existing
 * `/api/tomtom` tiles when status.hasKey; Sim is the built-in model and
 * never requests tiles. Preference lives in localStorage `meridian.trafficSource`
 * and is never written into share URLs.
 */

export const TRAFFIC_SOURCE_STORAGE_KEY = 'meridian.trafficSource';
export const DEFAULT_TRAFFIC_SOURCE = 'live';
export const TRAFFIC_SOURCE_CHANGE_EVENT = 'meridian:trafficSource';

/** @type {'live'|'sim'|null} */
let cachedSource = null;

/** Clear the in-memory preference so the next read hits storage (reload / tests). */
export function resetTrafficSourceCache() {
  cachedSource = null;
}

/**
 * @param {unknown} value
 * @returns {'live'|'sim'}
 */
export function normalizeTrafficSource(value) {
  return String(value || '').toLowerCase() === 'sim' ? 'sim' : 'live';
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {'live'|'sim'}
 */
export function readTrafficSource(storage) {
  try {
    const raw = storage?.getItem?.(TRAFFIC_SOURCE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_TRAFFIC_SOURCE;
    return normalizeTrafficSource(raw);
  } catch {
    return DEFAULT_TRAFFIC_SOURCE;
  }
}

/**
 * @param {unknown} source
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {'live'|'sim'}
 */
export function writeTrafficSource(source, storage) {
  const normalized = normalizeTrafficSource(source);
  try {
    storage?.setItem?.(TRAFFIC_SOURCE_STORAGE_KEY, normalized);
  } catch {
    // Fail open: the session can still use the chosen source.
  }
  return normalized;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {'live'|'sim'}
 */
export function getTrafficSource(storage = globalThis.localStorage) {
  if (cachedSource) return cachedSource;
  cachedSource = readTrafficSource(storage);
  return cachedSource;
}

/**
 * @param {unknown} source
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {'live'|'sim'}
 */
export function setTrafficSource(source, storage = globalThis.localStorage) {
  cachedSource = writeTrafficSource(source, storage);
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent(TRAFFIC_SOURCE_CHANGE_EVENT, {
      detail: { source: cachedSource },
    }));
  }
  return cachedSource;
}

/**
 * Effective paint source. Keyless (or unknown) always stays Sim.
 * @param {{hasKey?: boolean, preference?: unknown}} [input]
 * @returns {'live'|'sim'}
 */
export function resolveTrafficSource({ hasKey = false, preference = DEFAULT_TRAFFIC_SOURCE } = {}) {
  if (!hasKey) return 'sim';
  return normalizeTrafficSource(preference);
}

/**
 * Whether the layer may request `/api/tomtom/flow` tiles.
 * Status probes are not tiles and are not gated here.
 * @param {{hasKey?: boolean, source?: unknown}} [input]
 * @returns {boolean}
 */
export function trafficUsesLiveTiles({ hasKey = false, source = DEFAULT_TRAFFIC_SOURCE } = {}) {
  return resolveTrafficSource({ hasKey, preference: source }) === 'live';
}

/**
 * TomTom terms require the credit only when Live actually used a tile.
 * A key, a Live click, or a 429 without paint must not register it.
 * @param {{liveMode?: boolean, paintedTile?: boolean}} [input]
 * @returns {boolean}
 */
export function shouldRegisterTomTomCredit({ liveMode = false, paintedTile = false } = {}) {
  return Boolean(liveMode && paintedTile);
}

/**
 * DATA LAYERS chips for Street Traffic: Live | Sim.
 * Live is disabled without a key. Sim stays available through budget 429.
 * @param {{hasKey?: boolean, source?: unknown, flowError?: string|null}} [input]
 * @returns {{heading: string, chips: Array<object>}}
 */
export function trafficSourceControls({
  hasKey = false,
  source = 'sim',
  flowError = null,
} = {}) {
  const resolved = resolveTrafficSource({ hasKey, preference: source });
  const liveTitle = hasKey
    ? 'Use live TomTom traffic flow'
    : 'Live traffic needs a TomTom key on the host';
  const simTitle = flowError
    ? `Use built-in simulation — ${flowError}`
    : 'Use built-in simulated traffic (no TomTom tiles)';
  return {
    heading: 'Traffic',
    chips: [
      {
        id: 'traffic-source-live',
        label: 'Live',
        title: liveTitle,
        active: resolved === 'live',
        disabled: !hasKey,
        state: !hasKey ? 'idle' : (resolved === 'live' ? 'active' : 'idle'),
        params: { trafficSource: 'live' },
      },
      {
        id: 'traffic-source-sim',
        label: 'Sim',
        title: simTitle,
        active: resolved === 'sim',
        disabled: false,
        state: resolved === 'sim' ? 'active' : 'idle',
        params: { trafficSource: 'sim' },
      },
    ],
  };
}
