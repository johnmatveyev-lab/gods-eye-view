/**
 * Client-only FIRMS scan-size ceiling. Filters already-fetched detections
 * by `fire.scanKm` (pixel size km from adaptFirmsRecords: FIRMS CSV `scan`)
 * — never issues a new NASA /api/firms query. Unknown ceilings stay All so
 * a stale preference cannot invent a new NASA query.
 *
 * Persistence is local only (`meridian.firmsScan`), separate from the Plan
 * 155 TI4 brightness floor, Plan 163 satellite chips, and Plan 192 TI5
 * brightness floor. No share-URL write.
 *
 * Missing / non-finite / non-positive scanKm stays visible. The adapter
 * stores 0 for an unparseable scan, so 0 is treated as unknown rather than
 * a zero-width pixel.
 */

/** Operator scan-size ceiling chips. `all` is the current unfiltered view. */
export const FIRMS_SCAN_CEILING_CHIPS = Object.freeze([
  Object.freeze({ id: 'all', label: 'All', title: 'Show every FIRMS detection scan size' }),
  Object.freeze({ id: '0.5', label: '<0.5km', title: 'Hide detections at or above 0.5 km scan (MODIS and wide-scan VIIRS)' }),
  Object.freeze({ id: '0.4', label: '<0.4km', title: 'Hide detections at or above 0.4 km scan (keep near-nadir VIIRS)' }),
]);

export const FIRMS_SCAN_STORAGE_KEY = 'meridian.firmsScan';

export const DEFAULT_FIRMS_SCAN_CEILING = 'all';

/** @typedef {'all'|'0.5'|'0.4'} FirmsScanCeiling */

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Coerce a chip / layer-state value to a scan ceiling id. Unknown values
 * stay All so a stale preference cannot invent a new NASA query.
 * @param {*} value
 * @returns {FirmsScanCeiling}
 */
export function normalizeScanCeiling(value) {
  if (value === 0.5 || value === '0.5') return '0.5';
  if (value === 0.4 || value === '0.4') return '0.4';
  if (value === 'all' || value === 0 || value === '0') return 'all';
  return DEFAULT_FIRMS_SCAN_CEILING;
}

/** Numeric km ceiling for a scan chip id. All is 0 (no ceiling). */
export function scanCeilingKm(ceiling) {
  const id = normalizeScanCeiling(ceiling);
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
 * Whether one detection clears the scan-size ceiling. Missing / non-finite
 * / non-positive scanKm stays visible so an unknown VIIRS/MODIS pixel size
 * is never dropped.
 * @param {Object|null|undefined} fire
 * @param {FirmsScanCeiling|number} ceiling
 * @returns {boolean}
 */
export function fireMeetsScanCeiling(fire, ceiling) {
  const max = scanCeilingKm(ceiling);
  if (max <= 0) return true;
  const raw = fire?.scanKm;
  if (raw == null || raw === '') return true;
  const scanKm = Number(raw);
  if (!Number.isFinite(scanKm) || scanKm <= 0) return true;
  return scanKm < max;
}

/**
 * Keep detections below the scan-size ceiling. All returns a shallow copy.
 * @param {Array<Object>|null|undefined} fires
 * @param {FirmsScanCeiling|number} ceiling
 * @returns {Array<Object>}
 */
export function filterFiresByScanCeiling(fires, ceiling) {
  if (!Array.isArray(fires)) return [];
  if (scanCeilingKm(ceiling) <= 0) return fires.slice();
  return fires.filter((fire) => fireMeetsScanCeiling(fire, ceiling));
}

/**
 * Exclusive-chip models for the FIRMS data-layer row.
 * @param {unknown} current
 * @returns {Array<object>}
 */
export function firmsScanChipModels(current = DEFAULT_FIRMS_SCAN_CEILING) {
  const ceiling = normalizeScanCeiling(current);
  return FIRMS_SCAN_CEILING_CHIPS.map((chip) => ({
    id: `scan-${chip.id}`,
    label: chip.label,
    title: chip.title,
    active: ceiling === chip.id,
    group: 'Scan',
    params: { scanCeiling: chip.id },
  }));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {FirmsScanCeiling}
 */
export function readFirmsScanCeiling(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_SCAN_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_SCAN_CEILING;
    return normalizeScanCeiling(raw);
  } catch {
    return DEFAULT_FIRMS_SCAN_CEILING;
  }
}

/**
 * @param {unknown} ceiling
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {FirmsScanCeiling}
 */
export function writeFirmsScanCeiling(ceiling, storage) {
  const normalized = normalizeScanCeiling(ceiling);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_SCAN_STORAGE_KEY, normalized);
    }
  } catch {
    // Fail open: the session can still apply the chosen ceiling.
  }
  return normalized;
}
