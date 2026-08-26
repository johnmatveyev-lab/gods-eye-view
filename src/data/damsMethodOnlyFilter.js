/**
 * Client-only dam Method only toggle for the in-view list / fly-to surface.
 *
 * Re-filters already-bundled OSM / ODbL `local-dams` list records by a
 * non-empty plant:method string. Reads `record['plant:method']`,
 * `properties['plant:method']`, `tags['plant:method']`, or the
 * already-registered `local-dams` context entity — the same sibling-tag
 * path Plan 224 uses for operator and Plan 279 uses for start_date.
 * Never fetches, adds no /api, and does not touch globe stems.
 * Persistence is local only (`meridian.damMethodOnly`). LayerStateCoordinator
 * restore re-enables `local-dams`; the list re-reads this key. The toggle
 * is not a share-URL field.
 *
 * Distinct from Plan 205 output-floor chips, Plan 218 Named only,
 * Plan 224 Operator only, Plan 229 River only, Plan 240 Wikipedia only,
 * Plan 249 Output only, and Plan 279 Dated only. AND with those happens
 * in `listDamsInView`, after Dated only.
 */

import { getContextStore } from './contextStore.js';

export const DEFAULT_DAM_METHOD_ONLY = false;
export const DAM_METHOD_ONLY_STORAGE_KEY = 'meridian.damMethodOnly';
export const DAM_METHOD_ONLY_CHIP_LABEL = 'Method only';
export const DAM_METHOD_ONLY_CHIP_TITLE =
  'Hide dams that have no OSM plant:method';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trim a candidate plant:method. Missing / whitespace collapse to null.
 * @param {unknown} value
 * @returns {string|null}
 */
function cleanPlantMethod(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeDamMethodOnly(value) {
  if (value == null || value === '') return DEFAULT_DAM_METHOD_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function contextDamPlantMethod(record) {
  const recordId = record?.id;
  if (recordId == null || recordId === '') return null;
  try {
    const store = getContextStore();
    const ctx = store?.entities?.get?.(`local-dams:${String(recordId)}`);
    const props = ctx?.properties;
    const tags = props?.tags || {};
    return cleanPlantMethod(props?.['plant:method'])
      || cleanPlantMethod(tags['plant:method']);
  } catch {
    // Node tests and missing window fail open to "no plant:method on the record".
    return null;
  }
}

/**
 * Raw plant:method already on a list record, its properties / tags, or the
 * already-registered `local-dams` entity context (same bundled snapshot
 * `getListPayload()` reads). No fetch.
 * @param {object|null|undefined} record
 * @returns {string|null}
 */
export function damPlantMethodRaw(record) {
  if (record == null) return null;
  const fromRecord = cleanPlantMethod(record['plant:method']);
  if (fromRecord != null) return fromRecord;
  const props = record.properties;
  const fromProps = cleanPlantMethod(props?.['plant:method']);
  if (fromProps != null) return fromProps;
  const tags = props?.tags || record.tags;
  const fromTags = cleanPlantMethod(tags?.['plant:method']);
  if (fromTags != null) return fromTags;
  return contextDamPlantMethod(record);
}

/**
 * Whether one in-view row already carries a non-empty plant:method.
 * Missing / empty / whitespace-only fail closed.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function damHasPlantMethod(record) {
  return damPlantMethodRaw(record) != null;
}

/**
 * Whether one in-view row clears Method only.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} methodOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function damMatchesMethodOnlyFilter(record, methodOnly, { selectedId = null } = {}) {
  if (normalizeDamMethodOnly(methodOnly) !== true) return true;
  const id = String(record?.id ?? '');
  if (selectedId && id && id === String(selectedId)) return true;
  return damHasPlantMethod(record);
}

/**
 * Keep plants with a plant:method when Method only is on. Off returns a
 * shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [methodOnly=DEFAULT_DAM_METHOD_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterDamsByMethodOnly(
  records,
  methodOnly = DEFAULT_DAM_METHOD_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeDamMethodOnly(methodOnly) !== true) return records.slice();
  return records.filter((record) => damMatchesMethodOnlyFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_DAM_METHOD_ONLY]
 * @returns {object}
 */
export function damsMethodOnlyChipModel(current = DEFAULT_DAM_METHOD_ONLY) {
  const only = normalizeDamMethodOnly(current) === true;
  return {
    id: 'method-only',
    label: DAM_METHOD_ONLY_CHIP_LABEL,
    title: DAM_METHOD_ONLY_CHIP_TITLE,
    active: only,
    group: 'Method',
    params: { methodOnly: !only },
  };
}

/**
 * Read `meridian.damMethodOnly`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readDamMethodOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(DAM_METHOD_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DAM_METHOD_ONLY;
    return normalizeDamMethodOnly(raw) === true;
  } catch {
    return DEFAULT_DAM_METHOD_ONLY;
  }
}

/**
 * Write `meridian.damMethodOnly` as `'1'` / `'0'`.
 * @param {unknown} methodOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDamMethodOnly(methodOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeDamMethodOnly(methodOnly);
    if (next == null) return false;
    store.setItem(DAM_METHOD_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
