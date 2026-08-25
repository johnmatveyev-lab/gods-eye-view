/**
 * NASA FIRMS live active-fire proxy — shared by the Vite plugin and the
 * hosted Vercel `/api/firms` functions. The MAP_KEY stays server-side.
 *
 * Upstream: https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{SOURCE}/world/2
 *
 * Merges three VIIRS NRT sources (NOAA-20, NOAA-21, Suomi-NPP — independent
 * satellites, no cross-source dedup) fetched sequentially with `days=2`
 * (`days=1` means "current UTC day", nearly empty just after 00:00Z) and
 * clamps to the trailing 24 h via {@link parseFirmsCsv} / {@link filterTrailing24h}.
 * FIRMS quota is 5,000 transactions / 10 min per MAP_KEY, so the cache is the
 * point: TTL 30 min, single-flight refresh, serve-stale-on-failure.
 *
 * Hosted cache is in-memory last-good plus optional `/tmp` (ephemeral isolate
 * disk). No persistent volume. Local Vite still uses `.gev-cache/firms.json`
 * so a restart does not burn quota.
 *
 * Routes:
 *   GET /api/firms        → {fetchedAt, stale, ttlMs, sources, count, fires}
 *   GET /api/firms/status → {hasKey, lastFetch, count, stale, ttlMs, transactions}
 *
 * Keyless (no FIRMS_MAP_KEY): /api/firms → 503 {error:'no_key'}; status →
 * {hasKey:false}. Upstream is never touched without a key.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { filterTrailing24h, parseFirmsCsv } from './firmsCsv.js';

export { filterTrailing24h, parseFirmsCsv };

export const FIRMS_TTL_MS = 30 * 60_000;
export const FIRMS_STATUS_TTL_MS = 5 * 60_000;
export const FIRMS_SOURCES = Object.freeze([
  'VIIRS_NOAA20_NRT',
  'VIIRS_NOAA21_NRT',
  'VIIRS_SNPP_NRT',
]);

export const config = {
  api: {
    bodyParser: false,
  },
};

/** In-memory last-good + optional `/tmp` on Vercel; local Vite keeps `.gev-cache`. */
export function defaultFirmsCachePath(env = process.env) {
  if (String(env.VERCEL || '').trim()) return '/tmp/meridian-firms.json';
  return path.join(process.cwd(), '.gev-cache', 'firms.json');
}

