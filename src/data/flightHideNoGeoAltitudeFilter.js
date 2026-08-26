/**
 * @module flightHideNoGeoAltitudeFilter
 * @description Client-only Hide no geo altitude toggle for already-fetched
 * flight contacts. Uses the current `meta.geoAltitudeM` field (written by
 * each adsb.lol poll from the state-vector geo height onto the in-memory
 * contact) — no extra fetch and no new endpoint. `geoAltitudeM` is not sticky:
 * each poll overwrites it from this poll's geo height.
 *
 * Off is a pass-through (current draw stays, including null / missing /
 * non-finite geoAltitudeM). On hides contacts whose `geoAltitudeM` is
 * not finite. 0 is a real on-ground / sea-level geo height and stays.
 * Missing, null, and non-finite fail closed when on.
 *
 * Distinct from the Plan 93 altitude-band floor (aviation `altitude` /
 * baro, not geo), Hide no speed (Plan 255, `velocity`), Hide no country
 * (Plan 244), and airborne-only / hide-ground (Plan 95).
 * Selected/tracked exemption lives on the layer AND gate, not here.
 * Persistence is local (`meridian.flightHideNoGeoAltitude`) and rides
 * LayerStateCoordinator restore via the flights layer params. It is
 * not written into the share URL.
 */

export const HIDE_NO_GEO_ALTITUDE_DEFAULT = false;
export const HIDE_NO_GEO_ALTITUDE_CHIP_ID = 'hide-no-geo-altitude';
export const HIDE_NO_GEO_ALTITUDE_CHIP_LABEL = 'Hide no geo altitude';
export const HIDE_NO_GEO_ALTITUDE_CHIP_TITLE =
  'Hide contacts that have no geo altitude.';
export const HIDE_NO_GEO_ALTITUDE_STORAGE_KEY = 'meridian.flightHideNoGeoAltitude';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Finite geo altitude in metres, or null when missing / non-finite.
 * 0 is a real on-ground / sea-level geo height and stays finite. Missing,
 * null, undefined, and NaN become null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function geoAltitudeFieldM(value) {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Whether one in-memory contact already carries a finite geoAltitudeM.
 * Missing/null/undefined/NaN rows fail. 0 (on-ground / sea-level) succeeds.
 * @param {{geoAltitudeM?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasGeoAltitude(contact) {
  return geoAltitudeFieldM(contact?.geoAltitudeM) != null;
}

/**
 * Whether Hide no geo altitude allows this contact to draw.
 * Off is a pass-through. On requires a finite geoAltitudeM (0 stays).
 * @param {{geoAltitudeM?: unknown, hideNoGeoAltitude?: boolean}} [input]
 * @returns {boolean}
 */
export function passesHideNoGeoAltitudeFilter({
  geoAltitudeM,
  hideNoGeoAltitude = HIDE_NO_GEO_ALTITUDE_DEFAULT,
} = {}) {
  if (hideNoGeoAltitude !== true) return true;
  return contactHasGeoAltitude({ geoAltitudeM });
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeHideNoGeoAltitude(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return HIDE_NO_GEO_ALTITUDE_DEFAULT;
}

/**
 * Read the durable Hide no geo altitude preference. Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readHideNoGeoAltitudeEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(HIDE_NO_GEO_ALTITUDE_STORAGE_KEY);
    if (raw == null) return HIDE_NO_GEO_ALTITUDE_DEFAULT;
    return normalizeHideNoGeoAltitude(raw);
  } catch {
    return HIDE_NO_GEO_ALTITUDE_DEFAULT;
  }
}

/**
 * Persist the Hide no geo altitude preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeHideNoGeoAltitudeEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(HIDE_NO_GEO_ALTITUDE_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = HIDE_NO_GEO_ALTITUDE_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getHideNoGeoAltitudeEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setHideNoGeoAltitudeEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeHideNoGeoAltitude(enabled);
  currentEnabled = next;
  if (persist) writeHideNoGeoAltitudeEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateHideNoGeoAltitudeEnabled(storage) {
  return setHideNoGeoAltitudeEnabled(readHideNoGeoAltitudeEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeHideNoGeoAltitudeEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetHideNoGeoAltitudeForTest() {
  currentEnabled = HIDE_NO_GEO_ALTITUDE_DEFAULT;
}

/** Layer-row chip for the civil flights Hide no geo altitude toggle. */
export function hideNoGeoAltitudeChipModel(active = HIDE_NO_GEO_ALTITUDE_DEFAULT) {
  const on = active === true;
  return {
    id: HIDE_NO_GEO_ALTITUDE_CHIP_ID,
    label: HIDE_NO_GEO_ALTITUDE_CHIP_LABEL,
    active: on,
    title: HIDE_NO_GEO_ALTITUDE_CHIP_TITLE,
    params: { hideNoGeoAltitude: !on },
  };
}
