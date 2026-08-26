/**
 * Client-only Launches panel Hide no vehicle toggle.
 *
 * Filters already-fetched Launch Library 2 panel rows by the `vehicle`
 * string `launchesPanelRows` already copies (`rocketName` or
 * `rocket.configuration.name` or `rocket.name`). Never fetches Launch
 * Library 2 and adds no endpoint. Persistence is local only
 * (`meridian.launchListHideNoVehicle`) and is never written into share
 * URLs. LayerStateCoordinator restore of globe / LSP-type / mapped-only
 * / status / hide-no-provider / hide-no-site / hide-no-time options
 * does not wipe this key; the hosted list re-reads it when painting
 * rows.
 *
 * Off is the current panel list (missing + empty + named vehicle stay).
 * On keeps a non-empty trimmed vehicle (Falcon 9 stays). Empty /
 * whitespace / missing fail closed. A selected id stays. Distinct from
 * Plan 207 LSP-type chips, Plan 215 mapped-only, Plan 223 status chips,
 * Plan 232 Hide no provider, Plan 239 Hide no site, Plan 248 Hide no
 * time, and globe `meridian.launchRocket` chips.
 */

export const DEFAULT_LAUNCH_LIST_HIDE_NO_VEHICLE = false;
export const LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY = 'meridian.launchListHideNoVehicle';
export const LAUNCH_LIST_HIDE_NO_VEHICLE_CHIP_LABEL = 'Hide no vehicle';
export const LAUNCH_LIST_HIDE_NO_VEHICLE_CHIP_TITLE =
  'Hide missions without a launch vehicle';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function trimmedVehicleField(value) {
  if (typeof value === 'string') return value.trim();
  if (value != null && value !== '') return String(value).trim();
  return '';
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeLaunchListHideNoVehicle(value) {
  if (value == null || value === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_VEHICLE;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Read the copied panel `vehicle` (string or rocketName /
 * rocket.configuration.name / rocket.name). Empty / whitespace collapse
 * to ''.
 * @param {{
 *   vehicle?: unknown,
 *   rocketName?: unknown,
 *   rocket?: {configuration?: {name?: unknown}, name?: unknown}
 * }|null|undefined} row
 * @returns {string}
 */
export function launchListVehicleName(row) {
  const copied = trimmedVehicleField(row?.vehicle);
  if (copied) return copied;
  const rocketName = trimmedVehicleField(row?.rocketName);
  if (rocketName) return rocketName;
  const configName = trimmedVehicleField(row?.rocket?.configuration?.name);
  if (configName) return configName;
  return trimmedVehicleField(row?.rocket?.name);
}

/**
 * Whether a panel row already has a named vehicle.
 * @param {{
 *   vehicle?: unknown,
 *   rocketName?: unknown,
 *   rocket?: {configuration?: {name?: unknown}, name?: unknown}
 * }|null|undefined} row
 * @returns {boolean}
 */
export function launchListRowHasVehicle(row) {
  return launchListVehicleName(row) !== '';
}

/**
 * Whether one panel row clears Hide no vehicle.
 * Off always passes. A selected id stays.
 * Empty / whitespace / missing fail closed when on.
 * @param {{
 *   id?: unknown,
 *   vehicle?: unknown,
 *   rocketName?: unknown,
 *   rocket?: {configuration?: {name?: unknown}, name?: unknown}
 * }|null|undefined} row
 * @param {unknown} hideNoVehicle
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function launchListRowMatchesVehicleFilter(row, hideNoVehicle, { selectedId = null } = {}) {
  if (normalizeLaunchListHideNoVehicle(hideNoVehicle) !== true) return true;
  const id = String(row?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return launchListRowHasVehicle(row);
}

/**
 * Drop missing / empty-vehicle rows when Hide no vehicle is on. Off
 * returns a shallow copy.
 * @param {Array<object>|null|undefined} rows
 * @param {unknown} [hideNoVehicle=DEFAULT_LAUNCH_LIST_HIDE_NO_VEHICLE]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterLaunchListByVehicle(
  rows,
  hideNoVehicle = DEFAULT_LAUNCH_LIST_HIDE_NO_VEHICLE,
  selectedId = null,
) {
  if (!Array.isArray(rows)) return [];
  if (normalizeLaunchListHideNoVehicle(hideNoVehicle) !== true) return rows.slice();
  return rows.filter((row) => launchListRowMatchesVehicleFilter(row, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_LAUNCH_LIST_HIDE_NO_VEHICLE]
 * @returns {object}
 */
export function launchListHideNoVehicleChipModel(current = DEFAULT_LAUNCH_LIST_HIDE_NO_VEHICLE) {
  const hide = normalizeLaunchListHideNoVehicle(current) === true;
  return {
    id: 'hide-no-vehicle',
    label: LAUNCH_LIST_HIDE_NO_VEHICLE_CHIP_LABEL,
    title: LAUNCH_LIST_HIDE_NO_VEHICLE_CHIP_TITLE,
    active: hide,
    group: 'Vehicle',
    params: { hideNoVehicle: !hide },
  };
}

/**
 * Read `meridian.launchListHideNoVehicle`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readLaunchListHideNoVehicle(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_VEHICLE;
    return normalizeLaunchListHideNoVehicle(raw) === true;
  } catch {
    return DEFAULT_LAUNCH_LIST_HIDE_NO_VEHICLE;
  }
}

/**
 * Write `meridian.launchListHideNoVehicle` as `'1'` / `'0'`.
 * @param {unknown} hideNoVehicle
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchListHideNoVehicle(hideNoVehicle, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeLaunchListHideNoVehicle(hideNoVehicle);
    if (next == null) return false;
    store.setItem(LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
