/**
 * @module launchStatusFilter
 * @description Client-side Launch Library 2 status chips for the existing
 * Space Missions roster and globe markers. Filters already-fetched
 * `status.name` values. Persistence is local only (`meridian.launchStatus`).
 * No /api and no new LL2 query.
 */

export const LAUNCH_STATUS_FILTER_STORAGE_KEY = 'meridian.launchStatus';
export const LAUNCH_STATUS_CHIP_IDS = Object.freeze([
  'go',
  'tbd',
  'hold',
  'in-flight',
  'other',
]);
export const LAUNCH_STATUS_CHIP_LABELS = Object.freeze({
  go: 'Go',
  tbd: 'TBD',
  hold: 'Hold',
  'in-flight': 'In Flight',
  other: 'Other',
});
export const LAUNCH_STATUS_CHIP_CODES = Object.freeze({
  go: 'g',
  tbd: 't',
  hold: 'h',
  'in-flight': 'i',
  other: 'o',
});
export const DEFAULT_LAUNCH_STATUS_FILTER = 'gthio';

const CODE_TO_CHIP = Object.freeze(
  Object.fromEntries(
    Object.entries(LAUNCH_STATUS_CHIP_CODES).map(([id, code]) => [code, id]),
  ),
);

/** @typedef {'go'|'tbd'|'hold'|'in-flight'|'other'} LaunchStatusChipId */

let sessionFilter = DEFAULT_LAUNCH_STATUS_FILTER;
const listeners = new Set();

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function statusName(status) {
  if (typeof status === 'string') return status;
  if (status && typeof status === 'object' && typeof status.name === 'string') return status.name;
  return '';
}

/**
 * Map a Launch Library 2 status name onto one chip.
 * @param {unknown} status Normalized string or `{ name }`.
 * @returns {LaunchStatusChipId}
 */
export function launchStatusChipId(status) {
  const text = statusName(status).trim().toLowerCase();
  if (text === 'go' || text.startsWith('go for') || /^go\b/.test(text)) return 'go';
  if (text === 'tbd' || /\btbd\b/.test(text) || text.includes('to be determined')) return 'tbd';
  if (text === 'hold' || /\bhold\b/.test(text)) return 'hold';
  if (text === 'in flight' || /in[\s-]?flight/.test(text)) return 'in-flight';
  return 'other';
}

/**
 * Canonical chip-code token. Invalid input becomes the all-on default.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeLaunchStatusFilter(value) {
  if (value == null || value === '') return DEFAULT_LAUNCH_STATUS_FILTER;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'all' || trimmed === DEFAULT_LAUNCH_STATUS_FILTER) {
      return DEFAULT_LAUNCH_STATUS_FILTER;
    }
    if (trimmed === '0' || trimmed === 'none') return '0';
    const seen = new Set();
    for (const character of trimmed) {
      const chipId = CODE_TO_CHIP[character];
      if (chipId) seen.add(chipId);
    }
    if (!seen.size) return DEFAULT_LAUNCH_STATUS_FILTER;
    const codes = LAUNCH_STATUS_CHIP_IDS
      .filter((id) => seen.has(id))
      .map((id) => LAUNCH_STATUS_CHIP_CODES[id])
      .join('');
    return codes === DEFAULT_LAUNCH_STATUS_FILTER ? DEFAULT_LAUNCH_STATUS_FILTER : codes;
  }
  if (typeof value === 'object') {
    const enabled = LAUNCH_STATUS_CHIP_IDS.filter((id) => value[id] === true);
    if (!enabled.length) {
      const explicitFalse = LAUNCH_STATUS_CHIP_IDS.some((id) => value[id] === false);
      if (explicitFalse) return '0';
      return DEFAULT_LAUNCH_STATUS_FILTER;
    }
    return enabled.map((id) => LAUNCH_STATUS_CHIP_CODES[id]).join('');
  }
  return DEFAULT_LAUNCH_STATUS_FILTER;
}

/**
 * @param {unknown} filter
 * @returns {Record<LaunchStatusChipId, boolean>}
 */
export function launchStatusFilterFlags(filter) {
  const token = normalizeLaunchStatusFilter(filter);
  if (token === '0') {
    return Object.fromEntries(LAUNCH_STATUS_CHIP_IDS.map((id) => [id, false]));
  }
  return Object.fromEntries(
    LAUNCH_STATUS_CHIP_IDS.map((id) => [id, token.includes(LAUNCH_STATUS_CHIP_CODES[id])]),
  );
}

/**
 * Flip one chip. Last-off becomes the empty token `0`.
 * @param {unknown} filter
 * @param {unknown} chipId
 * @returns {string}
 */
export function toggleLaunchStatusFilter(filter, chipId) {
  const id = String(chipId || '');
  if (!LAUNCH_STATUS_CHIP_IDS.includes(/** @type {LaunchStatusChipId} */ (id))) {
    return normalizeLaunchStatusFilter(filter);
  }
  const flags = launchStatusFilterFlags(filter);
  flags[id] = !flags[id];
  return normalizeLaunchStatusFilter(flags);
}

/**
 * @param {{id?: string, status?: unknown}|null|undefined} launch
 * @param {unknown} filter
 * @param {string|null} [selectedLaunchId]
 * @returns {boolean}
 */
export function launchPassesStatusFilter(launch, filter, selectedLaunchId = null) {
  if (selectedLaunchId && launch?.id === selectedLaunchId) return true;
  const flags = launchStatusFilterFlags(filter);
  return flags[launchStatusChipId(launch?.status)] === true;
}

/**
 * @param {Array<{id?: string, status?: unknown}>|null|undefined} launches
 * @param {unknown} filter
 * @param {string|null} [selectedLaunchId]
 * @returns {Array}
 */
export function filterLaunchesByStatus(launches, filter, selectedLaunchId = null) {
  const list = Array.isArray(launches) ? launches : [];
  return list.filter((launch) => launchPassesStatusFilter(launch, filter, selectedLaunchId));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function readLaunchStatusFilter(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(LAUNCH_STATUS_FILTER_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_STATUS_FILTER;
    return normalizeLaunchStatusFilter(raw);
  } catch {
    return DEFAULT_LAUNCH_STATUS_FILTER;
  }
}

/**
 * @param {unknown} filter
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchStatusFilter(filter, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(LAUNCH_STATUS_FILTER_STORAGE_KEY, normalizeLaunchStatusFilter(filter));
    return true;
  } catch {
    return false;
  }
}

/** @returns {string} */
export function getLaunchStatusFilter() {
  return sessionFilter;
}

/**
 * @param {unknown} filter
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {string}
 */
export function setLaunchStatusFilter(filter, { persist = true, storage } = {}) {
  const next = normalizeLaunchStatusFilter(filter);
  sessionFilter = next;
  if (persist) writeLaunchStatusFilter(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function hydrateLaunchStatusFilter(storage) {
  return setLaunchStatusFilter(readLaunchStatusFilter(storage), { persist: false, storage });
}

/**
 * @param {(filter: string) => void} listener
 * @returns {() => void}
 */
export function subscribeLaunchStatusFilter(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore all-on without clearing subscribers. */
export function resetLaunchStatusFilterForTest() {
  sessionFilter = DEFAULT_LAUNCH_STATUS_FILTER;
}
