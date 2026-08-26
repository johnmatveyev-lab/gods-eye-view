/**
 * Client-only FIRMS track-size ceiling. Filters already-fetched detections
 * by `fire.trackKm` (along-track pixel km from adaptFirmsRecords: FIRMS CSV
 * `track`) — never issues a new NASA /api/firms query. Unknown ceilings stay
 * All so a stale preference cannot invent a new NASA query.
 *
 * Persistence is local only (`meridian.firmsTrack`), separate from the Plan
 * 204 scan-size chips (`meridian.firmsScan`), Plan 155 TI4 brightness floor,
 * Plan 163 satellite chips, and Plan 192 TI5 brightness floor. No share-URL
 * write.
 *
 * Missing / non-finite / non-positive trackKm stays visible. The adapter
 * stores 0 for an unparseable track, so 0 is treated as unknown rather than
 * a zero-width pixel.
 */

/** Operator track-size ceiling chips. `all` is the current unfiltered view. */
export const FIRMS_TRACK_CEILING_CHIPS = Object.freeze([
  Object.freeze({ id: 'all', label: 'All', title: 'Show every FIRMS detection track size' }),
  Object.freeze({ id: '0.5', label: '<0.5km', title: 'Hide detections at or above 0.5 km track (MODIS and wide-track VIIRS)' }),
  Object.freeze({ id: '0.4', label: '<0.4km', title: 'Hide detections at or above 0.4 km track (keep near-nadir VIIRS)' }),
]);

export const FIRMS_TRACK_STORAGE_KEY = 'meridian.firmsTrack';

export const DEFAULT_FIRMS_TRACK_CEILING = 'all';

/** @typedef {'all'|'0.5'|'0.4'} FirmsTrackCeiling */

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Coerce a chip / layer-state value to a track ceiling id. Unknown values
 * stay All so a stale preference cannot invent a new NASA query.
 * @param {*} value
 * @returns {FirmsTrackCeiling}
 */
export function normalizeTrackCeiling(value) {
  if (value === 0.5 || value === '0.5') return '0.5';
  if (value === 0.4 || value === '0.4') return '0.4';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return DEFAULT_FIRMS_TRACK_CEILING;
}

/** Numeric km ceiling for a track chip id. All is 0 (no ceiling). */
export function trackCeilingKm(ceiling) {
  const id = normalizeTrackCeiling(ceiling);
  switch (id) {
    case 'all':
      return 0;
    case '0.5':
      return 0.5;
    case '0.4':
      return 0.4;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      void _exhaustive;
      return 0;
    }
  }
}

/**
 * Whether one detection clears the track-size ceiling. Missing / non-finite
 * / non-positive trackKm stays visible so an unknown VIIRS/MODIS along-track
 * pixel size is never dropped.
 * @param {Object|null|undefined} fire
 * @param {FirmsTrackCeiling|number} ceiling
 * @returns {boolean}
 */
export function fireMeetsTrackCeiling(fire, ceiling) {
  const max = trackCeilingKm(ceiling);
  if (max <= 0) return true;
  const raw = fire?.trackKm;
  if (raw == null || raw === '') return true;
  const trackKm = Number(raw);
  if (!Number.isFinite(trackKm) || trackKm <= 0) return true;
  return trackKm < max;
}

/**
 * Keep detections below the track-size ceiling. All returns a shallow copy.
 * @param {Array<Object>|null|undefined} fires
 * @param {FirmsTrackCeiling|number} ceiling
 * @returns {Array<Object>}
 */
export function filterFiresByTrackCeiling(fires, ceiling) {
  if (!Array.isArray(fires)) return [];
  if (trackCeilingKm(ceiling) <= 0) return fires.slice();
  return fires.filter((fire) => fireMeetsTrackCeiling(fire, ceiling));
}

/**
 * Exclusive-chip models for the FIRMS data-layer row.
 * @param {unknown} current
 * @returns {Array<object>}
 */
export function firmsTrackChipModels(current = DEFAULT_FIRMS_TRACK_CEILING) {
  const ceiling = normalizeTrackCeiling(current);
  return FIRMS_TRACK_CEILING_CHIPS.map((chip) => ({
    id: `track-${chip.id}`,
    label: chip.label,
    title: chip.title,
    active: ceiling === chip.id,
    group: 'Track',
    params: { trackCeiling: chip.id },
  }));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {FirmsTrackCeiling}
 */
export function readFirmsTrackCeiling(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_TRACK_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_TRACK_CEILING;
    return normalizeTrackCeiling(raw);
  } catch {
    return DEFAULT_FIRMS_TRACK_CEILING;
  }
}

/**
 * @param {unknown} ceiling
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {FirmsTrackCeiling}
 */
export function writeFirmsTrackCeiling(ceiling, storage) {
  const normalized = normalizeTrackCeiling(ceiling);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_TRACK_STORAGE_KEY, normalized);
    }
  } catch {
    // Fail open: the session can still apply the chosen ceiling.
  }
  return normalized;
}
