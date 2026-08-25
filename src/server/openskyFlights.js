import { normalizeAdsbLolPointResponse } from '../data/adsbLolFallback.js';

/** Commercial flights feed. OpenSky is not contacted. */
export const COMMERCIAL_FLIGHT_SOURCE = 'adsb.lol';
/** Hard off — do not fetch opensky-network.org from production paths. */
export const OPENSKY_ENABLED = false;
/** Bounded regional snapshot radius used by the Flights provenance row. */
export const ADSBLOL_POINT_RADIUS_NM = 250;

const ADSBLOL_POINT_CACHE_MS = 12_000;
const ADSBLOL_POINT_CACHE_MAX = 80;
const ADSBLOL_POINT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const ADSBLOL_POINT_TIMEOUT_MS = 10_000;

const defaultCache = new Map();
const defaultInFlight = new Map();

export const config = {
  api: {
    bodyParser: false,
  },
};

export function restoreOpenskyPath(url) {
  const parsed = parseUrl(url);
  if (parsed.pathname === '/api/opensky' || parsed.pathname.startsWith('/api/opensky/')) {
    return `${parsed.pathname}${parsed.search}`;
  }
  return `/api/opensky${parsed.search}`;
}

export function adsbLolFallbackAnchor(req) {
  const incoming = parseUrl(req?.url);
  const latitude = requiredFiniteQueryNumber(incoming.searchParams, 'lat');
  const longitude = requiredFiniteQueryNumber(incoming.searchParams, 'lon');
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

export function adsbLolPointUrl(latitude, longitude) {
  const roundedLat = Math.round(latitude * 4) / 4;
  const roundedLon = Math.round(longitude * 4) / 4;
  return `https://api.adsb.lol/v2/lat/${roundedLat}/lon/${roundedLon}/dist/${ADSBLOL_POINT_RADIUS_NM}`;
}

export function createOpenskyFlightsRuntime({
  fetchImpl = globalThis.fetch.bind(globalThis),
  cache = defaultCache,
  inFlight = defaultInFlight,
  now = Date.now,
} = {}) {
  return { fetchImpl, cache, inFlight, now };
}

/**
 * Node req/res handler for GET /api/opensky.
 * Serves a 250 nm adsb.lol snapshot. Never fetches OpenSky.
 */
export async function handleOpenskyFlightsHttp(req, res, runtime = createOpenskyFlightsRuntime()) {
  try {
    if (await serveAdsbLolFlightsSnapshot(req, res, 'adsblol_primary', runtime)) return;
    writeJson(res, 400, {
      error: 'adsb.lol regional snapshot requires lat and lon query parameters',
    }, buildAdsbLolFlightHeaders({ cacheStatus: 'MISS', reason: 'missing_view_anchor' }));
  } catch (error) {
    console.error('[adsb.lol Flights Proxy]', error?.message || error);
    if (await serveAdsbLolFlightsSnapshot(req, res, 'adsblol_proxy_error', runtime)) return;
    writeJson(res, 502, { error: 'adsb.lol flights proxy error' }, buildAdsbLolFlightHeaders({
      cacheStatus: 'MISS',
      reason: 'proxy_error',
    }));
  }
}

export function createVercelOpenskyHandler(runtimeFactory = createOpenskyFlightsRuntime) {
  return async function handler(req, res) {
    req.url = restoreOpenskyPath(req.url);
    await handleOpenskyFlightsHttp(req, res, runtimeFactory());
  };
}

/** Default Node entry used by api/opensky.js */
export default createVercelOpenskyHandler();

export async function fetchAdsbLolPointFallback(req, runtime = createOpenskyFlightsRuntime()) {
  const anchor = adsbLolFallbackAnchor(req);
  if (!anchor) return null;
  const roundedLat = Math.round(anchor.latitude * 4) / 4;
  const roundedLon = Math.round(anchor.longitude * 4) / 4;
  const cacheKey = `${roundedLat.toFixed(2)},${roundedLon.toFixed(2)}`;
  const cached = runtime.cache.get(cacheKey);
  const now = runtime.now();
  if (cached && now - cached.cachedAt < ADSBLOL_POINT_CACHE_MS) {
    return { ...cached, cacheStatus: 'HIT' };
  }

  const request = coalesceProxyRequest(runtime.inFlight, cacheKey, async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ADSBLOL_POINT_TIMEOUT_MS);
    try {
      const upstreamUrl = adsbLolPointUrl(anchor.latitude, anchor.longitude);
      const upstream = await runtime.fetchImpl(upstreamUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'meridian-adsblol-flights/1.0',
        },
        signal: controller.signal,
      });
      if (!upstream.ok) throw new Error(`upstream HTTP ${upstream.status}`);
      const payload = await readResponseJsonCapped(upstream, ADSBLOL_POINT_MAX_RESPONSE_BYTES);
      const normalized = normalizeAdsbLolPointResponse(payload);
      const record = {
        body: JSON.stringify(normalized),
        cachedAt: runtime.now(),
        count: normalized.states.length,
      };
      runtime.cache.delete(cacheKey);
      runtime.cache.set(cacheKey, record);
      while (runtime.cache.size > ADSBLOL_POINT_CACHE_MAX) {
        runtime.cache.delete(runtime.cache.keys().next().value);
      }
      return record;
    } finally {
      clearTimeout(timeoutId);
    }
  });
  try {
    const record = await request.promise;
    return { ...record, cacheStatus: request.shared ? 'INFLIGHT' : 'MISS' };
  } catch (error) {
    if (!request.shared && error?.name !== 'AbortError') {
      console.warn('[adsb.lol Flights]', error?.message || error);
    }
    return cached ? { ...cached, cacheStatus: 'STALE' } : null;
  }
}

function buildAdsbLolFlightHeaders({ cacheStatus, reason }) {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Flight-Source': COMMERCIAL_FLIGHT_SOURCE,
    'X-Flight-Coverage': `${ADSBLOL_POINT_RADIUS_NM}nm regional`,
    'X-Flight-Cache': cacheStatus,
    'X-Flight-Reason': reason,
  };
}

async function serveAdsbLolFlightsSnapshot(req, res, reason, runtime) {
  const snapshot = await fetchAdsbLolPointFallback(req, runtime);
  if (!snapshot) return false;
  writeRaw(res, 200, snapshot.body, {
    ...buildAdsbLolFlightHeaders({
      cacheStatus: snapshot.cacheStatus,
      reason,
    }),
    'X-Flight-Count': String(snapshot.count),
  });
  return true;
}

function requiredFiniteQueryNumber(params, key) {
  const value = params.get(key);
  if (value === null || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseUrl(url) {
  const raw = String(url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
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

async function readResponseJsonCapped(response, maxBytes) {
  if (typeof response.json === 'function' && !response.body?.getReader) {
    const payload = await response.json();
    const encoded = JSON.stringify(payload);
    if (Buffer.byteLength(encoded) > maxBytes) {
      const err = new Error('Upstream response too large');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }
    return payload;
  }
  const text = await readResponseTextCapped(response, maxBytes);
  return JSON.parse(text);
}

async function readResponseTextCapped(response, maxBytes) {
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

function writeJson(res, status, body, headers = {}) {
  writeRaw(res, status, JSON.stringify(body), headers);
}

function writeRaw(res, status, body, headers = {}) {
  if (typeof res.writeHead === 'function') {
    res.writeHead(status, headers);
  } else {
    res.statusCode = status;
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
  }
  res.end(body);
}
