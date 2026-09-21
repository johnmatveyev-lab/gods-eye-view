/**
 * Client-only Hide no TI5 toggle for the hosted FIRES list.
 *
 * Filters the already-fetched trailing-24h snapshot inside `listNearestFires`
 * before the 50-row cap. Distinct from the globe TI5 floor
 * (`meridian.firmsBrightnessTi5` All | 290+ | 310+, which fail-opens
 * missing / non-finite / `brightnessTi5 <= 0`), from globe Plan 290
 * Hide no TI5 (`meridian.firmsHideNoTi5`), from Plan 267 Hide no
 * brightness (TI4 `fire.brightness`), and from list confidence / FRP /
 * age / hide-no chips through Plan 288. Persistence is local only
 * (`meridian.firmsListHideNoTi5` as `1` / `0`). Restore hydrates this
 * key from the list attach path; there is no share-URL write, no extra
 * NASA fetch, and no new /api.
 *
 * Off (default) keeps missing / non-finite / `brightnessTi5 <= 0`. On is
 * presence-only: hides those sentinels and keeps finite `brightnessTi5 > 0`.
 * `0` hides when on — not the confidence "0 stays" rule. A selected fire
 * always stays.
 */

export const FIRMS_LIST_HIDE_NO_TI5_STORAGE_KEY = 'meridian.firmsListHideNoTi5';
export const DEFAULT_FIRMS_LIST_HIDE_NO_TI5 = false;
export const FIRMS_LIST_HIDE_NO_TI5_CHIP_ID = 'hide-no-ti5';
export const FIRMS_LIST_HIDE_NO_TI5_CHIP_LABEL = 'Hide no TI5';
export const FIRMS_LIST_HIDE_NO_TI5_CHIP_TITLE =
  'Hide detections with no TI5 brightness on the FIRES list';

let sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_TI5;
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
export function normalizeFirmsListHideNoTi5(value) {
  if (value == null || value === '') return DEFAULT_FIRMS_LIST_HIDE_NO_TI5;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Whether one detection already carries a real mid-IR TI5 Kelvin.
 * Missing, non-finite, and `brightnessTi5 <= 0` fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasListBrightnessTi5(fire) {
  const brightnessTi5 = Number(fire?.brightnessTi5);
  return Number.isFinite(brightnessTi5) && brightnessTi5 > 0;
}

/**
 * Whether one detection clears Hide no TI5. Off always passes.
 * A selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hideNoTi5
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function fireMeetsListHideNoTi5(fire, hideNoTi5, { selectedId = null } = {}) {
  const selected = selectedId == null || selectedId === '' ? '' : String(selectedId);
  if (selected) {
    const id = fireListId(fire);
    if (id && id === selected) return true;
  }
  if (normalizeFirmsListHideNoTi5(hideNoTi5) !== true) return true;
  return fireHasListBrightnessTi5(fire);
}

/**
 * Keep detections with `brightnessTi5 > 0` when Hide no TI5 is on.
 * Off returns a shallow copy so the current 50-row ranking stays unchanged.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hideNoTi5]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<Object>}
 */
export function filterFiresByListHideNoTi5(fires, hideNoTi5, { selectedId = null } = {}) {
  const list = Array.isArray(fires) ? fires : [];
  if (normalizeFirmsListHideNoTi5(hideNoTi5) !== true && !selectedId) return list.slice();
  return list.filter((fire) => fireMeetsListHideNoTi5(fire, hideNoTi5, { selectedId }));
}

/**
 * Toggle-chip model for the hosted FIRES list row.
 * @param {unknown} [current]
 * @returns {object}
 */
export function firmsListHideNoTi5ChipModel(current = DEFAULT_FIRMS_LIST_HIDE_NO_TI5) {
  const hide = normalizeFirmsListHideNoTi5(current) === true;
  return {
    id: FIRMS_LIST_HIDE_NO_TI5_CHIP_ID,
    label: FIRMS_LIST_HIDE_NO_TI5_CHIP_LABEL,
    title: FIRMS_LIST_HIDE_NO_TI5_CHIP_TITLE,
    active: hide,
    group: 'ListHideNoTi5',
    params: { firmsListHideNoTi5: !hide },
  };
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsListHideNoTi5(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_LIST_HIDE_NO_TI5_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_LIST_HIDE_NO_TI5;
    return normalizeFirmsListHideNoTi5(raw) === true;
  } catch {
    return DEFAULT_FIRMS_LIST_HIDE_NO_TI5;
  }
}

/**
 * Persist `meridian.firmsListHideNoTi5` as `'1'` / `'0'`.
 * @param {unknown} hideNoTi5
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsListHideNoTi5(hideNoTi5, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeFirmsListHideNoTi5(hideNoTi5);
    if (next == null) return false;
    store.setItem(FIRMS_LIST_HIDE_NO_TI5_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getFirmsListHideNoTi5() {
  return sessionFilter;
}

/**
 * Toggle set. Clicking Hide no TI5 flips the preference.
 * @param {unknown} hideNoTi5
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setFirmsListHideNoTi5(hideNoTi5, { persist = true, storage } = {}) {
  const next = normalizeFirmsListHideNoTi5(hideNoTi5) === true;
  sessionFilter = next;
  if (persist) writeFirmsListHideNoTi5(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * List attach restore path. Reads the local key and applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateFirmsListHideNoTi5(storage) {
  return setFirmsListHideNoTi5(readFirmsListHideNoTi5(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(hideNoTi5: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeFirmsListHideNoTi5(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetFirmsListHideNoTi5ForTest() {
  sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_TI5;
}
