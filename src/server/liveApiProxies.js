/**
 * Live same-origin /api proxy plugins for Meridian.
 *
 * Shared by Vite (dev + preview) and the Vercel Node catch-all so hosted
 * production is not a static-SPA 404. Handlers are the existing Node
 * middlewares — no Next rewrite, no new vendors.
 *
 * OpenSky is disabled. Cockpit headlines use GDELT only (no Google News RSS).
 * TeleGeography is not a data source.
 *
 * @module src/server/liveApiProxies
 */

import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import https from 'node:https';
import { lookup as lookupDns } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  CCTV_FRAME_FETCH_TIMEOUT_MS,
  cctvProxy,
  fetchCctvImageFromUpstream,
} from '../data/cctvProxy.js';
import {
  isValidTileCoord as isValidTomTomTile,
  utcDayKey as tomtomUtcDayKey,
  normalizeBudget as normalizeTomTomBudget,
  isOverBudget as isTomTomOverBudget,
} from '../data/tomtomTiles.js';
import { firmsProxy } from '../data/firms.js';
import { normalizeRadioCountryInput } from '../data/radioCountry.js';
import {
  handleRegionalBrief,
  regionalBriefHasAnySource,
  requiredFiniteQueryNumber,
  validRegionalPoint,
} from '../data/regionalBriefHandler.js';
import { adsbLolMilPlugin } from '../data/adsblolMil.js';
import { createAisStreamAdapter, isRecognizedAisEnvelope } from '../data/aisStreamAdapter.js';
import {
  COMMERCIAL_FLIGHT_SOURCE,
  OPENSKY_ENABLED,
  adsbLolFallbackAnchor,
  handleOpenskyFlightsHttp,
} from './openskyFlights.js';
import { rejectIfVoiceForbidden } from '../billing/http.js';
import { parseSilenceTimeoutEnv } from '../data/aisWatchdog.js';
import {
  fetchTerrainChunkWithRetry,
  parseTerrainPoints,
  resolveTerrainHeightRequest,
  terrainPointKey,
  validTerrainResult,
} from '../data/terrainHeightsProxy.js';
import { gbfsProxy } from '../data/gbfs.js';
import { handleOsrmRouteHttp } from '../data/osrmRoute.js';
import { weatherEffectsProxy } from '../data/weatherEffects.js';
import { celestrakProxy } from '../data/celestrak.js';
import {
  LL2_CACHE_TTL_MS,
  launchLibraryRequestHeaders,
  rocketLaunchesProxy,
} from '../data/launches.js';
import { VOICE_MODELS, isKnownVoiceTier, resolveVoiceModel } from '../voice/voiceCost.js';
import { trackBackfillProxies } from '../data/trackBackfill.js';

export { LL2_CACHE_TTL_MS, launchLibraryRequestHeaders };

export { CCTV_FRAME_FETCH_TIMEOUT_MS, fetchCctvImageFromUpstream, cctvProxy };

/** Repo root — this module lives in src/server. */
const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ---------------------------------------------------------------------------
// Civilian flights: adsb.lol only (OpenSky is disabled in this commercial fork)
// ---------------------------------------------------------------------------
export { COMMERCIAL_FLIGHT_SOURCE, OPENSKY_ENABLED, adsbLolFallbackAnchor };
export { regionalBriefHasAnySource, requiredFiniteQueryNumber, validRegionalPoint };
/** Hard off — cockpit headlines use GDELT only. */
export const GOOGLE_NEWS_RSS_ENABLED = false;
// ---------------------------------------------------------------------------
// Overpass API proxy constants and cache state
// ---------------------------------------------------------------------------
/** Ordered list of Overpass API mirrors; tried sequentially on failure/rate-limit. */
const OVERPASS_UPSTREAMS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  // Community full-planet instance (privateforge nonprofit) — added 2026-07-30
  // when all three mirrors above refused this IP (likely a dev-traffic rate
  // ban; refused connections fail in ms, so healthy mirrors above still win).
  // Verified: planet coverage (Texas query), CORS *, ~5-20 s cold latency.
  'https://overpass.private.coffee/api/interpreter',
];
/**
 * TTL for FRESH cached Overpass responses (ms). Road geometry is static for
 * months — the original 45 s TTL forced a public-mirror round-trip on nearly
 * every viewport revisit and left nothing to serve when the mirrors 502
 * (field-test 2026-07-17: all three mirrors down during US morning peak =
 * "traffic takes forever to load"). 24 h in memory; the disk layer below
 * keeps 7 days and also survives dev-server restarts.
 */
const OVERPASS_CACHE_MS = 86_400_000;
/** Disk-cache TTL for Overpass responses (ms) — 7 days. */
const OVERPASS_DISK_TTL_MS = 7 * 86_400_000;
/**
 * Disk-cache TTL for BOUNDARY-class queries (is_in / admin-relation pivots) — 30
 * days. Admin boundaries change ≈never, and their pivots are the most expensive
 * queries the app issues (multi-MB coastline geometry, 10–25 s on public mirrors —
 * field test 2026-07-23: outline latency + the Sicily miss). Keeping them a month
 * means each boundary is fetched roughly once per machine, ever.
 */
const OVERPASS_BOUNDARY_DISK_TTL_MS = 30 * 86_400_000;
/** Disk-cache directory for Overpass responses. */
const OVERPASS_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'overpass');
/** Per-upstream fetch timeout (ms). */
const OVERPASS_TIMEOUT_MS = 22000;
/** Max entries in the Overpass response cache (LRU-like, oldest evicted first). */
const OVERPASS_CACHE_MAX_ENTRIES = 120;
/** @type {Map<string,{status:number,body:string,contentType:string,endpoint:string,cachedAt:number}>} */
const _overpassCache = new Map();
/** @type {Map<string,Promise>} In-flight Overpass requests keyed by normalized query body. */
const _overpassInFlight = new Map();

/**
 * Whether a normalized Overpass query is BOUNDARY-class (admin `is_in` lookups
 * and area→relation pivots) — the static, expensive geometry that earns the
 * 30-day disk TTL. The enclosing-compound sweep and road fetches keep the
 * default TTL. Exported for tests.
 */
export function isOverpassBoundaryQuery(cacheKey) {
  return /is_in\s*\(|\bpivot\b/i.test(String(cacheKey || ''));
}

/** Disk TTL for a query: boundary geometry keeps for a month, the rest 7 days. */
function overpassDiskTtlMs(cacheKey) {
  return isOverpassBoundaryQuery(cacheKey) ? OVERPASS_BOUNDARY_DISK_TTL_MS : OVERPASS_DISK_TTL_MS;
}

/** Iterative Douglas-Peucker on [{lat,lon},...] (planar-degree approx — fine at
 *  the ~44 m tolerance used here). Endpoints always kept. */
function douglasPeucker(points, toleranceDeg) {
  const n = points.length;
  if (n <= 2) return points;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = points[a].lon;
    const ay = points[a].lat;
    const vx = points[b].lon - ax;
    const vy = points[b].lat - ay;
    const c2 = vx * vx + vy * vy;
    let worst = -1;
    let worstDist = toleranceDeg;
    for (let i = a + 1; i < b; i++) {
      const wx = points[i].lon - ax;
      const wy = points[i].lat - ay;
      let d;
      if (c2 === 0) {
        d = Math.hypot(wx, wy);
      } else {
        const t = Math.max(0, Math.min(1, (vx * wx + vy * wy) / c2));
        d = Math.hypot(wx - t * vx, wy - t * vy);
      }
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Simplify one element's geometry array in place if it is big enough. */
function simplifyElementGeometry(el, minPoints, toleranceDeg) {
  if (Array.isArray(el?.geometry) && el.geometry.length >= minPoints) {
    el.geometry = douglasPeucker(el.geometry, toleranceDeg);
  }
  if (Array.isArray(el?.members)) {
    for (const member of el.members) {
      if (Array.isArray(member?.geometry) && member.geometry.length >= minPoints) {
        member.geometry = douglasPeucker(member.geometry, toleranceDeg);
      }
    }
  }
}

/**
 * Server-side geometry simplification for large Overpass `out geom` payloads.
 * Region/state boundary pivots return multi-MB coastline rings whose fidelity
 * nothing downstream needs (the client re-simplifies for draw); decimating them
 * HERE shrinks the disk cache, the wire, and client parse time — and is what
 * makes the raised read cap safe. Anything unparseable or below the thresholds
 * passes through byte-identical. Exported for tests (opts override thresholds).
 *
 * @param {string} bodyText - Raw upstream JSON body.
 * @returns {string} Possibly-simplified JSON body.
 */
export function simplifyOverpassPayloadBody(bodyText, opts = {}) {
  const minBytes = opts.minBytes ?? OVERPASS_SIMPLIFY_MIN_BYTES;
  const minPoints = opts.minPoints ?? OVERPASS_SIMPLIFY_MIN_POINTS;
  const toleranceDeg = opts.toleranceDeg ?? OVERPASS_SIMPLIFY_TOLERANCE_DEG;
  if (typeof bodyText !== 'string' || bodyText.length < minBytes) return bodyText;
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
  if (!Array.isArray(data?.elements)) return bodyText;
  for (const el of data.elements) simplifyElementGeometry(el, minPoints, toleranceDeg);
  try {
    return JSON.stringify(data);
  } catch {
    return bodyText;
  }
}

/** Normalized Overpass query -> stable disk-cache file path. */
function overpassDiskPath(cacheKey) {
  return path.join(OVERPASS_DISK_DIR, `${createHash('sha1').update(cacheKey).digest('hex')}.json`);
}

/**
 * Read a disk-cached Overpass payload. maxAgeMs Infinity = any age (the
 * serve-stale path when every mirror is down).
 * @returns {Promise<?Object>} Payload with cachedAt, or null.
 */
async function readOverpassDisk(cacheKey, maxAgeMs) {
  try {
    const raw = await fsp.readFile(overpassDiskPath(cacheKey), 'utf8');
    const payload = JSON.parse(raw);
    if (!payload || typeof payload.body !== 'string' || !Number.isFinite(payload.cachedAt)) return null;
    if (Date.now() - payload.cachedAt > maxAgeMs) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Fire-and-forget disk write for a successful Overpass payload. */
function writeOverpassDisk(cacheKey, payload) {
  fsp.mkdir(OVERPASS_DISK_DIR, { recursive: true })
    .then(() => fsp.writeFile(overpassDiskPath(cacheKey), JSON.stringify(payload)))
    .catch((err) => console.warn('[Overpass Proxy] disk cache write failed:', err?.message || err));
}

/**
 * Resolve every cache/coalescing layer before admitting a request to the local
 * upstream rate limiter. The injected limiter callback is invoked exactly once
 * for a complete cache miss and never for memory, in-flight, or disk hits.
 * Exported so the admission ordering can be tested without a Vite server.
 *
 * @param {object} options
 * @param {string} options.cacheKey
 * @param {Map<string, object>} options.memoryCache
 * @param {Map<string, Promise<object>>} options.inFlight
 * @param {()=>Promise<object|null>} options.readDisk
 * @param {()=>boolean} options.allowUpstream
 * @param {number} [options.now]
 * @param {number} [options.cacheMs]
 * @returns {Promise<{source:'HIT'|'INFLIGHT'|'DISK'|'UPSTREAM'|'RATE_LIMITED', payload:object|null}>}
 */
export async function resolveOverpassPreflight({
  cacheKey,
  memoryCache,
  inFlight,
  readDisk,
  allowUpstream,
  now = Date.now(),
  cacheMs = OVERPASS_CACHE_MS,
}) {
  const cached = memoryCache.get(cacheKey);
  if (cached && now - cached.cachedAt <= cacheMs) return { source: 'HIT', payload: cached };

  const pending = inFlight.get(cacheKey);
  if (pending) return { source: 'INFLIGHT', payload: await pending };

  const disk = await readDisk();
  if (disk) return { source: 'DISK', payload: disk };

  return allowUpstream()
    ? { source: 'UPSTREAM', payload: null }
    : { source: 'RATE_LIMITED', payload: null };
}
// --- Abuse guards shared by the Overpass proxy ------------------------------
/** Max accepted POST body for the Overpass proxy (Overpass QL queries are tiny). */
const OVERPASS_MAX_BODY_BYTES = 24 * 1024; // 24 KB
/**
 * Hard cap on a single Overpass upstream response we will buffer into memory.
 * 32 MB (was 12 MB): a dense island/state admin boundary at full `out geom`
 * fidelity — Sicilia's Mediterranean coastline — can exceed 12 MB, and clipping
 * it read as a permanent "transient" failure (field test 2026-07-23, Sicily
 * never traced). The buffered payload is SIMPLIFIED server-side before it is
 * cached or sent (simplifyOverpassPayloadBody), so the raised cap does not
 * raise what clients receive or what the disk stores.
 */
const OVERPASS_MAX_RESPONSE_BYTES = 32 * 1024 * 1024; // 32 MB
/** Only payloads at least this large go through geometry simplification. */
const OVERPASS_SIMPLIFY_MIN_BYTES = 1_500_000;
/** Only per-element geometry arrays with at least this many points are simplified. */
const OVERPASS_SIMPLIFY_MIN_POINTS = 1200;
/**
 * Douglas-Peucker tolerance (degrees, ≈44 m of latitude). Region/state boundary
 * rings are drawn at regional camera scale and the client simplifies again for
 * draw, so ~44 m fidelity is invisible; building footprints never reach the
 * point threshold above and pass through untouched.
 */
const OVERPASS_SIMPLIFY_TOLERANCE_DEG = 0.0004;
/** Max concurrent in-flight upstream Overpass fetches across all distinct queries. */
const OVERPASS_MAX_CONCURRENT = 6;
let _overpassConcurrent = 0;
/**
 * Minimal fixed-window per-key rate limiter for the dev proxies. Not a hard
 * security boundary (dev-only), just a backstop so a runaway client can't hammer
 * the public Overpass mirrors or exhaust this process.
 */
const RATE_LIMITER_MAX_KEYS = 2000;
function makeRateLimiter({ windowMs, max, globalMax }) {
  const hits = new Map(); // key -> number[] (timestamps within window)
  let globalTimes = []; // all hits in window, for the global backstop
  return function allow(key) {
    const now = Date.now();
    globalTimes = globalTimes.filter((t) => now - t < windowMs);
    if (globalMax && globalTimes.length >= globalMax) return false; // global backstop
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return false; }
    recent.push(now);
    hits.set(key, recent);
    globalTimes.push(now);
    // Hard key cap so a key-rotating caller can't grow the map without bound.
    if (hits.size > RATE_LIMITER_MAX_KEYS) {
      const oldest = hits.keys().next().value;
      if (oldest !== undefined) hits.delete(oldest);
    }
    if (hits.size > 256) {
      for (const [k, v] of hits) {
        if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
      }
    }
    return true;
  };
}
const _overpassRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 90, globalMax: 300 });
const _militaryInstallationsRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 90, globalMax: 300 });

/**
 * Opt-in per-IP rate limiter for the cost-bearing API proxies (OpenAI / Google).
 * DEFAULT IS UNLIMITED: when the env var is unset, `0`, or non-numeric, this
 * returns `null` and the caller skips the check entirely — a runtime no-op that
 * preserves the original behavior. Only a positive integer N enables a fixed
 * 60s window of N requests/IP (built lazily once, then reused so its per-IP
 * window state persists across requests). The global backstop is set to a
 * generous multiple of the per-IP cap so a single host can't starve the rest.
 *
 * @param {string|undefined} envValue - Raw env value (requests/min/IP).
 * @returns {((key:string)=>boolean)|null} An `allow(key)` fn, or null when unlimited.
 */
function makeOptInRateLimiter(envValue) {
  const max = Number(envValue);
  if (!Number.isFinite(max) || max <= 0) return null; // unset/0/garbage -> unlimited
  return makeRateLimiter({ windowMs: 60_000, max: Math.floor(max), globalMax: Math.floor(max) * 20 });
}
// Built LAZILY on first request, NOT at module load: `.env` values are applied to process.env later
// (the plugin config hook calls loadEnv → process.env, AFTER this module is imported), so reading
// process.env here at import time would always see them unset and silently stay unlimited even when
// configured via .env. Building on first request (like the OPENAI_API_KEY reads) sees the loaded env;
// the result is cached so the limiter's per-IP window state persists. `null` = unlimited (default).
let _openAiRateLimiter; // undefined = not built yet; null = unlimited; fn = active limiter
let _googleRateLimiter;
/** OpenAI cost endpoints (realtime/token + hud-summary). Null = unlimited (default). */
function openAiRateLimiter() {
  if (_openAiRateLimiter === undefined) _openAiRateLimiter = makeOptInRateLimiter(process.env.GEV_RATELIMIT_OPENAI_PER_MIN);
  return _openAiRateLimiter;
}
/** Google cost endpoint (nearby-places). Null = unlimited (default). */
function googleRateLimiter() {
  if (_googleRateLimiter === undefined) _googleRateLimiter = makeOptInRateLimiter(process.env.GEV_RATELIMIT_GOOGLE_PER_MIN);
  return _googleRateLimiter;
}

/**
 * Apply an opt-in limiter to a request, writing a 429 when over the cap.
 * When `limiter` is null (unlimited, the default) this is a no-op returning
 * `true`, so the handler proceeds exactly as before.
 *
 * @param {((key:string)=>boolean)|null} limiter
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {boolean} True if the request may proceed; false if a 429 was sent.
 */
function enforceOptInRateLimit(limiter, req, res) {
  if (!limiter) return true; // unlimited (default) — no behavior change
  if (limiter(clientKey(req))) return true;
  res.statusCode = 429;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Retry-After', '5');
  res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
  return false;
}

/**
 * Client key for rate limiting. Uses the real socket peer address only — we do
 * NOT trust X-Forwarded-For (client-controlled; a rotating value would mint fresh
 * quota and grow the limiter map). This is a localhost dev proxy, so the socket
 * address is the real client.
 */
function clientKey(req) {
  return String(req.socket?.remoteAddress || 'local');
}

/** Server-side timeout ceiling (seconds) we allow inside an Overpass QL query. */
const OVERPASS_MAX_QL_TIMEOUT = 30;
/** Max `around:` radius (m) — every app caller uses <= 1800 m. */
const OVERPASS_MAX_AROUND_M = 50000;
/** Max bbox span (degrees) — app bboxes are small viewport tiles. */
const OVERPASS_MAX_BBOX_DEG = 12;
/**
 * Every Overpass element-type specifier, including the combined shortcuts
 * (nwr/nw/nr/wr) and `rel`. Shared by the selector + area-element-deny regexes so
 * they can't drift (a missing shortcut like `wr` was an area-scan bypass).
 */
const OVERPASS_ELEMENT_TYPES = 'node|way|relation|nwr|nw|nr|wr|rel';
/** Element-selector (incl. `area`) whose statements must be individually bounded. */
const OVERPASS_SELECTOR_RE = new RegExp(`\\b(?:${OVERPASS_ELEMENT_TYPES}|area)\\b`);
/** An element selector bounded BY an area — the country-scan abuse shape. */
const OVERPASS_AREA_ELEMENT_RE = new RegExp(`\\b(?:${OVERPASS_ELEMENT_TYPES})\\s*\\(\\s*area\\b`, 'i');
/** A single bbox 4-tuple `(s,w,n,e)` (non-global so it does not advance lastIndex). */
const OVERPASS_BBOX_RE = /\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/;

/**
 * Validate + clamp an Overpass form body. Defends the generic proxy against
 * planet-scale abuse: requires exactly one `data` query in which EVERY element
 * selector is individually spatially bounded (around / bbox / is_in / poly /
 * area-set / pivot), rejects oversized radii and world-sized bboxes, and clamps
 * every `[timeout:]` directive. Comments + quoted literals are stripped first so
 * a fake bound inside a tag value can't satisfy the check.
 *
 * Every real app caller passes (annotations/locations/cctv use `around:`/`is_in`/
 * `area.`/`pivot`; traffic uses a small `(s,w,n,e)` bbox); a mixed query that
 * pairs one bounded selector with a global one is rejected.
 *
 * @returns {{ok:true, body:string} | {ok:false, error:string}}
 */
/**
 * Single-pass lexer: blank out quoted literals (→ empty quotes) and strip line
 * and block comments — recognizing each in one walk so a comment marker INSIDE a
 * quoted string is treated as string content, not a comment (and vice versa).
 * Chained regex replaces get the ordering wrong (a quoted slash-slash would hide
 * the rest of the line), which is exactly the bypass this avoids.
 */
