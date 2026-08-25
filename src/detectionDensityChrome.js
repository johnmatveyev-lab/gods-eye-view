/**
 * @module detectionDensityChrome
 * @description Mouse chrome for the five-stop detection density control.
 * Voice `set_detection` and this slider must emit the same request and the
 * same Sparse/Balanced/Dense labels. Persistence uses an existing density
 * key when one is already populated; otherwise sessionStorage.
 *
 * Detection math (canonicalize, profile, budgets) stays in detectionPolicy.
 */

import {
  DENSITY_STOPS,
  canonicalizeDensity,
  normalizeProfile,
  profileForDensity,
} from './data/detectionPolicy.js';

/** Known leftover density keys. Reuse one only if it already has a value. */
export const DETECTION_DENSITY_KNOWN_KEYS = Object.freeze([
  'gev:detection-density:v1',
  'gev:detection-density',
  'meridian.detectionDensity',
]);

/** Session key used when no leftover density key exists. */
export const DETECTION_DENSITY_SESSION_KEY = 'meridian.detectionDensity';

const PROFILE_LABELS = Object.freeze({
  SPARSE: 'Sparse',
  BALANCED: 'Balanced',
  DENSE: 'Dense',
});

/**
 * Best-effort browser storage refs. Privacy-restricted getters must not throw
 * at the call site.
 * @param {object} [overrides]
 * @returns {{localStorage: Storage|null, sessionStorage: Storage|null}}
 */
export function detectionDensityStorageRefs(overrides = {}) {
  const read = (kind) => {
    if (Object.hasOwn(overrides, kind)) return overrides[kind] ?? null;
    try {
      return kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage;
    } catch {
      return null;
    }
  };
  return {
    localStorage: read('localStorage'),
    sessionStorage: read('sessionStorage'),
  };
}

/**
 * Prefer a leftover localStorage density key that already exists; otherwise
 * session. Never creates a new durable key.
 * @param {{localStorage?: Storage|null, sessionStorage?: Storage|null}} [refs]
 * @returns {{store: Storage|null, key: string, kind: 'local'|'session'}}
 */
export function resolveDetectionDensityStorage(refs = detectionDensityStorageRefs()) {
  const local = refs.localStorage ?? null;
  if (local) {
    for (const key of DETECTION_DENSITY_KNOWN_KEYS) {
      try {
        if (local.getItem(key) != null) {
          return { store: local, key, kind: 'local' };
        }
      } catch {
        // Privacy-restricted storage should fall through to session.
      }
    }
  }
  return {
    store: refs.sessionStorage ?? null,
    key: DETECTION_DENSITY_SESSION_KEY,
    kind: 'session',
  };
}

/**
 * @param {unknown} inputPct
 * @returns {{densityPct: number, profile: 'SPARSE'|'BALANCED'|'DENSE', label: string, hidesDetections: boolean}}
 */
export function detectionDensityChromeState(inputPct) {
  const densityPct = canonicalizeDensity(inputPct);
  const profile = profileForDensity(densityPct);
  return {
    densityPct,
    profile,
    label: PROFILE_LABELS[profile],
    hidesDetections: densityPct === 0,
  };
}

/**
 * The request both the slider and voice `set_detection` must send.
 * Density 0 is the hide stop (enabled false); every other stop turns the
 * overlay on at the density-derived Sparse/Balanced/Dense profile.
 * @param {unknown} inputPct
 * @returns {{densityPct: number, enabled: boolean}}
 */
export function detectionDensityControlRequest(inputPct) {
  const { densityPct, hidesDetections } = detectionDensityChromeState(inputPct);
  return { densityPct, enabled: !hidesDetections };
}

/**
 * Voice "density twenty-five" is the model calling set_detection with 25.
 * Same request as dragging the slider to 25.
 * @param {{densityPct?: unknown, mode?: unknown, enabled?: unknown}} args
 * @returns {{densityPct?: number, enabled?: boolean, mode?: string}}
 */
export function detectionDensityVoiceRequest(args = {}) {
  const out = {};
  if (args.densityPct != null && Number.isFinite(Number(args.densityPct))) {
    Object.assign(out, detectionDensityControlRequest(args.densityPct));
  }
  if (typeof args.enabled === 'boolean') out.enabled = args.enabled;
  if (typeof args.mode === 'string') {
    const profile = normalizeProfile(args.mode);
    if (profile && profile !== 'OFF') out.mode = profile.toLowerCase();
    if (profile === 'OFF') out.enabled = false;
  }
  return out;
}

/**
 * @param {unknown} inputPct
 * @param {{localStorage?: Storage|null, sessionStorage?: Storage|null}} [refs]
 * @returns {boolean}
 */
export function persistDetectionDensity(inputPct, refs = detectionDensityStorageRefs()) {
  const { store, key } = resolveDetectionDensityStorage(refs);
  if (!store) return false;
  try {
    store.setItem(key, String(canonicalizeDensity(inputPct)));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{localStorage?: Storage|null, sessionStorage?: Storage|null}} [refs]
 * @returns {number|null}
 */
export function readPersistedDetectionDensity(refs = detectionDensityStorageRefs()) {
  const { store, key } = resolveDetectionDensityStorage(refs);
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (raw == null || raw === '') return null;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return canonicalizeDensity(numeric);
  } catch {
    return null;
  }
}

export { DENSITY_STOPS, PROFILE_LABELS };
