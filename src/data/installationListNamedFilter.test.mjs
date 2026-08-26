// PLAN 220 — Sites list Named only toggle. Client-only filter of
// already-fetched viewport rows. Distinct from 151 class, 165 footprints,
// 186 globe named, 202 osmType, 209 list mapped, and 212 globe mapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_SITES_NAMED_ONLY,
  SITES_NAMED_ONLY_CHIP_LABEL,
  SITES_NAMED_ONLY_CHIP_TITLE,
  SITES_NAMED_ONLY_STORAGE_KEY,
  filterInstallationsByNamedOnly,
  filterViewportSitesListNamed,
  installationListHasName,
  installationMatchesNamedListFilter,
  normalizeSitesNamedOnly,
  readSitesListNamedPref,
  readSitesNamedOnly,
  sitesNamedOnlyChipModel,
  writeSitesNamedOnly,
} from './installationListNamedFilter.js';
import { filterInstallationsByMappedOnly } from './installationListMappedFilter.js';
import { listViewportInstallations } from './installationsViewportList.js';
import { filterInstallationsByClass } from './militaryInstallationClassFilter.js';
import { filterInstallationsByFootprint } from './militaryFootprintFilter.js';
import { filterInstallationsByNamed } from './militaryNamedFilter.js';
import { filterInstallationsByOsmType } from './militaryOsmTypeFilter.js';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
  layerOptionsForRestore,
  normalizeLayerState,
} from './layerState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.hasOwn(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    snapshot() {
      return { ...data };
    },
  };
}

function record(overrides = {}) {
  return {
    id: 'osm:node:1',
    kind: 'installation',
    class: 'airfield',
    name: 'Bergstrom AFB',
    latitude: 30.1945,
    longitude: -97.67,
    osmType: 'node',
    hasName: true,
    footprint: null,
    ...overrides,
  };
}

const unnamedLand = record({
  id: 'osm:way:land',
  class: 'military_land',
  name: 'Military land',
  latitude: 30.22,
  longitude: -97.72,
  osmType: 'way',
  hasName: false,
});

const missingName = record({
  id: 'osm:node:legacy',
  class: 'range',
  name: 'Range',
  latitude: 30.24,
  longitude: -97.74,
});
delete missingName.hasName;

const MIXED = Object.freeze([
  record(),
  record({
    id: 'osm:way:2',
    class: 'naval_base',
    name: 'Naval Station',
    latitude: 30.2,
    longitude: -97.7,
    osmType: 'way',
    footprint: [[-97.71, 30.20], [-97.70, 30.20], [-97.70, 30.21]],
  }),
  record({
    id: 'google:abc',
    kind: 'place_candidate',
    class: 'places_candidate',
    name: 'Places Extra',
    latitude: 30.21,
    longitude: -97.71,
    osmType: undefined,
    hasName: true,
  }),
  unnamedLand,
  missingName,
]);

