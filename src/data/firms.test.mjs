import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquisitionMsUtc } from './firmsCsv.js';
import {
  FIRMS_TTL_MS,
  createFirmsRuntime,
  createVercelFirmsHandler,
  filterTrailing24h,
  handleFirmsHttp,
  parseFirmsCsv,
  restoreFirmsPath,
} from './firms.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FIXTURE = readFileSync(
  path.join(ROOT, 'src/data/fixtures/firms-viirs-noaa20-sample.csv'),
  'utf8',
);

const VERCEL_FIRMS_FILES = Object.freeze([
  'api/firms/index.js',
  'api/firms/status.js',
]);

const FIXTURE_NOW_MS = Date.UTC(2026, 6, 17, 2, 0);

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
    end(chunk) {
      this.headersSent = true;
      this.body = chunk || '';
    },
  };
}

function fixtureFetch() {
  return async (url) => {
    const href = String(url);
    if (href.includes('mapkey_status')) {
      return {
        ok: true,
        json: async () => ({ current_transactions: 12, transaction_limit: 5000 }),
      };
    }
    if (href.includes('opensky-network.org') || href.includes('news.google.com')) {
      throw new Error(`illegal upstream ${href}`);
    }
    return {
      ok: true,
      text: async () => FIXTURE,
    };
  };
}

function runtime(overrides = {}) {
  return createFirmsRuntime({
    env: { FIRMS_MAP_KEY: 'test-map-key', ...overrides.env },
    now: () => FIXTURE_NOW_MS,
    fetchFn: fixtureFetch(),
    cachePath: null,
    log: { warn() {} },
    ...overrides,
  });
}

async function dispatch(rt, options) {
  const req = mockReq(options);
  const res = mockRes();
  await handleFirmsHttp(req, res, rt);
  return {
    status: res.statusCode,
    json: res.body ? JSON.parse(res.body) : null,
    headers: res.headers,
    body: res.body,
  };
}

test('Vercel Node entrypoints forward to handleFirmsHttp', () => {
  for (const file of VERCEL_FIRMS_FILES) {
    const absolute = path.join(ROOT, file);
    assert.equal(existsSync(absolute), true, `missing ${file}`);
    const source = readFileSync(absolute, 'utf8');
    assert.match(source, /createVercelFirmsHandler|from '\.\.\/\.\.\/src\/data\/firms\.js'/);
    assert.doesNotMatch(source, /export \{ GET, POST \}/);
    assert.doesNotMatch(source, /opensky-network\.org|news\.google\.com|telegeography|quantum-earth/i);
  }
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/tomtom.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/tomtom')), false);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(vercelJson.framework, 'vite');
  assert.ok(vercelJson.functions['api/firms/index.js']);
  assert.ok(vercelJson.functions['api/firms/status.js']);
  assert.equal(Array.isArray(vercelJson.rewrites), false);
  assert.doesNotMatch(JSON.stringify(vercelJson), /index\.html/);
});

test('GET /api/firms/status → 200 JSON hasKey true/false, never NOT_FOUND', async () => {
  const keyed = await dispatch(runtime(), { url: '/api/firms/status' });
  assert.equal(keyed.status, 200);
  assert.equal(keyed.json.hasKey, true);
  assert.equal(typeof keyed.json.hasKey, 'boolean');
  assert.equal(keyed.json.ttlMs, FIRMS_TTL_MS);
  assert.doesNotMatch(keyed.body, /x-vercel-error|NOT_FOUND/);

  const keyless = await dispatch(runtime({ env: { FIRMS_MAP_KEY: '' } }), { url: '/api/firms/status' });
  assert.equal(keyless.status, 200);
  assert.equal(keyless.json.hasKey, false);
  assert.equal(keyless.json.lastFetch, null);
  assert.equal(keyless.json.transactions, null);
  assert.doesNotMatch(keyless.body, /x-vercel-error|NOT_FOUND/);
});

test('GET /api/firms without key → 503 {error:\'no_key\'}', async () => {
  const { status, json, body } = await dispatch(runtime({ env: { FIRMS_MAP_KEY: '' } }), {
    url: '/api/firms',
  });
  assert.equal(status, 503);
  assert.equal(json.error, 'no_key');
  assert.doesNotMatch(body, /NOT_FOUND/);
});

