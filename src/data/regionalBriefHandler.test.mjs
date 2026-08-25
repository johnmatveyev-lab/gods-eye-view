import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createViteConfig, { GOOGLE_NEWS_RSS_ENABLED } from '../../vite.config.js';
import {
  createRegionalBriefHandler,
  handleRegionalBrief,
  REGIONAL_BRIEF_CACHE_MS,
  REGIONAL_BRIEF_RATE_LIMIT,
  REGIONAL_BRIEF_STALE_MS,
  regionalBriefHasAnySource,
  validRegionalPoint,
} from './regionalBriefHandler.js';
import { formatWindSpeed } from './weatherWindUnits.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUSTIN = { latitude: 30.2672, longitude: -97.7431 };
const AUSTIN_QUERY = `latitude=${AUSTIN.latitude}&longitude=${AUSTIN.longitude}`;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockUpstream({ place = true, weather = true, news = 'ready' } = {}) {
  const urls = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    urls.push(href);
    assert.doesNotMatch(href, /news\.google\.com/);
    if (href.includes('nominatim.openstreetmap.org')) {
      if (!place) throw new Error('place down');
      return jsonResponse({
        address: { city: 'Austin', state: 'Texas', country: 'United States', country_code: 'us' },
        display_name: 'Austin, Texas, United States',
      });
    }
    if (href.includes('api.open-meteo.com')) {
      if (!weather) throw new Error('weather down');
      return jsonResponse({
        current: {
          time: '2026-08-25T12:00:00Z',
          temperature_2m: 31.2,
          apparent_temperature: 33,
          precipitation: 0,
          weather_code: 1,
          cloud_cover: 20,
          wind_speed_10m: 14,
          wind_direction_10m: 180,
          visibility: 16000,
        },
      });
    }
    if (href.includes('api.gdeltproject.org')) {
      if (news === 'down') throw new Error('news down');
      if (news === 'empty') return jsonResponse({ articles: [] });
      return jsonResponse({
        articles: [{
          title: 'Austin regional update',
          url: 'https://statesman.example/story',
          domain: 'statesman.example',
          seendate: '20260825T120000Z',
          sourcecountry: 'United States',
        }],
      });
    }
    throw new Error(`unexpected upstream ${href}`);
  };
  return { fetchImpl, urls };
}

function mockReq({
  method = 'GET',
  url = '/',
  body,
  headers = {},
  query,
  parsedBody,
  remoteAddress = '127.0.0.1',
} = {}) {
  const shouldStream = method === 'POST' && parsedBody === undefined && body !== undefined;
  const req = new Readable({
    read() {
      if (shouldStream) {
        this.push(typeof body === 'string' ? body : JSON.stringify(body));
      }
      this.push(null);
    },
  });
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = { remoteAddress };
  if (query) req.query = query;
  if (parsedBody !== undefined) req.body = parsedBody;
  return req;
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    headersSent: false,
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
    },
    setHeader(name, value) { this.headers[name] = value; },
    end(chunk) {
      this.headersSent = true;
      this.body = chunk || '';
    },
  };
}

function handlerFor(fetchImpl, extras = {}) {
  return createRegionalBriefHandler({
    fetchImpl,
    nominatimMinIntervalMs: 0,
    ...extras,
  });
}

async function dispatch(handler, options) {
  const req = mockReq(options);
  const res = mockRes();
  await handler(req, res);
  return {
    status: res.statusCode,
    json: res.body ? JSON.parse(res.body) : null,
    headers: res.headers,
    text: String(res.body || ''),
  };
}

function assertCockpitBrief(result) {
  assert.equal(result.status, 200);
  assert.notEqual(result.status, 404);
  assert.doesNotMatch(result.text, /NOT_FOUND|x-vercel-error/);
  assert.ok(result.json.place || result.json.weather || result.json.newsStatus);
  assert.notEqual(result.json.newsStatus, undefined);
}

