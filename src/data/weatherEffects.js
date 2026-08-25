import { normalizeRegionalWeather } from './regionalBrief.js';

/** Fresh observation cache window (matches the previous Vite proxy). */
export const WEATHER_EFFECTS_CACHE_MS = 5 * 60_000;
/** Stale-serve window during a transient Open-Meteo outage. */
export const WEATHER_EFFECTS_STALE_MS = 30 * 60_000;
export const WEATHER_EFFECTS_MAX_CACHE = 180;
export const WEATHER_EFFECTS_MAX_RESPONSE_BYTES = 512 * 1024;
export const WEATHER_EFFECTS_FETCH_TIMEOUT_MS = 9000;
export const WEATHER_EFFECTS_RATE_LIMIT = Object.freeze({
  windowMs: 60_000,
  max: 45,
  globalMax: 120,
});

/** Only weather vendor for this endpoint. Do not add a second provider. */
export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_CURRENT_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'weather_code',
  'cloud_cover',
  'wind_speed_10m',
  'wind_direction_10m',
  'visibility',
].join(',');

export const WEATHER_EFFECTS_ERRORS = Object.freeze({
  METHOD: 'Method Not Allowed',
  RATE_LIMIT: 'Rate limit exceeded',
  COORDINATES: 'Valid lat/lon are required',
  UNAVAILABLE: 'Weather effects are temporarily unavailable',
});

const RATE_LIMITER_MAX_KEYS = 2000;

export const config = {
  api: {
    bodyParser: false,
  },
};

