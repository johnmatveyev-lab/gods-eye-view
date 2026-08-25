/**
 * Launch Library 2 recent-launch proxy.
 *
 * Hosted and Vite both call handleLaunchesHttp. Successful responses stay in
 * memory for 15 minutes, optionally persist under /tmp (Vercel) or .gev-cache
 * (local), and the last good body is served when a refresh fails. Malformed
 * upstream payloads never overwrite that cache.
 *
 * Vendor: Launch Library 2 only (ll.thespacedevs.com). No other launch source.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

export const LL2_CACHE_TTL_MS = 15 * 60_000;
export const LL2_UPSTREAM_TIMEOUT_MS = 20_000;
export const LL2_MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
export const LL2_MAX_DISK_CACHE_BYTES = 24 * 1024 * 1024;
export const LL2_UPSTREAM_URL = 'https://ll.thespacedevs.com/2.3.0/launches/';
export const LL2_INFLIGHT_KEY = 'recent-launches';

/** Build LL2 request headers without exposing its optional token client-side. */
export function launchLibraryRequestHeaders(token = process.env.LL2_API_TOKEN) {
  const normalized = String(token || '').trim();
  return {
    Accept: 'application/json',
    ...(normalized ? { Authorization: `Token ${normalized}` } : {}),
  };
}

/** Memory first; hosted isolates may also persist under /tmp. */
export function defaultLaunchCachePath(env = process.env) {
  if (env.LAUNCHES_CACHE_PATH) return env.LAUNCHES_CACHE_PATH;
  if (env.VERCEL) return '/tmp/launch-library-2-v2.3.json';
  return path.join(process.cwd(), '.gev-cache', 'launch-library-2-v2.3.json');
}

/** Share one per-key refresh and drop it only after that promise settles. */
export function coalesceLaunchesRequest(inFlight, key, create) {
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

export function createLaunchesRuntime({
  env = process.env,
  fetchImpl = globalThis.fetch.bind(globalThis),
  now = Date.now,
  ttlMs = LL2_CACHE_TTL_MS,
  cachePath,
  maxResponseBytes = LL2_MAX_RESPONSE_BYTES,
  maxDiskCacheBytes = LL2_MAX_DISK_CACHE_BYTES,
  initialCache,
  disk = fsp,
} = {}) {
  const resolvedPath = cachePath === undefined ? defaultLaunchCachePath(env) : cachePath;
  let cache = initialCache || null;
  let diskLoaded = initialCache !== undefined;
  const inFlight = new Map();

  async function loadDiskCache() {
    if (diskLoaded || !resolvedPath) return;
    diskLoaded = true;
    try {
      const stat = await disk.stat(resolvedPath);
      if (stat.size > maxDiskCacheBytes) throw new Error('cache file too large');
      const parsed = JSON.parse(await disk.readFile(resolvedPath, 'utf8'));
      if (Number.isFinite(parsed?.at) && typeof parsed?.body === 'string') {
        const body = JSON.parse(parsed.body);
        if (Array.isArray(body?.results)) cache = parsed;
      }
    } catch { /* first run or invalid cache */ }
  }

  async function saveDiskCache(entry) {
    if (!resolvedPath) return;
    try {
      await disk.mkdir(path.dirname(resolvedPath), { recursive: true });
      await disk.writeFile(resolvedPath, JSON.stringify(entry), 'utf8');
    } catch (error) {
      console.warn(`[launch-library-proxy] cache write failed: ${error?.message || error}`);
    }
  }

  async function refreshUpstream() {
    const end = new Date(now());
    const start = new Date(end.getTime() - 30 * 86400000);
    const url = new URL(LL2_UPSTREAM_URL);
    url.searchParams.set('net__gte', start.toISOString());
    url.searchParams.set('net__lte', end.toISOString());
    url.searchParams.set('limit', '100');
    url.searchParams.set('mode', 'detailed');
    const upstream = await fetchImpl(url, {
      signal: AbortSignal.timeout(LL2_UPSTREAM_TIMEOUT_MS),
      headers: launchLibraryRequestHeaders(env.LL2_API_TOKEN),
    });
    const body = await readResponseTextCapped(upstream, maxResponseBytes);
    if (!upstream.ok) {
      const error = new Error(`upstream HTTP ${upstream.status}`);
      error.upstreamStatus = upstream.status;
      error.upstreamBody = body;
      throw error;
    }
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed?.results)) throw new Error('malformed upstream response');
    const fresh = { at: now(), body };
    cache = fresh;
    void saveDiskCache(fresh);
    return fresh;
  }

  async function handleHttp(req, res) {
    if ((req.method || 'GET') !== 'GET') {
      sendLaunchesResponse(res, 405, JSON.stringify({ error: 'Method Not Allowed' }), 'NONE');
      return;
    }
    await loadDiskCache();
    const timestamp = now();
    if (cache && timestamp - cache.at < ttlMs) {
      sendLaunchesResponse(res, 200, cache.body, 'HIT');
      return;
    }
    const stale = cache;
    const request = coalesceLaunchesRequest(inFlight, LL2_INFLIGHT_KEY, refreshUpstream);
    try {
      const fresh = await request.promise;
      sendLaunchesResponse(res, 200, fresh.body, request.shared ? 'INFLIGHT' : 'MISS');
    } catch (error) {
      if (stale) {
        if (!request.shared) {
          console.warn(`[launch-library-proxy] refresh failed (${error?.message || error}) — serving stale cache`);
        }
        sendLaunchesResponse(res, 200, stale.body, 'STALE-ERROR');
        return;
      }
      let status = Number.isInteger(error?.upstreamStatus) ? error.upstreamStatus : 502;
      if (status === 404) status = 502;
      sendLaunchesResponse(
        res,
        status,
        error?.upstreamBody || JSON.stringify({ error: 'Launch Library 2 unavailable' }),
        'NONE',
      );
    }
  }

  return {
    handleHttp,
    getCache: () => cache,
    cachePath: resolvedPath,
  };
}

let defaultRuntime = null;

export function getLaunchesRuntime() {
  if (!defaultRuntime) defaultRuntime = createLaunchesRuntime();
  return defaultRuntime;
}

export function resetLaunchesRuntime() {
  defaultRuntime = null;
}

export async function handleLaunchesHttp(req, res, runtime = getLaunchesRuntime()) {
  await runtime.handleHttp(req, res);
}

/** Vite / preview middleware that forwards /api/launches to the shared handler. */
export function rocketLaunchesProxy(runtimeFactory = getLaunchesRuntime) {
  function install(middlewares) {
    middlewares.use('/api/launches', async (req, res) => {
      await handleLaunchesHttp(
        req,
        res,
        typeof runtimeFactory === 'function' ? runtimeFactory() : runtimeFactory,
      );
    });
  }

  return {
    name: 'rocket-launches-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

export function sendLaunchesResponse(res, status, body, cacheState) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': status === 200 ? 'public, max-age=900' : 'no-store',
    'X-GEV-Cache': cacheState,
  };
  res.statusCode = status;
  if (typeof res.setHeader === 'function') {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  } else if (typeof res.writeHead === 'function') {
    res.writeHead(status, headers);
  }
  res.end(body);
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
