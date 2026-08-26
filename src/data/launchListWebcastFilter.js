/**
 * Client-only Launches panel Webcast only toggle.
 *
 * Filters already-fetched Launch Library 2 panel rows by the `webcast`
 * boolean `launchesPanelRows` copies (`webcastLive` / `webcast_live` or
 * a non-empty `vid_urls` / `vidURLs` list). Never fetches Launch Library
 * 2 and adds no endpoint. Persistence is local only
 * (`meridian.launchListWebcastOnly`) and is never written into share
 * URLs. LayerStateCoordinator restore of globe / LSP-type / mapped-only
 * / status / hide-no-provider / hide-no-site / hide-no-time /
 * hide-no-vehicle / hide-no-orbit options does not wipe this key; the
 * hosted list re-reads it when painting rows.
 *
 * Off is the current panel list (no-webcast rows stay). On keeps a
 * copied `webcast === true`. Missing / false fail closed. A selected
 * id stays. Distinct from Plan 207 LSP-type chips, Plan 215 mapped-only,
 * Plan 223 status chips, Plan 232 Hide no provider, Plan 239 Hide no
 * site, Plan 248 Hide no time, Plan 257 Hide no vehicle, Plan 264 Hide
 * no orbit, and globe `meridian.launchWebcastOnly` (Space Missions
 * roster / globe markers). This is the hosted list presence chip, not
 * a new LL2 query.
 */

export const DEFAULT_LAUNCH_LIST_WEBCAST_ONLY = false;
export const LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY = 'meridian.launchListWebcastOnly';
export const LAUNCH_LIST_WEBCAST_ONLY_CHIP_LABEL = 'Webcast only';
export const LAUNCH_LIST_WEBCAST_ONLY_CHIP_TITLE =
  'Show only missions with a webcast';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function nonEmptyVidUrls(value) {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeLaunchListWebcastOnly(value) {
  if (value == null || value === '') return DEFAULT_LAUNCH_LIST_WEBCAST_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Whether a raw LL2 row or copied panel row already has a webcast.
 * True when `webcast` / `webcastLive` / `webcast_live` is strictly true
 * or either video-URL list is a non-empty array.
 * @param {{
 *   webcast?: unknown,
 *   webcastLive?: unknown,
 *   webcast_live?: unknown,
 *   vid_urls?: unknown,
 *   vidURLs?: unknown
 * }|null|undefined} row
 * @returns {boolean}
 */
export function launchListRowHasWebcast(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.webcast === true || row.webcastLive === true || row.webcast_live === true) {
    return true;
  }
  return nonEmptyVidUrls(row.vid_urls) || nonEmptyVidUrls(row.vidURLs);
}

/**
 * Whether one panel row clears Webcast only.
 * Off always passes. A selected id stays.
 * Missing / false fail closed when on.
 * @param {{
 *   id?: unknown,
 *   webcast?: unknown,
 *   webcastLive?: unknown,
 *   webcast_live?: unknown,
 *   vid_urls?: unknown,
 *   vidURLs?: unknown
 * }|null|undefined} row
 * @param {unknown} webcastOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function launchListRowMatchesWebcastFilter(row, webcastOnly, { selectedId = null } = {}) {
  if (normalizeLaunchListWebcastOnly(webcastOnly) !== true) return true;
  const id = String(row?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return launchListRowHasWebcast(row);
}

/**
 * Drop missing / false-webcast rows when Webcast only is on. Off
 * returns a shallow copy.
 * @param {Array<object>|null|undefined} rows
 * @param {unknown} [webcastOnly=DEFAULT_LAUNCH_LIST_WEBCAST_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterLaunchListByWebcast(
  rows,
  webcastOnly = DEFAULT_LAUNCH_LIST_WEBCAST_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(rows)) return [];
  if (normalizeLaunchListWebcastOnly(webcastOnly) !== true) return rows.slice();
  return rows.filter((row) => launchListRowMatchesWebcastFilter(row, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_LAUNCH_LIST_WEBCAST_ONLY]
 * @returns {object}
 */
export function launchListWebcastOnlyChipModel(current = DEFAULT_LAUNCH_LIST_WEBCAST_ONLY) {
  const only = normalizeLaunchListWebcastOnly(current) === true;
  return {
    id: 'webcast-only',
    label: LAUNCH_LIST_WEBCAST_ONLY_CHIP_LABEL,
    title: LAUNCH_LIST_WEBCAST_ONLY_CHIP_TITLE,
    active: only,
    group: 'Webcast',
    params: { webcastOnly: !only },
  };
}

/**
 * Read `meridian.launchListWebcastOnly`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readLaunchListWebcastOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_LIST_WEBCAST_ONLY;
    return normalizeLaunchListWebcastOnly(raw) === true;
  } catch {
    return DEFAULT_LAUNCH_LIST_WEBCAST_ONLY;
  }
}

/**
 * Write `meridian.launchListWebcastOnly` as `'1'` / `'0'`.
 * @param {unknown} webcastOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchListWebcastOnly(webcastOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeLaunchListWebcastOnly(webcastOnly);
    if (next == null) return false;
    store.setItem(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
