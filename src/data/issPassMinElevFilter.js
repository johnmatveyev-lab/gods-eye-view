/**
 * @module issPassMinElevFilter
 * @description Client-only exclusive ISS next-pass horizon chips.
 *
 * 10° | 30° | 40° re-runs `findNextIssPass` on the already-loaded ISS satrec
 * and camera cartographic. Persistence lives in localStorage
 * `meridian.issPassMinElev` and is never written into share URLs.
 * No extra CelesTrak fetch. Not an alert service.
 */

import { DEFAULT_ISS_PASS_MIN_ELEV_DEG } from './issPass.js';

/** Exclusive 10° | 30° | 40° chips. `10` is today's existing default. */
export const ISS_PASS_MIN_ELEV_CHIPS = Object.freeze([
  Object.freeze({
    id: 10,
    elevDeg: 10,
    label: '10°',
    title: 'Count ISS passes that clear 10° — the current default',
  }),
  Object.freeze({
    id: 30,
    elevDeg: 30,
    label: '30°',
    title: 'Skip ISS passes that peak below 30°',
  }),
  Object.freeze({
    id: 40,
    elevDeg: 40,
    label: '40°',
    title: 'Skip ISS passes that peak below 40°',
  }),
]);

export const ISS_PASS_MIN_ELEV_STORAGE_KEY = 'meridian.issPassMinElev';
export const DEFAULT_ISS_PASS_MIN_ELEV = DEFAULT_ISS_PASS_MIN_ELEV_DEG;

/** @typedef {10|30|40} IssPassMinElevDeg */

/** @type {IssPassMinElevDeg|null} */
let cachedMinElev = null;

/** Clear the in-memory preference so the next read hits storage (reload / tests). */
export function resetIssPassMinElevCache() {
  cachedMinElev = null;
}

/**
 * Accept only the shipped chip floors. Unknown values stay 10° so a stale
 * preference cannot invent a new CelesTrak query.
 * @param {unknown} value
 * @returns {IssPassMinElevDeg}
 */
export function normalizeIssPassMinElev(value) {
  if (value === 30 || value === '30' || value === '30°') return 30;
  if (value === 40 || value === '40' || value === '40°') return 40;
  if (value === 10 || value === '10' || value === '10°') return 10;
  return DEFAULT_ISS_PASS_MIN_ELEV;
}

/**
 * Horizon cut in degrees for a chip.
 * @param {unknown} floorId
 * @returns {IssPassMinElevDeg}
 */
export function issPassMinElevDeg(floorId) {
  const id = normalizeIssPassMinElev(floorId);
  switch (id) {
    case 10:
      return 10;
    case 30:
      return 30;
    case 40:
      return 40;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      void _exhaustive;
      return DEFAULT_ISS_PASS_MIN_ELEV;
    }
  }
}

/**
 * Whether one predicted pass clears the horizon cut.
 * Missing / non-finite peak elevation does not invent a pass.
 * @param {{maxElevDeg?: number}|null|undefined} pass
 * @param {unknown} [filter]
 * @returns {boolean}
 */
export function issPassClearsMinElev(pass, filter = DEFAULT_ISS_PASS_MIN_ELEV) {
  const floor = issPassMinElevDeg(filter);
  const peak = Number(pass?.maxElevDeg);
  if (!Number.isFinite(peak)) return false;
  return peak >= floor;
}

/**
 * Exclusive-chip models for the Satellites data-layer row.
 * @param {unknown} [current]
 * @returns {Array<object>}
 */
export function issPassMinElevChipModels(current = DEFAULT_ISS_PASS_MIN_ELEV) {
  const floor = normalizeIssPassMinElev(current);
  return ISS_PASS_MIN_ELEV_CHIPS.map((chip) => {
    switch (chip.id) {
      case 10:
      case 30:
      case 40:
        return {
          id: `iss-elev-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: floor === chip.id,
          group: 'Elev',
          params: { issPassMinElev: chip.id },
        };
      default: {
        const _exhaustive = /** @type {never} */ (chip.id);
        void _exhaustive;
        return {
          id: `iss-elev-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: false,
          group: 'Elev',
          params: { issPassMinElev: floor },
        };
      }
    }
  });
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {IssPassMinElevDeg}
 */
export function readIssPassMinElevPreference(storage) {
  try {
    return normalizeIssPassMinElev(storage?.getItem?.(ISS_PASS_MIN_ELEV_STORAGE_KEY));
  } catch {
    return DEFAULT_ISS_PASS_MIN_ELEV;
  }
}

/**
 * @param {unknown} elev
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {IssPassMinElevDeg}
 */
export function writeIssPassMinElevPreference(elev, storage) {
  const normalized = normalizeIssPassMinElev(elev);
  try {
    storage?.setItem?.(ISS_PASS_MIN_ELEV_STORAGE_KEY, String(normalized));
  } catch {
    // Fail open: the session can still apply the chosen horizon cut.
  }
  return normalized;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {IssPassMinElevDeg}
 */
export function getIssPassMinElev(storage = globalThis.localStorage) {
  if (cachedMinElev != null) return cachedMinElev;
  cachedMinElev = readIssPassMinElevPreference(storage);
  return cachedMinElev;
}

/**
 * Exclusive chip set. Clicking 10° | 30° | 40° replaces the current cut.
 * @param {unknown} elev
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {IssPassMinElevDeg}
 */
export function setIssPassMinElev(elev, storage = globalThis.localStorage) {
  cachedMinElev = writeIssPassMinElevPreference(elev, storage);
  return cachedMinElev;
}
