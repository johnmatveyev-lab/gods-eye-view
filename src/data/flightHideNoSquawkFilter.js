/**
 * @module flightHideNoSquawkFilter
 * @description Client-only Hide no squawk toggle for already-fetched flight
 * contacts. Uses the current `squawk` field (normalized from the live state
 * vector) — no extra fetch and no new endpoint.
 *
 * Off is a pass-through (current draw stays). On hides contacts whose squawk
 * is missing, null, empty, or whitespace-only after trim. A published squawk
 * stays, including 1200, 7700, and every other non-empty code.
 *
 * Distinct from Emergencies only (7500/7600/7700) and Identified only
 * (callsign/registration). Selected/tracked exemption lives on the layer
 * AND gate, not here. Persistence is local (`meridian.flightHideNoSquawk`)
 * and rides LayerStateCoordinator restore via the flights layer params.
 * It is not written into the share URL.
 */

export const HIDE_NO_SQUAWK_DEFAULT = false;
export const HIDE_NO_SQUAWK_CHIP_ID = 'hide-no-squawk';
export const HIDE_NO_SQUAWK_CHIP_LABEL = 'Hide no squawk';
export const HIDE_NO_SQUAWK_CHIP_TITLE =
  'Hide contacts that never publish a squawk.';
export const HIDE_NO_SQUAWK_STORAGE_KEY = 'meridian.flightHideNoSquawk';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trimmed squawk text. Missing, null, empty, and whitespace-only become ''.
 * @param {unknown} value
 * @returns {string}
 */
export function squawkFieldText(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

/**
 * Whether one in-memory contact already carries a published squawk.
 * Missing/empty/whitespace rows fail.
 * @param {{squawk?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasSquawk(contact) {
  return squawkFieldText(contact?.squawk) !== '';
}

/**
 * Whether Hide no squawk allows this contact to draw.
 * Off is a pass-through. On requires a non-empty squawk after trim.
 * @param {{squawk?: unknown, hideNoSquawk?: boolean}} [input]
 * @returns {boolean}
 */
export function passesHideNoSquawkFilter({
  squawk,
  hideNoSquawk = HIDE_NO_SQUAWK_DEFAULT,
} = {}) {
  if (hideNoSquawk !== true) return true;
  return contactHasSquawk({ squawk });
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeHideNoSquawk(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return HIDE_NO_SQUAWK_DEFAULT;
}

/**
 * Read the durable Hide no squawk preference. Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readHideNoSquawkEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(HIDE_NO_SQUAWK_STORAGE_KEY);
    if (raw == null) return HIDE_NO_SQUAWK_DEFAULT;
    return normalizeHideNoSquawk(raw);
  } catch {
    return HIDE_NO_SQUAWK_DEFAULT;
  }
}

/**
 * Persist the Hide no squawk preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeHideNoSquawkEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(HIDE_NO_SQUAWK_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = HIDE_NO_SQUAWK_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getHideNoSquawkEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setHideNoSquawkEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeHideNoSquawk(enabled);
  currentEnabled = next;
  if (persist) writeHideNoSquawkEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateHideNoSquawkEnabled(storage) {
  return setHideNoSquawkEnabled(readHideNoSquawkEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeHideNoSquawkEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetHideNoSquawkForTest() {
  currentEnabled = HIDE_NO_SQUAWK_DEFAULT;
}

/** Layer-row chip for the civil flights Hide no squawk toggle. */
export function hideNoSquawkChipModel(active = HIDE_NO_SQUAWK_DEFAULT) {
  const on = active === true;
  return {
    id: HIDE_NO_SQUAWK_CHIP_ID,
    label: HIDE_NO_SQUAWK_CHIP_LABEL,
    active: on,
    title: HIDE_NO_SQUAWK_CHIP_TITLE,
    params: { hideNoSquawk: !on },
  };
}
