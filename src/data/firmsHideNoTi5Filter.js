/**
 * Client-only Hide no TI5 toggle for already-fetched NASA FIRMS
 * detections. Off is the current overlay (missing + unparseable +
 * real mid-IR Kelvin). On keeps detections whose `brightnessTi5` is a
 * finite Kelvin greater than 0. Missing, non-finite, and
 * `brightnessTi5 <= 0` hide. Missing TI5 fails closed when on.
 *
 * Distinct from the globe TI5 floor (All | 290+ | 310+ — that floor
 * still fails open on `brightnessTi5` 0 / missing / non-finite:
 * `meridian.firmsBrightnessTi5`), Plan 267 Hide no brightness
 * (TI4 `fire.brightness` — a different channel), Plan 286 Hide no
 * track, Plan 281 Hide no FRP, Plan 277 Hide no scan, Plan 262 Hide
 * no acq, and Plan 253 Hide no confidence. This is presence-only, not
 * a TI5 Kelvin floor. `adaptFirmsRecords` still writes 0 when TI5 is
 * unparseable; this chip hides that sentinel when on. The selected
 * detection always stays if it already passed the other matchers.
 * Re-applied on the already-fetched `/api/firms` payload — no extra
 * NASA fetch and no new `/api`.
 *
 * Persistence is local only (`meridian.firmsHideNoTi5`, `1` / `0`).
 * LayerStateCoordinator restore re-reads the key. No share-URL write.
 */

export const FIRMS_HIDE_NO_TI5_CHIP_ID = 'hide-no-ti5';
export const FIRMS_HIDE_NO_TI5_CHIP_LABEL = 'Hide no TI5';
export const FIRMS_HIDE_NO_TI5_CHIP_TITLE =
  'Hide detections that have no TI5 brightness';

export const FIRMS_HIDE_NO_TI5_STORAGE_KEY = 'meridian.firmsHideNoTi5';

export const DEFAULT_FIRMS_HIDE_NO_TI5 = false;

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
export function normalizeFirmsHideNoTi5(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return DEFAULT_FIRMS_HIDE_NO_TI5;
}

/**
 * Whether one detection already carries a real mid-IR TI5 Kelvin.
 * Missing, non-finite, and `brightnessTi5 <= 0` fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasBrightnessTi5(fire) {
  const brightnessTi5 = Number(fire?.brightnessTi5);
  return Number.isFinite(brightnessTi5) && brightnessTi5 > 0;
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
 * Whether Hide no TI5 allows this detection to draw. Off is a
 * pass-through. On requires `brightnessTi5 > 0`. The selected id always
 * stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hide
 * @param {{selectedId?: string|null}|string|null} [options]
 * @returns {boolean}
 */
export function fireMeetsHideNoTi5(fire, hide, options) {
  if (keepSelectedFire(fire, selectedIdFrom(options))) return true;
  if (normalizeFirmsHideNoTi5(hide) !== true) return true;
  return fireHasBrightnessTi5(fire);
}

/**
 * Keep detections that pass Hide no TI5. Off returns a shallow copy
 * when no selected id is forced in. The selected id always stays.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hide=DEFAULT_FIRMS_HIDE_NO_TI5]
 * @param {{selectedId?: string|null}|string|null} [selectedId]
 * @returns {Array<Object>}
 */
export function filterFiresByHideNoTi5(
  fires,
  hide = DEFAULT_FIRMS_HIDE_NO_TI5,
  selectedId,
) {
  if (!Array.isArray(fires)) return [];
  const keepId = selectedIdFrom(selectedId);
  if (normalizeFirmsHideNoTi5(hide) !== true && (keepId == null || keepId === '')) {
    return fires.slice();
  }
  return fires.filter((fire) => fireMeetsHideNoTi5(fire, hide, keepId));
}

/**
 * Toggle-chip model for the FIRMS data-layer row. Clicking writes the
 * opposite boolean via setParams.
 * @param {unknown} [active=DEFAULT_FIRMS_HIDE_NO_TI5]
 * @returns {object}
 */
export function firmsHideNoTi5ChipModel(active = DEFAULT_FIRMS_HIDE_NO_TI5) {
  const on = active === true;
  return {
    id: FIRMS_HIDE_NO_TI5_CHIP_ID,
    label: FIRMS_HIDE_NO_TI5_CHIP_LABEL,
    title: FIRMS_HIDE_NO_TI5_CHIP_TITLE,
    active: on,
    params: { hideNoTi5: !on },
  };
}

/**
 * Read the durable Hide no TI5 preference. Storage failures fail
 * closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsHideNoTi5(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_HIDE_NO_TI5_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_HIDE_NO_TI5;
    return normalizeFirmsHideNoTi5(raw);
  } catch {
    return DEFAULT_FIRMS_HIDE_NO_TI5;
  }
}

/**
 * Persist the Hide no TI5 preference as `1` / `0`. Best-effort;
 * never throws.
 * @param {unknown} hide
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsHideNoTi5(hide, storage) {
  const normalized = normalizeFirmsHideNoTi5(hide);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_HIDE_NO_TI5_STORAGE_KEY, normalized ? '1' : '0');
    }
  } catch {
    // Fail open: the session can still apply the chosen toggle.
  }
  return normalized;
}
