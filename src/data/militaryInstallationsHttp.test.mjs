import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleMilitaryInstallationsHttp,
  MILITARY_INSTALLATION_ELEMENT_CAP,
  militaryInstallationCacheKey,
  militaryInstallationRequestCacheKey,
  quantizeMilitaryInstallationBox,
  validMilitaryInstallationBox,
} from './militaryInstallationsHttp.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const AUSTIN = 'south=30.26&west=-97.74&north=30.28&east=-97.71';

function mockReq({ method = 'GET', url = '/api/military-installations', headers = {} } = {}) {
  return {
    method,
    url,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
  };
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
      Object.assign(this.headers, headers);
    },
    end(chunk) {
      this.headersSent = true;
      this.writableEnded = true;
      this.body = chunk || '';
    },
  };
}

function isolatedOptions(overrides = {}) {
  const dir = path.join(os.tmpdir(), `gev-installations-http-${process.pid}-${Math.random().toString(36).slice(2)}`);
  return {
    memoryCache: new Map(),
    inFlight: new Map(),
    diskDir: dir,
    rateLimiter: null,
    fetchOverpass: async () => ({
      status: 200,
      body: JSON.stringify({
        elements: [{
          type: 'node',
          id: 1,
          lat: 30.27,
          lon: -97.74,
          tags: { military: 'base', name: 'Example' },
        }],
      }),
      rateLimited: false,
      runtimeError: false,
    }),
    ...overrides,
  };
}

async function dispatch(options = {}, handlerOptions = isolatedOptions()) {
  const req = mockReq(options);
  const res = mockRes();
  await handleMilitaryInstallationsHttp(req, res, handlerOptions);
  const json = res.body ? JSON.parse(res.body) : null;
  return { status: res.statusCode, json, body: res.body, headers: res.headers };
}

test('GET /api/military-installations without bbox → 400, never a platform 404', async () => {
  const missing = await dispatch({ url: '/api/military-installations' });
  assert.equal(missing.status, 400);
  assert.notEqual(missing.status, 404);
  assert.match(missing.json.error, /bbox|10 degrees/i);
  assert.doesNotMatch(JSON.stringify(missing.json), /x-vercel-error|NOT_FOUND/);

  const partial = await dispatch({ url: '/api/military-installations?south=30&west=-97&north=30.1' });
  assert.equal(partial.status, 400);
  assert.notEqual(partial.status, 404);
});

test('GET valid bbox → 200 {status, elements, saturated, elementCap}', async () => {
  const { status, json } = await dispatch({
    url: `/api/military-installations?${AUSTIN}`,
  });
  assert.equal(status, 200);
  assert.equal(typeof json.status, 'string');
  assert.ok(Array.isArray(json.elements));
  assert.equal(typeof json.saturated, 'boolean');
  assert.equal(json.elementCap, MILITARY_INSTALLATION_ELEMENT_CAP);
  assert.equal(json.saturated, false);
  assert.equal(json.elements[0].tags.name, 'Example');
});

test('POST /api/military-installations → 405; oversized bbox → 400', async () => {
  const post = await dispatch({
    method: 'POST',
    url: `/api/military-installations?${AUSTIN}`,
  });
  assert.equal(post.status, 405);
  assert.equal(post.json.error, 'Method Not Allowed');

  const huge = await dispatch({
    url: '/api/military-installations?south=20&west=-97&north=40&east=-87',
  });
  assert.equal(huge.status, 400);
  assert.match(huge.json.error, /10 degrees/i);
});

