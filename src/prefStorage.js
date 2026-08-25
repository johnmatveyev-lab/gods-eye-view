/**
 * Meridian preference keys in localStorage.
 *
 * New writes use `meridian.*`. A read of a known key copies a matching
 * `godsEyeView.*` value once and leaves the older key in place.
 */

export const PREF_PREFIX = 'meridian.';
export const LEGACY_PREF_PREFIX = 'godsEyeView.';

/** Static suffixes the runtime still reads. Panel keys are versioned separately. */
export const KNOWN_PREF_SUFFIXES = Object.freeze([
  'cockpitWeatherEffects.enabled',
  'voiceCost.tier',
  'voiceCost.limits',
  'sceneProject.v2',
  'cctv.calibration.v2',
]);

export function prefKey(suffix) {
  return `${PREF_PREFIX}${suffix}`;
}

export function legacyPrefKey(suffix) {
  return `${LEGACY_PREF_PREFIX}${suffix}`;
}

export function panelPositionSuffix(version, panelId) {
  return `${version}.panelPos.${panelId}`;
}

export function panelCollapsedSuffix(version, panelId) {
  return `${version}.panelCollapsed.${panelId}`;
}

export function layoutResetNotifiedSuffix(version) {
  return `${version}.layoutResetNotified`;
}

export function legacyKeyFor(prefFullKey) {
  if (typeof prefFullKey !== 'string' || !prefFullKey.startsWith(PREF_PREFIX)) return null;
  return `${LEGACY_PREF_PREFIX}${prefFullKey.slice(PREF_PREFIX.length)}`;
}

function storageGet(storage, key) {
  if (!storage || typeof storage.getItem !== 'function' || typeof key !== 'string') return null;
  const value = storage.getItem(key);
  return value === undefined ? null : value;
}

export function readPrefKey(storage, key) {
  try {
    const current = storageGet(storage, key);
    if (current !== null) return current;
    const legacy = legacyKeyFor(key);
    if (!legacy) return null;
    const previous = storageGet(storage, legacy);
    if (previous === null) return null;
    try {
      storage.setItem(key, previous);
    } catch {
      // copy is best-effort; still return the older value
    }
    return previous;
  } catch {
    return null;
  }
}

export function writePrefKey(storage, key, value) {
  if (!storage || typeof storage.setItem !== 'function') return;
  storage.setItem(key, String(value));
}

export function readPref(storage, suffix) {
  return readPrefKey(storage, prefKey(suffix));
}

export function writePref(storage, suffix, value) {
  writePrefKey(storage, prefKey(suffix), value);
}

export function hasPanelPrefix(storage, suffixPrefix) {
  const nextPrefix = `${PREF_PREFIX}${suffixPrefix}`;
  const legacyPrefix = `${LEGACY_PREF_PREFIX}${suffixPrefix}`;
  try {
    return Object.keys(storage).some((key) => (
      key.startsWith(nextPrefix) || key.startsWith(legacyPrefix)
    ));
  } catch {
    return false;
  }
}
