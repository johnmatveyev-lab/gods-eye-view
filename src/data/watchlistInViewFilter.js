/**
 * Client-only watchlist In-view-only toggle.
 *
 * Gates the Watch panel list against `highlightedWatchIdents` — the pins
 * already present in the current flights payload. Off keeps today's full
 * list with "not in view" rows. Does not invent positions, change the
 * 10-ident cap, or fetch. Persistence is local only
 * (`meridian.watchlistInViewOnly`). No /api.
 */

export const WATCHLIST_IN_VIEW_ONLY_STORAGE_KEY = 'meridian.watchlistInViewOnly';
export const WATCHLIST_IN_VIEW_ONLY_CHIP_ID = 'watchlist-in-view-only';
export const WATCHLIST_IN_VIEW_ONLY_CHIP_LABEL = 'In-view-only';
export const WATCHLIST_IN_VIEW_ONLY_CHIP_TITLE =
  'Hide watched aircraft that are not in the current flights view';
export const DEFAULT_WATCHLIST_IN_VIEW_ONLY = false;
export const WATCHLIST_NONE_IN_VIEW = 'None in view';

let sessionInViewOnly = DEFAULT_WATCHLIST_IN_VIEW_ONLY;
const listeners = new Set();

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function normalizeWatchIdent(value) {
  return String(value ?? '').trim().toUpperCase();
}

function inViewIdentSet(inViewIdents) {
  const set = new Set();
  const values = inViewIdents instanceof Set
    ? inViewIdents
    : (Array.isArray(inViewIdents) ? inViewIdents : []);
  for (const value of values) {
    const ident = normalizeWatchIdent(value);
    if (ident) set.add(ident);
  }
  return set;
}

/**
 * Canonical on/off. Invalid input becomes the off default.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeWatchlistInViewOnly(value) {
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 'on') {
    return true;
  }
  return DEFAULT_WATCHLIST_IN_VIEW_ONLY;
}

/**
 * Whether a watched ident should appear in the panel.
 * Off always keeps the row. On keeps only idents already in the in-view set
 * (`highlightedWatchIdents`).
 * @param {unknown} ident
 * @param {Iterable<string>|Set<string>|null|undefined} inViewIdents
 * @param {unknown} inViewOnly
 * @returns {boolean}
 */
export function watchIdentMatchesInViewFilter(ident, inViewIdents, inViewOnly) {
  if (normalizeWatchlistInViewOnly(inViewOnly) !== true) return true;
  const needle = normalizeWatchIdent(ident);
  if (!needle) return false;
  return inViewIdentSet(inViewIdents).has(needle);
}

/**
 * Panel rows after In-view-only. Off returns a shallow copy (current view).
 * On keeps only idents already returned by `highlightedWatchIdents`.
 * @param {Iterable<string>|null|undefined} list
 * @param {Iterable<string>|Set<string>|null|undefined} inViewIdents
 * @param {unknown} [inViewOnly=DEFAULT_WATCHLIST_IN_VIEW_ONLY]
 * @returns {string[]}
 */
export function filterWatchlistByInView(
  list,
  inViewIdents,
  inViewOnly = DEFAULT_WATCHLIST_IN_VIEW_ONLY,
) {
  const idents = Array.isArray(list) ? list.slice() : [];
  if (normalizeWatchlistInViewOnly(inViewOnly) !== true) return idents;
  const visible = inViewIdentSet(inViewIdents);
  return idents.filter((ident) => visible.has(normalizeWatchIdent(ident)));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readWatchlistInViewOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(WATCHLIST_IN_VIEW_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_WATCHLIST_IN_VIEW_ONLY;
    return normalizeWatchlistInViewOnly(raw);
  } catch {
    return DEFAULT_WATCHLIST_IN_VIEW_ONLY;
  }
}

/**
 * Persist as `'1'` / `'0'`. Best-effort; never throws.
 * @param {unknown} inViewOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeWatchlistInViewOnly(inViewOnly, storage) {
  const next = normalizeWatchlistInViewOnly(inViewOnly);
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return next;
    store.setItem(WATCHLIST_IN_VIEW_ONLY_STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Fail open: the session can still hold the chip in memory.
  }
  return next;
}

/** @returns {boolean} */
export function getWatchlistInViewOnly() {
  return sessionInViewOnly;
}

/**
 * @param {unknown} inViewOnly
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setWatchlistInViewOnly(inViewOnly, { persist = true, storage } = {}) {
  const next = normalizeWatchlistInViewOnly(inViewOnly);
  sessionInViewOnly = next;
  if (persist) writeWatchlistInViewOnly(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateWatchlistInViewOnly(storage) {
  return setWatchlistInViewOnly(readWatchlistInViewOnly(storage), { persist: false, storage });
}

/**
 * @param {(inViewOnly: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeWatchlistInViewOnly(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetWatchlistInViewOnlyForTest() {
  sessionInViewOnly = DEFAULT_WATCHLIST_IN_VIEW_ONLY;
}
