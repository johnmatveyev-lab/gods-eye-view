/**
 * @module flightHideNoCategoryFilter
 * @description Client-only Hide no category toggle for already-fetched
 * flight contacts. Uses the current `category` field (written by each
 * adsb.lol poll from state[17] emitter category onto the in-memory
 * contact) — no extra fetch and no new endpoint.
 *
 * Off is a pass-through (current draw stays, including missing / non-finite
 * / 0 category). On hides contacts whose `category` is missing, non-finite,
 * or 0 (ADS-B "no information", ~94% of the fleet). A real emitter category
 * stays: extended-states integers 2–18, and string A1–B1 when present.
 * Category 0 is no-information and hides when on — not the heading / speed
 * / baro "0 stays" rule.
 *
 * Distinct from the Plan 93 altitude-band chips, Hide no type (214), Hide no
 * reg (222), Hide no callsign (227), Hide no heading (234), Hide no country
 * (244), Hide no speed (255), Hide no geo altitude (261), Hide no vertical
 * rate (268), Hide no baro altitude (274), Hide no last contact (280),
 * hide-no-squawk, class chips / aircraftClass.js, and
 * airborne-only / hide-ground (already shipped — this is not hide-ground).
 * This is a leftover presence filter, not a band chip.
 * Selected/tracked exemption lives on the layer AND gate, not here.
 * Persistence is local (`meridian.flightHideNoCategory`) and rides
 * LayerStateCoordinator restore via the flights layer params. It is
 * not written into the share URL.
 */

export const HIDE_NO_CATEGORY_DEFAULT = false;
export const HIDE_NO_CATEGORY_CHIP_ID = 'hide-no-category';
export const HIDE_NO_CATEGORY_CHIP_LABEL = 'Hide no category';
export const HIDE_NO_CATEGORY_CHIP_TITLE =
  'Hide contacts that have no ADS-B emitter category.';
export const HIDE_NO_CATEGORY_STORAGE_KEY = 'meridian.flightHideNoCategory';

/** Extended-states integers that carry a real emitter category. */
const CATEGORY_INT_MIN = 2;
const CATEGORY_INT_MAX = 18;

/** ADS-B emitter-category strings classifyAircraft already accepts (A1..B1). */
const EMITTER_CATEGORY_RE = /^(A[1-7]|B1)$/;

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * A real emitter category, or null when missing / non-finite / 0.
 * Integers 2–18 stay. String A1–B1 (A1–A7, B1) stay. 0 is ADS-B
 * "no information" and becomes null — not the heading/speed/baro
 * "0 stays" rule. Missing, null, undefined, and NaN become null.
 * @param {unknown} value
 * @returns {number|string|null}
 */
export function categoryField(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value === 0) return null;
    if (value >= CATEGORY_INT_MIN && value <= CATEGORY_INT_MAX) return value;
    return null;
  }
  const text = String(value).trim();
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && text !== '') {
    if (numeric === 0) return null;
    if (numeric >= CATEGORY_INT_MIN && numeric <= CATEGORY_INT_MAX) return numeric;
  }
  const emitter = text.toUpperCase();
  return EMITTER_CATEGORY_RE.test(emitter) ? emitter : null;
}

/**
 * Whether one in-memory contact already carries a real emitter category.
 * Missing/null/undefined/NaN/0 rows fail. Integers 2–18 and A1–B1 succeed.
 * @param {{category?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasCategory(contact) {
  return categoryField(contact?.category) != null;
}

/**
 * Whether Hide no category allows this contact to draw.
 * Off is a pass-through. On requires a real emitter category (2–18 or
 * A1–B1). Category 0 hides.
 * @param {{category?: unknown, hideNoCategory?: boolean}} [input]
 * @returns {boolean}
 */
export function passesHideNoCategoryFilter({
  category,
  hideNoCategory = HIDE_NO_CATEGORY_DEFAULT,
} = {}) {
  if (hideNoCategory !== true) return true;
  return contactHasCategory({ category });
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeHideNoCategory(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return HIDE_NO_CATEGORY_DEFAULT;
}

/**
 * Read the durable Hide no category preference. Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readHideNoCategoryEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(HIDE_NO_CATEGORY_STORAGE_KEY);
    if (raw == null) return HIDE_NO_CATEGORY_DEFAULT;
    return normalizeHideNoCategory(raw);
  } catch {
    return HIDE_NO_CATEGORY_DEFAULT;
  }
}

/**
 * Persist the Hide no category preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeHideNoCategoryEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(HIDE_NO_CATEGORY_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = HIDE_NO_CATEGORY_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getHideNoCategoryEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setHideNoCategoryEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeHideNoCategory(enabled);
  currentEnabled = next;
  if (persist) writeHideNoCategoryEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateHideNoCategoryEnabled(storage) {
  return setHideNoCategoryEnabled(readHideNoCategoryEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeHideNoCategoryEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetHideNoCategoryForTest() {
  currentEnabled = HIDE_NO_CATEGORY_DEFAULT;
}

/** Layer-row chip for the civil flights Hide no category toggle. */
export function hideNoCategoryChipModel(active = HIDE_NO_CATEGORY_DEFAULT) {
  const on = active === true;
  return {
    id: HIDE_NO_CATEGORY_CHIP_ID,
    label: HIDE_NO_CATEGORY_CHIP_LABEL,
    active: on,
    title: HIDE_NO_CATEGORY_CHIP_TITLE,
    params: { hideNoCategory: !on },
  };
}
