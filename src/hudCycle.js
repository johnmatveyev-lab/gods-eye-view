/**
 * HUD layout cycle — the mouse chrome for the existing set_hud state.
 *
 * Voice already writes visibility + operator/minimal/tactical through
 * StyleManager.setHudLayout / setHudVisible. This module is the same state
 * machine for a single click: operator → minimal → tactical → off → operator.
 *
 * Variant persistence is session-only unless a durable store key already
 * exists. This file never creates that durable key.
 */

/** Click order, including the off step. */
export const HUD_CYCLE = Object.freeze(['operator', 'minimal', 'tactical', 'off']);

/** Layout variants accepted by set_hud / setHudLayout. */
export const HUD_LAYOUTS = Object.freeze(['operator', 'minimal', 'tactical']);

/**
 * Store key for the last HUD layout variant. Written to sessionStorage unless
 * this exact key is already present in localStorage.
 */
export const HUD_VARIANT_STORE_KEY = 'gev:hud-variant:v1';

/**
 * Resolve a Web Storage area without letting a hostile getter escape.
 * @param {'local'|'session'} kind
 * @param {object|null|undefined} injected Explicit store; `undefined` means "use the global".
 * @returns {{getItem?: Function, setItem?: Function, removeItem?: Function}|null}
 */
function resolveStore(kind, injected) {
  if (injected !== undefined) return injected;
  try {
    return kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage;
  } catch {
    return null;
  }
}

/** @param {unknown} value */
function assertNever(value) {
  throw new Error(`Unhandled HUD cycle token: ${value}`);
}

/**
 * @param {unknown} value
 * @returns {'operator'|'minimal'|'tactical'}
 */
export function normalizeHudLayout(value) {
  const normalized = String(value ?? '').toLowerCase();
  return HUD_LAYOUTS.includes(normalized) ? normalized : 'tactical';
}

/**
 * @param {{visible?: boolean, layout?: string}} state
 * @returns {'operator'|'minimal'|'tactical'|'off'}
 */
export function describeHudCycleState(state = {}) {
  if (!state.visible) return 'off';
  return normalizeHudLayout(state.layout);
}

/**
 * @param {{visible?: boolean, layout?: string}} state
 * @returns {'operator'|'minimal'|'tactical'|'off'}
 */
export function nextHudCycleState(state = {}) {
  const current = describeHudCycleState(state);
  switch (current) {
    case 'operator':
      return 'minimal';
    case 'minimal':
      return 'tactical';
    case 'tactical':
      return 'off';
    case 'off':
      return 'operator';
    default:
      return assertNever(current);
  }
}

/**
 * Apply one cycle token through the same facades voice set_hud uses.
 * @param {'operator'|'minimal'|'tactical'|'off'} token
 * @param {{setHudLayout: Function, setHudVisible: Function}} facades
 * @returns {object}
 */
export function applyHudCycleState(token, facades) {
  if (token === 'off') {
    return facades.setHudVisible('off');
  }
  const layout = facades.setHudLayout(token);
  if (!layout?.ok) return layout;
  const visible = facades.setHudVisible('on');
  return { ...layout, ...visible };
}

/**
 * Advance the current HUD chrome one step.
 * @param {{visible?: boolean, layout?: string}} state
 * @param {{setHudLayout: Function, setHudVisible: Function}} facades
 * @returns {object}
 */
export function cycleHud(state, facades) {
  return applyHudCycleState(nextHudCycleState(state), facades);
}

/**
 * @param {{visible?: boolean, layout?: string}} state
 * @returns {string}
 */
export function hudChromeLabel(state = {}) {
  const token = describeHudCycleState(state);
  return token === 'off' ? 'HUD' : token.toUpperCase();
}

/**
 * @param {{visible?: boolean, layout?: string}} state
 * @returns {string}
 */
export function hudChromeAriaLabel(state = {}) {
  const token = describeHudCycleState(state);
  return token === 'off' ? 'HUD: off' : `HUD layout: ${token}`;
}

/**
 * @param {{getItem?: Function}|null} store
 * @param {string} key
 * @returns {string|null}
 */
function readItem(store, key) {
  try {
    return store?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {{setItem?: Function}|null} store
 * @param {string} key
 * @param {string} value
 * @returns {boolean}
 */
function writeItem(store, key, value) {
  try {
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Durable storage is used only when this key is already present.
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {{getItem?: Function, setItem?: Function}|null}
 */
function existingDurableStore(storage) {
  const store = resolveStore('local', storage);
  return readItem(store, HUD_VARIANT_STORE_KEY) != null ? store : null;
}

/**
 * @param {{storage?: object|null, sessionStorageRef?: object|null}} [input]
 * @returns {'operator'|'minimal'|'tactical'|null}
 */
export function readStoredHudVariant({ storage, sessionStorageRef } = {}) {
  const durable = existingDurableStore(storage);
  const raw = durable
    ? readItem(durable, HUD_VARIANT_STORE_KEY)
    : readItem(resolveStore('session', sessionStorageRef), HUD_VARIANT_STORE_KEY);
  if (raw == null) return null;
  return normalizeHudLayout(raw);
}

/**
 * Persist a layout variant. Never creates a durable key that was not already there.
 * @param {unknown} variant
 * @param {{storage?: object|null, sessionStorageRef?: object|null}} [input]
 * @returns {boolean}
 */
export function writeStoredHudVariant(variant, { storage, sessionStorageRef } = {}) {
  const normalized = normalizeHudLayout(variant);
  const durable = existingDurableStore(storage);
  if (durable) {
    return writeItem(durable, HUD_VARIANT_STORE_KEY, normalized);
  }
  return writeItem(resolveStore('session', sessionStorageRef), HUD_VARIANT_STORE_KEY, normalized);
}
