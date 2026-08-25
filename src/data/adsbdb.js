/**
 * adsbdb.com enrichment proxy: callsign → route (airline + origin/destination
 * airports) and hex → aircraft type/registration. Free community API — cached
 * aggressively: ONE upstream request per new key ever (404s negative-cached),
 * persisted when a path is available so restarts don't re-hammer it.
 * Adapted from skylight (MIT) server/src/enrich/routes.ts.
 *
 * Hosted (Vercel) uses an in-memory Map with a 24h TTL and an optional /tmp
 * write. No volume is required — a failed persist leaves memory intact.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';

export const ADSBDB_TTL_MS = 24 * 3600_000;
export const ADSBDB_TIMEOUT_MS = 8000;
export const ADSBDB_UPSTREAM_ORIGIN = 'https://api.adsbdb.com';

export const config = {
  api: {
    bodyParser: false,
  },
};

export function parseRoute(json) {
  const fr = json?.response?.flightroute;
  if (!fr?.origin || !fr?.destination) return null;
  const airport = (a) => ({
    code: a.iata_code || a.icao_code || '',
    name: a.municipality || a.name || '',
    lat: Number.isFinite(a.latitude) ? a.latitude : null,
    lon: Number.isFinite(a.longitude) ? a.longitude : null,
  });
  return {
    airline: fr.airline?.name || null,
    origin: airport(fr.origin),
    destination: airport(fr.destination),
  };
}

export function parseAircraft(json) {
  const a = json?.response?.aircraft;
  if (!a) return null;
  return {
    typeCode: a.icao_type || null,
    typeName: a.manufacturer && a.type ? `${a.manufacturer} ${a.type}` : (a.type || null),
    registration: a.registration || null,
  };
}

export function restoreAdsbdbApiPath(url) {
  const parsed = parseUrl(url);
  if (parsed.pathname.startsWith('/api/adsbdb')) {
    return `${parsed.pathname}${parsed.search}`;
  }
  const rest = parsed.pathname === '/' ? '' : parsed.pathname;
  return `/api/adsbdb${rest.startsWith('/') ? rest : `/${rest}`}${parsed.search}`;
}

/**
 * @param {string} url
 * @returns {{ kind: 'route'|'aircraft', key: string } | { status: number, error: string }}
 */
export function parseAdsbdbRequest(url) {
  const parsed = parseUrl(restoreAdsbdbApiPath(url));
  const parts = parsed.pathname.split('/').filter(Boolean);
  const kind = parts[2] || '';
  const rawKey = parts[3] || '';
  if (kind === 'route') {
    const cs = String(rawKey).toUpperCase();
    if (!/^[A-Z0-9]{2,8}$/.test(cs)) return { status: 400, error: 'invalid callsign' };
    return { kind: 'route', key: cs };
  }
  if (kind === 'type' || kind === 'aircraft') {
    const hex = String(rawKey).toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(hex)) return { status: 400, error: 'invalid hex' };
    return { kind: 'aircraft', key: hex };
  }
  return { status: 404, error: 'unknown endpoint' };
}