function stripOverpassNoise(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i += 1;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; } // escaped char
        if (src[i] === quote) { i += 1; break; } // closing quote
        i += 1;
      }
      out += quote + quote; // collapse the literal to empty quotes
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < n && src[i] !== '\n') i += 1;
      out += ' ';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function sanitizeOverpassBody(rawBody) {
  let params;
  try { params = new URLSearchParams(rawBody); } catch { return { ok: false, error: 'Malformed query body' }; }
  const all = params.getAll('data');
  if (all.length !== 1) return { ok: false, error: 'Exactly one data query is required' };
  const data = all[0];
  if (!data || !data.trim()) return { ok: false, error: 'Missing Overpass data query' };

  // Blank quoted literals + strip comments in one lexer pass so a fake bound or a
  // `//` inside a string can't hide an unbounded selector (or satisfy a bound).
  const stripped = stripOverpassNoise(data);

  // Reject oversized radii in EVERY around form — point `around:r,lat,lon` AND the
  // input-set form `around.set:r` — and parse the full numeric token so scientific
  // notation (`5e7`) can't slip a planet-scale radius past the cap.
  for (const m of stripped.matchAll(/around(?:\.\w+)?:\s*([\d.eE+-]+)/gi)) {
    const radius = Number(m[1]);
    if (!Number.isFinite(radius) || radius > OVERPASS_MAX_AROUND_M) {
      return { ok: false, error: 'Overpass around radius too large' };
    }
  }
  // Reject world-sized / oversized bboxes.
  for (const m of stripped.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g)) {
    const s = Number(m[1]); const w = Number(m[2]); const n = Number(m[3]); const e = Number(m[4]);
    if (Math.abs(n - s) > OVERPASS_MAX_BBOX_DEG || Math.abs(e - w) > OVERPASS_MAX_BBOX_DEG) {
      return { ok: false, error: 'Overpass bbox too large' };
    }
  }

  // Reject control-flow constructs the app never uses — their set/bound semantics
  // are hard to validate statically. The app only uses plain selectors + is_in /
  // area / pivot / recursion, so this denylist closes loop/transform escape hatches.
  if (/\b(?:foreach|complete|retro|compare|convert|make)\b/i.test(stripped)) {
    return { ok: false, error: 'Unsupported Overpass construct' };
  }
  // `poly:` has unchecked extent and the app never uses it — reject outright
  // (position-independent, so tag filters can't hide it).
  if (/\bpoly\s*:/i.test(stripped)) {
    return { ok: false, error: 'Overpass poly filter not allowed' };
  }

  // Every selector statement must be individually bounded, WITH set provenance: a
  // set counts as a bound only if it was assigned (->.set) by an already-bounded
  // statement. So `way[...]->.a` (global assigned to a set) is rejected, while the
  // app's `is_in(...)->.a; area.a[...]` and `area(id)->.x; rel(pivot.x)` validate.
  const boundedSets = new Set();
  for (let stmt of stripped.split(';')) {
    stmt = stmt.trim();
    if (!stmt || stmt.startsWith('[') || /^out\b/.test(stmt)) continue;

    // Strip output-set assignments (NOT input bounds), then strip bracket tag
    // filters so a tag KEY/value (e.g. `way[is_in]`, `node[around]`) can never be
    // misread as a spatial bound. Bounds live in (...) / function calls / set
    // refs, never inside [...], so the probe loses nothing real.
    const outSets = [];
    const body = stmt.replace(/->\s*\.(\w+)/g, (_, name) => { outSets.push(name); return ' '; });
    const probe = body.replace(/\[[^\]]*\]/g, ' ');

    // Reject element-in-area scans on the TAG-STRIPPED probe, so a tag filter
    // between the selector and the area filter (way["highway"](area.a)) can't hide
    // it. An area has unbounded extent (could be a whole country); the app only
    // SELECTS admin areas (area.set) and pivots (rel(pivot.x)), never node/way/
    // relation(area...). The probe collapses tags so `way (area.a)` is caught.
    if (OVERPASS_AREA_ELEMENT_RE.test(probe)) {
      return { ok: false, error: 'Overpass area-bounded element selector not allowed' };
    }

    const hasSelector = OVERPASS_SELECTOR_RE.test(probe);
    const inputSets = [...probe.matchAll(/(?<!\d)\.([a-z_]\w*)/gi)].map((m) => m[1]);
    const directBound = /around:\s*\d/.test(probe)
      || OVERPASS_BBOX_RE.test(probe)
      || /is_in\s*\(/.test(probe)                 // is_in(lat,lon) — the function form only
      || /\barea\s*\(/.test(probe);               // area(id) — bounded as a set definition

    const setBound = inputSets.some((s) => boundedSets.has(s));
    const bounded = directBound || setBound;

    if (hasSelector && !bounded) {
      return { ok: false, error: 'Overpass query has an unbounded selector' };
    }
    // Only a bounded statement can mark its output sets as bounded.
    if (bounded) for (const name of outSets) boundedSets.add(name);
  }

  const clamped = data.replace(
    /\[timeout:\s*(\d+)\s*\]/gi,
    (_, n) => `[timeout:${Math.min(Number(n) || OVERPASS_MAX_QL_TIMEOUT, OVERPASS_MAX_QL_TIMEOUT)}]`,
  );
  return { ok: true, body: `data=${encodeURIComponent(clamped)}` };
}

/** Read a request body with a hard byte cap; throws { code:'BODY_TOO_LARGE' } past the cap. */
async function readRequestBodyCapped(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const err = new Error('Request body too large');
      err.code = 'BODY_TOO_LARGE';
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Read a fetch() Response body as text with a hard byte cap. Rejects early on an
 * oversized Content-Length, then streams with a running cap so a chunked or
 * length-omitted response cannot blow past the limit. Throws { code:'RESPONSE_TOO_LARGE' }.
 */
export async function readResponseTextCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    const err = new Error('Upstream response too large');
    err.code = 'RESPONSE_TOO_LARGE';
    throw err;
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      const err = new Error('Upstream response too large');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }
    return text;
  }
  const decoder = new TextDecoder();
  let out = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* no-op */ }
      const err = new Error('Upstream response too large');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

/** Parse a fetch() JSON response only after enforcing a hard byte cap. */
export async function readResponseJsonCapped(response, maxBytes) {
  return JSON.parse(await readResponseTextCapped(response, maxBytes));
}

/**
 * Return the existing promise for a cache key, or create one and remove it
 * only when that exact promise settles.
 */
export function coalesceProxyRequest(inFlight, key, create) {
  const existing = inFlight.get(key);
  if (existing) return { promise: existing, shared: true };
  let promise;
  promise = Promise.resolve()
    .then(create)
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return { promise, shared: false };
}

// ---------------------------------------------------------------------------
// Radio Browser directory proxy
// ---------------------------------------------------------------------------
const RADIO_DIRECTORY_CACHE_MS = 45 * 60 * 1000;
const RADIO_DIRECTORY_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const RADIO_MIRROR_CACHE_MS = 6 * 60 * 60 * 1000;
const RADIO_FETCH_TIMEOUT_MS = 12_000;
const RADIO_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const RADIO_DIRECTORY_LIMIT = 750;
const RADIO_CATALOG_MIN_SUCCESSFUL_QUERIES = 5;
const RADIO_CATALOG_HEALTHY_MIN_STATIONS = Math.ceil(RADIO_DIRECTORY_LIMIT / 2);
const RADIO_USER_AGENT = 'Meridian/1.0 (Radio Browser directory client)';
const RADIO_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RADIO_FALLBACK_MIRRORS = Object.freeze([
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
]);

function cleanRadioText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength).trim();
}

function isNonGlobalIpv4(hostname) {
  const pieces = hostname.split('.');
  if (pieces.length !== 4 || pieces.some((piece) => !/^\d{1,3}$/.test(piece))) return false;
  const values = pieces.map(Number);
  if (values.some((value) => value > 255)) return true;
  const [a, b, c] = values;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

/** Return a normalized public HTTPS URL, or null for local/private targets. */
export function publicRadioHttpsUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || !hostname) return null;
    if (
      hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname.endsWith('.local')
      || isNonGlobalIpv4(hostname)
      || hostname.includes(':')
    ) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** Normalize one Radio Browser station and omit favicons and unsafe streams. */
export function normalizeRadioBrowserStation(raw) {
  const id = cleanRadioText(raw?.stationuuid, 40).toLowerCase();
  const lat = raw?.geo_lat === null || raw?.geo_lat === '' ? null : Number(raw?.geo_lat);
  const lon = raw?.geo_long === null || raw?.geo_long === '' ? null : Number(raw?.geo_long);
  const codec = cleanRadioText(raw?.codec, 16).toUpperCase();
  const streamUrl = publicRadioHttpsUrl(raw?.url_resolved || raw?.url);
  if (
    !RADIO_UUID_RE.test(id)
    || Number(raw?.lastcheckok) !== 1
    || Number(raw?.hls) === 1
    || !Number.isFinite(lat) || lat < -90 || lat > 90
    || !Number.isFinite(lon) || lon < -180 || lon > 180
    || !/^(?:MP3|AAC(?:\+|-LC|-HE)?|HE-AAC)$/i.test(codec)
    || !streamUrl
  ) return null;

  const name = cleanRadioText(raw?.name, 140);
  if (!name) return null;
  const tags = String(raw?.tags ?? '')
    .split(',')
    .map((tag) => cleanRadioText(tag, 80).toLocaleLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((tag, index, all) => all.indexOf(tag) === index)
    .slice(0, 24);
  const languages = String(raw?.language ?? '')
    .split(',')
    .map((language) => cleanRadioText(language, 40))
    .filter(Boolean)
    .slice(0, 8);
  const rawCountryCode = cleanRadioText(raw?.countrycode, 2).toUpperCase();
  const normalizedCode = normalizeRadioCountryInput(rawCountryCode);
  const normalizedCountry = normalizedCode.valid && !normalizedCode.empty
    ? normalizedCode
    : normalizeRadioCountryInput(cleanRadioText(raw?.country, 80));
  const bitrate = Number(raw?.bitrate);
  return {
    id,
    name,
    lat,
    lon,
    streamUrl,
    homepage: publicRadioHttpsUrl(raw?.homepage),
    tags,
    languages,
    state: cleanRadioText(raw?.state, 80),
    country: normalizedCountry.valid && !normalizedCountry.empty
      ? normalizedCountry.name
      : cleanRadioText(raw?.country, 80),
    countryCode: normalizedCountry.valid ? normalizedCountry.code : '',
    metadataTrust: 'untrusted-community',
    codec,
    bitrate: Number.isInteger(bitrate) && bitrate >= 8 && bitrate <= 1024 ? bitrate : null,
    clickCount: Math.max(0, Math.min(10_000_000, Number(raw?.clickcount) || 0)),
  };
}

export function publicRadioStation(station) {
  return {
    id: station.id,
    name: station.name,
    lat: station.lat,
    lon: station.lon,
    streamUrl: station.streamUrl,
    homepage: station.homepage,
    tags: station.tags,
    languages: station.languages,
    state: station.state,
    country: station.country,
    countryCode: station.countryCode,
    metadataTrust: station.metadataTrust,
    codec: station.codec,
    bitrate: station.bitrate,
  };
}

function radioMirrorOrigin(value) {
  const hostname = String(value ?? '').toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9-]+\.api\.radio-browser\.info$/.test(hostname)) return null;
  return `https://${hostname}`;
}

