/**
 * Client-only dam Wikipedia only toggle for the in-view list / fly-to surface.
 *
 * Re-filters already-bundled OSM / ODbL `local-dams` list records by a
 * non-empty wikipedia or wikidata string. Reads `record.wikipedia` /
 * `wikidata`, `properties.wikipedia` / `wikidata`, `tags.wikipedia` /
 * `wikidata`, or the already-registered `local-dams` context entity —
 * the same sibling-tag path Plan 205 uses for output, Plan 224 uses for
 * operator, and Plan 229 uses for river. Never fetches, adds no /api,
 * and does not touch globe stems.
 * Persistence is local only (`meridian.damWikiOnly`). LayerStateCoordinator
 * restore re-enables `local-dams`; the list re-reads this key. The toggle
 * is not a share-URL field.
 *
 * Distinct from Plan 205 output-floor chips, Plan 218 Named only,
 * Plan 224 Operator only, and Plan 229 River only. AND with those happens
 * in `listDamsInView`, after River only.
 */

import { getContextStore } from './contextStore.js';

export const DEFAULT_DAM_WIKI_ONLY = false;
export const DAM_WIKI_ONLY_STORAGE_KEY = 'meridian.damWikiOnly';
export const DAM_WIKI_ONLY_CHIP_LABEL = 'Wikipedia only';
export const DAM_WIKI_ONLY_CHIP_TITLE =
  'Hide dams that have no OSM Wikipedia or Wikidata page';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trim a candidate wikipedia / wikidata value. Missing / whitespace
 * collapse to null.
 * @param {unknown} value
 * @returns {string|null}
 */
function cleanWiki(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeDamWikiOnly(value) {
  if (value == null || value === '') return DEFAULT_DAM_WIKI_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function contextDamWikiField(record, key) {
  const recordId = record?.id;
  if (recordId == null || recordId === '') return null;
  try {
    const store = getContextStore();
    const ctx = store?.entities?.get?.(`local-dams:${String(recordId)}`);
    const props = ctx?.properties;
    const tags = props?.tags || {};
    return cleanWiki(props?.[key]) || cleanWiki(tags[key]);
  } catch {
    // Node tests and missing window fail open to "no wiki on the record".
    return null;
  }
}

/**
 * Non-empty wikipedia or wikidata already on a list record, its
 * properties / tags, or the already-registered `local-dams` entity
 * context (same bundled snapshot `getListPayload()` reads). No fetch.
 * @param {object|null|undefined} record
 * @param {'wikipedia'|'wikidata'} key
 * @returns {string|null}
 */
function damWikiFieldRaw(record, key) {
  if (record == null) return null;
  const fromRecord = cleanWiki(record[key]);
  if (fromRecord != null) return fromRecord;
  const props = record.properties;
  const fromProps = cleanWiki(props?.[key]);
  if (fromProps != null) return fromProps;
  const tags = props?.tags || record.tags;
  const fromTags = cleanWiki(tags?.[key]);
  if (fromTags != null) return fromTags;
  return contextDamWikiField(record, key);
}

/**
 * Raw wikipedia already on a list record, properties / tags, or context.
 * @param {object|null|undefined} record
 * @returns {string|null}
 */
export function damWikipediaRaw(record) {
  return damWikiFieldRaw(record, 'wikipedia');
}

/**
 * Raw wikidata already on a list record, properties / tags, or context.
 * @param {object|null|undefined} record
 * @returns {string|null}
 */
export function damWikidataRaw(record) {
  return damWikiFieldRaw(record, 'wikidata');
}

/**
 * First non-empty wikipedia or wikidata on the record.
 * @param {object|null|undefined} record
 * @returns {string|null}
 */
export function damWikiRaw(record) {
  return damWikipediaRaw(record) || damWikidataRaw(record);
}

/**
 * Whether one in-view row already carries a non-empty wikipedia or
 * wikidata tag. Missing / empty on both fails closed.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function damHasWiki(record) {
  return damWikiRaw(record) != null;
}

/**
 * Whether one in-view row clears Wikipedia only.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} wikiOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function damMatchesWikiFilter(record, wikiOnly, { selectedId = null } = {}) {
  if (normalizeDamWikiOnly(wikiOnly) !== true) return true;
  const id = String(record?.id ?? '');
  if (selectedId && id && id === String(selectedId)) return true;
  return damHasWiki(record);
}

/**
 * Keep plants with wikipedia or wikidata when Wikipedia only is on.
 * Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [wikiOnly=DEFAULT_DAM_WIKI_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterDamsByWikiOnly(
  records,
  wikiOnly = DEFAULT_DAM_WIKI_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeDamWikiOnly(wikiOnly) !== true) return records.slice();
  return records.filter((record) => damMatchesWikiFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_DAM_WIKI_ONLY]
 * @returns {object}
 */
export function damsWikiOnlyChipModel(current = DEFAULT_DAM_WIKI_ONLY) {
  const only = normalizeDamWikiOnly(current) === true;
  return {
    id: 'wiki-only',
    label: DAM_WIKI_ONLY_CHIP_LABEL,
    title: DAM_WIKI_ONLY_CHIP_TITLE,
    active: only,
    group: 'Wiki',
    params: { wikiOnly: !only },
  };
}

/**
 * Read `meridian.damWikiOnly`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readDamWikiOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(DAM_WIKI_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DAM_WIKI_ONLY;
    return normalizeDamWikiOnly(raw) === true;
  } catch {
    return DEFAULT_DAM_WIKI_ONLY;
  }
}

/**
 * Write `meridian.damWikiOnly` as `'1'` / `'0'`.
 * @param {unknown} wikiOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDamWikiOnly(wikiOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeDamWikiOnly(wikiOnly);
    if (next == null) return false;
    store.setItem(DAM_WIKI_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
