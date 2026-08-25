/**
 * @module launchSiteFilter
 * @description Client-side Launch Library 2 launch-site chips for the existing
 * Space Missions roster and globe markers. Chips are derived from the
 * in-memory 30-day roster via `compactLaunchSiteName(launchSite)`, plus Other
 * for blank or unknown pads. Persistence is local only (`meridian.launchSite`).
 * No /api and no new LL2 query.
 */

export const LAUNCH_SITE_FILTER_STORAGE_KEY = 'meridian.launchSite';
export const LAUNCH_SITE_OTHER_CHIP_ID = 'other';
export const DEFAULT_LAUNCH_SITE_FILTER = 'all';

/** @typedef {string} LaunchSiteChipId */

let sessionFilter = DEFAULT_LAUNCH_SITE_FILTER;
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
 * Reduce generic launch-complex names to their identifying pad or area suffix.
 * @param {string|null} launchSite Launch Library pad name.
 * @returns {string|null} Compact launch-site identifier.
 */
export function compactLaunchSiteName(launchSite) {
  const text = String(launchSite || '').replace(/\s+/g, ' ').trim();
  if (!text || /^(unknown|unavailable|n\/a)$/i.test(text)) return null;
  const genericPrefix = /^(?:orbital\s+launch\s+pad|space\s+launch\s+complex|launch\s+(?:area|complex|pad|site))\s*[-·:]?\s*/i;
  const compact = text.replace(genericPrefix, '').trim();
  return compact || null;
}

/**
 * Map a Launch Library 2 pad name onto one chip.
 * Blank, unknown, and "Unknown launch site" fall through to Other.
 * @param {unknown} launchSite Normalized string or `{ name }` / `{ launchSite }`.
 * @returns {LaunchSiteChipId}
 */
export function launchSiteChipId(launchSite) {
  let raw = launchSite;
  if (raw && typeof raw === 'object') {
    if (typeof raw.launchSite === 'string') raw = raw.launchSite;
    else if (typeof raw.name === 'string') raw = raw.name;
  }
  const compact = compactLaunchSiteName(typeof raw === 'string' ? raw : '');
  if (!compact || /^unknown(\s+launch\s+site)?$/i.test(compact)) {
    return LAUNCH_SITE_OTHER_CHIP_ID;
  }
  return compact;
}

/**
 * Unique chip ids from the in-memory 30-day roster. Other is always last.
 * @param {Array<{launchSite?: unknown}|null|undefined>|null|undefined} launches
 * @returns {LaunchSiteChipId[]}
 */
