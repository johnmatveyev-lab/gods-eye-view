/**
 * @module satellitePerigeeFilter
 * @description Client-only perigee-altitude chips for the existing CelesTrak
 * catalog. Filters already-fetched satrecs through `satrec.altp` from
 * satellite.js `twoline2satrec` (perigee altitude in Earth radii). Convert
 * with 6378.135 km — Vallado `xkmper`, exported in satellite.js 6 as
 * `constants.earthRadius`. Persistence lives in localStorage
 * `meridian.satPerigee` and is never written into share URLs. No extra /api.
 */

/** Exclusive All | <600km | <400km chips. `all` is the current unfiltered view. */
export const SAT_PERIGEE_CHIPS = Object.freeze([
  Object.freeze({
    id: 'all',
    maxKm: null,
    label: 'All',
    title: 'Show every satellite regardless of perigee altitude',
  }),
  Object.freeze({
    id: '600',
    maxKm: 600,
    label: '<600km',
    title: 'Hide satellites with perigee of 600 km or more',
  }),
  Object.freeze({
    id: '400',
    maxKm: 400,
    label: '<400km',
    title: 'Hide satellites with perigee of 400 km or more (typical Starlink)',
  }),
]);

export const SAT_PERIGEE_STORAGE_KEY = 'meridian.satPerigee';
export const DEFAULT_SAT_PERIGEE = 'all';

/**
 * satellite.js WGS-72 Earth radius in km (Vallado `xkmper`).
 * v6 exports the same value as `constants.earthRadius`.
 */
export const SAT_XKMPER_KM = 6378.135;

/** @typedef {'all'|'600'|'400'} SatPerigeeId */

/** @type {SatPerigeeId|null} */
let cachedPerigee = null;

/** Clear the in-memory preference so the next read hits storage (reload / tests). */
export function resetSatPerigeeCache() {
  cachedPerigee = null;
}

/**
 * Accept only the shipped chip ids. Unknown values stay All so a stale
 * preference cannot invent a new CelesTrak query.
 * @param {unknown} value
 * @returns {SatPerigeeId}
 */
export function normalizeSatPerigee(value) {
  if (value === 600 || value === '600') return '600';
  if (value === 400 || value === '400') return '400';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return DEFAULT_SAT_PERIGEE;
}

/**
 * Kilometre ceiling for a chip. All has no numeric ceiling.
 * @param {unknown} floorId
 * @returns {number|null}
 */
export function satellitePerigeeMaxKm(floorId) {
  const id = normalizeSatPerigee(floorId);
  switch (id) {
    case 'all':
      return null;
    case '600':
      return 600;
    case '400':
      return 400;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Perigee altitude in km from a satellite.js satrec.
 * `altp` is already Earth-radii from `twoline2satrec` / `sgp4init`.
 * Missing / non-finite `altp` yields a non-finite kilometre value.
 * @param {{altp?: number}|null|undefined} satrec
 * @returns {number}
 */
export function satellitePerigeeKm(satrec) {
  const altp = satrec?.altp;
  if (!Number.isFinite(altp)) return Number.NaN;
  return altp * SAT_XKMPER_KM;
}

/**
 * Whether one catalog row clears the perigee floor.
 * Missing / non-finite perigee stays visible. The tracked satellite stays
 * even when its chip is off.
 * @param {{satrec?: {altp?: number}, noradId?: number}|null|undefined} sat
 * @param {unknown} filter
 * @param {{noradId?: number, trackedNorad?: number|null}} [options]
 * @returns {boolean}
 */
export function satellitePassesPerigeeFilter(sat, filter, {
  noradId = sat?.noradId,
  trackedNorad = null,
} = {}) {
  const id = Number(noradId);
  if (trackedNorad != null && Number.isFinite(id) && id === Number(trackedNorad)) {
    return true;
  }
  const maxKm = satellitePerigeeMaxKm(filter);
  if (maxKm == null) return true;
  const km = satellitePerigeeKm(sat?.satrec);
  if (!Number.isFinite(km)) return true;
  return km < maxKm;
}

/**
 * @param {Array<{satrec?: {altp?: number}, noradId?: number}>|null|undefined} satellites
 * @param {unknown} [filter]
 * @param {number|null} [trackedNorad]
 * @returns {Array}
 */
export function filterSatellitesByPerigee(
  satellites,
  filter = DEFAULT_SAT_PERIGEE,
  trackedNorad = null,
) {
  const list = Array.isArray(satellites) ? satellites : [];
  if (satellitePerigeeMaxKm(filter) == null) return list.slice();
  return list.filter((sat) => satellitePassesPerigeeFilter(sat, filter, {
    noradId: sat?.noradId,
    trackedNorad,
  }));
}

/**
 * Exclusive-chip models for the Satellites data-layer row.
 * @param {unknown} [current]
 * @returns {Array<object>}
 */
export function satellitePerigeeChipModels(current = DEFAULT_SAT_PERIGEE) {
  const floor = normalizeSatPerigee(current);
  return SAT_PERIGEE_CHIPS.map((chip) => ({
    id: `perigee-${chip.id}`,
    label: chip.label,
    title: chip.title,
    active: floor === chip.id,
    group: 'Perigee',
    params: { satPerigee: chip.id },
  }));
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {SatPerigeeId}
 */
export function readSatPerigeePreference(storage) {
  try {
    return normalizeSatPerigee(storage?.getItem?.(SAT_PERIGEE_STORAGE_KEY));
  } catch {
    return DEFAULT_SAT_PERIGEE;
  }
}

/**
 * @param {unknown} perigee
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {SatPerigeeId}
 */
export function writeSatPerigeePreference(perigee, storage) {
  const normalized = normalizeSatPerigee(perigee);
  try {
    storage?.setItem?.(SAT_PERIGEE_STORAGE_KEY, normalized);
  } catch {
    // Fail open: the session can still apply the chosen floor.
  }
  return normalized;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {SatPerigeeId}
 */
export function getSatPerigee(storage = globalThis.localStorage) {
  if (cachedPerigee) return cachedPerigee;
  cachedPerigee = readSatPerigeePreference(storage);
  return cachedPerigee;
}

/**
 * @param {unknown} perigee
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {SatPerigeeId}
 */
export function setSatPerigee(perigee, storage = globalThis.localStorage) {
  cachedPerigee = writeSatPerigeePreference(perigee, storage);
  return cachedPerigee;
}
