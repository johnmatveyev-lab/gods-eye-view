/**
 * @module bikeshareLastReportedFilter
 * @description Client-only last-reported freshness chips for already-fetched
 * GBFS stations.
 *
 * All | 15m | 60m re-filters cached `lastReported` (POSIX seconds from
 * station_status `last_reported`). It never fetches `/api/gbfs` and does
 * not add an endpoint. Missing / non-finite timestamps stay visible.
 */

export const DEFAULT_BIKESHARE_LAST_REPORTED = 'all';
export const BIKESHARE_LAST_REPORTED_STORAGE_KEY = 'meridian.bikeshareLastReported';

/** @typedef {'all'|'15'|'60'} BikeshareLastReportedId */

export const BIKESHARE_LAST_REPORTED_WINDOWS = Object.freeze([
  Object.freeze({
    id: 'all',
    maxAgeSeconds: null,
    label: 'All',
    title: 'Show every station regardless of last report age',
  }),
  Object.freeze({
    id: '15',
    maxAgeSeconds: 15 * 60,
    label: '15m',
    title: 'Hide stations last reported more than 15 minutes ago',
  }),
  Object.freeze({
    id: '60',
    maxAgeSeconds: 60 * 60,
    label: '60m',
    title: 'Hide stations last reported more than 60 minutes ago',
  }),
]);

/**
 * Accept only the shipped chip ids.
 * @param {unknown} value
 * @returns {BikeshareLastReportedId|null}
 */
export function normalizeBikeshareLastReported(value) {
  if (value === 15 || value === '15' || value === '15m') return '15';
  if (value === 60 || value === '60' || value === '60m') return '60';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return null;
}

/**
 * Max age in seconds for a chip. All has no numeric window.
 * @param {unknown} windowId
 * @returns {number|null}
 */
export function bikeshareLastReportedMaxAgeSeconds(windowId) {
  const id = normalizeBikeshareLastReported(windowId) || DEFAULT_BIKESHARE_LAST_REPORTED;
  switch (id) {
    case 'all':
      return null;
    case '15':
      return 15 * 60;
    case '60':
      return 60 * 60;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Whether one cached station is fresh enough for the chip.
 * Missing / non-finite `lastReported` stays visible. A selected station
 * can be kept even when its snapshot is older than the window.
 * `lastReported` is POSIX seconds. `now` is epoch milliseconds (Date.now()).
 * @param {Object|null|undefined} record
 * @param {unknown} windowId
 * @param {{ selectedKey?: string|null, now?: number }} [options]
 * @returns {boolean}
 */
export function stationMatchesBikeshareLastReported(record, windowId, {
  selectedKey = null,
  now = Date.now(),
} = {}) {
  if (selectedKey && record?.key === selectedKey) return true;
  const maxAgeSeconds = bikeshareLastReportedMaxAgeSeconds(windowId);
  if (maxAgeSeconds == null) return true;
  if (!Number.isFinite(record?.lastReported)) return true;
  const nowMs = Number(now);
  if (!Number.isFinite(nowMs)) return true;
  const ageSeconds = (nowMs / 1000) - record.lastReported;
  return ageSeconds <= maxAgeSeconds;
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {BikeshareLastReportedId|null}
 */
export function readPersistedBikeshareLastReported(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    return normalizeBikeshareLastReported(storage.getItem(BIKESHARE_LAST_REPORTED_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {BikeshareLastReportedId|null}
 */
export function writePersistedBikeshareLastReported(value, storage) {
  const normalized = normalizeBikeshareLastReported(value);
  if (normalized == null || !storage || typeof storage.setItem !== 'function') return null;
  try {
    storage.setItem(BIKESHARE_LAST_REPORTED_STORAGE_KEY, normalized);
    return normalized;
  } catch {
    return null;
  }
}
