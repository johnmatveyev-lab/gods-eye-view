/**
 * Client-only Hide no day/night toggle for the hosted FIRES list.
 *
 * Filters the already-fetched trailing-24h snapshot inside `listNearestFires`
 * before the 50-row cap. Distinct from globe Plan 233 Hide no day/night
 * (`meridian.firmsHideNoDaynight` on firmsHeatmap.js) and from Plan 210 /
 * 219 / 225 / 230 / 252 / 256 list confidence, FRP, age, Hide no satellite,
 * Hide no sensor, and Hide no version chips. Persistence is local only
 * (`meridian.firmsListHideNoDaynight` as `1` / `0`). LayerStateCoordinator
 * restore hydrates this key; there is no share-URL write, no extra NASA
 * fetch, and no new /api.
 *
 * Off (default) keeps missing + present daynight. On keeps
 * `daynight === 'D'` or `'N'`. Empty / whitespace / missing daynight
 * is a hide when on. A selected fire always stays.
 */

export const FIRMS_LIST_HIDE_NO_DAYNIGHT_STORAGE_KEY = 'meridian.firmsListHideNoDaynight';
export const DEFAULT_FIRMS_LIST_HIDE_NO_DAYNIGHT = false;
export const FIRMS_LIST_HIDE_NO_DAYNIGHT_CHIP_ID = 'hide-no-daynight';
export const FIRMS_LIST_HIDE_NO_DAYNIGHT_CHIP_LABEL = 'Hide no day/night';
export const FIRMS_LIST_HIDE_NO_DAYNIGHT_CHIP_TITLE =
  'Hide detections with no day/night on the FIRES list';

/** @typedef {boolean} FirmsListHideNoDaynight */

let sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_DAYNIGHT;
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
export function normalizeFirmsListHideNoDaynight(value) {
  if (value == null || value === '') return DEFAULT_FIRMS_LIST_HIDE_NO_DAYNIGHT;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Day/night flag already present on adapted list rows. Empty /
 * whitespace / missing daynight collapse to ''.
 * @param {Object|null|undefined} fire
 * @returns {string}
 */
export function fireListDaynightLabel(fire) {
  return String(fire?.daynight ?? '').trim();
}

/**
 * Whether one detection already carries daynight D or N.
 * Empty, whitespace, and missing fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasListDaynight(fire) {
  const label = fireListDaynightLabel(fire);
  return label === 'D' || label === 'N';
}

/**
 * Whether one detection clears Hide no day/night. Off always passes.
 * A selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hideNoDaynight
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function fireMeetsListHideNoDaynight(fire, hideNoDaynight, { selectedId = null } = {}) {
  const selected = selectedId == null || selectedId === '' ? '' : String(selectedId);
  if (selected) {
    const id = fireListId(fire);
    if (id && id === selected) return true;
  }
  if (normalizeFirmsListHideNoDaynight(hideNoDaynight) !== true) return true;
  return fireHasListDaynight(fire);
}

/**
 * Keep detections with daynight D or N when Hide no day/night is on. Off
 * returns a shallow copy so the current 50-row ranking stays unchanged.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hideNoDaynight]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<Object>}
 */
export function filterFiresByListHideNoDaynight(fires, hideNoDaynight, { selectedId = null } = {}) {
  const list = Array.isArray(fires) ? fires : [];
  if (normalizeFirmsListHideNoDaynight(hideNoDaynight) !== true && !selectedId) return list.slice();
  return list.filter((fire) => fireMeetsListHideNoDaynight(fire, hideNoDaynight, { selectedId }));
}

/**
 * Toggle-chip model for the hosted FIRES list row.
 * @param {unknown} [current]
 * @returns {object}
 */
export function firmsListHideNoDaynightChipModel(current = DEFAULT_FIRMS_LIST_HIDE_NO_DAYNIGHT) {
  const hide = normalizeFirmsListHideNoDaynight(current) === true;
  return {
    id: FIRMS_LIST_HIDE_NO_DAYNIGHT_CHIP_ID,
    label: FIRMS_LIST_HIDE_NO_DAYNIGHT_CHIP_LABEL,
    title: FIRMS_LIST_HIDE_NO_DAYNIGHT_CHIP_TITLE,
    active: hide,
    group: 'ListDaynight',
    params: { firmsListHideNoDaynight: !hide },
  };
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsListHideNoDaynight(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_LIST_HIDE_NO_DAYNIGHT_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_LIST_HIDE_NO_DAYNIGHT;
    return normalizeFirmsListHideNoDaynight(raw) === true;
  } catch {
    return DEFAULT_FIRMS_LIST_HIDE_NO_DAYNIGHT;
  }
}

/**
 * Persist `meridian.firmsListHideNoDaynight` as `'1'` / `'0'`.
 * @param {unknown} hideNoDaynight
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsListHideNoDaynight(hideNoDaynight, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeFirmsListHideNoDaynight(hideNoDaynight);
    if (next == null) return false;
    store.setItem(FIRMS_LIST_HIDE_NO_DAYNIGHT_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getFirmsListHideNoDaynight() {
  return sessionFilter;
}

/**
 * Toggle set. Clicking Hide no day/night flips the preference.
 * @param {unknown} hideNoDaynight
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setFirmsListHideNoDaynight(hideNoDaynight, { persist = true, storage } = {}) {
  const next = normalizeFirmsListHideNoDaynight(hideNoDaynight) === true;
  sessionFilter = next;
  if (persist) writeFirmsListHideNoDaynight(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateFirmsListHideNoDaynight(storage) {
  return setFirmsListHideNoDaynight(readFirmsListHideNoDaynight(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(hideNoDaynight: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeFirmsListHideNoDaynight(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetFirmsListHideNoDaynightForTest() {
  sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_DAYNIGHT;
}
