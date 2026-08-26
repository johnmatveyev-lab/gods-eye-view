/**
 * @module flightHideNoTypeFilter
 * @description Client-only Hide no type toggle for already-fetched flight
 * contacts. Uses the current `typeCode` field (written by adsbdb onto the
 * in-memory contact) — no extra fetch and no new endpoint.
 *
 * Off is a pass-through (current draw stays). On hides contacts whose
 * typeCode is missing, null, empty, or whitespace-only after trim. A
 * published type such as B738 stays.
 *
 * Distinct from Emergencies only (7500/7600/7700), Identified only
 * (callsign/registration), Hide no squawk, and class chips (klass is still
 * assigned from category when typeCode is missing). Selected/tracked
 * exemption lives on the layer AND gate, not here. Persistence is local
 * (`meridian.flightHideNoType`) and rides LayerStateCoordinator restore
 * via the flights layer params. It is not written into the share URL.
 */

export const HIDE_NO_TYPE_DEFAULT = false;
export const HIDE_NO_TYPE_CHIP_ID = 'hide-no-type';
export const HIDE_NO_TYPE_CHIP_LABEL = 'Hide no type';
export const HIDE_NO_TYPE_CHIP_TITLE =
  'Hide contacts that have no aircraft type code.';
export const HIDE_NO_TYPE_STORAGE_KEY = 'meridian.flightHideNoType';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trimmed typeCode text. Missing, null, empty, and whitespace-only become ''.
 * @param {unknown} value
 * @returns {string}
 */
export function typeCodeFieldText(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

/**
 * Whether one in-memory contact already carries a published typeCode.
 * Missing/empty/whitespace rows fail.
 * @param {{typeCode?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasTypeCode(contact) {
  return typeCodeFieldText(contact?.typeCode) !== '';
}

/**
 * Whether Hide no type allows this contact to draw.
 * Off is a pass-through. On requires a non-empty typeCode after trim.
 * @param {{typeCode?: unknown, hideNoType?: boolean}} [input]
 * @returns {boolean}
 */
export function passesHideNoTypeFilter({
  typeCode,
  hideNoType = HIDE_NO_TYPE_DEFAULT,
} = {}) {
  if (hideNoType !== true) return true;
  return contactHasTypeCode({ typeCode });
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeHideNoType(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return HIDE_NO_TYPE_DEFAULT;
}

/**
 * Read the durable Hide no type preference. Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readHideNoTypeEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(HIDE_NO_TYPE_STORAGE_KEY);
    if (raw == null) return HIDE_NO_TYPE_DEFAULT;
    return normalizeHideNoType(raw);
  } catch {
    return HIDE_NO_TYPE_DEFAULT;
  }
}

/**
 * Persist the Hide no type preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeHideNoTypeEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(HIDE_NO_TYPE_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = HIDE_NO_TYPE_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getHideNoTypeEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setHideNoTypeEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeHideNoType(enabled);
  currentEnabled = next;
  if (persist) writeHideNoTypeEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateHideNoTypeEnabled(storage) {
  return setHideNoTypeEnabled(readHideNoTypeEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeHideNoTypeEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetHideNoTypeForTest() {
  currentEnabled = HIDE_NO_TYPE_DEFAULT;
}

/** Layer-row chip for the civil flights Hide no type toggle. */
export function hideNoTypeChipModel(active = HIDE_NO_TYPE_DEFAULT) {
  const on = active === true;
  return {
    id: HIDE_NO_TYPE_CHIP_ID,
    label: HIDE_NO_TYPE_CHIP_LABEL,
    active: on,
    title: HIDE_NO_TYPE_CHIP_TITLE,
    params: { hideNoType: !on },
  };
}
