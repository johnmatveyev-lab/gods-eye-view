/**
 * Client-only dam Website only toggle for the in-view list / fly-to surface.
 *
 * Re-filters already-bundled OSM / ODbL `local-dams` list records by a
 * non-empty website string. Reads `record.website`, `properties.website`,
 * `tags.website`, `contact:website`, or the already-registered
 * `local-dams` context entity — the same sibling-tag path Plan 224 uses
 * for operator and Plan 287 uses for plant:method. Never fetches, adds
 * no /api, and does not touch globe stems.
 * Persistence is local only (`meridian.damWebsiteOnly`). LayerStateCoordinator
 * restore re-enables `local-dams`; the list re-reads this key. The toggle
 * is not a share-URL field.
 *
 * Distinct from Plan 205 output-floor chips, Plan 218 Named only,
 * Plan 224 Operator only, Plan 229 River only, Plan 240 Wikipedia only,
 * Plan 249 Output only, Plan 279 Dated only, Plan 287 Method only, and
 * datacenter Plan 285 Website only. AND with those dam chips happens
 * in `listDamsInView`, after Method only.
 */

import { getContextStore } from './contextStore.js';

export const DEFAULT_DAM_WEBSITE_ONLY = false;
export const DAM_WEBSITE_ONLY_STORAGE_KEY = 'meridian.damWebsiteOnly';
export const DAM_WEBSITE_ONLY_CHIP_LABEL = 'Website only';
export const DAM_WEBSITE_ONLY_CHIP_TITLE =
  'Hide dams that have no OSM website';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trim a candidate website. Missing / whitespace collapse to null.
 * @param {unknown} value
 * @returns {string|null}
 */
function cleanWebsite(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * First non-empty website or contact:website on one bag.
 * @param {object|null|undefined} bag
 * @returns {string|null}
 */
function websiteFromBag(bag) {
  if (bag == null || typeof bag !== 'object') return null;
  return cleanWebsite(bag.website) || cleanWebsite(bag['contact:website']);
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeDamWebsiteOnly(value) {
  if (value == null || value === '') return DEFAULT_DAM_WEBSITE_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function contextDamWebsite(record) {
  const recordId = record?.id;
  if (recordId == null || recordId === '') return null;
  try {
    const store = getContextStore();
    const ctx = store?.entities?.get?.(`local-dams:${String(recordId)}`);
    const props = ctx?.properties;
    const tags = props?.tags || {};
    return websiteFromBag(props) || websiteFromBag(tags);
  } catch {
    // Node tests and missing window fail open to "no website on the record".
    return null;
  }
}

/**
 * Raw website already on a list record, its properties / tags
 * (`website` or `contact:website`), or the already-registered
 * `local-dams` entity context (same bundled snapshot
 * `getListPayload()` reads). No fetch.
 * @param {object|null|undefined} record
 * @returns {string|null}
 */
export function damWebsiteRaw(record) {
  if (record == null) return null;
  const fromRecord = websiteFromBag(record);
  if (fromRecord != null) return fromRecord;
  const props = record.properties;
  const fromProps = websiteFromBag(props);
  if (fromProps != null) return fromProps;
  const tags = props?.tags || record.tags;
  const fromTags = websiteFromBag(tags);
  if (fromTags != null) return fromTags;
  return contextDamWebsite(record);
}

/**
 * Whether one in-view row already carries a non-empty website.
 * Missing / empty / whitespace-only fail closed.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function damHasWebsite(record) {
  return damWebsiteRaw(record) != null;
}

/**
 * Whether one in-view row clears Website only.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} websiteOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function damMatchesWebsiteFilter(record, websiteOnly, { selectedId = null } = {}) {
  if (normalizeDamWebsiteOnly(websiteOnly) !== true) return true;
  const id = String(record?.id ?? '');
  if (selectedId && id && id === String(selectedId)) return true;
  return damHasWebsite(record);
}

/**
 * Keep plants with a website when Website only is on. Off returns a
 * shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [websiteOnly=DEFAULT_DAM_WEBSITE_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterDamsByWebsiteOnly(
  records,
  websiteOnly = DEFAULT_DAM_WEBSITE_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeDamWebsiteOnly(websiteOnly) !== true) return records.slice();
  return records.filter((record) => damMatchesWebsiteFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_DAM_WEBSITE_ONLY]
 * @returns {object}
 */
export function damsWebsiteOnlyChipModel(current = DEFAULT_DAM_WEBSITE_ONLY) {
  const only = normalizeDamWebsiteOnly(current) === true;
  return {
    id: 'website-only',
    label: DAM_WEBSITE_ONLY_CHIP_LABEL,
    title: DAM_WEBSITE_ONLY_CHIP_TITLE,
    active: only,
    group: 'Website',
    params: { websiteOnly: !only },
  };
}

/**
 * Read `meridian.damWebsiteOnly`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readDamWebsiteOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(DAM_WEBSITE_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DAM_WEBSITE_ONLY;
    return normalizeDamWebsiteOnly(raw) === true;
  } catch {
    return DEFAULT_DAM_WEBSITE_ONLY;
  }
}

/**
 * Write `meridian.damWebsiteOnly` as `'1'` / `'0'`.
 * @param {unknown} websiteOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDamWebsiteOnly(websiteOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeDamWebsiteOnly(websiteOnly);
    if (next == null) return false;
    store.setItem(DAM_WEBSITE_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
