/**
 * Operator aircraft-class chips. Reuses `classifyAircraft()` / `meta.klass`
 * only — this module never reclassifies and never adds types.
 *
 * Default is ALL ON so the mixed-fleet view is unchanged until a chip is
 * unchecked. Unknown or missing `klass` stays visible. A selected/tracked
 * contact stays visible even when its class chip is off.
 *
 * PLAN 92–97 (ident watchlist, altitude, emergency squawk, airborne-only,
 * ground-speed, climb/level/descent) compose as AND through
 * `flightPassesOperatorFilters` when those predicates are supplied. This
 * module does not reimplement them.
 */

/** Every `classifyAircraft()` id, in persist/chip order. */
export const AIRCRAFT_CLASS_FILTER_IDS = Object.freeze([
  'light',
  'glider',
  'turboprop',
  'airliner',
  'widebody',
  'quadjet',
  'helicopter',
  'fastjet',
  'bizjet',
  'uav',
]);

export const AIRCRAFT_CLASS_CHIP_LABELS = Object.freeze({
  light: 'GA',
  glider: 'GLDR',
  turboprop: 'TPROP',
  airliner: 'JET',
  widebody: 'HEAVY',
  quadjet: 'QUAD',
  helicopter: 'HELO',
  fastjet: 'FAST',
  bizjet: 'BIZ',
  uav: 'UAV',
});

export const AIRCRAFT_CLASS_CHIP_TITLES = Object.freeze({
  light: 'Light / general aviation',
  glider: 'Glider',
  turboprop: 'Turboprop',
  airliner: 'Airliner',
  widebody: 'Widebody / heavy',
  quadjet: 'Quadjet',
  helicopter: 'Helicopter',
  fastjet: 'Fast jet',
  bizjet: 'Business jet',
  uav: 'UAV',
});

/** Canonical durable/live value when every class chip is on. */
export const AIRCRAFT_CLASS_FILTER_ALL = 'all';

const ALL_BITS = (1 << AIRCRAFT_CLASS_FILTER_IDS.length) - 1;
const KNOWN_CLASS = new Set(AIRCRAFT_CLASS_FILTER_IDS);

function bitsToCanonical(bits) {
  if (!Number.isInteger(bits) || bits < 0 || bits > ALL_BITS) return null;
  return bits === ALL_BITS ? AIRCRAFT_CLASS_FILTER_ALL : bits.toString(16);
}

function mapToBits(map) {
  let bits = 0;
  for (const [index, id] of AIRCRAFT_CLASS_FILTER_IDS.entries()) {
    if (map[id]) bits |= (1 << index);
  }
  return bits;
}

/**
 * Expand any accepted filter value into a `{ [klass]: boolean }` map.
 * @param {unknown} value Filter token, hex mask, enabled-id list, or map.
 * @returns {Record<string, boolean>}
 */
export function aircraftClassFilterMap(value) {
  const normalized = normalizeAircraftClassFilter(value);
  if (normalized === AIRCRAFT_CLASS_FILTER_ALL || normalized == null) {
    return Object.fromEntries(AIRCRAFT_CLASS_FILTER_IDS.map((id) => [id, true]));
  }
  const bits = parseInt(normalized, 16);
  return Object.fromEntries(
    AIRCRAFT_CLASS_FILTER_IDS.map((id, index) => [id, ((bits >> index) & 1) === 1]),
  );
}

/**
 * Canonicalize operator/UI/share input. Invalid input returns null so the
 * layer-state codec can substitute the default (all on).
 * @param {unknown} value Raw filter.
 * @returns {string|null} `'all'` or a hex bitmask of enabled classes.
 */
