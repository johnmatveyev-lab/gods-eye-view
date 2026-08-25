import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

import {
  formatChromeClock,
  formatHudClock,
  getClockMode,
  resetClockPreferenceCache,
  setClockMode,
} from './clockPreference.js';
import {
  LIVE_SUN_DEFAULT,
  LIVE_SUN_STORAGE_KEY,
  applyLiveSunLighting,
  liveSunEnabledFromStoredValue,
  noonDateAtLongitude,
  readLiveSunPreference,
  writeLiveSunPreference,
} from './liveSunLighting.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (name) => readFileSync(path.join(ROOT, 'src', name), 'utf8');
const root = (name) => readFileSync(path.join(ROOT, name), 'utf8');

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
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
    keys() {
      return [...map.keys()];
    },
  };
}

function makeViewer({
  enableLighting = false,
  dynamicAtmosphereLighting = false,
  shouldAnimate = true,
  clockStep = 'SYSTEM_CLOCK_MULTIPLIER',
  currentTime = { dayNumber: 2460000, secondsOfDay: 1 },
} = {}) {
  return {
    clock: {
      shouldAnimate,
      clockStep,
      currentTime,
    },
    scene: {
      globe: {
        enableLighting,
        dynamicAtmosphereLighting,
      },
      requestRender() {
        this.renderCount = (this.renderCount || 0) + 1;
      },
    },
  };
}

test('missing meridian.liveSun defaults to the well-lit look already used in the app', () => {
  assert.equal(LIVE_SUN_STORAGE_KEY, 'meridian.liveSun');
  assert.equal(LIVE_SUN_DEFAULT, false);
  assert.equal(liveSunEnabledFromStoredValue(null), false);
  assert.equal(liveSunEnabledFromStoredValue(''), false);
  assert.equal(liveSunEnabledFromStoredValue('garbage'), false);
  assert.equal(liveSunEnabledFromStoredValue('0'), false);
  assert.equal(liveSunEnabledFromStoredValue('1'), true);
  assert.equal(liveSunEnabledFromStoredValue('true'), true);
  assert.equal(readLiveSunPreference(memoryStorage()), false);
  assert.equal(readLiveSunPreference(memoryStorage({ [LIVE_SUN_STORAGE_KEY]: '1' })), true);
});

