/**
 * Client-only Hide no confidence toggle for already-fetched NASA FIRMS
 * detections. Off is the current overlay (null + missing + non-finite
 * + rated confidence). On keeps detections whose confidence is a finite
 * number. Missing, null, and non-finite confidence hide. Missing
 * confidence fails closed when on.
 *
 * Distinct from the globe confidence floor (All | 0.5+ | 0.8+ — that
 * floor still fails open on missing), Plan 210 list confidence, Plan
 * 204 scan, 211 track, 217 version, 226 pixel-area, 233 Hide no
 * day/night, 238 Hide no satellite, 241 Hide no sensor, and 245 Hide
 * no version. This is presence-only, not a floor. The selected
 * detection always stays. Re-applied on the already-fetched `/api/firms`
 * payload — no extra NASA fetch and no new `/api`.
 *
 * Persistence is local only (`meridian.firmsHideNoConfidence`, `1` / `0`).
 * LayerStateCoordinator restore re-reads the key. No share-URL write.
 */

export const FIRMS_HIDE_NO_CONFIDENCE_CHIP_ID = 'hide-no-confidence';
export const FIRMS_HIDE_NO_CONFIDENCE_CHIP_LABEL = 'Hide no confidence';
export const FIRMS_HIDE_NO_CONFIDENCE_CHIP_TITLE =
  'Hide detections that have no confidence rating';

export const FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY = 'meridian.firmsHideNoConfidence';

export const DEFAULT_FIRMS_HIDE_NO_CONFIDENCE = false;

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
export function normalizeFirmsHideNoConfidence(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return DEFAULT_FIRMS_HIDE_NO_CONFIDENCE;
}

/**
 * Whether one detection already carries a finite confidence. Missing,
 * null, empty, and non-finite fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasFiniteConfidence(fire) {
  const raw = fire?.confidence;
  if (raw == null || raw === '') return false;
  return Number.isFinite(Number(raw));
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
 * Whether Hide no confidence allows this detection to draw. Off is a
 * pass-through. On requires a finite confidence. The selected id
 * always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hide
 * @param {{selectedId?: string|null}|string|null} [options]
 * @returns {boolean}
 */
export function fireMeetsHideNoConfidence(fire, hide, options) {
  if (keepSelectedFire(fire, selectedIdFrom(options))) return true;
  if (normalizeFirmsHideNoConfidence(hide) !== true) return true;
  return fireHasFiniteConfidence(fire);
}

/**
 * Keep detections that pass Hide no confidence. Off returns a shallow
 * copy when no selected id is forced in. The selected id always stays.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hide=DEFAULT_FIRMS_HIDE_NO_CONFIDENCE]
 * @param {{selectedId?: string|null}|string|null} [selectedId]
 * @returns {Array<Object>}
 */
export function filterFiresByHideNoConfidence(
  fires,
  hide = DEFAULT_FIRMS_HIDE_NO_CONFIDENCE,
  selectedId,
) {
  if (!Array.isArray(fires)) return [];
  const keepId = selectedIdFrom(selectedId);
  if (normalizeFirmsHideNoConfidence(hide) !== true && (keepId == null || keepId === '')) {
    return fires.slice();
  }
  return fires.filter((fire) => fireMeetsHideNoConfidence(fire, hide, keepId));
}

/**
 * Toggle-chip model for the FIRMS data-layer row. Clicking writes the
 * opposite boolean via setParams.
 * @param {unknown} [active=DEFAULT_FIRMS_HIDE_NO_CONFIDENCE]
 * @returns {object}
 */
export function firmsHideNoConfidenceChipModel(active = DEFAULT_FIRMS_HIDE_NO_CONFIDENCE) {
  const on = active === true;
  return {
    id: FIRMS_HIDE_NO_CONFIDENCE_CHIP_ID,
    label: FIRMS_HIDE_NO_CONFIDENCE_CHIP_LABEL,
    title: FIRMS_HIDE_NO_CONFIDENCE_CHIP_TITLE,
    active: on,
    params: { hideNoConfidence: !on },
  };
}

/**
 * Read the durable Hide no confidence preference. Storage failures fail
 * closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsHideNoConfidence(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_HIDE_NO_CONFIDENCE;
    return normalizeFirmsHideNoConfidence(raw);
  } catch {
    return DEFAULT_FIRMS_HIDE_NO_CONFIDENCE;
  }
}

/**
 * Persist the Hide no confidence preference as `1` / `0`. Best-effort;
 * never throws.
 * @param {unknown} hide
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsHideNoConfidence(hide, storage) {
  const normalized = normalizeFirmsHideNoConfidence(hide);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY, normalized ? '1' : '0');
    }
  } catch {
    // Fail open: the session can still apply the chosen toggle.
  }
  return normalized;
}
