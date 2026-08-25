// Terrain proxy cache/retry mechanics. All dependencies are injected; no real
// network, disk, or Vite server is involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTerrainHeightsProxy,
  fetchTerrainChunkWithRetry,
  handleTerrainHeightsHttp,
  parseTerrainPoints,
  resolveTerrainHeightRequest,
  TERRAIN_MAX_POINTS,
  terrainPointKey,
} from './terrainHeightsProxy.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function result(id, ellipsoid) {
  return { id, ellipsoid, elevation: ellipsoid - 10, geoid: 10 };
}

test('per-point cache reconstruction preserves exact request order with mixed hits/misses and duplicates', async () => {
  const now = 50_000;
  const cache = new Map([
    [terrainPointKey([10, 1]), { at: now, result: result('cached-a', 101) }],
    [terrainPointKey([30, 3]), { at: now, result: result('cached-c', 303) }],
  ]);
  const points = [[30, 3], [20, 2], [10, 1], [40, 4], [20, 2]];
  let fetchedPoints = null;

  const response = await resolveTerrainHeightRequest({
    points,
    cache,
    ttlMs: 10_000,
    now: () => now,
    fetchMissing: async (missing) => {
      fetchedPoints = missing;
      return [result('fresh-b', 202), result('fresh-d', 404)];
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(fetchedPoints, [[20, 2], [40, 4]], 'only unique cache misses go upstream');
  assert.deepEqual(
    response.body.results.map((item) => item.id),
    ['cached-c', 'fresh-b', 'cached-a', 'fresh-d', 'fresh-b'],
    'each output position must map back to its own input point'
  );
});

test('429 retry honors Retry-After before the next attempt', async () => {
  let clock = 1_000_000;
  let attempts = 0;
  const sleeps = [];
  const results = await fetchTerrainChunkWithRetry([[12.345678, 45.678912]], {
    now: () => clock,
    random: () => 0.5,
    makeSignal: () => undefined,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: (name) => name.toLowerCase() === 'retry-after' ? '3' : null },
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [result('recovered', 88)] }),
      };
    },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [3000]);
  assert.equal(results[0].id, 'recovered');
});

test('permanently failing upstream exhausts retries and returns 502 without fake results', async () => {
  let clock = 2_000_000;
  let attempts = 0;
  const response = await resolveTerrainHeightRequest({
    points: [[-97.7431, 30.2672]],
    cache: new Map(),
    ttlMs: 10_000,
    now: () => clock,
    fetchMissing: (missing) => fetchTerrainChunkWithRetry(missing, {
      now: () => clock,
      random: () => 0.5,
      makeSignal: () => undefined,
      sleep: async (ms) => { clock += ms; },
      fetchImpl: async () => {
        attempts += 1;
        return { ok: false, status: 503, headers: { get: () => null } };
      },
    }),
  });

  assert.equal(attempts, 4, 'one initial attempt plus three retries');
  assert.equal(response.status, 502);
  assert.equal('results' in response.body, false, 'failure body must not fabricate positional heights');
});

test('stale per-point entries serve through a failed refresh only when every point is real', async () => {
  const cache = new Map([
    [terrainPointKey([1, 1]), { at: 0, result: result('stale-a', 11) }],
    [terrainPointKey([2, 2]), { at: 0, result: result('stale-b', 22) }],
  ]);
  const response = await resolveTerrainHeightRequest({
    points: [[2, 2], [1, 1]],
    cache,
    ttlMs: 100,
    now: () => 1000,
    fetchMissing: async () => { throw new Error('offline'); },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.results.map((item) => item.id), ['stale-b', 'stale-a']);
});

test('parseTerrainPoints rejects garbage and empty input', () => {
  assert.equal(parseTerrainPoints(null), null);
  assert.equal(parseTerrainPoints(''), null);
  assert.equal(parseTerrainPoints('   '), null);
  assert.equal(parseTerrainPoints('not-a-point'), null);
  assert.equal(parseTerrainPoints('-74.0'), null);
  assert.equal(parseTerrainPoints('-74.0,40.7,12'), null);
  assert.equal(parseTerrainPoints('abc,40.7'), null);
  assert.equal(parseTerrainPoints('-74.0,NaN'), null);
  assert.equal(parseTerrainPoints('-74.0,40.7;garbage'), null);
  assert.deepEqual(parseTerrainPoints('-74.0,40.7'), [[-74, 40.7]]);
  assert.deepEqual(parseTerrainPoints('-74.0,40.7; -73.9,40.8'), [[-74, 40.7], [-73.9, 40.8]]);
});

test('cache key is lon,lat at 5 decimal places', () => {
  assert.equal(terrainPointKey([-74.0, 40.7]), '-74.00000,40.70000');
  assert.equal(terrainPointKey([-73.9851234, 40.7584567]), '-73.98512,40.75846');
  assert.notEqual(terrainPointKey([-74.0, 40.7]), '40.70000,-74.00000');
});

function mockReq({ method = 'GET', url = '/api/terrain/heights' } = {}) {
  return { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
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
      if (chunk !== undefined && chunk !== null) this.body = chunk;
    },
  };
}

