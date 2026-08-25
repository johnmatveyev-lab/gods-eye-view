/**
 * @module satelliteLaunchYearFilter
 * @description Client-only launch-year chips for the existing CelesTrak
 * catalog. Filters already-fetched satrecs through `satrec.intldesg` using
 * the same two-digit year decode as `internationalDesignatorYear`
 * (57–99 → 1900s, else 2000s). Persistence lives in localStorage
 * `meridian.satLaunchYear` and is never written into share URLs. No extra /api.
 */

/** Exclusive All | 2020s | 2010s | older chips. `all` is the current unfiltered view. */
export const SAT_LAUNCH_YEAR_CHIPS = Object.freeze([
  Object.freeze({
    id: 'all',
    label: 'All',
    title: 'Show every satellite regardless of launch year',
  }),
  Object.freeze({
    id: '2020s',
    label: '2020s',
    title: 'Show satellites launched in 2020–2029',
  }),
  Object.freeze({
    id: '2010s',
    label: '2010s',
    title: 'Show satellites launched in 2010–2019',
  }),
  Object.freeze({
    id: 'older',
    label: 'older',
    title: 'Show satellites launched before 2010',
  }),
]);

export const SAT_LAUNCH_YEAR_STORAGE_KEY = 'meridian.satLaunchYear';
export const DEFAULT_SAT_LAUNCH_YEAR = 'all';

/** @typedef {'all'|'2020s'|'2010s'|'older'} SatLaunchYearId */

/** @type {SatLaunchYearId|null} */
let cachedLaunchYear = null;

/** Clear the in-memory preference so the next read hits storage (reload / tests). */
export function resetSatLaunchYearCache() {
  cachedLaunchYear = null;
}

/**
 * Accept only the shipped chip ids. Unknown values stay All so a stale
 * preference cannot invent a new CelesTrak query.
 * @param {unknown} value
 * @returns {SatLaunchYearId}
 */
export function normalizeSatLaunchYear(value) {
  if (value === '2020s' || value === 2020 || value === '2020') return '2020s';
  if (value === '2010s' || value === 2010 || value === '2010') return '2010s';
  if (value === 'older' || value === 'old') return 'older';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return DEFAULT_SAT_LAUNCH_YEAR;
}

/**
 * TLE line 1 columns 10–17 (COSPAR / international designator).
 * satellite.js 6 does not copy this onto the satrec.
 * @param {string|null|undefined} line1
 * @returns {string}
 */
export function internationalDesignatorFromTleLine1(line1) {
  return String(line1 || '').slice(9, 17).trim();
}

/**
 * Stamp `satrec.intldesg` from the already-fetched TLE line so launch-year
 * chips can read the existing CelesTrak field. No-op when the satrec already
 * carries a designator or the line has no columns 10–17.
 * @param {{intldesg?: string}|null|undefined} satrec
 * @param {string|null|undefined} line1
 * @returns {{intldesg?: string}|null|undefined}
 */
export function attachInternationalDesignator(satrec, line1) {
  if (!satrec || satrec.intldesg) return satrec;
  const designator = internationalDesignatorFromTleLine1(line1);
  if (designator) satrec.intldesg = designator;
  return satrec;
}

/**
 * Decode the COSPAR / international-designator year from a satellite.js satrec.
 * `intldesg` is the TLE field (`YYNNNPPP`, e.g. `98067A`). 57–99 → 1900s,
 * else 2000s. Missing or unparseable designators return null.
 * @param {{intldesg?: string}|null|undefined} satrec
 * @returns {number|null}
 */
export function internationalDesignatorYear(satrec) {
  const match = String(satrec?.intldesg || '').match(/^(\d{2})/);
  if (!match) return null;
  const shortYear = Number(match[1]);
  return shortYear >= 57 ? 1900 + shortYear : 2000 + shortYear;
}

/**
 * Decade bucket for a four-digit year. 2030+ is parseable but unbucketed.
 * @param {number|null|undefined} year
 * @returns {SatLaunchYearId|null}
 */