/** Return whether a resolved Radio Browser address is safe for an outbound request. */
export function isPublicRadioAddress(value) {
  const address = String(value ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!address) return false;
  if (!address.includes(':')) {
    const ipv4 = address.split('.');
    return ipv4.length === 4
      && ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
      && !isNonGlobalIpv4(address);
  }
  const pieces = address.split('::');
  if (pieces.length > 2) return false;
  const left = pieces[0] ? pieces[0].split(':') : [];
  const right = pieces[1] ? pieces[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((pieces.length === 1 && missing !== 0) || (pieces.length === 2 && missing < 1)) return false;
  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return false;
  const numeric = groups.reduce((total, group) => (total << 16n) | BigInt(`0x${group}`), 0n);
  const inCidr = (base, prefix) => {
    const shift = 128n - BigInt(prefix);
    return (numeric >> shift) === (base >> shift);
  };
  const base = (text) => text.split(':').reduce(
    (total, group) => (total << 16n) | BigInt(`0x${group || '0'}`),
    0n,
  );
  const cidr = (text, prefix) => inCidr(base(text), prefix);
  return cidr('2000:0:0:0:0:0:0:0', 3)
    && !cidr('2001:0:0:0:0:0:0:0', 23)
    && !cidr('2001:db8:0:0:0:0:0:0', 32)
    && !cidr('2002:0:0:0:0:0:0:0', 16)
    && !cidr('3fff:0:0:0:0:0:0:0', 20);
}

function radioProxyDestination(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  const origin = radioMirrorOrigin(url.hostname);
  if (
    !origin
    || url.origin !== origin
    || url.username
    || url.password
    || url.port
    || url.hash
  ) return null;
  const discovery = url.hostname.toLowerCase() === 'all.api.radio-browser.info'
    && url.pathname === '/json/servers'
    && !url.search;
  const directory = url.pathname === '/json/stations/search';
  const click = /^\/json\/url\/[0-9a-f-]+$/i.test(url.pathname) && !url.search;
  return discovery || directory || click ? url : null;
}

async function resolveRadioProxyAddresses(hostname, lookupImpl) {
  const resolved = await lookupImpl(hostname, { all: true, verbatim: true });
  const rows = Array.isArray(resolved) ? resolved : [resolved];
  const addresses = rows
    .map((row) => ({ address: String(row?.address || ''), family: Number(row?.family) || undefined }))
    .filter((row) => row.address);
  if (!addresses.length || addresses.some((row) => !isPublicRadioAddress(row.address))) {
    throw new Error('Radio Browser resolved to a forbidden address');
  }
  return addresses;
}

function fetchPinnedRadioResponse(url, options, addresses) {
  return new Promise((resolve, reject) => {
    const address = addresses[0];
    const request = https.request(url, {
      method: 'GET',
      headers: options.headers,
      signal: options.signal,
      lookup(_hostname, lookupOptions, callback) {
        if (lookupOptions?.all) callback(null, addresses);
        else callback(null, address.address, address.family);
      },
    }, (response) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, String(value));
      }
      resolve(new Response(Readable.toWeb(response), {
        status: response.statusCode || 500,
        statusText: response.statusMessage || '',
        headers,
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function mapRadioConcurrent(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Create the testable Connect middleware backing `/api/radio`. */
export function createRadioProxyMiddleware({ fetchImpl = null, lookupImpl = lookupDns, now = Date.now } = {}) {
  let mirrorCache = { origins: [...RADIO_FALLBACK_MIRRORS], cachedAt: 0 };
  let mirrorPromise = null;
  let catalogCache = null;
  let catalogGeneration = 0;
  // The generation counter is process-local, so it restarts from 1 with the
  // server. The instance token scopes each generation sequence: a client that
  // sees a new instance must treat the catalog as a fresh sequence, never as a
  // repeat ("still generation 1") or a regression ("generation went backward").
  const catalogInstance = randomUUID();
  let servedStationIds = new Set();
  let refreshPromise = null;

  async function fetchJson(url, maxBytes = RADIO_RESPONSE_MAX_BYTES) {
    const destination = radioProxyDestination(url);
    if (!destination) throw new Error('Radio Browser destination is not permitted');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RADIO_FETCH_TIMEOUT_MS);
    try {
      const addresses = await resolveRadioProxyAddresses(destination.hostname, lookupImpl);
      const options = {
        headers: { Accept: 'application/json', 'User-Agent': RADIO_USER_AGENT },
        signal: controller.signal,
        redirect: 'manual',
      };
      const response = fetchImpl
        ? await fetchImpl(destination.href, options)
        : await fetchPinnedRadioResponse(destination, options, addresses);
      if (response.status >= 300 && response.status < 400) {
        try { await response.body?.cancel?.(); } catch { /* no-op */ }
        throw new Error('Radio Browser redirects are refused');
      }
      if (!response.ok) throw new Error(`Radio Browser returned ${response.status}`);
      const text = await readResponseTextCapped(response, maxBytes);
      return JSON.parse(text);
    } finally {
      clearTimeout(timer);
    }
  }

  async function mirrors() {
    if (now() - mirrorCache.cachedAt < RADIO_MIRROR_CACHE_MS) return mirrorCache.origins;
    if (!mirrorPromise) {
      mirrorPromise = (async () => {
        try {
          const rows = await fetchJson('https://all.api.radio-browser.info/json/servers', 256 * 1024);
          const discovered = [...new Set((Array.isArray(rows) ? rows : []).map((row) => radioMirrorOrigin(row?.name)).filter(Boolean))];
          if (discovered.length) {
            mirrorCache = { origins: [...discovered, ...RADIO_FALLBACK_MIRRORS.filter((origin) => !discovered.includes(origin))], cachedAt: now() };
          }
        } catch {
          mirrorCache = { ...mirrorCache, cachedAt: now() };
        }
        return mirrorCache.origins;
      })().finally(() => { mirrorPromise = null; });
    }
    return mirrorPromise;
  }

  async function fetchPath(pathname) {
    let lastError = null;
    for (const origin of await mirrors()) {
      try {
        return await fetchJson(`${origin}${pathname}`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('No Radio Browser mirror is available');
  }

  async function refreshCatalog() {
    const queries = [null, 'news', 'talk', 'weather', 'emergency', 'scanner', 'aviation', 'marine', 'traffic'];
    const outcomes = await mapRadioConcurrent(queries, 3, async (tag, index) => {
      const params = new URLSearchParams({
        has_geo_info: 'true',
        is_https: 'true',
        hidebroken: 'true',
        order: 'clickcount',
        reverse: 'true',
        limit: index === 0 ? '1800' : '220',
      });
      if (tag) params.set('tag', tag);
      try {
        const rows = await fetchPath(`/json/stations/search?${params}`);
        if (!Array.isArray(rows)) throw new Error('Radio Browser catalog payload was not an array');
        if (!rows.every((row) => (
          row
          && typeof row === 'object'
          && !Array.isArray(row)
          && typeof row.stationuuid === 'string'
          && typeof row.name === 'string'
          && (typeof row.url_resolved === 'string' || typeof row.url === 'string')
        ))) throw new Error('Radio Browser catalog contained a malformed station row');
        const stations = rows.map(normalizeRadioBrowserStation).filter(Boolean);
        const requestedTag = cleanRadioText(tag, 80)
          .toLocaleLowerCase()
          .replace(/[_-]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const requestedTagCovered = !requestedTag || stations.some((station) => (
          station.tags.some((stationTag) => stationTag === requestedTag || stationTag.includes(requestedTag))
        ));
        return {
          // Query coverage is based on accepted rows, not merely a payload that
          // happens to match the upstream schema. Specialist responses must
          // also contain an accepted station tagged for the requested category.
          succeeded: stations.length > 0 && requestedTagCovered,
          stations,
        };
      } catch {
        return { succeeded: false, stations: [] };
      }
    });
    const resultSets = outcomes.map((outcome) => outcome.stations);

    const selected = [];
    const seen = new Set();
    const take = (station) => {
      if (!station || seen.has(station.id) || selected.length >= RADIO_DIRECTORY_LIMIT) return;
      seen.add(station.id);
      selected.push(station);
    };
    // Seed specialist station-tag queries before popularity fill so operational
    // categories remain represented even when global click charts skew musical.
    for (const rows of resultSets.slice(1)) rows.slice(0, 45).forEach(take);
    resultSets.flat().sort((a, b) => b.clickCount - a.clickCount || a.name.localeCompare(b.name)).forEach(take);
    const timestamp = now();
    const successfulQueries = outcomes.filter((outcome) => outcome.succeeded).length;
    const broadQueryHealthy = outcomes[0].succeeded && outcomes[0].stations.length > 0;
    const healthReasons = [];
    if (!broadQueryHealthy) healthReasons.push('broad-query-unhealthy');
    if (successfulQueries < RADIO_CATALOG_MIN_SUCCESSFUL_QUERIES) healthReasons.push('query-coverage-below-policy');
    if (selected.length < RADIO_CATALOG_HEALTHY_MIN_STATIONS) healthReasons.push('station-coverage-below-policy');
    const degraded = healthReasons.length > 0;
    const coverage = {
      successfulQueries,
      totalQueries: queries.length,
      stationCount: selected.length,
      healthyStationMinimum: RADIO_CATALOG_HEALTHY_MIN_STATIONS,
    };
    const nextCatalog = {
      cachedAt: timestamp,
      updatedAt: new Date(timestamp).toISOString(),
      stations: selected.map(publicRadioStation),
      stationIds: new Set(selected.map((station) => station.id)),
      degraded,
      degradedReason: degraded ? healthReasons.join(',') : null,
      coverage,
    };
    if (degraded && catalogCache) {
      const error = new Error('Radio Browser catalog refresh did not meet health policy');
      error.radioCatalogDegraded = true;
      error.radioDegradedReason = nextCatalog.degradedReason;
      error.radioCoverage = coverage;
      throw error;
    }
    if (degraded && !selected.length) {
      const error = new Error('Radio Browser catalog refresh returned no usable stations');
      error.radioCatalogDegraded = true;
      error.radioDegradedReason = nextCatalog.degradedReason;
      error.radioCoverage = coverage;
      throw error;
    }
    if (degraded) {
      servedStationIds = nextCatalog.stationIds;
      return { ...nextCatalog, acceptedGeneration: null };
    }
    catalogCache = {
      ...nextCatalog,
      acceptedGeneration: ++catalogGeneration,
    };
    servedStationIds = catalogCache.stationIds;
    return catalogCache;
  }

  async function getCatalog() {
    if (catalogCache && now() - catalogCache.cachedAt < RADIO_DIRECTORY_CACHE_MS) {
      return { ...catalogCache, stale: false };
    }
    if (!refreshPromise) {
      refreshPromise = refreshCatalog().finally(() => { refreshPromise = null; });
    }
    try {
      return { ...await refreshPromise, stale: false };
    } catch (error) {
      if (catalogCache && now() - catalogCache.cachedAt <= RADIO_DIRECTORY_STALE_MS) {
        return {
          ...catalogCache,
          stale: true,
          degraded: true,
          degradedReason: error?.radioDegradedReason || 'refresh-failed',
          coverage: error?.radioCoverage || catalogCache.coverage,
        };
      }
      throw error;
    }
  }

  function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  return async function radioProxyMiddleware(req, res) {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    if (requestUrl.pathname === '/stations') {
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      try {
        const catalog = await getCatalog();
        sendJson(res, 200, {
          stations: catalog.stations,
          updatedAt: catalog.updatedAt,
          stale: catalog.stale,
          degraded: Boolean(catalog.degraded),
          degradedReason: catalog.degradedReason || null,
          coverage: catalog.coverage || null,
          acceptedGeneration: catalog.acceptedGeneration ?? null,
          catalogInstance,
        });
      } catch (error) {
        sendJson(res, 503, {
          error: 'Radio directory is temporarily unavailable',
          degraded: Boolean(error?.radioCatalogDegraded),
          degradedReason: error?.radioDegradedReason || null,
        });
      }
      return;
    }

    const clickMatch = requestUrl.pathname.match(/^\/click\/([0-9a-f-]+)$/i);
    if (clickMatch) {
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      const id = clickMatch[1].toLowerCase();
      if (!RADIO_UUID_RE.test(id) || !servedStationIds.has(id)) {
        sendJson(res, 404, { error: 'Unknown radio station' });
        return;
      }
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      void fetchPath(`/json/url/${id}`).catch(() => {});
      return;
    }

    sendJson(res, 404, { error: 'Unknown radio route' });
  };
}

function radioBrowserProxy() {
  const middleware = createRadioProxyMiddleware();
  const install = (server) => {
    server.middlewares.use('/api/radio', middleware);
  };
  return {
    name: 'radio-browser-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
// ---------------------------------------------------------------------------
// AISStream live vessel cache state
// ---------------------------------------------------------------------------
const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const AISSTREAM_DEFAULT_BBOXES = [[[-90, -180], [90, 180]]];
const AISSTREAM_DEFAULT_MESSAGE_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'ShipStaticData',
  'StaticDataReport',
];
const AISSTREAM_CACHE_MAX = 50000;
const AISSTREAM_STALE_MS = 30 * 60 * 1000;
// Per-MMSI recent-path ring buffers (PRD WS-F F3). Float32 lat/lon (~1m
// precision, fine for 25m thinning) + Uint32 epoch seconds ≈ 12B/sample;
// 64 samples × 50k MMSIs worst case ≈ 38MB. Tracks exist only while the dev
// server runs — this is "recent path", not voyage history.
const AIS_TRACK_SAMPLES = 64;
const AIS_TRACK_MIN_GAP_SEC = 30;
const AIS_TRACK_MIN_MOVE_M = 25;
// Watchdog budgets (policy lives in src/data/aisWatchdog.js). Silence is
// REPORTED quickly and ACTED ON slowly: a dead feed must read as dead within
// ~2 min, but recycling the socket is throttled so recovery can never become a
// reconnect cycle against AISStream's one-connection-per-key limit.
const AISSTREAM_SILENCE_REPORT_MS = 120_000;
/** Recycle threshold as a multiple of the report threshold. */
const AISSTREAM_RECYCLE_RATIO = 2.5;
const AISSTREAM_BACKOFF_MS = Object.freeze([5_000, 15_000, 60_000, 300_000]);
/** Slow retry cadence once the ladder is spent and the feed reads DOWN. */
const AISSTREAM_DOWN_RETRY_MS = 900_000;
/**
 * Probe cadence while AISStream is rejecting the key. Retrying cannot fix a
 * bad credential, so this exists only to recover from an upstream-side
 * mistake — it must never approach the ladder's pace.
 */
const AISSTREAM_AUTH_PROBE_MS = 3_600_000;
/** How often the watchdog re-evaluates without request traffic. */
const AISSTREAM_TICK_MS = 15_000;
// Sourced from the shared voice-model registry so the client's cost estimate
// can never be computed against a different model than the session runs on.
const OPENAI_REALTIME_MODEL_DEFAULT = VOICE_MODELS.standard.id;
const OPENAI_REALTIME_MODEL_MINI_DEFAULT = VOICE_MODELS.mini.id;
const OPENAI_REALTIME_VOICE_DEFAULT = 'marin';
const OPENAI_REALTIME_REASONING_DEFAULT = 'low';
const OPENAI_REALTIME_CONTEXT_TOKENS_DEFAULT = 3000;
const OPENAI_REALTIME_CONTEXT_RETENTION_DEFAULT = 0.5;
const OPENAI_HUD_SUMMARY_MODEL_DEFAULT = 'gpt-5-nano';
const REALTIME_DEBUG_LOG_DIR = path.join(__dirname, '.gev-logs');
const REALTIME_DEBUG_LOG_FILE = path.join(REALTIME_DEBUG_LOG_DIR, 'realtime-conversations.jsonl');
const REALTIME_DEBUG_LOG_MAX_BYTES = 8 * 1024 * 1024;

/**
 * @type {ReturnType<typeof createAisStreamAdapter>|null}
 * Module-lifetime: it owns the socket-generation namespace, which must never
 * restart across a dev-server reload (see aisStreamAdapter.js ownership rules).
 */
let _aisAdapter = null;
/** @type {{silenceWatch:boolean,reportMs:number,recycleMs:number,url:string}|null} */
let _aisWatchdogPolicy = null;
/** @type {number|null} */
let _aisStreamTickTimer = null;
/** Set by dispose so the next ensure() re-derives budgets from a reloaded .env. */
let _aisNeedsRearm = false;
/** @type {Function|null|undefined} `ws` constructor; null = unavailable, undefined = not yet probed. */
let _aisWebSocketImpl;
/** @type {Map<string,object>} */
const _aisStreamVessels = new Map();
/** @type {Map<string,object>} */
const _aisStreamStatic = new Map();
/** @type {Map<string,{lats:Float32Array,lons:Float32Array,times:Uint32Array,head:number,len:number}>} mmsi -> track ring buffer */
const _aisStreamTracks = new Map();
/** @type {Map<string,{lat:number,lon:number,epochSec:number}>} mmsi -> first fix awaiting second (lazy buffer allocation) */
const _aisStreamTrackPending = new Map();

/** Launch Library 2 recent-launch proxy lives in src/data/launches.js. */

/**
 * TomTom traffic-flow vector-tile proxy with a daily budget governor.
 *
 * Upstream: https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf
 * (style `relative`; the response is an UNCOMPRESSED Mapbox Vector Tile, layer
 * "Traffic flow"). The key comes from TOMTOM_API_KEY server-side only — the
 * browser fetches same-origin `/api/tomtom/flow/{z}/{x}/{y}.pbf`.
 *
 * Cache: memory + disk (.gev-cache/tomtom/), TTL 120 s (traffic is fresh
 * data), single-flight per tile, serve-stale-on-failure — the celestrakProxy
 * pattern. Cache hits never count against the budget.
 *
 * Budget governor (mirrors the OpenSky credit-governor philosophy — last-good
 * data beats a dead layer): a persistent counter (.gev-cache/tomtom/budget.json,
 * keyed by UTC date, reset on day change) counts upstream fetch attempts
 * against a soft cap (TOMTOM_DAILY_TILE_BUDGET, default 40,000 of the free
 * tier's ~50k/day). Over the cap the proxy serves stale tiles when available,
 * else 429 {error:'budget'}.
 *
 * GET /api/tomtom/status → {hasKey, dailyCount, budget, date}. Keyless mode:
 * status reports hasKey:false and the tile endpoint 503s {error:'no_key'}
 * without touching upstream — the traffic layer then stays in simulation mode.
 *
 * @returns {import('vite').Plugin}
 */
function tomtomProxy() {
  const TILE_TTL_MS = 120_000;
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'tomtom');
  const BUDGET_PATH = path.join(CACHE_DIR, 'budget.json');
  const DEFAULT_DAILY_BUDGET = 40000;
  const MEM_MAX_ENTRIES = 256;
  const UPSTREAM_TIMEOUT_MS = 15000;

  /** @type {Map<string, {at:number, buf:Buffer}>} tile key `z/x/y` -> cached tile (kept past TTL for serve-stale). */
  const mem = new Map();
  /** @type {Map<string, Promise<{at:number, buf:Buffer}|null>>} single-flight per tile. */
  const inflight = new Map();

  /** @type {{date:string, count:number}|null} lazily-loaded persistent counter. */
  let budget = null;
  let budgetLoaded = false;

  function dailyBudgetLimit() {
    const raw = Number.parseInt(process.env.TOMTOM_DAILY_TILE_BUDGET || '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_BUDGET;
  }

  async function loadBudgetOnce() {
    if (budgetLoaded) return;
    budgetLoaded = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(BUDGET_PATH, 'utf8'));
      if (parsed && typeof parsed.date === 'string' && Number.isFinite(parsed.count)) {
        budget = parsed;
      }
    } catch { /* no budget file yet */ }
  }

  async function persistBudget() {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(BUDGET_PATH, JSON.stringify(budget), 'utf8');
    } catch (err) {
      console.warn('[tomtom-proxy] budget write failed:', err?.message || err);
    }
  }

  /** Roll the counter to today (UTC) and return it. */
  function currentBudget() {
    budget = normalizeTomTomBudget(budget, tomtomUtcDayKey());
    return budget;
  }

  /** Count one upstream fetch attempt against today's budget (async persist). */
  function recordUpstreamFetch() {
    currentBudget().count += 1;
    void persistBudget();
  }

  const tilePath = (key) => path.join(CACHE_DIR, `flow-${key.replaceAll('/', '-')}.pbf`);

  /** Disk-cache read; tile age comes from the file's mtime. */
  async function readDiskTile(key) {
    try {
      const [stat, buf] = await Promise.all([
        fsp.stat(tilePath(key)),
        fsp.readFile(tilePath(key)),
      ]);
      return { at: stat.mtimeMs, buf };
    } catch { return null; }
  }

  async function writeDiskTile(key, buf) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(tilePath(key), buf);
    } catch (err) {
      console.warn(`[tomtom-proxy] tile cache write failed for ${key}:`, err?.message || err);
    }
  }

  /** LRU-ish memory insert (Map preserves insertion order; evict the oldest). */
  function memSet(key, entry) {
    if (!mem.has(key) && mem.size >= MEM_MAX_ENTRIES) {
      const oldest = mem.keys().next().value;
      mem.delete(oldest);
    }
    mem.set(key, entry);
  }

  async function fetchUpstream(z, x, y) {
    const url = 'https://api.tomtom.com/traffic/map/4/tile/flow/relative/'
      + `${z}/${x}/${y}.pbf?key=${encodeURIComponent(process.env.TOMTOM_API_KEY)}`;
    recordUpstreamFetch(); // attempts count — upstream bills the request either way
    const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error('empty tile body');
    return buf;
  }

  return {
    name: 'tomtom-proxy',
    configureServer(server) {
      server.middlewares.use('/api/tomtom', async (req, res) => {
        // Sanitized responses only (proxy/security baseline): no upstream
        // error details, and never echo the key or the upstream URL.
        const sendJson = (status, obj, extraHeaders = {}) => {
          if (res.headersSent) return;
          res.writeHead(status, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...extraHeaders,
          });
          res.end(JSON.stringify(obj));
        };
        const sendTile = (buf, cacheStatus) => {
          if (res.headersSent) return;
          res.writeHead(200, {
            'Content-Type': 'application/x-protobuf',
            'Cache-Control': 'no-store',
            'x-tomtom-cache': cacheStatus,
          });
          res.end(buf);
        };

        try {
          await loadBudgetOnce();
          const urlPath = String(req.url || '').split('?')[0];

          if (urlPath === '/status') {
            const hasKey = Boolean(process.env.TOMTOM_API_KEY);
            const b = currentBudget();
            sendJson(200, { hasKey, dailyCount: b.count, budget: dailyBudgetLimit(), date: b.date });
            return;
          }

          const m = urlPath.match(/^\/flow\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
          if (!m) {
            sendJson(404, { error: 'not_found' });
            return;
          }
          const z = Number(m[1]);
          const x = Number(m[2]);
          const y = Number(m[3]);
          if (!isValidTomTomTile(z, x, y)) {
            sendJson(400, { error: 'invalid_tile' });
            return;
          }
          if (!process.env.TOMTOM_API_KEY) {
            sendJson(503, { error: 'no_key' });
            return;
          }

          const key = `${z}/${x}/${y}`;
          const now = Date.now();

          let entry = mem.get(key);
          if (!entry) {
            entry = await readDiskTile(key);
            if (entry) memSet(key, entry);
          }
          // Fresh cache hit — never counts against the budget.
          if (entry && now - entry.at < TILE_TTL_MS) {
            sendTile(entry.buf, 'HIT');
            return;
          }

          // Budget governor: over the soft cap, last-good data beats a dead layer.
          if (isTomTomOverBudget(currentBudget(), dailyBudgetLimit())) {
            if (entry) {
              sendTile(entry.buf, 'STALE-BUDGET');
            } else {
              sendJson(429, { error: 'budget' });
            }
            return;
          }

          // Stale or missing → refresh, single-flight per tile.
          if (!inflight.has(key)) {
            inflight.set(key, fetchUpstream(z, x, y)
              .then(async (buf) => {
                const fresh = { at: Date.now(), buf };
                memSet(key, fresh);
                await writeDiskTile(key, buf);
                return fresh;
              })
              .catch((err) => {
                console.warn(`[tomtom-proxy] ${key} fetch failed (${err?.message || err}) — serving stale if any`);
                return null;
              })
              .finally(() => inflight.delete(key)));
          }
          const fresh = await inflight.get(key);
          if (fresh) {
            sendTile(fresh.buf, 'MISS');
          } else if (entry) {
            sendTile(entry.buf, 'STALE-ERROR'); // upstream down — stale beats empty
          } else {
            sendJson(502, { error: 'upstream' });
          }
        } catch (err) {
          console.warn('[tomtom-proxy] error:', err?.message || err);
          sendJson(500, { error: 'proxy' });
        }
      });
    },
  };
}

/** NASA FIRMS handlers live in src/data/firms.js (Vite + Vercel /api/firms). */

/**
 * Re:Earth terrain point-height proxy: batched lon/lat → ellipsoidal height
 * lookups, keyless. Upstream: https://terrain.reearth.land/heights.json
 * (≤256 points per call). Terrain doesn't move, so results are cached to
 * disk with a long TTL (30 days) — mirrors celestrakProxy's memory+disk
 * cache and serve-stale shape. Cache entries and stale fallback are keyed per
 * 5dp point, so reordered and partially overlapping batches reuse prior work.
 * Only missing/stale points go upstream; the response is rebuilt in exact
 * request order. Oversized requests (>256 points) are chunked sequentially.
 */
function terrainHeightsProxy() {
  const TTL_MS = 30 * 24 * 3600_000;
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
  const CACHE_PATH = path.join(CACHE_DIR, 'terrain-heights.json');
  const UPSTREAM_CHUNK = 256;
  const MAX_POINTS = 2000;

  /** @type {Map<string, {at:number, result:object}>} keyed by canonical 5dp lon/lat. */
  const mem = new Map();
  /** @type {Map<string, Promise<Array<object>>>} single-flight per missing-point subset. */
  const inflight = new Map();
  let diskLoaded = false;
  let diskDirty = false;

  /** Load the on-disk cache into memory once, lazily (first request only). */
  async function loadDiskOnce() {
    if (diskLoaded) return;
    diskLoaded = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      const pointEntries = parsed?.version === 2 && parsed.points && typeof parsed.points === 'object'
        ? parsed.points
        : null;
      if (pointEntries) {
        for (const [key, entry] of Object.entries(pointEntries)) {
          if (entry && Number.isFinite(entry.at) && validTerrainResult(entry.result)) {
            mem.set(key, entry);
          }
        }
      } else if (parsed && typeof parsed === 'object') {
        // One-time migration from the former raw-batch cache. Zip only real,
        // positionally present results; an absent value never becomes height 0.
        for (const [rawPoints, entry] of Object.entries(parsed)) {
          const points = parseTerrainPoints(rawPoints);
          if (!points || !entry || !Number.isFinite(entry.at) || !Array.isArray(entry.results)) continue;
          for (let i = 0; i < points.length; i += 1) {
            const result = entry.results[i];
            if (!validTerrainResult(result)) continue;
            const key = terrainPointKey(points[i]);
            const existing = mem.get(key);
            if (!existing || entry.at > existing.at) mem.set(key, { at: entry.at, result });
          }
        }
        diskDirty = mem.size > 0;
      }
    } catch { /* no disk cache yet */ }
    // Periodic flush, same shape as adsbdbProxy: coalesce writes instead of
    // hitting disk on every request.
    setInterval(async () => {
      if (!diskDirty) return;
      diskDirty = false;
      try {
        await fsp.mkdir(CACHE_DIR, { recursive: true });
        const obj = { version: 2, points: Object.fromEntries(mem.entries()) };
        await fsp.writeFile(CACHE_PATH, JSON.stringify(obj), 'utf8');
      } catch (err) {
        diskDirty = true; // retry next tick
        console.warn('[terrain-heights-proxy] cache write failed:', err?.message || err);
      }
    }, 15_000).unref?.();
  }

  /**
   * Fetch all missing chunks sequentially (upstream caps each call at 256).
   *
   * The first try keeps its empirically required 30s timeout; network errors,
   * 429, and 5xx receive up to three jittered retries sharing a 10s added-time
   * budget, with Retry-After honored within that bound.
   * @param {Array<[number, number]>} points
   * @returns {Promise<Array<object>>}
   */
  async function fetchUpstreamAll(points) {
    const results = [];
    for (let i = 0; i < points.length; i += UPSTREAM_CHUNK) {
      const chunk = points.slice(i, i + UPSTREAM_CHUNK);
      const chunkResults = await fetchTerrainChunkWithRetry(chunk);
      // Keep later chunks aligned even if a malformed upstream response omits
      // trailing positions. The resolver will reject each null individually.
      for (let j = 0; j < chunk.length; j += 1) results.push(chunkResults[j] ?? null);
    }
    return results;
  }

  /** Coalesce concurrent requests for the same canonical missing-point list. */
  function fetchMissingSingleFlight(points) {
    const key = points.map(terrainPointKey).join(';');
    if (!inflight.has(key)) {
      const request = fetchUpstreamAll(points)
        .finally(() => {
          if (inflight.get(key) === request) inflight.delete(key);
        });
      inflight.set(key, request);
    }
    return inflight.get(key);
  }

  return {
    name: 'terrain-heights-proxy',
    configureServer(server) {
      server.middlewares.use('/api/terrain/heights', async (req, res) => {
        const send = (status, bodyObj) => {
          if (res.headersSent) return;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(bodyObj));
        };
        try {
          await loadDiskOnce();
          const parsedUrl = new URL(req.url || '', 'http://internal');
          const rawPoints = parsedUrl.searchParams.get('points');
          const points = parseTerrainPoints(rawPoints);
          if (!points) {
            send(400, { error: 'invalid points parameter — expected "lon,lat;lon,lat;…" with finite numbers' });
            return;
          }
          if (points.length > MAX_POINTS) {
            send(500, { error: `too many points (${points.length}); max ${MAX_POINTS} per request` });
            return;
          }

          const outcome = await resolveTerrainHeightRequest({
            points,
            cache: mem,
            fetchMissing: fetchMissingSingleFlight,
            ttlMs: TTL_MS,
          });
          if (outcome.cacheChanged) diskDirty = true;
          if (outcome.upstreamError) {
            console.warn(
              `[terrain-heights-proxy] refresh incomplete (${outcome.upstreamError?.message || outcome.upstreamError})`
              + ' — serving stale points when available'
            );
          }
          send(outcome.status, outcome.body);
        } catch (err) {
          send(500, { error: `terrain heights proxy error: ${err?.message || err}` });
        }
      });
    },
  };
}

/**
 * adsbdb.com enrichment proxy: callsign → route (airline + origin/destination
 * airports) and hex → aircraft type/registration. Free community API — cached
 * aggressively: ONE upstream request per new key ever (404s negative-cached),
 * persisted to disk so restarts don't re-hammer it. Adapted from skylight
 * (MIT) server/src/enrich/routes.ts.
 */
function adsbdbProxy() {
  const TTL_MS = 24 * 3600_000;
  const CACHE_PATH = path.join(process.cwd(), '.gev-cache', 'adsbdb.json');
  let cache = { routes: {}, aircraft: {} };
  let dirty = false;
  let loaded = false;
  const inflight = new Map();

  async function loadOnce() {
    if (loaded) return;
    loaded = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      cache = { routes: parsed.routes ?? {}, aircraft: parsed.aircraft ?? {} };
    } catch { /* first run */ }
    setInterval(async () => {
      if (!dirty) return;
      dirty = false;
      try {
        await fsp.mkdir(path.dirname(CACHE_PATH), { recursive: true });
        await fsp.writeFile(CACHE_PATH, JSON.stringify(cache), 'utf8');
      } catch { dirty = true; } // retry next tick
    }, 15_000).unref?.();
  }

  const fresh = (e) => e && Date.now() - e.at < TTL_MS;

  function parseRoute(json) {
    const fr = json?.response?.flightroute;
    if (!fr?.origin || !fr?.destination) return null;
    const airport = (a) => ({
      code: a.iata_code || a.icao_code || '',
      name: a.municipality || a.name || '',
      lat: Number.isFinite(a.latitude) ? a.latitude : null,
      lon: Number.isFinite(a.longitude) ? a.longitude : null,
    });
    return { airline: fr.airline?.name || null, origin: airport(fr.origin), destination: airport(fr.destination) };
  }

  function parseAircraft(json) {
    const a = json?.response?.aircraft;
    if (!a) return null;
    return {
      typeCode: a.icao_type || null, // ICAO designator, e.g. "B738" — feeds classifyAircraft
      typeName: a.manufacturer && a.type ? `${a.manufacturer} ${a.type}` : (a.type || null),
      registration: a.registration || null,
    };
  }

  function lookup(kind, key) {
    const store = kind === 'route' ? cache.routes : cache.aircraft;
    if (fresh(store[key])) return Promise.resolve(store[key].data);
    const ik = `${kind}:${key}`;
    if (!inflight.has(ik)) {
      inflight.set(ik, (async () => {
        try {
          const url = kind === 'route'
            ? `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(key)}`
            : `https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(key)}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (res.ok) {
            const data = kind === 'route' ? parseRoute(await res.json()) : parseAircraft(await res.json());
            store[key] = { at: Date.now(), data }; // data may be null — negative cache
            dirty = true;
            return data;
          }
          if (res.status === 404) {
            store[key] = { at: Date.now(), data: null }; // known-missing — cache the miss
            dirty = true;
          }
          // other statuses: leave uncached so we retry later
          return fresh(store[key]) ? store[key].data : null;
        } catch {
          return fresh(store[key]) ? store[key].data : null; // network error → stale if any
        } finally {
          inflight.delete(ik);
        }
      })());
    }
    return inflight.get(ik);
  }

  return {
    name: 'adsbdb-proxy',
    configureServer(server) {
      server.middlewares.use('/api/adsbdb', async (req, res) => {
        await loadOnce();
        const send = (status, obj) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(obj));
        };
        try {
          const [, kind, rawKey] = String(req.url || '').split('?')[0].split('/');
          if (kind === 'route') {
            const cs = String(rawKey || '').toUpperCase();
            if (!/^[A-Z0-9]{2,8}$/.test(cs)) return send(400, { error: 'invalid callsign' });
            const data = await lookup('route', cs);
            return send(200, data ? { found: true, ...data } : { found: false });
          }
          if (kind === 'type') {
            const hex = String(rawKey || '').toLowerCase();
            if (!/^[0-9a-f]{6}$/.test(hex)) return send(400, { error: 'invalid hex' });
            const data = await lookup('aircraft', hex);
            return send(200, data ? { found: true, ...data } : { found: false });
          }
          return send(404, { error: 'unknown endpoint' });
        } catch (err) {
          return send(500, { error: String(err?.message || err) });
        }
      });
    },
  };
}

/**
 * Detect whether an Overpass API response body indicates rate-limiting.
 *
 * Checks for known rate-limit phrases in the body text regardless of
 * HTTP status code, since some mirrors return 200 with an error payload.
 *
 * @param {string} bodyText - Upstream response body.
 * @returns {boolean} True if the body looks rate-limited.
 */
function overpassLooksRateLimited(bodyText) {
  const text = String(bodyText || '').toLowerCase();
  return text.includes('rate_limited')
    || text.includes('quota of your ip address')
    || text.includes('dispatcher_client::request_read_and_idx::rate_limited')
    || text.includes('too many requests');
}

/**
 * Detect an Overpass HTTP-200 body that is actually a runtime FAILURE (server-side
 * timeout / out-of-memory) via its `remark`. These are transient upstream failures,
 * not authoritative empty results, so they must not be returned or cached.
 */
function overpassLooksRuntimeError(bodyText) {
  const text = String(bodyText || '').toLowerCase();
  return text.includes('runtime error')
    || text.includes('timed out')
    || text.includes('out of memory');
}

/** Evict oldest Overpass cache entries until size is within the cap. */
function trimOverpassCache() {
  while (_overpassCache.size > OVERPASS_CACHE_MAX_ENTRIES) {
    const oldestKey = _overpassCache.keys().next().value;
    if (!oldestKey) break;
    _overpassCache.delete(oldestKey);
  }
}

/**
 * Write a completed Overpass payload to the HTTP response.
 *
 * @param {import('http').ServerResponse} res - Node HTTP response.
 * @param {{status:number,body:string,contentType:string,endpoint:string}} payload
 * @param {string} [cacheStatus='MISS'] - 'HIT', 'MISS', or 'INFLIGHT'.
 */
function sendOverpassResponse(res, payload, cacheStatus = 'MISS') {
  res.writeHead(payload.status, {
    'Content-Type': payload.contentType || 'application/json',
    'Cache-Control': 'public, max-age=15',
    'X-Overpass-Cache': cacheStatus,
    'X-Overpass-Upstream': payload.endpoint || 'unknown',
  });
  res.end(payload.body || '');
}

/**
 * Try each Overpass upstream in order until one succeeds.
 *
 * Skips rate-limited or 5xx responses and falls through to the next
 * mirror. If all mirrors fail, returns the last rate-limited payload
 * (if any) or throws the last error.
 *
 * @param {string} body - URL-encoded Overpass QL query body.
 * @param {number} [maxResponseBytes] Endpoint-specific response cap.
 * @returns {Promise<{status:number,body:string,contentType:string,endpoint:string,rateLimited:boolean}>}
 */
async function fetchOverpassPayload(body, maxResponseBytes = OVERPASS_MAX_RESPONSE_BYTES) {
  let lastError = null;
  let lastRateLimitPayload = null;

  for (const endpoint of OVERPASS_UPSTREAMS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'gods-eye-view-overpass-proxy/1.0',
        },
        body,
        signal: controller.signal,
      });

      const responseBody = await readResponseTextCapped(upstream, maxResponseBytes);
      const contentType = upstream.headers.get('content-type') || 'application/json';
      const status = upstream.status;
      const rateLimited = status === 429 || overpassLooksRateLimited(responseBody);
      const runtimeError = overpassLooksRuntimeError(responseBody);
      const payload = {
        status,
        body: responseBody,
        contentType,
        endpoint,
        rateLimited,
        runtimeError,
      };

      if (rateLimited) {
        lastRateLimitPayload = payload;
        continue;
      }
      // A 200 body carrying a runtime error / timeout is a transient upstream
      // failure — skip to the next mirror rather than returning or caching it.
      if (runtimeError) {
        lastError = new Error(`Overpass runtime error (${endpoint})`);
        continue;
      }
      if (status >= 500) {
        lastError = new Error(`Overpass upstream returned ${status} (${endpoint})`);
        continue;
      }

      // Success: decimate giant boundary geometry before it reaches the cache,
      // the disk, or the client (what makes the 32 MB read cap safe to hold).
      payload.body = simplifyOverpassPayloadBody(payload.body);
      return payload;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (lastRateLimitPayload) return lastRateLimitPayload;
  throw lastError || new Error('All Overpass upstreams failed');
}

/**
 * Vite plugin: Overpass API proxy with response caching and request coalescing.
 *
 * Accepts POST requests at /api/overpass, normalizes the query body for
 * cache keying, and fans out to multiple Overpass mirrors with per-upstream
 * timeout and rate-limit detection. Successful responses are cached for
 * OVERPASS_CACHE_MS. Concurrent identical queries share a single upstream
 * request via the in-flight map.
 *
 * @returns {import('vite').Plugin}
 */
function overpassProxy() {
  return {
    name: 'overpass-proxy',
    configureServer(server) {
      server.middlewares.use('/api/overpass', async (req, res) => {
        // Hoisted out of the try so the catch's serve-stale lookup can see it
        // (a body-read failure would otherwise hit an out-of-scope reference).
        let cacheKey = null;
        try {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            return;
          }

          // Collect POST body with a hard byte cap (Overpass QL queries are small)
          let body;
          try {
            body = (await readRequestBodyCapped(req, OVERPASS_MAX_BODY_BYTES)).toString();
          } catch (err) {
            if (err?.code === 'BODY_TOO_LARGE') {
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Overpass query too large' }));
              return;
            }
            throw err;
          }
          if (!body) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing Overpass query body' }));
            return;
          }

          // Validate + clamp the QL: reject unbounded/global queries and cap the
          // server-side timeout so a tiny body can't request planet-scale work.
          const sanitized = sanitizeOverpassBody(body);
          if (!sanitized.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: sanitized.error }));
            return;
          }
          const safeBody = sanitized.body;

          // Normalize whitespace so semantically identical Overpass QL queries share cache entries
          cacheKey = safeBody.replace(/\s+/g, ' ').trim();
          const preflight = await resolveOverpassPreflight({
            cacheKey,
            memoryCache: _overpassCache,
            inFlight: _overpassInFlight,
            // Fresh-enough disk entries survive restarts and skip the public
            // mirrors; boundary-class queries keep their month-long TTL.
            readDisk: () => readOverpassDisk(cacheKey, overpassDiskTtlMs(cacheKey)),
            allowUpstream: () => _overpassRateLimiter(clientKey(req)),
          });
          if (preflight.source === 'RATE_LIMITED') {
            res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
            res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
            return;
          }
          if (preflight.source !== 'UPSTREAM') {
            if (preflight.source === 'DISK') {
              _overpassCache.set(cacheKey, preflight.payload);
              trimOverpassCache();
            }
            sendOverpassResponse(res, preflight.payload, preflight.source);
            return;
          }

          // From here onward the request is genuinely upstream-bound and has
          // consumed one local limiter slot. Cache and dedupe hits above do not.
          if (_overpassConcurrent >= OVERPASS_MAX_CONCURRENT) {
            res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '2' });
            res.end(JSON.stringify({ error: 'Overpass proxy busy — try again shortly' }));
            return;
          }
          _overpassConcurrent += 1;
          const requestPromise = fetchOverpassPayload(safeBody)
            .then((payload) => {
              if (payload.status < 500 && !payload.rateLimited && !payload.runtimeError) {
                const entry = { ...payload, cachedAt: Date.now() };
                _overpassCache.set(cacheKey, entry);
                trimOverpassCache();
                writeOverpassDisk(cacheKey, entry);
              }
              return payload;
            })
            .finally(() => {
              _overpassConcurrent -= 1;
              _overpassInFlight.delete(cacheKey);
            });

          _overpassInFlight.set(cacheKey, requestPromise);
          const payload = await requestPromise;
          // Degraded upstream (rate-limited on every mirror / 5xx / runtime
          // error): last-good roads beat an empty layer — serve stale from
          // memory or disk at ANY age before surfacing the failure.
          if (payload.rateLimited || payload.runtimeError || payload.status >= 500) {
            const stale = _overpassCache.get(cacheKey) || await readOverpassDisk(cacheKey, Infinity);
            if (stale) {
              sendOverpassResponse(res, stale, 'STALE');
              return;
            }
          }
          sendOverpassResponse(res, payload, 'MISS');
        } catch (e) {
          // Every mirror threw (network-level). Same serve-stale rule.
          const stale = cacheKey
            ? (_overpassCache.get(cacheKey) || await readOverpassDisk(cacheKey, Infinity).catch(() => null))
            : null;
          if (stale) {
            sendOverpassResponse(res, stale, 'STALE');
            return;
          }
          console.error('[Overpass Proxy]', e.message);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Overpass proxy error' }));
        }
      });

      // Real OSM routing via the public FOSSGIS OSRM servers (foot/car/bike).
      // GET /api/route?profile=foot|car|bike&coords=lon,lat;lon,lat[;...]
      server.middlewares.use('/api/route', async (req, res) => {
        await handleOsrmRouteHttp(req, res);
      });
    },
  };
}

/**
 * Vite plugin: civilian flights proxy.
 *
 * OpenSky is disabled in this commercial fork. `/api/opensky` is kept as a
 * compatibility path and serves only a bounded 250 nm adsb.lol snapshot
 * around the current view anchor. It never fetches opensky-network.org.
 *
 * @returns {import('vite').Plugin}
 */
function openSkyProxy() {
  return {
    name: 'opensky-proxy',
    configureServer(server) {
      server.middlewares.use('/api/opensky', (req, res) => handleOpenskyFlightsHttp(req, res));
    },
  };
}

/**
 * Read a fetch Response body as text while enforcing a hard byte cap during
 * the read — so a malicious or buggy upstream that streams an unbounded body
 * (no/oversized Content-Length, chunked) can't OOM the proxy. Returns
 * { tooLarge, text }. Cancels the stream as soon as the cap is crossed.
 * @param {Response} upstream - fetch() response.
 * @param {number} maxBytes - hard ceiling on decoded bytes.
 * @returns {Promise<{tooLarge: boolean, text: string}>}
 */
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

/**
 * Vite plugin: AISStream live vessel cache.
 *
 * AISStream does not support browser CORS and requires a private API key, so
 * the Vite server keeps one backend websocket open and exposes a same-origin
 * JSON snapshot to the Cesium layer.
 */
function aisLiveProxy() {
  function install(middlewares) {
    middlewares.use('/api/ais-live', async (req, res) => {
      try {
        ensureAisStreamConnection();
        const incoming = new URL(req.url || '', 'http://localhost');

        // Track sub-route MUST be handled before the rows snapshot — this
        // mount prefix-matches every subpath, so without this branch
        // /api/ais-live/track would be silently answered with vessel rows.
        if (incoming.pathname === '/track' || incoming.pathname.startsWith('/track/')) {
          const mmsi = String(incoming.searchParams.get('mmsi') || '').trim();
          res.statusCode = /^\d{5,10}$/.test(mmsi) ? 200 : 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          if (res.statusCode !== 200) {
            res.end(JSON.stringify({ error: 'mmsi query param required', samples: [] }));
            return;
          }
          res.end(JSON.stringify({
            mmsi,
            samples: readAisTrack(mmsi),
            source: 'AISStream (accumulated since server start)',
            retainedSec: Math.floor(AISSTREAM_STALE_MS / 1000),
          }));
          return;
        }

        const maxRows = clampInt(incoming.searchParams.get('maxRows'), 1, AISSTREAM_CACHE_MAX, AISSTREAM_CACHE_MAX);
        const rows = aisStreamRows(maxRows);

        const feed = aisStreamStatusSnapshot();

        res.statusCode = process.env.AISSTREAM_API_KEY ? 200 : 503;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({
          rows,
          source: 'AISStream',
          status: feed.status,
          error: feed.error,
          refreshing: feed.status !== 'live',
          newestPositionAt: newestAisPositionAt(rows),
          lastMessageAt: feed.lastMessageAt,
          // Honest-failure metadata: how long the feed has been quiet, which
          // recovery attempt we are on, and when the next one lands.
          silentForMs: feed.silentForMs,
          reconnectAttempt: feed.reconnectAttempt,
          nextAttemptAt: feed.nextAttemptAt,
          staleAfterMs: feed.staleAfterMs,
          watchdog: feed.watchdog,
        }));
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ error: error?.message || 'AIS live stream error', rows: [] }));
      }
    });
  }

  return {
    name: 'ais-live-proxy',
    configureServer(server) {
      install(server.middlewares);
      startAisStreamWatchdogTick();
      // Vite restarts the server in-process on a config change while this
      // module's state survives; without teardown each reload stacks another
      // interval and another socket.
      server.httpServer?.on('close', disposeAisStream);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
      startAisStreamWatchdogTick();
      server.httpServer?.on('close', disposeAisStream);
    },
    // Middleware-mode backstop: there is no httpServer to hang 'close' on.
    closeBundle() {
      disposeAisStream();
    },
  };
}

/**
 * Vite plugin: OpenAI Realtime ephemeral client secret.
 *
 * Keeps OPENAI_API_KEY server-side while the browser connects to the
 * Realtime API over WebRTC with a short-lived secret.
 */
function openAiRealtimeProxy() {
  function install(middlewares) {
    middlewares.use('/api/openai/hud-summary', async (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      // Opt-in per-IP throttle (GEV_RATELIMIT_OPENAI_PER_MIN). No-op when unset.
      if (!enforceOptInRateLimit(openAiRateLimiter(), req, res)) return;

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'OPENAI_API_KEY is not set' }));
        return;
      }
      if (await rejectIfVoiceForbidden(req, res)) return;

      try {
        const body = await readRequestBody(req, 64 * 1024);
        const context = JSON.parse(body || '{}');
        const response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env.OPENAI_HUD_SUMMARY_MODEL || OPENAI_HUD_SUMMARY_MODEL_DEFAULT,
            instructions: [
              "Write one concise intelligence-HUD summary for Meridian.",
              'Use only the supplied place, street, nearby-place, and enabled-layer text labels.',
              'Prefer the clearest named place and include a relevant enabled layer only when useful.',
              'Do not infer from coordinates or invent a place.',
              'Output exactly five words with no title, punctuation, markdown, or introductory phrase.',
            ].join(' '),
            input: JSON.stringify(context),
            reasoning: { effort: 'minimal' },
            max_output_tokens: 100,
          }),
        });
        const data = await response.json().catch(() => ({}));
        const summary = toFiveWordHudSummary(extractOpenAiResponseText(data));
        res.statusCode = response.ok && summary ? 200 : response.status || 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({
          summary: summary || null,
          error: response.ok ? null : data.error?.message || 'OpenAI HUD summary request failed',
        }));
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: error?.message || 'OpenAI HUD summary request failed' }));
      }
    });

    middlewares.use('/api/realtime/debug-log', async (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      try {
        const body = await readRequestBody(req, REALTIME_DEBUG_LOG_MAX_BYTES);
        const record = JSON.parse(body || '{}');
        fs.mkdirSync(REALTIME_DEBUG_LOG_DIR, { recursive: true });
        fs.appendFileSync(REALTIME_DEBUG_LOG_FILE, `${JSON.stringify({
          loggedAt: new Date().toISOString(),
          ...record,
        })}\n`);
        res.statusCode = 204;
        res.end();
      } catch (error) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: error?.message || 'Failed to write Realtime debug log' }));
      }
    });

    middlewares.use('/api/realtime/token', async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      // Opt-in per-IP throttle (GEV_RATELIMIT_OPENAI_PER_MIN). No-op when unset.
      if (!enforceOptInRateLimit(openAiRateLimiter(), req, res)) return;

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'OPENAI_API_KEY is not set' }));
        return;
      }
      if (await rejectIfVoiceForbidden(req, res)) return;

      // Voice model tier, requested by the client as ?tier=standard|mini.
      // resolveVoiceModel is total: an unknown, empty, or hostile value
      // resolves to `standard` instead of reaching OpenAI as a model id, so a
      // bad querystring degrades to a normal session rather than a dead mic.
      // The env overrides stay authoritative per tier (see .env.example) —
      // a wrong upstream model id is then a config fix, not a code change.
      const requestedTier = (() => {
        try {
          return new URL(req.url || '', 'http://localhost').searchParams.get('tier');
        } catch {
          return null;
        }
      })();
      const tier = resolveVoiceModel(requestedTier).tier;
      const model =
        tier === 'mini'
          ? process.env.OPENAI_REALTIME_MODEL_MINI || OPENAI_REALTIME_MODEL_MINI_DEFAULT
          : process.env.OPENAI_REALTIME_MODEL || OPENAI_REALTIME_MODEL_DEFAULT;
      const voice = process.env.OPENAI_REALTIME_VOICE || OPENAI_REALTIME_VOICE_DEFAULT;
      const effort = process.env.OPENAI_REALTIME_REASONING_EFFORT || OPENAI_REALTIME_REASONING_DEFAULT;
      const contextTokenLimit = Math.round(Math.max(
        1000,
        Math.min(12000, Number(process.env.OPENAI_REALTIME_CONTEXT_TOKENS) || OPENAI_REALTIME_CONTEXT_TOKENS_DEFAULT)
      ));
      const contextRetentionRatio = Math.max(
        0.1,
        Math.min(1, Number(process.env.OPENAI_REALTIME_CONTEXT_RETENTION) || OPENAI_REALTIME_CONTEXT_RETENTION_DEFAULT)
      );
      const sessionConfig = {
        session: {
          type: 'realtime',
          model,
          reasoning: { effort },
          truncation: {
            type: 'retention_ratio',
            retention_ratio: contextRetentionRatio,
            token_limits: {
              post_instructions: contextTokenLimit,
            },
          },
          audio: {
            input: {
              noise_reduction: { type: 'near_field' },
              turn_detection: {
                type: 'semantic_vad',
                eagerness: 'low',
                create_response: true,
                interrupt_response: false,
              },
            },
            output: { voice },
          },
          instructions: [
            "You are Meridian Voice Control, a concise voice controller for a Cesium geospatial app called Meridian.",
            'Have a natural spoken conversation with the user while the mic session is active.',
            'Do not require a wake phrase. Treat direct commands like "zoom into London" or "open datacenters" as Meridian control requests.',
            'Only control the app by calling the provided tools. Never invent tool names or arguments.',
            'Call tools only for clear Meridian control, navigation, visual-style, layer, or app-state requests. For ordinary conversation, answer normally without tools.',
            'For requests to open, show, reveal, or focus a menu/panel, call set_panel_open or show_data_layers_menu. "Open Context" means only set_panel_open{panelId:"global-context-panel",open:true}; it does not activate a Context sub-mode. "Open Contacts" means set_context_mode{mode:"contacts"}; that action expands the parent Context panel before activating Contacts.',
            'For requests like "show me the datacenter layers", open the data layers menu and focus the matching layer row; do not enable the layer unless the user asks to turn it on.',
            'For questions like "what am I looking at?", "what is in view?", "what is this?", "that selected thing", nearby datacenter, dam, cable, ship, or current view contents, call get_entity_context first, then answer from the returned scene/entity context.',
            'For "what is this aircraft?" answers, read the callsign, operator, registration, type, and route only from get_entity_context selected.properties. Treat route, routeOrigin, and routeDestination as the only authoritative route fields. Every aircraft identity answer MUST explicitly cover operator, type, and route. When a route is present, repeat its endpoint codes exactly; do not expand airport codes into city names. For a missing field say exactly "Operator details are unavailable", "Aircraft type is unavailable", or "Route details are unavailable" as applicable. Never silently omit missing enrichment or infer it from the callsign.',
            'While a camera motion or route flight is active, a bare "stop" means move_camera{motion:stop} — NOT control_scene and NOT stop_tracking (those need explicit words like "stop the scene" / "stop tracking"). If move_camera stop returns stopped:false and an entity is being tracked, call stop_tracking next — the user means "stop whatever is moving". Flying somewhere while tracking automatically stops the tracking (the result says so): mention it briefly.',
            'For camera-motion requests — "orbit around this", "pan left", "tilt up", "stop moving" — call move_camera. For "fly the route" over a drawn route, call fly_route. Confirm with the RESULTING state ("Orbiting slowly", "Flying the route").',
            'analyst_query ANSWERS questions; it never moves the camera or starts tracking. For requests to FOLLOW or TRACK a specific aircraft/ship, call track_entity (get_entity_context first when the target is ambiguous), never analyst_query as the final or only action. For "follow/track the nearest aircraft", first call analyst_query with the aircraft layer(s), sortBy=distance, and limit=1, then call track_entity with the returned aircraft identity in the same turn. The lookup alone does not fulfill a follow/track command.',
            'For a request to enable an aircraft layer and SELECT or FIND the nearest/closest aircraft near a named place — for example, "Turn on flights and select the closest aircraft to Austin" — call select_nearest_aircraft once. It atomically turns on the requested aircraft layer first, waits for location arrival, refreshes that layer for the destination viewport, filters out landed/on-ground records, and selects the nearest airborne result. A healthy fallback feed is valid data: report the returned feed source briefly, never call it an enable failure. Do not also call fly_to_location, set_layer_visibility, analyst_query, track_entity, set_context_mode, or control_cockpit for the same request. SELECT/FIND never implies Contacts or Cockpit unless the user explicitly asks for either mode.',
            'For ANALYTICAL questions about layer data — how many / which / fastest / highest / biggest / nearest flights, ships, fires, or earthquakes ("how many flights over Texas", "biggest fire near LA", "which ships are headed to Oakland", "anything above 40,000 feet") — call analyst_query, not get_entity_context. Narrate the count plus two or three notable examples by name, and reflect the result\'s coverage note honestly: the answer covers data loaded by enabled layers, not the whole world. If the needed layer is disabled, say so and offer to enable it. For follow-ups about the same set ("which of THOSE is closest?"), call analyst_query with followUp=true and only the new filter/sort.',
            'COUNTING CONTRACT — what "near" means. (1) While Contacts is ACTIVE, "near / nearby / how many aircraft" means the Contacts window: answer from contactsWindow in the tool result — those are the exact numbers on the user\'s panel. set_context_mode, analyst_query, and get_current_view_state carry it after Contacts settles. For "Open Contacts and tell me how many aircraft are within 250 km", call set_context_mode{mode:"contacts"} first and answer from contactsWindow.aircraft; do not answer from a pre-Contacts analyst query. analyst_query\'s own count measures currently-loaded records and is usually lower; never give it as the window count. CENTER PRECEDENCE for a nearby/how-many ask, in order: an explicit place in the question ("over Texas", "near Austin") always wins and ignores Contacts state; else the CONTACTS SUBJECT when Contacts is active and has one — a selected datacenter, dam, fire, or cable does NOT silently become the center; else an entity the user explicitly names ("around this datacenter"); else the current view, said aloud ("nothing is selected, so this is the current view"). With Contacts active but NO subject yet, use the view and say so; never read an empty panel. (2) With Contacts OFF, "nearby" means in view; "near <place>" means a radius around that place. (3) EVERY count names its scope in words — "42 in your window", "8 in view", "about 30 within 250 km of Austin" — never a bare number; analyst_query returns scopeLabel for exactly this. Two different numbers with named scopes are not a contradiction; say both if asked. (4) State counts VERBATIM — never estimate, round, or hedge ("a few", "less than a dozen"): if a tool returns 46, say 46. (5) When it matters, add once: counts cover loaded data, and the flights layer loads where you look.',
            'While Cockpit is active, navigate with control_cockpit (next/previous, optionally targetLayer or aircraftClass). track_entity and fly_to_location are REFUSED by design while Cockpit owns the camera — that refusal is correct, not an error to retry. To go somewhere else, exit Cockpit first. control_cockpit enter establishes Contacts itself, so do not call set_context_mode before or after it.',
            'When the target layer is unknown, OMIT layerId in track_entity so it searches all enabled layers. Passing the wrong layerId ("flights" for a military contact) returns "Nothing matched" even though the contact is loaded.',
            'If get_entity_context has no selected object or overlay entities, use its basemap context: Google Photorealistic 3D Tiles/Cesium source, center target coordinates, reverse-geocoded place, camera altitude, active style, and enabled layers. Do not say there is nothing unless the basemap target is also unavailable.',
            'If basemap context includes knownLandmarks, prefer the nearest known landmark by name for "what am I looking at" answers. For example, if knownLandmarks includes Eiffel Tower, say Eiffel Tower.',
            'At local zoom, use basemap nearbyPlaces, place.labels, viewportPlaces.visibleLabels, and viewportPlaces.streetLabels to identify the building, premises, roads, and named places visible around the screen target.',
            'If basemap context includes viewportPlaces, prefer dominantCountry, dominantRegion, and dominantLocality over raw coordinates.',
            'When basemap context includes viewportSamples or an inferred country, trust that over a single reverse-geocoded address. If most samples indicate Iran, say Iran, not the United States.',
            'When a viewport screenshot is attached after get_entity_context, read clearly legible street, building, and place labels from it and combine them with structured label context. Respect scene viewScale: at global/continental/regional scale, avoid naming a precise street/city from one center pixel.',
            'Do not mention disabled layers or stale selections.',
            'When a request requires a tool call, do not speak in the same response as the tool call. Call the tool first.',
            'When a single user request contains MULTIPLE changes (e.g. "switch to operator layout, use balanced detection at density 50, and switch to Bing aerial"), call ALL the corresponding tools — multiple tool calls in sequence — before speaking. Never confirm a partial subset. If a later tool fails, say which parts succeeded and which failed.',
            'After receiving tool output, speak exactly one short confirmation. Do not repeat the confirmation.',
            'For "show/open/turn on" layer requests, enable the matching layer. For "hide/close/turn off", disable it.',
            // INSTRUCTION-ONLY mapping for the two globe-scale named views.
            //
            // Both are BROADER than the first-run tiles on purpose. A person
            // naming layers out loud has chosen them; a tile is a first
            // impression handed to a stranger. So voice keeps fires in the
            // environmental view and keeps infrastructure entirely, while the
            // launcher's ENVIRONMENTAL tile is quakes-only and has no
            // infrastructure tile at all. See src/firstRunExperience.js for why.
            //
            // Fully expressible with tools that already exist, so
            // GEV_REALTIME_TOOLS is deliberately untouched — deleting this one
            // string is the whole rollback.
            'NAMED VIEWS are shorthand for tool calls you already have — there is no "mode" tool for them. Treat ONLY these as the shorthand: "infrastructure mode" / "the infrastructure view" / "show me global infrastructure" means two set_layer_visibility calls (local-datacenters, local-dams) plus zoom_to_globe; the submarine-cables layer is a commercial no-op and must not be enabled; "environmental mode" / "earth watch" / "active events", said as the name of a view, means set_layer_visibility for local-firms and earthquakes plus zoom_to_globe. Anything vaguer is NOT this shorthand — an open-ended question about the world or the news is an ordinary question: answer it, or use analyst_query over the layers already on. Never switch a whole view on to answer a question nobody asked to see. When you do run one, make every call before speaking, then give one confirmation naming the resulting state; if the fires layer comes back unavailable because no FIRMS key is configured, say so plainly — the earthquakes still loaded. "Live contacts" and "space missions" are NOT this pattern: they stay set_context_mode{mode:"contacts"} and set_context_mode{mode:"space-missions"}.',
            'For visual filter requests, call set_visual_style with one of the allowed style IDs.',
            'Disambiguation table — basemap vs layer vs style: basemap switching requires an explicit stack name — "Bing aerial" means set_map_stack bing-aerial, "aerial with labels" means bing-labels, "OSM"/"road map" means osm, "Google 3D"/"photorealistic" means photoreal. Any mention of "satellite" or "satellites" ALWAYS means the satellites DATA LAYER via set_layer_visibility, never a basemap. "surveillance"/"night vision"/"thermal" are visual STYLES via set_visual_style.',
            'HUD requests ("hud on/off", "switch to operator/minimal/tactical layout") use set_hud. Detection requests ("detection on", "dense mode", "balanced mode", "sparse mode", "set density to 25", "use weighted allocation") use set_detection. Density snaps to 0/25/50/75/100 and derives Sparse/Balanced/Dense; panoptic is a legacy alias for Dense.',
            'Bloom/sharpen requests use set_post_processing. Scene requests ("play orbital watch", "stop the scene", "what scenes are there") use control_scene. CCTV camera requests ("next camera", "nearest camera", "select the Congress camera", "show coverage") use control_cctv — the CCTV layer must be enabled first.',
            'Radio playback requests use control_radio. "Turn on/start the radio" means action=play; action=enable only reveals Radio markers and must be reserved for explicit "show/enable the Radio layer/markers" requests. After a prepared playback result, briefly confirm any other completed actions and say "Turning on the radio"—never claim it is already playing. The client keeps Radio muted until playback is verified, then closes voice before restoring Radio volume. Examples: "play news near Austin" → select category=news locationId=austin; "play US news" → select category=news country=US; "Radio volume 30" → volume; pause/resume/stop/next/previous use the matching action. Radio selection never moves the camera.',
            '"Track/follow <something specific>" (a callsign, ship name, satellite name) uses track_entity. "Take me to the biggest fire" uses track_entity with query "biggest fire" (the fires layer must be enabled). Bare "orbit" means camera orbit of the current landmark. "Stop following/tracking" uses stop_tracking.',
            '"Show me which planes are overhead"/"frame the ships"/"show me the satellites above" use frame_overhead with the matching target.',
            "After frame_overhead, speak ONLY from the tool result's count field — e.g. 'Framed fourteen aircraft, labels on'; never reassess or second-guess the count aloud.",
            'Confirmations echo the RESULTING state, never the request: "HUD operator layout", "Density twenty-five percent", "Bing aerial imagery", "Tracking UAL428", "Framed fourteen aircraft". On ok=false, state the failure plainly: "Nothing matched UAL999", "No ships within 120 kilometers". Never claim an action without ok=true in the tool result.',
            'For destination requests such as "take me to Italy", "go to NYC", or "show me the Eiffel Tower", call fly_to_location. Prefer known city IDs when available; otherwise pass the plain place query.',
            'Navigation-only requests ("take me to X", "go to X", "fly to X") are NOT descriptions: call fly_to_location alone and do NOT also call annotate_map, unless the user explicitly asks to mark the place or you go on to explain specific places there. Never drop a point pin on a region-scale natural feature (a mountain range, desert, sea, or forest) — a single point in the middle of the Rockies is meaningless. If the user explicitly asks to mark such a region, prefer type=area.',
            'For country and city destinations, omit rangeM so Meridian frames the whole country or city in view. For landmarks and buildings, omit rangeM so Meridian chooses a close landmark view.',
            'Only supply rangeM when the user asks for a particular numeric height, distance, closer view, or wider view.',
            'For relative requests such as "zoom out a little", "pull back", "zoom in more", or "get closer", always call adjust_camera_zoom. But "globe view", "whole earth", "the whole planet", or "zoom all the way out" is an ABSOLUTE framing: call zoom_to_globe once instead — repeated adjust_camera_zoom calls can never reach the globe. Never claim the camera moved without the tool returning ok=true.',
            'Keep spoken confirmations short, e.g. "Opening datacenters" or "Flying to London".',
            'WHITEBOARD THE WORLD: whenever you describe or explain a specific place, building, campus, district, boundary, or a spatial relationship between places, call annotate_map to mark it visually as you talk — like sketching on the map. To call out a specific building, campus, compound, park, or district, use type=area (it traces and encloses the real footprint — a building gets a glowing volume, a district gets a draped outline). Use type=highlight only for a transient pulse on a precise spot that has no meaningful footprint, and type=pin to drop a labeled marker. Examples: "what is the Palace of Fine Arts?" → an AREA on it; "the old military base next to it" → an AREA on the Presidio; "ILM is right here" → a pin; "it sits next to the Marina" → an arrow from one to the other. Prefer place NAMES so the app resolves real positions and outlines; never invent coordinates or pixel locations.',
            'On every annotation, also set entityKind to what the thing IS when you know it: building (one structure), compound (campus/grounds/mall/park), district (neighborhood/area of a city), street (a named road), or point_feature (a monument, statue, memorial, plaque, fountain, or other small point landmark). entityKind is a FACT about the target, independent of the mark type you chose — monuments and statues are point_feature even when you use type=area; the app then anchors them as precise points instead of guessing at a footprint.',
            'Use a single annotate_map call with several annotations when you are describing multiple related places at once. Set flyTo true only when the user is not already looking at the place; if every mark in a call lands off-screen the app auto-frames them, so when unsure leave flyTo false. Do NOT say out loud that you are drawing, highlighting, or annotating — just speak naturally about the places while the marks appear. ANNOTATIONS ACCUMULATE AND PERSIST — keep adding marks as you explore; you can fly around, change topic, and jump between far-apart places and the marks STAY, so the user can build up the map and show people things. Do NOT clear on your own initiative: never pass clearPrevious, and call clear_annotations ONLY when the user EXPLICITLY asks to clear or reset the map.',
            'If an annotate_map result has partial:true or any failedLabels, do not pretend those places appeared — briefly work into your narration that you could not pinpoint them (e.g. "I couldn\'t place X"). If a route comes back as a direct line (no street route was found), describe it as a straight-line distance, not a walking/driving time. If an annotate_map result has capped:true, the map is full — ASK the user whether to clear before drawing more; do not clear unprompted. outlinePending:true is NOT a failure, but it is also NOT an outline: the anchor mark is placed and the boundary is still being traced in the background. Narrate it in progress — e.g. "tracing the boundary now" — and NEVER state the outline is already drawn or visible; it may yet come back as just a point. A later system item of type map_annotation_outline reports the final outcome per mark (status resolved or failed, with its label): use it to quietly confirm, or to correct yourself if you implied a boundary that stayed a point — an honest miss beats a misleading guess.',
            'PREFER NAMES. Only when you cannot name or geocode a place but you can clearly SEE the exact spot in the most recent viewport screenshot, fall back to screenX/screenY (normalized 0..1 from that image) to point at it; the app converts the pixel to a real world point. Never use screenX/screenY for something you could name.',
            'PATHS vs DISTANCES: for "walking/driving route from A to B" (or through several stops), use type=route with the ordered points and the matching mode (walking/driving/cycling) — the app draws the real street-following path on the map and reports distance and travel time, which you can read aloud. For "how far is X from Y", "is it nearby", or "X is next to Y", use type=arrow between the two — it draws a floating connector and shows the straight-line distance. Do NOT use route for a simple distance/proximity question.',
          ].join('\n'),
          tools: GEV_REALTIME_TOOLS,
          tool_choice: 'auto',
        },
      };

      try {
        const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'OpenAI-Safety-Identifier': 'gev-local-dev',
          },
          body: JSON.stringify(sessionConfig),
        });
        const body = await response.text();
        res.statusCode = response.status;
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
        // Which tier/model this secret was actually minted for. The upstream
        // body is passed through untouched (the client parses it verbatim), so
        // these headers are the authoritative echo — including the case where a
        // bogus ?tier= was silently downgraded to standard.
        res.setHeader('X-GEV-Voice-Tier', tier);
        res.setHeader('X-GEV-Voice-Model', model);
        if (requestedTier && !isKnownVoiceTier(requestedTier)) {
          res.setHeader('X-GEV-Voice-Tier-Fallback', '1');
        }
        res.end(body);
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: error?.message || 'Failed to create Realtime token' }));
      }
    });
  }

  return {
    name: 'openai-realtime-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

function extractOpenAiResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  if (!Array.isArray(data?.output)) return '';
  return data.output
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((part) => part?.text || part?.output_text || '')
    .join(' ')
    .trim();
}

function toFiveWordHudSummary(value) {
  return String(value || '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');
}

function readRequestBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`Request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Vite plugin: nearby Google place labels for Realtime scene context.
 *
 * The Photorealistic 3D Tiles mesh does not expose rendered map labels as
 * Cesium feature metadata. Nearby Search supplies the names around the actual
 * screen-space target without exposing the Google API key in the request.
 */
function googlePlacesContextProxy() {
  function install(middlewares) {
    middlewares.use('/api/google/nearby-places', async (req, res) => {
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed', places: [] }));
        return;
      }

      // Opt-in per-IP throttle (GEV_RATELIMIT_GOOGLE_PER_MIN). No-op when unset.
      // Inlined (not the shared helper) so the 429 body keeps this endpoint's
      // `places: []` contract that the client expects on every error response.
      const _grl = googleRateLimiter();
      if (_grl && !_grl(clientKey(req))) {
        res.statusCode = 429;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Retry-After', '5');
        res.end(JSON.stringify({ error: 'Rate limit exceeded', places: [] }));
        return;
      }

      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'GOOGLE_MAPS_API_KEY is not set', places: [] }));
        return;
      }

      const requestUrl = new URL(req.url || '', 'http://localhost');
      const latitude = Number(requestUrl.searchParams.get('lat'));
      const longitude = Number(requestUrl.searchParams.get('lon'));
      const radiusM = Math.max(25, Math.min(5000, Number(requestUrl.searchParams.get('radiusM')) || 250));
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Valid lat and lon are required', places: [] }));
        return;
      }

      try {
        const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': [
              'places.id',
              'places.displayName',
              'places.formattedAddress',
              'places.shortFormattedAddress',
              'places.location',
              'places.primaryType',
              'places.primaryTypeDisplayName',
              'places.types',
            ].join(','),
          },
          body: JSON.stringify({
            maxResultCount: 20,
            rankPreference: 'DISTANCE',
            locationRestriction: {
              circle: {
                center: { latitude, longitude },
                radius: radiusM,
              },
            },
          }),
        });
        const data = await response.json().catch(() => ({}));
        const seenPlaces = new Set();
        const places = Array.isArray(data.places) ? data.places
          .map((place) => {
            const placeLatitude = place.location?.latitude ?? null;
            const placeLongitude = place.location?.longitude ?? null;
            const types = Array.isArray(place.types) ? place.types.slice(0, 8) : [];
            return {
              id: place.id || null,
              name: place.displayName?.text || null,
              address: place.shortFormattedAddress || place.formattedAddress || null,
              latitude: placeLatitude,
              longitude: placeLongitude,
              distanceM: approximateDistanceM(latitude, longitude, placeLatitude, placeLongitude),
              primaryType: place.primaryTypeDisplayName?.text || place.primaryType || null,
              types,
              contextPriority: placeContextPriority(types),
            };
          })
          .filter((place) => {
            const key = `${place.name}:${place.address || ''}`.toLowerCase();
            if (!place.name || seenPlaces.has(key)) return false;
            seenPlaces.add(key);
            return true;
          })
          .sort((a, b) => b.contextPriority - a.contextPriority || a.distanceM - b.distanceM)
          .map(({ contextPriority, ...place }) => place)
          .slice(0, 20) : [];

        res.statusCode = response.ok ? 200 : response.status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.end(JSON.stringify({
          places,
          error: response.ok ? null : data.error?.message || 'Google Places request failed',
        }));
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: error?.message || 'Google Places request failed', places: [] }));
      }
    });

    // Text Search: resolve a named landmark/POI to a real coordinate, biased to
    // the view. Geocoding scatters obscure monument/POI names across the city;
    // a view-biased Text Search lands on the actual feature. Same key, field
    // mask, throttle, and `places: []` error contract as nearby-places above.
    middlewares.use('/api/google/text-search', async (req, res) => {
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed', places: [] }));
        return;
      }

      // Opt-in per-IP throttle (GEV_RATELIMIT_GOOGLE_PER_MIN). No-op when unset.
      // Inlined (like nearby-places) so the 429 body keeps the `places: []`
      // contract the client expects on every error response.
      const _grl = googleRateLimiter();
      if (_grl && !_grl(clientKey(req))) {
        res.statusCode = 429;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Retry-After', '5');
        res.end(JSON.stringify({ error: 'Rate limit exceeded', places: [] }));
        return;
      }

      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'GOOGLE_MAPS_API_KEY is not set', places: [] }));
        return;
      }

      const requestUrl = new URL(req.url || '', 'http://localhost');
      const textQuery = String(requestUrl.searchParams.get('q') || '').trim();
      const latitude = Number(requestUrl.searchParams.get('lat'));
      const longitude = Number(requestUrl.searchParams.get('lon'));
      const radiusM = Math.max(50, Math.min(50000, Number(requestUrl.searchParams.get('radiusM')) || 4000));
      if (!textQuery || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'q, lat and lon are required', places: [] }));
        return;
      }

      try {
        const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': [
              'places.id',
              'places.displayName',
              'places.formattedAddress',
              'places.location',
              'places.viewport',
              'places.primaryType',
              'places.types',
            ].join(','),
          },
          body: JSON.stringify({
            textQuery,
            locationBias: {
              circle: {
                center: { latitude, longitude },
                radius: radiusM,
              },
            },
            maxResultCount: 5,
          }),
        });
        const data = await response.json().catch(() => ({}));
        const places = Array.isArray(data.places) ? data.places
          .map((place) => {
            const placeLatitude = place.location?.latitude ?? null;
            const placeLongitude = place.location?.longitude ?? null;
            const types = Array.isArray(place.types) ? place.types.slice(0, 8) : [];
            // Places returns a lat/lng bounding box (low/high corners) framing the
            // place — no polygon, but enough to SIZE a fallback grounds disc to the
            // real feature instead of a blind constant. Normalize to plain numbers.
            const vp = place.viewport;
            const viewport = (
              Number.isFinite(vp?.low?.latitude) && Number.isFinite(vp?.low?.longitude)
              && Number.isFinite(vp?.high?.latitude) && Number.isFinite(vp?.high?.longitude)
            ) ? {
              low: { latitude: vp.low.latitude, longitude: vp.low.longitude },
              high: { latitude: vp.high.latitude, longitude: vp.high.longitude },
            } : null;
            return {
              id: place.id || null,
              name: place.displayName?.text || null,
              address: place.formattedAddress || null,
              latitude: placeLatitude,
              longitude: placeLongitude,
              distanceM: approximateDistanceM(latitude, longitude, placeLatitude, placeLongitude),
              primaryType: place.primaryType || null,
              types,
              viewport,
            };
          })
          .filter((place) => place.name) : [];

        res.statusCode = response.ok ? 200 : response.status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.end(JSON.stringify({
          places,
          error: response.ok ? null : data.error?.message || 'Google Places request failed',
        }));
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: error?.message || 'Google Places request failed', places: [] }));
      }
    });
  }

  return {
    name: 'google-places-context-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

function placeContextPriority(types) {
  const typeSet = new Set(types);
  if (typeSet.has('historical_landmark') || typeSet.has('monument')) return 100;
  if (typeSet.has('tourist_attraction') || typeSet.has('museum')) return 90;
  if (typeSet.has('premise') || typeSet.has('street_address')) return 75;
  if (typeSet.has('point_of_interest')) return 60;
  if (typeSet.has('public_bathroom')) return 10;
  return 40;
}

function approximateDistanceM(latA, lonA, latB, lonB) {
  if (![latA, lonA, latB, lonB].every(Number.isFinite)) return Number.MAX_SAFE_INTEGER;
  const latitudeScale = 111320;
  const longitudeScale = latitudeScale * Math.cos((latA * Math.PI) / 180);
  return Math.round(Math.hypot(
    (latB - latA) * latitudeScale,
    (lonB - lonA) * longitudeScale
  ));
}

const GEV_REALTIME_TOOLS = [
  {
    type: 'function',
    name: 'fly_to_location',
    description: "Fly the Meridian camera to a known city, geocoded country/region/city/landmark, or explicit WGS84 coordinate. Countries/cities frame the whole place; landmarks/buildings use close framing.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        locationId: {
          type: 'string',
          enum: ['austin', 'sf', 'nyc', 'tokyo', 'london', 'paris', 'dubai', 'dc'],
          description: 'Known city preset ID. Use when the requested place matches one of these cities.',
        },
        query: {
          type: 'string',
          description: 'Plain place search query, e.g. "London", "Eiffel Tower", or "Dubai Marina".',
        },
        latitude: { type: 'number', minimum: -90, maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
        viewMode: {
          type: 'string',
          enum: ['close', 'overview'],
          description: 'Optional framing intent. Usually omit this; GEV infers whole-place framing for countries/cities and close framing for landmarks.',
        },
        rangeM: {
          type: 'number',
          minimum: 100,
          maximum: 20000000,
          description: 'Optional camera range from the target in meters. Omit it for automatic whole-country/whole-city or close-landmark framing; provide it only when the user explicitly requests a numeric height or distance.',
        },
        waitForArrival: {
          type: 'boolean',
          description: 'Set true when a later tool depends on the destination viewport. The result then waits for the camera flight and returns arrived=true; cancellation returns ok=false.',
        },
      },
    },
  },
  {
    type: 'function',
    name: 'select_nearest_aircraft',
    description: 'Atomically fly to a place, wait for arrival, enable and load Flights or Military Flights in that viewport, exclude on-ground records, and select/follow the nearest airborne aircraft. Healthy fallback feeds remain usable and are reported in the result. This does not open Contacts or Cockpit.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        layerId: {
          type: 'string',
          enum: ['flights', 'military'],
          description: 'Aircraft layer to enable and search. Use flights unless the user explicitly asks for military aircraft.',
        },
        locationId: {
          type: 'string',
          enum: ['austin', 'sf', 'nyc', 'tokyo', 'london', 'paris', 'dubai', 'dc'],
          description: 'Known city preset ID when the place matches one of these cities.',
        },
        locationQuery: {
          type: 'string',
          maxLength: 160,
          description: 'Free-form destination when no locationId matches.',
        },
        latitude: { type: 'number', minimum: -90, maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
      },
      required: ['layerId'],
    },
  },
  {
    type: 'function',
    name: 'adjust_camera_zoom',
    description: 'Move the current Cesium camera closer to or farther from what it is presently looking at. Use for relative zoom requests without changing location.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        direction: {
          type: 'string',
          enum: ['in', 'out'],
        },
        amount: {
          type: 'string',
          enum: ['little', 'medium', 'lot'],
          description: 'Use little for phrases like "a bit" or "a little", medium for ordinary zoom requests, and lot for "way out/in".',
        },
      },
      required: ['direction', 'amount'],
    },
  },
  {
    type: 'function',
    name: 'zoom_to_globe',
    description: 'Pull the camera out to an ABSOLUTE full-Earth globe view (~18,000 km altitude, the whole planet in frame), keeping the current region centered. Use for "globe view", "whole earth", "see the planet", "zoom all the way out". Never use adjust_camera_zoom for these — its relative steps cannot reach the globe.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'set_layer_visibility',
    description: "Enable or disable one registered Meridian data layer.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        layerId: {
          type: 'string',
          description:
            'Common-name mapping for the non-obvious ids: space mission(s) → rocket-launches; fires/wildfires/active fires → local-firms (NASA FIRMS); ships/vessels/boats → ais-live-vessels; undersea/submarine cables → telegeography-submarine-cables; datacenters → local-datacenters; dams → local-dams; bikes/bike share → bikeshare; street traffic/congestion → traffic; traffic cameras → cctv; internet radio/stations → radio.',
          enum: [
            'flights',
            'military',
            'earthquakes',
            'satellites',
            'rocket-launches',
            'traffic',
            'cctv',
            'radio',
            'bikeshare',
            'ais-live-vessels',
            'local-datacenters',
            'local-dams',
            'telegeography-submarine-cables',
            'local-firms',
          ],
        },
        enabled: { type: 'boolean' },
      },
      required: ['layerId', 'enabled'],
    },
  },
  {
    type: 'function',
    name: 'show_data_layers_menu',
    description: 'Open the data layers dropdown/menu and optionally scroll to a specific layer row without toggling it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        layerId: {
          type: 'string',
          enum: [
            'flights',
            'military',
            'earthquakes',
            'satellites',
            'traffic',
            'cctv',
            'radio',
            'bikeshare',
            'ais-live-vessels',
            'local-datacenters',
            'local-dams',
            'telegeography-submarine-cables',
            'local-firms',
          ],
          description: 'Optional layer row to scroll into view and highlight.',
        },
      },
    },
  },
  {
    type: 'function',
    name: 'set_panel_open',
    description: 'Open or close a GEV UI panel/dropdown.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        panelId: {
          type: 'string',
          enum: ['data-panel', 'location-bar', 'control-panel', 'cctv-panel', 'radio-panel', 'scene-panel', 'pp-toggles', 'global-context-panel'],
        },
        open: { type: 'boolean' },
      },
      required: ['panelId', 'open'],
    },
  },
  {
    type: 'function',
    name: 'set_context_mode',
    description: 'Enter or exit the Global Context sub-mode used by Contacts and Space Missions. Use Contacts only when the user explicitly requests Contacts, and Space Missions only when explicitly requested. A request to open the parent Context panel alone uses set_panel_open and must not activate either sub-mode. Selecting an aircraft does not imply Context.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: {
          type: 'string',
          enum: ['off', 'contacts', 'flights', 'space-missions', 'missions'],
          description: 'Use off to exit context mode.',
        },
      },
      required: ['mode'],
    },
  },
  {
    type: 'function',
    name: 'control_cockpit',
    description: 'Read or control Cockpit when the user explicitly requests Cockpit: establish Contacts and enter from a selected or tracked aircraft; exit; or navigate nearby Contacts with optional filters. Selecting or viewing an aircraft alone must not enter Cockpit.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['enter', 'exit', 'previous', 'next', 'prev', 'status'],
          description: 'previous/next (or prev) navigates through nearby contacts in Cockpit context.',
        },
        targetLayer: {
          type: 'string',
          enum: ['flights', 'military', 'ais-live-vessels', 'military-installations'],
          description: 'Optional contact layer filter for next/previous (for example military for a military-only cycle).',
        },
        aircraftClass: {
          type: 'string',
          description: 'Optional aircraft class filter (for example helicopter) when using next/previous navigation.',
        },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'set_visual_style',
    description: "Set the active Meridian visual filter/style.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        style: {
          type: 'string',
          enum: ['normal', 'retro', 'surveillance', 'thermal', 'anime', 'noir', 'snow'],
        },
      },
      required: ['style'],
    },
  },
  {
    type: 'function',
    name: 'get_entity_context',
    description: 'Get current GEV scene context, including basemap/3D-tile target context, selected entity metadata if active, and entities currently visible in the camera view.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scope: {
          type: 'string',
          enum: ['auto', 'selected', 'in_view'],
          description: 'Use auto by default. selected returns the clicked/selected entity; in_view returns visible entities near the screen center.',
        },
        layerId: {
          type: 'string',
          enum: [
            'local-datacenters',
            'local-dams',
            'telegeography-submarine-cables',
            'local-firms',
          ],
          description: 'Optional layer filter for visible entity context.',
        },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: 12,
        },
      },
    },
  },
  {
    type: 'function',
    name: 'get_current_view_state',
    description: 'Read the current camera, style, Context, Cockpit, HUD, detection, map stack, post-processing, scene-playback, tracked-entity, and layer state before choosing another action.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'set_hud',
    description: 'Control the intelligence HUD overlay: visibility and/or layout variant.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        visible: { type: 'string', enum: ['on', 'off', 'auto'], description: 'auto restores style-driven show/hide.' },
        layout: { type: 'string', enum: ['tactical', 'operator', 'minimal'] },
      },
    },
  },
  {
    type: 'function',
    name: 'set_detection',
    description: 'Control the detection overlay: on/off, density-derived Sparse/Balanced/Dense profile, and Elastic/Weighted layer allocation.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean', description: 'false turns detection OFF; true restores the current density-derived profile.' },
        mode: { type: 'string', enum: ['sparse', 'balanced', 'dense'] },
        densityPct: { type: 'number', description: 'Density snaps to 0, 25, 50, 75, or 100 and derives the active profile.' },
        allocationStrategy: { type: 'string', enum: ['elastic', 'weighted'], description: 'Elastic splits evenly then lends unused slots; Weighted follows demand and semantic weight.' },
      },
    },
  },
  {
    type: 'function',
    name: 'set_map_stack',
    description: 'Switch the basemap/imagery stack (NOT the satellites data layer and NOT a visual style filter).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        stack: {
          type: 'string',
          enum: ['photoreal', 'bing-aerial', 'bing-labels', 'osm'],
          description: 'photoreal = Google 3D. Use bing-aerial only when the user explicitly says "Bing aerial" — "satellite(s)" never means a basemap.',
        },
      },
      required: ['stack'],
    },
  },
  {
    type: 'function',
    name: 'set_post_processing',
    description: 'Control bloom and sharpen post-processing toggles and intensities.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        bloom: {
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean' },
            intensityPct: { type: 'number', description: '0-200 (UI percent).' },
          },
        },
        sharpen: {
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean' },
            intensityPct: { type: 'number', description: '0-100 (UI percent).' },
          },
        },
      },
    },
  },
  {
    type: 'function',
    name: 'control_scene',
    description: 'Cinematic scene playback: list scenes, play one scene by name, stop, advance, or read status. Play starts a single named scene and returns immediately.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'play', 'stop', 'next', 'status'] },
        sceneId: { type: 'string', description: 'Scene id or (partial) title for play.' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'control_cctv',
    description: 'CCTV camera operations: enable/disable the layer, select a camera by name, next/prev/nearest/focus, toggle coverage wedges / projection overlay / auto-hop, "viewshed" for color-coded per-camera coverage volumes, and "adjust" for the on-camera calibration gizmo.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['enable', 'disable', 'select', 'next', 'prev', 'nearest', 'focus', 'coverage', 'viewshed', 'adjust', 'projection', 'autohop'] },
        cameraQuery: { type: 'string', description: 'Camera name or id for select.' },
        enabled: { type: 'boolean', description: 'Explicit on/off for coverage/viewshed/adjust/projection/autohop; omit to toggle.' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'control_radio',
    description: 'Control Internet Radio playback without moving the map. Use select whenever the request includes a station category, name, country, coordinates, or nearby place—even when the user says play. Use play only for an unqualified "turn on/start the radio" request so the current or nearest station begins. Enable only reveals the Radio layer/markers without audio. Also supports disable, resume, pause, stop, next/previous, volume, and status.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['enable', 'disable', 'play', 'resume', 'pause', 'stop', 'next', 'previous', 'volume', 'select', 'status'],
          description: 'Use select for any request qualified by category, station, country, coordinates, or place. Use play only for an unqualified turn on/start/listen request. Use enable only when the user explicitly asks to show or enable the Radio layer or its markers without requesting audio.',
        },
        volumePct: { type: 'number', minimum: 0, maximum: 100, description: 'Required for volume; sets the persistent Radio playback volume.' },
        category: {
          type: 'string',
          enum: ['all', 'news', 'talk', 'weather', 'public-safety', 'aviation-marine', 'traffic-transit', 'music'],
          description: 'Station category for select/next/previous. When the user requests playback with a category, action must be select, not play.',
        },
        locationId: {
          type: 'string',
          enum: ['austin', 'sf', 'nyc', 'tokyo', 'london', 'paris', 'dubai', 'dc'],
          description: 'Known nearby-city anchor for select.',
        },
        locationQuery: { type: 'string', maxLength: 120, description: 'Place to search near, such as "Austin, Texas" or "Seattle". Selection does not fly the camera.' },
        latitude: { type: 'number', minimum: -90, maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
        country: { type: 'string', maxLength: 80, description: 'Country code or name filter, for example US or United States.' },
        stationQuery: { type: 'string', maxLength: 120, description: 'Optional station name/tag substring.' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'track_entity',
    description: 'Find and follow a specific aircraft (callsign/ICAO hex), ship (name/MMSI), or satellite (name/NORAD id) on enabled layers. Camera follows the entity.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Callsign, ship name, satellite name, ICAO hex, MMSI, or NORAD id.' },
        layerId: { type: 'string', description: 'Optional layer hint: flights | military | ais-live-vessels | satellites.' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'stop_tracking',
    description: 'Stop following the tracked aircraft/satellite and clear any selected vessel.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'frame_overhead',
    description: 'Cinematically frame entities near the current view: pulls the camera back and angles it so nearby aircraft, ships, or satellites are visible together.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: { type: 'string', enum: ['flights', 'military', 'satellites', 'vessels'] },
        radiusKm: { type: 'number', description: 'Search radius around the view target. Defaults: 150 aircraft, 120 ships, 3000 satellites.' },
      },
      required: ['target'],
    },
  },
  {
    type: 'function',
    name: 'annotate_map',
    description: "Draw annotations on the 3D map to visually point out what you are talking about — like sketching on a whiteboard over the world. Use this whenever you mention a specific place, building, campus, boundary, district, or a relationship between two places, so the user can SEE what you mean. Give place NAMES (preferred) or explicit lat/lng; the app resolves them to real-world positions and real building/area outlines — never guess pixel positions. Call this as you begin describing something, and you may mark several places in one call.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        annotations: {
          type: 'array',
          description: 'One or more things to mark. Mark multiple related places together when describing them as a group.',
          minItems: 1,
          maxItems: 24,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: {
                type: 'string',
                enum: ['pin', 'highlight', 'area', 'arrow', 'route', 'label'],
                description: 'pin = planted marker at a spot; highlight = pulsing ring drawing the eye to a point; area = trace the outline of a building/campus/compound/district; arrow = a connector from one place to another (use target as the origin and toTarget as the destination); route = a path through several waypoints (use the points array); label = a floating text callout.',
              },
              target: { type: 'string', maxLength: 200, description: 'Place name to resolve, e.g. "Palace of Fine Arts, San Francisco", "the Pentagon", "Presidio of San Francisco". Preferred over coordinates. For a specific monument/statue/feature that sits within a larger landmark, use its OWN name + city ("Tejano Monument, Austin", "Texas African American History Memorial, Austin") — do NOT phrase it as "X at the Texas State Capitol", which makes the geocoder collapse several of them onto the same centroid so they stack on one spot.' },
              points: {
                type: 'array',
                description: 'For type=route: 2+ ordered waypoints the path passes through, each a place name (or coordinates / screen point).',
                minItems: 2,
                maxItems: 12,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    target: { type: 'string', maxLength: 200, description: 'Waypoint place name.' },
                    latitude: { type: 'number', minimum: -90, maximum: 90 },
                    longitude: { type: 'number', minimum: -180, maximum: 180 },
                    screenX: { type: 'number', minimum: 0, maximum: 1 },
                    screenY: { type: 'number', minimum: 0, maximum: 1 },
                  },
                },
              },
              mode: {
                type: 'string',
                enum: ['walking', 'driving', 'cycling'],
                description: 'For type=route: travel mode for a real street-following route (the app returns distance + time). Pick from the verb the user used ("walk" → walking, "drive" → driving). Defaults to walking.',
              },
              latitude: { type: 'number', minimum: -90, maximum: 90, description: 'Explicit latitude (use only if no good place name exists).' },
              longitude: { type: 'number', minimum: -180, maximum: 180 },
              toTarget: { type: 'string', maxLength: 200, description: 'For type=arrow: the destination place name.' },
              toLatitude: { type: 'number', minimum: -90, maximum: 90 },
              toLongitude: { type: 'number', minimum: -180, maximum: 180 },
              label: { type: 'string', maxLength: 120, description: 'Short caption shown on the map (a few words). Optional.' },
              color: {
                type: 'string',
                enum: ['primary', 'amber', 'cyan', 'green', 'red'],
                description: 'Accent color. primary = neutral, amber = point of interest, cyan = infrastructure, green = confirmed/safe, red = alert.',
              },
              footprint: { type: 'boolean', description: 'For type=area/highlight: trace the real building or campus outline from map data. Defaults true for area.' },
              intent: { type: 'string', enum: ['the_thing', 'around_the_thing'], description: 'For type=area: "the_thing" (default) outlines the place itself (its footprint/boundary); "around_the_thing" highlights a surrounding zone (a buffered radius around it). Infer from phrasing: "the Capitol"/"show me X" → the_thing; "around/near/by X" or "the area around X" → around_the_thing.' },
              entityKind: { type: 'string', enum: ['building', 'compound', 'district', 'street', 'point_feature'], description: 'What KIND of thing the target IS — a fact, not a style choice: building = one structure; compound = campus/grounds/mall/park; district = neighborhood or area of a city; street = a named road/corridor; point_feature = monument/statue/memorial/plaque/fountain or other small point landmark. Set it whenever you know it — it routes the resolver to the right footprint source (point_feature anchors monuments as precise points instead of adopting a nearby building outline).' },
              screenX: { type: 'number', minimum: 0, maximum: 1, description: 'Fallback only: when you cannot name/geocode the place but can SEE it in the latest viewport screenshot, the normalized horizontal position (0=left, 1=right) of the spot. The app converts it back to a real world point under that pixel.' },
              screenY: { type: 'number', minimum: 0, maximum: 1, description: 'Fallback only: normalized vertical position (0=top, 1=bottom) of the spot in the latest viewport screenshot.' },
              toScreenX: { type: 'number', minimum: 0, maximum: 1, description: 'For type=arrow: normalized x of the arrow destination from the screenshot (pixel fallback).' },
              toScreenY: { type: 'number', minimum: 0, maximum: 1, description: 'For type=arrow: normalized y of the arrow destination from the screenshot (pixel fallback).' },
            },
            required: ['type'],
          },
        },
        flyTo: { type: 'boolean', description: 'Also move the camera to frame the first annotation. Default false — leave false if the user is already looking at the spot.' },
        persist: { type: 'boolean', description: 'Keep annotations until cleared (true, default) or let them auto-fade after ~20s (false).' },
      },
      required: ['annotations'],
    },
  },
  {
    type: 'function',
    name: 'clear_annotations',
    description: 'Erase ALL map annotations previously drawn with annotate_map. Call this ONLY when the user EXPLICITLY asks to clear or reset the map. Annotations accumulate and persist across navigation and topic changes by design — never clear on your own initiative.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'move_camera',
    description: 'Direct the camera like a drone operator: orbit the current view target, pan, tilt, or rotate — one bounded nudge (mode=once) or continuous motion until stopped (mode=continuous). Continuous motion also stops on any manual camera input or when a navigation tool runs. Say the RESULTING state when confirming ("Orbiting slowly").',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        motion: { type: 'string', enum: ['orbit', 'pan', 'tilt', 'rotate', 'stop'] },
        direction: { type: 'string', enum: ['left', 'right', 'up', 'down'], description: 'Required except for orbit (defaults right/clockwise) and stop.' },
        speed: { type: 'string', enum: ['slow', 'normal', 'fast'] },
        mode: { type: 'string', enum: ['once', 'continuous'], description: 'once = bounded eased nudge (default); continuous = until stop/manual input.' },
      },
      required: ['motion'],
    },
  },
  {
    type: 'function',
    name: 'fly_route',
    description: 'Cinematic dolly along an EXISTING route annotation (drawn earlier with annotate_map type=route) — flies the street-following path from start to end. Omit label for the newest route. If no route is drawn, this fails with guidance: draw the route first.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string', description: 'Match an existing route mark by (partial) label.' },
        speed: { type: 'string', enum: ['slow', 'normal', 'fast'] },
      },
    },
  },
  {
    type: 'function',
    name: 'analyst_query',
    description: 'Answer questions ABOUT the data currently loaded on the map — counts, lists, superlatives, and attribute filters over live layers (flights, military, ships, fires, earthquakes). Examples: "how many flights over Texas", "biggest fire near LA", "which ships are headed to Oakland", "anything above 40,000 feet", "fastest thing in view". Queries ONLY client-side data from ENABLED layers — if the needed layer is off, say so and offer to enable it. For a follow-up about the previous answer\'s set ("which of those is closest?"), set followUp=true and send only the new filters/sort.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        layers: {
          type: 'array',
          items: { type: 'string', enum: ['flights', 'military', 'ais-live-vessels', 'local-firms', 'earthquakes'] },
          description: 'Layers to query. fires/wildfires → local-firms; ships/vessels → ais-live-vessels.',
        },
        scope: {
          type: 'object',
          additionalProperties: false,
          description: 'Spatial scope. Default: view (near the camera). Use kind=region for "over Texas"-style asks; kind=anywhere for global questions.',
          properties: {
            kind: { type: 'string', enum: ['view', 'region', 'radius', 'anywhere'] },
            name: { type: 'string', description: 'For kind=region: a state/country ("Texas", "France") or a named natural region ("the Alps", "Gulf of Mexico").' },
            km: { type: 'number', description: 'For kind=radius.' },
            center: { type: 'object', additionalProperties: false, properties: { lat: { type: 'number' }, lon: { type: 'number' } } },
          },
        },
        filters: {
          type: 'array',
          description: 'Attribute predicates, ANDed. ALTITUDE IS METERS (40,000 ft = 12192). Fields: altitudeM, speedMps, military, onGround, aircraftClass, callsign, operator, routeOrigin, routeDestination, originCountry (flights); speedKts, shipType, destination (ships); frp, confidence (fires); magnitude, depthKm, place (earthquakes).',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              field: { type: 'string' },
              op: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'contains'] },
              value: {},
            },
            required: ['field', 'op', 'value'],
          },
        },
        sortBy: { type: 'string', description: 'Field to rank by, or "distance" for nearest-first.' },
        sortDir: { type: 'string', enum: ['asc', 'desc'] },
        limit: { type: 'number' },
        followUp: { type: 'boolean', description: 'true = re-query the PREVIOUS result set instead of fresh data.' },
      },
    },
  },
  {
    type: 'function',
    name: 'next_iss_pass',
    description: "When the user asks when the ISS / the space station will next fly over: returns the next visible ISS pass for the current camera location (or an explicit lat/lon) — rise time (ISO + minutes from now), rise compass direction, peak elevation, and duration. Requires the satellites layer to have loaded its catalog at least once this session; if it hasn't, tell the user to enable the satellites layer and try again.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        latitude: { type: 'number', minimum: -90, maximum: 90, description: 'Optional observer latitude. Omit to use the current camera position.' },
        longitude: { type: 'number', minimum: -180, maximum: 180, description: 'Optional observer longitude. Omit to use the current camera position.' },
        minElevationDeg: { type: 'number', minimum: 5, maximum: 60, description: 'Minimum peak elevation (deg) to count as a pass. Default 10.' },
      },
    },
  },
];

