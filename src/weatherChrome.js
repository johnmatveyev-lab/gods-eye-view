/**
 * @module weatherChrome
 * @description WX on/off chrome for cockpit weather effects.
 *
 * Production default stays off. An explicit stored `'1'` opts in to globe FX.
 * Preference lives in `meridian.cockpitWeatherEffects.enabled` and is never
 * written into share URLs. A leftover `godsEyeView.cockpitWeatherEffects.enabled`
 * value copies once on read. Local Info briefing weather and the Open-Meteo
 * credit stay independent of this render switch.
 */

import { prefKey, readPrefKey, writePrefKey } from './prefStorage.js';

export const WX_STORAGE_KEY = prefKey('cockpitWeatherEffects.enabled');
export const DEFAULT_WX_ENABLED = false;
export const WX_TOGGLE_EVENT = 'gev:cockpit-weather-toggle';
export const WX_STATE_EVENT = 'gev:cockpit-weather-state';

/** @type {boolean|null} */
let cachedEnabled = null;

/** Clear the in-memory preference so the next read hits storage (reload / tests). */
export function resetWxPreferenceCache() {
  cachedEnabled = null;
}

/**
 * Resolve the persisted cockpit-weather preference; missing values default off.
 * @param {unknown} value
 * @returns {boolean}
 */
export function wxEnabledFromStoredValue(value) {
  return value === '1';
}

/**
 * @param {{getItem?: Function}|null|undefined} storage
 * @returns {boolean}
 */
export function readWxPreference(storage) {
  try {
    return wxEnabledFromStoredValue(readPrefKey(storage, WX_STORAGE_KEY));
  } catch {
    return DEFAULT_WX_ENABLED;
  }
}

/**
 * @param {unknown} enabled
 * @param {{setItem?: Function}|null|undefined} storage
 * @returns {boolean}
 */
export function writeWxPreference(enabled, storage) {
  const next = !!enabled;
  cachedEnabled = next;
  try {
    writePrefKey(storage, WX_STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Fail open: the session can still apply the chosen render flag.
  }
  return next;
}

/**
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function getWxEnabled(storage = globalThis.localStorage) {
  if (cachedEnabled !== null) return cachedEnabled;
  cachedEnabled = readWxPreference(storage);
  return cachedEnabled;
}

/**
 * @param {unknown} enabled
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function setWxEnabled(enabled, storage = globalThis.localStorage) {
  cachedEnabled = writeWxPreference(enabled, storage);
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent(WX_TOGGLE_EVENT, {
      detail: { enabled: cachedEnabled },
    }));
  }
  return cachedEnabled;
}

/**
 * Button/label snapshot for WX chrome.
 * @param {unknown} enabled
 * @returns {{pressed: string, ariaLabel: string, title: string, active: boolean, stateText: string}}
 */
export function weatherChromePresentation(enabled) {
  const active = !!enabled;
  const ariaLabel = `${active ? 'Disable' : 'Enable'} cockpit weather effects`;
  return {
    pressed: String(active),
    ariaLabel,
    title: ariaLabel,
    active,
    stateText: active ? 'ON' : 'OFF',
  };
}

/**
 * Whether cockpit weather FX should paint or fetch.
 * Hidden/offline chrome pauses share the same suspended flag as live polls.
 * @param {{
 *   enabled?: boolean,
 *   cockpitActive?: boolean,
 *   suspended?: boolean,
 *   hidden?: boolean,
 *   offline?: boolean,
 *   destroyed?: boolean,
 * }} [state]
 * @returns {boolean}
 */
export function weatherEffectsShouldRender(state = {}) {
  if (state.destroyed === true) return false;
  if (state.enabled !== true) return false;
  if (state.cockpitActive !== true) return false;
  if (state.suspended === true) return false;
  if (state.hidden === true || state.offline === true) return false;
  return true;
}

function applySingleToggle(button, presentation, stateEl) {
  if (!button) return;
  button.setAttribute('aria-pressed', presentation.pressed);
  button.setAttribute('aria-label', presentation.ariaLabel);
  button.title = presentation.title;
  button.classList?.toggle?.('active', presentation.active);
  if (stateEl) stateEl.textContent = presentation.stateText;
}

/**
 * @param {{querySelectorAll?: Function}|null|undefined} root
 * @param {unknown} enabled
 * @param {{textContent?: string}|null} [stateEl]
 */
export function syncWxToggleButtons(root, enabled, stateEl) {
  const presentation = weatherChromePresentation(enabled);
  const modeButtons = root?.querySelectorAll?.('[data-wx-mode]') ?? [];
  for (const button of modeButtons) {
    const modeOn = button.dataset?.wxMode === 'on';
    button.setAttribute('aria-pressed', String(modeOn === presentation.active));
  }
  const toggles = root?.querySelectorAll?.('[data-wx-toggle]') ?? [];
  for (const button of toggles) {
    applySingleToggle(button, presentation, stateEl);
  }
}

/**
 * @param {{addEventListener?: Function, removeEventListener?: Function, contains?: Function, querySelectorAll?: Function}|null|undefined} root
 * @param {{storage?: object, onChange?: Function, stateEl?: {textContent?: string}}} [options]
 * @returns {() => void}
 */
export function bindWxToggle(root, { storage, onChange, stateEl } = {}) {
  if (!root?.addEventListener) return () => {};
  syncWxToggleButtons(root, getWxEnabled(storage), stateEl);
  const handler = (event) => {
    const modeBtn = event.target?.closest?.('[data-wx-mode]');
    const toggleBtn = event.target?.closest?.('[data-wx-toggle]');
    let next = null;
    if (modeBtn && (typeof root.contains !== 'function' || root.contains(modeBtn))) {
      next = modeBtn.dataset.wxMode === 'on';
    } else if (toggleBtn && (typeof root.contains !== 'function' || root.contains(toggleBtn))) {
      next = toggleBtn.getAttribute('aria-pressed') !== 'true';
    } else {
      return;
    }
    const enabled = setWxEnabled(next, storage);
    syncWxToggleButtons(root, enabled, stateEl);
    onChange?.(enabled);
  };
  root.addEventListener('click', handler);
  return () => root.removeEventListener?.('click', handler);
}
