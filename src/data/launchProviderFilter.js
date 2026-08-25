/**
 * @module launchProviderFilter
 * @description Client-side Launch Library 2 provider chips for the existing
 * Space Missions roster and globe markers. Chips are derived from already-
 * fetched provider strings on the in-memory 30-day roster. Persistence is
 * local only (`meridian.launchProvider`). No /api and no new LL2 query.
 */

export const LAUNCH_PROVIDER_FILTER_STORAGE_KEY = 'meridian.launchProvider';
export const LAUNCH_PROVIDER_OTHER_CHIP_ID = 'other';
export const LAUNCH_PROVIDER_CHIP_LABELS = Object.freeze({
  [LAUNCH_PROVIDER_OTHER_CHIP_ID]: 'Other',
});
export const DEFAULT_LAUNCH_PROVIDER_FILTER = 'all';

/** @typedef {string} LaunchProviderChipId */

let sessionFilter = DEFAULT_LAUNCH_PROVIDER_FILTER;
const listeners = new Set();

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function providerName(launch) {
  if (typeof launch === 'string') return launch.trim();
  if (!launch || typeof launch !== 'object') return '';
  if (typeof launch.provider === 'string') return launch.provider.trim();
  const nested = launch.launch_service_provider?.name;
  if (typeof nested === 'string') return nested.trim();
  return '';
}

function chipIdsFrom(chipIds) {
  if (!Array.isArray(chipIds)) return [];
  return [...new Set(chipIds.map((id) => String(id || '')).filter(Boolean))];
}