export function createFirmsRuntime({
  env = process.env,
  now = () => Date.now(),
  fetchFn = globalThis.fetch,
  cachePath,
  log = console,
} = {}) {
  const diskPath = cachePath === undefined ? defaultFirmsCachePath(env) : cachePath;

  /** @type {?{at: number, sources: Array<object>, fires: Array<object>}} */
  let mem = null;
  let diskChecked = false;
  /** @type {?Promise<?{at: number, sources: Array<object>, fires: Array<object>}>} */
  let inflight = null;
  /** @type {?{at: number, transactions: ?{used: number, limit: number}}} */
  let statusCache = null;
  /** @type {?Promise<?{used: number, limit: number}>} */
  let statusInflight = null;

  function mapKey() {
    return String(env.FIRMS_MAP_KEY || '').trim();
  }

  async function readDiskOnce() {
    if (diskChecked || !diskPath) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(diskPath, 'utf8'));
      if (Number.isFinite(parsed?.at) && Array.isArray(parsed?.sources) && Array.isArray(parsed?.fires)) {
        mem = parsed;
      }
    } catch { /* no disk cache yet */ }
  }

  async function writeDisk(entry) {
    if (!diskPath) return;
    try {
      await fsp.mkdir(path.dirname(diskPath), { recursive: true });
      await fsp.writeFile(diskPath, JSON.stringify(entry), 'utf8');
    } catch (err) {
      log.warn?.('[firms-proxy] cache write failed:', err?.message || err);
    }
  }

  /**
   * Fetch + parse one FIRMS source. Throws on HTTP error or a non-CSV body
   * (FIRMS reports errors as HTML/plain text, never CSV). Never log the URL —
   * it embeds the MAP_KEY.
   */
  async function fetchSource(key, source) {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/world/2`;
    const res = await fetchFn(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const records = parseFirmsCsv(await res.text());
    if (records === null) throw new Error('non-CSV upstream response');
    return records;
  }

  /**
   * Refresh all sources sequentially (quota courtesy — never in parallel).
   * Partial success (≥1 source ok) still produces a cacheable entry with the
   * failed sources marked ok:false; total failure throws so the caller can
   * serve stale.
   */
  async function refreshUpstream(key) {
    const at = now();
    const sources = [];
    const fires = [];
    for (const source of FIRMS_SOURCES) {
      try {
        const records = filterTrailing24h(await fetchSource(key, source), at);
        sources.push({ source, count: records.length, ok: true });
        fires.push(...records);
      } catch (err) {
        log.warn?.(`[firms-proxy] ${source} fetch failed:`, err?.message || err);
        sources.push({ source, count: 0, ok: false });
      }
    }
    if (!sources.some((s) => s.ok)) throw new Error('all FIRMS sources failed');
    return { at, sources, fires };
  }

  /**
   * Cache entry → response payload. Fires are RE-filtered to the trailing
   * 24 h at serve time so a stale cache never serves >24h-old detections.
   */
  function buildPayload(entry, stale) {
    const fires = filterTrailing24h(entry.fires, now());
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: FIRMS_TTL_MS,
      sources: entry.sources,
      count: fires.length,
      fires,
    };
  }

  /** mapkey_status transactions, cached 5 min, best-effort (null on failure). */
  function getTransactions(key) {
    const t = now();
    if (statusCache && t - statusCache.at < FIRMS_STATUS_TTL_MS) {
      return Promise.resolve(statusCache.transactions);
    }
    if (!statusInflight) {
      statusInflight = (async () => {
        try {
          const url = `https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=${encodeURIComponent(key)}`;
          const res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.json();
          const used = Number(body?.current_transactions);
          const limit = Number(body?.transaction_limit);
          return Number.isFinite(used) && Number.isFinite(limit) ? { used, limit } : null;
        } catch (err) {
          log.warn?.('[firms-proxy] mapkey status failed:', err?.message || err);
          return null;
        }
      })()
        .then((transactions) => {
          statusCache = { at: now(), transactions };
          return transactions;
        })
        .finally(() => { statusInflight = null; });
    }
    return statusInflight;
  }

  async function getOrRefreshFires(key) {
    await readDiskOnce();
    const entry = mem;
    if (entry && now() - entry.at < FIRMS_TTL_MS) {
      return { entry, stale: false };
    }
    if (!inflight) {
      inflight = refreshUpstream(key)
        .then(async (fresh) => {
          mem = fresh;
          await writeDisk(fresh);
          return fresh;
        })
        .catch((err) => {
          log.warn?.(`[firms-proxy] refresh failed (${err?.message || err}) — serving cache if any`);
          return null;
        })
        .finally(() => { inflight = null; });
    }
    const pending = inflight;
    const fresh = await pending;
    if (fresh) return { entry: fresh, stale: false };
    if (entry) return { entry, stale: true };
    return { entry: null, stale: true };
  }

  return {
    env,
    now,
    mapKey,
    readDiskOnce,
    getTransactions,
    getOrRefreshFires,
    buildPayload,
    getMem() { return mem; },
    seedMem(entry) { mem = entry; diskChecked = true; },
  };
}

let defaultRuntime = null;

export function getFirmsRuntime(overrides) {
  if (overrides) return createFirmsRuntime(overrides);
  if (!defaultRuntime) defaultRuntime = createFirmsRuntime();
  return defaultRuntime;
}

export function resetFirmsRuntime() {
  defaultRuntime = null;
}

/**
 * Restore `/api/firms` or `/api/firms/status` when Vite leftover-mounts or a
 * Vercel catch-all hands us only the suffix. Do not invent a SPA rewrite.
 */
export function restoreFirmsPath(url, prefix = '/api/firms') {
  const parsed = parseUrl(url);
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  if (pathname === '/api/firms' || pathname === '/api/firms/status') {
    return `${pathname}${parsed.search}`;
  }
  if (pathname.startsWith('/api/firms/')) {
    return `${pathname}${parsed.search}`;
  }
  if (prefix === '/api/firms/status' || pathname === '/status') {
    return `/api/firms/status${parsed.search}`;
  }
  if (pathname === '/' || pathname === '') {
    return `${prefix}${parsed.search}`;
  }
  const rest = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${prefix}${rest}${parsed.search}`;
}

