import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BIKESHARE_EBIKES_ONLY_CHIP_LABEL,
  DEFAULT_BIKESHARE_EBIKES_ONLY,
  ebikesAvailableFromGbfsStation,
  isGbfsEbikeVehicleType,
  normalizeBikeshareEbikesOnly,
  stationMatchesBikeshareEbikesOnly,
} from './bikeshareEbikeFilter.js';

const here = dirname(fileURLToPath(import.meta.url));

test('E-bikes only defaults off and accepts only an explicit on/off', () => {
  assert.equal(DEFAULT_BIKESHARE_EBIKES_ONLY, false);
  assert.equal(BIKESHARE_EBIKES_ONLY_CHIP_LABEL, 'E-bikes only');
  assert.equal(normalizeBikeshareEbikesOnly(true), true);
  assert.equal(normalizeBikeshareEbikesOnly('1'), true);
  assert.equal(normalizeBikeshareEbikesOnly('true'), true);
  assert.equal(normalizeBikeshareEbikesOnly(1), true);
  assert.equal(normalizeBikeshareEbikesOnly(false), false);
  assert.equal(normalizeBikeshareEbikesOnly('0'), false);
  assert.equal(normalizeBikeshareEbikesOnly('false'), false);
  assert.equal(normalizeBikeshareEbikesOnly(0), false);
  assert.equal(normalizeBikeshareEbikesOnly('nope'), null);
  assert.equal(normalizeBikeshareEbikesOnly(undefined), null);
  assert.equal(normalizeBikeshareEbikesOnly(null), null);
  assert.equal(normalizeBikeshareEbikesOnly(''), null);
});

test('off keeps every station; on hides only finite zero e-bikes', () => {
  const zero = { key: 'austin-capmetro:zero', ebikesAvailable: 0 };
  const stocked = { key: 'austin-capmetro:stocked', ebikesAvailable: 2 };
  const unknown = { key: 'austin-capmetro:unknown' };

  assert.equal(stationMatchesBikeshareEbikesOnly(zero, false), true);
  assert.equal(stationMatchesBikeshareEbikesOnly(stocked, false), true);
  assert.equal(stationMatchesBikeshareEbikesOnly(unknown, false), true);

  assert.equal(stationMatchesBikeshareEbikesOnly(zero, true), false);
  assert.equal(stationMatchesBikeshareEbikesOnly(stocked, true), true);
  assert.equal(stationMatchesBikeshareEbikesOnly(unknown, true), true,
    'missing ebikesAvailable stays visible');
  assert.equal(stationMatchesBikeshareEbikesOnly({ ebikesAvailable: Number.NaN }, true), true);
  assert.equal(stationMatchesBikeshareEbikesOnly({ ebikesAvailable: null }, true), true);
  assert.equal(stationMatchesBikeshareEbikesOnly({ ebikesAvailable: Number.POSITIVE_INFINITY }, true), true);
  assert.equal(stationMatchesBikeshareEbikesOnly(zero, true, { selectedKey: zero.key }), true);
});

test('normalize prefers num_ebikes_available over vehicle_types_available', () => {
  assert.equal(ebikesAvailableFromGbfsStation({
    num_ebikes_available: 4,
    vehicle_types_available: [
      { vehicle_type_id: 'FIT', count: 3 },
      { vehicle_type_id: 'EFIT', count: 1 },
    ],
  }), 4);
  assert.equal(ebikesAvailableFromGbfsStation({
    num_ebikes_available: 0,
    vehicle_types_available: [{ vehicle_type_id: 'ebike', count: 7 }],
  }), 0, 'explicit zero wins over typed counts');
  assert.equal(ebikesAvailableFromGbfsStation({
    num_ebikes_available: '2',
  }), 2);
});

