// PLAN 185 — client-only km | mi chips for already-fetched Open-Meteo
// visibility. Default km. Persist separately from °C/°F, wind, precip,
// feels, and km/nm/mi. Chip change re-applies the in-memory observation;
// no new /api. HUD/weather off hides the chips.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_DISTANCE_UNIT, UNITS_STORAGE_KEY, getDistanceUnit } from '../units.js';
import { DEFAULT_WX_ENABLED, WX_STORAGE_KEY, getWxEnabled, resetWxPreferenceCache } from '../weatherChrome.js';
import { WEATHER_UNITS_STORAGE_KEY } from './weatherUnits.js';
import { WIND_UNITS_STORAGE_KEY } from './weatherWindUnits.js';
import { WEATHER_PRECIP_UNITS_STORAGE_KEY } from './weatherPrecipUnits.js';
import { WEATHER_FEELS_STORAGE_KEY } from './weatherFeelsMode.js';
import { normalizeRegionalWeather } from './regionalBrief.js';
import {
  DEFAULT_VISIBILITY_UNIT,
  METERS_PER_KILOMETER,
  METERS_PER_STATUTE_MILE,
  VISIBILITY_UNITS,
  WEATHER_VISIBILITY_STORAGE_KEY,
  bindWeatherVisibilityUnitToggle,
  convertVisibilityM,
  formatVisibilityM,
  getVisibilityUnit,
  initWeatherVisibilityUnits,
  metersToKm,
  metersToMiles,
  normalizeVisibilityUnit,
  resetWeatherVisibilityUnitsForTests,
  setVisibilityUnit,
  subscribeWeatherVisibilityUnits,
  weatherVisibilityChipsHidden,
} from './weatherVisibilityUnits.js';

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
    dataset: { weatherVisibility: unit },
    attrs: { 'aria-pressed': unit === 'km' ? 'true' : 'false', ...attrs },
    getAttribute(name) {
      return this.attrs[name];
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    closest(selector) {
      return selector === '[data-weather-visibility]' ? this : null;
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
      return selector === '[data-weather-visibility]' ? buttons : [];
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
  resetWeatherVisibilityUnitsForTests();
  resetWxPreferenceCache();
});

test('8000 m reads 8 km and 5 mi from the same visibilityM observation', () => {
  assert.equal(DEFAULT_VISIBILITY_UNIT, 'km');
  assert.deepEqual([...VISIBILITY_UNITS], ['km', 'mi']);
  assert.equal(METERS_PER_KILOMETER, 1000);
  assert.equal(METERS_PER_STATUTE_MILE, 1609.344);
  assert.equal(metersToKm(8000), 8);
  assert.equal(metersToMiles(8000), 8000 / 1609.344);
  assert.equal(formatVisibilityM(8000, 'km'), '8 km');
  assert.equal(formatVisibilityM(8000, 'mi'), '5 mi');
  assert.equal(convertVisibilityM(8000, 'km').value, 8);
  assert.equal(formatVisibilityM(SAMPLE_WEATHER.visibilityM, 'km'), '18 km');
  assert.equal(SAMPLE_WEATHER.visibilityM, 18000);
  assert.equal(normalizeVisibilityUnit('miles'), 'mi');
  assert.equal(normalizeVisibilityUnit('kilometres'), 'km');
  assert.equal(normalizeVisibilityUnit('nm'), null);
});

test('missing or non-finite visibility stays UNAVAILABLE', () => {
  assert.equal(formatVisibilityM(null, 'km'), 'UNAVAILABLE');
  assert.equal(formatVisibilityM(undefined, 'mi'), 'UNAVAILABLE');
  assert.equal(formatVisibilityM('', 'km'), 'UNAVAILABLE');
  assert.equal(formatVisibilityM(Number.NaN, 'mi'), 'UNAVAILABLE');
  assert.equal(formatVisibilityM(Number.POSITIVE_INFINITY, 'km'), 'UNAVAILABLE');
  assert.equal(formatVisibilityM(-1, 'km'), 'UNAVAILABLE');
});

test('HUD or weather off hides the km | mi chips', () => {
  assert.equal(weatherVisibilityChipsHidden({ weather: SAMPLE_WEATHER, hudHidden: false }), false);
  assert.equal(weatherVisibilityChipsHidden({ weather: SAMPLE_WEATHER, hudHidden: true }), true);
  assert.equal(weatherVisibilityChipsHidden({ weather: null, hudHidden: false }), true);
  assert.equal(weatherVisibilityChipsHidden({ weather: {}, hudHidden: false }), true);
  assert.equal(weatherVisibilityChipsHidden({
    weather: { visibilityM: Number.NaN },
    hudHidden: false,
  }), true);
});