/**
 * Load the `ws` constructor once.
 *
 * Node's built-in WebSocket cannot be used here: it has no terminate(), and
 * its close() waits forever for a close frame a black-holed peer never sends
 * (verified in src/data/aisWatchdogTransport.test.mjs). A socket parked in
 * CLOSING keeps holding AISStream's single per-key connection, which is how
 * the reverted watchdog wedged.
 *
 * Loaded lazily rather than imported at the top of this file so a missing
 * optional dependency degrades the vessel feed honestly instead of breaking
 * the whole dev server and build.
 *
 * @returns {Function|null}
 */
function aisWebSocketImpl() {
  if (_aisWebSocketImpl !== undefined) return _aisWebSocketImpl;
  try {
    _aisWebSocketImpl = createRequire(import.meta.url)('ws');
  } catch (error) {
    _aisWebSocketImpl = null;
    console.warn('[AISStream] `ws` is unavailable; the live vessel feed is off.', error?.message || '');
  }
  return _aisWebSocketImpl;
}

/**
 * Resolve the watchdog policy from the environment, once.
 *
 * Read lazily because module evaluation happens before Vite's loadEnv() copies
 * .env into process.env — the reverted watchdog read these at import time and
 * silently ignored every .env value, including its own kill switch.
 *
 * A custom subscription (one harbor, one message type) can be legitimately
 * silent for minutes, so the silence watch only self-arms for the default
 * worldwide subscription. An operator with a narrow filter opts back in by
 * setting AISSTREAM_SILENCE_TIMEOUT_MS to a value sized for that filter; 0 is
 * an explicit kill switch.
 */
