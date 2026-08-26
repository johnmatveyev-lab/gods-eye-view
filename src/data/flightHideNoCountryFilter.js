/**
 * @module flightHideNoCountryFilter
 * @description Client-only Hide no country toggle for already-fetched
 * flight contacts. Uses the current `originCountry` field (written by the
 * ingested state vector onto the in-memory contact) — no extra fetch, no
 * people lookup, no extra adsbdb call, and no new endpoint.
 *
 * Off is a pass-through (current draw stays, including empty / missing
 * originCountry). On fail-opens when originCountry is missing, null,
 * empty, or whitespace-only after trim (QA 49: the commercial adsb.lol
 * adapter always emits null at state index 2, so fail-closed would blank
 * the civil layer — UAL1416 / DAL986 / SWA1412). A published non-empty
 * country such as United States still stays. Never invents a country and
 * never asks the adapter to fabricate state[2].
 *
 * Distinct from Identified only (callsign OR registration), Emergencies
 * only (7500/7600/7700), Hide no squawk, Hide no type, Hide no
 * registration, Hide no callsign, Hide no heading, and Hide no speed.
 * Selected/tracked exemption lives on the layer AND gate, not here.
 * Persistence is local (`meridian.flightHideNoCountry`) and rides
 * LayerStateCoordinator restore via the flights layer params. It is not written into the share URL.
 */

export const HIDE_NO_COUNTRY_DEFAULT = false;
export const HIDE_NO_COUNTRY_CHIP_ID = 'hide-no-country';
export const HIDE_NO_COUNTRY_CHIP_LABEL = 'Hide no country';
export const HIDE_NO_COUNTRY_CHIP_TITLE =
  'Hide contacts that have no country.';
export const HIDE_NO_COUNTRY_STORAGE_KEY = 'meridian.flightHideNoCountry';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trimmed origin-country text. Missing, null, empty, and whitespace-only become ''.
 * @param {unknown} value
 * @returns {string}
 */
export function originCountryFieldText(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

/**
 * Whether one in-memory contact already carries a published originCountry.
 * Missing/empty/whitespace rows fail.
 * @param {{originCountry?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasCountry(contact) {
  return originCountryFieldText(contact?.originCountry) !== '';
}

/**
 * Whether Hide no country allows this contact to draw.
 * Off is a pass-through. On fail-opens when originCountry is missing,
 * null, empty, or whitespace (QA 49). A published non-empty country
 * still stays. Never invents a country.
 * @param {{originCountry?: unknown, hideNoCountry?: boolean}} [input]
 * @returns {boolean}
 */
export function passesHideNoCountryFilter({
  originCountry,
  hideNoCountry = HIDE_NO_COUNTRY_DEFAULT,
} = {}) {
  if (hideNoCountry !== true) return true;
  if (originCountryFieldText(originCountry) === '') return true;
  return true;
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeHideNoCountry(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return HIDE_NO_COUNTRY_DEFAULT;
}

/**
 * Read the durable Hide no country preference. Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readHideNoCountryEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(HIDE_NO_COUNTRY_STORAGE_KEY);
    if (raw == null) return HIDE_NO_COUNTRY_DEFAULT;
    return normalizeHideNoCountry(raw);
  } catch {
    return HIDE_NO_COUNTRY_DEFAULT;
  }
}

/**
 * Persist the Hide no country preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeHideNoCountryEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(HIDE_NO_COUNTRY_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = HIDE_NO_COUNTRY_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getHideNoCountryEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setHideNoCountryEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeHideNoCountry(enabled);
  currentEnabled = next;
  if (persist) writeHideNoCountryEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateHideNoCountryEnabled(storage) {
  return setHideNoCountryEnabled(readHideNoCountryEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeHideNoCountryEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetHideNoCountryForTest() {
  currentEnabled = HIDE_NO_COUNTRY_DEFAULT;
}

/** Layer-row chip for the civil flights Hide no country toggle. */
export function hideNoCountryChipModel(active = HIDE_NO_COUNTRY_DEFAULT) {
  const on = active === true;
  return {
    id: HIDE_NO_COUNTRY_CHIP_ID,
    label: HIDE_NO_COUNTRY_CHIP_LABEL,
    active: on,
    title: HIDE_NO_COUNTRY_CHIP_TITLE,
    params: { hideNoCountry: !on },
  };
}
