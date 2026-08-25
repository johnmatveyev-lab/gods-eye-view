// PLAN 58 — WX effects on/off chrome. Wired to the existing cockpit weather
// render flag. Off hides globe FX; Local Info may still show Open-Meteo + credit.
// Offline/hidden-tab pauses still apply. Not annotations, not trails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DEFAULT_WX_ENABLED,
  WX_STATE_EVENT,
  WX_STORAGE_KEY,
  WX_TOGGLE_EVENT,
  bindWxToggle,
  getWxEnabled,
  readWxPreference,
  resetWxPreferenceCache,
  setWxEnabled,
  syncWxToggleButtons,
  weatherEffectsShouldRender,
  weatherChromePresentation,
  writeWxPreference,
  wxEnabledFromStoredValue,
} from './weatherChrome.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function fakeButton(attrs = {}, dataset = {}) {
  const classes = new Set();
  const button = {
    dataset,
    attrs: { 'aria-pressed': 'false', ...attrs },
    title: '',
    getAttribute(name) {
      return this.attrs[name];
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    classList: {
      toggle(name, on) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    closest(selector) {
      if (selector === '[data-wx-mode]' && button.dataset.wxMode) return button;
      if (selector === '[data-wx-toggle]' && button.dataset.wxToggle != null) return button;
      return null;
    },
  };
  return button;
}

function fakeToggleRoot(buttons) {
  const listeners = new Map();
  return {
    buttons,
    contains(node) {
      return buttons.includes(node);
    },
    querySelectorAll(selector) {
      if (selector === '[data-wx-mode]') {
        return buttons.filter((button) => button.dataset.wxMode);
      }
      if (selector === '[data-wx-toggle]') {
        return buttons.filter((button) => button.dataset.wxToggle != null);
      }
      return [];
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    click(button) {
      listeners.get('click')?.({ target: button });
    },
  };
}

test('the stored key stays the existing cockpit weather-effects flag and defaults off', () => {
  assert.equal(WX_STORAGE_KEY, 'meridian.cockpitWeatherEffects.enabled');
  assert.equal(DEFAULT_WX_ENABLED, false);
  assert.equal(WX_TOGGLE_EVENT, 'gev:cockpit-weather-toggle');
  assert.equal(WX_STATE_EVENT, 'gev:cockpit-weather-state');
  assert.equal(wxEnabledFromStoredValue(null), false);
  assert.equal(wxEnabledFromStoredValue(''), false);
  assert.equal(wxEnabledFromStoredValue('0'), false);
  assert.equal(wxEnabledFromStoredValue('1'), true);
});

test('a leftover godsEyeView WX key copies onto meridian and still applies', () => {
  resetWxPreferenceCache();
  const storage = memoryStorage({
    'godsEyeView.cockpitWeatherEffects.enabled': '1',
  });
  assert.equal(readWxPreference(storage), true);
  assert.equal(storage.getItem('meridian.cockpitWeatherEffects.enabled'), '1');
  assert.equal(storage.getItem('godsEyeView.cockpitWeatherEffects.enabled'), '1');
});

test('empty or unreadable storage keeps WX off', () => {
  resetWxPreferenceCache();
  assert.equal(readWxPreference(memoryStorage()), false);
  assert.equal(readWxPreference(null), false);
  assert.equal(readWxPreference({
    getItem() {
      throw new Error('blocked');
    },
  }), false);
});

test('reload keeps an explicit WX ON opt-in and writes 1|0 only', () => {
  const storage = memoryStorage();
  assert.equal(writeWxPreference(true, storage), true);
  assert.equal(storage.getItem(WX_STORAGE_KEY), '1');
  resetWxPreferenceCache();
  assert.equal(readWxPreference(storage), true);

  assert.equal(writeWxPreference(false, storage), false);
  assert.equal(storage.getItem(WX_STORAGE_KEY), '0');
});

test('get/setWxEnabled persist through a cache reset the way a reload would', () => {
  const storage = memoryStorage();
  resetWxPreferenceCache();
  assert.equal(getWxEnabled(storage), false);
  assert.equal(setWxEnabled(true, storage), true);
  resetWxPreferenceCache();
  assert.equal(getWxEnabled(storage), true);
});

test('WX off means no globe FX; WX on returns them only in a live cockpit', () => {
  assert.equal(weatherEffectsShouldRender({
    enabled: false, cockpitActive: true, suspended: false, destroyed: false,
  }), false);
  assert.equal(weatherEffectsShouldRender({
    enabled: true, cockpitActive: true, suspended: false, destroyed: false,
  }), true);
  assert.equal(weatherEffectsShouldRender({
    enabled: true, cockpitActive: false, suspended: false, destroyed: false,
  }), false);
});

test('offline and hidden-tab pauses still suppress weather FX while opted in', () => {
  assert.equal(weatherEffectsShouldRender({
    enabled: true, cockpitActive: true, suspended: true, destroyed: false,
  }), false);
  assert.equal(weatherEffectsShouldRender({
    enabled: true, cockpitActive: true, hidden: true, offline: false, destroyed: false,
  }), false);
  assert.equal(weatherEffectsShouldRender({
    enabled: true, cockpitActive: true, hidden: false, offline: true, destroyed: false,
  }), false);
  assert.equal(weatherEffectsShouldRender({
    enabled: true, cockpitActive: true, hidden: false, offline: false, destroyed: false,
  }), true);
});

test('the WX OFF | ON chrome paints pressed state and persists the click', () => {
  const storage = memoryStorage();
  resetWxPreferenceCache();
  const off = fakeButton({ 'aria-pressed': 'true' }, { wxMode: 'off' });
  const on = fakeButton({ 'aria-pressed': 'false' }, { wxMode: 'on' });
  const root = fakeToggleRoot([off, on]);
  const seen = [];

  bindWxToggle(root, {
    storage,
    onChange: (enabled) => seen.push(enabled),
  });
  assert.equal(off.getAttribute('aria-pressed'), 'true');
  assert.equal(on.getAttribute('aria-pressed'), 'false');

  root.click(on);
  assert.equal(getWxEnabled(storage), true);
  assert.equal(on.getAttribute('aria-pressed'), 'true');
  assert.equal(off.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(seen, [true]);

  syncWxToggleButtons(root, false);
  assert.equal(off.getAttribute('aria-pressed'), 'true');
  assert.equal(on.getAttribute('aria-pressed'), 'false');
});

test('the existing single WX footer toggle stays wired to the same flag', () => {
  const storage = memoryStorage();
  resetWxPreferenceCache();
  const toggle = fakeButton({ 'aria-pressed': 'false' }, { wxToggle: '' });
  const state = { textContent: 'OFF' };
  const presentation = weatherChromePresentation(true);
  assert.equal(presentation.pressed, 'true');
  assert.equal(presentation.stateText, 'ON');
  assert.match(presentation.ariaLabel, /Disable cockpit weather effects/);

  const root = fakeToggleRoot([toggle]);
  bindWxToggle(root, { storage, stateEl: state });
  root.click(toggle);
  assert.equal(getWxEnabled(storage), true);
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(state.textContent, 'ON');
});

test('Intel HUD and cockpit chrome host WX OFF | ON next to the existing clock', () => {
  const hud = readFileSync(new URL('./hud.js', import.meta.url), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const clouds = readFileSync(path.join(ROOT, 'src', 'cockpitCloudEffects.js'), 'utf8');
  const main = readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

  assert.match(hud, /import \{[^}]*bindWxToggle[^}]*\} from '\.\/weatherChrome\.js';/);
  assert.match(
    hud,
    /id="hud-timestamp"[\s\S]*?data-wx-mode="off"[\s\S]*?WX OFF[\s\S]*?data-wx-mode="on"[\s\S]*?WX ON/,
  );

  assert.match(
    html,
    /id="cockpit-clock"[\s\S]*?data-wx-mode="off"[\s\S]*?WX OFF[\s\S]*?data-wx-mode="on"[\s\S]*?WX ON/,
  );
  assert.match(html, /id="cockpit-weather-toggle"[^>]*data-wx-toggle/);
  assert.match(ui, /import \{[^}]*bindWxToggle[^}]*\} from '\.\/weatherChrome\.js';/);
  assert.match(clouds, /weatherEffectsShouldRender/);
  assert.match(main, /cockpitCloudEffects\?\.setSuspended\?\.\(state\.suspended\)/);
});

