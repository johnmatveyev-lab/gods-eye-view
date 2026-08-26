/**
 * Client-only AIS last-position freshness chips.
 *
 * Uses `lastPositionEpoch` (unix seconds or ms) already present on each
 * in-memory vessel, with `lastPositionUtc` as a Date fallback. Never
 * fetches AISStream and adds no endpoint. Persistence is local only
 * (`meridian.aisLastPos`) and is never written into share URLs.
 *
 * All is the current unfiltered view. 15m hides vessels whose last
 * position is older than 15 minutes. 1h hides older than 1 hour.
 * Missing both timestamps stays visible. A selected vessel stays.
 * AND with Plan 153 type chips, Plan 157 Hide parked, Plan 162
 * min-speed, Plan 170 destination field, Plan 175 Hide no dest,
 * Plan 180 Hide unnamed, and Plan 189 Hide no IMO happens at the
 * AIS layer, not here.
 */

export const DEFAULT_AIS_LAST_POS = 'all';
export const AIS_LAST_POS_STORAGE_KEY = 'meridian.aisLastPos';

/** Values at or above this magnitude are treated as epoch milliseconds. */
const EPOCH_MS_THRESHOLD = 1e11;

/** @typedef {'all'|'15'|'1h'} AisLastPosId */

export const AIS_LAST_POS_CHIPS = Object.freeze([
  Object.freeze({
    id: 'all',
    maxAgeSeconds: null,
    label: 'All',
    title: 'Show every vessel regardless of last-position age',
  }),
  Object.freeze({
    id: '15',
    maxAgeSeconds: 15 * 60,
    label: '15m',
    title: 'Hide vessels whose last position is older than 15 minutes',
  }),
  Object.freeze({
    id: '1h',
    maxAgeSeconds: 60 * 60,
    label: '1h',
    title: 'Hide vessels whose last position is older than 1 hour',
  }),
]);

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Canonical chip id. Invalid input returns null so setParams can refuse.
 * Empty / omitted returns All.
 * @param {unknown} value
 * @returns {AisLastPosId|null}
 */
export function normalizeAisLastPos(value) {
  if (value == null || value === '') return DEFAULT_AIS_LAST_POS;
  if (value === 15 || value === '15' || value === '15m') return '15';
  if (
    value === 60
    || value === '60'
    || value === '60m'
    || value === '1h'
    || value === '1'
  ) return '1h';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return null;
}

/**
 * Max age in seconds for a chip. All has no numeric window.
 * @param {unknown} windowId
 * @returns {number|null}
 */
export function aisLastPosMaxAgeSeconds(windowId) {
  const id = normalizeAisLastPos(windowId) || DEFAULT_AIS_LAST_POS;
  switch (id) {
    case 'all':
      return null;
    case '15':
      return 15 * 60;
    case '1h':
      return 60 * 60;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Epoch milliseconds from `lastPositionEpoch` (seconds or ms) with
 * `lastPositionUtc` Date / ISO fallback. Missing both is null.
 * @param {object|null|undefined} record
 * @returns {number|null}
 */
export function vesselLastPositionEpochMs(record) {
  const epoch = record?.lastPositionEpoch;
  if (Number.isFinite(epoch)) {
    return epoch >= EPOCH_MS_THRESHOLD ? epoch : epoch * 1000;
  }
  const utc = record?.lastPositionUtc;
  if (utc instanceof Date) {
    const ms = utc.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (utc == null || utc === '') return null;
  const parsed = Date.parse(utc);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Whether one in-memory vessel is fresh enough for the chip.
 * All always passes. A selected id stays. Missing both timestamps stays.
 * @param {object|null|undefined} record
 * @param {unknown} lastPos
 * @param {{selectedId?: string|null, now?: number}} [options]
 * @returns {boolean}
 */
export function vesselMatchesLastPosFilter(record, lastPos, {
  selectedId = null,
  now = Date.now(),
} = {}) {
  const id = String(record?.mmsi || record?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  const maxAgeSeconds = aisLastPosMaxAgeSeconds(lastPos);
  if (maxAgeSeconds == null) return true;
  const epochMs = vesselLastPositionEpochMs(record);
  if (epochMs == null) return true;
  const nowMs = Number(now);
  if (!Number.isFinite(nowMs)) return true;
  const ageSeconds = (nowMs - epochMs) / 1000;
  return ageSeconds <= maxAgeSeconds;
}

/**
 * Keep vessels whose last position is within the window. All returns a
 * shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [lastPos=DEFAULT_AIS_LAST_POS]
 * @param {string|null} [selectedId]
 * @param {{now?: number}} [options]
 * @returns {Array<object>}
 */
export function filterVesselsByLastPos(
  records,
  lastPos = DEFAULT_AIS_LAST_POS,
  selectedId = null,
  { now = Date.now() } = {},
) {
  if (!Array.isArray(records)) return [];
  if (aisLastPosMaxAgeSeconds(lastPos) == null) return records.slice();
  return records.filter((record) => (
    vesselMatchesLastPosFilter(record, lastPos, { selectedId, now })
  ));
}

/**
 * Read `meridian.aisLastPos`. Missing or invalid storage is All.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {AisLastPosId}
 */
export function readAisLastPos(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(AIS_LAST_POS_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_AIS_LAST_POS;
    return normalizeAisLastPos(raw) || DEFAULT_AIS_LAST_POS;
  } catch {
    return DEFAULT_AIS_LAST_POS;
  }
}

/**
 * Write `meridian.aisLastPos` as the canonical chip id.
 * @param {unknown} lastPos
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {AisLastPosId|null}
 */
export function writeAisLastPos(lastPos, storage) {
  const normalized = normalizeAisLastPos(lastPos);
  if (normalized == null) return null;
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return normalized;
    store.setItem(AIS_LAST_POS_STORAGE_KEY, normalized);
    return normalized;
  } catch {
    return normalized;
  }
}

/**
 * Exclusive All | 15m | 1h chip models. Params carry the chosen window.
 * @param {unknown} [current=DEFAULT_AIS_LAST_POS]
 * @returns {Array<object>}
 */
export function aisLastPosChipModels(current = DEFAULT_AIS_LAST_POS) {
  const windowId = normalizeAisLastPos(current) || DEFAULT_AIS_LAST_POS;
  return AIS_LAST_POS_CHIPS.map((chip) => ({
    id: `last-pos-${chip.id}`,
    label: chip.label,
    title: chip.title,
    active: windowId === chip.id,
    group: 'Position',
    params: { lastPos: chip.id },
  }));
}
