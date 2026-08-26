/**
 * Client-only Dated only toggle for the in-view datacenter list.
 *
 * Re-filters already-bundled OSM / ODbL `local-datacenters` list records
 * by a non-empty start_date string. Reads `record.start_date`,
 * `properties.start_date`, `tags.start_date`, or the already-registered
 * `local-datacenters:${id}` context — the same sibling-tag path Plan 206
 * uses for operator and Plan 285 uses for website. Never fetches, adds
 * no /api, and does not touch globe stems.
 *
 * Persistence is local only (`meridian.dcDatedOnly`) and is never written
 * into share URLs. LayerStateCoordinator restore is enabled-only for
 * local-datacenters; the list re-reads this key. Distinct from Plan 193
 * hide-no-operator (`meridian.datacenterHideNoOperator`), Plan 206
 * exclusive All | AWS | Equinix chips (`meridian.dcOperator`), Plan 270
 * Named only (`meridian.dcNamedOnly`), and Plan 285 Website only
 * (`meridian.dcWebsiteOnly`). AND with Plan 206, Plan 270, and Plan 285
 * happens in `listDatacentersInView`, after Website only.
 */

import { getContextStore } from './contextStore.js';

export const DEFAULT_DATACENTER_DATED_ONLY = false;
export const DATACENTER_DATED_ONLY_STORAGE_KEY = 'meridian.dcDatedOnly';
export const DATACENTER_DATED_ONLY_CHIP_LABEL = 'Dated only';
export const DATACENTER_DATED_ONLY_CHIP_TITLE =
  'Hide datacenters that have no OSM start_date';

/** @typedef {boolean} DatacenterListDatedOnly */

let sessionDatedOnly = DEFAULT_DATACENTER_DATED_ONLY;
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
 * Trim a candidate start_date. Missing / empty / whitespace collapse to null.
 * @param {unknown} value
 * @returns {string|null}
 */
function cleanStartDate(value) {
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
export function normalizeDatacenterListDatedOnly(value) {
  if (value == null || value === '') return DEFAULT_DATACENTER_DATED_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function contextDatacenterStartDate(record) {
  const recordId = record?.id;
  if (recordId == null || recordId === '') return null;
  try {
    const store = getContextStore();
    const ctx = store?.entities?.get?.(`local-datacenters:${String(recordId)}`);
    const props = ctx?.properties;
    const tags = props?.tags || {};
    return cleanStartDate(props?.start_date) || cleanStartDate(tags.start_date);
  } catch {
    // Node tests and missing window fail open to "no start_date on the record".
    return null;
  }
}

/**
 * Non-empty start_date already on a list record, its properties / tags, or
 * the already-registered `local-datacenters` entity context (same bundled
 * snapshot `getListPayload()` reads). No fetch.
 * @param {object|null|undefined} record
 * @returns {string|null}
 */
export function datacenterStartDateRaw(record) {
  if (record == null) return null;
  const fromRecord = cleanStartDate(record.start_date);
  if (fromRecord != null) return fromRecord;
  const props = record.properties;
  const fromProps = cleanStartDate(props?.start_date);
  if (fromProps != null) return fromProps;
  const tags = props?.tags || record.tags;
  const fromTags = cleanStartDate(tags?.start_date);
  if (fromTags != null) return fromTags;
  return contextDatacenterStartDate(record);
}

/**
 * Whether one in-view row already carries a non-empty start_date.
 * Missing / empty / whitespace-only fail closed.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function datacenterHasStartDate(record) {
  return datacenterStartDateRaw(record) != null;
}

/**
 * Whether one in-view row clears Dated only.
 * Off always passes. A selected id stays if the caller already ran the
 * other matchers (operator chips, Named only, Website only, view bounds,
 * visibility).
 * @param {object|null|undefined} record
 * @param {unknown} datedOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function datacenterMatchesDatedOnlyFilter(record, datedOnly, { selectedId = null } = {}) {
  if (normalizeDatacenterListDatedOnly(datedOnly) !== true) return true;
  const id = String(record?.id ?? '');
  if (selectedId && id && id === String(selectedId)) return true;
  return datacenterHasStartDate(record);
}

/**
 * Keep dated sites when Dated only is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [datedOnly=DEFAULT_DATACENTER_DATED_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterDatacentersByDatedOnly(
  records,
  datedOnly = DEFAULT_DATACENTER_DATED_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeDatacenterListDatedOnly(datedOnly) !== true) return records.slice();
  return records.filter((record) => datacenterMatchesDatedOnlyFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_DATACENTER_DATED_ONLY]
 * @returns {object}
 */
export function datacenterDatedOnlyChipModel(current = DEFAULT_DATACENTER_DATED_ONLY) {
  const only = normalizeDatacenterListDatedOnly(current) === true;
  return {
    id: 'dc-dated-only',
    label: DATACENTER_DATED_ONLY_CHIP_LABEL,
    title: DATACENTER_DATED_ONLY_CHIP_TITLE,
    active: only,
    group: 'Dated',
    params: { dcDatedOnly: !only },
  };
}

/**
 * Read `meridian.dcDatedOnly`. Missing, invalid, or corrupt storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readDatacenterListDatedOnly(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(DATACENTER_DATED_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DATACENTER_DATED_ONLY;
    return normalizeDatacenterListDatedOnly(raw) === true;
  } catch {
    return DEFAULT_DATACENTER_DATED_ONLY;
  }
}

/**
 * Write `meridian.dcDatedOnly` as `'1'` / `'0'`.
 * @param {unknown} datedOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDatacenterListDatedOnly(datedOnly, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeDatacenterListDatedOnly(datedOnly);
    if (next == null) return false;
    store.setItem(DATACENTER_DATED_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getDatacenterListDatedOnly() {
  return sessionDatedOnly;
}

/**
 * Dated only set. LayerStateCoordinator restore hydrates without rewriting.
 * @param {unknown} datedOnly
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setDatacenterListDatedOnly(datedOnly, { persist = true, storage } = {}) {
  const next = normalizeDatacenterListDatedOnly(datedOnly) === true;
  sessionDatedOnly = next;
  if (persist) writeDatacenterListDatedOnly(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateDatacenterListDatedOnly(storage) {
  return setDatacenterListDatedOnly(readDatacenterListDatedOnly(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(datedOnly: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeDatacenterListDatedOnly(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetDatacenterListDatedOnlyForTest() {
  sessionDatedOnly = DEFAULT_DATACENTER_DATED_ONLY;
}
