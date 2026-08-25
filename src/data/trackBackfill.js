/**
 * Aircraft track-history backfill (PRD WS-F F1/F2).
 *
 * Shared by the Vite plugin and hosted Vercel Node functions:
 *   GET /api/opensky-track — hard 410. OpenSky is never contacted.
 *   GET /api/adsblol/trace?hex= — adsb.lol tar1090 readsb trace (~24h, ODbL).
 *
 * Hex must match /^[0-9a-f~]{6,7}$/. Missing or invalid hex is 400 from this
 * handler, never a platform 404. OpenSky URLs are never built.
 */

export const ADSB_LOL_TRACE_HEX_RE = /^[0-9a-f~]{6,7}$/;
export const ADSB_LOL_TRACE_HEX_ERROR = 'hex must be a 6-7 char hex string';
export const ADSB_LOL_TRACE_FETCH_ERROR = 'adsb.lol trace fetch failed';
export const OPENSKY_TRACK_DISABLED_ERROR =
  'OpenSky track backfill is disabled in this commercial build';

export const TRACK_CACHE_MS = 60_000;
export const TRACK_CACHE_MAX = 200;
export const TRACK_RESPONSE_CAP_BYTES = 5 * 1024 * 1024;
export const TRACK_FETCH_TIMEOUT_MS = 12_000;

export const config = {
  api: {
    bodyParser: false,
  },
};

export function normalizeTraceHex(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isValidTraceHex(hex) {
  return ADSB_LOL_TRACE_HEX_RE.test(hex);
}

/**
 * adsb.lol tar1090 path. Returns null unless hex is already valid so an
 * OpenSky (or any other) URL can never be constructed from this module.
 */
export function adsblolTraceUrl(hex) {
  if (!isValidTraceHex(hex)) return null;
  return `https://adsb.lol/data/traces/${hex.slice(-2)}/trace_full_${hex}.json`;
}

export function parseTraceHexFromRequest(req) {
  const fromQuery = req?.query?.hex;
  if (fromQuery !== undefined && fromQuery !== null) {
    const raw = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
    const hex = normalizeTraceHex(raw);
    return isValidTraceHex(hex) ? hex : null;
  }

  const rawUrl = String(req?.url || '');
  try {
    const incoming = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
      ? new URL(rawUrl)
      : new URL(rawUrl, 'http://localhost');
    const hex = normalizeTraceHex(incoming.searchParams.get('hex'));
    return isValidTraceHex(hex) ? hex : null;
  } catch {
    return null;
  }
}

export function createTrackCache({
  ttlMs = TRACK_CACHE_MS,
  max = TRACK_CACHE_MAX,
  now = Date.now,
} = {}) {
  /** @type {Map<string, {at:number,status:number,body:string}>} */
  const cache = new Map();

  return {
    get(key) {
      const entry = cache.get(key);
      if (!entry) return null;
      if (now() - entry.at >= ttlMs) return null;
      return entry;
    },
    put(key, entry) {
      cache.set(key, entry);
      if (cache.size > max) {
        const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) cache.delete(oldest[0]);
      }
    },
  };
}

async function readCappedResponseText(upstream, maxBytes) {
  const declared = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await upstream.body?.cancel(); } catch { /* no-op */ }
    return { tooLarge: true, text: '' };
  }
  if (!upstream.body || typeof upstream.body[Symbol.asyncIterator] !== 'function') {
    const text = await upstream.text();
    return text.length > maxBytes ? { tooLarge: true, text: '' } : { tooLarge: false, text };
  }
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  for await (const chunk of upstream.body) {
    total += chunk.length;
    if (total > maxBytes) {
      try { await upstream.body.cancel(); } catch { /* no-op */ }
      return { tooLarge: true, text: '' };
    }
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return { tooLarge: false, text };
}

function writeJson(res, status, body, { charset = false } = {}) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader(
    'Content-Type',
    charset ? 'application/json; charset=utf-8' : 'application/json',
  );
  if (status === 410 || charset) {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

export async function handleOpenskyTrack(_req, res) {
  writeJson(res, 410, { error: OPENSKY_TRACK_DISABLED_ERROR });
}

export async function handleAdsblolTrace(req, res, {
  fetchImpl = globalThis.fetch,
  cache = createTrackCache(),
  now = Date.now,
  timeoutMs = TRACK_FETCH_TIMEOUT_MS,
  capBytes = TRACK_RESPONSE_CAP_BYTES,
} = {}) {
  const hex = parseTraceHexFromRequest(req);
  if (!hex) {
    writeJson(res, 400, { error: ADSB_LOL_TRACE_HEX_ERROR });
    return;
  }

  const upstreamUrl = adsblolTraceUrl(hex);
  if (!upstreamUrl) {
    writeJson(res, 400, { error: ADSB_LOL_TRACE_HEX_ERROR });
    return;
  }

  try {
    const cacheKey = `lol:${hex}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      writeJson(res, cached.status, cached.body, { charset: true });
      return;
    }

    const upstream = await fetchImpl(upstreamUrl, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const { tooLarge, text } = await readCappedResponseText(upstream, capBytes);
    let body;
    if (tooLarge) {
      body = JSON.stringify({ error: 'Upstream track response too large' });
    } else if (!upstream.ok) {
      body = JSON.stringify({ error: `Track source HTTP ${upstream.status}` });
    } else {
      body = text;
    }
    cache.put(cacheKey, { at: now(), status: upstream.status, body });
    writeJson(res, upstream.status, body, { charset: true });
  } catch {
    writeJson(res, 502, { error: ADSB_LOL_TRACE_FETCH_ERROR });
  }
}

export function createAdsblolTraceHandler(options = {}) {
  const cache = options.cache || createTrackCache({ now: options.now });
  return async function handler(req, res) {
    await handleAdsblolTrace(req, res, { ...options, cache });
  };
}

/** Vite plugin: same-origin routes forward here. */
export function trackBackfillProxies(options = {}) {
  const handleTrace = createAdsblolTraceHandler(options);
  function install(middlewares) {
    middlewares.use('/api/opensky-track', handleOpenskyTrack);
    middlewares.use('/api/adsblol/trace', handleTrace);
  }
  return {
    name: 'track-backfill-proxies',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

/** Default Node entry used by api/adsblol/trace.js */
export default createAdsblolTraceHandler();
