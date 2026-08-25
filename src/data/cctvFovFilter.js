/**
 * Client-only exclusive CCTV FOV chips (All | Wide 75+ | Tight <70).
 *
 * Filters the in-memory catalog by effective FOV: catalog `fovDeg` plus any
 * calibration `fovDeg` offset that has not already been applied. After
 * `ensureCameraPose`, `camera.fovDeg` is already the clamped sum — do not
 * add the offset again when `basePose` is present.
 *
 * Default is All (current catalog). Missing or non-finite FOV stays visible.
 * A selected camera stays. The 70–75 band is neither Wide nor Tight.
 * Persistence is local only (`meridian.cctvFov`).
 * No extra /api/cctv fetch.
 */

export const CCTV_FOV_STORAGE_KEY = 'meridian.cctvFov';
export const CCTV_FOV_CHIP_IDS = Object.freeze(['all', 'wide', 'tight']);
export const DEFAULT_CCTV_FOV_FILTER = 'all';
/** Wide chip: effective FOV at or above this value. */
export const CCTV_FOV_WIDE_MIN_DEG = 75;
/** Tight chip: effective FOV strictly below this value. */
export const CCTV_FOV_TIGHT_MAX_DEG = 70;

/** @typedef {'all'|'wide'|'tight'} CctvFovChipId */

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Effective horizontal FOV in degrees.
 *
 * Catalog cameras store `fovDeg`. Calibration stores a `fovDeg` *offset*.
 * Pose derivation writes the clamped sum back onto `camera.fovDeg` and
 * freezes the catalog value on `basePose.fovDeg`. If `basePose` is present,
 * `fovDeg` is already effective — adding the offset again would double-count.
 *
 * @param {{
 *   fovDeg?: unknown,
 *   basePose?: {fovDeg?: unknown}|null,
 *   calibration?: {fovDeg?: unknown}|null,
 * }|null|undefined} source
 * @returns {number|null}
 */
export function effectiveCctvFovDeg(source) {
  if (!source || typeof source !== 'object') return null;
  const live = Number(source.fovDeg);
  if (source.basePose && Number.isFinite(live)) return live;

  const catalog = Number.isFinite(live) ? live : Number(source.basePose?.fovDeg);
  if (!Number.isFinite(catalog)) return null;
  const offset = Number(source.calibration?.fovDeg);
  return Number.isFinite(offset) ? catalog + offset : catalog;
}

/**
 * Canonical exclusive chip. Invalid input becomes All.
 * @param {unknown} value
 * @returns {CctvFovChipId}
 */
export function normalizeCctvFovFilter(value) {
  if (value == null || value === '' || value === true || value === 'all' || value === 0 || value === '0') {
    return DEFAULT_CCTV_FOV_FILTER;
  }
  const text = String(value).trim().toLowerCase();
  if (text === 'wide' || text === '75' || text === '75+') return 'wide';
  if (text === 'tight' || text === '70' || text === '<70') return 'tight';
  return DEFAULT_CCTV_FOV_FILTER;
}

/**
 * Whether one catalog camera clears the exclusive FOV chips.
 * Missing / non-finite FOV stays visible. A selected camera can be kept.
 * @param {{
 *   id?: string,
 *   fovDeg?: unknown,
 *   basePose?: {fovDeg?: unknown}|null,
 *   calibration?: {fovDeg?: unknown}|null,
 * }|null|undefined} source
 * @param {unknown} filter
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function sourceMatchesCctvFov(source, filter, { selectedId = null } = {}) {
  if (selectedId && source?.id === selectedId) return true;
  const chip = normalizeCctvFovFilter(filter);
  switch (chip) {
    case 'all':
      return true;
    case 'wide': {
      const fov = effectiveCctvFovDeg(source);
      if (fov == null) return true;
      return fov >= CCTV_FOV_WIDE_MIN_DEG;
    }
    case 'tight': {
      const fov = effectiveCctvFovDeg(source);
      if (fov == null) return true;
      return fov < CCTV_FOV_TIGHT_MAX_DEG;
    }
    default: {
      const _exhaustive = /** @type {never} */ (chip);
      void _exhaustive;
      return true;
    }
  }
}

/**
 * Current-catalog cameras that still match the exclusive FOV chips.
 * @param {Array<object>|null|undefined} sources
 * @param {unknown} filter
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterCctvSourcesByFov(sources, filter, options = {}) {
  const list = Array.isArray(sources) ? sources : [];
  if (normalizeCctvFovFilter(filter) === DEFAULT_CCTV_FOV_FILTER) return list.slice();
  return list.filter((source) => sourceMatchesCctvFov(source, filter, options));
}

/**
 * Read the durable FOV chip. Storage failures fail open to All.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {CctvFovChipId}
 */
export function readCctvFovFilter(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(CCTV_FOV_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_CCTV_FOV_FILTER;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string' || parsed == null) {
        return normalizeCctvFovFilter(parsed);
      }
    } catch {
      // Raw chip id, not JSON.
    }
    return normalizeCctvFovFilter(raw);
  } catch {
    return DEFAULT_CCTV_FOV_FILTER;
  }
}

/**
 * Persist the exclusive FOV chip. Best-effort; never throws.
 * @param {{setItem?: Function}|null|undefined} storage
 * @param {unknown} filter
 * @returns {CctvFovChipId}
 */
export function writeCctvFovFilter(storage, filter) {
  const next = normalizeCctvFovFilter(filter);
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(CCTV_FOV_STORAGE_KEY, next);
    }
  } catch {
    // Fail open: the session can still hold the chip in memory.
  }
  return next;
}
