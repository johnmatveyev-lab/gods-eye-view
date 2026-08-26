/**
 * Client-only Hide no satellite toggle for already-fetched NASA FIRMS
 * detections. Off is the current overlay (empty + named satellite). On
 * keeps detections whose satellite is a non-empty trimmed string. Empty,
 * whitespace, and missing satellite hide. Missing satellite fails closed
 * when on.
 *
 * Distinct from the satellite identity chips (All | NOAA-20 | … / Other),
 * Plan 204 scan, 211 track, 217 version, 226 pixel-area, 233 Hide no
 * day/night, and 230 list hide-no-sat. The selected detection always
 * stays. Re-applied on the already-fetched `/api/firms` payload — no extra
 * NASA fetch and no new `/api`.
 *
 * Persistence is local only (`meridian.firmsHideNoSatellite`, `1` / `0`).
 * LayerStateCoordinator restore re-reads the key. No share-URL write.
 */

export const FIRMS_HIDE_NO_SATELLITE_CHIP_ID = 'hide-no-satellite';
export const FIRMS_HIDE_NO_SATELLITE_CHIP_LABEL = 'Hide no satellite';
export const FIRMS_HIDE_NO_SATELLITE_CHIP_TITLE =
  'Hide detections that have no satellite name';

export const FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY = 'meridian.firmsHideNoSatellite';

export const DEFAULT_FIRMS_HIDE_NO_SATELLITE = false;

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
export function normalizeFirmsHideNoSatellite(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return DEFAULT_FIRMS_HIDE_NO_SATELLITE;
}

/**
 * Whether one detection already carries a non-empty trimmed satellite.
 * Missing, empty, and whitespace fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasNamedSatellite(fire) {
  const raw = fire?.satellite;
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
 * Whether Hide no satellite allows this detection to draw. Off is a
 * pass-through. On requires a non-empty trimmed satellite. The selected
 * id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hide
 * @param {{selectedId?: string|null}|string|null} [options]
 * @returns {boolean}
 */
export function fireMeetsHideNoSatellite(fire, hide, options) {
  if (keepSelectedFire(fire, selectedIdFrom(options))) return true;
  if (normalizeFirmsHideNoSatellite(hide) !== true) return true;
  return fireHasNamedSatellite(fire);
}

/**
 * Keep detections that pass Hide no satellite. Off returns a shallow copy
 * when no selected id is forced in. The selected id always stays.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hide=DEFAULT_FIRMS_HIDE_NO_SATELLITE]
 * @param {{selectedId?: string|null}|string|null} [selectedId]
 * @returns {Array<Object>}
 */
export function filterFiresByHideNoSatellite(
  fires,
  hide = DEFAULT_FIRMS_HIDE_NO_SATELLITE,
  selectedId,
) {
  if (!Array.isArray(fires)) return [];
  const keepId = selectedIdFrom(selectedId);
  if (normalizeFirmsHideNoSatellite(hide) !== true && (keepId == null || keepId === '')) {
    return fires.slice();
  }
  return fires.filter((fire) => fireMeetsHideNoSatellite(fire, hide, keepId));
}

/**
 * Toggle-chip model for the FIRMS data-layer row. Clicking writes the
 * opposite boolean via setParams.
 * @param {unknown} [active=DEFAULT_FIRMS_HIDE_NO_SATELLITE]
 * @returns {object}
 */
export function firmsHideNoSatelliteChipModel(active = DEFAULT_FIRMS_HIDE_NO_SATELLITE) {
  const on = active === true;
  return {
    id: FIRMS_HIDE_NO_SATELLITE_CHIP_ID,
    label: FIRMS_HIDE_NO_SATELLITE_CHIP_LABEL,
    title: FIRMS_HIDE_NO_SATELLITE_CHIP_TITLE,
    active: on,
    params: { hideNoSatellite: !on },
  };
}

/**
 * Read the durable Hide no satellite preference. Storage failures fail
 * closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsHideNoSatellite(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_HIDE_NO_SATELLITE;
    return normalizeFirmsHideNoSatellite(raw);
  } catch {
    return DEFAULT_FIRMS_HIDE_NO_SATELLITE;
  }
}

/**
 * Persist the Hide no satellite preference as `1` / `0`. Best-effort;
 * never throws.
 * @param {unknown} hide
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsHideNoSatellite(hide, storage) {
  const normalized = normalizeFirmsHideNoSatellite(hide);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_HIDE_NO_SATELLITE_STORAGE_KEY, normalized ? '1' : '0');
    }
  } catch {
    // Fail open: the session can still apply the chosen toggle.
  }
  return normalized;
}
