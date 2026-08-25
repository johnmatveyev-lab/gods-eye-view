/**
 * @module satelliteInclinationFilter
 * @description Client-only orbital-inclination chips for the existing CelesTrak
 * catalog. Filters already-fetched satrecs through `satrec.inclo`, which
 * satellite.js stores in radians (TLE degrees × deg2rad). Persistence lives
 * in localStorage `meridian.satInclination` and is never written into share
 * URLs. No extra /api.
 */

/** Independent Eq | Mid | Polar chips. All on is the current unfiltered view. */
export const SAT_INCLINATION_CHIPS = Object.freeze([
  Object.freeze({
    id: 'eq',
    label: 'Eq',
    title: 'Show equatorial orbits (inclination under 30°)',
  }),
  Object.freeze({
    id: 'mid',
    label: 'Mid',
    title: 'Show mid-inclination orbits (30–80°)',
  }),
  Object.freeze({
    id: 'polar',
    label: 'Polar',
    title: 'Show polar orbits (inclination 80° and above)',
  }),
]);

export const SAT_INCLINATION_CHIP_IDS = Object.freeze(
  SAT_INCLINATION_CHIPS.map((chip) => chip.id),
);

export const SAT_INCLINATION_CHIP_CODES = Object.freeze({
  eq: 'e',
  mid: 'm',
  polar: 'p',
});

export const SAT_INCLINATION_STORAGE_KEY = 'meridian.satInclination';

/** Canonical all-on token. Omitted storage means this. */
export const DEFAULT_SAT_INCLINATION = SAT_INCLINATION_CHIP_IDS
  .map((id) => SAT_INCLINATION_CHIP_CODES[id])
  .join('');

const CODE_TO_CHIP = Object.freeze(
  Object.fromEntries(
    Object.entries(SAT_INCLINATION_CHIP_CODES).map(([id, code]) => [code, id]),
  ),
);

const RAD_TO_DEG = 180 / Math.PI;
/** Degree buckets applied in satrec.inclo's native radians to avoid a deg round-trip. */
const EQ_MAX_RAD = 30 * (Math.PI / 180);
const POLAR_MIN_RAD = 80 * (Math.PI / 180);

/** @typedef {'eq'|'mid'|'polar'} SatInclinationChipId */

/** @type {string|null} */
let cachedInclination = null;

/** Clear the in-memory preference so the next read hits storage (reload / tests). */
export function resetSatInclinationCache() {
  cachedInclination = null;
}

/**
 * Canonical chip-code token. Invalid input becomes the all-on default.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSatInclination(value) {
  if (value == null || value === '') return DEFAULT_SAT_INCLINATION;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'all' || trimmed === DEFAULT_SAT_INCLINATION) {
      return DEFAULT_SAT_INCLINATION;
    }
    if (trimmed === '0' || trimmed === 'none') return '0';
    const seen = new Set();
    if (trimmed.includes(',') || trimmed.includes('|')) {
      for (const part of trimmed.split(/[,|]/)) {
        const token = part.trim();
        if (SAT_INCLINATION_CHIP_IDS.includes(/** @type {SatInclinationChipId} */ (token))) {
          seen.add(token);
        } else if (CODE_TO_CHIP[token]) {
          seen.add(CODE_TO_CHIP[token]);
        }
      }
    } else if (SAT_INCLINATION_CHIP_IDS.includes(/** @type {SatInclinationChipId} */ (trimmed))) {
      seen.add(trimmed);
    } else if ([...trimmed].every((character) => Boolean(CODE_TO_CHIP[character]))) {
      for (const character of trimmed) {
        seen.add(CODE_TO_CHIP[character]);
      }
    }
    if (!seen.size) return DEFAULT_SAT_INCLINATION;
    const codes = SAT_INCLINATION_CHIP_IDS
      .filter((id) => seen.has(id))
      .map((id) => SAT_INCLINATION_CHIP_CODES[id])
      .join('');
    return codes === DEFAULT_SAT_INCLINATION ? DEFAULT_SAT_INCLINATION : codes;
  }
  if (typeof value === 'object') {
    const enabled = SAT_INCLINATION_CHIP_IDS.filter((id) => value[id] === true);
    if (!enabled.length) {
      const explicitFalse = SAT_INCLINATION_CHIP_IDS.some((id) => value[id] === false);
      if (explicitFalse) return '0';
      return DEFAULT_SAT_INCLINATION;
    }
    return enabled.map((id) => SAT_INCLINATION_CHIP_CODES[id]).join('');
  }
  return DEFAULT_SAT_INCLINATION;
}

/**
 * @param {unknown} filter
 * @returns {Record<SatInclinationChipId, boolean>}
 */
export function satelliteInclinationFilterFlags(filter) {
  const token = normalizeSatInclination(filter);
  if (token === '0') {
    return Object.fromEntries(SAT_INCLINATION_CHIP_IDS.map((id) => [id, false]));
  }
  return Object.fromEntries(
    SAT_INCLINATION_CHIP_IDS.map((id) => [id, token.includes(SAT_INCLINATION_CHIP_CODES[id])]),
  );
}

/**
 * Flip one chip. Last-off becomes the empty token `0`.
 * @param {unknown} filter
 * @param {unknown} chipId
 * @returns {string}
 */
