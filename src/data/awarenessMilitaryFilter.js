/**
 * @module awarenessMilitaryFilter
 * @description Client-only Military-only toggle for the Global Context
 * panel roster and NEXT walk. Filters already-fetched `getNearby` records —
 * no extra fetch and no new endpoint.
 *
 * Off is a pass-through (all four cohorts stay). On keeps `military`
 * (military flights) and drops civil flights + AIS + `military-installations`.
 * Missing `layerId` fails open. The current subject always stays, even
 * when it is a civil flight, vessel, or site.
 *
 * Distinct from Plan 213 Identified only, Plan 221 range-floor, Plan
 * 231 Aircraft only, Plan 251 Vessels only, and Plan 259 Sites only.
 * Persistence is local (`meridian.awarenessMilitaryOnly`) and hydrates on
 * Context restore. Share URLs are not written. Does not shrink
 * AWARENESS_RADIUS_M.
 */

import { isAwarenessSubjectContact } from './awarenessIdentifiedFilter.js';

export const AWARENESS_MILITARY_DEFAULT = false;
export const AWARENESS_MILITARY_CHIP_ID = 'awareness-military-only';
export const AWARENESS_MILITARY_CHIP_LABEL = 'Military only';
export const AWARENESS_MILITARY_CHIP_TITLE =
  'Keep military flights only on this Context roster.';
export const AWARENESS_MILITARY_STORAGE_KEY = 'meridian.awarenessMilitaryOnly';
export const AWARENESS_MILITARY_LAYER_ID = 'military';

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
 * Whether Military-only allows this already-fetched contact on the roster.
 * Off is a pass-through. Missing layerId fails open. The current subject
 * always stays.
 * @param {object|null|undefined} contact
 * @param {{militaryOnly?: boolean, subjectId?: unknown}} [options]
 * @returns {boolean}
 */
export function passesAwarenessMilitaryFilter(contact, {
  militaryOnly = AWARENESS_MILITARY_DEFAULT,
  subjectId = null,
} = {}) {
  if (militaryOnly !== true) return true;
  if (isAwarenessSubjectContact(contact, subjectId)) return true;
  const layerId = layerIdText(contact?.layerId);
  if (!layerId) return true;
  return layerId === AWARENESS_MILITARY_LAYER_ID;
}

/**
 * Keep military flights when the toggle is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {{militaryOnly?: boolean, subjectId?: unknown}} [options]
 * @returns {Array<object>}
 */
export function filterAwarenessMilitaryContacts(records, {
  militaryOnly = AWARENESS_MILITARY_DEFAULT,
  subjectId = null,
} = {}) {
  if (!Array.isArray(records)) return [];
  if (militaryOnly !== true) return records.slice();
  return records.filter((record) => passesAwarenessMilitaryFilter(record, {
    militaryOnly: true,
    subjectId,
  }));
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeAwarenessMilitaryOnly(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return AWARENESS_MILITARY_DEFAULT;
}

/**
 * Read the durable Context Military-only preference.
 * Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readAwarenessMilitaryOnlyEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(AWARENESS_MILITARY_STORAGE_KEY);
    if (raw == null) return AWARENESS_MILITARY_DEFAULT;
    return normalizeAwarenessMilitaryOnly(raw);
  } catch {
    return AWARENESS_MILITARY_DEFAULT;
  }
}

/**
 * Persist the Context Military-only preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeAwarenessMilitaryOnlyEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(AWARENESS_MILITARY_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = AWARENESS_MILITARY_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getAwarenessMilitaryOnlyEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setAwarenessMilitaryOnlyEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeAwarenessMilitaryOnly(enabled);
  currentEnabled = next;
  if (persist) writeAwarenessMilitaryOnlyEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateAwarenessMilitaryOnlyEnabled(storage) {
  return setAwarenessMilitaryOnlyEnabled(readAwarenessMilitaryOnlyEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeAwarenessMilitaryOnlyEnabled(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetAwarenessMilitaryOnlyForTest() {
  currentEnabled = AWARENESS_MILITARY_DEFAULT;
}

/** Context-panel chip for the Military-only toggle. */
export function awarenessMilitaryChipModel(active = AWARENESS_MILITARY_DEFAULT) {
  const on = active === true;
  return {
    id: AWARENESS_MILITARY_CHIP_ID,
    label: AWARENESS_MILITARY_CHIP_LABEL,
    active: on,
    title: AWARENESS_MILITARY_CHIP_TITLE,
    params: { militaryOnly: !on },
  };
}
