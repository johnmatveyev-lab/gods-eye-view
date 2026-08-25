/**
 * Hosted AIS live stub. Snapshot + track only. Never opens AISStream.
 *
 * Vite still owns the websocket via `ais-live-proxy`. Hosted platforms
 * (Netlify / Vercel) must answer the browser contract with an honest empty
 * feed so the Ships row can paint UNAVAILABLE and stay unarmed.
 *
 * @module data/aisLiveHosted
 */

export const config = {
  api: {
    bodyParser: false,
  },
};

const AIS_LIVE_PREFIX = '/api/ais-live';

/**
 * Restore `/api/ais-live/...` when a catch-all hands us only the leftover
 * path (`/`, `/track`). Do not invent a SPA rewrite.
 *
 * @param {string|undefined} url
 * @returns {string}
 */
export function restoreAisLivePath(url) {
  const parsed = parseUrl(url);
  if (parsed.pathname === AIS_LIVE_PREFIX || parsed.pathname.startsWith(`${AIS_LIVE_PREFIX}/`)) {
    return `${parsed.pathname}${parsed.search}`;
  }
  const rest = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${AIS_LIVE_PREFIX}${rest.startsWith('/') ? rest : `/${rest}`}${parsed.search}`;
}

/**
 * Resolve the public `/api/ais-live/...` pathname for a Node request.
 *
 * @param {{url?: string, query?: {path?: string|string[]}}} req
 * @returns {string}
 */
export function aisLiveRequestPath(req) {
  const leftover = req?.query?.path;
  if (Array.isArray(leftover) && leftover.length > 0) {
    return `${AIS_LIVE_PREFIX}/${leftover.join('/')}`;
  }
  if (typeof leftover === 'string' && leftover) {
    return `${AIS_LIVE_PREFIX}/${leftover}`;
  }
  return restoreAisLivePath(req?.url);
}

/** Empty snapshot the Ships layer already classifies as unsupported. */
export function createHostedAisLiveSnapshot() {
  return {
    rows: [],
    source: 'AISStream',
    status: 'unsupported',
    error: 'live AIS is not available on this host',
    refreshing: false,
    newestPositionAt: null,
    lastMessageAt: null,
    silentForMs: null,
    reconnectAttempt: 0,
    nextAttemptAt: null,
  };
}

/**
 * Node req/res handler for GET /api/ais-live and /api/ais-live/track.
 * Does not read AISSTREAM_API_KEY and does not open a socket.
 *
 * @param {{url?: string, query?: object}} req
 * @param {{statusCode: number, setHeader: Function, end: Function, headersSent?: boolean}} res
 */
export function handleAisLiveHostedHttp(req, res) {
  try {
    const incoming = parseUrl(aisLiveRequestPath(req));
    const pathname = normalizePathname(incoming.pathname);

    if (pathname === `${AIS_LIVE_PREFIX}/track` || pathname.startsWith(`${AIS_LIVE_PREFIX}/track/`)) {
      const mmsi = String(incoming.searchParams.get('mmsi') || '').trim();
      const valid = /^\d{5,10}$/.test(mmsi);
      writeJson(res, valid ? 200 : 400, valid
        ? { mmsi, samples: [] }
        : { error: 'mmsi query param required', samples: [] });
      return;
    }

    if (pathname === AIS_LIVE_PREFIX) {
      // 503 matches the Vite missing-key contract so the existing client
      // unarms; JSON status is unsupported (hosted never opens AISStream).
      writeJson(res, 503, createHostedAisLiveSnapshot());
      return;
    }

    writeJson(res, 404, { error: 'Not found' });
  } catch {
    writeJson(res, 500, { error: 'AIS live request failed', rows: [] });
  }
}

export function createVercelAisLiveHandler() {
  return async function handler(req, res) {
    req.url = restoreAisLivePath(req.url);
    handleAisLiveHostedHttp(req, res);
  };
}

/** Default Node entry used by api/ais-live/[...path].js */
export default createVercelAisLiveHandler();

function parseUrl(url) {
  const raw = String(url || '/');
  try {
    return raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

function normalizePathname(pathname) {
  const raw = String(pathname || '/');
  if (raw.length > 1 && raw.endsWith('/')) return raw.replace(/\/+$/, '') || '/';
  return raw || '/';
}

function writeJson(res, status, body) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
