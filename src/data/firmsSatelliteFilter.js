/**
 * Client-side NASA FIRMS satellite chips (compact spacecraft names + Other).
 *
 * Filters detections the client already received from `/api/firms`.
 * Never fetches NASA FIRMS or adds an endpoint. Persistence rides the
 * existing `local-firms` prefs (`satelliteFilter` next to `sensors`) —
 * `firms.satelliteFilter` via layer `setParams({ satelliteFilter })`.
 *
 * Chips are rebuilt from compact names on the current in-memory `_fires`
 * payload (`satelliteShortName(fire.satellite)`), plus Other. Missing or
 * unknown satellite maps to Other. Newly seen birds stay on (disabled-list
 * token) so a refresh does not hide a spacecraft the operator never toggled.
 */

import { satelliteShortName } from './firmsLabels.js';

export const FIRMS_SATELLITE_OTHER_CHIP_ID = 'other';
export const FIRMS_SATELLITE_CHIP_LABELS = Object.freeze({
  [FIRMS_SATELLITE_OTHER_CHIP_ID]: 'Other',
});
export const FIRMS_SATELLITE_CHIP_TITLES = Object.freeze({
  [FIRMS_SATELLITE_OTHER_CHIP_ID]: 'Show detections from unlabeled or unknown satellites',
});
/** Canonical token when every satellite chip is on — current unfiltered view. */
export const DEFAULT_FIRMS_SATELLITE_FILTER = 'all';

const CHIP_ID_PATTERN = /^[A-Za-z0-9-]{1,12}$/;

/**
 * Compact spacecraft label already used on FIRMS cards (N20, N21, SNPP, …).
 * Blank / unknown stays empty so the chip maps to Other.
 * @param {unknown} satellite
 * @returns {string}
 */
export function compactFirmsSatelliteName(satellite) {
  return satelliteShortName(satellite);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isChipId(value) {
  const raw = String(value || '').trim();
  if (!raw || /[._]/.test(raw)) return false;
  if (raw.toLowerCase() === FIRMS_SATELLITE_OTHER_CHIP_ID) return true;
  return CHIP_ID_PATTERN.test(raw) && Boolean(satelliteShortName(raw));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalizeFirmsSatelliteChipId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.toLowerCase() === FIRMS_SATELLITE_OTHER_CHIP_ID) {
    return FIRMS_SATELLITE_OTHER_CHIP_ID;
  }
  return satelliteShortName(raw);
}

/**
 * Map an adapted fire (or raw satellite string) onto one chip.
 * Missing / unknown becomes Other.
 * @param {unknown} fire
 * @returns {string}
 */
export function firmsSatelliteChipId(fire) {
  if (typeof fire === 'string' || fire == null) {
    return compactFirmsSatelliteName(fire) || FIRMS_SATELLITE_OTHER_CHIP_ID;
  }
  return compactFirmsSatelliteName(fire?.satellite) || FIRMS_SATELLITE_OTHER_CHIP_ID;
}

function chipIdsFrom(chipIds) {
  if (!Array.isArray(chipIds) && !(chipIds instanceof Set)) return [];
  return [...new Set([...chipIds].map((id) => canonicalizeFirmsSatelliteChipId(id)).filter(Boolean))];
}

