/**
 * Client-side Radio Browser English-only chip.
 *
 * Filters stations the client already received using the same language
 * tokens as globe-view ranking (`en` / `eng` / `english…`). Playback still
 * uses the existing `/api/radio` broker; this module never fetches Radio
 * Browser or adds an endpoint. Persistence is local only
 * (`meridian.radioEnglishOnly`).
 */

export const RADIO_ENGLISH_ONLY_STORAGE_KEY = 'meridian.radioEnglishOnly';
export const DEFAULT_RADIO_ENGLISH_ONLY = false;

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Normalize one directory language token the same way station tags are cleaned. */
function normalizeRadioLanguage(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

/**
 * Return whether Radio Browser metadata identifies a station as English-language.
 * @param {object} station
 * @returns {boolean}
 */
export function isEnglishRadioStation(station) {
  const languages = Array.isArray(station?.languages) ? station.languages : [];
  return languages.some((language) => {
    const normalized = normalizeRadioLanguage(language);
    return normalized === 'en'
      || normalized === 'eng'
      || normalized.startsWith('english')
      || normalized.endsWith(' english');
  });
}

/**
 * Accept a chip or stored flag. Invalid values fail open to off.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeRadioEnglishOnly(value) {
  return value === true || value === 'true' || value === '1' || value === 'on';
}

/**
 * Whether one directory station clears the English-only chip.
 * Off keeps every station already in the current list. A playing station
 * can be kept even when it is not English.
 * @param {object} station
 * @param {unknown} englishOnly
 * @param {{keepStationId?: string|null}} [options]
 * @returns {boolean}
 */
export function stationMatchesRadioEnglishFilter(station, englishOnly, { keepStationId = null } = {}) {
  if (keepStationId && station?.id === keepStationId) return true;
  if (!normalizeRadioEnglishOnly(englishOnly)) return true;
  return isEnglishRadioStation(station);
}

/**
 * Current-list stations that still match the English-only chip.
 * @param {Array<object>} stations
 * @param {unknown} englishOnly
 * @param {{keepStationId?: string|null}} [options]
 * @returns {Array<object>}
 */
export function filterRadioStationsByEnglish(stations, englishOnly, options = {}) {
  return (Array.isArray(stations) ? stations : [])
    .filter((station) => stationMatchesRadioEnglishFilter(station, englishOnly, options));
}

/**
 * Read the durable English-only chip. Storage failures fail open to off.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readRadioEnglishOnly(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem?.(RADIO_ENGLISH_ONLY_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_RADIO_ENGLISH_ONLY;
    return normalizeRadioEnglishOnly(JSON.parse(raw));
  } catch {
    return DEFAULT_RADIO_ENGLISH_ONLY;
  }
}

/**
 * Persist the English-only chip. Best-effort; never throws.
 * @param {unknown} englishOnly
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeRadioEnglishOnly(englishOnly, storage) {
  const next = normalizeRadioEnglishOnly(englishOnly);
  try {
    const store = resolveStorage(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(RADIO_ENGLISH_ONLY_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Fail open: the session can still hold the chip in memory.
  }
  return next;
}
