import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FOSSGIS_OSRM_ORIGIN,
  handleOsrmRouteHttp,
  mapOsrmRoute,
  parseOsrmCoords,
  parseOsrmProfile,
  resetOsrmRouteState,
} from './osrmRoute.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const FOOT_COORDS = '-73.9855,40.7580;-73.9832,40.7536';
const HUGE_SPAN = '-74.006,40.7128;-0.1278,51.5074';

function thirteenCoords() {
  const pairs = [];
  for (let i = 0; i < 13; i += 1) {
    pairs.push(`${(-73.99 - i * 0.001).toFixed(5)},${(40.75 + i * 0.001).toFixed(5)}`);
  }
  return pairs.join(';');
}

function mockReq({ method = 'GET', url = '/api/route', headers = {} } = {}) {
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
      if (chunk !== undefined && chunk !== null) this.body = chunk;
    },
  };
}

function fossgisFootResponse() {
  return new Response(JSON.stringify({
    code: 'Ok',
    routes: [{
      distance: 612.4,
      duration: 441.2,
      geometry: { coordinates: [[-73.9855, 40.758], [-73.9832, 40.7536]] },
    }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function dispatch(options = {}, handlerOptions = {}) {
  const req = mockReq(options);
  const res = mockRes();
  let fetchCalls = 0;
  await handleOsrmRouteHttp(req, res, {
    rateLimiter: null,
    cache: new Map(),
    fetchImpl: async () => {
      fetchCalls += 1;
      return fossgisFootResponse();
    },
    ...handlerOptions,
  });
  const json = res.body ? JSON.parse(res.body) : null;
  return { status: res.statusCode, json, body: res.body, headers: res.headers, fetchCalls };
}

test('GET /api/route without 2-12 coords → 200 {ok:false} need 2-12 coordinates', async () => {
  const missing = await dispatch({ url: '/api/route' });
  assert.equal(missing.status, 200);
  assert.equal(missing.json.ok, false);
  assert.equal(missing.json.error, 'need 2-12 coordinates');
  assert.notEqual(missing.status, 404);

  const one = await dispatch({ url: `/api/route?profile=foot&coords=-73.9855,40.7580` });
  assert.equal(one.status, 200);
  assert.equal(one.json.ok, false);
  assert.equal(one.json.error, 'need 2-12 coordinates');
});

test('GET /api/route?profile=foot&coords=… → 200 {ok:true}', async () => {
  let upstreamUrl = '';
  let fetchCalls = 0;
  const { status, json } = await dispatch({
    url: `/api/route?profile=foot&coords=${encodeURIComponent(FOOT_COORDS)}`,
  }, {
    fetchImpl: async (url) => {
      fetchCalls += 1;
      upstreamUrl = String(url);
      return fossgisFootResponse();
    },
  });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.profile, 'foot');
  assert.equal(json.distanceM, 612);
  assert.equal(json.durationS, 441);
  assert.ok(Array.isArray(json.geometry));
  assert.ok(json.geometry.length >= 2);
  assert.equal(fetchCalls, 1);
  assert.match(upstreamUrl, new RegExp(FOSSGIS_OSRM_ORIGIN.replace(/\./g, '\\.')));
  assert.match(upstreamUrl, /\/routed-foot\/route\/v1\/foot\//);
  assert.doesNotMatch(upstreamUrl, /api\.mapbox|maps\.googleapis\.com\/maps\/api\/directions|router\.hereapi|api\.tomtom\.com\/routing/);
});

test('GET /api/route?profile=spaceship → 200 {ok:false} invalid profile', async () => {
  let fetchCalled = false;
  const { status, json } = await dispatch({
    url: `/api/route?profile=spaceship&coords=${encodeURIComponent(FOOT_COORDS)}`,
  }, {
    fetchImpl: async () => {
      fetchCalled = true;
      return fossgisFootResponse();
    },
  });
  assert.equal(status, 200);
  assert.equal(json.ok, false);
  assert.equal(json.error, 'invalid profile');
  assert.equal(fetchCalled, false);
  assert.notEqual(status, 404);
});

test('GET /api/route with >12 coords or a huge span is rejected', async () => {
  const tooMany = await dispatch({
    url: `/api/route?profile=foot&coords=${encodeURIComponent(thirteenCoords())}`,
  }, {
    fetchImpl: async () => {
      throw new Error('must not call FOSSGIS for >12 coords');
    },
  });
  assert.equal(tooMany.status, 200);
  assert.equal(tooMany.json.ok, false);
  assert.equal(tooMany.json.error, 'need 2-12 coordinates');

  const huge = await dispatch({
    url: `/api/route?profile=car&coords=${encodeURIComponent(HUGE_SPAN)}`,
  }, {
    fetchImpl: async () => {
      throw new Error('must not call FOSSGIS for a transatlantic span');
    },
  });
  assert.equal(huge.status, 200);
  assert.equal(huge.json.ok, false);
  assert.equal(huge.json.error, 'route leg too long');
  assert.notEqual(huge.status, 404);
});

test('Vite leftover /?profile=foot path still returns the route contract', async () => {
  const { status, json } = await dispatch({
    url: `/?profile=foot&coords=${encodeURIComponent(FOOT_COORDS)}`,
  });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.profile, 'foot');
});

test('profile aliases stay on the FOSSGIS allowlist', () => {
  assert.equal(parseOsrmProfile('walking'), 'foot');
  assert.equal(parseOsrmProfile('driving'), 'car');
  assert.equal(parseOsrmProfile('cycling'), 'bike');
  assert.equal(parseOsrmProfile('spaceship'), null);
  assert.equal(parseOsrmCoords('').ok, false);
  assert.equal(parseOsrmCoords(FOOT_COORDS).ok, true);
  assert.equal(mapOsrmRoute({ code: 'NoRoute', routes: [] }, 'foot'), null);
});

test('Vercel wrapper forwards to handleOsrmRouteHttp and does not wrap adsblol/trace or ais-live', () => {
  const entry = path.join(ROOT, 'api/route.js');
  assert.equal(existsSync(entry), true);
  const source = readFileSync(entry, 'utf8');
  assert.match(source, /from '\.\.\/src\/data\/osrmRoute\.js'/);
  assert.doesNotMatch(source, /export \{ GET, POST \}/);
  assert.doesNotMatch(source, /adsblol|ais-live|aisstream|mapbox|google.*direction/i);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(vercelJson.functions['api/route.js']);
  assert.equal(vercelJson.functions['api/ais-live.js'], undefined);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live.js')), false);
});

test('OSRM module is FOSSGIS + OSM ODbL only — no commercial router or forbidden sources', () => {
  const moduleSource = readFileSync(path.join(ROOT, 'src/data/osrmRoute.js'), 'utf8');
  assert.match(moduleSource, /routing\.openstreetmap\.de/);
  assert.match(moduleSource, /ODbL/);
  assert.doesNotMatch(moduleSource, /api\.mapbox\.com|maps\.googleapis\.com\/maps\/api\/directions|router\.hereapi|api\.tomtom\.com\/routing|graphhopper/);
  assert.doesNotMatch(moduleSource, /opensky-network|news\.google|telegeography|quantum-earth/i);
  assert.doesNotMatch(moduleSource, /adsb\.lol\/v2\/traces|\/api\/ais-live/);

  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(license, /Meridian is an independent commercial product/);

  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'meridian');
  assert.equal(pkg.license, 'MIT');
  assert.doesNotMatch(pkg.description, /quantum-earth/i);
});

test('resetOsrmRouteState clears the default cache hook', () => {
  resetOsrmRouteState();
  assert.equal(parseOsrmProfile(undefined), 'foot');
});