export function normalizeAircraftClassFilter(value) {
  if (value == null || value === '' || value === AIRCRAFT_CLASS_FILTER_ALL || value === true) {
    return AIRCRAFT_CLASS_FILTER_ALL;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return bitsToCanonical(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed === AIRCRAFT_CLASS_FILTER_ALL) return AIRCRAFT_CLASS_FILTER_ALL;
    if (/^[0-9a-f]+$/.test(trimmed)) return bitsToCanonical(parseInt(trimmed, 16));
    const ids = trimmed.split(/[,+|]/).map((part) => part.trim()).filter(Boolean);
    if (!ids.length) return null;
    const map = Object.fromEntries(AIRCRAFT_CLASS_FILTER_IDS.map((id) => [id, false]));
    for (const id of ids) {
      if (!KNOWN_CLASS.has(id)) return null;
      map[id] = true;
    }
    return bitsToCanonical(mapToBits(map));
  }
  if (Array.isArray(value)) {
    const map = Object.fromEntries(AIRCRAFT_CLASS_FILTER_IDS.map((id) => [id, false]));
    for (const raw of value) {
      const id = String(raw || '').trim().toLowerCase();
      if (!KNOWN_CLASS.has(id)) return null;
      map[id] = true;
    }
    return bitsToCanonical(mapToBits(map));
  }
  if (typeof value === 'object') {
    const map = Object.fromEntries(AIRCRAFT_CLASS_FILTER_IDS.map((id) => [id, false]));
    let sawKnown = false;
    for (const id of AIRCRAFT_CLASS_FILTER_IDS) {
      if (!Object.hasOwn(value, id)) continue;
      sawKnown = true;
      map[id] = value[id] === true;
    }
    if (!sawKnown) return null;
    return bitsToCanonical(mapToBits(map));
  }
  return null;
}

export function encodeAircraftClassFilter(value) {
  const normalized = normalizeAircraftClassFilter(value);
  if (normalized == null || normalized === AIRCRAFT_CLASS_FILTER_ALL) {
    return AIRCRAFT_CLASS_FILTER_ALL;
  }
  return normalized;
}

export function decodeAircraftClassFilter(raw) {
  if (raw == null) return null;
  return normalizeAircraftClassFilter(raw);
}

export function aircraftClassFilterIsAllOn(value) {
  return normalizeAircraftClassFilter(value) === AIRCRAFT_CLASS_FILTER_ALL;
}

export function toggleAircraftClassFilter(value, klass) {
  const id = String(klass || '').trim().toLowerCase();
  if (!KNOWN_CLASS.has(id)) return normalizeAircraftClassFilter(value) ?? AIRCRAFT_CLASS_FILTER_ALL;
  const map = aircraftClassFilterMap(value);
  map[id] = !map[id];
  return normalizeAircraftClassFilter(map) ?? AIRCRAFT_CLASS_FILTER_ALL;
}

/**
 * Whether one contact's `meta.klass` may render under the current chips.
 * @param {string|null|undefined} klass `meta.klass` from classifyAircraft().
 * @param {unknown} filter Canonical or raw filter.
 * @param {{tracked?: boolean, selected?: boolean}} [flags]
 * @returns {boolean}
 */
export function aircraftClassPassesFilter(klass, filter, { tracked = false, selected = false } = {}) {
  if (tracked || selected) return true;
  if (aircraftClassFilterIsAllOn(filter)) return true;
  const key = String(klass || '').trim().toLowerCase();
  if (!key || !KNOWN_CLASS.has(key)) return true;
  return aircraftClassFilterMap(filter)[key] === true;
}

/**
 * Compose the class chips with any landed in-flight filters (PLAN 92–97).
 * Extra predicates are AND-ed; this function does not reimplement them.
 * @param {{klass?: string|null, tracked?: boolean, selected?: boolean}} contact
 * @param {{aircraftClassFilter?: unknown, andPredicates?: Array<Function>}} [options]
 * @returns {boolean}
 */
export function flightPassesOperatorFilters(contact = {}, options = {}) {
  if (!aircraftClassPassesFilter(contact.klass, options.aircraftClassFilter, {
    tracked: contact.tracked === true,
    selected: contact.selected === true,
  })) {
    return false;
  }
  const extras = options.andPredicates;
  if (!Array.isArray(extras)) return true;
  for (const predicate of extras) {
    if (typeof predicate === 'function' && !predicate(contact, options)) return false;
  }
  return true;
}