export function toggleSatInclination(filter, chipId) {
  const id = String(chipId || '');
  if (!SAT_INCLINATION_CHIP_IDS.includes(/** @type {SatInclinationChipId} */ (id))) {
    return normalizeSatInclination(filter);
  }
  const flags = satelliteInclinationFilterFlags(filter);
  flags[id] = !flags[id];
  return normalizeSatInclination(flags);
}

/**
 * Inclination in degrees from a satellite.js satrec.
 * `inclo` is radians (SGP4 / twoline2satrec). Missing / non-finite yields NaN.
 * @param {{inclo?: number}|null|undefined} satrec
 * @returns {number}
 */
export function satelliteInclinationDegrees(satrec) {
  const inclo = satrec?.inclo;
  if (!Number.isFinite(inclo)) return Number.NaN;
  return inclo * RAD_TO_DEG;
}

/**
 * Eq &lt; 30°, Mid 30–80°, Polar ≥ 80°. Unknown stays unbucketed.
 * @param {number} degrees
 * @returns {SatInclinationChipId|null}
 */
export function satelliteInclinationBucket(degrees) {
  if (!Number.isFinite(degrees)) return null;
  if (degrees < 30) return 'eq';
  if (degrees < 80) return 'mid';
  return 'polar';
}

/**
 * Bucket a satrec from `inclo` radians using the 30° / 80° plane splits.
 * @param {{inclo?: number}|null|undefined} satrec
 * @returns {SatInclinationChipId|null}
 */
export function satelliteInclinationBucketOf(satrec) {
  const inclo = satrec?.inclo;
  if (!Number.isFinite(inclo)) return null;
  if (inclo < EQ_MAX_RAD) return 'eq';
  if (inclo < POLAR_MIN_RAD) return 'mid';
  return 'polar';
}

/**
 * Whether one catalog row clears the inclination chips.
 * Missing / non-finite inclination stays visible. The tracked satellite stays
 * even when its chip is off.
 * @param {{satrec?: {inclo?: number}, noradId?: number}|null|undefined} sat
 * @param {unknown} filter
 * @param {{noradId?: number, trackedNorad?: number|null}} [options]
 * @returns {boolean}
 */
export function satellitePassesInclinationFilter(sat, filter, {
  noradId = sat?.noradId,
  trackedNorad = null,
} = {}) {
  const id = Number(noradId);
  if (trackedNorad != null && Number.isFinite(id) && id === Number(trackedNorad)) {
    return true;
  }
  const token = normalizeSatInclination(filter);
  if (token === DEFAULT_SAT_INCLINATION) return true;
  const bucket = satelliteInclinationBucketOf(sat?.satrec);
  if (bucket == null) return true;
  const flags = satelliteInclinationFilterFlags(token);
  return flags[bucket] === true;
}

/**
 * @param {Array<{satrec?: {inclo?: number}, noradId?: number}>|null|undefined} satellites
 * @param {unknown} [filter]
 * @param {number|null} [trackedNorad]
 * @returns {Array}
 */
export function filterSatellitesByInclination(
  satellites,
  filter = DEFAULT_SAT_INCLINATION,
  trackedNorad = null,
) {
  const list = Array.isArray(satellites) ? satellites : [];
  if (normalizeSatInclination(filter) === DEFAULT_SAT_INCLINATION) return list.slice();
  return list.filter((sat) => satellitePassesInclinationFilter(sat, filter, {
    noradId: sat?.noradId,
    trackedNorad,
  }));
}

/**
 * Toggle-chip models for the Satellites data-layer row.
 * @param {unknown} [current]
 * @returns {Array<object>}
 */
export function satelliteInclinationChipModels(current = DEFAULT_SAT_INCLINATION) {
  const token = normalizeSatInclination(current);
  const flags = satelliteInclinationFilterFlags(token);
  return SAT_INCLINATION_CHIPS.map((chip) => {
    switch (chip.id) {
      case 'eq':
      case 'mid':
      case 'polar':
        return {
          id: `inc-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: flags[chip.id] === true,
          group: 'Inclination',
          params: { satInclination: toggleSatInclination(token, chip.id) },
        };
      default: {
        const _exhaustive = /** @type {never} */ (chip.id);
        void _exhaustive;
        return {
          id: `inc-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: false,
          group: 'Inclination',
          params: { satInclination: token },
        };
      }
    }
  });
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {string}
 */
export function readSatInclinationPreference(storage) {
  try {
    return normalizeSatInclination(storage?.getItem?.(SAT_INCLINATION_STORAGE_KEY));
  } catch {
    return DEFAULT_SAT_INCLINATION;
  }
}

/**
 * @param {unknown} inclination
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {string}
 */
export function writeSatInclinationPreference(inclination, storage) {
  const normalized = normalizeSatInclination(inclination);
  try {
    storage?.setItem?.(SAT_INCLINATION_STORAGE_KEY, normalized);
  } catch {
    // Fail open: the session can still apply the chosen chips.
  }
  return normalized;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function getSatInclination(storage = globalThis.localStorage) {
  if (cachedInclination != null) return cachedInclination;
  cachedInclination = readSatInclinationPreference(storage);
  return cachedInclination;
}

/**
 * @param {unknown} inclination
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function setSatInclination(inclination, storage = globalThis.localStorage) {
  cachedInclination = writeSatInclinationPreference(inclination, storage);
  return cachedInclination;
}
