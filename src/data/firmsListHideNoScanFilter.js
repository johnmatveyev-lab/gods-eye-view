/**
 * Client-only Hide no scan toggle for the hosted FIRES list.
 *
 * Filters the already-fetched trailing-24h snapshot inside `listNearestFires`
 * before the 50-row cap. Distinct from the globe scan-size ceiling
 * (`meridian.firmsScan` on firmsScanFilter.js / firmsHeatmap.js), from
 * globe Plan 267 Hide no brightness, and from Plan 210 / 219 / 225 /
 * 230 / 252 / 256 / 260 / 266 list confidence, FRP, age, Hide no
 * satellite, Hide no sensor, Hide no version, Hide no day/night, and
 * Hide no acq chips. Persistence is local only
 * (`meridian.firmsListHideNoScan` as `1` / `0`). LayerStateCoordinator
 * restore hydrates this key; there is no share-URL write, no extra NASA
 * fetch, and no new /api.
 *
 * Off (default) keeps missing / non-finite / `scanKm<=0`. On is
 * presence-only: hides those sentinels and keeps a real scan
 * (`scanKm > 0`, e.g. 1.0 km). This is not a scan-size ceiling. A
 * selected fire always stays.
 */

export const FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY = 'meridian.firmsListHideNoScan';
export const DEFAULT_FIRMS_LIST_HIDE_NO_SCAN = false;
export const FIRMS_LIST_HIDE_NO_SCAN_CHIP_ID = 'hide-no-scan';
export const FIRMS_LIST_HIDE_NO_SCAN_CHIP_LABEL = 'Hide no scan';
export const FIRMS_LIST_HIDE_NO_SCAN_CHIP_TITLE =
  'Hide detections with no scan size on the FIRES list';

/** @typedef {boolean} FirmsListHideNoScan */

let sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_SCAN;
const listeners = new Set();

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function fireListId(fire) {
  if (fire?.id != null && fire.id !== '') return String(fire.id);
  return '';
}

/**
 * Canonical on/off. Invalid input returns null so readers fail closed to off.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeFirmsListHideNoScan(value) {
  if (value == null || value === '') return DEFAULT_FIRMS_LIST_HIDE_NO_SCAN;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Scan km already present on adapted list rows. Missing / non-finite /
 * `scanKm<=0` collapse to 0.
 * @param {Object|null|undefined} fire
 * @returns {number}
 */
export function fireListScanKm(fire) {
  const scanKm = Number(fire?.scanKm);
  return Number.isFinite(scanKm) ? scanKm : 0;
}

/**
 * Whether one detection already carries a real scan size.
 * Missing, non-finite, and `scanKm <= 0` fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasListScan(fire) {
  return fireListScanKm(fire) > 0;
}

/**
 * Whether one detection clears Hide no scan. Off always passes.
 * A selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hideNoScan
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function fireMeetsListHideNoScan(fire, hideNoScan, { selectedId = null } = {}) {
  const selected = selectedId == null || selectedId === '' ? '' : String(selectedId);
  if (selected) {
    const id = fireListId(fire);
    if (id && id === selected) return true;
  }
  if (normalizeFirmsListHideNoScan(hideNoScan) !== true) return true;
  return fireHasListScan(fire);
}

/**
 * Keep detections with `scanKm > 0` when Hide no scan is on. Off returns
 * a shallow copy so the current 50-row ranking stays unchanged.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hideNoScan]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<Object>}
 */
export function filterFiresByListHideNoScan(fires, hideNoScan, { selectedId = null } = {}) {
  const list = Array.isArray(fires) ? fires : [];
  if (normalizeFirmsListHideNoScan(hideNoScan) !== true && !selectedId) return list.slice();
  return list.filter((fire) => fireMeetsListHideNoScan(fire, hideNoScan, { selectedId }));
}

/**
 * Toggle-chip model for the hosted FIRES list row.
 * @param {unknown} [current]
 * @returns {object}
 */
export function firmsListHideNoScanChipModel(current = DEFAULT_FIRMS_LIST_HIDE_NO_SCAN) {
  const hide = normalizeFirmsListHideNoScan(current) === true;
  return {
    id: FIRMS_LIST_HIDE_NO_SCAN_CHIP_ID,
    label: FIRMS_LIST_HIDE_NO_SCAN_CHIP_LABEL,
    title: FIRMS_LIST_HIDE_NO_SCAN_CHIP_TITLE,
    active: hide,
    group: 'ListScan',
    params: { firmsListHideNoScan: !hide },
  };
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsListHideNoScan(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_LIST_HIDE_NO_SCAN;
    return normalizeFirmsListHideNoScan(raw) === true;
  } catch {
    return DEFAULT_FIRMS_LIST_HIDE_NO_SCAN;
  }
}

/**
 * Persist `meridian.firmsListHideNoScan` as `'1'` / `'0'`.
 * @param {unknown} hideNoScan
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsListHideNoScan(hideNoScan, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeFirmsListHideNoScan(hideNoScan);
    if (next == null) return false;
    store.setItem(FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getFirmsListHideNoScan() {
  return sessionFilter;
}

/**
 * Toggle set. Clicking Hide no scan flips the preference.
 * @param {unknown} hideNoScan
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setFirmsListHideNoScan(hideNoScan, { persist = true, storage } = {}) {
  const next = normalizeFirmsListHideNoScan(hideNoScan) === true;
  sessionFilter = next;
  if (persist) writeFirmsListHideNoScan(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateFirmsListHideNoScan(storage) {
  return setFirmsListHideNoScan(readFirmsListHideNoScan(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(hideNoScan: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeFirmsListHideNoScan(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetFirmsListHideNoScanForTest() {
  sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_SCAN;
}
