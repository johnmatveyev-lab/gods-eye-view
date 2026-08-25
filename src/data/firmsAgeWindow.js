/**
 * Client-only FIRMS age window. Filters already-fetched detections by
 * `acqMs` from parseAcquisitionMs — never issues a new NASA /api/firms
 * query. Unknown windows stay 24h so a stale share token cannot invent
 * a longer NASA window.
 */

/** Operator age-window chips. 24h is the current NASA trailing window. */
export const FIRMS_AGE_WINDOW_CHIPS = Object.freeze([
  Object.freeze({ id: '6', label: '6h', title: 'Hide FIRMS detections older than 6 hours' }),
  Object.freeze({ id: '12', label: '12h', title: 'Hide FIRMS detections older than 12 hours' }),
  Object.freeze({ id: '24', label: '24h', title: 'Show the current trailing-24h NASA window' }),
]);

const FIRMS_AGE_WINDOW_HOURS = Object.freeze({ 6: 6, 12: 12, 24: 24 });

export const DEFAULT_FIRMS_AGE_WINDOW = '24';

/**
 * Coerce a chip / layer-state value to a window id. Unknown values stay
 * 24h so a stale share token cannot invent a new NASA query.
 * @param {*} value
 * @returns {'6'|'12'|'24'}
 */
export function normalizeAgeWindow(value) {
  if (value === 6 || value === '6') return '6';
  if (value === 12 || value === '12') return '12';
  if (value === 24 || value === '24') return '24';
  return DEFAULT_FIRMS_AGE_WINDOW;
}

/** Hour length for a window id. Unknown is 24. */
export function ageWindowHours(window) {
  return FIRMS_AGE_WINDOW_HOURS[normalizeAgeWindow(window)] ?? 24;
}

/**
 * Whether one detection clears the age window. Missing / non-finite
 * acquisition time stays visible so an unknown VIIRS timestamp is never
 * dropped.
 * @param {Object|null|undefined} fire
 * @param {'6'|'12'|'24'|number} window
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
export function fireMeetsAgeWindow(fire, window, now = Date.now()) {
  const hours = ageWindowHours(window);
  const acqMs = Number(fire?.acqMs);
  if (!Number.isFinite(acqMs) || acqMs <= 0) return true;
  return acqMs >= now - hours * 3_600_000;
}

/**
 * Keep detections inside the age window. Always filters — 24h is the NASA
 * trailing window, not an unfiltered pass-through.
 * @param {Array<Object>|null|undefined} fires
 * @param {'6'|'12'|'24'|number} window
 * @param {number} [now=Date.now()]
 * @returns {Array<Object>}
 */
export function filterFiresByAgeWindow(fires, window, now = Date.now()) {
  if (!Array.isArray(fires)) return [];
  return fires.filter((fire) => fireMeetsAgeWindow(fire, window, now));
}
