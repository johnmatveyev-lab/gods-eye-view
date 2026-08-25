// PLAN 69 — Traffic: Live | Sim. Live uses /api/tomtom when status.hasKey.
// Sim is the built-in model and must not request tiles. Credit only after a
// live tile paint. Share URLs stay out. No extra /api.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DEFAULT_TRAFFIC_SOURCE,
  TRAFFIC_SOURCE_STORAGE_KEY,
  getTrafficSource,
  normalizeTrafficSource,
  readTrafficSource,
  resetTrafficSourceCache,
  resolveTrafficSource,
  setTrafficSource,
  shouldRegisterTomTomCredit,
  trafficSourceControls,
  trafficUsesLiveTiles,
  writeTrafficSource,
} from './trafficSource.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test('the stored key is meridian.trafficSource and the keyed default is live', () => {
  assert.equal(TRAFFIC_SOURCE_STORAGE_KEY, 'meridian.trafficSource');
  assert.equal(DEFAULT_TRAFFIC_SOURCE, 'live');
  assert.equal(normalizeTrafficSource('sim'), 'sim');
  assert.equal(normalizeTrafficSource('live'), 'live');
  assert.equal(normalizeTrafficSource('bogus'), 'live');
  assert.equal(normalizeTrafficSource(null), 'live');
});

test('no key: Live disabled, Sim works, no TomTom fetch', () => {
  assert.equal(resolveTrafficSource({ hasKey: false, preference: 'live' }), 'sim');
  assert.equal(trafficUsesLiveTiles({ hasKey: false, source: 'live' }), false);
  assert.equal(trafficUsesLiveTiles({ hasKey: false, source: 'sim' }), false);

  const controls = trafficSourceControls({ hasKey: false, source: 'live' });
  assert.equal(controls.heading, 'Traffic');
  const live = controls.chips.find((chip) => chip.id === 'traffic-source-live');
  const sim = controls.chips.find((chip) => chip.id === 'traffic-source-sim');
  assert.equal(live.disabled, true);
  assert.equal(live.active, false);
  assert.equal(sim.disabled, false);
  assert.equal(sim.active, true);
  assert.equal(sim.label, 'Sim');
  assert.equal(live.label, 'Live');
});

test('with key: Live fetches tiles; Sim stops fetches', () => {
  assert.equal(resolveTrafficSource({ hasKey: true, preference: 'live' }), 'live');
  assert.equal(trafficUsesLiveTiles({ hasKey: true, source: 'live' }), true);
  assert.equal(trafficUsesLiveTiles({ hasKey: true, source: 'sim' }), false);

  const liveOn = trafficSourceControls({ hasKey: true, source: 'live' });
  assert.equal(liveOn.chips.find((chip) => chip.id === 'traffic-source-live').disabled, false);
  assert.equal(liveOn.chips.find((chip) => chip.id === 'traffic-source-live').active, true);
  assert.equal(liveOn.chips.find((chip) => chip.id === 'traffic-source-sim').active, false);

  const simOn = trafficSourceControls({ hasKey: true, source: 'sim' });
  assert.equal(simOn.chips.find((chip) => chip.id === 'traffic-source-sim').active, true);
  assert.equal(simOn.chips.find((chip) => chip.id === 'traffic-source-live').active, false);
  assert.equal(simOn.chips.find((chip) => chip.id === 'traffic-source-live').disabled, false);
});

test('budget 429: Sim still available', () => {
  const controls = trafficSourceControls({
    hasKey: true,
    source: 'live',
    flowError: 'TomTom daily budget reached',
  });
  const sim = controls.chips.find((chip) => chip.id === 'traffic-source-sim');
  assert.equal(sim.disabled, false);
  assert.match(sim.title, /TomTom daily budget reached/);
  assert.equal(trafficUsesLiveTiles({ hasKey: true, source: 'sim' }), false);
});

