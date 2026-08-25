import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DAILY_TILE_BUDGET,
  createTomTomRuntime,
  createVercelTomTomHandler,
  restoreTomTomApiPath,
  tomtomProxy,
} from './tomtom.js';
import { decodeFlowTile } from './flowTiles.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FIXTURE = path.join(ROOT, 'src/data/fixtures/tomtom-flow-austin-12-935-1686.pbf');
const FIXTURE_BYTES = 22_980;
const SECRET = 'ttk_unit_test_secret_xyz';
const FIXED_NOW = Date.parse('2026-08-25T12:00:00.000Z');

function loadFixture() {
  return readFileSync(FIXTURE);
}

function mockReq({ method = 'GET', url = '/', headers = {}, query } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  if (query) req.query = query;
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
      this.body = chunk ?? '';
    },
  };
}

function runtime(overrides = {}) {
  return createTomTomRuntime({
    env: { TOMTOM_API_KEY: SECRET, ...overrides.env },
    now: () => overrides.now ?? FIXED_NOW,
    cacheDir: null,
    fetchImpl: overrides.fetchImpl ?? (async () => {
      throw new Error('fetch should not be called');
    }),
    ...overrides,
  });
}

async function dispatch(rt, options) {
  const handler = createVercelTomTomHandler(() => rt);
  const req = mockReq(options);
  const res = mockRes();
  await handler(req, res);
  const isJson = String(res.headers['Content-Type'] || '').includes('json');
  return {
    status: res.statusCode,
    headers: res.headers,
    body: res.body,
    json: isJson && res.body ? JSON.parse(String(res.body)) : null,
  };
}

function assertNoSecrets(payload) {
  const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
  assert.doesNotMatch(text, new RegExp(SECRET));
  assert.doesNotMatch(text, /api\.tomtom\.com/i);
  assert.doesNotMatch(text, /NOT_FOUND/);
  assert.doesNotMatch(text, /x-vercel-error/);
}

test('Vercel Node entry forwards to handleTomTomHttp; ais-live is not wrapped', () => {
  const file = path.join(ROOT, 'api/tomtom/[...path].js');
  assert.equal(existsSync(file), true);
  const source = readFileSync(file, 'utf8');
  assert.match(source, /from '\.\.\/\.\.\/src\/data\/tomtom\.js'/);
  assert.doesNotMatch(source, /export \{ GET, POST \}/);
  assert.doesNotMatch(source, /TOMTOM_API_KEY|api\.tomtom\.com/);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(vercelJson.framework, 'vite');
  assert.ok(vercelJson.functions['api/tomtom/[...path].js']);
  assert.ok(Array.isArray(vercelJson.rewrites));
  assert.ok(vercelJson.rewrites.some((rule) => (
    rule.source === '/api/tomtom/flow/:z/:x/:y.pbf'
    && rule.destination === '/api/tomtom/flow/:z/:x/:y'
  )));
  assert.doesNotMatch(JSON.stringify(vercelJson), /index\.html/);
  assert.doesNotMatch(JSON.stringify(vercelJson.rewrites || []), /ais-live/i);

  assert.equal(existsSync(path.join(ROOT, 'api/ais-live.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live/[...path].js')), false);
  assert.equal(typeof tomtomProxy().configureServer, 'function');
  assert.equal(typeof tomtomProxy().configurePreviewServer, 'function');
});

test('GET /api/tomtom/status → 200 {hasKey, dailyCount, budget, date}, never NOT_FOUND', async () => {
  const keyed = await dispatch(runtime(), { url: '/api/tomtom/status' });
  assert.equal(keyed.status, 200);
  assert.deepEqual(keyed.json, {
    hasKey: true,
    dailyCount: 0,
    budget: DEFAULT_DAILY_TILE_BUDGET,
    date: '2026-08-25',
  });
  assertNoSecrets(JSON.stringify(keyed.json));

  const leftover = await dispatch(runtime({ env: {} }), { url: '/status' });
  assert.equal(leftover.status, 200);
  assert.equal(leftover.json.hasKey, false);
  assert.equal(leftover.json.dailyCount, 0);
  assert.equal(leftover.json.budget, DEFAULT_DAILY_TILE_BUDGET);
  assert.equal(leftover.json.date, '2026-08-25');
  assert.notEqual(leftover.status, 404);
  assertNoSecrets(JSON.stringify(leftover.json));
});

test('GET /api/tomtom/flow/6/18/25.pbf without key → 503 {error:no_key}, no TomTom request', async () => {
  const calls = [];
  const rt = runtime({
    env: {},
    fetchImpl: async (url) => {
      calls.push(String(url));
      throw new Error('should not fetch');
    },
  });
  const res = await dispatch(rt, { url: '/api/tomtom/flow/6/18/25.pbf' });
  assert.equal(res.status, 503);
  assert.deepEqual(res.json, { error: 'no_key' });
  const stripped = await dispatch(rt, { url: '/api/tomtom/flow/6/18/25' });
  assert.equal(stripped.status, 503);
  assert.deepEqual(stripped.json, { error: 'no_key' });
  assert.equal(calls.length, 0);
  assertNoSecrets(JSON.stringify(res.json));
});

