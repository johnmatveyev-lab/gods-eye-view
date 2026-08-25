/**
 * Hosted GBFS (General Bikeshare Feed Specification) proxy.
 *
 * Shared by Vite (dev + preview) and the dedicated Vercel Node route
 * `api/gbfs/[...target].js`. Only allowlisted operator hosts and
 * station_information / station_status paths are forwarded. No arbitrary
 * hosts. User-Agent identifies Meridian, not the upstream MIT project.
 *
 * @module src/data/gbfs
 */

/** Upstream fetch timeout for GBFS requests (ms). */
export const GBFS_PROXY_TIMEOUT_MS = 12000;

/** Response body cap to prevent memory exhaustion from a malicious upstream. */
export const GBFS_MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Identify this product to GBFS operators. */
export const GBFS_PROXY_USER_AGENT = 'Meridian-gbfs-proxy/1.0';

/** Allowlisted GBFS hostnames; wildcard *.publicbikesystem.net also accepted. */
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
 * Return an appropriate Cache-Control header for a GBFS endpoint.
 *
 * station_information is semi-static (5 min cache); station_status is
 * real-time (no-store).
 *
 * @param {string} pathname
 * @returns {string} Cache-Control header value.
 */
export function gbfsCacheControl(pathname) {
  if (/\/station_information\.json$/i.test(String(pathname || ''))) {
    return 'public, max-age=300';
  }
  return 'no-store';
}

/**
 * Restore /api/gbfs/... when a Vercel catch-all hands us only the leftover
 * path. Do not invent a SPA rewrite.
 *
 * @param {string} url
 * @returns {string}
 */
export function restoreGbfsApiPath(url) {
  const parsed = parseUrl(url);
  if (parsed.pathname === '/api/gbfs' || parsed.pathname.startsWith('/api/gbfs/')) {
    return `${parsed.pathname}${parsed.search}`;
  }
  const rest = parsed.pathname === '/' ? '' : parsed.pathname;
  return `/api/gbfs${rest.startsWith('/') ? rest : `/${rest}`}${parsed.search}`;
}

/**
 * Connect / Vercel handler for GET /api/gbfs/<encoded-upstream-URL>.
 *
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {(req: object, res: object) => Promise<void>}
 */
export function createGbfsHandler({ fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  return async function handleGbfsHttp(req, res) {
    try {
      if (req.method !== 'GET') {
        writeJson(res, 405, { error: 'Method Not Allowed' });
        return;
      }

      const encodedTarget = encodedGbfsTarget(req.url);
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
        upstream = await doFetch(upstreamUrl.toString(), {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': GBFS_PROXY_USER_AGENT,
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
      writeRaw(res, upstream.status, {
        'Content-Type': contentType,
        'Cache-Control': gbfsCacheControl(upstreamUrl.pathname),
        'X-GBFS-Upstream': upstreamUrl.hostname,
        'X-GBFS-Cache': 'MISS',
      }, body);
    } catch (error) {
      if (error?.name === 'AbortError') {
        writeJson(res, 504, { error: 'GBFS upstream timeout' });
        return;
      }
      console.error('[GBFS Proxy]', error?.message || String(error));
      writeJson(res, 502, { error: 'GBFS proxy error' });
    }
  };
}

/**
 * Vite plugin: GBFS bike-share proxy with host allowlisting and size limits.
 *
 * Accepts GET /api/gbfs/<encoded-upstream-URL> and proxies the request
 * to the upstream GBFS provider. Validates hostname against an allowlist,
 * restricts to station_information/station_status paths, enforces HTTPS,
 * and caps response body at 5 MB.
 *
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {import('vite').Plugin}
 */
export function gbfsProxy(options = {}) {
  const handle = createGbfsHandler(options);
  return {
    name: 'gbfs-proxy',
    configureServer(server) {
      server.middlewares.use('/api/gbfs', handle);
    },
  };
}

/**
 * Vercel Node entry used by api/gbfs/[...target].js.
 *
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export function createVercelGbfsHandler(options = {}) {
  const handle = createGbfsHandler(options);
  return async function handler(req, res) {
    req.url = restoreGbfsApiPath(req.url);
    await handle(req, res);
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

/**
 * Accept both Vite-stripped `/<encoded>` and full `/api/gbfs/<encoded>` URLs.
 *
 * @param {string} reqUrl
 * @returns {string}
 */
function encodedGbfsTarget(reqUrl) {
  const url = parseUrl(reqUrl);
  let pathname = url.pathname;
  if (pathname === '/api/gbfs' || pathname.startsWith('/api/gbfs/')) {
    pathname = pathname.slice('/api/gbfs'.length);
  }
  return pathname.replace(/^\/+/, '');
}

function writeJson(res, status, payload) {
  writeRaw(res, status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  }, JSON.stringify(payload));
}

function writeRaw(res, status, headers, body) {
  res.statusCode = status;
  if (typeof res.writeHead === 'function') {
    res.writeHead(status, headers);
  } else if (typeof res.setHeader === 'function') {
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
  }
  res.end(body);
}
