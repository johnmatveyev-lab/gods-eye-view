/**
 * Client-only Ref only toggle for the in-view datacenter list.
 *
 * Re-filters already-bundled OSM / ODbL `local-datacenters` list records
 * by a non-empty ref string. Reads `record.ref`,
 * `properties.ref`, `tags.ref`, or the already-registered
 * `local-datacenters:${id}` context — the same sibling-tag path Plan 206
 * uses for operator, Plan 285 uses for website, Plan 291 uses for
 * start_date, and Plan 301 uses for owner. Never fetches, adds no /api,
 * and does not touch globe stems.
 *
 * Persistence is local only (`meridian.dcRefOnly`) and is never written
 * into share URLs. LayerStateCoordinator restore is enabled-only for
 * local-datacenters; the list re-reads this key. Distinct from Plan 193
 * hide-no-operator (`meridian.datacenterHideNoOperator`), Plan 206
 * exclusive All | AWS | Equinix chips (`meridian.dcOperator`), Plan 270
 * Named only (`meridian.dcNamedOnly`), Plan 285 Website only
 * (`meridian.dcWebsiteOnly`), Plan 291 Dated only
 * (`meridian.dcDatedOnly`), and Plan 301 Owner only
 * (`meridian.dcOwnerOnly`). AND with Plan 206, Plan 270, Plan 285,
 * Plan 291, and Plan 301 happens in `listDatacentersInView`, after
 * Owner only.
 */

import { getContextStore } from './contextStore.js';

export const DEFAULT_DATACENTER_REF_ONLY = false;
export const DATACENTER_REF_ONLY_STORAGE_KEY = 'meridian.dcRefOnly';
export const DATACENTER_REF_ONLY_CHIP_LABEL = 'Ref only';
export const DATACENTER_REF_ONLY_CHIP_TITLE =
  'Hide datacenters that have no OSM ref';

/** @typedef {boolean} DatacenterListRefOnly */

let sessionRefOnly = DEFAULT_DATACENTER_REF_ONLY;
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
 * Trim a candidate ref. Missing / empty / whitespace collapse to null.
 * @param {unknown} value
 * @returns {string|null}
 */
function cleanRef(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text === 'undefined' || text === 'null') return null;
  return text;
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeDatacenterListRefOnly(value) {
  if (value == null || value === '') return DEFAULT_DATACENTER_REF_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function contextDatacenterRef(record) {
  const recordId = record?.id;
  if (recordId == null || recordId === '') return null;
  try {
    const store = getContextStore();
    const ctx = store?.entities?.get?.(`local-datacenters:${String(recordId)}`);
    const props = ctx?.properties;
    const tags = props?.tags || {};
    return cleanRef(props?.ref) || cleanRef(tags.ref);
  } catch {
    // Node tests and missing window fail open to "no ref on the record".
    return null;
  }
}

/**
 * Non-empty ref already on a list record, its properties / tags, or
 * the already-registered `local-datacenters` entity context (same bundled
 * snapshot `getListPayload()` reads). No fetch.
 * @param {object|null|undefined} record
 * @returns {string|null}
 */
export function datacenterRefRaw(record) {
  if (record == null) return null;
  const fromRecord = cleanRef(record.ref);
  if (fromRecord != null) return fromRecord;
  const props = record.properties;
  const fromProps = cleanRef(props?.ref);
  if (fromProps != null) return fromProps;
  const tags = props?.tags || record.tags;
  const fromTags = cleanRef(tags?.ref);
  if (fromTags != null) return fromTags;
  return contextDatacenterRef(record);
}

/**
 * Whether one in-view row already carries a non-empty ref.
 * Missing / empty / whitespace-only fail closed.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function datacenterHasRef(record) {
  return datacenterRefRaw(record) != null;
}

/**
 * Whether one in-view row clears Ref only.
 * Off always passes. A selected id stays if the caller already ran the
 * other matchers (operator chips, Named only, Website only, Dated only,
 * Owner only, view bounds, visibility).
 * @param {object|null|undefined} record
 * @param {unknown} refOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function datacenterMatchesRefOnlyFilter(record, refOnly, { selectedId = null } = {}) {
  if (normalizeDatacenterListRefOnly(refOnly) !== true) return true;
  const id = String(record?.id ?? '');
  if (selectedId && id && id === String(selectedId)) return true;
  return datacenterHasRef(record);
}

/**
 * Keep referenced sites when Ref only is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [refOnly=DEFAULT_DATACENTER_REF_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterDatacentersByRefOnly(
  records,
  refOnly = DEFAULT_DATACENTER_REF_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeDatacenterListRefOnly(refOnly) !== true) return records.slice();
  return records.filter((record) => datacenterMatchesRefOnlyFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_DATACENTER_REF_ONLY]
 * @returns {object}
 */
export function datacenterRefOnlyChipModel(current = DEFAULT_DATACENTER_REF_ONLY) {
  const only = normalizeDatacenterListRefOnly(current) === true;
  return {
    id: 'dc-ref-only',
    label: DATACENTER_REF_ONLY_CHIP_LABEL,
    title: DATACENTER_REF_ONLY_CHIP_TITLE,
    active: only,
    group: 'Ref',
    params: { dcRefOnly: !only },
  };
}

/**
 * Read `meridian.dcRefOnly`. Missing, invalid, or corrupt storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readDatacenterListRefOnly(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(DATACENTER_REF_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DATACENTER_REF_ONLY;
    return normalizeDatacenterListRefOnly(raw) === true;
  } catch {
    return DEFAULT_DATACENTER_REF_ONLY;
  }
}

/**
 * Write `meridian.dcRefOnly` as `'1'` / `'0'`.
 * @param {unknown} refOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDatacenterListRefOnly(refOnly, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeDatacenterListRefOnly(refOnly);
    if (next == null) return false;
    store.setItem(DATACENTER_REF_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getDatacenterListRefOnly() {
  return sessionRefOnly;
}

/**
 * Ref only set. LayerStateCoordinator restore hydrates without rewriting.
 * @param {unknown} refOnly
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setDatacenterListRefOnly(refOnly, { persist = true, storage } = {}) {
  const next = normalizeDatacenterListRefOnly(refOnly) === true;
  sessionRefOnly = next;
  if (persist) writeDatacenterListRefOnly(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateDatacenterListRefOnly(storage) {
  return setDatacenterListRefOnly(readDatacenterListRefOnly(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(refOnly: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeDatacenterListRefOnly(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetDatacenterListRefOnlyForTest() {
  sessionRefOnly = DEFAULT_DATACENTER_REF_ONLY;
}
