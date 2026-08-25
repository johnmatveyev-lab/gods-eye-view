/**
 * Thin Netlify Functions v2 adapter for hosted `/api/*`.
 *
 * Maps the request path onto the existing Vercel Node default-export handlers
 * under `api/` and invokes them with a Node req/res pair. No business logic
 * is copied. Disabled commercial-fork sources stay disabled.
 *
 * @module src/server/netlifyLiveApi
 */

import { Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';

/**
 * Functions v2 routing. `/api/*` is owned here so the SPA fallback cannot
 * serve index.html for live or billing URLs.
 */
export const config = {
  path: ['/api', '/api/*'],
};

/**
 * Vercel `api/` file routes. Static imports keep Netlify esbuild from dropping
 * handlers. More-specific kinds win: exact, then `:param`, then longest
 * catch-all prefix.
 */
const VERCEL_API_ROUTES = Object.freeze([
  exactRoute('/api/stripe/webhook', 'api/stripe/webhook.js', () => import('../../api/stripe/webhook.js')),
  exactRoute('/api/google/text-search', 'api/google/text-search.js', () => import('../../api/google/text-search.js')),
  exactRoute('/api/google/nearby-places', 'api/google/nearby-places.js', () => import('../../api/google/nearby-places.js')),
  exactRoute('/api/openai/hud-summary', 'api/openai/hud-summary.js', () => import('../../api/openai/hud-summary.js')),
  exactRoute('/api/realtime/token', 'api/realtime/token.js', () => import('../../api/realtime/token.js')),
  exactRoute('/api/weather-effects', 'api/weather-effects.js', () => import('../../api/weather-effects.js')),
  exactRoute('/api/regional-brief', 'api/regional-brief.js', () => import('../../api/regional-brief.js')),
  exactRoute('/api/opensky-track', 'api/opensky-track.js', () => import('../../api/opensky-track.js')),
  exactRoute('/api/opensky', 'api/opensky.js', () => import('../../api/opensky.js')),
  exactRoute('/api/launches', 'api/launches.js', () => import('../../api/launches.js')),
  exactRoute('/api/route', 'api/route.js', () => import('../../api/route.js')),
  exactRoute('/api/terrain/heights', 'api/terrain/heights.js', () => import('../../api/terrain/heights.js')),
  exactRoute('/api/firms/status', 'api/firms/status.js', () => import('../../api/firms/status.js')),
  exactRoute('/api/firms', 'api/firms/index.js', () => import('../../api/firms/index.js')),
  exactRoute('/api/adsblol/trace', 'api/adsblol/trace.js', () => import('../../api/adsblol/trace.js')),
  exactRoute('/api/adsblol/mil', 'api/adsblol/mil.js', () => import('../../api/adsblol/mil.js')),
  paramRoute('/api/cctv/frame', 'id', 'api/cctv/frame/[id].js', () => import('../../api/cctv/frame/[id].js')),
  paramRoute('/api/cctv/stream', 'id', 'api/cctv/stream/[id].js', () => import('../../api/cctv/stream/[id].js')),
  paramRoute('/api/cctv/media', 'id', 'api/cctv/media/[id].js', () => import('../../api/cctv/media/[id].js')),
  catchAllRoute('/api/cctv', 'api/cctv/[...path].js', () => import('../../api/cctv/[...path].js')),
  catchAllRoute('/api/billing', 'api/billing/[...path].js', () => import('../../api/billing/[...path].js')),
  catchAllRoute('/api/celestrak', 'api/celestrak/[...group].js', () => import('../../api/celestrak/[...group].js')),
  catchAllRoute('/api/adsbdb', 'api/adsbdb/[...path].js', () => import('../../api/adsbdb/[...path].js')),
  catchAllRoute('/api/tomtom', 'api/tomtom/[...path].js', () => import('../../api/tomtom/[...path].js')),
  catchAllRoute('/api/radio', 'api/radio/[...path].js', () => import('../../api/radio/[...path].js')),
  catchAllRoute('/api/gbfs', 'api/gbfs/[...target].js', () => import('../../api/gbfs/[...target].js')),
  catchAllRoute('/api/ais-live', 'api/ais-live/[...path].js', () => import('../../api/ais-live/[...path].js')),
  catchAllRoute('/api', 'api/[...path].js', () => import('../../api/[...path].js')),
]);

const handlerCache = new Map();

/** Same hosted TomTom tile rewrite as vercel.json. Do not invent others. */
export function applyHostedApiRewrites(pathname) {
  const match = String(pathname || '').match(/^\/api\/tomtom\/flow\/([^/]+)\/([^/]+)\/([^/]+)\.pbf$/);
  if (!match) return String(pathname || '/');
  return `/api/tomtom/flow/${match[1]}/${match[2]}/${match[3]}`;
}

/**
 * Restore `/api/...` when Netlify hands us the function URL or a leftover
 * splat. Do not invent a SPA rewrite.
 */
export function restoreNetlifyApiPath(url) {
  const parsed = parseUrl(url);
  let pathname = parsed.pathname;
  const functionPrefix = '/.netlify/functions/api';
  if (pathname === functionPrefix || pathname.startsWith(`${functionPrefix}/`)) {
    const rest = pathname.slice(functionPrefix.length) || '/';
    pathname = rest === '/'
      ? '/api'
      : rest.startsWith('/api/')
        ? rest
        : `/api${rest.startsWith('/') ? rest : `/${rest}`}`;
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return `${pathname}${parsed.search}`;
  }
  const rest = pathname === '/' ? '' : pathname;
  return `/api${rest.startsWith('/') ? rest : `/${rest}`}${parsed.search}`;
}

/** Resolve the Vercel `api/` file that owns this path. */
export function resolveVercelApiFile(pathname) {
  return matchVercelApiRoute(pathname)?.file || null;
}

export function matchVercelApiRoute(pathname) {
  const normalized = normalizePathname(pathname);
  for (const route of VERCEL_API_ROUTES) {
    if (route.kind === 'exact' && route.prefix === normalized) {
      return { file: route.file, params: {}, load: route.load };
    }
  }
  for (const route of VERCEL_API_ROUTES) {
    if (route.kind !== 'param') continue;
    if (!normalized.startsWith(`${route.prefix}/`)) continue;
    const rest = normalized.slice(route.prefix.length + 1);
    if (!rest || rest.includes('/')) continue;
    return {
      file: route.file,
      params: { [route.param]: decodeURIComponent(rest) },
      load: route.load,
    };
  }
  let best = null;
  for (const route of VERCEL_API_ROUTES) {
    if (route.kind !== 'catchall') continue;
    if (normalized !== route.prefix && !normalized.startsWith(`${route.prefix}/`)) continue;
    if (!best || route.prefix.length > best.prefixLength) {
      best = { file: route.file, params: {}, load: route.load, prefixLength: route.prefix.length };
    }
  }
  return best ? { file: best.file, params: best.params, load: best.load } : null;
}

export async function invokeVercelApiHandler(request) {
  const restored = restoreNetlifyApiPath(request.url);
  const parsed = parseUrl(restored);
  parsed.pathname = applyHostedApiRewrites(parsed.pathname);
  const match = matchVercelApiRoute(parsed.pathname);
  if (!match) {
    return jsonResponse(404, { error: 'Not found' });
  }

  const handler = await loadHandler(match);
  if (typeof handler !== 'function') {
    return jsonResponse(500, { error: 'Live API request failed' });
  }

  const body = await readRequestBuffer(request);
  const req = createNodeRequest(request, {
    url: `${parsed.pathname}${parsed.search}`,
    query: {
      ...searchParamsObject(parsed.searchParams),
      ...match.params,
    },
    body,
  });
  const { res, chunks } = createNodeResponse();

  await handler(req, res);
  if (!res.headersSent && !res.writableEnded && !res.writableFinished) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'Not found' }));
  }
  if (!res.writableFinished) await finished(res);

  return toWebResponse(res, chunks);
}

