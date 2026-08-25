import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleNearbyPlacesHttp,
  mapNearbyPlaces,
  parseNearbyPlacesQuery,
  serializePlacesBody,
} from './nearbyPlaces.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TEST_KEY = 'AIzaSyTEST_NEARBY_KEY_DO_NOT_LEAK';

function mockReq({ method = 'GET', url = '/api/google/nearby-places', headers = {} } = {}) {
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
    setHeader(name, value) { this.headers[name] = value; },
    end(chunk) { this.body = chunk || ''; },
  };
}

async function dispatch(options = {}, handlerOptions = {}) {
  const req = mockReq(options);
  const res = mockRes();
  await handleNearbyPlacesHttp(req, res, {
    env: { GOOGLE_MAPS_API_KEY: TEST_KEY },
    rateLimiter: null,
    fetchImpl: async () => new Response(JSON.stringify({ places: [] }), { status: 200 }),
    ...handlerOptions,
  });
  const json = res.body ? JSON.parse(res.body) : null;
  return { status: res.statusCode, json, body: res.body, headers: res.headers };
}

function timesSquarePlace() {
  return {
    id: 'places/ChIJ',
    displayName: { text: 'Times Square' },
    shortFormattedAddress: 'Manhattan, NY',
    formattedAddress: 'Times Square, Manhattan, NY 10036',
    location: { latitude: 40.758, longitude: -73.985 },
    primaryType: 'tourist_attraction',
    primaryTypeDisplayName: { text: 'Tourist Attraction' },
    types: ['tourist_attraction', 'point_of_interest'],
  };
}

test('GET /api/google/nearby-places without lat/lon → 400 {places:[]}', async () => {
  const missing = await dispatch({ url: '/api/google/nearby-places' });
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.json.places, []);
  assert.match(missing.json.error, /lat and lon/i);

  const partial = await dispatch({ url: '/api/google/nearby-places?lat=40.75' });
  assert.equal(partial.status, 400);
  assert.deepEqual(partial.json.places, []);
});

test('GET /api/google/nearby-places?lat=40.75&lon=-73.99&radiusM=250 → 200 or 503', async () => {
  const keyed = await dispatch({
    url: '/api/google/nearby-places?lat=40.75&lon=-73.99&radiusM=250',
  }, {
    fetchImpl: async () => new Response(JSON.stringify({ places: [timesSquarePlace()] }), { status: 200 }),
  });
  assert.equal(keyed.status, 200);
  assert.equal(keyed.json.places[0].name, 'Times Square');
  assert.equal(keyed.json.error, null);

  const unkeyed = await dispatch({
    url: '/api/google/nearby-places?lat=40.75&lon=-73.99&radiusM=250',
  }, {
    env: {},
  });
  assert.equal(unkeyed.status, 503);
  assert.deepEqual(unkeyed.json.places, []);
  assert.match(unkeyed.json.error, /GOOGLE_MAPS_API_KEY/);

  for (const result of [keyed, unkeyed]) {
    assert.ok(result.status === 200 || result.status === 503);
    assert.ok(Array.isArray(result.json.places));
  }
});

test('POST /api/google/nearby-places → 405 {places:[]}', async () => {
  const { status, json } = await dispatch({
    method: 'POST',
    url: '/api/google/nearby-places?lat=40.75&lon=-73.99',
  });
  assert.equal(status, 405);
  assert.deepEqual(json.places, []);
  assert.equal(json.error, 'Method not allowed');
});

test('Google API key never appears in nearby-places JSON', async () => {
  const cases = [
    await dispatch({ url: '/api/google/nearby-places' }),
    await dispatch({
      url: '/api/google/nearby-places?lat=40.75&lon=-73.99&radiusM=250',
    }, {
      fetchImpl: async () => new Response(JSON.stringify({
        places: [timesSquarePlace()],
        error: { message: `upstream leaked ${TEST_KEY}` },
      }), { status: 403 }),
    }),
    await dispatch({
      url: '/api/google/nearby-places?lat=40.75&lon=-73.99',
    }, {
      fetchImpl: async () => {
        throw new Error(`network failed for key ${TEST_KEY}`);
      },
    }),
    await dispatch({ method: 'POST', url: '/api/google/nearby-places' }),
  ];

  for (const result of cases) {
    const serialized = JSON.stringify(result.json);
    assert.doesNotMatch(serialized, new RegExp(TEST_KEY));
    assert.doesNotMatch(result.body, new RegExp(TEST_KEY));
    assert.doesNotMatch(serialized, /X-Goog-Api-Key|AIzaSy/);
    assert.ok(Array.isArray(result.json.places));
  }

  assert.equal(
    serializePlacesBody({ error: `bad ${TEST_KEY}`, places: [] }, TEST_KEY),
    '{"error":"bad [redacted]","places":[]}',
  );
});

test('Vercel wrapper forwards to handleNearbyPlacesHttp and is the only new Google wrap', () => {
  const entry = path.join(ROOT, 'api/google/nearby-places.js');
  assert.equal(existsSync(entry), true);
  const source = readFileSync(entry, 'utf8');
  assert.match(source, /from '\.\.\/\.\.\/src\/google\/nearbyPlaces\.js'/);
  assert.doesNotMatch(source, /export \{ GET, POST \}/);
  assert.doesNotMatch(source, /FIRMS|AISSTREAM|TOMTOM|adsbdb|person|findPlaceFromPhone/);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(vercelJson.functions['api/google/nearby-places.js']);
  assert.equal(vercelJson.functions['api/firms.js'], undefined);
  assert.equal(vercelJson.functions['api/ais-live.js'], undefined);
  assert.equal(vercelJson.functions['api/tomtom/[...path].js'], undefined);
  assert.equal(vercelJson.functions['api/adsbdb.js'], undefined);
  assert.equal(existsSync(path.join(ROOT, 'api/firms.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/tomtom')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/adsbdb.js')), false);
});

test('nearby-places is place labels only — no person-search fields', () => {
  const moduleSource = readFileSync(path.join(ROOT, 'src/google/nearbyPlaces.js'), 'utf8');
  assert.match(moduleSource, /places:searchNearby/);
  assert.doesNotMatch(moduleSource, /places:searchText|findPlaceFromPhoneNumber|people\.googleapis/);
  assert.doesNotMatch(moduleSource, /opensky-network|news\.google|telegeography|quantum-earth/);

  const mapped = mapNearbyPlaces({
    places: [
      timesSquarePlace(),
      { displayName: { text: 'Times Square' }, formattedAddress: 'Manhattan, NY' },
      { id: 'anon' },
    ],
  }, 40.75, -73.99);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].name, 'Times Square');
  assert.equal(mapped[0].primaryType, 'Tourist Attraction');
  assert.ok(!('contextPriority' in mapped[0]));

  const query = parseNearbyPlacesQuery('/api/google/nearby-places?lat=40.75&lon=-73.99&radiusM=12');
  assert.equal(query.valid, true);
  assert.equal(query.radiusM, 25);
});
