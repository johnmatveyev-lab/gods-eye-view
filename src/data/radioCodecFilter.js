/**
 * Client-side Radio Browser codec chips.
 *
 * Filters stations the client already received. Playback still uses the
 * existing `/api/radio` broker; this module never fetches Radio Browser or
 * adds an endpoint. Persistence is local only (`meridian.radioCodecs`).
 */

export const RADIO_CODEC_STORAGE_KEY = 'meridian.radioCodecs';
export const RADIO_CODEC_IDS = Object.freeze(['mp3', 'aac']);
export const DEFAULT_RADIO_CODEC_FILTER = Object.freeze({ mp3: true, aac: true });

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Map one directory codec onto the MP3 or AAC chip. AAC covers AAC, AAC+,
 * AAC-LC, AAC-HE, and HE-AAC. Unknown or missing values stay visible.
 * @param {unknown} codec
 * @returns {'mp3'|'aac'|null}
 */
export function radioCodecFamily(codec) {
  const value = String(codec ?? '').trim().toUpperCase();
  if (!value) return null;
  if (value === 'MP3') return 'mp3';
  if (
    value === 'AAC'
    || value === 'AAC+'
    || value === 'AAC-LC'
    || value === 'AAC-HE'
    || value === 'HE-AAC'
    || value.startsWith('AAC')
    || value.includes('HE-AAC')
  ) return 'aac';
  return null;
}

/**
 * Accept chip maps, 'all' / 'mp3' / 'aac', or a partial object.
 * Missing chip keys stay on so a single-chip toggle does not hide the other.
 * @param {unknown} value
 * @returns {{mp3: boolean, aac: boolean}}
 */
export function normalizeRadioCodecFilter(value) {
  if (value == null || value === '' || value === 'all' || value === true) {
    return { mp3: true, aac: true };
  }
  if (value === 'none' || value === false) return { mp3: false, aac: false };
  if (value === 'mp3') return { mp3: true, aac: false };
  if (value === 'aac') return { mp3: false, aac: true };
  if (Array.isArray(value)) {
    const next = { mp3: false, aac: false };
    for (const raw of value) {
      const id = String(raw || '').trim().toLowerCase();
      if (id === 'mp3' || id === 'aac') next[id] = true;
    }
    return next;
  }
  if (typeof value === 'object') {
    return {
      mp3: value.mp3 !== false,
      aac: value.aac !== false,
    };
  }
  return { mp3: true, aac: true };
}

/**
 * Whether one directory station clears the codec chips.
 * Unknown/missing codec stays visible. A playing station can be kept.
 * @param {object} station
 * @param {unknown} filter
 * @param {{keepStationId?: string|null}} [options]
 * @returns {boolean}
 */
export function stationMatchesRadioCodecFilter(station, filter, { keepStationId = null } = {}) {
  if (keepStationId && station?.id === keepStationId) return true;
  const family = radioCodecFamily(station?.codec);
  if (family == null) return true;
  const enabled = normalizeRadioCodecFilter(filter);
  return enabled[family] === true;
}

/**
 * Current-list stations that still match the codec chips.
 * @param {Array<object>} stations
 * @param {unknown} filter
 * @param {{keepStationId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterRadioStationsByCodec(stations, filter, options = {}) {
  return (Array.isArray(stations) ? stations : [])
    .filter((station) => stationMatchesRadioCodecFilter(station, filter, options));
}

/**
 * Read the durable codec chips. Storage failures fail open to both on.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {{mp3: boolean, aac: boolean}}
 */
export function readRadioCodecFilter(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(RADIO_CODEC_STORAGE_KEY);
    if (raw == null || raw === '') return { ...DEFAULT_RADIO_CODEC_FILTER };
    return normalizeRadioCodecFilter(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_RADIO_CODEC_FILTER };
  }
}

/**
 * Persist codec chips. Best-effort; never throws.
 * @param {unknown} filter
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {{mp3: boolean, aac: boolean}}
 */
export function writeRadioCodecFilter(filter, storage) {
  const next = normalizeRadioCodecFilter(filter);
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(RADIO_CODEC_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Fail open: the session can still hold the chips in memory.
  }
  return next;
}
