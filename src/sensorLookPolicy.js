/**
 * Hosted sensor Look cycle.
 *
 * Existing styles only: CRT → NVG → FLIR → Noir → Snow → default.
 * IDs match StyleManager.setStyle / voice set_visual_style / the share URL
 * `style` key. Anime stays a Visual Presets entry, not a Look.
 */

export const SENSOR_LOOK_CYCLE = Object.freeze([
  'retro',
  'surveillance',
  'thermal',
  'noir',
  'snow',
  'normal',
]);

export const SENSOR_LOOK_LABELS = Object.freeze({
  retro: 'CRT',
  surveillance: 'NVG',
  thermal: 'FLIR',
  noir: 'NOIR',
  snow: 'SNOW',
  normal: 'NORMAL',
});

/** Next Look in the hosted cycle. Unknown styles, including Anime, start at CRT. */
export function nextSensorLook(current) {
  const index = SENSOR_LOOK_CYCLE.indexOf(current);
  if (index < 0) return SENSOR_LOOK_CYCLE[0];
  return SENSOR_LOOK_CYCLE[(index + 1) % SENSOR_LOOK_CYCLE.length];
}

export function sensorLookLabel(styleId) {
  return SENSOR_LOOK_LABELS[styleId] || String(styleId || 'normal').toUpperCase();
}

/** Apply a Look through the same setter the share URL and voice already use. */
export function applySensorLook(styleManager, styleId) {
  if (typeof styleManager?.setStyle === 'function') {
    styleManager.setStyle(styleId);
  }
  return styleId;
}

export function cycleSensorLook(styleManager) {
  return applySensorLook(styleManager, nextSensorLook(styleManager?.activeStyle));
}

/**
 * Store key for the last sensor look. Written to sessionStorage unless
 * this exact key is already present in localStorage.
 */
export const SENSOR_LOOK_STORE_KEY = 'gev:style:v1';

function resolveStore(kind, injected) {
  if (injected !== undefined) return injected;
  try {
    return kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage;
  } catch {
    return null;
  }
}

function readItem(store, key) {
  try {
    return store?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

function writeItem(store, key, value) {
  try {
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function existingDurableStore(storage) {
  const store = resolveStore('local', storage);
  return readItem(store, SENSOR_LOOK_STORE_KEY) != null ? store : null;
}

function normalizeStoredLook(value) {
  if (SENSOR_LOOK_CYCLE.includes(value)) return value;
  return null;
}

/** @returns {'retro'|'surveillance'|'thermal'|'noir'|'snow'|'normal'|null} */
export function readStoredSensorLook({ storage, sessionStorageRef } = {}) {
  const durable = existingDurableStore(storage);
  const raw = durable
    ? readItem(durable, SENSOR_LOOK_STORE_KEY)
    : readItem(resolveStore('session', sessionStorageRef), SENSOR_LOOK_STORE_KEY);
  return normalizeStoredLook(raw);
}

/**
 * Persist a look. Never creates a durable key that was not already there.
 * @returns {boolean}
 */
export function writeStoredSensorLook(styleId, { storage, sessionStorageRef } = {}) {
  const normalized = normalizeStoredLook(styleId);
  if (!normalized) return false;
  const durable = existingDurableStore(storage);
  if (durable) {
    return writeItem(durable, SENSOR_LOOK_STORE_KEY, normalized);
  }
  return writeItem(resolveStore('session', sessionStorageRef), SENSOR_LOOK_STORE_KEY, normalized);
}
