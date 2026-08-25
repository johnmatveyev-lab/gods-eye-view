/**
 * City / provider filter for the existing CCTV panel list.
 *
 * Uses fields already on each /api/cctv/sources row (city, cityId, provider).
 * Empty filter shows the full catalog. Last city persists in localStorage.
 * No new camera networks and no extra /api.
 */

export const CCTV_CITY_FILTER_STORAGE_KEY = 'meridian.cctvCity';

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeCctvCityFilter(value) {
  return String(value || '').trim();
}

/**
 * @param {{city?: string, cityId?: string, provider?: string}|null|undefined} source
 * @param {unknown} filter
 * @returns {boolean}
 */
export function sourceMatchesCityFilter(source, filter) {
  const needle = normalizeCctvCityFilter(filter).toLowerCase();
  if (!needle) return true;
  const fields = [source?.city, source?.cityId, source?.provider]
    .map((field) => String(field || '').trim().toLowerCase())
    .filter(Boolean);
  return fields.includes(needle);
}

/**
 * @param {Array<object>|null|undefined} sources
 * @param {unknown} filter
 * @returns {Array<object>}
 */
export function filterCctvSources(sources, filter) {
  return (Array.isArray(sources) ? sources : []).filter((source) => (
    sourceMatchesCityFilter(source, filter)
  ));
}

/**
 * Unique city/provider options. City-scoped packs keep their cityId; a
 * provider that spans several cityIds (Caltrans districts) collapses to one
 * provider option so hosted users can pick Austin / Caltrans / TfL.
 * @param {Array<object>|null|undefined} sources
 * @returns {Array<{key: string, label: string, count: number}>}
 */
export function listCctvCityFilterOptions(sources) {
  const list = Array.isArray(sources) ? sources : [];
  const cityIdsByProvider = new Map();
  for (const source of list) {
    const provider = String(source?.provider || '').trim();
    if (!provider) continue;
    if (!cityIdsByProvider.has(provider)) cityIdsByProvider.set(provider, new Set());
    const cityId = String(source?.cityId || '').trim();
    if (cityId) cityIdsByProvider.get(provider).add(cityId);
  }
  const multiCityProviders = new Set(
    [...cityIdsByProvider.entries()]
      .filter(([, cityIds]) => cityIds.size > 1)
      .map(([provider]) => provider),
  );

  const byKey = new Map();
  for (const source of list) {
    const cityId = String(source?.cityId || '').trim();
    const city = String(source?.city || '').trim();
    const provider = String(source?.provider || '').trim();
    const key = provider && multiCityProviders.has(provider)
      ? provider
      : (cityId || city || provider);
    if (!key) continue;
    const label = provider && multiCityProviders.has(provider)
      ? provider
      : (city || cityId || provider);
    const current = byKey.get(key);
    if (current) current.count += 1;
    else byKey.set(key, { key, label, count: 1 });
  }

  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {string}
 */
export function readCctvCityFilter(storage) {
  try {
    return normalizeCctvCityFilter(storage?.getItem?.(CCTV_CITY_FILTER_STORAGE_KEY));
  } catch {
    return '';
  }
}

/**
 * @param {{setItem?: Function}|null|undefined} storage
 * @param {unknown} filter
 * @returns {string}
 */
export function writeCctvCityFilter(storage, filter) {
  const normalized = normalizeCctvCityFilter(filter);
  try {
    storage?.setItem?.(CCTV_CITY_FILTER_STORAGE_KEY, normalized);
  } catch {
    // Fail open: the session can still show the chosen city.
  }
  return normalized;
}

/**
 * @param {Array<{id?: string}>|null|undefined} cameras
 * @param {unknown} activeId
 * @param {number} [step=1]
 * @returns {string|null}
 */
export function cycleFilteredCctvCamera(cameras, activeId, step = 1) {
  const list = Array.isArray(cameras) ? cameras : [];
  if (!list.length) return null;
  const currentIdx = list.findIndex((camera) => camera?.id === activeId);
  const delta = Number.isFinite(step) ? Math.trunc(step) : 1;
  const nextIdx = currentIdx < 0
    ? (delta < 0 ? list.length - 1 : 0)
    : (((currentIdx + delta) % list.length) + list.length) % list.length;
  return list[nextIdx]?.id || null;
}

/**
 * Selecting a camera still uses the existing stream/placeholder URL.
 * @param {{frameUrl?: string}|null|undefined} camera
 * @param {{enabled?: boolean}} [options]
 * @returns {string|null}
 */
export function cctvSelectedFrameSrc(camera, { enabled = true } = {}) {
  if (!enabled || !camera) return null;
  return camera.frameUrl || null;
}
