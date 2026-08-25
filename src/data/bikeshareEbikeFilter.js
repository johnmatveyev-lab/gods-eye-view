/**
 * @module bikeshareEbikeFilter
 * @description Client-only E-bikes only toggle for already-fetched GBFS stations.
 *
 * Prefers `num_ebikes_available` from station_status. When that field is
 * missing, sums e-bike counts from `vehicle_types_available` using the
 * vehicle_type_id already on that payload (no vehicle_types.json fetch).
 * Re-filters cached `ebikesAvailable`. It never fetches `/api/gbfs` and
 * does not add an endpoint. Missing / non-finite counts stay visible.
 */

export const DEFAULT_BIKESHARE_EBIKES_ONLY = false;
export const BIKESHARE_EBIKES_ONLY_CHIP_LABEL = 'E-bikes only';
export const BIKESHARE_EBIKES_ONLY_CHIP_TITLE =
  'Hide stations with zero e-bikes available';

/**
 * PBSC / publicbikesystem.net e-bike `vehicle_type_id`s used by shipped
 * cities (Austin, Honolulu, Chattanooga). station_status does not include
 * propulsion_type, and these ids are not "ebike" / "electric".
 */
const PBSC_EBIKE_TYPE_IDS = Object.freeze(new Set([
  'boost',
  'efit',
  'cosmo',
  'astro',
]));

const EBIKE_TYPE_ID_RE = /e-?bikes?|electric_assist/i;

/**
 * Accept only an explicit on/off. Invalid input returns null so setParams
 * can refuse, matching Hide empty / min-docks on this layer.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeBikeshareEbikesOnly(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * @param {*} value
 * @param {number|null} [fallback=null]
 * @returns {number|null}
 */
function toNonNegativeInteger(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

/**
 * Whether one `vehicle_types_available` row is an e-bike.
 * Uses vehicle_type_id (and optional propulsion_type if a feed inlines it).
 * Does not fetch vehicle_types.json.
 * @param {Object|null|undefined} entry
 * @returns {boolean}
 */
export function isGbfsEbikeVehicleType(entry) {
  const propulsion = String(entry?.propulsion_type ?? '').trim().toLowerCase();
  const form = String(entry?.form_factor ?? '').trim().toLowerCase();
  if (propulsion === 'electric_assist') return true;
  if (propulsion === 'electric' && form.includes('bicycle')) return true;
  const id = String(entry?.vehicle_type_id ?? '').trim();
  if (!id) return false;
  if (PBSC_EBIKE_TYPE_IDS.has(id.toLowerCase())) return true;
  return EBIKE_TYPE_ID_RE.test(id);
}

/**
 * E-bike count from one raw GBFS station_status row.
 * Prefer `num_ebikes_available`. Else sum identifiable e-bike rows in
 * `vehicle_types_available`. Unknown stays null (do not hide).
 * @param {Object|null|undefined} raw
 * @returns {number|null}
 */
export function ebikesAvailableFromGbfsStation(raw) {
  const direct = toNonNegativeInteger(raw?.num_ebikes_available);
  if (direct != null) return direct;

  const types = raw?.vehicle_types_available;
  if (!Array.isArray(types)) return null;

  let found = false;
  let total = 0;
  for (const entry of types) {
    if (!isGbfsEbikeVehicleType(entry)) continue;
    const count = toNonNegativeInteger(entry?.count);
    if (count == null) continue;
    found = true;
    total += count;
  }
  return found ? total : null;
}

/**
 * Whether one cached station clears E-bikes only.
 * Off always passes. Missing / non-finite `ebikesAvailable` stays visible.
 * A selected station can be kept even when the count is 0.
 * @param {Object|null|undefined} record
 * @param {unknown} ebikesOnly
 * @param {{ selectedKey?: string|null }} [options]
 * @returns {boolean}
 */
export function stationMatchesBikeshareEbikesOnly(record, ebikesOnly, { selectedKey = null } = {}) {
  if (selectedKey && record?.key === selectedKey) return true;
  if (normalizeBikeshareEbikesOnly(ebikesOnly) !== true) return true;
  if (!Number.isFinite(record?.ebikesAvailable)) return true;
  return record.ebikesAvailable !== 0;
}
