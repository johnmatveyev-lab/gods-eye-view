/**
 * Client-side Radio Browser min-bitrate floor.
 *
 * Filters stations the client already received. Playback still uses the
 * existing `/api/radio` broker; this module never fetches Radio Browser or
 * adds an endpoint.
 */

export const DEFAULT_RADIO_BITRATE_FLOOR = 'all';

export const RADIO_BITRATE_FLOORS = Object.freeze([
  Object.freeze({ id: 'all', kbps: 0, label: 'All' }),
  Object.freeze({ id: '64', kbps: 64, label: '64+' }),
  Object.freeze({ id: '128', kbps: 128, label: '128+' }),
  Object.freeze({ id: '192', kbps: 192, label: '192+' }),
]);

const FLOOR_BY_ID = Object.freeze(Object.fromEntries(
  RADIO_BITRATE_FLOORS.map((floor) => [floor.id, floor]),
));

/**
 * Accept only the shipped chip ids.
 * @param {unknown} value
 * @returns {'all'|'64'|'128'|'192'|null}
 */
export function normalizeRadioBitrateFloor(value) {
  const id = String(value ?? '').trim();
  return Object.hasOwn(FLOOR_BY_ID, id) ? id : null;
}

/**
 * Minimum kbps for a chip. All is 0 (no numeric floor).
 * @param {unknown} floorId
 * @returns {number}
 */
export function radioBitrateFloorKbps(floorId) {
  const id = normalizeRadioBitrateFloor(floorId) || DEFAULT_RADIO_BITRATE_FLOOR;
  return FLOOR_BY_ID[id].kbps;
}

/**
 * Whether one directory station clears the floor.
 * Null/unknown bitrate stays visible. A playing station can be kept.
 * @param {object} station
 * @param {unknown} floorId
 * @param {{keepStationId?: string|null}} [options]
 * @returns {boolean}
 */
export function stationMatchesRadioBitrateFloor(station, floorId, { keepStationId = null } = {}) {
  if (keepStationId && station?.id === keepStationId) return true;
  const kbps = radioBitrateFloorKbps(floorId);
  if (!kbps) return true;
  const bitrate = station?.bitrate;
  if (bitrate == null) return true;
  const numeric = Number(bitrate);
  return Number.isFinite(numeric) && numeric >= kbps;
}

/**
 * Current-list stations at or above the floor.
 * @param {Array<object>} stations
 * @param {unknown} floorId
 * @param {{keepStationId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterRadioStationsByBitrateFloor(stations, floorId, options = {}) {
  return (Array.isArray(stations) ? stations : [])
    .filter((station) => stationMatchesRadioBitrateFloor(station, floorId, options));
}