/**
 * Fetch forbids a body on 204 / 205 / 304. An empty Buffer is still a body,
 * so those statuses must pass `null` or the Response constructor throws and
 * the adapter catch turns a legal 204 into a 500.
 */
export function toWebResponse(res, chunks) {
  const status = res.statusCode || 200;
  switch (status) {
    case 204:
    case 205:
    case 304:
      return new Response(null, {
        status,
        headers: toWebHeaders(res.headers),
      });
    default:
      return new Response(Buffer.concat(chunks), {
        status,
        headers: toWebHeaders(res.headers),
      });
  }
}

/** Default Netlify Functions v2 entry used by netlify/functions/api.js */
export default async function handleNetlifyLiveApi(request) {
  try {
    return await invokeVercelApiHandler(request);
  } catch (error) {
    return jsonResponse(500, { error: publicError(error) });
  }
}

function exactRoute(prefix, file, load) {
  return { kind: 'exact', prefix, file, load };
}

function paramRoute(prefix, param, file, load) {
  return { kind: 'param', prefix, param, file, load };
}

function catchAllRoute(prefix, file, load) {
  return { kind: 'catchall', prefix, file, load };
}

async function loadHandler(match) {
  if (handlerCache.has(match.file)) return handlerCache.get(match.file);
  const mod = await match.load();
  const handler = mod.default;
  handlerCache.set(match.file, handler);
  return handler;
}

