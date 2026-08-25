/**
 * OSM street routing via public FOSSGIS OSRM (foot / car / bike).
 *
 * Shared by the Vite `/api/route` middleware and the Vercel `api/route.js`
 * wrapper so hosted and local stay on one contract. Failures are
 * `{ ok: false, error }` JSON (HTTP 200, or 429 when rate-limited) — never a
 * platform 404.
 *
 * Map data is OpenStreetMap (ODbL 1.0). OSRM is BSD. No commercial router.
 */

export const FOSSGIS_OSRM_ORIGIN = 'https://routing.openstreetmap.de';
export const ROUTE_MIN_COORDS = 2;
export const ROUTE_MAX_COORDS = 12;
export const ROUTE_MAX_LEG_KM = 600;
export const ROUTE_MAX_TOTAL_KM = 2500;
export const ROUTE_CACHE_MS = 600_000;
export const ROUTE_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const ROUTE_UPSTREAM_TIMEOUT_MS = 12_000;
export const ROUTE_CACHE_MAX = 200;
export const ROUTE_USER_AGENT = 'Meridian/1.0 (OSM OSRM; +https://github.com/johnmatveyev-lab/gods-eye-view)';

const RATE_LIMITER_MAX_KEYS = 2000;

/** @type {Map<string, { payload: object, cachedAt: number }>} */
const defaultRouteCache = new Map();

/** @type {((key: string) => boolean) | null} */
let defaultRouteRateLimiter = null;

/**
 * Fixed-window per-key limiter (60/min/IP, 200/min global).
 * Built once so the window persists across requests.
 *
 * @returns {(key: string) => boolean}
 */
export function osrmRouteRateLimiter() {
  if (!defaultRouteRateLimiter) {
    defaultRouteRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 200 });
  }
  return defaultRouteRateLimiter;
}

/** Test hook — do not use in production. */
export function resetOsrmRouteState() {
  defaultRouteCache.clear();
  defaultRouteRateLimiter = null;
}

function makeRateLimiter({ windowMs, max, globalMax }) {
  const hits = new Map();
  let globalTimes = [];
  return function allow(key) {
    const now = Date.now();
    globalTimes = globalTimes.filter((t) => now - t < windowMs);
    if (globalMax && globalTimes.length >= globalMax) return false;
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
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
      for (const [k, v] of hits) {
        if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
      }
    }
    return true;
  };
}

export function osrmRouteClientKey(req) {
  return String(req?.socket?.remoteAddress || 'local');
}

/**
 * Haversine great-circle distance between two WGS-84 points.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in kilometers.
 */
