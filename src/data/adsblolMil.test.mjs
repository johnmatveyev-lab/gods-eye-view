import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createViteConfig from '../../vite.config.js';
import { createVercelLiveApiHandler } from '../server/vercelLiveApi.js';
import adsblolMilDefault, { config as adsblolMilApiConfig } from '../../api/adsblol/mil.js';
import {
  ADSBLOL_MIL_CACHE_MS,
  ADSBLOL_MIL_PATH,
  ADSBLOL_MIL_UPSTREAM_URL,
  ADSBLOL_MIL_USER_AGENT,
  adsbLolMilPlugin,
  createAdsbLolMilApiHandler,
  createAdsbLolMilHandler,
  createAdsbLolMilProxy,
} from './adsblolMil.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SNAPSHOT = JSON.stringify({ ac: [{ hex: 'ae01ce', flight: 'RCH451' }] });

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
      Object.assign(this.headers, headers);
    },
    end(chunk) {
      this.headersSent = true;
      this.writableEnded = true;
      if (chunk !== undefined && chunk !== null) this.body = String(chunk);
    },
  };
}

async function invoke(handler, { method = 'GET', url = ADSBLOL_MIL_PATH } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {};
  const res = mockRes();
  await handler(req, res);
  let json = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
  return { status: res.statusCode, headers: res.headers, body: res.body, json };
}

function okFetch(calls, body = SNAPSHOT) {
  return async (url, options = {}) => {
    calls.push({ url, headers: options.headers });
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

test('upstream URL is api.adsb.lol/v2/mil and User-Agent is Meridian', async () => {
  const calls = [];
  const handler = createAdsbLolMilHandler({
    fetchImpl: okFetch(calls),
    log: () => {},
  });
  const { status, headers, json } = await invoke(handler);
  assert.equal(status, 200);
  assert.equal(headers['X-ADS-B-Cache'], 'MISS');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(json.ac[0].hex, 'ae01ce');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ADSBLOL_MIL_UPSTREAM_URL);
  assert.equal(calls[0].url, 'https://api.adsb.lol/v2/mil');
  assert.equal(calls[0].headers['User-Agent'], ADSBLOL_MIL_USER_AGENT);
  assert.equal(calls[0].headers['User-Agent'], 'Meridian-adsblol-proxy/1.0');
  assert.match(ADSBLOL_MIL_USER_AGENT, /Meridian/);
});

test('GET /api/adsblol/mil serves HIT, MISS, and STALE without a platform 404', async () => {
  const calls = [];
  let now = 1_000;
  let mode = 'ok';
  const handler = createAdsbLolMilHandler({
    now: () => now,
    log: () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url, headers: options.headers });
      if (mode === 'throw') throw new Error('upstream down');
      if (mode === 'http-error') {
        return new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 });
      }
      return new Response(SNAPSHOT, { status: 200 });
    },
  });

  const miss = await invoke(handler);
  assert.equal(miss.status, 200);
  assert.notEqual(miss.status, 404);
  assert.equal(miss.headers['X-ADS-B-Cache'], 'MISS');
  assert.equal(miss.json.ac.length, 1);

  now = 1_000 + ADSBLOL_MIL_CACHE_MS - 1;
  const hit = await invoke(handler);
  assert.equal(hit.status, 200);
  assert.equal(hit.headers['X-ADS-B-Cache'], 'HIT');
  assert.equal(hit.body, SNAPSHOT);
  assert.equal(calls.length, 1);

  now = 1_000 + ADSBLOL_MIL_CACHE_MS;
  mode = 'throw';
  const stale = await invoke(handler);
  assert.equal(stale.status, 200);
  assert.equal(stale.headers['X-ADS-B-Cache'], 'STALE');
  assert.equal(stale.body, SNAPSHOT);
  assert.notEqual(stale.status, 404);

  now = 1_000 + ADSBLOL_MIL_CACHE_MS * 2;
  mode = 'http-error';
  const staleHttp = await invoke(handler);
  assert.equal(staleHttp.status, 200);
  assert.equal(staleHttp.headers['X-ADS-B-Cache'], 'STALE');
  assert.equal(staleHttp.body, SNAPSHOT);
});

test('cold upstream failure is JSON 502, never a platform 404', async () => {
  const handler = createAdsbLolMilHandler({
    fetchImpl: async () => { throw new Error('dns'); },
    log: () => {},
  });
  const { status, json, headers } = await invoke(handler);
  assert.equal(status, 502);
  assert.notEqual(status, 404);
  assert.equal(json.error, 'ADS-B proxy error');
  assert.equal(headers['X-ADS-B-Cache'], 'MISS');
});

