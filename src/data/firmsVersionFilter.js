/**
 * Client-only FIRMS product-version chips. Filters already-fetched detections
 * by `fire.version` (FIRMS CSV `version` from adaptFirmsRecords) — never
 * issues a new NASA /api/firms query. Unknown chips stay All so a stale
 * preference cannot invent a new NASA query.
 *
 * Persistence is local only (`meridian.firmsVersion`), separate from the Plan
 * 155 TI4 brightness floor, Plan 163 satellite chips, Plan 192 TI5 brightness
 * floor, Plan 204 scan-size chips, Plan 211 track-size chips, and Plan 210
 * list confidence chips. No share-URL write.
 *
 * Missing version fails open on All and counts as Other. The selected
 * detection always stays.
 */

/** Operator product-version chips. `all` is the current unfiltered view. */
export const FIRMS_VERSION_CHIPS = Object.freeze([
  Object.freeze({ id: 'all', label: 'All', title: 'Show every FIRMS product version' }),
  Object.freeze({
    id: '2.0NRT',
    label: '2.0NRT',
    title: 'Show C2 NRT (2.0NRT) detections only',
  }),
  Object.freeze({
    id: 'other',
    label: 'Other',
    title: 'Show older or other FIRMS product versions (1.0NRT and missing)',
  }),
]);

export const FIRMS_VERSION_STORAGE_KEY = 'meridian.firmsVersion';

export const DEFAULT_FIRMS_VERSION_FILTER = 'all';

/** Canonical C2 NRT product token as NASA FIRMS writes it. */
export const FIRMS_VERSION_C2_NRT = '2.0NRT';

/** @typedef {'all'|'2.0NRT'|'other'} FirmsVersionFilter */

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Trimmed version string from a fire or raw CSV cell. Missing stays empty.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeFirmsVersionValue(value) {
  if (value == null) return '';
  return String(value).trim();
}

/**
 * Map one detection (or raw version string) onto a chip. Missing / blank
 * / anything other than 2.0NRT is Other. Comparison is case-insensitive
 * and ignores interior whitespace so `2.0nrt` and `2.0 NRT` still match.
 * @param {unknown} fire
 * @returns {'2.0NRT'|'other'}
 */
export function classifyFirmsVersion(fire) {
  const raw = typeof fire === 'string' || fire == null ? fire : fire?.version;
  const compact = normalizeFirmsVersionValue(raw).replace(/\s+/g, '').toUpperCase();
  if (compact === FIRMS_VERSION_C2_NRT.toUpperCase()) return FIRMS_VERSION_C2_NRT;
  return 'other';
}

/**
 * Coerce a chip / layer-state value to a version filter id. Unknown values
 * stay All so a stale preference cannot invent a new NASA query.
 * @param {*} value
 * @returns {FirmsVersionFilter}
 */
export function normalizeFirmsVersionFilter(value) {
  const text = normalizeFirmsVersionValue(value);
  const compact = text.replace(/\s+/g, '').toUpperCase();
  if (compact === FIRMS_VERSION_C2_NRT.toUpperCase()) return FIRMS_VERSION_C2_NRT;
  const lower = text.toLowerCase();
  if (lower === 'other') return 'other';
  if (lower === 'all' || lower === '0' || lower === '') return DEFAULT_FIRMS_VERSION_FILTER;
  return DEFAULT_FIRMS_VERSION_FILTER;
}

function fireRecordId(fire) {
  if (fire?.id != null && fire.id !== '') return String(fire.id);
  if (fire?.index != null && fire.index !== '') return String(fire.index);
  return '';
}

function keepSelectedFire(fire, selectedId) {
  if (selectedId == null || selectedId === '') return false;
  const id = fireRecordId(fire);
  return Boolean(id) && id === String(selectedId);
}

function selectedIdFrom(options) {
  if (options == null || options === '') return null;
  if (typeof options === 'object' && !Array.isArray(options)) {
    return options.selectedId ?? null;
  }
  return options;
}

/**
 * Whether one detection clears the product-version chips. All keeps every
 * version including 1.0NRT and missing. 2.0NRT drops 1.0NRT. Other keeps
 * 1.0NRT and missing. The selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {FirmsVersionFilter|string} filter
 * @param {{selectedId?: string|null}|string|null} [options]
 * @returns {boolean}
 */
export function fireMeetsVersionFilter(fire, filter, options) {
  if (keepSelectedFire(fire, selectedIdFrom(options))) return true;
  const chip = normalizeFirmsVersionFilter(filter);
  switch (chip) {
    case 'all':
      return true;
    case FIRMS_VERSION_C2_NRT:
      return classifyFirmsVersion(fire) === FIRMS_VERSION_C2_NRT;
    case 'other':
      return classifyFirmsVersion(fire) === 'other';
    default: {
      const _exhaustive = /** @type {never} */ (chip);
      void _exhaustive;
      return true;
    }
  }
}

/**
 * Keep detections that match the product-version chips. All returns a
 * shallow copy. The selected id always stays.
 * @param {Array<Object>|null|undefined} fires
 * @param {FirmsVersionFilter|string} filter
 * @param {{selectedId?: string|null}|string|null} [selectedId]
 * @returns {Array<Object>}
 */
export function filterFiresByVersion(fires, filter, selectedId) {
  if (!Array.isArray(fires)) return [];
  const chip = normalizeFirmsVersionFilter(filter);
  const keepId = selectedIdFrom(selectedId);
  if (chip === DEFAULT_FIRMS_VERSION_FILTER && (keepId == null || keepId === '')) {
    return fires.slice();
  }
  return fires.filter((fire) => fireMeetsVersionFilter(fire, chip, keepId));
}

/**
 * Exclusive-chip models for the FIRMS data-layer row.
 * @param {unknown} current
 * @returns {Array<object>}
 */
export function firmsVersionChipModels(current = DEFAULT_FIRMS_VERSION_FILTER) {
  const chip = normalizeFirmsVersionFilter(current);
  return FIRMS_VERSION_CHIPS.map((entry) => ({
    id: `version-${entry.id}`,
    label: entry.label,
    title: entry.title,
    active: chip === entry.id,
    group: 'Version',
    params: { versionFilter: entry.id },
  }));
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {FirmsVersionFilter}
 */
export function readFirmsVersionFilter(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_VERSION_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_VERSION_FILTER;
    return normalizeFirmsVersionFilter(raw);
  } catch {
    return DEFAULT_FIRMS_VERSION_FILTER;
  }
}

/**
 * @param {unknown} filter
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {FirmsVersionFilter}
 */
export function writeFirmsVersionFilter(filter, storage) {
  const normalized = normalizeFirmsVersionFilter(filter);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_VERSION_STORAGE_KEY, normalized);
    }
  } catch {
    // Fail open: the session can still apply the chosen chip.
  }
  return normalized;
}
