/**
 * Client-only exclusive All | High | Nominal+ chips for the hosted FIRES list.
 *
 * Filters the already-fetched trailing-24h snapshot inside `listNearestFires`
 * before the 50-row cap. Distinct from the globe 0.5+ / 0.8+ confidence
 * floors and Plan 204 scan chips. Persistence is local only
 * (`meridian.firmsListConf`). LayerStateCoordinator restore hydrates this
 * key; there is no share-URL write, no extra NASA fetch, and no new /api.
 *
 * Thresholds match `formatFireListRow` buckets: high ≥0.75, nominal ≥0.45.
 * Missing / non-finite confidence stays visible.
 */

/** Same cutoffs `formatFireListRow` uses for high / nominal / low. */
export const FIRMS_LIST_CONF_HIGH_MIN = 0.75;
export const FIRMS_LIST_CONF_NOMINAL_MIN = 0.45;

export const FIRMS_LIST_CONF_STORAGE_KEY = 'meridian.firmsListConf';
export const FIRMS_LIST_CONF_CHIP_IDS = Object.freeze(['all', 'high', 'nominal']);
export const FIRMS_LIST_CONF_CHIP_LABELS = Object.freeze({
  all: 'All',
  high: 'High',
  nominal: 'Nominal+',
});
export const FIRMS_LIST_CONF_CHIP_TITLES = Object.freeze({
  all: 'Show every FIRMS list confidence bucket',
  high: 'Keep high-confidence detections (≥0.75) on the FIRES list',
  nominal: 'Keep nominal and high detections (≥0.45) on the FIRES list',
});
export const DEFAULT_FIRMS_LIST_CONF = 'all';

/** @deprecated Use FIRMS_LIST_CONF_CHIP_IDS / labels. */
export const FIRMS_LIST_CONF_CHIPS = Object.freeze(
  FIRMS_LIST_CONF_CHIP_IDS.map((id) => Object.freeze({
    id,
    label: FIRMS_LIST_CONF_CHIP_LABELS[id],
    title: FIRMS_LIST_CONF_CHIP_TITLES[id],
  })),
);

/** @typedef {'all'|'high'|'nominal'} FirmsListConf */

let sessionFilter = DEFAULT_FIRMS_LIST_CONF;
const listeners = new Set();

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Canonical exclusive chip. Invalid input becomes the All default.
 * Unknown values stay All so a stale preference cannot invent a new NASA query.
 * @param {unknown} value
 * @returns {FirmsListConf}
 */
export function normalizeFirmsListConf(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'high' || text === 'h') return 'high';
  if (text === 'nominal' || text === 'nominal+' || text === 'n') return 'nominal';
  if (text === 'all' || text === '0' || text === '') return DEFAULT_FIRMS_LIST_CONF;
  return DEFAULT_FIRMS_LIST_CONF;
}

/** Numeric 0–1 floor for a list-confidence id. All has no floor. */
export function firmsListConfThreshold(listConf) {
  switch (normalizeFirmsListConf(listConf)) {
    case 'all':
      return null;
    case 'high':
      return FIRMS_LIST_CONF_HIGH_MIN;
    case 'nominal':
      return FIRMS_LIST_CONF_NOMINAL_MIN;
    default: {
      const unexpected = /** @type {never} */ (normalizeFirmsListConf(listConf));
      throw new Error(`unexpected FIRMS list confidence: ${unexpected}`);
    }
  }
}

function confidenceIsMissing(fire) {
  const raw = fire?.confidence;
  if (raw == null || raw === '') return true;
  return !Number.isFinite(Number(raw));
}

/**
 * Whether one detection clears the list confidence floor. Missing /
 * non-finite confidence stays visible so an unknown VIIRS/MODIS value
 * is never dropped from the hosted list.
 * @param {Object|null|undefined} fire
 * @param {unknown} listConf
 * @returns {boolean}
 */
export function fireMeetsListConf(fire, listConf) {
  const min = firmsListConfThreshold(listConf);
  if (min == null) return true;
  if (confidenceIsMissing(fire)) return true;
  return Number(fire.confidence) >= min;
}

/**
 * Keep detections at or above the list confidence floor. All returns a
 * shallow copy so the current 50-row ranking stays unchanged.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [listConf]
 * @returns {Array<Object>}
 */
export function filterFiresByListConf(fires, listConf) {
  const list = Array.isArray(fires) ? fires : [];
  if (firmsListConfThreshold(listConf) == null) return list.slice();
  return list.filter((fire) => fireMeetsListConf(fire, listConf));
}

/**
 * Exclusive-chip models for the hosted FIRES list row.
 * @param {unknown} [current]
 * @returns {Array<object>}
 */
export function firmsListConfChipModels(current = DEFAULT_FIRMS_LIST_CONF) {
  const id = normalizeFirmsListConf(current);
  return FIRMS_LIST_CONF_CHIP_IDS.map((chipId) => ({
    id: chipId,
    label: FIRMS_LIST_CONF_CHIP_LABELS[chipId],
    title: FIRMS_LIST_CONF_CHIP_TITLES[chipId],
    active: id === chipId,
    group: 'ListConf',
    params: { firmsListConf: chipId },
  }));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {FirmsListConf}
 */
export function readFirmsListConf(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_LIST_CONF_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_LIST_CONF;
    return normalizeFirmsListConf(raw);
  } catch {
    return DEFAULT_FIRMS_LIST_CONF;
  }
}

/**
 * @param {unknown} listConf
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsListConf(listConf, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(FIRMS_LIST_CONF_STORAGE_KEY, normalizeFirmsListConf(listConf));
    return true;
  } catch {
    return false;
  }
}

/** @returns {FirmsListConf} */
export function getFirmsListConf() {
  return sessionFilter;
}

/**
 * Exclusive chip set. Clicking All, High, or Nominal+ replaces the floor.
 * @param {unknown} listConf
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {FirmsListConf}
 */
export function setFirmsListConf(listConf, { persist = true, storage } = {}) {
  const next = normalizeFirmsListConf(listConf);
  sessionFilter = next;
  if (persist) writeFirmsListConf(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {FirmsListConf}
 */
export function hydrateFirmsListConf(storage) {
  return setFirmsListConf(readFirmsListConf(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(listConf: FirmsListConf) => void} listener
 * @returns {() => void}
 */
export function subscribeFirmsListConf(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore All without clearing subscribers. */
export function resetFirmsListConfForTest() {
  sessionFilter = DEFAULT_FIRMS_LIST_CONF;
}
