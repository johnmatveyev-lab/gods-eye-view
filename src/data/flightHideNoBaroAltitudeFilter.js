/**
 * @module flightHideNoBaroAltitudeFilter
 * @description Client-only Hide no baro altitude toggle for already-fetched
 * flight contacts. Uses the current aviation `altitude` / `altitudeM` field
 * (written by each adsb.lol poll from the state-vector baro metres onto
 * the in-memory contact) — no extra fetch and no new endpoint.
 *
 * Off is a pass-through (current draw stays, including missing / non-finite
 * baro). On hides contacts whose `altitude` / `altitudeM` is not finite.
 * 0 is a real on-ground / sea-level baro and stays. 10000 m stays.
 * Missing, null, and non-finite fail closed when on.
 *
 * Distinct from the Plan 93 altitude-band chips (All pass-through; a named
 * band fail-closes missing baro), Hide no geo altitude (Plan 261,
 * `geoAltitudeM` only), Hide no vertical rate (Plan 268), Hide no speed
 * (Plan 255, `velocity`), and airborne-only / hide-ground (Plan 95).
 * This is presence-only, not an altitude-band chip.
 * Selected/tracked exemption lives on the layer AND gate, not here.
 * Persistence is local (`meridian.flightHideNoBaroAltitude`) and rides
 * LayerStateCoordinator restore via the flights layer params. It is
 * not written into the share URL.
 */

export const HIDE_NO_BARO_ALTITUDE_DEFAULT = false;
export const HIDE_NO_BARO_ALTITUDE_CHIP_ID = 'hide-no-baro-altitude';
export const HIDE_NO_BARO_ALTITUDE_CHIP_LABEL = 'Hide no baro altitude';
export const HIDE_NO_BARO_ALTITUDE_CHIP_TITLE =
  'Hide contacts that have no baro altitude.';
export const HIDE_NO_BARO_ALTITUDE_STORAGE_KEY = 'meridian.flightHideNoBaroAltitude';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Finite baro altitude in metres, or null when missing / non-finite.
 * 0 is a real on-ground / sea-level baro and stays finite. Missing,
 * null, undefined, and NaN become null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function baroAltitudeFieldM(value) {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Whether one in-memory contact already carries a finite altitude
 * or altitudeM. Missing/null/undefined/NaN rows fail. 0 (on-ground /
 * sea-level) succeeds.
 * @param {{altitude?: unknown, altitudeM?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasBaroAltitude(contact) {
  return baroAltitudeFieldM(contact?.altitude) != null
    || baroAltitudeFieldM(contact?.altitudeM) != null;
}

/**
 * Whether Hide no baro altitude allows this contact to draw.
 * Off is a pass-through. On requires a finite altitude / altitudeM
 * (0 stays).
 * @param {{altitude?: unknown, altitudeM?: unknown, hideNoBaroAltitude?: boolean}} [input]
 * @returns {boolean}
 */
export function passesHideNoBaroAltitudeFilter({
  altitude,
  altitudeM,
  hideNoBaroAltitude = HIDE_NO_BARO_ALTITUDE_DEFAULT,
} = {}) {
  if (hideNoBaroAltitude !== true) return true;
  return contactHasBaroAltitude({ altitude, altitudeM });
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeHideNoBaroAltitude(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return HIDE_NO_BARO_ALTITUDE_DEFAULT;
}

/**
 * Read the durable Hide no baro altitude preference. Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readHideNoBaroAltitudeEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(HIDE_NO_BARO_ALTITUDE_STORAGE_KEY);
    if (raw == null) return HIDE_NO_BARO_ALTITUDE_DEFAULT;
    return normalizeHideNoBaroAltitude(raw);
  } catch {
    return HIDE_NO_BARO_ALTITUDE_DEFAULT;
  }
}

/**
 * Persist the Hide no baro altitude preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeHideNoBaroAltitudeEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(HIDE_NO_BARO_ALTITUDE_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = HIDE_NO_BARO_ALTITUDE_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getHideNoBaroAltitudeEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setHideNoBaroAltitudeEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeHideNoBaroAltitude(enabled);
  currentEnabled = next;
  if (persist) writeHideNoBaroAltitudeEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateHideNoBaroAltitudeEnabled(storage) {
  return setHideNoBaroAltitudeEnabled(readHideNoBaroAltitudeEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeHideNoBaroAltitudeEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetHideNoBaroAltitudeForTest() {
  currentEnabled = HIDE_NO_BARO_ALTITUDE_DEFAULT;
}

/** Layer-row chip for the civil flights Hide no baro altitude toggle. */
export function hideNoBaroAltitudeChipModel(active = HIDE_NO_BARO_ALTITUDE_DEFAULT) {
  const on = active === true;
  return {
    id: HIDE_NO_BARO_ALTITUDE_CHIP_ID,
    label: HIDE_NO_BARO_ALTITUDE_CHIP_LABEL,
    active: on,
    title: HIDE_NO_BARO_ALTITUDE_CHIP_TITLE,
    params: { hideNoBaroAltitude: !on },
  };
}
