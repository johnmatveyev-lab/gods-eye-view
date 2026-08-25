import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import liveApiHandler from './vercelLiveApi.js';
import textSearchHandler, {
  googlePlacesContextProxy,
  handleGooglePlacesTextSearchHttp,
} from './liveApiProxies.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function mockReq({ method = 'GET', url = '/api/google/text-search', headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = { remoteAddress: '127.0.0.1' };
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

async function dispatch(handler, options = {}) {
  const req = mockReq(options);
  const res = mockRes();
  await handler(req, res);
  let json = null;
  if (typeof res.body === 'string' && res.body) {
    try { json = JSON.parse(res.body); } catch { json = null; }
  }
  return { status: res.statusCode, json, body: res.body, headers: res.headers };
}

test('Vercel text-search entry re-exports the existing Places proxy, not a new vendor', () => {
  const entry = path.join(ROOT, 'api/google/text-search.js');
  assert.equal(existsSync(entry), true);
  const source = readFileSync(entry, 'utf8');
  assert.match(source, /from '\.\.\/\.\.\/src\/server\/liveApiProxies\.js'/);
  assert.doesNotMatch(source, /export \{ GET, POST \}/);
  assert.doesNotMatch(source, /news\.google|opensky-network|telegeography|quantum-earth/i);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(vercelJson.functions['api/google/text-search.js']);
  assert.ok(vercelJson.functions['api/google/nearby-places.js']);
  assert.equal(vercelJson.functions['api/ais-live.js'], undefined);
  assert.equal(existsSync(path.join(ROOT, 'api/google/[...path].js')), false);

  const plugin = googlePlacesContextProxy();
  assert.equal(plugin.name, 'google-places-context-proxy');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.equal(typeof handleGooglePlacesTextSearchHttp, 'function');
  assert.equal(typeof textSearchHandler, 'function');
});

test('GET /api/google/text-search requires q/lat/lon and never returns a platform 404', async () => {
  const previous = process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  try {
    const unkeyed = await dispatch(textSearchHandler, {
      url: '/api/google/text-search?q=military+installation&lat=30.2672&lon=-97.7431&radiusM=4000',
    });
    assert.equal(unkeyed.status, 503);
    assert.deepEqual(unkeyed.json.places, []);
    assert.match(unkeyed.json.error, /GOOGLE_MAPS_API_KEY/);
    assert.doesNotMatch(JSON.stringify(unkeyed.json), /x-vercel-error|NOT_FOUND/);

    process.env.GOOGLE_MAPS_API_KEY = 'test-text-search-key';
    const missing = await dispatch(handleGooglePlacesTextSearchHttp, { url: '/api/google/text-search' });
    assert.equal(missing.status, 400);
    assert.deepEqual(missing.json.places, []);
    assert.match(missing.json.error, /q, lat and lon/i);
    assert.notEqual(missing.status, 404);

    const leftover = await dispatch(liveApiHandler, { url: '/google/text-search' });
    assert.equal(leftover.status, 400);
    assert.deepEqual(leftover.json.places, []);
    assert.notEqual(leftover.status, 404);

    const method = await dispatch(textSearchHandler, {
      method: 'POST',
      url: '/api/google/text-search?q=military+installation&lat=30.26&lon=-97.74',
    });
    assert.equal(method.status, 405);
    assert.deepEqual(method.json.places, []);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = previous;
  }
});