test('dateline and huge boxes are rejected by validMilitaryInstallationBox', () => {
  assert.equal(
    validMilitaryInstallationBox(new URLSearchParams('south=-1&west=179&north=1&east=-179')),
    null,
    'dateline-crossing boxes are rejected',
  );
  assert.equal(
    validMilitaryInstallationBox(new URLSearchParams('south=-20&west=0&north=20&east=1')),
    null,
    'spans larger than 10° latitude are rejected',
  );
  assert.equal(
    validMilitaryInstallationBox(new URLSearchParams('south=0&west=-20&north=1&east=20')),
    null,
    'spans larger than 10° longitude are rejected',
  );
  assert.deepEqual(
    validMilitaryInstallationBox(new URLSearchParams(AUSTIN)),
    { south: 30.26, west: -97.74, north: 30.28, east: -97.71 },
  );
});

test('exact=1 uses a separate cache key from the snapped tile', () => {
  const box = { south: 30.26, west: -97.74, north: 30.28, east: -97.71 };
  const snappedBox = quantizeMilitaryInstallationBox(box);
  const snapped = militaryInstallationRequestCacheKey(snappedBox, false);
  const exact = militaryInstallationRequestCacheKey(box, true);
  assert.notEqual(snapped, exact, 'a saturated retry must never overwrite the shared tile');
  assert.equal(snapped, militaryInstallationCacheKey(snappedBox));
  assert.equal(exact, `exact:${militaryInstallationCacheKey(box, 5)}`);
  assert.match(exact, /^exact:/);
});

test('exact=1 and snapped requests do not share an in-memory cache entry', async () => {
  const keys = [];
  const memoryCache = new Map();
  const options = isolatedOptions({
    memoryCache,
    fetchOverpass: async (body) => {
      keys.push(body);
      return {
        status: 200,
        body: JSON.stringify({ elements: [] }),
        rateLimited: false,
        runtimeError: false,
      };
    },
  });

  await dispatch({ url: `/api/military-installations?${AUSTIN}` }, options);
  await dispatch({ url: `/api/military-installations?${AUSTIN}&exact=1` }, options);
  assert.equal(keys.length, 2, 'exact and snapped must each miss the other cache');
  assert.ok([...memoryCache.keys()].some((key) => key.startsWith('exact:')));
  assert.ok([...memoryCache.keys()].some((key) => !key.startsWith('exact:')));
});

test('hosted catch-all forwards to handleMilitaryInstallationsHttp and does not add a 13th function or wrap ais-live', () => {
  assert.equal(existsSync(path.join(ROOT, 'api/military-installations.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/[...path].js')), true);
  const catchAll = readFileSync(path.join(ROOT, 'api/[...path].js'), 'utf8');
  assert.match(catchAll, /vercelLiveApi\.js/);
  assert.doesNotMatch(catchAll, /from ['"]next|person-search|findPlaceFromPhone|people\.googleapis/);

  const proxies = readFileSync(path.join(ROOT, 'src/server/liveApiProxies.js'), 'utf8');
  assert.match(proxies, /handleMilitaryInstallationsHttp/);
  assert.match(proxies, /military-installations-proxy/);
  assert.doesNotMatch(proxies, /function validMilitaryInstallationBox/);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(vercelJson.functions['api/[...path].js']);
  assert.equal(vercelJson.functions['api/military-installations.js'], undefined);
  assert.equal(vercelJson.functions['api/ais-live.js'], undefined);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live.js')), false);
});

test('installations handler is public OSM mapped context only', () => {
  const moduleSource = readFileSync(path.join(ROOT, 'src/data/militaryInstallationsHttp.js'), 'utf8');
  assert.match(moduleSource, /overpass-api\.de/);
  assert.match(moduleSource, /landuse"="military/);
  assert.match(moduleSource, /Meridian-overpass-proxy\/1\.0/);
  assert.doesNotMatch(moduleSource, /gods-eye-view-overpass-proxy/);
  assert.doesNotMatch(moduleSource, /opensky-network\.org|news\.google\.com|telegeography|quantum-earth/i);
  assert.doesNotMatch(moduleSource, /places:searchText|findPlaceFromPhoneNumber|people\.googleapis/);
  assert.doesNotMatch(moduleSource, /\/api\/route|\/api\/ais-live/);
});
