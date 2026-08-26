/**
 * Client-only Launches panel Mapped only toggle.
 *
 * Filters already-fetched Launch Library 2 panel rows by finite pad
 * `lat` / `lon` (the coords `launchesPanelRows` already computes).
 * Never fetches Launch Library 2 and adds no endpoint.
 * Persistence is local only (`meridian.launchListMappedOnly`) and is
 * never written into share URLs. LayerStateCoordinator restore of
 * globe / LSP-type options does not wipe this key; the hosted list
 * re-reads it when painting rows.
 *
 * Off is the current panel list (no-coord rows stay selectable).
 * On drops rows missing finite pad coords. A selected id stays.
 * Distinct from Plan 207 LSP-type chips, Plan 181 hide-unknown-site
 * (name string), and Plan 209/212 sites mapped-only.
 */

export const DEFAULT_LAUNCH_LIST_MAPPED_ONLY = false;
export const LAUNCH_LIST_MAPPED_ONLY_STORAGE_KEY = 'meridian.launchListMappedOnly';
export const LAUNCH_LIST_MAPPED_ONLY_CHIP_LABEL = 'Mapped only';
export const LAUNCH_LIST_MAPPED_ONLY_CHIP_TITLE =
  'Hide missions without a flyable pad';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeLaunchListMappedOnly(value) {
  if (value == null || value === '') return DEFAULT_LAUNCH_LIST_MAPPED_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Whether a panel row already has a flyable pad.
 * @param {{lat?: unknown, lon?: unknown}|null|undefined} row
 * @returns {boolean}
 */
export function launchListRowHasMappedPad(row) {
  return Number.isFinite(row?.lat) && Number.isFinite(row?.lon);
}

/**
 * Whether one panel row clears Mapped only.
 * Off always passes. A selected id stays.
 * @param {{id?: unknown, lat?: unknown, lon?: unknown}|null|undefined} row
 * @param {unknown} mappedOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function launchListRowMatchesMappedFilter(row, mappedOnly, { selectedId = null } = {}) {
  if (normalizeLaunchListMappedOnly(mappedOnly) !== true) return true;
  const id = String(row?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return launchListRowHasMappedPad(row);
}

/**
 * Drop unmappable rows when Mapped only is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} rows
 * @param {unknown} [mappedOnly=DEFAULT_LAUNCH_LIST_MAPPED_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterLaunchListByMappedOnly(
  rows,
  mappedOnly = DEFAULT_LAUNCH_LIST_MAPPED_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(rows)) return [];
  if (normalizeLaunchListMappedOnly(mappedOnly) !== true) return rows.slice();
  return rows.filter((row) => launchListRowMatchesMappedFilter(row, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_LAUNCH_LIST_MAPPED_ONLY]
 * @returns {object}
 */
export function launchListMappedOnlyChipModel(current = DEFAULT_LAUNCH_LIST_MAPPED_ONLY) {
  const only = normalizeLaunchListMappedOnly(current) === true;
  return {
    id: 'mapped-only',
    label: LAUNCH_LIST_MAPPED_ONLY_CHIP_LABEL,
    title: LAUNCH_LIST_MAPPED_ONLY_CHIP_TITLE,
    active: only,
    group: 'Mapped',
    params: { mappedOnly: !only },
  };
}

/**
 * Read `meridian.launchListMappedOnly`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readLaunchListMappedOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(LAUNCH_LIST_MAPPED_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_LIST_MAPPED_ONLY;
    return normalizeLaunchListMappedOnly(raw) === true;
  } catch {
    return DEFAULT_LAUNCH_LIST_MAPPED_ONLY;
  }
}

/**
 * Write `meridian.launchListMappedOnly` as `'1'` / `'0'`.
 * @param {unknown} mappedOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchListMappedOnly(mappedOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeLaunchListMappedOnly(mappedOnly);
    if (next == null) return false;
    store.setItem(LAUNCH_LIST_MAPPED_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
