import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createViteConfig from '../../vite.config.js';
import {
  ADSBDB_TIMEOUT_MS,
  ADSBDB_TTL_MS,
  ADSBDB_UPSTREAM_ORIGIN,
  createAdsbdbRuntime,
  createVercelAdsbdbHandler,
  parseAircraft,
  parseRoute,
  restoreAdsbdbApiPath,
} from './adsbdb.js';
import adsbdbHandler from './adsbdb.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ROUTE_FIXTURE = {
  response: {
    flightroute: {
      callsign: 'UAL123',
      airline: { name: 'United Airlines', icao: 'UAL', iata: 'UA' },
      origin: {
        iata_code: 'SFO',
        icao_code: 'KSFO',
        municipality: 'San Francisco',
        name: 'San Francisco International Airport',
        latitude: 37.6188,
        longitude: -122.375,
      },
      destination: {
        iata_code: 'EWR',
        icao_code: 'KEWR',
        municipality: 'Newark',
        name: 'Newark Liberty International Airport',
        latitude: 40.6895,
        longitude: -74.1745,
      },
    },
  },
};

const AIRCRAFT_FIXTURE = {
  response: {
    aircraft: {
      icao_type: 'B738',
      manufacturer: 'Boeing',
      type: '737-800',
      registration: 'N76529',
    },
  },
};

const AIRCRAFT_HEX = 'a19c4d';

function mockReq({ method = 'GET', url = '/' } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {};
  return req;
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    headersSent: false,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
    },
    end(chunk) {
      this.headersSent = true;
      this.body = chunk || '';
    },
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function runtimeFor(fetchImpl, extras = {}) {
  return createAdsbdbRuntime({
    fetchImpl,
    now: extras.now || (() => Date.parse('2026-08-25T12:00:00.000Z')),
    persistPath: extras.persistPath || null,
    persistImmediate: extras.persistImmediate ?? true,
    cache: extras.cache,
  });
}

async function dispatch(runtime, url) {
  const handler = createVercelAdsbdbHandler(() => runtime);
  const req = mockReq({ url });
  const res = mockRes();
  await handler(req, res);
  return {
    status: res.statusCode,
    json: res.body ? JSON.parse(res.body) : null,
    body: res.body,
    headers: res.headers,
  };
}

test('parseRoute fixture yields airline, origin, and destination', () => {
  const parsed = parseRoute(ROUTE_FIXTURE);
  assert.equal(parsed.airline, 'United Airlines');
  assert.deepEqual(parsed.origin, {
    code: 'SFO',
    name: 'San Francisco',
    lat: 37.6188,
    lon: -122.375,
  });
  assert.deepEqual(parsed.destination, {
    code: 'EWR',
    name: 'Newark',
    lat: 40.6895,
    lon: -74.1745,
  });
});

test('parseAircraft fixture yields typeCode, typeName, and registration', () => {
  const parsed = parseAircraft(AIRCRAFT_FIXTURE);
  assert.equal(parsed.typeCode, 'B738');
  assert.equal(parsed.typeName, 'Boeing 737-800');
  assert.equal(parsed.registration, 'N76529');
});

test('parseRoute and parseAircraft return null for incomplete fixtures', () => {
  assert.equal(parseRoute({ response: { flightroute: { origin: { iata_code: 'SFO' } } } }), null);
  assert.equal(parseRoute({ response: 'unknown callsign' }), null);
  assert.equal(parseAircraft({ response: {} }), null);
  assert.equal(parseAircraft({ response: 'unknown aircraft' }), null);
});

test('GET /api/adsbdb/route/UAL123 → 200 JSON airline/origin/destination or null, never NOT_FOUND', async () => {
  const urls = [];
  const runtime = runtimeFor(async (url) => {
    urls.push(String(url));
    return jsonResponse(ROUTE_FIXTURE);
  });
  const { status, json, body } = await dispatch(runtime, '/api/adsbdb/route/UAL123');
  assert.equal(status, 200);
  assert.equal(json.airline, 'United Airlines');
  assert.equal(json.origin.code, 'SFO');
  assert.equal(json.destination.code, 'EWR');
  assert.notEqual(json.airline, null);
  assert.doesNotMatch(body, /NOT_FOUND/);
  assert.equal(urls[0], `${ADSBDB_UPSTREAM_ORIGIN}/v0/callsign/UAL123`);
});

test('GET /api/adsbdb/aircraft/{hex} → 200 typeCode/typeName/registration or null', async () => {
  const urls = [];
  const runtime = runtimeFor(async (url) => {
    urls.push(String(url));
    return jsonResponse(AIRCRAFT_FIXTURE);
  });
  const { status, json, body } = await dispatch(runtime, `/api/adsbdb/aircraft/${AIRCRAFT_HEX}`);
  assert.equal(status, 200);
  assert.equal(json.typeCode, 'B738');
  assert.equal(json.typeName, 'Boeing 737-800');
  assert.equal(json.registration, 'N76529');
  assert.doesNotMatch(body, /NOT_FOUND/);
  assert.equal(urls[0], `${ADSBDB_UPSTREAM_ORIGIN}/v0/aircraft/${AIRCRAFT_HEX}`);
});

test('legacy /type/{hex} stays an aircraft alias for the existing client', async () => {
  const runtime = runtimeFor(async () => jsonResponse(AIRCRAFT_FIXTURE));
  const { status, json } = await dispatch(runtime, `/api/adsbdb/type/${AIRCRAFT_HEX}`);
  assert.equal(status, 200);
  assert.equal(json.typeCode, 'B738');
  assert.equal(json.registration, 'N76529');
});

