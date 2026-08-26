/**
 * Client-only exclusive All | Go | TBD chips for the hosted Launches panel.
 *
 * Filters already-fetched Launch Library 2 panel rows by the `status`
 * name `launchesPanelRows` already copies. Never fetches Launch Library 2
 * and adds no endpoint. Persistence is local only
 * (`meridian.launchListStatus`) and is never written into share URLs.
 * LayerStateCoordinator restore of globe / LSP-type / mapped-only
 * options does not wipe this key; the hosted list re-reads it when
 * painting rows.
 *
 * All is the current panel list (Go / TBD / Hold stay).
 * Go keeps status name Go (case-insensitive) and drops TBD.
 * TBD keeps TBD / TBC and drops Go.
 * Missing / Unknown status fails open (keep). A selected id stays.
 * Distinct from Plan 207 LSP-type, Plan 215 mapped-only, and the
 * globe `meridian.launchStatus` chips on rocketLaunches.js.
 */

export const DEFAULT_LAUNCH_LIST_STATUS_FILTER = 'all';
export const LAUNCH_LIST_STATUS_STORAGE_KEY = 'meridian.launchListStatus';
export const LAUNCH_LIST_STATUS_CHIP_IDS = Object.freeze(['all', 'go', 'tbd']);
export const LAUNCH_LIST_STATUS_CHIP_LABELS = Object.freeze({
  all: 'All',
  go: 'Go',
  tbd: 'TBD',
});
export const LAUNCH_LIST_STATUS_CHIP_TITLES = Object.freeze({
  all: 'Show every mission regardless of launch status',
  go: 'Show only missions with a Go status',
  tbd: 'Show only missions with a TBD or TBC status',
});

/** @typedef {'all'|'go'|'tbd'} LaunchListStatusChipId */

let sessionFilter = DEFAULT_LAUNCH_LIST_STATUS_FILTER;
const listeners = new Set();

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Canonical exclusive chip. Invalid input becomes the All default.
 * @param {unknown} value
 * @returns {LaunchListStatusChipId}
 */
export function normalizeLaunchListStatusFilter(value) {
  const text = String(value ?? '').trim().toLowerCase();
  switch (text) {
    case 'go':
      return 'go';
    case 'tbd':
      return 'tbd';
    case 'all':
    case '0':
    case '':
      return DEFAULT_LAUNCH_LIST_STATUS_FILTER;
    default:
      return DEFAULT_LAUNCH_LIST_STATUS_FILTER;
  }
}

/**
 * Read the copied panel `status` (string or `{ name }`).
 * @param {{status?: unknown}|null|undefined} row
 * @returns {string}
 */
export function launchListStatusName(row) {
  const raw = row?.status;
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object' && typeof raw.name === 'string') return raw.name.trim();
  return '';
}

function statusFailsOpen(name) {
  const text = String(name || '').trim().toLowerCase();
  return text === '' || text === 'unknown';
}

/**
 * Whether one panel row clears the exclusive status chip.
 * All always passes. Missing / Unknown fails open. A selected id stays.
 * @param {{id?: unknown, status?: unknown}|null|undefined} row
 * @param {unknown} filter
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function launchListRowMatchesStatusFilter(row, filter, { selectedId = null } = {}) {
  const id = String(row?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  const chip = normalizeLaunchListStatusFilter(filter);
  switch (chip) {
    case 'all':
      return true;
    case 'go':
    case 'tbd': {
      const name = launchListStatusName(row);
      if (statusFailsOpen(name)) return true;
      const key = name.toLowerCase();
      if (chip === 'go') return key === 'go';
      return key === 'tbd' || key === 'tbc';
    }
    default: {
      const unexpected = /** @type {never} */ (chip);
      void unexpected;
      return true;
    }
  }
}

/**
 * Re-filter already-built panel rows. All returns a shallow copy.
 * @param {Array<object>|null|undefined} rows
 * @param {unknown} [filter=DEFAULT_LAUNCH_LIST_STATUS_FILTER]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterLaunchListByStatus(
  rows,
  filter = DEFAULT_LAUNCH_LIST_STATUS_FILTER,
  selectedId = null,
) {
  if (!Array.isArray(rows)) return [];
  if (normalizeLaunchListStatusFilter(filter) === DEFAULT_LAUNCH_LIST_STATUS_FILTER) {
    return rows.slice();
  }
  return rows.filter((row) => launchListRowMatchesStatusFilter(row, filter, { selectedId }));
}

/**
 * Exclusive-chip models for the hosted Launches panel.
 * @param {unknown} [current=DEFAULT_LAUNCH_LIST_STATUS_FILTER]
 * @returns {Array<{id: LaunchListStatusChipId, label: string, title: string, active: boolean}>}
 */
export function launchListStatusChipModels(current = DEFAULT_LAUNCH_LIST_STATUS_FILTER) {
  const chip = normalizeLaunchListStatusFilter(current);
  return LAUNCH_LIST_STATUS_CHIP_IDS.map((id) => {
    switch (id) {
      case 'all':
      case 'go':
      case 'tbd':
        return {
          id,
          label: LAUNCH_LIST_STATUS_CHIP_LABELS[id],
          title: LAUNCH_LIST_STATUS_CHIP_TITLES[id],
          active: chip === id,
        };
      default: {
        const unexpected = /** @type {never} */ (id);
        void unexpected;
        return { id, label: String(id), title: '', active: false };
      }
    }
  });
}

/**
 * Read `meridian.launchListStatus`. Missing or invalid storage is All.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {LaunchListStatusChipId}
 */
export function readLaunchListStatusFilter(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(LAUNCH_LIST_STATUS_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_LIST_STATUS_FILTER;
    return normalizeLaunchListStatusFilter(raw);
  } catch {
    return DEFAULT_LAUNCH_LIST_STATUS_FILTER;
  }
}

/**
 * Write `meridian.launchListStatus` as the exclusive chip id.
 * @param {unknown} filter
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchListStatusFilter(filter, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(LAUNCH_LIST_STATUS_STORAGE_KEY, normalizeLaunchListStatusFilter(filter));
    return true;
  } catch {
    return false;
  }
}

/** @returns {LaunchListStatusChipId} */
export function getLaunchListStatusFilter() {
  return sessionFilter;
}

/**
 * Exclusive chip set. Clicking All, Go, or TBD replaces the current
 * status. LayerStateCoordinator restore hydrates this key; share URLs
 * are never written.
 * @param {unknown} filter
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {LaunchListStatusChipId}
 */
export function setLaunchListStatusFilter(filter, { persist = true, storage } = {}) {
  const next = normalizeLaunchListStatusFilter(filter);
  sessionFilter = next;
  if (persist) writeLaunchListStatusFilter(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Restore `meridian.launchListStatus` without rewriting storage.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {LaunchListStatusChipId}
 */
export function hydrateLaunchListStatusFilter(storage) {
  return setLaunchListStatusFilter(readLaunchListStatusFilter(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(filter: LaunchListStatusChipId) => void} listener
 * @returns {() => void}
 */
export function subscribeLaunchListStatusFilter(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore All without clearing subscribers. */
export function resetLaunchListStatusFilterForTest() {
  sessionFilter = DEFAULT_LAUNCH_LIST_STATUS_FILTER;
}
