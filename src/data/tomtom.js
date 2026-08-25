/**
 * @file TomTom traffic-flow proxy — Vite plugin + Vercel Node handler.
 *
 * Server-only. Do not import from client modules. The browser talks to
 * same-origin `/api/tomtom/*`; `TOMTOM_API_KEY` never leaves the isolate.
 *
 * Public JSON never includes the key or the upstream URL. Cache hits do not
 * count against `TOMTOM_DAILY_TILE_BUDGET` (default 40,000). The daily
 * counter is in-memory per isolate; tile bytes may sit in a 256-entry
 * memory map and, when writable, a short-lived disk dir (`.gev-cache/tomtom`
 * locally, `/tmp/tomtom` on Vercel).
 *
 * @module data/tomtom
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  isValidTileCoord,
  utcDayKey,
  normalizeBudget,
  isOverBudget,
} from './tomtomTiles.js';

/** @const {number} Default daily upstream-fetch soft cap. */
export const DEFAULT_DAILY_TILE_BUDGET = 40_000;
/** @const {number} Fresh-tile TTL. Stale entries stay for serve-stale. */
export const TILE_TTL_MS = 120_000;
/** @const {number} In-isolate memory cache cap (LRU-ish eviction). */
export const MEM_MAX_ENTRIES = 256;
/** @const {number} Upstream abort timeout. */
export const UPSTREAM_TIMEOUT_MS = 15_000;

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Restore `/api/tomtom/...` when a Vercel catch-all hands us only the leftover
 * path (`/status`, `/flow/6/18/25.pbf`). Do not invent a SPA rewrite.
 *
 * @param {string|undefined} url
 * @returns {string}
 */
export function restoreTomTomApiPath(url) {
  const parsed = parseUrl(url);
  if (parsed.pathname.startsWith('/api/tomtom')) {
    return `${parsed.pathname}${parsed.search}`;
  }
  const rest = parsed.pathname === '/' ? '' : parsed.pathname;
  return `/api/tomtom${rest.startsWith('/') ? rest : `/${rest}`}${parsed.search}`;
}

/**
 * Resolve the public `/api/tomtom/...` pathname for a Node/Vercel request.
 *
 * @param {{url?: string, query?: {path?: string|string[]}}} req
 * @returns {string}
 */
export function tomtomRequestPath(req) {
  const leftover = req?.query?.path;
  if (Array.isArray(leftover) && leftover.length > 0) {
    return `/api/tomtom/${leftover.join('/')}`;
  }
  if (typeof leftover === 'string' && leftover) {
    return `/api/tomtom/${leftover}`;
  }
  return restoreTomTomApiPath(req?.url);
}

/**
 * Create an isolate-scoped TomTom proxy runtime (memory cache + budget).
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} [options.env]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {string|null} [options.cacheDir] disk tile cache; `null` disables
 * @param {typeof fsp} [options.fs]
 * @returns {{handle: Function, getBudget: Function, seedTile: Function}}
 */