export function osrmHaversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function parseRequestUrl(url) {
  const raw = String(url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

/**
 * Allowlisted profiles only: foot | car | bike (plus common aliases).
 * Anything else — including `spaceship` — is invalid.
 *
 * @param {string | null | undefined} raw
 * @returns {'foot' | 'car' | 'bike' | null}
 */
export function parseOsrmProfile(raw) {
  const value = String(raw || 'foot').toLowerCase();
  if (value === 'car' || value === 'driving') return 'car';
  if (value === 'bike' || value === 'cycling' || value === 'bicycle') return 'bike';
  if (value === 'foot' || value === 'walking' || value === 'walk') return 'foot';
  return null;
}

export function osrmPathProfile(profile) {
  return profile === 'car' ? 'driving' : profile;
}

/**
 * @param {string | null | undefined} raw
 * @returns {{ ok: true, coords: string, points: number[][] } | { ok: false, error: string }}
 */
export function parseOsrmCoords(raw) {
  const pairs = String(raw || '').split(';').map((s) => s.trim()).filter(Boolean);
  if (pairs.length < ROUTE_MIN_COORDS || pairs.length > ROUTE_MAX_COORDS) {
    return { ok: false, error: 'need 2-12 coordinates' };
  }
  const clean = [];
  const points = [];
  for (const pair of pairs) {
    const parts = pair.split(',');
    if (parts.length !== 2) return { ok: false, error: 'invalid coordinate' };
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return { ok: false, error: 'invalid coordinate' };
    }
    clean.push(`${lon},${lat}`);
    points.push([lon, lat]);
  }
  return { ok: true, coords: clean.join(';'), points };
}

/**
 * Reject obviously-abusive spans so a cross-continent request cannot drive
 * heavy upstream OSRM work.
 *
 * @param {number[][]} points lon,lat pairs
 * @returns {string | null} error message, or null when the span is allowed
 */
export function osrmSpanError(points) {
  let totalKm = 0;
  for (let i = 1; i < points.length; i += 1) {
    const legKm = osrmHaversineKm(points[i - 1][1], points[i - 1][0], points[i][1], points[i][0]);
    if (legKm > ROUTE_MAX_LEG_KM) return 'route leg too long';
    totalKm += legKm;
  }
  if (totalKm > ROUTE_MAX_TOTAL_KM) return 'route too long';
  return null;
}

export function fossgisOsrmUrl(profile, coords) {
  const osrmProfile = osrmPathProfile(profile);
  return `${FOSSGIS_OSRM_ORIGIN}/routed-${profile}/route/v1/${osrmProfile}/${coords}?overview=full&geometries=geojson&alternatives=false&steps=false`;
}

/**
 * @param {unknown} osrm
 * @param {'foot' | 'car' | 'bike'} profile
 * @returns {{ ok: true, profile: string, distanceM: number, durationS: number, geometry: number[][] } | null}
 */
export function mapOsrmRoute(osrm, profile) {
  const route = osrm?.routes?.[0];
  if (osrm?.code !== 'Ok' || !route?.geometry?.coordinates?.length) return null;
  return {
    ok: true,
    profile,
    distanceM: Math.round(route.distance),
    durationS: Math.round(route.duration),
    geometry: route.geometry.coordinates,
  };
}

/**
 * Shared GET handler. Vite middleware and the Vercel wrapper both call this.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   rateLimiter?: ((key: string) => boolean) | null,
 *   clientKey?: (req: import('http').IncomingMessage) => string,
 *   cache?: Map<string, { payload: object, cachedAt: number }>,
 *   now?: () => number,
 * }} [options]
 */
export async function handleOsrmRouteHttp(req, res, options = {}) {
  const fail = (msg) => {
    writeRouteJson(res, 200, { ok: false, error: msg });
  };

  try {
    const limiter = options.rateLimiter !== undefined
      ? options.rateLimiter
      : osrmRouteRateLimiter();
    const keyFn = options.clientKey || osrmRouteClientKey;
    if (limiter && !limiter(keyFn(req))) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
      res.end(JSON.stringify({ ok: false, error: 'rate limited' }));
      return;
    }

    const url = parseRequestUrl(req.url);
    const profile = parseOsrmProfile(url.searchParams.get('profile'));
    if (!profile) {
      fail('invalid profile');
      return;
    }

    const parsed = parseOsrmCoords(url.searchParams.get('coords'));
    if (!parsed.ok) {
      fail(parsed.error);
      return;
    }

    const spanError = osrmSpanError(parsed.points);
    if (spanError) {
      fail(spanError);
      return;
    }

    const cache = options.cache || defaultRouteCache;
    const now = (options.now || Date.now)();
    const cacheKey = `${profile}|${parsed.coords}`;
    const cached = cache.get(cacheKey);
    if (cached && now - cached.cachedAt <= ROUTE_CACHE_MS) {
      writeRouteJson(res, 200, cached.payload);
      return;
    }

    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const upstream = fossgisOsrmUrl(profile, parsed.coords);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROUTE_UPSTREAM_TIMEOUT_MS);
    let osrm;
    try {
      const upstreamRes = await fetchImpl(upstream, {
        signal: controller.signal,
        headers: { 'User-Agent': ROUTE_USER_AGENT },
      });
      if (!upstreamRes.ok) {
        fail('no route found');
        return;
      }
      const ctype = upstreamRes.headers.get('content-type') || '';
      if (!ctype.includes('json')) {
        fail('no route found');
        return;
      }
      const text = await readResponseTextCapped(upstreamRes, ROUTE_MAX_RESPONSE_BYTES);
      osrm = JSON.parse(text);
    } finally {
      clearTimeout(timer);
    }

    const payload = mapOsrmRoute(osrm, profile);
    if (!payload) {
      fail('no route found');
      return;
    }

    cache.set(cacheKey, { payload, cachedAt: now });
    if (cache.size > ROUTE_CACHE_MAX) cache.delete(cache.keys().next().value);
    writeRouteJson(res, 200, payload);
  } catch (error) {
    console.error('[Route Proxy]', error?.message || error);
    fail('route proxy error');
  }
}

/** Vercel Node entry used by api/route.js */
export default async function osrmRouteHandler(req, res) {
  await handleOsrmRouteHttp(req, res);
}

function writeRouteJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
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
