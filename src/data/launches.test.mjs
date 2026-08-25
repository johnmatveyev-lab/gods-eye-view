import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LL2_CACHE_TTL_MS,
  LL2_UPSTREAM_URL,
  createLaunchesRuntime,
  defaultLaunchCachePath,
  handleLaunchesHttp,
  launchLibraryRequestHeaders,
  rocketLaunchesProxy,
} from './launches.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FRESH = { results: [{ id: 'll2-starlink', name: 'Starlink Group' }] };

function mockReq({ method = 'GET', url = '/api/launches', headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(name, value) { this.headers[name] = value; },
    end(chunk) {
      this.headersSent = true;
      this.body = chunk || '';
    },
  };
}

async function dispatch(runtime, options) {
  const req = mockReq(options);
  const res = mockRes();
  await handleLaunchesHttp(req, res, runtime);
  let json = null;
  if (res.body) {
    try { json = JSON.parse(res.body); } catch { json = null; }
  }
  return {
    status: res.statusCode,
    json,
    headers: res.headers,
    body: res.body,
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('Launch Library uses a 15-minute cache and optional server-side token header', () => {
  assert.equal(LL2_CACHE_TTL_MS, 15 * 60_000);
  assert.deepEqual(launchLibraryRequestHeaders(''), { Accept: 'application/json' });
  assert.deepEqual(launchLibraryRequestHeaders(' secret '), {
    Accept: 'application/json',
    Authorization: 'Token secret',
  });
});

test('hosted cache path is optional /tmp; local Vite keeps .gev-cache', () => {
  assert.equal(defaultLaunchCachePath({ VERCEL: '1' }), '/tmp/launch-library-2-v2.3.json');
  assert.match(defaultLaunchCachePath({}), /\.gev-cache[/\\]launch-library-2-v2\.3\.json$/);
});

test('GET /api/launches → 200 {results:[…]} and never NOT_FOUND', async () => {
  const runtime = createLaunchesRuntime({
    cachePath: null,
    fetchImpl: async () => jsonResponse(FRESH),
  });
  const { status, json, headers, body } = await dispatch(runtime);
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.results));
  assert.equal(json.results[0].id, 'll2-starlink');
  assert.notEqual(status, 404);
  assert.doesNotMatch(body, /NOT_FOUND|x-vercel-error/);
  assert.equal(headers['X-GEV-Cache'], 'MISS');
});

test('GET serves stale {results:[…]} when refresh fails, never NOT_FOUND', async () => {
  let now = 1_000_000;
  const runtime = createLaunchesRuntime({
    cachePath: null,
    now: () => now,
    ttlMs: 1_000,
    initialCache: { at: now, body: JSON.stringify(FRESH) },
    fetchImpl: async () => {
      throw new Error('Launch Library 2 unavailable');
    },
  });
  now += 5_000;
  const { status, json, headers, body } = await dispatch(runtime);
  assert.equal(status, 200);
  assert.deepEqual(json.results, FRESH.results);
  assert.equal(headers['X-GEV-Cache'], 'STALE-ERROR');
  assert.notEqual(status, 404);
  assert.doesNotMatch(body, /NOT_FOUND|x-vercel-error/);
});

test('POST /api/launches → 405', async () => {
  const runtime = createLaunchesRuntime({
    cachePath: null,
    fetchImpl: async () => {
      throw new Error('POST must not touch upstream');
    },
  });
  const { status, json } = await dispatch(runtime, { method: 'POST' });
  assert.equal(status, 405);
  assert.equal(json.error, 'Method Not Allowed');
  assert.notEqual(status, 404);
});

test('malformed upstream does not overwrite cache', async () => {
  let now = 1_000_000;
  let fetches = 0;
  const runtime = createLaunchesRuntime({
    cachePath: null,
    now: () => now,
    ttlMs: 1_000,
    fetchImpl: async () => {
      fetches += 1;
      if (fetches === 1) return jsonResponse(FRESH);
      return jsonResponse({ detail: 'not a launch list' });
    },
  });
  const first = await dispatch(runtime);
  assert.equal(first.status, 200);
  assert.deepEqual(first.json.results, FRESH.results);
  now += 5_000;
  const second = await dispatch(runtime);
  assert.equal(second.status, 200);
  assert.deepEqual(second.json.results, FRESH.results);
  assert.equal(second.headers['X-GEV-Cache'], 'STALE-ERROR');
  assert.equal(runtime.getCache().body, JSON.stringify(FRESH));
  assert.equal(fetches, 2);
});

test('upstream 404 without cache is 502, never NOT_FOUND', async () => {
  const runtime = createLaunchesRuntime({
    cachePath: null,
    fetchImpl: async () => new Response('missing', { status: 404 }),
  });
  const { status, body } = await dispatch(runtime);
  assert.equal(status, 502);
  assert.notEqual(status, 404);
  assert.doesNotMatch(body, /x-vercel-error|NOT_FOUND/);
});

test('Vercel api/launches.js forwards to handleLaunchesHttp', () => {
  const file = path.join(ROOT, 'api/launches.js');
  assert.equal(existsSync(file), true);
  const source = readFileSync(file, 'utf8');
  assert.match(source, /handleLaunchesHttp/);
  assert.match(source, /src\/data\/launches\.js/);
  assert.doesNotMatch(source, /ais-live|google\/text-search|opensky|news\.google|telegeography|quantum-earth/i);
  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(vercelJson.functions['api/launches.js']);
  assert.equal(vercelJson.functions['api/ais-live.js'], undefined);
  assert.equal(vercelJson.functions['api/google/text-search.js'], undefined);
  assert.equal(Array.isArray(vercelJson.rewrites), false);
});

test('handler stays Launch Library 2 only; existing credit and MIT line remain', () => {
  const source = readFileSync(path.join(ROOT, 'src/data/launches.js'), 'utf8');
  assert.match(source, /ll\.thespacedevs\.com/);
  assert.doesNotMatch(source, /ais-live|google\/text-search|opensky-network|news\.google|telegeography|quantum-earth/i);
  assert.match(
    readFileSync(path.join(ROOT, 'src/data/dataCredits.js'), 'utf8'),
    /key:\s*'launch-library-2'/,
  );
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(license, /MIT License/);
  const plugin = rocketLaunchesProxy();
  assert.equal(plugin.name, 'rocket-launches-proxy');
  assert.ok(LL2_UPSTREAM_URL.startsWith('https://ll.thespacedevs.com/'));
});
