/**
 * Client-only CCTV calibration-source chips (Calibrated | Curated | Raw).
 *
 * Wraps `deriveCalBadge` — the existing panel classifier — so operators can
 * hide raw Austin priors or keep only manually calibrated cameras.
 * Default is all on (current catalog). A selected camera stays.
 * Persistence is local only (`meridian.cctv.calSource`).
 * No extra /api/cctv fetch.
 */

export const CCTV_CAL_SOURCE_STORAGE_KEY = 'meridian.cctv.calSource';
export const CCTV_CAL_SOURCE_IDS = Object.freeze(['calibrated', 'curated', 'raw-prior']);
export const DEFAULT_CCTV_CAL_SOURCE_FILTER = Object.freeze({
  calibrated: true,
  curated: true,
  'raw-prior': true,
});

/**
 * Derives the panel CAL badge state for a camera (design §3b, as amended by
 * the LOCKED §9.2 — panel-only, no in-world tint).
 *
 * Three states:
 *  - 'calibrated' — a human explicitly saved a v2 calibration (`source:'manual'`).
 *  - 'curated'    — no manual save, but the catalog entry was hand-authored
 *                   (`poseSource:'curated'`, file/env sources only).
 *  - 'raw-prior'  — everything else (all Austin Open Data today).
 *
 * Pure — no scoring math, no raycasts. `confidenceFromScore` and score-based
 * quality seeding are retired; this replaces them.
 * @param {{calSource?: string|null, poseSource?: string|null}} camera
 * @returns {'calibrated'|'curated'|'raw-prior'}
 */
export function deriveCalBadge(camera) {
  if (camera?.calSource === 'manual') return 'calibrated';
  if (camera?.poseSource === 'curated') return 'curated';
  return 'raw-prior';
}

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function calSourceChipId(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'calibrated' || raw === 'curated' || raw === 'raw-prior') return raw;
  if (raw === 'raw') return 'raw-prior';
  return null;
}

/**
 * Accept chip maps, 'all' / a single id, or a partial object.
 * Missing chip keys stay on so a single-chip toggle does not hide the others.
 * @param {unknown} value
 * @returns {{calibrated: boolean, curated: boolean, 'raw-prior': boolean}}
 */
export function normalizeCctvCalBadgeFilter(value) {
  if (value == null || value === '' || value === 'all' || value === true) {
    return { ...DEFAULT_CCTV_CAL_SOURCE_FILTER };
  }
  if (value === 'none' || value === false) {
    return { calibrated: false, curated: false, 'raw-prior': false };
  }
  const single = calSourceChipId(value);
  if (single) {
    return {
      calibrated: single === 'calibrated',
      curated: single === 'curated',
      'raw-prior': single === 'raw-prior',
    };
  }
  if (Array.isArray(value)) {
    const next = { calibrated: false, curated: false, 'raw-prior': false };
    for (const raw of value) {
      const id = calSourceChipId(raw);
      if (id) next[id] = true;
    }
    return next;
  }
  if (typeof value === 'object') {
    return {
      calibrated: value.calibrated !== false,
      curated: value.curated !== false,
      'raw-prior': value['raw-prior'] !== false,
    };
  }
  return { ...DEFAULT_CCTV_CAL_SOURCE_FILTER };
}

/**
 * Whether one catalog camera clears the calibration-source chips.
 * Classification is `deriveCalBadge` only. A selected camera can be kept.
 * @param {{id?: string, calSource?: string|null, poseSource?: string|null}|null|undefined} source
 * @param {unknown} filter
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function sourceMatchesCalBadge(source, filter, { selectedId = null } = {}) {
  if (selectedId && source?.id === selectedId) return true;
  const badge = deriveCalBadge(source);
  const enabled = normalizeCctvCalBadgeFilter(filter);
  return enabled[badge] === true;
}

/**
 * Current-catalog cameras that still match the calibration-source chips.
 * @param {Array<object>|null|undefined} sources
 * @param {unknown} filter
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterCctvSourcesByCalBadge(sources, filter, options = {}) {
  return (Array.isArray(sources) ? sources : [])
    .filter((source) => sourceMatchesCalBadge(source, filter, options));
}

/**
 * Read the durable calibration-source chips. Storage failures fail open to all on.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {{calibrated: boolean, curated: boolean, 'raw-prior': boolean}}
 */
export function readCctvCalBadgeFilter(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(CCTV_CAL_SOURCE_STORAGE_KEY);
    if (raw == null || raw === '') return { ...DEFAULT_CCTV_CAL_SOURCE_FILTER };
    return normalizeCctvCalBadgeFilter(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CCTV_CAL_SOURCE_FILTER };
  }
}

/**
 * Persist calibration-source chips. Best-effort; never throws.
 * @param {{setItem?: Function}|null|undefined} storage
 * @param {unknown} filter
 * @returns {{calibrated: boolean, curated: boolean, 'raw-prior': boolean}}
 */
export function writeCctvCalBadgeFilter(storage, filter) {
  const next = normalizeCctvCalBadgeFilter(filter);
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(CCTV_CAL_SOURCE_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Fail open: the session can still hold the chips in memory.
  }
  return next;
}
