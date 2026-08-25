import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finished } from 'node:stream/promises';
import handleNetlifyLiveApi, {
  applyHostedApiRewrites,
  config as netlifyFunctionConfig,
  createNodeResponse,
  resolveVercelApiFile,
  restoreNetlifyApiPath,
  toWebResponse,
} from './netlifyLiveApi.js';
import { createRadioProxyMiddleware } from '../data/radioDirectory.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function parseNetlifyToml(source) {
  const build = {};
  const buildEnvironment = {};
  const redirects = [];
  let section = null;
  let currentRedirect = null;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) continue;
    if (line === '[build]') {
      section = 'build';
      currentRedirect = null;
      continue;
    }
    if (line === '[build.environment]') {
      section = 'build.environment';
      currentRedirect = null;
      continue;
    }
    if (line === '[[redirects]]') {
      section = 'redirects';
      currentRedirect = {};
      redirects.push(currentRedirect);
      continue;
    }
    if (line.startsWith('[')) {
      section = 'other';
      currentRedirect = null;
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(?:"([^"]*)"|(\d+))$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2] !== undefined ? match[2] : Number(match[3]);
    if (section === 'build') build[key] = value;
    else if (section === 'build.environment') buildEnvironment[key] = value;
    else if (section === 'redirects' && currentRedirect) currentRedirect[key] = value;
  }
  return { build, buildEnvironment, redirects };
}

async function dispatch(url, { method = 'GET', headers = {}, body } = {}) {
  const request = new Request(new URL(url, 'http://localhost').href, {
    method,
    headers,
    body,
  });
  const response = await handleNetlifyLiveApi(request);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json, text, contentType: response.headers.get('content-type') || '' };
}

test('netlify.toml builds the Vite dist and never SPA-falls-back /api/*', () => {
  const tomlPath = path.join(ROOT, 'netlify.toml');
  assert.equal(existsSync(tomlPath), true);
  const source = readFileSync(tomlPath, 'utf8');
  const toml = parseNetlifyToml(source);

  assert.equal(toml.build.command, 'npm run build');
  assert.equal(toml.build.publish, 'dist');
  assert.equal(toml.buildEnvironment.NODE_VERSION, '24');
  assert.match(source, /\[functions\.api\]/);
  assert.match(source, /included_files\s*=\s*\["config\/\*\*"\]/);
  assert.match(source, /node_bundler\s*=\s*"nft"/);
  assert.doesNotMatch(source, /node_bundler\s*=\s*"esbuild"/);

  assert.ok(toml.redirects.length >= 2);
  const spaIndex = toml.redirects.findIndex((rule) => (
    rule.from === '/*' && rule.to === '/index.html' && Number(rule.status) === 200
  ));
  assert.ok(spaIndex >= 0, 'SPA fallback /* → /index.html 200 is required');
  assert.equal(spaIndex, toml.redirects.length - 1, 'SPA fallback must be last');

  const apiRules = toml.redirects.filter((rule) => rule.from === '/api/*' || rule.from === '/api');
  assert.ok(apiRules.length >= 1, '/api must be declared before the SPA fallback');
  for (const rule of apiRules) {
    assert.notEqual(rule.to, '/index.html');
    assert.doesNotMatch(String(rule.to), /index\.html/);
    assert.ok(toml.redirects.indexOf(rule) < spaIndex);
  }

  const paths = netlifyFunctionConfig.path;
  assert.ok(Array.isArray(paths));
  assert.ok(paths.includes('/api/*'));
  assert.ok(paths.includes('/api'));
});

