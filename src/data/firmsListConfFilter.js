/**
 * Client-only FIRMS list confidence floor. Filters the already-fetched
 * trailing-24h snapshot before the hosted FIRES list cap — never issues a
 * new NASA /api/firms query. Unknown chips stay All so a stale preference
 * cannot invent a new NASA query.
 *
 * Persistence is local only (`meridian.firmsListConf`). LayerStateCoordinator
 * restore reads this key; there is no share-URL write. Distinct from the
 * globe 0.5+ / 0.8+ confidence floors and Plan 204 scan chips.
 *
 * Thresholds match `formatFireListRow` buckets: high ≥0.75, nominal ≥0.45.
 * Missing / non-finite confidence stays visible.
 */

/** Same cutoffs `formatFireListRow` uses for high / nominal / low. */
export const FIRMS_LIST_CONF_HIGH_MIN = 0.75;
export const FIRMS_LIST_CONF_NOMINAL_MIN = 0.45;

/** Exclusive list-confidence chips. `all` is the current unfiltered 50-row list. */
export const FIRMS_LIST_CONF_CHIPS = Object.freeze([
  Object.freeze({ id: 'all', label: 'All', title: 'Show every FIRMS list confidence bucket' }),
  Object.freeze({ id: 'high', label: 'High', title: 'Keep high-confidence detections (≥0.75) on the FIRES list' }),
  Object.freeze({ id: 'nominal', label: 'Nominal+', title: 'Keep nominal and high detections (≥0.45) on the FIRES list' }),
]);

export const FIRMS_LIST_CONF_STORAGE_KEY = 'meridian.firmsListConf';

export const DEFAULT_FIRMS_LIST_CONF = 'all';

/** @typedef {'all'|'high'|'nominal'} FirmsListConf */

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Coerce a chip / persisted value to a list-confidence id. Unknown values
 * stay All so a stale preference cannot invent a new NASA query.
 * @param {*} value
 * @returns {FirmsListConf}
 */
export function normalizeFirmsListConf(value) {
  if (value === 'high' || value === 'h') return 'high';
  if (value === 'nominal' || value === 'nominal+' || value === 'n') return 'nominal';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return DEFAULT_FIRMS_LIST_CONF;
}

/** Numeric 0–1 floor for a list-confidence id. All is 0. */
export function firmsListConfThreshold(listConf) {
  const id = normalizeFirmsListConf(listConf);
  switch (id) {
    case 'all':
      return 0;
    case 'high':
      return FIRMS_LIST_CONF_HIGH_MIN;
    case 'nominal':
      return FIRMS_LIST_CONF_NOMINAL_MIN;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      void _exhaustive;
      return 0;
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
 * @param {FirmsListConf|string} listConf
 * @returns {boolean}
 */
export function fireMeetsListConf(fire, listConf) {
  const min = firmsListConfThreshold(listConf);
  if (min <= 0) return true;
  if (confidenceIsMissing(fire)) return true;
  return Number(fire.confidence) >= min;
}

/**
 * Keep detections at or above the list confidence floor. All returns a
 * shallow copy so the current 50-row ranking stays unchanged.
 * @param {Array<Object>|null|undefined} fires
 * @param {FirmsListConf|string} listConf
 * @returns {Array<Object>}
 */
export function filterFiresByListConf(fires, listConf) {
  if (!Array.isArray(fires)) return [];
  if (firmsListConfThreshold(listConf) <= 0) return fires.slice();
  return fires.filter((fire) => fireMeetsListConf(fire, listConf));
}

/**
 * Exclusive-chip models for the hosted FIRES list row.
 * @param {unknown} current
 * @returns {Array<object>}
 */
export function firmsListConfChipModels(current = DEFAULT_FIRMS_LIST_CONF) {
  const id = normalizeFirmsListConf(current);
  return FIRMS_LIST_CONF_CHIPS.map((chip) => ({
    id: `list-conf-${chip.id}`,
    label: chip.label,
    title: chip.title,
    active: id === chip.id,
    group: 'ListConf',
    params: { firmsListConf: chip.id },
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
 * @returns {FirmsListConf}
 */
export function writeFirmsListConf(listConf, storage) {
  const normalized = normalizeFirmsListConf(listConf);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_LIST_CONF_STORAGE_KEY, normalized);
    }
  } catch {
    // Fail open: the session can still apply the chosen list floor.
  }
  return normalized;
}