function parseUrl(url) {
  const raw = String(url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function cacheKey(kind, key) {
  return `${kind}:${key}`;
}

function present(kind, data) {
  switch (kind) {
    case 'route':
      return data
        ? { found: true, airline: data.airline, origin: data.origin, destination: data.destination }
        : { found: false, airline: null, origin: null, destination: null };
    case 'aircraft':
      return data
        ? { found: true, typeCode: data.typeCode, typeName: data.typeName, registration: data.registration }
        : { found: false, typeCode: null, typeName: null, registration: null };
    default: {
      const unexpected = kind;
      throw new Error(`unexpected adsbdb kind: ${unexpected}`);
    }
  }
}

function defaultPersistPath() {
  if (process.env.ADSBDB_CACHE_PATH) return process.env.ADSBDB_CACHE_PATH;
  if (process.env.VERCEL) return '/tmp/adsbdb.json';
  return path.join(process.cwd(), '.gev-cache', 'adsbdb.json');
}

function deserializeCache(parsed, cache) {
  const buckets = [
    ['route', parsed?.routes],
    ['aircraft', parsed?.aircraft],
  ];
  for (const [kind, store] of buckets) {
    if (!store || typeof store !== 'object') continue;
    for (const [key, entry] of Object.entries(store)) {
      if (!entry || !Number.isFinite(entry.at)) continue;
      cache.set(cacheKey(kind, key), { at: entry.at, data: entry.data ?? null });
    }
  }
}

function serializeCache(cache) {
  const routes = {};
  const aircraft = {};
  for (const [ik, entry] of cache) {
    const sep = ik.indexOf(':');
    if (sep < 0) continue;
    const kind = ik.slice(0, sep);
    const key = ik.slice(sep + 1);
    if (kind === 'route') routes[key] = entry;
    else if (kind === 'aircraft') aircraft[key] = entry;
  }
  return { routes, aircraft };
}

export function createAdsbdbRuntime({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  persistPath = null,
  persistImmediate = false,
  persistIntervalMs = 0,
  ttlMs = ADSBDB_TTL_MS,
  timeoutMs = ADSBDB_TIMEOUT_MS,
  cache = new Map(),
} = {}) {
  const inflight = new Map();
  let loaded = false;
  let dirty = false;
  let persistTimer = null;

  const fresh = (entry) => entry && now() - entry.at < ttlMs;

  async function loadOnce() {
    if (loaded) return;
    loaded = true;
    if (!persistPath) return;
    try {
      deserializeCache(JSON.parse(await fsp.readFile(persistPath, 'utf8')), cache);
    } catch { /* optional persist — no volume required */ }
    if (persistIntervalMs > 0) {
      persistTimer = setInterval(() => {
        if (!dirty) return;
        dirty = false;
        writePersist().catch(() => { dirty = true; });
      }, persistIntervalMs);
      persistTimer.unref?.();
    }
  }

  async function writePersist() {
    if (!persistPath) return;
    try {
      await fsp.mkdir(path.dirname(persistPath), { recursive: true });
      await fsp.writeFile(persistPath, JSON.stringify(serializeCache(cache)), 'utf8');
    } catch { /* optional /tmp write */ }
  }

  async function remember(ik, data) {
    cache.set(ik, { at: now(), data });
    dirty = true;
    if (persistImmediate) await writePersist();
  }

  function lastGood(ik) {
    const entry = cache.get(ik);
    return entry ? entry.data : null;
  }

  function lookup(kind, key) {
    const ik = cacheKey(kind, key);
    const hit = cache.get(ik);
    if (fresh(hit)) return Promise.resolve(hit.data);
    if (!inflight.has(ik)) {
      inflight.set(ik, (async () => {
        try {
          const url = kind === 'route'
            ? `${ADSBDB_UPSTREAM_ORIGIN}/v0/callsign/${encodeURIComponent(key)}`
            : `${ADSBDB_UPSTREAM_ORIGIN}/v0/aircraft/${encodeURIComponent(key)}`;
          const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
          if (res.ok) {
            const data = kind === 'route' ? parseRoute(await res.json()) : parseAircraft(await res.json());
            await remember(ik, data);
            return data;
          }
          if (res.status === 404) {
            await remember(ik, null);
            return null;
          }
          return lastGood(ik);
        } catch {
          return lastGood(ik);
        } finally {
          inflight.delete(ik);
        }
      })());
    }
    return inflight.get(ik);
  }

  async function handleHttp(req, res) {
    await loadOnce();
    const send = (status, obj) => {
      res.statusCode = status;
      if (typeof res.setHeader === 'function') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify(obj));
    };
    try {
      const parsed = parseAdsbdbRequest(req.url);
      if (parsed.error) return send(parsed.status, { error: parsed.error });
      const data = await lookup(parsed.kind, parsed.key);
      return send(200, present(parsed.kind, data));
    } catch (err) {
      return send(500, { error: String(err?.message || err) });
    }
  }

  return {
    cache,
    loadOnce,
    lookup,
    handleHttp,
  };
}

let defaultRuntime = null;

export function getAdsbdbRuntime() {
  if (!defaultRuntime) {
    defaultRuntime = createAdsbdbRuntime({
      persistPath: defaultPersistPath(),
      persistImmediate: Boolean(process.env.VERCEL),
      persistIntervalMs: process.env.VERCEL ? 0 : 15_000,
    });
  }
  return defaultRuntime;
}

export function resetAdsbdbRuntime() {
  defaultRuntime = null;
}

export function createVercelAdsbdbHandler(runtimeFactory = getAdsbdbRuntime) {
  return async function handler(req, res) {
    req.url = restoreAdsbdbApiPath(req.url);
    try {
      const runtime = typeof runtimeFactory === 'function' ? runtimeFactory() : runtimeFactory;
      await runtime.handleHttp(req, res);
    } catch (err) {
      if (res.headersSent) return;
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: String(err?.message || err) }));
    }
  };
}

/** Default Node entry used by api/adsbdb/[...path].js */
export default createVercelAdsbdbHandler();

/**
 * Vite / preview plugin. Forwards /api/adsbdb to the shared handler.
 */
export function adsbdbProxy() {
  const runtime = createAdsbdbRuntime({
    persistPath: path.join(process.cwd(), '.gev-cache', 'adsbdb.json'),
    persistImmediate: false,
    persistIntervalMs: 15_000,
  });
  return {
    name: 'adsbdb-proxy',
    configureServer(server) {
      server.middlewares.use('/api/adsbdb', async (req, res) => {
        req.url = restoreAdsbdbApiPath(req.url);
        await runtime.handleHttp(req, res);
      });
    },
  };
}