test('Netlify adapter is a thin Vercel-handler map; Vercel files stay untouched', () => {
  const entry = path.join(ROOT, 'netlify/functions/api.js');
  assert.equal(existsSync(entry), true);
  const entrySource = readFileSync(entry, 'utf8');
  assert.match(entrySource, /netlifyLiveApi\.js/);
  assert.doesNotMatch(entrySource, /export \{ GET, POST \}/);
  assert.doesNotMatch(entrySource, /from ['"]next/);
  assert.doesNotMatch(entrySource, /vite-plugin-cesium|from ['"]vite['"]/);

  const adapter = readFileSync(path.join(ROOT, 'src/server/netlifyLiveApi.js'), 'utf8');
  assert.doesNotMatch(adapter, /from ['"]vite['"]|vite-plugin-cesium/);
  assert.doesNotMatch(adapter, /https:\/\/opensky-network\.org|https:\/\/news\.google\.com|telegeography\.com|submarinecablemap/i);
  assert.doesNotMatch(adapter, /quantum-earth/i);
  assert.match(adapter, /api\/\[\.\.\.path\]\.js/);
  assert.match(adapter, /api\/billing\/\[\.\.\.path\]\.js/);
  assert.match(adapter, /api\/ais-live\/\[\.\.\.path\]\.js/);

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(vercelJson.framework, 'vite');
  assert.ok(vercelJson.functions['api/[...path].js']);
  assert.ok(vercelJson.functions['api/billing/[...path].js']);
  assert.doesNotMatch(JSON.stringify(vercelJson), /index\.html|netlify/i);

  assert.equal(existsSync(path.join(ROOT, 'api/google/text-search.js')), true);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live/[...path].js')), true);

  const stub = readFileSync(path.join(ROOT, 'src/data/aisLiveHosted.js'), 'utf8');
  assert.doesNotMatch(stub, /from ['"]ws['"]|new WebSocket\(|wss:\/\/stream\.aisstream\.io/i);
  assert.doesNotMatch(stub, /opensky-network|news\.google|telegeography|quantum-earth/i);
});

test('restoreNetlifyApiPath and TomTom rewrite do not invent a SPA path', () => {
  assert.equal(restoreNetlifyApiPath('/api/google/text-search'), '/api/google/text-search');
  assert.equal(restoreNetlifyApiPath('/.netlify/functions/api/google/text-search'), '/api/google/text-search');
  assert.equal(restoreNetlifyApiPath('/google/text-search'), '/api/google/text-search');
  assert.equal(
    applyHostedApiRewrites('/api/tomtom/flow/6/12/25.pbf'),
    '/api/tomtom/flow/6/12/25',
  );
  assert.equal(applyHostedApiRewrites('/api/tomtom/status'), '/api/tomtom/status');
});

test('adapter routes known /api paths onto the existing Vercel handler files', () => {
  assert.equal(resolveVercelApiFile('/api/google/text-search'), 'api/google/text-search.js');
  assert.equal(resolveVercelApiFile('/api/tomtom/status'), 'api/tomtom/[...path].js');
  assert.equal(resolveVercelApiFile('/api/billing/me'), 'api/billing/[...path].js');
  assert.equal(resolveVercelApiFile('/api/stripe/webhook'), 'api/stripe/webhook.js');
  assert.equal(resolveVercelApiFile('/api/cctv/frame/354'), 'api/cctv/frame/[id].js');
  assert.equal(resolveVercelApiFile('/api/opensky'), 'api/opensky.js');
  assert.equal(resolveVercelApiFile('/api/opensky-track'), 'api/opensky-track.js');
  assert.equal(resolveVercelApiFile('/api/radio/stations'), 'api/radio/[...path].js');
  assert.equal(resolveVercelApiFile('/api/ais-live'), 'api/ais-live/[...path].js');
  assert.equal(resolveVercelApiFile('/api/ais-live/track'), 'api/ais-live/[...path].js');
});

test('GET /api/google/text-search reaches the existing handler, not index.html', async () => {
  const previous = process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  try {
    const { status, json, text, contentType } = await dispatch('/api/google/text-search?q=capitol');
    assert.equal(status, 503);
    assert.deepEqual(json.places, []);
    assert.match(json.error, /GOOGLE_MAPS_API_KEY/);
    assert.match(contentType, /json/);
    assert.doesNotMatch(text, /<!doctype html/i);
    assert.doesNotMatch(text, /<div id="app"/i);
  } finally {
    if (previous !== undefined) process.env.GOOGLE_MAPS_API_KEY = previous;
  }
});

test('GET leftover /.netlify/functions/api/tomtom/status reaches TomTom', async () => {
  const { status, json, text } = await dispatch('/.netlify/functions/api/tomtom/status');
  assert.equal(status, 200);
  assert.equal(typeof json.hasKey, 'boolean');
  assert.equal(typeof json.dailyCount, 'number');
  assert.doesNotMatch(text, /<!doctype html/i);
});

test('GET /api/billing/me reaches the existing billing handler', async () => {
  const { status, json, text } = await dispatch('/api/billing/me');
  assert.notEqual(status, 404);
  if (status === 200) {
    assert.equal(json.plan, 'self_host');
    assert.equal(json.clerkConfigured, false);
  } else {
    assert.ok(status === 401 || status === 503);
    assert.equal(typeof json.error, 'string');
  }
  assert.doesNotMatch(text, /<!doctype html/i);
});

test('unknown /api path is a handler 404 JSON, never index.html', async () => {
  const { status, json, text, contentType } = await dispatch('/api/does-not-exist');
  assert.equal(status, 404);
  assert.equal(json.error, 'Not found');
  assert.match(contentType, /json/);
  assert.doesNotMatch(text, /<!doctype html/i);
  assert.doesNotMatch(text, /<html/i);
});

function countDirnameBindings(source) {
  return [...String(source).matchAll(/\b(?:const|let|var)\s+__dirname\b/g)].length;
}

test('Netlify function wrapper does not declare a second __dirname', () => {
  const wrapper = readFileSync(path.join(ROOT, 'netlify/functions/api.js'), 'utf8');
  const adapter = readFileSync(path.join(ROOT, 'src/server/netlifyLiveApi.js'), 'utf8');
  assert.equal(countDirnameBindings(wrapper), 0);
  assert.equal(countDirnameBindings(adapter), 0);
  assert.doesNotMatch(wrapper, /fileURLToPath\(new URL\(['"]\.['"]/);
  assert.doesNotMatch(adapter, /fileURLToPath\(new URL\(['"]\.['"]/);

  // These modules are pulled into the same Netlify function graph. A second
  // `const __dirname` collides with zip-it-and-ship-it's esbuild CJS shim.
  for (const relative of ['src/server/liveApiProxies.js', 'src/data/cctvProxy.js']) {
    const source = readFileSync(path.join(ROOT, relative), 'utf8');
    assert.equal(countDirnameBindings(source), 0, relative);
    assert.match(source, /\brepoRoot\b/);
  }
});

test('GET /api/opensky never contacts OpenSky', async () => {
  const { status, json } = await dispatch('/api/opensky');
  assert.equal(status, 400);
  assert.match(json.error, /adsb\.lol/i);
  assert.doesNotMatch(JSON.stringify(json), /opensky-network/);
});

test('GET /api/ais-live is an unsupported or missing-key snapshot, not a generic 404', async () => {
  const previous = process.env.AISSTREAM_API_KEY;
  process.env.AISSTREAM_API_KEY = 'must-not-open-a-hosted-socket';
  try {
    const { status, json, text, contentType } = await dispatch('/api/ais-live?maxRows=12000');
    assert.notEqual(status, 404);
    assert.notEqual(json?.error, 'Not found');
    assert.ok(json.status === 'unsupported' || json.status === 'missing-key');
    assert.deepEqual(json.rows, []);
    assert.match(contentType, /json/);
    assert.doesNotMatch(text, /<!doctype html/i);
    assert.doesNotMatch(JSON.stringify(json), /opensky-network|news\.google|telegeography|quantum-earth/i);

    const leftover = await dispatch('/.netlify/functions/api/ais-live');
    assert.ok(leftover.json.status === 'unsupported' || leftover.json.status === 'missing-key');
    assert.deepEqual(leftover.json.rows, []);
  } finally {
    if (previous === undefined) delete process.env.AISSTREAM_API_KEY;
    else process.env.AISSTREAM_API_KEY = previous;
  }
});

test('GET /api/ais-live/track is an empty samples stub', async () => {
  const { status, json, text } = await dispatch('/api/ais-live/track?mmsi=123456789');
  assert.notEqual(status, 404);
  assert.deepEqual(json.samples, []);
  assert.doesNotMatch(text, /<!doctype html/i);
  assert.doesNotMatch(JSON.stringify(json), /opensky-network|news\.google|telegeography|quantum-earth/i);
});

async function nodeHandlerToWebResponse(write) {
  const { res, chunks } = createNodeResponse();
  await write(res);
  if (!res.writableFinished) await finished(res);
  return toWebResponse(res, chunks);
}

test('adapter writeHead(204)+end() is a bodyless 204; 200 JSON still has a body', async () => {
  assert.throws(
    () => new Response(Buffer.concat([]), { status: 204 }),
    /Invalid response status code 204/,
  );

  const empty = await nodeHandlerToWebResponse((res) => {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
  });
  assert.equal(empty.status, 204);
  assert.equal(empty.body, null);
  assert.equal(empty.headers.get('cache-control'), 'no-store');

  for (const status of [205, 304]) {
    const response = await nodeHandlerToWebResponse((res) => {
      res.writeHead(status);
      res.end();
    });
    assert.equal(response.status, status);
    assert.equal(response.body, null);
  }

  const jsonOk = await nodeHandlerToWebResponse((res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
  });
  assert.equal(jsonOk.status, 200);
  assert.ok(jsonOk.body);
  assert.deepEqual(await jsonOk.json(), { ok: true });

  const liveJson = await handleNetlifyLiveApi(new Request('http://localhost/api/tomtom/status'));
  assert.equal(liveJson.status, 200);
  assert.ok(liveJson.body);
  assert.equal(typeof (await liveJson.json()).hasKey, 'boolean');
});

test('adapter radio click: known uuid is 204 with no body; unknown uuid is 404', async () => {
  const uuid = '12345678-1234-4234-8234-123456789abc';
  const unknownUuid = '00000000-0000-0000-0000-000000000000';
  const station = {
    stationuuid: uuid,
    name: 'Test Radio',
    url_resolved: 'https://stream.example.org/live.mp3',
    homepage: 'https://station.example.org/',
    tags: 'news',
    language: 'English',
    country: 'United States',
    countrycode: 'US',
    state: 'Texas',
    codec: 'MP3',
    bitrate: 128,
    hls: 0,
    lastcheckok: 1,
    geo_lat: 30.2672,
    geo_long: -97.7431,
    clickcount: 42,
  };
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.includes('/json/servers')) {
      return new Response(JSON.stringify([{ name: 'de1.api.radio-browser.info' }]), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (href.includes('/json/stations/search')) {
      return new Response(JSON.stringify([station]), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (href.includes(`/json/url/${uuid}`)) {
      return new Response(JSON.stringify({ ok: 'true' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };
  const middleware = createRadioProxyMiddleware({
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl,
  });

  const stations = await nodeHandlerToWebResponse((res) => (
    middleware({ method: 'GET', url: '/stations' }, res)
  ));
  assert.equal(stations.status, 200);
  assert.ok(stations.body);
  const catalog = await stations.json();
  assert.equal(catalog.stations[0].id, uuid);

  const known = await nodeHandlerToWebResponse((res) => (
    middleware({ method: 'POST', url: `/click/${uuid}` }, res)
  ));
  assert.equal(known.status, 204);
  assert.equal(known.body, null);
  assert.equal(known.headers.get('cache-control'), 'no-store');

  const unknown = await handleNetlifyLiveApi(new Request(
    `http://localhost/api/radio/click/${unknownUuid}`,
    { method: 'POST' },
  ));
  assert.equal(unknown.status, 404);
  assert.ok(unknown.body);
  assert.deepEqual(await unknown.json(), { error: 'Unknown radio station' });
  assert.equal(unknown.headers.get('cache-control'), 'no-store');
});
