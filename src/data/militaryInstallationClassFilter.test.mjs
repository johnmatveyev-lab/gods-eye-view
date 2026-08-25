// PLAN 151 — Military installation class chips. Client-only filter of
// already-fetched OSM/Places records. Distinct from 65–150.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_INSTALLATION_CLASS_FILTER,
  INSTALLATION_CLASS_CHIP_IDS,
  decodeInstallationClassFilter,
  encodeInstallationClassFilter,
  filterInstallationsByClass,
  installationClassFamily,
  installationClassFilterFlags,
  installationMatchesClassFilter,
  normalizeInstallationClassFilter,
  toggleInstallationClassFilter,
} from './militaryInstallationClassFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const MIXED = Object.freeze([
  { id: 'osm:node:1', class: 'airfield', name: 'Airfield' },
  { id: 'osm:node:2', class: 'naval_base', name: 'Naval' },
  { id: 'osm:way:3', class: 'range', name: 'Range' },
  { id: 'osm:way:4', class: 'military_land', name: 'Land' },
  { id: 'google:5', class: 'places_candidate', name: 'Places' },
  { id: 'osm:node:6', class: '', name: 'Blank class' },
  { id: 'osm:node:7', name: 'Missing class' },
  { id: 'osm:node:8', class: 'depot', name: 'Unknown class' },
]);

test('class chips default all on and match the unfiltered set', () => {
  assert.deepEqual([...INSTALLATION_CLASS_CHIP_IDS], [
    'airfield', 'naval', 'range', 'land', 'places',
  ]);
  assert.equal(DEFAULT_INSTALLATION_CLASS_FILTER, 'all');
  assert.equal(normalizeInstallationClassFilter(null), 'all');
  assert.equal(normalizeInstallationClassFilter('ANRLP'), 'all');
  assert.deepEqual(installationClassFilterFlags('all'), {
    airfield: true,
    naval: true,
    range: true,
    land: true,
    places: true,
  });
  assert.deepEqual(
    filterInstallationsByClass(MIXED, 'all').map((record) => record.id),
    MIXED.map((record) => record.id),
  );
});

test('Naval off hides naval_base and keeps the other classes', () => {
  assert.equal(installationClassFamily('airfield'), 'airfield');
  assert.equal(installationClassFamily('naval_base'), 'naval');
  assert.equal(installationClassFamily('range'), 'range');
  assert.equal(installationClassFamily('military_land'), 'land');
  assert.equal(installationClassFamily('places_candidate'), 'places');
  assert.equal(toggleInstallationClassFilter('all', 'naval'), 'ARLP');
  assert.equal(toggleInstallationClassFilter('ARLP', 'naval'), 'all');
  assert.deepEqual(
    filterInstallationsByClass(MIXED, 'ARLP').map((record) => record.id),
    ['osm:node:1', 'osm:way:3', 'osm:way:4', 'google:5', 'osm:node:6', 'osm:node:7', 'osm:node:8'],
  );
  assert.equal(installationMatchesClassFilter({ class: 'naval_base' }, 'ARLP'), false);
  assert.equal(installationMatchesClassFilter({ class: 'airfield' }, 'ARLP'), true);
});

test('missing and unknown class stay visible even when last-off empties known classes', () => {
  assert.equal(installationClassFamily(''), null);
  assert.equal(installationClassFamily(null), null);
  assert.equal(installationClassFamily('depot'), null);
  assert.equal(toggleInstallationClassFilter('A', 'airfield'), '0');
  assert.deepEqual(
    filterInstallationsByClass(MIXED, '0').map((record) => record.id),
    ['osm:node:6', 'osm:node:7', 'osm:node:8'],
  );
  assert.equal(installationMatchesClassFilter({ class: '' }, '0'), true);
  assert.equal(installationMatchesClassFilter({ class: 'depot' }, '0'), true);
  assert.equal(installationMatchesClassFilter({ class: 'naval_base' }, '0'), false);
});

test('selected installation stays when its class chip is off', () => {
  assert.equal(
    installationMatchesClassFilter({ id: 'osm:node:2', class: 'naval_base' }, 'ARLP', {
      selectedId: 'osm:node:2',
    }),
    true,
  );
  assert.deepEqual(
    filterInstallationsByClass(MIXED, 'ARLP', 'osm:node:2').map((record) => record.id),
    ['osm:node:1', 'osm:node:2', 'osm:way:3', 'osm:way:4', 'google:5', 'osm:node:6', 'osm:node:7', 'osm:node:8'],
  );
  assert.deepEqual(
    filterInstallationsByClass(MIXED, '0', 'osm:node:2').map((record) => record.id),
    ['osm:node:2', 'osm:node:6', 'osm:node:7', 'osm:node:8'],
  );
});

test('bogus class tokens are refused; share tokens round-trip', () => {
  assert.equal(normalizeInstallationClassFilter('bogus'), null);
  assert.equal(decodeInstallationClassFilter('xyz'), null);
  assert.equal(encodeInstallationClassFilter('all'), 'a');
  assert.equal(encodeInstallationClassFilter('ARLP'), 'arlp');
  assert.equal(decodeInstallationClassFilter('arlp'), 'ARLP');
  assert.equal(decodeInstallationClassFilter('0'), '0');
});

test('Sites list exposes Airfield | Naval | Range | Land | Places chips', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const layer = readFileSync(path.join(ROOT, 'src/data/militaryInstallations.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const panel = html.match(/<aside id="installations-viewport-list"[\s\S]*?<\/aside>/);
  assert.ok(panel, 'installations viewport list is missing');
  assert.match(panel[0], /id="installation-class-chips"/);
  assert.match(panel[0], /data-installation-class="airfield"[^>]*>Airfield</);
  assert.match(panel[0], /data-installation-class="naval"[^>]*>Naval</);
  assert.match(panel[0], /data-installation-class="range"[^>]*>Range</);
  assert.match(panel[0], /data-installation-class="land"[^>]*>Land</);
  assert.match(panel[0], /data-installation-class="places"[^>]*>Places</);
  assert.match(ui, /data-installation-class/);
  assert.match(ui, /setLayerParams\?\.\('military-installations'/);
  assert.match(ui, /installation-class-chips/);
  assert.match(layer, /installationClassFilter/);
  assert.match(layerState, /id: 'military-installations', token: 'i', disposition: 'enabled\+options'/);
  assert.match(layerState, /installationClassFilter/);
  assert.doesNotMatch(layer, /\/api\/military-installations\/class/);
  assert.equal(existsSync(path.join(ROOT, 'api/military-installations/class.js')), false);
  assert.doesNotMatch(layer, /OpenSky|Google News|TeleGeography|quantum-earth|God's Eye View/);
  const filterSrc = readFileSync(path.join(ROOT, 'src/data/militaryInstallationClassFilter.js'), 'utf8');
  assert.doesNotMatch(filterSrc, /earthquakes\.js|satellites\.js|OpenSky|Google News|TeleGeography/);
});
