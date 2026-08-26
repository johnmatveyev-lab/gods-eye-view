/**
 * @module flightHideNoVerticalRateFilter
 * @description Client-only Hide no vertical rate toggle for already-fetched
 * flight contacts. Uses the current `meta.verticalRate` / `verticalRateMps`
 * field (written by each adsb.lol poll from the state-vector baro rate onto
 * the in-memory contact) — no extra fetch and no new endpoint.
 *
 * Off is a pass-through (current draw stays, including null / missing /
 * non-finite verticalRate). On hides contacts whose `verticalRate` /
 * `verticalRateMps` is not finite. 0 is a real level flight and stays.
 * ±5 m/s stays. Missing, null, and non-finite fail closed when on.
 *
 * Distinct from Plan 97 climb / level / descent (that chip fail-opens when
 * the rate is missing), Hide no geo altitude (Plan 261, `geoAltitudeM`),
 * Hide no speed (Plan 255, `velocity`), and airborne-only / hide-ground
 * (Plan 95). This is presence-only, not a climb/descent chip.
 * Selected/tracked exemption lives on the layer AND gate, not here.
 * Persistence is local (`meridian.flightHideNoVerticalRate`) and rides
 * LayerStateCoordinator restore via the flights layer params. It is
 * not written into the share URL.
 */

export const HIDE_NO_VERTICAL_RATE_DEFAULT = false;
export const HIDE_NO_VERTICAL_RATE_CHIP_ID = 'hide-no-vertical-rate';
export const HIDE_NO_VERTICAL_RATE_CHIP_LABEL = 'Hide no vertical rate';
export const HIDE_NO_VERTICAL_RATE_CHIP_TITLE =
  'Hide contacts that have no vertical rate.';
export const HIDE_NO_VERTICAL_RATE_STORAGE_KEY = 'meridian.flightHideNoVerticalRate';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Finite vertical rate in m/s, or null when missing / non-finite.
 * 0 is a real level flight and stays finite. Missing, null, undefined,
 * and NaN become null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function verticalRateFieldMps(value) {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Whether one in-memory contact already carries a finite verticalRate
 * or verticalRateMps. Missing/null/undefined/NaN rows fail. 0 (level)
 * succeeds.
 * @param {{verticalRate?: unknown, verticalRateMps?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasVerticalRate(contact) {
  return verticalRateFieldMps(contact?.verticalRate) != null
    || verticalRateFieldMps(contact?.verticalRateMps) != null;
}

/**
 * Whether Hide no vertical rate allows this contact to draw.
 * Off is a pass-through. On requires a finite verticalRate /
 * verticalRateMps (0 stays).
 * @param {{verticalRate?: unknown, verticalRateMps?: unknown, hideNoVerticalRate?: boolean}} [input]
 * @returns {boolean}
 */
export function passesHideNoVerticalRateFilter({
  verticalRate,
  verticalRateMps,
  hideNoVerticalRate = HIDE_NO_VERTICAL_RATE_DEFAULT,
} = {}) {
  if (hideNoVerticalRate !== true) return true;
  return contactHasVerticalRate({ verticalRate, verticalRateMps });
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeHideNoVerticalRate(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return HIDE_NO_VERTICAL_RATE_DEFAULT;
}

/**
 * Read the durable Hide no vertical rate preference. Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readHideNoVerticalRateEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(HIDE_NO_VERTICAL_RATE_STORAGE_KEY);
    if (raw == null) return HIDE_NO_VERTICAL_RATE_DEFAULT;
    return normalizeHideNoVerticalRate(raw);
  } catch {
    return HIDE_NO_VERTICAL_RATE_DEFAULT;
  }
}

/**
 * Persist the Hide no vertical rate preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeHideNoVerticalRateEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(HIDE_NO_VERTICAL_RATE_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = HIDE_NO_VERTICAL_RATE_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getHideNoVerticalRateEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setHideNoVerticalRateEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeHideNoVerticalRate(enabled);
  currentEnabled = next;
  if (persist) writeHideNoVerticalRateEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateHideNoVerticalRateEnabled(storage) {
  return setHideNoVerticalRateEnabled(readHideNoVerticalRateEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeHideNoVerticalRateEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetHideNoVerticalRateForTest() {
  currentEnabled = HIDE_NO_VERTICAL_RATE_DEFAULT;
}

/** Layer-row chip for the civil flights Hide no vertical rate toggle. */
export function hideNoVerticalRateChipModel(active = HIDE_NO_VERTICAL_RATE_DEFAULT) {
  const on = active === true;
  return {
    id: HIDE_NO_VERTICAL_RATE_CHIP_ID,
    label: HIDE_NO_VERTICAL_RATE_CHIP_LABEL,
    active: on,
    title: HIDE_NO_VERTICAL_RATE_CHIP_TITLE,
    params: { hideNoVerticalRate: !on },
  };
}