test('meridian.weatherVisibility persists separately from other weather units', () => {
  assert.equal(WEATHER_VISIBILITY_STORAGE_KEY, 'meridian.weatherVisibility');
  assert.notEqual(WEATHER_VISIBILITY_STORAGE_KEY, UNITS_STORAGE_KEY);
  assert.notEqual(WEATHER_VISIBILITY_STORAGE_KEY, WX_STORAGE_KEY);
  assert.notEqual(WEATHER_VISIBILITY_STORAGE_KEY, WEATHER_UNITS_STORAGE_KEY);
  assert.notEqual(WEATHER_VISIBILITY_STORAGE_KEY, WIND_UNITS_STORAGE_KEY);
  assert.notEqual(WEATHER_VISIBILITY_STORAGE_KEY, WEATHER_PRECIP_UNITS_STORAGE_KEY);
  assert.notEqual(WEATHER_VISIBILITY_STORAGE_KEY, WEATHER_FEELS_STORAGE_KEY);

  const storage = memoryStorage({
    [WEATHER_UNITS_STORAGE_KEY]: 'F',
    [WIND_UNITS_STORAGE_KEY]: 'kt',
    [WEATHER_PRECIP_UNITS_STORAGE_KEY]: 'in',
    [WEATHER_FEELS_STORAGE_KEY]: 'feels',
    [UNITS_STORAGE_KEY]: 'mi',
    [WX_STORAGE_KEY]: '1',
  });
  assert.equal(initWeatherVisibilityUnits({ storage }), 'km');
  assert.equal(setVisibilityUnit('mi', { storage }), 'mi');
  assert.equal(storage.getItem(WEATHER_VISIBILITY_STORAGE_KEY), 'mi');
  assert.equal(storage.getItem(WEATHER_UNITS_STORAGE_KEY), 'F');
  assert.equal(storage.getItem(WIND_UNITS_STORAGE_KEY), 'kt');
  assert.equal(storage.getItem(WEATHER_PRECIP_UNITS_STORAGE_KEY), 'in');
  assert.equal(storage.getItem(WEATHER_FEELS_STORAGE_KEY), 'feels');
  assert.equal(storage.getItem(UNITS_STORAGE_KEY), 'mi');
  assert.equal(storage.getItem(WX_STORAGE_KEY), '1');
  assert.equal(getDistanceUnit(), DEFAULT_DISTANCE_UNIT);
  assert.equal(getWxEnabled(memoryStorage()), DEFAULT_WX_ENABLED);

  resetWeatherVisibilityUnitsForTests();
  assert.equal(initWeatherVisibilityUnits({ storage }), 'mi');
  assert.equal(formatVisibilityM(8000, getVisibilityUnit()), '5 mi');
});

test('subscribers hear a visibility-unit change once', () => {
  const seen = [];
  const stop = subscribeWeatherVisibilityUnits((unit, previous) => seen.push([unit, previous]));
  try {
    setVisibilityUnit('mi', { persist: false });
    setVisibilityUnit('mi', { persist: false });
    assert.deepEqual(seen, [['mi', 'km']]);
  } finally {
    stop();
    resetWeatherVisibilityUnitsForTests();
  }
});

test('chip change re-applies the cached observation and does not fetch', () => {
  const fetches = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetches.push(args[0]);
    throw new Error('chip change must not fetch');
  };
  const km = fakeButton('km');
  const miles = fakeButton('mi');
  const root = fakeToggleRoot([km, miles]);
  const painted = [];
  try {
    bindWeatherVisibilityUnitToggle(root, {
      persist: false,
      onChange: (unit) => {
        painted.push(formatVisibilityM(8000, unit));
      },
    });
    assert.equal(km.getAttribute('aria-pressed'), 'true');
    assert.equal(miles.getAttribute('aria-pressed'), 'false');
    root.click(miles);
    assert.equal(getVisibilityUnit(), 'mi');
    assert.equal(miles.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(painted, ['5 mi']);
    assert.deepEqual(fetches, []);
  } finally {
    globalThis.fetch = originalFetch;
    resetWeatherVisibilityUnitsForTests();
  }
});

