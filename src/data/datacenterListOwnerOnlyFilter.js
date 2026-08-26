/**
 * Client-only Owner only toggle for the in-view datacenter list.
 *
 * Re-filters already-bundled OSM / ODbL `local-datacenters` list records
 * by a non-empty owner string. Reads `record.owner`,
 * `properties.owner`, `tags.owner`, or the already-registered
 * `local-datacenters:${id}` context — the same sibling-tag path Plan 206
 * uses for operator, Plan 285 uses for website, and Plan 291 uses for
 * start_date. Never fetches, adds no /api, and does not touch globe stems.
 *
 * Persistence is local only (`meridian.dcOwnerOnly`) and is never written
 * into share URLs. LayerStateCoordinator restore is enabled-only for
 * local-datacenters; the list re-reads this key. Distinct from Plan 193
 * hide-no-operator (`meridian.datacenterHideNoOperator`), Plan 206
 * exclusive All | AWS | Equinix chips (`meridian.dcOperator`), Plan 270
 * Named only (`meridian.dcNamedOnly`), Plan 285 Website only
 * (`meridian.dcWebsiteOnly`), and Plan 291 Dated only
 * (`meridian.dcDatedOnly`). AND with Plan 206, Plan 270, Plan 285, and
 * Plan 291 happens in `listDatacentersInView`, after Dated only.
 */

import { getContextStore } from './contextStore.js';

export const DEFAULT_DATACENTER_OWNER_ONLY = false;
export const DATACENTER_OWNER_ONLY_STORAGE_KEY = 'meridian.dcOwnerOnly';
export const DATACENTER_OWNER_ONLY_CHIP_LABEL = 'Owner only';
export const DATACENTER_OWNER_ONLY_CHIP_TITLE =
  'Hide datacenters that have no OSM owner';

/** @typedef {boolean} DatacenterListOwnerOnly */

let sessionOwnerOnly = DEFAULT_DATACENTER_OWNER_ONLY;
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
 * Trim a candidate owner. Missing / empty / whitespace collapse to null.
 * @param {unknown} value
 * @returns {string|null}
 */
function cleanOwner(value) {
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
export function normalizeDatacenterListOwnerOnly(value) {
  if (value == null || value === '') return DEFAULT_DATACENTER_OWNER_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function contextDatacenterOwner(record) {
  const recordId = record?.id;
  if (recordId == null || recordId === '') return null;
  try {
    const store = getContextStore();
    const ctx = store?.entities?.get?.(`local-datacenters:${String(recordId)}`);
    const props = ctx?.properties;
    const tags = props?.tags || {};
    return cleanOwner(props?.owner) || cleanOwner(tags.owner);
  } catch {
    // Node tests and missing window fail open to "no owner on the record".
    return null;
  }
}

/**
 * Non-empty owner already on a list record, its properties / tags, or
 * the already-registered `local-datacenters` entity context (same bundled
 * snapshot `getListPayload()` reads). No fetch.
 * @param {object|null|undefined} record
 * @returns {string|null}
 */
export function datacenterOwnerRaw(record) {
  if (record == null) return null;
  const fromRecord = cleanOwner(record.owner);
  if (fromRecord != null) return fromRecord;
  const props = record.properties;
  const fromProps = cleanOwner(props?.owner);
  if (fromProps != null) return fromProps;
  const tags = props?.tags || record.tags;
  const fromTags = cleanOwner(tags?.owner);
  if (fromTags != null) return fromTags;
  return contextDatacenterOwner(record);
}

/**
 * Whether one in-view row already carries a non-empty owner.
 * Missing / empty / whitespace-only fail closed.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function datacenterHasOwner(record) {
  return datacenterOwnerRaw(record) != null;
}

/**
 * Whether one in-view row clears Owner only.
 * Off always passes. A selected id stays if the caller already ran the
 * other matchers (operator chips, Named only, Website only, Dated only,
 * view bounds, visibility).
 * @param {object|null|undefined} record
 * @param {unknown} ownerOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function datacenterMatchesOwnerOnlyFilter(record, ownerOnly, { selectedId = null } = {}) {
  if (normalizeDatacenterListOwnerOnly(ownerOnly) !== true) return true;
  const id = String(record?.id ?? '');
  if (selectedId && id && id === String(selectedId)) return true;
  return datacenterHasOwner(record);
}

/**
 * Keep owned sites when Owner only is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [ownerOnly=DEFAULT_DATACENTER_OWNER_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterDatacentersByOwnerOnly(
  records,
  ownerOnly = DEFAULT_DATACENTER_OWNER_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeDatacenterListOwnerOnly(ownerOnly) !== true) return records.slice();
  return records.filter((record) => datacenterMatchesOwnerOnlyFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_DATACENTER_OWNER_ONLY]
 * @returns {object}
 */
export function datacenterOwnerOnlyChipModel(current = DEFAULT_DATACENTER_OWNER_ONLY) {
  const only = normalizeDatacenterListOwnerOnly(current) === true;
  return {
    id: 'dc-owner-only',
    label: DATACENTER_OWNER_ONLY_CHIP_LABEL,
    title: DATACENTER_OWNER_ONLY_CHIP_TITLE,
    active: only,
    group: 'Owner',
    params: { dcOwnerOnly: !only },
  };
}

/**
 * Read `meridian.dcOwnerOnly`. Missing, invalid, or corrupt storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readDatacenterListOwnerOnly(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(DATACENTER_OWNER_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DATACENTER_OWNER_ONLY;
    return normalizeDatacenterListOwnerOnly(raw) === true;
  } catch {
    return DEFAULT_DATACENTER_OWNER_ONLY;
  }
}

/**
 * Write `meridian.dcOwnerOnly` as `'1'` / `'0'`.
 * @param {unknown} ownerOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDatacenterListOwnerOnly(ownerOnly, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeDatacenterListOwnerOnly(ownerOnly);
    if (next == null) return false;
    store.setItem(DATACENTER_OWNER_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getDatacenterListOwnerOnly() {
  return sessionOwnerOnly;
}

/**
 * Owner only set. LayerStateCoordinator restore hydrates without rewriting.
 * @param {unknown} ownerOnly
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setDatacenterListOwnerOnly(ownerOnly, { persist = true, storage } = {}) {
  const next = normalizeDatacenterListOwnerOnly(ownerOnly) === true;
  sessionOwnerOnly = next;
  if (persist) writeDatacenterListOwnerOnly(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateDatacenterListOwnerOnly(storage) {
  return setDatacenterListOwnerOnly(readDatacenterListOwnerOnly(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(ownerOnly: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeDatacenterListOwnerOnly(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetDatacenterListOwnerOnlyForTest() {
  sessionOwnerOnly = DEFAULT_DATACENTER_OWNER_ONLY;
}
