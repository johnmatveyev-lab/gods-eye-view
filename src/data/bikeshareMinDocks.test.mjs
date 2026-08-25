import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BIKESHARE_MIN_DOCKS_FLOORS,
  DEFAULT_BIKESHARE_MIN_DOCKS,
  bikeshareMinDocksFloor,
  normalizeBikeshareMinDocks,
  stationMatchesBikeshareMinDocks,
} from './bikeshareMinDocks.js';

const here = dirname(fileURLToPath(import.meta.url));

test('All is the default min-docks floor and 3+ / 5+ are the shipped chips', () => {
  assert.equal(DEFAULT_BIKESHARE_MIN_DOCKS, 'all');
  assert.deepEqual(BIKESHARE_MIN_DOCKS_FLOORS.map((entry) => entry.id), ['all', '3', '5']);
  assert.deepEqual(BIKESHARE_MIN_DOCKS_FLOORS.map((entry) => entry.label), ['All', '3+', '5+']);
  assert.equal(bikeshareMinDocksFloor('all'), 0);
  assert.equal(bikeshareMinDocksFloor('3'), 3);
  assert.equal(bikeshareMinDocksFloor('5'), 5);
  assert.equal(bikeshareMinDocksFloor('nope'), 0);
});

test('normalize accepts only All | 3+ | 5+ chip ids', () => {
  assert.equal(normalizeBikeshareMinDocks('all'), 'all');
  assert.equal(normalizeBikeshareMinDocks(0), 'all');
  assert.equal(normalizeBikeshareMinDocks('0'), 'all');
  assert.equal(normalizeBikeshareMinDocks(3), '3');
  assert.equal(normalizeBikeshareMinDocks('3'), '3');
  assert.equal(normalizeBikeshareMinDocks(5), '5');
  assert.equal(normalizeBikeshareMinDocks('5'), '5');
  assert.equal(normalizeBikeshareMinDocks('nope'), null);
  assert.equal(normalizeBikeshareMinDocks(4), null);
  assert.equal(normalizeBikeshareMinDocks(undefined), null);
});

test('3+ hides 0–2 open docks; 5+ is stricter; missing docks stay visible', () => {
  const zero = { key: 'austin-capmetro:zero', docksAvailable: 0 };
  const two = { key: 'austin-capmetro:two', docksAvailable: 2 };
  const three = { key: 'austin-capmetro:three', docksAvailable: 3 };
  const four = { key: 'austin-capmetro:four', docksAvailable: 4 };
  const five = { key: 'austin-capmetro:five', docksAvailable: 5 };

  assert.equal(stationMatchesBikeshareMinDocks(zero, 'all'), true);
  assert.equal(stationMatchesBikeshareMinDocks(two, 'all'), true);
  assert.equal(stationMatchesBikeshareMinDocks(five, 'all'), true);

  assert.equal(stationMatchesBikeshareMinDocks(zero, '3'), false);
  assert.equal(stationMatchesBikeshareMinDocks(two, '3'), false);
  assert.equal(stationMatchesBikeshareMinDocks(three, '3'), true);
  assert.equal(stationMatchesBikeshareMinDocks(four, '3'), true);
  assert.equal(stationMatchesBikeshareMinDocks(five, '3'), true);

  assert.equal(stationMatchesBikeshareMinDocks(three, '5'), false, '5+ is stricter than 3+');
  assert.equal(stationMatchesBikeshareMinDocks(four, '5'), false);
  assert.equal(stationMatchesBikeshareMinDocks(five, '5'), true);

  assert.equal(stationMatchesBikeshareMinDocks({ docksAvailable: Number.NaN }, '5'), true);
  assert.equal(stationMatchesBikeshareMinDocks({ docksAvailable: null }, '5'), true);
  assert.equal(stationMatchesBikeshareMinDocks({ docksAvailable: undefined }, '3'), true);
  assert.equal(stationMatchesBikeshareMinDocks({}, '5'), true);
  assert.equal(stationMatchesBikeshareMinDocks(two, '3', { selectedKey: two.key }), true);
});

test('min-docks is client-only: no new /api path and chips hide with the bike layer', () => {
  const helper = readFileSync(join(here, 'bikeshareMinDocks.js'), 'utf8');
  const layer = readFileSync(join(here, 'bikeshare.js'), 'utf8');
  const persist = readFileSync(join(here, 'bikeshareSystems.js'), 'utf8');
  const manager = readFileSync(join(here, 'manager.js'), 'utf8');
  const markup = readFileSync(join(here, '..', '..', 'index.html'), 'utf8');
  const ui = readFileSync(join(here, '..', 'ui.js'), 'utf8');

  assert.equal(/\bfetch\s*\(/.test(helper), false);
  assert.equal(/export\s+async\s+function|\/api\/gbfs\/\$\{/.test(helper), false);
  assert.match(persist, /meridian\.bikeshare\.minDocks/);
  assert.match(layer, /stationMatchesBikeshareMinDocks/);
  assert.match(layer, /minDocks/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.equal(/min-docks|minDocks/.test(markup), false);
  assert.equal(/min-docks|minDocks/.test(ui), false);
});
