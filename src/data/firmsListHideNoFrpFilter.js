/**
 * Client-only Hide no FRP toggle for the hosted FIRES list.
 *
 * Filters the already-fetched trailing-24h snapshot inside `listNearestFires`
 * before the 50-row cap. Distinct from the list FRP floor
 * (`meridian.firmsListFrp` All | 10+ | 100+ on firmsListFrpFilter.js,
 * which fail-opens missing FRP), from globe Plan 281 Hide no FRP
 * (`meridian.firmsHideNoFrp` on firmsHeatmap.js), and from Plan 210 /
 * 219 / 225 / 230 / 252 / 256 / 260 / 266 / 271 / 276 list confidence,
 * FRP floor, age, Hide no satellite, Hide no sensor, Hide no version,
 * Hide no day/night, Hide no acq, Hide no scan, and Hide no track
 * chips. Persistence is local only (`meridian.firmsListHideNoFrp` as
 * `1` / `0`). LayerStateCoordinator restore hydrates this key; there
 * is no share-URL write, no extra NASA fetch, and no new /api.
 *
 * Off (default) keeps missing / non-finite / `frp<=0`. On is
 * presence-only: hides those sentinels and keeps a real MW
 * (`frp > 0`, e.g. 120 MW). This is not an FRP floor. A selected
 * fire always stays.
 */

export const FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY = 'meridian.firmsListHideNoFrp';
export const DEFAULT_FIRMS_LIST_HIDE_NO_FRP = false;
export const FIRMS_LIST_HIDE_NO_FRP_CHIP_ID = 'hide-no-frp';
export const FIRMS_LIST_HIDE_NO_FRP_CHIP_LABEL = 'Hide no FRP';
export const FIRMS_LIST_HIDE_NO_FRP_CHIP_TITLE =
  'Hide detections with no FRP on the FIRES list';

/** @typedef {boolean} FirmsListHideNoFrp */

let sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_FRP;
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
export function normalizeFirmsListHideNoFrp(value) {
  if (value == null || value === '') return DEFAULT_FIRMS_LIST_HIDE_NO_FRP;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * FRP already present on adapted list rows. Missing / non-finite /
 * `frp<=0` collapse to 0.
 * @param {Object|null|undefined} fire
 * @returns {number}
 */
export function fireListFrpMw(fire) {
  const frp = Number(fire?.frp);
  return Number.isFinite(frp) ? frp : 0;
}

/**
 * Whether one detection already carries a real FRP.
 * Missing, non-finite, and `frp <= 0` fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasListFrp(fire) {
  return fireListFrpMw(fire) > 0;
}

/**
 * Whether one detection clears Hide no FRP. Off always passes.
 * A selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hideNoFrp
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function fireMeetsListHideNoFrp(fire, hideNoFrp, { selectedId = null } = {}) {
  const selected = selectedId == null || selectedId === '' ? '' : String(selectedId);
  if (selected) {
    const id = fireListId(fire);
    if (id && id === selected) return true;
  }
  if (normalizeFirmsListHideNoFrp(hideNoFrp) !== true) return true;
  return fireHasListFrp(fire);
}

/**
 * Keep detections with `frp > 0` when Hide no FRP is on. Off returns
 * a shallow copy so the current 50-row ranking stays unchanged.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hideNoFrp]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<Object>}
 */
export function filterFiresByListHideNoFrp(fires, hideNoFrp, { selectedId = null } = {}) {
  const list = Array.isArray(fires) ? fires : [];
  if (normalizeFirmsListHideNoFrp(hideNoFrp) !== true && !selectedId) return list.slice();
  return list.filter((fire) => fireMeetsListHideNoFrp(fire, hideNoFrp, { selectedId }));
}

/**
 * Toggle-chip model for the hosted FIRES list row.
 * @param {unknown} [current]
 * @returns {object}
 */
export function firmsListHideNoFrpChipModel(current = DEFAULT_FIRMS_LIST_HIDE_NO_FRP) {
  const hide = normalizeFirmsListHideNoFrp(current) === true;
  return {
    id: FIRMS_LIST_HIDE_NO_FRP_CHIP_ID,
    label: FIRMS_LIST_HIDE_NO_FRP_CHIP_LABEL,
    title: FIRMS_LIST_HIDE_NO_FRP_CHIP_TITLE,
    active: hide,
    group: 'ListHideNoFrp',
    params: { firmsListHideNoFrp: !hide },
  };
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsListHideNoFrp(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_LIST_HIDE_NO_FRP;
    return normalizeFirmsListHideNoFrp(raw) === true;
  } catch {
    return DEFAULT_FIRMS_LIST_HIDE_NO_FRP;
  }
}

/**
 * Persist `meridian.firmsListHideNoFrp` as `'1'` / `'0'`.
 * @param {unknown} hideNoFrp
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsListHideNoFrp(hideNoFrp, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeFirmsListHideNoFrp(hideNoFrp);
    if (next == null) return false;
    store.setItem(FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getFirmsListHideNoFrp() {
  return sessionFilter;
}

/**
 * Toggle set. Clicking Hide no FRP flips the preference.
 * @param {unknown} hideNoFrp
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setFirmsListHideNoFrp(hideNoFrp, { persist = true, storage } = {}) {
  const next = normalizeFirmsListHideNoFrp(hideNoFrp) === true;
  sessionFilter = next;
  if (persist) writeFirmsListHideNoFrp(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateFirmsListHideNoFrp(storage) {
  return setFirmsListHideNoFrp(readFirmsListHideNoFrp(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(hideNoFrp: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeFirmsListHideNoFrp(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetFirmsListHideNoFrpForTest() {
  sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_FRP;
}