test('GET and POST cockpit queries return 200 JSON with place, weather, and GDELT news', async () => {
  const getUp = mockUpstream();
  const getResult = await dispatch(handlerFor(getUp.fetchImpl), {
    url: `/api/regional-brief?${AUSTIN_QUERY}`,
  });
  assertCockpitBrief(getResult);
  assert.equal(getResult.json.place.locality, 'Austin');
  assert.equal(getResult.json.weather.temperatureC, 31.2);
  assert.equal(getResult.json.weather.windKph, 14);
  assert.equal(getResult.json.weather.windDirectionDeg, 180);
  assert.equal(formatWindSpeed(getResult.json.weather.windKph, 'kmh'), '14 KM/H');
  assert.equal(formatWindSpeed(getResult.json.weather.windKph, 'mph'), '9 MPH');
  assert.equal(formatWindSpeed(getResult.json.weather.windKph, 'kt'), '8 KT');
  assert.equal(getResult.json.newsSource, 'GDELT Project');
  assert.equal(getResult.json.newsStatus, 'ready');
  assert.equal(getResult.json.articles[0].title, 'Austin regional update');
  assert.ok(getUp.urls.some((url) => url.includes('api.gdeltproject.org')));
  assert.ok(getUp.urls.some((url) => url.includes('api.open-meteo.com')));
  assert.equal(getUp.urls.some((url) => url.includes('news.google.com')), false);

  const postQuery = mockUpstream();
  const postQueryResult = await dispatch(handlerFor(postQuery.fetchImpl), {
    method: 'POST',
    url: `/api/regional-brief?${AUSTIN_QUERY}`,
  });
  assertCockpitBrief(postQueryResult);
  assert.equal(postQueryResult.json.newsSource, 'GDELT Project');

  const postBody = mockUpstream();
  const postBodyResult = await dispatch(handlerFor(postBody.fetchImpl), {
    method: 'POST',
    url: '/api/regional-brief',
    body: AUSTIN,
  });
  assertCockpitBrief(postBodyResult);
  assert.equal(postBodyResult.json.place.country, 'United States');

  const vercelBody = mockUpstream();
  const vercelResult = await dispatch(handlerFor(vercelBody.fetchImpl), {
    method: 'POST',
    url: '/api/regional-brief',
    parsedBody: AUSTIN,
  });
  assertCockpitBrief(vercelResult);
});

test('regional brief never answers NOT_FOUND; empty and stale stay distinct', async () => {
  const missing = await dispatch(handlerFor(mockUpstream().fetchImpl), {
    url: '/api/regional-brief',
  });
  assert.equal(missing.status, 400);
  assert.notEqual(missing.status, 404);
  assert.doesNotMatch(missing.text, /NOT_FOUND/);

  const put = await dispatch(handlerFor(mockUpstream().fetchImpl), {
    method: 'PUT',
    url: `/api/regional-brief?${AUSTIN_QUERY}`,
  });
  assert.equal(put.status, 405);
  assert.notEqual(put.status, 404);

  const emptyUp = mockUpstream({ news: 'empty' });
  const empty = await dispatch(handlerFor(emptyUp.fetchImpl), {
    url: `/api/regional-brief?${AUSTIN_QUERY}`,
  });
  assert.equal(empty.status, 200);
  assert.equal(empty.json.newsStatus, 'empty');
  assert.notEqual(empty.json.status, 'stale');
  assert.notEqual(empty.json.newsStatus, 'stale');
  assert.equal(empty.json.articles.length, 0);
  assert.equal(empty.json.newsSource, 'GDELT Project');

  let nowMs = Date.parse('2026-08-25T12:00:00.000Z');
  const cache = new Map();
  let fetchImpl = mockUpstream().fetchImpl;
  const handler = handlerFor((...args) => fetchImpl(...args), {
    cache,
    now: () => nowMs,
  });
  const fresh = await dispatch(handler, { url: `/api/regional-brief?${AUSTIN_QUERY}` });
  assert.equal(fresh.json.newsStatus, 'ready');
  nowMs += REGIONAL_BRIEF_CACHE_MS + 1;
  fetchImpl = mockUpstream({ place: false, weather: false, news: 'down' }).fetchImpl;
  const stale = await dispatch(handler, { url: `/api/regional-brief?${AUSTIN_QUERY}` });
  assert.equal(stale.status, 200);
  assert.equal(stale.json.status, 'stale');
  assert.notEqual(stale.json.status, 'empty');
  assert.notEqual(stale.json.newsStatus, 'empty');
  assert.equal(stale.headers['X-Regional-Brief'], 'STALE');
  assert.ok(REGIONAL_BRIEF_STALE_MS > REGIONAL_BRIEF_CACHE_MS);

  const outage = await dispatch(handlerFor(mockUpstream({
    place: false, weather: false, news: 'down',
  }).fetchImpl), { url: `/api/regional-brief?${AUSTIN_QUERY}` });
  assert.equal(outage.status, 503);
  assert.notEqual(outage.status, 404);
  assert.doesNotMatch(outage.text, /NOT_FOUND/);
});

