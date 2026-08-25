import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_CREDITS } from './dataCredits.js';
import weatherEffectsHandler, {
  OPEN_METEO_FORECAST_URL,
  WEATHER_EFFECTS_CACHE_MS,
  WEATHER_EFFECTS_ERRORS,
  WEATHER_EFFECTS_RATE_LIMIT,
  WEATHER_EFFECTS_STALE_MS,
  createWeatherEffectsRuntime,
  handleWeatherEffectsHttp,
  openMeteoForecastUrl,
  validWeatherEffectsPoint,
  weatherEffectsProxy,
} from './weatherEffects.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const OPEN_METEO_SAMPLE = Object.freeze({
  current: {
    time: '2026-08-25T12:00',
    temperature_2m: 21.4,
    apparent_temperature: 20.8,
    precipitation: 0,
    weather_code: 2,
    cloud_cover: 42,
    wind_speed_10m: 18.2,
    wind_direction_10m: 270,
    visibility: 18000,
  },
});

function mockReq({ method = 'GET', url = '/', headers = {}, socket } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = socket || { remoteAddress: '127.0.0.1' };
  return req;
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
      for (const [name, value] of Object.entries(headers || {})) {
        this.headers[name] = value;
      }
    },
    end(chunk) {
      this.headersSent = true;
      this.body = chunk || '';
    },
  };
}

async function dispatch(options, runtime) {
  const req = mockReq(options);
  const res = mockRes();
  await handleWeatherEffectsHttp(req, res, runtime);
  return {
    status: res.statusCode,
    json: res.body ? JSON.parse(res.body) : null,
    headers: res.headers,
    serialized: String(res.body || ''),
  };
}

function mockOpenMeteoFetch(payload = OPEN_METEO_SAMPLE) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    assert.match(String(url), /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}