function makeWeatherRateLimiter({
  windowMs = WEATHER_EFFECTS_RATE_LIMIT.windowMs,
  max = WEATHER_EFFECTS_RATE_LIMIT.max,
  globalMax = WEATHER_EFFECTS_RATE_LIMIT.globalMax,
  now = () => Date.now(),
} = {}) {
  const hits = new Map();
  let globalTimes = [];
  return function allow(key) {
    const current = now();
    globalTimes = globalTimes.filter((time) => current - time < windowMs);
    if (globalMax && globalTimes.length >= globalMax) return false;
    const recent = (hits.get(key) || []).filter((time) => current - time < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(current);
    hits.set(key, recent);
    globalTimes.push(current);
    if (hits.size > RATE_LIMITER_MAX_KEYS) {
      const oldest = hits.keys().next().value;
      if (oldest !== undefined) hits.delete(oldest);
    }
    return true;
  };
}

function clientKey(req) {
  return String(req.socket?.remoteAddress || 'local');
}

function coalesceProxyRequest(inFlight, key, create) {
  const existing = inFlight.get(key);
  if (existing) return { promise: existing, shared: true };
  let promise;
  promise = Promise.resolve()
    .then(create)
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return { promise, shared: false };
}

function parseRequestUrl(url) {
  const raw = String(url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function requiredFiniteQueryNumber(params, ...keys) {
  for (const key of keys) {
    const value = params.get(key);
    if (value === null || String(value).trim() === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

/**
 * Accept camera-local coordinates as `lat`/`lon` or `latitude`/`longitude`.
 * @param {URLSearchParams} params
 * @returns {{ latitude: number, longitude: number } | null}
 */
export function validWeatherEffectsPoint(params) {
  const latitude = requiredFiniteQueryNumber(params, 'lat', 'latitude');
  const longitude = requiredFiniteQueryNumber(params, 'lon', 'longitude');
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

export function weatherEffectsCacheKey(point) {
  return `${(Math.round(point.latitude * 10) / 10).toFixed(1)},${(Math.round(point.longitude * 10) / 10).toFixed(1)}`;
}

export function openMeteoForecastUrl(point) {
  const params = new URLSearchParams({
    latitude: point.latitude.toFixed(5),
    longitude: point.longitude.toFixed(5),
    current: OPEN_METEO_CURRENT_FIELDS,
    timezone: 'UTC',
  });
  return `${OPEN_METEO_FORECAST_URL}?${params}`;
}

async function readJsonCapped(response, maxBytes) {
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes) {
    const error = new Error('Upstream response too large');
    error.code = 'RESPONSE_TOO_LARGE';
    throw error;
  }
  return JSON.parse(text);
}

export async function fetchOpenMeteoWeather(point, {
  fetchImpl = globalThis.fetch.bind(globalThis),
  timeoutMs = WEATHER_EFFECTS_FETCH_TIMEOUT_MS,
  maxBytes = WEATHER_EFFECTS_MAX_RESPONSE_BYTES,
} = {}) {
  const url = openMeteoForecastUrl(point);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
    return normalizeRegionalWeather(await readJsonCapped(response, maxBytes));
  } finally {
    clearTimeout(timeout);
  }
}

function trimWeatherEffectsCache(cache) {
  while (cache.size > WEATHER_EFFECTS_MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function writeJson(res, status, body, headers = {}) {
  if (res.headersSent) return;
  const payload = JSON.stringify(body);
  if (typeof res.writeHead === 'function') {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      ...headers,
    });
    res.end(payload);
    return;
  }
  res.statusCode = status;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json');
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
  }
  res.end(payload);
}

export function createWeatherEffectsRuntime({
  fetchImpl = globalThis.fetch.bind(globalThis),
  now = () => Date.now(),
  cache = new Map(),
  inFlight = new Map(),
  rateLimiter,
} = {}) {
  return {
    fetchImpl,
    now,
    cache,
    inFlight,
    rateLimiter: rateLimiter || makeWeatherRateLimiter({ now }),
  };
}

let defaultRuntime = null;

export function getWeatherEffectsRuntime() {
  if (!defaultRuntime) defaultRuntime = createWeatherEffectsRuntime();
  return defaultRuntime;
}

export function resetWeatherEffectsRuntime() {
  defaultRuntime = null;
}

async function refreshWeatherEffects(point, key, runtime) {
  const weather = await fetchOpenMeteoWeather(point, { fetchImpl: runtime.fetchImpl });
  if (!weather) throw new Error('Weather observation unavailable');
  const payload = {
    status: 'ready',
    retrievedAt: new Date(runtime.now()).toISOString(),
    coordinates: point,
    weather,
  };
  runtime.cache.set(key, { payload, cachedAt: runtime.now() });
  trimWeatherEffectsCache(runtime.cache);
  return payload;
}

/**
 * GET /api/weather-effects — camera-local Open-Meteo observations.
 * Vite middleware and the hosted `api/weather-effects.js` function both forward here.
 */
export async function handleWeatherEffectsHttp(req, res, runtime = getWeatherEffectsRuntime()) {
  if ((req.method || 'GET') !== 'GET') {
    writeJson(res, 405, { error: WEATHER_EFFECTS_ERRORS.METHOD });
    return;
  }
  if (!runtime.rateLimiter(clientKey(req))) {
    writeJson(res, 429, { error: WEATHER_EFFECTS_ERRORS.RATE_LIMIT }, { 'Retry-After': '10' });
    return;
  }
  const point = validWeatherEffectsPoint(parseRequestUrl(req.url).searchParams);
  if (!point) {
    writeJson(res, 400, { error: WEATHER_EFFECTS_ERRORS.COORDINATES });
    return;
  }
  const key = weatherEffectsCacheKey(point);
  const current = runtime.now();
  const cached = runtime.cache.get(key);
  if (cached && current - cached.cachedAt <= WEATHER_EFFECTS_CACHE_MS) {
    writeJson(res, 200, { ...cached.payload, status: 'cached' }, {
      'Cache-Control': 'public, max-age=60',
      'X-Weather-Effects': 'HIT',
    });
    return;
  }
  const request = coalesceProxyRequest(runtime.inFlight, key, () => refreshWeatherEffects(point, key, runtime));
  try {
    const payload = await request.promise;
    writeJson(res, 200, payload, {
      'Cache-Control': 'public, max-age=60',
      'X-Weather-Effects': request.shared ? 'INFLIGHT' : 'MISS',
    });
  } catch {
    if (cached && current - cached.cachedAt <= WEATHER_EFFECTS_STALE_MS) {
      writeJson(res, 200, { ...cached.payload, status: 'stale' }, {
        'Cache-Control': 'no-store',
        'X-Weather-Effects': 'STALE',
      });
      return;
    }
    writeJson(res, 503, { error: WEATHER_EFFECTS_ERRORS.UNAVAILABLE }, { 'Cache-Control': 'no-store' });
  }
}

/** Default Node entry used by api/weather-effects.js */
export default async function weatherEffectsHandler(req, res) {
  try {
    await handleWeatherEffectsHttp(req, res);
  } catch {
    writeJson(res, 503, { error: WEATHER_EFFECTS_ERRORS.UNAVAILABLE }, { 'Cache-Control': 'no-store' });
  }
}

export function weatherEffectsProxy(runtimeFactory = getWeatherEffectsRuntime) {
  function install(middlewares) {
    middlewares.use('/api/weather-effects', async (req, res) => {
      await handleWeatherEffectsHttp(req, res, runtimeFactory());
    });
  }
  return {
    name: 'weather-effects-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}
