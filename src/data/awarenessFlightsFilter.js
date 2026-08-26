/**
 * @module awarenessFlightsFilter
 * @description Client-only Flights-only toggle for the Global Context
 * panel roster and NEXT walk. Filters already-fetched `getNearby` records —
 * no extra fetch and no new endpoint.
 *
 * Off is a pass-through (all four cohorts stay). On keeps `flights`
 * (civil ADS-B) and drops military + AIS + `military-installations`.
 * Missing `layerId` fails open. The current subject always stays, even
 * when it is a military flight, vessel, or site.
 *
 * Distinct from Plan 213 Identified only, Plan 221 range-floor, Plan
 * 231 Aircraft only, Plan 251 Vessels only, Plan 259 Sites only, and
 * Plan 263 Military only. Persistence is local
 * (`meridian.awarenessFlightsOnly`) and hydrates on Context restore.
 * Share URLs are not written. Does not shrink AWARENESS_RADIUS_M.
 */

import { isAwarenessSubjectContact } from './awarenessIdentifiedFilter.js';

export const AWARENESS_FLIGHTS_DEFAULT = false;
export const AWARENESS_FLIGHTS_CHIP_ID = 'awareness-flights-only';
export const AWARENESS_FLIGHTS_CHIP_LABEL = 'Flights only';
export const AWARENESS_FLIGHTS_CHIP_TITLE =
  'Keep civil flights only on this Context roster.';
export const AWARENESS_FLIGHTS_STORAGE_KEY = 'meridian.awarenessFlightsOnly';
export const AWARENESS_FLIGHTS_LAYER_ID = 'flights';

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
 * Whether Flights-only allows this already-fetched contact on the roster.
 * Off is a pass-through. Missing layerId fails open. The current subject
 * always stays.
 * @param {object|null|undefined} contact
 * @param {{flightsOnly?: boolean, subjectId?: unknown}} [options]
 * @returns {boolean}
 */
export function passesAwarenessFlightsFilter(contact, {
  flightsOnly = AWARENESS_FLIGHTS_DEFAULT,
  subjectId = null,
} = {}) {
  if (flightsOnly !== true) return true;
  if (isAwarenessSubjectContact(contact, subjectId)) return true;
  const layerId = layerIdText(contact?.layerId);
  if (!layerId) return true;
  return layerId === AWARENESS_FLIGHTS_LAYER_ID;
}

/**
 * Keep civil flights when the toggle is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {{flightsOnly?: boolean, subjectId?: unknown}} [options]
 * @returns {Array<object>}
 */
export function filterAwarenessFlightsContacts(records, {
  flightsOnly = AWARENESS_FLIGHTS_DEFAULT,
  subjectId = null,
} = {}) {
  if (!Array.isArray(records)) return [];
  if (flightsOnly !== true) return records.slice();
  return records.filter((record) => passesAwarenessFlightsFilter(record, {
    flightsOnly: true,
    subjectId,
  }));
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeAwarenessFlightsOnly(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return AWARENESS_FLIGHTS_DEFAULT;
}

/**
 * Read the durable Context Flights-only preference.
 * Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readAwarenessFlightsOnlyEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(AWARENESS_FLIGHTS_STORAGE_KEY);
    if (raw == null) return AWARENESS_FLIGHTS_DEFAULT;
    return normalizeAwarenessFlightsOnly(raw);
  } catch {
    return AWARENESS_FLIGHTS_DEFAULT;
  }
}

/**
 * Persist the Context Flights-only preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeAwarenessFlightsOnlyEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(AWARENESS_FLIGHTS_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = AWARENESS_FLIGHTS_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getAwarenessFlightsOnlyEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setAwarenessFlightsOnlyEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeAwarenessFlightsOnly(enabled);
  currentEnabled = next;
  if (persist) writeAwarenessFlightsOnlyEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateAwarenessFlightsOnlyEnabled(storage) {
  return setAwarenessFlightsOnlyEnabled(readAwarenessFlightsOnlyEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeAwarenessFlightsOnlyEnabled(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetAwarenessFlightsOnlyForTest() {
  currentEnabled = AWARENESS_FLIGHTS_DEFAULT;
}

/** Context-panel chip for the Flights-only toggle. */
export function awarenessFlightsChipModel(active = AWARENESS_FLIGHTS_DEFAULT) {
  const on = active === true;
  return {
    id: AWARENESS_FLIGHTS_CHIP_ID,
    label: AWARENESS_FLIGHTS_CHIP_LABEL,
    active: on,
    title: AWARENESS_FLIGHTS_CHIP_TITLE,
    params: { flightsOnly: !on },
  };
}
