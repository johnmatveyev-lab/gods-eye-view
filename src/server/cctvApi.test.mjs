import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_CREDITS } from '../data/dataCredits.js';
import cctvHandler, {
  createVercelCctvHandler,
  ensureCctvResourceUrl,
  promoteCctvResourceId,
  restoreCctvApiPath,
} from './cctvApi.js';
import frameById from '../../api/cctv/frame/[id].js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function mockReq({ method = 'GET', url = '/', headers = {}, query } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.query = query;
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
  const text = typeof res.body === 'string'
    ? res.body
    : Buffer.isBuffer(res.body)
      ? res.body.toString('utf8')
      : '';
  if (text) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { status: res.statusCode, json, body: res.body, text, headers: res.headers };
}

function assertNotPlatform404(result) {
  const serialized = JSON.stringify({
    json: result.json,
    headers: result.headers,
    text: result.text,
  });
  assert.doesNotMatch(serialized, /x-vercel-error|NOT_FOUND/);
}

test('Vercel CCTV entry forwards to the existing catalog proxy only', () => {
  const entry = path.join(ROOT, 'api/cctv/[...path].js');
  assert.equal(existsSync(entry), true);
  const source = readFileSync(entry, 'utf8');
  assert.match(source, /cctvApi\.js/);
  assert.doesNotMatch(source, /export \{ GET, POST \}/);
  assert.doesNotMatch(source, /from ['"]next/);
  assert.doesNotMatch(source, /ais-live|google\/text-search|vite-plugin-cesium|from ['"]vite['"]/);

  const adapter = readFileSync(path.join(ROOT, 'src/server/cctvApi.js'), 'utf8');
  assert.match(adapter, /from ['"]\.\.\/data\/cctvProxy\.js['"]/);
  assert.doesNotMatch(adapter, /ais-live|aisStreamAdapter|google\/text-search|liveApiProxies/);
  assert.doesNotMatch(adapter, /opensky-network\.org|news\.google\.com|telegeography|quantum-earth/i);

  const proxy = readFileSync(path.join(ROOT, 'src/data/cctvProxy.js'), 'utf8');
  assert.match(proxy, /export function cctvProxy/);
  assert.doesNotMatch(proxy, /\/api\/ais-live|google\/text-search|opensky-network\.org|news\.google\.com|telegeography|quantum-earth/i);
  assert.doesNotMatch(proxy, /person.search|face.recognition|facial.recogn/i);

  const vite = readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
  assert.match(vite, /createLiveApiPlugins/);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(vercelJson.framework, 'vite');
  assert.ok(vercelJson.functions['api/cctv/[...path].js']);
  assert.equal(vercelJson.functions['api/cctv/[...path].js'].includeFiles, 'config/**');
  assert.equal(existsSync(path.join(ROOT, 'api/cctv/[path].js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/cctv/frame/[id].js')), true);
  assert.equal(existsSync(path.join(ROOT, 'api/cctv/stream/[id].js')), true);
  assert.equal(existsSync(path.join(ROOT, 'api/cctv/media/[id].js')), true);
  assert.equal(vercelJson.functions['api/cctv/frame/[id].js']?.includeFiles, 'config/**');
  for (const rule of vercelJson.rewrites || []) {
    assert.match(rule.source, /^\/api\/tomtom\//);
    assert.match(rule.destination, /^\/api\/tomtom\//);
  }
  assert.doesNotMatch(JSON.stringify(vercelJson), /index\.html/);
});

test('GET /api/cctv/sources → 200 catalog JSON', async () => {
  const leftover = await dispatch(cctvHandler, { url: '/sources' });
  assert.equal(leftover.status, 200);
  assert.ok(Array.isArray(leftover.json?.sources));
  assertNotPlatform404(leftover);

  const full = await dispatch(cctvHandler, { url: '/api/cctv/sources' });
  assert.equal(full.status, 200);
  assert.ok(Array.isArray(full.json?.sources));
});

test('GET /api/cctv/health → 200 health JSON', async () => {
  const { status, json } = await dispatch(cctvHandler, { url: '/api/cctv/health' });
  assert.equal(status, 200);
  assert.ok(Array.isArray(json?.cameras));
  assertNotPlatform404({ json, headers: {}, text: JSON.stringify(json) });
});

test('GET /api/cctv/stream/{id} → 200 stream info', async () => {
  const sources = await dispatch(cctvHandler, { url: '/api/cctv/sources' });
  const cameraId = sources.json?.sources?.[0]?.id || 'fixture-camera';
  const { status, json } = await dispatch(cctvHandler, {
    url: `/api/cctv/stream/${encodeURIComponent(cameraId)}`,
  });
  assert.equal(status, 200);
  assert.equal(json.id, cameraId);
  assert.equal(typeof json.feedType, 'string');
  assert.match(json.frameUrl, /\/api\/cctv\/frame\//);
  assertNotPlatform404({ json, headers: {}, text: JSON.stringify(json) });
});

test('unknown camera id is a handler fallback, not a platform 404', async () => {
  const stream = await dispatch(cctvHandler, { url: '/api/cctv/stream/not-a-real-camera' });
  assert.equal(stream.status, 200);
  assert.equal(stream.json.id, 'not-a-real-camera');
  assert.match(stream.json.frameUrl, /\/api\/cctv\/frame\/not-a-real-camera/);
  assertNotPlatform404(stream);

  const frame = await dispatch(cctvHandler, { url: '/api/cctv/frame/not-a-real-camera' });
  assert.equal(frame.status, 200);
  assert.match(String(frame.headers['Content-Type'] || frame.headers['content-type'] || ''), /image\/svg\+xml|image\//);
  assertNotPlatform404(frame);

  const unknown = await dispatch(cctvHandler, { url: '/api/cctv/does-not-exist' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.error, 'not found');
  assertNotPlatform404(unknown);
});

test('restoreCctvApiPath does not require a vercel.json rewrite', () => {
  assert.equal(restoreCctvApiPath('/sources'), '/api/cctv/sources');
  assert.equal(restoreCctvApiPath('/cctv/health'), '/api/cctv/health');
  assert.equal(restoreCctvApiPath('/api/cctv/stream/abc'), '/api/cctv/stream/abc');
  assert.equal(restoreCctvApiPath('/frame/xyz?label=x'), '/api/cctv/frame/xyz?label=x');
});

test('promoteCctvResourceId lifts ?id= onto /frame/:id after the mount', () => {
  assert.equal(promoteCctvResourceId('/frame?id=354'), '/frame/354');
  assert.equal(promoteCctvResourceId('/frame/', { id: '354' }), '/frame/354');
  assert.equal(
    promoteCctvResourceId('/frame?id=354&label=Congress'),
    '/frame/354?label=Congress',
  );
  assert.equal(promoteCctvResourceId('/frame/354'), '/frame/354');
  assert.equal(promoteCctvResourceId('/sources'), '/sources');
});

test('ensureCctvResourceUrl rebuilds leftover /354 into /api/cctv/frame/354', () => {
  assert.equal(ensureCctvResourceUrl('/354', 'frame'), '/api/cctv/frame/354');
  assert.equal(ensureCctvResourceUrl('/frame/354', 'frame'), '/api/cctv/frame/354');
  assert.equal(ensureCctvResourceUrl('/api/cctv/frame/354', 'frame'), '/api/cctv/frame/354');
  assert.equal(ensureCctvResourceUrl('/frame?id=354', 'frame'), '/api/cctv/frame/354');
  assert.equal(ensureCctvResourceUrl('/354', 'stream'), '/api/cctv/stream/354');
});

test('GET /api/cctv/frame/354 is a handler image with X-CCTV-Source', async () => {
  const frame = await dispatch(cctvHandler, { url: '/api/cctv/frame/354' });
  assert.equal(frame.status, 200);
  assert.match(
    String(frame.headers['Content-Type'] || frame.headers['content-type'] || ''),
    /image\/(jpeg|jpg|png|svg\+xml)/,
  );
  assert.match(
    String(frame.headers['X-CCTV-Source'] || frame.headers['x-cctv-source'] || ''),
    /upstream-image|streetview|synthetic/,
  );
  assertNotPlatform404(frame);

  const queryId = await dispatch(cctvHandler, { url: '/api/cctv/frame?id=354' });
  assert.equal(queryId.status, 200);
  assert.match(
    String(queryId.headers['Content-Type'] || queryId.headers['content-type'] || ''),
    /image\/(jpeg|jpg|png|svg\+xml)/,
  );
  assert.match(
    String(queryId.headers['X-CCTV-Source'] || queryId.headers['x-cctv-source'] || ''),
    /upstream-image|streetview|synthetic/,
  );
  assertNotPlatform404(queryId);

  const leftover = await dispatch(frameById, { url: '/354' });
  assert.equal(leftover.status, 200);
  assert.match(
    String(leftover.headers['X-CCTV-Source'] || leftover.headers['x-cctv-source'] || ''),
    /upstream-image|streetview|synthetic/,
  );
  assertNotPlatform404(leftover);

  const health = await dispatch(cctvHandler, { url: '/api/cctv/health' });
  assert.equal(health.status, 200);
  assert.ok(Array.isArray(health.json?.cameras));
  assert.ok(health.json.cameras.some((camera) => camera.id === '354'));
});

test('client still requests /api/cctv/frame/:id', () => {
  const client = readFileSync(path.join(ROOT, 'src/data/cctv.js'), 'utf8');
  assert.match(client, /const FRAME_ENDPOINT = '\/api\/cctv\/frame'/);
  assert.match(client, /FRAME_ENDPOINT\}\/\$\{encodeURIComponent\(camera\.id\)\}/);
  assert.doesNotMatch(client, /FRAME_ENDPOINT\?id=/);
});

test('dedicated CCTV handler does not serve ais-live or google/text-search', async () => {
  const ais = await dispatch(createVercelCctvHandler(), { url: '/api/ais-live' });
  assert.equal(ais.status, 404);
  assert.equal(ais.json.error, 'not found');
  assert.equal(ais.json.vessels, undefined);

  const textSearch = await dispatch(createVercelCctvHandler(), { url: '/api/google/text-search' });
  assert.equal(textSearch.status, 404);
  assert.equal(textSearch.json.error, 'not found');
});

test('existing public CCTV credits stay on the product', () => {
  const keys = DATA_CREDITS.map((credit) => credit.key);
  assert.ok(keys.includes('austin-cctv'));
  assert.ok(keys.includes('caltrans-cctv'));
  assert.ok(keys.includes('tfl-cctv'));
  assert.ok(!keys.includes('opensky'));
  assert.ok(!keys.includes('google-news-rss'));
  assert.ok(!keys.includes('telegeography'));
});