test('keeps the 30/90 rate limiter and five-minute cache', async () => {
  assert.deepEqual(REGIONAL_BRIEF_RATE_LIMIT, { windowMs: 60_000, max: 30, globalMax: 90 });
  const limiterUp = mockUpstream();
  const handler = handlerFor(limiterUp.fetchImpl);
  const statuses = [];
  for (let i = 0; i < 31; i += 1) {
    const result = await dispatch(handler, { url: `/api/regional-brief?${AUSTIN_QUERY}` });
    statuses.push(result.status);
  }
  assert.ok(statuses.slice(0, 30).every((status) => status === 200));
  assert.equal(statuses[30], 429);

  const cacheUp = mockUpstream();
  const cached = handlerFor(cacheUp.fetchImpl);
  const miss = await dispatch(cached, { url: `/api/regional-brief?${AUSTIN_QUERY}` });
  const hit = await dispatch(cached, { url: `/api/regional-brief?${AUSTIN_QUERY}` });
  assert.equal(miss.headers['X-Regional-Brief'], 'MISS');
  assert.equal(hit.headers['X-Regional-Brief'], 'HIT');
  assert.equal(hit.json.status, 'cached');
  assert.equal(cacheUp.urls.filter((url) => url.includes('api.gdeltproject.org')).length, 1);
});

test('Vite plugin is a one-line forward and the Vercel wrapper exists', () => {
  assert.equal(GOOGLE_NEWS_RSS_ENABLED, false);
  const proxies = readFileSync(path.join(ROOT, 'src/server/liveApiProxies.js'), 'utf8');
  const vite = readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
  assert.match(proxies, /middlewares\.use\('\/api\/regional-brief', handleRegionalBrief\)/);
  assert.doesNotMatch(proxies, /function fetchRegionalNews/);
  assert.doesNotMatch(proxies, /news\.google\.com/);
  assert.doesNotMatch(vite, /news\.google\.com/);
  const config = createViteConfig({ mode: 'test' });
  const plugin = config.plugins.find((entry) => entry?.name === 'regional-brief-proxy');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.equal(typeof plugin.configurePreviewServer, 'function');

  const wrapper = path.join(ROOT, 'api/regional-brief.js');
  assert.equal(existsSync(wrapper), true);
  const wrapperSource = readFileSync(wrapper, 'utf8');
  assert.match(wrapperSource, /from '\.\.\/src\/data\/regionalBriefHandler\.js'/);
  assert.doesNotMatch(wrapperSource, /export \{ GET, POST \}/);
  assert.doesNotMatch(wrapperSource, /news\.google\.com/);
  assert.equal(typeof handleRegionalBrief, 'function');

  const vercelJson = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(vercelJson.functions['api/regional-brief.js']);
  for (const rule of vercelJson.rewrites || []) {
    assert.match(rule.source, /^\/api\/tomtom\//);
    assert.match(rule.destination, /^\/api\/tomtom\//);
  }
});

test('handler sources stay GDELT + Open-Meteo; Google News / OpenSky stay out', () => {
  const handler = readFileSync(path.join(ROOT, 'src/data/regionalBriefHandler.js'), 'utf8');
  const wrapper = readFileSync(path.join(ROOT, 'api/regional-brief.js'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const source of [handler, wrapper]) {
    assert.doesNotMatch(source, /news\.google\.com/);
    assert.doesNotMatch(source, /opensky-network\.org/);
    assert.doesNotMatch(source, /submarine-cable-map|telegeography\.com/i);
    assert.doesNotMatch(source, /quantum-earth/i);
  }
  assert.match(handler, /api\.gdeltproject\.org/);
  assert.match(handler, /api\.open-meteo\.com/);
  assert.match(handler, /GDELT Project/);
  assert.match(handler, /GOOGLE_NEWS_RSS_ENABLED !== false/);
  assert.match(
    html,
    /class="cockpit-weather-credit"[^>]*href="https:\/\/open-meteo.com\/"[^>]*>Weather data by Open-Meteo.com/,
  );
  assert.match(ui, /this\.weatherCredit\.hidden = !shown/);
  assert.equal(regionalBriefHasAnySource({
    place: null, weather: null, news: { status: 'unavailable' },
  }), false);
  assert.deepEqual(
    validRegionalPoint(new URLSearchParams('latitude=30.2672&longitude=-97.7431')),
    AUSTIN,
  );
});
