/**
 * @module launchWebcastFilter
 * @description Client-side Webcast only toggle for the existing Space Missions
 * roster and globe markers. Filters already-normalized `webcastLive` on the
 * in-memory 30-day Launch Library 2 roster. Persistence is local only
 * (`meridian.launchWebcastOnly`). No /api and no new LL2 query.
 */

export const LAUNCH_WEBCAST_ONLY_STORAGE_KEY = 'meridian.launchWebcastOnly';
export const LAUNCH_WEBCAST_ONLY_CHIP_LABEL = 'Webcast only';
export const DEFAULT_LAUNCH_WEBCAST_ONLY = false;

let sessionWebcastOnly = DEFAULT_LAUNCH_WEBCAST_ONLY;
const listeners = new Set();

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function nonEmptyVidUrls(launch) {
  const urls = launch?.vid_urls ?? launch?.vidURLs;
  return Array.isArray(urls) && urls.length > 0;
}

/**
 * LL2 2.3.0 ships `webcast_live` plus `vid_urls` (renamed from `vidURLs`).
 * A mission has a webcast when the live flag is strictly true or either
 * video-URL list is a non-empty array.
 * @param {object|null|undefined} launch Raw LL2 row or normalized launch.
 * @returns {boolean}
 */
export function launchWebcastLiveFromPayload(launch) {
  if (!launch || typeof launch !== 'object') return false;
  if (launch.webcastLive === true || launch.webcast_live === true) return true;
  return nonEmptyVidUrls(launch);
}

/**
 * Canonical on/off. Invalid input becomes the off default.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeLaunchWebcastOnly(value) {
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 'on') {
    return true;
  }
  return DEFAULT_LAUNCH_WEBCAST_ONLY;
}

/**
 * Keep a launch when the toggle is off, or when `webcastLive === true`.
 * Missing or false hide while the toggle is on. Selected mission stays.
 * @param {{id?: string, webcastLive?: unknown}|null|undefined} launch
 * @param {unknown} webcastOnly
 * @param {string|null} [selectedLaunchId]
 * @returns {boolean}
 */
export function launchPassesWebcastFilter(launch, webcastOnly, selectedLaunchId = null) {
  if (selectedLaunchId && launch?.id === selectedLaunchId) return true;
  if (normalizeLaunchWebcastOnly(webcastOnly) !== true) return true;
  return launchWebcastLiveFromPayload(launch);
}

/**
 * @param {Array<{id?: string, webcastLive?: unknown}>|null|undefined} launches
 * @param {unknown} webcastOnly
 * @param {string|null} [selectedLaunchId]
 * @returns {Array}
 */
export function filterLaunchesByWebcast(launches, webcastOnly, selectedLaunchId = null) {
  const list = Array.isArray(launches) ? launches : [];
  return list.filter((launch) => launchPassesWebcastFilter(launch, webcastOnly, selectedLaunchId));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readLaunchWebcastOnly(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(LAUNCH_WEBCAST_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_WEBCAST_ONLY;
    return normalizeLaunchWebcastOnly(raw);
  } catch {
    return DEFAULT_LAUNCH_WEBCAST_ONLY;
  }
}

/**
 * @param {unknown} webcastOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchWebcastOnly(webcastOnly, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      LAUNCH_WEBCAST_ONLY_STORAGE_KEY,
      normalizeLaunchWebcastOnly(webcastOnly) ? '1' : '0',
    );
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getLaunchWebcastOnly() {
  return sessionWebcastOnly;
}

/**
 * @param {unknown} webcastOnly
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setLaunchWebcastOnly(webcastOnly, { persist = true, storage } = {}) {
  const next = normalizeLaunchWebcastOnly(webcastOnly);
  sessionWebcastOnly = next;
  if (persist) writeLaunchWebcastOnly(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateLaunchWebcastOnly(storage) {
  return setLaunchWebcastOnly(readLaunchWebcastOnly(storage), { persist: false, storage });
}

/**
 * @param {(webcastOnly: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeLaunchWebcastOnly(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetLaunchWebcastOnlyForTest() {
  sessionWebcastOnly = DEFAULT_LAUNCH_WEBCAST_ONLY;
}