function normalizePathname(pathname) {
  const raw = String(pathname || '/');
  if (raw.length > 1 && raw.endsWith('/')) return raw.replace(/\/+$/, '') || '/';
  return raw || '/';
}

function parseUrl(url) {
  const raw = String(url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function searchParamsObject(searchParams) {
  const query = {};
  for (const [key, value] of searchParams) {
    if (query[key] === undefined) query[key] = value;
    else if (Array.isArray(query[key])) query[key].push(value);
    else query[key] = [query[key], value];
  }
  return query;
}

async function readRequestBuffer(request) {
  const method = String(request.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return Buffer.alloc(0);
  try {
    return Buffer.from(await request.arrayBuffer());
  } catch {
    return Buffer.alloc(0);
  }
}

function nodeHeaders(headers) {
  const out = Object.create(null);
  if (!headers || typeof headers.forEach !== 'function') return out;
  headers.forEach((value, name) => {
    out[String(name).toLowerCase()] = value;
  });
  return out;
}

function clientAddress(request) {
  const forwarded = request.headers?.get?.('x-forwarded-for');
  if (forwarded) return String(forwarded).split(',')[0].trim();
  const netlify = request.headers?.get?.('x-nf-client-connection-ip');
  if (netlify) return String(netlify).trim();
  return 'local';
}

function createNodeRequest(request, { url, query, body }) {
  const chunks = body?.byteLength ? [body] : [];
  const req = Readable.from(chunks);
  req.method = request.method || 'GET';
  req.url = url;
  req.originalUrl = url;
  req.headers = nodeHeaders(request.headers);
  req.query = query;
  req.rawBody = body?.byteLength ? body : undefined;
  req.socket = { remoteAddress: clientAddress(request) };
  return req;
}

export function createNodeResponse() {
  const chunks = [];
  const headers = Object.create(null);
  const res = new Writable({
    write(chunk, encoding, callback) {
      res.headersSent = true;
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      callback();
    },
    final(callback) {
      callback();
    },
  });
  res.statusCode = 200;
  res.headersSent = false;
  res.headers = headers;
  res.setHeader = function setHeader(name, value) {
    headers[String(name).toLowerCase()] = value;
  };
  res.getHeader = function getHeader(name) {
    return headers[String(name).toLowerCase()];
  };
  res.removeHeader = function removeHeader(name) {
    delete headers[String(name).toLowerCase()];
  };
  res.writeHead = function writeHead(status, maybeMessage, maybeHeaders) {
    this.statusCode = status;
    this.headersSent = true;
    const hdrs = typeof maybeMessage === 'object' && maybeMessage
      ? maybeMessage
      : (maybeHeaders || {});
    for (const [name, value] of Object.entries(hdrs)) {
      this.setHeader(name, value);
    }
  };
  return { res, chunks };
}

function toWebHeaders(nodeHeadersMap) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeHeadersMap || {})) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, String(item));
      continue;
    }
    headers.set(name, String(value));
  }
  return headers;
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function publicError(error) {
  const message = String(error?.message || '').trim();
  if (!message || message.length > 200 || message.includes('\n')) {
    return 'Live API request failed';
  }
  if (/sk_live|sk_test|rk_live|whsec_|OPENAI_API_KEY\s*=/i.test(message)) {
    return 'Live API request failed';
  }
  return message;
}
