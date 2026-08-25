import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_CREDITS } from './dataCredits.js';
import {
  RADIO_USER_AGENT,
  createRadioProxyMiddleware,
  isAllowlistedRadioRoute,
} from './radio.js';
import radioHandler, { createVercelRadioHandler, restoreRadioApiPath } from './radioVercel.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const UUID = '12345678-1234-4234-8234-123456789abc';
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function station(overrides = {}) {
  return {
    stationuuid: UUID,
    name: 'Test Radio',
    url_resolved: 'https://stream.example.org/live.mp3',
    homepage: 'https://station.example.org/',
    favicon: 'https://station.example.org/logo.png',
    tags: 'news,jazz',
    language: 'English',
    country: 'United States',
    countrycode: 'US',
    state: 'Texas',
    codec: 'MP3',
    bitrate: 128,
    hls: 0,
    lastcheckok: 1,
    geo_lat: 30.2672,
    geo_long: -97.7431,
    clickcount: 42,
    ...overrides,
  };
}

function catalogRows(prefix, tags = 'news,jazz', count = 400) {
  return Array.from({ length: count }, (_, index) => station({
    stationuuid: `${prefix}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    name: `${prefix} Station ${index}`,
    tags,
    clickcount: 1000 - index,
  }));
}

function queryTag(url) {
  return new URL(String(url)).searchParams.get('tag');
}

function responseJson(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

function createCatalogFetch() {
  return async (url) => {
    if (String(url).includes('/json/servers')) {
      return responseJson([{ name: 'de1.api.radio-browser.info' }]);
    }
    if (String(url).includes('/json/stations/search')) {
      return responseJson(catalogRows('30000000', queryTag(url) || 'news'));
    }
    return responseJson({}, 404);
  };
}

function hostedRadioHandler() {
  return createVercelRadioHandler(() => createRadioProxyMiddleware({
    lookupImpl: publicLookup,
    fetchImpl: createCatalogFetch(),
  }));
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

test('Vercel radio entrypoint forwards to the allowlisted broker', () => {
  const entry = path.join(ROOT, 'api/radio/[...path].js');
  assert.equal(existsSync(entry), true, 'missing api/radio/[...path].js');
  const source = readFileSync(entry, 'utf8');
  assert.match(source, /radioVercel\.js/);
  assert.doesNotMatch(source, /export \{ GET, POST \}/);
  assert.doesNotMatch(source, /from ['"]next/);
  assert.doesNotMatch(source, /ais-live|vercelLiveApi|liveApiProxies/);

  const adapter = readFileSync(path.join(ROOT, 'src/data/radioVercel.js'), 'utf8');
  assert.doesNotMatch(adapter, /from ['"].*ais|aisLiveProxy|createAisStreamAdapter/);
  assert.doesNotMatch(adapter, /opensky-network\.org|news\.google\.com|telegeography/i);
  assert.match(adapter, /createRadioProxyMiddleware|createHostedRadioProxyMiddleware/);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(vercelJson.framework, 'vite');
  assert.ok(vercelJson.functions['api/radio/[...path].js']);
  assert.equal(Array.isArray(vercelJson.rewrites), false);
  assert.doesNotMatch(JSON.stringify(vercelJson), /index\.html/);
});

test('GET /api/radio/stations is 200 JSON, never a platform 404', async () => {
  const handler = hostedRadioHandler();
  const leftover = await dispatch(handler, { url: '/stations' });
  assert.equal(leftover.status, 200);
  assert.ok(Array.isArray(leftover.json.stations));
  assert.ok(leftover.json.stations.length > 0);
  assert.doesNotMatch(JSON.stringify(leftover.json), /x-vercel-error|NOT_FOUND/);

  const full = await dispatch(handler, { url: '/api/radio/stations' });
  assert.equal(full.status, 200);
  assert.ok(Array.isArray(full.json.stations));
  assert.doesNotMatch(JSON.stringify(full.json), /x-vercel-error|NOT_FOUND/);
});

test('GET /api/radio/not-a-route is 404 {error:Unknown radio route} from the function', async () => {
  const handler = hostedRadioHandler();
  const { status, json } = await dispatch(handler, { url: '/api/radio/not-a-route' });
  assert.equal(status, 404);
  assert.equal(json.error, 'Unknown radio route');
  assert.doesNotMatch(JSON.stringify(json), /x-vercel-error|NOT_FOUND/);
  assert.equal(isAllowlistedRadioRoute('/not-a-route'), false);
});

test('radio function does not wrap /api/ais-live', async () => {
  const handler = hostedRadioHandler();
  const { status, json } = await dispatch(handler, { url: '/api/ais-live' });
  assert.equal(status, 404);
  assert.equal(json.error, 'Unknown radio route');
  const leftover = await dispatch(handler, { url: '/ais-live' });
  assert.equal(leftover.status, 404);
  assert.equal(leftover.json.error, 'Unknown radio route');
});

test('restoreRadioApiPath does not require a vercel.json rewrite', () => {
  assert.equal(restoreRadioApiPath('/stations'), '/stations');
  assert.equal(restoreRadioApiPath('/api/radio/stations'), '/stations');
  assert.equal(restoreRadioApiPath('/radio/stations'), '/stations');
  assert.equal(restoreRadioApiPath('/api/radio/not-a-route'), '/not-a-route');
});

test('Radio Browser credit is unchanged and the UA is Meridian', () => {
  const credit = DATA_CREDITS.find((entry) => entry.key === 'radio-browser');
  assert.ok(credit);
  assert.match(credit.html, /Radio Browser/);
  assert.match(credit.html, /radio-browser\.info/);
  assert.doesNotMatch(credit.html, /gods-eye-view|GEV rebrand|quantum-earth/i);
  assert.equal(RADIO_USER_AGENT, 'Meridian/1.0 (Radio Browser directory client)');
  assert.doesNotMatch(RADIO_USER_AGENT, /gods-eye-view/i);

  const sources = readFileSync(path.join(ROOT, 'DATA_SOURCES.md'), 'utf8');
  assert.match(sources, /Radio Browser/);
});

test('default radio handler leftover /not-a-route still answers from the function', async () => {
  const req = mockReq({ method: 'GET', url: '/not-a-route' });
  const res = mockRes();
  await radioHandler(req, res);
  assert.equal(req.url, '/not-a-route');
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error, 'Unknown radio route');
});
