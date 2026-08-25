/**
 * Client-side Radio Browser station favorites.
 *
 * Pins already-fetched directory station ids. Playback still uses the
 * existing `/api/radio` broker; this module never fetches Radio Browser or
 * adds an endpoint. Persistence is local only (`meridian.radioFavorites`).
 */

export const RADIO_FAVORITES_STORAGE_KEY = 'meridian.radioFavorites';
export const RADIO_FAVORITES_CAP = 20;

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Accept a directory station id. Empty or oversized values are rejected.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeRadioFavoriteId(value) {
  const id = String(value ?? '').trim();
  if (!id || id.length > 64) return '';
  return id;
}

/**
 * Deduplicate and cap a favorites list. First-seen order is kept.
 * @param {unknown} list
 * @returns {string[]}
 */
export function sanitizeRadioFavoriteIds(list) {
  const seen = new Set();
  const ids = [];
  for (const value of Array.isArray(list) ? list : []) {
    const id = normalizeRadioFavoriteId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= RADIO_FAVORITES_CAP) break;
  }
  return ids;
}

/**
 * Whether one directory station is currently pinned.
 * @param {unknown} stationId
 * @param {Iterable<string>|null|undefined} list
 * @returns {boolean}
 */
export function isRadioFavorite(stationId, list) {
  const id = normalizeRadioFavoriteId(stationId);
  return Boolean(id && sanitizeRadioFavoriteIds(list).includes(id));
}

/**
 * Add a station id. The 21st pin is rejected so the stored set stays at 20.
 * @param {Iterable<string>|null|undefined} list
 * @param {unknown} stationId
 * @returns {{ok: boolean, list: string[], added: boolean, reason: string|null}}
 */
export function addRadioFavorite(list, stationId) {
  const current = sanitizeRadioFavoriteIds(list);
  const id = normalizeRadioFavoriteId(stationId);
  if (!id) return { ok: false, list: current, added: false, reason: 'invalid' };
  if (current.includes(id)) return { ok: true, list: current, added: false, reason: null };
  if (current.length >= RADIO_FAVORITES_CAP) {
    return { ok: false, list: current, added: false, reason: 'full' };
  }
  return { ok: true, list: [...current, id], added: true, reason: null };
}

/**
 * Remove a station id. Missing ids are a no-op.
 * @param {Iterable<string>|null|undefined} list
 * @param {unknown} stationId
 * @returns {{ok: boolean, list: string[], removed: boolean}}
 */
export function removeRadioFavorite(list, stationId) {
  const current = sanitizeRadioFavoriteIds(list);
  const id = normalizeRadioFavoriteId(stationId);
  const next = current.filter((value) => value !== id);
  return { ok: true, list: next, removed: next.length !== current.length };
}

/**
 * Pin or unpin one station id.
 * @param {Iterable<string>|null|undefined} list
 * @param {unknown} stationId
 * @returns {{ok: boolean, list: string[], favorited: boolean, reason: string|null}}
 */
export function toggleRadioFavoriteId(list, stationId) {
  if (isRadioFavorite(stationId, list)) {
    const removed = removeRadioFavorite(list, stationId);
    return { ok: true, list: removed.list, favorited: false, reason: null };
  }
  const added = addRadioFavorite(list, stationId);
  return {
    ok: added.ok,
    list: added.list,
    favorited: added.added,
    reason: added.reason,
  };
}

/**
 * Whether one directory station clears the Favorites-only chip.
 * Off keeps every station already in the current list.
 * @param {object} station
 * @param {Iterable<string>|null|undefined} list
 * @param {{favoritesOnly?: boolean}} [options]
 * @returns {boolean}
 */
export function stationMatchesRadioFavorites(station, list, { favoritesOnly = false } = {}) {
  if (!favoritesOnly) return true;
  return isRadioFavorite(station?.id, list);
}

/**
 * Current-list stations that are still pinned, when the chip is on.
 * @param {Array<object>} stations
 * @param {Iterable<string>|null|undefined} list
 * @param {{favoritesOnly?: boolean}} [options]
 * @returns {Array<object>}
 */
export function filterRadioStationsByFavorites(stations, list, options = {}) {
  return (Array.isArray(stations) ? stations : [])
    .filter((station) => stationMatchesRadioFavorites(station, list, options));
}

/**
 * Read the durable favorite ids. Storage failures fail open to [].
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string[]}
 */
export function readRadioFavoriteIds(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(RADIO_FAVORITES_STORAGE_KEY);
    if (raw == null || raw === '') return [];
    return sanitizeRadioFavoriteIds(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Persist favorite ids. Best-effort; never throws.
 * @param {Iterable<string>|null|undefined} list
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {string[]}
 */
export function writeRadioFavoriteIds(list, storage) {
  const ids = sanitizeRadioFavoriteIds(list);
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(RADIO_FAVORITES_STORAGE_KEY, JSON.stringify(ids));
    }
  } catch {
    // Fail open: the session can still hold the list in memory.
  }
  return ids;
}
