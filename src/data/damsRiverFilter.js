/**
 * Client-only dam River only toggle for the in-view list / fly-to surface.
 *
 * Re-filters already-bundled OSM / ODbL `local-dams` list records by a
 * non-empty river string. Reads `record.river`, `properties.associated_river`
 * / `river`, `tags.associated_river` / `river` / `river:name`, or the
 * already-registered `local-dams` context entity — the same sibling-tag
 * path Plan 205 uses for output and Plan 224 uses for operator. Never
 * fetches, adds no /api, and does not touch globe stems.
 * Persistence is local only (`meridian.damRiverOnly`). LayerStateCoordinator
 * restore re-enables `local-dams`; the list re-reads this key. The toggle
 * is not a share-URL field.
 *
 * Distinct from Plan 205 output-floor chips, Plan 218 Named only, and
 * Plan 224 Operator only. AND with those happens in `listDamsInView`,
 * after Operator only.
 */

import { getContextStore } from './contextStore.js';

export const DEFAULT_DAM_RIVER_ONLY = false;
export const DAM_RIVER_ONLY_STORAGE_KEY = 'meridian.damRiverOnly';
export const DAM_RIVER_ONLY_CHIP_LABEL = 'River only';
export const DAM_RIVER_ONLY_CHIP_TITLE =
  'Hide dams that have no OSM river';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trim a candidate river. Missing / whitespace collapse to null.
 * @param {unknown} value
 * @returns {string|null}
 */
function cleanRiver(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeDamRiverOnly(value) {
  if (value == null || value === '') return DEFAULT_DAM_RIVER_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function contextDamRiver(record) {
  const recordId = record?.id;
  if (recordId == null || recordId === '') return null;
  try {
    const store = getContextStore();
    const ctx = store?.entities?.get?.(`local-dams:${String(recordId)}`);
    const props = ctx?.properties;
    const tags = props?.tags || {};
    return cleanRiver(props?.associated_river)
      || cleanRiver(props?.river)
      || cleanRiver(tags.associated_river)
      || cleanRiver(tags.river)
      || cleanRiver(tags['river:name']);
  } catch {
    // Node tests and missing window fail open to "no river on the record".
    return null;
  }
}

/**
 * Raw river already on a list record, its properties / tags, or the
 * already-registered `local-dams` entity context (same bundled snapshot
 * `getListPayload()` reads). No fetch.
 * @param {object|null|undefined} record
 * @returns {string|null}
 */
export function damRiverRaw(record) {
  if (record == null) return null;
  const fromRecord = cleanRiver(record.river);
  if (fromRecord != null) return fromRecord;
  const props = record.properties;
  const fromProps = cleanRiver(props?.associated_river) || cleanRiver(props?.river);
  if (fromProps != null) return fromProps;
  const tags = props?.tags || record.tags;
  const fromTags = cleanRiver(tags?.associated_river)
    || cleanRiver(tags?.river)
    || cleanRiver(tags?.['river:name']);
  if (fromTags != null) return fromTags;
  return contextDamRiver(record);
}

/**
 * Whether one in-view row already carries a non-empty river.
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function damHasRiver(record) {
  return damRiverRaw(record) != null;
}

/**
 * Whether one in-view row clears River only.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} riverOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function damMatchesRiverFilter(record, riverOnly, { selectedId = null } = {}) {
  if (normalizeDamRiverOnly(riverOnly) !== true) return true;
  const id = String(record?.id ?? '');
  if (selectedId && id && id === String(selectedId)) return true;
  return damHasRiver(record);
}

/**
 * Keep plants with a river when River only is on. Off returns a
 * shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [riverOnly=DEFAULT_DAM_RIVER_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterDamsByRiverOnly(
  records,
  riverOnly = DEFAULT_DAM_RIVER_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeDamRiverOnly(riverOnly) !== true) return records.slice();
  return records.filter((record) => damMatchesRiverFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_DAM_RIVER_ONLY]
 * @returns {object}
 */
export function damsRiverOnlyChipModel(current = DEFAULT_DAM_RIVER_ONLY) {
  const only = normalizeDamRiverOnly(current) === true;
  return {
    id: 'river-only',
    label: DAM_RIVER_ONLY_CHIP_LABEL,
    title: DAM_RIVER_ONLY_CHIP_TITLE,
    active: only,
    group: 'River',
    params: { riverOnly: !only },
  };
}

/**
 * Read `meridian.damRiverOnly`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readDamRiverOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(DAM_RIVER_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DAM_RIVER_ONLY;
    return normalizeDamRiverOnly(raw) === true;
  } catch {
    return DEFAULT_DAM_RIVER_ONLY;
  }
}

/**
 * Write `meridian.damRiverOnly` as `'1'` / `'0'`.
 * @param {unknown} riverOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDamRiverOnly(riverOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeDamRiverOnly(riverOnly);
    if (next == null) return false;
    store.setItem(DAM_RIVER_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
