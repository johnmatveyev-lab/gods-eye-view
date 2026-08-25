/**
 * Client-only earthquake event-type chips. Uses properties.type
 * already present on USGS all_day GeoJSON (earthquake | explosion |
 * quarry blast | ice quake | …). Does not change the product or fetch.
 */

export const EARTHQUAKE_EVENT_TYPES = Object.freeze([
  'quake',
  'explosion',
  'quarry',
  'other',
]);
export const EARTHQUAKE_EVENT_TYPE_CODES = Object.freeze({
  quake: 'Q',
  explosion: 'E',
  quarry: 'R',
  other: 'O',
});
export const EARTHQUAKE_EVENT_TYPE_LABELS = Object.freeze({
  quake: 'Quake',
  explosion: 'Explosion',
  quarry: 'Quarry',
  other: 'Other',
});
export const EARTHQUAKE_EVENT_TYPE_TITLES = Object.freeze({
  quake: 'Show tectonic earthquakes',
  explosion: 'Show explosion events',
  quarry: 'Show quarry blasts',
  other: 'Show other seismic events (ice quake, missing type, and similar)',
});
/** Canonical token when every type chip is on — current unfiltered type view. */
export const DEFAULT_EARTHQUAKE_EVENT_TYPES = 'QERO';

const CODE_TO_TYPE = Object.freeze(
  Object.fromEntries(
    Object.entries(EARTHQUAKE_EVENT_TYPE_CODES).map(([type, code]) => [code, type]),
  ),
);

/**
 * Map USGS `properties.type` onto a chip. Missing/unknown (including
 * ice quake) is Other. `quarry` and `quarry blast` share Quarry.
 * @param {unknown} value
 * @returns {'quake'|'explosion'|'quarry'|'other'}
 */
export function earthquakeEventType(value) {
  const token = String(value ?? '').trim().toLowerCase();
  if (token === 'earthquake') return 'quake';
  if (token === 'explosion') return 'explosion';
  if (token === 'quarry' || token === 'quarry blast') return 'quarry';
  return 'other';
}

/**
 * Canonical chip-code token. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeEarthquakeEventTypes(value) {
  if (value == null || value === '' || value === true || value === 'all') {
    return DEFAULT_EARTHQUAKE_EVENT_TYPES;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) return DEFAULT_EARTHQUAKE_EVENT_TYPES;
    if (trimmed === '0') return '0';
    if (trimmed === DEFAULT_EARTHQUAKE_EVENT_TYPES || trimmed === 'ALL') {
      return DEFAULT_EARTHQUAKE_EVENT_TYPES;
    }
    const seen = new Set();
    for (const character of trimmed) {
      const type = CODE_TO_TYPE[character];
      if (!type) return null;
      seen.add(type);
    }
    if (!seen.size) return '0';
    const codes = EARTHQUAKE_EVENT_TYPES
      .filter((type) => seen.has(type))
      .map((type) => EARTHQUAKE_EVENT_TYPE_CODES[type])
      .join('');
    return codes === DEFAULT_EARTHQUAKE_EVENT_TYPES ? DEFAULT_EARTHQUAKE_EVENT_TYPES : codes;
  }
  if (Array.isArray(value)) {
    const seen = new Set();
    for (const raw of value) {
      const type = String(raw || '').trim().toLowerCase();
      if (!EARTHQUAKE_EVENT_TYPES.includes(/** @type {'quake'|'explosion'|'quarry'|'other'} */ (type))) {
        return null;
      }
      seen.add(type);
    }
    if (!seen.size) return '0';
    return normalizeEarthquakeEventTypes(
      Object.fromEntries(EARTHQUAKE_EVENT_TYPES.map((type) => [type, seen.has(type)])),
    );
  }
  if (typeof value === 'object') {
    const seen = new Set();
    let sawKnown = false;
    for (const type of EARTHQUAKE_EVENT_TYPES) {
      if (!Object.hasOwn(value, type)) continue;
      sawKnown = true;
      if (value[type] === true) seen.add(type);
    }
    if (!sawKnown) return null;
    if (!seen.size) return '0';
    const codes = EARTHQUAKE_EVENT_TYPES
      .filter((type) => seen.has(type))
      .map((type) => EARTHQUAKE_EVENT_TYPE_CODES[type])
      .join('');
    return codes === DEFAULT_EARTHQUAKE_EVENT_TYPES ? DEFAULT_EARTHQUAKE_EVENT_TYPES : codes;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {Record<'quake'|'explosion'|'quarry'|'other', boolean>}
 */
export function earthquakeEventTypeFlags(value) {
  const token = normalizeEarthquakeEventTypes(value) ?? DEFAULT_EARTHQUAKE_EVENT_TYPES;
  if (token === '0') {
    return Object.fromEntries(EARTHQUAKE_EVENT_TYPES.map((type) => [type, false]));
  }
  return Object.fromEntries(
    EARTHQUAKE_EVENT_TYPES.map((type) => [type, token.includes(EARTHQUAKE_EVENT_TYPE_CODES[type])]),
  );
}

/**
 * Flip one event-type chip. Last-off becomes the empty token `0`.
 * @param {unknown} current
 * @param {unknown} type
 * @returns {string}
 */
export function toggleEarthquakeEventType(current, type) {
  const id = String(type || '').trim().toLowerCase();
  if (!EARTHQUAKE_EVENT_TYPES.includes(/** @type {'quake'|'explosion'|'quarry'|'other'} */ (id))) {
    return normalizeEarthquakeEventTypes(current) ?? DEFAULT_EARTHQUAKE_EVENT_TYPES;
  }
  const token = normalizeEarthquakeEventTypes(current) ?? DEFAULT_EARTHQUAKE_EVENT_TYPES;
  const enabled = new Set(
    token === '0'
      ? []
      : [...token].map((code) => CODE_TO_TYPE[code]).filter(Boolean),
  );
  if (enabled.has(id)) enabled.delete(id);
  else enabled.add(id);
  return normalizeEarthquakeEventTypes(
    Object.fromEntries(EARTHQUAKE_EVENT_TYPES.map((name) => [name, enabled.has(name)])),
  ) ?? DEFAULT_EARTHQUAKE_EVENT_TYPES;
}

/**
 * Keep events whose type chip is on. Missing/unknown type is Other.
 * A selected event stays visible even when its chip is off.
 * All-on returns a shallow copy (current view).
 * @param {Array<object>|null|undefined} features
 * @param {unknown} [types=DEFAULT_EARTHQUAKE_EVENT_TYPES]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterEarthquakeFeaturesByEventType(
  features,
  types = DEFAULT_EARTHQUAKE_EVENT_TYPES,
  { selectedId = null } = {},
) {
  if (!Array.isArray(features)) return [];
  const token = normalizeEarthquakeEventTypes(types) ?? DEFAULT_EARTHQUAKE_EVENT_TYPES;
  if (token === DEFAULT_EARTHQUAKE_EVENT_TYPES) return features.slice();
  const keepId = selectedId == null || selectedId === '' ? null : String(selectedId);
  if (token === '0') {
    return keepId
      ? features.filter((feature) => String(feature?.id) === keepId)
      : [];
  }
  const enabled = new Set([...token].map((code) => CODE_TO_TYPE[code]));
  return features.filter((feature) => {
    if (keepId && String(feature?.id) === keepId) return true;
    return enabled.has(earthquakeEventType(feature?.properties?.type));
  });
}
