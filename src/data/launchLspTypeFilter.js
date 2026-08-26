/**
 * @module launchLspTypeFilter
 * @description Client-only exclusive All | Commercial | Government chips for
 * the hosted Launches panel. Filters already-fetched Launch Library 2
 * `launch_service_provider.type` on the in-memory `/api/launches` payload.
 * Persistence is local only (`meridian.launchLspType`) and is never written
 * into share URLs. No extra fetch and no new `/api`.
 */

export const LAUNCH_LSP_TYPE_STORAGE_KEY = 'meridian.launchLspType';
export const LAUNCH_LSP_TYPE_CHIP_IDS = Object.freeze(['all', 'commercial', 'government']);
export const LAUNCH_LSP_TYPE_CHIP_LABELS = Object.freeze({
  all: 'All',
  commercial: 'Commercial',
  government: 'Government',
});
export const DEFAULT_LAUNCH_LSP_TYPE_FILTER = 'all';

/** @typedef {'all'|'commercial'|'government'} LaunchLspTypeChipId */

let sessionFilter = DEFAULT_LAUNCH_LSP_TYPE_FILTER;
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
 * Read `launch_service_provider.type` from a raw LL2 2.3.0 row.
 * Detailed mode ships `{ id, name }`; older payloads may use a string.
 * @param {object|null|undefined} launch
 * @returns {string}
 */
export function launchLspTypeFromPayload(launch) {
  if (!launch || typeof launch !== 'object') return '';
  const raw = launch.launch_service_provider?.type ?? launch.lspType;
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object' && typeof raw.name === 'string') {
    return raw.name.trim();
  }
  return '';
}

/**
 * Canonical exclusive chip. Invalid input becomes the All default.
 * @param {unknown} value
 * @returns {LaunchLspTypeChipId}
 */
export function normalizeLaunchLspTypeFilter(value) {
  const text = String(value ?? '').trim().toLowerCase();
  switch (text) {
    case 'commercial':
      return 'commercial';
    case 'government':
      return 'government';
    case 'all':
    case '0':
    case '':
      return DEFAULT_LAUNCH_LSP_TYPE_FILTER;
    default:
      return DEFAULT_LAUNCH_LSP_TYPE_FILTER;
  }
}

/**
 * Keep a launch when the chip is All, or when the LSP type matches.
 * Missing / blank type stays on All and drops on Commercial or Government.
 * @param {{launch_service_provider?: {type?: unknown}, lspType?: unknown}|null|undefined} launch
 * @param {unknown} filter
 * @returns {boolean}
 */
export function launchPassesLspTypeFilter(launch, filter) {
  const chip = normalizeLaunchLspTypeFilter(filter);
  switch (chip) {
    case 'all':
      return true;
    case 'commercial':
    case 'government': {
      const type = launchLspTypeFromPayload(launch).toLowerCase();
      return type === chip;
    }
    default: {
      const unexpected = /** @type {never} */ (chip);
      void unexpected;
      return true;
    }
  }
}

/**
 * @param {Array|null|undefined} launches
 * @param {unknown} [filter]
 * @returns {Array}
 */
export function filterLaunchesByLspType(launches, filter = DEFAULT_LAUNCH_LSP_TYPE_FILTER) {
  const list = Array.isArray(launches) ? launches : [];
  if (normalizeLaunchLspTypeFilter(filter) === DEFAULT_LAUNCH_LSP_TYPE_FILTER) {
    return list.slice();
  }
  return list.filter((launch) => launchPassesLspTypeFilter(launch, filter));
}

/**
 * Exclusive-chip models for the hosted Launches panel.
 * @param {unknown} [current]
 * @returns {Array<{id: LaunchLspTypeChipId, label: string, active: boolean}>}
 */
export function launchLspTypeChipModels(current = DEFAULT_LAUNCH_LSP_TYPE_FILTER) {
  const chip = normalizeLaunchLspTypeFilter(current);
  return LAUNCH_LSP_TYPE_CHIP_IDS.map((id) => {
    switch (id) {
      case 'all':
      case 'commercial':
      case 'government':
        return {
          id,
          label: LAUNCH_LSP_TYPE_CHIP_LABELS[id],
          active: chip === id,
        };
      default: {
        const unexpected = /** @type {never} */ (id);
        void unexpected;
        return { id, label: String(id), active: false };
      }
    }
  });
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {LaunchLspTypeChipId}
 */
export function readLaunchLspTypeFilter(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(LAUNCH_LSP_TYPE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_LSP_TYPE_FILTER;
    return normalizeLaunchLspTypeFilter(raw);
  } catch {
    return DEFAULT_LAUNCH_LSP_TYPE_FILTER;
  }
}

/**
 * @param {unknown} filter
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchLspTypeFilter(filter, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(LAUNCH_LSP_TYPE_STORAGE_KEY, normalizeLaunchLspTypeFilter(filter));
    return true;
  } catch {
    return false;
  }
}

/** @returns {LaunchLspTypeChipId} */
export function getLaunchLspTypeFilter() {
  return sessionFilter;
}

/**
 * Exclusive chip set. Clicking All, Commercial, or Government replaces
 * the current type. LayerStateCoordinator restore hydrates this key;
 * share URLs are never written.
 * @param {unknown} filter
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {LaunchLspTypeChipId}
 */
export function setLaunchLspTypeFilter(filter, { persist = true, storage } = {}) {
  const next = normalizeLaunchLspTypeFilter(filter);
  sessionFilter = next;
  if (persist) writeLaunchLspTypeFilter(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Restore `meridian.launchLspType` without rewriting storage.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {LaunchLspTypeChipId}
 */
export function hydrateLaunchLspTypeFilter(storage) {
  return setLaunchLspTypeFilter(readLaunchLspTypeFilter(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(filter: LaunchLspTypeChipId) => void} listener
 * @returns {() => void}
 */
export function subscribeLaunchLspTypeFilter(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore All without clearing subscribers. */
export function resetLaunchLspTypeFilterForTest() {
  sessionFilter = DEFAULT_LAUNCH_LSP_TYPE_FILTER;
}
