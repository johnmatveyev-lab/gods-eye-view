/**
 * GET /api/military-installations — allow-listed OSM mapped-installation context.
 *
 * Shared by the Vite plugin (via liveApiProxies) and the Vercel live
 * catch-all (`api/[...path].js`) so hosted production is not a static-SPA
 * 404. A dedicated `api/military-installations.js` is not added — Hobby
 * already has 12 serverless functions. Public Overpass mirrors only; no
 * person-search and no new intel vendors.
 *
 * The Cesium layer stays in `militaryInstallations.js`. This module is the
 * Node handler: bbox gate, snap-to-cache, exact=1 after saturation, element
 * cap, and the independent rate limiter.
 */

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

const RATE_LIMITER_MAX_KEYS = 2000;
const MILITARY_INSTALLATION_CACHE_MS = 5 * 60_000;
const MILITARY_INSTALLATION_STALE_MS = 60 * 60_000;
const MILITARY_INSTALLATION_MAX_CACHE = 80;
const MILITARY_INSTALLATION_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MILITARY_INSTALLATION_DISK_TTL_MS = 30 * 86_400_000;
const MILITARY_INSTALLATION_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'military-installations');
const MILITARY_INSTALLATION_BBOX_STEP_DEG = 0.05;
const OVERPASS_TIMEOUT_MS = 22000;
const OVERPASS_UPSTREAMS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/**
 * Upstream element cap. A response that hits it exactly is SATURATED — Overpass
 * truncated, so off-viewport features from the snapped bbox may have crowded out
 * in-viewport ones. Callers re-ask for the exact viewport in that case.
 */
export const MILITARY_INSTALLATION_ELEMENT_CAP = 700;

const _militaryInstallationCache = new Map();
const _militaryInstallationInFlight = new Map();
const _militaryInstallationsRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 90, globalMax: 300 });

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

export function militaryInstallationsClientKey(req) {
  return String(req?.socket?.remoteAddress || 'local');
}