test('live sun persists only meridian.liveSun and never opens /api', () => {
  const storage = memoryStorage();
  writeLiveSunPreference(storage, true);
  assert.equal(storage.getItem(LIVE_SUN_STORAGE_KEY), '1');
  writeLiveSunPreference(storage, false);
  assert.equal(storage.getItem(LIVE_SUN_STORAGE_KEY), '0');
  assert.deepEqual(storage.keys(), [LIVE_SUN_STORAGE_KEY]);

  const moduleSource = src('liveSunLighting.js');
  assert.doesNotMatch(moduleSource, /\/api\//);
  assert.doesNotMatch(moduleSource, /clerk/i);
  assert.doesNotMatch(moduleSource, /opensky/i);
  assert.doesNotMatch(moduleSource, /news\.google/i);
  assert.doesNotMatch(moduleSource, /telegeography/i);
  assert.doesNotMatch(moduleSource, /quantum-earth/i);
});

test('Sun on follows the real Cesium clock; terminator lighting is enabled', () => {
  const viewer = makeViewer({
    enableLighting: false,
    currentTime: { dayNumber: 1, secondsOfDay: 2 },
    clockStep: 'SYSTEM_CLOCK_MULTIPLIER',
    shouldAnimate: false,
  });
  const now = { dayNumber: 2461234, secondsOfDay: 43200 };
  const state = applyLiveSunLighting(viewer, true, {
    now,
    clockStep: 'SYSTEM_CLOCK',
  });

  assert.equal(viewer.scene.globe.enableLighting, true);
  assert.equal(viewer.scene.globe.dynamicAtmosphereLighting, true);
  assert.equal(viewer.clock.shouldAnimate, true);
  assert.equal(viewer.clock.clockStep, 'SYSTEM_CLOCK');
  assert.equal(viewer.clock.currentTime, now);
  assert.equal(state.liveSun, true);
  assert.equal(state.enableLighting, true);
});

test('Sun off keeps the globe lit without moving the Cesium clock', () => {
  const frozen = { dayNumber: 2460000, secondsOfDay: 99 };
  const viewer = makeViewer({
    enableLighting: true,
    dynamicAtmosphereLighting: true,
    currentTime: frozen,
    shouldAnimate: true,
    clockStep: 'SYSTEM_CLOCK',
  });
  const state = applyLiveSunLighting(viewer, false, {
    now: { dayNumber: 9, secondsOfDay: 9 },
    clockStep: 'SYSTEM_CLOCK',
  });

  assert.equal(viewer.scene.globe.enableLighting, false);
  assert.equal(viewer.scene.globe.dynamicAtmosphereLighting, false);
  assert.equal(viewer.clock.currentTime, frozen);
  assert.equal(viewer.clock.shouldAnimate, true);
  assert.equal(viewer.clock.clockStep, 'SYSTEM_CLOCK');
  assert.equal(state.liveSun, false);
  assert.equal(state.enableLighting, false);
});

test('noon-at-longitude is solar noon UTC for the camera lon', () => {
  const day = new Date(Date.UTC(2026, 7, 25, 3, 14, 0));
  assert.equal(noonDateAtLongitude(0, day).toISOString(), '2026-08-25T12:00:00.000Z');
  assert.equal(noonDateAtLongitude(-90, day).toISOString(), '2026-08-25T18:00:00.000Z');
  assert.equal(noonDateAtLongitude(90, day).toISOString(), '2026-08-25T06:00:00.000Z');
});

test('UTC/local toggle reformats the HUD clock and does not touch sun lighting', () => {
  const storage = memoryStorage();
  resetClockPreferenceCache();
  const utcDate = new Date(Date.UTC(2026, 7, 25, 18, 5, 9));
  assert.equal(formatChromeClock(utcDate, 'utc'), '18:05:09Z');
  assert.equal(formatHudClock(utcDate, 'utc'), '2026-08-25 18:05:09Z');
  assert.match(formatChromeClock(utcDate, 'local'), /^\d{2}:\d{2}:\d{2}$/);

  const viewer = makeViewer({ enableLighting: true, currentTime: { stamp: 1 } });
  applyLiveSunLighting(viewer, true, { now: viewer.clock.currentTime, clockStep: 'SYSTEM_CLOCK' });
  const before = {
    enableLighting: viewer.scene.globe.enableLighting,
    currentTime: viewer.clock.currentTime,
    clockStep: viewer.clock.clockStep,
  };

  assert.equal(setClockMode('local', storage), 'local');
  assert.equal(getClockMode(storage), 'local');
  assert.equal(viewer.scene.globe.enableLighting, before.enableLighting);
  assert.equal(viewer.clock.currentTime, before.currentTime);
  assert.equal(viewer.clock.clockStep, before.clockStep);
  setClockMode('utc', storage);
  resetClockPreferenceCache();
});

test('DISPLAY Sun control is lighting-only and independent of looks, WX, and imagery', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const lighting = src('liveSunLighting.js');
  const weather = src('cockpitCloudEffects.js');
  const stacks = src('mapStackController.js');
  const clock = src('clockPreference.js');

  assert.match(html, /id="live-sun-toggle"/);
  assert.match(html, /<span class="pp-label">Sun<\/span>/);
  assert.match(html, /id="cockpit-clock"[\s\S]*?data-clock-mode="utc"[\s\S]*?UTC[\s\S]*?data-clock-mode="local"/);
  assert.match(ui, /setLiveSunEnabled/);
  assert.match(ui, /applyLiveSunLighting/);
  assert.match(ui, /LIVE_SUN_STORAGE_KEY/);
  assert.match(clock, /meridian\.clock/);
  assert.doesNotMatch(clock, /enableLighting|applyLiveSunLighting/);

  assert.doesNotMatch(lighting, /createWorldImagery|IonWorldImagery|photoreal|setStack\(/);
  assert.doesNotMatch(lighting, /setStyle\(|stages\[|bloom|sharpen|nightVision|thermal/);
  assert.doesNotMatch(lighting, /gev:cockpit-weather|godsEyeView\.cockpitWeatherEffects/);
  assert.match(weather, /writeWxPreference/);
  assert.doesNotMatch(weather, /godsEyeView\.cockpitWeatherEffects/);
  const wx = src('weatherChrome.js');
  assert.match(wx, /prefKey\('cockpitWeatherEffects\.enabled'\)/);
  assert.doesNotMatch(wx, /WX_STORAGE_KEY = 'godsEyeView\.cockpitWeatherEffects\.enabled'/);
  assert.match(stacks, /id: 'photoreal'/);
  assert.equal((stacks.match(/id: '/g) || []).length, 4, 'no new imagery stack');
});

test('credits stay visible; lighting does not hide Google Maps attribution', () => {
  const css = root('style.css');
  const lighting = src('liveSunLighting.js');
  const main = src('main.js');
  assert.match(main, /id = 'cesium-credits'/);
  assert.match(css, /body\.ui-clean-view #cesium-credits/);
  assert.doesNotMatch(lighting, /cesium-credits|creditContainer|display:\s*none/);
});

test('legal: lighting-only, Meridian title, MIT credit, no banned sources', () => {
  const lighting = src('liveSunLighting.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(lighting, /OpenSky|Google News|TeleGeography|God'?s Eye View|quantum-earth/i);
  assert.doesNotMatch(html, /id="live-sun-toggle"[\s\S]*OpenSky/);
});
