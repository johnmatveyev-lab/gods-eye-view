// PLAN 146 — client-only mm | in chips for already-fetched Open-Meteo
// precipitation. Default mm. Persist separately from °C/°F, wind units, and
// km/nm/mi. Chip change re-applies the in-memory observation; no new /api.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_DISTANCE_UNIT, UNITS_STORAGE_KEY, getDistanceUnit } from '../units.js';
import { DEFAULT_WX_ENABLED, WX_STORAGE_KEY, getWxEnabled, resetWxPreferenceCache } from '../weatherChrome.js';
import { WEATHER_UNITS_STORAGE_KEY } from './weatherUnits.js';
import { WIND_UNITS_STORAGE_KEY } from './weatherWindUnits.js';
import { normalizeRegionalWeather } from './regionalBrief.js';
import {
  DEFAULT_PRECIP_UNIT,
  MM_PER_INCH,
  PRECIP_UNITS,
  WEATHER_PRECIP_UNITS_STORAGE_KEY,
  bindWeatherPrecipUnitToggle,
  convertPrecipitationMm,
  formatPrecipitationMm,
  getPrecipUnit,
  initWeatherPrecipUnits,
  mmToInches,
  normalizePrecipUnit,
  resetWeatherPrecipUnitsForTests,
  setPrecipUnit,
  subscribeWeatherPrecipUnits,
} from './weatherPrecipUnits.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SAMPLE_WEATHER = normalizeRegionalWeather({
  current: {
    time: '2026-07-22T08:15:00Z',
    temperature_2m: 21.4,
    apparent_temperature: 20.8,
    precipitation: 4.2,
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
    dataset: { weatherPrecipUnits: unit },
    attrs: { 'aria-pressed': unit === 'mm' ? 'true' : 'false', ...attrs },
    getAttribute(name) {
      return this.attrs[name];
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    closest(selector) {
      return selector === '[data-weather-precip-units]' ? this : null;
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
      return selector === '[data-weather-precip-units]' ? buttons : [];
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
  resetWeatherPrecipUnitsForTests();
  resetWxPreferenceCache();
});

test('mm matches the current Local Info precipitation number', () => {
  assert.equal(DEFAULT_PRECIP_UNIT, 'mm');
  assert.deepEqual([...PRECIP_UNITS], ['mm', 'in']);
  assert.equal(SAMPLE_WEATHER.precipitationMm, 4.2);
  assert.equal(formatPrecipitationMm(SAMPLE_WEATHER.precipitationMm, 'mm'), '4.2');
  assert.equal(formatPrecipitationMm(0, 'mm'), '0.0');
  assert.equal(formatPrecipitationMm(4.2), '4.2');
});

test('in converts the same in-memory precipitationMm observation', () => {
  assert.equal(MM_PER_INCH, 25.4);
  assert.equal(mmToInches(4.2), 4.2 / 25.4);
  assert.equal(formatPrecipitationMm(SAMPLE_WEATHER.precipitationMm, 'in'), (4.2 / 25.4).toFixed(2));
  assert.equal(formatPrecipitationMm(25.4, 'in'), '1.00');
  assert.equal(convertPrecipitationMm(0, 'in').value, 0);
  assert.equal(formatPrecipitationMm(Number.NaN, 'in'), '—');
  assert.equal(formatPrecipitationMm(null, 'mm'), '—');
  assert.equal(formatPrecipitationMm(undefined, 'in'), '—');
  assert.equal(normalizePrecipUnit('inches'), 'in');
  assert.equal(normalizePrecipUnit('millimetres'), 'mm');
  assert.equal(normalizePrecipUnit('cm'), null);
});

test('meridian.weatherPrecipUnits persists separately from temp, wind, km/nm/mi, and WX', () => {
  assert.equal(WEATHER_PRECIP_UNITS_STORAGE_KEY, 'meridian.weatherPrecipUnits');
  assert.notEqual(WEATHER_PRECIP_UNITS_STORAGE_KEY, UNITS_STORAGE_KEY);
  assert.notEqual(WEATHER_PRECIP_UNITS_STORAGE_KEY, WX_STORAGE_KEY);
  assert.notEqual(WEATHER_PRECIP_UNITS_STORAGE_KEY, WEATHER_UNITS_STORAGE_KEY);
  assert.notEqual(WEATHER_PRECIP_UNITS_STORAGE_KEY, WIND_UNITS_STORAGE_KEY);

  const storage = memoryStorage({
    [WEATHER_UNITS_STORAGE_KEY]: 'F',
    [WIND_UNITS_STORAGE_KEY]: 'kt',
    [UNITS_STORAGE_KEY]: 'mi',
    [WX_STORAGE_KEY]: '1',
  });
  assert.equal(initWeatherPrecipUnits({ storage }), 'mm');
  assert.equal(setPrecipUnit('in', { storage }), 'in');
  assert.equal(storage.getItem(WEATHER_PRECIP_UNITS_STORAGE_KEY), 'in');
  assert.equal(storage.getItem(WEATHER_UNITS_STORAGE_KEY), 'F');
  assert.equal(storage.getItem(WIND_UNITS_STORAGE_KEY), 'kt');
  assert.equal(storage.getItem(UNITS_STORAGE_KEY), 'mi');
  assert.equal(storage.getItem(WX_STORAGE_KEY), '1');
  assert.equal(getDistanceUnit(), DEFAULT_DISTANCE_UNIT);
  assert.equal(getWxEnabled(memoryStorage()), DEFAULT_WX_ENABLED);

  resetWeatherPrecipUnitsForTests();
  assert.equal(initWeatherPrecipUnits({ storage }), 'in');
  assert.equal(formatPrecipitationMm(SAMPLE_WEATHER.precipitationMm, 'in'), (4.2 / 25.4).toFixed(2));
});

test('subscribers hear a precip-unit change once', () => {
  const seen = [];
  const stop = subscribeWeatherPrecipUnits((unit, previous) => seen.push([unit, previous]));
  try {
    setPrecipUnit('in', { persist: false });
    setPrecipUnit('in', { persist: false });
    assert.deepEqual(seen, [['in', 'mm']]);
  } finally {
    stop();
    resetWeatherPrecipUnitsForTests();
  }
});

test('chip change re-applies the cached observation and does not fetch', () => {
  const fetches = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetches.push(args[0]);
    throw new Error('chip change must not fetch');
  };
  const mm = fakeButton('mm');
  const inches = fakeButton('in');
  const root = fakeToggleRoot([mm, inches]);
  const painted = [];
  try {
    bindWeatherPrecipUnitToggle(root, {
      persist: false,
      onChange: (unit) => {
        painted.push(formatPrecipitationMm(SAMPLE_WEATHER.precipitationMm, unit));
      },
    });
    assert.equal(mm.getAttribute('aria-pressed'), 'true');
    assert.equal(inches.getAttribute('aria-pressed'), 'false');
    root.click(inches);
    assert.equal(getPrecipUnit(), 'in');
    assert.equal(inches.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(painted, [(4.2 / 25.4).toFixed(2)]);
    assert.deepEqual(fetches, []);
  } finally {
    globalThis.fetch = originalFetch;
    resetWeatherPrecipUnitsForTests();
  }
});

test('Local Info hosts mm | in next to PRECIP; Display units stay km | nm | mi', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/weatherPrecipUnits.js'), 'utf8');

  const local = html.match(/data-cockpit-brief-page="local"[\s\S]*?<\/section>/);
  assert.ok(local, 'Local Info briefing is missing');
  assert.match(local[0], /id="cockpit-local-precipitation"/);
  assert.match(local[0], /data-weather-precip-units="mm"[^>]*>mm</);
  assert.match(local[0], /data-weather-precip-units="in"[^>]*>in</);
  assert.match(local[0], /class="[^"]*weather-precip-toggle[^"]*"/);
  assert.match(local[0], /id="cockpit-local-wind"/);

  const unitsRow = html.match(/id="units-row"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(unitsRow, 'Display units row is missing');
  assert.match(unitsRow[0], /data-units="km"/);
  assert.match(unitsRow[0], /data-units="nm"/);
  assert.match(unitsRow[0], /data-units="mi"/);
  assert.doesNotMatch(unitsRow[0], /data-weather-precip-units|weather-precip-toggle/);

  assert.match(ui, /bindWeatherPrecipUnitToggle|formatPrecipitationMm|initWeatherPrecipUnits/);
  assert.match(ui, /paintLocalPrecipitation|regionalBrief\?\.weather/);
  assert.doesNotMatch(helper, /from ['"]\.\.\/units\.js['"]|setDistanceUnit|setWxEnabled|setTemperatureUnit|setWindUnit/);
  assert.doesNotMatch(helper, /['"]meridian\.units['"]/);
});

test('chip wiring re-paints from the in-memory brief and adds no /api', () => {
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/weatherPrecipUnits.js'), 'utf8');
  const weatherEffects = readFileSync(path.join(ROOT, 'src/data/weatherEffects.js'), 'utf8');
  const paint = ui.match(/paintLocalPrecipitation\(weather\) \{([\s\S]*?)\n  \}/);
  const bind = ui.match(/bindWeatherPrecipUnitToggle\([\s\S]*?\}\);/);
  assert.ok(paint, 'paintLocalPrecipitation is missing');
  assert.ok(bind, 'weather precip chip bind is missing');
  assert.match(paint[1], /formatPrecipitationMm\(weather\?\.precipitationMm\)/);
  assert.doesNotMatch(paint[1], /fetchRegionalBrief|\/api\/weather-effects|\/api\/regional-brief/);
  assert.match(bind[0], /this\.regionalBrief\?\.weather/);
  assert.doesNotMatch(bind[0], /fetchRegionalBrief|maybeRefreshRegionalBrief|\/api\/weather-effects/);
  assert.doesNotMatch(helper, /\/api\/weather-precip|\/api\/precipitation/);
  assert.match(weatherEffects, /normalizeRegionalWeather/);
  assert.match(weatherEffects, /'precipitation'/);
  assert.doesNotMatch(weatherEffects, /precipitationIn|weatherPrecipUnits|setPrecipUnit/);

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
  assert.equal(existsSync(path.join(ROOT, 'api/weather-precip.js')), false);
  assert.equal(files.some((file) => /weather-precip|precip-unit/i.test(file)), false);
});

test('WX on/off and legal surfaces stay independent of precip chips', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/weatherPrecipUnits.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  assert.match(html, /data-wx-mode="off"[\s\S]*?WX OFF[\s\S]*?data-wx-mode="on"[\s\S]*?WX ON/);
  assert.match(html, /id="cockpit-weather-toggle"[^>]*data-wx-toggle/);
  const refresh = ui.match(/maybeRefreshRegionalBrief\(info\) \{([\s\S]*?)\n  \}/);
  assert.ok(refresh, 'regional brief refresh is missing');
  assert.doesNotMatch(refresh[1], /getPrecipUnit|setPrecipUnit|weatherPrecipUnits/);
  assert.match(helper, /not an alert service/i);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.match(html, /Weather data by Open-Meteo\.com/);
});
