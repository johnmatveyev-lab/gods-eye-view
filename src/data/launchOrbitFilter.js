/**
 * @module launchOrbitFilter
 * @description Client-side Launch Library 2 orbit-class chips for the existing
 * Space Missions roster and globe markers. Filters already-fetched
 * `orbit.name` values. Persistence is local only (`meridian.launchOrbit`).
 * No /api and no new LL2 query.
 */

export const LAUNCH_ORBIT_FILTER_STORAGE_KEY = 'meridian.launchOrbit';
export const LAUNCH_ORBIT_CHIP_IDS = Object.freeze([
  'leo',
  'meo',
  'geo',
  'polar',
  'other',
]);
export const LAUNCH_ORBIT_CHIP_LABELS = Object.freeze({
  leo: 'LEO',
  meo: 'MEO',
  geo: 'GEO',
  polar: 'Polar',
  other: 'Other',
});
export const LAUNCH_ORBIT_CHIP_CODES = Object.freeze({
  leo: 'l',
  meo: 'm',
  geo: 'g',
  polar: 'p',
  other: 'o',
});
export const DEFAULT_LAUNCH_ORBIT_FILTER = 'lmgpo';

const CODE_TO_CHIP = Object.freeze(
  Object.fromEntries(
    Object.entries(LAUNCH_ORBIT_CHIP_CODES).map(([id, code]) => [code, id]),
  ),
);

/** @typedef {'leo'|'meo'|'geo'|'polar'|'other'} LaunchOrbitChipId */

let sessionFilter = DEFAULT_LAUNCH_ORBIT_FILTER;
const listeners = new Set();

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function orbitName(orbit) {
  if (typeof orbit === 'string') return orbit;
  if (orbit && typeof orbit === 'object' && typeof orbit.name === 'string') return orbit.name;
  return '';
}

/**
 * Map a Launch Library 2 orbit name onto one chip.
 * Polar (polar / sun-sync) wins over LEO. GEO includes GTO, geostationary,
 * geosynchronous, and transfer names.
 * @param {unknown} orbit Normalized string or `{ name }`.
 * @returns {LaunchOrbitChipId}
 */
export function launchOrbitChipId(orbit) {
  const text = orbitName(orbit).trim().toLowerCase();
  if (!text) return 'other';
  if (
    /\bpolar\b/.test(text)
    || /sun[\s-]?sync/.test(text)
    || text.includes('sunsynchronous')
    || /\bsso\b/.test(text)
  ) {
    return 'polar';
  }
  if (
    /\bgto\b/.test(text)
    || /\bgeo\b/.test(text)
    || text.includes('geostationary')
    || text.includes('geosynchronous')
    || text.includes('transfer')
  ) {
    return 'geo';
  }
  if (/\bmeo\b/.test(text) || text.includes('medium earth') || text.includes('medium-earth')) {
    return 'meo';
  }
  if (/\bleo\b/.test(text) || text.includes('low earth') || text.includes('low-earth')) {
    return 'leo';
  }
  return 'other';
}

/**
 * Canonical chip-code token. Invalid input becomes the all-on default.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeLaunchOrbitFilter(value) {
  if (value == null || value === '') return DEFAULT_LAUNCH_ORBIT_FILTER;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'all' || trimmed === DEFAULT_LAUNCH_ORBIT_FILTER) {
      return DEFAULT_LAUNCH_ORBIT_FILTER;
    }
    if (trimmed === '0' || trimmed === 'none') return '0';
    const seen = new Set();
    for (const character of trimmed) {
      const chipId = CODE_TO_CHIP[character];
      if (chipId) seen.add(chipId);
    }
    if (!seen.size) return DEFAULT_LAUNCH_ORBIT_FILTER;
    const codes = LAUNCH_ORBIT_CHIP_IDS
      .filter((id) => seen.has(id))
      .map((id) => LAUNCH_ORBIT_CHIP_CODES[id])
      .join('');
    return codes === DEFAULT_LAUNCH_ORBIT_FILTER ? DEFAULT_LAUNCH_ORBIT_FILTER : codes;
  }
  if (typeof value === 'object') {
    const enabled = LAUNCH_ORBIT_CHIP_IDS.filter((id) => value[id] === true);
    if (!enabled.length) {
      const explicitFalse = LAUNCH_ORBIT_CHIP_IDS.some((id) => value[id] === false);
      if (explicitFalse) return '0';
      return DEFAULT_LAUNCH_ORBIT_FILTER;
    }
    return enabled.map((id) => LAUNCH_ORBIT_CHIP_CODES[id]).join('');
  }
  return DEFAULT_LAUNCH_ORBIT_FILTER;
}

/**
 * @param {unknown} filter
 * @returns {Record<LaunchOrbitChipId, boolean>}
 */