test('GET /api/firms with fixture → 200 {fires, count, stale, ttlMs}; trailing 24h only', async () => {
  const { status, json } = await dispatch(runtime(), { url: '/api/firms' });
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.fires));
  assert.equal(typeof json.count, 'number');
  assert.equal(json.count, json.fires.length);
  assert.equal(json.stale, false);
  assert.equal(json.ttlMs, FIRMS_TTL_MS);
  assert.ok(json.count > 0);

  const expected = filterTrailing24h(parseFirmsCsv(FIXTURE), FIXTURE_NOW_MS);
  assert.equal(json.count, expected.length * 3); // three VIIRS sources, same fixture
  for (const fire of json.fires) {
    const ms = acquisitionMsUtc(fire.acqDate, fire.acqTime);
    assert.ok(Number.isFinite(ms), `parseable acquisition ${fire.acqDate} ${fire.acqTime}`);
    assert.ok(ms >= FIXTURE_NOW_MS - 24 * 3600_000);
    assert.ok(ms <= FIXTURE_NOW_MS + 2 * 3600_000);
  }
});

test('parseFirmsCsv fixture is the hosted payload source', () => {
  const records = parseFirmsCsv(FIXTURE);
  assert.ok(Array.isArray(records));
  assert.equal(records.length, 45);
  assert.equal(records[0].lat, 38.99488);
  assert.equal(records[0].confidence, 'n');
});

test('serve-time filter drops detections older than 24h from cache', async () => {
  const recent = parseFirmsCsv(FIXTURE);
  const rt = runtime();
  rt.seedMem({
    at: FIXTURE_NOW_MS,
    sources: [{ source: 'VIIRS_NOAA20_NRT', count: recent.length + 1, ok: true }],
    fires: [
      ...recent,
      {
        lat: 1,
        lon: 2,
        frp: 1,
        confidence: 'n',
        brightness: 0,
        brightnessTi5: 0,
        daynight: 'D',
        acqDate: '2020-01-01',
        acqTime: '0000',
        satellite: 'N20',
        instrument: 'VIIRS',
      },
    ],
  });
  const { status, json } = await dispatch(rt, { url: '/api/firms' });
  assert.equal(status, 200);
  assert.equal(json.fires.some((f) => f.acqDate === '2020-01-01'), false);
  assert.equal(json.count, filterTrailing24h(recent, FIXTURE_NOW_MS).length);
});

test('Vercel leftover /status still reaches the status handler', async () => {
  const handler = createVercelFirmsHandler('/api/firms', () => runtime({ env: { FIRMS_MAP_KEY: '' } }));
  const req = mockReq({ url: '/status' });
  const res = mockRes();
  await handler(req, res);
  assert.equal(req.url, '/api/firms/status');
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).hasKey, false);
  assert.doesNotMatch(res.body, /NOT_FOUND/);
});

test('restoreFirmsPath does not require a vercel.json rewrite', () => {
  assert.equal(restoreFirmsPath('/status', '/api/firms'), '/api/firms/status');
  assert.equal(restoreFirmsPath('/api/firms/status', '/api/firms'), '/api/firms/status');
  assert.equal(restoreFirmsPath('/', '/api/firms'), '/api/firms');
  assert.equal(restoreFirmsPath('/api/firms', '/api/firms'), '/api/firms');
});

test('NASA FIRMS acknowledgement stays in DATA_SOURCES.md and dataCredits.js', () => {
  const sources = readFileSync(path.join(ROOT, 'DATA_SOURCES.md'), 'utf8');
  const credits = readFileSync(path.join(ROOT, 'src/data/dataCredits.js'), 'utf8');
  assert.match(sources, /We acknowledge the use of data and\/or imagery from NASA's Fire Information for Resource Management System/);
  assert.match(sources, /CC0|public domain/i);
  assert.match(credits, /key: 'firms'/);
  assert.match(credits, /NASA FIRMS/);
  assert.match(credits, /earthdata\.nasa\.gov\/firms/);
});

test('FIRMS module does not pull OpenSky, Google News, or cables', () => {
  const source = readFileSync(path.join(ROOT, 'src/data/firms.js'), 'utf8');
  assert.doesNotMatch(source, /opensky-network\.org|auth\.opensky-network\.org/);
  assert.doesNotMatch(source, /news\.google\.com/);
  assert.doesNotMatch(source, /telegeography|submarine.?cable/i);
  assert.doesNotMatch(source, /quantum-earth/i);
  assert.match(source, /firms\.modaps\.eosdis\.nasa\.gov/);
});

test('Vite plugin still forwards to the shared FIRMS handler', () => {
  const vite = readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
  assert.match(vite, /import \{ firmsProxy \} from '\.\/src\/data\/firms\.js'/);
  assert.match(vite, /firmsProxy\(\)/);
  assert.doesNotMatch(vite, /function firmsProxy\(/);
});
