/**
 * @module awarenessVesselsFilter
 * @description Client-only Vessels-only toggle for the Global Context
 * panel roster and NEXT walk. Filters already-fetched `getNearby` records —
 * no extra fetch and no new endpoint.
 *
 * Off is a pass-through (all four cohorts stay). On keeps
 * `ais-live-vessels` and drops flights + military + `military-installations`.
 * Missing `layerId` fails open. The current subject always stays, even
 * when it is a flight or site.
 *
 * Distinct from Plan 213 Identified only, Plan 221 range-floor, and Plan
 * 231 Aircraft only (which drops AIS + sites and keeps flights + military).
 * Persistence is local (`meridian.awarenessVesselsOnly`) and hydrates on
 * Context restore. Share URLs are not written. Does not shrink
 * AWARENESS_RADIUS_M.
 */

import { isAwarenessSubjectContact } from './awarenessIdentifiedFilter.js';

export const AWARENESS_VESSELS_DEFAULT = false;
export const AWARENESS_VESSELS_CHIP_ID = 'awareness-vessels-only';
export const AWARENESS_VESSELS_CHIP_LABEL = 'Vessels only';
export const AWARENESS_VESSELS_CHIP_TITLE =
  'Keep AIS vessels only on this Context roster.';
export const AWARENESS_VESSELS_STORAGE_KEY = 'meridian.awarenessVesselsOnly';
export const AWARENESS_VESSELS_LAYER_ID = 'ais-live-vessels';

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
 * Whether Vessels-only allows this already-fetched contact on the roster.
 * Off is a pass-through. Missing layerId fails open. The current subject
 * always stays.
 * @param {object|null|undefined} contact
 * @param {{vesselsOnly?: boolean, subjectId?: unknown}} [options]
 * @returns {boolean}
 */
export function passesAwarenessVesselsFilter(contact, {
  vesselsOnly = AWARENESS_VESSELS_DEFAULT,
  subjectId = null,
} = {}) {
  if (vesselsOnly !== true) return true;
  if (isAwarenessSubjectContact(contact, subjectId)) return true;
  const layerId = layerIdText(contact?.layerId);
  if (!layerId) return true;
  return layerId === AWARENESS_VESSELS_LAYER_ID;
}

/**
 * Keep AIS vessels when the toggle is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {{vesselsOnly?: boolean, subjectId?: unknown}} [options]
 * @returns {Array<object>}
 */
export function filterAwarenessVesselsContacts(records, {
  vesselsOnly = AWARENESS_VESSELS_DEFAULT,
  subjectId = null,
} = {}) {
  if (!Array.isArray(records)) return [];
  if (vesselsOnly !== true) return records.slice();
  return records.filter((record) => passesAwarenessVesselsFilter(record, {
    vesselsOnly: true,
    subjectId,
  }));
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeAwarenessVesselsOnly(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return AWARENESS_VESSELS_DEFAULT;
}

/**
 * Read the durable Context Vessels-only preference.
 * Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readAwarenessVesselsOnlyEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(AWARENESS_VESSELS_STORAGE_KEY);
    if (raw == null) return AWARENESS_VESSELS_DEFAULT;
    return normalizeAwarenessVesselsOnly(raw);
  } catch {
    return AWARENESS_VESSELS_DEFAULT;
  }
}

/**
 * Persist the Context Vessels-only preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeAwarenessVesselsOnlyEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(AWARENESS_VESSELS_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = AWARENESS_VESSELS_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getAwarenessVesselsOnlyEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setAwarenessVesselsOnlyEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeAwarenessVesselsOnly(enabled);
  currentEnabled = next;
  if (persist) writeAwarenessVesselsOnlyEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateAwarenessVesselsOnlyEnabled(storage) {
  return setAwarenessVesselsOnlyEnabled(readAwarenessVesselsOnlyEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeAwarenessVesselsOnlyEnabled(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetAwarenessVesselsOnlyForTest() {
  currentEnabled = AWARENESS_VESSELS_DEFAULT;
}

/** Context-panel chip for the Vessels-only toggle. */
export function awarenessVesselsChipModel(active = AWARENESS_VESSELS_DEFAULT) {
  const on = active === true;
  return {
    id: AWARENESS_VESSELS_CHIP_ID,
    label: AWARENESS_VESSELS_CHIP_LABEL,
    active: on,
    title: AWARENESS_VESSELS_CHIP_TITLE,
    params: { vesselsOnly: !on },
  };
}
