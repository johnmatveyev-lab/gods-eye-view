/**
 * @module bikeshareSystems
 * @description Allowlisted bike-share system picker helpers.
 *
 * The hosted picker can only name systems the client already ships: the GBFS
 * city registry plus the existing host allowlist from `gbfs.js`. It does not
 * add hosts or open the `/api/gbfs` proxy. Last system is persisted locally —
 * not as a layer filter and not through Radio's search path.
 */

import { GBFS_ALLOWED_HOSTS } from './gbfs.js';
import { normalizeBikeshareEbikesOnly } from './bikeshareEbikeFilter.js';
import { normalizeBikeshareMinAvailable } from './bikeshareMinAvailable.js';
import { normalizeBikeshareMinDocks } from './bikeshareMinDocks.js';

/** localStorage key for the last picked allowlisted system. */
export const BIKESHARE_SYSTEM_STORAGE_KEY = 'meridian.bikeshare.system';
/** localStorage key for the Hide empty station filter. Default omitted = OFF. */
export const BIKESHARE_HIDE_EMPTY_STORAGE_KEY = 'meridian.bikeshare.hideEmpty';
/** localStorage key for the Hide full station filter. Default omitted = OFF. */
export const BIKESHARE_HIDE_FULL_STORAGE_KEY = 'meridian.bikeshare.hideFull';
/** localStorage key for the Hide closed station filter. Default omitted = OFF. */
export const BIKESHARE_HIDE_CLOSED_STORAGE_KEY = 'meridian.bikeshare.hideClosed';
/** localStorage key for the min-available bike floor. Default omitted = All. */
export const BIKESHARE_MIN_AVAILABLE_STORAGE_KEY = 'meridian.bikeshare.minAvailable';
/** localStorage key for the min-open-docks floor. Default omitted = All. */
export const BIKESHARE_MIN_DOCKS_STORAGE_KEY = 'meridian.bikeshare.minDocks';
/** localStorage key for the E-bikes only station filter. Default omitted = OFF. */
export const BIKESHARE_EBIKES_ONLY_STORAGE_KEY = 'meridian.bikeshare.ebikesOnly';

/** Default system: the app's first-run city. */
export const DEFAULT_BIKESHARE_SYSTEM_ID = 'austin-capmetro';

/**
 * Explicit GBFS hosts the picker may show. Same set as the proxy allowlist
 * literals — no extras, no wildcard expansion into unknown systems.
 */
export const BIKESHARE_PICKER_ALLOWED_HOSTS = Object.freeze([...GBFS_ALLOWED_HOSTS]);

const PICKER_ALLOWED_HOST_SET = new Set(BIKESHARE_PICKER_ALLOWED_HOSTS);

/**
 * Whether a hostname is allowed to appear in the system picker.
 * @param {string} host
 * @returns {boolean}
 */
export function isBikesharePickerHostAllowed(host) {
  return PICKER_ALLOWED_HOST_SET.has(String(host || '').trim().toLowerCase());
}

/**
 * Convert an upstream GBFS URL into the existing `/api/gbfs` proxy path.
 * @param {string} upstreamUrl
 * @returns {string}
 */
export function buildGbfsProxyUrl(upstreamUrl) {
  return `/api/gbfs/${encodeURIComponent(String(upstreamUrl || ''))}`;
}

/**
 * @param {string} id
 * @param {Array<{id: string}>} systems
 * @returns {string|null}
 */
export function normalizeBikeshareSystemId(id, systems) {
  const normalized = String(id || '').trim().toLowerCase();
  if (!normalized || !Array.isArray(systems)) return null;
  return systems.some((system) => system.id === normalized) ? normalized : null;
}

/**
 * Public picker rows from a city registry. Drops any entry whose hosts are
 * not on the picker allowlist so a disallowed host can never appear.
 * @param {Array<object>} systems
 * @returns {Array<object>}
 */
export function listPickerSystems(systems) {
  const rows = [];
  for (const system of Array.isArray(systems) ? systems : []) {
    const hosts = Array.isArray(system?.hosts) ? system.hosts : [];
    if (hosts.length === 0 || !hosts.every(isBikesharePickerHostAllowed)) continue;
    rows.push({
      id: system.id,
      city: system.city,
      provider: system.provider,
      hosts: [...hosts],
      stationInformationUrl: system.stationInformationUrl,
      stationStatusUrl: system.stationStatusUrl,
    });
  }
  return rows.sort((a, b) => String(a.city).localeCompare(String(b.city)));
}

/**
 * @param {{getItem?: Function}|null} storage
 * @param {Array<{id: string}>} systems
 * @returns {string|null}
 */
export function readPersistedBikeshareSystem(storage, systems) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    return normalizeBikeshareSystemId(storage.getItem(BIKESHARE_SYSTEM_STORAGE_KEY), systems);
  } catch {
    return null;
  }
}

/**
 * @param {string} id
 * @param {{setItem?: Function}|null} storage
 * @param {Array<{id: string}>} systems
 * @returns {string|null} Persisted id, or null when rejected / storage failed.
 */
