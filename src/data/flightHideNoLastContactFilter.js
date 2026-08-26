/**
 * @module flightHideNoLastContactFilter
 * @description Client-only Hide no last contact toggle for already-fetched
 * flight contacts. Uses the current `lastContactEpochMs` field (written by
 * each adsb.lol poll from state[4] `last_contact` × 1000 onto the
 * in-memory contact) — no extra fetch and no new endpoint.
 *
 * Off is a pass-through (current draw stays, including missing / non-finite
 * last contact). On hides contacts whose `lastContactEpochMs` is not finite.
 * A finite epoch stays. Missing, null, and non-finite fail closed when on.
 *
 * Distinct from the Plan 93 altitude-band chips, Hide no type (214), Hide no
 * reg (222), Hide no callsign (227), Hide no heading (234), Hide no country
 * (244), Hide no speed (255), Hide no geo altitude (261), Hide no vertical
 * rate (268), Hide no baro altitude (274), hide-no-squawk, and
 * airborne-only / hide-ground (already shipped — this is not hide-ground).
 * This is a leftover presence filter, not a band chip.
 * Selected/tracked exemption lives on the layer AND gate, not here.
 * Persistence is local (`meridian.flightHideNoLastContact`) and rides
 * LayerStateCoordinator restore via the flights layer params. It is
 * not written into the share URL.
 */

export const HIDE_NO_LAST_CONTACT_DEFAULT = false;
export const HIDE_NO_LAST_CONTACT_CHIP_ID = 'hide-no-last-contact';
export const HIDE_NO_LAST_CONTACT_CHIP_LABEL = 'Hide no last contact';
export const HIDE_NO_LAST_CONTACT_CHIP_TITLE =
  'Hide contacts that have no last contact.';
export const HIDE_NO_LAST_CONTACT_STORAGE_KEY = 'meridian.flightHideNoLastContact';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Finite last-contact epoch in milliseconds, or null when missing / non-finite.
 * 0 is a real Unix-epoch timestamp and stays finite. Missing, null,
 * undefined, and NaN become null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function lastContactEpochMsField(value) {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Whether one in-memory contact already carries a finite lastContactEpochMs.
 * Missing/null/undefined/NaN rows fail. A finite epoch succeeds.
 * @param {{lastContactEpochMs?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasLastContact(contact) {
  return lastContactEpochMsField(contact?.lastContactEpochMs) != null;
}

/**
 * Whether Hide no last contact allows this contact to draw.
 * Off is a pass-through. On requires a finite lastContactEpochMs.
 * @param {{lastContactEpochMs?: unknown, hideNoLastContact?: boolean}} [input]
 * @returns {boolean}
 */
export function passesHideNoLastContactFilter({
  lastContactEpochMs,
  hideNoLastContact = HIDE_NO_LAST_CONTACT_DEFAULT,
} = {}) {
  if (hideNoLastContact !== true) return true;
  return contactHasLastContact({ lastContactEpochMs });
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeHideNoLastContact(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return HIDE_NO_LAST_CONTACT_DEFAULT;
}

/**
 * Read the durable Hide no last contact preference. Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readHideNoLastContactEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(HIDE_NO_LAST_CONTACT_STORAGE_KEY);
    if (raw == null) return HIDE_NO_LAST_CONTACT_DEFAULT;
    return normalizeHideNoLastContact(raw);
  } catch {
    return HIDE_NO_LAST_CONTACT_DEFAULT;
  }
}

/**
 * Persist the Hide no last contact preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeHideNoLastContactEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(HIDE_NO_LAST_CONTACT_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = HIDE_NO_LAST_CONTACT_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getHideNoLastContactEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setHideNoLastContactEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeHideNoLastContact(enabled);
  currentEnabled = next;
  if (persist) writeHideNoLastContactEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateHideNoLastContactEnabled(storage) {
  return setHideNoLastContactEnabled(readHideNoLastContactEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeHideNoLastContactEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetHideNoLastContactForTest() {
  currentEnabled = HIDE_NO_LAST_CONTACT_DEFAULT;
}

/** Layer-row chip for the civil flights Hide no last contact toggle. */
export function hideNoLastContactChipModel(active = HIDE_NO_LAST_CONTACT_DEFAULT) {
  const on = active === true;
  return {
    id: HIDE_NO_LAST_CONTACT_CHIP_ID,
    label: HIDE_NO_LAST_CONTACT_CHIP_LABEL,
    active: on,
    title: HIDE_NO_LAST_CONTACT_CHIP_TITLE,
    params: { hideNoLastContact: !on },
  };
}
