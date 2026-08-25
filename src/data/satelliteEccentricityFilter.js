/**
 * @module satelliteEccentricityFilter
 * @description Client-only orbital-eccentricity chips for the existing CelesTrak
 * catalog. Filters already-fetched satrecs through `satrec.ecco`, which
 * satellite.js stores as unitless 0–1 eccentricity (TLE field with an implied
 * decimal). Persistence lives in localStorage `meridian.satEccentricity` and
 * is never written into share URLs. No extra /api.
 */

/** Exclusive All | <0.01 | <0.05 chips. `all` is the current unfiltered view. */
export const SAT_ECCENTRICITY_CHIPS = Object.freeze([
  Object.freeze({
    id: 'all',
    maxEccentricity: null,
    label: 'All',
    title: 'Show every satellite regardless of eccentricity',
  }),
  Object.freeze({
    id: '001',
    maxEccentricity: 0.01,
    label: '<0.01',
    title: 'Hide satellites with eccentricity of 0.01 or more (near-circular)',
  }),
  Object.freeze({
    id: '005',
    maxEccentricity: 0.05,
    label: '<0.05',
    title: 'Hide satellites with eccentricity of 0.05 or more',
  }),
]);

export const SAT_ECCENTRICITY_STORAGE_KEY = 'meridian.satEccentricity';
export const DEFAULT_SAT_ECCENTRICITY = 'all';

/** @typedef {'all'|'001'|'005'} SatEccentricityId */

/** @type {SatEccentricityId|null} */
let cachedEccentricity = null;

/** Clear the in-memory preference so the next read hits storage (reload / tests). */
export function resetSatEccentricityCache() {
  cachedEccentricity = null;
}

/**
 * Accept only the shipped chip ids. Unknown values stay All so a stale
 * preference cannot invent a new CelesTrak query.
 * @param {unknown} value
 * @returns {SatEccentricityId}
 */
export function normalizeSatEccentricity(value) {
  if (value === 0.01 || value === '0.01' || value === '001' || value === '01') return '001';
  if (value === 0.05 || value === '0.05' || value === '005' || value === '05') return '005';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return DEFAULT_SAT_ECCENTRICITY;
}

/**
 * Eccentricity ceiling for a chip. All has no numeric ceiling.
 * @param {unknown} floorId
 * @returns {number|null}
 */
export function satelliteEccentricityMax(floorId) {
  const id = normalizeSatEccentricity(floorId);
  switch (id) {
    case 'all':
      return null;
    case '001':
      return 0.01;
    case '005':
      return 0.05;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Unitless eccentricity from a satellite.js satrec.
 * `ecco` is already 0–1 (SGP4 / twoline2satrec). Missing / non-finite yields NaN.
 * @param {{ecco?: number}|null|undefined} satrec
 * @returns {number}
 */
export function satelliteEccentricity(satrec) {
  const ecco = satrec?.ecco;
  if (!Number.isFinite(ecco)) return Number.NaN;
  return ecco;
}

/**
 * Whether one catalog row clears the eccentricity floor.
 * Missing / non-finite eccentricity stays visible. The tracked satellite stays
 * even when its chip is off.
 * @param {{satrec?: {ecco?: number}, noradId?: number}|null|undefined} sat
 * @param {unknown} filter
 * @param {{noradId?: number, trackedNorad?: number|null}} [options]
 * @returns {boolean}
 */
export function satellitePassesEccentricityFilter(sat, filter, {
  noradId = sat?.noradId,
  trackedNorad = null,
} = {}) {
  const id = Number(noradId);
  if (trackedNorad != null && Number.isFinite(id) && id === Number(trackedNorad)) {
    return true;
  }
  const maxEccentricity = satelliteEccentricityMax(filter);
  if (maxEccentricity == null) return true;
  const eccentricity = satelliteEccentricity(sat?.satrec);
  if (!Number.isFinite(eccentricity)) return true;
  return eccentricity < maxEccentricity;
}

/**
 * @param {Array<{satrec?: {ecco?: number}, noradId?: number}>|null|undefined} satellites
 * @param {unknown} [filter]
 * @param {number|null} [trackedNorad]
 * @returns {Array}
 */
export function filterSatellitesByEccentricity(
  satellites,
  filter = DEFAULT_SAT_ECCENTRICITY,
  trackedNorad = null,
) {
  const list = Array.isArray(satellites) ? satellites : [];
  if (satelliteEccentricityMax(filter) == null) return list.slice();
  return list.filter((sat) => satellitePassesEccentricityFilter(sat, filter, {
    noradId: sat?.noradId,
    trackedNorad,
  }));
}

/**
 * Exclusive-chip models for the Satellites data-layer row.
 * @param {unknown} [current]
 * @returns {Array<object>}
 */
export function satelliteEccentricityChipModels(current = DEFAULT_SAT_ECCENTRICITY) {
  const floor = normalizeSatEccentricity(current);
  return SAT_ECCENTRICITY_CHIPS.map((chip) => ({
    id: `ecc-${chip.id}`,
    label: chip.label,
    title: chip.title,
    active: floor === chip.id,
    group: 'Eccentricity',
    params: { satEccentricity: chip.id },
  }));
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {SatEccentricityId}
 */
export function readSatEccentricityPreference(storage) {
  try {
    return normalizeSatEccentricity(storage?.getItem?.(SAT_ECCENTRICITY_STORAGE_KEY));
  } catch {
    return DEFAULT_SAT_ECCENTRICITY;
  }
}

/**
 * @param {unknown} eccentricity
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {SatEccentricityId}
 */
export function writeSatEccentricityPreference(eccentricity, storage) {
  const normalized = normalizeSatEccentricity(eccentricity);
  try {
    storage?.setItem?.(SAT_ECCENTRICITY_STORAGE_KEY, normalized);
  } catch {
    // Fail open: the session can still apply the chosen floor.
  }
  return normalized;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {SatEccentricityId}
 */
export function getSatEccentricity(storage = globalThis.localStorage) {
  if (cachedEccentricity) return cachedEccentricity;
  cachedEccentricity = readSatEccentricityPreference(storage);
  return cachedEccentricity;
}

/**
 * @param {unknown} eccentricity
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {SatEccentricityId}
 */
export function setSatEccentricity(eccentricity, storage = globalThis.localStorage) {
  cachedEccentricity = writeSatEccentricityPreference(eccentricity, storage);
  return cachedEccentricity;
}
