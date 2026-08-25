/**
 * CelesTrak GP/TLE proxy with a memory + optional disk cache.
 * Upstream: https://celestrak.org/NORAD/elements/gp.php?GROUP=<group>&FORMAT=tle
 * CelesTrak asks clients not to re-fetch GP data more than ~every 2 h and
 * throttles offenders; every dev reload used to refetch every group. Cache TTL
 * 6 h; on upstream failure the freshest stale copy is served (a stale TLE
 * beats an empty satellites layer). Hosted isolates may persist a copy under
 * /tmp when that filesystem is writable; write failures stay memory-only.
 * Adapted from skylight's TleStore (MIT).
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';

export const CELESTRAK_TTL_MS = 6 * 3600_000;
export const CELESTRAK_UPSTREAM = 'https://celestrak.org/NORAD/elements/gp.php';
export const CELESTRAK_USER_AGENT =
  'Meridian-celestrak-proxy/1.0 (+https://github.com/johnmatveyev-lab/gods-eye-view)';
export const CELESTRAK_GROUP_RE = /^[a-z0-9-]+$/i;
export const CELESTRAK_API_PREFIX = '/api/celestrak';

export const config = {
  api: {
    bodyParser: false,
  },
};

const TRAVERSAL_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

/**
 * Hosted Vercel isolates can write /tmp; local Vite keeps `.gev-cache`.
 * Disk is optional — a read-only filesystem still serves from memory.
 */
export function defaultCelestrakCacheDir({ env = process.env, cwd = process.cwd() } = {}) {
  if (env.VERCEL) return path.join('/tmp', 'meridian-celestrak');
  return path.join(cwd, '.gev-cache');
}

export function isCelestrakTleBody(body) {
  return typeof body === 'string' && /^1 /m.test(body);
}

export function celestrakUpstreamUrl(group) {
  const url = new URL(CELESTRAK_UPSTREAM);
  url.searchParams.set('GROUP', group);
  url.searchParams.set('FORMAT', 'tle');
  return url.toString();
}

function stripOrigin(pathname) {
  const raw = String(pathname || '');
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) return raw;
  const slash = raw.indexOf('/', raw.indexOf('//') + 2);
  return slash >= 0 ? raw.slice(slash) : '/';
}

function containsTraversal(value) {
  let decoded = String(value ?? '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return true;
  }
  return TRAVERSAL_RE.test(decoded) || decoded.includes('\\');
}

export function validCelestrakGroup(value) {
  if (containsTraversal(value)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(String(value ?? ''));
  } catch {
    return null;
  }
  if (!decoded || decoded.includes('/') || decoded.includes('\\')) return null;
  if (!CELESTRAK_GROUP_RE.test(decoded)) return null;
  return decoded;
}

/**
 * Restore `/api/celestrak/<group>` when a Vercel catch-all hands us only the
 * leftover path. Does not resolve `..` — traversal stays visible so the
 * group parser can 400. Do not invent a SPA rewrite.
 */
export function restoreCelestrakPath(url) {
  const raw = String(url || '/');
  const qIndex = raw.indexOf('?');
  const pathname = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const search = qIndex >= 0 ? raw.slice(qIndex) : '';
  const pathOnly = stripOrigin(pathname) || '/';
  if (pathOnly === CELESTRAK_API_PREFIX || pathOnly.startsWith(`${CELESTRAK_API_PREFIX}/`)) {
    return `${pathOnly}${search}`;
  }
  const rest = pathOnly === '/' ? '' : pathOnly;
  return `${CELESTRAK_API_PREFIX}${rest.startsWith('/') ? rest : `/${rest}`}${search}`;
}

export function parseCelestrakGroupFromRequest(req) {
  const rawUrl = String(req?.url || '');
  const pathOnly = stripOrigin(rawUrl.split('?')[0]);
  if (containsTraversal(pathOnly)) return null;

  const fromQuery = req?.query?.group;
  if (fromQuery !== undefined && fromQuery !== null) {
    const parts = Array.isArray(fromQuery) ? fromQuery : [fromQuery];
    if (parts.length !== 1) return null;
    if (parts.some((part) => containsTraversal(String(part)))) return null;
    return validCelestrakGroup(String(parts[0]));
  }

  let rest = pathOnly;
  if (rest === CELESTRAK_API_PREFIX || rest.startsWith(`${CELESTRAK_API_PREFIX}/`)) {
    rest = rest.slice(CELESTRAK_API_PREFIX.length);
  }
  rest = rest.replace(/^\/+/, '');
  return validCelestrakGroup(rest);
}

