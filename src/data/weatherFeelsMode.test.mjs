// PLAN 154 — client-only Actual | Feels chips for already-fetched Open-Meteo
// temperatures. Default Actual. Feels formats apparentTemperatureC with the
// existing °C/°F converter. Missing/non-finite apparent stays UNAVAILABLE
// (no silent fallback to actual). Persist separately from °C/°F, wind,
// precip, and km/nm/mi. Chip change re-applies the in-memory observation;
// no new /api. HUD/weather off hides the chips.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_DISTANCE_UNIT, UNITS_STORAGE_KEY, getDistanceUnit } from '../units.js';
import { DEFAULT_WX_ENABLED, WX_STORAGE_KEY, getWxEnabled, resetWxPreferenceCache } from '../weatherChrome.js';
import { WEATHER_UNITS_STORAGE_KEY, formatTemperatureC, resetWeatherUnitsForTests, setTemperatureUnit } from './weatherUnits.js';
import { WIND_UNITS_STORAGE_KEY } from './weatherWindUnits.js';
import { WEATHER_PRECIP_UNITS_STORAGE_KEY } from './weatherPrecipUnits.js';
import { normalizeRegionalWeather } from './regionalBrief.js';
import {
  DEFAULT_WEATHER_FEELS_MODE,
  WEATHER_FEELS_MODES,
  WEATHER_FEELS_STORAGE_KEY,
  bindWeatherFeelsToggle,
  formatApparentTemperatureC,
  formatWeatherHudTemperature,
  getWeatherFeelsMode,
  initWeatherFeelsMode,
  normalizeWeatherFeelsMode,
  resetWeatherFeelsModeForTests,
  setWeatherFeelsMode,
  subscribeWeatherFeelsMode,
  weatherFeelsChipsHidden,
} from './weatherFeelsMode.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SAMPLE_WEATHER = normalizeRegionalWeather({
  current: {
    time: '2026-07-22T08:15:00Z',
    temperature_2m: 21.4,
    apparent_temperature: 20.8,
    precipitation: 0,
    cloud_cover: 42,
    wind_speed_10m: 18.2,
    wind_direction_10m: 270,
    visibility: 18000,
    weather_code: 2,
  },
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function fakeButton(mode, attrs = {}) {
  return {
    dataset: { weatherFeels: mode },
    attrs: { 'aria-pressed': mode === 'actual' ? 'true' : 'false', ...attrs },
    getAttribute(name) {
      return this.attrs[name];
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    closest(selector) {
      return selector === '[data-weather-feels]' ? this : null;
    },
  };
}

function fakeToggleRoot(buttons) {
  const listeners = new Map();
  return {
    buttons,
    contains(node) {
      return buttons.includes(node);
    },
    querySelectorAll(selector) {
      return selector === '[data-weather-feels]' ? buttons : [];
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

test.afterEach(() => {
  resetWeatherFeelsModeForTests();
  resetWeatherUnitsForTests();
  resetWxPreferenceCache();
});

test('Actual matches the current HUD temperature readout', () => {
  assert.equal(DEFAULT_WEATHER_FEELS_MODE, 'actual');
  assert.deepEqual([...WEATHER_FEELS_MODES], ['actual', 'feels']);
  assert.equal(SAMPLE_WEATHER.temperatureC, 21.4);
  assert.equal(SAMPLE_WEATHER.apparentTemperatureC, 20.8);
  assert.equal(formatWeatherHudTemperature(SAMPLE_WEATHER, 'actual', 'C'), '21°C');
  assert.equal(
    formatWeatherHudTemperature(SAMPLE_WEATHER, 'actual', 'C'),
    formatTemperatureC(SAMPLE_WEATHER.temperatureC, 'C'),
  );
  assert.equal(formatWeatherHudTemperature(SAMPLE_WEATHER, 'actual'), '21°C');
});

test('Feels + °C shows rounded apparentTemperatureC', () => {
  assert.equal(formatApparentTemperatureC(SAMPLE_WEATHER.apparentTemperatureC, 'C'), '21°C');
  assert.equal(formatWeatherHudTemperature(SAMPLE_WEATHER, 'feels', 'C'), '21°C');
  assert.equal(formatApparentTemperatureC(20.4, 'C'), '20°C');
  assert.equal(normalizeWeatherFeelsMode('feels'), 'feels');
  assert.equal(normalizeWeatherFeelsMode('apparent'), 'feels');
  assert.equal(normalizeWeatherFeelsMode('kelvin'), null);
});

test('switching to °F converts feels too', () => {
  assert.equal(formatApparentTemperatureC(SAMPLE_WEATHER.apparentTemperatureC, 'F'), '69°F');
  assert.equal(formatWeatherHudTemperature(SAMPLE_WEATHER, 'feels', 'F'), '69°F');
  assert.equal(formatWeatherHudTemperature(SAMPLE_WEATHER, 'actual', 'F'), '71°F');
  setTemperatureUnit('F', { persist: false });
  assert.equal(formatWeatherHudTemperature(SAMPLE_WEATHER, 'feels'), '69°F');
});

test('missing or non-finite apparent stays UNAVAILABLE without falling back to actual', () => {
  assert.equal(formatApparentTemperatureC(null, 'C'), 'UNAVAILABLE');
  assert.equal(formatApparentTemperatureC(undefined, 'F'), 'UNAVAILABLE');
  assert.equal(formatApparentTemperatureC(Number.NaN, 'C'), 'UNAVAILABLE');
  assert.equal(formatApparentTemperatureC(Number.POSITIVE_INFINITY, 'C'), 'UNAVAILABLE');
  const missingApparent = { temperatureC: 21.4, apparentTemperatureC: null };
  assert.equal(formatWeatherHudTemperature(missingApparent, 'feels', 'C'), 'UNAVAILABLE');
  assert.notEqual(formatWeatherHudTemperature(missingApparent, 'feels', 'C'), '21°C');
  assert.equal(formatWeatherHudTemperature(missingApparent, 'actual', 'C'), '21°C');
});

test('HUD or weather off hides the Actual | Feels chips', () => {
  assert.equal(weatherFeelsChipsHidden({ weather: SAMPLE_WEATHER, hudHidden: false }), false);
  assert.equal(weatherFeelsChipsHidden({ weather: SAMPLE_WEATHER, hudHidden: true }), true);
  assert.equal(weatherFeelsChipsHidden({ weather: null, hudHidden: false }), true);
  assert.equal(weatherFeelsChipsHidden({ weather: {}, hudHidden: false }), true);
  assert.equal(weatherFeelsChipsHidden({
    weather: { temperatureC: Number.NaN, apparentTemperatureC: 20.8 },
    hudHidden: false,
  }), true);
});

test('meridian.weatherFeels persists separately from °C/°F, wind, precip, km/nm/mi, and WX', () => {
  assert.equal(WEATHER_FEELS_STORAGE_KEY, 'meridian.weatherFeels');
  assert.notEqual(WEATHER_FEELS_STORAGE_KEY, UNITS_STORAGE_KEY);
  assert.notEqual(WEATHER_FEELS_STORAGE_KEY, WX_STORAGE_KEY);
  assert.notEqual(WEATHER_FEELS_STORAGE_KEY, WEATHER_UNITS_STORAGE_KEY);
  assert.notEqual(WEATHER_FEELS_STORAGE_KEY, WIND_UNITS_STORAGE_KEY);
  assert.notEqual(WEATHER_FEELS_STORAGE_KEY, WEATHER_PRECIP_UNITS_STORAGE_KEY);

  const storage = memoryStorage({
    [WEATHER_UNITS_STORAGE_KEY]: 'F',
    [WIND_UNITS_STORAGE_KEY]: 'kt',
    [WEATHER_PRECIP_UNITS_STORAGE_KEY]: 'in',
    [UNITS_STORAGE_KEY]: 'mi',
    [WX_STORAGE_KEY]: '1',
  });
  assert.equal(initWeatherFeelsMode({ storage }), 'actual');
  assert.equal(setWeatherFeelsMode('feels', { storage }), 'feels');
  assert.equal(storage.getItem(WEATHER_FEELS_STORAGE_KEY), 'feels');
  assert.equal(storage.getItem(WEATHER_UNITS_STORAGE_KEY), 'F');
  assert.equal(storage.getItem(WIND_UNITS_STORAGE_KEY), 'kt');
  assert.equal(storage.getItem(WEATHER_PRECIP_UNITS_STORAGE_KEY), 'in');
  assert.equal(storage.getItem(UNITS_STORAGE_KEY), 'mi');
  assert.equal(storage.getItem(WX_STORAGE_KEY), '1');
  assert.equal(getDistanceUnit(), DEFAULT_DISTANCE_UNIT);
  assert.equal(getWxEnabled(memoryStorage()), DEFAULT_WX_ENABLED);

  resetWeatherFeelsModeForTests();
  assert.equal(initWeatherFeelsMode({ storage }), 'feels');
  assert.equal(formatWeatherHudTemperature(SAMPLE_WEATHER, getWeatherFeelsMode(), 'C'), '21°C');
});

test('subscribers hear a feels-mode change once', () => {
  const seen = [];
  const stop = subscribeWeatherFeelsMode((mode, previous) => seen.push([mode, previous]));
  try {
    setWeatherFeelsMode('feels', { persist: false });
    setWeatherFeelsMode('feels', { persist: false });
    assert.deepEqual(seen, [['feels', 'actual']]);
  } finally {
    stop();
    resetWeatherFeelsModeForTests();
  }
});

test('chip change re-applies the cached observation and does not fetch', () => {
  const fetches = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetches.push(args[0]);
    throw new Error('chip change must not fetch');
  };
  const actual = fakeButton('actual');
  const feels = fakeButton('feels');
  const root = fakeToggleRoot([actual, feels]);
  const painted = [];
  try {
    bindWeatherFeelsToggle(root, {
      persist: false,
      onChange: (mode) => {
        painted.push(formatWeatherHudTemperature(SAMPLE_WEATHER, mode, 'C'));
      },
    });
    assert.equal(actual.getAttribute('aria-pressed'), 'true');
    assert.equal(feels.getAttribute('aria-pressed'), 'false');
    root.click(feels);
    assert.equal(getWeatherFeelsMode(), 'feels');
    assert.equal(feels.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(painted, ['21°C']);
    assert.deepEqual(fetches, []);
  } finally {
    globalThis.fetch = originalFetch;
    resetWeatherFeelsModeForTests();
  }
});

test('Local Info hosts Actual | Feels next to TEMP; other unit chips stay put', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/weatherFeelsMode.js'), 'utf8');

  const local = html.match(/data-cockpit-brief-page="local"[\s\S]*?<\/section>/);
  assert.ok(local, 'Local Info briefing is missing');
  assert.match(local[0], /id="cockpit-local-temperature"/);
  assert.match(local[0], /data-weather-feels="actual"[^>]*>Actual</);
  assert.match(local[0], /data-weather-feels="feels"[^>]*>Feels</);
  assert.match(local[0], /class="[^"]*weather-feels-toggle[^"]*"/);
  assert.match(local[0], /data-weather-units="C"[^>]*>°C</);
  assert.match(local[0], /data-weather-units="F"[^>]*>°F</);

  const unitsRow = html.match(/id="units-row"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(unitsRow, 'Display units row is missing');
  assert.match(unitsRow[0], /data-units="km"/);
  assert.match(unitsRow[0], /data-units="nm"/);
  assert.match(unitsRow[0], /data-units="mi"/);
  assert.doesNotMatch(unitsRow[0], /data-weather-feels|weather-feels-toggle/);

  assert.match(ui, /bindWeatherFeelsToggle|formatWeatherHudTemperature|initWeatherFeelsMode/);
  assert.match(ui, /paintLocalTemperature|regionalBrief\?\.weather/);
  assert.doesNotMatch(helper, /from ['"]\.\.\/units\.js['"]|setDistanceUnit|setWxEnabled|setTemperatureUnit|setWindUnit|setPrecipUnit/);
  assert.doesNotMatch(helper, /['"]meridian\.units['"]|['"]meridian\.weatherUnits['"]|['"]meridian\.weatherWind['"]|['"]meridian\.weatherPrecipUnits['"]|['"]meridian\.weatherVisibility['"]/);
});

test('chip wiring re-paints from the in-memory brief and adds no /api', () => {
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/weatherFeelsMode.js'), 'utf8');
  const weatherEffects = readFileSync(path.join(ROOT, 'src/data/weatherEffects.js'), 'utf8');
  const paint = ui.match(/paintLocalTemperature\(weather\) \{([\s\S]*?)\n  \}/);
  const bind = ui.match(/bindWeatherFeelsToggle\([\s\S]*?\}\);/);
  assert.ok(paint, 'paintLocalTemperature is missing');
  assert.ok(bind, 'weather feels chip bind is missing');
  assert.match(paint[1], /formatWeatherHudTemperature\(|formatApparentTemperatureC\(/);
  assert.match(paint[1], /formatTemperatureC\(weather\?\.temperatureC\)|formatWeatherHudTemperature\(/);
  assert.doesNotMatch(paint[1], /fetchRegionalBrief|\/api\/weather-effects|\/api\/regional-brief/);
  assert.match(bind[0], /this\.regionalBrief\?\.weather/);
  assert.doesNotMatch(bind[0], /fetchRegionalBrief|maybeRefreshRegionalBrief|\/api\/weather-effects/);
  assert.doesNotMatch(helper, /\/api\/weather-feels|\/api\/apparent/);
  assert.match(weatherEffects, /normalizeRegionalWeather/);
  assert.match(weatherEffects, /apparent_temperature/);
  assert.doesNotMatch(weatherEffects, /weatherFeels|setWeatherFeelsMode|formatApparentTemperatureC/);

  const apiDir = path.join(ROOT, 'api');
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else files.push(path.relative(apiDir, absolute).split(path.sep).join('/'));
    }
  };
  visit(apiDir);
  assert.ok(files.includes('weather-effects.js'));
  assert.ok(files.includes('regional-brief.js'));
  assert.equal(existsSync(path.join(ROOT, 'api/weather-feels.js')), false);
  assert.equal(files.some((file) => /weather-feel|apparent-temp/i.test(file)), false);
});

test('WX on/off and legal surfaces stay independent of feels chips', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/weatherFeelsMode.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  assert.match(html, /data-wx-mode="off"[\s\S]*?WX OFF[\s\S]*?data-wx-mode="on"[\s\S]*?WX ON/);
  assert.match(html, /id="cockpit-weather-toggle"[^>]*data-wx-toggle/);
  const refresh = ui.match(/maybeRefreshRegionalBrief\(info\) \{([\s\S]*?)\n  \}/);
  assert.ok(refresh, 'regional brief refresh is missing');
  assert.doesNotMatch(refresh[1], /getWeatherFeelsMode|setWeatherFeelsMode|weatherFeels/);
  assert.match(helper, /not an alert service/i);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.match(html, /Weather data by Open-Meteo\.com/);
  assert.match(html, /<title>Meridian<\/title>/);
});
