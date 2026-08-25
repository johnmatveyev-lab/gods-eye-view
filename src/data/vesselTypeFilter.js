/**
 * Client-side AIS vessel type chips
 * (Tanker | Cargo | Passenger | Fishing | Service | Other).
 *
 * Filters vessels the client already received from `/api/ais-live`.
 * Never fetches AISStream and adds no endpoint. Persistence rides
 * `ais-live-vessels` layerState (`vesselTypeFilter`).
 *
 * Families follow `normalizeVesselType` + TYPE_STYLES. Missing/unknown
 * type maps to Other. A selected vessel stays.
 */

import { vesselTypeFamily } from './vesselLabels.js';

export const VESSEL_TYPE_CHIP_IDS = Object.freeze([
  'tanker',
  'cargo',
  'passenger',
  'fishing',
  'service',
  'other',
]);
export const VESSEL_TYPE_CODES = Object.freeze({
  tanker: 'T',
  cargo: 'C',
  passenger: 'P',
  fishing: 'F',
  service: 'S',
  other: 'O',
});
export const VESSEL_TYPE_CHIP_LABELS = Object.freeze({
  tanker: 'Tanker',
  cargo: 'Cargo',
  passenger: 'Passenger',
  fishing: 'Fishing',
  service: 'Service',
  other: 'Other',
});
export const VESSEL_TYPE_CHIP_TITLES = Object.freeze({
  tanker: 'Show tankers',
  cargo: 'Show cargo vessels',
  passenger: 'Show passenger vessels',
  fishing: 'Show fishing vessels',
  service: 'Show service and tug vessels',
  other: 'Show untyped or unmatched vessels',
});
/** Canonical token when every type chip is on — current unfiltered view. */
export const DEFAULT_VESSEL_TYPE_FILTER = 'all';

const CODE_TO_ID = Object.freeze(
  Object.fromEntries(
    Object.entries(VESSEL_TYPE_CODES).map(([id, code]) => [code, id]),
  ),
);

function codesFromEnabled(enabled) {
  const codes = VESSEL_TYPE_CHIP_IDS
    .filter((id) => enabled.has(id))
    .map((id) => VESSEL_TYPE_CODES[id])
    .join('');
  return codes === 'TCPFSO' ? DEFAULT_VESSEL_TYPE_FILTER : (codes || '0');
}

/**
 * Canonical chip-code token. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {'all'|'0'|string|null}
 */
