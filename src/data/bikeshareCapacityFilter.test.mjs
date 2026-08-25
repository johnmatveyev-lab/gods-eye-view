import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BIKESHARE_CAPACITY_FLOORS,
  BIKESHARE_CAPACITY_STORAGE_KEY,
  DEFAULT_BIKESHARE_CAPACITY,
  bikeshareCapacityFloor,
  normalizeBikeshareCapacity,
  readPersistedBikeshareCapacity,
  stationMatchesBikeshareCapacity,
  writePersistedBikeshareCapacity,
} from './bikeshareCapacityFilter.js';

const here = dirname(fileURLToPath(import.meta.url));

function station(capacity, key = 'austin-capmetro:dock') {
  return { key, capacity };
}

test('All is the default capacity floor and 10+ / 20+ are the shipped chips', () => {
  assert.equal(DEFAULT_BIKESHARE_CAPACITY, 'all');
  assert.deepEqual(BIKESHARE_CAPACITY_FLOORS.map((entry) => entry.id), ['all', '10', '20']);
  assert.deepEqual(BIKESHARE_CAPACITY_FLOORS.map((entry) => entry.label), ['All', '10+', '20+']);
  assert.equal(bikeshareCapacityFloor('all'), 0);
  assert.equal(bikeshareCapacityFloor('10'), 10);
  assert.equal(bikeshareCapacityFloor('20'), 20);
  assert.equal(bikeshareCapacityFloor('nope'), 0);
});

test('normalize accepts only All | 10+ | 20+ chip ids', () => {
  assert.equal(normalizeBikeshareCapacity('all'), 'all');
  assert.equal(normalizeBikeshareCapacity(0), 'all');
  assert.equal(normalizeBikeshareCapacity('0'), 'all');
  assert.equal(normalizeBikeshareCapacity(10), '10');
  assert.equal(normalizeBikeshareCapacity('10'), '10');
  assert.equal(normalizeBikeshareCapacity('10+'), '10');
  assert.equal(normalizeBikeshareCapacity(20), '20');
  assert.equal(normalizeBikeshareCapacity('20'), '20');
  assert.equal(normalizeBikeshareCapacity('20+'), '20');
  assert.equal(normalizeBikeshareCapacity('nope'), null);
  assert.equal(normalizeBikeshareCapacity(15), null);
  assert.equal(normalizeBikeshareCapacity(undefined), null);
  assert.equal(normalizeBikeshareCapacity(null), null);
});

test('capacity 24 matches 20+; capacity 8 hides on 10+; All restores', () => {
  const hub = station(24, 'austin-capmetro:hub');
  const rack = station(8, 'austin-capmetro:rack');
  const mid = station(12, 'austin-capmetro:mid');

  assert.equal(stationMatchesBikeshareCapacity(hub, 'all'), true);
  assert.equal(stationMatchesBikeshareCapacity(rack, 'all'), true);
  assert.equal(stationMatchesBikeshareCapacity(mid, 'all'), true);

  assert.equal(stationMatchesBikeshareCapacity(hub, '10'), true);
  assert.equal(stationMatchesBikeshareCapacity(mid, '10'), true);
  assert.equal(stationMatchesBikeshareCapacity(rack, '10'), false);

  assert.equal(stationMatchesBikeshareCapacity(hub, '20'), true);
  assert.equal(stationMatchesBikeshareCapacity(mid, '20'), false, '20+ is stricter than 10+');
  assert.equal(stationMatchesBikeshareCapacity(rack, '20'), false);
});

test('missing capacity stays visible; All restores every station', () => {
  const hub = station(24);
  const rack = station(8);

  assert.equal(stationMatchesBikeshareCapacity({ capacity: Number.NaN }, '10'), true);
  assert.equal(stationMatchesBikeshareCapacity({ capacity: null }, '10'), true);
  assert.equal(stationMatchesBikeshareCapacity({ capacity: undefined }, '20'), true);
  assert.equal(stationMatchesBikeshareCapacity({}, '10'), true);
  assert.equal(stationMatchesBikeshareCapacity({ capacity: Number.POSITIVE_INFINITY }, '10'), true);
  assert.equal(stationMatchesBikeshareCapacity(rack, '10', { selectedKey: rack.key }), true);

  assert.equal(stationMatchesBikeshareCapacity(hub, 'all'), true);
  assert.equal(stationMatchesBikeshareCapacity(rack, 'all'), true);
});

test('persist meridian.bikeshareCapacity and reject unknown values', () => {
  assert.equal(BIKESHARE_CAPACITY_STORAGE_KEY, 'meridian.bikeshareCapacity');
  const storage = new Map();
  const store = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); },
  };
  assert.equal(writePersistedBikeshareCapacity('10', store), '10');
  assert.equal(storage.get(BIKESHARE_CAPACITY_STORAGE_KEY), '10');
  assert.equal(readPersistedBikeshareCapacity(store), '10');
  assert.equal(writePersistedBikeshareCapacity('20', store), '20');
  assert.equal(storage.get(BIKESHARE_CAPACITY_STORAGE_KEY), '20');
  assert.equal(writePersistedBikeshareCapacity('all', store), 'all');
  assert.equal(readPersistedBikeshareCapacity(store), 'all');
  assert.equal(writePersistedBikeshareCapacity('nope', store), null);
  assert.equal(storage.get(BIKESHARE_CAPACITY_STORAGE_KEY), 'all');
  assert.equal(readPersistedBikeshareCapacity(null), null);
});

test('capacity filter is client-only: no new /api path and chips hide with the bike layer', () => {
  const helper = readFileSync(join(here, 'bikeshareCapacityFilter.js'), 'utf8');
  const layer = readFileSync(join(here, 'bikeshare.js'), 'utf8');
  const manager = readFileSync(join(here, 'manager.js'), 'utf8');
  const markup = readFileSync(join(here, '..', '..', 'index.html'), 'utf8');
  const ui = readFileSync(join(here, '..', 'ui.js'), 'utf8');

  assert.equal(/\bfetch\s*\(/.test(helper), false);
  assert.equal(/export\s+async\s+function|\/api\/gbfs\/\$\{/.test(helper), false);
  assert.match(helper, /meridian\.bikeshareCapacity/);
  assert.match(helper, /record\.capacity/);
  assert.match(layer, /stationMatchesBikeshareCapacity/);
  assert.match(layer, /record\.capacity/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.equal(/capacity-all|bikeshareCapacity|meridian\.bikeshareCapacity/.test(markup), false);
  assert.equal(/capacity-all|bikeshareCapacity|meridian\.bikeshareCapacity/.test(ui), false);
});