export function writePersistedBikeshareSystem(id, storage, systems) {
  const normalized = normalizeBikeshareSystemId(id, systems);
  if (!normalized || !storage || typeof storage.setItem !== 'function') return null;
  try {
    storage.setItem(BIKESHARE_SYSTEM_STORAGE_KEY, normalized);
    return normalized;
  } catch {
    return null;
  }
}

/**
 * @param {{city?: string, provider?: string}} system
 * @returns {string}
 */
export function bikeshareSystemPickerLabel(system) {
  const city = String(system?.city || '').trim();
  const provider = String(system?.provider || '').trim();
  if (city && provider) return `${city} · ${provider}`;
  return city || provider || 'GBFS';
}

/**
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeBikeshareHideEmpty(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeBikeshareHideFull(value) {
  return normalizeBikeshareHideEmpty(value);
}

/**
 * @param {unknown} value
 * @returns {boolean|null}
 */
export function normalizeBikeshareHideClosed(value) {
  return normalizeBikeshareHideEmpty(value);
}

/**
 * @param {{getItem?: Function}|null} storage
 * @returns {boolean|null}
 */
export function readPersistedBikeshareHideEmpty(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    return normalizeBikeshareHideEmpty(storage.getItem(BIKESHARE_HIDE_EMPTY_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * @param {{getItem?: Function}|null} storage
 * @returns {boolean|null}
 */
export function readPersistedBikeshareHideFull(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    return normalizeBikeshareHideFull(storage.getItem(BIKESHARE_HIDE_FULL_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * @param {{getItem?: Function}|null} storage
 * @returns {boolean|null}
 */
export function readPersistedBikeshareHideClosed(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    return normalizeBikeshareHideClosed(storage.getItem(BIKESHARE_HIDE_CLOSED_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @param {{setItem?: Function}|null} storage
 * @returns {boolean|null}
 */
export function writePersistedBikeshareHideEmpty(value, storage) {
  const normalized = normalizeBikeshareHideEmpty(value);
  if (normalized == null || !storage || typeof storage.setItem !== 'function') return null;
  try {
    storage.setItem(BIKESHARE_HIDE_EMPTY_STORAGE_KEY, normalized ? '1' : '0');
    return normalized;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @param {{setItem?: Function}|null} storage
 * @returns {boolean|null}
 */
export function writePersistedBikeshareHideFull(value, storage) {
  const normalized = normalizeBikeshareHideFull(value);
  if (normalized == null || !storage || typeof storage.setItem !== 'function') return null;
  try {
    storage.setItem(BIKESHARE_HIDE_FULL_STORAGE_KEY, normalized ? '1' : '0');
    return normalized;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @param {{setItem?: Function}|null} storage
 * @returns {boolean|null}
 */
export function writePersistedBikeshareHideClosed(value, storage) {
  const normalized = normalizeBikeshareHideClosed(value);
  if (normalized == null || !storage || typeof storage.setItem !== 'function') return null;
  try {
    storage.setItem(BIKESHARE_HIDE_CLOSED_STORAGE_KEY, normalized ? '1' : '0');
    return normalized;
  } catch {
    return null;
  }
}

/**
 * @param {{getItem?: Function}|null} storage
 * @returns {'all'|'3'|'5'|null}
 */
export function readPersistedBikeshareMinAvailable(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    return normalizeBikeshareMinAvailable(storage.getItem(BIKESHARE_MIN_AVAILABLE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @param {{setItem?: Function}|null} storage
 * @returns {'all'|'3'|'5'|null}
 */
export function writePersistedBikeshareMinAvailable(value, storage) {
  const normalized = normalizeBikeshareMinAvailable(value);
  if (normalized == null || !storage || typeof storage.setItem !== 'function') return null;
  try {
    storage.setItem(BIKESHARE_MIN_AVAILABLE_STORAGE_KEY, normalized);
    return normalized;
  } catch {
    return null;
  }
}

/**
 * @param {{getItem?: Function}|null} storage
 * @returns {'all'|'3'|'5'|null}
 */
export function readPersistedBikeshareMinDocks(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    return normalizeBikeshareMinDocks(storage.getItem(BIKESHARE_MIN_DOCKS_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @param {{setItem?: Function}|null} storage
 * @returns {'all'|'3'|'5'|null}
 */
export function writePersistedBikeshareMinDocks(value, storage) {
  const normalized = normalizeBikeshareMinDocks(value);
  if (normalized == null || !storage || typeof storage.setItem !== 'function') return null;
  try {
    storage.setItem(BIKESHARE_MIN_DOCKS_STORAGE_KEY, normalized);
    return normalized;
  } catch {
    return null;
  }
}

/**
 * @param {{getItem?: Function}|null} storage
 * @returns {boolean|null}
 */
export function readPersistedBikeshareEbikesOnly(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    return normalizeBikeshareEbikesOnly(storage.getItem(BIKESHARE_EBIKES_ONLY_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @param {{setItem?: Function}|null} storage
 * @returns {boolean|null}
 */
export function writePersistedBikeshareEbikesOnly(value, storage) {
  const normalized = normalizeBikeshareEbikesOnly(value);
  if (normalized == null || !storage || typeof storage.setItem !== 'function') return null;
  try {
    storage.setItem(BIKESHARE_EBIKES_ONLY_STORAGE_KEY, normalized ? '1' : '0');
    return normalized;
  } catch {
    return null;
  }
}
