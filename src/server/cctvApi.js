import { cctvProxy } from '../data/cctvProxy.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const CCTV_RESOURCE_KINDS = new Set(['frame', 'stream', 'media']);

/**
 * Restore /api/cctv/... when a Vercel catch-all hands us only the leftover
 * path. Do not invent a SPA rewrite. Do not wrap AIS or Google text-search.
 */
export function restoreCctvApiPath(url) {
  const parsed = parseUrl(url);
  if (parsed.pathname.startsWith('/api/cctv')) {
    return `${parsed.pathname}${parsed.search}`;
  }
  if (parsed.pathname === '/cctv' || parsed.pathname.startsWith('/cctv/')) {
    return `/api${parsed.pathname}${parsed.search}`;
  }
  const rest = parsed.pathname === '/' ? '' : parsed.pathname;
  return `/api/cctv${rest.startsWith('/') ? rest : `/${rest}`}${parsed.search}`;
}

/**
 * Vite-on-Vercel treats `[...path].js` as one extra segment, so
 * `/api/cctv/frame?id=354` can reach Node while `/frame/354` cannot.
 * Promote `?id=` onto `/frame/:id` (and stream/media) after the mount.
 */
export function promoteCctvResourceId(url, query = {}) {
  const parsed = parseUrl(url);
  const match = parsed.pathname.match(/^\/(frame|stream|media)\/?$/);
  const id = firstQueryValue(query?.id, parsed.searchParams.get('id'));
  if (!match || !id) {
    return `${parsed.pathname}${parsed.search}`;
  }
  parsed.searchParams.delete('id');
  const search = parsed.searchParams.toString();
  return `/${match[1]}/${encodeURIComponent(id)}${search ? `?${search}` : ''}`;
}

/**
 * Dedicated `api/cctv/{frame,stream,media}/[id].js` entries may hand us
 * leftover `/354`, `/frame/354`, or the full `/api/cctv/frame/354`.
 */
export function ensureCctvResourceUrl(url, kind, query = {}) {
  const resource = String(kind || '').trim();
  if (!CCTV_RESOURCE_KINDS.has(resource)) {
    return String(url || '/');
  }
  const parsed = parseUrl(url);
  const segments = parsed.pathname.split('/').filter(Boolean);
  const kindIdx = segments.lastIndexOf(resource);
  const idFromKind = kindIdx >= 0 ? segments[kindIdx + 1] : '';
  const last = segments.at(-1) || '';
  const reserved = new Set(['api', 'cctv', 'sources', 'health', ...CCTV_RESOURCE_KINDS]);
  const id = firstQueryValue(
    query?.id,
    parsed.searchParams.get('id'),
    idFromKind,
    reserved.has(last) ? '' : last,
  );
  if (!id) {
    return `${parsed.pathname}${parsed.search}`;
  }
  parsed.searchParams.delete('id');
  const search = parsed.searchParams.toString();
  return `/api/cctv/${resource}/${encodeURIComponent(id)}${search ? `?${search}` : ''}`;
}

export function createVercelCctvHandler(pluginFactory = cctvProxy) {
  let middleware = null;
  return async function handler(req, res) {
    const fullUrl = restoreCctvApiPath(req.url);
    req.url = promoteCctvResourceId(stripCctvMount(fullUrl), req.query);
    if (!middleware) {
      middleware = mountCctvMiddleware(pluginFactory);
    }
    try {
      await middleware(req, res);
      if (res.headersSent || res.writableEnded) return;
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'not found' }));
    } catch (error) {
      if (res.headersSent) return;
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: publicError(error) }));
    }
  };
}

/** Default Node entry used by api/cctv/[...path].js */
export default createVercelCctvHandler();

function mountCctvMiddleware(pluginFactory) {
  let fn = null;
  const plugin = pluginFactory();
  plugin.configureServer({
    middlewares: {
      use(pathOrFn, maybeFn) {
        fn = typeof pathOrFn === 'function' ? pathOrFn : maybeFn;
      },
    },
  });
  if (typeof fn !== 'function') {
    throw new Error('CCTV plugin did not register a middleware');
  }
  return fn;
}

function firstQueryValue(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const found = firstQueryValue(...value);
      if (found) return found;
      continue;
    }
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function parseUrl(url) {
  const raw = String(url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function stripCctvMount(url) {
  const parsed = parseUrl(url);
  let rest = parsed.pathname.replace(/^\/api\/cctv/, '') || '/';
  if (!rest.startsWith('/')) rest = `/${rest}`;
  return `${rest}${parsed.search}`;
}

function publicError(error) {
  const message = String(error?.message || '').trim();
  if (!message || message.length > 200 || message.includes('\n')) {
    return 'CCTV request failed';
  }
  if (/sk_live|sk_test|rk_live|whsec_|OPENAI_API_KEY\s*=/i.test(message)) {
    return 'CCTV request failed';
  }
  return message;
}
