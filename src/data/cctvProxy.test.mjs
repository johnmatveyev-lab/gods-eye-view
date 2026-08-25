import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  CCTV_FRAME_FETCH_TIMEOUT_MS,
  cctvProxy,
  fetchCctvImageFromUpstream,
} from './cctvProxy.js';

// Local catalog only: health must report served ids on a cold isolate without
// fetching OpenSky, Google News, TeleGeography, or live CCTV open-data packs.
process.env.CCTV_PREFER_AUSTIN = '0';
delete process.env.CCTV_FORCE_AUSTIN;
delete process.env.GOOGLE_MAPS_API_KEY;
process.env.CCTV_SOURCES_JSON = JSON.stringify([
  {
    id: '354',
    name: 'Congress Avenue',
    provider: 'Austin Transportation & Public Works',
    sourceKind: 'austin-open-data',
    url: 'https://cctv.austinmobility.io/image/354.jpg',
  },
]);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const href = String(input?.url || input);
  if (/austinmobility\.io/i.test(href)) {
    return new Response('', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }
  return originalFetch(input, init);
};

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
    writableEnded: false,
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

function mountCctvMiddleware() {
  let fn = null;
  cctvProxy().configureServer({
    middlewares: {
      use(pathOrFn, maybeFn) {
        fn = typeof pathOrFn === 'function' ? pathOrFn : maybeFn;
      },
    },
  });
  if (typeof fn !== 'function') {
    throw new Error('CCTV plugin did not register a middleware');
  }
  return fn;
}

async function dispatch(handler, url) {
  const req = mockReq({ url });
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
  return { status: res.statusCode, json, headers: res.headers };
}

test('CCTV upstream frame fetch supplies a bounded abort signal', async () => {
  let observedSignal = null;
  const startedAt = Date.now();
  const result = await fetchCctvImageFromUpstream('https://example.com/frame.jpg', {
    timeoutMs: 20,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      observedSignal = options.signal;
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }),
  });

  assert.equal(result, null);
  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, true);
  assert.ok(Date.now() - startedAt < 500, 'test timeout should settle promptly');
  assert.ok(CCTV_FRAME_FETCH_TIMEOUT_MS < 10_000, 'production timeout must beat the active refresh cadence');
});

test('CCTV upstream frame fetch returns a valid image response', async () => {
  const result = await fetchCctvImageFromUpstream('https://example.com/frame.jpg', {
    timeoutMs: 100,
    fetchImpl: async () => new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    }),
  });

  assert.equal(result?.ok, true);
  assert.equal(result?.contentType, 'image/jpeg');
  assert.deepEqual(result?.body, Buffer.from([1, 2, 3]));
});

test('GET /api/cctv/sources publishes feedConfigured for 354 without url', async () => {
  const handler = mountCctvMiddleware();
  const sources = await dispatch(handler, '/sources');
  assert.equal(sources.status, 200);
  assert.ok(Array.isArray(sources.json?.sources));
  assert.ok(sources.json.sources.length > 0, '/sources must list the served catalog');
  const first = sources.json.sources[0];
  assert.equal(first.id, '354');
  assert.equal(first.feedConfigured, true);
  assert.equal(Object.hasOwn(first, 'url'), false);
  assert.equal(first.url, undefined);
});

test('GET /api/cctv/health on a cold isolate lists catalog cameras including 354', async () => {
  const handler = mountCctvMiddleware();
  const health = await dispatch(handler, '/health');
  assert.equal(health.status, 200);
  assert.ok(Array.isArray(health.json?.cameras));
  assert.ok(health.json.cameras.length > 0, 'cold /health must list the served catalog, not []');
  const camera = health.json.cameras.find((row) => row.id === '354');
  assert.ok(camera, 'cold /health must include catalog id 354');
  assert.equal(camera.status, 'unknown');
  assert.equal(camera.sourceKind, 'austin-open-data');
});

test('GET /api/cctv/frame/354 updates health so that id is not stuck unknown', async () => {
  const handler = mountCctvMiddleware();
  const before = await dispatch(handler, '/health');
  assert.equal(before.json?.cameras?.find((row) => row.id === '354')?.status, 'unknown');

  const frame = await dispatch(handler, '/frame/354');
  assert.equal(frame.status, 200);

  const after = await dispatch(handler, '/health');
  const camera = after.json?.cameras?.find((row) => row.id === '354');
  assert.ok(camera, 'health must still include 354 after a frame');
  assert.notEqual(camera.status, 'unknown');
});
