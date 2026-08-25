/**
 * @module clockPreference
 * @description Display-only UTC | Local clock for HUD/chrome time.
 *
 * Production default stays UTC (trailing Z). Local uses the browser timezone
 * and drops Z. Preference lives in localStorage `meridian.clock` and is never
 * written into share URLs.
 */

export const CLOCK_STORAGE_KEY = 'meridian.clock';
export const DEFAULT_CLOCK_MODE = 'utc';
export const CLOCK_CHANGE_EVENT = 'meridian:clock';

/** @type {'utc'|'local'|null} */
let cachedMode = null;

/** Clear the in-memory preference so the next read hits storage (reload / tests). */
export function resetClockPreferenceCache() {
  cachedMode = null;
}

/**
 * @param {unknown} value
 * @returns {'utc'|'local'}
 */
export function normalizeClockMode(value) {
  return String(value || '').toLowerCase() === 'local' ? 'local' : 'utc';
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {'utc'|'local'}
 */
export function readClockPreference(storage) {
  try {
    return normalizeClockMode(storage?.getItem?.(CLOCK_STORAGE_KEY));
  } catch {
    return DEFAULT_CLOCK_MODE;
  }
}

/**
 * @param {unknown} mode
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {'utc'|'local'}
 */
export function writeClockPreference(mode, storage) {
  const normalized = normalizeClockMode(mode);
  try {
    storage?.setItem?.(CLOCK_STORAGE_KEY, normalized);
  } catch {
    // Fail open: the session can still display the chosen mode.
  }
  return normalized;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {'utc'|'local'}
 */
export function getClockMode(storage = globalThis.localStorage) {
  if (cachedMode) return cachedMode;
  cachedMode = readClockPreference(storage);
  return cachedMode;
}

/**
 * @param {unknown} mode
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {'utc'|'local'}
 */
export function setClockMode(mode, storage = globalThis.localStorage) {
  cachedMode = writeClockPreference(mode, storage);
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent(CLOCK_CHANGE_EVENT, { detail: { mode: cachedMode } }));
  }
  return cachedMode;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * @param {Date} date
 * @param {'utc'|'local'|string} mode
 */
function clockParts(date, mode) {
  const when = date instanceof Date ? date : new Date(date);
  if (normalizeClockMode(mode) === 'local') {
    return {
      y: when.getFullYear(),
      mo: pad2(when.getMonth() + 1),
      d: pad2(when.getDate()),
      h: pad2(when.getHours()),
      mi: pad2(when.getMinutes()),
      s: pad2(when.getSeconds()),
      zone: '',
    };
  }
  return {
    y: when.getUTCFullYear(),
    mo: pad2(when.getUTCMonth() + 1),
    d: pad2(when.getUTCDate()),
    h: pad2(when.getUTCHours()),
    mi: pad2(when.getUTCMinutes()),
    s: pad2(when.getUTCSeconds()),
    zone: 'Z',
  };
}

/** Cockpit chrome clock: `HH:MM:SSZ` or local `HH:MM:SS`. */
export function formatChromeClock(date, mode) {
  const parts = clockParts(date, mode);
  return `${parts.h}:${parts.mi}:${parts.s}${parts.zone}`;
}

/** Intel HUD clock: `YYYY-MM-DD HH:MM:SSZ` or the local equivalent without Z. */
export function formatHudClock(date, mode) {
  const parts = clockParts(date, mode);
  return `${parts.y}-${parts.mo}-${parts.d} ${parts.h}:${parts.mi}:${parts.s}${parts.zone}`;
}

/**
 * @param {{querySelectorAll?: Function}|null|undefined} root
 * @param {unknown} mode
 */
export function syncClockToggleButtons(root, mode) {
  const normalized = normalizeClockMode(mode);
  const buttons = root?.querySelectorAll?.('[data-clock-mode]') ?? [];
  for (const button of buttons) {
    button.setAttribute('aria-pressed', button.dataset.clockMode === normalized ? 'true' : 'false');
  }
}

/**
 * @param {{addEventListener?: Function, removeEventListener?: Function, contains?: Function, querySelectorAll?: Function}|null|undefined} root
 * @param {{storage?: object, onChange?: Function}} [options]
 * @returns {() => void}
 */
export function bindClockToggle(root, { storage, onChange } = {}) {
  if (!root?.addEventListener) return () => {};
  syncClockToggleButtons(root, getClockMode(storage));
  const handler = (event) => {
    const button = event.target?.closest?.('[data-clock-mode]');
    if (!button || (typeof root.contains === 'function' && !root.contains(button))) return;
    const mode = setClockMode(button.dataset.clockMode, storage);
    syncClockToggleButtons(root, mode);
    onChange?.(mode);
  };
  root.addEventListener('click', handler);
  return () => root.removeEventListener?.('click', handler);
}
