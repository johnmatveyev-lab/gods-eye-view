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
import { DATA_CREDITS } from './dataCredits.js';
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
  const vite = readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
  const adsbdb = readFileSync(path.join(ROOT, 'src/data/adsbdb.js'), 'utf8');
  for (const source of [vite, adsbdb]) {
    assert.doesNotMatch(source, /https:\/\/opensky-network\.org/);
    assert.doesNotMatch(source, /https:\/\/auth\.opensky-network\.org/);
    assert.doesNotMatch(source, /news\.google\.com/);
  }
  assert.match(vite, /api\.adsb\.lol/);
  assert.match(vite, /api\.gdeltproject\.org/);
  assert.match(adsbdb, /api\.adsbdb\.com/);
});

test('in-app credits omit OpenSky, Google News RSS, and TeleGeography', () => {
  const keys = DATA_CREDITS.map((credit) => credit.key);
  assert.ok(!keys.includes('opensky'));
  assert.ok(!keys.includes('google-news-rss'));
  assert.ok(!keys.includes('telegeography'));
  assert.ok(keys.includes('adsblol'));
  assert.ok(keys.includes('adsbdb'));
  assert.ok(keys.includes('gdelt'));
  assert.ok(keys.includes('open-meteo'));
  assert.ok(keys.includes('tfl-cctv'));
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