function requiredFiniteQueryNumber(params, key) {
  const value = params.get(key);
  if (value === null || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Accept only a non-dateline bbox no larger than 10°.
 * @param {URLSearchParams} params
 * @returns {{south:number, west:number, north:number, east:number}|null}
 */
export function validMilitaryInstallationBox(params) {
  const south = requiredFiniteQueryNumber(params, 'south');
  const west = requiredFiniteQueryNumber(params, 'west');
  const north = requiredFiniteQueryNumber(params, 'north');
  const east = requiredFiniteQueryNumber(params, 'east');
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) return null;
  if (north - south > 10 || east - west > 10) return null;
  return { south, west, north, east };
}

/**
 * Snap a request bbox outward onto the shared installation cache grid.
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {number} [stepDeg]
 * @returns {{south:number, west:number, north:number, east:number}}
 */
export function quantizeMilitaryInstallationBox(box, stepDeg = MILITARY_INSTALLATION_BBOX_STEP_DEG) {
  const snap = (value, grow) => {
    const cells = Number((value / stepDeg).toFixed(9));
    return Number(((grow > 0 ? Math.ceil(cells) : Math.floor(cells)) * stepDeg).toFixed(6));
  };
  return {
    south: Math.max(-90, snap(box.south, -1)),
    west: Math.max(-180, snap(box.west, -1)),
    north: Math.min(90, snap(box.north, 1)),
    east: Math.min(180, snap(box.east, 1)),
  };
}

/**
 * Stable disk/memory cache key for an installation bbox.
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {number} [decimals]
 */
export function militaryInstallationCacheKey(box, decimals = 3) {
  return [box.south, box.west, box.north, box.east]
    .map((value) => value.toFixed(decimals))
    .join(',');
}

/**
 * Cache key for one request. `exact=1` is prefixed so a saturated retry never
 * overwrites the shared snapped tile.
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {boolean} exact
 */
export function militaryInstallationRequestCacheKey(box, exact) {
  return exact
    ? `exact:${militaryInstallationCacheKey(box, 5)}`
    : militaryInstallationCacheKey(box);
}

export async function resolveMilitaryInstallationTier({
  cacheKey,
  memoryCache,
  inFlight,
  readDisk,
  now = Date.now(),
  cacheMs = MILITARY_INSTALLATION_CACHE_MS,
}) {
  const cached = memoryCache.get(cacheKey);
  if (cached && now - cached.cachedAt <= cacheMs) return { source: 'HIT', entry: cached };
  if (inFlight.has(cacheKey)) return { source: 'UPSTREAM', entry: null };
  const disk = await readDisk();
  return disk ? { source: 'DISK', entry: disk } : { source: 'UPSTREAM', entry: null };
}

export function migrateMilitaryInstallationEntry(entry) {
  if (!entry?.payload || typeof entry.payload.saturated === 'boolean') return entry;
  const elements = Array.isArray(entry.payload.elements) ? entry.payload.elements : [];
  return {
    ...entry,
    payload: {
      ...entry.payload,
      saturated: elements.length >= MILITARY_INSTALLATION_ELEMENT_CAP,
    },
  };
}

export function militaryInstallationDiskFresh(
  entry,
  maxAgeMs = MILITARY_INSTALLATION_DISK_TTL_MS,
  now = Date.now(),
) {
  if (!entry || !Number.isFinite(entry.cachedAt) || !Array.isArray(entry.payload?.elements)) return false;
  return now - entry.cachedAt <= maxAgeMs;
}

export function militaryInstallationDiskPath(cacheKey, dir = MILITARY_INSTALLATION_DISK_DIR) {
  return path.join(dir, `${createHash('sha1').update(cacheKey).digest('hex')}.json`);
}

export async function readMilitaryInstallationDisk(
  cacheKey,
  maxAgeMs,
  dir = MILITARY_INSTALLATION_DISK_DIR,
) {
  try {
    const entry = JSON.parse(await fsp.readFile(militaryInstallationDiskPath(cacheKey, dir), 'utf8'));
    if (!militaryInstallationDiskFresh(entry, maxAgeMs)) return null;
    return migrateMilitaryInstallationEntry(entry);
  } catch {
    return null;
  }
}

export async function writeMilitaryInstallationDisk(
  cacheKey,
  entry,
  dir = MILITARY_INSTALLATION_DISK_DIR,
) {
  const target = militaryInstallationDiskPath(cacheKey, dir);
  const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(temp, JSON.stringify(entry));
    await fsp.rename(temp, target);
    return true;
  } catch (err) {
    console.warn('[Installations Proxy] disk cache write failed:', err?.message || err);
    await fsp.rm(temp, { force: true }).catch(() => {});
    return false;
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

function overpassLooksRateLimited(bodyText) {
  const text = String(bodyText || '').toLowerCase();
  return text.includes('rate_limited')
    || text.includes('quota of your ip address')
    || text.includes('too many requests');
}

function overpassLooksRuntimeError(bodyText) {
  const text = String(bodyText || '').toLowerCase();
  return text.includes('runtime error')
    || text.includes('timed out')
    || text.includes('out of memory');
}

async function readResponseTextCapped(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    const err = new Error('Upstream response too large');
    err.code = 'RESPONSE_TOO_LARGE';
    throw err;
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes) {
    const err = new Error('Upstream response too large');
    err.code = 'RESPONSE_TOO_LARGE';
    throw err;
  }
  return text;
}

async function defaultFetchOverpass(body, maxResponseBytes, fetchImpl = globalThis.fetch) {
  let lastError = null;
  let lastRateLimitPayload = null;

  for (const endpoint of OVERPASS_UPSTREAMS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const upstream = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Meridian-overpass-proxy/1.0',
        },
        body,
        signal: controller.signal,
      });
      const responseBody = await readResponseTextCapped(upstream, maxResponseBytes);
      const status = upstream.status;
      const rateLimited = status === 429 || overpassLooksRateLimited(responseBody);
      const runtimeError = overpassLooksRuntimeError(responseBody);
      const payload = {
        status,
        body: responseBody,
        contentType: upstream.headers?.get?.('content-type') || 'application/json',
        endpoint,
        rateLimited,
        runtimeError,
      };
      if (rateLimited) {
        lastRateLimitPayload = payload;
        continue;
      }
      if (runtimeError) {
        lastError = new Error(`Overpass runtime error (${endpoint})`);
        continue;
      }
      if (status >= 500) {
        lastError = new Error(`Overpass upstream returned ${status} (${endpoint})`);
        continue;
      }
      return payload;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (lastRateLimitPayload) return lastRateLimitPayload;
  throw lastError || new Error('All Overpass upstreams failed');
}

function trimMilitaryInstallationCache(memoryCache) {
  while (memoryCache.size > MILITARY_INSTALLATION_MAX_CACHE) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    memoryCache.delete(oldest);
  }
}

function writeJson(res, status, body, headers = {}) {
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
  res.setHeader?.('Content-Type', 'application/json');
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader?.(name, value);
  }
  res.end(payload);
}

