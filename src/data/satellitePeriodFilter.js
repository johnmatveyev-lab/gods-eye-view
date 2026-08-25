/**
 * @module satellitePeriodFilter
 * @description Client-only orbital-period chips for the existing CelesTrak
 * catalog. Filters already-fetched satrecs through `orbitalPeriodSeconds`
 * (the same mean-motion helper orbit rings already use). Persistence lives
 * in localStorage `meridian.satPeriod` and is never written into share URLs.
 * No extra /api.
 */

/** Exclusive All | <100m | <128m chips. `all` is the current unfiltered view. */
export const SAT_PERIOD_CHIPS = Object.freeze([
  Object.freeze({
    id: 'all',
    maxMinutes: null,
    label: 'All',
    title: 'Show every satellite regardless of orbital period',
  }),
  Object.freeze({
    id: '100',
    maxMinutes: 100,
    label: '<100m',
    title: 'Hide satellites with period of 100 minutes or more',
  }),
  Object.freeze({
    id: '128',
    maxMinutes: 128,
    label: '<128m',
    title: 'Hide satellites with period of 128 minutes or more (typical GEO)',
  }),
]);

export const SAT_PERIOD_STORAGE_KEY = 'meridian.satPeriod';
export const DEFAULT_SAT_PERIOD = 'all';

/** @typedef {'all'|'100'|'128'} SatPeriodId */

/** @type {SatPeriodId|null} */
let cachedPeriod = null;

/** Clear the in-memory preference so the next read hits storage (reload / tests). */
export function resetSatPeriodCache() {
  cachedPeriod = null;
}

/**
 * Accept only the shipped chip ids. Unknown values stay All so a stale
 * preference cannot invent a new CelesTrak query.
 * @param {unknown} value
 * @returns {SatPeriodId}
 */
export function normalizeSatPeriod(value) {
  if (value === 100 || value === '100') return '100';
  if (value === 128 || value === '128') return '128';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return DEFAULT_SAT_PERIOD;
}

/**
 * Minute ceiling for a chip. All has no numeric ceiling.
 * @param {unknown} floorId
 * @returns {number|null}
 */
export function satellitePeriodMaxMinutes(floorId) {
  const id = normalizeSatPeriod(floorId);
  switch (id) {
    case 'all':
      return null;
    case '100':
      return 100;
    case '128':
      return 128;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Orbital period in seconds from a satellite.js satrec mean motion.
 * This is the helper orbit rings already use — not a new satrec property.
 * Missing / non-finite `no` yields a non-finite period.
 * @param {{no?: number}|null|undefined} satrec
 * @returns {number}
 */
export function orbitalPeriodSeconds(satrec) {
  const meanMotion = satrec?.no * (1440 / (2 * Math.PI));
  return 86400 / Math.max(meanMotion, 0.1);
}

/**
 * Period in minutes for chip comparison.
 * @param {{no?: number}|null|undefined} satrec
 * @returns {number}
 */
export function satellitePeriodMinutes(satrec) {
  return orbitalPeriodSeconds(satrec) / 60;
}

/**
 * Whether one catalog row clears the period floor.
 * Missing / non-finite period stays visible. The tracked satellite stays
 * even when its chip is off.
 * @param {{satrec?: {no?: number}, noradId?: number}|null|undefined} sat
 * @param {unknown} filter
 * @param {{noradId?: number, trackedNorad?: number|null}} [options]
 * @returns {boolean}
 */
export function satellitePassesPeriodFilter(sat, filter, {
  noradId = sat?.noradId,
  trackedNorad = null,
} = {}) {
  const id = Number(noradId);
  if (trackedNorad != null && Number.isFinite(id) && id === Number(trackedNorad)) {
    return true;
  }
  const maxMinutes = satellitePeriodMaxMinutes(filter);
  if (maxMinutes == null) return true;
  const minutes = satellitePeriodMinutes(sat?.satrec);
  if (!Number.isFinite(minutes)) return true;
  return minutes < maxMinutes;
}

/**
 * @param {Array<{satrec?: {no?: number}, noradId?: number}>|null|undefined} satellites
 * @param {unknown} [filter]
 * @param {number|null} [trackedNorad]
 * @returns {Array}
 */
export function filterSatellitesByPeriod(
  satellites,
  filter = DEFAULT_SAT_PERIOD,
  trackedNorad = null,
) {
  const list = Array.isArray(satellites) ? satellites : [];
  if (satellitePeriodMaxMinutes(filter) == null) return list.slice();
  return list.filter((sat) => satellitePassesPeriodFilter(sat, filter, {
    noradId: sat?.noradId,
    trackedNorad,
  }));
}

/**
 * Exclusive-chip models for the Satellites data-layer row.
 * @param {unknown} [current]
 * @returns {Array<object>}
 */
export function satellitePeriodChipModels(current = DEFAULT_SAT_PERIOD) {
  const floor = normalizeSatPeriod(current);
  return SAT_PERIOD_CHIPS.map((chip) => ({
    id: `period-${chip.id}`,
    label: chip.label,
    title: chip.title,
    active: floor === chip.id,
    group: 'Period',
    params: { satPeriod: chip.id },
  }));
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {SatPeriodId}
 */
export function readSatPeriodPreference(storage) {
  try {
    return normalizeSatPeriod(storage?.getItem?.(SAT_PERIOD_STORAGE_KEY));
  } catch {
    return DEFAULT_SAT_PERIOD;
  }
}

/**
 * @param {unknown} period
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {SatPeriodId}
 */
export function writeSatPeriodPreference(period, storage) {
  const normalized = normalizeSatPeriod(period);
  try {
    storage?.setItem?.(SAT_PERIOD_STORAGE_KEY, normalized);
  } catch {
    // Fail open: the session can still apply the chosen floor.
  }
  return normalized;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {SatPeriodId}
 */
export function getSatPeriod(storage = globalThis.localStorage) {
  if (cachedPeriod) return cachedPeriod;
  cachedPeriod = readSatPeriodPreference(storage);
  return cachedPeriod;
}

/**
 * @param {unknown} period
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {SatPeriodId}
 */
export function setSatPeriod(period, storage = globalThis.localStorage) {
  cachedPeriod = writeSatPeriodPreference(period, storage);
  return cachedPeriod;
}
