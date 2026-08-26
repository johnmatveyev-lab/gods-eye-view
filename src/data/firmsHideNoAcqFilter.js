/**
 * Client-only Hide no acq toggle for already-fetched NASA FIRMS
 * detections. Off is the current overlay (missing + unparseable +
 * dated acquisition). On keeps detections whose `acqMs` is a finite
 * epoch greater than 0. Missing, non-finite, and `acqMs <= 0` hide.
 * Missing acquisition fails closed when on.
 *
 * Distinct from the age window (6h / 12h / 24h — that window still
 * fails open on `acqMs` 0 / missing / non-finite) and from Plans
 * 233 Hide no day/night, 238 Hide no satellite, 241 Hide no sensor,
 * 245 Hide no version, and 253 Hide no confidence. This is
 * presence-only, not a time floor. `parseAcquisitionMs` still writes
 * 0 when date/time is unparseable; this chip hides that sentinel
 * when on. The selected detection always stays. Re-applied on the
 * already-fetched `/api/firms` payload — no extra NASA fetch and no
 * new `/api`.
 *
 * Persistence is local only (`meridian.firmsHideNoAcq`, `1` / `0`).
 * LayerStateCoordinator restore re-reads the key. No share-URL write.
 */

export const FIRMS_HIDE_NO_ACQ_CHIP_ID = 'hide-no-acq';
export const FIRMS_HIDE_NO_ACQ_CHIP_LABEL = 'Hide no acq';
export const FIRMS_HIDE_NO_ACQ_CHIP_TITLE =
  'Hide detections that have no acquisition time';

export const FIRMS_HIDE_NO_ACQ_STORAGE_KEY = 'meridian.firmsHideNoAcq';

export const DEFAULT_FIRMS_HIDE_NO_ACQ = false;

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
export function normalizeFirmsHideNoAcq(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return DEFAULT_FIRMS_HIDE_NO_ACQ;
}

/**
 * Whether one detection already carries a real acquisition epoch.
 * Missing, non-finite, and `acqMs <= 0` fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasAcquisitionTime(fire) {
  const acqMs = Number(fire?.acqMs);
  return Number.isFinite(acqMs) && acqMs > 0;
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
 * Whether Hide no acq allows this detection to draw. Off is a
 * pass-through. On requires `acqMs > 0`. The selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hide
 * @param {{selectedId?: string|null}|string|null} [options]
 * @returns {boolean}
 */
export function fireMeetsHideNoAcq(fire, hide, options) {
  if (keepSelectedFire(fire, selectedIdFrom(options))) return true;
  if (normalizeFirmsHideNoAcq(hide) !== true) return true;
  return fireHasAcquisitionTime(fire);
}

/**
 * Keep detections that pass Hide no acq. Off returns a shallow copy
 * when no selected id is forced in. The selected id always stays.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hide=DEFAULT_FIRMS_HIDE_NO_ACQ]
 * @param {{selectedId?: string|null}|string|null} [selectedId]
 * @returns {Array<Object>}
 */
export function filterFiresByHideNoAcq(
  fires,
  hide = DEFAULT_FIRMS_HIDE_NO_ACQ,
  selectedId,
) {
  if (!Array.isArray(fires)) return [];
  const keepId = selectedIdFrom(selectedId);
  if (normalizeFirmsHideNoAcq(hide) !== true && (keepId == null || keepId === '')) {
    return fires.slice();
  }
  return fires.filter((fire) => fireMeetsHideNoAcq(fire, hide, keepId));
}

/**
 * Toggle-chip model for the FIRMS data-layer row. Clicking writes the
 * opposite boolean via setParams.
 * @param {unknown} [active=DEFAULT_FIRMS_HIDE_NO_ACQ]
 * @returns {object}
 */
export function firmsHideNoAcqChipModel(active = DEFAULT_FIRMS_HIDE_NO_ACQ) {
  const on = active === true;
  return {
    id: FIRMS_HIDE_NO_ACQ_CHIP_ID,
    label: FIRMS_HIDE_NO_ACQ_CHIP_LABEL,
    title: FIRMS_HIDE_NO_ACQ_CHIP_TITLE,
    active: on,
    params: { hideNoAcq: !on },
  };
}

/**
 * Read the durable Hide no acq preference. Storage failures fail
 * closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsHideNoAcq(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_HIDE_NO_ACQ_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_HIDE_NO_ACQ;
    return normalizeFirmsHideNoAcq(raw);
  } catch {
    return DEFAULT_FIRMS_HIDE_NO_ACQ;
  }
}

/**
 * Persist the Hide no acq preference as `1` / `0`. Best-effort;
 * never throws.
 * @param {unknown} hide
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsHideNoAcq(hide, storage) {
  const normalized = normalizeFirmsHideNoAcq(hide);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_HIDE_NO_ACQ_STORAGE_KEY, normalized ? '1' : '0');
    }
  } catch {
    // Fail open: the session can still apply the chosen toggle.
  }
  return normalized;
}
