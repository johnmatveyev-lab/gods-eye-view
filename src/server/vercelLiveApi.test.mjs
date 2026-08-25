import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import liveApiHandler, { restoreLiveApiPath } from './vercelLiveApi.js';
import { createLiveApiPlugins } from './liveApiProxies.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const LIVE_PLUGIN_NAMES = Object.freeze([
  'opensky-proxy',
  'celestrak-proxy',
  'tomtom-proxy',
  'firms-proxy',
  'rocket-launches-proxy',
  'terrain-heights-proxy',
  'adsbdb-proxy',
  'overpass-proxy',
  'military-installations-proxy',
  'regional-brief-proxy',
  'weather-effects-proxy',
  'cctv-proxy',
  'radio-browser-proxy',
  'gbfs-proxy',
  'adsblol-proxy',
  'ais-live-proxy',
  'track-backfill-proxies',
  'openai-realtime-proxy',
  'google-places-context-proxy',
]);

function mockReq({ method = 'GET', url = '/', headers = {}, body = '' } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.rawBody = typeof body === 'string' ? body : JSON.stringify(body);
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

test('Vercel live catch-all reuses Node proxies without a Next rewrite', () => {
  const entry = path.join(ROOT, 'api/[...path].js');
  assert.equal(existsSync(entry), true);
  const source = readFileSync(entry, 'utf8');
  assert.match(source, /vercelLiveApi\.js/);
  assert.doesNotMatch(source, /export \{ GET, POST \}/);
  assert.doesNotMatch(source, /from ['"]next/);
  assert.doesNotMatch(source, /vite-plugin-cesium|from ['"]vite['"]/);

  const adapter = readFileSync(path.join(ROOT, 'src/server/vercelLiveApi.js'), 'utf8');
  assert.doesNotMatch(adapter, /from ['"]vite['"]|vite-plugin-cesium/);
  assert.doesNotMatch(adapter, /opensky-network\.org|news\.google\.com|telegeography/i);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(vercelJson.framework, 'vite');
  assert.ok(vercelJson.functions['api/[...path].js']);
  assert.ok(vercelJson.functions['api/billing/[...path].js']);
  assert.ok(vercelJson.functions['api/gbfs/[...target].js']);
  assert.ok(vercelJson.functions['api/adsblol/mil.js']);
  assert.equal(Array.isArray(vercelJson.rewrites), false);
  assert.doesNotMatch(JSON.stringify(vercelJson), /index\.html/);
});

test('createLiveApiPlugins registers every live Vite /api proxy', () => {
  const names = createLiveApiPlugins().map((plugin) => plugin.name);
  assert.deepEqual(names, [...LIVE_PLUGIN_NAMES]);
  assert.ok(!names.includes('meridian-billing'));
});

test('restoreLiveApiPath does not require a vercel.json rewrite', () => {
  assert.equal(restoreLiveApiPath('/realtime/token'), '/api/realtime/token');
  assert.equal(restoreLiveApiPath('/cctv/sources'), '/api/cctv/sources');
  assert.equal(restoreLiveApiPath('/tomtom/status'), '/api/tomtom/status');
  assert.equal(restoreLiveApiPath('/api/radio/stations'), '/api/radio/stations');
  assert.equal(restoreLiveApiPath('/adsblol/mil'), '/api/adsblol/mil');
  assert.equal(restoreLiveApiPath('/openai/hud-summary'), '/api/openai/hud-summary');
});

test('GET /api/tomtom/status reaches the existing TomTom handler', async () => {
  const leftover = await dispatch(liveApiHandler, { url: '/tomtom/status' });
  assert.equal(leftover.status, 200);
  assert.equal(typeof leftover.json.hasKey, 'boolean');
  assert.equal(typeof leftover.json.dailyCount, 'number');
  assert.doesNotMatch(JSON.stringify(leftover.json), /x-vercel-error|NOT_FOUND/);

  const full = await dispatch(liveApiHandler, { url: '/api/tomtom/status' });
  assert.equal(full.status, 200);
  assert.equal(typeof full.json.hasKey, 'boolean');
});

test('GET /api/realtime/token reaches the existing token handler', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const { status, json } = await dispatch(liveApiHandler, { url: '/api/realtime/token' });
    assert.equal(status, 503);
    assert.match(json.error, /OPENAI_API_KEY/);
    assert.notEqual(status, 404);
  } finally {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
  }
});

test('GET /api/radio/stations and unknown radio routes reach the radio handler', async () => {
  const unknown = await dispatch(liveApiHandler, { url: '/api/radio/not-a-route' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.error, 'Unknown radio route');
  assert.doesNotMatch(JSON.stringify(unknown.json), /x-vercel-error|NOT_FOUND/);

  const method = await dispatch(liveApiHandler, {
    method: 'POST',
    url: '/api/radio/stations',
  });
  assert.equal(method.status, 405);
});

test('GET /api/launches reaches the Launch Library handler', async () => {
  const { status, json } = await dispatch(liveApiHandler, {
    method: 'POST',
    url: '/api/launches',
  });
  assert.equal(status, 405);
  assert.equal(json.error, 'Method Not Allowed');
});

test('GET leftover /adsblol/mil and /terrain/heights reach existing handlers', async () => {
  assert.equal(restoreLiveApiPath('/adsblol/mil'), '/api/adsblol/mil');
  assert.equal(existsSync(path.join(ROOT, 'api/adsblol/mil.js')), true);
  const terrain = await dispatch(liveApiHandler, { url: '/terrain/heights' });
  assert.equal(terrain.status, 400);
  assert.match(terrain.json.error, /invalid points/i);
  assert.doesNotMatch(JSON.stringify(terrain.json), /x-vercel-error|NOT_FOUND/);
});

test('GET /api/openai/hud-summary reaches the HUD handler', async () => {
  const get = await dispatch(liveApiHandler, { url: '/api/openai/hud-summary' });
  assert.equal(get.status, 405);

  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const post = await dispatch(liveApiHandler, {
      method: 'POST',
      url: '/api/openai/hud-summary',
      body: {},
    });
    assert.equal(post.status, 503);
    assert.match(post.json.error, /OPENAI_API_KEY/);
  } finally {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
  }
});

test('GET /api/cctv/sources reaches the CCTV handler', async () => {
  const { status, json } = await dispatch(liveApiHandler, { url: '/api/cctv/sources' });
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.sources));
});

test('GET /api/opensky never contacts OpenSky and is not a platform 404', async () => {
  const { status, json } = await dispatch(liveApiHandler, { url: '/api/opensky' });
  assert.equal(status, 400);
  assert.match(json.error, /adsb\.lol/i);
  assert.doesNotMatch(JSON.stringify(json), /opensky-network/);
});

test('unknown live /api path is a handler 404, not a missing function', async () => {
  const { status, json } = await dispatch(liveApiHandler, { url: '/api/does-not-exist' });
  assert.equal(status, 404);
  assert.equal(json.error, 'Not found');
});