export function createCelestrakStore({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  cacheDir = defaultCelestrakCacheDir(),
  mem = new Map(),
  ttlMs = CELESTRAK_TTL_MS,
  userAgent = CELESTRAK_USER_AGENT,
  makeSignal = (ms) => AbortSignal.timeout(ms),
  timeoutMs = 20_000,
  fsImpl = fsp,
} = {}) {
  const inflight = new Map();

  function diskFile(group) {
    if (!cacheDir) return null;
    return path.join(cacheDir, `celestrak-${group}.json`);
  }

  async function readDisk(group) {
    const file = diskFile(group);
    if (!file) return null;
    try {
      const parsed = JSON.parse(await fsImpl.readFile(file, 'utf8'));
      if (typeof parsed?.body === 'string' && Number.isFinite(parsed?.at)) return parsed;
    } catch { /* no disk cache yet, or /tmp unavailable */ }
    return null;
  }

  async function writeDisk(group, entry) {
    const file = diskFile(group);
    if (!file) return;
    try {
      await fsImpl.mkdir(cacheDir, { recursive: true });
      await fsImpl.writeFile(file, JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn(`[celestrak-proxy] cache write failed for ${group}:`, err?.message || err);
    }
  }

  async function fetchUpstream(group) {
    const res = await fetchImpl(celestrakUpstreamUrl(group), {
      signal: makeSignal(timeoutMs),
      // CelesTrak 403s bulk groups (e.g. `active`) unless the request carries a
      // descriptive User-Agent with a contact point.
      headers: { 'User-Agent': userAgent },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    // An upstream error page parses to zero TLEs — treat as failure, keep cache.
    if (!isCelestrakTleBody(body)) throw new Error('no TLE lines in response');
    return { at: now(), body };
  }

  async function resolve(group) {
    const t = now();
    let entry = mem.get(group);
    if (!entry) {
      entry = await readDisk(group);
      if (entry) mem.set(group, entry);
    }
    if (entry && t - entry.at < ttlMs) {
      return { status: 200, body: entry.body, cache: 'HIT' };
    }
    if (!inflight.has(group)) {
      inflight.set(group, fetchUpstream(group)
        .then(async (fresh) => {
          mem.set(group, fresh);
          await writeDisk(group, fresh);
          return fresh;
        })
        .catch((err) => {
          console.warn(`[celestrak-proxy] ${group} refresh failed (${err?.message || err}) — serving cache if any`);
          return null;
        })
        .finally(() => inflight.delete(group)));
    }
    const fresh = await inflight.get(group);
    if (fresh) return { status: 200, body: fresh.body, cache: 'MISS' };
    if (entry) return { status: 200, body: entry.body, cache: 'STALE-ERROR' };
    return { status: 502, body: 'celestrak fetch failed and no cache available', cache: 'NONE' };
  }

  return {
    resolve,
    mem,
    seed(group, entry) {
      mem.set(group, entry);
    },
  };
}

function sendCelestrak(res, status, body, cacheStatus) {
  if (res.headersSent) return;
  const headers = { 'Content-Type': 'text/plain' };
  if (cacheStatus) headers['x-tle-cache'] = cacheStatus;
  res.statusCode = status;
  if (typeof res.writeHead === 'function') {
    res.writeHead(status, headers);
  } else if (typeof res.setHeader === 'function') {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  }
  res.end(body);
}

export async function handleCelestrakHttp(req, res, store) {
  const group = parseCelestrakGroupFromRequest(req);
  if (!group) {
    sendCelestrak(res, 400, 'invalid group');
    return;
  }
  try {
    const result = await store.resolve(group);
    sendCelestrak(res, result.status, result.body, result.cache);
  } catch (err) {
    sendCelestrak(res, 500, `celestrak proxy error: ${err?.message || err}`, 'ERROR');
  }
}

/** Vite plugin: same-origin `/api/celestrak/<group>` forwards here. */
export function celestrakProxy(options = {}) {
  const store = createCelestrakStore({
    cacheDir: path.join(process.cwd(), '.gev-cache'),
    ...options,
  });
  const handle = (req, res) => handleCelestrakHttp(req, res, store);
  return {
    name: 'celestrak-proxy',
    configureServer(server) {
      server.middlewares.use('/api/celestrak', handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/celestrak', handle);
    },
  };
}

export function createVercelCelestrakHandler(storeOrFactory = () => createCelestrakStore()) {
  const store = typeof storeOrFactory === 'function' ? storeOrFactory() : storeOrFactory;
  return async function handler(req, res) {
    req.url = restoreCelestrakPath(req.url);
    try {
      await handleCelestrakHttp(req, res, store);
    } catch (err) {
      sendCelestrak(res, 500, `celestrak proxy error: ${err?.message || err}`, 'ERROR');
    }
  };
}

/** Default Node entry used by api/celestrak/[...group].js */
export default createVercelCelestrakHandler();
