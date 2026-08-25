/**
 * Client-only earthquake significance-floor chips. Uses properties.sig
 * already present on USGS all_day GeoJSON (0–1000 composite of mag +
 * felt + MMI + impact). 600 is USGS's own significant-event cutoff.
 * Distinct from isSignificantEarthquake (mag >= 5.0).
 * Does not change the product or fetch. Persistence is local only
 * (`meridian.earthquakeSigFloor`).
 */

export const EARTHQUAKE_SIG_FLOOR_STORAGE_KEY = 'meridian.earthquakeSigFloor';
export const DEFAULT_EARTHQUAKE_SIG_FLOOR = 'all';
/** USGS significant-event cutoff on properties.sig. Do not invent another top chip. */
export const EARTHQUAKE_SIGNIFICANT_SIG_CUTOFF = 600;

export const EARTHQUAKE_SIG_FLOORS = Object.freeze([
  Object.freeze({
    id: 'all',
    floor: 0,
    label: 'All',
    title: 'Show every earthquake regardless of USGS significance',
  }),
  Object.freeze({
    id: '100',
    floor: 100,
    label: '100+',
    title: 'Show earthquakes with USGS significance 100 or higher',
  }),
  Object.freeze({
    id: '300',
    floor: 300,
    label: '300+',
    title: 'Show earthquakes with USGS significance 300 or higher',
  }),
  Object.freeze({
    id: '600',
    floor: EARTHQUAKE_SIGNIFICANT_SIG_CUTOFF,
    label: '600+',
    title: 'Show earthquakes with USGS significance 600 or higher',
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
 * Canonical exclusive chip. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {'all'|'100'|'300'|'600'|null}
 */
export function normalizeEarthquakeSigFloor(value) {
  if (value == null || value === '') return DEFAULT_EARTHQUAKE_SIG_FLOOR;
  if (value === 100 || value === '100' || value === '100+') return '100';
  if (value === 300 || value === '300' || value === '300+') return '300';
  if (value === 600 || value === '600' || value === '600+') return '600';
  if (value === 'all' || value === 0 || value === '0') return DEFAULT_EARTHQUAKE_SIG_FLOOR;
  return null;
}

/**
 * Numeric floor for a chip. All is 0 (no numeric floor).
 * @param {unknown} floorId
 * @returns {number}
 */
export function earthquakeSigFloorValue(floorId) {
  const id = normalizeEarthquakeSigFloor(floorId) || DEFAULT_EARTHQUAKE_SIG_FLOOR;
  switch (id) {
    case 'all':
      return 0;
    case '100':
      return 100;
    case '300':
      return 300;
    case '600':
      return EARTHQUAKE_SIGNIFICANT_SIG_CUTOFF;
    default: {
      const unexpected = /** @type {never} */ (id);
      void unexpected;
      return 0;
    }
  }
}

/**
 * USGS `properties.sig`. Missing or non-finite is null so the floor
 * keeps the event visible.
 * @param {unknown} value
 * @returns {number|null}
 */
export function earthquakeSignificance(value) {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Whether one in-memory event clears the significance floor.
 * All always passes. Missing / non-finite sig stays. A selected id stays.
 * @param {object|null|undefined} feature
 * @param {unknown} floorId
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function earthquakeMatchesSigFloor(feature, floorId, { selectedId = null } = {}) {
  const keepId = selectedId == null || selectedId === '' ? null : String(selectedId);
  if (keepId && String(feature?.id) === keepId) return true;
  const floor = earthquakeSigFloorValue(floorId);
  if (floor <= 0) return true;
  const sig = earthquakeSignificance(feature?.properties?.sig);
  if (sig == null) return true;
  return sig >= floor;
}

/**
 * Keep events at or above the floor. All returns a shallow copy.
 * Missing or non-finite sig stays visible.
 * @param {Array<object>|null|undefined} features
 * @param {unknown} [floorId=DEFAULT_EARTHQUAKE_SIG_FLOOR]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterEarthquakeFeaturesBySigFloor(
  features,
  floorId = DEFAULT_EARTHQUAKE_SIG_FLOOR,
  { selectedId = null } = {},
) {
  if (!Array.isArray(features)) return [];
  if (earthquakeSigFloorValue(floorId) <= 0) return features.slice();
  return features.filter((feature) => earthquakeMatchesSigFloor(feature, floorId, { selectedId }));
}

/**
 * Exclusive All | 100+ | 300+ | 600+ chip models. Params carry the chosen floor.
 * @param {unknown} [current=DEFAULT_EARTHQUAKE_SIG_FLOOR]
 * @returns {Array<object>}
 */
export function earthquakeSigFloorChipModels(current = DEFAULT_EARTHQUAKE_SIG_FLOOR) {
  const floor = normalizeEarthquakeSigFloor(current) || DEFAULT_EARTHQUAKE_SIG_FLOOR;
  return EARTHQUAKE_SIG_FLOORS.map((chip) => ({
    id: `sig-${chip.id}`,
    label: chip.label,
    title: chip.title,
    active: floor === chip.id,
    group: 'Significance',
    params: { sigFloor: chip.id },
  }));
}

/**
 * Read the durable significance-floor chip. Storage failures fail open to All.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {'all'|'100'|'300'|'600'}
 */
export function readEarthquakeSigFloor(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(EARTHQUAKE_SIG_FLOOR_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_EARTHQUAKE_SIG_FLOOR;
    let token = raw;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string' || typeof parsed === 'number') token = parsed;
    } catch {
      token = raw;
    }
    return normalizeEarthquakeSigFloor(token) || DEFAULT_EARTHQUAKE_SIG_FLOOR;
  } catch {
    return DEFAULT_EARTHQUAKE_SIG_FLOOR;
  }
}

/**
 * Persist the significance-floor chip. Best-effort; never throws.
 * @param {unknown} floorId
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {'all'|'100'|'300'|'600'}
 */
export function writeEarthquakeSigFloor(floorId, storage) {
  const next = normalizeEarthquakeSigFloor(floorId) || DEFAULT_EARTHQUAKE_SIG_FLOOR;
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(EARTHQUAKE_SIG_FLOOR_STORAGE_KEY, next);
    }
  } catch {
    // Fail open: the session can still hold the chip in memory.
  }
  return next;
}
