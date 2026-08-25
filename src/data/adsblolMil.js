/**
 * Hosted adsb.lol military ADS-B proxy (ODbL 1.0).
 *
 * Upstream is https://api.adsb.lol/v2/mil only. OpenSky is never contacted.
 * Vite and the dedicated Vercel route share this handler: 12s in-process
 * memory cache, last-good JSON on upstream error.
 *
 * @module src/data/adsblolMil
 */

export const ADSBLOL_MIL_UPSTREAM_URL = 'https://api.adsb.lol/v2/mil';
export const ADSBLOL_MIL_USER_AGENT = 'Meridian-adsblol-proxy/1.0';
export const ADSBLOL_MIL_CACHE_MS = 12_000;
export const ADSBLOL_MIL_PATH = '/api/adsblol/mil';

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
});

function cacheHeaders(cacheStatus) {
  return {
    ...JSON_HEADERS,
    'X-ADS-B-Cache': cacheStatus,
  };
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {(...args: unknown[]) => void} [options.log]
 */
export function createAdsbLolMilProxy({
  fetchImpl = globalThis.fetch.bind(globalThis),
  now = Date.now,
  log = console.error,
} = {}) {
  /** @type {string|null} */
  let cacheBody = null;
  let cacheAt = 0;

  async function resolveMilitarySnapshot() {
    const timestamp = now();
    if (cacheBody && timestamp - cacheAt < ADSBLOL_MIL_CACHE_MS) {
      return { status: 200, body: cacheBody, cache: 'HIT' };
    }

    try {
      const upstream = await fetchImpl(ADSBLOL_MIL_UPSTREAM_URL, {
        headers: {
          Accept: 'application/json',
          'User-Agent': ADSBLOL_MIL_USER_AGENT,
        },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await upstream.text();
      if (upstream.ok) {
        cacheBody = body;
        cacheAt = timestamp;
        return { status: 200, body, cache: 'MISS' };
      }
      if (cacheBody) {
        return { status: 200, body: cacheBody, cache: 'STALE' };
      }
      return { status: upstream.status || 502, body, cache: 'MISS' };
    } catch (error) {
      log('[adsb.lol Proxy]', error?.message || String(error));
      if (cacheBody) {
        return { status: 200, body: cacheBody, cache: 'STALE' };
      }
      return {
        status: 502,
        body: JSON.stringify({ error: 'ADS-B proxy error' }),
        cache: 'MISS',
      };
    }
  }

  async function handleConnect(_req, res) {
    const result = await resolveMilitarySnapshot();
    res.writeHead(result.status, cacheHeaders(result.cache));
    res.end(result.body);
  }

  async function handleRequest(_request) {
    const result = await resolveMilitarySnapshot();
    return new Response(result.body, {
      status: result.status,
      headers: cacheHeaders(result.cache),
    });
  }

  return {
    resolveMilitarySnapshot,
    handleConnect,
    handleRequest,
  };
}

/** Connect / Node (req, res) handler used by Vite and Vercel. */
export function createAdsbLolMilHandler(options) {
  return createAdsbLolMilProxy(options).handleConnect;
}

/**
 * Dual Node/Web handler for `api/adsblol/mil.js`.
 * Does not wrap AIS, OpenSky, or adsb.lol traces.
 */
export function createAdsbLolMilApiHandler(options) {
  const proxy = createAdsbLolMilProxy(options);
  return async function adsblolMil(req, res) {
    if (res && typeof res.writeHead === 'function' && typeof res.end === 'function') {
      await proxy.handleConnect(req, res);
      return;
    }
    const request = req instanceof Request
      ? req
      : new Request(`http://localhost${ADSBLOL_MIL_PATH}`);
    return proxy.handleRequest(request);
  };
}

/** Vite plugin: forwards GET /api/adsblol/mil to the shared handler. */
export function adsbLolMilPlugin(options) {
  const handle = createAdsbLolMilHandler(options);
  const install = (server) => {
    server.middlewares.use(ADSBLOL_MIL_PATH, handle);
  };
  return {
    name: 'adsblol-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
