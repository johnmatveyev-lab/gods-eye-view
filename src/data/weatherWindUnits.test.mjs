// PLAN 140 — weather wind km/h | mph | kt. Client-only convert of already
// fetched windKph. Default km/h matches today's Local Info numbers.
// Persist is separate from °C/°F and km/nm/mi. Chip change must not
// refetch /api/weather-effects. WX on/off stays independent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNITS_STORAGE_KEY, getDistanceUnit, resetDistanceUnitsForTests, setDistanceUnit } from '../units.js';
import {
  WEATHER_UNITS_STORAGE_KEY,
  getTemperatureUnit,
  resetWeatherUnitsForTests,
  setTemperatureUnit,
} from './weatherUnits.js';
import {
  DEFAULT_WX_ENABLED,
  WX_STORAGE_KEY,
  getWxEnabled,
  resetWxPreferenceCache,
  setWxEnabled,
} from '../weatherChrome.js';
import { normalizeRegionalWeather } from './regionalBrief.js';
import {
  createWeatherEffectsRuntime,
  handleWeatherEffectsHttp,
} from './weatherEffects.js';
import {
  DEFAULT_WIND_UNIT,
  KT_PER_KMH,
  MPH_PER_KMH,
  WIND_UNITS,
  WIND_UNITS_STORAGE_KEY,
  bindWindUnitToggle,
  convertWindKph,
  formatWindSpeed,
  getWindUnit,
  initWindUnits,
  normalizeWindUnit,
  resetWindUnitsForTests,
  setWindUnit,
  subscribeWindUnit,
  syncWindUnitButtons,
} from './weatherWindUnits.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SAMPLE_WIND_KPH = 18.2;
const OPEN_METEO_SAMPLE = Object.freeze({
  current: {
    time: '2026-08-25T12:00',
    temperature_2m: 21.4,
    apparent_temperature: 20.8,
    precipitation: 0,
    weather_code: 2,
    cloud_cover: 42,
    wind_speed_10m: SAMPLE_WIND_KPH,
    wind_direction_10m: 270,
    visibility: 18000,
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
  const classes = new Set();
  const button = {
    dataset: { windUnit: unit },
    attrs: { 'aria-pressed': 'false', 'aria-checked': 'false', ...attrs },
    classList: {
      toggle(name, on) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    getAttribute(name) {
      return this.attrs[name];
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    closest(selector) {
      return selector === '[data-wind-unit]' ? button : null;
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
      return selector === '[data-wind-unit]' ? buttons : [];
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

function mockReq({ method = 'GET', url = '/', headers = {} } = {}) {
  return { method, url, headers, socket: { remoteAddress: '127.0.0.1' } };
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headersSent = true;
      Object.assign(this.headers, headers || {});
    },
    end(chunk) {
      this.headersSent = true;
      this.body = chunk || '';
    },
  };
}

async function dispatchWeatherEffects(options, runtime) {
  const req = mockReq(options);
  const res = mockRes();
  await handleWeatherEffectsHttp(req, res, runtime);
  return {
    status: res.statusCode,
    json: res.body ? JSON.parse(res.body) : null,
  };
}

test.afterEach(() => {
  resetWindUnitsForTests();
  resetWeatherUnitsForTests();
  resetDistanceUnitsForTests();
  resetWxPreferenceCache();
});

test('km/h matches the current Local Info wind numbers', () => {
  const weather = normalizeRegionalWeather({ current: OPEN_METEO_SAMPLE.current });
  assert.equal(DEFAULT_WIND_UNIT, 'kmh');
  assert.deepEqual(WIND_UNITS, ['kmh', 'mph', 'kt']);
  assert.equal(getWindUnit(), 'kmh');
  assert.equal(weather.windKph, SAMPLE_WIND_KPH);
  assert.equal(formatWindSpeed(weather.windKph), '18 KM/H');
  assert.equal(formatWindSpeed(weather.windKph, 'kmh'), '18 KM/H');
  assert.equal(convertWindKph(weather.windKph, 'kmh').value, SAMPLE_WIND_KPH);
});

test('mph and kt convert the same in-memory observation', () => {
  const weather = normalizeRegionalWeather({ current: OPEN_METEO_SAMPLE.current });
  assert.equal(MPH_PER_KMH, 0.621371);
  assert.equal(KT_PER_KMH, 0.539957);
  assert.equal(formatWindSpeed(weather.windKph, 'mph'), '11 MPH');
  assert.equal(formatWindSpeed(weather.windKph, 'kt'), '10 KT');
  assert.equal(convertWindKph(weather.windKph, 'mph').value, SAMPLE_WIND_KPH * MPH_PER_KMH);
  assert.equal(convertWindKph(weather.windKph, 'kt').value, SAMPLE_WIND_KPH * KT_PER_KMH);
  assert.equal(weather.windDirectionDeg, 270);
  assert.equal(formatWindSpeed(Number.NaN), '—');
  assert.equal(normalizeWindUnit('fathoms'), null);
  assert.equal(normalizeWindUnit('km/h'), 'kmh');
  assert.equal(normalizeWindUnit('knots'), 'kt');
});

test('chip change re-applies the cached observation and does not refetch /api/weather-effects', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify(OPEN_METEO_SAMPLE), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  let now = Date.parse('2026-08-25T12:00:00.000Z');
  const runtime = createWeatherEffectsRuntime({ fetchImpl, now: () => now });
  const first = await dispatchWeatherEffects({ url: '?lat=40.7&lon=-74.0' }, runtime);
  now += 60_000;
  const cached = await dispatchWeatherEffects({ url: '?lat=40.7&lon=-74.0' }, runtime);
  assert.equal(first.status, 200);
  assert.equal(cached.status, 200);
  assert.equal(cached.json.status, 'cached');
  assert.equal(calls.length, 1);

  const observation = cached.json.weather;
  const readout = { textContent: formatWindSpeed(observation.windKph, 'kmh') };
  const kmh = fakeButton('kmh', { 'aria-pressed': 'true', 'aria-checked': 'true' });
  const mph = fakeButton('mph');
  const kt = fakeButton('kt');
  const root = fakeToggleRoot([kmh, mph, kt]);
  const storage = memoryStorage();
  const seen = [];

  bindWindUnitToggle(root, {
    storage,
    onChange: (unit) => {
      readout.textContent = formatWindSpeed(observation.windKph, unit);
      seen.push(unit);
    },
  });

  root.click(mph);
  assert.equal(readout.textContent, '11 MPH');
  assert.equal(observation.windKph, SAMPLE_WIND_KPH);
  assert.equal(observation.windDirectionDeg, 270);
  assert.equal(storage.getItem(WIND_UNITS_STORAGE_KEY), 'mph');
  assert.equal(calls.length, 1, 'chip change must reuse the cached observation');

  root.click(kt);
  assert.equal(readout.textContent, '10 KT');
  assert.deepEqual(seen, ['mph', 'kt']);
  assert.equal(calls.length, 1);

  const afterChip = await dispatchWeatherEffects({ url: '?lat=40.7&lon=-74.0' }, runtime);
  assert.equal(afterChip.json.status, 'cached');
  assert.equal(calls.length, 1);
});

test('wind persist is separate from distance units, temperature °C, and WX', () => {
  const storage = memoryStorage();
  assert.equal(WIND_UNITS_STORAGE_KEY, 'meridian.weatherWind');
  assert.notEqual(WIND_UNITS_STORAGE_KEY, UNITS_STORAGE_KEY);
  assert.notEqual(WIND_UNITS_STORAGE_KEY, WX_STORAGE_KEY);
  assert.notEqual(WIND_UNITS_STORAGE_KEY, WEATHER_UNITS_STORAGE_KEY);

  assert.equal(setWindUnit('mph', { storage }), 'mph');
  assert.equal(setTemperatureUnit('F', { storage }), 'F');
  assert.equal(storage.getItem(WIND_UNITS_STORAGE_KEY), 'mph');
  assert.equal(storage.getItem(WEATHER_UNITS_STORAGE_KEY), 'F');
  assert.equal(storage.getItem(UNITS_STORAGE_KEY), null);
  assert.equal(storage.getItem(WX_STORAGE_KEY), null);
  assert.equal(getTemperatureUnit(), 'C', 'injected temperature storage must not leak into the live default');

  setDistanceUnit('mi', { storage });
  assert.equal(storage.getItem(UNITS_STORAGE_KEY), 'mi');
  assert.equal(storage.getItem(WIND_UNITS_STORAGE_KEY), 'mph');
  assert.equal(getDistanceUnit(), 'km', 'injected distance storage must not leak into the live default');

  resetWxPreferenceCache();
  assert.equal(DEFAULT_WX_ENABLED, false);
  assert.equal(getWxEnabled(storage), false);
  assert.equal(setWxEnabled(true, storage), true);
  assert.equal(storage.getItem(WIND_UNITS_STORAGE_KEY), 'mph');
  assert.equal(storage.getItem(WX_STORAGE_KEY), '1');

  resetWindUnitsForTests();
  assert.equal(initWindUnits({ storage }), 'mph');
  assert.equal(formatWindSpeed(SAMPLE_WIND_KPH, 'mph'), '11 MPH');
});

test('subscribers hear a wind-unit change once', () => {
  const seen = [];
  const stop = subscribeWindUnit((unit, previous) => seen.push([unit, previous]));
  try {
    setWindUnit('kt', { persist: false });
    setWindUnit('kt', { persist: false });
    assert.deepEqual(seen, [['kt', 'kmh']]);
  } finally {
    stop();
    resetWindUnitsForTests();
  }
});

test('Local Info and HUD host km/h | mph | kt chips next to the °C weather readout', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/weatherWindUnits.js'), 'utf8');

  assert.match(html, /id="cockpit-local-temperature"/);
  assert.match(html, /id="cockpit-wind-units"/);
  assert.match(html, /data-wind-unit="kmh"/);
  assert.match(html, /data-wind-unit="mph"/);
  assert.match(html, /data-wind-unit="kt"/);
  const localPage = html.match(/data-cockpit-brief-page="local"[\s\S]*?<\/section>/);
  assert.ok(localPage, 'Local Info weather page is missing');
  assert.match(localPage[0], /data-weather-units="C"[\s\S]*?data-weather-units="F"[\s\S]*?id="cockpit-wind-units"|id="cockpit-wind-units"[\s\S]*?data-weather-units="C"/);
  assert.match(localPage[0], /°C|OPEN-METEO/);

  assert.match(ui, /from '\.\/data\/weatherWindUnits\.js'/);
  assert.match(ui, /applyLocalWindReadout/);
  assert.match(ui, /formatWindSpeed\(weather\?\.windKph\)/);
  const apply = ui.match(/applyLocalWindReadout\(weather = this\.regionalBrief\?\.weather\) \{([\s\S]*?)\n  \}/);
  assert.ok(apply, 'in-memory wind re-apply helper is missing');
  assert.doesNotMatch(apply[1], /fetchRegionalBrief|\/api\/weather-effects|\/api\/regional-brief/);

  const chipBind = ui.match(/bindWindUnitToggle\(this\.windUnitToggle, \{([\s\S]*?)\n    \}\)/);
  assert.ok(chipBind, 'wind chips are not bound');
  assert.match(chipBind[1], /applyLocalWindReadout/);
  assert.doesNotMatch(chipBind[1], /fetchRegionalBrief|maybeRefreshRegionalBrief|\/api\/weather-effects/);

  assert.match(ui, /formatTemperatureC\(weather\?\.temperatureC\)/);
  assert.doesNotMatch(helper, /from '\.\.\/units\.js'|from '\.\/weatherUnits\.js'|meridian\.units'|meridian\.weatherUnits'|setWxEnabled|getWxEnabled/);
});

test('no new weather endpoint; MIT credit and Meridian name stay put', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/weatherWindUnits.js'), 'utf8');
  const weatherEffects = readFileSync(path.join(ROOT, 'src/data/weatherEffects.js'), 'utf8');
  const apiEntry = path.join(ROOT, 'api/weather-effects.js');

  assert.equal(existsSync(apiEntry), true);
  assert.equal(existsSync(path.join(ROOT, 'api/weather-wind.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/weather-units.js')), false);
  assert.match(weatherEffects, /OPEN_METEO_FORECAST_URL/);
  assert.doesNotMatch(helper, /\/api\/weather-wind|\/api\/weather-units/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(html, /Meridian is independent/);
  assert.match(html, /Weather data by Open-Meteo\.com/);
});

test('sync paints pressed chips without mutating WX or distance', () => {
  const kmh = fakeButton('kmh', { 'aria-pressed': 'true' });
  const mph = fakeButton('mph');
  const root = fakeToggleRoot([kmh, mph]);
  syncWindUnitButtons(root, 'mph');
  assert.equal(kmh.getAttribute('aria-pressed'), 'false');
  assert.equal(mph.getAttribute('aria-pressed'), 'true');
  assert.equal(mph.classList.contains('active'), true);
  resetWxPreferenceCache();
  assert.equal(getWxEnabled(memoryStorage()), false);
  assert.equal(getDistanceUnit(), 'km');
});
