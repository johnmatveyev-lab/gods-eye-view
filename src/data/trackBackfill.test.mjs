import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createViteConfig from '../../vite.config.js';
import liveApiHandler from '../server/vercelLiveApi.js';
import { createLiveApiPlugins } from '../server/liveApiProxies.js';
import {
  ADSB_LOL_TRACE_FETCH_ERROR,
  ADSB_LOL_TRACE_HEX_ERROR,
  OPENSKY_TRACK_DISABLED_ERROR,
  adsblolTraceUrl,
  createAdsblolTraceHandler,
  handleOpenskyTrack,
  isValidTraceHex,
  normalizeTraceHex,
  parseTraceHexFromRequest,
  trackBackfillProxies,
} from './trackBackfill.js';
import adsblolTraceHandler from '../../api/adsblol/trace.js';
import openskyTrackHandler from '../../api/opensky-track.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) { this.headers[name] = value; },
    end(chunk) {
      this.headersSent = true;
      this.writableEnded = true;
      this.body = chunk === undefined || chunk === null ? '' : String(chunk);
    },
  };
}

async function dispatch(handler, { url = '/', query, method = 'GET' } = {}) {
  const req = { method, url, query, headers: {} };
  const res = mockRes();
  await handler(req, res);
  let json = null;
  if (res.body) {
    try { json = JSON.parse(res.body); } catch { json = null; }
  }
  return { status: res.statusCode, json, body: res.body, headers: res.headers };
}

function assertNeverPlatform404(res) {
  assert.notEqual(res.status, 404);
  assert.doesNotMatch(String(res.body), /x-vercel-error|NOT_FOUND/);
  assert.notEqual(res.headers['x-vercel-error'], 'NOT_FOUND');
}

test('bad hex is 400 and never a platform 404', async () => {
  const fetchImpl = async () => {
    throw new Error('upstream must not run for an invalid hex');
  };
  const handler = createAdsblolTraceHandler({ fetchImpl, cache: { get() { return null; }, put() {} } });

  for (const url of [
    '/api/adsblol/trace',
    '/api/adsblol/trace?',
    '/api/adsblol/trace?hex=',
    '/api/adsblol/trace?hex=ab',
    '/api/adsblol/trace?hex=zzzzzz',
    '/api/adsblol/trace?hex=abc12345',
    '/?hex=nope',
  ]) {
    const res = await dispatch(handler, { url });
    assert.equal(res.status, 400, url);
    assert.equal(res.json.error, ADSB_LOL_TRACE_HEX_ERROR);
    assert.match(res.body, /hex must be a 6-7 char/);
    assertNeverPlatform404(res);
  }

  const fromQuery = await dispatch(handler, {
    url: '/api/adsblol/trace',
    query: { hex: '12' },
  });
  assert.equal(fromQuery.status, 400);
  assert.equal(fromQuery.json.error, ADSB_LOL_TRACE_HEX_ERROR);
  assertNeverPlatform404(fromQuery);
});

