/**
 * @module launchRocketFilter
 * @description Client-side Launch Library 2 rocket-family chips for the existing
 * Space Missions roster and globe markers. Chips are derived from compact
 * vehicle names already present on the in-memory 30-day roster
 * (`rocket.configuration.name` or `rocket.name`). Persistence is local only
 * (`meridian.launchRocket`). No /api and no new LL2 query.
 */

export const LAUNCH_ROCKET_FILTER_STORAGE_KEY = 'meridian.launchRocket';
export const LAUNCH_ROCKET_OTHER_CHIP_ID = 'other';
export const LAUNCH_ROCKET_CHIP_LABELS = Object.freeze({
  [LAUNCH_ROCKET_OTHER_CHIP_ID]: 'Other',
});
export const DEFAULT_LAUNCH_ROCKET_FILTER = 'all';

/** @typedef {string} LaunchRocketChipId */

let sessionFilter = DEFAULT_LAUNCH_ROCKET_FILTER;
const listeners = new Set();

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function rawRocketName(launch) {
  if (typeof launch === 'string') return launch.trim();
  if (!launch || typeof launch !== 'object') return '';
  if (typeof launch.rocketName === 'string') return launch.rocketName.trim();
  const configName = launch.rocket?.configuration?.name;
  if (typeof configName === 'string') return configName.trim();
  const rocketName = launch.rocket?.name;
  if (typeof rocketName === 'string') return rocketName.trim();
  return '';
}

/**
 * Reduce Launch Library 2 vehicle names to a compact family label.
 * "Falcon 9 Block 5" → "Falcon 9", "Atlas V 551" → "Atlas V".
 * Blank / unknown stay null so the chip maps to Other.
 * @param {string|null|undefined} rocketName
 * @returns {string|null}
 */
export function compactRocketName(rocketName) {
  const text = String(rocketName || '').replace(/\s+/g, ' ').trim();
  if (!text || /^(unknown|unavailable|n\/a|unnamed)$/i.test(text)) return null;
  let compact = text.replace(/\s+Block\s+[\w.-]+$/i, '').trim();
  compact = compact.replace(/\s+(?:[A-Z]{1,3}\d{1,3}[A-Z]?|\d{3,4})$/i, '').trim();
  compact = compact.replace(/\s+(ECA|ES|ECA\/ES|CA|FT)$/i, '').trim();
  compact = compact.replace(/\s+\d+x\d+$/i, '').trim();
  return compact || null;
}

function chipIdsFrom(chipIds) {
  if (!Array.isArray(chipIds)) return [];
  return [...new Set(chipIds.map((id) => String(id || '')).filter(Boolean))];
}

function parseDisabledIds(token) {
  if (token === '0') return null;
  if (!token || token === DEFAULT_LAUNCH_ROCKET_FILTER) return [];
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
  if (!unique.length) return DEFAULT_LAUNCH_ROCKET_FILTER;
  if (chipIds.length && chipIds.every((id) => unique.includes(id))) return '0';
  return JSON.stringify(unique);
}

/**
 * Map a launch onto one rocket-family chip. Blank or unknown becomes Other.
 * @param {unknown} launch Normalized launch, raw LL2 row, or rocket name.
 * @returns {LaunchRocketChipId}
 */
export function launchRocketChipId(launch) {
  return compactRocketName(rawRocketName(launch)) || LAUNCH_ROCKET_OTHER_CHIP_ID;
}

/**
 * Unique rocket-family chips from the in-memory 30-day roster. Named families
 * stay in locale order; Other is last and only when a blank/unknown row exists.
 * @param {Array<{rocketName?: unknown, rocket?: {configuration?: {name?: unknown}, name?: unknown}}>|null|undefined} launches
 * @returns {LaunchRocketChipId[]}
 */
export function listLaunchRocketChipIds(launches) {
  const named = new Set();
  let hasOther = false;
  for (const launch of Array.isArray(launches) ? launches : []) {
    const compact = compactRocketName(rawRocketName(launch));
    if (compact) named.add(compact);
    else hasOther = true;
  }
  const ids = [...named].sort((a, b) => a.localeCompare(b));
  if (hasOther) ids.push(LAUNCH_ROCKET_OTHER_CHIP_ID);
  return ids;
}

/**
 * @param {unknown} chipId
 * @returns {string}
 */
export function launchRocketChipLabel(chipId) {
  const id = String(chipId || '');
  if (id === LAUNCH_ROCKET_OTHER_CHIP_ID) return LAUNCH_ROCKET_CHIP_LABELS.other;
  return id;
}

