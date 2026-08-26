/**
 * Client-only Hide no scan toggle for already-fetched NASA FIRMS
 * detections. Off is the current overlay (missing + unparseable +
 * real scan). On keeps detections whose `scanKm` is a finite size
 * greater than 0. Missing, non-finite, and `scanKm <= 0` hide.
 * Missing scan fails closed when on.
 *
 * Distinct from the globe scan-size ceiling (All | <0.5km | <0.4km —
 * that ceiling still fails open on `scanKm` 0 / missing / non-finite),
 * Plan 271 list Hide no scan (`meridian.firmsListHideNoScan`), Plan
 * 267 Hide no brightness, Plan 262 Hide no acq, and Plan 253 Hide
 * no confidence. This is presence-only, not a scan-size ceiling.
 * `adaptFirmsRecords` still writes 0 when scan is unparseable; this
 * chip hides that sentinel when on. The selected detection always
 * stays. Re-applied on the already-fetched `/api/firms` payload — no
 * extra NASA fetch and no new `/api`.
 *
 * Persistence is local only (`meridian.firmsHideNoScan`, `1` / `0`).
 * LayerStateCoordinator restore re-reads the key. No share-URL write.
 */

export const FIRMS_HIDE_NO_SCAN_CHIP_ID = 'hide-no-scan';
export const FIRMS_HIDE_NO_SCAN_CHIP_LABEL = 'Hide no scan';
export const FIRMS_HIDE_NO_SCAN_CHIP_TITLE =
  'Hide detections that have no scan size';

export const FIRMS_HIDE_NO_SCAN_STORAGE_KEY = 'meridian.firmsHideNoScan';

export const DEFAULT_FIRMS_HIDE_NO_SCAN = false;

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeFirmsHideNoScan(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return DEFAULT_FIRMS_HIDE_NO_SCAN;
}

/**
 * Whether one detection already carries a real scan size.
 * Missing, non-finite, and `scanKm <= 0` fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasScan(fire) {
  const scanKm = Number(fire?.scanKm);
  return Number.isFinite(scanKm) && scanKm > 0;
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
 * Whether Hide no scan allows this detection to draw. Off is a
 * pass-through. On requires `scanKm > 0`. The selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hide
 * @param {{selectedId?: string|null}|string|null} [options]
 * @returns {boolean}
 */
export function fireMeetsHideNoScan(fire, hide, options) {
  if (keepSelectedFire(fire, selectedIdFrom(options))) return true;
  if (normalizeFirmsHideNoScan(hide) !== true) return true;
  return fireHasScan(fire);
}

/**
 * Keep detections that pass Hide no scan. Off returns a shallow copy
 * when no selected id is forced in. The selected id always stays.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hide=DEFAULT_FIRMS_HIDE_NO_SCAN]
 * @param {{selectedId?: string|null}|string|null} [selectedId]
 * @returns {Array<Object>}
 */
export function filterFiresByHideNoScan(
  fires,
  hide = DEFAULT_FIRMS_HIDE_NO_SCAN,
  selectedId,
) {
  if (!Array.isArray(fires)) return [];
  const keepId = selectedIdFrom(selectedId);
  if (normalizeFirmsHideNoScan(hide) !== true && (keepId == null || keepId === '')) {
    return fires.slice();
  }
  return fires.filter((fire) => fireMeetsHideNoScan(fire, hide, keepId));
}

/**
 * Toggle-chip model for the FIRMS data-layer row. Clicking writes the
 * opposite boolean via setParams.
 * @param {unknown} [active=DEFAULT_FIRMS_HIDE_NO_SCAN]
 * @returns {object}
 */
export function firmsHideNoScanChipModel(active = DEFAULT_FIRMS_HIDE_NO_SCAN) {
  const on = active === true;
  return {
    id: FIRMS_HIDE_NO_SCAN_CHIP_ID,
    label: FIRMS_HIDE_NO_SCAN_CHIP_LABEL,
    title: FIRMS_HIDE_NO_SCAN_CHIP_TITLE,
    active: on,
    params: { hideNoScan: !on },
  };
}

/**
 * Read the durable Hide no scan preference. Storage failures fail
 * closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsHideNoScan(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_HIDE_NO_SCAN_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_HIDE_NO_SCAN;
    return normalizeFirmsHideNoScan(raw);
  } catch {
    return DEFAULT_FIRMS_HIDE_NO_SCAN;
  }
}

/**
 * Persist the Hide no scan preference as `1` / `0`. Best-effort;
 * never throws.
 * @param {unknown} hide
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsHideNoScan(hide, storage) {
  const normalized = normalizeFirmsHideNoScan(hide);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_HIDE_NO_SCAN_STORAGE_KEY, normalized ? '1' : '0');
    }
  } catch {
    // Fail open: the session can still apply the chosen toggle.
  }
  return normalized;
}