export function launchOrbitFilterFlags(filter) {
  const token = normalizeLaunchOrbitFilter(filter);
  if (token === '0') {
    return Object.fromEntries(LAUNCH_ORBIT_CHIP_IDS.map((id) => [id, false]));
  }
  return Object.fromEntries(
    LAUNCH_ORBIT_CHIP_IDS.map((id) => [id, token.includes(LAUNCH_ORBIT_CHIP_CODES[id])]),
  );
}

/**
 * Flip one chip. Last-off becomes the empty token `0`.
 * @param {unknown} filter
 * @param {unknown} chipId
 * @returns {string}
 */
export function toggleLaunchOrbitFilter(filter, chipId) {
  const id = String(chipId || '');
  if (!LAUNCH_ORBIT_CHIP_IDS.includes(/** @type {LaunchOrbitChipId} */ (id))) {
    return normalizeLaunchOrbitFilter(filter);
  }
  const flags = launchOrbitFilterFlags(filter);
  flags[id] = !flags[id];
  return normalizeLaunchOrbitFilter(flags);
}

/**
 * @param {{id?: string, orbit?: unknown}|null|undefined} launch
 * @param {unknown} filter
 * @param {string|null} [selectedLaunchId]
 * @returns {boolean}
 */
export function launchPassesOrbitFilter(launch, filter, selectedLaunchId = null) {
  if (selectedLaunchId && launch?.id === selectedLaunchId) return true;
  const flags = launchOrbitFilterFlags(filter);
  return flags[launchOrbitChipId(launch?.orbit)] === true;
}

/**
 * @param {Array<{id?: string, orbit?: unknown}>|null|undefined} launches
 * @param {unknown} filter
 * @param {string|null} [selectedLaunchId]
 * @returns {Array}
 */
export function filterLaunchesByOrbit(launches, filter, selectedLaunchId = null) {
  const list = Array.isArray(launches) ? launches : [];
  return list.filter((launch) => launchPassesOrbitFilter(launch, filter, selectedLaunchId));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function readLaunchOrbitFilter(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(LAUNCH_ORBIT_FILTER_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_ORBIT_FILTER;
    return normalizeLaunchOrbitFilter(raw);
  } catch {
    return DEFAULT_LAUNCH_ORBIT_FILTER;
  }
}

/**
 * @param {unknown} filter
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchOrbitFilter(filter, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(LAUNCH_ORBIT_FILTER_STORAGE_KEY, normalizeLaunchOrbitFilter(filter));
    return true;
  } catch {
    return false;
  }
}

/** @returns {string} */
export function getLaunchOrbitFilter() {
  return sessionFilter;
}

/**
 * @param {unknown} filter
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {string}
 */
export function setLaunchOrbitFilter(filter, { persist = true, storage } = {}) {
  const next = normalizeLaunchOrbitFilter(filter);
  sessionFilter = next;
  if (persist) writeLaunchOrbitFilter(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function hydrateLaunchOrbitFilter(storage) {
  return setLaunchOrbitFilter(readLaunchOrbitFilter(storage), { persist: false, storage });
}

/**
 * @param {(filter: string) => void} listener
 * @returns {() => void}
 */
export function subscribeLaunchOrbitFilter(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore all-on without clearing subscribers. */
export function resetLaunchOrbitFilterForTest() {
  sessionFilter = DEFAULT_LAUNCH_ORBIT_FILTER;
}
