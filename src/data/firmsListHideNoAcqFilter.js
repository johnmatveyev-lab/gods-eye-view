/**
 * Client-only Hide no acq toggle for the hosted FIRES list.
 *
 * Filters the already-fetched trailing-24h snapshot inside `listNearestFires`
 * before the 50-row cap. Distinct from globe Plan 262 Hide no acq
 * (`meridian.firmsHideNoAcq` on firmsHeatmap.js) and from Plan 210 /
 * 219 / 225 / 230 / 252 / 256 / 260 list confidence, FRP, age, Hide no
 * satellite, Hide no sensor, Hide no version, and Hide no day/night
 * chips. Persistence is local only (`meridian.firmsListHideNoAcq` as
 * `1` / `0`). LayerStateCoordinator restore hydrates this key; there is
 * no share-URL write, no extra NASA fetch, and no new /api.
 *
 * Off (default) keeps missing / non-finite / `acqMs<=0`. On is
 * presence-only: hides those sentinels and keeps a real epoch
 * (`acqMs > 0`). This is not an age floor. A selected fire always stays.
 */

export const FIRMS_LIST_HIDE_NO_ACQ_STORAGE_KEY = 'meridian.firmsListHideNoAcq';
export const DEFAULT_FIRMS_LIST_HIDE_NO_ACQ = false;
export const FIRMS_LIST_HIDE_NO_ACQ_CHIP_ID = 'hide-no-acq';
export const FIRMS_LIST_HIDE_NO_ACQ_CHIP_LABEL = 'Hide no acq';
export const FIRMS_LIST_HIDE_NO_ACQ_CHIP_TITLE =
  'Hide detections with no acquisition time on the FIRES list';

/** @typedef {boolean} FirmsListHideNoAcq */

let sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_ACQ;
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
export function normalizeFirmsListHideNoAcq(value) {
  if (value == null || value === '') return DEFAULT_FIRMS_LIST_HIDE_NO_ACQ;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Acquisition epoch already present on adapted list rows. Missing /
 * non-finite / `acqMs<=0` collapse to 0.
 * @param {Object|null|undefined} fire
 * @returns {number}
 */
export function fireListAcqMs(fire) {
  const acqMs = Number(fire?.acqMs);
  return Number.isFinite(acqMs) ? acqMs : 0;
}

/**
 * Whether one detection already carries a real acquisition epoch.
 * Missing, non-finite, and `acqMs <= 0` fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasListAcq(fire) {
  return fireListAcqMs(fire) > 0;
}

/**
 * Whether one detection clears Hide no acq. Off always passes.
 * A selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hideNoAcq
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function fireMeetsListHideNoAcq(fire, hideNoAcq, { selectedId = null } = {}) {
  const selected = selectedId == null || selectedId === '' ? '' : String(selectedId);
  if (selected) {
    const id = fireListId(fire);
    if (id && id === selected) return true;
  }
  if (normalizeFirmsListHideNoAcq(hideNoAcq) !== true) return true;
  return fireHasListAcq(fire);
}

/**
 * Keep detections with `acqMs > 0` when Hide no acq is on. Off returns
 * a shallow copy so the current 50-row ranking stays unchanged.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hideNoAcq]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<Object>}
 */
export function filterFiresByListHideNoAcq(fires, hideNoAcq, { selectedId = null } = {}) {
  const list = Array.isArray(fires) ? fires : [];
  if (normalizeFirmsListHideNoAcq(hideNoAcq) !== true && !selectedId) return list.slice();
  return list.filter((fire) => fireMeetsListHideNoAcq(fire, hideNoAcq, { selectedId }));
}

/**
 * Toggle-chip model for the hosted FIRES list row.
 * @param {unknown} [current]
 * @returns {object}
 */
export function firmsListHideNoAcqChipModel(current = DEFAULT_FIRMS_LIST_HIDE_NO_ACQ) {
  const hide = normalizeFirmsListHideNoAcq(current) === true;
  return {
    id: FIRMS_LIST_HIDE_NO_ACQ_CHIP_ID,
    label: FIRMS_LIST_HIDE_NO_ACQ_CHIP_LABEL,
    title: FIRMS_LIST_HIDE_NO_ACQ_CHIP_TITLE,
    active: hide,
    group: 'ListAcq',
    params: { firmsListHideNoAcq: !hide },
  };
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsListHideNoAcq(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_LIST_HIDE_NO_ACQ_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_LIST_HIDE_NO_ACQ;
    return normalizeFirmsListHideNoAcq(raw) === true;
  } catch {
    return DEFAULT_FIRMS_LIST_HIDE_NO_ACQ;
  }
}

/**
 * Persist `meridian.firmsListHideNoAcq` as `'1'` / `'0'`.
 * @param {unknown} hideNoAcq
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsListHideNoAcq(hideNoAcq, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeFirmsListHideNoAcq(hideNoAcq);
    if (next == null) return false;
    store.setItem(FIRMS_LIST_HIDE_NO_ACQ_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getFirmsListHideNoAcq() {
  return sessionFilter;
}

/**
 * Toggle set. Clicking Hide no acq flips the preference.
 * @param {unknown} hideNoAcq
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setFirmsListHideNoAcq(hideNoAcq, { persist = true, storage } = {}) {
  const next = normalizeFirmsListHideNoAcq(hideNoAcq) === true;
  sessionFilter = next;
  if (persist) writeFirmsListHideNoAcq(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateFirmsListHideNoAcq(storage) {
  return setFirmsListHideNoAcq(readFirmsListHideNoAcq(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(hideNoAcq: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeFirmsListHideNoAcq(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetFirmsListHideNoAcqForTest() {
  sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_ACQ;
}
