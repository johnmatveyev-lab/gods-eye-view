/**
 * @module militaryFlightIdentifiedFilter
 * @description Client-only Identified-only toggle for already-fetched
 * military contacts. Uses the current `callsign` and `registration`
 * fields — no extra fetch and no new endpoint.
 *
 * Off is a pass-through (current draw stays). On hides hex-only contacts:
 * missing, null, empty, and whitespace-only identities count as empty after
 * trim. A non-empty callsign or a non-empty registration stays.
 *
 * Selected/tracked exemption lives on the layer AND gate, not here.
 * Persistence is local (`meridian.militaryFlightsIdentifiedOnly`), a
 * military-only key that does not share storage with the civil toggle.
 */

export const MILITARY_IDENTIFIED_ONLY_DEFAULT = false;
export const MILITARY_IDENTIFIED_ONLY_CHIP_ID = 'identified-only';
export const MILITARY_IDENTIFIED_ONLY_CHIP_LABEL = 'Identified only';
export const MILITARY_IDENTIFIED_ONLY_CHIP_TITLE =
  'Hide hex-only military tracks that have no callsign and no registration.';
export const MILITARY_FLIGHTS_IDENTIFIED_ONLY_STORAGE_KEY = 'meridian.militaryFlightsIdentifiedOnly';

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
 * Whether one in-memory military contact already carries a usable callsign
 * or registration. Hex-only rows fail.
 * @param {{callsign?: unknown, registration?: unknown}|null|undefined} contact
 * @returns {boolean}
 */
export function militaryContactHasIdent(contact) {
  return identityFieldText(contact?.callsign) !== ''
    || identityFieldText(contact?.registration) !== '';
}

/**
 * Whether Identified-only allows this military contact to draw.
 * Off is a pass-through. On requires a non-empty callsign or registration.
 * @param {{callsign?: unknown, registration?: unknown, identifiedOnly?: boolean}} [input]
 * @returns {boolean}
 */
export function passesMilitaryIdentifiedOnlyFilter({
  callsign,
  registration,
  identifiedOnly = MILITARY_IDENTIFIED_ONLY_DEFAULT,
} = {}) {
  if (identifiedOnly !== true) return true;
  return militaryContactHasIdent({ callsign, registration });
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeMilitaryIdentifiedOnly(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return MILITARY_IDENTIFIED_ONLY_DEFAULT;
}

/**
 * Read the durable military Identified-only preference.
 * Storage failures fail closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readMilitaryFlightsIdentifiedOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(MILITARY_FLIGHTS_IDENTIFIED_ONLY_STORAGE_KEY);
    if (raw == null) return MILITARY_IDENTIFIED_ONLY_DEFAULT;
    return normalizeMilitaryIdentifiedOnly(raw);
  } catch {
    return MILITARY_IDENTIFIED_ONLY_DEFAULT;
  }
}

/**
 * Persist the military Identified-only preference. Best-effort; never throws.
 * @param {boolean} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean} true only when the write landed
 */
export function writeMilitaryFlightsIdentifiedOnly(enabled, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(MILITARY_FLIGHTS_IDENTIFIED_ONLY_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

let currentEnabled = MILITARY_IDENTIFIED_ONLY_DEFAULT;
const listeners = new Set();

/** Live in-memory preference for this session. */
export function getMilitaryFlightsIdentifiedOnly() {
  return currentEnabled;
}

/**
 * Set the live preference, optionally persist it, and notify subscribers.
 * @param {unknown} enabled
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setMilitaryFlightsIdentifiedOnly(enabled, { persist = true, storage } = {}) {
  const next = normalizeMilitaryIdentifiedOnly(enabled);
  currentEnabled = next;
  if (persist) writeMilitaryFlightsIdentifiedOnly(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * Hydrate the live preference from durable storage without rewriting it.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateMilitaryFlightsIdentifiedOnly(storage) {
  return setMilitaryFlightsIdentifiedOnly(readMilitaryFlightsIdentifiedOnly(storage), {
    persist: false,
    storage,
  });
}

/**
 * Subscribe to live preference changes. Returns an unsubscribe function.
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeMilitaryFlightsIdentifiedOnly(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: restore the default OFF preference without clearing subscribers. */
export function resetMilitaryFlightsIdentifiedOnlyForTest() {
  currentEnabled = MILITARY_IDENTIFIED_ONLY_DEFAULT;
  for (const listener of listeners) listener(currentEnabled);
}

/**
 * Keep identified contacts when the toggle is on. Off returns a shallow copy.
 * A selected id stays even when it would otherwise hide.
 * @param {Array<object>|null|undefined} contacts
 * @param {unknown} [identifiedOnly=MILITARY_IDENTIFIED_ONLY_DEFAULT]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterMilitaryContactsByIdentifiedOnly(
  contacts,
  identifiedOnly = MILITARY_IDENTIFIED_ONLY_DEFAULT,
  selectedId = null,
) {
  if (!Array.isArray(contacts)) return [];
  if (normalizeMilitaryIdentifiedOnly(identifiedOnly) !== true) return contacts.slice();
  const keepId = selectedId == null || selectedId === '' ? null : String(selectedId);
  return contacts.filter((contact) => {
    const id = String(contact?.icao24 || contact?.id || '');
    if (keepId && id && id === keepId) return true;
    return passesMilitaryIdentifiedOnlyFilter({
      callsign: contact?.callsign,
      registration: contact?.registration,
      identifiedOnly: true,
    });
  });
}

/** Layer-row chip for the military flights Identified-only toggle. */
export function militaryIdentifiedOnlyChipModel(active = MILITARY_IDENTIFIED_ONLY_DEFAULT) {
  const on = active === true;
  return {
    id: MILITARY_IDENTIFIED_ONLY_CHIP_ID,
    label: MILITARY_IDENTIFIED_ONLY_CHIP_LABEL,
    active: on,
    title: MILITARY_IDENTIFIED_ONLY_CHIP_TITLE,
    params: { identifiedOnly: !on },
  };
}