function aisWatchdogPolicy() {
  if (_aisWatchdogPolicy) return _aisWatchdogPolicy;
  const customSubscription = Boolean(
    process.env.AISSTREAM_BOUNDING_BOXES || process.env.AISSTREAM_MESSAGE_TYPES,
  );
  const override = parseSilenceTimeoutEnv(
    process.env.AISSTREAM_SILENCE_TIMEOUT_MS,
    (message) => console.warn(message),
  );
  const reportMs = override.kind === 'timeout' ? override.value : AISSTREAM_SILENCE_REPORT_MS;
  _aisWatchdogPolicy = {
    silenceWatch: override.kind === 'off' ? false : (override.kind === 'timeout' || !customSubscription),
    reportMs,
    recycleMs: Math.round(reportMs * AISSTREAM_RECYCLE_RATIO),
    // Overridable so the watchdog can be exercised end-to-end against a local
    // stand-in upstream without opening a connection to AISStream (which
    // allows only one per key).
    url: process.env.AISSTREAM_URL || AISSTREAM_URL,
  };
  return _aisWatchdogPolicy;
}

/**
 * The transport adapter, built on first use and kept for the module lifetime.
 *
 * Never rebuilt: it owns the socket-generation namespace, and a restarted
 * namespace would let a pre-disposal handler act on its successor's socket.
 */