export function firmsPathname(url) {
  return parseUrl(restoreFirmsPath(url)).pathname.replace(/\/+$/, '') || '/';
}

export async function handleFirmsHttp(req, res, runtime = getFirmsRuntime()) {
  const pathname = firmsPathname(req.url);
  if (pathname === '/api/firms/status') {
    return handleFirmsStatus(res, runtime);
  }
  if (pathname === '/api/firms') {
    return handleFirmsFires(res, runtime);
  }
  return writeJson(res, 404, { error: 'Not found' });
}

async function handleFirmsStatus(res, runtime) {
  const key = runtime.mapKey();
  if (!key) {
    return writeJson(res, 200, {
      hasKey: false,
      lastFetch: null,
      count: null,
      stale: false,
      ttlMs: FIRMS_TTL_MS,
      transactions: null,
    });
  }
  await runtime.readDiskOnce();
  const mem = runtime.getMem();
  const transactions = await runtime.getTransactions(key);
  return writeJson(res, 200, {
    hasKey: true,
    lastFetch: mem ? mem.at : null,
    count: mem ? mem.fires.length : null,
    stale: mem ? runtime.now() - mem.at >= FIRMS_TTL_MS : false,
    ttlMs: FIRMS_TTL_MS,
    transactions,
  });
}

async function handleFirmsFires(res, runtime) {
  const key = runtime.mapKey();
  if (!key) {
    return writeJson(res, 503, { error: 'no_key' });
  }
  const { entry, stale } = await runtime.getOrRefreshFires(key);
  if (!entry) {
    return writeJson(res, 502, { error: 'firms fetch failed and no cache available' });
  }
  return writeJson(res, 200, runtime.buildPayload(entry, stale));
}

export function createVercelFirmsHandler(prefix = '/api/firms', runtimeFactory = getFirmsRuntime) {
  return async function handler(req, res) {
    req.url = restoreFirmsPath(req.url, prefix);
    try {
      await handleFirmsHttp(req, res, runtimeFactory());
    } catch (err) {
      if (res.headersSent) return;
      console.warn('[firms-proxy] error:', err?.message || err);
      writeJson(res, 500, { error: 'firms proxy error' });
    }
  };
}

/** Default Node entry used by api/firms/index.js */
export default createVercelFirmsHandler('/api/firms');

/**
 * Vite plugin: forwards `/api/firms` and `/api/firms/status` to {@link handleFirmsHttp}.
 * @param {() => ReturnType<typeof createFirmsRuntime>} [runtimeFactory]
 * @returns {import('vite').Plugin}
 */
export function firmsProxy(runtimeFactory = getFirmsRuntime) {
  function install(middlewares) {
    middlewares.use(async (req, res, next) => {
      const pathname = String(req.url || '').split('?')[0];
      if (pathname !== '/api/firms' && pathname !== '/api/firms/status') {
        next();
        return;
      }
      try {
        await handleFirmsHttp(req, res, runtimeFactory());
      } catch (err) {
        console.warn('[firms-proxy] error:', err?.message || err);
        if (res.headersSent) return;
        writeJson(res, 500, { error: 'firms proxy error' });
      }
    });
  }

  return {
    name: 'firms-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

function parseUrl(url) {
  const raw = String(url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function writeJson(res, status, body) {
  if (res.headersSent) return true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
  return true;
}
