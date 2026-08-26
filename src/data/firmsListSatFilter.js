/**
 * Client-only Hide no satellite toggle for the hosted FIRES list.
 *
 * Filters the already-fetched trailing-24h snapshot inside `listNearestFires`
 * before the 50-row cap. Distinct from the globe Plan 163 satellite chips
 * and Plan 210 / 219 / 225 list confidence, FRP, and age chips.
 * Persistence is local only (`meridian.firmsListHideNoSat` as `1` / `0`).
 * LayerStateCoordinator restore hydrates this key; there is no share-URL
 * write, no extra NASA fetch, and no new /api.
 *
 * Off (default) keeps missing + present satellite/sensor. On keeps a
 * non-empty `satelliteShortName(satellite)` or `sensor` after trim.
 * Empty / whitespace satellite+sensor is a hide when on. A selected fire
 * always stays.
 */

import { satelliteShortName } from './firmsLabels.js';

export const FIRMS_LIST_HIDE_NO_SAT_STORAGE_KEY = 'meridian.firmsListHideNoSat';
export const DEFAULT_FIRMS_LIST_HIDE_NO_SAT = false;
export const FIRMS_LIST_HIDE_NO_SAT_CHIP_ID = 'hide-no-sat';
export const FIRMS_LIST_HIDE_NO_SAT_CHIP_LABEL = 'Hide no satellite';
export const FIRMS_LIST_HIDE_NO_SAT_CHIP_TITLE =
  'Hide detections with no satellite on the FIRES list';

/** @typedef {boolean} FirmsListHideNoSat */

let sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_SAT;
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
export function normalizeFirmsListHideNoSat(value) {
  if (value == null || value === '') return DEFAULT_FIRMS_LIST_HIDE_NO_SAT;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Same label `formatFireListRow` prints: compact satellite, else sensor.
 * Empty / whitespace satellite+sensor collapse to ''.
 * @param {Object|null|undefined} fire
 * @returns {string}
 */
export function fireListSatelliteLabel(fire) {
  const sat = String(satelliteShortName(fire?.satellite) || '').trim();
  if (sat) return sat;
  return String(fire?.sensor || '').trim();
}

/**
 * Whether one detection already carries a non-empty satellite or sensor.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasListSatellite(fire) {
  return fireListSatelliteLabel(fire) !== '';
}

/**
 * Whether one detection clears Hide no satellite. Off always passes.
 * A selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hideNoSat
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function fireMeetsListHideNoSat(fire, hideNoSat, { selectedId = null } = {}) {
  const selected = selectedId == null || selectedId === '' ? '' : String(selectedId);
  if (selected) {
    const id = fireListId(fire);
    if (id && id === selected) return true;
  }
  if (normalizeFirmsListHideNoSat(hideNoSat) !== true) return true;
  return fireHasListSatellite(fire);
}

/**
 * Keep detections with a filled satellite or sensor when Hide no satellite
 * is on. Off returns a shallow copy so the current 50-row ranking stays
 * unchanged.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hideNoSat]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<Object>}
 */
export function filterFiresByListHideNoSat(fires, hideNoSat, { selectedId = null } = {}) {
  const list = Array.isArray(fires) ? fires : [];
  if (normalizeFirmsListHideNoSat(hideNoSat) !== true && !selectedId) return list.slice();
  return list.filter((fire) => fireMeetsListHideNoSat(fire, hideNoSat, { selectedId }));
}

/**
 * Toggle-chip model for the hosted FIRES list row.
 * @param {unknown} [current]
 * @returns {object}
 */
export function firmsListHideNoSatChipModel(current = DEFAULT_FIRMS_LIST_HIDE_NO_SAT) {
  const hide = normalizeFirmsListHideNoSat(current) === true;
  return {
    id: FIRMS_LIST_HIDE_NO_SAT_CHIP_ID,
    label: FIRMS_LIST_HIDE_NO_SAT_CHIP_LABEL,
    title: FIRMS_LIST_HIDE_NO_SAT_CHIP_TITLE,
    active: hide,
    group: 'ListSat',
    params: { firmsListHideNoSat: !hide },
  };
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsListHideNoSat(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_LIST_HIDE_NO_SAT_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_LIST_HIDE_NO_SAT;
    return normalizeFirmsListHideNoSat(raw) === true;
  } catch {
    return DEFAULT_FIRMS_LIST_HIDE_NO_SAT;
  }
}

/**
 * Persist `meridian.firmsListHideNoSat` as `'1'` / `'0'`.
 * @param {unknown} hideNoSat
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsListHideNoSat(hideNoSat, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeFirmsListHideNoSat(hideNoSat);
    if (next == null) return false;
    store.setItem(FIRMS_LIST_HIDE_NO_SAT_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getFirmsListHideNoSat() {
  return sessionFilter;
}

/**
 * Toggle set. Clicking Hide no satellite flips the preference.
 * @param {unknown} hideNoSat
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setFirmsListHideNoSat(hideNoSat, { persist = true, storage } = {}) {
  const next = normalizeFirmsListHideNoSat(hideNoSat) === true;
  sessionFilter = next;
  if (persist) writeFirmsListHideNoSat(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateFirmsListHideNoSat(storage) {
  return setFirmsListHideNoSat(readFirmsListHideNoSat(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(hideNoSat: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeFirmsListHideNoSat(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetFirmsListHideNoSatForTest() {
  sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_SAT;
}
