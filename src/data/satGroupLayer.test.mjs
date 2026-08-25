// PLAN 65 — switching meridian.satGroup refetches /api/celestrak/<group>
// and replaces the sats layer. Launches keeps /api/celestrak/active.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import satellitesLayer, {
  _catalogGroupForTest,
  _clearDenseCatalogStateForTest,
  _setDenseCatalogStateForTest,
} from './satellites.js';
import {
  SAT_GROUP_STORAGE_KEY,
  getSatGroup,
  listSatGroups,
  resetSatGroupCache,
  setSatGroup,
} from './satGroup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const tleFor = (satnum, name) => [
  name,
  `1 ${satnum}U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927`,
  `2 ${satnum}  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537`,
].join('\n');

const STATIONS_TLE = tleFor('33333', 'TIANHE');
const WEATHER_TLE = tleFor('28654', 'NOAA 18');
const VIEWER = { scene: { primitives: { add: (p) => p, remove() {} } } };

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

async function waitForFetch(urls, needle, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    if (urls.some((url) => url.includes(needle))) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('switching group fetches the new TLE set and updates the layer', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  const storage = memoryStorage();
  try {
    resetSatGroupCache();
    setSatGroup('stations', storage);
    globalThis.fetch = async (url) => {
      const href = String(url);
      urls.push(href);
      if (href.includes('/api/celestrak/weather')) {
        return { ok: true, text: async () => WEATHER_TLE };
      }
      if (href.includes('/api/celestrak/stations')) {
        return { ok: true, text: async () => STATIONS_TLE };
      }
      throw new Error(`unexpected catalog fetch ${href}`);
    };
    _setDenseCatalogStateForTest({});

    await satellitesLayer.update(VIEWER);
    assert.equal(getSatGroup(storage), 'stations');
    assert.ok(urls.some((url) => url === '/api/celestrak/stations'));
    assert.equal(_catalogGroupForTest(33333), 'stations');
    assert.equal(_catalogGroupForTest(28654), undefined);
    assert.equal(satellitesLayer.getStats().count, 1);

    urls.length = 0;
    satellitesLayer.setParams({ satGroup: 'weather' }, { storage });
    assert.equal(storage.getItem(SAT_GROUP_STORAGE_KEY), 'weather');
    assert.equal(satellitesLayer.getParams().satGroup, 'weather');
    await waitForFetch(urls, '/api/celestrak/weather');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(urls.some((url) => url === '/api/celestrak/weather'));
    assert.equal(urls.some((url) => url.includes('/api/celestrak/active')), false);
    assert.equal(_catalogGroupForTest(28654), 'weather');
    assert.equal(_catalogGroupForTest(33333), undefined, 'previous TLE set must be replaced');
    assert.equal(satellitesLayer.getStats().count, 1);
  } finally {
    globalThis.fetch = originalFetch;
    resetSatGroupCache();
    _clearDenseCatalogStateForTest();
  }
});

test('row controls list only allowlisted groups and hide unknown ones', () => {
  resetSatGroupCache();
  try {
    _setDenseCatalogStateForTest({});
    const selects = satellitesLayer.getRowControls().selects || [];
    const picker = selects.find((entry) => entry.id === 'sat-group');
    assert.ok(picker, 'sats row declares a group select');
    assert.equal(picker.label, 'Sats');
    assert.deepEqual(picker.options.map((option) => option.value), listSatGroups().map((g) => g.id));
    assert.equal(picker.options.some((option) => option.value === 'active'), false);
    assert.equal(picker.options.some((option) => option.value === '../etc'), false);
    assert.equal(picker.options.some((option) => option.value === 'starlink'), false);
    assert.equal(picker.options.some((option) => option.value === 'weather'), true);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('launches panel stays on /api/celestrak/active and is independent of satGroup', () => {
  const launches = readFileSync(path.join(ROOT, 'src/data/rocketLaunches.js'), 'utf8');
  assert.match(launches, /fetch\('\/api\/celestrak\/active'\)/);
  assert.doesNotMatch(launches, /meridian\.satGroup/);
  assert.doesNotMatch(launches, /from '\.\/satGroup\.js'/);
  const panel = readFileSync(path.join(ROOT, 'src/data/launchesPanel.js'), 'utf8');
  assert.match(panel, /LAUNCHES_FEED_URL = '\/api\/launches'/);
  assert.doesNotMatch(panel, /meridian\.satGroup/);
  assert.doesNotMatch(panel, /\/api\/celestrak/);
  const satellites = readFileSync(path.join(ROOT, 'src/data/satellites.js'), 'utf8');
  assert.doesNotMatch(satellites, /\/api\/celestrak\/active/);
});
