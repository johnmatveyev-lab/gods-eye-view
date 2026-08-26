/**
 * Client-only Named only toggle for the in-view datacenter list.
 *
 * Re-filters already-bundled OSM / ODbL `local-datacenters` list records
 * by the label `listDatacentersInView` already paints (`record.label` or
 * the generic layer title `Datacenter` when OSM left the site untitled).
 * Never fetches, adds no /api, and does not touch globe stems.
 *
 * Persistence is local only (`meridian.dcNamedOnly`) and is never written
 * into share URLs. LayerStateCoordinator restore is enabled-only for
 * local-datacenters; the list re-reads this key. Distinct from Plan 193
 * hide-no-operator (`meridian.datacenterHideNoOperator`) and Plan 206
 * exclusive All | AWS | Equinix chips (`meridian.dcOperator`). AND with
 * Plan 206 happens in `listDatacentersInView`, after the operator matcher.
 */

export const DEFAULT_DATACENTER_NAMED_ONLY = false;
export const DATACENTER_NAMED_ONLY_STORAGE_KEY = 'meridian.dcNamedOnly';
export const DATACENTER_FALLBACK_LABEL = 'Datacenter';
export const DATACENTER_NAMED_ONLY_CHIP_LABEL = 'Named only';
export const DATACENTER_NAMED_ONLY_CHIP_TITLE =
  'Hide untitled datacenters that only have the Datacenter fallback label';

/** @typedef {boolean} DatacenterListNamedOnly */

let sessionNamedOnly = DEFAULT_DATACENTER_NAMED_ONLY;
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
 * Canonical on/off. Invalid input returns null so writers can refuse.
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeDatacenterListNamedOnly(value) {
  if (value == null || value === '') return DEFAULT_DATACENTER_NAMED_ONLY;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * Same label `listDatacentersInView` already paints: empty / whitespace
 * become the generic `Datacenter` fallback.
 * @param {object|null|undefined} record
 * @returns {string}
 */
export function datacenterListLabel(record) {
  return String(record?.label || DATACENTER_FALLBACK_LABEL).trim()
    || DATACENTER_FALLBACK_LABEL;
}

/**
 * Whether a painted list label is a real site name.
 * Empty, whitespace, and the exact `Datacenter` fallback are untitled.
 * @param {unknown} label
 * @returns {boolean}
 */
export function datacenterLabelIsNamed(label) {
  const text = String(label ?? '').trim();
  return text !== '' && text !== DATACENTER_FALLBACK_LABEL;
}

/**
 * Whether one in-view row clears Named only.
 * Off always passes. A selected id stays if the caller already ran the
 * other matchers (operator chips, view bounds, visibility).
 * @param {object|null|undefined} record
 * @param {unknown} namedOnly
 * @param {{selectedId?: string|null}} [options]
 * @returns {boolean}
 */
export function datacenterMatchesNamedFilter(record, namedOnly, { selectedId = null } = {}) {
  if (normalizeDatacenterListNamedOnly(namedOnly) !== true) return true;
  const id = String(record?.id ?? '');
  if (selectedId && id && id === String(selectedId)) return true;
  return datacenterLabelIsNamed(datacenterListLabel(record));
}

/**
 * Keep named sites when Named only is on. Off returns a shallow copy.
 * @param {Array<object>|null|undefined} records
 * @param {unknown} [namedOnly=DEFAULT_DATACENTER_NAMED_ONLY]
 * @param {string|null} [selectedId]
 * @returns {Array<object>}
 */
export function filterDatacentersByNamedOnly(
  records,
  namedOnly = DEFAULT_DATACENTER_NAMED_ONLY,
  selectedId = null,
) {
  if (!Array.isArray(records)) return [];
  if (normalizeDatacenterListNamedOnly(namedOnly) !== true) return records.slice();
  return records.filter((record) => datacenterMatchesNamedFilter(record, true, { selectedId }));
}

/**
 * Data-row chip model. Params carry the flipped boolean for the list only.
 * @param {unknown} [current=DEFAULT_DATACENTER_NAMED_ONLY]
 * @returns {object}
 */
export function datacenterNamedOnlyChipModel(current = DEFAULT_DATACENTER_NAMED_ONLY) {
  const only = normalizeDatacenterListNamedOnly(current) === true;
  return {
    id: 'dc-named-only',
    label: DATACENTER_NAMED_ONLY_CHIP_LABEL,
    title: DATACENTER_NAMED_ONLY_CHIP_TITLE,
    active: only,
    group: 'Name',
    params: { dcNamedOnly: !only },
  };
}

/**
 * Read `meridian.dcNamedOnly`. Missing, invalid, or corrupt storage is off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readDatacenterListNamedOnly(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(DATACENTER_NAMED_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_DATACENTER_NAMED_ONLY;
    return normalizeDatacenterListNamedOnly(raw) === true;
  } catch {
    return DEFAULT_DATACENTER_NAMED_ONLY;
  }
}

/**
 * Write `meridian.dcNamedOnly` as `'1'` / `'0'`.
 * @param {unknown} namedOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeDatacenterListNamedOnly(namedOnly, storage) {
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem !== 'function') return false;
    const next = normalizeDatacenterListNamedOnly(namedOnly);
    if (next == null) return false;
    store.setItem(DATACENTER_NAMED_ONLY_STORAGE_KEY, next ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function getDatacenterListNamedOnly() {
  return sessionNamedOnly;
}

/**
 * Named only set. LayerStateCoordinator restore hydrates without rewriting.
 * @param {unknown} namedOnly
 * @param {{persist?: boolean, storage?: {getItem?: Function, setItem?: Function}|null}} [options]
 * @returns {boolean}
 */
export function setDatacenterListNamedOnly(namedOnly, { persist = true, storage } = {}) {
  const next = normalizeDatacenterListNamedOnly(namedOnly) === true;
  sessionNamedOnly = next;
  if (persist) writeDatacenterListNamedOnly(next, storage);
  for (const listener of listeners) listener(next);
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function hydrateDatacenterListNamedOnly(storage) {
  return setDatacenterListNamedOnly(readDatacenterListNamedOnly(storage), {
    persist: false,
    storage,
  });
}

/**
 * @param {(namedOnly: boolean) => void} listener
 * @returns {() => void}
 */
export function subscribeDatacenterListNamedOnly(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: restore off without clearing subscribers. */
export function resetDatacenterListNamedOnlyForTest() {
  sessionNamedOnly = DEFAULT_DATACENTER_NAMED_ONLY;
}
