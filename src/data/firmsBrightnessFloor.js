/**
 * Client-only FIRMS brightness floor. Filters already-fetched detections by
 * `fire.brightness` (Kelvin from adaptFirmsRecords) — never issues a new
 * NASA /api/firms query. Unknown floors stay All so a stale share token
 * cannot invent a new NASA query.
 *
 * Missing / non-finite / non-positive brightness stays visible. The adapter
 * stores 0 for unparseable Kelvin, so 0 is treated as unknown rather than
 * a cool pixel.
 */

/** Operator brightness-floor chips. `all` is the current unfiltered view. */
export const FIRMS_BRIGHTNESS_FLOOR_CHIPS = Object.freeze([
  Object.freeze({ id: 'all', label: 'All', title: 'Show every FIRMS detection brightness' }),
  Object.freeze({ id: '320', label: '320+', title: 'Hide detections below 320 K' }),
  Object.freeze({ id: '340', label: '340+', title: 'Hide detections below 340 K' }),
]);

const FIRMS_BRIGHTNESS_FLOOR_K = Object.freeze({ all: 0, 320: 320, 340: 340 });

export const DEFAULT_FIRMS_BRIGHTNESS_FLOOR = 'all';

/**
 * Coerce a chip / layer-state value to a brightness floor id. Unknown
 * values stay All so a stale share token cannot invent a new NASA query.
 * @param {*} value
 * @returns {'all'|'320'|'340'}
 */
export function normalizeBrightnessFloor(value) {
  if (value === 320 || value === '320') return '320';
  if (value === 340 || value === '340') return '340';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return DEFAULT_FIRMS_BRIGHTNESS_FLOOR;
}

/** Numeric Kelvin threshold for a floor id. All is 0. */
export function brightnessFloorThresholdK(floor) {
  return FIRMS_BRIGHTNESS_FLOOR_K[normalizeBrightnessFloor(floor)] ?? 0;
}

/**
 * Whether one detection clears the brightness floor. Missing / non-finite
 * / non-positive brightness stays visible so an unknown VIIRS/MODIS
 * Kelvin value is never dropped.
 * @param {Object|null|undefined} fire
 * @param {'all'|'320'|'340'|number} floor
 * @returns {boolean}
 */
export function fireMeetsBrightnessFloor(fire, floor) {
  const min = brightnessFloorThresholdK(floor);
  if (min <= 0) return true;
  const raw = fire?.brightness;
  if (raw == null || raw === '') return true;
  const brightness = Number(raw);
  if (!Number.isFinite(brightness) || brightness <= 0) return true;
  return brightness >= min;
}

/**
 * Keep detections at or above the brightness floor. All returns a shallow copy.
 * @param {Array<Object>|null|undefined} fires
 * @param {'all'|'320'|'340'|number} floor
 * @returns {Array<Object>}
 */
export function filterFiresByBrightnessFloor(fires, floor) {
  if (!Array.isArray(fires)) return [];
  if (brightnessFloorThresholdK(floor) <= 0) return fires.slice();
  return fires.filter((fire) => fireMeetsBrightnessFloor(fire, floor));
}

/**
 * Exclusive-chip models for the FIRMS data-layer row.
 * @param {unknown} current
 * @returns {Array<object>}
 */
export function firmsBrightnessChipModels(current = DEFAULT_FIRMS_BRIGHTNESS_FLOOR) {
  const floor = normalizeBrightnessFloor(current);
  return FIRMS_BRIGHTNESS_FLOOR_CHIPS.map((chip) => ({
    id: `bright-${chip.id}`,
    label: chip.label,
    title: chip.title,
    active: floor === chip.id,
    group: 'Bright',
    params: { brightnessFloor: chip.id },
  }));
}