export function createTomTomRuntime({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  cacheDir,
  fs: fsImpl = fsp,
} = {}) {
  const tileCacheDir = cacheDir === undefined ? defaultTileCacheDir(env) : cacheDir;

  /** @type {Map<string, {at:number, buf:Buffer}>} */
  const mem = new Map();
  /** @type {Map<string, Promise<{at:number, buf:Buffer}|null>>} */
  const inflight = new Map();
  /** @type {{date:string, count:number}|null} */
  let budget = null;

  function dailyBudgetLimit() {
    const raw = Number.parseInt(env.TOMTOM_DAILY_TILE_BUDGET || '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_TILE_BUDGET;
  }

  function currentBudget() {
    budget = normalizeBudget(budget, utcDayKey(now()));
    return budget;
  }

  function recordUpstreamFetch() {
    currentBudget().count += 1;
  }

  function apiKey() {
    return typeof env.TOMTOM_API_KEY === 'string' ? env.TOMTOM_API_KEY : '';
  }

  function tileDiskPath(key) {
    return path.join(tileCacheDir, `flow-${key.replaceAll('/', '-')}.pbf`);
  }

  async function readDiskTile(key) {
    if (!tileCacheDir) return null;
    try {
      const file = tileDiskPath(key);
      const [stat, buf] = await Promise.all([
        fsImpl.stat(file),
        fsImpl.readFile(file),
      ]);
      return { at: stat.mtimeMs, buf };
    } catch {
      return null;
    }
  }

  async function writeDiskTile(key, buf) {
    if (!tileCacheDir) return;
    try {
      await fsImpl.mkdir(tileCacheDir, { recursive: true });
      await fsImpl.writeFile(tileDiskPath(key), buf);
    } catch (err) {
      console.warn(`[tomtom-proxy] tile cache write failed for ${key}:`, redactSecrets(err?.message || err, apiKey()));
    }
  }

  function memSet(key, entry) {
    if (!mem.has(key) && mem.size >= MEM_MAX_ENTRIES) {
      const oldest = mem.keys().next().value;
      mem.delete(oldest);
    }
    mem.set(key, entry);
  }

  async function fetchUpstream(z, x, y) {
    const key = apiKey();
    const url = 'https://api.tomtom.com/traffic/map/4/tile/flow/relative/'
      + `${z}/${x}/${y}.pbf?key=${encodeURIComponent(key)}`;
    recordUpstreamFetch();
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error('empty tile body');
    return buf;
  }

  async function handle(req, res) {
    const sendJson = (status, obj) => sendPublicJson(res, status, obj);
    const sendTile = (buf, cacheStatus) => {
      if (res.headersSent) return;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/x-protobuf');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('x-tomtom-cache', cacheStatus);
      res.end(buf);
    };

    try {
      const urlPath = tomtomRequestPath(req).split('?')[0].replace(/\/+$/, '') || '/';

      if (urlPath === '/api/tomtom/status') {
        const b = currentBudget();
        sendJson(200, {
          hasKey: Boolean(apiKey()),
          dailyCount: b.count,
          budget: dailyBudgetLimit(),
          date: b.date,
        });
        return;
      }

      const match = urlPath.match(/^\/api\/tomtom\/flow\/(\d+)\/(\d+)\/(\d+)(?:\.pbf)?$/);
      if (!match) {
        sendJson(404, { error: 'not_found' });
        return;
      }

      // Keyless installs must not touch TomTom — even for out-of-range zooms.
      if (!apiKey()) {
        sendJson(503, { error: 'no_key' });
        return;
      }

      const z = Number(match[1]);
      const x = Number(match[2]);
      const y = Number(match[3]);
      if (!isValidTileCoord(z, x, y)) {
        sendJson(400, { error: 'invalid_tile' });
        return;
      }

      const key = `${z}/${x}/${y}`;
      const t = now();

      let entry = mem.get(key);
      if (!entry) {
        entry = await readDiskTile(key);
        if (entry) memSet(key, entry);
      }
      if (entry && t - entry.at < TILE_TTL_MS) {
        sendTile(entry.buf, 'HIT');
        return;
      }

      if (isOverBudget(currentBudget(), dailyBudgetLimit())) {
        if (entry) {
          sendTile(entry.buf, 'STALE-BUDGET');
        } else {
          sendJson(429, { error: 'budget' });
        }
        return;
      }

      if (!inflight.has(key)) {
        inflight.set(key, fetchUpstream(z, x, y)
          .then(async (buf) => {
            const fresh = { at: now(), buf };
            memSet(key, fresh);
            await writeDiskTile(key, buf);
            return fresh;
          })
          .catch((err) => {
            console.warn(
              `[tomtom-proxy] ${key} fetch failed (${redactSecrets(err?.message || err, apiKey())}) — serving stale if any`,
            );
            return null;
          })
          .finally(() => inflight.delete(key)));
      }
      const fresh = await inflight.get(key);
      if (fresh) {
        sendTile(fresh.buf, 'MISS');
      } else if (entry) {
        sendTile(entry.buf, 'STALE-ERROR');
      } else {
        sendJson(502, { error: 'upstream' });
      }
    } catch (err) {
      console.warn('[tomtom-proxy] error:', redactSecrets(err?.message || err, apiKey()));
      sendJson(500, { error: 'proxy' });
    }
  }

  return {
    handle,
    getBudget: () => ({ ...currentBudget() }),
    seedTile(key, buf, at = now()) {
      memSet(key, { at, buf: Buffer.from(buf) });
    },
  };
}

/**
 * Dispatch one `/api/tomtom` request against a runtime (or a fresh default).
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {ReturnType<typeof createTomTomRuntime>} [runtime]
 */
export async function handleTomTomHttp(req, res, runtime = createTomTomRuntime()) {
  await runtime.handle(req, res);
}

/**
 * Vite plugin — forwards `/api/tomtom` to `handleTomTomHttp`.
 *
 * @param {Parameters<typeof createTomTomRuntime>[0]} [options]
 * @returns {import('vite').Plugin}
 */
export function tomtomProxy(options) {
  const runtime = createTomTomRuntime(options);
  function install(middlewares) {
    middlewares.use(async (req, res, next) => {
      const pathname = String(req.url || '').split('?')[0];
      if (!pathname.startsWith('/api/tomtom')) {
        next();
        return;
      }
      await handleTomTomHttp(req, res, runtime);
    });
  }
  return {
    name: 'tomtom-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

/**
 * Vercel Node handler. Catch-all leftovers are restored to `/api/tomtom/...`.
 *
 * @param {() => ReturnType<typeof createTomTomRuntime>} [runtimeFactory]
 */
export function createVercelTomTomHandler(runtimeFactory = getDefaultRuntime) {
  return async function handler(req, res) {
    req.url = restoreTomTomApiPath(req.url);
    try {
      await handleTomTomHttp(req, res, runtimeFactory());
    } catch (err) {
      if (res.headersSent) return;
      sendPublicJson(res, 500, { error: 'proxy' });
      console.warn('[tomtom-proxy] vercel error:', redactSecrets(err?.message || err, process.env.TOMTOM_API_KEY));
    }
  };
}

/** Default Node entry used by `api/tomtom/[...path].js`. */
export default createVercelTomTomHandler();

let defaultRuntime = null;

function getDefaultRuntime() {
  if (!defaultRuntime) defaultRuntime = createTomTomRuntime();
  return defaultRuntime;
}

function defaultTileCacheDir(env) {
  if (env?.VERCEL) return '/tmp/tomtom';
  return path.join(process.cwd(), '.gev-cache', 'tomtom');
}

function parseUrl(url) {
  const raw = String(url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function sendPublicJson(res, status, obj) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function redactSecrets(value, key) {
  let text = String(value ?? '');
  if (key) text = text.split(key).join('[redacted]');
  return text.replace(/https:\/\/api\.tomtom\.com\S*/gi, '[upstream]');
}
