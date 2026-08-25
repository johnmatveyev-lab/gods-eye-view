/**
 * @module launchUnknownSiteFilter
 * @description Client-side Hide unknown site toggle for the existing Space
 * Missions roster and globe markers. Filters already-normalized `launchSite`
 * on the in-memory 30-day Launch Library 2 roster. Persistence is local only
 * (`meridian.launchHideUnknownSite`). No /api and no new LL2 query.
 */

export const LAUNCH_HIDE_UNKNOWN_SITE_STORAGE_KEY = 'meridian.launchHideUnknownSite';
export const LAUNCH_HIDE_UNKNOWN_SITE_CHIP_LABEL = 'Hide unknown site';
export const UNKNOWN_LAUNCH_SITE_LABEL = 'Unknown launch site';
export const DEFAULT_LAUNCH_HIDE_UNKNOWN_SITE = false;

let sessionHideUnknownSite = DEFAULT_LAUNCH_HIDE_UNKNOWN_SITE;
const listeners = new Set();

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Canonical on/off. Invalid input becomes the off default.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeLaunchHideUnknownSite(value) {
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 'on') {
    return true;
  }
  return DEFAULT_LAUNCH_HIDE_UNKNOWN_SITE;
}

/**
 * Unlabeled pad/location: missing, whitespace-only, or the roster fallback
 * `Unknown launch site` (trim first; case-insensitive).
 * @param {unknown} launchSite Normalized string or `{ launchSite }`.
 * @returns {boolean}
 */
export function isUnknownLaunchSite(launchSite) {
  let raw = launchSite;
  if (raw && typeof raw === 'object') {
    raw = raw.launchSite;
  }
  if (raw == null) return true;
  const text = String(raw).replace(/\s+/g, ' ').trim();
  if (!text) return true;
  return text.toLowerCase() === UNKNOWN_LAUNCH_SITE_LABEL.toLowerCase();
}

/**
 * Keep a launch when the toggle is off, or when `launchSite` is a named pad.
 * Missing, whitespace-only, and the fallback label hide while the toggle is
 * on. Selected mission stays.
 * @param {{id?: string, launchSite?: unknown}|null|undefined} launch
 * @param {unknown} hideUnknownSite
 * @param {string|null} [selectedLaunchId]
 * @returns {boolean}
 */
export function launchPassesUnknownSiteFilter(launch, hideUnknownSite, selectedLaunchId = null) {
  if (selectedLaunchId && launch?.id === selectedLaunchId) return true;
  if (normalizeLaunchHideUnknownSite(hideUnknownSite) !== true) return true;
  return !isUnknownLaunchSite(launch?.launchSite);
}

/**
 * @param {Array<{id?: string, launchSite?: unknown}>|null|undefined} launches
 * @param {unknown} hideUnknownSite
 * @param {string|null} [selectedLaunchId]
 * @returns {Array}
 */
export function filterLaunchesByUnknownSite(launches, hideUnknownSite, selectedLaunchId = null) {
  const list = Array.isArray(launches) ? launches : [];
  return list.filter((launch) => (
    launchPassesUnknownSiteFilter(launch, hideUnknownSite, selectedLaunchId)
  ));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readLaunchHideUnknownSite(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(LAUNCH_HIDE_UNKNOWN_SITE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_HIDE_UNKNOWN_SITE;
    return normalizeLaunchHideUnknownSite(raw);
  } catch {
    return DEFAULT_LAUNCH_HIDE_UNKNOWN_SITE;
  }
}

/**
 * @param {unknown} hideUnknownSite
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchHideUnknownSite(hideUnknownSite, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      LAUNCH_HIDE_UNKNOWN_SITE_STORAGE_KEY,
      normalizeLaunchHideUnknownSite(hideUnknownSite) ? '1' : '0',
    );
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getLaunchHideUnknownSite() {
  return sessionHideUnknownSite;
}

/**
 * @param {unknown} hideUnknownSite
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setLaunchHideUnknownSite(hideUnknownSite, { persist = true, storage } = {}) {
  const next = normalizeLaunchHideUnknownSite(hideUnknownSite);
  sessionHideUnknownSite = next;
  if (persist) writeLaunchHideUnknownSite(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateLaunchHideUnknownSite(storage) {
  return setLaunchHideUnknownSite(readLaunchHideUnknownSite(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(hideUnknownSite: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeLaunchHideUnknownSite(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetLaunchHideUnknownSiteForTest() {
  sessionHideUnknownSite = DEFAULT_LAUNCH_HIDE_UNKNOWN_SITE;
}
