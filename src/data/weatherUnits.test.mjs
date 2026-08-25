// PLAN 135 — client-only °C | °F chips for already-fetched Open-Meteo
// temperatures. Default °C. Persist separately from km/nm/mi. Chip change
// re-applies the in-memory observation; no new /api.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_DISTANCE_UNIT, UNITS_STORAGE_KEY, getDistanceUnit } from '../units.js';
import { DEFAULT_WX_ENABLED, WX_STORAGE_KEY, getWxEnabled, resetWxPreferenceCache } from '../weatherChrome.js';
import { normalizeRegionalWeather } from './regionalBrief.js';
import {
  DEFAULT_TEMPERATURE_UNIT,
  TEMPERATURE_UNITS,
  WEATHER_UNITS_STORAGE_KEY,
  bindWeatherUnitToggle,
  celsiusToFahrenheit,
  convertTemperatureC,
  formatTemperatureC,
  getTemperatureUnit,
  initWeatherUnits,
  normalizeTemperatureUnit,
  resetWeatherUnitsForTests,
  setTemperatureUnit,
  subscribeWeatherUnits,
} from './weatherUnits.js';

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

function fakeButton(unit, attrs = {}) {
  return {
    dataset: { weatherUnits: unit },
    attrs: { 'aria-pressed': unit === 'C' ? 'true' : 'false', ...attrs },
    getAttribute(name) {
      return this.attrs[name];
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    closest(selector) {
      return selector === '[data-weather-units]' ? this : null;
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
      return selector === '[data-weather-units]' ? buttons : [];
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
  resetWeatherUnitsForTests();
  resetWxPreferenceCache();
});

test('°C matches the current rounded Local Info number', () => {
  assert.equal(DEFAULT_TEMPERATURE_UNIT, 'C');
  assert.deepEqual([...TEMPERATURE_UNITS], ['C', 'F']);
  assert.equal(SAMPLE_WEATHER.temperatureC, 21.4);
  assert.equal(formatTemperatureC(SAMPLE_WEATHER.temperatureC, 'C'), '21°C');
  assert.equal(formatTemperatureC(SAMPLE_WEATHER.apparentTemperatureC, 'C'), '21°C');
  assert.equal(formatTemperatureC(21.4), '21°C');
});

test('°F converts the same in-memory Celsius observation', () => {
  assert.equal(celsiusToFahrenheit(21.4), 21.4 * (9 / 5) + 32);
  assert.equal(formatTemperatureC(SAMPLE_WEATHER.temperatureC, 'F'), '71°F');
  assert.equal(formatTemperatureC(SAMPLE_WEATHER.apparentTemperatureC, 'F'), '69°F');
  assert.equal(convertTemperatureC(0, 'F').value, 32);
  assert.equal(convertTemperatureC(100, 'F').value, 212);
  assert.equal(formatTemperatureC(Number.NaN, 'F'), '—');
  assert.equal(normalizeTemperatureUnit('fahrenheit'), 'F');
  assert.equal(normalizeTemperatureUnit('kelvin'), null);
});

test('meridian.weatherUnits persists separately from km/nm/mi and WX', () => {
  assert.equal(WEATHER_UNITS_STORAGE_KEY, 'meridian.weatherUnits');
  assert.notEqual(WEATHER_UNITS_STORAGE_KEY, UNITS_STORAGE_KEY);
  assert.notEqual(WEATHER_UNITS_STORAGE_KEY, WX_STORAGE_KEY);

  const storage = memoryStorage();
  assert.equal(initWeatherUnits({ storage }), 'C');
  assert.equal(setTemperatureUnit('F', { storage }), 'F');
  assert.equal(storage.getItem(WEATHER_UNITS_STORAGE_KEY), 'F');
  assert.equal(storage.getItem(UNITS_STORAGE_KEY), null);
  assert.equal(storage.getItem(WX_STORAGE_KEY), null);
  assert.equal(getDistanceUnit(), DEFAULT_DISTANCE_UNIT);
  assert.equal(getWxEnabled(storage), DEFAULT_WX_ENABLED);

  resetWeatherUnitsForTests();
  assert.equal(initWeatherUnits({ storage }), 'F');
  assert.equal(formatTemperatureC(SAMPLE_WEATHER.temperatureC, 'F'), '71°F');
});

test('subscribers hear a temperature-unit change once', () => {
  const seen = [];
  const stop = subscribeWeatherUnits((unit, previous) => seen.push([unit, previous]));
  try {
    setTemperatureUnit('F', { persist: false });
    setTemperatureUnit('F', { persist: false });
    assert.deepEqual(seen, [['F', 'C']]);
  } finally {
    stop();
    resetWeatherUnitsForTests();
  }
});

test('chip change re-applies the cached observation and does not fetch', () => {
  const fetches = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetches.push(args[0]);
    throw new Error('chip change must not fetch');
  };
  const c = fakeButton('C');
  const f = fakeButton('F');
  const root = fakeToggleRoot([c, f]);
  const painted = [];
  try {
    bindWeatherUnitToggle(root, {
      persist: false,
      onChange: (unit) => {
        painted.push(formatTemperatureC(SAMPLE_WEATHER.temperatureC, unit));
      },
    });
    assert.equal(c.getAttribute('aria-pressed'), 'true');
    assert.equal(f.getAttribute('aria-pressed'), 'false');
    root.click(f);
    assert.equal(getTemperatureUnit(), 'F');
    assert.equal(f.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(painted, ['71°F']);
    assert.deepEqual(fetches, []);
  } finally {
    globalThis.fetch = originalFetch;
    resetWeatherUnitsForTests();
  }
});

test('Local Info hosts °C | °F next to TEMP; Display units stay km | nm | mi', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/weatherUnits.js'), 'utf8');

  const local = html.match(/data-cockpit-brief-page="local"[\s\S]*?<\/section>/);
  assert.ok(local, 'Local Info briefing is missing');
  assert.match(local[0], /id="cockpit-local-temperature"/);
  assert.match(local[0], /data-weather-units="C"[^>]*>°C</);
  assert.match(local[0], /data-weather-units="F"[^>]*>°F</);
  assert.match(local[0], /class="weather-unit-toggle"/);

  const unitsRow = html.match(/id="units-row"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(unitsRow, 'Display units row is missing');
  assert.match(unitsRow[0], /data-units="km"/);
  assert.match(unitsRow[0], /data-units="nm"/);
  assert.match(unitsRow[0], /data-units="mi"/);
  assert.doesNotMatch(unitsRow[0], /data-weather-units|°C|°F/);

  assert.match(ui, /bindWeatherUnitToggle|formatTemperatureC|initWeatherUnits/);
  assert.match(ui, /paintLocalTemperature|regionalBrief\?\.weather/);
  assert.doesNotMatch(helper, /UNITS_STORAGE_KEY|meridian\.units['"`]|setDistanceUnit|setWxEnabled/);
});

test('chip wiring re-paints from the in-memory brief and adds no /api', () => {
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/weatherUnits.js'), 'utf8');
  const weatherEffects = readFileSync(path.join(ROOT, 'src/data/weatherEffects.js'), 'utf8');
  const paint = ui.match(/paintLocalTemperature\(weather\) \{([\s\S]*?)\n  \}/);
  const bind = ui.match(/bindWeatherUnitToggle\([\s\S]*?\}\);/);
  assert.ok(paint, 'paintLocalTemperature is missing');
  assert.ok(bind, 'weather unit chip bind is missing');
  assert.match(paint[1], /formatTemperatureC\(weather\?\.temperatureC\)/);
  assert.doesNotMatch(paint[1], /fetchRegionalBrief|\/api\/weather-effects|\/api\/regional-brief/);
  assert.match(bind[0], /this\.regionalBrief\?\.weather/);
  assert.doesNotMatch(bind[0], /fetchRegionalBrief|maybeRefreshRegionalBrief|\/api\/weather-effects/);
  assert.doesNotMatch(helper, /\/api\/weather-units|\/api\/temperature/);
  assert.match(weatherEffects, /temperatureC:/);
  assert.doesNotMatch(weatherEffects, /temperatureF|weatherUnits|setTemperatureUnit/);

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
  assert.equal(existsSync(path.join(ROOT, 'api/weather-units.js')), false);
  assert.equal(files.some((file) => /weather-unit|temperature-unit/i.test(file)), false);
});

test('WX on/off and legal surfaces stay independent of temperature chips', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/weatherUnits.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  assert.match(html, /data-wx-mode="off"[\s\S]*?WX OFF[\s\S]*?data-wx-mode="on"[\s\S]*?WX ON/);
  assert.match(html, /id="cockpit-weather-toggle"[^>]*data-wx-toggle/);
  const refresh = ui.match(/maybeRefreshRegionalBrief\(info\) \{([\s\S]*?)\n  \}/);
  assert.ok(refresh, 'regional brief refresh is missing');
  assert.doesNotMatch(refresh[1], /getTemperatureUnit|setTemperatureUnit|weatherUnits/);
  assert.match(helper, /not an alert service/i);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.match(html, /Weather data by Open-Meteo\.com/);
});
