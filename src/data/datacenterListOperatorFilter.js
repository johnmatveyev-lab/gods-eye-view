/**
 * Client-only exclusive All | AWS | Equinix chips for the in-view
 * datacenter list.
 *
 * Matches `operator:short` or `operator` on the already-bundled OSM / ODbL
 * snapshot (case-insensitive). AWS includes Amazon Web Services. Missing
 * operator stays on All and drops on AWS / Equinix. All is the current
 * in-view list. Globe stems stay unchanged — this is the list / fly-to
 * surface only.
 *
 * Persistence is local only (`meridian.dcOperator`) and is never written
 * into share URLs. LayerStateCoordinator restore re-reads the persist key
 * on list init; local-datacenters stays enabled-only. Distinct from Plan
 * 193 hide-no-operator (`meridian.datacenterHideNoOperator`).
 */

export const DATACENTER_LIST_OPERATOR_CHIPS = Object.freeze([
  Object.freeze({
    id: 'all',
    label: 'All',
    title: 'Show every datacenter in view',
  }),
  Object.freeze({
    id: 'aws',
    label: 'AWS',
    title: 'Show Amazon Web Services datacenters',
  }),
  Object.freeze({
    id: 'equinix',
    label: 'Equinix',
    title: 'Show Equinix datacenters',
  }),
]);

export const DATACENTER_LIST_OPERATOR_CHIP_IDS = Object.freeze(
  DATACENTER_LIST_OPERATOR_CHIPS.map((chip) => chip.id),
);
export const DATACENTER_LIST_OPERATOR_STORAGE_KEY = 'meridian.dcOperator';
export const DEFAULT_DATACENTER_LIST_OPERATOR = 'all';

/** @typedef {'all'|'aws'|'equinix'} DatacenterListOperatorId */

let sessionOperator = DEFAULT_DATACENTER_LIST_OPERATOR;
const listeners = new Set();

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
 * Properties bag from a GeoJSON feature, stem record, or list payload.
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
 * Named-operator strings already on the record: `operator:short` then
 * `operator`. Live `getListPayload()` rows only have `label`, which is
 * used when those tags are absent (label copy already falls back to
 * operator on the bundled snapshot).
 * @param {object|null|undefined} input
 * @returns {string[]}
 */
export function datacenterListOperatorValues(input) {
  const props = featureProperties(input);
  const tags = props.tags && typeof props.tags === 'object' ? props.tags : {};
  const named = [
    cleanOperatorValue(tags['operator:short']),
    cleanOperatorValue(tags.operator),
    cleanOperatorValue(props['operator:short']),
    cleanOperatorValue(props.operator),
    cleanOperatorValue(input?.operatorShort),
    cleanOperatorValue(input?.operator),
  ].filter(Boolean);
  if (named.length > 0) return named;
  const label = cleanOperatorValue(input?.label);
  return label ? [label] : [];
}

/**
 * Whether the record carries a cleaned operator / operator:short tag.
 * Label-only payload rows are not "named" in this sense.
 * @param {object|null|undefined} input
 * @returns {boolean}
 */
export function datacenterListHasOperatorTag(input) {
  const props = featureProperties(input);
  const tags = props.tags && typeof props.tags === 'object' ? props.tags : {};
  return Boolean(
    cleanOperatorValue(tags['operator:short'])
    || cleanOperatorValue(tags.operator)
    || cleanOperatorValue(props['operator:short'])
    || cleanOperatorValue(props.operator)
    || cleanOperatorValue(input?.operatorShort)
    || cleanOperatorValue(input?.operator),
  );
}

/**
 * Canonical exclusive chip. Unknown values stay All so a stale preference
 * cannot invent a new fetch.
 * @param {unknown} value
 * @returns {DatacenterListOperatorId}
 */
