/**
 * Client-only dam Dated only toggle for the in-view list / fly-to surface.
 *
 * Re-filters already-bundled OSM / ODbL `local-dams` list records by a
 * non-empty start_date string. Reads `record.start_date`,
 * `properties.start_date`, `tags.start_date`, or the already-registered
 * `local-dams` context entity — the same sibling-tag path Plan 205 uses
 * for output and Plan 224 uses for operator. Never fetches, adds no /api,
 * and does not touch globe stems.
 * Persistence is local only (`meridian.damDatedOnly`). LayerStateCoordinator
 * restore re-enables `local-dams`; the list re-reads this key. The toggle
 * is not a share-URL field.
 *
 * Distinct from Plan 205 output-floor chips, Plan 218 Named only,
 * Plan 224 Operator only, Plan 229 River only, Plan 240 Wikipedia only,
 * and Plan 249 Output only. AND with those happens in `listDamsInView`,
 * after Output only.
 */

import { getContextStore } from './contextStore.js';

export const DEFAULT_DAM_DATED_ONLY = false;
export const DAM_DATED_ONLY_STORAGE_KEY = 'meridian.damDatedOnly';
export const DAM_DATED_ONLY_CHIP_LABEL = 'Dated only';
export const DAM_DATED_ONLY_CHIP_TITLE =
  'Hide dams that have no OSM start_date';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trim a candidate start_date. Missing / whitespace collapse to null.
 * @param {unknown} value
 * @returns {string|null}
 */
function cleanStartDate(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeDamDatedOnly(value) {
  if (value == null || value === '') return DEFAULT_DAM_DATED_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function contextDamStartDate(record) {
  const recordId = record?.id;
  if (recordId == null || recordId === '') return null;
  try {
    const store = getContextStore();
    const ctx = store?.entities?.get?.(`local-dams:${String(recordId)}`);
    const props = ctx?.properties;
    const tags = props?.tags || {};
    return cleanStartDate(props?.start_date) || cleanStartDate(tags.start_date);
  } catch {
    // Node tests and missing window fail open to "no start_date on the record".
    return null;
  }
}

/**
 * Raw start_date already on a list record, its properties / tags, or the
 * already-registered `local-dams` entity context (same bundled snapshot
 * `getListPayload()` reads). No fetch.
 * @param {object|null|undefined} record
 * @returns {string|null}
 */
export function damStartDateRaw(record) {
  if (record == null) return null;
  const fromRecord = cleanStartDate(record.start_date);
  if (fromRecord != null) return fromRecord;
  const props = record.properties;
  const fromProps = cleanStartDate(props?.start_date);
  if (fromProps != null) return fromProps;
  const tags = props?.tags || record.tags;
  const fromTags = cleanStartDate(tags?.start_date);
  if (fromTags != null) return fromTags;
  return contextDamStartDate(record);
}

/**
 * Whether one in-view row already carries a non-empty start_date.
 * Missing / empty / whitespace-only fail closed.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function damHasStartDate(record) {
  return damStartDateRaw(record) != null;
}

/**
 * Whether one in-view row clears Dated only.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} datedOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function damMatchesDatedOnlyFilter(record, datedOnly, { selectedId = null } = {}) {
  if (normalizeDamDatedOnly(datedOnly) !== true) return true;
  const id = String(record?.id ?? '');
  if (selectedId && id && id === String(selectedId)) return true;
  return damHasStartDate(record);
}

/**
 * Keep plants with a start_date when Dated only is on. Off returns a
 * shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [datedOnly=DEFAULT_DAM_DATED_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterDamsByDatedOnly(
  records,
  datedOnly = DEFAULT_DAM_DATED_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeDamDatedOnly(datedOnly) !== true) return records.slice();
  return records.filter((record) => damMatchesDatedOnlyFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_DAM_DATED_ONLY]
 * @returns {object}
 */
export function damsDatedOnlyChipModel(current = DEFAULT_DAM_DATED_ONLY) {
  const only = normalizeDamDatedOnly(current) === true;
  return {
    id: 'dated-only',
    label: DAM_DATED_ONLY_CHIP_LABEL,
    title: DAM_DATED_ONLY_CHIP_TITLE,
    active: only,
    group: 'Dated',
    params: { datedOnly: !only },
  };
}

/**
 * Read `meridian.damDatedOnly`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readDamDatedOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(DAM_DATED_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DAM_DATED_ONLY;
    return normalizeDamDatedOnly(raw) === true;
  } catch {
    return DEFAULT_DAM_DATED_ONLY;
  }
}

/**
 * Write `meridian.damDatedOnly` as `'1'` / `'0'`.
 * @param {unknown} datedOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDamDatedOnly(datedOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeDamDatedOnly(datedOnly);
    if (next == null) return false;
    store.setItem(DAM_DATED_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