/**
 * Canonical filter token. Invalid input becomes the all-on default.
 * Disabled-rocket JSON is used so a newly seen roster family stays on.
 * @param {unknown} value
 * @param {Iterable<string>|null|undefined} [chipIds]
 * @returns {string}
 */
export function normalizeLaunchRocketFilter(value, chipIds) {
  const chips = chipIdsFrom(chipIds);
  if (value == null || value === '') return DEFAULT_LAUNCH_ROCKET_FILTER;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    if (lower === 'all' || trimmed === DEFAULT_LAUNCH_ROCKET_FILTER) {
      return DEFAULT_LAUNCH_ROCKET_FILTER;
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
      return DEFAULT_LAUNCH_ROCKET_FILTER;
    }
    if (ids.length && enabled.length === ids.length) return DEFAULT_LAUNCH_ROCKET_FILTER;
    return serializeDisabledIds(ids.filter((id) => value[id] !== true), ids);
  }
  return DEFAULT_LAUNCH_ROCKET_FILTER;
}

/**
 * @param {unknown} filter
 * @param {Iterable<string>|null|undefined} [chipIds]
 * @returns {Record<string, boolean>}
 */
export function launchRocketFilterFlags(filter, chipIds) {
  const chips = chipIdsFrom(chipIds);
  const token = normalizeLaunchRocketFilter(filter, chips);
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
export function toggleLaunchRocketFilter(filter, chipId, chipIds) {
  const id = String(chipId || '');
  const chips = chipIdsFrom(chipIds);
  if (!id || (chips.length && !chips.includes(id))) {
    return normalizeLaunchRocketFilter(filter, chips);
  }
  const known = chips.length ? chips : [id];
  const flags = launchRocketFilterFlags(filter, known);
  flags[id] = !flags[id];
  return normalizeLaunchRocketFilter(flags, known);
}

/**
 * @param {{id?: string, rocketName?: unknown, rocket?: {configuration?: {name?: unknown}, name?: unknown}}|null|undefined} launch
 * @param {unknown} filter
 * @param {string|null} [selectedLaunchId]
 * @returns {boolean}
 */
export function launchPassesRocketFilter(launch, filter, selectedLaunchId = null) {
  if (selectedLaunchId && launch?.id === selectedLaunchId) return true;
  const token = normalizeLaunchRocketFilter(filter);
  if (token === DEFAULT_LAUNCH_ROCKET_FILTER) return true;
  if (token === '0') return false;
  const disabled = new Set(parseDisabledIds(token) || []);
  return !disabled.has(launchRocketChipId(launch));
}

/**
 * @param {Array<{id?: string, rocketName?: unknown}>|null|undefined} launches
 * @param {unknown} filter
 * @param {string|null} [selectedLaunchId]
 * @returns {Array}
 */
export function filterLaunchesByRocket(launches, filter, selectedLaunchId = null) {
  const list = Array.isArray(launches) ? launches : [];
  return list.filter((launch) => launchPassesRocketFilter(launch, filter, selectedLaunchId));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function readLaunchRocketFilter(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(LAUNCH_ROCKET_FILTER_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_ROCKET_FILTER;
    return normalizeLaunchRocketFilter(raw);
  } catch {
    return DEFAULT_LAUNCH_ROCKET_FILTER;
  }
}

/**
 * @param {unknown} filter
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @param {Iterable<string>|null|undefined} [chipIds]
 * @returns {boolean}
 */
export function writeLaunchRocketFilter(filter, storage, chipIds) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      LAUNCH_ROCKET_FILTER_STORAGE_KEY,
      normalizeLaunchRocketFilter(filter, chipIds),
    );
    return true;
  } catch {
    return false;
  }
}

/** @returns {string} */
export function getLaunchRocketFilter() {
  return sessionFilter;
}

/**
 * @param {unknown} filter
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null, chipIds?: Iterable<string>}} [options]
 * @returns {string}
 */
export function setLaunchRocketFilter(filter, { persist = true, storage, chipIds } = {}) {
  const next = normalizeLaunchRocketFilter(filter, chipIds);
  sessionFilter = next;
  if (persist) writeLaunchRocketFilter(next, storage, chipIds);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function hydrateLaunchRocketFilter(storage) {
  return setLaunchRocketFilter(readLaunchRocketFilter(storage), { persist: false, storage });
}

/**
 * @param {(filter: string) => void} listener
 * @returns {() => void}
 */
export function subscribeLaunchRocketFilter(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore all-on without clearing subscribers. */
export function resetLaunchRocketFilterForTest() {
  sessionFilter = DEFAULT_LAUNCH_ROCKET_FILTER;
}
