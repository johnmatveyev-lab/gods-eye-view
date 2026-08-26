/**
 * @module flightHideNoCallsignFilter
 * @description Client-only Hide no callsign toggle for already-fetched
 * flight contacts. Uses the current `callsign` field (written by the
 * adsb.lol poll onto the in-memory contact) — no extra fetch and no new
 * endpoint.
 *
 * Off is a pass-through (current draw stays). On hides contacts whose
 * callsign is missing, null, empty, or whitespace-only after trim. A
 * published callsign such as DAL123 stays.
 *
 * Distinct from Identified only (callsign OR registration), Emergencies
 * only (7500/7600/7700), Hide no squawk, Hide no type, and Hide no
 * registration. Selected/tracked exemption lives on the layer AND gate,
 * not here. Persistence is local (`meridian.flightHideNoCallsign`) and
 * rides LayerStateCoordinator restore via the flights layer params. It
 * is not written into the share URL.
 */

export const HIDE_NO_CALLSIGN_DEFAULT = false;
export const HIDE_NO_CALLSIGN_CHIP_ID = 'hide-no-callsign';
export const HIDE_NO_CALLSIGN_CHIP_LABEL = 'Hide no callsign';
export const HIDE_NO_CALLSIGN_CHIP_TITLE =
  'Hide contacts that have no callsign.';
export const HIDE_NO_CALLSIGN_STORAGE_KEY = 'meridian.flightHideNoCallsign';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trimmed callsign text. Missing, null, empty, and whitespace-only become ''.
 * @param {unknown} value
 * @returns {string}
 */
export function callsignFieldText(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

/**
 * Whether one in-memory contact already carries a published callsign.
 * Missing/empty/whitespace rows fail.
 * @param {{callsign?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasCallsign(contact) {
  return callsignFieldText(contact?.callsign) !== '';
}

/**
 * Whether Hide no callsign allows this contact to draw.
 * Off is a pass-through. On requires a non-empty callsign after trim.
 * @param {{callsign?: unknown, hideNoCallsign?: boolean}} [input]
 * @returns {boolean}
 */
export function passesHideNoCallsignFilter({
  callsign,
  hideNoCallsign = HIDE_NO_CALLSIGN_DEFAULT,
} = {}) {
  if (hideNoCallsign !== true) return true;
  return contactHasCallsign({ callsign });
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeHideNoCallsign(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return HIDE_NO_CALLSIGN_DEFAULT;
}

/**
 * Read the durable Hide no callsign preference. Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readHideNoCallsignEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(HIDE_NO_CALLSIGN_STORAGE_KEY);
    if (raw == null) return HIDE_NO_CALLSIGN_DEFAULT;
    return normalizeHideNoCallsign(raw);
  } catch {
    return HIDE_NO_CALLSIGN_DEFAULT;
  }
}

/**
 * Persist the Hide no callsign preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeHideNoCallsignEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(HIDE_NO_CALLSIGN_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = HIDE_NO_CALLSIGN_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getHideNoCallsignEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setHideNoCallsignEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeHideNoCallsign(enabled);
  currentEnabled = next;
  if (persist) writeHideNoCallsignEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateHideNoCallsignEnabled(storage) {
  return setHideNoCallsignEnabled(readHideNoCallsignEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeHideNoCallsignEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetHideNoCallsignForTest() {
  currentEnabled = HIDE_NO_CALLSIGN_DEFAULT;
}

/** Layer-row chip for the civil flights Hide no callsign toggle. */
export function hideNoCallsignChipModel(active = HIDE_NO_CALLSIGN_DEFAULT) {
  const on = active === true;
  return {
    id: HIDE_NO_CALLSIGN_CHIP_ID,
    label: HIDE_NO_CALLSIGN_CHIP_LABEL,
    active: on,
    title: HIDE_NO_CALLSIGN_CHIP_TITLE,
    params: { hideNoCallsign: !on },
  };
}
