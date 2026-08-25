/**
 * Client-only AIS destination field.
 *
 * Uses `destination` already present on each in-memory vessel (HUD `→ dest`).
 * Never fetches AISStream and adds no endpoint.
 * Persistence rides `ais-live-vessels` layerState (`destination`).
 *
 * Empty is the current unfiltered view. Non-empty is a case-insensitive
 * contains match. Empty / missing destination hides when the field is set.
 * A selected vessel stays. AND with Plan 153 type chips, Plan 157 Hide
 * parked, and Plan 162 min-speed happens at the AIS layer, not here.
 */

export const DEFAULT_AIS_DESTINATION = '';
export const AIS_DESTINATION_MAX_LENGTH = 80;
const INVALID_AIS_DESTINATION = '\u0000';

/**
 * Bound the operator-typed destination field. Empty is all destinations.
 * Non-strings and control characters stay a closed invalid token so they
 * cannot broaden. Matching is case-insensitive contains.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAisDestinationQuery(value) {
  if (value === undefined || value === null) return DEFAULT_AIS_DESTINATION;
  if (typeof value !== 'string') return INVALID_AIS_DESTINATION;
  if (/[\u0000-\u001f\u007f]/.test(value) || value.length > AIS_DESTINATION_MAX_LENGTH) {
    return INVALID_AIS_DESTINATION;
  }
  const trimmed = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (trimmed.length > AIS_DESTINATION_MAX_LENGTH) return INVALID_AIS_DESTINATION;
  return trimmed;
}

/**
 * Canonical destination for setParams / layerState. Invalid input returns
 * null so setParams can refuse. Empty is a valid "all" value.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeAisDestination(value) {
  const next = normalizeAisDestinationQuery(value);
  return next === INVALID_AIS_DESTINATION ? null : next;
}

/**
 * Share-URL token. Empty / invalid encode as empty so the codec can omit them.
 * `.` and `_` are percent-encoded because `lo` splits on those characters.
 * @param {unknown} value
 * @returns {string}
 */
export function encodeAisDestination(value) {
  const next = normalizeAisDestination(value);
  if (!next) return '';
  return encodeURIComponent(next).replace(/[._]/g, (ch) => (ch === '.' ? '%2E' : '%5F'));
}

/**
 * Reverse a share-URL token. Empty / invalid / undecodable return null so
 * the decoder can fall back to the default (all).
 * @param {unknown} value
 * @returns {string|null}
 */
export function decodeAisDestination(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    return normalizeAisDestination(decodeURIComponent(value));
  } catch {
    return null;
  }
}

/**
 * Whether one in-memory vessel clears the destination field.
 * Empty matches every vessel. Invalid input matches none.
 * Empty / missing `record.destination` hides when the field is non-empty.
 * A selected vessel stays.
 * @param {object|null|undefined} record
 * @param {unknown} query
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function vesselMatchesDestinationFilter(record, query, { selectedId = null } = {}) {
  const id = String(record?.mmsi || record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  const normalized = normalizeAisDestinationQuery(query);
  if (normalized === DEFAULT_AIS_DESTINATION) return true;
  if (normalized === INVALID_AIS_DESTINATION) return false;
  const destination = String(record?.destination ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!destination) return false;
  return destination.toLocaleLowerCase().includes(normalized.toLocaleLowerCase());
}

/**
 * Keep vessels whose destination contains the field. Empty returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [query=DEFAULT_AIS_DESTINATION]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterVesselsByDestination(
  records,
  query = DEFAULT_AIS_DESTINATION,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (!normalizeAisDestinationQuery(query)) return records.slice();
  return records.filter((record) => (
    vesselMatchesDestinationFilter(record, query, { selectedId })
  ));
}
