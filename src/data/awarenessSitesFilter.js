/**
 * @module awarenessSitesFilter
 * @description Client-only Sites-only toggle for the Global Context
 * panel roster and NEXT walk. Filters already-fetched `getNearby` records —
 * no extra fetch and no new endpoint.
 *
 * Off is a pass-through (all four cohorts stay). On keeps
 * `military-installations` and drops flights + military flights + AIS.
 * Missing `layerId` fails open. The current subject always stays, even
 * when it is a flight or vessel.
 *
 * Distinct from Plan 213 Identified only, Plan 221 range-floor, Plan
 * 231 Aircraft only, and Plan 251 Vessels only. Persistence is local
 * (`meridian.awarenessSitesOnly`) and hydrates on Context restore. Share
 * URLs are not written. Does not shrink AWARENESS_RADIUS_M.
 */

import { isAwarenessSubjectContact } from './awarenessIdentifiedFilter.js';

export const AWARENESS_SITES_DEFAULT = false;
export const AWARENESS_SITES_CHIP_ID = 'awareness-sites-only';
export const AWARENESS_SITES_CHIP_LABEL = 'Sites only';
export const AWARENESS_SITES_CHIP_TITLE =
  'Keep mapped sites only on this Context roster.';
export const AWARENESS_SITES_STORAGE_KEY = 'meridian.awarenessSitesOnly';
export const AWARENESS_SITES_LAYER_ID = 'military-installations';

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
 * Whether Sites-only allows this already-fetched contact on the roster.
 * Off is a pass-through. Missing layerId fails open. The current subject
 * always stays.
 * @param {object|null|undefined} contact
 * @param {{sitesOnly?: boolean, subjectId?: unknown}} [options]
 * @returns {boolean}
 */
export function passesAwarenessSitesFilter(contact, {
  sitesOnly = AWARENESS_SITES_DEFAULT,
  subjectId = null,
} = {}) {
  if (sitesOnly !== true) return true;
  if (isAwarenessSubjectContact(contact, subjectId)) return true;
  const layerId = layerIdText(contact?.layerId);
  if (!layerId) return true;
  return layerId === AWARENESS_SITES_LAYER_ID;
}

/**
 * Keep mapped sites when the toggle is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {{sitesOnly?: boolean, subjectId?: unknown}} [options]
 * @returns {Array<object>}
 */
export function filterAwarenessSitesContacts(records, {
  sitesOnly = AWARENESS_SITES_DEFAULT,
  subjectId = null,
} = {}) {
  if (!Array.isArray(records)) return [];
  if (sitesOnly !== true) return records.slice();
  return records.filter((record) => passesAwarenessSitesFilter(record, {
    sitesOnly: true,
    subjectId,
  }));
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeAwarenessSitesOnly(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return AWARENESS_SITES_DEFAULT;
}

/**
 * Read the durable Context Sites-only preference.
 * Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readAwarenessSitesOnlyEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(AWARENESS_SITES_STORAGE_KEY);
    if (raw == null) return AWARENESS_SITES_DEFAULT;
    return normalizeAwarenessSitesOnly(raw);
  } catch {
    return AWARENESS_SITES_DEFAULT;
  }
}

/**
 * Persist the Context Sites-only preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeAwarenessSitesOnlyEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(AWARENESS_SITES_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = AWARENESS_SITES_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getAwarenessSitesOnlyEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setAwarenessSitesOnlyEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeAwarenessSitesOnly(enabled);
  currentEnabled = next;
  if (persist) writeAwarenessSitesOnlyEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateAwarenessSitesOnlyEnabled(storage) {
  return setAwarenessSitesOnlyEnabled(readAwarenessSitesOnlyEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeAwarenessSitesOnlyEnabled(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetAwarenessSitesOnlyForTest() {
  currentEnabled = AWARENESS_SITES_DEFAULT;
}

/** Context-panel chip for the Sites-only toggle. */
export function awarenessSitesChipModel(active = AWARENESS_SITES_DEFAULT) {
  const on = active === true;
  return {
    id: AWARENESS_SITES_CHIP_ID,
    label: AWARENESS_SITES_CHIP_LABEL,
    active: on,
    title: AWARENESS_SITES_CHIP_TITLE,
    params: { sitesOnly: !on },
  };
}
