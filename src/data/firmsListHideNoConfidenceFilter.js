/**
 * Client-only Hide no confidence toggle for the hosted FIRES list.
 *
 * Filters the already-fetched trailing-24h snapshot inside `listNearestFires`
 * before the 50-row cap. Distinct from the list confidence floor
 * (`meridian.firmsListConf` All | High | Nominal+ on firmsListConfFilter.js,
 * which fail-opens missing / non-finite confidence), from globe Plan 253
 * Hide no confidence (`meridian.firmsHideNoConfidence` on firmsHeatmap.js),
 * and from Plan 210 / 219 / 225 / 230 / 252 / 256 / 260 / 266 / 271 /
 * 276 / 282 list confidence, FRP floor, age, Hide no satellite, Hide no
 * sensor, Hide no version, Hide no day/night, Hide no acq, Hide no scan,
 * Hide no track, and Hide no FRP chips. Persistence is local only
 * (`meridian.firmsListHideNoConfidence` as `1` / `0`). LayerStateCoordinator
 * restore hydrates this key; there is no share-URL write, no extra NASA
 * fetch, and no new /api.
 *
 * Off (default) keeps missing / null / non-finite confidence. On is
 * presence-only: hides those sentinels and keeps a rated confidence
 * (finite, including `0` as a real low rating). This is not a confidence
 * floor and is not the FRP `<=0` hide rule. A selected fire always stays.
 */

export const FIRMS_LIST_HIDE_NO_CONFIDENCE_STORAGE_KEY = 'meridian.firmsListHideNoConfidence';
export const DEFAULT_FIRMS_LIST_HIDE_NO_CONFIDENCE = false;
export const FIRMS_LIST_HIDE_NO_CONFIDENCE_CHIP_ID = 'hide-no-confidence';
export const FIRMS_LIST_HIDE_NO_CONFIDENCE_CHIP_LABEL = 'Hide no confidence';
export const FIRMS_LIST_HIDE_NO_CONFIDENCE_CHIP_TITLE =
  'Hide detections with no confidence on the FIRES list';

/** @typedef {boolean} FirmsListHideNoConfidence */

let sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_CONFIDENCE;
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
export function normalizeFirmsListHideNoConfidence(value) {
  if (value == null || value === '') return DEFAULT_FIRMS_LIST_HIDE_NO_CONFIDENCE;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Whether one detection already carries a rated confidence.
 * Missing, null, empty, and non-finite fail closed. `0` is a real
 * low rating and stays.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasListConfidence(fire) {
  const raw = fire?.confidence;
  if (raw == null || raw === '') return false;
  return Number.isFinite(Number(raw));
}

/**
 * Whether one detection clears Hide no confidence. Off always passes.
 * A selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hideNoConfidence
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function fireMeetsListHideNoConfidence(fire, hideNoConfidence, { selectedId = null } = {}) {
  const selected = selectedId == null || selectedId === '' ? '' : String(selectedId);
  if (selected) {
    const id = fireListId(fire);
    if (id && id === selected) return true;
  }
  if (normalizeFirmsListHideNoConfidence(hideNoConfidence) !== true) return true;
  return fireHasListConfidence(fire);
}

/**
 * Keep detections with a finite confidence when Hide no confidence is
 * on. Off returns a shallow copy so the current 50-row ranking stays
 * unchanged.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hideNoConfidence]
 * @param {{selectedId?: string|null}} [options]
 * @returns {Array<Object>}
 */
export function filterFiresByListHideNoConfidence(fires, hideNoConfidence, { selectedId = null } = {}) {
  const list = Array.isArray(fires) ? fires : [];
  if (normalizeFirmsListHideNoConfidence(hideNoConfidence) !== true && !selectedId) return list.slice();
  return list.filter((fire) => fireMeetsListHideNoConfidence(fire, hideNoConfidence, { selectedId }));
}

/**
 * Toggle-chip model for the hosted FIRES list row.
 * @param {unknown} [current]
 * @returns {object}
 */
export function firmsListHideNoConfidenceChipModel(current = DEFAULT_FIRMS_LIST_HIDE_NO_CONFIDENCE) {
  const hide = normalizeFirmsListHideNoConfidence(current) === true;
  return {
    id: FIRMS_LIST_HIDE_NO_CONFIDENCE_CHIP_ID,
    label: FIRMS_LIST_HIDE_NO_CONFIDENCE_CHIP_LABEL,
    title: FIRMS_LIST_HIDE_NO_CONFIDENCE_CHIP_TITLE,
    active: hide,
    group: 'ListHideNoConfidence',
    params: { firmsListHideNoConfidence: !hide },
  };
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsListHideNoConfidence(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_LIST_HIDE_NO_CONFIDENCE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_LIST_HIDE_NO_CONFIDENCE;
    return normalizeFirmsListHideNoConfidence(raw) === true;
  } catch {
    return DEFAULT_FIRMS_LIST_HIDE_NO_CONFIDENCE;
  }
}

/**
 * Persist `meridian.firmsListHideNoConfidence` as `'1'` / `'0'`.
 * @param {unknown} hideNoConfidence
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsListHideNoConfidence(hideNoConfidence, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeFirmsListHideNoConfidence(hideNoConfidence);
    if (next == null) return false;
    store.setItem(FIRMS_LIST_HIDE_NO_CONFIDENCE_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getFirmsListHideNoConfidence() {
  return sessionFilter;
}

/**
 * Toggle set. Clicking Hide no confidence flips the preference.
 * @param {unknown} hideNoConfidence
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setFirmsListHideNoConfidence(hideNoConfidence, { persist = true, storage } = {}) {
  const next = normalizeFirmsListHideNoConfidence(hideNoConfidence) === true;
  sessionFilter = next;
  if (persist) writeFirmsListHideNoConfidence(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * LayerStateCoordinator restore / reload path. Reads the local key and
 * applies it without writing again.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateFirmsListHideNoConfidence(storage) {
  return setFirmsListHideNoConfidence(readFirmsListHideNoConfidence(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(hideNoConfidence: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeFirmsListHideNoConfidence(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetFirmsListHideNoConfidenceForTest() {
  sessionFilter = DEFAULT_FIRMS_LIST_HIDE_NO_CONFIDENCE;
}