function parseDisabledIds(token) {
  if (token === '0') return null;
  if (!token || token === DEFAULT_FIRMS_SATELLITE_FILTER) return [];
  return [...new Set(String(token).split(',')
    .map((part) => canonicalizeFirmsSatelliteChipId(part))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function serializeDisabledIds(disabled, chipIds) {
  const unique = [...new Set(disabled.map((id) => canonicalizeFirmsSatelliteChipId(id)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  if (!unique.length) return DEFAULT_FIRMS_SATELLITE_FILTER;
  if (chipIds.length && chipIds.every((id) => unique.includes(id))) return '0';
  return unique.join(',');
}

/**
 * Unique compact satellite chips from the in-memory `_fires` payload.
 * Named birds stay in locale order; Other is always last.
 * @param {Array<{satellite?: unknown}>|null|undefined} fires
 * @returns {string[]}
 */
export function listFirmsSatelliteChipIds(fires) {
  const named = new Set();
  for (const fire of Array.isArray(fires) ? fires : []) {
    const compact = compactFirmsSatelliteName(fire?.satellite);
    if (compact) named.add(compact);
  }
  const ids = [...named].sort((a, b) => a.localeCompare(b));
  ids.push(FIRMS_SATELLITE_OTHER_CHIP_ID);
  return ids;
}

/**
 * @param {unknown} chipId
 * @returns {string}
 */
export function firmsSatelliteChipLabel(chipId) {
  const id = canonicalizeFirmsSatelliteChipId(chipId);
  if (id === FIRMS_SATELLITE_OTHER_CHIP_ID) return FIRMS_SATELLITE_CHIP_LABELS.other;
  return id;
}

/**
 * Canonical disabled-list token. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @param {Iterable<string>|null|undefined} [chipIds]
 * @returns {string|null}
 */
export function normalizeFirmsSatelliteFilter(value, chipIds) {
  const chips = chipIdsFrom(chipIds);
  if (value == null || value === true || value === '') {
    return DEFAULT_FIRMS_SATELLITE_FILTER;
  }
  if (value === false) return '0';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return DEFAULT_FIRMS_SATELLITE_FILTER;
    const lower = trimmed.toLowerCase();
    if (lower === 'all') return DEFAULT_FIRMS_SATELLITE_FILTER;
    if (lower === '0' || lower === 'none') return '0';
    const parts = trimmed.split(',');
    if (!parts.length || parts.some((part) => !isChipId(part))) return null;
    return serializeDisabledIds(parseDisabledIds(trimmed) || [], chips);
  }
  if (Array.isArray(value)) {
    const seen = new Set();
    for (const raw of value) {
      if (!isChipId(raw)) return null;
      seen.add(canonicalizeFirmsSatelliteChipId(raw));
    }
    if (!chips.length) return seen.size ? null : '0';
    if (!seen.size) return '0';
    if (chips.every((id) => seen.has(id))) return DEFAULT_FIRMS_SATELLITE_FILTER;
    return serializeDisabledIds(chips.filter((id) => !seen.has(id)), chips);
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => isChipId(key));
    if (!keys.length) return null;
    const flagFor = (id) => {
      if (Object.hasOwn(value, id)) return value[id];
      if (Object.hasOwn(value, id.toLowerCase())) return value[id.toLowerCase()];
      if (Object.hasOwn(value, id.toUpperCase())) return value[id.toUpperCase()];
      return undefined;
    };
    if (chips.length) {
      const disabled = chips.filter((id) => flagFor(id) === false);
      if (disabled.length === chips.length) return '0';
      return serializeDisabledIds(disabled, chips);
    }
    const disabled = keys
      .filter((key) => value[key] === false)
      .map((key) => canonicalizeFirmsSatelliteChipId(key));
    return serializeDisabledIds(disabled, []);
  }
  return null;
}

/**
 * @param {unknown} value
 * @param {Iterable<string>|null|undefined} [chipIds]
 * @returns {Record<string, boolean>}
 */
export function firmsSatelliteFilterFlags(value, chipIds) {
  const chips = chipIdsFrom(chipIds);
  const token = normalizeFirmsSatelliteFilter(value, chips) ?? DEFAULT_FIRMS_SATELLITE_FILTER;
  if (token === '0') {
    return Object.fromEntries(chips.map((id) => [id, false]));
  }
  const disabled = new Set(parseDisabledIds(token) || []);
  return Object.fromEntries(chips.map((id) => [id, !disabled.has(id)]));
}

/**
 * Flip one satellite chip. Last-off becomes the empty token `0`.
 * @param {unknown} current
 * @param {unknown} chipId
 * @param {Iterable<string>|null|undefined} [chipIds]
 * @returns {string}
 */
export function toggleFirmsSatellite(current, chipId, chipIds) {
  const id = canonicalizeFirmsSatelliteChipId(chipId);
  const chips = chipIdsFrom(chipIds);
  if (!id || (chips.length && !chips.includes(id))) {
    return normalizeFirmsSatelliteFilter(current, chips) ?? DEFAULT_FIRMS_SATELLITE_FILTER;
  }
  const known = chips.length ? chips : [id];
  const flags = firmsSatelliteFilterFlags(current, known);
  flags[id] = flags[id] !== true;
  return normalizeFirmsSatelliteFilter(flags, known) ?? DEFAULT_FIRMS_SATELLITE_FILTER;
}

/**
 * Whether one adapted fire clears the satellite chips.
 * Missing / unknown satellite needs Other.
 * @param {object|null|undefined} fire
 * @param {unknown} filter
 * @returns {boolean}
 */
export function fireMatchesFirmsSatelliteFilter(fire, filter) {
  const token = normalizeFirmsSatelliteFilter(filter) ?? DEFAULT_FIRMS_SATELLITE_FILTER;
  if (token === DEFAULT_FIRMS_SATELLITE_FILTER) return true;
  if (token === '0') return false;
  const disabled = new Set(parseDisabledIds(token) || []);
  return disabled.has(firmsSatelliteChipId(fire)) !== true;
}

/**
 * Keep detections whose satellite chip is on. All-on returns a shallow copy.
 * @param {Array<object>|null|undefined} fires
 * @param {unknown} [filter]
 * @returns {Array<object>}
 */
export function filterFiresBySatellite(fires, filter = DEFAULT_FIRMS_SATELLITE_FILTER) {
  if (!Array.isArray(fires)) return [];
  const token = normalizeFirmsSatelliteFilter(filter) ?? DEFAULT_FIRMS_SATELLITE_FILTER;
  if (token === DEFAULT_FIRMS_SATELLITE_FILTER) return fires.slice();
  return fires.filter((fire) => fireMatchesFirmsSatelliteFilter(fire, token));
}

/** Share-token encode. `all` is omitted by the codec; `0` is every chip off. */
export function encodeFirmsSatelliteFilter(value) {
  const token = normalizeFirmsSatelliteFilter(value) ?? DEFAULT_FIRMS_SATELLITE_FILTER;
  if (token === DEFAULT_FIRMS_SATELLITE_FILTER) return 'a';
  if (token === '0') return '0';
  return token.split(',').map((id) => id.toLowerCase()).join(',');
}

/** Share-token decode. Unknown tokens return null so the codec ignores them. */
export function decodeFirmsSatelliteFilter(value) {
  if (value === 'a' || value === 'all') return DEFAULT_FIRMS_SATELLITE_FILTER;
  if (typeof value !== 'string' || !value) return null;
  return normalizeFirmsSatelliteFilter(value);
}

/**
 * Data-row chip models. Params carry the full next token after toggle.
 * @param {unknown} current
 * @param {Array<object>|null|undefined} [fires]
 * @returns {Array<object>}
 */
export function firmsSatelliteChipModels(current = DEFAULT_FIRMS_SATELLITE_FILTER, fires = []) {
  const ids = listFirmsSatelliteChipIds(fires);
  const flags = firmsSatelliteFilterFlags(current, ids);
  return ids.map((id) => ({
    id: `sat-${id}`,
    label: firmsSatelliteChipLabel(id),
    title: id === FIRMS_SATELLITE_OTHER_CHIP_ID
      ? FIRMS_SATELLITE_CHIP_TITLES.other
      : `Show ${id} detections`,
    active: flags[id] === true,
    group: 'Sat',
    params: { satelliteFilter: toggleFirmsSatellite(current, id, ids) },
  }));
}
