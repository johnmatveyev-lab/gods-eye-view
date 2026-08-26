/**
 * Client-only Hide no track toggle for already-fetched NASA FIRMS
 * detections. Off is the current overlay (missing + unparseable +
 * real track). On keeps detections whose `trackKm` is a finite size
 * greater than 0. Missing, non-finite, and `trackKm <= 0` hide.
 * Missing track fails closed when on.
 *
 * Distinct from the globe track-size ceiling (All | <0.5km | <0.4km —
 * that ceiling still fails open on `trackKm` 0 / missing / non-finite:
 * `meridian.firmsTrack`), Plan 276 list Hide no track
 * (`meridian.firmsListHideNoTrack`), Plan 277 Hide no scan, Plan 281
 * Hide no FRP, Plan 267 Hide no brightness, Plan 262 Hide no acq, and
 * Plan 253 Hide no confidence. This is presence-only, not a track-size
 * ceiling. `adaptFirmsRecords` still writes 0 when track is unparseable;
 * this chip hides that sentinel when on. The selected detection always
 * stays if it already passed the other matchers. Re-applied on the
 * already-fetched `/api/firms` payload — no extra NASA fetch and no
 * new `/api`.
 *
 * Persistence is local only (`meridian.firmsHideNoTrack`, `1` / `0`).
 * LayerStateCoordinator restore re-reads the key. No share-URL write.
 */

export const FIRMS_HIDE_NO_TRACK_CHIP_ID = 'hide-no-track';
export const FIRMS_HIDE_NO_TRACK_CHIP_LABEL = 'Hide no track';
export const FIRMS_HIDE_NO_TRACK_CHIP_TITLE =
  'Hide detections that have no track size';

export const FIRMS_HIDE_NO_TRACK_STORAGE_KEY = 'meridian.firmsHideNoTrack';

export const DEFAULT_FIRMS_HIDE_NO_TRACK = false;

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
export function normalizeFirmsHideNoTrack(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return DEFAULT_FIRMS_HIDE_NO_TRACK;
}

/**
 * Whether one detection already carries a real along-track size.
 * Missing, non-finite, and `trackKm <= 0` fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasTrack(fire) {
  const trackKm = Number(fire?.trackKm);
  return Number.isFinite(trackKm) && trackKm > 0;
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
 * Whether Hide no track allows this detection to draw. Off is a
 * pass-through. On requires `trackKm > 0`. The selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hide
 * @param {{selectedId?: string|null}|string|null} [options]
 * @returns {boolean}
 */
export function fireMeetsHideNoTrack(fire, hide, options) {
  if (keepSelectedFire(fire, selectedIdFrom(options))) return true;
  if (normalizeFirmsHideNoTrack(hide) !== true) return true;
  return fireHasTrack(fire);
}

/**
 * Keep detections that pass Hide no track. Off returns a shallow copy
 * when no selected id is forced in. The selected id always stays.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hide=DEFAULT_FIRMS_HIDE_NO_TRACK]
 * @param {{selectedId?: string|null}|string|null} [selectedId]
 * @returns {Array<Object>}
 */
export function filterFiresByHideNoTrack(
  fires,
  hide = DEFAULT_FIRMS_HIDE_NO_TRACK,
  selectedId,
) {
  if (!Array.isArray(fires)) return [];
  const keepId = selectedIdFrom(selectedId);
  if (normalizeFirmsHideNoTrack(hide) !== true && (keepId == null || keepId === '')) {
    return fires.slice();
  }
  return fires.filter((fire) => fireMeetsHideNoTrack(fire, hide, keepId));
}

/**
 * Toggle-chip model for the FIRMS data-layer row. Clicking writes the
 * opposite boolean via setParams.
 * @param {unknown} [active=DEFAULT_FIRMS_HIDE_NO_TRACK]
 * @returns {object}
 */
export function firmsHideNoTrackChipModel(active = DEFAULT_FIRMS_HIDE_NO_TRACK) {
  const on = active === true;
  return {
    id: FIRMS_HIDE_NO_TRACK_CHIP_ID,
    label: FIRMS_HIDE_NO_TRACK_CHIP_LABEL,
    title: FIRMS_HIDE_NO_TRACK_CHIP_TITLE,
    active: on,
    params: { hideNoTrack: !on },
  };
}

/**
 * Read the durable Hide no track preference. Storage failures fail
 * closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsHideNoTrack(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_HIDE_NO_TRACK_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_HIDE_NO_TRACK;
    return normalizeFirmsHideNoTrack(raw);
  } catch {
    return DEFAULT_FIRMS_HIDE_NO_TRACK;
  }
}

/**
 * Persist the Hide no track preference as `1` / `0`. Best-effort;
 * never throws.
 * @param {unknown} hide
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsHideNoTrack(hide, storage) {
  const normalized = normalizeFirmsHideNoTrack(hide);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_HIDE_NO_TRACK_STORAGE_KEY, normalized ? '1' : '0');
    }
  } catch {
    // Fail open: the session can still apply the chosen toggle.
  }
  return normalized;
}
