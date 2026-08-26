/**
 * Client-only Hide no track toggle for the hosted FIRES list.
 *
 * Filters the already-fetched trailing-24h snapshot inside `listNearestFires`
 * before the 50-row cap. Distinct from the globe track-size ceiling
 * (`meridian.firmsTrack` on firmsTrackFilter.js / firmsHeatmap.js), from
 * globe Plan 267 Hide no brightness, and from Plan 210 / 219 / 225 /
 * 230 / 252 / 256 / 260 / 266 / 271 list confidence, FRP, age, Hide no
 * satellite, Hide no sensor, Hide no version, Hide no day/night, Hide
 * no acq, and Hide no scan chips. Persistence is local only
 * (`meridian.firmsListHideNoTrack` as `1` / `0`). LayerStateCoordinator
 * restore hydrates this key; there is no share-URL write, no extra NASA
 * fetch, and no new /api.
 *
 * Off (default) keeps missing / non-finite / `trackKm<=0`. On is
 * presence-only: hides those sentinels and keeps a real track
 * (`trackKm > 0`, e.g. 1.0 km). This is not a track-size ceiling. A
 * selected fire always stays.
 */

export const FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY = 'meridian.firmsListHideNoTrack';
export const DEFAULT_FIRMS_LIST_HIDE_NO_TRACK = false;
export const FIRMS_LIST_HIDE_NO_TRACK_CHIP_ID = 'hide-no-track';
export const FIRMS_LIST_HIDE_NO_TRACK_CHIP_LABEL = 'Hide no track';
export const FIRMS_LIST_HIDE_NO_TRACK_CHIP_TITLE =
  'Hide detections with no track size on the FIRES list';

/** @typedef {boolean} FirmsListHideNoTrack */

let sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_TRACK;
const listeners = new Set();

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function fireListId(fire) {
  if (fire?.id != null && fire.id !== '') return String(fire.id);
  return '';
}

/**
 * Canonical on/off. Invalid input returns null so readers fail closed to off.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeFirmsListHideNoTrack(value) {
  if (value == null || value === '') return DEFAULT_FIRMS_LIST_HIDE_NO_TRACK;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Track km already present on adapted list rows. Missing / non-finite /
 * `trackKm<=0` collapse to 0.
 * @param {Object|null|undefined} fire
 * @returns {number}
 */
export function fireListTrackKm(fire) {
  const trackKm = Number(fire?.trackKm);
  return Number.isFinite(trackKm) ? trackKm : 0;
}

/**
 * Whether one detection already carries a real track size.
 * Missing, non-finite, and `trackKm <= 0` fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasListTrack(fire) {
  return fireListTrackKm(fire) > 0;
}

/**
 * Whether one detection clears Hide no track. Off always passes.
 * A selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hideNoTrack
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function fireMeetsListHideNoTrack(fire, hideNoTrack, { selectedId = null } = {}) {
  const selected = selectedId == null || selectedId === '' ? '' : String(selectedId);
  if (selected) {
    const id = fireListId(fire);
    if (id && id === selected) return true;
  }
  if (normalizeFirmsListHideNoTrack(hideNoTrack) !== true) return true;
  return fireHasListTrack(fire);
}

/**
 * Keep detections with `trackKm > 0` when Hide no track is on. Off returns
 * a shallow copy so the current 50-row ranking stays unchanged.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hideNoTrack]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<Object>}
 */
export function filterFiresByListHideNoTrack(fires, hideNoTrack, { selectedId = null } = {}) {
  const list = Array.isArray(fires) ? fires : [];
  if (normalizeFirmsListHideNoTrack(hideNoTrack) !== true && !selectedId) return list.slice();
  return list.filter((fire) => fireMeetsListHideNoTrack(fire, hideNoTrack, { selectedId }));
}

/**
 * Toggle-chip model for the hosted FIRES list row.
 * @param {unknown} [current]
 * @returns {object}
 */
export function firmsListHideNoTrackChipModel(current = DEFAULT_FIRMS_LIST_HIDE_NO_TRACK) {
  const hide = normalizeFirmsListHideNoTrack(current) === true;
  return {
    id: FIRMS_LIST_HIDE_NO_TRACK_CHIP_ID,
    label: FIRMS_LIST_HIDE_NO_TRACK_CHIP_LABEL,
    title: FIRMS_LIST_HIDE_NO_TRACK_CHIP_TITLE,
    active: hide,
    group: 'ListTrack',
    params: { firmsListHideNoTrack: !hide },
  };
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsListHideNoTrack(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_LIST_HIDE_NO_TRACK;
    return normalizeFirmsListHideNoTrack(raw) === true;
  } catch {
    return DEFAULT_FIRMS_LIST_HIDE_NO_TRACK;
  }
}

/**
 * Persist `meridian.firmsListHideNoTrack` as `'1'` / `'0'`.
 * @param {unknown} hideNoTrack
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsListHideNoTrack(hideNoTrack, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeFirmsListHideNoTrack(hideNoTrack);
    if (next == null) return false;
    store.setItem(FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getFirmsListHideNoTrack() {
  return sessionFilter;
}

/**
 * Toggle set. Clicking Hide no track flips the preference.
 * @param {unknown} hideNoTrack
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setFirmsListHideNoTrack(hideNoTrack, { persist = true, storage } = {}) {
  const next = normalizeFirmsListHideNoTrack(hideNoTrack) === true;
  sessionFilter = next;
  if (persist) writeFirmsListHideNoTrack(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateFirmsListHideNoTrack(storage) {
  return setFirmsListHideNoTrack(readFirmsListHideNoTrack(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(hideNoTrack: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeFirmsListHideNoTrack(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetFirmsListHideNoTrackForTest() {
  sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_TRACK;
}
