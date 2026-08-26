/**
 * Client-only exclusive All | 10+ MW | 100+ MW chips for the hosted FIRES list.
 *
 * Filters the already-fetched trailing-24h snapshot inside `listNearestFires`
 * before the 50-row cap. Distinct from the globe FRP 10 / 50 / 100 chips and
 * Plan 210 list confidence. Persistence is local only
 * (`meridian.firmsListFrp`). LayerStateCoordinator restore hydrates this
 * key; there is no share-URL write, no extra NASA fetch, and no new /api.
 *
 * All keeps 1 / 10 / 100 MW. 10+ drops 1. 100+ keeps 100 and drops 10.
 * Missing / non-finite FRP stays visible. A selected fire always stays.
 */

export const FIRMS_LIST_FRP_STORAGE_KEY = 'meridian.firmsListFrp';
export const FIRMS_LIST_FRP_CHIP_IDS = Object.freeze(['all', '10', '100']);
export const FIRMS_LIST_FRP_CHIP_LABELS = Object.freeze({
  all: 'All',
  10: '10+ MW',
  100: '100+ MW',
});
export const FIRMS_LIST_FRP_CHIP_TITLES = Object.freeze({
  all: 'Show every FIRMS list FRP',
  10: 'Keep detections at or above 10 MW on the FIRES list',
  100: 'Keep detections at or above 100 MW on the FIRES list',
});
export const DEFAULT_FIRMS_LIST_FRP = 'all';

/** @deprecated Use FIRMS_LIST_FRP_CHIP_IDS / labels. */
export const FIRMS_LIST_FRP_CHIPS = Object.freeze(
  FIRMS_LIST_FRP_CHIP_IDS.map((id) => Object.freeze({
    id,
    label: FIRMS_LIST_FRP_CHIP_LABELS[id],
    title: FIRMS_LIST_FRP_CHIP_TITLES[id],
  })),
);

/** @typedef {'all'|'10'|'100'} FirmsListFrp */

let sessionFilter = DEFAULT_FIRMS_LIST_FRP;
let sessionSelectedId = null;
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
 * Canonical exclusive chip. Invalid input becomes the All default.
 * Globe FRP `50` is not a list chip and stays All so a stale preference
 * cannot invent a new NASA query.
 * @param {unknown} value
 * @returns {FirmsListFrp}
 */
export function normalizeFirmsListFrp(value) {
  if (value === 10 || value === '10' || value === '10+') return '10';
  if (value === 100 || value === '100' || value === '100+') return '100';
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'all' || text === '0' || text === '') return DEFAULT_FIRMS_LIST_FRP;
  return DEFAULT_FIRMS_LIST_FRP;
}

/** Numeric MW floor for a list-FRP id. All has no floor. */
export function firmsListFrpThresholdMw(listFrp) {
  switch (normalizeFirmsListFrp(listFrp)) {
    case 'all':
      return null;
    case '10':
      return 10;
    case '100':
      return 100;
    default: {
      const unexpected = /** @type {never} */ (normalizeFirmsListFrp(listFrp));
      throw new Error(`unexpected FIRMS list FRP: ${unexpected}`);
    }
  }
}

function frpIsMissing(fire) {
  const raw = fire?.frp;
  if (raw == null || raw === '') return true;
  return !Number.isFinite(Number(raw));
}

/**
 * Whether one detection clears the list FRP floor. Missing / non-finite
 * FRP stays visible so an unknown VIIRS/MODIS value is never dropped
 * from the hosted list. A selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} listFrp
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function fireMeetsListFrp(fire, listFrp, { selectedId = null } = {}) {
  const selected = selectedId == null || selectedId === '' ? '' : String(selectedId);
  if (selected) {
    const id = fireListId(fire);
    if (id && id === selected) return true;
  }
  const min = firmsListFrpThresholdMw(listFrp);
  if (min == null) return true;
  if (frpIsMissing(fire)) return true;
  return Number(fire.frp) >= min;
}

/**
 * Keep detections at or above the list FRP floor. All returns a
 * shallow copy so the current 50-row ranking stays unchanged.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [listFrp]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<Object>}
 */
export function filterFiresByListFrp(fires, listFrp, { selectedId = null } = {}) {
  const list = Array.isArray(fires) ? fires : [];
  if (firmsListFrpThresholdMw(listFrp) == null && !selectedId) return list.slice();
  return list.filter((fire) => fireMeetsListFrp(fire, listFrp, { selectedId }));
}

/**
 * Exclusive-chip models for the hosted FIRES list row.
 * @param {unknown} [current]
 * @returns {Array<object>}
 */
export function firmsListFrpChipModels(current = DEFAULT_FIRMS_LIST_FRP) {
  const id = normalizeFirmsListFrp(current);
  return FIRMS_LIST_FRP_CHIP_IDS.map((chipId) => ({
    id: chipId,
    label: FIRMS_LIST_FRP_CHIP_LABELS[chipId],
    title: FIRMS_LIST_FRP_CHIP_TITLES[chipId],
    active: id === chipId,
    group: 'ListFrp',
    params: { firmsListFrp: chipId },
  }));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {FirmsListFrp}
 */
export function readFirmsListFrp(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_LIST_FRP_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_LIST_FRP;
    return normalizeFirmsListFrp(raw);
  } catch {
    return DEFAULT_FIRMS_LIST_FRP;
  }
}

/**
 * @param {unknown} listFrp
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsListFrp(listFrp, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(FIRMS_LIST_FRP_STORAGE_KEY, normalizeFirmsListFrp(listFrp));
    return true;
  } catch {
    return false;
  }
}

/** @returns {FirmsListFrp} */
export function getFirmsListFrp() {
  return sessionFilter;
}

/** @returns {string|null} */
export function getFirmsListSelectedId() {
  return sessionSelectedId;
}

/**
 * Remember the list/globe selected detection so a raised floor cannot
 * hide the fire the operator just opened.
 * @param {unknown} selectedId
 * @returns {string|null}
 */
export function setFirmsListSelectedId(selectedId) {
  const next = selectedId == null || selectedId === '' ? null : String(selectedId);
  sessionSelectedId = next;
  return next;
}

/**
 * Exclusive chip set. Clicking All, 10+ MW, or 100+ MW replaces the floor.
 * @param {unknown} listFrp
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {FirmsListFrp}
 */
export function setFirmsListFrp(listFrp, { persist = true, storage } = {}) {
  const next = normalizeFirmsListFrp(listFrp);
  sessionFilter = next;
  if (persist) writeFirmsListFrp(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {FirmsListFrp}
 */
export function hydrateFirmsListFrp(storage) {
  return setFirmsListFrp(readFirmsListFrp(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(listFrp: FirmsListFrp) => void} listener
 * @returns {() => void}
 */
export function subscribeFirmsListFrp(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore All without clearing subscribers. */
export function resetFirmsListFrpForTest() {
  sessionFilter = DEFAULT_FIRMS_LIST_FRP;
  sessionSelectedId = null;
}
