/**
 * Client-only CCTV heading-confidence chips (High | Medium | Low).
 *
 * Filters the in-memory catalog by `headingConfidence` already set on each
 * camera (source value, or high/low from a seed). Default is all on.
 * Missing or unknown confidence stays visible. A selected camera stays.
 * Persistence is local only (`meridian.cctvHeadingConfidence`).
 * No extra /api/cctv/sources or /health fetch.
 */

export const CCTV_HEADING_CONFIDENCE_STORAGE_KEY = 'meridian.cctvHeadingConfidence';
export const CCTV_HEADING_CONFIDENCE_IDS = Object.freeze(['high', 'medium', 'low']);
export const DEFAULT_CCTV_HEADING_CONFIDENCE_FILTER = Object.freeze({
  high: true,
  medium: true,
  low: true,
});

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Map a catalog headingConfidence onto one chip. Unknown/missing is null
 * so those cameras stay visible regardless of chip state.
 * @param {unknown} value
 * @returns {'high'|'medium'|'low'|null}
 */
export function cctvHeadingConfidenceLevel(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'high' || raw === 'medium' || raw === 'low') return raw;
  return null;
}

/**
 * Accept chip maps, 'all' / a single id, or a partial object.
 * Missing chip keys stay on so a single-chip toggle does not hide the others.
 * @param {unknown} value
 * @returns {{high: boolean, medium: boolean, low: boolean}}
 */
export function normalizeCctvHeadingConfidenceFilter(value) {
  if (value == null || value === '' || value === 'all' || value === true) {
    return { ...DEFAULT_CCTV_HEADING_CONFIDENCE_FILTER };
  }
  if (value === 'none' || value === false) {
    return { high: false, medium: false, low: false };
  }
  if (value === 'high' || value === 'medium' || value === 'low') {
    return {
      high: value === 'high',
      medium: value === 'medium',
      low: value === 'low',
    };
  }
  if (Array.isArray(value)) {
    const next = { high: false, medium: false, low: false };
    for (const raw of value) {
      const id = String(raw || '').trim().toLowerCase();
      if (id === 'high' || id === 'medium' || id === 'low') next[id] = true;
    }
    return next;
  }
  if (typeof value === 'object') {
    return {
      high: value.high !== false,
      medium: value.medium !== false,
      low: value.low !== false,
    };
  }
  return { ...DEFAULT_CCTV_HEADING_CONFIDENCE_FILTER };
}

/**
 * Whether one catalog camera clears the heading-confidence chips.
 * Unknown/missing confidence stays visible. A selected camera can be kept.
 * @param {{id?: string, headingConfidence?: unknown}|null|undefined} source
 * @param {unknown} filter
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function sourceMatchesHeadingConfidence(source, filter, { selectedId = null } = {}) {
  if (selectedId && source?.id === selectedId) return true;
  const level = cctvHeadingConfidenceLevel(source?.headingConfidence);
  if (level == null) return true;
  const enabled = normalizeCctvHeadingConfidenceFilter(filter);
  return enabled[level] === true;
}

/**
 * Current-catalog cameras that still match the heading-confidence chips.
 * @param {Array<object>|null|undefined} sources
 * @param {unknown} filter
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterCctvSourcesByHeadingConfidence(sources, filter, options = {}) {
  return (Array.isArray(sources) ? sources : [])
    .filter((source) => sourceMatchesHeadingConfidence(source, filter, options));
}

/**
 * Read the durable heading-confidence chips. Storage failures fail open to all on.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {{high: boolean, medium: boolean, low: boolean}}
 */
export function readCctvHeadingConfidenceFilter(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(CCTV_HEADING_CONFIDENCE_STORAGE_KEY);
    if (raw == null || raw === '') return { ...DEFAULT_CCTV_HEADING_CONFIDENCE_FILTER };
    return normalizeCctvHeadingConfidenceFilter(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CCTV_HEADING_CONFIDENCE_FILTER };
  }
}

/**
 * Persist heading-confidence chips. Best-effort; never throws.
 * @param {{setItem?: Function}|null|undefined} storage
 * @param {unknown} filter
 * @returns {{high: boolean, medium: boolean, low: boolean}}
 */
export function writeCctvHeadingConfidenceFilter(storage, filter) {
  const next = normalizeCctvHeadingConfidenceFilter(filter);
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(CCTV_HEADING_CONFIDENCE_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Fail open: the session can still hold the chips in memory.
  }
  return next;
}
