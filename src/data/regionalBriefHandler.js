/**
 * Hosted cockpit regional brief — Node (req, res) handler.
 *
 * Sources (legal):
 *   - Place: OpenStreetMap Nominatim (ODbL)
 *   - Weather: Open-Meteo (CC BY 4.0)
 *   - News: GDELT Project DOC 2.0 only
 *
 * Google News RSS is never queried.
 * Vite and Vercel both forward to `handleRegionalBrief`.
 */

import {
  normalizeRegionalArticles,
  normalizeRegionalPlace,
  normalizeRegionalWeather,
} from './regionalBrief.js';

export const REGIONAL_BRIEF_CACHE_MS = 5 * 60_000;
export const REGIONAL_BRIEF_STALE_MS = 60 * 60_000;
export const REGIONAL_BRIEF_MAX_CACHE = 120;
export const REGIONAL_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const WEATHER_EFFECTS_MAX_RESPONSE_BYTES = 512 * 1024;
export const REGIONAL_BRIEF_RATE_LIMIT = Object.freeze({
  windowMs: 60_000,
  max: 30,
  globalMax: 90,
});

const RATE_LIMITER_MAX_KEYS = 2000;
const NOMINATIM_MIN_INTERVAL_MS = 1100;

/** Parse a finite query number; blank and missing stay null (never coerced to 0). */
export function requiredFiniteQueryNumber(params, key) {
  const value = params.get(key);
  if (value === null || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberFromUnknown(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Validate a lat/lon pair already parsed as numbers. */
export function validRegionalPointFromValues(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/**
 * Accept URLSearchParams or a plain { latitude, longitude } record.
 * Blank strings are rejected; 0,0 is a valid Gulf of Guinea point.
 */
export function validRegionalPoint(params) {
  if (params && typeof params.get === 'function') {
    return validRegionalPointFromValues(
      requiredFiniteQueryNumber(params, 'latitude'),
      requiredFiniteQueryNumber(params, 'longitude'),
    );
  }
  return validRegionalPointFromValues(
    numberFromUnknown(params?.latitude),
    numberFromUnknown(params?.longitude),
  );
}

/** 0.1° cache cell used by the cockpit regional brief. */
export function regionalBriefCacheKey(point) {
  return `${(Math.round(point.latitude * 10) / 10).toFixed(1)},${(Math.round(point.longitude * 10) / 10).toFixed(1)}`;
}

/** True when at least one regional source produced usable data. */
export function regionalBriefHasAnySource({ place, weather, news } = {}) {
  return Boolean(place || weather || (news && news.status !== 'unavailable'));
}

function makeRateLimiter({ windowMs, max, globalMax }) {
  const hits = new Map();
  let globalTimes = [];
  return function allow(key) {
    const now = Date.now();
    globalTimes = globalTimes.filter((time) => now - time < windowMs);
    if (globalMax && globalTimes.length >= globalMax) return false;
    const recent = (hits.get(key) || []).filter((time) => now - time < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    globalTimes.push(now);
    if (hits.size > RATE_LIMITER_MAX_KEYS) {
      const oldest = hits.keys().next().value;
      if (oldest !== undefined) hits.delete(oldest);
    }
    if (hits.size > 256) {
      for (const [entryKey, times] of hits) {
        if (!times.length || now - times[times.length - 1] > windowMs) hits.delete(entryKey);
      }
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

async function readResponseTextCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    const err = new Error('Upstream response too large');
    err.code = 'RESPONSE_TOO_LARGE';
    throw err;
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      const err = new Error('Upstream response too large');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }
    return text;
  }
  const decoder = new TextDecoder();
  let out = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* no-op */ }
      const err = new Error('Upstream response too large');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

export async function readResponseJsonCapped(response, maxBytes) {
  return JSON.parse(await readResponseTextCapped(response, maxBytes));
}

export async function fetchRegionalJson(url, {
  headers = {},
  timeoutMs = 9000,
  maxBytes = REGIONAL_MAX_RESPONSE_BYTES,
  fetchImpl = globalThis.fetch,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
    return readResponseJsonCapped(response, maxBytes);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchRegionalWeather(point, { fetchImpl = globalThis.fetch } = {}) {
  const params = new URLSearchParams({
    latitude: point.latitude.toFixed(5),
    longitude: point.longitude.toFixed(5),
    current: 'temperature_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility',
    timezone: 'UTC',
  });
  try {
    const payload = await fetchRegionalJson(`https://api.open-meteo.com/v1/forecast?${params}`, {
      maxBytes: WEATHER_EFFECTS_MAX_RESPONSE_BYTES,
      fetchImpl,
    });
    return normalizeRegionalWeather(payload);
  } catch {
    return null;
  }
}

function parseRequestUrl(req) {
  const raw = String(req?.url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function readJsonBody(req, maxBytes = 4096) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    try {
      return Promise.resolve(JSON.parse(String(req.body)));
    } catch {
      return Promise.resolve(null);
    }
  }
  if (typeof req.on !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        finish(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        finish(null);
        return;
      }
      try {
        finish(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        finish(null);
      }
    });
    req.on('error', () => finish(null));
  });
}

export async function resolveRegionalBriefPoint(req) {
  const url = parseRequestUrl(req);
  const fromQuery = validRegionalPoint(url.searchParams);
  if (fromQuery) return fromQuery;
  const fromVercelQuery = validRegionalPoint(req.query);
  if (fromVercelQuery) return fromVercelQuery;
  if (String(req.method || 'GET').toUpperCase() !== 'POST') return null;
  return validRegionalPoint(await readJsonBody(req));
}

function writeJson(res, status, body, headers = {}) {
  const allHeaders = { 'Content-Type': 'application/json', ...headers };
  if (typeof res.writeHead === 'function') {
    res.writeHead(status, allHeaders);
  } else {
    res.statusCode = status;
    if (typeof res.setHeader === 'function') {
      for (const [key, value] of Object.entries(allHeaders)) {
        res.setHeader(key, value);
      }
    }
  }
  res.end(JSON.stringify(body));
}

function trimCache(cache, max) {
  while (cache.size > max) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function createNominatimGate(minIntervalMs) {
  let queue = Promise.resolve();
  let lastAt = 0;
  return function schedule(task) {
    const run = queue.then(async () => {
      const waitMs = Math.max(0, minIntervalMs - (Date.now() - lastAt));
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      lastAt = Date.now();
      return task();
    });
    queue = run.catch(() => null);
    return run;
  };
}

async function fetchRegionalPlace(point, { fetchImpl, scheduleNominatim }) {
  return scheduleNominatim(async () => {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: point.latitude.toFixed(5),
      lon: point.longitude.toFixed(5),
      zoom: '10',
      addressdetails: '1',
      'accept-language': 'en',
    });
    const payload = await fetchRegionalJson(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: {
        'User-Agent': 'Meridian/0.1 (+https://github.com/johnmatveyev-lab/gods-eye-view)',
        Referer: 'https://github.com/johnmatveyev-lab/gods-eye-view',
      },
      fetchImpl,
    });
    return normalizeRegionalPlace(payload);
  });
}

async function fetchRegionalNews(place, { fetchImpl }) {
  const query = place?.locality || place?.region || place?.country;
  if (!query) return { status: 'unavailable', query: null, articles: [], source: null };
  const params = new URLSearchParams({
    query: `"${String(query).replace(/["\\]/g, ' ').trim()}"`,
    mode: 'artlist',
    format: 'json',
    maxrecords: '5',
    sort: 'datedesc',
    timespan: '48h',
  });
  try {
    const payload = await fetchRegionalJson(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
      headers: { 'User-Agent': 'Meridian/0.1' },
      timeoutMs: 12_000,
      fetchImpl,
    });
    const articles = normalizeRegionalArticles(payload, 5);
    return { status: articles.length ? 'ready' : 'empty', query, articles, source: 'GDELT Project' };
  } catch {
    return { status: 'unavailable', query, articles: [], source: null };
  }
}

/**
 * Isolated handler factory so tests can inject fetch, clock, cache, and limiter.
 * Production Vite/Vercel use the default singleton.
 */
export function createRegionalBriefHandler({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  cache = new Map(),
  inFlight = new Map(),
  rateLimiter = makeRateLimiter(REGIONAL_BRIEF_RATE_LIMIT),
  nominatimMinIntervalMs = NOMINATIM_MIN_INTERVAL_MS,
} = {}) {
  const scheduleNominatim = createNominatimGate(nominatimMinIntervalMs);

  async function refresh(point, key) {
    const [placeResult, weatherResult] = await Promise.allSettled([
      fetchRegionalPlace(point, { fetchImpl, scheduleNominatim }),
      fetchRegionalWeather(point, { fetchImpl }),
    ]);
    const place = placeResult.status === 'fulfilled' ? placeResult.value : null;
    const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : null;
    const news = await fetchRegionalNews(place, { fetchImpl });
    if (!regionalBriefHasAnySource({ place, weather, news })) {
      throw new Error('All regional briefing sources unavailable');
    }
    const payload = {
      status: place && weather && news.status !== 'unavailable' ? 'ready' : 'partial',
      retrievedAt: new Date(now()).toISOString(),
      coordinates: point,
      place,
      placeStatus: place ? 'ready' : 'unavailable',
      weather,
      weatherStatus: weather ? 'ready' : 'unavailable',
      newsStatus: news.status,
      newsQuery: news.query,
      newsSource: news.source,
      articles: news.articles,
    };
    cache.set(key, { payload, cachedAt: now() });
    trimCache(cache, REGIONAL_BRIEF_MAX_CACHE);
    return payload;
  }

  return async function handleRegionalBrief(req, res) {
    const method = String(req?.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      writeJson(res, 405, { error: 'Method Not Allowed' });
      return;
    }
    if (!rateLimiter(clientKey(req))) {
      writeJson(res, 429, { error: 'Rate limit exceeded' }, { 'Retry-After': '10' });
      return;
    }
    const point = await resolveRegionalBriefPoint(req);
    if (!point) {
      writeJson(res, 400, { error: 'Valid latitude and longitude are required' });
      return;
    }
    const key = regionalBriefCacheKey(point);
    const cachedAtNow = now();
    const cached = cache.get(key);
    if (cached && cachedAtNow - cached.cachedAt <= REGIONAL_BRIEF_CACHE_MS) {
      writeJson(res, 200, { ...cached.payload, status: 'cached' }, {
        'Cache-Control': 'public, max-age=60',
        'X-Regional-Brief': 'HIT',
      });
      return;
    }
    const request = coalesceProxyRequest(inFlight, key, () => refresh(point, key));
    try {
      const payload = await request.promise;
      writeJson(res, 200, payload, {
        'Cache-Control': 'public, max-age=60',
        'X-Regional-Brief': request.shared ? 'INFLIGHT' : 'MISS',
      });
    } catch {
      if (cached && cachedAtNow - cached.cachedAt <= REGIONAL_BRIEF_STALE_MS) {
        writeJson(res, 200, { ...cached.payload, status: 'stale' }, {
          'Cache-Control': 'no-store',
          'X-Regional-Brief': 'STALE',
        });
        return;
      }
      writeJson(res, 503, { error: 'Regional briefing is temporarily unavailable' }, {
        'Cache-Control': 'no-store',
      });
    }
  };
}

export const handleRegionalBrief = createRegionalBriefHandler();
export default handleRegionalBrief;
