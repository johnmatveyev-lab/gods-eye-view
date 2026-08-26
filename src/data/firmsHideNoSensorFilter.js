/**
 * Client-only Hide no sensor toggle for already-fetched NASA FIRMS
 * detections. Off is the current overlay (empty + named sensor). On
 * keeps detections whose sensor is a non-empty trimmed string. Empty,
 * whitespace, and missing sensor hide. Missing sensor fails closed
 * when on.
 *
 * Distinct from the sensor identity chips (All | VIIRS | MODIS / Other),
 * Plan 204 scan, 211 track, 217 version, 226 pixel-area, 233 Hide no
 * day/night, and 238 Hide no satellite. The selected detection always
 * stays. Re-applied on the already-fetched `/api/firms` payload — no extra
 * NASA fetch and no new `/api`.
 *
 * Persistence is local only (`meridian.firmsHideNoSensor`, `1` / `0`).
 * LayerStateCoordinator restore re-reads the key. No share-URL write.
 */

export const FIRMS_HIDE_NO_SENSOR_CHIP_ID = 'hide-no-sensor';
export const FIRMS_HIDE_NO_SENSOR_CHIP_LABEL = 'Hide no sensor';
export const FIRMS_HIDE_NO_SENSOR_CHIP_TITLE =
  'Hide detections that have no sensor name';

export const FIRMS_HIDE_NO_SENSOR_STORAGE_KEY = 'meridian.firmsHideNoSensor';

export const DEFAULT_FIRMS_HIDE_NO_SENSOR = false;

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
export function normalizeFirmsHideNoSensor(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return DEFAULT_FIRMS_HIDE_NO_SENSOR;
}

/**
 * Whether one detection already carries a non-empty trimmed sensor.
 * Missing, empty, and whitespace fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasNamedSensor(fire) {
  const raw = fire?.sensor;
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
 * Whether Hide no sensor allows this detection to draw. Off is a
 * pass-through. On requires a non-empty trimmed sensor. The selected
 * id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hide
 * @param {{selectedId?: string|null}|string|null} [options]
 * @returns {boolean}
 */
export function fireMeetsHideNoSensor(fire, hide, options) {
  if (keepSelectedFire(fire, selectedIdFrom(options))) return true;
  if (normalizeFirmsHideNoSensor(hide) !== true) return true;
  return fireHasNamedSensor(fire);
}

/**
 * Keep detections that pass Hide no sensor. Off returns a shallow copy
 * when no selected id is forced in. The selected id always stays.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hide=DEFAULT_FIRMS_HIDE_NO_SENSOR]
 * @param {{selectedId?: string|null}|string|null} [selectedId]
 * @returns {Array<Object>}
 */
export function filterFiresByHideNoSensor(
  fires,
  hide = DEFAULT_FIRMS_HIDE_NO_SENSOR,
  selectedId,
) {
  if (!Array.isArray(fires)) return [];
  const keepId = selectedIdFrom(selectedId);
  if (normalizeFirmsHideNoSensor(hide) !== true && (keepId == null || keepId === '')) {
    return fires.slice();
  }
  return fires.filter((fire) => fireMeetsHideNoSensor(fire, hide, keepId));
}

/**
 * Toggle-chip model for the FIRMS data-layer row. Clicking writes the
 * opposite boolean via setParams.
 * @param {unknown} [active=DEFAULT_FIRMS_HIDE_NO_SENSOR]
 * @returns {object}
 */
export function firmsHideNoSensorChipModel(active = DEFAULT_FIRMS_HIDE_NO_SENSOR) {
  const on = active === true;
  return {
    id: FIRMS_HIDE_NO_SENSOR_CHIP_ID,
    label: FIRMS_HIDE_NO_SENSOR_CHIP_LABEL,
    title: FIRMS_HIDE_NO_SENSOR_CHIP_TITLE,
    active: on,
    params: { hideNoSensor: !on },
  };
}

/**
 * Read the durable Hide no sensor preference. Storage failures fail
 * closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsHideNoSensor(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_HIDE_NO_SENSOR_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_HIDE_NO_SENSOR;
    return normalizeFirmsHideNoSensor(raw);
  } catch {
    return DEFAULT_FIRMS_HIDE_NO_SENSOR;
  }
}

/**
 * Persist the Hide no sensor preference as `1` / `0`. Best-effort;
 * never throws.
 * @param {unknown} hide
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsHideNoSensor(hide, storage) {
  const normalized = normalizeFirmsHideNoSensor(hide);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_HIDE_NO_SENSOR_STORAGE_KEY, normalized ? '1' : '0');
    }
  } catch {
    // Fail open: the session can still apply the chosen toggle.
  }
  return normalized;
}