test('unknown key 404 from upstream is cached as null, not a crash', async () => {
  let hits = 0;
  const runtime = runtimeFor(async () => {
    hits += 1;
    return jsonResponse({ response: 'unknown callsign' }, 404);
  });
  const first = await dispatch(runtime, '/api/adsbdb/route/ZZZ999');
  assert.equal(first.status, 200);
  assert.equal(first.json.airline, null);
  assert.equal(first.json.origin, null);
  assert.equal(first.json.destination, null);
  assert.doesNotMatch(first.body, /NOT_FOUND/);
  assert.equal(hits, 1);

  const second = await dispatch(runtime, '/api/adsbdb/route/zzz999');
  assert.equal(second.status, 200);
  assert.equal(second.json.airline, null);
  assert.equal(hits, 1, '404 miss must be negative-cached');
});

test('upstream errors serve last-good data instead of throwing', async () => {
  let now = Date.parse('2026-08-25T12:00:00.000Z');
  const cache = new Map();
  const primed = createAdsbdbRuntime({
    fetchImpl: async () => jsonResponse(ROUTE_FIXTURE),
    now: () => now,
    persistPath: null,
    cache,
  });
  const ok = await dispatch(primed, '/api/adsbdb/route/UAL123');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.airline, 'United Airlines');

  now += ADSBDB_TTL_MS + 1;
  const expired = createAdsbdbRuntime({
    fetchImpl: async () => { throw new Error('offline'); },
    now: () => now,
    persistPath: null,
    cache,
  });
  const recovered = await dispatch(expired, '/api/adsbdb/route/UAL123');
  assert.equal(recovered.status, 200);
  assert.equal(recovered.json.airline, 'United Airlines');
});

test('in-memory Map TTL is 24h and timeout is 8s against api.adsbdb.com only', () => {
  assert.equal(ADSBDB_TTL_MS, 24 * 3600_000);
  assert.equal(ADSBDB_TIMEOUT_MS, 8000);
  assert.equal(ADSBDB_UPSTREAM_ORIGIN, 'https://api.adsbdb.com');
});

test('optional persist path writes a cache file; missing volume is not required', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'adsbdb-'));
  const persistPath = path.join(dir, 'adsbdb.json');
  try {
    const first = runtimeFor(async () => jsonResponse(ROUTE_FIXTURE), { persistPath });
    await dispatch(first, '/api/adsbdb/route/UAL123');
    assert.equal(existsSync(persistPath), true);

    let hits = 0;
    const second = runtimeFor(async () => {
      hits += 1;
      return jsonResponse(ROUTE_FIXTURE);
    }, { persistPath });
    const { json } = await dispatch(second, '/api/adsbdb/route/UAL123');
    assert.equal(json.airline, 'United Airlines');
    assert.equal(hits, 0, 'warm /tmp cache must skip upstream');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('catch-all leftover /route/UAL123 still reaches the handler', async () => {
  const req = mockReq({ url: '/route/UAL123' });
  const res = mockRes();
  const handler = createVercelAdsbdbHandler(() => runtimeFor(async () => jsonResponse(ROUTE_FIXTURE)));
  await handler(req, res);
  assert.equal(req.url, '/api/adsbdb/route/UAL123');
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).airline, 'United Airlines');
});

test('restoreAdsbdbApiPath does not invent a SPA rewrite', () => {
  assert.equal(restoreAdsbdbApiPath('/route/UAL123'), '/api/adsbdb/route/UAL123');
  assert.equal(restoreAdsbdbApiPath('/api/adsbdb/aircraft/a19c4d'), '/api/adsbdb/aircraft/a19c4d');
});

test('Vercel Node entrypoint forwards to the shared adsbdb handler', () => {
  const wrapper = path.join(ROOT, 'api/adsbdb/[...path].js');
  assert.equal(existsSync(wrapper), true, 'missing api/adsbdb/[...path].js');
  const source = readFileSync(wrapper, 'utf8');
  assert.match(source, /from '\.\.\/\.\.\/src\/data\/adsbdb\.js'/);
  assert.doesNotMatch(source, /export \{ GET, POST \}/);
  assert.doesNotMatch(source, /opensky-network\.org|aisstream|firms|tomtom/i);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(vercelJson.functions['api/adsbdb/[...path].js']);
  assert.equal(Array.isArray(vercelJson.rewrites), false);
});

test('hosted adsbdb module never mentions OpenSky, GEV rebrand, or quantum-earth', () => {
  const source = readFileSync(path.join(ROOT, 'src/data/adsbdb.js'), 'utf8');
  assert.match(source, /Adapted from skylight \(MIT\)/);
  assert.match(source, /api\.adsbdb\.com/);
  assert.doesNotMatch(source, /opensky-network\.org/);
  assert.doesNotMatch(source, /auth\.opensky-network\.org/);
  assert.doesNotMatch(source, /news\.google\.com/);
  assert.doesNotMatch(source, /telegeography/i);
  assert.doesNotMatch(source, /quantum-earth/i);
  assert.doesNotMatch(source, /God's Eye View|GEV rebrand/i);
  assert.doesNotMatch(source, /aisstream|api\.firms|tomtom/i);
  assert.equal(typeof adsbdbHandler, 'function');
});

test('Vite plugin forwards to the extracted adsbdb handler', () => {
  const config = createViteConfig({ mode: 'test' });
  const byName = new Map(config.plugins.map((plugin) => [plugin.name, plugin]));
  assert.equal(typeof byName.get('adsbdb-proxy')?.configureServer, 'function');
  const proxies = readFileSync(path.join(ROOT, 'src/server/liveApiProxies.js'), 'utf8');
  assert.match(proxies, /adsbdbProxy/);
  assert.doesNotMatch(proxies, /function adsbdbProxy\(/);
});
