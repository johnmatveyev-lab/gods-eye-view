/**
 * @module awarenessHideNoTrackFilter
 * @description Client-only Hide no track toggle for the Global Context
 * panel roster and NEXT walk. Filters already-fetched `getNearby` records —
 * no extra fetch and no new endpoint.
 *
 * Off is a pass-through (current roster stays, including a civil flight
 * with `track` null). On hides `flights` + `military` contacts whose
 * `track` is missing or non-finite. AIS and `military-installations` fail
 * open — they never stamp track, and this is not an aircraft-only chip.
 * Missing `layerId` fails open. The current subject always stays, even
 * when it has no track. 0° (north) is finite and stays.
 *
 * Distinct from Plan 213 Identified only, Plan 221 range-floor, Plan
 * 231 Aircraft only, Plan 251 Vessels only, Plan 259 Sites only, Plan
 * 263 Military only, and Plan 269 Flights only. Persistence is local
 * (`meridian.awarenessHideNoTrack`) and hydrates on Context restore.
 * Share URLs are not written. Does not shrink AWARENESS_RADIUS_M.
 */

import { isAwarenessSubjectContact } from './awarenessIdentifiedFilter.js';

export const AWARENESS_HIDE_NO_TRACK_DEFAULT = false;
export const AWARENESS_HIDE_NO_TRACK_CHIP_ID = 'awareness-hide-no-track';
export const AWARENESS_HIDE_NO_TRACK_CHIP_LABEL = 'Hide no track';
export const AWARENESS_HIDE_NO_TRACK_CHIP_TITLE =
  'Hide flights and military contacts that have no course on this Context roster.';
export const AWARENESS_HIDE_NO_TRACK_STORAGE_KEY = 'meridian.awarenessHideNoTrack';
export const AWARENESS_HIDE_NO_TRACK_LAYER_IDS = Object.freeze(['flights', 'military']);
export const AWARENESS_HIDE_NO_TRACK_FAIL_OPEN_LAYER_IDS = Object.freeze([
  'ais-live-vessels',
  'military-installations',
]);

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function layerIdText(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

/**
 * Course already stamped on a getNearby record. Civil and military rows
 * carry `track` (degrees). AIS and sites omit it.
 * @param {object|null|undefined} contact
 * @returns {number}
 */
export function awarenessContactTrack(contact) {
  const raw = contact?.track;
  if (raw == null || raw === '') return Number.NaN;
  const numeric = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

/**
 * Whether Hide no track allows this already-fetched contact on the roster.
 * Off is a pass-through. AIS, sites, and missing layerId fail open. The
 * current subject always stays.
 * @param {object|null|undefined} contact
 * @param {{hideNoTrack?: boolean, subjectId?: unknown}} [options]
 * @returns {boolean}
 */
export function passesAwarenessHideNoTrackFilter(contact, {
  hideNoTrack = AWARENESS_HIDE_NO_TRACK_DEFAULT,
  subjectId = null,
} = {}) {
  if (hideNoTrack !== true) return true;
  if (isAwarenessSubjectContact(contact, subjectId)) return true;
  const layerId = layerIdText(contact?.layerId);
  if (!layerId) return true;
  if (AWARENESS_HIDE_NO_TRACK_FAIL_OPEN_LAYER_IDS.includes(layerId)) return true;
  if (!AWARENESS_HIDE_NO_TRACK_LAYER_IDS.includes(layerId)) return true;
  return Number.isFinite(awarenessContactTrack(contact));
}

/**
 * Keep contacts with a course when the toggle is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {{hideNoTrack?: boolean, subjectId?: unknown}} [options]
 * @returns {Array<object>}
 */
export function filterAwarenessHideNoTrackContacts(records, {
  hideNoTrack = AWARENESS_HIDE_NO_TRACK_DEFAULT,
  subjectId = null,
} = {}) {
  if (!Array.isArray(records)) return [];
  if (hideNoTrack !== true) return records.slice();
  return records.filter((record) => passesAwarenessHideNoTrackFilter(record, {
    hideNoTrack: true,
    subjectId,
  }));
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeAwarenessHideNoTrack(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return AWARENESS_HIDE_NO_TRACK_DEFAULT;
}

/**
 * Read the durable Context Hide no track preference.
 * Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readAwarenessHideNoTrackEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(AWARENESS_HIDE_NO_TRACK_STORAGE_KEY);
    if (raw == null) return AWARENESS_HIDE_NO_TRACK_DEFAULT;
    return normalizeAwarenessHideNoTrack(raw);
  } catch {
    return AWARENESS_HIDE_NO_TRACK_DEFAULT;
  }
}

/**
 * Persist the Context Hide no track preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeAwarenessHideNoTrackEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(AWARENESS_HIDE_NO_TRACK_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = AWARENESS_HIDE_NO_TRACK_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getAwarenessHideNoTrackEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setAwarenessHideNoTrackEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeAwarenessHideNoTrack(enabled);
  currentEnabled = next;
  if (persist) writeAwarenessHideNoTrackEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateAwarenessHideNoTrackEnabled(storage) {
  return setAwarenessHideNoTrackEnabled(readAwarenessHideNoTrackEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeAwarenessHideNoTrackEnabled(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetAwarenessHideNoTrackForTest() {
  currentEnabled = AWARENESS_HIDE_NO_TRACK_DEFAULT;
}

/** Context-panel chip for the Hide no track toggle. */
export function awarenessHideNoTrackChipModel(active = AWARENESS_HIDE_NO_TRACK_DEFAULT) {
  const on = active === true;
  return {
    id: AWARENESS_HIDE_NO_TRACK_CHIP_ID,
    label: AWARENESS_HIDE_NO_TRACK_CHIP_LABEL,
    active: on,
    title: AWARENESS_HIDE_NO_TRACK_CHIP_TITLE,
    params: { hideNoTrack: !on },
  };
}