test('Local Info briefing still fetches weather and shows Open-Meteo credit when WX is off', () => {
  const ui = readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sources = readFileSync(path.join(ROOT, 'DATA_SOURCES.md'), 'utf8');

  const refresh = ui.match(/maybeRefreshRegionalBrief\(info\) \{([\s\S]*?)\n  \}/);
  assert.ok(refresh, 'regional brief refresh is missing');
  assert.match(refresh[1], /fetchRegionalBrief\(/);
  assert.doesNotMatch(refresh[1], /getWxEnabled|weatherToggle|cockpitWeather|WX_/);

  const credit = ui.match(/updateWeatherCredit\(weather\) \{([\s\S]*?)\n  \}/);
  assert.ok(credit, 'weather credit helper is missing');
  assert.match(credit[1], /weather && Number\.isFinite\(weather\.temperatureC\)/);
  assert.doesNotMatch(credit[1], /getWxEnabled|weatherToggle|cockpitWeather|WX_/);

  assert.match(
    html,
    /href="https:\/\/open-meteo\.com\/"[\s\S]*?Weather data by Open-Meteo\.com/,
  );
  assert.match(sources, /WX OFF[\s\S]*Open-Meteo credit/);

  const paint = ui.match(/paintLocalTemperature\(weather\) \{([\s\S]*?)\n  \}/);
  assert.ok(paint, 'temperature paint helper is missing');
  assert.match(paint[1], /formatTemperatureC\(weather\?\.temperatureC\)/);
  assert.doesNotMatch(paint[1], /getWxEnabled|weatherToggle|cockpitWeather|WX_/);
  assert.match(html, /id="cockpit-local-temperature"[\s\S]*?data-weather-units="C"[\s\S]*?°C[\s\S]*?data-weather-units="F"[\s\S]*?°F/);

  const windHelper = readFileSync(path.join(ROOT, 'src', 'data', 'weatherWindUnits.js'), 'utf8');
  const windUi = ui.match(/bindWindUnitToggle\(this\.windUnitToggle, \{([\s\S]*?)\n    \}\)/);
  assert.ok(windUi, 'wind unit chips must stay on Local Info');
  assert.doesNotMatch(windUi[1], /setWxEnabled|getWxEnabled|WX_/);
  assert.doesNotMatch(windHelper, /setWxEnabled|getWxEnabled|WX_STORAGE_KEY|weatherEffectsShouldRender/);
  assert.match(html, /id="cockpit-wind-units"[\s\S]*?data-wx-mode|data-wx-mode[\s\S]*?id="cockpit-wind-units"/);
});

test('share URLs, annotations, and trails stay off this chrome', () => {
  const share = readFileSync(path.join(ROOT, 'src', 'sharelink.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const weatherChrome = readFileSync(path.join(ROOT, 'src', 'weatherChrome.js'), 'utf8');

  assert.equal(share.includes(WX_STORAGE_KEY), false, 'sharelink must not read the WX flag');
  assert.doesNotMatch(share, /params\.set\('wx'/);
  assert.doesNotMatch(html, /data-annotation-chrome|data-trail-chrome/);
  assert.doesNotMatch(weatherChrome, /annotate_map|trailRenderer|OpenSky|news\.google|TeleGeography|quantum-earth/i);
});
