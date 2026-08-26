/**
 * @module flightHideNoHeadingFilter
 * @description Client-only Hide no heading toggle for already-fetched
 * flight contacts. Uses the current `true_track` field (written by the
 * adsb.lol poll onto the in-memory contact) — no extra fetch and no new
 * endpoint.
 *
 * Off is a pass-through (current draw stays, including missing + 0 + 270).
 * On hides contacts whose `true_track` is not finite. 0 is a real north
 * heading and stays. Missing, null, and undefined hide when on.
 *
 * Distinct from Plan 101 NESW heading chips (those fail-open on missing)
 * and from airborne-only / hide-ground (Plan 95). Selected/tracked
 * exemption lives on the layer AND gate, not here. Persistence is local
 * (`meridian.flightHideNoHeading`) and rides LayerStateCoordinator restore
 * via the flights layer params. It is not written into the share URL.
 */

export const HIDE_NO_HEADING_DEFAULT = false;
export const HIDE_NO_HEADING_CHIP_ID = 'hide-no-heading';
export const HIDE_NO_HEADING_CHIP_LABEL = 'Hide no heading';
export const HIDE_NO_HEADING_CHIP_TITLE =
  'Hide contacts that have no heading.';
export const HIDE_NO_HEADING_STORAGE_KEY = 'meridian.flightHideNoHeading';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Finite true-track degrees, or null when missing / non-finite.
 * 0 is north and stays finite. Missing, null, undefined, and NaN become null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function headingFieldDegrees(value) {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Whether one in-memory contact already carries a finite true_track.
 * Missing/null/undefined/NaN rows fail. 0 (north) succeeds.
 * @param {{true_track?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasHeading(contact) {
  return headingFieldDegrees(contact?.true_track) != null;
}

/**
 * Whether Hide no heading allows this contact to draw.
 * Off is a pass-through. On requires a finite true_track (0 stays).
 * @param {{true_track?: unknown, hideNoHeading?: boolean}} [input]
 * @returns {boolean}
 */
export function passesHideNoHeadingFilter({
  true_track,
  hideNoHeading = HIDE_NO_HEADING_DEFAULT,
} = {}) {
  if (hideNoHeading !== true) return true;
  return contactHasHeading({ true_track });
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeHideNoHeading(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return HIDE_NO_HEADING_DEFAULT;
}

/**
 * Read the durable Hide no heading preference. Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readHideNoHeadingEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(HIDE_NO_HEADING_STORAGE_KEY);
    if (raw == null) return HIDE_NO_HEADING_DEFAULT;
    return normalizeHideNoHeading(raw);
  } catch {
    return HIDE_NO_HEADING_DEFAULT;
  }
}

/**
 * Persist the Hide no heading preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeHideNoHeadingEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(HIDE_NO_HEADING_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = HIDE_NO_HEADING_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getHideNoHeadingEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setHideNoHeadingEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeHideNoHeading(enabled);
  currentEnabled = next;
  if (persist) writeHideNoHeadingEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateHideNoHeadingEnabled(storage) {
  return setHideNoHeadingEnabled(readHideNoHeadingEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeHideNoHeadingEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetHideNoHeadingForTest() {
  currentEnabled = HIDE_NO_HEADING_DEFAULT;
}

/** Layer-row chip for the civil flights Hide no heading toggle. */
export function hideNoHeadingChipModel(active = HIDE_NO_HEADING_DEFAULT) {
  const on = active === true;
  return {
    id: HIDE_NO_HEADING_CHIP_ID,
    label: HIDE_NO_HEADING_CHIP_LABEL,
    active: on,
    title: HIDE_NO_HEADING_CHIP_TITLE,
    params: { hideNoHeading: !on },
  };
}
