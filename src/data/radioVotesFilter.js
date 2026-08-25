/**
 * Client-side Radio Browser min-votes floor.
 *
 * Filters stations the client already received using `votes` from Radio
 * Browser. Playback still uses the existing `/api/radio` broker; this
 * module never fetches Radio Browser or adds an endpoint. Persistence is
 * local only (`meridian.radioVotesFloor`).
 */

export const RADIO_VOTES_FLOOR_STORAGE_KEY = 'meridian.radioVotesFloor';
export const DEFAULT_RADIO_VOTES_FLOOR = 'all';

export const RADIO_VOTES_FLOORS = Object.freeze([
  Object.freeze({ id: 'all', votes: 0, label: 'All' }),
  Object.freeze({ id: '10', votes: 10, label: '10+' }),
  Object.freeze({ id: '100', votes: 100, label: '100+' }),
]);

const FLOOR_BY_ID = Object.freeze(Object.fromEntries(
  RADIO_VOTES_FLOORS.map((floor) => [floor.id, floor]),
));

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function stationIsKept(station, keepStationId) {
  if (Array.isArray(keepStationId)) return keepStationId.includes(station?.id);
  return Boolean(keepStationId && station?.id === keepStationId);
}

/**
 * Keep Radio Browser `votes` as a non-negative int, or drop unknown values.
 * @param {unknown} value
 * @returns {number|null}
 */
export function normalizeRadioVotes(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.min(10_000_000, Math.trunc(numeric));
}

/**
 * Votes kept on one in-memory directory station.
 * @param {object} station
 * @returns {number|null}
 */
export function stationVotes(station) {
  return normalizeRadioVotes(station?.votes);
}

/**
 * Accept only the shipped chip ids.
 * @param {unknown} value
 * @returns {'all'|'10'|'100'|null}
 */
export function normalizeRadioVotesFloor(value) {
  const id = String(value ?? '').trim();
  return Object.hasOwn(FLOOR_BY_ID, id) ? id : null;
}

/**
 * Minimum votes for a chip. All is 0 (no numeric floor).
 * @param {unknown} floorId
 * @returns {number}
 */
export function radioVotesFloorMin(floorId) {
  const id = normalizeRadioVotesFloor(floorId) || DEFAULT_RADIO_VOTES_FLOOR;
  return FLOOR_BY_ID[id].votes;
}

/**
 * Whether one directory station clears the votes floor.
 * Missing / non-finite votes stay visible. A playing or selected station
 * can be kept even when its votes are below the floor.
 * @param {object} station
 * @param {unknown} floorId
 * @param {{keepStationId?: string|string[]|null}} [options]
 * @returns {boolean}
 */
export function stationMatchesRadioVotesFloor(station, floorId, { keepStationId = null } = {}) {
  if (stationIsKept(station, keepStationId)) return true;
  const minVotes = radioVotesFloorMin(floorId);
  if (!minVotes) return true;
  const votes = stationVotes(station);
  if (votes == null || !Number.isFinite(votes)) return true;
  return votes >= minVotes;
}

/**
 * Current-list stations at or above the votes floor.
 * @param {Array<object>} stations
 * @param {unknown} floorId
 * @param {{keepStationId?: string|string[]|null}} [options]
 * @returns {Array<object>}
 */
export function filterRadioStationsByVotesFloor(stations, floorId, options = {}) {
  return (Array.isArray(stations) ? stations : [])
    .filter((station) => stationMatchesRadioVotesFloor(station, floorId, options));
}

/**
 * Read the durable votes-floor chip. Storage failures fail open to All.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {'all'|'10'|'100'}
 */
export function readRadioVotesFloor(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(RADIO_VOTES_FLOOR_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_RADIO_VOTES_FLOOR;
    return normalizeRadioVotesFloor(JSON.parse(raw)) || DEFAULT_RADIO_VOTES_FLOOR;
  } catch {
    return DEFAULT_RADIO_VOTES_FLOOR;
  }
}

/**
 * Persist the votes-floor chip. Best-effort; never throws.
 * @param {unknown} floorId
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {'all'|'10'|'100'}
 */
export function writeRadioVotesFloor(floorId, storage) {
  const next = normalizeRadioVotesFloor(floorId) || DEFAULT_RADIO_VOTES_FLOOR;
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(RADIO_VOTES_FLOOR_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Fail open: the session can still hold the chip in memory.
  }
  return next;
}
