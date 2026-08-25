/**
 * @module trailPreference
 * @description Hosted Trails on/off preference for the existing tracked-target
 * trail renderer. Persistence is local only (`meridian.trails`); default ON.
 * Turning trails off hides drawing without stopping track or clearing history.
 */

export const TRAILS_STORAGE_KEY = 'meridian.trails';
export const TRAILS_DEFAULT_ENABLED = true;

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit off is off;
 * missing or corrupt values keep the product default ON.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeTrailsEnabled(value) {
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return TRAILS_DEFAULT_ENABLED;
}

/**
 * Read the durable Trails preference. Storage failures fail open to ON.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readTrailsEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(TRAILS_STORAGE_KEY);
    if (raw == null) return TRAILS_DEFAULT_ENABLED;
    return normalizeTrailsEnabled(raw);
  } catch {
    return TRAILS_DEFAULT_ENABLED;
  }
}

/**
 * Persist the Trails preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeTrailsEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(TRAILS_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the existing trail renderer should draw right now.
 * Cockpit still hides trails independently of the hosted preference.
 * @param {{trailsEnabled?: boolean, cockpitContactMode?: boolean}} [state]
 * @returns {boolean}
 */
export function trailDrawingVisible({
  trailsEnabled = TRAILS_DEFAULT_ENABLED,
  cockpitContactMode = false,
} = {}) {
  return trailsEnabled !== false && cockpitContactMode !== true;
}

let currentEnabled = TRAILS_DEFAULT_ENABLED;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getTrailsEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setTrailsEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeTrailsEnabled(enabled);
  currentEnabled = next;
  if (persist) writeTrailsEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateTrailsEnabled(storage) {
  return setTrailsEnabled(readTrailsEnabled(storage), { persist: false, storage });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeTrailsEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default ON preference without clearing subscribers. */
export function resetTrailsEnabledForTest() {
  currentEnabled = TRAILS_DEFAULT_ENABLED;
  for (const listener of listeners) listener(currentEnabled);
}
