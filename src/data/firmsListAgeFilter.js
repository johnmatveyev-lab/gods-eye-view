/**
 * Client-only exclusive All | <6 h | <1 h chips for the hosted FIRES list.
 *
 * Filters the already-fetched trailing-24h snapshot inside `listNearestFires`
 * before the 50-row cap. Distinct from the globe 6 / 12 / 24 h age window
 * and Plan 210 / 219 list confidence and FRP chips. Persistence is local
 * only (`meridian.firmsListAge`). LayerStateCoordinator restore hydrates
 * this key; there is no share-URL write, no extra NASA fetch, and no new
 * /api.
 *
 * All keeps 20 min / 3 h / 12 h. <6 h drops 12 h and keeps 3 h. <1 h
 * keeps 20 min and drops 3 h. Missing / non-finite acqMs stays visible.
 * A selected fire always stays.
 */

export const FIRMS_LIST_AGE_STORAGE_KEY = 'meridian.firmsListAge';
export const FIRMS_LIST_AGE_CHIP_IDS = Object.freeze(['all', '6', '1']);
export const FIRMS_LIST_AGE_CHIP_LABELS = Object.freeze({
  all: 'All',
  6: '<6 h',
  1: '<1 h',
});
export const FIRMS_LIST_AGE_CHIP_TITLES = Object.freeze({
  all: 'Show every FIRMS list age',
  6: 'Keep detections younger than 6 hours on the FIRES list',
  1: 'Keep detections younger than 1 hour on the FIRES list',
});
export const DEFAULT_FIRMS_LIST_AGE = 'all';

/** @deprecated Use FIRMS_LIST_AGE_CHIP_IDS / labels. */
export const FIRMS_LIST_AGE_CHIPS = Object.freeze(
  FIRMS_LIST_AGE_CHIP_IDS.map((id) => Object.freeze({
    id,
    label: FIRMS_LIST_AGE_CHIP_LABELS[id],
    title: FIRMS_LIST_AGE_CHIP_TITLES[id],
  })),
);

/** @typedef {'all'|'6'|'1'} FirmsListAge */

let sessionFilter = DEFAULT_FIRMS_LIST_AGE;
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
 * Globe age `12` / `24` are not list chips and stay All so a stale
 * preference cannot invent a new NASA query.
 * @param {unknown} value
 * @returns {FirmsListAge}
 */
export function normalizeFirmsListAge(value) {
  if (value === 6 || value === '6') return '6';
  if (value === 1 || value === '1') return '1';
  const text = String(value ?? '').trim().toLowerCase();
  if (text === '6h' || text === '<6' || text === '<6h' || text === '<6 h') return '6';
  if (text === '1h' || text === '<1' || text === '<1h' || text === '<1 h') return '1';
  if (text === 'all' || text === '0' || text === '') return DEFAULT_FIRMS_LIST_AGE;
  return DEFAULT_FIRMS_LIST_AGE;
}

/** Hour ceiling for a list-age id. All has no ceiling. */
export function firmsListAgeThresholdHours(listAge) {
  switch (normalizeFirmsListAge(listAge)) {
    case 'all':
      return null;
    case '6':
      return 6;
    case '1':
      return 1;
    default: {
      const unexpected = /** @type {never} */ (normalizeFirmsListAge(listAge));
      throw new Error(`unexpected FIRMS list age: ${unexpected}`);
    }
  }
}

function acqMsIsMissing(fire) {
  const raw = fire?.acqMs;
  if (raw == null || raw === '') return true;
  const acqMs = Number(raw);
  return !Number.isFinite(acqMs) || acqMs <= 0;
}

/**
 * Whether one detection clears the list age floor. Missing / non-finite
 * acqMs stays visible so an unknown VIIRS timestamp is never dropped
 * from the hosted list. A selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} listAge
 * @param {{selectedId?: string|null, now?: number}} [options]
 * @returns {boolean}
 */
export function fireMeetsListAge(fire, listAge, { selectedId = null, now = Date.now() } = {}) {
  const selected = selectedId == null || selectedId === '' ? '' : String(selectedId);
  if (selected) {
    const id = fireListId(fire);
    if (id && id === selected) return true;
  }
  const hours = firmsListAgeThresholdHours(listAge);
  if (hours == null) return true;
  if (acqMsIsMissing(fire)) return true;
  const clock = Number(now);
  const origin = Number.isFinite(clock) ? clock : Date.now();
  return origin - Number(fire.acqMs) < hours * 3_600_000;
}

/**
 * Keep detections younger than the list age floor. All returns a
 * shallow copy so the current 50-row ranking stays unchanged.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [listAge]
 * @param {{selectedId?: string|null, now?: number}} [options]
 * @returns {Array<Object>}
 */
export function filterFiresByListAge(fires, listAge, { selectedId = null, now = Date.now() } = {}) {
  const list = Array.isArray(fires) ? fires : [];
  if (firmsListAgeThresholdHours(listAge) == null && !selectedId) return list.slice();
  return list.filter((fire) => fireMeetsListAge(fire, listAge, { selectedId, now }));
}

/**
 * Exclusive-chip models for the hosted FIRES list row.
 * @param {unknown} [current]
 * @returns {Array<object>}
 */
export function firmsListAgeChipModels(current = DEFAULT_FIRMS_LIST_AGE) {
  const id = normalizeFirmsListAge(current);
  return FIRMS_LIST_AGE_CHIP_IDS.map((chipId) => ({
    id: chipId,
    label: FIRMS_LIST_AGE_CHIP_LABELS[chipId],
    title: FIRMS_LIST_AGE_CHIP_TITLES[chipId],
    active: id === chipId,
    group: 'ListAge',
    params: { firmsListAge: chipId },
  }));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {FirmsListAge}
 */
export function readFirmsListAge(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_LIST_AGE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_LIST_AGE;
    return normalizeFirmsListAge(raw);
  } catch {
    return DEFAULT_FIRMS_LIST_AGE;
  }
}

/**
 * @param {unknown} listAge
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsListAge(listAge, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(FIRMS_LIST_AGE_STORAGE_KEY, normalizeFirmsListAge(listAge));
    return true;
  } catch {
    return false;
  }
}

/** @returns {FirmsListAge} */
export function getFirmsListAge() {
  return sessionFilter;
}

/**
 * Exclusive chip set. Clicking All, <6 h, or <1 h replaces the floor.
 * @param {unknown} listAge
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {FirmsListAge}
 */
export function setFirmsListAge(listAge, { persist = true, storage } = {}) {
  const next = normalizeFirmsListAge(listAge);
  sessionFilter = next;
  if (persist) writeFirmsListAge(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {FirmsListAge}
 */
export function hydrateFirmsListAge(storage) {
  return setFirmsListAge(readFirmsListAge(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(listAge: FirmsListAge) => void} listener
 * @returns {() => void}
 */
export function subscribeFirmsListAge(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore All without clearing subscribers. */
export function resetFirmsListAgeForTest() {
  sessionFilter = DEFAULT_FIRMS_LIST_AGE;
}
