/**
 * Client-only dam Operator only toggle for the in-view list / fly-to surface.
 *
 * Re-filters already-bundled OSM / ODbL `local-dams` list records by a
 * non-empty operator string. Reads `record.operator`, `properties.operator`,
 * `tags.operator`, `tags['operator:short']`, or the already-registered
 * `local-dams` context entity — the same sibling-tag path Plan 205 uses
 * for output. Never fetches, adds no /api, and does not touch globe stems.
 * Persistence is local only (`meridian.damOperatorOnly`). LayerStateCoordinator
 * restore re-enables `local-dams`; the list re-reads this key. The toggle
 * is not a share-URL field.
 *
 * Distinct from Plan 205 output-floor chips and Plan 218 Named only.
 * AND with both happens in `listDamsInView`, after Named only.
 */

import { getContextStore } from './contextStore.js';

export const DEFAULT_DAM_OPERATOR_ONLY = false;
export const DAM_OPERATOR_ONLY_STORAGE_KEY = 'meridian.damOperatorOnly';
export const DAM_OPERATOR_ONLY_CHIP_LABEL = 'Operator only';
export const DAM_OPERATOR_ONLY_CHIP_TITLE =
  'Hide dams that have no OSM operator';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trim a candidate operator. Missing / whitespace collapse to null.
 * @param {unknown} value
 * @returns {string|null}
 */
function cleanOperator(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeDamOperatorOnly(value) {
  if (value == null || value === '') return DEFAULT_DAM_OPERATOR_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function contextDamOperator(record) {
  const recordId = record?.id;
  if (recordId == null || recordId === '') return null;
  try {
    const store = getContextStore();
    const ctx = store?.entities?.get?.(`local-dams:${String(recordId)}`);
    const props = ctx?.properties;
    const tags = props?.tags || {};
    return cleanOperator(props?.operator)
      || cleanOperator(tags.operator)
      || cleanOperator(tags['operator:short']);
  } catch {
    // Node tests and missing window fail open to "no operator on the record".
    return null;
  }
}

/**
 * Raw operator already on a list record, its properties / tags, or the
 * already-registered `local-dams` entity context (same bundled snapshot
 * `getListPayload()` reads). No fetch.
 * @param {object|null|undefined} record
 * @returns {string|null}
 */
export function damOperatorRaw(record) {
  if (record == null) return null;
  const fromRecord = cleanOperator(record.operator);
  if (fromRecord != null) return fromRecord;
  const props = record.properties;
  const fromProps = cleanOperator(props?.operator);
  if (fromProps != null) return fromProps;
  const tags = props?.tags || record.tags;
  const fromTags = cleanOperator(tags?.operator) || cleanOperator(tags?.['operator:short']);
  if (fromTags != null) return fromTags;
  return contextDamOperator(record);
}

/**
 * Whether one in-view row already carries a non-empty operator.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function damHasOperator(record) {
  return damOperatorRaw(record) != null;
}

/**
 * Whether one in-view row clears Operator only.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} operatorOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function damMatchesOperatorFilter(record, operatorOnly, { selectedId = null } = {}) {
  if (normalizeDamOperatorOnly(operatorOnly) !== true) return true;
  const id = String(record?.id ?? '');
  if (selectedId && id && id === String(selectedId)) return true;
  return damHasOperator(record);
}

/**
 * Keep plants with an operator when Operator only is on. Off returns a
 * shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [operatorOnly=DEFAULT_DAM_OPERATOR_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterDamsByOperatorOnly(
  records,
  operatorOnly = DEFAULT_DAM_OPERATOR_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeDamOperatorOnly(operatorOnly) !== true) return records.slice();
  return records.filter((record) => damMatchesOperatorFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_DAM_OPERATOR_ONLY]
 * @returns {object}
 */
export function damsOperatorOnlyChipModel(current = DEFAULT_DAM_OPERATOR_ONLY) {
  const only = normalizeDamOperatorOnly(current) === true;
  return {
    id: 'operator-only',
    label: DAM_OPERATOR_ONLY_CHIP_LABEL,
    title: DAM_OPERATOR_ONLY_CHIP_TITLE,
    active: only,
    group: 'Operator',
    params: { operatorOnly: !only },
  };
}

/**
 * Read `meridian.damOperatorOnly`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readDamOperatorOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(DAM_OPERATOR_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DAM_OPERATOR_ONLY;
    return normalizeDamOperatorOnly(raw) === true;
  } catch {
    return DEFAULT_DAM_OPERATOR_ONLY;
  }
}

/**
 * Write `meridian.damOperatorOnly` as `'1'` / `'0'`.
 * @param {unknown} operatorOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDamOperatorOnly(operatorOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeDamOperatorOnly(operatorOnly);
    if (next == null) return false;
    store.setItem(DAM_OPERATOR_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
