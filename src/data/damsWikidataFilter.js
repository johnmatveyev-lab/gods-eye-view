/**
 * Client-only dam Wikidata only toggle for the in-view list / fly-to surface.
 *
 * Re-filters already-bundled OSM / ODbL `local-dams` list records by a
 * non-empty wikidata Q-id. Reads `record.wikidata`, `properties.wikidata`,
 * `tags.wikidata`, or the already-registered `local-dams` context entity —
 * the same sibling-tag path Plan 240 uses for wikipedia / wikidata and
 * Plan 297 uses for website. Never fetches, adds no /api, and does not
 * touch globe stems.
 * Persistence is local only (`meridian.damWikidataOnly`). LayerStateCoordinator
 * restore re-enables `local-dams`; the list re-reads this key. The toggle
 * is not a share-URL field.
 *
 * Distinct from Plan 205 output-floor chips, Plan 218 Named only,
 * Plan 224 Operator only, Plan 229 River only, Plan 240 Wikipedia only,
 * Plan 249 Output only, Plan 279 Dated only, Plan 287 Method only, and
 * Plan 297 Website only. AND with those dam chips happens in
 * `listDamsInView`, after Website only.
 */

import { getContextStore } from './contextStore.js';

export const DEFAULT_DAM_WIKIDATA_ONLY = false;
export const DAM_WIKIDATA_ONLY_STORAGE_KEY = 'meridian.damWikidataOnly';
export const DAM_WIKIDATA_ONLY_CHIP_LABEL = 'Wikidata only';
export const DAM_WIKIDATA_ONLY_CHIP_TITLE =
  'Hide dams that have no OSM Wikidata Q-id';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trim a candidate wikidata value. Missing / whitespace collapse to null.
 * @param {unknown} value
 * @returns {string|null}
 */
function cleanWikidata(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeDamWikidataOnly(value) {
  if (value == null || value === '') return DEFAULT_DAM_WIKIDATA_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function contextDamWikidata(record) {
  const recordId = record?.id;
  if (recordId == null || recordId === '') return null;
  try {
    const store = getContextStore();
    const ctx = store?.entities?.get?.(`local-dams:${String(recordId)}`);
    const props = ctx?.properties;
    const tags = props?.tags || {};
    return cleanWikidata(props?.wikidata) || cleanWikidata(tags.wikidata);
  } catch {
    // Node tests and missing window fail open to "no wikidata on the record".
    return null;
  }
}

/**
 * Raw wikidata already on a list record, its properties / tags, or the
 * already-registered `local-dams` entity context (same bundled snapshot
 * `getListPayload()` reads). No fetch. Wikipedia and operator:wikidata
 * do not count.
 * @param {object|null|undefined} record
 * @returns {string|null}
 */
export function damWikidataRaw(record) {
  if (record == null) return null;
  const fromRecord = cleanWikidata(record.wikidata);
  if (fromRecord != null) return fromRecord;
  const props = record.properties;
  const fromProps = cleanWikidata(props?.wikidata);
  if (fromProps != null) return fromProps;
  const tags = props?.tags || record.tags;
  const fromTags = cleanWikidata(tags?.wikidata);
  if (fromTags != null) return fromTags;
  return contextDamWikidata(record);
}

/**
 * Whether one in-view row already carries a non-empty wikidata Q-id.
 * Missing / empty / whitespace-only fail closed.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function damHasWikidata(record) {
  return damWikidataRaw(record) != null;
}

/**
 * Whether one in-view row clears Wikidata only.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} wikidataOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function damMatchesWikidataFilter(record, wikidataOnly, { selectedId = null } = {}) {
  if (normalizeDamWikidataOnly(wikidataOnly) !== true) return true;
  const id = String(record?.id ?? '');
  if (selectedId && id && id === String(selectedId)) return true;
  return damHasWikidata(record);
}

/**
 * Keep plants with a published Q-id when Wikidata only is on. Off
 * returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [wikidataOnly=DEFAULT_DAM_WIKIDATA_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterDamsByWikidataOnly(
  records,
  wikidataOnly = DEFAULT_DAM_WIKIDATA_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeDamWikidataOnly(wikidataOnly) !== true) return records.slice();
  return records.filter((record) => damMatchesWikidataFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_DAM_WIKIDATA_ONLY]
 * @returns {object}
 */
export function damsWikidataOnlyChipModel(current = DEFAULT_DAM_WIKIDATA_ONLY) {
  const only = normalizeDamWikidataOnly(current) === true;
  return {
    id: 'wikidata-only',
    label: DAM_WIKIDATA_ONLY_CHIP_LABEL,
    title: DAM_WIKIDATA_ONLY_CHIP_TITLE,
    active: only,
    group: 'Wikidata',
    params: { wikidataOnly: !only },
  };
}

/**
 * Read `meridian.damWikidataOnly`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readDamWikidataOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(DAM_WIKIDATA_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DAM_WIKIDATA_ONLY;
    return normalizeDamWikidataOnly(raw) === true;
  } catch {
    return DEFAULT_DAM_WIKIDATA_ONLY;
  }
}

/**
 * Write `meridian.damWikidataOnly` as `'1'` / `'0'`.
 * @param {unknown} wikidataOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDamWikidataOnly(wikidataOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeDamWikidataOnly(wikidataOnly);
    if (next == null) return false;
    store.setItem(DAM_WIKIDATA_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
