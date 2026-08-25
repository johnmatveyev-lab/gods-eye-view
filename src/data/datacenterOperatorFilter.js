/**
 * Client-only Hide no operator toggle for existing OSM datacenter pins.
 *
 * Uses the same cleaned operator string overlay copy already reads
 * (`tags.operator`, `props.operator`, `tags['operator:short']`).
 * Re-filters in-memory local-datacenters features. Never fetches and
 * adds no endpoint. Persistence is local only
 * (`meridian.datacenterHideNoOperator`). Dams are unchanged.
 */

export const DATACENTER_HIDE_NO_OPERATOR_STORAGE_KEY = 'meridian.datacenterHideNoOperator';
export const DATACENTER_HIDE_NO_OPERATOR_CHIP_LABEL = 'Hide no operator';
export const DATACENTER_HIDE_NO_OPERATOR_CHIP_TITLE =
  'Hide datacenters with no operator';
export const DEFAULT_DATACENTER_HIDE_NO_OPERATOR = false;

let sessionHideNoOperator = DEFAULT_DATACENTER_HIDE_NO_OPERATOR;

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Overlay-copy cleaning: missing, empty, whitespace, and the literal
 * strings `undefined` / `null` collapse to empty.
 * @param {unknown} value
 * @returns {string}
 */
function cleanOperatorValue(value) {
  const text = String(value || '').trim();
  if (!text || text === 'undefined' || text === 'null') return '';
  return text;
}

/**
 * Canonical on/off. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeDatacenterHideNoOperator(value) {
  if (value == null || value === '') return DEFAULT_DATACENTER_HIDE_NO_OPERATOR;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Properties bag from a GeoJSON feature, stem record, or unwrapped props.
 * @param {object|null|undefined} input
 * @returns {object}
 */
function featureProperties(input) {
  if (!input || typeof input !== 'object') return {};
  if (input.properties && typeof input.properties === 'object' && !input.tags) {
    return input.properties;
  }
  return input;
}

/**
 * Cleaned operator string overlay copy already uses for datacenter cards.
 * Prefer `tags.operator`, then `props.operator`, then `operator:short`.
 * Stem records that already cached that string expose it as `operator`.
 * @param {object|null|undefined} input Feature, properties, or stem record.
 * @returns {string}
 */
export function datacenterOperatorText(input) {
  const props = featureProperties(input);
  const tags = props.tags && typeof props.tags === 'object' ? props.tags : {};
  return cleanOperatorValue(tags.operator)
    || cleanOperatorValue(props.operator)
    || cleanOperatorValue(tags['operator:short']);
}

/**
 * Whether the cleaned overlay operator string is present.
 * @param {object|null|undefined} input
 * @returns {boolean}
 */
export function datacenterHasOperator(input) {
  return Boolean(datacenterOperatorText(input));
}

/**
 * Whether one in-memory datacenter clears Hide no operator.
 * Off always passes. A selected / fly-to id stays.
 * @param {object|null|undefined} record
 * @param {unknown} hideNoOperator
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function datacenterPassesOperatorFilter(record, hideNoOperator, { selectedId = null } = {}) {
  const id = String(record?.id ?? '');
  if (selectedId && id && id === String(selectedId)) return true;
  if (normalizeDatacenterHideNoOperator(hideNoOperator) !== true) return true;
  return datacenterHasOperator(record);
}

/**
 * Keep named-operator pins when Hide no operator is on. Off returns a
 * shallow copy so the current view is unchanged.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [hideNoOperator=DEFAULT_DATACENTER_HIDE_NO_OPERATOR]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterDatacentersByOperator(
  records,
  hideNoOperator = DEFAULT_DATACENTER_HIDE_NO_OPERATOR,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeDatacenterHideNoOperator(hideNoOperator) !== true) return records.slice();
  return records.filter((record) => (
    datacenterPassesOperatorFilter(record, true, { selectedId })
  ));
}

/**
 * Data-row chip model. Params carry the flipped boolean.
 * @param {unknown} [current=DEFAULT_DATACENTER_HIDE_NO_OPERATOR]
 * @returns {object}
 */
export function datacenterHideNoOperatorChipModel(
  current = DEFAULT_DATACENTER_HIDE_NO_OPERATOR,
) {
  const hide = normalizeDatacenterHideNoOperator(current) === true;
  return {
    id: 'hide-no-operator',
    label: DATACENTER_HIDE_NO_OPERATOR_CHIP_LABEL,
    title: DATACENTER_HIDE_NO_OPERATOR_CHIP_TITLE,
    active: hide,
    group: 'Operator',
    params: { hideNoOperator: !hide },
  };
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readDatacenterHideNoOperator(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(DATACENTER_HIDE_NO_OPERATOR_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DATACENTER_HIDE_NO_OPERATOR;
    return normalizeDatacenterHideNoOperator(raw) === true;
  } catch {
    return DEFAULT_DATACENTER_HIDE_NO_OPERATOR;
  }
}

/**
 * @param {unknown} hideNoOperator
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDatacenterHideNoOperator(hideNoOperator, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      DATACENTER_HIDE_NO_OPERATOR_STORAGE_KEY,
      normalizeDatacenterHideNoOperator(hideNoOperator) === true ? '1' : '0',
    );
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getDatacenterHideNoOperator() {
  return sessionHideNoOperator;
}

/**
 * @param {unknown} hideNoOperator
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setDatacenterHideNoOperator(hideNoOperator, { persist = true, storage } = {}) {
  const next = normalizeDatacenterHideNoOperator(hideNoOperator) === true;
  sessionHideNoOperator = next;
  if (persist) writeDatacenterHideNoOperator(next, storage);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateDatacenterHideNoOperator(storage) {
  return setDatacenterHideNoOperator(readDatacenterHideNoOperator(storage), {
    persist: false,
    storage,
  });
}

/** Test-only: restore off. */
export function resetDatacenterHideNoOperatorForTest() {
  sessionHideNoOperator = DEFAULT_DATACENTER_HIDE_NO_OPERATOR;
}
