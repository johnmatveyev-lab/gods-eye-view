/**
 * @module awarenessRangeFilter
 * @description Client-only exclusive All | <50 km | <10 km chips for the
 * Global Context panel roster and NEXT walk. Filters already-fetched
 * `getNearby` records — no extra fetch and no new endpoint.
 *
 * All is a pass-through (current 250 km window stays). <50 km drops 200 km
 * contacts and keeps 40 km. <10 km keeps 8 km and drops 40 km. Missing /
 * non-finite `distanceM` (or the flights `distance` field) fails open. The
 * current subject always stays.
 *
 * Distinct from Plan 213 Identified only. Persistence is local
 * (`meridian.awarenessRange`) and hydrates on Context restore. Share URLs
 * are not written. Does not shrink AWARENESS_RADIUS_M.
 */

import { isAwarenessSubjectContact } from './awarenessIdentifiedFilter.js';

export const AWARENESS_RANGE_DEFAULT = 'all';
export const AWARENESS_RANGE_STORAGE_KEY = 'meridian.awarenessRange';
export const AWARENESS_RANGE_CHIP_IDS = Object.freeze(['all', '50', '10']);
export const AWARENESS_RANGE_CHIP_LABELS = Object.freeze({
  all: 'All',
  50: '<50 km',
  10: '<10 km',
});
export const AWARENESS_RANGE_CHIP_TITLES = Object.freeze({
  all: 'Show every contact in the current 250 km window',
  50: 'Hide contacts at or beyond 50 km',
  10: 'Hide contacts at or beyond 10 km',
});
export const AWARENESS_RANGE_50_M = 50_000;
export const AWARENESS_RANGE_10_M = 10_000;

/** @typedef {'all'|'50'|'10'} AwarenessRangeChipId */

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Canonical exclusive chip. Invalid input becomes the All default.
 * @param {unknown} value
 * @returns {AwarenessRangeChipId}
 */
export function normalizeAwarenessRange(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === '50' || text === '<50' || text === '50km' || text === '<50 km' || text === '<50km') {
    return '50';
  }
  if (text === '10' || text === '<10' || text === '10km' || text === '<10 km' || text === '<10km') {
    return '10';
  }
  if (text === 'all' || text === '0' || text === '' || text === '250') {
    return AWARENESS_RANGE_DEFAULT;
  }
  return AWARENESS_RANGE_DEFAULT;
}

/**
 * Exclusive-chip ceiling in metres. All has no ceiling.
 * @param {unknown} rangeId
 * @returns {number|null}
 */
export function awarenessRangeCeilingM(rangeId) {
  switch (normalizeAwarenessRange(rangeId)) {
    case 'all':
      return null;
    case '50':
      return AWARENESS_RANGE_50_M;
    case '10':
      return AWARENESS_RANGE_10_M;
    default: {
      const unexpected = /** @type {never} */ (normalizeAwarenessRange(rangeId));
      throw new Error(`unexpected awareness range: ${unexpected}`);
    }
  }
}

/**
 * Distance already stamped on a getNearby record. Flights use `distance`;
 * AIS and installations use `distanceM`. The engine later aliases them.
 * @param {object|null|undefined} contact
 * @returns {number}
 */
export function awarenessContactDistanceM(contact) {
  const raw = contact?.distanceM ?? contact?.distance;
  if (raw == null || raw === '') return Number.NaN;
  return Number(raw);
}

/**
 * Whether the range chip allows this already-fetched contact on the roster.
 * All is a pass-through. Missing / non-finite distance fails open. The
 * current subject always stays.
 * @param {object|null|undefined} contact
 * @param {{range?: unknown, subjectId?: unknown}} [options]
 * @returns {boolean}
 */
export function passesAwarenessRangeFilter(contact, {
  range = AWARENESS_RANGE_DEFAULT,
  subjectId = null,
} = {}) {
  if (isAwarenessSubjectContact(contact, subjectId)) return true;
  const ceilingM = awarenessRangeCeilingM(range);
  if (ceilingM == null) return true;
  const distanceM = awarenessContactDistanceM(contact);
  if (!Number.isFinite(distanceM)) return true;
  return distanceM < ceilingM;
}

/**
 * Keep in-range contacts for the active chip. All returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {{range?: unknown, subjectId?: unknown}} [options]
 * @returns {Array<object>}
 */
export function filterAwarenessRangeContacts(records, {
  range = AWARENESS_RANGE_DEFAULT,
  subjectId = null,
} = {}) {
  if (!Array.isArray(records)) return [];
  if (awarenessRangeCeilingM(range) == null) return records.slice();
  return records.filter((record) => passesAwarenessRangeFilter(record, { range, subjectId }));
}

/**
 * Exclusive-chip models for the Context panel row.
 * @param {unknown} [current]
 * @returns {Array<object>}
 */
export function awarenessRangeChipModels(current = AWARENESS_RANGE_DEFAULT) {
  const floor = normalizeAwarenessRange(current);
  return AWARENESS_RANGE_CHIP_IDS.map((id) => ({
    id,
    label: AWARENESS_RANGE_CHIP_LABELS[id],
    title: AWARENESS_RANGE_CHIP_TITLES[id],
    active: floor === id,
    params: { range: id },
  }));
}

/**
 * Read the durable Context range preference.
 * Storage failures fail open to All.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {AwarenessRangeChipId}
 */
export function readAwarenessRangeFilter(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(AWARENESS_RANGE_STORAGE_KEY);
    if (raw == null || raw === '') return AWARENESS_RANGE_DEFAULT;
    return normalizeAwarenessRange(raw);
  } catch {
    return AWARENESS_RANGE_DEFAULT;
  }
}

/**
 * Persist the Context range preference. Best-effort; never throws.
 * @param {unknown} rangeId
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeAwarenessRangeFilter(rangeId, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(AWARENESS_RANGE_STORAGE_KEY, normalizeAwarenessRange(rangeId));
    return true;
  } catch {
    return false;
  }
}

let currentRange = AWARENESS_RANGE_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getAwarenessRangeFilter() {
  return currentRange;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} rangeId
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {AwarenessRangeChipId}
 */
export function setAwarenessRangeFilter(rangeId, { persist = true, storage } = {}) {
  const next = normalizeAwarenessRange(rangeId);
  currentRange = next;
  if (persist) writeAwarenessRangeFilter(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {AwarenessRangeChipId}
 */
export function hydrateAwarenessRangeFilter(storage) {
  return setAwarenessRangeFilter(readAwarenessRangeFilter(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(rangeId: AwarenessRangeChipId) => void} listener
 * @returns {() => void}
 */
export function subscribeAwarenessRangeFilter(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore the default All preference without notifying layers. */
export function resetAwarenessRangeForTest() {
  currentRange = AWARENESS_RANGE_DEFAULT;
}