test('hosted api handler answers Node req/res and Web Request', async () => {
  const calls = [];
  const handler = createAdsbLolMilApiHandler({
    fetchImpl: okFetch(calls),
    log: () => {},
  });

  const node = await invoke(handler, { url: '/adsblol/mil' });
  assert.equal(node.status, 200);
  assert.equal(node.headers['X-ADS-B-Cache'], 'MISS');
  assert.ok(node.json);

  const web = await handler(new Request('https://example.com/api/adsblol/mil'));
  assert.equal(web.status, 200);
  assert.equal(web.headers.get('x-ads-b-cache'), 'HIT');
  assert.match(web.headers.get('content-type'), /json/);
  assert.equal(typeof adsblolMilDefault, 'function');
  assert.equal(adsblolMilApiConfig.api.bodyParser, false);
});

test('HTTP GET /api/adsblol/mil returns 200 JSON with a cache header', async () => {
  const handler = createAdsbLolMilHandler({
    fetchImpl: okFetch([]),
    log: () => {},
  });
  const server = http.createServer((req, res) => {
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${ADSBLOL_MIL_PATH}`);
    assert.equal(response.status, 200);
    assert.notEqual(response.status, 404);
    assert.equal(response.headers.get('x-ads-b-cache'), 'MISS');
    assert.match(response.headers.get('content-type'), /json/);
    const json = await response.json();
    assert.ok(Array.isArray(json.ac));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('Vite forwards the extracted adsblol-proxy plugin', () => {
  const plugin = adsbLolMilPlugin();
  assert.equal(plugin.name, 'adsblol-proxy');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.equal(typeof plugin.configurePreviewServer, 'function');

  const config = createViteConfig({ mode: 'test' });
  const installed = config.plugins.find((entry) => entry?.name === 'adsblol-proxy');
  assert.equal(typeof installed?.configureServer, 'function');
  assert.equal(typeof installed?.configurePreviewServer, 'function');
});

test('Vercel leftover /adsblol/mil reaches the extracted handler', async () => {
  const handler = createVercelLiveApiHandler(() => [
    adsbLolMilPlugin({
      fetchImpl: okFetch([]),
      log: () => {},
    }),
  ]);
  const leftover = await invoke(handler, { url: '/adsblol/mil' });
  assert.equal(leftover.status, 200);
  assert.equal(leftover.headers['X-ADS-B-Cache'], 'MISS');
  const full = await invoke(handler, { url: '/api/adsblol/mil' });
  assert.equal(full.status, 200);
  assert.equal(full.headers['X-ADS-B-Cache'], 'HIT');
});

test('military proxy sources stay adsb.lol ODbL only', () => {
  const files = [
    'src/data/adsblolMil.js',
    'api/adsblol/mil.js',
    'src/server/liveApiProxies.js',
    'vite.config.js',
  ].map((file) => ({
    file,
    source: readFileSync(path.join(ROOT, file), 'utf8'),
  }));

  assert.equal(existsSync(path.join(ROOT, 'api/adsblol/mil.js')), true);
  assert.match(files[0].source, /https:\/\/api\.adsb\.lol\/v2\/mil/);
  assert.match(files[0].source, /Meridian-adsblol-proxy\/1\.0/);
  assert.doesNotMatch(files[1].source, /liveApiProxies|ais-live|opensky/i);
  assert.doesNotMatch(files[2].source, /function adsbLolProxy/);
  assert.doesNotMatch(files[2].source, /gods-eye-view-adsblol/);
  assert.match(files[2].source, /adsbLolMilPlugin/);

  const milAndApi = `${files[0].source}\n${files[1].source}`;
  for (const source of [milAndApi, files[2].source, files[3].source]) {
    assert.doesNotMatch(source, /opensky-network\.org/);
    assert.doesNotMatch(source, /auth\.opensky-network\.org/);
    assert.doesNotMatch(source, /news\.google\.com/);
    assert.doesNotMatch(source, /quantum-earth/i);
  }
  assert.doesNotMatch(milAndApi, /telegeography/i);
  assert.doesNotMatch(milAndApi, /\/api\/ais-live/);
  assert.doesNotMatch(milAndApi, /\/api\/adsblol\/trace/);
  assert.doesNotMatch(milAndApi, /gods-eye-view-adsblol/);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(vercelJson.functions['api/adsblol/mil.js']);
});

test('createAdsbLolMilProxy does not contact OpenSky', async () => {
  const calls = [];
  const proxy = createAdsbLolMilProxy({
    fetchImpl: okFetch(calls),
    log: () => {},
  });
  await proxy.resolveMilitarySnapshot();
  assert.equal(calls.every((call) => !String(call.url).includes('opensky-network.org')), true);
});
