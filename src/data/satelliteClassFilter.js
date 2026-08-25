/**
 * @module satelliteClassFilter
 * @description Client-side satellite class chips for the existing CelesTrak
 * catalog. Filters already-fetched groups through `satelliteClassOf`.
 * Persistence is the satellites layerState option — no extra /api.
 */

import {
  SATELLITE_CLASS_ORDER,
  SATELLITE_CLASSES,
  satelliteClassOf,
} from './satelliteClass.js';

/** Chip ids follow the legend / class-registry order. */
export const SATELLITE_CLASS_CHIP_IDS = SATELLITE_CLASS_ORDER;

export const SATELLITE_CLASS_CHIP_LABELS = Object.freeze(
  Object.fromEntries(SATELLITE_CLASS_ORDER.map((id) => [id, SATELLITE_CLASSES[id].label])),
);

export const SATELLITE_CLASS_CHIP_CODES = Object.freeze({
  station: 's',
  nav: 'n',
  geo: 'g',
  visual: 'v',
  comms: 'c',
});

/** Canonical all-on token. Omitted layerState `k` means this. */
export const DEFAULT_SATELLITE_CLASS_FILTER = SATELLITE_CLASS_CHIP_IDS
  .map((id) => SATELLITE_CLASS_CHIP_CODES[id])
  .join('');

const CODE_TO_CHIP = Object.freeze(
  Object.fromEntries(
    Object.entries(SATELLITE_CLASS_CHIP_CODES).map(([id, code]) => [code, id]),
  ),
);

const ISS_NORAD = 25544;

/** @typedef {'station'|'nav'|'geo'|'visual'|'comms'} SatelliteClassChipId */

/**
 * Canonical chip-code token. Invalid input becomes the all-on default.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSatelliteClassFilter(value) {
  if (value == null || value === '') return DEFAULT_SATELLITE_CLASS_FILTER;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'all' || trimmed === DEFAULT_SATELLITE_CLASS_FILTER) {
      return DEFAULT_SATELLITE_CLASS_FILTER;
    }
    if (trimmed === '0' || trimmed === 'none') return '0';
    const seen = new Set();
    for (const character of trimmed) {
      const chipId = CODE_TO_CHIP[character];
      if (chipId) seen.add(chipId);
    }
    if (!seen.size) return DEFAULT_SATELLITE_CLASS_FILTER;
    const codes = SATELLITE_CLASS_CHIP_IDS
      .filter((id) => seen.has(id))
      .map((id) => SATELLITE_CLASS_CHIP_CODES[id])
      .join('');
    return codes === DEFAULT_SATELLITE_CLASS_FILTER ? DEFAULT_SATELLITE_CLASS_FILTER : codes;
  }
  if (typeof value === 'object') {
    const enabled = SATELLITE_CLASS_CHIP_IDS.filter((id) => value[id] === true);
    if (!enabled.length) {
      const explicitFalse = SATELLITE_CLASS_CHIP_IDS.some((id) => value[id] === false);
      if (explicitFalse) return '0';
      return DEFAULT_SATELLITE_CLASS_FILTER;
    }
    return enabled.map((id) => SATELLITE_CLASS_CHIP_CODES[id]).join('');
  }
  return DEFAULT_SATELLITE_CLASS_FILTER;
}

/**
 * @param {unknown} filter
 * @returns {Record<SatelliteClassChipId, boolean>}
 */
export function satelliteClassFilterFlags(filter) {
  const token = normalizeSatelliteClassFilter(filter);
  if (token === '0') {
    return Object.fromEntries(SATELLITE_CLASS_CHIP_IDS.map((id) => [id, false]));
  }
  return Object.fromEntries(
    SATELLITE_CLASS_CHIP_IDS.map((id) => [id, token.includes(SATELLITE_CLASS_CHIP_CODES[id])]),
  );
}

/**
 * Flip one chip. Last-off becomes the empty token `0`.
 * @param {unknown} filter
 * @param {unknown} chipId
 * @returns {string}
 */
export function toggleSatelliteClassFilter(filter, chipId) {
  const id = String(chipId || '');
  if (!SATELLITE_CLASS_CHIP_IDS.includes(/** @type {SatelliteClassChipId} */ (id))) {
    return normalizeSatelliteClassFilter(filter);
  }
  const flags = satelliteClassFilterFlags(filter);
  flags[id] = !flags[id];
  return normalizeSatelliteClassFilter(flags);
}

/**
 * @param {{group?: string, noradId?: number}|null|undefined} sat
 * @param {unknown} filter
 * @param {{noradId?: number, trackedNorad?: number|null, isIss?: boolean}} [options]
 * @returns {boolean}
 */
export function satellitePassesClassFilter(sat, filter, {
  noradId = sat?.noradId,
  trackedNorad = null,
  isIss = false,
} = {}) {
  const id = Number(noradId);
  if (trackedNorad != null && Number.isFinite(id) && id === Number(trackedNorad)) return true;
  const flags = satelliteClassFilterFlags(filter);
  const { klass } = satelliteClassOf(sat?.group, {
    isIss: isIss === true || id === ISS_NORAD,
  });
  return flags[klass] === true;
}

/**
 * @param {Array<{group?: string, noradId?: number}>|null|undefined} satellites
 * @param {unknown} filter
 * @param {number|null} [trackedNorad]
 * @returns {Array}
 */
export function filterSatellitesByClass(satellites, filter, trackedNorad = null) {
  const list = Array.isArray(satellites) ? satellites : [];
  return list.filter((sat) => satellitePassesClassFilter(sat, filter, {
    noradId: sat?.noradId,
    trackedNorad,
    isIss: Number(sat?.noradId) === ISS_NORAD,
  }));
}

/** Durable / share encode. All-on stays the canonical default token. */
export function encodeSatelliteClassFilter(value) {
  return normalizeSatelliteClassFilter(value);
}

/** Durable / share decode. Invalid input becomes all-on. */
export function decodeSatelliteClassFilter(raw) {
  if (raw == null) return null;
  return normalizeSatelliteClassFilter(raw);
}
