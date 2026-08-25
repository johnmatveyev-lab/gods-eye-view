/**
 * Client-side military installation class chips
 * (Airfield | Naval | Range | Land | Places).
 *
 * Filters records the client already received from `/api/military-installations`
 * and optional Places search. Never fetches Overpass or Places and adds no
 * endpoint. Persistence rides `military-installations` layerState
 * (`installationClassFilter`).
 *
 * Missing/unknown `class` stays visible. A selected installation stays.
 */

export const INSTALLATION_CLASS_CHIP_IDS = Object.freeze([
  'airfield',
  'naval',
  'range',
  'land',
  'places',
]);
export const INSTALLATION_CLASS_CODES = Object.freeze({
  airfield: 'A',
  naval: 'N',
  range: 'R',
  land: 'L',
  places: 'P',
});
export const INSTALLATION_CLASS_CHIP_LABELS = Object.freeze({
  airfield: 'Airfield',
  naval: 'Naval',
  range: 'Range',
  land: 'Land',
  places: 'Places',
});
export const INSTALLATION_CLASS_CHIP_TITLES = Object.freeze({
  airfield: 'Show military airfields',
  naval: 'Show naval bases',
  range: 'Show firing ranges',
  land: 'Show military land',
  places: 'Show Places search candidates',
});
/** Canonical token when every class chip is on — current unfiltered view. */
export const DEFAULT_INSTALLATION_CLASS_FILTER = 'all';

const RECORD_CLASS_TO_CHIP = Object.freeze({
  airfield: 'airfield',
  naval_base: 'naval',
  range: 'range',
  military_land: 'land',
  places_candidate: 'places',
});

const CODE_TO_ID = Object.freeze(
  Object.fromEntries(
    Object.entries(INSTALLATION_CLASS_CODES).map(([id, code]) => [code, id]),
  ),
);

function codesFromEnabled(enabled) {
  const codes = INSTALLATION_CLASS_CHIP_IDS
    .filter((id) => enabled.has(id))
    .map((id) => INSTALLATION_CLASS_CODES[id])
    .join('');
  return codes === 'ANRLP' ? DEFAULT_INSTALLATION_CLASS_FILTER : (codes || '0');
}

/**
 * Map a record `class` onto a chip. Empty/missing/unknown returns null so the
 * site stays visible even when every named chip is off.
 * @param {unknown} value
 * @returns {'airfield'|'naval'|'range'|'land'|'places'|null}
 */
export function installationClassFamily(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) return null;
  return RECORD_CLASS_TO_CHIP[token] || null;
}

/**
 * Canonical chip-code token. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {'all'|'0'|'A'|'N'|'R'|'L'|'P'|string|null}
 */
export function normalizeInstallationClassFilter(value) {
  if (value == null || value === true || value === 'all') {
    return DEFAULT_INSTALLATION_CLASS_FILTER;
  }
  if (value === false || value === 'none') return '0';
  if (typeof value === 'string') {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) return DEFAULT_INSTALLATION_CLASS_FILTER;
    if (trimmed === '0' || trimmed === 'NONE') return '0';
    if (trimmed === 'ALL' || trimmed === 'ANRLP') return DEFAULT_INSTALLATION_CLASS_FILTER;
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
      if (!INSTALLATION_CLASS_CHIP_IDS.includes(/** @type {'airfield'|'naval'|'range'|'land'|'places'} */ (id))) {
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
    for (const id of INSTALLATION_CLASS_CHIP_IDS) {
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
 * @returns {Record<'airfield'|'naval'|'range'|'land'|'places', boolean>}
 */
export function installationClassFilterFlags(value) {
  const token = normalizeInstallationClassFilter(value) ?? DEFAULT_INSTALLATION_CLASS_FILTER;
  if (token === '0') {
    return Object.fromEntries(INSTALLATION_CLASS_CHIP_IDS.map((id) => [id, false]));
  }
  if (token === DEFAULT_INSTALLATION_CLASS_FILTER) {
    return Object.fromEntries(INSTALLATION_CLASS_CHIP_IDS.map((id) => [id, true]));
  }
  return Object.fromEntries(
    INSTALLATION_CLASS_CHIP_IDS.map((id) => [id, token.includes(INSTALLATION_CLASS_CODES[id])]),
  );
}

/**
 * Flip one class chip. Last-off becomes the empty token `0`.
 * @param {unknown} current
 * @param {unknown} classId
 * @returns {string}
 */
export function toggleInstallationClassFilter(current, classId) {
  const id = String(classId || '').trim().toLowerCase();
  if (!INSTALLATION_CLASS_CHIP_IDS.includes(/** @type {'airfield'|'naval'|'range'|'land'|'places'} */ (id))) {
    return normalizeInstallationClassFilter(current) ?? DEFAULT_INSTALLATION_CLASS_FILTER;
  }
  const flags = installationClassFilterFlags(current);
  flags[id] = flags[id] !== true;
  return normalizeInstallationClassFilter(flags) ?? DEFAULT_INSTALLATION_CLASS_FILTER;
}

/**
 * Whether one in-memory installation clears the class chips.
 * Missing/unknown class stays visible. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} filter
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function installationMatchesClassFilter(record, filter, { selectedId = null } = {}) {
  const id = String(record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  const family = installationClassFamily(record?.class);
  if (family == null) return true;
  return installationClassFilterFlags(filter)[family] === true;
}

/**
 * Keep records whose class chip is on. All-on returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [filter]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterInstallationsByClass(
  records,
  filter = DEFAULT_INSTALLATION_CLASS_FILTER,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  const token = normalizeInstallationClassFilter(filter) ?? DEFAULT_INSTALLATION_CLASS_FILTER;
  if (token === DEFAULT_INSTALLATION_CLASS_FILTER) return records.slice();
  return records.filter((record) => installationMatchesClassFilter(record, token, { selectedId }));
}

/** Share-token encode. `all` is omitted by the codec; `0` is every chip off. */
export function encodeInstallationClassFilter(value) {
  const token = normalizeInstallationClassFilter(value) ?? DEFAULT_INSTALLATION_CLASS_FILTER;
  if (token === DEFAULT_INSTALLATION_CLASS_FILTER) return 'a';
  return token.toLowerCase();
}

/** Share-token decode. Unknown tokens return null so the codec ignores them. */
export function decodeInstallationClassFilter(value) {
  if (value === 'a' || value === 'all') return DEFAULT_INSTALLATION_CLASS_FILTER;
  if (typeof value !== 'string' || !value) return null;
  return normalizeInstallationClassFilter(value);
}
