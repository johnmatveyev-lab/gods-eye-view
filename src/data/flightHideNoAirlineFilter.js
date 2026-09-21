/**
 * @module flightHideNoAirlineFilter
 * @description Client-only Hide no airline toggle for already-fetched
 * flight contacts. Uses the current `airline` field (written by adsbdb
 * onto the in-memory contact — labels, context, Easter-egg line) — no
 * extra fetch and no new endpoint.
 *
 * Off is a pass-through (current draw stays, including missing / null /
 * empty / whitespace airline). On hides contacts whose airline is
 * missing, null, empty, or whitespace-only after trim. A published name
 * such as "American Airlines" stays. A contact can carry AAL123 this
 * poll and still have no airline until adsbdb returns — callsign present
 * + airline missing still hides when this chip is on.
 *
 * Distinct from Emergencies only (166 squawk), Identified only (188
 * callsign OR registration), Hide no type (214 typeCode), Hide no reg
 * (222), Hide no callsign (227), Hide no category (284), Hide no
 * position time (294), Hide no type name (299), hide-no-squawk, class
 * chips, and airborne-only / hide-ground (already shipped — this is not
 * hide-ground). This is a leftover presence filter on the already-fetched
 * adsbdb airline. Selected/tracked exemption lives on the layer
 * AND gate, not here. Persistence is local
 * (`meridian.flightHideNoAirline`) and rides LayerStateCoordinator
 * restore via the flights layer params. It is not written into the share URL.
 */

export const HIDE_NO_AIRLINE_DEFAULT = false;
export const HIDE_NO_AIRLINE_CHIP_ID = 'hide-no-airline';
export const HIDE_NO_AIRLINE_CHIP_LABEL = 'Hide no airline';
export const HIDE_NO_AIRLINE_CHIP_TITLE =
  'Hide contacts that have no airline.';
export const HIDE_NO_AIRLINE_STORAGE_KEY = 'meridian.flightHideNoAirline';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trimmed airline text. Missing, null, empty, and whitespace-only become ''.
 * @param {unknown} value
 * @returns {string}
 */
export function airlineFieldText(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

/**
 * Whether one in-memory contact already carries a published airline.
 * Missing/empty/whitespace rows fail.
 * @param {{airline?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasAirline(contact) {
  return airlineFieldText(contact?.airline) !== '';
}

/**
 * Whether Hide no airline allows this contact to draw.
 * Off is a pass-through. On requires a non-empty airline after trim.
 * @param {{airline?: unknown, hideNoAirline?: boolean}} [input]
 * @returns {boolean}
 */
export function passesHideNoAirlineFilter({
  airline,
  hideNoAirline = HIDE_NO_AIRLINE_DEFAULT,
} = {}) {
  if (hideNoAirline !== true) return true;
  return contactHasAirline({ airline });
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeHideNoAirline(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return HIDE_NO_AIRLINE_DEFAULT;
}

/**
 * Read the durable Hide no airline preference. Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readHideNoAirlineEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(HIDE_NO_AIRLINE_STORAGE_KEY);
    if (raw == null) return HIDE_NO_AIRLINE_DEFAULT;
    return normalizeHideNoAirline(raw);
  } catch {
    return HIDE_NO_AIRLINE_DEFAULT;
  }
}

/**
 * Persist the Hide no airline preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeHideNoAirlineEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(HIDE_NO_AIRLINE_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = HIDE_NO_AIRLINE_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getHideNoAirlineEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setHideNoAirlineEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeHideNoAirline(enabled);
  currentEnabled = next;
  if (persist) writeHideNoAirlineEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateHideNoAirlineEnabled(storage) {
  return setHideNoAirlineEnabled(readHideNoAirlineEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeHideNoAirlineEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetHideNoAirlineForTest() {
  currentEnabled = HIDE_NO_AIRLINE_DEFAULT;
}

/** Layer-row chip for the civil flights Hide no airline toggle. */
export function hideNoAirlineChipModel(active = HIDE_NO_AIRLINE_DEFAULT) {
  const on = active === true;
  return {
    id: HIDE_NO_AIRLINE_CHIP_ID,
    label: HIDE_NO_AIRLINE_CHIP_LABEL,
    active: on,
    title: HIDE_NO_AIRLINE_CHIP_TITLE,
    params: { hideNoAirline: !on },
  };
}
