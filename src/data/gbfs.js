/**
 * Hosted GBFS bike-share proxy.
 *
 * Same-origin GET /api/gbfs/<encoded-upstream-URL> with a fixed host allowlist
 * and station_information / station_status path lock. Vite and the Vercel
 * Node entry both call handleGbfsHttp — no arbitrary hosts.
 *
 * @module src/data/gbfs
 */

/** Upstream fetch timeout for GBFS requests (ms). */
export const GBFS_PROXY_TIMEOUT_MS = 12000;

/** Response body cap (bytes). */
export const GBFS_MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Upstream User-Agent for Meridian's GBFS proxy. */
export const GBFS_USER_AGENT = 'Meridian-gbfs-proxy/1.0';

/**
 * Allowlisted GBFS hostnames; wildcard *.publicbikesystem.net also accepted.
 * Keep this list exact — do not add arbitrary operators here.
 */
export const GBFS_ALLOWED_HOSTS = new Set([
  'gbfs.lyft.com',
  'gbfs.bluebikes.com',
  'gbfs.bcycle.com',
  'gbfs.biketownpdx.com',
  'gbfs.cogobikeshare.com',
  'austin.publicbikesystem.net',
  'hon.publicbikesystem.net',
  'chat.publicbikesystem.net',
]);

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Restore /api/gbfs/... when a Vercel catch-all hands us only the leftover path.
 * Do not invent a SPA rewrite.
 *
 * @param {string} url
 * @returns {string}
 */
export function restoreGbfsPath(url) {
  const parsed = parseUrl(url);
  if (parsed.pathname === '/api/gbfs' || parsed.pathname.startsWith('/api/gbfs/')) {
    return `${parsed.pathname}${parsed.search}`;
  }
  const rest = parsed.pathname === '/' ? '/' : parsed.pathname;
  return `/api/gbfs${rest.startsWith('/') ? rest : `/${rest}`}${parsed.search}`;
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
export function isAllowedGbfsHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return false;
  if (GBFS_ALLOWED_HOSTS.has(host)) return true;
  return host.endsWith('.publicbikesystem.net');
}

/**
 * Only allow station_information.json and station_status.json endpoints.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function isAllowedGbfsPath(pathname) {
  return /\/station_(information|status)\.json$/i.test(String(pathname || ''));
}

/**
 * station_information is semi-static (5 min cache); station_status is
 * real-time (no-store).
 *
 * @param {string} pathname
 * @returns {string}
 */
export function gbfsCacheControl(pathname) {
  if (/\/station_information\.json$/i.test(String(pathname || ''))) {
    return 'public, max-age=300';
  }
  return 'no-store';
}

/**
 * Handle GET /api/gbfs/<encoded-upstream-URL> (or a Vite leftover path).
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export async function handleGbfsHttp(req, res, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  try {
    if (req.method !== 'GET') {
      writeJson(res, 405, { error: 'Method Not Allowed' });
      return;
    }

    const encodedTarget = extractEncodedTarget(req.url);
    if (!encodedTarget) {
      writeJson(res, 400, { error: 'Missing GBFS upstream target' });
      return;
    }

    let decodedTarget = '';
    try {
      decodedTarget = decodeURIComponent(encodedTarget);
    } catch {
      writeJson(res, 400, { error: 'Invalid GBFS target encoding' });
      return;
    }

    let upstreamUrl = null;
    try {
      upstreamUrl = new URL(decodedTarget);
    } catch {
      writeJson(res, 400, { error: 'Invalid GBFS upstream URL' });
      return;
    }

    if (upstreamUrl.protocol !== 'https:') {
      writeJson(res, 400, { error: 'Only https GBFS targets are allowed' });
      return;
    }

    if (!isAllowedGbfsHost(upstreamUrl.hostname)) {
      writeJson(res, 403, { error: 'GBFS host not allowed' });
      return;
    }

    if (!isAllowedGbfsPath(upstreamUrl.pathname)) {
      writeJson(res, 400, { error: 'Only station_information/station_status endpoints are allowed' });
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GBFS_PROXY_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetchImpl(upstreamUrl.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': GBFS_USER_AGENT,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const contentLength = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > GBFS_MAX_BODY_BYTES) {
      writeJson(res, 502, { error: 'GBFS upstream response too large' });
      return;
    }
    const body = await upstream.text();
    if (body.length > GBFS_MAX_BODY_BYTES) {
      writeJson(res, 502, { error: 'GBFS upstream response too large' });
      return;
    }
    const contentType = upstream.headers.get('content-type') || 'application/json';
    writeHead(res, upstream.status, {
      'Content-Type': contentType,
      'Cache-Control': gbfsCacheControl(upstreamUrl.pathname),
      'X-GBFS-Upstream': upstreamUrl.hostname,
      'X-GBFS-Cache': 'MISS',
    });
    res.end(body);
  } catch (error) {
    if (error?.name === 'AbortError') {
      writeJson(res, 504, { error: 'GBFS upstream timeout' });
      return;
    }
    console.error('[GBFS Proxy]', error?.message || String(error));
    writeJson(res, 502, { error: 'GBFS proxy error' });
  }
}

/**
 * Vite plugin: GBFS bike-share proxy with host allowlisting and size limits.
 *
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {import('vite').Plugin}
 */
export function gbfsProxy(options = {}) {
  return {
    name: 'gbfs-proxy',
    configureServer(server) {
      server.middlewares.use('/api/gbfs', (req, res) => handleGbfsHttp(req, res, options));
    },
  };
}

/**
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export function createVercelGbfsHandler(options = {}) {
  return async function handler(req, res) {
    req.url = restoreGbfsPath(req.url);
    await handleGbfsHttp(req, res, options);
  };
}

/** Default Node entry used by api/gbfs/[...target].js */
export default createVercelGbfsHandler();

function parseUrl(url) {
  const raw = String(url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function extractEncodedTarget(url) {
  const parsed = parseUrl(url);
  let pathname = parsed.pathname;
  if (pathname === '/api/gbfs' || pathname.startsWith('/api/gbfs/')) {
    pathname = pathname.slice('/api/gbfs'.length) || '/';
  }
  return pathname.replace(/^\/+/, '');
}

function writeHead(res, status, headers) {
  if (typeof res.writeHead === 'function') {
    res.writeHead(status, headers);
    return;
  }
  res.statusCode = status;
  if (typeof res.setHeader === 'function') {
    for (const [name, value] of Object.entries(headers || {})) {
      res.setHeader(name, value);
    }
  }
}

function writeJson(res, status, payload) {
  writeHead(res, status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}
