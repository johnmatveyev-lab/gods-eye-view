import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import createViteConfig, {
  COMMERCIAL_FLIGHT_SOURCE,
  GOOGLE_NEWS_RSS_ENABLED,
  OPENSKY_ENABLED,
} from '../../vite.config.js';
import { AISSTREAM_CREDIT, DATA_CREDITS } from './dataCredits.js';
import flightsLayer from './flights.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('commercial flights are adsb.lol-only; OpenSky and Google News stay off', () => {
  assert.equal(COMMERCIAL_FLIGHT_SOURCE, 'adsb.lol');
  assert.equal(OPENSKY_ENABLED, false);
  assert.equal(GOOGLE_NEWS_RSS_ENABLED, false);
  assert.equal(flightsLayer.source, 'adsb.lol');
  assert.equal(flightsLayer.getStats().fallback, false);
});

test('production proxies never fetch OpenSky or Google News RSS', () => {
  const flights = readFileSync(path.join(ROOT, 'src/server/openskyFlights.js'), 'utf8');
  const proxies = readFileSync(path.join(ROOT, 'src/server/liveApiProxies.js'), 'utf8');
  const cctv = readFileSync(path.join(ROOT, 'src/data/cctvProxy.js'), 'utf8');
  const vite = readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
  const adsbdb = readFileSync(path.join(ROOT, 'src/data/adsbdb.js'), 'utf8');
  const weather = readFileSync(path.join(ROOT, 'src/data/weatherEffects.js'), 'utf8');
  const handler = readFileSync(path.join(ROOT, 'src/data/regionalBriefHandler.js'), 'utf8');
  for (const source of [flights, proxies, cctv, vite, adsbdb, weather, handler]) {
    assert.doesNotMatch(source, /https:\/\/opensky-network\.org/);
    assert.doesNotMatch(source, /https:\/\/auth\.opensky-network\.org/);
    assert.doesNotMatch(source, /news\.google\.com/);
  }
  assert.match(flights, /api\.adsb\.lol/);
  assert.match(adsbdb, /api\.adsbdb\.com/);
  assert.match(handler, /api\.gdeltproject\.org/);
  assert.match(weather, /api\.open-meteo\.com/);
  assert.doesNotMatch(weather, /openweathermap|weatherapi|visualcrossing|accuweather/i);
});

test('outbound proxy list has no TeleGeography URL', () => {
  const outboundFiles = [
    'src/server/liveApiProxies.js',
    'src/server/openskyFlights.js',
    'src/data/gbfs.js',
    'src/data/adsbdb.js',
    'src/data/regionalBriefHandler.js',
    'vite.config.js',
    'src/data/telegeographySubmarineCables.js',
  ];
  const urls = [];
  for (const relative of outboundFiles) {
    const source = readFileSync(path.join(ROOT, relative), 'utf8');
    for (const match of source.matchAll(/https:\/\/[^\s'"`,)]+/g)) {
      urls.push(match[0]);
    }
  }
  assert.ok(urls.length > 0, 'outbound URL list must be non-empty');
  assert.equal(
    urls.filter((url) => /telegeography|submarinecablemap/i.test(url)).length,
    0,
    'TeleGeography hosts must not appear in the outbound list',
  );
});

test('layer list has no OpenSky enable control', () => {
  assert.equal(flightsLayer.id, 'flights');
  assert.equal(flightsLayer.name, 'Live Flights');
  assert.equal(flightsLayer.source, 'adsb.lol');
  assert.doesNotMatch(flightsLayer.name, /opensky/i);
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /OpenSky/);
});

test('in-app credits omit OpenSky, Google News RSS, and TeleGeography', () => {
  const keys = DATA_CREDITS.map((credit) => credit.key);
  assert.ok(!keys.includes('opensky'));
  assert.ok(!keys.includes('google-news-rss'));
  assert.ok(!keys.includes('telegeography'));
  assert.ok(!keys.includes('aisstream'), 'AISStream credit is dynamic; hosted empty state must not show it');
  assert.ok(keys.includes('adsblol'));
  assert.ok(keys.includes('adsbdb'));
  assert.ok(keys.includes('gdelt'));
  assert.ok(keys.includes('open-meteo'));
  assert.ok(keys.includes('tfl-cctv'));
  assert.ok(keys.includes('osrm'));
  const osrm = DATA_CREDITS.find((credit) => credit.key === 'osrm');
  assert.match(osrm.html, /OSRM/);
  assert.match(osrm.html, /OpenStreetMap contributors/);
  assert.match(osrm.html, /ODbL/);
  assert.ok(keys.includes('radio-browser'));
  const radio = DATA_CREDITS.find((credit) => credit.key === 'radio-browser');
  assert.match(radio.html, /Radio Browser/);
});

test('AIS stays BYOK on a long-lived Node host; hosted Vercel does not wrap AISStream', () => {
  assert.match(AISSTREAM_CREDIT.html, /AISStream\.io/);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live.js')), false);
  const client = readFileSync(path.join(ROOT, 'src/data/aisLiveVessels.js'), 'utf8');
  assert.doesNotMatch(client, /wss:\/\/stream\.aisstream\.io/);
  assert.doesNotMatch(client, /new WebSocket\(/);
  assert.doesNotMatch(client, /updateInterval:\s*aisRetryInSec/);
});

test('TeleGeography cable GeoJSON is not present on disk', () => {
  assert.equal(
    existsSync(path.join(ROOT, 'src/data/local_data/telegeography_submarine_cables')),
    false,
  );
});

test('flights proxy plugin is still installed for the compatibility path', () => {
  const config = createViteConfig({ mode: 'test' });
  const byName = new Map(config.plugins.map((plugin) => [plugin.name, plugin]));
  assert.equal(typeof byName.get('opensky-proxy')?.configureServer, 'function');
  assert.equal(typeof byName.get('adsbdb-proxy')?.configureServer, 'function');
  assert.equal(typeof byName.get('adsblol-proxy')?.configureServer, 'function');
  assert.equal(typeof byName.get('meridian-billing')?.configureServer, 'function');
});

test('client bundle defines never include Stripe or Clerk secrets', () => {
  const define = createViteConfig({ mode: 'test' }).define;
  const serialized = JSON.stringify(define);
  assert.match(serialized, /CLERK_PUBLISHABLE_KEY/);
  assert.doesNotMatch(serialized, /CLERK_SECRET_KEY/);
  assert.doesNotMatch(serialized, /STRIPE_SECRET_KEY/);
  assert.doesNotMatch(serialized, /STRIPE_WEBHOOK_SECRET/);
  assert.doesNotMatch(serialized, /STRIPE_PRICE_PRO/);
  assert.doesNotMatch(serialized, /OPENAI_API_KEY/);
});