export function launchSiteChipIdsFromLaunches(launches) {
  const seen = new Set();
  const ids = [];
  for (const launch of Array.isArray(launches) ? launches : []) {
    const id = launchSiteChipId(launch?.launchSite);
    if (id === LAUNCH_SITE_OTHER_CHIP_ID || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  ids.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  ids.push(LAUNCH_SITE_OTHER_CHIP_ID);
  return ids;
}

/**
 * Visible label for a derived site chip.
 * @param {unknown} chipId
 * @returns {string}
 */
export function launchSiteChipLabel(chipId) {
  const id = String(chipId || '');
  if (!id || id === LAUNCH_SITE_OTHER_CHIP_ID) return 'Other';
  return id;
}

function encodeChipId(id) {
  return encodeURIComponent(String(id));
}

function decodeChipId(token) {
  try {
    return decodeURIComponent(String(token));
  } catch {
    return '';
  }
}

function encodeDisabled(ids) {
  const unique = [...new Set(ids.map((id) => String(id || '')).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  if (!unique.length) return DEFAULT_LAUNCH_SITE_FILTER;
  return unique.map((id) => `-${encodeChipId(id)}`).join(',');
}

function encodeEnabled(ids) {
  const unique = [...new Set(ids.map((id) => String(id || '')).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  if (!unique.length) return '0';
  return unique.map((id) => `+${encodeChipId(id)}`).join(',');
}

function decodeToken(token) {
  if (token === DEFAULT_LAUNCH_SITE_FILTER) return { mode: 'all' };
  if (token === '0') return { mode: 'none' };
  const off = new Set();
  const on = new Set();
  for (const part of String(token).split(',')) {
    if (!part) continue;
    if (part.startsWith('-')) {
      const id = decodeChipId(part.slice(1));
      if (id) off.add(id);
    } else if (part.startsWith('+')) {
      const id = decodeChipId(part.slice(1));
      if (id) on.add(id);
    }
  }
  if (on.size) return { mode: 'on', on };
  if (off.size) return { mode: 'off', off };
  return { mode: 'all' };
}

/**
 * Canonical chip token. Invalid input becomes the all-on default.
 * Pass `chipIds` when the current roster universe is known so "all on"
 * and "last off" stay aligned with the derived chips.
 * @param {unknown} value
 * @param {Iterable<string>|null} [chipIds]
 * @returns {string}
 */
export function normalizeLaunchSiteFilter(value, chipIds = null) {
  const universe = Array.isArray(chipIds) || chipIds instanceof Set
    ? [...chipIds].map((id) => String(id || '')).filter(Boolean)
    : [];
  if (value == null || value === '') return DEFAULT_LAUNCH_SITE_FILTER;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return DEFAULT_LAUNCH_SITE_FILTER;
    const lower = trimmed.toLowerCase();
    if (lower === 'all' || trimmed === DEFAULT_LAUNCH_SITE_FILTER) {
      return DEFAULT_LAUNCH_SITE_FILTER;
    }
    if (lower === '0' || lower === 'none') return '0';
    const decoded = decodeToken(trimmed);
    if (decoded.mode === 'all') return DEFAULT_LAUNCH_SITE_FILTER;
    if (decoded.mode === 'none') return '0';
    if (decoded.mode === 'on') {
      if (universe.length && universe.every((id) => decoded.on.has(id))) {
        return DEFAULT_LAUNCH_SITE_FILTER;
      }
      return encodeEnabled([...decoded.on]);
    }
    if (universe.length && universe.every((id) => decoded.off.has(id))) return '0';
    return encodeDisabled([...decoded.off]);
  }
  if (typeof value === 'object') {
    if (universe.length) {
      const enabled = universe.filter((id) => value[id] === true);
      const disabled = universe.filter((id) => value[id] !== true);
      if (!enabled.length) return '0';
      if (!disabled.length) return DEFAULT_LAUNCH_SITE_FILTER;
      return encodeDisabled(disabled);
    }
    const enabled = Object.keys(value).filter((id) => value[id] === true);
    const hasFalse = Object.values(value).some((flag) => flag === false);
    if (!enabled.length) return hasFalse ? '0' : DEFAULT_LAUNCH_SITE_FILTER;
    return encodeEnabled(enabled);
  }
  return DEFAULT_LAUNCH_SITE_FILTER;
}

/**
 * Whether one derived chip is on.
 * @param {unknown} filter
 * @param {unknown} chipId
 * @returns {boolean}
 */
export function launchSiteChipEnabled(filter, chipId) {
  const id = String(chipId || '');
  if (!id) return false;
  const decoded = decodeToken(normalizeLaunchSiteFilter(filter));
  if (decoded.mode === 'all') return true;
  if (decoded.mode === 'none') return false;
  if (decoded.mode === 'off') return !decoded.off.has(id);
  return decoded.on.has(id);
}

/**
 * @param {unknown} filter
 * @param {Iterable<string>|null} [chipIds]
 * @returns {Record<string, boolean>}
 */
export function launchSiteFilterFlags(filter, chipIds = null) {
  const ids = Array.isArray(chipIds) || chipIds instanceof Set
    ? [...chipIds].map((id) => String(id || '')).filter(Boolean)
    : [];
  return Object.fromEntries(ids.map((id) => [id, launchSiteChipEnabled(filter, id)]));
}

/**
 * Flip one chip. Last-off becomes the empty token `0`.
 * @param {unknown} filter
 * @param {unknown} chipId
 * @param {Iterable<string>|null} [chipIds]
 * @returns {string}
 */
export function toggleLaunchSiteFilter(filter, chipId, chipIds = null) {
  const id = String(chipId || '');
  if (!id) return normalizeLaunchSiteFilter(filter, chipIds);
  const universe = Array.isArray(chipIds) || chipIds instanceof Set
    ? [...new Set([...chipIds].map((item) => String(item || '')).filter(Boolean))]
    : [];
  if (!universe.includes(id)) universe.push(id);
  const flags = launchSiteFilterFlags(filter, universe);
  flags[id] = !flags[id];
  return normalizeLaunchSiteFilter(flags, universe);
}

/**
 * @param {{id?: string, launchSite?: unknown}|null|undefined} launch
 * @param {unknown} filter
 * @param {string|null} [selectedLaunchId]
 * @returns {boolean}
 */
export function launchPassesSiteFilter(launch, filter, selectedLaunchId = null) {
  if (selectedLaunchId && launch?.id === selectedLaunchId) return true;
  return launchSiteChipEnabled(filter, launchSiteChipId(launch?.launchSite)) === true;
}

/**
 * @param {Array<{id?: string, launchSite?: unknown}>|null|undefined} launches
 * @param {unknown} filter
 * @param {string|null} [selectedLaunchId]
 * @returns {Array}
 */
export function filterLaunchesBySite(launches, filter, selectedLaunchId = null) {
  const list = Array.isArray(launches) ? launches : [];
  return list.filter((launch) => launchPassesSiteFilter(launch, filter, selectedLaunchId));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function readLaunchSiteFilter(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(LAUNCH_SITE_FILTER_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_SITE_FILTER;
    return normalizeLaunchSiteFilter(raw);
  } catch {
    return DEFAULT_LAUNCH_SITE_FILTER;
  }
}

/**
 * @param {unknown} filter
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchSiteFilter(filter, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(LAUNCH_SITE_FILTER_STORAGE_KEY, normalizeLaunchSiteFilter(filter));
    return true;
  } catch {
    return false;
  }
}

/** @returns {string} */
export function getLaunchSiteFilter() {
  return sessionFilter;
}

/**
 * @param {unknown} filter
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {string}
 */
export function setLaunchSiteFilter(filter, { persist = true, storage } = {}) {
  const next = normalizeLaunchSiteFilter(filter);
  sessionFilter = next;
  if (persist) writeLaunchSiteFilter(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function hydrateLaunchSiteFilter(storage) {
  return setLaunchSiteFilter(readLaunchSiteFilter(storage), { persist: false, storage });
}

/**
 * @param {(filter: string) => void} listener
 * @returns {() => void}
 */
export function subscribeLaunchSiteFilter(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore all-on without clearing subscribers. */
export function resetLaunchSiteFilterForTest() {
  sessionFilter = DEFAULT_LAUNCH_SITE_FILTER;
}
