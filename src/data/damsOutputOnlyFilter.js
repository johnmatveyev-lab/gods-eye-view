/**
 * Client-only dam Output only toggle for the in-view list / fly-to surface.
 *
 * Re-filters already-bundled OSM / ODbL `local-dams` list records by a
 * parseable MW plant output. Reads the same raw fields Plan 205 uses:
 * `record.output`, `properties.output`, `tags['plant:output:electricity']`,
 * or the already-registered `local-dams` context entity. Never fetches,
 * adds no /api, and does not touch globe stems.
 * Persistence is local only (`meridian.damOutputOnly`). LayerStateCoordinator
 * restore re-enables `local-dams`; the list re-reads this key. The toggle
 * is not a share-URL field.
 *
 * Distinct from Plan 205 output-floor chips (which fail open when output
 * is missing), Plan 218 Named only, Plan 224 Operator only, Plan 229
 * River only, and Plan 240 Wikipedia only. AND with those happens in
 * `listDamsInView`, after Wikipedia only.
 */

import { damOutputRaw, parseDamOutputMw } from './damsOutputFilter.js';

export const DEFAULT_DAM_OUTPUT_ONLY = false;
export const DAM_OUTPUT_ONLY_STORAGE_KEY = 'meridian.damOutputOnly';
export const DAM_OUTPUT_ONLY_CHIP_LABEL = 'Output only';
export const DAM_OUTPUT_ONLY_CHIP_TITLE =
  'Hide dams that have no parseable plant output';

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
export function normalizeDamOutputOnly(value) {
  if (value == null || value === '') return DEFAULT_DAM_OUTPUT_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Whether one in-view row already carries a parseable MW output on the
 * same raw fields Plan 205 reads. Missing / empty / unparseable fails
 * closed.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function damHasParseableOutput(record) {
  return parseDamOutputMw(damOutputRaw(record)) != null;
}

/**
 * Whether one in-view row clears Output only.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} outputOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function damMatchesOutputOnlyFilter(record, outputOnly, { selectedId = null } = {}) {
  if (normalizeDamOutputOnly(outputOnly) !== true) return true;
  const id = String(record?.id ?? '');
  if (selectedId && id && id === String(selectedId)) return true;
  return damHasParseableOutput(record);
}

/**
 * Keep plants with a parseable MW output when Output only is on.
 * Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [outputOnly=DEFAULT_DAM_OUTPUT_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterDamsByOutputOnly(
  records,
  outputOnly = DEFAULT_DAM_OUTPUT_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeDamOutputOnly(outputOnly) !== true) return records.slice();
  return records.filter((record) => damMatchesOutputOnlyFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_DAM_OUTPUT_ONLY]
 * @returns {object}
 */
export function damsOutputOnlyChipModel(current = DEFAULT_DAM_OUTPUT_ONLY) {
  const only = normalizeDamOutputOnly(current) === true;
  return {
    id: 'output-only',
    label: DAM_OUTPUT_ONLY_CHIP_LABEL,
    title: DAM_OUTPUT_ONLY_CHIP_TITLE,
    active: only,
    group: 'Output only',
    params: { outputOnly: !only },
  };
}

/**
 * Read `meridian.damOutputOnly`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readDamOutputOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(DAM_OUTPUT_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DAM_OUTPUT_ONLY;
    return normalizeDamOutputOnly(raw) === true;
  } catch {
    return DEFAULT_DAM_OUTPUT_ONLY;
  }
}

/**
 * Write `meridian.damOutputOnly` as `'1'` / `'0'`.
 * @param {unknown} outputOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDamOutputOnly(outputOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeDamOutputOnly(outputOnly);
    if (next == null) return false;
    store.setItem(DAM_OUTPUT_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
