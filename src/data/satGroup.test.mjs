// PLAN 65 — CelesTrak group picker. Persist meridian.satGroup.
// Lists only groups the existing /api/celestrak proxy already allows
// (/^[a-z0-9-]+$/i) and that the sats client already requests, plus weather.
// Do not add `active` (launches; CelesTrak 403s it without UA).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CELESTRAK_GROUP_RE } from './celestrak.js';
import {
  DEFAULT_SAT_GROUP,
  SAT_GROUP_STORAGE_KEY,
  SAT_GROUPS,
  getSatGroup,
  listSatGroups,
  normalizeSatGroup,
  readSatGroupPreference,
  resetSatGroupCache,
  setSatGroup,
  writeSatGroupPreference,
} from './satGroup.js';

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

test('the stored key is meridian.satGroup and the default is stations', () => {
  assert.equal(SAT_GROUP_STORAGE_KEY, 'meridian.satGroup');
  assert.equal(DEFAULT_SAT_GROUP, 'stations');
  assert.equal(normalizeSatGroup('weather'), 'weather');
  assert.equal(normalizeSatGroup('stations'), 'stations');
  assert.equal(normalizeSatGroup('bogus'), 'stations');
  assert.equal(normalizeSatGroup('active'), 'stations');
  assert.equal(normalizeSatGroup('../etc'), 'stations');
  assert.equal(normalizeSatGroup(null), 'stations');
});

test('picker lists only regex-safe groups the sats client already requests, plus weather', () => {
  const ids = listSatGroups().map((group) => group.id);
  assert.deepEqual(ids, [
    'stations',
    'weather',
    'visual',
    'gps-ops',
    'glo-ops',
    'galileo',
    'geo',
  ]);
  for (const id of ids) {
    assert.match(id, CELESTRAK_GROUP_RE);
  }
  assert.equal(ids.includes('active'), false, 'active is launches-only and 403s without UA');
  assert.equal(ids.includes('starlink'), false, 'starlink stays on the DENSE chip');
  assert.equal(ids.includes('analyst'), false);
  assert.equal(ids.includes('last-30-days'), false);

  const satellites = readFileSync(path.join(ROOT, 'src/data/satellites.js'), 'utf8');
  for (const id of ids) {
    if (id === 'weather') continue;
    assert.match(satellites, new RegExp(`path: '${id}'`));
  }
  assert.match(satellites, /DENSE_GROUP_PATH = 'starlink'/);
  const launches = readFileSync(path.join(ROOT, 'src/data/rocketLaunches.js'), 'utf8');
  assert.match(launches, /fetch\('\/api\/celestrak\/active'\)/);
});

test('invalid or unknown groups are not shown and fall back to stations', () => {
  const ids = new Set(listSatGroups().map((group) => group.id));
  for (const bad of ['active', 'starlink', '../etc', 'not-a-group', '', 'WEATHER SATS']) {
    assert.equal(ids.has(bad), false, bad);
    assert.equal(normalizeSatGroup(bad), 'stations');
  }
  assert.equal(SAT_GROUPS.some((group) => group.id === 'active'), false);
});

test('reload keeps a Weather choice and writes the CelesTrak path only', () => {
  const storage = memoryStorage();
  assert.equal(writeSatGroupPreference('weather', storage), 'weather');
  assert.equal(storage.getItem(SAT_GROUP_STORAGE_KEY), 'weather');
  resetSatGroupCache();
  assert.equal(readSatGroupPreference(storage), 'weather');

  assert.equal(writeSatGroupPreference('GLO-OPS', storage), 'glo-ops');
  assert.equal(storage.getItem(SAT_GROUP_STORAGE_KEY), 'glo-ops');
});

test('empty or unreadable storage keeps the stations default', () => {
  resetSatGroupCache();
  assert.equal(readSatGroupPreference(memoryStorage()), 'stations');
  assert.equal(readSatGroupPreference(null), 'stations');
  assert.equal(readSatGroupPreference({
    getItem() {
      throw new Error('blocked');
    },
  }), 'stations');
});

test('get/set use the cache and survive a hostile setItem', () => {
  resetSatGroupCache();
  const storage = memoryStorage({ [SAT_GROUP_STORAGE_KEY]: 'geo' });
  assert.equal(getSatGroup(storage), 'geo');
  assert.equal(setSatGroup('weather', storage), 'weather');
  assert.equal(getSatGroup(storage), 'weather');

  const hostile = {
    getItem() { return 'visual'; },
    setItem() { throw new Error('blocked'); },
  };
  resetSatGroupCache();
  assert.equal(setSatGroup('galileo', hostile), 'galileo');
});

test('share URLs do not carry the sat group preference', () => {
  const share = readFileSync(path.join(ROOT, 'src/sharelink.js'), 'utf8');
  assert.equal(share.includes('meridian.satGroup'), false);
  assert.doesNotMatch(share, /params\.set\('satGroup'/);
  assert.doesNotMatch(share, /params\.get\('satGroup'/);
});

test('legal: Meridian title, CelesTrak credit, MIT copyright; no forbidden sources', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const credits = readFileSync(path.join(ROOT, 'src/data/dataCredits.js'), 'utf8');
  const module = readFileSync(path.join(ROOT, 'src/data/satGroup.js'), 'utf8');
  const satellites = readFileSync(path.join(ROOT, 'src/data/satellites.js'), 'utf8');

  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(credits, /CelesTrak/);
  assert.match(credits, /celestrak\.org/);
  assert.doesNotMatch(module, /opensky|news\.google|telegeography|quantum-earth|God's Eye View/i);
  assert.doesNotMatch(satellites, /\/api\/celestrak\/active/);
  assert.match(satellites, /\/api\/celestrak\/\$\{/);
});
