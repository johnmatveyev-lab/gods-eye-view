/**
 * Client-only Launches panel Hide no probability toggle.
 *
 * Filters already-fetched Launch Library 2 panel rows by the finite
 * `probability` number `launchesPanelRows` copies (`launch.probability`).
 * Never fetches Launch Library 2 and adds no endpoint. Persistence is
 * local only (`meridian.launchListHideNoProbability`) and is never
 * written into share URLs. LayerStateCoordinator restore of globe /
 * LSP-type / mapped-only / status / hide-no-provider / hide-no-site /
 * hide-no-time / hide-no-vehicle / hide-no-orbit / webcast-only /
 * hide-no-mission options does not wipe this key; the hosted list
 * re-reads it when painting rows.
 *
 * Off is the current panel list (missing + null + non-finite + rated
 * stay). On keeps Number.isFinite(probability). 0 stays as a real 0%
 * go chance. Missing / null / non-finite fail closed. A selected id
 * stays. Distinct from Plan 207 LSP-type chips, Plan 215 mapped-only,
 * Plan 223 status chips, Plan 232 Hide no provider, Plan 239 Hide no
 * site, Plan 248 Hide no time, Plan 257 Hide no vehicle, Plan 264 Hide
 * no orbit, Plan 272 Webcast only, Plan 283 Hide no mission, and globe
 * `meridian.launchProbability` (All | 50+ | 80+). This is
 * presence-only, not a probability-floor chip.
 */

export const DEFAULT_LAUNCH_LIST_HIDE_NO_PROBABILITY = false;
export const LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY = 'meridian.launchListHideNoProbability';
export const LAUNCH_LIST_HIDE_NO_PROBABILITY_CHIP_LABEL = 'Hide no probability';
export const LAUNCH_LIST_HIDE_NO_PROBABILITY_CHIP_TITLE =
  'Hide missions without a launch probability';

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
export function normalizeLaunchListHideNoProbability(value) {
  if (value == null || value === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_PROBABILITY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Copied panel `probability` when it is already a finite number.
 * 0 stays 0. Missing / null / non-finite collapse to null.
 * @param {{probability?: unknown}|null|undefined} row
 * @returns {number|null}
 */
export function launchListProbability(row) {
  return Number.isFinite(row?.probability) ? row.probability : null;
}

/**
 * Whether a panel row already has a finite go-percent.
 * 0 is a real 0% and counts as present.
 * @param {{probability?: unknown}|null|undefined} row
 * @returns {boolean}
 */
export function launchListRowHasProbability(row) {
  return Number.isFinite(launchListProbability(row));
}

/**
 * Whether one panel row clears Hide no probability.
 * Off always passes. A selected id stays.
 * Missing / null / non-finite fail closed when on.
 * @param {{
 *   id?: unknown,
 *   probability?: unknown
 * }|null|undefined} row
 * @param {unknown} hideNoProbability
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function launchListRowMatchesProbabilityFilter(row, hideNoProbability, { selectedId = null } = {}) {
  if (normalizeLaunchListHideNoProbability(hideNoProbability) !== true) return true;
  const id = String(row?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return launchListRowHasProbability(row);
}

/**
 * Drop missing / null / non-finite-probability rows when Hide no
 * probability is on. Off returns a shallow copy. 0 stays.
 * @param {Array<object>|null|undefined} rows
 * @param {unknown} [hideNoProbability=DEFAULT_LAUNCH_LIST_HIDE_NO_PROBABILITY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterLaunchListByProbability(
  rows,
  hideNoProbability = DEFAULT_LAUNCH_LIST_HIDE_NO_PROBABILITY,
  selectedId = null,
) {
  if (!Array.isArray(rows)) return [];
  if (normalizeLaunchListHideNoProbability(hideNoProbability) !== true) return rows.slice();
  return rows.filter((row) => launchListRowMatchesProbabilityFilter(row, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_LAUNCH_LIST_HIDE_NO_PROBABILITY]
 * @returns {object}
 */
export function launchListHideNoProbabilityChipModel(current = DEFAULT_LAUNCH_LIST_HIDE_NO_PROBABILITY) {
  const hide = normalizeLaunchListHideNoProbability(current) === true;
  return {
    id: 'hide-no-probability',
    label: LAUNCH_LIST_HIDE_NO_PROBABILITY_CHIP_LABEL,
    title: LAUNCH_LIST_HIDE_NO_PROBABILITY_CHIP_TITLE,
    active: hide,
    group: 'Probability',
    params: { hideNoProbability: !hide },
  };
}

/**
 * Read `meridian.launchListHideNoProbability`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readLaunchListHideNoProbability(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_PROBABILITY;
    return normalizeLaunchListHideNoProbability(raw) === true;
  } catch {
    return DEFAULT_LAUNCH_LIST_HIDE_NO_PROBABILITY;
  }
}

/**
 * Write `meridian.launchListHideNoProbability` as `'1'` / `'0'`.
 * @param {unknown} hideNoProbability
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchListHideNoProbability(hideNoProbability, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeLaunchListHideNoProbability(hideNoProbability);
    if (next == null) return false;
    store.setItem(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