test('Local Info hosts km | mi next to VIS; Display units stay km | nm | mi', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/weatherVisibilityUnits.js'), 'utf8');

  const local = html.match(/data-cockpit-brief-page="local"[\s\S]*?<\/section>/);
  assert.ok(local, 'Local Info briefing is missing');
  assert.match(local[0], /id="cockpit-local-visibility"/);
  assert.match(local[0], /data-weather-visibility="km"[^>]*>km</);
  assert.match(local[0], /data-weather-visibility="mi"[^>]*>mi</);
  assert.match(local[0], /class="[^"]*weather-visibility-toggle[^"]*"/);
  assert.match(local[0], /data-weather-precip-units="mm"/);
  assert.match(local[0], /data-weather-feels="actual"/);

  const unitsRow = html.match(/id="units-row"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(unitsRow, 'Display units row is missing');
  assert.match(unitsRow[0], /data-units="km"/);
  assert.match(unitsRow[0], /data-units="nm"/);
  assert.match(unitsRow[0], /data-units="mi"/);
  assert.doesNotMatch(unitsRow[0], /data-weather-visibility|weather-visibility-toggle/);

  assert.match(ui, /bindWeatherVisibilityUnitToggle|formatVisibilityM|initWeatherVisibilityUnits/);
  assert.match(ui, /paintWeatherVisibility|regionalBrief\?\.weather/);
  assert.doesNotMatch(helper, /from ['"]\.\.\/units\.js['"]|setDistanceUnit|setWxEnabled|setTemperatureUnit|setWindUnit|setPrecipUnit|setWeatherFeelsMode/);
  assert.doesNotMatch(
    helper,
    /['"]meridian\.units['"]|['"]meridian\.weatherUnits['"]|['"]meridian\.weatherWind['"]|['"]meridian\.weatherPrecipUnits['"]|['"]meridian\.weatherFeels['"]/,
  );
});

test('chip wiring re-paints from the in-memory brief and adds no /api', () => {
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/weatherVisibilityUnits.js'), 'utf8');
  const weatherEffects = readFileSync(path.join(ROOT, 'src/data/weatherEffects.js'), 'utf8');
  const paint = ui.match(/paintWeatherVisibility\(weather\) \{([\s\S]*?)\n  \}/);
  const bind = ui.match(/bindWeatherVisibilityUnitToggle\([\s\S]*?\}\);/);
  assert.ok(paint, 'paintWeatherVisibility is missing');
  assert.ok(bind, 'weather visibility chip bind is missing');
  assert.match(paint[1], /formatVisibilityM\(weather\?\.visibilityM\)/);
  assert.doesNotMatch(paint[1], /fetchRegionalBrief|\/api\/weather-effects|\/api\/regional-brief/);
  assert.match(bind[0], /this\.regionalBrief\?\.weather/);
  assert.doesNotMatch(bind[0], /fetchRegionalBrief|maybeRefreshRegionalBrief|\/api\/weather-effects/);
  assert.doesNotMatch(helper, /\/api\/weather-visibility|\/api\/visibility/);
  assert.match(weatherEffects, /normalizeRegionalWeather/);
  assert.match(weatherEffects, /'visibility'/);
  assert.doesNotMatch(weatherEffects, /weatherVisibility|setVisibilityUnit|formatVisibilityM/);

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
  assert.equal(existsSync(path.join(ROOT, 'api/weather-visibility.js')), false);
  assert.equal(files.some((file) => /weather-visibility|visibility-unit/i.test(file)), false);
});

test('WX on/off and legal surfaces stay independent of visibility chips', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/weatherVisibilityUnits.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  assert.match(html, /data-wx-mode="off"[\s\S]*?WX OFF[\s\S]*?data-wx-mode="on"[\s\S]*?WX ON/);
  assert.match(html, /id="cockpit-weather-toggle"[^>]*data-wx-toggle/);
  const refresh = ui.match(/maybeRefreshRegionalBrief\(info\) \{([\s\S]*?)\n  \}/);
  assert.ok(refresh, 'regional brief refresh is missing');
  assert.doesNotMatch(refresh[1], /getVisibilityUnit|setVisibilityUnit|weatherVisibility/);
  assert.match(helper, /not an alert service/i);
  assert.doesNotMatch(helper, /news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.match(html, /Weather data by Open-Meteo\.com/);
  assert.match(html, /<title>Meridian<\/title>/);
});
