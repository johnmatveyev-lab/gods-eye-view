/**
 * Client-only airline callsign prefix filter for both flight layers.
 *
 * Tokens are 3-letter ICAO-style prefixes already present on ingested
 * callsigns (UAL, AAL, BAW). Empty means show every contact. This is not
 * the exact-ident watchlist and does not resolve airline names or IATA↔ICAO.
 *
 * Sibling in-flight filters (watchlist, altitude, squawk, airborne, speed,
 * climb/descent, class, hide-stale) AND in through `andPredicates` when
 * those plans are present. Do not reimplement them here.
 */

const MAX_PREFIX_TOKENS = 16;

/** @type {string} Canonical space-separated 3-letter tokens, or ''. */
let _callsignPrefixField = '';

/**
 * Extract unique 3-letter callsign prefixes from a field or token list.
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseCallsignPrefixes(value) {
  const tokens = Array.isArray(value)
    ? value.map((item) => String(item || '').trim().toUpperCase())
    : String(value || '').toUpperCase().split(/[^A-Z0-9]+/);
  const seen = new Set();
  const out = [];
  for (const token of tokens) {
    if (!/^[A-Z]{3}$/.test(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= MAX_PREFIX_TOKENS) break;
  }
  return out;
}

/**
 * Canonical persisted field: uppercase tokens separated by a single space.
 * @param {unknown} value
 * @returns {string}
 */
export function formatCallsignPrefixField(value) {
  return parseCallsignPrefixes(value).join(' ');
}

/** Contact-shaped wrapper so sibling AND hooks can call one export. */
export function passesCallsignPrefixFilter(contact, prefixes = getCallsignPrefixes()) {
  return callsignMatchesPrefixes(contact?.callsign, prefixes);
}

/**
 * Whether a cleaned callsign starts with one of the active prefixes.
 * Empty prefixes mean show all.
 * @param {unknown} callsign
 * @param {unknown} prefixes
 * @returns {boolean}
 */
export function callsignMatchesPrefixes(callsign, prefixes) {
  const list = parseCallsignPrefixes(prefixes);
  if (list.length === 0) return true;
  const cs = String(callsign || '').trim().toUpperCase();
  if (!cs) return false;
  return list.some((prefix) => cs.startsWith(prefix));
}

/**
 * Selected/tracked contacts stay visible even when their callsign misses.
 * @param {{icao24?: string, id?: string}|null|undefined} contact
 * @param {{trackedId?: string, selectedId?: string}} [extras]
 * @returns {boolean}
 */
export function isRetainedFlightContact(contact, extras = {}) {
  const id = String(contact?.icao24 || contact?.id || '').trim().toLowerCase();
  if (!id) return false;
  for (const key of ['trackedId', 'selectedId']) {
    const pin = String(extras[key] || '').trim().toLowerCase();
    if (pin && pin === id) return true;
  }
  return false;
}

/**
 * AND gate for client-side flight-layer visibility.
 * @param {{icao24?: string, id?: string, callsign?: string}|null|undefined} contact
 * @param {{callsignPrefixes?: unknown}} [filters]
 * @param {{trackedId?: string, selectedId?: string, andPredicates?: Array<Function>}} [extras]
 * @returns {boolean}
 */
export function contactPassesFlightLayerFilters(contact, filters = {}, extras = {}) {
  if (isRetainedFlightContact(contact, extras)) return true;
  if (!callsignMatchesPrefixes(contact?.callsign, filters.callsignPrefixes)) return false;
  const and = extras.andPredicates;
  if (Array.isArray(and)) {
    for (const predicate of and) {
      if (typeof predicate === 'function' && predicate(contact, filters, extras) === false) {
        return false;
      }
    }
  }
  return true;
}

/**
 * @param {Array<object>|null|undefined} contacts
 * @param {{callsignPrefixes?: unknown}} [filters]
 * @param {{trackedId?: string, selectedId?: string, andPredicates?: Array<Function>}} [extras]
 * @returns {Array<object>}
 */
export function filterFlightContacts(contacts, filters = {}, extras = {}) {
  return (Array.isArray(contacts) ? contacts : []).filter((contact) => (
    contactPassesFlightLayerFilters(contact, filters, extras)
  ));
}

/** @returns {string} */
export function getCallsignPrefixField() {
  return _callsignPrefixField;
}

/** @returns {string[]} */
export function getCallsignPrefixes() {
  return parseCallsignPrefixes(_callsignPrefixField);
}

/**
 * @param {unknown} value
 * @returns {string} Canonical field stored for both flight layers.
 */
export function setCallsignPrefixField(value) {
  _callsignPrefixField = formatCallsignPrefixField(value);
  return _callsignPrefixField;
}

/** Test seam: isolate shared prefix state between cases. */
export function resetCallsignPrefixFieldForTest() {
  _callsignPrefixField = '';
}

/**
 * Layer-facing check against the shared prefix field plus a tracked id.
 * @param {{callsign?: string}|null|undefined} info
 * @param {string} icao24
 * @param {string|null|undefined} trackedId
 * @returns {boolean}
 */
export function flightContactVisibleOnLayer(info, icao24, trackedId) {
  return contactPassesFlightLayerFilters(
    { icao24, callsign: info?.callsign },
    { callsignPrefixes: getCallsignPrefixes() },
    { trackedId },
  );
}

/** Prefix field chrome shared by commercial and military rows. */
export function callsignPrefixRowField() {
  return {
    id: 'callsign-prefixes',
    label: 'PREFIX',
    value: getCallsignPrefixField(),
    placeholder: 'UAL AAL BAW',
    ariaLabel: 'Airline callsign prefixes',
  };
}