function parseDisabledIds(token) {
  if (token === '0') return null;
  if (!token || token === DEFAULT_LAUNCH_PROVIDER_FILTER) return [];
  try {
    const parsed = JSON.parse(token);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((id) => String(id || '')).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function serializeDisabledIds(disabled, chipIds) {
  const unique = [...new Set(disabled.map((id) => String(id || '')).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  if (!unique.length) return DEFAULT_LAUNCH_PROVIDER_FILTER;
  if (chipIds.length && chipIds.every((id) => unique.includes(id))) return '0';
  return JSON.stringify(unique);
}

/**
 * Map a launch onto one provider chip. Blank or unspecified becomes Other.
 * @param {unknown} launch Normalized launch, raw LL2 row, or provider string.
 * @returns {LaunchProviderChipId}
 */
export function launchProviderChipId(launch) {
  return providerName(launch) || LAUNCH_PROVIDER_OTHER_CHIP_ID;
}

/**
 * Unique provider chips from the in-memory 30-day roster. Named providers
 * stay in locale order; Other is last and only when a blank row exists.
 * @param {Array<{provider?: unknown, launch_service_provider?: {name?: unknown}}>|null|undefined} launches
 * @returns {LaunchProviderChipId[]}
 */
export function listLaunchProviderChipIds(launches) {
  const named = new Set();
  let hasOther = false;
  for (const launch of Array.isArray(launches) ? launches : []) {
    const name = providerName(launch);
    if (name) named.add(name);
    else hasOther = true;
  }
  const ids = [...named].sort((a, b) => a.localeCompare(b));
  if (hasOther) ids.push(LAUNCH_PROVIDER_OTHER_CHIP_ID);
  return ids;
}

/**
 * @param {unknown} chipId
 * @returns {string}
 */
export function launchProviderChipLabel(chipId) {
  const id = String(chipId || '');
  if (id === LAUNCH_PROVIDER_OTHER_CHIP_ID) return LAUNCH_PROVIDER_CHIP_LABELS.other;
  return id;
}

/**
 * Canonical filter token. Invalid input becomes the all-on default.
 * Disabled-provider JSON is used so a newly seen roster provider stays on.
 * @param {unknown} value
 * @param {Iterable<string>|null|undefined} [chipIds]
 * @returns {string}
 */
export function normalizeLaunchProviderFilter(value, chipIds) {
  const chips = chipIdsFrom(chipIds);
  if (value == null || value === '') return DEFAULT_LAUNCH_PROVIDER_FILTER;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    if (lower === 'all' || trimmed === DEFAULT_LAUNCH_PROVIDER_FILTER) {
      return DEFAULT_LAUNCH_PROVIDER_FILTER;
    }
    if (lower === '0' || lower === 'none') return '0';
    return serializeDisabledIds(parseDisabledIds(trimmed) || [], chips);
  }
  if (typeof value === 'object') {
    const ids = chips.length ? chips : Object.keys(value);
    const enabled = ids.filter((id) => value[id] === true);
    if (!enabled.length) {
      const explicitFalse = ids.some((id) => value[id] === false);
      if (explicitFalse) return '0';
      return DEFAULT_LAUNCH_PROVIDER_FILTER;
    }
    if (ids.length && enabled.length === ids.length) return DEFAULT_LAUNCH_PROVIDER_FILTER;
    return serializeDisabledIds(ids.filter((id) => value[id] !== true), ids);
  }
  return DEFAULT_LAUNCH_PROVIDER_FILTER;
}

/**
 * @param {unknown} filter
 * @param {Iterable<string>|null|undefined} [chipIds]
 * @returns {Record<string, boolean>}
 */
export function launchProviderFilterFlags(filter, chipIds) {
  const chips = chipIdsFrom(chipIds);
  const token = normalizeLaunchProviderFilter(filter, chips);
  if (token === '0') {
    return Object.fromEntries(chips.map((id) => [id, false]));
  }
  const disabled = new Set(parseDisabledIds(token) || []);
  return Object.fromEntries(chips.map((id) => [id, !disabled.has(id)]));
}

/**
 * Flip one chip. Last-off becomes the empty token `0`.
 * @param {unknown} filter
 * @param {unknown} chipId
 * @param {Iterable<string>|null|undefined} [chipIds]
 * @returns {string}
 */
export function toggleLaunchProviderFilter(filter, chipId, chipIds) {
  const id = String(chipId || '');
  const chips = chipIdsFrom(chipIds);
  if (!id || (chips.length && !chips.includes(id))) {
    return normalizeLaunchProviderFilter(filter, chips);
  }
  const known = chips.length ? chips : [id];
  const flags = launchProviderFilterFlags(filter, known);
  flags[id] = !flags[id];
  return normalizeLaunchProviderFilter(flags, known);
}

/**
 * @param {{id?: string, provider?: unknown, launch_service_provider?: {name?: unknown}}|null|undefined} launch
 * @param {unknown} filter
 * @param {string|null} [selectedLaunchId]
 * @returns {boolean}
 */
export function launchPassesProviderFilter(launch, filter, selectedLaunchId = null) {
  if (selectedLaunchId && launch?.id === selectedLaunchId) return true;
  const token = normalizeLaunchProviderFilter(filter);
  if (token === DEFAULT_LAUNCH_PROVIDER_FILTER) return true;
  if (token === '0') return false;
  const disabled = new Set(parseDisabledIds(token) || []);
  return !disabled.has(launchProviderChipId(launch));
}

/**
 * @param {Array<{id?: string, provider?: unknown}>|null|undefined} launches
 * @param {unknown} filter
 * @param {string|null} [selectedLaunchId]
 * @returns {Array}
 */
export function filterLaunchesByProvider(launches, filter, selectedLaunchId = null) {
  const list = Array.isArray(launches) ? launches : [];
  return list.filter((launch) => launchPassesProviderFilter(launch, filter, selectedLaunchId));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function readLaunchProviderFilter(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(LAUNCH_PROVIDER_FILTER_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_PROVIDER_FILTER;
    return normalizeLaunchProviderFilter(raw);
  } catch {
    return DEFAULT_LAUNCH_PROVIDER_FILTER;
  }
}

/**
 * @param {unknown} filter
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @param {Iterable<string>|null|undefined} [chipIds]
 * @returns {boolean}
 */
export function writeLaunchProviderFilter(filter, storage, chipIds) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      LAUNCH_PROVIDER_FILTER_STORAGE_KEY,
      normalizeLaunchProviderFilter(filter, chipIds),
    );
    return true;
  } catch {
    return false;
  }
}

/** @returns {string} */
export function getLaunchProviderFilter() {
  return sessionFilter;
}

/**
 * @param {unknown} filter
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null, chipIds?: Iterable<string>}} [options]
 * @returns {string}
 */
export function setLaunchProviderFilter(filter, { persist = true, storage, chipIds } = {}) {
  const next = normalizeLaunchProviderFilter(filter, chipIds);
  sessionFilter = next;
  if (persist) writeLaunchProviderFilter(next, storage, chipIds);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function hydrateLaunchProviderFilter(storage) {
  return setLaunchProviderFilter(readLaunchProviderFilter(storage), { persist: false, storage });
}

/**
 * @param {(filter: string) => void} listener
 * @returns {() => void}
 */
export function subscribeLaunchProviderFilter(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore all-on without clearing subscribers. */
export function resetLaunchProviderFilterForTest() {
  sessionFilter = DEFAULT_LAUNCH_PROVIDER_FILTER;
}
