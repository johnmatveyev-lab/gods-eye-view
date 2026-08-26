/**
 * Client-only FIRMS pixel-area ceiling. Filters already-fetched detections
 * by the footprint product `scanKm × trackKm` (both already parsed on the
 * adapted fire) — never issues a new NASA /api/firms query. Unknown
 * ceilings stay All so a stale preference cannot invent a new NASA query.
 *
 * Persistence is local only (`meridian.firmsArea`), separate from the Plan
 * 204 scan-size chips (`meridian.firmsScan`), Plan 211 track-size chips
 * (`meridian.firmsTrack`), Plan 217 version chips (`meridian.firmsVersion`),
 * Plan 155 TI4 brightness floor, and Plan 192 TI5 brightness floor. No
 * share-URL write.
 *
 * Missing / non-finite / non-positive scanKm or trackKm stays visible. The
 * adapter stores 0 for an unparseable scan or track, so 0 is treated as
 * unknown rather than a zero-area pixel. The selected detection always
 * stays.
 */

/** Operator pixel-area ceiling chips. `all` is the current unfiltered view. */
export const FIRMS_AREA_CEILING_CHIPS = Object.freeze([
  Object.freeze({ id: 'all', label: 'All', title: 'Show every FIRMS detection pixel area' }),
  Object.freeze({
    id: '2',
    label: '<2 km²',
    title: 'Hide detections at or above 2 km² (scan × track); drop 2×2 km edge-of-swath pixels',
  }),
  Object.freeze({
    id: '1',
    label: '<1 km²',
    title: 'Hide detections at or above 1 km² (scan × track); keep near-nadir 0.4×0.4 km pixels',
  }),
]);

export const FIRMS_AREA_STORAGE_KEY = 'meridian.firmsArea';

export const DEFAULT_FIRMS_AREA_CEILING = 'all';

/** @typedef {'all'|'2'|'1'} FirmsAreaCeiling */

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Coerce a chip / layer-state value to an area ceiling id. Unknown values
 * stay All so a stale preference cannot invent a new NASA query.
 * @param {*} value
 * @returns {FirmsAreaCeiling}
 */
export function normalizeAreaCeiling(value) {
  if (value === 2 || value === '2') return '2';
  if (value === 1 || value === '1') return '1';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return DEFAULT_FIRMS_AREA_CEILING;
}

/** Numeric km² ceiling for an area chip id. All is 0 (no ceiling). */
export function areaCeilingKm2(ceiling) {
  const id = normalizeAreaCeiling(ceiling);
  switch (id) {
    case 'all':
      return 0;
    case '2':
      return 2;
    case '1':
      return 1;
    default: {
      const _exhaustive = /** @type {never} */ (id);
      void _exhaustive;
      return 0;
    }
  }
}

/**
 * Pixel footprint km² from already-adapted scanKm × trackKm. Missing /
 * non-finite / non-positive either axis returns NaN so callers fail open.
 * @param {Object|null|undefined} fire
 * @returns {number}
 */
export function firePixelAreaKm2(fire) {
  const scanRaw = fire?.scanKm;
  const trackRaw = fire?.trackKm;
  if (scanRaw == null || scanRaw === '' || trackRaw == null || trackRaw === '') return Number.NaN;
  const scanKm = Number(scanRaw);
  const trackKm = Number(trackRaw);
  if (!Number.isFinite(scanKm) || scanKm <= 0 || !Number.isFinite(trackKm) || trackKm <= 0) {
    return Number.NaN;
  }
  return scanKm * trackKm;
}

function fireRecordId(fire) {
  if (fire?.id != null && fire.id !== '') return String(fire.id);
  if (fire?.index != null && fire.index !== '') return String(fire.index);
  return '';
}

function keepSelectedFire(fire, selectedId) {
  if (selectedId == null || selectedId === '') return false;
  const id = fireRecordId(fire);
  return Boolean(id) && id === String(selectedId);
}

function selectedIdFrom(options) {
  if (options == null || options === '') return null;
  if (typeof options === 'object' && !Array.isArray(options)) {
    return options.selectedId ?? null;
  }
  return options;
}

/**
 * Whether one detection clears the pixel-area ceiling. Missing / non-finite
 * / non-positive scanKm or trackKm stays visible so an unknown VIIRS/MODIS
 * footprint is never dropped. The selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {FirmsAreaCeiling|number} ceiling
 * @param {{selectedId?: string|null}|string|null} [options]
 * @returns {boolean}
 */
export function fireMeetsAreaCeiling(fire, ceiling, options) {
  if (keepSelectedFire(fire, selectedIdFrom(options))) return true;
  const max = areaCeilingKm2(ceiling);
  if (max <= 0) return true;
  const area = firePixelAreaKm2(fire);
  if (!Number.isFinite(area)) return true;
  return area < max;
}

/**
 * Keep detections below the pixel-area ceiling. All returns a shallow copy
 * when no selected id is forced in. The selected id always stays.
 * @param {Array<Object>|null|undefined} fires
 * @param {FirmsAreaCeiling|number} ceiling
 * @param {{selectedId?: string|null}|string|null} [selectedId]
 * @returns {Array<Object>}
 */
export function filterFiresByAreaCeiling(fires, ceiling, selectedId) {
  if (!Array.isArray(fires)) return [];
  const keepId = selectedIdFrom(selectedId);
  if (areaCeilingKm2(ceiling) <= 0 && (keepId == null || keepId === '')) {
    return fires.slice();
  }
  return fires.filter((fire) => fireMeetsAreaCeiling(fire, ceiling, keepId));
}

/**
 * Exclusive-chip models for the FIRMS data-layer row.
 * @param {unknown} current
 * @returns {Array<object>}
 */
export function firmsAreaChipModels(current = DEFAULT_FIRMS_AREA_CEILING) {
  const ceiling = normalizeAreaCeiling(current);
  return FIRMS_AREA_CEILING_CHIPS.map((chip) => ({
    id: `area-${chip.id}`,
    label: chip.label,
    title: chip.title,
    active: ceiling === chip.id,
    group: 'Area',
    params: { areaCeiling: chip.id },
  }));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {FirmsAreaCeiling}
 */
export function readFirmsAreaCeiling(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_AREA_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_AREA_CEILING;
    return normalizeAreaCeiling(raw);
  } catch {
    return DEFAULT_FIRMS_AREA_CEILING;
  }
}

/**
 * @param {unknown} ceiling
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {FirmsAreaCeiling}
 */
export function writeFirmsAreaCeiling(ceiling, storage) {
  const normalized = normalizeAreaCeiling(ceiling);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_AREA_STORAGE_KEY, normalized);
    }
  } catch {
    // Fail open: the session can still apply the chosen ceiling.
  }
  return normalized;
}