function aisAdapter() {
  if (_aisAdapter) return _aisAdapter;
  _aisAdapter = createAisStreamAdapter({
    createSocket: (url) => {
      const WebSocketCtor = aisWebSocketImpl();
      if (!WebSocketCtor) throw new Error('ws transport unavailable');
      return new WebSocketCtor(url);
    },
    resolveUrl: () => aisWatchdogPolicy().url,
    buildSubscription: aisStreamSubscription,
    ingestEnvelope: ingestAisStreamEnvelope,
    warn: (message) => console.warn(message),
  });
  _aisAdapter.setWatchdogOptions(aisWatchdogBudgets());
  return _aisAdapter;
}

/** Watchdog budgets derived from the resolved environment policy. */
function aisWatchdogBudgets() {
  const policy = aisWatchdogPolicy();
  return {
    staleMs: policy.reportMs,
    recycleAfterMs: policy.recycleMs,
    backoffMs: [...AISSTREAM_BACKOFF_MS],
    downRetryMs: AISSTREAM_DOWN_RETRY_MS,
    authProbeMs: AISSTREAM_AUTH_PROBE_MS,
  };
}

/**
 * Fingerprint the credential so a key change can clear the terminal
 * auth-failed state. Only a truncated digest is kept — never the key.
 */
function aisKeyFingerprint() {
  const key = process.env.AISSTREAM_API_KEY;
  if (!key) return null;
  return createHash('sha256').update(String(key)).digest('hex').slice(0, 12);
}

