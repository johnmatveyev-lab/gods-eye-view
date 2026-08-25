/**
 * Client-side NASA FIRMS sensor chips (VIIRS | MODIS | Other).
 *
 * Filters detections the client already received from `/api/firms`.
 * Never fetches NASA FIRMS or adds an endpoint. Persistence rides the
 * existing `local-firms` prefs (`sensors` next to `frpFloor`).
 *
 * Missing/blank `sensor` stays visible. A non-empty unknown token is Other.
 */

import { normalizeSensor } from './firmsAdapt.js';

export const FIRMS_SENSOR_IDS = Object.freeze(['viirs', 'modis', 'other']);
export const FIRMS_SENSOR_CODES = Object.freeze({
  viirs: 'V',
  modis: 'M',
  other: 'O',
});
export const FIRMS_SENSOR_CHIP_LABELS = Object.freeze({
  viirs: 'VIIRS',
  modis: 'MODIS',
  other: 'Other',
});
export const FIRMS_SENSOR_CHIP_TITLES = Object.freeze({
  viirs: 'Show VIIRS detections',
  modis: 'Show MODIS detections',
  other: 'Show detections from other named sensors',
});
/** Canonical token when every sensor chip is on — current unfiltered sensor view. */
export const DEFAULT_FIRMS_SENSOR_FILTER = 'all';

const CODE_TO_ID = Object.freeze(
  Object.fromEntries(
    Object.entries(FIRMS_SENSOR_CODES).map(([id, code]) => [code, id]),
  ),
);

function codesFromEnabled(enabled) {
  const codes = FIRMS_SENSOR_IDS
    .filter((id) => enabled.has(id))
    .map((id) => FIRMS_SENSOR_CODES[id])
    .join('');
  return codes === 'VMO' ? DEFAULT_FIRMS_SENSOR_FILTER : (codes || '0');
}

/**
 * Map an adapted `sensor` (or raw instrument) onto a chip. Empty/missing
 * returns null so the detection stays visible even when Other is off.
 * @param {unknown} value
 * @returns {'viirs'|'modis'|'other'|null}
 */
export function firmsSensorFamily(value) {
  const token = normalizeSensor(value);
  if (!token) return null;
  if (token === 'VIIRS') return 'viirs';
  if (token === 'MODIS') return 'modis';
  return 'other';
}

/**
 * Canonical chip-code token. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {'all'|'0'|'V'|'M'|'O'|'VM'|'VO'|'MO'|null}
 */
export function normalizeFirmsSensorFilter(value) {
  if (value == null || value === true || value === 'all') {
    return DEFAULT_FIRMS_SENSOR_FILTER;
  }
  if (value === false || value === 'none') return '0';
  if (typeof value === 'string') {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) return DEFAULT_FIRMS_SENSOR_FILTER;
    if (trimmed === '0' || trimmed === 'NONE') return '0';
    if (trimmed === 'ALL' || trimmed === 'VMO') return DEFAULT_FIRMS_SENSOR_FILTER;
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
      if (!FIRMS_SENSOR_IDS.includes(/** @type {'viirs'|'modis'|'other'} */ (id))) {
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
    for (const id of FIRMS_SENSOR_IDS) {
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
 * @returns {Record<'viirs'|'modis'|'other', boolean>}
 */
export function firmsSensorFilterFlags(value) {
  const token = normalizeFirmsSensorFilter(value) ?? DEFAULT_FIRMS_SENSOR_FILTER;
  if (token === '0') {
    return Object.fromEntries(FIRMS_SENSOR_IDS.map((id) => [id, false]));
  }
  if (token === DEFAULT_FIRMS_SENSOR_FILTER) {
    return Object.fromEntries(FIRMS_SENSOR_IDS.map((id) => [id, true]));
  }
  return Object.fromEntries(
    FIRMS_SENSOR_IDS.map((id) => [id, token.includes(FIRMS_SENSOR_CODES[id])]),
  );
}

/**
 * Flip one sensor chip. Last-off becomes the empty token `0`.
 * @param {unknown} current
 * @param {unknown} sensorId
 * @returns {string}
 */
export function toggleFirmsSensor(current, sensorId) {
  const id = String(sensorId || '').trim().toLowerCase();
  if (!FIRMS_SENSOR_IDS.includes(/** @type {'viirs'|'modis'|'other'} */ (id))) {
    return normalizeFirmsSensorFilter(current) ?? DEFAULT_FIRMS_SENSOR_FILTER;
  }
  const flags = firmsSensorFilterFlags(current);
  flags[id] = flags[id] !== true;
  return normalizeFirmsSensorFilter(flags) ?? DEFAULT_FIRMS_SENSOR_FILTER;
}

/**
 * Whether one adapted fire clears the sensor chips.
 * Empty/missing sensor stays visible. Non-empty unknown tokens need Other.
 * @param {object|null|undefined} fire
 * @param {unknown} filter
 * @returns {boolean}
 */
export function fireMatchesFirmsSensorFilter(fire, filter) {
  const family = firmsSensorFamily(fire?.sensor ?? fire?.instrument);
  if (family == null) return true;
  return firmsSensorFilterFlags(filter)[family] === true;
}

/**
 * Keep detections whose sensor chip is on. All-on returns a shallow copy.
 * @param {Array<object>|null|undefined} fires
 * @param {unknown} [filter]
 * @returns {Array<object>}
 */
export function filterFiresBySensor(fires, filter = DEFAULT_FIRMS_SENSOR_FILTER) {
  if (!Array.isArray(fires)) return [];
  const token = normalizeFirmsSensorFilter(filter) ?? DEFAULT_FIRMS_SENSOR_FILTER;
  if (token === DEFAULT_FIRMS_SENSOR_FILTER) return fires.slice();
  return fires.filter((fire) => fireMatchesFirmsSensorFilter(fire, token));
}

/** Share-token encode. `all` is omitted by the codec; `0` is every chip off. */
export function encodeFirmsSensorFilter(value) {
  const token = normalizeFirmsSensorFilter(value) ?? DEFAULT_FIRMS_SENSOR_FILTER;
  if (token === DEFAULT_FIRMS_SENSOR_FILTER) return 'a';
  return token.toLowerCase();
}

/** Share-token decode. Unknown tokens return null so the codec ignores them. */
export function decodeFirmsSensorFilter(value) {
  if (value === 'a' || value === 'all') return DEFAULT_FIRMS_SENSOR_FILTER;
  if (typeof value !== 'string' || !value) return null;
  return normalizeFirmsSensorFilter(value);
}

/**
 * Data-row chip models. Params carry the full next token after toggle.
 * @param {unknown} current
 * @returns {Array<object>}
 */
export function firmsSensorChipModels(current = DEFAULT_FIRMS_SENSOR_FILTER) {
  const flags = firmsSensorFilterFlags(current);
  return FIRMS_SENSOR_IDS.map((id) => ({
    id: `sensor-${id}`,
    label: FIRMS_SENSOR_CHIP_LABELS[id],
    title: FIRMS_SENSOR_CHIP_TITLES[id],
    active: flags[id] === true,
    group: 'Sensor',
    params: { sensors: toggleFirmsSensor(current, id) },
  }));
}