test('hosted weather-effects entry forwards to the shared handler', () => {
  const entry = path.join(ROOT, 'api/weather-effects.js');
  assert.equal(existsSync(entry), true);
  const source = readFileSync(entry, 'utf8');
  assert.match(source, /from '\.\.\/src\/data\/weatherEffects\.js'/);
  assert.doesNotMatch(source, /export \{ GET, POST \}/);
  assert.doesNotMatch(source, /from ['"]next|from ['"]vite['"]|vite-plugin-cesium/);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(vercelJson.framework, 'vite');
  assert.ok(vercelJson.functions['api/weather-effects.js']);
  assert.equal(vercelJson.functions['api/terrain/heights.js'], undefined);
  assert.equal(existsSync(path.join(ROOT, 'api/terrain/heights.js')), false);
  for (const rule of vercelJson.rewrites || []) {
    assert.match(rule.source, /^\/api\/tomtom\//);
    assert.match(rule.destination, /^\/api\/tomtom\//);
  }
});

test('weather-effects talks to Open-Meteo only and keeps the registered credit', () => {
  const source = readFileSync(path.join(ROOT, 'src/data/weatherEffects.js'), 'utf8');
  assert.match(source, /https:\/\/api\.open-meteo\.com\/v1\/forecast/);
  assert.doesNotMatch(source, /openweathermap|weatherapi|visualcrossing|accuweather|tomorrow\.io|weather\.gov/i);
  assert.doesNotMatch(source, /opensky-network|news\.google\.com|telegeography|quantum-earth/i);
  assert.equal(OPEN_METEO_FORECAST_URL, 'https://api.open-meteo.com/v1/forecast');

  const credit = DATA_CREDITS.find((entry) => entry.key === 'open-meteo');
  assert.ok(credit);
  assert.match(credit.html, /Open-Meteo\.com/);
  assert.match(credit.html, /open-meteo\.com\/en\/licence/);
  assert.equal(DATA_CREDITS.some((entry) => /opensky|google-news|telegeography/i.test(entry.key)), false);
});

test('cache window and rate limit stay at the previous Vite proxy values', () => {
  assert.equal(WEATHER_EFFECTS_CACHE_MS, 5 * 60_000);
  assert.equal(WEATHER_EFFECTS_STALE_MS, 30 * 60_000);
  assert.deepEqual(WEATHER_EFFECTS_RATE_LIMIT, { windowMs: 60_000, max: 45, globalMax: 120 });
  const plugin = weatherEffectsProxy();
  assert.equal(plugin.name, 'weather-effects-proxy');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.equal(typeof plugin.configurePreviewServer, 'function');
});

test('validWeatherEffectsPoint accepts lat/lon and latitude/longitude', () => {
  assert.deepEqual(
    validWeatherEffectsPoint(new URLSearchParams('lat=40.7&lon=-74.0')),
    { latitude: 40.7, longitude: -74 },
  );
  assert.deepEqual(
    validWeatherEffectsPoint(new URLSearchParams('latitude=40.7&longitude=-74.0')),
    { latitude: 40.7, longitude: -74 },
  );
  assert.equal(validWeatherEffectsPoint(new URLSearchParams('')), null);
  assert.equal(validWeatherEffectsPoint(new URLSearchParams('lat=91&lon=0')), null);
});

test('GET /api/weather-effects without coordinates is 400, never a platform 404', async () => {
  const runtime = createWeatherEffectsRuntime({
    fetchImpl: async () => {
      throw new Error('Open-Meteo should not be contacted without coordinates');
    },
  });
  const { status, json, serialized } = await dispatch({ url: '/api/weather-effects' }, runtime);
  assert.equal(status, 400);
  assert.notEqual(status, 404);
  assert.match(json.error, /valid lat\/lon are required/i);
  assert.doesNotMatch(serialized, /x-vercel-error|NOT_FOUND/);
});

test('GET ?lat=40.7&lon=-74.0 returns 200 {status, weather, coordinates} or existing error JSON', async () => {
  const { fetchImpl, calls } = mockOpenMeteoFetch();
  const ready = await dispatch(
    { url: '/api/weather-effects?lat=40.7&lon=-74.0' },
    createWeatherEffectsRuntime({ fetchImpl }),
  );
  assert.equal(ready.status, 200);
  assert.equal(ready.json.status, 'ready');
  assert.ok(ready.json.weather);
  assert.equal(ready.json.weather.temperatureC, 21.4);
  assert.deepEqual(ready.json.coordinates, { latitude: 40.7, longitude: -74 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0], openMeteoForecastUrl({ latitude: 40.7, longitude: -74 }));
  assert.doesNotMatch(ready.serialized, /x-vercel-error|NOT_FOUND/);

  const failed = await dispatch(
    { url: '?lat=40.7&lon=-74.0' },
    createWeatherEffectsRuntime({
      fetchImpl: async () => { throw new Error('Open-Meteo unavailable'); },
    }),
  );
  assert.equal(failed.status, 503);
  assert.equal(failed.json.error, WEATHER_EFFECTS_ERRORS.UNAVAILABLE);
  assert.doesNotMatch(failed.serialized, /x-vercel-error|NOT_FOUND/);
});

test('POST /api/weather-effects is 405', async () => {
  const { status, json, serialized } = await dispatch(
    { method: 'POST', url: '/api/weather-effects?lat=40.7&lon=-74.0' },
    createWeatherEffectsRuntime({
      fetchImpl: async () => {
        throw new Error('POST must not contact Open-Meteo');
      },
    }),
  );
  assert.equal(status, 405);
  assert.equal(json.error, WEATHER_EFFECTS_ERRORS.METHOD);
  assert.doesNotMatch(serialized, /x-vercel-error|NOT_FOUND/);
});

test('existing latitude/longitude query still hits the shared handler', async () => {
  const { fetchImpl } = mockOpenMeteoFetch();
  const { status, json } = await dispatch(
    { url: '/api/weather-effects?latitude=40.70000&longitude=-74.00000' },
    createWeatherEffectsRuntime({ fetchImpl }),
  );
  assert.equal(status, 200);
  assert.equal(json.status, 'ready');
  assert.deepEqual(json.coordinates, { latitude: 40.7, longitude: -74 });
});

test('fresh cache is served without a second Open-Meteo call', async () => {
  const { fetchImpl, calls } = mockOpenMeteoFetch();
  let now = Date.parse('2026-08-25T12:00:00.000Z');
  const runtime = createWeatherEffectsRuntime({ fetchImpl, now: () => now });
  const first = await dispatch({ url: '?lat=40.7&lon=-74.0' }, runtime);
  now += 60_000;
  const second = await dispatch({ url: '?lat=40.7&lon=-74.0' }, runtime);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.json.status, 'cached');
  assert.equal(second.headers['X-Weather-Effects'], 'HIT');
  assert.equal(calls.length, 1);
});

test('rate limiter still rejects a bursting client', async () => {
  const { status, json } = await dispatch(
    { url: '?lat=40.7&lon=-74.0' },
    createWeatherEffectsRuntime({ rateLimiter: () => false }),
  );
  assert.equal(status, 429);
  assert.equal(json.error, WEATHER_EFFECTS_ERRORS.RATE_LIMIT);
});

test('Vercel leftover query still reaches handleWeatherEffectsHttp', async () => {
  const { fetchImpl } = mockOpenMeteoFetch();
  const leftover = await dispatch(
    { url: '/?lat=40.7&lon=-74.0' },
    createWeatherEffectsRuntime({ fetchImpl }),
  );
  assert.equal(leftover.status, 200);
  assert.equal(leftover.json.weather.weatherCode, 2);
  assert.equal(typeof weatherEffectsHandler, 'function');
});