/**
 * Drive the watchdog once. Called on every /api/ais-live request and on the
 * background interval, so recovery does not depend on browser traffic.
 */
function ensureAisStreamConnection() {
  const adapter = aisAdapter();
  if (_aisNeedsRearm) {
    // Post-dispose re-arm, now that the restarted server's .env is loaded. The
    // adapter keeps its generation namespace across this.
    _aisNeedsRearm = false;
    adapter.setWatchdogOptions(aisWatchdogBudgets());
  }
  const policy = aisWatchdogPolicy();
  adapter.ensure({
    hasKey: Boolean(process.env.AISSTREAM_API_KEY),
    hasTransport: Boolean(aisWebSocketImpl()),
    silenceWatch: policy.silenceWatch,
    keyFingerprint: aisKeyFingerprint(),
  });
}
/** Status metadata for /api/ais-live, safe to call before the first connect. */
function aisStreamStatusSnapshot() {
  const snapshot = _aisAdapter ? _aisAdapter.snapshot() : null;
  if (snapshot) return snapshot;
  return {
    status: process.env.AISSTREAM_API_KEY ? 'idle' : 'missing-key',
    error: process.env.AISSTREAM_API_KEY ? null : 'AISSTREAM_API_KEY is not set',
    lastMessageAt: null,
    silentForMs: null,
    reconnectAttempt: 0,
    nextAttemptAt: null,
    watchdog: 'armed',
    staleAfterMs: AISSTREAM_SILENCE_REPORT_MS,
  };
}

/**
 * Start the background watchdog tick. Unref'd so it never holds the dev server
 * open, and idempotent so a Vite in-process restart cannot stack intervals.
 */
function startAisStreamWatchdogTick() {
  if (_aisStreamTickTimer) return;
  _aisStreamTickTimer = setInterval(() => {
    try {
      ensureAisStreamConnection();
    } catch (error) {
      console.warn('[AISStream] watchdog tick failed', error?.message || '');
    }
  }, AISSTREAM_TICK_MS);
  _aisStreamTickTimer.unref?.();
}

/**
 * Tear down every timer and socket this module owns.
 *
 * Vite restarts the dev server in-process on a config change while module
 * state survives, so without this each reload stacked another interval and
 * another reconnect chain. The cached policy is dropped too, so a restart
 * re-reads .env.
 *
 * The adapter instance itself is deliberately KEPT: it owns the socket
 * generation namespace, which must stay monotonic across restarts so a
 * pre-disposal handler can never collide with a post-disposal socket.
 */
function disposeAisStream() {
  if (_aisStreamTickTimer) {
    clearInterval(_aisStreamTickTimer);
    _aisStreamTickTimer = null;
  }
  if (_aisAdapter) _aisAdapter.dispose();
  // Drop the cached policy and re-arm LAZILY. Re-deriving budgets here would
  // read process.env before the restarted server's loadEnv() has repopulated
  // it, caching the outgoing configuration; the next ensure() runs after that.
  _aisWatchdogPolicy = null;
  _aisNeedsRearm = true;
}

function aisStreamSubscription() {
  return {
    APIKey: process.env.AISSTREAM_API_KEY,
    BoundingBoxes: parseJsonEnv('AISSTREAM_BOUNDING_BOXES', AISSTREAM_DEFAULT_BBOXES),
    FilterMessageTypes: parseCsvOrJsonEnv('AISSTREAM_MESSAGE_TYPES', AISSTREAM_DEFAULT_MESSAGE_TYPES),
  };
}

/**
 * Store one parsed AIS envelope.
 *
 * The return value is the feed's ONLY liveness proof, so it is true strictly
 * when the envelope carried a real AIS record. Malformed frames and error
 * envelopes never reach here — the adapter classifies those — and a JSON
 * object without an MMSI proves nothing about the feed.
 *
 * @param {Object} envelope Parsed, non-error AIS envelope.
 * @returns {boolean} True when an AIS record was recognised.
 */
function ingestAisStreamEnvelope(envelope) {
  // Single shared recognition rule (also used by the adapter's tests), so the
  // liveness predicate that ships is the one under test. An envelope carrying
  // only an MMSI is not proof the feed works.
  if (!isRecognizedAisEnvelope(envelope)) return false;

  const messageType = envelope?.MessageType;
  const message = envelope?.Message?.[messageType] || {};
  const metadata = envelope?.MetaData || envelope?.Metadata || {};
  const mmsi = stringValue(metadata.MMSI ?? message.UserID ?? message.UserId ?? message.Mmsi);
  if (!mmsi) return false;

  if (messageType === 'ShipStaticData' || messageType === 'StaticDataReport') {
    const staticData = {
      name: vesselNameFromAis(metadata, message, _aisStreamStatic.get(mmsi)),
      type: vesselTypeFromAis(message, _aisStreamStatic.get(mmsi)),
      destination: stringValue(message.Destination),
      imo: stringValue(message.ImoNumber ?? message.IMO),
    };
    _aisStreamStatic.set(mmsi, staticData);
    mergeAisStaticIntoLiveVessel(mmsi, staticData);
  }

  const lat = numberValue(metadata.latitude ?? metadata.Latitude ?? message.Latitude);
  const lon = numberValue(metadata.longitude ?? metadata.Longitude ?? message.Longitude);
  // A positionless but well-formed record (static data) is still the feed
  // delivering AIS traffic, so it counts as liveness.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return true;

  const staticData = _aisStreamStatic.get(mmsi) || {};
  _aisStreamVessels.set(mmsi, {
    lat,
    lon,
    name: vesselNameFromAis(metadata, message, staticData) || `MMSI ${mmsi}`,
    mmsi,
    imo: stringValue(message.ImoNumber ?? message.IMO ?? staticData.imo),
    type: vesselTypeFromAis(message, staticData),
    destination: stringValue(message.Destination ?? staticData.destination),
    speed: numberValue(message.Sog ?? message.SOG),
    course: numberValue(message.Cog ?? message.COG),
    heading: normalizedHeading(message.TrueHeading ?? message.Heading),
    last_position_UTC: normalizeAisTimestamp(metadata.time_utc ?? metadata.TimeUtc),
    // Use the AIS message's own report time, not server ingest wall-clock —
    // trail spacing and dead reckoning depend on true fix epochs.
    last_position_epoch: aisEpochSeconds(metadata.time_utc ?? metadata.TimeUtc),
    _updatedAt: Date.now(),
  });

  appendAisTrackSample(mmsi, lat, lon, aisEpochSeconds(metadata.time_utc ?? metadata.TimeUtc));

  pruneAisStreamCache();
  return true;
}

/**
 * Parses an AISStream UTC timestamp into epoch seconds (fallback: now).
 */