function parseRequestUrl(url) {
  const raw = String(url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

/**
 * Shared GET handler. Vite middleware and the Vercel live catch-all both call this.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{
 *   fetchOverpass?: (body: string, maxBytes: number) => Promise<object>,
 *   fetchImpl?: typeof fetch,
 *   rateLimiter?: ((key: string) => boolean) | null,
 *   clientKey?: (req: import('http').IncomingMessage) => string,
 *   memoryCache?: Map<string, {payload: object, cachedAt: number}>,
 *   inFlight?: Map<string, Promise>,
 *   diskDir?: string,
 *   now?: () => number,
 * }} [options]
 */
export async function handleMilitaryInstallationsHttp(req, res, options = {}) {
  const memoryCache = options.memoryCache || _militaryInstallationCache;
  const inFlight = options.inFlight || _militaryInstallationInFlight;
  const diskDir = options.diskDir || MILITARY_INSTALLATION_DISK_DIR;
  const nowFn = options.now || Date.now;
  const fetchOverpass = options.fetchOverpass
    || ((body, maxBytes) => defaultFetchOverpass(body, maxBytes, options.fetchImpl || globalThis.fetch));

  if (req.method !== 'GET') {
    writeJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  const limiter = options.rateLimiter !== undefined
    ? options.rateLimiter
    : _militaryInstallationsRateLimiter;
  const keyFn = options.clientKey || militaryInstallationsClientKey;
  if (limiter && !limiter(keyFn(req))) {
    writeJson(res, 429, { error: 'Rate limit exceeded' }, { 'Retry-After': '5' });
    return;
  }

  const url = parseRequestUrl(req.url);
  const requested = validMilitaryInstallationBox(url.searchParams);
  if (!requested) {
    writeJson(res, 400, { error: 'A non-dateline bbox no larger than 10 degrees is required' });
    return;
  }

  const exact = url.searchParams.get('exact') === '1';
  const box = exact ? requested : quantizeMilitaryInstallationBox(requested);
  const key = militaryInstallationRequestCacheKey(box, exact);
  const now = nowFn();
  const cached = memoryCache.get(key);
  const preflight = await resolveMilitaryInstallationTier({
    cacheKey: key,
    memoryCache,
    inFlight,
    readDisk: () => readMilitaryInstallationDisk(key, MILITARY_INSTALLATION_DISK_TTL_MS, diskDir),
    now,
  });
  if (preflight.source !== 'UPSTREAM') {
    if (preflight.source === 'DISK') {
      memoryCache.set(key, preflight.entry);
      trimMilitaryInstallationCache(memoryCache);
    }
    writeJson(
      res,
      200,
      { ...preflight.entry.payload, status: 'cached' },
      { 'Cache-Control': 'public, max-age=60', 'X-Military-Installations': preflight.source },
    );
    return;
  }

  async function refresh() {
    const bbox = `${box.south},${box.west},${box.north},${box.east}`;
    const ql = `[out:json][timeout:20];(nwr["military"~"^(airfield|naval_base|range|barracks|base)$"](${bbox});nwr["landuse"="military"](${bbox}););out center tags geom ${MILITARY_INSTALLATION_ELEMENT_CAP};`;
    const upstream = await fetchOverpass(
      `data=${encodeURIComponent(ql)}`,
      MILITARY_INSTALLATION_MAX_RESPONSE_BYTES,
    );
    if (upstream.status >= 400 || upstream.rateLimited || upstream.runtimeError) {
      throw new Error('Mapped installation upstream unavailable');
    }
    const parsed = JSON.parse(upstream.body);
    const elements = Array.isArray(parsed?.elements)
      ? parsed.elements.slice(0, MILITARY_INSTALLATION_ELEMENT_CAP)
      : [];
    const payload = {
      elements,
      saturated: elements.length >= MILITARY_INSTALLATION_ELEMENT_CAP,
      elementCap: MILITARY_INSTALLATION_ELEMENT_CAP,
      retrievedAt: new Date(nowFn()).toISOString(),
      status: 'ready',
    };
    const entry = { payload, cachedAt: nowFn() };
    memoryCache.set(key, entry);
    trimMilitaryInstallationCache(memoryCache);
    writeMilitaryInstallationDisk(key, entry, diskDir);
    return payload;
  }

  const request = coalesceProxyRequest(inFlight, key, refresh);
  try {
    const payload = await request.promise;
    writeJson(res, 200, payload, {
      'Cache-Control': 'public, max-age=60',
      'X-Military-Installations': request.shared ? 'INFLIGHT' : 'MISS',
    });
  } catch {
    if (cached && now - cached.cachedAt <= MILITARY_INSTALLATION_STALE_MS) {
      writeJson(
        res,
        200,
        { ...cached.payload, status: 'stale' },
        { 'Cache-Control': 'no-store', 'X-Military-Installations': 'STALE' },
      );
      return;
    }
    const stale = await readMilitaryInstallationDisk(key, Infinity, diskDir);
    if (stale) {
      writeJson(
        res,
        200,
        { ...stale.payload, status: 'stale' },
        { 'Cache-Control': 'no-store', 'X-Military-Installations': 'STALE-DISK' },
      );
      return;
    }
    writeJson(
      res,
      503,
      { error: 'Mapped installation context is temporarily unavailable' },
      { 'Cache-Control': 'no-store' },
    );
  }
}

/** Node entry used by the Vite plugin and the Vercel live catch-all. */
export default async function militaryInstallationsHandler(req, res) {
  await handleMilitaryInstallationsHttp(req, res);
}
