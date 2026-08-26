/**
 * @module awarenessIdentifiedFilter
 * @description Client-only Identified-only toggle for the Global Context
 * panel roster and NEXT walk. Filters already-fetched `getNearby` records —
 * no extra fetch and no new endpoint.
 *
 * Off is a pass-through (current 250 km view stays). On drops a contact
 * unless it already carries a human label: flight callsign or registration,
 * vessel name, or installation `hasName`. The current subject always stays.
 *
 * Distinct from globe Identified / Named / Mapped-only chips. Persistence is
 * local (`meridian.awarenessIdentified`) and hydrates on Context restore.
 * Share URLs are not written.
 */

export const AWARENESS_IDENTIFIED_DEFAULT = false;
export const AWARENESS_IDENTIFIED_CHIP_ID = 'awareness-identified-only';
export const AWARENESS_IDENTIFIED_CHIP_LABEL = 'Identified only';
export const AWARENESS_IDENTIFIED_CHIP_TITLE =
  'Hide hex-only flights and unnamed vessels or sites on this Context roster.';
export const AWARENESS_IDENTIFIED_STORAGE_KEY = 'meridian.awarenessIdentified';
export const AWARENESS_GENERIC_VESSEL_LABEL = 'VESSEL';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trimmed identity text. Missing, null, empty, and whitespace-only become ''.
 * @param {unknown} value
 * @returns {string}
 */
export function identityFieldText(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

/**
 * Whether an AIS `name` is a real ship name rather than a feed fallback.
 * @param {{name?: unknown, mmsi?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function vesselHasHumanName(contact) {
  const text = identityFieldText(contact?.name);
  if (!text) return false;
  if (text.toLowerCase() === AWARENESS_GENERIC_VESSEL_LABEL.toLowerCase()) return false;
  if (/^MMSI\s*\d+$/i.test(text)) return false;
  const mmsi = identityFieldText(contact?.mmsi);
  return !(mmsi && text === mmsi);
}

/**
 * Whether one in-memory getNearby record already carries a human label.
 * @param {object|null|undefined} contact
 * @returns {boolean}
 */
export function contactHasHumanLabel(contact) {
  if (!contact) return false;
  // Installations stamp `hasName` at normalize time. Class-only labels still
  // occupy `name` when hasName is false, so that flag is authoritative.
  if (contact.hasName === true) return true;
  if (contact.hasName === false) return false;
  if (identityFieldText(contact.callsign)) return true;
  if (identityFieldText(contact.registration)) return true;
  if (identityFieldText(contact.mmsi)) return vesselHasHumanName(contact);

  // Civil flights stamp the display label on `id` (callsign → registration →
  // hex) and omit `registration` from the nearby record.
  const icao24 = identityFieldText(contact.icao24);
  if (icao24) {
    const label = identityFieldText(contact.id);
    if (label && label.toLowerCase() !== icao24.toLowerCase()) return true;
  }
  return false;
}

function contactIdentityKeys(contact) {
  return [contact?.icao24, contact?.mmsi, contact?.id]
    .map((value) => identityFieldText(value))
    .filter(Boolean);
}

/**
 * Whether this record is the current Context subject.
 * Accepts a bare id (`ae01ce`) or a `layerId:id` key.
 * @param {object|null|undefined} contact
 * @param {unknown} subjectId
 * @returns {boolean}
 */
export function isAwarenessSubjectContact(contact, subjectId) {
  const wanted = identityFieldText(subjectId).toLowerCase();
  if (!wanted || !contact) return false;
  const bare = wanted.includes(':') ? wanted.slice(wanted.indexOf(':') + 1) : wanted;
  return contactIdentityKeys(contact).some((key) => {
    const normalized = key.toLowerCase();
    return normalized === bare || normalized === wanted;
  });
}

/**
 * Whether Identified-only allows this already-fetched contact on the roster.
 * Off is a pass-through. The current subject always stays.
 * @param {object|null|undefined} contact
 * @param {{identifiedOnly?: boolean, subjectId?: unknown}} [options]
 * @returns {boolean}
 */
export function passesAwarenessIdentifiedFilter(contact, {
  identifiedOnly = AWARENESS_IDENTIFIED_DEFAULT,
  subjectId = null,
} = {}) {
  if (identifiedOnly !== true) return true;
  if (isAwarenessSubjectContact(contact, subjectId)) return true;
  return contactHasHumanLabel(contact);
}

/**
 * Keep identified contacts when the toggle is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {{identifiedOnly?: boolean, subjectId?: unknown}} [options]
 * @returns {Array<object>}
 */
export function filterAwarenessIdentifiedContacts(records, {
  identifiedOnly = AWARENESS_IDENTIFIED_DEFAULT,
  subjectId = null,
} = {}) {
  if (!Array.isArray(records)) return [];
  if (identifiedOnly !== true) return records.slice();
  return records.filter((record) => passesAwarenessIdentifiedFilter(record, {
    identifiedOnly: true,
    subjectId,
  }));
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeAwarenessIdentified(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return AWARENESS_IDENTIFIED_DEFAULT;
}

/**
 * Read the durable Context Identified-only preference.
 * Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readAwarenessIdentifiedEnabled(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(AWARENESS_IDENTIFIED_STORAGE_KEY);
    if (raw == null) return AWARENESS_IDENTIFIED_DEFAULT;
    return normalizeAwarenessIdentified(raw);
  } catch {
    return AWARENESS_IDENTIFIED_DEFAULT;
  }
}

/**
 * Persist the Context Identified-only preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeAwarenessIdentifiedEnabled(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(AWARENESS_IDENTIFIED_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = AWARENESS_IDENTIFIED_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getAwarenessIdentifiedEnabled() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setAwarenessIdentifiedEnabled(enabled, { persist = true, storage } = {}) {
  const next = normalizeAwarenessIdentified(enabled);
  currentEnabled = next;
  if (persist) writeAwarenessIdentifiedEnabled(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateAwarenessIdentifiedEnabled(storage) {
  return setAwarenessIdentifiedEnabled(readAwarenessIdentifiedEnabled(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeAwarenessIdentifiedEnabled(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without notifying layers. */
export function resetAwarenessIdentifiedForTest() {
  currentEnabled = AWARENESS_IDENTIFIED_DEFAULT;
}

/** Context-panel chip for the Identified-only toggle. */
export function awarenessIdentifiedChipModel(active = AWARENESS_IDENTIFIED_DEFAULT) {
  const on = active === true;
  return {
    id: AWARENESS_IDENTIFIED_CHIP_ID,
    label: AWARENESS_IDENTIFIED_CHIP_LABEL,
    active: on,
    title: AWARENESS_IDENTIFIED_CHIP_TITLE,
    params: { identifiedOnly: !on },
  };
}