test('GET /api/adsblol/trace?hex=abc123 → 200 JSON or 502 from handler', async () => {
  const payload = { timestamp: 1_700_000_000, trace: [[0, 30.1, -97.7, 12000]] };
  const seen = [];
  const okHandler = createAdsblolTraceHandler({
    fetchImpl: async (url) => {
      seen.push(String(url));
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const ok = await dispatch(okHandler, { url: '/api/adsblol/trace?hex=abc123' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, payload);
  assert.equal(seen[0], 'https://adsb.lol/data/traces/23/trace_full_abc123.json');
  assertNeverPlatform404(ok);

  const failHandler = createAdsblolTraceHandler({
    fetchImpl: async () => {
      throw new Error('upstream down');
    },
  });
  const fail = await dispatch(failHandler, { url: '/api/adsblol/trace?hex=abc123' });
  assert.equal(fail.status, 502);
  assert.equal(fail.json.error, ADSB_LOL_TRACE_FETCH_ERROR);
  assertNeverPlatform404(fail);
});

test('GET /api/opensky-track → 410 JSON; zero requests to opensky-network.org', async () => {
  const seen = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    throw new Error(`illegal fetch ${url}`);
  };
  try {
    const res = await dispatch(handleOpenskyTrack, {
      url: '/api/opensky-track?icao24=abc123',
    });
    assert.equal(res.status, 410);
    assert.equal(res.json.error, OPENSKY_TRACK_DISABLED_ERROR);
    assert.match(res.body, /disabled in this commercial build/);
    assert.equal(seen.length, 0);
    assert.equal(seen.some((url) => url.includes('opensky-network.org')), false);
    assertNeverPlatform404(res);

    const hosted = await dispatch(openskyTrackHandler, { url: '/api/opensky-track' });
    assert.equal(hosted.status, 410);
    assert.equal(hosted.json.error, OPENSKY_TRACK_DISABLED_ERROR);
    assert.equal(seen.length, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('OpenSky URL is never built; only valid adsb.lol traces get a URL', () => {
  assert.equal(adsblolTraceUrl('abc123'), 'https://adsb.lol/data/traces/23/trace_full_abc123.json');
  assert.equal(adsblolTraceUrl('abcdefa'), 'https://adsb.lol/data/traces/fa/trace_full_abcdefa.json');
  assert.equal(adsblolTraceUrl('ab~def'), 'https://adsb.lol/data/traces/ef/trace_full_ab~def.json');
  assert.equal(adsblolTraceUrl(''), null);
  assert.equal(adsblolTraceUrl('abc'), null);
  assert.equal(adsblolTraceUrl('zzzzzz'), null);
  assert.equal(isValidTraceHex(normalizeTraceHex('ABC123')), true);
  assert.equal(parseTraceHexFromRequest({ url: '/api/adsblol/trace?hex=abc123' }), 'abc123');
  assert.equal(parseTraceHexFromRequest({ url: '/api/opensky-track?icao24=abc123' }), null);

  const moduleSource = readFileSync(path.join(ROOT, 'src/data/trackBackfill.js'), 'utf8');
  assert.doesNotMatch(moduleSource, /opensky-network\.org/);
  assert.doesNotMatch(moduleSource, /auth\.opensky-network\.org/);
  assert.doesNotMatch(moduleSource, /function\s+\w*opensky\w*Url/i);
  assert.doesNotMatch(moduleSource, /https:\/\/[^\n]*opensky/i);
  assert.doesNotMatch(moduleSource, /process\.env\.OPENSKY_|OPENSKY_USERNAME|OPENSKY_PASSWORD|OPENSKY_CLIENT|OPENSKY_AUTH/);
  assert.match(moduleSource, /adsb\.lol\/data\/traces/);
});

test('hosted Node entrypoints forward; ais-live stays unwrapped', () => {
  assert.equal(existsSync(path.join(ROOT, 'api/adsblol/trace.js')), true);
  assert.equal(existsSync(path.join(ROOT, 'api/opensky-track.js')), true);

  const traceEntry = readFileSync(path.join(ROOT, 'api/adsblol/trace.js'), 'utf8');
  assert.ok(traceEntry.includes("from '../../src/data/trackBackfill.js'"));
  assert.doesNotMatch(traceEntry, /export \{ GET, POST \}/);

  const openskyEntry = readFileSync(path.join(ROOT, 'api/opensky-track.js'), 'utf8');
  assert.match(openskyEntry, /handleOpenskyTrack/);
  assert.ok(openskyEntry.includes("from '../src/data/trackBackfill.js'"));
  assert.doesNotMatch(openskyEntry, /opensky-network\.org/);

  for (const forbidden of [
    'api/ais-live.js',
    'api/ais-live/[...path].js',
    'api/google/[...path].js',
  ]) {
    assert.equal(existsSync(path.join(ROOT, forbidden)), false, forbidden);
  }

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(vercelJson.framework, 'vite');
  assert.ok(vercelJson.functions['api/adsblol/trace.js']);
  assert.ok(vercelJson.functions['api/opensky-track.js']);
  for (const rule of vercelJson.rewrites || []) {
    assert.match(rule.source, /^\/api\/tomtom\//);
    assert.match(rule.destination, /^\/api\/tomtom\//);
  }
  const functionKeys = Object.keys(vercelJson.functions);
  assert.equal(functionKeys.some((key) => /ais-live/.test(key)), false);
});

test('Vite and the live catch-all forward to the extracted plugin', async () => {
  const viteSource = readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
  assert.match(viteSource, /createLiveApiPlugins/);
  assert.doesNotMatch(viteSource, /function trackBackfillProxies/);
  assert.doesNotMatch(viteSource, /trace_full_/);

  const proxies = readFileSync(path.join(ROOT, 'src/server/liveApiProxies.js'), 'utf8');
  assert.ok(proxies.includes("from '../data/trackBackfill.js'"));
  assert.match(proxies, /trackBackfillProxies/);
  assert.doesNotMatch(proxies, /function trackBackfillProxies/);
  assert.doesNotMatch(proxies, /trace_full_/);

  const config = createViteConfig({ mode: 'test' });
  const byName = new Map(config.plugins.map((plugin) => [plugin.name, plugin]));
  assert.equal(typeof byName.get('track-backfill-proxies')?.configureServer, 'function');
  assert.equal(typeof trackBackfillProxies().configurePreviewServer, 'function');
  assert.ok(createLiveApiPlugins().some((plugin) => plugin.name === 'track-backfill-proxies'));

  const missing = await dispatch(adsblolTraceHandler, { url: '/api/adsblol/trace' });
  assert.equal(missing.status, 400);
  assert.equal(missing.json.error, ADSB_LOL_TRACE_HEX_ERROR);
  assertNeverPlatform404(missing);

  const leftover = await dispatch(liveApiHandler, { url: '/adsblol/trace' });
  assert.equal(leftover.status, 400);
  assert.equal(leftover.json.error, ADSB_LOL_TRACE_HEX_ERROR);
  assertNeverPlatform404(leftover);

  const opensky = await dispatch(liveApiHandler, { url: '/opensky-track' });
  assert.equal(opensky.status, 410);
  assert.equal(opensky.json.error, OPENSKY_TRACK_DISABLED_ERROR);
});
