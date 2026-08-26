/**
 * @module flightHideNoSpeedFilter
 * @description Client-only Hide no speed toggle for already-fetched
 * flight contacts. Uses the current `meta.velocity` field (written by the
 * adsb.lol poll onto the in-memory contact) — no extra fetch and no new
 * endpoint.
 *
 * Off is a pass-through (current draw stays, including null / missing /
 * non-finite velocity). On hides contacts whose `velocity` is not finite.
 * 0 is a real parked / on-ground speed and stays. Missing, null, and
 * non-finite fail closed when on.
 *
 * Distinct from the fail-open speed-band floor (missing velocity still
 * passes that floor), airborne-only / hide-ground (Plan 95), Hide no
 * heading (Plan 234), Hide no country (Plan 244), and AIS Hide no speed.
 * Selected/tracked exemption lives on the layer AND gate, not here.
 * Persistence is local (`meridian.flightHideNoSpeed`) and rides
 * LayerStateCoordinator restore via the flights layer params. It is
 * not written into the share URL.
 */

export const HIDE_NO_SPEED_DEFAULT = false;
export const HIDE_NO_SPEED_CHIP_ID = 'hide-no-speed';
export const HIDE_NO_SPEED_CHIP_LABEL = 'Hide no speed';
export const HIDE_NO_SPEED_CHIP_TITLE =
  'Hide contacts that have no speed.';
export const HIDE_NO_SPEED_STORAGE_KEY = 'meridian.flightHideNoSpeed';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Finite velocity in m/s, or null when missing / non-finite.
 * 0 is a real parked / on-ground speed and stays finite. Missing, null,
 * undefined, and NaN become null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function velocityFieldMps(value) {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Whether one in-memory contact already carries a finite velocity.
 * Missing/null/undefined/NaN rows fail. 0 (parked / on-ground) succeeds.
 * @param {{velocity?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasSpeed(contact) {
  return velocityFieldMps(contact?.velocity) != null;
}

/**
 * Whether Hide no speed allows this contact to draw.
 * Off is a pass-through. On requires a finite velocity (0 stays).
 * @param {{velocity?: unknown, hideNoSpeed?: boolean}} [input]
 * @returns {boolean}
 */
export function passesHideNoSpeedFilter({
  velocity,
  hideNoSpeed = HIDE_NO_SPEED_DEFAULT,
} = {}) {
  if (hideNoSpeed !== true) return true;
  return contactHasSpeed({ velocity });
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeHideNoSpeed(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return HIDE_NO_SPEED_DEFAULT;
}

/**
 * Read the durable Hide no speed preference. Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readHideNoSpeedEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(HIDE_NO_SPEED_STORAGE_KEY);
    if (raw == null) return HIDE_NO_SPEED_DEFAULT;
    return normalizeHideNoSpeed(raw);
  } catch {
    return HIDE_NO_SPEED_DEFAULT;
  }
}

/**
 * Persist the Hide no speed preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeHideNoSpeedEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(HIDE_NO_SPEED_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = HIDE_NO_SPEED_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getHideNoSpeedEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setHideNoSpeedEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeHideNoSpeed(enabled);
  currentEnabled = next;
  if (persist) writeHideNoSpeedEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateHideNoSpeedEnabled(storage) {
  return setHideNoSpeedEnabled(readHideNoSpeedEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeHideNoSpeedEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetHideNoSpeedForTest() {
  currentEnabled = HIDE_NO_SPEED_DEFAULT;
}

/** Layer-row chip for the civil flights Hide no speed toggle. */
export function hideNoSpeedChipModel(active = HIDE_NO_SPEED_DEFAULT) {
  const on = active === true;
  return {
    id: HIDE_NO_SPEED_CHIP_ID,
    label: HIDE_NO_SPEED_CHIP_LABEL,
    active: on,
    title: HIDE_NO_SPEED_CHIP_TITLE,
    params: { hideNoSpeed: !on },
  };
}
