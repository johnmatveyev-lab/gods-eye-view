/**
 * @module awarenessAircraftFilter
 * @description Client-only Aircraft-only toggle for the Global Context
 * panel roster and NEXT walk. Filters already-fetched `getNearby` records —
 * no extra fetch and no new endpoint.
 *
 * Off is a pass-through (all four cohorts stay). On keeps flights + military
 * and drops `ais-live-vessels` + `military-installations`. Missing `layerId`
 * fails open. The current subject always stays, even when it is a vessel
 * or site.
 *
 * Distinct from Plan 213 Identified only, Plan 221 range-floor, and the
 * cockpit walk-time `aircraftOnly` option. Persistence is local
 * (`meridian.awarenessAircraftOnly`) and hydrates on Context restore.
 * Share URLs are not written. Does not shrink AWARENESS_RADIUS_M.
 */

import { isAwarenessSubjectContact } from './awarenessIdentifiedFilter.js';

export const AWARENESS_AIRCRAFT_DEFAULT = false;
export const AWARENESS_AIRCRAFT_CHIP_ID = 'awareness-aircraft-only';
export const AWARENESS_AIRCRAFT_CHIP_LABEL = 'Aircraft only';
export const AWARENESS_AIRCRAFT_CHIP_TITLE =
  'Hide AIS vessels and mapped sites on this Context roster.';
export const AWARENESS_AIRCRAFT_STORAGE_KEY = 'meridian.awarenessAircraftOnly';

const DROPPED_LAYER_IDS = Object.freeze([
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
 * Whether Aircraft-only allows this already-fetched contact on the roster.
 * Off is a pass-through. Missing layerId fails open. The current subject
 * always stays.
 * @param {object|null|undefined} contact
 * @param {{aircraftOnly?: boolean, subjectId?: unknown}} [options]
 * @returns {boolean}
 */
export function passesAwarenessAircraftFilter(contact, {
  aircraftOnly = AWARENESS_AIRCRAFT_DEFAULT,
  subjectId = null,
} = {}) {
  if (aircraftOnly !== true) return true;
  if (isAwarenessSubjectContact(contact, subjectId)) return true;
  const layerId = layerIdText(contact?.layerId);
  if (!layerId) return true;
  return !DROPPED_LAYER_IDS.includes(layerId);
}

/**
 * Keep aircraft cohorts when the toggle is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {{aircraftOnly?: boolean, subjectId?: unknown}} [options]
 * @returns {Array<object>}
 */
export function filterAwarenessAircraftContacts(records, {
  aircraftOnly = AWARENESS_AIRCRAFT_DEFAULT,
  subjectId = null,
} = {}) {
  if (!Array.isArray(records)) return [];
  if (aircraftOnly !== true) return records.slice();
  return records.filter((record) => passesAwarenessAircraftFilter(record, {
    aircraftOnly: true,
    subjectId,
  }));
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeAwarenessAircraftOnly(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return AWARENESS_AIRCRAFT_DEFAULT;
}

/**
 * Read the durable Context Aircraft-only preference.
 * Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readAwarenessAircraftOnlyEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(AWARENESS_AIRCRAFT_STORAGE_KEY);
    if (raw == null) return AWARENESS_AIRCRAFT_DEFAULT;
    return normalizeAwarenessAircraftOnly(raw);
  } catch {
    return AWARENESS_AIRCRAFT_DEFAULT;
  }
}

/**
 * Persist the Context Aircraft-only preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeAwarenessAircraftOnlyEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(AWARENESS_AIRCRAFT_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = AWARENESS_AIRCRAFT_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getAwarenessAircraftOnlyEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setAwarenessAircraftOnlyEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeAwarenessAircraftOnly(enabled);
  currentEnabled = next;
  if (persist) writeAwarenessAircraftOnlyEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateAwarenessAircraftOnlyEnabled(storage) {
  return setAwarenessAircraftOnlyEnabled(readAwarenessAircraftOnlyEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeAwarenessAircraftOnlyEnabled(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetAwarenessAircraftOnlyForTest() {
  currentEnabled = AWARENESS_AIRCRAFT_DEFAULT;
}

/** Context-panel chip for the Aircraft-only toggle. */
export function awarenessAircraftChipModel(active = AWARENESS_AIRCRAFT_DEFAULT) {
  const on = active === true;
  return {
    id: AWARENESS_AIRCRAFT_CHIP_ID,
    label: AWARENESS_AIRCRAFT_CHIP_LABEL,
    active: on,
    title: AWARENESS_AIRCRAFT_CHIP_TITLE,
    params: { aircraftOnly: !on },
  };
}
