/**
 * @module radioVolumePreference
 * @description Hosted Radio loudness for the existing HTMLAudioElement.
 * Persistence is local only (`meridian.radioVolume`, 0–100). Mute stores the
 * prior level so unmute can restore it. Layer-off still uses stopPlayback.
 */

export const RADIO_VOLUME_STORAGE_KEY = 'meridian.radioVolume';
export const DEFAULT_RADIO_VOLUME_PCT = 80;

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Clamp an untrusted slider or stored value to an integer 0–100.
 * Missing or corrupt values keep the product default (80).
 * @param {unknown} value
 * @returns {number}
 */
export function clampRadioVolumePct(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_RADIO_VOLUME_PCT;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

/** Convert a 0–100 slider value to the Audio element unit range. */
export function radioVolumePctToUnit(pct) {
  return clampRadioVolumePct(pct) / 100;
}

/** Convert an Audio element unit to a 0–100 slider value. */
export function radioVolumeUnitToPct(unit) {
  const numeric = Number(unit);
  if (!Number.isFinite(numeric)) return DEFAULT_RADIO_VOLUME_PCT;
  return clampRadioVolumePct(numeric * 100);
}

/**
 * Prior level used when the current loudness is 0. A positive current level
 * becomes the new prior; otherwise a stored prior or the default is kept.
 * @param {unknown} volumePct
 * @param {unknown} [priorPct]
 * @returns {number}
 */
export function rememberRadioVolumePrior(volumePct, priorPct) {
  const current = clampRadioVolumePct(volumePct);
  if (current > 0) return current;
  const prior = Number(priorPct);
  if (Number.isFinite(prior) && prior > 0) return clampRadioVolumePct(prior);
  return DEFAULT_RADIO_VOLUME_PCT;
}

/**
 * Mute sets 0 and remembers the prior level. Unmute restores that level.
 * @param {{volumePct?: unknown, priorPct?: unknown}} [state]
 * @returns {{volumePct: number, priorPct: number, muted: boolean}}
 */
export function radioMuteToggle({ volumePct = DEFAULT_RADIO_VOLUME_PCT, priorPct } = {}) {
  const current = clampRadioVolumePct(volumePct);
  if (current > 0) {
    return { volumePct: 0, priorPct: current, muted: true };
  }
  const restored = rememberRadioVolumePrior(0, priorPct);
  return { volumePct: restored, priorPct: restored, muted: false };
}

/**
 * Read the durable Radio volume. Storage failures fail open to 80.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {number}
 */
export function readRadioVolumePct(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(RADIO_VOLUME_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_RADIO_VOLUME_PCT;
    return clampRadioVolumePct(raw);
  } catch {
    return DEFAULT_RADIO_VOLUME_PCT;
  }
}

/**
 * Persist the Radio volume as an integer 0–100. Best-effort; never throws.
 * @param {unknown} pct
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeRadioVolumePct(pct, storage) {
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(RADIO_VOLUME_STORAGE_KEY, String(clampRadioVolumePct(pct)));
    return true;
  } catch {
    return false;
  }
}
