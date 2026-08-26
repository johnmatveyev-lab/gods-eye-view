/**
 * Client-only Hide no version toggle for the hosted FIRES list.
 *
 * Filters the already-fetched trailing-24h snapshot inside `listNearestFires`
 * before the 50-row cap. Distinct from the globe Plan 217 version identity
 * chips, globe Plan 245 Hide no version (`meridian.firmsHideNoVersion` on
 * firmsHeatmap.js), and Plan 210 / 219 / 225 / 230 / 252 list confidence,
 * FRP, age, Hide no satellite, and Hide no sensor chips. Persistence is
 * local only (`meridian.firmsListHideNoVersion` as `1` / `0`).
 * LayerStateCoordinator restore hydrates this key; there is no share-URL
 * write, no extra NASA fetch, and no new /api.
 *
 * Off (default) keeps missing + present version. On keeps a non-empty
 * trimmed `version` (C6.1 stays). Empty / whitespace / missing version
 * is a hide when on. A selected fire always stays.
 */

export const FIRMS_LIST_HIDE_NO_VERSION_STORAGE_KEY = 'meridian.firmsListHideNoVersion';
export const DEFAULT_FIRMS_LIST_HIDE_NO_VERSION = false;
export const FIRMS_LIST_HIDE_NO_VERSION_CHIP_ID = 'hide-no-version';
export const FIRMS_LIST_HIDE_NO_VERSION_CHIP_LABEL = 'Hide no version';
export const FIRMS_LIST_HIDE_NO_VERSION_CHIP_TITLE =
  'Hide detections with no version on the FIRES list';

/** @typedef {boolean} FirmsListHideNoVersion */

let sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_VERSION;
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
export function normalizeFirmsListHideNoVersion(value) {
  if (value == null || value === '') return DEFAULT_FIRMS_LIST_HIDE_NO_VERSION;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Product-version label already present on adapted list rows. Empty /
 * whitespace / missing version collapse to ''.
 * @param {Object|null|undefined} fire
 * @returns {string}
 */
export function fireListVersionLabel(fire) {
  return String(fire?.version ?? '').trim();
}

/**
 * Whether one detection already carries a non-empty trimmed version.
 * Missing, empty, and whitespace fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasListVersion(fire) {
  return fireListVersionLabel(fire) !== '';
}

/**
 * Whether one detection clears Hide no version. Off always passes.
 * A selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hideNoVersion
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function fireMeetsListHideNoVersion(fire, hideNoVersion, { selectedId = null } = {}) {
  const selected = selectedId == null || selectedId === '' ? '' : String(selectedId);
  if (selected) {
    const id = fireListId(fire);
    if (id && id === selected) return true;
  }
  if (normalizeFirmsListHideNoVersion(hideNoVersion) !== true) return true;
  return fireHasListVersion(fire);
}

/**
 * Keep detections with a filled version when Hide no version is on. Off
 * returns a shallow copy so the current 50-row ranking stays unchanged.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hideNoVersion]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<Object>}
 */
export function filterFiresByListHideNoVersion(fires, hideNoVersion, { selectedId = null } = {}) {
  const list = Array.isArray(fires) ? fires : [];
  if (normalizeFirmsListHideNoVersion(hideNoVersion) !== true && !selectedId) return list.slice();
  return list.filter((fire) => fireMeetsListHideNoVersion(fire, hideNoVersion, { selectedId }));
}

/**
 * Toggle-chip model for the hosted FIRES list row.
 * @param {unknown} [current]
 * @returns {object}
 */
export function firmsListHideNoVersionChipModel(current = DEFAULT_FIRMS_LIST_HIDE_NO_VERSION) {
  const hide = normalizeFirmsListHideNoVersion(current) === true;
  return {
    id: FIRMS_LIST_HIDE_NO_VERSION_CHIP_ID,
    label: FIRMS_LIST_HIDE_NO_VERSION_CHIP_LABEL,
    title: FIRMS_LIST_HIDE_NO_VERSION_CHIP_TITLE,
    active: hide,
    group: 'ListVersion',
    params: { firmsListHideNoVersion: !hide },
  };
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsListHideNoVersion(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_LIST_HIDE_NO_VERSION_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_LIST_HIDE_NO_VERSION;
    return normalizeFirmsListHideNoVersion(raw) === true;
  } catch {
    return DEFAULT_FIRMS_LIST_HIDE_NO_VERSION;
  }
}

/**
 * Persist `meridian.firmsListHideNoVersion` as `'1'` / `'0'`.
 * @param {unknown} hideNoVersion
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsListHideNoVersion(hideNoVersion, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeFirmsListHideNoVersion(hideNoVersion);
    if (next == null) return false;
    store.setItem(FIRMS_LIST_HIDE_NO_VERSION_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getFirmsListHideNoVersion() {
  return sessionFilter;
}

/**
 * Toggle set. Clicking Hide no version flips the preference.
 * @param {unknown} hideNoVersion
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setFirmsListHideNoVersion(hideNoVersion, { persist = true, storage } = {}) {
  const next = normalizeFirmsListHideNoVersion(hideNoVersion) === true;
  sessionFilter = next;
  if (persist) writeFirmsListHideNoVersion(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateFirmsListHideNoVersion(storage) {
  return setFirmsListHideNoVersion(readFirmsListHideNoVersion(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(hideNoVersion: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeFirmsListHideNoVersion(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetFirmsListHideNoVersionForTest() {
  sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_VERSION;
}
