/**
 * @module flightHideNoRegFilter
 * @description Client-only Hide no registration toggle for already-fetched
 * flight contacts. Uses the current `registration` field (written by adsbdb
 * onto the in-memory contact) — no extra fetch and no new endpoint.
 *
 * Off is a pass-through (current draw stays). On hides contacts whose
 * registration is missing, null, empty, or whitespace-only after trim. A
 * published tail such as N123AB stays.
 *
 * Distinct from Identified only (callsign OR registration), Emergencies
 * only (7500/7600/7700), Hide no squawk, and Hide no type. Selected/tracked
 * exemption lives on the layer AND gate, not here. Persistence is local
 * (`meridian.flightHideNoReg`) and rides LayerStateCoordinator restore
 * via the flights layer params. It is not written into the share URL.
 */

export const HIDE_NO_REG_DEFAULT = false;
export const HIDE_NO_REG_CHIP_ID = 'hide-no-reg';
export const HIDE_NO_REG_CHIP_LABEL = 'Hide no registration';
export const HIDE_NO_REG_CHIP_TITLE =
  'Hide contacts that have no registration.';
export const HIDE_NO_REG_STORAGE_KEY = 'meridian.flightHideNoReg';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trimmed registration text. Missing, null, empty, and whitespace-only become ''.
 * @param {unknown} value
 * @returns {string}
 */
export function registrationFieldText(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

/**
 * Whether one in-memory contact already carries a published registration.
 * Missing/empty/whitespace rows fail.
 * @param {{registration?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasRegistration(contact) {
  return registrationFieldText(contact?.registration) !== '';
}

/**
 * Whether Hide no registration allows this contact to draw.
 * Off is a pass-through. On requires a non-empty registration after trim.
 * @param {{registration?: unknown, hideNoReg?: boolean}} [input]
 * @returns {boolean}
 */
export function passesHideNoRegFilter({
  registration,
  hideNoReg = HIDE_NO_REG_DEFAULT,
} = {}) {
  if (hideNoReg !== true) return true;
  return contactHasRegistration({ registration });
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeHideNoReg(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return HIDE_NO_REG_DEFAULT;
}

/**
 * Read the durable Hide no registration preference. Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readHideNoRegEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(HIDE_NO_REG_STORAGE_KEY);
    if (raw == null) return HIDE_NO_REG_DEFAULT;
    return normalizeHideNoReg(raw);
  } catch {
    return HIDE_NO_REG_DEFAULT;
  }
}

/**
 * Persist the Hide no registration preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeHideNoRegEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(HIDE_NO_REG_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = HIDE_NO_REG_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getHideNoRegEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setHideNoRegEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeHideNoReg(enabled);
  currentEnabled = next;
  if (persist) writeHideNoRegEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateHideNoRegEnabled(storage) {
  return setHideNoRegEnabled(readHideNoRegEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeHideNoRegEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetHideNoRegForTest() {
  currentEnabled = HIDE_NO_REG_DEFAULT;
}

/** Layer-row chip for the civil flights Hide no registration toggle. */
export function hideNoRegChipModel(active = HIDE_NO_REG_DEFAULT) {
  const on = active === true;
  return {
    id: HIDE_NO_REG_CHIP_ID,
    label: HIDE_NO_REG_CHIP_LABEL,
    active: on,
    title: HIDE_NO_REG_CHIP_TITLE,
    params: { hideNoReg: !on },
  };
}
