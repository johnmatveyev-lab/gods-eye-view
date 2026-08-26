/**
 * Client-only Hide no version toggle for already-fetched NASA FIRMS
 * detections. Off is the current overlay (empty + named version). On
 * keeps detections whose version is a non-empty trimmed string. Empty,
 * whitespace, and missing version hide. Missing version fails closed
 * when on.
 *
 * Distinct from the Plan 217 version identity chips (All | 2.0NRT |
 * Other), Plan 204 scan, 211 track, 226 pixel-area, 233 Hide no
 * day/night, 238 Hide no satellite, and 241 Hide no sensor. The
 * selected detection always stays. Re-applied on the already-fetched
 * `/api/firms` payload — no extra NASA fetch and no new `/api`.
 *
 * Persistence is local only (`meridian.firmsHideNoVersion`, `1` / `0`).
 * LayerStateCoordinator restore re-reads the key. No share-URL write.
 */

export const FIRMS_HIDE_NO_VERSION_CHIP_ID = 'hide-no-version';
export const FIRMS_HIDE_NO_VERSION_CHIP_LABEL = 'Hide no version';
export const FIRMS_HIDE_NO_VERSION_CHIP_TITLE =
  'Hide detections that have no product version';

export const FIRMS_HIDE_NO_VERSION_STORAGE_KEY = 'meridian.firmsHideNoVersion';

export const DEFAULT_FIRMS_HIDE_NO_VERSION = false;

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
export function normalizeFirmsHideNoVersion(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return DEFAULT_FIRMS_HIDE_NO_VERSION;
}

/**
 * Whether one detection already carries a non-empty trimmed version.
 * Missing, empty, and whitespace fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasNamedVersion(fire) {
  const raw = fire?.version;
  if (raw == null) return false;
  return String(raw).trim() !== '';
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
 * Whether Hide no version allows this detection to draw. Off is a
 * pass-through. On requires a non-empty trimmed version. The selected
 * id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hide
 * @param {{selectedId?: string|null}|string|null} [options]
 * @returns {boolean}
 */
export function fireMeetsHideNoVersion(fire, hide, options) {
  if (keepSelectedFire(fire, selectedIdFrom(options))) return true;
  if (normalizeFirmsHideNoVersion(hide) !== true) return true;
  return fireHasNamedVersion(fire);
}

/**
 * Keep detections that pass Hide no version. Off returns a shallow copy
 * when no selected id is forced in. The selected id always stays.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hide=DEFAULT_FIRMS_HIDE_NO_VERSION]
 * @param {{selectedId?: string|null}|string|null} [selectedId]
 * @returns {Array<Object>}
 */
export function filterFiresByHideNoVersion(
  fires,
  hide = DEFAULT_FIRMS_HIDE_NO_VERSION,
  selectedId,
) {
  if (!Array.isArray(fires)) return [];
  const keepId = selectedIdFrom(selectedId);
  if (normalizeFirmsHideNoVersion(hide) !== true && (keepId == null || keepId === '')) {
    return fires.slice();
  }
  return fires.filter((fire) => fireMeetsHideNoVersion(fire, hide, keepId));
}

/**
 * Toggle-chip model for the FIRMS data-layer row. Clicking writes the
 * opposite boolean via setParams.
 * @param {unknown} [active=DEFAULT_FIRMS_HIDE_NO_VERSION]
 * @returns {object}
 */
export function firmsHideNoVersionChipModel(active = DEFAULT_FIRMS_HIDE_NO_VERSION) {
  const on = active === true;
  return {
    id: FIRMS_HIDE_NO_VERSION_CHIP_ID,
    label: FIRMS_HIDE_NO_VERSION_CHIP_LABEL,
    title: FIRMS_HIDE_NO_VERSION_CHIP_TITLE,
    active: on,
    params: { hideNoVersion: !on },
  };
}

/**
 * Read the durable Hide no version preference. Storage failures fail
 * closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsHideNoVersion(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_HIDE_NO_VERSION_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_HIDE_NO_VERSION;
    return normalizeFirmsHideNoVersion(raw);
  } catch {
    return DEFAULT_FIRMS_HIDE_NO_VERSION;
  }
}

/**
 * Persist the Hide no version preference as `1` / `0`. Best-effort;
 * never throws.
 * @param {unknown} hide
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsHideNoVersion(hide, storage) {
  const normalized = normalizeFirmsHideNoVersion(hide);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_HIDE_NO_VERSION_STORAGE_KEY, normalized ? '1' : '0');
    }
  } catch {
    // Fail open: the session can still apply the chosen toggle.
  }
  return normalized;
}
