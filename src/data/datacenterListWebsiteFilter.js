/**
 * Client-only Website only toggle for the in-view datacenter list.
 *
 * Re-filters already-bundled OSM / ODbL `local-datacenters` list records
 * by a non-empty website string. Reads `record.website`,
 * `properties.website`, `tags.website`, or the already-registered
 * `local-datacenters:${id}` context — the same sibling-tag path Plan 206
 * uses for operator. Never fetches, adds no /api, and does not touch
 * globe stems.
 *
 * Persistence is local only (`meridian.dcWebsiteOnly`) and is never written
 * into share URLs. LayerStateCoordinator restore is enabled-only for
 * local-datacenters; the list re-reads this key. Distinct from Plan 193
 * hide-no-operator (`meridian.datacenterHideNoOperator`), Plan 206
 * exclusive All | AWS | Equinix chips (`meridian.dcOperator`), and Plan
 * 270 Named only (`meridian.dcNamedOnly`). AND with Plan 206 and Plan 270
 * happens in `listDatacentersInView`, after Named only.
 */

import { getContextStore } from './contextStore.js';

export const DEFAULT_DATACENTER_WEBSITE_ONLY = false;
export const DATACENTER_WEBSITE_ONLY_STORAGE_KEY = 'meridian.dcWebsiteOnly';
export const DATACENTER_WEBSITE_ONLY_CHIP_LABEL = 'Website only';
export const DATACENTER_WEBSITE_ONLY_CHIP_TITLE =
  'Hide datacenters that have no OSM website';

/** @typedef {boolean} DatacenterListWebsiteOnly */

let sessionWebsiteOnly = DEFAULT_DATACENTER_WEBSITE_ONLY;
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
 * Trim a candidate website. Missing / empty / whitespace collapse to null.
 * @param {unknown} value
 * @returns {string|null}
 */
function cleanWebsite(value) {
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
export function normalizeDatacenterListWebsiteOnly(value) {
  if (value == null || value === '') return DEFAULT_DATACENTER_WEBSITE_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function contextDatacenterWebsite(record) {
  const recordId = record?.id;
  if (recordId == null || recordId === '') return null;
  try {
    const store = getContextStore();
    const ctx = store?.entities?.get?.(`local-datacenters:${String(recordId)}`);
    const props = ctx?.properties;
    const tags = props?.tags || {};
    return cleanWebsite(props?.website) || cleanWebsite(tags.website);
  } catch {
    // Node tests and missing window fail open to "no website on the record".
    return null;
  }
}

/**
 * Non-empty website already on a list record, its properties / tags, or
 * the already-registered `local-datacenters` entity context (same bundled
 * snapshot `getListPayload()` reads). No fetch.
 * @param {object|null|undefined} record
 * @returns {string|null}
 */
export function datacenterWebsiteRaw(record) {
  if (record == null) return null;
  const fromRecord = cleanWebsite(record.website);
  if (fromRecord != null) return fromRecord;
  const props = record.properties;
  const fromProps = cleanWebsite(props?.website);
  if (fromProps != null) return fromProps;
  const tags = props?.tags || record.tags;
  const fromTags = cleanWebsite(tags?.website);
  if (fromTags != null) return fromTags;
  return contextDatacenterWebsite(record);
}

/**
 * Whether one in-view row already carries a non-empty website.
 * Missing / empty / whitespace fails closed.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function datacenterHasWebsite(record) {
  return datacenterWebsiteRaw(record) != null;
}

/**
 * Whether one in-view row clears Website only.
 * Off always passes. A selected id stays if the caller already ran the
 * other matchers (operator chips, Named only, view bounds, visibility).
 * @param {object|null|undefined} record
 * @param {unknown} websiteOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function datacenterMatchesWebsiteFilter(record, websiteOnly, { selectedId = null } = {}) {
  if (normalizeDatacenterListWebsiteOnly(websiteOnly) !== true) return true;
  const id = String(record?.id ?? '');
  if (selectedId && id && id === String(selectedId)) return true;
  return datacenterHasWebsite(record);
}

/**
 * Keep tagged sites when Website only is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [websiteOnly=DEFAULT_DATACENTER_WEBSITE_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterDatacentersByWebsiteOnly(
  records,
  websiteOnly = DEFAULT_DATACENTER_WEBSITE_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeDatacenterListWebsiteOnly(websiteOnly) !== true) return records.slice();
  return records.filter((record) => datacenterMatchesWebsiteFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_DATACENTER_WEBSITE_ONLY]
 * @returns {object}
 */
export function datacenterWebsiteOnlyChipModel(current = DEFAULT_DATACENTER_WEBSITE_ONLY) {
  const only = normalizeDatacenterListWebsiteOnly(current) === true;
  return {
    id: 'dc-website-only',
    label: DATACENTER_WEBSITE_ONLY_CHIP_LABEL,
    title: DATACENTER_WEBSITE_ONLY_CHIP_TITLE,
    active: only,
    group: 'Website',
    params: { dcWebsiteOnly: !only },
  };
}

/**
 * Read `meridian.dcWebsiteOnly`. Missing, invalid, or corrupt storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readDatacenterListWebsiteOnly(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(DATACENTER_WEBSITE_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DATACENTER_WEBSITE_ONLY;
    return normalizeDatacenterListWebsiteOnly(raw) === true;
  } catch {
    return DEFAULT_DATACENTER_WEBSITE_ONLY;
  }
}

/**
 * Write `meridian.dcWebsiteOnly` as `'1'` / `'0'`.
 * @param {unknown} websiteOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDatacenterListWebsiteOnly(websiteOnly, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeDatacenterListWebsiteOnly(websiteOnly);
    if (next == null) return false;
    store.setItem(DATACENTER_WEBSITE_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getDatacenterListWebsiteOnly() {
  return sessionWebsiteOnly;
}

/**
 * Website only set. LayerStateCoordinator restore hydrates without rewriting.
 * @param {unknown} websiteOnly
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setDatacenterListWebsiteOnly(websiteOnly, { persist = true, storage } = {}) {
  const next = normalizeDatacenterListWebsiteOnly(websiteOnly) === true;
  sessionWebsiteOnly = next;
  if (persist) writeDatacenterListWebsiteOnly(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateDatacenterListWebsiteOnly(storage) {
  return setDatacenterListWebsiteOnly(readDatacenterListWebsiteOnly(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(websiteOnly: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeDatacenterListWebsiteOnly(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetDatacenterListWebsiteOnlyForTest() {
  sessionWebsiteOnly = DEFAULT_DATACENTER_WEBSITE_ONLY;
}