test('off keeps named and unnamed rows', () => {
  assert.equal(DEFAULT_SITES_NAMED_ONLY, false);
  assert.equal(filterViewportSitesListNamed, filterInstallationsByNamedOnly);
  assert.equal(readSitesListNamedPref, readSitesNamedOnly);
  assert.equal(SITES_NAMED_ONLY_CHIP_LABEL, 'Named only');
  assert.equal(SITES_NAMED_ONLY_CHIP_TITLE, 'Hide unnamed class-fallback sites from this list');
  assert.equal(SITES_NAMED_ONLY_STORAGE_KEY, 'meridian.sitesNamedOnly');
  assert.equal(normalizeSitesNamedOnly(undefined), false);
  assert.equal(normalizeSitesNamedOnly(null), false);
  assert.equal(normalizeSitesNamedOnly(''), false);
  assert.equal(normalizeSitesNamedOnly(false), false);
  assert.equal(normalizeSitesNamedOnly(true), true);
  assert.equal(normalizeSitesNamedOnly('1'), true);
  assert.equal(normalizeSitesNamedOnly('true'), true);
  assert.equal(normalizeSitesNamedOnly(0), false);
  assert.equal(normalizeSitesNamedOnly('bogus'), null);

  const off = listViewportInstallations(MIXED, { listNamedPref: false, listMappedPref: false });
  assert.deepEqual(
    off.map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.ok(off.some((row) => row.id === 'osm:way:land'));
  assert.equal(off.find((row) => row.id === 'osm:way:land')?.name, 'Military land');
  assert.deepEqual(
    filterInstallationsByNamedOnly(MIXED, false).map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterInstallationsByNamedOnly(null), []);
  assert.deepEqual(filterInstallationsByNamedOnly(undefined), []);
  assert.equal(installationMatchesNamedListFilter(unnamedLand, false), true);
});

test('on drops hasName false and keeps OSM named and Places', () => {
  assert.equal(installationListHasName(MIXED[0]), true);
  assert.equal(installationListHasName(unnamedLand), false);
  assert.equal(installationListHasName({}), false);
  assert.equal(installationMatchesNamedListFilter(unnamedLand, true), false);
  assert.equal(installationMatchesNamedListFilter(MIXED[0], true), true, 'OSM named stays');
  assert.equal(installationMatchesNamedListFilter(MIXED[2], true), true, 'Places stays');

  const kept = filterInstallationsByNamedOnly(MIXED, true).map((row) => row.id);
  assert.deepEqual(kept, ['osm:node:1', 'osm:way:2', 'google:abc', 'osm:node:legacy']);
  assert.ok(!kept.includes('osm:way:land'));

  const rows = listViewportInstallations(MIXED, { listNamedPref: true, listMappedPref: false });
  assert.deepEqual(rows.map((row) => row.id), ['osm:node:1', 'osm:way:2', 'google:abc', 'osm:node:legacy']);
  assert.ok(rows.every((row) => row.id !== 'osm:way:land'));
  assert.equal(rows.find((row) => row.id === 'google:abc')?.name, 'Places Extra');
});

test('missing hasName stays', () => {
  assert.equal(Object.hasOwn(missingName, 'hasName'), false);
  assert.equal(installationMatchesNamedListFilter(missingName, true), true);
  assert.equal(installationMatchesNamedListFilter({ id: 'osm:node:x', hasName: undefined }, true), true);
  assert.equal(installationMatchesNamedListFilter({ id: 'osm:node:x', hasName: null }, true), true);

  const rows = listViewportInstallations([missingName, unnamedLand], { listNamedPref: true });
  assert.deepEqual(rows.map((row) => row.id), ['osm:node:legacy']);
});

test('209 mapped-only still AND-able', () => {
  const mappedThenNamed = filterInstallationsByNamedOnly(
    filterInstallationsByMappedOnly(MIXED, true),
    true,
  ).map((row) => row.id);
  assert.deepEqual(mappedThenNamed, ['osm:node:1', 'osm:way:2', 'osm:node:legacy']);

  const both = listViewportInstallations(MIXED, { listMappedPref: true, listNamedPref: true });
  assert.deepEqual(both.map((row) => row.id), ['osm:node:1', 'osm:way:2', 'osm:node:legacy']);
  assert.ok(both.every((row) => row.id !== 'google:abc'));
  assert.ok(both.every((row) => row.id !== 'osm:way:land'));

  const mappedOnly = listViewportInstallations(MIXED, { listMappedPref: true, listNamedPref: false });
  assert.deepEqual(
    mappedOnly.map((row) => row.id),
    ['osm:node:1', 'osm:way:2', 'osm:way:land', 'osm:node:legacy'],
  );
});

test('invalid storage reads as off', () => {
  assert.equal(readSitesNamedOnly(memoryStorage({ [SITES_NAMED_ONLY_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readSitesNamedOnly(memoryStorage({ [SITES_NAMED_ONLY_STORAGE_KEY]: 'yes' })), false);
  assert.equal(readSitesNamedOnly(memoryStorage({ [SITES_NAMED_ONLY_STORAGE_KEY]: '2' })), false);
  assert.equal(readSitesNamedOnly(memoryStorage()), false);
  assert.equal(writeSitesNamedOnly('nope', memoryStorage()), false);
});

test('persist flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(readSitesNamedOnly(storage), DEFAULT_SITES_NAMED_ONLY);
  assert.equal(writeSitesNamedOnly(true, storage), true);
  assert.equal(storage.getItem(SITES_NAMED_ONLY_STORAGE_KEY), '1');
  assert.equal(readSitesNamedOnly(storage), true);
  assert.equal(readSitesNamedOnly(memoryStorage(storage.snapshot())), true, 'reload keeps on');

  const restored = listViewportInstallations(MIXED, {
    listNamedPref: readSitesNamedOnly(memoryStorage(storage.snapshot())),
    listMappedPref: false,
  });
  assert.deepEqual(restored.map((row) => row.id), ['osm:node:1', 'osm:way:2', 'google:abc', 'osm:node:legacy']);

  assert.equal(writeSitesNamedOnly(false, storage), true);
  assert.equal(storage.getItem(SITES_NAMED_ONLY_STORAGE_KEY), '0');
  assert.equal(readSitesNamedOnly(memoryStorage(storage.snapshot())), false, 'reload keeps off');
  assert.equal(writeSitesNamedOnly('nope', storage), false);
  assert.equal(storage.getItem(SITES_NAMED_ONLY_STORAGE_KEY), '0');
});

test('Named only is distinct from class / footprints / globe named / osmType / 209 mapped', () => {
  const afterGlobe = filterInstallationsByOsmType(
    filterInstallationsByNamed(
      filterInstallationsByFootprint(
        filterInstallationsByClass(MIXED, 'all'),
        false,
      ),
      false,
    ),
    'all',
  );
  assert.deepEqual(
    afterGlobe.map((row) => row.id),
    MIXED.map((row) => row.id),
    'globe chips off leave the payload unchanged',
  );
  assert.deepEqual(
    filterInstallationsByNamedOnly(afterGlobe, true).map((row) => row.id),
    ['osm:node:1', 'osm:way:2', 'google:abc', 'osm:node:legacy'],
  );
  const helper = read('src/data/installationListNamedFilter.js');
  assert.doesNotMatch(helper, /setLayerParams/);
  assert.doesNotMatch(helper, /from ['"].*militaryInstallation(s|ClassFilter|FootprintFilter|NamedFilter|OsmTypeFilter|MappedFilter)/);
  assert.doesNotMatch(helper, /from ['"].*militaryInstallations/);
  assert.doesNotMatch(helper, /from ['"].*installationListMappedFilter/);
});

test('Named only is not a share-link field; LayerStateCoordinator restore keeps the persist key', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['military-installations'].sitesNamedOnly, undefined);
  assert.equal(defaults.options['military-installations'].namedOnly, false);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=i'));
  assert.equal(omitted.options['military-installations'].sitesNamedOnly, undefined);

  const state = normalizeLayerState({
    enabledLayerIds: ['military-installations'],
    options: { 'military-installations': { sitesNamedOnly: true, namedOnly: true } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /sitesNamedOnly|sitesNamed/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['military-installations'].sitesNamedOnly, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'military-installations').sitesNamedOnly, undefined);

  const storage = memoryStorage({ [SITES_NAMED_ONLY_STORAGE_KEY]: '1' });
  assert.equal(readSitesNamedOnly(storage), true, 'coordinator restore of globe options does not wipe the list key');
});

test('militaryInstallations.js is unchanged', () => {
  const layer = read('src/data/militaryInstallations.js');
  assert.doesNotMatch(layer, /sitesNamedOnly|installationListNamedFilter|meridian\.sitesNamedOnly/);
  assert.doesNotMatch(layer, /listNamedPref|filterViewportSitesListNamed/);

  const mapped = read('src/data/installationListMappedFilter.js');
  assert.doesNotMatch(mapped, /sitesNamedOnly|installationListNamedFilter|hasName/);

  const diff = spawnSync('git', ['diff', 'origin/main', '--', 'src/data/militaryInstallations.js'], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  if (diff.status === 0) {
    assert.equal(diff.stdout, '', 'militaryInstallations.js must stay unchanged vs origin/main');
  }
});

test('chip sits on the Sites list after Mapped only', () => {
  const helper = read('src/data/installationListNamedFilter.js');
  const list = read('src/data/installationsViewportList.js');
  const html = read('index.html');
  const ui = read('src/ui.js');
  const css = read('style.css');
  const layerState = read('src/data/layerState.js');
  const license = read('LICENSE');
  const readme = read('README.md');

  assert.match(helper, /record\?\.hasName|hasName === true/);
  assert.match(helper, /meridian\.sitesNamedOnly/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);

  assert.match(list, /filterViewportSitesListNamed|readSitesListNamedPref/);
  assert.match(list, /filterViewportSitesList|readSitesListMappedPref/);
  assert.doesNotMatch(list, /namedOnly|milNamedOnly|militaryNamedFilter|filterInstallationsByNamed[^O]/);
  assert.doesNotMatch(list, /\/api\//);

  assert.doesNotMatch(layerState, /sitesNamedOnly|sitesNamed/);

  assert.match(html, /id="installation-named-chips"/);
  assert.match(html, /id="installation-list-mapped-chips"/);
  assert.match(html, /id="installation-list-named-chips"/);
  assert.match(html, /data-installation-list-named="only"/);
  assert.match(html, /Hide unnamed class-fallback sites from this list/);
  assert.ok(
    html.indexOf('id="installation-list-mapped-chips"') < html.indexOf('id="installation-list-named-chips"'),
    'list Named only sits after the list Mapped only chip',
  );
  assert.ok(
    html.indexOf('id="installations-viewport-list"') < html.indexOf('id="installation-list-named-chips"'),
    'list Named only lives on the hosted Sites list',
  );

  assert.match(ui, /installation-list-named-chips|data-installation-list-named/);
  assert.match(ui, /_installationListNamedChips\.hidden = !enabled/);
  assert.match(ui, /writeSitesNamedOnly\(/);
  assert.match(ui, /readSitesNamedOnly\(/);
  const listInitAt = ui.indexOf('  _initInstallationListNamedChip()');
  const listInitEnd = ui.indexOf('\n  _', listInitAt + 10);
  const listInit = ui.slice(listInitAt, listInitEnd === -1 ? undefined : listInitEnd);
  assert.match(listInit, /writeSitesNamedOnly\(/);
  assert.doesNotMatch(listInit, /setLayerParams/);
  assert.match(css, /installation-list-named-chip/);

  assert.equal(existsSync(path.join(ROOT, 'api/military-installations/named.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(readme, /quantum-earth/);

  assert.equal(sitesNamedOnlyChipModel(false).params.namedOnly, true);
  assert.equal(sitesNamedOnlyChipModel(true).params.namedOnly, false);
  assert.equal(sitesNamedOnlyChipModel(false).label, 'Named only');
});
