/**
 * @module emergencySquawk
 * @description Client-side paint for public ADS-B squawk 7500 / 7600 / 7700.
 *
 * Uses the current payload field only (adsb.lol `squawk` / flights
 * state-vector field 14). This is not an alert service and does not verify
 * an emergency. It does not invent events or headlines, and it does not
 * add a network route.
 *
 * Altitude-band visibility still wins: an out-of-band contact stays hidden
 * and is not specially painted, even when the current squawk is 7500/7600/7700.
 * Watchlist remains a separate manual-ident filter.
 *
 * Highlight color is the existing annotation "red = alert" token.
 */

export const EMERGENCY_SQUAWKS = Object.freeze(['7500', '7600', '7700']);

/** Existing annotation alert red (`src/annotations/*` color token `red`). */
export const EMERGENCY_HIGHLIGHT_CSS = '#ff6b6b';

export const EMERGENCY_HIGHLIGHT_STORAGE_KEY = 'meridian.emergencyHighlight';
export const EMERGENCY_HIGHLIGHT_DEFAULT = true;

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Normalize a public squawk from the current payload.
 * Accepts 7700, "7700", "7700 ". Anything else is not a squawk.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeSquawk(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (/^\d{4}$/.test(text)) return text;
  const asNumber = Number(value);
  if (Number.isInteger(asNumber) && asNumber >= 0 && asNumber <= 7777) {
    return String(asNumber).padStart(4, '0');
  }
  return null;
}

/**
 * Whether the current payload squawk is one of the three public emergency codes.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isEmergencySquawk(value) {
  const squawk = normalizeSquawk(value);
  return squawk !== null && EMERGENCY_SQUAWKS.includes(squawk);
}

/**
 * Whether this contact should receive the emergency highlight.
 * Altitude-band visibility still hides out-of-band contacts even when
 * the squawk is 7500/7600/7700.
 * @param {{squawk?: unknown, highlightEnabled?: boolean, inAltitudeBand?: boolean}} [input]
 * @returns {boolean}
 */
export function shouldPaintEmergencyHighlight({
  squawk,
  highlightEnabled = EMERGENCY_HIGHLIGHT_DEFAULT,
  inAltitudeBand = true,
} = {}) {
  if (inAltitudeBand === false) return false;
  if (highlightEnabled === false) return false;
  return isEmergencySquawk(squawk);
}

/**
 * Paint decision for one current-payload contact.
 * @param {{squawk?: unknown, highlightEnabled?: boolean, inAltitudeBand?: boolean}} [input]
 * @returns {{visible: boolean, highlighted: boolean, cssColor: string|null}}
 */
export function emergencyHighlightPaint({
  squawk,
  highlightEnabled = EMERGENCY_HIGHLIGHT_DEFAULT,
  inAltitudeBand = true,
} = {}) {
  const visible = inAltitudeBand !== false;
  const highlighted = shouldPaintEmergencyHighlight({
    squawk,
    highlightEnabled,
    inAltitudeBand,
  });
  return {
    visible,
    highlighted,
    cssColor: highlighted ? EMERGENCY_HIGHLIGHT_CSS : null,
  };
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit off is off;
 * missing or corrupt values keep the product default ON.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeEmergencyHighlightEnabled(value) {
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return EMERGENCY_HIGHLIGHT_DEFAULT;
}

/**
 * Read the durable Emergency highlight preference. Storage failures fail open to ON.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readEmergencyHighlightEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(EMERGENCY_HIGHLIGHT_STORAGE_KEY);
    if (raw == null) return EMERGENCY_HIGHLIGHT_DEFAULT;
    return normalizeEmergencyHighlightEnabled(raw);
  } catch {
    return EMERGENCY_HIGHLIGHT_DEFAULT;
  }
}

/**
 * Persist the Emergency highlight preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeEmergencyHighlightEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(EMERGENCY_HIGHLIGHT_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = EMERGENCY_HIGHLIGHT_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getEmergencyHighlightEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setEmergencyHighlightEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeEmergencyHighlightEnabled(enabled);
  currentEnabled = next;
  if (persist) writeEmergencyHighlightEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateEmergencyHighlightEnabled(storage) {
  return setEmergencyHighlightEnabled(readEmergencyHighlightEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeEmergencyHighlightEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default ON preference without clearing subscribers. */
export function resetEmergencyHighlightForTest() {
  currentEnabled = EMERGENCY_HIGHLIGHT_DEFAULT;
  for (const listener of listeners) listener(currentEnabled);
}
