/**
 * Client-only Hide no sensor toggle for the hosted FIRES list.
 *
 * Filters the already-fetched trailing-24h snapshot inside `listNearestFires`
 * before the 50-row cap. Distinct from the globe Plan 241 Hide no sensor
 * toggle and Plan 210 / 219 / 225 / 230 list confidence, FRP, age, and
 * Hide no satellite chips. Persistence is local only
 * (`meridian.firmsListHideNoSensor` as `1` / `0`). LayerStateCoordinator
 * restore hydrates this key; there is no share-URL write, no extra NASA
 * fetch, and no new /api.
 *
 * Off (default) keeps missing + present sensor. On keeps a non-empty
 * trimmed `sensor` (VIIRS stays). Empty / whitespace / missing sensor
 * is a hide when on. A selected fire always stays.
 */

export const FIRMS_LIST_HIDE_NO_SENSOR_STORAGE_KEY = 'meridian.firmsListHideNoSensor';
export const DEFAULT_FIRMS_LIST_HIDE_NO_SENSOR = false;
export const FIRMS_LIST_HIDE_NO_SENSOR_CHIP_ID = 'hide-no-sensor';
export const FIRMS_LIST_HIDE_NO_SENSOR_CHIP_LABEL = 'Hide no sensor';
export const FIRMS_LIST_HIDE_NO_SENSOR_CHIP_TITLE =
  'Hide detections with no sensor on the FIRES list';

/** @typedef {boolean} FirmsListHideNoSensor */

let sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_SENSOR;
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
export function normalizeFirmsListHideNoSensor(value) {
  if (value == null || value === '') return DEFAULT_FIRMS_LIST_HIDE_NO_SENSOR;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Same instrument label `formatFireListRow` can print as the satellite
 * fallback. Empty / whitespace / missing sensor collapse to ''.
 * @param {Object|null|undefined} fire
 * @returns {string}
 */
export function fireListSensorLabel(fire) {
  return String(fire?.sensor ?? '').trim();
}

/**
 * Whether one detection already carries a non-empty trimmed sensor.
 * Missing, empty, and whitespace fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasListSensor(fire) {
  return fireListSensorLabel(fire) !== '';
}

/**
 * Whether one detection clears Hide no sensor. Off always passes.
 * A selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hideNoSensor
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function fireMeetsListHideNoSensor(fire, hideNoSensor, { selectedId = null } = {}) {
  const selected = selectedId == null || selectedId === '' ? '' : String(selectedId);
  if (selected) {
    const id = fireListId(fire);
    if (id && id === selected) return true;
  }
  if (normalizeFirmsListHideNoSensor(hideNoSensor) !== true) return true;
  return fireHasListSensor(fire);
}

/**
 * Keep detections with a filled sensor when Hide no sensor is on. Off
 * returns a shallow copy so the current 50-row ranking stays unchanged.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hideNoSensor]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<Object>}
 */
export function filterFiresByListHideNoSensor(fires, hideNoSensor, { selectedId = null } = {}) {
  const list = Array.isArray(fires) ? fires : [];
  if (normalizeFirmsListHideNoSensor(hideNoSensor) !== true && !selectedId) return list.slice();
  return list.filter((fire) => fireMeetsListHideNoSensor(fire, hideNoSensor, { selectedId }));
}

/**
 * Toggle-chip model for the hosted FIRES list row.
 * @param {unknown} [current]
 * @returns {object}
 */
export function firmsListHideNoSensorChipModel(current = DEFAULT_FIRMS_LIST_HIDE_NO_SENSOR) {
  const hide = normalizeFirmsListHideNoSensor(current) === true;
  return {
    id: FIRMS_LIST_HIDE_NO_SENSOR_CHIP_ID,
    label: FIRMS_LIST_HIDE_NO_SENSOR_CHIP_LABEL,
    title: FIRMS_LIST_HIDE_NO_SENSOR_CHIP_TITLE,
    active: hide,
    group: 'ListSensor',
    params: { firmsListHideNoSensor: !hide },
  };
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsListHideNoSensor(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_LIST_HIDE_NO_SENSOR_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_LIST_HIDE_NO_SENSOR;
    return normalizeFirmsListHideNoSensor(raw) === true;
  } catch {
    return DEFAULT_FIRMS_LIST_HIDE_NO_SENSOR;
  }
}

/**
 * Persist `meridian.firmsListHideNoSensor` as `'1'` / `'0'`.
 * @param {unknown} hideNoSensor
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsListHideNoSensor(hideNoSensor, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeFirmsListHideNoSensor(hideNoSensor);
    if (next == null) return false;
    store.setItem(FIRMS_LIST_HIDE_NO_SENSOR_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getFirmsListHideNoSensor() {
  return sessionFilter;
}

/**
 * Toggle set. Clicking Hide no sensor flips the preference.
 * @param {unknown} hideNoSensor
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setFirmsListHideNoSensor(hideNoSensor, { persist = true, storage } = {}) {
  const next = normalizeFirmsListHideNoSensor(hideNoSensor) === true;
  sessionFilter = next;
  if (persist) writeFirmsListHideNoSensor(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateFirmsListHideNoSensor(storage) {
  return setFirmsListHideNoSensor(readFirmsListHideNoSensor(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(hideNoSensor: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeFirmsListHideNoSensor(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetFirmsListHideNoSensorForTest() {
  sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_SENSOR;
}