test('missing num_ebikes_available sums identifiable e-bike type counts', () => {
  assert.equal(ebikesAvailableFromGbfsStation({
    vehicle_types_available: [
      { vehicle_type_id: 'FIT', count: 3 },
      { vehicle_type_id: 'BOOST', count: 1 },
      { vehicle_type_id: 'EFIT', count: 2 },
    ],
  }), 3);
  assert.equal(ebikesAvailableFromGbfsStation({
    vehicle_types_available: [
      { vehicle_type_id: 'COSMO', count: 1 },
      { vehicle_type_id: 'ASTRO', count: 4 },
      { vehicle_type_id: 'ICONIC', count: 6 },
    ],
  }), 5);
  assert.equal(ebikesAvailableFromGbfsStation({
    vehicle_types_available: [
      { vehicle_type_id: 'ebike', count: 2 },
      { vehicle_type_id: 'e-bike', count: 1 },
      { vehicle_type_id: 'classic', count: 8 },
    ],
  }), 3);
  assert.equal(ebikesAvailableFromGbfsStation({
    vehicle_types_available: [
      { vehicle_type_id: 'FIT', count: 4 },
      { vehicle_type_id: 'BOOST', count: 0 },
      { vehicle_type_id: 'EFIT', count: 0 },
    ],
  }), 0);
  assert.equal(ebikesAvailableFromGbfsStation({
    vehicle_types_available: [
      { vehicle_type_id: '1', count: 3 },
      { vehicle_type_id: '2', count: 10 },
    ],
  }), null, 'opaque Lyft type ids stay unknown without num_ebikes_available');
  assert.equal(ebikesAvailableFromGbfsStation({
    vehicle_types_available: [
      { vehicle_type_id: 'CHLOE', count: 2, propulsion_type: 'electric', form_factor: 'scooter_standing' },
    ],
  }), null, 'electric scooters are not e-bikes');
  assert.equal(ebikesAvailableFromGbfsStation({
    vehicle_types_available: [
      { vehicle_type_id: 'x', count: 2, propulsion_type: 'electric_assist' },
    ],
  }), 2);
  assert.equal(ebikesAvailableFromGbfsStation({}), null);
  assert.equal(ebikesAvailableFromGbfsStation({ num_ebikes_available: 'nope' }), null);
});

test('isGbfsEbikeVehicleType recognizes PBSC and named e-bike ids', () => {
  assert.equal(isGbfsEbikeVehicleType({ vehicle_type_id: 'BOOST' }), true);
  assert.equal(isGbfsEbikeVehicleType({ vehicle_type_id: 'efit' }), true);
  assert.equal(isGbfsEbikeVehicleType({ vehicle_type_id: 'FIT' }), false);
  assert.equal(isGbfsEbikeVehicleType({ vehicle_type_id: 'ICONIC' }), false);
  assert.equal(isGbfsEbikeVehicleType({ vehicle_type_id: '1' }), false);
  assert.equal(isGbfsEbikeVehicleType({ vehicle_type_id: 'ebike' }), true);
  assert.equal(isGbfsEbikeVehicleType({
    vehicle_type_id: '2',
    propulsion_type: 'electric_assist',
  }), true);
});

test('e-bike filter is client-only: no new /api path and chips hide with the bike layer', () => {
  const helper = readFileSync(join(here, 'bikeshareEbikeFilter.js'), 'utf8');
  const layer = readFileSync(join(here, 'bikeshare.js'), 'utf8');
  const persist = readFileSync(join(here, 'bikeshareSystems.js'), 'utf8');
  const manager = readFileSync(join(here, 'manager.js'), 'utf8');
  const markup = readFileSync(join(here, '..', '..', 'index.html'), 'utf8');
  const ui = readFileSync(join(here, '..', 'ui.js'), 'utf8');

  assert.equal(/\bfetch\s*\(/.test(helper), false);
  assert.equal(/export\s+async\s+function|\/api\/gbfs\/\$\{/.test(helper), false);
  assert.match(helper, /num_ebikes_available/);
  assert.match(helper, /vehicle_types_available/);
  assert.match(persist, /meridian\.bikeshare\.ebikesOnly/);
  assert.match(layer, /stationMatchesBikeshareEbikesOnly/);
  assert.match(layer, /ebikesOnly/);
  assert.match(layer, /ebikesAvailableFromGbfsStation/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.equal(/ebikes-only|ebikesOnly|E-bikes only/.test(markup), false);
  assert.equal(/ebikes-only|ebikesOnly|E-bikes only/.test(ui), false);
});
