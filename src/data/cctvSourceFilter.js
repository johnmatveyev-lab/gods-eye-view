/**
 * Client-only city/provider filter for the existing CCTV panel list.
 * Groups sources from fields already on each catalog row (city, cityId, provider).
 * No new camera networks and no extra /api.
 */

export const CCTV_CITY_STORAGE_KEY = 'meridian.cctvCity';
export const CCTV_CITY_FILTER_ALL = '';

/**
 * @param {unknown} value
 * @returns {string}
 */
function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * City-style ids (austin, london) group by city. District-style ids (ca-d7)
 * group by provider so Caltrans stays one filter.
 * @param {object|null|undefined} source
 * @returns {{key: string, label: string}}
 */
export function cctvSourceFilterGroup(source) {
  const cityId = String(source?.cityId || '').trim();
  const city = String(source?.city || '').trim();
  const provider = String(source?.provider || '').trim();
  if (cityId && !cityId.includes('-')) {
    return { key: `city:${slug(cityId)}`, label: city || cityId };
  }
  if (provider) {
    return { key: `provider:${slug(provider)}`, label: provider };
  }
  if (cityId) {
    return { key: `city:${slug(cityId)}`, label: city || cityId };
  }
  if (city) {
    return { key: `city:${slug(city)}`, label: city };
  }
  return { key: 'city:unknown', label: 'Unknown' };
}

/**
 * @param {Iterable<object>|null|undefined} sources
 * @returns {Array<{key: string, label: string}>}
 */
export function listCctvCityFilters(sources) {
  const byKey = new Map();
  for (const source of sources || []) {
    const group = cctvSourceFilterGroup(source);
    if (!byKey.has(group.key)) byKey.set(group.key, group);
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * @param {unknown} value
 * @param {string[]} [availableKeys]
 * @returns {string}
 */
export function normalizeCctvCityFilter(value, availableKeys = []) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === 'all' || raw === '*') return CCTV_CITY_FILTER_ALL;
  const keys = Array.isArray(availableKeys) ? availableKeys : [];
  if (keys.includes(raw)) return raw;
  const bare = slug(raw.replace(/^(city|provider):/i, ''));
  const cityKey = `city:${bare}`;
  if (keys.includes(cityKey)) return cityKey;
  const providerKey = `provider:${bare}`;
  if (keys.includes(providerKey)) return providerKey;
  return CCTV_CITY_FILTER_ALL;
}

/**
 * @param {Iterable<object>|null|undefined} sources
 * @param {unknown} filterKey
 * @returns {object[]}
 */
export function filterCctvSources(sources, filterKey) {
  const list = Array.isArray(sources) ? sources : [];
  const keys = listCctvCityFilters(list).map((option) => option.key);
  const normalized = normalizeCctvCityFilter(filterKey, keys);
  if (!normalized) return [...list];
  return list.filter((source) => cctvSourceFilterGroup(source).key === normalized);
}

/**
 * @param {Iterable<object>|null|undefined} sources
 * @param {unknown} activeId
 * @param {number} [step]
 * @param {unknown} [filterKey]
 * @returns {string|null}
 */
export function cycleFilteredCctvSources(sources, activeId, step = 1, filterKey = CCTV_CITY_FILTER_ALL) {
  const visible = filterCctvSources(sources, filterKey);
  if (!visible.length) return null;
  const idx = visible.findIndex((source) => source.id === activeId);
  const delta = Number.isFinite(step) ? Math.trunc(step) : 1;
  const nextIdx = idx < 0
    ? (delta < 0 ? visible.length - 1 : 0)
    : (((idx + delta) % visible.length) + visible.length) % visible.length;
  return visible[nextIdx]?.id || null;
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {string}
 */
export function readLastCctvCity(storage) {
  try {
    const raw = storage?.getItem?.(CCTV_CITY_STORAGE_KEY);
    if (!raw || raw === 'all' || raw === '*') return CCTV_CITY_FILTER_ALL;
    return String(raw);
  } catch {
    return CCTV_CITY_FILTER_ALL;
  }
}

/**
 * @param {unknown} value
 * @param {{setItem?: Function, removeItem?: Function}|null|undefined} storage
 * @returns {string}
 */
export function writeLastCctvCity(value, storage) {
  const stored = !value || value === 'all' || value === '*'
    ? CCTV_CITY_FILTER_ALL
    : String(value);
  try {
    if (!stored) storage?.removeItem?.(CCTV_CITY_STORAGE_KEY);
    else storage?.setItem?.(CCTV_CITY_STORAGE_KEY, stored);
  } catch {
    // Fail open: the session can still filter without persistence.
  }
  return stored;
}
