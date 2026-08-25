import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADSBLOL_POINT_RADIUS_NM,
  COMMERCIAL_FLIGHT_SOURCE,
  OPENSKY_ENABLED,
  adsbLolPointUrl,
  createOpenskyFlightsRuntime,
  createVercelOpenskyHandler,
  handleOpenskyFlightsHttp,
  restoreOpenskyPath,
} from './openskyFlights.js';
import { DATA_CREDITS } from '../data/dataCredits.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLIENT_QUERY = '/api/opensky?lat=30.1945&lon=-97.6699';

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
      this.body = chunk || '';
    },
  };
}

function adsbLolPayload() {
  return {
    now: 1_700_000_000,
    ac: [{
      hex: 'a1b2c3',
      flight: 'UAL123',
      lat: 30.2,
      lon: -97.7,
      alt_baro: 10000,
      gs: 200,
      track: 90,
    }],
  };
}

function mockFetch(calls) {
  return async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => adsbLolPayload(),
    };
  };
}

async function dispatch(handler, url) {
  const req = mockReq({ url });
  const res = mockRes();
  await handler(req, res);
  return {
    status: res.statusCode,
    json: res.body ? JSON.parse(res.body) : null,
    headers: res.headers,
  };
}

test('GET /api/opensky with the client query returns adsb.lol aircraft', async () => {
  const outbound = [];
  const runtime = createOpenskyFlightsRuntime({
    fetchImpl: mockFetch(outbound),
    cache: new Map(),
    inFlight: new Map(),
  });
  const handler = createVercelOpenskyHandler(() => runtime);

  const leftover = await dispatch(handler, '/?lat=30.1945&lon=-97.6699');
  assert.equal(leftover.status, 200);
  assert.ok(Array.isArray(leftover.json.states));
  assert.equal(leftover.json.states.length, 1);
  assert.equal(leftover.json.states[0][0], 'a1b2c3');
  assert.equal(leftover.headers['X-Flight-Source'], 'adsb.lol');
  assert.match(leftover.headers['X-Flight-Coverage'], /250nm/);
  assert.doesNotMatch(JSON.stringify(leftover.json), /x-vercel-error|NOT_FOUND|opensky-network/);

  const full = await dispatch(handler, CLIENT_QUERY);
  assert.equal(full.status, 200);
  assert.equal(full.json.states[0][1], 'UAL123');
  assert.equal(outbound.length, 1, '250 nm cache must reuse the last-good snapshot');
  assert.equal(
    outbound[0],
    adsbLolPointUrl(30.1945, -97.6699),
  );
  assert.match(outbound[0], /^https:\/\/api\.adsb\.lol\/v2\/lat\//);
  assert.doesNotMatch(outbound.join('\n'), /opensky-network\.org/);
});

test('last-good snapshot is served when adsb.lol refresh fails', async () => {
  let calls = 0;
  const runtime = createOpenskyFlightsRuntime({
    cache: new Map(),
    inFlight: new Map(),
    now: () => 1_000,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: true, status: 200, json: async () => adsbLolPayload() };
      }
      throw new Error('upstream down');
    },
  });
  const first = await dispatch(
    (req, res) => handleOpenskyFlightsHttp(req, res, runtime),
    CLIENT_QUERY,
  );
  assert.equal(first.status, 200);

  runtime.now = () => 1_000 + 20_000;
  const stale = await dispatch(
    (req, res) => handleOpenskyFlightsHttp(req, res, runtime),
    CLIENT_QUERY,
  );
  assert.equal(stale.status, 200);
  assert.equal(stale.json.states[0][0], 'a1b2c3');
  assert.equal(stale.headers['X-Flight-Cache'], 'STALE');
});

test('OPENSKY_ENABLED stays false and TeleGeography remains a no-op', () => {
  assert.equal(COMMERCIAL_FLIGHT_SOURCE, 'adsb.lol');
  assert.equal(OPENSKY_ENABLED, false);
  assert.equal(ADSBLOL_POINT_RADIUS_NM, 250);
  const track = path.join(ROOT, 'api/opensky-track.js');
  assert.equal(existsSync(track), true);
  assert.doesNotMatch(readFileSync(track, 'utf8'), /opensky-network\.org/);
  assert.ok(!DATA_CREDITS.some((credit) => credit.key === 'opensky'));
  assert.ok(!DATA_CREDITS.some((credit) => credit.key === 'telegeography'));
  assert.ok(!existsSync(path.join(ROOT, 'src/data/local_data/telegeography_submarine_cables')));
});

test('api/opensky.js wraps the extracted handler and never mentions OpenSky hosts', () => {
  const entry = path.join(ROOT, 'api/opensky.js');
  assert.equal(existsSync(entry), true);
  const source = readFileSync(entry, 'utf8');
  assert.match(source, /openskyFlights\.js/);
  assert.doesNotMatch(source, /export \{ GET, POST \}/);
  assert.doesNotMatch(source, /opensky-network\.org|OPENSKY_/);

  const handler = readFileSync(path.join(ROOT, 'src/server/openskyFlights.js'), 'utf8');
  assert.match(handler, /api\.adsb\.lol/);
  assert.doesNotMatch(handler, /https:\/\/opensky-network\.org|https:\/\/auth\.opensky-network\.org|news\.google\.com/i);
  assert.doesNotMatch(handler, /OPENSKY_USERNAME|OPENSKY_PASSWORD|OPENSKY_CLIENT/);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(vercelJson.functions['api/opensky.js']);
  for (const rule of vercelJson.rewrites || []) {
    assert.match(rule.source, /^\/api\/tomtom\//);
    assert.match(rule.destination, /^\/api\/tomtom\//);
  }
});

test('restoreOpenskyPath keeps the client /api/opensky path', () => {
  assert.equal(restoreOpenskyPath(CLIENT_QUERY), CLIENT_QUERY);
  assert.equal(restoreOpenskyPath('/?lat=30.1945&lon=-97.6699'), CLIENT_QUERY);
});
