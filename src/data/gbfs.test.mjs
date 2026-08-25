import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import gbfsHandler, {
  GBFS_ALLOWED_HOSTS,
  GBFS_USER_AGENT,
  createVercelGbfsHandler,
  gbfsProxy,
  handleGbfsHttp,
  isAllowedGbfsHost,
  isAllowedGbfsPath,
  restoreGbfsPath,
} from './gbfs.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const STATUS_URL = 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json';
const STATUS_PAYLOAD = Object.freeze({
  last_updated: 1_777_000_000,
  ttl: 60,
  data: { stations: [{ station_id: '1', num_bikes_available: 4 }] },
});

function mockReq({ method = 'GET', url = '/', headers = {} } = {}) {
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
    writableEnded: false,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headersSent = true;
      for (const [name, value] of Object.entries(headers || {})) {
        this.headers[name] = value;
      }
    },
    end(chunk) {
      this.headersSent = true;
      this.writableEnded = true;
      if (chunk !== undefined && chunk !== null) this.body = chunk;
    },
  };
}

async function dispatch(url, options = {}) {
  const { method = 'GET', fetchImpl, handler } = options;
  const req = mockReq({ method, url });
  const res = mockRes();
  if (handler) {
    await handler(req, res);
  } else {
    await handleGbfsHttp(req, res, fetchImpl ? { fetchImpl } : {});
  }
  let json = null;
  if (typeof res.body === 'string' && res.body) {
    try { json = JSON.parse(res.body); } catch { json = null; }
  }
  return { status: res.statusCode, json, body: res.body, headers: res.headers, req };
}

function gbfsUrl(target) {
  return `/api/gbfs/${encodeURIComponent(target)}`;
}

function failFetch() {
  return async () => {
    throw new Error('upstream fetch must not run');
  };
}

test('Vercel Node entry forwards to handleGbfsHttp without a Next rewrite', () => {
  const entry = path.join(ROOT, 'api/gbfs/[...target].js');
  assert.equal(existsSync(entry), true);
  const source = readFileSync(entry, 'utf8');
  assert.match(source, /from '\.\.\/\.\.\/src\/data\/gbfs\.js'/);
  assert.doesNotMatch(source, /export \{ GET, POST \}/);
  assert.doesNotMatch(source, /from ['"]next/);

  const vite = readFileSync(path.join(ROOT, 'src/server/liveApiProxies.js'), 'utf8');
  assert.match(vite, /from '\.\.\/data\/gbfs\.js'/);
  assert.doesNotMatch(vite, /gods-eye-view-gbfs-proxy/);
  assert.doesNotMatch(vite, /function gbfsProxy\(/);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(vercelJson.framework, 'vite');
  assert.ok(vercelJson.functions['api/gbfs/[...target].js']);
  assert.equal(Array.isArray(vercelJson.rewrites), false);
  assert.doesNotMatch(JSON.stringify(vercelJson), /index\.html/);
});

test('host and path allowlists stay exact; no arbitrary hosts', () => {
  assert.deepEqual([...GBFS_ALLOWED_HOSTS], [
    'gbfs.lyft.com',
    'gbfs.bluebikes.com',
    'gbfs.bcycle.com',
    'gbfs.biketownpdx.com',
    'gbfs.cogobikeshare.com',
    'austin.publicbikesystem.net',
    'hon.publicbikesystem.net',
    'chat.publicbikesystem.net',
  ]);
  assert.equal(isAllowedGbfsHost('gbfs.lyft.com'), true);
  assert.equal(isAllowedGbfsHost('nyc.publicbikesystem.net'), true);
  assert.equal(isAllowedGbfsHost('example.com'), false);
  assert.equal(isAllowedGbfsHost('opensky-network.org'), false);
  assert.equal(isAllowedGbfsPath('/gbfs/2.3/bkn/en/station_status.json'), true);
  assert.equal(isAllowedGbfsPath('/gbfs/2.3/bkn/en/gbfs.json'), false);
  assert.equal(GBFS_USER_AGENT, 'Meridian-gbfs-proxy/1.0');
});

test('GET /api/gbfs/ is 400 missing target', async () => {
  const missing = await dispatch('/api/gbfs/');
  assert.equal(missing.status, 400);
  assert.equal(missing.json.error, 'Missing GBFS upstream target');

  const leftover = await dispatch('/');
  assert.equal(leftover.status, 400);
  assert.equal(leftover.json.error, 'Missing GBFS upstream target');
});

test('http and disallowed hosts are 400/403 and never fetch', async () => {
  const http = await dispatch(gbfsUrl('http://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json'), {
    fetchImpl: failFetch(),
  });
  assert.equal(http.status, 400);
  assert.equal(http.json.error, 'Only https GBFS targets are allowed');

  const disallowed = await dispatch(gbfsUrl('https://example.com/station_status.json'), {
    fetchImpl: failFetch(),
  });
  assert.equal(disallowed.status, 403);
  assert.equal(disallowed.json.error, 'GBFS host not allowed');
});

test('allowed station_status is 200 and UA is Meridian', async () => {
  let observed = null;
  const { status, json, headers } = await dispatch(gbfsUrl(STATUS_URL), {
    fetchImpl: async (url, init) => {
      observed = { url, init };
      return new Response(JSON.stringify(STATUS_PAYLOAD), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  assert.equal(status, 200);
  assert.deepEqual(json, STATUS_PAYLOAD);
  assert.equal(headers['X-GBFS-Upstream'], 'gbfs.lyft.com');
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(observed.url, STATUS_URL);
  assert.equal(observed.init.headers['User-Agent'], 'Meridian-gbfs-proxy/1.0');
  assert.match(observed.init.headers['User-Agent'], /Meridian/);
  assert.doesNotMatch(observed.init.headers['User-Agent'], /gods-eye-view/i);
});

test('Vercel leftover encoded target still reaches handleGbfsHttp', async () => {
  const handler = createVercelGbfsHandler({
    fetchImpl: async () => new Response(JSON.stringify(STATUS_PAYLOAD), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  const leftover = `/${encodeURIComponent(STATUS_URL)}`;
  assert.equal(restoreGbfsPath(leftover), gbfsUrl(STATUS_URL));
  const { status, json, req } = await dispatch(leftover, { handler });
  assert.equal(req.url, gbfsUrl(STATUS_URL));
  assert.equal(status, 200);
  assert.deepEqual(json, STATUS_PAYLOAD);
  assert.equal(typeof gbfsHandler, 'function');
});

test('Vite plugin still mounts /api/gbfs', () => {
  const plugin = gbfsProxy();
  assert.equal(plugin.name, 'gbfs-proxy');
  let mounted = null;
  plugin.configureServer({
    middlewares: {
      use(pathOrFn, maybeFn) {
        mounted = { path: pathOrFn, fn: maybeFn };
      },
    },
  });
  assert.equal(mounted.path, '/api/gbfs');
  assert.equal(typeof mounted.fn, 'function');
});

test('GBFS module stays GBFS-only and does not rebrand legal sources', () => {
  const source = readFileSync(path.join(ROOT, 'src/data/gbfs.js'), 'utf8');
  assert.doesNotMatch(source, /opensky-network\.org|news\.google\.com|telegeography|quantum-earth/i);
  assert.doesNotMatch(source, /gods-eye-view-gbfs-proxy/);
  assert.match(source, /Meridian-gbfs-proxy\/1\.0/);
});
