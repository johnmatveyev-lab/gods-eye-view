/**
 * @module flightHideNoPositionTimeFilter
 * @description Client-only Hide no position time toggle for already-fetched
 * flight contacts. Uses the current `positionEpochMs` field (written by
 * each adsb.lol poll from state[3] `time_position` × 1000 onto the
 * in-memory contact) — no extra fetch and no new endpoint.
 *
 * Off is a pass-through (current draw stays, including missing / non-finite
 * / ≤0 position time). On hides contacts whose `positionEpochMs` is missing,
 * non-finite, or ≤0. A finite epoch > 0 stays. Missing, null, non-finite,
 * and ≤0 fail closed when on — not the heading / speed / baro "0 stays"
 * rule. Distinct from Hide no last contact (280), which keeps a finite
 * `lastContactEpochMs` including Unix-epoch 0.
 *
 * Distinct from the Plan 93 altitude-band chips, Hide no type (214), Hide no
 * reg (222), Hide no callsign (227), Hide no heading (234), Hide no country
 * (244), Hide no speed (255), Hide no geo altitude (261), Hide no vertical
 * rate (268), Hide no baro altitude (274), Hide no last contact (280),
 * Hide no category (284), hide-no-squawk, and
 * airborne-only / hide-ground (already shipped — this is not hide-ground).
 * This is a leftover presence filter, not a band chip.
 * Selected/tracked exemption lives on the layer AND gate, not here.
 * Persistence is local (`meridian.flightHideNoPositionTime`) and rides
 * LayerStateCoordinator restore via the flights layer params. It is
 * not written into the share URL.
 */

export const HIDE_NO_POSITION_TIME_DEFAULT = false;
export const HIDE_NO_POSITION_TIME_CHIP_ID = 'hide-no-position-time';
export const HIDE_NO_POSITION_TIME_CHIP_LABEL = 'Hide no position time';
export const HIDE_NO_POSITION_TIME_CHIP_TITLE =
  'Hide contacts that have no position time.';
export const HIDE_NO_POSITION_TIME_STORAGE_KEY = 'meridian.flightHideNoPositionTime';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Finite position epoch in milliseconds, or null when missing / non-finite / ≤0.
 * 0 and negatives are sentinels (the poll already treats time_position ≤0 as
 * missing) and become null — not the heading/speed/baro "0 stays" rule.
 * Missing, null, undefined, and NaN become null.
 * @param {unknown} value
 * @returns {number|null}
 */
export function positionEpochMsField(value) {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

/**
 * Whether one in-memory contact already carries a finite positionEpochMs > 0.
 * Missing/null/undefined/NaN/≤0 rows fail. A finite epoch > 0 succeeds.
 * @param {{positionEpochMs?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasPositionTime(contact) {
  return positionEpochMsField(contact?.positionEpochMs) != null;
}

/**
 * Whether Hide no position time allows this contact to draw.
 * Off is a pass-through. On requires a finite positionEpochMs > 0.
 * @param {{positionEpochMs?: unknown, hideNoPositionTime?: boolean}} [input]
 * @returns {boolean}
 */
export function passesHideNoPositionTimeFilter({
  positionEpochMs,
  hideNoPositionTime = HIDE_NO_POSITION_TIME_DEFAULT,
} = {}) {
  if (hideNoPositionTime !== true) return true;
  return contactHasPositionTime({ positionEpochMs });
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeHideNoPositionTime(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return HIDE_NO_POSITION_TIME_DEFAULT;
}

/**
 * Read the durable Hide no position time preference. Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readHideNoPositionTimeEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(HIDE_NO_POSITION_TIME_STORAGE_KEY);
    if (raw == null) return HIDE_NO_POSITION_TIME_DEFAULT;
    return normalizeHideNoPositionTime(raw);
  } catch {
    return HIDE_NO_POSITION_TIME_DEFAULT;
  }
}

/**
 * Persist the Hide no position time preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeHideNoPositionTimeEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(HIDE_NO_POSITION_TIME_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = HIDE_NO_POSITION_TIME_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getHideNoPositionTimeEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setHideNoPositionTimeEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeHideNoPositionTime(enabled);
  currentEnabled = next;
  if (persist) writeHideNoPositionTimeEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateHideNoPositionTimeEnabled(storage) {
  return setHideNoPositionTimeEnabled(readHideNoPositionTimeEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeHideNoPositionTimeEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetHideNoPositionTimeForTest() {
  currentEnabled = HIDE_NO_POSITION_TIME_DEFAULT;
}

/** Layer-row chip for the civil flights Hide no position time toggle. */
export function hideNoPositionTimeChipModel(active = HIDE_NO_POSITION_TIME_DEFAULT) {
  const on = active === true;
  return {
    id: HIDE_NO_POSITION_TIME_CHIP_ID,
    label: HIDE_NO_POSITION_TIME_CHIP_LABEL,
    active: on,
    title: HIDE_NO_POSITION_TIME_CHIP_TITLE,
    params: { hideNoPositionTime: !on },
  };
}