test('with key: 200 protobuf from fixture; cache hit does not recount budget', async () => {
  const fixture = loadFixture();
  const calls = [];
  const rt = runtime({
    fetchImpl: async (url) => {
      calls.push(String(url));
      assert.match(url, /12\/935\/1686\.pbf/);
      assert.match(url, new RegExp(SECRET));
      return new Response(fixture, { status: 200 });
    },
  });

  const miss = await dispatch(rt, { url: '/api/tomtom/flow/12/935/1686.pbf' });
  assert.equal(miss.status, 200);
  assert.equal(miss.headers['Content-Type'], 'application/x-protobuf');
  assert.equal(miss.headers['x-tomtom-cache'], 'MISS');
  assert.ok(Buffer.isBuffer(miss.body) || miss.body instanceof Uint8Array);
  assert.equal(Buffer.from(miss.body).equals(fixture), true);
  assert.equal(calls.length, 1);
  assertNoSecrets(miss.headers['x-tomtom-cache']);

  const hit = await dispatch(rt, { url: '/api/tomtom/flow/12/935/1686.pbf' });
  assert.equal(hit.status, 200);
  assert.equal(hit.headers['x-tomtom-cache'], 'HIT');
  assert.equal(calls.length, 1, 'fresh cache must not hit TomTom again');
  assert.equal(rt.getBudget().count, 1);

  const status = await dispatch(rt, { url: '/api/tomtom/status' });
  assert.equal(status.json.dailyCount, 1);
  assertNoSecrets(JSON.stringify(status.json));
});

test('upstream failure serves stale protobuf; JSON errors never echo key or URL', async () => {
  const fixture = loadFixture();
  let clock = FIXED_NOW;
  let fail = false;
  const rt = runtime({
    now: () => clock,
    fetchImpl: async (url) => {
      if (fail) {
        throw new Error(`fetch failed ${url}`);
      }
      return new Response(fixture, { status: 200 });
    },
  });

  const first = await dispatch(rt, { url: '/api/tomtom/flow/12/935/1686.pbf' });
  assert.equal(first.status, 200);

  clock += 121_000;
  fail = true;
  const stale = await dispatch(rt, { url: '/api/tomtom/flow/12/935/1686.pbf' });
  assert.equal(stale.status, 200);
  assert.equal(stale.headers['x-tomtom-cache'], 'STALE-ERROR');
  assert.equal(Buffer.from(stale.body).equals(fixture), true);

  const dead = await dispatch(rt, { url: '/api/tomtom/flow/12/1000/1600.pbf' });
  assert.equal(dead.status, 502);
  assert.deepEqual(dead.json, { error: 'upstream' });
  assertNoSecrets(JSON.stringify(dead.json));
});

test('over budget → stale or 429 {error:budget}', async () => {
  const fixture = loadFixture();
  const rt = runtime({
    env: { TOMTOM_API_KEY: SECRET, TOMTOM_DAILY_TILE_BUDGET: '1' },
    fetchImpl: async () => new Response(fixture, { status: 200 }),
  });

  const first = await dispatch(rt, { url: '/api/tomtom/flow/12/935/1686.pbf' });
  assert.equal(first.status, 200);
  assert.equal(rt.getBudget().count, 1);

  rt.seedTile('12/935/1686', fixture, FIXED_NOW - 200_000);
  const stale = await dispatch(rt, { url: '/api/tomtom/flow/12/935/1686.pbf' });
  assert.equal(stale.status, 200);
  assert.equal(stale.headers['x-tomtom-cache'], 'STALE-BUDGET');
  assert.equal(Buffer.from(stale.body).equals(fixture), true);

  const blocked = await dispatch(rt, { url: '/api/tomtom/flow/12/1000/1600.pbf' });
  assert.equal(blocked.status, 429);
  assert.deepEqual(blocked.json, { error: 'budget' });
  assertNoSecrets(JSON.stringify(blocked.json));
  assert.equal(rt.getBudget().count, 1, 'blocked fetch must not increment the counter');
});

test('fixture decode uses only the committed 23KB Austin tile', () => {
  const buf = loadFixture();
  assert.equal(buf.length, FIXTURE_BYTES);
  const segments = decodeFlowTile(buf, 12, 935, 1686);
  assert.ok(segments.length > 50);
  assert.ok(segments.some((s) => s.trafficLevel < 1));
});

test('restoreTomTomApiPath does not require a vercel.json rewrite', () => {
  assert.equal(restoreTomTomApiPath('/status'), '/api/tomtom/status');
  assert.equal(restoreTomTomApiPath('/flow/6/18/25.pbf'), '/api/tomtom/flow/6/18/25.pbf');
  assert.equal(restoreTomTomApiPath('/api/tomtom/status'), '/api/tomtom/status');
});
