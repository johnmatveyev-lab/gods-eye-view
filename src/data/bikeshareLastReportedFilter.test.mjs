import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BIKESHARE_LAST_REPORTED_STORAGE_KEY,
  BIKESHARE_LAST_REPORTED_WINDOWS,
  DEFAULT_BIKESHARE_LAST_REPORTED,
  bikeshareLastReportedMaxAgeSeconds,
  normalizeBikeshareLastReported,
  readPersistedBikeshareLastReported,
  stationMatchesBikeshareLastReported,
  writePersistedBikeshareLastReported,
} from './bikeshareLastReportedFilter.js';

const here = dirname(fileURLToPath(import.meta.url));
const NOW_MS = 1_700_000_000_000;
const nowSec = NOW_MS / 1000;

function station(lastReported, key = 'austin-capmetro:dock') {
  return { key, lastReported };
}

test('All is the default last-reported window and 15m / 60m are the shipped chips', () => {
  assert.equal(DEFAULT_BIKESHARE_LAST_REPORTED, 'all');
  assert.deepEqual(BIKESHARE_LAST_REPORTED_WINDOWS.map((entry) => entry.id), ['all', '15', '60']);
  assert.deepEqual(BIKESHARE_LAST_REPORTED_WINDOWS.map((entry) => entry.label), ['All', '15m', '60m']);
  assert.equal(bikeshareLastReportedMaxAgeSeconds('all'), null);
  assert.equal(bikeshareLastReportedMaxAgeSeconds('15'), 15 * 60);
  assert.equal(bikeshareLastReportedMaxAgeSeconds('60'), 60 * 60);
  assert.equal(bikeshareLastReportedMaxAgeSeconds('nope'), null);
});

test('normalize accepts only All | 15m | 60m chip ids', () => {
  assert.equal(normalizeBikeshareLastReported('all'), 'all');
  assert.equal(normalizeBikeshareLastReported(0), 'all');
  assert.equal(normalizeBikeshareLastReported('0'), 'all');
  assert.equal(normalizeBikeshareLastReported(15), '15');
  assert.equal(normalizeBikeshareLastReported('15'), '15');
  assert.equal(normalizeBikeshareLastReported('15m'), '15');
  assert.equal(normalizeBikeshareLastReported(60), '60');
  assert.equal(normalizeBikeshareLastReported('60'), '60');
  assert.equal(normalizeBikeshareLastReported('60m'), '60');
  assert.equal(normalizeBikeshareLastReported('nope'), null);
  assert.equal(normalizeBikeshareLastReported(30), null);
  assert.equal(normalizeBikeshareLastReported(undefined), null);
  assert.equal(normalizeBikeshareLastReported(null), null);
});

test('15m keeps a station reported 8 minutes ago and drops one reported 2 hours ago', () => {
  const fresh = station(nowSec - (8 * 60), 'austin-capmetro:fresh');
  const stale = station(nowSec - (2 * 60 * 60), 'austin-capmetro:stale');
  const hourOld = station(nowSec - (45 * 60), 'austin-capmetro:hour');

  assert.equal(stationMatchesBikeshareLastReported(fresh, 'all', { now: NOW_MS }), true);
  assert.equal(stationMatchesBikeshareLastReported(stale, 'all', { now: NOW_MS }), true);
  assert.equal(stationMatchesBikeshareLastReported(hourOld, 'all', { now: NOW_MS }), true);

  assert.equal(stationMatchesBikeshareLastReported(fresh, '15', { now: NOW_MS }), true);
  assert.equal(stationMatchesBikeshareLastReported(stale, '15', { now: NOW_MS }), false);
  assert.equal(stationMatchesBikeshareLastReported(hourOld, '15', { now: NOW_MS }), false);

  assert.equal(stationMatchesBikeshareLastReported(fresh, '60', { now: NOW_MS }), true);
  assert.equal(stationMatchesBikeshareLastReported(hourOld, '60', { now: NOW_MS }), true);
  assert.equal(stationMatchesBikeshareLastReported(stale, '60', { now: NOW_MS }), false,
    '60m is looser than 15m but still drops a 2-hour-old snapshot');
});

test('missing lastReported stays visible; All restores every station', () => {
  const fresh = station(nowSec - (8 * 60));
  const stale = station(nowSec - (2 * 60 * 60));

  assert.equal(stationMatchesBikeshareLastReported({ lastReported: Number.NaN }, '15', { now: NOW_MS }), true);
  assert.equal(stationMatchesBikeshareLastReported({ lastReported: null }, '15', { now: NOW_MS }), true);
  assert.equal(stationMatchesBikeshareLastReported({ lastReported: undefined }, '60', { now: NOW_MS }), true);
  assert.equal(stationMatchesBikeshareLastReported({}, '15', { now: NOW_MS }), true);
  assert.equal(stationMatchesBikeshareLastReported({ lastReported: Number.POSITIVE_INFINITY }, '15', { now: NOW_MS }), true);
  assert.equal(stationMatchesBikeshareLastReported(stale, '15', { selectedKey: stale.key, now: NOW_MS }), true);

  assert.equal(stationMatchesBikeshareLastReported(fresh, 'all', { now: NOW_MS }), true);
  assert.equal(stationMatchesBikeshareLastReported(stale, 'all', { now: NOW_MS }), true);
});

test('persist meridian.bikeshareLastReported and reject unknown values', () => {
  assert.equal(BIKESHARE_LAST_REPORTED_STORAGE_KEY, 'meridian.bikeshareLastReported');
  const storage = new Map();
  const store = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); },
  };
  assert.equal(writePersistedBikeshareLastReported('15', store), '15');
  assert.equal(storage.get(BIKESHARE_LAST_REPORTED_STORAGE_KEY), '15');
  assert.equal(readPersistedBikeshareLastReported(store), '15');
  assert.equal(writePersistedBikeshareLastReported('60', store), '60');
  assert.equal(storage.get(BIKESHARE_LAST_REPORTED_STORAGE_KEY), '60');
  assert.equal(writePersistedBikeshareLastReported('all', store), 'all');
  assert.equal(readPersistedBikeshareLastReported(store), 'all');
  assert.equal(writePersistedBikeshareLastReported('nope', store), null);
  assert.equal(storage.get(BIKESHARE_LAST_REPORTED_STORAGE_KEY), 'all');
  assert.equal(readPersistedBikeshareLastReported(null), null);
});

test('last-reported filter is client-only: no new /api path and chips hide with the bike layer', () => {
  const helper = readFileSync(join(here, 'bikeshareLastReportedFilter.js'), 'utf8');
  const layer = readFileSync(join(here, 'bikeshare.js'), 'utf8');
  const manager = readFileSync(join(here, 'manager.js'), 'utf8');
  const markup = readFileSync(join(here, '..', '..', 'index.html'), 'utf8');
  const ui = readFileSync(join(here, '..', 'ui.js'), 'utf8');

  assert.equal(/\bfetch\s*\(/.test(helper), false);
  assert.equal(/export\s+async\s+function|\/api\/gbfs\/\$\{/.test(helper), false);
  assert.match(helper, /meridian\.bikeshareLastReported/);
  assert.match(helper, /lastReported/);
  assert.match(layer, /stationMatchesBikeshareLastReported/);
  assert.match(layer, /record\.lastReported/);
  assert.match(layer, /last_reported/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.equal(/last-reported|lastReported|bikeshareLastReported/.test(markup), false);
  assert.equal(/last-reported|lastReported|bikeshareLastReported/.test(ui), false);
});