function aisEpochSeconds(value) {
  const ms = Date.parse(normalizeAisTimestamp(value));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

/**
 * Appends a thinned position sample to a vessel's track ring buffer.
 * Buffers allocate lazily on the second fix (most MMSIs are seen once);
 * samples are kept only when >=AIS_TRACK_MIN_GAP_SEC and
 * >=AIS_TRACK_MIN_MOVE_M from the previous stored sample, so anchored
 * vessels collapse to a single point.
 */
function appendAisTrackSample(mmsi, lat, lon, epochSec) {
  let track = _aisStreamTracks.get(mmsi);
  if (!track) {
    const pending = _aisStreamTrackPending.get(mmsi);
    if (!pending) {
      _aisStreamTrackPending.set(mmsi, { lat, lon, epochSec });
      return;
    }
    if (epochSec - pending.epochSec < AIS_TRACK_MIN_GAP_SEC) return;
    if (approxMetersBetween(pending.lat, pending.lon, lat, lon) < AIS_TRACK_MIN_MOVE_M) return;
    track = {
      lats: new Float32Array(AIS_TRACK_SAMPLES),
      lons: new Float32Array(AIS_TRACK_SAMPLES),
      times: new Uint32Array(AIS_TRACK_SAMPLES),
      head: 0,
      len: 0,
    };
    _aisStreamTracks.set(mmsi, track);
    _aisStreamTrackPending.delete(mmsi);
    writeAisTrackSample(track, pending.lat, pending.lon, pending.epochSec);
    writeAisTrackSample(track, lat, lon, epochSec);
    return;
  }

  const lastIdx = (track.head - 1 + AIS_TRACK_SAMPLES) % AIS_TRACK_SAMPLES;
  const lastEpoch = track.times[lastIdx];
  if (epochSec - lastEpoch < AIS_TRACK_MIN_GAP_SEC) return;
  if (approxMetersBetween(track.lats[lastIdx], track.lons[lastIdx], lat, lon) < AIS_TRACK_MIN_MOVE_M) return;
  writeAisTrackSample(track, lat, lon, epochSec);
}

function writeAisTrackSample(track, lat, lon, epochSec) {
  track.lats[track.head] = lat;
  track.lons[track.head] = lon;
  track.times[track.head] = epochSec;
  track.head = (track.head + 1) % AIS_TRACK_SAMPLES;
  track.len = Math.min(track.len + 1, AIS_TRACK_SAMPLES);
}

/**
 * Reads a vessel's accumulated track in chronological order.
 * @returns {Array<{lat:number,lon:number,t:number}>}
 */
function readAisTrack(mmsi) {
  const track = _aisStreamTracks.get(mmsi);
  if (!track || !track.len) return [];
  const samples = [];
  const start = (track.head - track.len + AIS_TRACK_SAMPLES) % AIS_TRACK_SAMPLES;
  for (let i = 0; i < track.len; i++) {
    const idx = (start + i) % AIS_TRACK_SAMPLES;
    samples.push({ lat: track.lats[idx], lon: track.lons[idx], t: track.times[idx] });
  }
  return samples;
}

/** Equirectangular distance approximation — plenty for 25m thinning. */
function approxMetersBetween(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111320;
  const dLon = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

function mergeAisStaticIntoLiveVessel(mmsi, staticData) {
  const existing = _aisStreamVessels.get(mmsi);
  if (!existing) return;
  if (staticData.name && (!existing.name || existing.name === `MMSI ${mmsi}`)) existing.name = staticData.name;
  if (staticData.type && !existing.type) existing.type = staticData.type;
  if (staticData.destination && !existing.destination) existing.destination = staticData.destination;
  if (staticData.imo && !existing.imo) existing.imo = staticData.imo;
}

function vesselNameFromAis(metadata, message, staticData = {}) {
  return stringValue(
    metadata.ShipName
      ?? message.Name
      ?? message.ShipName
      ?? message.ReportA?.Name
      ?? staticData.name
  );
}

function vesselTypeFromAis(message, staticData = {}) {
  return stringValue(
    message.Type
      ?? message.ShipType
      ?? message.ReportB?.ShipType
      ?? staticData.type
  );
}

function aisStreamRows(maxRows) {
  const cutoff = Date.now() - AISSTREAM_STALE_MS;
  const rows = [];
  for (const row of _aisStreamVessels.values()) {
    if (row._updatedAt >= cutoff) rows.push(row);
  }
  rows.sort((a, b) => b._updatedAt - a._updatedAt);
  return rows.slice(0, maxRows).map(({ _updatedAt, ...row }) => row);
}

function pruneAisStreamCache() {
  const cutoff = Date.now() - AISSTREAM_STALE_MS;
  for (const [mmsi, row] of _aisStreamVessels) {
    if (row._updatedAt < cutoff) {
      _aisStreamVessels.delete(mmsi);
      _aisStreamTracks.delete(mmsi);
      _aisStreamTrackPending.delete(mmsi);
    }
  }
  // Pending single-fix entries for vessels never seen again must not leak
  const pendingCutoffSec = Math.floor(cutoff / 1000);
  for (const [mmsi, pending] of _aisStreamTrackPending) {
    if (pending.epochSec < pendingCutoffSec) _aisStreamTrackPending.delete(mmsi);
  }
  if (_aisStreamVessels.size <= AISSTREAM_CACHE_MAX) return;
  const ordered = [..._aisStreamVessels.entries()].sort((a, b) => a[1]._updatedAt - b[1]._updatedAt);
  for (const [mmsi] of ordered.slice(0, _aisStreamVessels.size - AISSTREAM_CACHE_MAX)) {
    _aisStreamVessels.delete(mmsi);
    _aisStreamTracks.delete(mmsi);
    _aisStreamTrackPending.delete(mmsi);
  }
}

function newestAisPositionAt(rows) {
  return rows[0]?.last_position_UTC || null;
}

// ---------------------------------------------------------------------------
// Military-installation context proxy
// ---------------------------------------------------------------------------
// This narrow endpoint deliberately does not expose arbitrary Overpass QL to
// the browser. It returns only allow-listed mapped context and rejects global,
// cross-dateline, or oversized requests before touching public OSM mirrors.
const MILITARY_INSTALLATION_CACHE_MS = 5 * 60_000;
const MILITARY_INSTALLATION_STALE_MS = 60 * 60_000;
const MILITARY_INSTALLATION_MAX_CACHE = 80;
const MILITARY_INSTALLATION_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
/**
 * Upstream element cap. A response that hits it exactly is SATURATED — Overpass
 * truncated, so off-viewport features from the snapped bbox may have crowded out
 * in-viewport ones. Callers re-ask for the exact viewport in that case.
 */
export const MILITARY_INSTALLATION_ELEMENT_CAP = 700;
/**
 * Disk-cache TTL for mapped installations (ms) — 30 days.
 *
 * Field test 2026-08-18: "search nearby sites" was slow because every look
 * around paid a live Overpass round trip, and the 5-minute in-memory tier died
 * with the dev server. Mapped military features change on a survey timescale,
 * not a session one, so a month-old answer is still the right answer — the same
 * reasoning the Overpass proxy already applies to admin boundaries.
 */
const MILITARY_INSTALLATION_DISK_TTL_MS = 30 * 86_400_000;
/** Disk-cache directory for mapped installation payloads. */
const MILITARY_INSTALLATION_DISK_DIR = path.join(process.cwd(), '.gev-cache', 'military-installations');
/**
 * Cache-key grid step in degrees (~5.5 km).
 *
 * The browser sends the raw view rectangle, so every pixel of pan minted a new
 * key and a new upstream query. Snapping the bbox OUTWARD onto a coarse grid
 * makes neighbouring viewports share one entry, and because the snap only ever
 * grows the box, the cached answer is always a superset of what was asked for.
 */
const MILITARY_INSTALLATION_BBOX_STEP_DEG = 0.05;
const _militaryInstallationCache = new Map();
const _militaryInstallationInFlight = new Map();

/**
 * Snap a request bbox outward onto the shared installation cache grid.
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {number} [stepDeg]
 * @returns {{south:number, west:number, north:number, east:number}}
 */
export function quantizeMilitaryInstallationBox(box, stepDeg = MILITARY_INSTALLATION_BBOX_STEP_DEG) {
  // Round the ratio first: 29.9999/0.05 lands a hair under an exact grid line
  // in binary floating point, which would otherwise snap a whole cell too far.
  const snap = (value, grow) => {
    const cells = Number((value / stepDeg).toFixed(9));
    return Number(((grow > 0 ? Math.ceil(cells) : Math.floor(cells)) * stepDeg).toFixed(6));
  };
  return {
    south: Math.max(-90, snap(box.south, -1)),
    west: Math.max(-180, snap(box.west, -1)),
    north: Math.min(90, snap(box.north, 1)),
    east: Math.min(180, snap(box.east, 1)),
  };
}

/**
 * Stable disk/memory cache key for an installation bbox.
 *
 * The key's precision must match the precision of the bounds the QUERY uses, or
 * two different queries collide on one entry. Snapped boxes live on a 0.05 deg
 * grid, so 3 decimals is exact for them; an `exact=1` request carries the raw
 * viewport at 5 decimals and must be keyed at 5, otherwise two nearby exact
 * viewports would share an answer and the second would be missing the edge
 * strip it just exposed.
 * @param {{south:number, west:number, north:number, east:number}} box
 * @param {number} [decimals]
 */
export function militaryInstallationCacheKey(box, decimals = 3) {
  return [box.south, box.west, box.north, box.east]
    .map((value) => value.toFixed(decimals))
    .join(',');
}

/**
 * Resolve the READ tiers for one installation request, in order: fresh memory,
 * then disk. Returns UPSTREAM when neither can answer.
 *
 * Disk is skipped while a request for this key is already in flight — the
 * caller joins that instead of paying a read. Exported so the tier ORDER is
 * testable against a real temp directory without a Vite server, mirroring
 * resolveOverpassPreflight.
 *
 * @param {object} options
 * @param {string} options.cacheKey
 * @param {Map<string, {payload: object, cachedAt: number}>} options.memoryCache
 * @param {Map<string, Promise>} options.inFlight
 * @param {() => Promise<?{payload: object, cachedAt: number}>} options.readDisk
 * @param {number} [options.now]
 * @param {number} [options.cacheMs]
 * @returns {Promise<{source: 'HIT'|'DISK'|'UPSTREAM', entry: ?object}>}
 */
export async function resolveMilitaryInstallationTier({
  cacheKey,
  memoryCache,
  inFlight,
  readDisk,
  now = Date.now(),
  cacheMs = MILITARY_INSTALLATION_CACHE_MS,
}) {
  const cached = memoryCache.get(cacheKey);
  if (cached && now - cached.cachedAt <= cacheMs) return { source: 'HIT', entry: cached };
  if (inFlight.has(cacheKey)) return { source: 'UPSTREAM', entry: null };
  const disk = await readDisk();
  return disk ? { source: 'DISK', entry: disk } : { source: 'UPSTREAM', entry: null };
}

/**
 * Bring a stored installation entry up to the current payload shape.
 *
 * Entries written before the saturation guard shipped carry no `saturated`
 * field, and the disk TTL is 30 DAYS — so without this a cached, truncated
 * 700-element snapped response would keep skipping the exact-viewport retry for
 * a month, quietly starving in-view sites. Saturation is DERIVED from the
 * element count rather than invalidating those entries, so warm caches survive
 * the upgrade.
 * @param {?{payload: object, cachedAt: number}} entry
 * @returns {?{payload: object, cachedAt: number}}
 */
export function migrateMilitaryInstallationEntry(entry) {
  if (!entry?.payload || typeof entry.payload.saturated === 'boolean') return entry;
  const elements = Array.isArray(entry.payload.elements) ? entry.payload.elements : [];
  return {
    ...entry,
    payload: {
      ...entry.payload,
      saturated: elements.length >= MILITARY_INSTALLATION_ELEMENT_CAP,
    },
  };
}

/** Whether a stored installation entry is still inside its TTL. */
export function militaryInstallationDiskFresh(
  entry,
  maxAgeMs = MILITARY_INSTALLATION_DISK_TTL_MS,
  now = Date.now(),
) {
  if (!entry || !Number.isFinite(entry.cachedAt) || !Array.isArray(entry.payload?.elements)) return false;
  return now - entry.cachedAt <= maxAgeMs;
}

/** Cache key -> stable disk-cache file path. */
export function militaryInstallationDiskPath(cacheKey, dir = MILITARY_INSTALLATION_DISK_DIR) {
  return path.join(dir, `${createHash('sha1').update(cacheKey).digest('hex')}.json`);
}

/**
 * Read a disk-cached installation entry. maxAgeMs Infinity = any age (the
 * serve-stale path when Overpass is down).
 * @returns {Promise<?{payload: object, cachedAt: number}>}
 */
export async function readMilitaryInstallationDisk(
  cacheKey,
  maxAgeMs,
  dir = MILITARY_INSTALLATION_DISK_DIR,
) {
  try {
    const entry = JSON.parse(await fsp.readFile(militaryInstallationDiskPath(cacheKey, dir), 'utf8'));
    if (!militaryInstallationDiskFresh(entry, maxAgeMs)) return null;
    return migrateMilitaryInstallationEntry(entry);
  } catch {
    return null;
  }
}

/**
 * Persist one installation payload ATOMICALLY: serialize to a temp sibling,
 * then rename over the target. A crash or a full disk mid-write leaves the
 * PREVIOUS entry intact — an in-place overwrite would shred the last-good copy
 * and take serve-stale down with it, exactly when it is needed most.
 * @returns {Promise<boolean>} Whether the entry landed.
 */
export async function writeMilitaryInstallationDisk(
  cacheKey,
  entry,
  dir = MILITARY_INSTALLATION_DISK_DIR,
) {
  const target = militaryInstallationDiskPath(cacheKey, dir);
  // Same directory, so the rename is atomic on POSIX rather than a cross-device copy.
  const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(temp, JSON.stringify(entry));
    await fsp.rename(temp, target);
    return true;
  } catch (err) {
    console.warn('[Installations Proxy] disk cache write failed:', err?.message || err);
    await fsp.rm(temp, { force: true }).catch(() => {});
    return false;
  }
}

export function validMilitaryInstallationBox(params) {
  const south = requiredFiniteQueryNumber(params, 'south');
  const west = requiredFiniteQueryNumber(params, 'west');
  const north = requiredFiniteQueryNumber(params, 'north');
  const east = requiredFiniteQueryNumber(params, 'east');
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) return null;
  if (north - south > 10 || east - west > 10) return null;
  return { south, west, north, east };
}

function trimMilitaryInstallationCache() {
  while (_militaryInstallationCache.size > MILITARY_INSTALLATION_MAX_CACHE) {
    const oldest = _militaryInstallationCache.keys().next().value;
    if (oldest === undefined) break;
    _militaryInstallationCache.delete(oldest);
  }
}

function militaryInstallationsProxy() {
  async function refresh(box, key) {
    const bbox = `${box.south},${box.west},${box.north},${box.east}`;
    const ql = `[out:json][timeout:20];(nwr["military"~"^(airfield|naval_base|range|barracks|base)$"](${bbox});nwr["landuse"="military"](${bbox}););out center tags geom ${MILITARY_INSTALLATION_ELEMENT_CAP};`;
    const upstream = await fetchOverpassPayload(
      `data=${encodeURIComponent(ql)}`,
      MILITARY_INSTALLATION_MAX_RESPONSE_BYTES,
    );
    if (upstream.status >= 400 || upstream.rateLimited || upstream.runtimeError) {
      throw new Error('Mapped installation upstream unavailable');
    }
    const parsed = JSON.parse(upstream.body);
    const elements = Array.isArray(parsed?.elements)
      ? parsed.elements.slice(0, MILITARY_INSTALLATION_ELEMENT_CAP)
      : [];
    const payload = {
      elements,
      // Honest truncation flag — the client re-asks for its exact viewport so
      // off-view features can never starve in-view ones. The cap travels with
      // the payload so the client never has to hard-code it.
      saturated: elements.length >= MILITARY_INSTALLATION_ELEMENT_CAP,
      elementCap: MILITARY_INSTALLATION_ELEMENT_CAP,
      retrievedAt: new Date().toISOString(),
      status: 'ready',
    };
    const entry = { payload, cachedAt: Date.now() };
    _militaryInstallationCache.set(key, entry);
    trimMilitaryInstallationCache();
    writeMilitaryInstallationDisk(key, entry);
    return payload;
  }

  function install(middlewares) {
    middlewares.use('/api/military-installations', async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }
      if (!_militaryInstallationsRateLimiter(clientKey(req))) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
        return;
      }
      const url = new URL(req.url, 'http://localhost');
      const requested = validMilitaryInstallationBox(url.searchParams);
      if (!requested) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'A non-dateline bbox no larger than 10 degrees is required' }));
        return;
      }
      // Query the SNAPPED box, not the raw viewport: neighbouring views then
      // share one cache entry, and an outward snap always covers what was asked.
      // `exact=1` opts out — the client sends it after a SATURATED snapped
      // response, so a truncated tile can never starve the actual viewport. It
      // is keyed separately so exact and snapped answers never collide.
      const exact = url.searchParams.get('exact') === '1';
      const box = exact ? requested : quantizeMilitaryInstallationBox(requested);
      // Key at the precision the query actually uses (see militaryInstallationCacheKey).
      const key = exact
        ? `exact:${militaryInstallationCacheKey(box, 5)}`
        : militaryInstallationCacheKey(box);
      const now = Date.now();
      const cached = _militaryInstallationCache.get(key);
      const preflight = await resolveMilitaryInstallationTier({
        cacheKey: key,
        memoryCache: _militaryInstallationCache,
        inFlight: _militaryInstallationInFlight,
        readDisk: () => readMilitaryInstallationDisk(key, MILITARY_INSTALLATION_DISK_TTL_MS),
        now,
      });
      if (preflight.source !== 'UPSTREAM') {
        if (preflight.source === 'DISK') {
          _militaryInstallationCache.set(key, preflight.entry);
          trimMilitaryInstallationCache();
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'X-Military-Installations': preflight.source });
        res.end(JSON.stringify({ ...preflight.entry.payload, status: 'cached' }));
        return;
      }
      const request = coalesceProxyRequest(
        _militaryInstallationInFlight,
        key,
        () => refresh(box, key),
      );
      try {
        const payload = await request.promise;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
          'X-Military-Installations': request.shared ? 'INFLIGHT' : 'MISS',
        });
        res.end(JSON.stringify(payload));
      } catch (error) {
        if (cached && now - cached.cachedAt <= MILITARY_INSTALLATION_STALE_MS) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Military-Installations': 'STALE' });
          res.end(JSON.stringify({ ...cached.payload, status: 'stale' }));
          return;
        }
        // Overpass is down: last-good mapped context at ANY age beats an empty
        // layer (the same serve-stale rule the Overpass proxy applies).
        const stale = await readMilitaryInstallationDisk(key, Infinity);
        if (stale) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Military-Installations': 'STALE-DISK' });
          res.end(JSON.stringify({ ...stale.payload, status: 'stale' }));
          return;
        }
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Mapped installation context is temporarily unavailable' }));
      }
    });
  }

  return {
    name: 'military-installations-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

// ---------------------------------------------------------------------------
// Regional cockpit briefing — Vite/Vercel catch-all forward to the shared handler
// ---------------------------------------------------------------------------
function regionalBriefProxy() {
  return {
    name: 'regional-brief-proxy',
    configureServer(server) {
      server.middlewares.use('/api/regional-brief', handleRegionalBrief);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/regional-brief', handleRegionalBrief);
    },
  };
}

function parseJsonEnv(key, fallback) {
  const value = process.env[key];
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    console.warn(`[AISStream] Invalid ${key}; using default.`);
    return fallback;
  }
}

function parseCsvOrJsonEnv(key, fallback) {
  const value = process.env[key];
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function stringValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function numberValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedHeading(value) {
  const heading = numberValue(value);
  return heading !== null && heading >= 0 && heading <= 360 ? heading : null;
}

function normalizeAisTimestamp(value) {
  const text = stringValue(value);
  if (!text) return new Date().toISOString();
  const normalized = text.replace(' +0000 UTC', 'Z').replace(' UTC', 'Z');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/**
 * Vite plugins that register Connect /api middlewares.
 * Billing stays on its own Vercel entrypoints; Cesium is Vite-only.
 */
export function createLiveApiPlugins() {
  return [
    openSkyProxy(),
    celestrakProxy(),
    tomtomProxy(),
    firmsProxy(),
    rocketLaunchesProxy(),
    terrainHeightsProxy(),
    adsbdbProxy(),
    overpassProxy(),
    militaryInstallationsProxy(),
    regionalBriefProxy(),
    weatherEffectsProxy(),
    cctvProxy(),
    radioBrowserProxy(),
    gbfsProxy(),
    adsbLolMilPlugin(),
    aisLiveProxy(),
    trackBackfillProxies(),
    openAiRealtimeProxy(),
    googlePlacesContextProxy(),
  ];
}
