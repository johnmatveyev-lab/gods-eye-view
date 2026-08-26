/**
 * @module flightHideNoTypeNameFilter
 * @description Client-only Hide no type name toggle for already-fetched
 * flight contacts. Uses the current `typeName` field (written by adsbdb
 * onto the in-memory contact — labels, context, Easter-egg line) — no
 * extra fetch and no new endpoint.
 *
 * Off is a pass-through (current draw stays, including missing / null /
 * empty / whitespace typeName). On hides contacts whose typeName is
 * missing, null, empty, or whitespace-only after trim. A published name
 * such as "Boeing 737-800" stays. After QA 50, typeCode often arrives
 * this poll from adsb.lol `t` while typeName stays unpublished until
 * adsbdb returns — typeCode present + typeName missing still hides when
 * this chip is on.
 *
 * Distinct from Hide no type (214 typeCode), Identified only (188),
 * Hide no reg (222), Hide no callsign (227), Hide no category (284),
 * Hide no position time (294), hide-no-squawk, class chips, and
 * airborne-only / hide-ground (already shipped — this is not
 * hide-ground). This is a leftover presence filter on the already-fetched
 * adsbdb type name. Selected/tracked exemption lives on the layer
 * AND gate, not here. Persistence is local
 * (`meridian.flightHideNoTypeName`) and rides LayerStateCoordinator
 * restore via the flights layer params. It is not written into the share URL.
 */

export const HIDE_NO_TYPE_NAME_DEFAULT = false;
export const HIDE_NO_TYPE_NAME_CHIP_ID = 'hide-no-type-name';
export const HIDE_NO_TYPE_NAME_CHIP_LABEL = 'Hide no type name';
export const HIDE_NO_TYPE_NAME_CHIP_TITLE =
  'Hide contacts that have no aircraft type name.';
export const HIDE_NO_TYPE_NAME_STORAGE_KEY = 'meridian.flightHideNoTypeName';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trimmed typeName text. Missing, null, empty, and whitespace-only become ''.
 * @param {unknown} value
 * @returns {string}
 */
export function typeNameFieldText(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

/**
 * Whether one in-memory contact already carries a published typeName.
 * Missing/empty/whitespace rows fail.
 * @param {{typeName?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasTypeName(contact) {
  return typeNameFieldText(contact?.typeName) !== '';
}

/**
 * Whether Hide no type name allows this contact to draw.
 * Off is a pass-through. On requires a non-empty typeName after trim.
 * @param {{typeName?: unknown, hideNoTypeName?: boolean}} [input]
 * @returns {boolean}
 */
export function passesHideNoTypeNameFilter({
  typeName,
  hideNoTypeName = HIDE_NO_TYPE_NAME_DEFAULT,
} = {}) {
  if (hideNoTypeName !== true) return true;
  return contactHasTypeName({ typeName });
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeHideNoTypeName(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return HIDE_NO_TYPE_NAME_DEFAULT;
}

/**
 * Read the durable Hide no type name preference. Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readHideNoTypeNameEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(HIDE_NO_TYPE_NAME_STORAGE_KEY);
    if (raw == null) return HIDE_NO_TYPE_NAME_DEFAULT;
    return normalizeHideNoTypeName(raw);
  } catch {
    return HIDE_NO_TYPE_NAME_DEFAULT;
  }
}

/**
 * Persist the Hide no type name preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeHideNoTypeNameEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(HIDE_NO_TYPE_NAME_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = HIDE_NO_TYPE_NAME_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getHideNoTypeNameEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setHideNoTypeNameEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeHideNoTypeName(enabled);
  currentEnabled = next;
  if (persist) writeHideNoTypeNameEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateHideNoTypeNameEnabled(storage) {
  return setHideNoTypeNameEnabled(readHideNoTypeNameEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeHideNoTypeNameEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetHideNoTypeNameForTest() {
  currentEnabled = HIDE_NO_TYPE_NAME_DEFAULT;
}

/** Layer-row chip for the civil flights Hide no type name toggle. */
export function hideNoTypeNameChipModel(active = HIDE_NO_TYPE_NAME_DEFAULT) {
  const on = active === true;
  return {
    id: HIDE_NO_TYPE_NAME_CHIP_ID,
    label: HIDE_NO_TYPE_NAME_CHIP_LABEL,
    active: on,
    title: HIDE_NO_TYPE_NAME_CHIP_TITLE,
    params: { hideNoTypeName: !on },
  };
}