export function satelliteLaunchYearBucket(year) {
  if (!Number.isFinite(year)) return null;
  if (year >= 2020 && year < 2030) return '2020s';
  if (year >= 2010 && year < 2020) return '2010s';
  if (year < 2010) return 'older';
  return null;
}

/**
 * Whether one catalog row clears the launch-year chip.
 * Missing / unparseable intldesg stays visible. The tracked satellite stays
 * even when its chip is off.
 * @param {{satrec?: {intldesg?: string}, noradId?: number}|null|undefined} sat
 * @param {unknown} filter
 * @param {{noradId?: number, trackedNorad?: number|null}} [options]
 * @returns {boolean}
 */
export function satellitePassesLaunchYearFilter(sat, filter, {
  noradId = sat?.noradId,
  trackedNorad = null,
} = {}) {
  const id = Number(noradId);
  if (trackedNorad != null && Number.isFinite(id) && id === Number(trackedNorad)) {
    return true;
  }
  const chip = normalizeSatLaunchYear(filter);
  switch (chip) {
    case 'all':
      return true;
    case '2020s':
    case '2010s':
    case 'older': {
      const year = internationalDesignatorYear(sat?.satrec);
      if (year == null) return true;
      return satelliteLaunchYearBucket(year) === chip;
    }
    default: {
      const _exhaustive = /** @type {never} */ (chip);
      void _exhaustive;
      return true;
    }
  }
}

/**
 * @param {Array<{satrec?: {intldesg?: string}, noradId?: number}>|null|undefined} satellites
 * @param {unknown} [filter]
 * @param {number|null} [trackedNorad]
 * @returns {Array}
 */
export function filterSatellitesByLaunchYear(
  satellites,
  filter = DEFAULT_SAT_LAUNCH_YEAR,
  trackedNorad = null,
) {
  const list = Array.isArray(satellites) ? satellites : [];
  if (normalizeSatLaunchYear(filter) === DEFAULT_SAT_LAUNCH_YEAR) return list.slice();
  return list.filter((sat) => satellitePassesLaunchYearFilter(sat, filter, {
    noradId: sat?.noradId,
    trackedNorad,
  }));
}

/**
 * Exclusive-chip models for the Satellites data-layer row.
 * @param {unknown} [current]
 * @returns {Array<object>}
 */
export function satelliteLaunchYearChipModels(current = DEFAULT_SAT_LAUNCH_YEAR) {
  const floor = normalizeSatLaunchYear(current);
  return SAT_LAUNCH_YEAR_CHIPS.map((chip) => {
    switch (chip.id) {
      case 'all':
      case '2020s':
      case '2010s':
      case 'older':
        return {
          id: `year-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: floor === chip.id,
          group: 'Year',
          params: { satLaunchYear: chip.id },
        };
      default: {
        const _exhaustive = /** @type {never} */ (chip.id);
        void _exhaustive;
        return {
          id: `year-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: false,
          group: 'Year',
          params: { satLaunchYear: floor },
        };
      }
    }
  });
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {SatLaunchYearId}
 */
export function readSatLaunchYearPreference(storage) {
  try {
    return normalizeSatLaunchYear(storage?.getItem?.(SAT_LAUNCH_YEAR_STORAGE_KEY));
  } catch {
    return DEFAULT_SAT_LAUNCH_YEAR;
  }
}

/**
 * @param {unknown} year
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {SatLaunchYearId}
 */
export function writeSatLaunchYearPreference(year, storage) {
  const normalized = normalizeSatLaunchYear(year);
  try {
    storage?.setItem?.(SAT_LAUNCH_YEAR_STORAGE_KEY, normalized);
  } catch {
    // Fail open: the session can still apply the chosen decade.
  }
  return normalized;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {SatLaunchYearId}
 */
export function getSatLaunchYear(storage = globalThis.localStorage) {
  if (cachedLaunchYear) return cachedLaunchYear;
  cachedLaunchYear = readSatLaunchYearPreference(storage);
  return cachedLaunchYear;
}

/**
 * @param {unknown} year
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {SatLaunchYearId}
 */
export function setSatLaunchYear(year, storage = globalThis.localStorage) {
  cachedLaunchYear = writeSatLaunchYearPreference(year, storage);
  return cachedLaunchYear;
}