test('TomTom credit only after Live actually painted a tile', () => {
  assert.equal(shouldRegisterTomTomCredit({ liveMode: true, paintedTile: false }), false);
  assert.equal(shouldRegisterTomTomCredit({ liveMode: false, paintedTile: true }), false);
  assert.equal(shouldRegisterTomTomCredit({ liveMode: false, paintedTile: false }), false);
  assert.equal(shouldRegisterTomTomCredit({ liveMode: true, paintedTile: true }), true);
});

test('reload keeps a Sim choice and writes live|sim only', () => {
  const storage = memoryStorage();
  assert.equal(writeTrafficSource('sim', storage), 'sim');
  assert.equal(storage.getItem(TRAFFIC_SOURCE_STORAGE_KEY), 'sim');
  resetTrafficSourceCache();
  assert.equal(readTrafficSource(storage), 'sim');
  assert.equal(writeTrafficSource('LIVE', storage), 'live');
  assert.equal(storage.getItem(TRAFFIC_SOURCE_STORAGE_KEY), 'live');
});

test('empty or unreadable storage keeps the keyed Live default', () => {
  resetTrafficSourceCache();
  assert.equal(readTrafficSource(memoryStorage()), 'live');
  assert.equal(readTrafficSource(null), 'live');
  assert.equal(readTrafficSource({
    getItem() {
      throw new Error('blocked');
    },
  }), 'live');
});

test('get/setTrafficSource persist through a cache reset the way a reload would', () => {
  const storage = memoryStorage();
  resetTrafficSourceCache();
  assert.equal(getTrafficSource(storage), 'live');
  assert.equal(setTrafficSource('sim', storage), 'sim');
  resetTrafficSourceCache();
  assert.equal(getTrafficSource(storage), 'sim');
});

test('the traffic layer gates tile fetches and credit on the source helpers', () => {
  const traffic = readFileSync(path.join(ROOT, 'src/data/traffic.js'), 'utf8');
  assert.match(traffic, /from '\.\/trafficSource\.js'/);
  assert.match(traffic, /trafficUsesLiveTiles\(/);
  assert.match(traffic, /shouldRegisterTomTomCredit\(/);
  assert.match(traffic, /trafficSourceControls\(/);
  assert.match(traffic, /getRowControls\(/);
  assert.match(traffic, /params\.trafficSource/);

  const statusFn = traffic.slice(
    traffic.indexOf('function ensureFlowStatus()'),
    traffic.indexOf('async function applyFlowToRoads'),
  );
  assert.doesNotMatch(statusFn, /registerDynamicCredit/);
  assert.match(statusFn, /hasKey/);

  const applyFn = traffic.slice(
    traffic.indexOf('async function applyFlowToRoads'),
    traffic.indexOf('async function applyFlowThenRender'),
  );
  assert.match(applyFn, /fetchFlowForBounds/);
  assert.match(applyFn, /shouldRegisterTomTomCredit/);
  assert.match(applyFn, /registerDynamicCredit\(_viewer, TOMTOM_CREDIT\)/);
  assert.match(applyFn, /trafficUsesLiveTiles/);

  const warmup = traffic.slice(
    traffic.indexOf('ensureFlowStatus().then(() => {'),
    traffic.indexOf('_fetching = true;'),
  );
  assert.match(warmup, /trafficUsesLiveTiles/);
});

test('share URLs do not carry the traffic source preference', () => {
  const share = readFileSync(path.join(ROOT, 'src/sharelink.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  assert.equal(share.includes('meridian.trafficSource'), false);
  assert.doesNotMatch(share, /params\.set\('trafficSource'/);
  assert.match(layerState, /id: 'traffic', token: 't', disposition: 'enabled-only'/);
});

test('no extra /api route is added for the source toggle', () => {
  const traffic = readFileSync(path.join(ROOT, 'src/data/traffic.js'), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/trafficSource.js'), 'utf8');
  assert.doesNotMatch(traffic, /\/api\/traffic-source/);
  assert.doesNotMatch(source, /\/api\/traffic-source/);
  assert.match(traffic, /\/api\/tomtom\/status/);
  assert.match(source, /\/api\/tomtom/);
});
