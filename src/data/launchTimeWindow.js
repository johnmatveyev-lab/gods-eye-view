/**
 * @module launchTimeWindow
 * @description Client-side 7d | 30d chips for the existing Space Missions
 * roster and globe markers. Filters already-fetched `launchTime` values
 * inside the hosted Launch Library 2 30-day product window. Persistence is
 * local only (`meridian.launchTimeWindow`). No /api and no new LL2 query.
 */

export const LAUNCH_TIME_WINDOW_STORAGE_KEY = 'meridian.launchTimeWindow';
export const LAUNCH_TIME_WINDOW_CHIP_IDS = Object.freeze(['7d', '30d']);
export const LAUNCH_TIME_WINDOW_CHIP_LABELS = Object.freeze({
  '7d': '7d',
  '30d': '30d',
});
export const DEFAULT_LAUNCH_TIME_WINDOW = '30d';
export const MS_PER_DAY = 86400000;

/** @typedef {'7d'|'30d'} LaunchTimeWindowId */

let sessionWindow = DEFAULT_LAUNCH_TIME_WINDOW;
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
 * Canonical exclusive chip. Invalid input becomes the 30d default.
 * @param {unknown} value
 * @returns {LaunchTimeWindowId}
 */
export function normalizeLaunchTimeWindow(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === '7' || text === '7d') return '7d';
  if (text === '30' || text === '30d' || text === 'all') return '30d';
  return DEFAULT_LAUNCH_TIME_WINDOW;
}

/**
 * @param {unknown} windowId
 * @returns {7|30}
 */
export function launchTimeWindowDays(windowId) {
  switch (normalizeLaunchTimeWindow(windowId)) {
    case '7d':
      return 7;
    case '30d':
      return 30;
    default: {
      const unexpected = /** @type {never} */ (normalizeLaunchTimeWindow(windowId));
      throw new Error(`unexpected launch time window: ${unexpected}`);
    }
  }
}

/**
 * @param {unknown} windowId
 * @returns {number}
 */
export function launchTimeWindowMs(windowId) {
  return launchTimeWindowDays(windowId) * MS_PER_DAY;
}

/**
 * Keep a launch when its epoch is within `now ± window`. Missing or
 * non-finite `launchTime` stays visible. Selected mission stays.
 * @param {{id?: string, launchTime?: unknown}|null|undefined} launch
 * @param {unknown} windowId
 * @param {string|null} [selectedLaunchId]
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function launchPassesTimeWindow(
  launch,
  windowId,
  selectedLaunchId = null,
  nowMs = Date.now(),
) {
  if (selectedLaunchId && launch?.id === selectedLaunchId) return true;
  const launchTimeMs = Date.parse(launch?.launchTime);
  if (!Number.isFinite(launchTimeMs)) return true;
  const now = Number(nowMs);
  const origin = Number.isFinite(now) ? now : Date.now();
  return Math.abs(launchTimeMs - origin) <= launchTimeWindowMs(windowId);
}

/**
 * @param {Array<{id?: string, launchTime?: unknown}>|null|undefined} launches
 * @param {unknown} windowId
 * @param {string|null} [selectedLaunchId]
 * @param {number} [nowMs]
 * @returns {Array}
 */
export function filterLaunchesByTimeWindow(
  launches,
  windowId,
  selectedLaunchId = null,
  nowMs = Date.now(),
) {
  const list = Array.isArray(launches) ? launches : [];
  return list.filter((launch) => (
    launchPassesTimeWindow(launch, windowId, selectedLaunchId, nowMs)
  ));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {LaunchTimeWindowId}
 */
export function readLaunchTimeWindow(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(LAUNCH_TIME_WINDOW_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_TIME_WINDOW;
    return normalizeLaunchTimeWindow(raw);
  } catch {
    return DEFAULT_LAUNCH_TIME_WINDOW;
  }
}

/**
 * @param {unknown} windowId
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchTimeWindow(windowId, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(LAUNCH_TIME_WINDOW_STORAGE_KEY, normalizeLaunchTimeWindow(windowId));
    return true;
  } catch {
    return false;
  }
}

/** @returns {LaunchTimeWindowId} */
export function getLaunchTimeWindow() {
  return sessionWindow;
}

/**
 * Exclusive chip set. Clicking 7d or 30d replaces the current window.
 * @param {unknown} windowId
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {LaunchTimeWindowId}
 */
export function setLaunchTimeWindow(windowId, { persist = true, storage } = {}) {
  const next = normalizeLaunchTimeWindow(windowId);
  sessionWindow = next;
  if (persist) writeLaunchTimeWindow(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {LaunchTimeWindowId}
 */
export function hydrateLaunchTimeWindow(storage) {
  return setLaunchTimeWindow(readLaunchTimeWindow(storage), { persist: false, storage });
}

/**
 * @param {(windowId: LaunchTimeWindowId) => void} listener
 * @returns {() => void}
 */
export function subscribeLaunchTimeWindow(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore 30d without clearing subscribers. */
export function resetLaunchTimeWindowForTest() {
  sessionWindow = DEFAULT_LAUNCH_TIME_WINDOW;
}
