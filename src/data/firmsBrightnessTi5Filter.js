/**
 * Client-only FIRMS TI5 brightness floor. Filters already-fetched detections
 * by `fire.brightnessTi5` (Kelvin from adaptFirmsRecords: VIIRS bright_ti5 /
 * MODIS bright_t31) — never issues a new NASA /api/firms query. Unknown
 * floors stay All so a stale preference cannot invent a new NASA query.
 *
 * Persistence is local only (`meridian.firmsBrightnessTi5`), separate from
 * the Plan 155 TI4 brightness floor (`brightnessFloor`).
 *
 * Missing / non-finite / non-positive TI5 stays visible. The adapter stores
 * 0 for unparseable Kelvin, so 0 is treated as unknown rather than a cool
 * background channel.
 */

/** Operator TI5 brightness-floor chips. `all` is the current unfiltered view. */
export const FIRMS_BRIGHTNESS_TI5_FLOOR_CHIPS = Object.freeze([
  Object.freeze({ id: 'all', label: 'All', title: 'Show every FIRMS detection TI5 brightness' }),
  Object.freeze({ id: '290', label: '290+', title: 'Hide detections below 290 K TI5' }),
  Object.freeze({ id: '310', label: '310+', title: 'Hide detections below 310 K TI5' }),
]);

export const FIRMS_BRIGHTNESS_TI5_STORAGE_KEY = 'meridian.firmsBrightnessTi5';

export const DEFAULT_FIRMS_BRIGHTNESS_TI5_FLOOR = 'all';

/** @typedef {'all'|'290'|'310'} FirmsBrightnessTi5Floor */

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Coerce a chip / layer-state value to a TI5 brightness floor id. Unknown
 * values stay All so a stale preference cannot invent a new NASA query.
 * @param {*} value
 * @returns {FirmsBrightnessTi5Floor}
 */
export function normalizeBrightnessTi5Floor(value) {
  if (value === 290 || value === '290') return '290';
  if (value === 310 || value === '310') return '310';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return DEFAULT_FIRMS_BRIGHTNESS_TI5_FLOOR;
}

/** Numeric Kelvin threshold for a TI5 floor id. All is 0. */
export function brightnessTi5FloorThresholdK(floor) {
  const id = normalizeBrightnessTi5Floor(floor);
  switch (id) {
    case 'all':
      return 0;
    case '290':
      return 290;
    case '310':
      return 310;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      void _exhaustive;
      return 0;
    }
  }
}

/**
 * Whether one detection clears the TI5 brightness floor. Missing / non-finite
 * / non-positive brightnessTi5 stays visible so an unknown VIIRS/MODIS
 * background-channel Kelvin value is never dropped.
 * @param {Object|null|undefined} fire
 * @param {FirmsBrightnessTi5Floor|number} floor
 * @returns {boolean}
 */
export function fireMeetsBrightnessTi5Floor(fire, floor) {
  const min = brightnessTi5FloorThresholdK(floor);
  if (min <= 0) return true;
  const raw = fire?.brightnessTi5;
  if (raw == null || raw === '') return true;
  const brightnessTi5 = Number(raw);
  if (!Number.isFinite(brightnessTi5) || brightnessTi5 <= 0) return true;
  return brightnessTi5 >= min;
}

/**
 * Keep detections at or above the TI5 brightness floor. All returns a shallow copy.
 * @param {Array<Object>|null|undefined} fires
 * @param {FirmsBrightnessTi5Floor|number} floor
 * @returns {Array<Object>}
 */
export function filterFiresByBrightnessTi5Floor(fires, floor) {
  if (!Array.isArray(fires)) return [];
  if (brightnessTi5FloorThresholdK(floor) <= 0) return fires.slice();
  return fires.filter((fire) => fireMeetsBrightnessTi5Floor(fire, floor));
}

/**
 * Exclusive-chip models for the FIRMS data-layer row.
 * @param {unknown} current
 * @returns {Array<object>}
 */
export function firmsBrightnessTi5ChipModels(current = DEFAULT_FIRMS_BRIGHTNESS_TI5_FLOOR) {
  const floor = normalizeBrightnessTi5Floor(current);
  return FIRMS_BRIGHTNESS_TI5_FLOOR_CHIPS.map((chip) => ({
    id: `ti5-${chip.id}`,
    label: chip.label,
    title: chip.title,
    active: floor === chip.id,
    group: 'TI5',
    params: { brightnessTi5Floor: chip.id },
  }));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {FirmsBrightnessTi5Floor}
 */
export function readFirmsBrightnessTi5Floor(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_BRIGHTNESS_TI5_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_BRIGHTNESS_TI5_FLOOR;
    return normalizeBrightnessTi5Floor(raw);
  } catch {
    return DEFAULT_FIRMS_BRIGHTNESS_TI5_FLOOR;
  }
}

/**
 * @param {unknown} floor
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {FirmsBrightnessTi5Floor}
 */
export function writeFirmsBrightnessTi5Floor(floor, storage) {
  const normalized = normalizeBrightnessTi5Floor(floor);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_BRIGHTNESS_TI5_STORAGE_KEY, normalized);
    }
  } catch {
    // Fail open: the session can still apply the chosen floor.
  }
  return normalized;
}
