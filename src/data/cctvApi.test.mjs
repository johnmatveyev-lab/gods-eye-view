import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_CREDITS } from './dataCredits.js';
import cctvHandler, {
  handleCctvRequest,
  restoreCctvApiPath,
  createVercelCctvHandler,
} from './cctvProxy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const KNOWN_CAMERA = {
  id: 'austin-test-1',
  name: 'Congress & 6th',
  city: 'Austin',
  cityId: 'austin',
  provider: 'Austin Transportation & Public Works',
  lat: 30.2672,
  lon: -97.7431,
  headingDeg: 41,
  headingConfidence: 'high',
  pitchDeg: -24,
  fovDeg: 56,
  rangeM: 210,
  mountHeightM: 10,
  groundElevationM: 150,
  feedType: 'image',
  url: 'https://cctv.austinmobility.io/image/austin-test-1.jpg',
  snapshotUrl: 'https://cctv.austinmobility.io/image/austin-test-1.jpg',
  sourceKind: 'austin-open-data',
  license: 'Public city traffic camera frame',
};

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
    writeHead(status, headers = {}) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(chunk) {
      this.headersSent = true;
      this.body = chunk ?? '';
    },
  };
}

async function dispatch(url, deps = {}) {
  const req = mockReq({ url });
  const res = mockRes();
  const getSources = deps.getSources || (async () => [KNOWN_CAMERA]);
  await handleCctvRequest(req, res, { ...deps, getSources });
  const contentType = String(res.headers['Content-Type'] || res.headers['content-type'] || '');
  const text = Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body || '');
  return {
    status: res.statusCode,
    headers: res.headers,
    body: res.body,
    text,
    json: contentType.includes('application/json') && text ? JSON.parse(text) : null,
  };
}

test('Vercel CCTV entrypoint exists and does not wrap ais-live or Google text-search', () => {
  const file = path.join(ROOT, 'api/cctv/[...path].js');
  assert.equal(existsSync(file), true, 'missing api/cctv/[...path].js');
  const source = readFileSync(file, 'utf8');
  assert.match(source, /cctvProxy\.js/);
  assert.doesNotMatch(source, /ais-live|google\/text-search|opensky|news\.google|telegeography/i);
  assert.doesNotMatch(source, /export \{ GET, POST \}/);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(vercelJson.framework, 'vite');
  assert.ok(vercelJson.functions['api/cctv/[...path].js']);
  assert.ok(vercelJson.functions['api/billing/[...path].js']);
  assert.equal(Array.isArray(vercelJson.rewrites), false);
  assert.doesNotMatch(JSON.stringify(vercelJson), /index\.html/);
});

test('GET /api/cctv/sources → 200 {sources:[{id,name,city,lat,lon,license,…}]}, never NOT_FOUND', async () => {
  const { status, json, text } = await dispatch('/api/cctv/sources');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.sources));
  assert.equal(json.sources.length, 1);
  const camera = json.sources[0];
  assert.equal(camera.id, KNOWN_CAMERA.id);
  assert.equal(camera.name, KNOWN_CAMERA.name);
  assert.equal(camera.city, KNOWN_CAMERA.city);
  assert.equal(camera.lat, KNOWN_CAMERA.lat);
  assert.equal(camera.lon, KNOWN_CAMERA.lon);
  assert.equal(camera.license, KNOWN_CAMERA.license);
  assert.equal(camera.provider, KNOWN_CAMERA.provider);
  assert.doesNotMatch(text, /x-vercel-error|NOT_FOUND/);
});

test('GET /api/cctv/health → 200 {cameras}', async () => {
  const { status, json, text } = await dispatch('/api/cctv/health', { health: new Map() });
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.cameras));
  assert.doesNotMatch(text, /x-vercel-error|NOT_FOUND/);
});

test('GET /api/cctv/stream/{knownId} → 200 JSON the client expects', async () => {
  const { status, json } = await dispatch(`/api/cctv/stream/${KNOWN_CAMERA.id}`);
  assert.equal(status, 200);
  assert.equal(json.id, KNOWN_CAMERA.id);
  assert.equal(json.feedType, 'image');
  assert.equal(json.mediaUrl, null);
  assert.equal(json.frameUrl, `/api/cctv/frame/${encodeURIComponent(KNOWN_CAMERA.id)}`);
  assert.equal(json.provider, KNOWN_CAMERA.provider);
  assert.equal(json.sourceKind, 'austin-open-data');
});

