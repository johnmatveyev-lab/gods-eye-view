/**
 * @module launchRecoveryFilter
 * @description Client-side Recovery-attempted toggle for the existing Space
 * Missions roster and globe markers. Filters already-normalized
 * `recoveryStages` on the in-memory 30-day Launch Library 2 roster.
 * Persistence is local only (`meridian.launchRecoveryOnly`). No /api and
 * no new LL2 query.
 */

export const LAUNCH_RECOVERY_ONLY_STORAGE_KEY = 'meridian.launchRecoveryOnly';
export const LAUNCH_RECOVERY_ONLY_CHIP_LABEL = 'Recovery-attempted';
export const DEFAULT_LAUNCH_RECOVERY_ONLY = false;

let sessionRecoveryOnly = DEFAULT_LAUNCH_RECOVERY_ONLY;
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
 * True when at least one normalized recovery stage has `attempted === true`
 * (from Launch Library 2 `landing.attempt`). Empty or missing stages are
 * no attempt.
 * @param {{recoveryStages?: unknown}|null|undefined} launch
 * @returns {boolean}
 */
export function launchHasRecoveryAttempt(launch) {
  const stages = launch?.recoveryStages;
  if (!Array.isArray(stages) || stages.length === 0) return false;
  return stages.some((stage) => stage?.attempted === true);
}

/**
 * Canonical on/off. Invalid input becomes the off default.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeLaunchRecoveryOnly(value) {
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 'on') {
    return true;
  }
  return DEFAULT_LAUNCH_RECOVERY_ONLY;
}

/**
 * Keep a launch when the toggle is off, or when a recovery stage was
 * attempted. Empty or missing `recoveryStages` hide while the toggle is
 * on. Selected mission stays.
 * @param {{id?: string, recoveryStages?: unknown}|null|undefined} launch
 * @param {unknown} recoveryOnly
 * @param {string|null} [selectedLaunchId]
 * @returns {boolean}
 */
export function launchPassesRecoveryFilter(launch, recoveryOnly, selectedLaunchId = null) {
  if (selectedLaunchId && launch?.id === selectedLaunchId) return true;
  if (normalizeLaunchRecoveryOnly(recoveryOnly) !== true) return true;
  return launchHasRecoveryAttempt(launch);
}

/**
 * @param {Array<{id?: string, recoveryStages?: unknown}>|null|undefined} launches
 * @param {unknown} recoveryOnly
 * @param {string|null} [selectedLaunchId]
 * @returns {Array}
 */
export function filterLaunchesByRecovery(launches, recoveryOnly, selectedLaunchId = null) {
  const list = Array.isArray(launches) ? launches : [];
  return list.filter((launch) => launchPassesRecoveryFilter(launch, recoveryOnly, selectedLaunchId));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readLaunchRecoveryOnly(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(LAUNCH_RECOVERY_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_RECOVERY_ONLY;
    return normalizeLaunchRecoveryOnly(raw);
  } catch {
    return DEFAULT_LAUNCH_RECOVERY_ONLY;
  }
}

/**
 * @param {unknown} recoveryOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchRecoveryOnly(recoveryOnly, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      LAUNCH_RECOVERY_ONLY_STORAGE_KEY,
      normalizeLaunchRecoveryOnly(recoveryOnly) ? '1' : '0',
    );
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getLaunchRecoveryOnly() {
  return sessionRecoveryOnly;
}

/**
 * @param {unknown} recoveryOnly
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setLaunchRecoveryOnly(recoveryOnly, { persist = true, storage } = {}) {
  const next = normalizeLaunchRecoveryOnly(recoveryOnly);
  sessionRecoveryOnly = next;
  if (persist) writeLaunchRecoveryOnly(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateLaunchRecoveryOnly(storage) {
  return setLaunchRecoveryOnly(readLaunchRecoveryOnly(storage), { persist: false, storage });
}

/**
 * @param {(recoveryOnly: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeLaunchRecoveryOnly(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetLaunchRecoveryOnlyForTest() {
  sessionRecoveryOnly = DEFAULT_LAUNCH_RECOVERY_ONLY;
}
