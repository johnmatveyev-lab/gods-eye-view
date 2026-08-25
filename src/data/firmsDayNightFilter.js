/**
 * Client-only Day | Night filter for already-fetched NASA FIRMS detections.
 * Default both-on matches the current overlay. Missing / unknown daynight
 * stays visible. Pure — no Cesium, no /api/firms.
 */

export const FIRMS_DAY_NIGHT_CHIPS = Object.freeze([
  Object.freeze({
    id: 'day',
    label: 'Day',
    title: 'Show daytime FIRMS detections',
    param: 'showDay',
  }),
  Object.freeze({
    id: 'night',
    label: 'Night',
    title: 'Show nighttime FIRMS detections',
    param: 'showNight',
  }),
]);

export const DEFAULT_FIRMS_DAY_NIGHT = Object.freeze({
  showDay: true,
  showNight: true,
});

/**
 * @param {object} [input]
 * @returns {{ showDay: boolean, showNight: boolean }}
 */
export function normalizeFirmsDayNight(input = {}) {
  return {
    showDay: input.showDay !== false,
    showNight: input.showNight !== false,
  };
}

/**
 * Classify one detection. `night === true` or daynight `N` is night.
 * daynight `D` is day. A bare `night === false` fixture (no daynight key)
 * is day so existing in-memory records keep working. Anything else —
 * missing, blank, or an unrecognized flag — is unknown.
 * @param {Object|null|undefined} fire
 * @returns {'day'|'night'|'unknown'}
 */
export function classifyFirmsDayNight(fire) {
  if (!fire || typeof fire !== 'object') return 'unknown';
  const raw = typeof fire.daynight === 'string' ? fire.daynight.trim().toUpperCase() : '';
  if (raw === 'N' || fire.night === true) return 'night';
  if (raw === 'D') return 'day';
  if (fire.night === false && !Object.hasOwn(fire, 'daynight')) return 'day';
  return 'unknown';
}

/**
 * Whether one detection clears the Day | Night chips. Unknown stays visible
 * under every combination, including both off.
 * @param {Object|null|undefined} fire
 * @param {object} [filter]
 * @returns {boolean}
 */
export function fireMeetsDayNight(fire, filter = {}) {
  const prefs = normalizeFirmsDayNight(filter);
  if (prefs.showDay && prefs.showNight) return true;
  const kind = classifyFirmsDayNight(fire);
  switch (kind) {
    case 'day':
      return prefs.showDay;
    case 'night':
      return prefs.showNight;
    case 'unknown':
      return true;
    default: {
      const _exhaustive = kind;
      void _exhaustive;
      return true;
    }
  }
}

/**
 * Keep detections that pass Day | Night. Both-on returns a shallow copy.
 * @param {Array<Object>|null|undefined} fires
 * @param {object} [filter]
 * @returns {Array<Object>}
 */
export function filterFiresByDayNight(fires, filter = {}) {
  if (!Array.isArray(fires)) return [];
  const prefs = normalizeFirmsDayNight(filter);
  if (prefs.showDay && prefs.showNight) return fires.slice();
  return fires.filter((fire) => fireMeetsDayNight(fire, prefs));
}

/**
 * Toggle-chip models for the FIRMS data-layer row. Clicking a chip writes
 * the opposite boolean via setParams — both can be on (default) or off.
 * @param {object} [filter]
 * @returns {Array<object>}
 */
export function firmsDayNightChipModels(filter = {}) {
  const prefs = normalizeFirmsDayNight(filter);
  return FIRMS_DAY_NIGHT_CHIPS.map((chip) => ({
    id: `daynight-${chip.id}`,
    label: chip.label,
    title: chip.title,
    active: chip.id === 'day' ? prefs.showDay : prefs.showNight,
    group: 'Day/Night',
    params: chip.id === 'day'
      ? { showDay: !prefs.showDay }
      : { showNight: !prefs.showNight },
  }));
}
