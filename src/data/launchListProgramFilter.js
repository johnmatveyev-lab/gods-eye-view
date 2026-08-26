/**
 * Client-only Launches panel Hide no program toggle.
 *
 * Filters already-fetched Launch Library 2 panel rows by the first
 * published `program.name` `launchesPanelRows` copies (`launch.program`
 * array). Never fetches Launch Library 2 and adds no endpoint.
 * Persistence is local only (`meridian.launchListHideNoProgram`) and is
 * never written into share URLs. LayerStateCoordinator restore of globe
 * / LSP-type / mapped-only / status / hide-no-provider / hide-no-site /
 * hide-no-time / hide-no-vehicle / hide-no-orbit / webcast-only /
 * hide-no-mission / hide-no-probability / hide-no-country options does
 * not wipe this key; the hosted list re-reads it when painting rows.
 *
 * Off is the current panel list (missing + empty array + blank name +
 * named program stay). On keeps a non-empty trimmed program name
 * (Starlink stays). Empty / whitespace / missing / empty array fail
 * closed. A selected id stays. Distinct from Plan 207 LSP-type chips,
 * Plan 215 mapped-only, Plan 223 status chips, Plan 232 Hide no
 * provider, Plan 239 Hide no site, Plan 248 Hide no time, Plan 257 Hide
 * no vehicle, Plan 264 Hide no orbit, Plan 272 Webcast only, Plan 283
 * Hide no mission (`mission.name`), Plan 289 Hide no probability, Plan
 * 295 Hide no country, and the globe launch layer. This is
 * presence-only, not a program-name chip.
 */

export const DEFAULT_LAUNCH_LIST_HIDE_NO_PROGRAM = false;
export const LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY = 'meridian.launchListHideNoProgram';
export const LAUNCH_LIST_HIDE_NO_PROGRAM_CHIP_LABEL = 'Hide no program';
export const LAUNCH_LIST_HIDE_NO_PROGRAM_CHIP_TITLE =
  'Hide missions without a named program';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function trimmedProgramField(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && typeof value.name === 'string') {
    return value.name.trim();
  }
  if (value != null && value !== '' && !Array.isArray(value)) return String(value).trim();
  return '';
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeLaunchListHideNoProgram(value) {
  if (value == null || value === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_PROGRAM;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Read the first published program name. Prefers the copied panel
 * `program` string; otherwise walks `launch.program[]` and takes the
 * first non-empty trimmed `name`. Missing / empty array / blank name
 * collapse to ''.
 * @param {{
 *   program?: unknown
 * }|null|undefined} row
 * @returns {string}
 */
export function launchListProgramName(row) {
  const raw = row?.program;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const name = trimmedProgramField(entry);
      if (name) return name;
    }
    return '';
  }
  return trimmedProgramField(raw);
}

/**
 * Whether a panel row already has a published program name.
 * @param {{
 *   program?: unknown
 * }|null|undefined} row
 * @returns {boolean}
 */
export function launchListRowHasProgram(row) {
  return launchListProgramName(row) !== '';
}

/**
 * Whether one panel row clears Hide no program.
 * Off always passes. A selected id stays.
 * Empty / whitespace / missing / empty array fail closed when on.
 * @param {{
 *   id?: unknown,
 *   program?: unknown
 * }|null|undefined} row
 * @param {unknown} hideNoProgram
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function launchListRowMatchesProgramFilter(row, hideNoProgram, { selectedId = null } = {}) {
  if (normalizeLaunchListHideNoProgram(hideNoProgram) !== true) return true;
  const id = String(row?.id || '');
  if (selectedId && id && id === String(selectedId)) return true;
  return launchListRowHasProgram(row);
}

/**
 * Drop missing / empty-program rows when Hide no program is on. Off
 * returns a shallow copy. A published program name stays.
 * @param {Array<object>|null|undefined} rows
 * @param {unknown} [hideNoProgram=DEFAULT_LAUNCH_LIST_HIDE_NO_PROGRAM]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterLaunchListByProgram(
  rows,
  hideNoProgram = DEFAULT_LAUNCH_LIST_HIDE_NO_PROGRAM,
  selectedId = null,
) {
  if (!Array.isArray(rows)) return [];
  if (normalizeLaunchListHideNoProgram(hideNoProgram) !== true) return rows.slice();
  return rows.filter((row) => launchListRowMatchesProgramFilter(row, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_LAUNCH_LIST_HIDE_NO_PROGRAM]
 * @returns {object}
 */
export function launchListHideNoProgramChipModel(current = DEFAULT_LAUNCH_LIST_HIDE_NO_PROGRAM) {
  const hide = normalizeLaunchListHideNoProgram(current) === true;
  return {
    id: 'hide-no-program',
    label: LAUNCH_LIST_HIDE_NO_PROGRAM_CHIP_LABEL,
    title: LAUNCH_LIST_HIDE_NO_PROGRAM_CHIP_TITLE,
    active: hide,
    group: 'Program',
    params: { hideNoProgram: !hide },
  };
}

/**
 * Read `meridian.launchListHideNoProgram`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readLaunchListHideNoProgram(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_LAUNCH_LIST_HIDE_NO_PROGRAM;
    return normalizeLaunchListHideNoProgram(raw) === true;
  } catch {
    return DEFAULT_LAUNCH_LIST_HIDE_NO_PROGRAM;
  }
}

/**
 * Write `meridian.launchListHideNoProgram` as `'1'` / `'0'`.
 * @param {unknown} hideNoProgram
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeLaunchListHideNoProgram(hideNoProgram, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeLaunchListHideNoProgram(hideNoProgram);
    if (next == null) return false;
    store.setItem(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