async function dispatch(url, handlerOptions = {}, reqOptions = {}) {
  const req = mockReq({ url, ...reqOptions });
  const res = mockRes();
  await handleTerrainHeightsHttp(req, res, {
    cachePath: null,
    skipDisk: true,
    ...handlerOptions,
  });
  const json = res.body ? JSON.parse(res.body) : null;
  return { status: res.statusCode, json, body: res.body, headers: res.headers };
}

function nycHeight() {
  return { lon: -74, lat: 40.7, elevation: 10, geoid: -32, ellipsoid: -22 };
}

test('GET /api/terrain/heights without points → 400, never platform 404', async () => {
  const missing = await dispatch('/api/terrain/heights');
  assert.equal(missing.status, 400);
  assert.notEqual(missing.status, 404);
  assert.match(missing.json.error, /invalid points/i);
  assert.doesNotMatch(JSON.stringify(missing.json), /x-vercel-error|NOT_FOUND/);

  const empty = await dispatch('/api/terrain/heights?points=');
  assert.equal(empty.status, 400);
  assert.notEqual(empty.status, 404);

  const garbage = await dispatch('/api/terrain/heights?points=garbage');
  assert.equal(garbage.status, 400);
  assert.notEqual(garbage.status, 404);
});

test('GET /api/terrain/heights?points=-74.0,40.7 → 200 JSON heights or stale', async () => {
  const live = await dispatch('/api/terrain/heights?points=-74.0,40.7', {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [nycHeight()] }),
    }),
  });
  assert.equal(live.status, 200);
  assert.ok(Array.isArray(live.json.results));
  assert.equal(live.json.results[0].ellipsoid, -22);

  const staleCache = new Map([
    [terrainPointKey([-74.0, 40.7]), { at: 0, result: result('stale-nyc', 12) }],
  ]);
  const stale = await dispatch('/api/terrain/heights?points=-74.0,40.7', {
    cache: staleCache,
    ttlMs: 1,
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
    }),
  });
  assert.equal(stale.status, 200);
  assert.equal(stale.json.results[0].id, 'stale-nyc');
});

test('GET over TERRAIN_MAX_POINTS → 500 too many points', async () => {
  const points = Array.from({ length: TERRAIN_MAX_POINTS + 1 }, () => '-74.0,40.7').join(';');
  const { status, json } = await dispatch(`/api/terrain/heights?points=${points}`, {
    fetchImpl: async () => {
      throw new Error('must not fetch when over cap');
    },
  });
  assert.equal(status, 500);
  assert.match(json.error, /too many points/i);
  assert.match(json.error, new RegExp(String(TERRAIN_MAX_POINTS)));
});

test('Vercel wrapper forwards the extracted handler and does not wrap route or installations', () => {
  const entry = path.join(ROOT, 'api/terrain/heights.js');
  assert.equal(existsSync(entry), true);
  const source = readFileSync(entry, 'utf8');
  assert.match(source, /terrainHeightsProxy\.js/);
  assert.doesNotMatch(source, /export \{ GET, POST \}/);
  assert.doesNotMatch(source, /opensky-network|news\.google|telegeography|quantum-earth/i);

  const viteForward = readFileSync(path.join(ROOT, 'src/server/liveApiProxies.js'), 'utf8');
  assert.match(viteForward, /createTerrainHeightsProxy/);
  assert.doesNotMatch(viteForward, /function terrainHeightsProxy\(\) \{\n  const TTL_MS/);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(vercelJson.functions['api/terrain/heights.js']);
  assert.equal(vercelJson.functions['api/military-installations.js'], undefined);
  assert.equal(existsSync(path.join(ROOT, 'api/military-installations.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/military-installations')), false);
  const terrainModule = readFileSync(path.join(ROOT, 'src/data/terrainHeightsProxy.js'), 'utf8');
  assert.doesNotMatch(terrainModule, /\/api\/route\b|military-installations/);
  assert.doesNotMatch(source, /\/api\/route\b|military-installations/);

  const plugin = createTerrainHeightsProxy({ cachePath: null, skipDisk: true });
  assert.equal(plugin.name, 'terrain-heights-proxy');
  assert.equal(typeof plugin.configureServer, 'function');
});
