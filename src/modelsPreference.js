/**
 * Durable hangar-model preference for Meridian.
 *
 * `meridian.models` is `on` or `off`. Default `on` matches the existing
 * DISPLAY-rail 3D / hangar-model path. Off keeps every close-in contact on
 * the 2D billboard fallback already used when a GLB fails to load.
 */
export const MODELS_PREF_STORAGE_KEY = 'meridian.models';
export const MODELS_PREF_DEFAULT = 'on';

/**
 * @param {unknown} value
 * @returns {'on'|'off'}
 */
export function normalizeModelsPreference(value) {
  if (value === 'off' || value === false || value === 0 || value === '0') return 'off';
  if (value === 'on' || value === true || value === 1 || value === '1') return 'on';
  return MODELS_PREF_DEFAULT;
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {'on'|'off'|null} Explicit stored value, or null when unset/unreadable.
 */
export function peekModelsPreference(storage) {
  try {
    const raw = storage?.getItem?.(MODELS_PREF_STORAGE_KEY);
    if (raw === 'on' || raw === 'off') return raw;
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {'on'|'off'}
 */
export function readModelsPreference(storage) {
  return peekModelsPreference(storage) ?? MODELS_PREF_DEFAULT;
}

/**
 * @param {{setItem?: Function}|null|undefined} storage
 * @param {unknown} value
 * @returns {'on'|'off'}
 */
export function writeModelsPreference(storage, value) {
  const normalized = normalizeModelsPreference(value);
  try {
    storage?.setItem?.(MODELS_PREF_STORAGE_KEY, normalized);
  } catch {
    /* best effort — a locked store still returns the in-session choice */
  }
  return normalized;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function modelsPreferenceEnabled(value) {
  return normalizeModelsPreference(value) === 'on';
}
