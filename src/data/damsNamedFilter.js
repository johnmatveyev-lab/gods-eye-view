/**
 * Client-only dam Named only toggle for the in-view list / fly-to surface.
 *
 * Re-filters already-bundled OSM / ODbL `local-dams` list records by the
 * label `listDamsInView` already computes (`record.label` or the "Dam"
 * fallback when OSM left the plant unnamed). Never fetches, adds no /api,
 * and does not touch globe stems.
 * Persistence is local only (`meridian.damNamedOnly`). LayerStateCoordinator
 * restore re-enables `local-dams`; the list re-reads this key. The toggle
 * is not a share-URL field.
 *
 * Distinct from Plan 186 military Named only and Plan 193 datacenter
 * operator-missing hide. AND with Plan 205 output-floor chips happens in
 * `listDamsInView`, after the output floor.
 */

export const DEFAULT_DAM_NAMED_ONLY = false;
export const DAM_NAMED_ONLY_STORAGE_KEY = 'meridian.damNamedOnly';
export const DAM_FALLBACK_LABEL = 'Dam';
export const DAM_NAMED_ONLY_CHIP_LABEL = 'Named only';
export const DAM_NAMED_ONLY_CHIP_TITLE =
  'Hide unnamed dams that only have the Dam fallback label';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeDamNamedOnly(value) {
  if (value == null || value === '') return DEFAULT_DAM_NAMED_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Same label `listDamsInView` already paints: empty / whitespace become
 * the "Dam" fallback.
 * @param {object|null|undefined} record
 * @returns {string}
 */
export function damListLabel(record) {
  return String(record?.label || DAM_FALLBACK_LABEL).trim() || DAM_FALLBACK_LABEL;
}

/**
 * Whether a painted list label is a real plant name.
 * Empty, whitespace, and the exact "Dam" fallback are unnamed.
 * @param {unknown} label
 * @returns {boolean}
 */
export function damLabelIsNamed(label) {
  const text = String(label ?? '').trim();
  return text !== '' && text !== DAM_FALLBACK_LABEL;
}

/**
 * Whether one in-view row clears Named only.
 * Off always passes. A selected id stays.
 * @param {object|null|undefined} record
 * @param {unknown} namedOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function damMatchesNamedFilter(record, namedOnly, { selectedId = null } = {}) {
  if (normalizeDamNamedOnly(namedOnly) !== true) return true;
  const id = String(record?.id ?? '');
  if (selectedId && id && id === String(selectedId)) return true;
  return damLabelIsNamed(damListLabel(record));
}

/**
 * Keep named plants when Named only is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [namedOnly=DEFAULT_DAM_NAMED_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterDamsByNamedOnly(
  records,
  namedOnly = DEFAULT_DAM_NAMED_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeDamNamedOnly(namedOnly) !== true) return records.slice();
  return records.filter((record) => damMatchesNamedFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_DAM_NAMED_ONLY]
 * @returns {object}
 */
export function damsNamedOnlyChipModel(current = DEFAULT_DAM_NAMED_ONLY) {
  const only = normalizeDamNamedOnly(current) === true;
  return {
    id: 'named-only',
    label: DAM_NAMED_ONLY_CHIP_LABEL,
    title: DAM_NAMED_ONLY_CHIP_TITLE,
    active: only,
    group: 'Name',
    params: { namedOnly: !only },
  };
}

/**
 * Read `meridian.damNamedOnly`. Missing or invalid storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readDamNamedOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(DAM_NAMED_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DAM_NAMED_ONLY;
    return normalizeDamNamedOnly(raw) === true;
  } catch {
    return DEFAULT_DAM_NAMED_ONLY;
  }
}

/**
 * Write `meridian.damNamedOnly` as `'1'` / `'0'`.
 * @param {unknown} namedOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDamNamedOnly(namedOnly, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeDamNamedOnly(namedOnly);
    if (next == null) return false;
    store.setItem(DAM_NAMED_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
