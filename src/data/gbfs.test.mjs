import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GBFS_ALLOWED_HOSTS,
  GBFS_PROXY_USER_AGENT,
  createGbfsHandler,
  createVercelGbfsHandler,
  gbfsCacheControl,
  gbfsProxy,
  isAllowedGbfsHost,
  isAllowedGbfsPath,
  restoreGbfsApiPath,
} from './gbfs.js';
import { createLiveApiPlugins } from '../server/liveApiProxies.js';
import liveApiHandler from '../server/vercelLiveApi.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ALLOWED_STATUS = 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json';
const STATION_PAYLOAD = JSON.stringify({
  last_updated: 1,
  ttl: 10,
  data: { stations: [{ station_id: '1', num_bikes_available: 3 }] },
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

async function dispatch(handler, options) {
  const req = mockReq(options);
  const res = mockRes();
  await handler(req, res);
  let json = null;
  if (typeof res.body === 'string' && res.body) {
    try { json = JSON.parse(res.body); } catch { json = null; }
  }
  return { status: res.statusCode, json, body: res.body, headers: res.headers, req };
}

function mockUpstream(calls, { status = 200, body = STATION_PAYLOAD } = {}) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

test('dedicated Vercel entry forwards to src/data/gbfs.js without a Next rewrite', () => {
  const entry = path.join(ROOT, 'api/gbfs/[...target].js');
  assert.equal(existsSync(entry), true);
  const source = readFileSync(entry, 'utf8');
  assert.match(source, /from ['"]\.\.\/\.\.\/src\/data\/gbfs\.js['"]/);
  assert.doesNotMatch(source, /export \{ GET, POST \}/);
  assert.doesNotMatch(source, /from ['"]next/);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(vercelJson.functions['api/gbfs/[...target].js']);
  assert.equal(Array.isArray(vercelJson.rewrites), false);

  const plugin = gbfsProxy();
  assert.equal(plugin.name, 'gbfs-proxy');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.ok(createLiveApiPlugins().some((item) => item.name === 'gbfs-proxy'));
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
  assert.equal(isAllowedGbfsHost('evil.example.com'), false);
  assert.equal(isAllowedGbfsHost('opensky-network.org'), false);
  assert.equal(isAllowedGbfsPath('/gbfs/2.3/bkn/en/station_status.json'), true);
  assert.equal(isAllowedGbfsPath('/gbfs/2.3/bkn/en/station_information.json'), true);
  assert.equal(isAllowedGbfsPath('/gbfs/2.3/bkn/en/gbfs.json'), false);
  assert.equal(gbfsCacheControl('/en/station_information.json'), 'public, max-age=300');
  assert.equal(gbfsCacheControl('/en/station_status.json'), 'no-store');
  assert.equal(GBFS_PROXY_USER_AGENT, 'Meridian-gbfs-proxy/1.0');
});

test('GET /api/gbfs/ is 400 missing target', async () => {
  const calls = [];
  const handler = createVercelGbfsHandler({ fetchImpl: mockUpstream(calls) });
  const missing = await dispatch(handler, { url: '/api/gbfs/' });
  assert.equal(missing.status, 400);
  assert.match(missing.json.error, /Missing GBFS upstream target/i);
  assert.equal(calls.length, 0);

  const leftover = await dispatch(handler, { url: '/' });
  assert.equal(leftover.status, 400);
  assert.equal(leftover.json.error, 'Missing GBFS upstream target');
});

test('http and disallowed hosts are 400 / 403 and never fetched', async () => {
  const calls = [];
  const handler = createVercelGbfsHandler({ fetchImpl: mockUpstream(calls) });

  const http = await dispatch(handler, {
    url: `/api/gbfs/${encodeURIComponent('http://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json')}`,
  });
  assert.equal(http.status, 400);
  assert.match(http.json.error, /https/i);

  const disallowed = await dispatch(handler, {
    url: `/api/gbfs/${encodeURIComponent('https://evil.example.com/station_status.json')}`,
  });
  assert.equal(disallowed.status, 403);
  assert.match(disallowed.json.error, /host not allowed/i);

  const opensky = await dispatch(handler, {
    url: `/api/gbfs/${encodeURIComponent('https://opensky-network.org/station_status.json')}`,
  });
  assert.equal(opensky.status, 403);

  const badPath = await dispatch(handler, {
    url: `/api/gbfs/${encodeURIComponent('https://gbfs.lyft.com/gbfs/2.3/bkn/en/gbfs.json')}`,
  });
  assert.equal(badPath.status, 400);
  assert.match(badPath.json.error, /station_information\/station_status/i);
  assert.equal(calls.length, 0);
});

test('allowed station_status is 200 and User-Agent is Meridian', async () => {
  const calls = [];
  const handler = createVercelGbfsHandler({ fetchImpl: mockUpstream(calls) });
  const { status, json, headers } = await dispatch(handler, {
    url: `/api/gbfs/${encodeURIComponent(ALLOWED_STATUS)}`,
  });
  assert.equal(status, 200);
  assert.equal(json.data.stations[0].station_id, '1');
  assert.equal(headers['X-GBFS-Upstream'], 'gbfs.lyft.com');
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ALLOWED_STATUS);
  assert.equal(calls[0].init.headers['User-Agent'], 'Meridian-gbfs-proxy/1.0');
  assert.doesNotMatch(calls[0].init.headers['User-Agent'], /gods-eye-view/i);
});

test('Vite-stripped leftover path and catch-all still reach the same handler', async () => {
  const calls = [];
  const handle = createGbfsHandler({ fetchImpl: mockUpstream(calls) });
  const stripped = await dispatch(handle, {
    url: `/${encodeURIComponent(ALLOWED_STATUS)}`,
  });
  assert.equal(stripped.status, 200);
  assert.equal(calls[0].init.headers['User-Agent'], GBFS_PROXY_USER_AGENT);

  const leftover = await dispatch(createVercelGbfsHandler({ fetchImpl: mockUpstream(calls) }), {
    url: `/${encodeURIComponent(ALLOWED_STATUS)}`,
  });
  assert.equal(leftover.status, 200);
  assert.equal(restoreGbfsApiPath(`/${encodeURIComponent(ALLOWED_STATUS)}`), `/api/gbfs/${encodeURIComponent(ALLOWED_STATUS)}`);
  assert.equal(restoreGbfsApiPath('/'), '/api/gbfs/');

  const catchAll = await dispatch(liveApiHandler, { url: '/api/gbfs/' });
  assert.equal(catchAll.status, 400);
  assert.match(catchAll.json.error, /Missing GBFS upstream target/i);
});

test('GBFS module stays GBFS-only and does not rebrand the MIT project', () => {
  const source = readFileSync(path.join(ROOT, 'src/data/gbfs.js'), 'utf8');
  assert.doesNotMatch(source, /opensky-network\.org|news\.google\.com|telegeography|quantum-earth/i);
  assert.doesNotMatch(source, /gods-eye-view-gbfs-proxy/);
  assert.match(source, /Meridian-gbfs-proxy\/1\.0/);
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(license, /MERIDIAN NOTICE/);
});