export function normalizeVesselTypeFilter(value) {
  if (value == null || value === true || value === 'all') {
    return DEFAULT_VESSEL_TYPE_FILTER;
  }
  if (value === false || value === 'none') return '0';
  if (typeof value === 'string') {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) return DEFAULT_VESSEL_TYPE_FILTER;
    if (trimmed === '0' || trimmed === 'NONE') return '0';
    if (trimmed === 'ALL' || trimmed === 'TCPFSO') return DEFAULT_VESSEL_TYPE_FILTER;
    const seen = new Set();
    for (const character of trimmed) {
      const id = CODE_TO_ID[character];
      if (!id) return null;
      seen.add(id);
    }
    if (!seen.size) return '0';
    return codesFromEnabled(seen);
  }
  if (Array.isArray(value)) {
    const seen = new Set();
    for (const raw of value) {
      const id = String(raw || '').trim().toLowerCase();
      if (!VESSEL_TYPE_CHIP_IDS.includes(/** @type {'tanker'|'cargo'|'passenger'|'fishing'|'service'|'other'} */ (id))) {
        return null;
      }
      seen.add(id);
    }
    if (!seen.size) return '0';
    return codesFromEnabled(seen);
  }
  if (typeof value === 'object') {
    const seen = new Set();
    let sawKnown = false;
    for (const id of VESSEL_TYPE_CHIP_IDS) {
      if (!Object.hasOwn(value, id)) continue;
      sawKnown = true;
      if (value[id] === true) seen.add(id);
    }
    if (!sawKnown) return null;
    if (!seen.size) return '0';
    return codesFromEnabled(seen);
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {Record<'tanker'|'cargo'|'passenger'|'fishing'|'service'|'other', boolean>}
 */
export function vesselTypeFilterFlags(value) {
  const token = normalizeVesselTypeFilter(value) ?? DEFAULT_VESSEL_TYPE_FILTER;
  if (token === '0') {
    return Object.fromEntries(VESSEL_TYPE_CHIP_IDS.map((id) => [id, false]));
  }
  if (token === DEFAULT_VESSEL_TYPE_FILTER) {
    return Object.fromEntries(VESSEL_TYPE_CHIP_IDS.map((id) => [id, true]));
  }
  return Object.fromEntries(
    VESSEL_TYPE_CHIP_IDS.map((id) => [id, token.includes(VESSEL_TYPE_CODES[id])]),
  );
}

/**
 * Flip one type chip. Last-off becomes the empty token `0`.
 * @param {unknown} current
 * @param {unknown} typeId
 * @returns {string}
 */
export function toggleVesselTypeFilter(current, typeId) {
  const id = String(typeId || '').trim().toLowerCase();
  if (!VESSEL_TYPE_CHIP_IDS.includes(/** @type {'tanker'|'cargo'|'passenger'|'fishing'|'service'|'other'} */ (id))) {
    return normalizeVesselTypeFilter(current) ?? DEFAULT_VESSEL_TYPE_FILTER;
  }
  const flags = vesselTypeFilterFlags(current);
  flags[id] = flags[id] !== true;
  return normalizeVesselTypeFilter(flags) ?? DEFAULT_VESSEL_TYPE_FILTER;
}

/**
 * Whether one in-memory vessel clears the type chips.
 * Missing/unknown type is Other. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} filter
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function vesselMatchesTypeFilter(record, filter, { selectedId = null } = {}) {
  const id = String(record?.mmsi || record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  const family = vesselTypeFamily(record?.type);
  return vesselTypeFilterFlags(filter)[family] === true;
}

/**
 * Keep vessels whose type chip is on. All-on returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [filter]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterVesselsByType(
  records,
  filter = DEFAULT_VESSEL_TYPE_FILTER,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  const token = normalizeVesselTypeFilter(filter) ?? DEFAULT_VESSEL_TYPE_FILTER;
  if (token === DEFAULT_VESSEL_TYPE_FILTER) return records.slice();
  return records.filter((record) => vesselMatchesTypeFilter(record, token, { selectedId }));
}

/** Share-token encode. `all` is omitted by the codec; `0` is every chip off. */
export function encodeVesselTypeFilter(value) {
  const token = normalizeVesselTypeFilter(value) ?? DEFAULT_VESSEL_TYPE_FILTER;
  if (token === DEFAULT_VESSEL_TYPE_FILTER) return 'a';
  return token.toLowerCase();
}

/** Share-token decode. Unknown tokens return null so the codec ignores them. */
export function decodeVesselTypeFilter(value) {
  if (value === 'a' || value === 'all') return DEFAULT_VESSEL_TYPE_FILTER;
  if (typeof value !== 'string' || !value) return null;
  return normalizeVesselTypeFilter(value);
}

/**
 * Data-row chip models. Params carry the full next token after toggle.
 * @param {unknown} current
 * @returns {Array<object>}
 */
export function vesselTypeChipModels(current = DEFAULT_VESSEL_TYPE_FILTER) {
  const flags = vesselTypeFilterFlags(current);
  return VESSEL_TYPE_CHIP_IDS.map((id) => ({
    id: `type-${id}`,
    label: VESSEL_TYPE_CHIP_LABELS[id],
    title: VESSEL_TYPE_CHIP_TITLES[id],
    active: flags[id] === true,
    group: 'Type',
    params: { vesselTypeFilter: toggleVesselTypeFilter(current, id) },
  }));
}
