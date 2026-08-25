/**
 * @module satGroup
 * @description Hosted CelesTrak group picker for the Satellites layer.
 *
 * The existing `/api/celestrak/<group>` proxy accepts `/^[a-z0-9-]+$/i`.
 * This picker lists only groups that regex already allows and that the sats
 * client already requests, plus `weather`. `active` stays on launches — CelesTrak
 * 403s that bulk group without a User-Agent. Preference lives in localStorage
 * `meridian.satGroup` and is never written into share URLs.
 */

import { CELESTRAK_GROUP_RE } from './celestrak.js';

export const SAT_GROUP_STORAGE_KEY = 'meridian.satGroup';
export const DEFAULT_SAT_GROUP = 'stations';
export const SAT_GROUP_CHANGE_EVENT = 'meridian:sat-group';

/**
 * Allowlisted CelesTrak GROUP paths. `tag` is the internal catalog key used
 * for class/style lookup (`glo-ops` is CelesTrak's name; we tag it `glonass`).
 * @type {ReadonlyArray<{ id: string, path: string, tag: string, label: string }>}
 */
export const SAT_GROUPS = Object.freeze([
  Object.freeze({ id: 'stations', path: 'stations', tag: 'stations', label: 'Stations' }),
  Object.freeze({ id: 'weather', path: 'weather', tag: 'weather', label: 'Weather' }),
  Object.freeze({ id: 'visual', path: 'visual', tag: 'visual', label: 'Visual' }),
  Object.freeze({ id: 'gps-ops', path: 'gps-ops', tag: 'gps-ops', label: 'GPS' }),
  Object.freeze({ id: 'glo-ops', path: 'glo-ops', tag: 'glonass', label: 'GLONASS' }),
  Object.freeze({ id: 'galileo', path: 'galileo', tag: 'galileo', label: 'Galileo' }),
  Object.freeze({ id: 'geo', path: 'geo', tag: 'geo', label: 'GEO' }),
]);

const SAT_GROUP_BY_ID = Object.freeze(Object.fromEntries(
  SAT_GROUPS.map((group) => [group.id, group]),
));

/** @type {string|null} */
let cachedGroup = null;

/** Clear the in-memory preference so the next read hits storage (reload / tests). */
export function resetSatGroupCache() {
  cachedGroup = null;
}

/**
 * Groups shown in the Sats picker. Drops anything the proxy regex rejects
 * and never surfaces launches-only `active`.
 * @returns {ReadonlyArray<{ id: string, path: string, tag: string, label: string }>}
 */
export function listSatGroups() {
  return SAT_GROUPS.filter((group) => (
    CELESTRAK_GROUP_RE.test(group.id)
    && group.id !== 'active'
    && !group.id.includes('/')
  ));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSatGroup(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw.includes('/') || raw.includes('\\') || !CELESTRAK_GROUP_RE.test(raw)) {
    return DEFAULT_SAT_GROUP;
  }
  return SAT_GROUP_BY_ID[raw] ? raw : DEFAULT_SAT_GROUP;
}

/**
 * @param {string} group
 * @returns {{ id: string, path: string, tag: string, label: string }}
 */
export function satGroupSpec(group) {
  const id = normalizeSatGroup(group);
  return SAT_GROUP_BY_ID[id] || SAT_GROUP_BY_ID[DEFAULT_SAT_GROUP];
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {string}
 */
export function readSatGroupPreference(storage) {
  try {
    return normalizeSatGroup(storage?.getItem?.(SAT_GROUP_STORAGE_KEY));
  } catch {
    return DEFAULT_SAT_GROUP;
  }
}

/**
 * @param {unknown} group
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {string}
 */
export function writeSatGroupPreference(group, storage) {
  const normalized = normalizeSatGroup(group);
  try {
    storage?.setItem?.(SAT_GROUP_STORAGE_KEY, normalized);
  } catch {
    // Fail open: the session can still fetch the chosen group.
  }
  return normalized;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function getSatGroup(storage = globalThis.localStorage) {
  if (cachedGroup) return cachedGroup;
  cachedGroup = readSatGroupPreference(storage);
  return cachedGroup;
}

/**
 * @param {unknown} group
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {string}
 */
export function setSatGroup(group, storage = globalThis.localStorage) {
  cachedGroup = writeSatGroupPreference(group, storage);
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent(SAT_GROUP_CHANGE_EVENT, { detail: { group: cachedGroup } }));
  }
  return cachedGroup;
}