test('unknown camera id uses existing placeholder/fallback, not a platform 404', async () => {
  const stream = await dispatch('/api/cctv/stream/not-a-real-camera');
  assert.equal(stream.status, 200);
  assert.equal(stream.json.id, 'not-a-real-camera');
  assert.equal(stream.json.feedType, 'image');
  assert.equal(stream.json.frameUrl, '/api/cctv/frame/not-a-real-camera');
  assert.equal(stream.json.sourceKind, 'fallback');
  assert.doesNotMatch(stream.text, /x-vercel-error|NOT_FOUND/);

  const frame = await dispatch('/api/cctv/frame/not-a-real-camera');
  assert.equal(frame.status, 200);
  const contentType = String(frame.headers['Content-Type'] || frame.headers['content-type'] || '');
  assert.match(contentType, /image\/svg\+xml/);
  assert.match(frame.text, /CCTV FEED PLACEHOLDER/);
  assert.doesNotMatch(frame.text, /x-vercel-error|NOT_FOUND/);
});

test('catch-all leftover /sources still reaches the CCTV handler', async () => {
  assert.equal(typeof cctvHandler, 'function');
  const handler = createVercelCctvHandler('/api/cctv', handleCctvRequest, {
    getSources: async () => [KNOWN_CAMERA],
  });
  const req = mockReq({ url: '/sources' });
  const res = mockRes();
  await handler(req, res);
  assert.equal(req.url, '/api/cctv/sources');
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(String(res.body));
  assert.equal(json.sources[0].id, KNOWN_CAMERA.id);
  assert.doesNotMatch(String(res.body), /NOT_FOUND/);
});

test('restoreCctvApiPath does not require a vercel.json rewrite', () => {
  assert.equal(restoreCctvApiPath('/sources', '/api/cctv'), '/api/cctv/sources');
  assert.equal(restoreCctvApiPath('/api/cctv/health', '/api/cctv'), '/api/cctv/health');
  assert.equal(restoreCctvApiPath('/stream/austin-test-1', '/api/cctv'), '/api/cctv/stream/austin-test-1');
});

test('CCTV hosted module has no OpenSky, Google News, or cables; credits stay listed', () => {
  const proxy = readFileSync(path.join(ROOT, 'src/data/cctvProxy.js'), 'utf8');
  const entry = readFileSync(path.join(ROOT, 'api/cctv/[...path].js'), 'utf8');
  for (const source of [proxy, entry]) {
    assert.doesNotMatch(source, /opensky-network\.org/);
    assert.doesNotMatch(source, /news\.google\.com/);
    assert.doesNotMatch(source, /telegeography/i);
    assert.doesNotMatch(source, /quantum-earth/i);
    assert.doesNotMatch(source, /middlewares\.use\(['"`]\/api\/ais-live/);
    assert.doesNotMatch(source, /middlewares\.use\(['"`]\/api\/google\/text-search/);
  }
  const keys = DATA_CREDITS.map((credit) => credit.key);
  assert.ok(keys.includes('austin-cctv'));
  assert.ok(keys.includes('caltrans-cctv'));
  assert.ok(keys.includes('tfl-cctv'));
  assert.ok(!keys.includes('opensky'));
  assert.ok(!keys.includes('google-news-rss'));
  assert.ok(!keys.includes('telegeography'));
});

test('createVercelCctvHandler restores leftover stream paths', async () => {
  const handler = createVercelCctvHandler('/api/cctv', (req, res, deps) => (
    handleCctvRequest(req, res, { ...deps, getSources: async () => [KNOWN_CAMERA] })
  ));
  const req = mockReq({ url: `/stream/${KNOWN_CAMERA.id}` });
  const res = mockRes();
  await handler(req, res);
  assert.equal(req.url, `/api/cctv/stream/${KNOWN_CAMERA.id}`);
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(String(res.body));
  assert.equal(json.frameUrl, `/api/cctv/frame/${KNOWN_CAMERA.id}`);
});
