import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createViteConfig from '../../vite.config.js';
import {
  CELESTRAK_TTL_MS,
  CELESTRAK_USER_AGENT,
  celestrakProxy,
  createCelestrakStore,
  createVercelCelestrakHandler,
  defaultCelestrakCacheDir,
  parseCelestrakGroupFromRequest,
  restoreCelestrakPath,
} from './celestrak.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const STATIONS_TLE = [
  'ISS (ZARYA)',
  '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927',
  '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537',
  '',
].join('\n');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(headers)) {
        this.headers[name.toLowerCase()] = value;
      }
    },
    end(chunk) {
      this.headersSent = true;
      this.body = chunk || '';
    },
  };
}

async function dispatch(handler, { url = '/', query } = {}) {
  const req = { method: 'GET', url, query, headers: {} };
  const res = mockRes();
  await handler(req, res);
  return res;
}

function assertNeverNotFound(res) {
  assert.notEqual(res.statusCode, 404);
  assert.notEqual(res.headers['x-vercel-error'], 'NOT_FOUND');
  assert.doesNotMatch(String(res.body), /NOT_FOUND/);
}

test('User-Agent is Meridian, not God\'s Eye View; TleStore credit stays', () => {
  assert.match(CELESTRAK_USER_AGENT, /Meridian-celestrak-proxy\/1\.0/);
  assert.match(CELESTRAK_USER_AGENT, /\+https:\/\/github\.com\/johnmatveyev-lab\/gods-eye-view/);
  assert.doesNotMatch(CELESTRAK_USER_AGENT, /God's Eye View/);
  assert.doesNotMatch(CELESTRAK_USER_AGENT, /gods-eye-view-celestrak-proxy/);
  const source = readFileSync(path.join(ROOT, 'src/data/celestrak.js'), 'utf8');
  assert.match(source, /skylight's TleStore \(MIT\)/);
});

test('GET /api/celestrak/stations → 200 text/plain TLE, x-tle-cache miss then hit', async () => {
  const seenAgents = [];
  const store = createCelestrakStore({
    cacheDir: null,
    now: () => 1_000_000,
    fetchImpl: async (_url, options) => {
      seenAgents.push(options.headers['User-Agent']);
      return new Response(STATIONS_TLE, { status: 200 });
    },
  });
  const handler = createVercelCelestrakHandler(() => store);

  const miss = await dispatch(handler, { url: '/api/celestrak/stations' });
  assert.equal(miss.statusCode, 200);
  assert.match(String(miss.headers['content-type']), /text\/plain/);
  assert.match(miss.body, /^1 /m);
  assert.match(String(miss.headers['x-tle-cache']), /miss/i);
  assertNeverNotFound(miss);
  assert.match(seenAgents[0], /Meridian/);
  assert.doesNotMatch(seenAgents[0], /God's Eye View/);

  const hit = await dispatch(handler, { url: '/stations' });
  assert.equal(hit.statusCode, 200);
  assert.match(hit.body, /^1 /m);
  assert.match(String(hit.headers['x-tle-cache']), /hit/i);
  assertNeverNotFound(hit);
  assert.equal(seenAgents.length, 1);
});

test('empty or error upstream keeps stale and never returns NOT_FOUND', async () => {
  let clock = 1_000_000;
  let mode = 'ok';
  const store = createCelestrakStore({
    cacheDir: null,
    ttlMs: CELESTRAK_TTL_MS,
    now: () => clock,
    fetchImpl: async () => {
      if (mode === 'ok') return new Response(STATIONS_TLE, { status: 200 });
      if (mode === 'empty') return new Response('No GP data found', { status: 200 });
      return new Response('upstream down', { status: 503 });
    },
  });
  const handler = createVercelCelestrakHandler(() => store);

  const miss = await dispatch(handler, { url: '/api/celestrak/stations' });
  assert.equal(miss.statusCode, 200);
  assert.match(String(miss.headers['x-tle-cache']), /miss/i);

  clock += CELESTRAK_TTL_MS + 1;
  mode = 'empty';
  const emptyStale = await dispatch(handler, { url: '/api/celestrak/stations' });
  assert.equal(emptyStale.statusCode, 200);
  assert.match(emptyStale.body, /^1 /m);
  assert.match(String(emptyStale.headers['x-tle-cache']), /stale/i);
  assertNeverNotFound(emptyStale);

  clock += CELESTRAK_TTL_MS + 1;
  mode = 'error';
  const errorStale = await dispatch(handler, { url: '/api/celestrak/stations' });
  assert.equal(errorStale.statusCode, 200);
  assert.equal(errorStale.body, STATIONS_TLE);
  assert.match(String(errorStale.headers['x-tle-cache']), /stale/i);
  assertNeverNotFound(errorStale);
});

test('GET /api/celestrak/../etc → 400 invalid group', async () => {
  const handler = createVercelCelestrakHandler(() => createCelestrakStore({
    cacheDir: null,
    fetchImpl: async () => {
      throw new Error('upstream must not run for an invalid group');
    },
  }));
  for (const url of ['/api/celestrak/../etc', '/../etc', '/api/celestrak/%2e%2e/etc']) {
    const res = await dispatch(handler, { url });
    assert.equal(res.statusCode, 400, url);
    assert.match(res.body, /invalid group/);
    assertNeverNotFound(res);
  }
  const fromQuery = await dispatch(handler, {
    url: '/api/celestrak',
    query: { group: ['..', 'etc'] },
  });
  assert.equal(fromQuery.statusCode, 400);
  assert.match(fromQuery.body, /invalid group/);
});

test('restoreCelestrakPath keeps leftover groups without a vercel.json rewrite', () => {
  assert.equal(restoreCelestrakPath('/stations'), '/api/celestrak/stations');
  assert.equal(restoreCelestrakPath('/api/celestrak/active'), '/api/celestrak/active');
  assert.equal(restoreCelestrakPath('/../etc'), '/api/celestrak/../etc');
  assert.equal(parseCelestrakGroupFromRequest({ url: '/api/celestrak/../etc' }), null);
  assert.equal(parseCelestrakGroupFromRequest({ url: '/stations' }), 'stations');
});

test('optional /tmp disk is used on Vercel; write failures still serve from memory', async () => {
  assert.equal(
    defaultCelestrakCacheDir({ env: { VERCEL: '1' } }),
    path.join('/tmp', 'meridian-celestrak'),
  );
  assert.equal(
    defaultCelestrakCacheDir({ env: {}, cwd: '/app' }),
    path.join('/app', '.gev-cache'),
  );

  const store = createCelestrakStore({
    cacheDir: '/tmp/meridian-celestrak',
    now: () => 2_000_000,
    fsImpl: {
      mkdir: async () => { throw new Error('read-only /tmp'); },
      readFile: async () => { throw new Error('missing'); },
      writeFile: async () => { throw new Error('read-only /tmp'); },
    },
    fetchImpl: async () => new Response(STATIONS_TLE, { status: 200 }),
  });
  const first = await store.resolve('stations');
  assert.equal(first.status, 200);
  assert.equal(first.cache, 'MISS');
  const second = await store.resolve('stations');
  assert.equal(second.cache, 'HIT');
});

test('Vite forwards to the extracted plugin; no ais-live/google/voice wrap', () => {
  const entry = path.join(ROOT, 'api/celestrak/[...group].js');
  assert.equal(existsSync(entry), true);
  const source = readFileSync(entry, 'utf8');
  assert.match(source, /from '\.\.\/\.\.\/src\/data\/celestrak\.js'/);
  assert.doesNotMatch(source, /export \{ GET, POST \}/);

  const live = readFileSync(path.join(ROOT, 'src/server/liveApiProxies.js'), 'utf8');
  assert.match(live, /from '\.\.\/data\/celestrak\.js'/);
  assert.doesNotMatch(live, /function celestrakProxy\(/);
  assert.doesNotMatch(live, /gods-eye-view-celestrak-proxy/);

  const config = createViteConfig({ mode: 'test' });
  const byName = new Map(config.plugins.map((plugin) => [plugin.name, plugin]));
  assert.equal(typeof byName.get('celestrak-proxy')?.configureServer, 'function');
  assert.equal(typeof celestrakProxy().configurePreviewServer, 'function');

  for (const forbidden of [
    'api/ais-live.js',
    'api/ais-live/[...path].js',
    'api/google/text-search.js',
    'api/google/[...path].js',
    'api/realtime/token.js',
    'api/voice/[...path].js',
  ]) {
    assert.equal(existsSync(path.join(ROOT, forbidden)), false, forbidden);
  }

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(vercelJson.framework, 'vite');
  assert.ok(vercelJson.functions['api/celestrak/[...group].js']);
  assert.ok(vercelJson.functions['api/billing/[...path].js']);
  assert.equal(Array.isArray(vercelJson.rewrites), false);
  const functionKeys = Object.keys(vercelJson.functions);
  assert.equal(functionKeys.some((key) => (
    /ais-live/.test(key)
    || /google\/text-search/.test(key)
    || /google\/\[\.\.\.path\]/.test(key)
    || /voice/.test(key)
    || /realtime/.test(key)
  )), false);
});
