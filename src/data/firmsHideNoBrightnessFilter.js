/**
 * Client-only Hide no brightness toggle for already-fetched NASA FIRMS
 * detections. Off is the current overlay (missing + unparseable +
 * real Kelvin). On keeps detections whose `brightness` is a finite
 * Kelvin greater than 0. Missing, non-finite, and `brightness <= 0`
 * hide. Missing brightness fails closed when on.
 *
 * Distinct from the brightness floor (All | 320+ | 340+ — that floor
 * still fails open on `brightness` 0 / missing / non-finite), the TI5
 * filter, the FRP floor, Plan 253 Hide no confidence, and Plan 262
 * Hide no acq. This is presence-only, not a Kelvin floor.
 * `adaptFirmsRecords` still writes 0 when Kelvin is unparseable; this
 * chip hides that sentinel when on. The selected detection always
 * stays. Re-applied on the already-fetched `/api/firms` payload — no
 * extra NASA fetch and no new `/api`.
 *
 * Persistence is local only (`meridian.firmsHideNoBrightness`, `1` / `0`).
 * LayerStateCoordinator restore re-reads the key. No share-URL write.
 */

export const FIRMS_HIDE_NO_BRIGHTNESS_CHIP_ID = 'hide-no-brightness';
export const FIRMS_HIDE_NO_BRIGHTNESS_CHIP_LABEL = 'Hide no brightness';
export const FIRMS_HIDE_NO_BRIGHTNESS_CHIP_TITLE =
  'Hide detections that have no brightness';

export const FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY = 'meridian.firmsHideNoBrightness';

export const DEFAULT_FIRMS_HIDE_NO_BRIGHTNESS = false;

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
export function normalizeFirmsHideNoBrightness(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return DEFAULT_FIRMS_HIDE_NO_BRIGHTNESS;
}

/**
 * Whether one detection already carries a real Kelvin brightness.
 * Missing, non-finite, and `brightness <= 0` fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasBrightness(fire) {
  const brightness = Number(fire?.brightness);
  return Number.isFinite(brightness) && brightness > 0;
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
 * Whether Hide no brightness allows this detection to draw. Off is a
 * pass-through. On requires `brightness > 0`. The selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hide
 * @param {{selectedId?: string|null}|string|null} [options]
 * @returns {boolean}
 */
export function fireMeetsHideNoBrightness(fire, hide, options) {
  if (keepSelectedFire(fire, selectedIdFrom(options))) return true;
  if (normalizeFirmsHideNoBrightness(hide) !== true) return true;
  return fireHasBrightness(fire);
}

/**
 * Keep detections that pass Hide no brightness. Off returns a shallow copy
 * when no selected id is forced in. The selected id always stays.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hide=DEFAULT_FIRMS_HIDE_NO_BRIGHTNESS]
 * @param {{selectedId?: string|null}|string|null} [selectedId]
 * @returns {Array<Object>}
 */
export function filterFiresByHideNoBrightness(
  fires,
  hide = DEFAULT_FIRMS_HIDE_NO_BRIGHTNESS,
  selectedId,
) {
  if (!Array.isArray(fires)) return [];
  const keepId = selectedIdFrom(selectedId);
  if (normalizeFirmsHideNoBrightness(hide) !== true && (keepId == null || keepId === '')) {
    return fires.slice();
  }
  return fires.filter((fire) => fireMeetsHideNoBrightness(fire, hide, keepId));
}

/**
 * Toggle-chip model for the FIRMS data-layer row. Clicking writes the
 * opposite boolean via setParams.
 * @param {unknown} [active=DEFAULT_FIRMS_HIDE_NO_BRIGHTNESS]
 * @returns {object}
 */
export function firmsHideNoBrightnessChipModel(active = DEFAULT_FIRMS_HIDE_NO_BRIGHTNESS) {
  const on = active === true;
  return {
    id: FIRMS_HIDE_NO_BRIGHTNESS_CHIP_ID,
    label: FIRMS_HIDE_NO_BRIGHTNESS_CHIP_LABEL,
    title: FIRMS_HIDE_NO_BRIGHTNESS_CHIP_TITLE,
    active: on,
    params: { hideNoBrightness: !on },
  };
}

/**
 * Read the durable Hide no brightness preference. Storage failures fail
 * closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsHideNoBrightness(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_HIDE_NO_BRIGHTNESS;
    return normalizeFirmsHideNoBrightness(raw);
  } catch {
    return DEFAULT_FIRMS_HIDE_NO_BRIGHTNESS;
  }
}

/**
 * Persist the Hide no brightness preference as `1` / `0`. Best-effort;
 * never throws.
 * @param {unknown} hide
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsHideNoBrightness(hide, storage) {
  const normalized = normalizeFirmsHideNoBrightness(hide);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_HIDE_NO_BRIGHTNESS_STORAGE_KEY, normalized ? '1' : '0');
    }
  } catch {
    // Fail open: the session can still apply the chosen toggle.
  }
  return normalized;
}