export function normalizeDatacenterListOperator(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'aws' || text === 'amazon' || text === 'amazon web services') {
    return 'aws';
  }
  if (text === 'equinix') return 'equinix';
  if (text === 'all' || text === '0' || text === '') {
    return DEFAULT_DATACENTER_LIST_OPERATOR;
  }
  return DEFAULT_DATACENTER_LIST_OPERATOR;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function textMatchesAws(text) {
  const folded = String(text || '').trim().toLowerCase();
  if (!folded) return false;
  if (
    folded === 'aws'
    || folded === 'amazon'
    || folded === 'amazon web services'
    || folded.includes('amazon web services')
  ) {
    return true;
  }
  return /(^|[^a-z0-9])aws([^a-z0-9]|$)/.test(folded);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function textMatchesEquinix(text) {
  const folded = String(text || '').trim().toLowerCase();
  if (!folded) return false;
  if (folded === 'equinix' || folded.startsWith('equinix')) return true;
  return /(^|[^a-z0-9])equinix([^a-z0-9]|$)/.test(folded);
}

/**
 * Whether one in-view row clears the exclusive operator chips.
 * All always passes. Missing operator drops on AWS / Equinix.
 * @param {object|null|undefined} record
 * @param {unknown} operatorFilter
 * @returns {boolean}
 */
export function datacenterMatchesListOperator(record, operatorFilter) {
  const chip = normalizeDatacenterListOperator(operatorFilter);
  switch (chip) {
    case 'all':
      return true;
    case 'aws':
    case 'equinix': {
      const values = datacenterListOperatorValues(record);
      if (values.length === 0) return false;
      const match = chip === 'aws' ? textMatchesAws : textMatchesEquinix;
      return values.some(match);
    }
    default: {
      const _exhaustive = /** @type {never} */ (chip);
      void _exhaustive;
      return true;
    }
  }
}

/**
 * Keep rows for the exclusive chip. All returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [operatorFilter=DEFAULT_DATACENTER_LIST_OPERATOR]
 * @returns {Array<object>}
 */
export function filterDatacentersByListOperator(
  records,
  operatorFilter = DEFAULT_DATACENTER_LIST_OPERATOR,
) {
  if (!Array.isArray(records)) return [];
  const chip = normalizeDatacenterListOperator(operatorFilter);
  if (chip === DEFAULT_DATACENTER_LIST_OPERATOR) return records.slice();
  return records.filter((record) => datacenterMatchesListOperator(record, chip));
}

/**
 * Exclusive-chip models for the in-view list row.
 * @param {unknown} [current=DEFAULT_DATACENTER_LIST_OPERATOR]
 * @returns {Array<object>}
 */
export function datacenterListOperatorChipModels(
  current = DEFAULT_DATACENTER_LIST_OPERATOR,
) {
  const floor = normalizeDatacenterListOperator(current);
  return DATACENTER_LIST_OPERATOR_CHIPS.map((chip) => {
    switch (chip.id) {
      case 'all':
      case 'aws':
      case 'equinix':
        return {
          id: `dc-operator-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: floor === chip.id,
          group: 'Operator',
          params: { dcOperator: chip.id },
        };
      default: {
        const _exhaustive = /** @type {never} */ (chip.id);
        void _exhaustive;
        return {
          id: `dc-operator-${chip.id}`,
          label: chip.label,
          title: chip.title,
          active: false,
          group: 'Operator',
          params: { dcOperator: floor },
        };
      }
    }
  });
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {DatacenterListOperatorId}
 */
export function readDatacenterListOperator(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(DATACENTER_LIST_OPERATOR_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DATACENTER_LIST_OPERATOR;
    return normalizeDatacenterListOperator(raw);
  } catch {
    return DEFAULT_DATACENTER_LIST_OPERATOR;
  }
}

/**
 * @param {unknown} operatorFilter
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDatacenterListOperator(operatorFilter, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(
      DATACENTER_LIST_OPERATOR_STORAGE_KEY,
      normalizeDatacenterListOperator(operatorFilter),
    );
    return true;
  } catch {
    return false;
  }
}

/** @returns {DatacenterListOperatorId} */
export function getDatacenterListOperator() {
  return sessionOperator;
}

/**
 * Exclusive chip set. Clicking All, AWS, or Equinix replaces the current
 * operator. LayerStateCoordinator restore hydrates without rewriting.
 * @param {unknown} operatorFilter
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {DatacenterListOperatorId}
 */
export function setDatacenterListOperator(operatorFilter, { persist = true, storage } = {}) {
  const next = normalizeDatacenterListOperator(operatorFilter);
  sessionOperator = next;
  if (persist) writeDatacenterListOperator(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {DatacenterListOperatorId}
 */
export function hydrateDatacenterListOperator(storage) {
  return setDatacenterListOperator(readDatacenterListOperator(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(operatorFilter: DatacenterListOperatorId) => void} listener
 * @returns {() => void}
 */
export function subscribeDatacenterListOperator(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore All without clearing subscribers. */
export function resetDatacenterListOperatorForTest() {
  sessionOperator = DEFAULT_DATACENTER_LIST_OPERATOR;
}
