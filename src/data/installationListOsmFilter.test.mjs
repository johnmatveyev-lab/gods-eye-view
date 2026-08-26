// PLAN 235 — Sites list OSM-type chips All | Node | Way. Client-only
// filter of already-fetched viewport rows. Distinct from 151 class, 165
// footprints, 186/220 named, 202 globe osmType, 209 list mapped, and
// 212 globe mapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_SITES_LIST_OSM_TYPE,
  SITES_LIST_OSM_TYPE_CHIP_IDS,
  SITES_LIST_OSM_TYPE_STORAGE_KEY,
  filterInstallationsByListOsmType,
  filterViewportSitesListOsm,
  installationListOsmType,
  installationMatchesListOsmFilter,
  normalizeSitesListOsmType,
  readSitesListOsmPref,
  readSitesListOsmType,
  sitesListOsmTypeChipModels,
  writeSitesListOsmType,
} from './installationListOsmFilter.js';
import { filterInstallationsByMappedOnly } from './installationListMappedFilter.js';
import { filterInstallationsByNamedOnly } from './installationListNamedFilter.js';
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
  record({
    id: 'osm:way:land',
    class: 'military_land',
    name: 'Military land',
    latitude: 30.22,
    longitude: -97.72,
    osmType: 'way',
    hasName: false,
  }),
  record({
    id: 'osm:relation:9',
    kind: undefined,
    class: 'range',
    name: 'Legacy Range',
    latitude: 30.23,
    longitude: -97.73,
    osmType: 'relation',
    hasName: true,
  }),
]);

test('All keeps node / way / relation', () => {
  assert.deepEqual([...SITES_LIST_OSM_TYPE_CHIP_IDS], ['all', 'node', 'way']);
  assert.equal(DEFAULT_SITES_LIST_OSM_TYPE, 'all');
  assert.equal(filterViewportSitesListOsm, filterInstallationsByListOsmType);
  assert.equal(readSitesListOsmPref, readSitesListOsmType);
  assert.equal(SITES_LIST_OSM_TYPE_STORAGE_KEY, 'meridian.sitesListOsmType');
  assert.equal(normalizeSitesListOsmType(undefined), 'all');
  assert.equal(normalizeSitesListOsmType(null), 'all');
  assert.equal(normalizeSitesListOsmType(''), 'all');
  assert.equal(normalizeSitesListOsmType('all'), 'all');
  assert.equal(normalizeSitesListOsmType('NODE'), 'node');
  assert.equal(normalizeSitesListOsmType('way'), 'way');
  assert.equal(normalizeSitesListOsmType('relation'), null);
  assert.equal(normalizeSitesListOsmType('nope'), null);
  assert.equal(normalizeSitesListOsmType(false), null);

  const overflow = Array.from({ length: 61 }, (_, index) => record({
    id: index % 2 === 0 ? `osm:node:${index}` : `osm:way:${index}`,
    osmType: index % 2 === 0 ? 'node' : 'way',
    name: `Site ${index}`,
  }));
  const all = listViewportInstallations(overflow, { listOsmPref: 'all' });
  assert.equal(all.length, 50);
  assert.equal(all.at(-1).id, 'osm:way:49');
  assert.ok(all.some((row) => row.id.startsWith('osm:node:')));
  assert.ok(all.some((row) => row.id.startsWith('osm:way:')));
  assert.deepEqual(
    filterInstallationsByListOsmType(MIXED, 'all').map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterInstallationsByListOsmType(null), []);
  assert.deepEqual(filterInstallationsByListOsmType(undefined), []);
  assert.equal(installationMatchesListOsmFilter(MIXED[0], 'all'), true);
  assert.equal(installationMatchesListOsmFilter(MIXED[1], 'all'), true);
  assert.equal(installationMatchesListOsmFilter(MIXED[4], 'all'), true);
});

test('Node keeps node, drops way', () => {
  assert.equal(installationListOsmType('node'), 'node');
  assert.equal(installationListOsmType('way'), 'way');
  assert.equal(installationListOsmType('relation'), 'relation');
  assert.equal(installationListOsmType(undefined), null);
  assert.equal(installationMatchesListOsmFilter(MIXED[0], 'node'), true);
  assert.equal(installationMatchesListOsmFilter(MIXED[1], 'node'), false);
  assert.equal(installationMatchesListOsmFilter(MIXED[4], 'node'), false);

  const kept = filterInstallationsByListOsmType(MIXED, 'node').map((row) => row.id);
  assert.deepEqual(kept, ['osm:node:1', 'google:abc']);
  assert.ok(!kept.includes('osm:way:2'));
  assert.ok(!kept.includes('osm:way:land'));
  assert.ok(!kept.includes('osm:relation:9'));

  const rows = listViewportInstallations(MIXED, { listOsmPref: 'node' });
  assert.deepEqual(rows.map((row) => row.id), ['osm:node:1', 'google:abc']);
});

test('Way keeps way + relation, drops node', () => {
  assert.equal(installationMatchesListOsmFilter(MIXED[1], 'way'), true);
  assert.equal(installationMatchesListOsmFilter(MIXED[4], 'way'), true);
  assert.equal(installationMatchesListOsmFilter(MIXED[0], 'way'), false);

  const kept = filterInstallationsByListOsmType(MIXED, 'way').map((row) => row.id);
  assert.deepEqual(kept, ['osm:way:2', 'google:abc', 'osm:way:land', 'osm:relation:9']);
  assert.ok(!kept.includes('osm:node:1'));

  const rows = listViewportInstallations(MIXED, { listOsmPref: 'way' });
  assert.deepEqual(rows.map((row) => row.id), ['osm:way:2', 'google:abc', 'osm:way:land', 'osm:relation:9']);
});

test('Missing osmType stays', () => {
  assert.equal(installationMatchesListOsmFilter(MIXED[2], 'node'), true, 'Places extra stays');
  assert.equal(installationMatchesListOsmFilter(MIXED[2], 'way'), true, 'Places extra stays');
  assert.equal(installationMatchesListOsmFilter({}, 'node'), true);
  assert.equal(installationMatchesListOsmFilter({ id: 'google:land', osmType: undefined }, 'way'), true);
  assert.equal(installationMatchesListOsmFilter({ id: 'google:land', osmType: '' }, 'node'), true);

  const rows = listViewportInstallations([MIXED[2], MIXED[0]], { listOsmPref: 'way' });
  assert.deepEqual(rows.map((row) => row.id), ['google:abc']);
});

test('Selected id always kept', () => {
  assert.equal(
    installationMatchesListOsmFilter({ id: 'osm:node:1', osmType: 'node' }, 'way', {
      selectedId: 'osm:node:1',
    }),
    true,
  );
  assert.deepEqual(
    filterInstallationsByListOsmType(MIXED, 'way', 'osm:node:1').map((row) => row.id),
    ['osm:node:1', 'osm:way:2', 'google:abc', 'osm:way:land', 'osm:relation:9'],
  );
  const rows = listViewportInstallations(MIXED, { listOsmPref: 'way', selectedId: 'osm:node:1' });
  assert.ok(rows.some((row) => row.id === 'osm:node:1'));
  assert.deepEqual(
    rows.map((row) => row.id),
    ['osm:node:1', 'osm:way:2', 'google:abc', 'osm:way:land', 'osm:relation:9'],
  );
});

test('Invalid storage reads as All', () => {
  assert.equal(readSitesListOsmType(memoryStorage({ [SITES_LIST_OSM_TYPE_STORAGE_KEY]: 'nope' })), 'all');
  assert.equal(readSitesListOsmType(memoryStorage({ [SITES_LIST_OSM_TYPE_STORAGE_KEY]: 'relation' })), 'all');
  assert.equal(readSitesListOsmType(memoryStorage({ [SITES_LIST_OSM_TYPE_STORAGE_KEY]: '2' })), 'all');
  assert.equal(readSitesListOsmType(memoryStorage()), 'all');
  assert.equal(writeSitesListOsmType('nope', memoryStorage()), false);
  assert.equal(writeSitesListOsmType('relation', memoryStorage()), false);
});

test('Persist flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(readSitesListOsmType(storage), DEFAULT_SITES_LIST_OSM_TYPE);
  assert.equal(writeSitesListOsmType('node', storage), true);
  assert.equal(storage.getItem(SITES_LIST_OSM_TYPE_STORAGE_KEY), 'node');
  assert.equal(readSitesListOsmType(storage), 'node');
  assert.equal(readSitesListOsmType(memoryStorage(storage.snapshot())), 'node', 'reload keeps Node');

  const restored = listViewportInstallations(MIXED, {
    listOsmPref: readSitesListOsmType(memoryStorage(storage.snapshot())),
  });
  assert.deepEqual(restored.map((row) => row.id), ['osm:node:1', 'google:abc']);

  assert.equal(writeSitesListOsmType('way', storage), true);
  assert.equal(readSitesListOsmType(memoryStorage(storage.snapshot())), 'way', 'reload keeps Way');
  assert.equal(writeSitesListOsmType('all', storage), true);
  assert.equal(storage.getItem(SITES_LIST_OSM_TYPE_STORAGE_KEY), 'all');
  assert.equal(writeSitesListOsmType('nope', storage), false);
  assert.equal(storage.getItem(SITES_LIST_OSM_TYPE_STORAGE_KEY), 'all');
});

test('AND with 209 mapped-only and 220 named-only', () => {
  const afterList = filterInstallationsByListOsmType(
    filterInstallationsByNamedOnly(
      filterInstallationsByMappedOnly(MIXED, true),
      true,
    ),
    'way',
  ).map((row) => row.id);
  assert.deepEqual(afterList, ['osm:way:2', 'osm:relation:9']);

  const both = listViewportInstallations(MIXED, {
    listMappedPref: true,
    listNamedPref: true,
    listOsmPref: 'way',
  });
  assert.deepEqual(both.map((row) => row.id), ['osm:way:2', 'osm:relation:9']);
  assert.ok(both.every((row) => row.id !== 'google:abc'));
  assert.ok(both.every((row) => row.id !== 'osm:way:land'));
  assert.ok(both.every((row) => row.id !== 'osm:node:1'));

  const nodeNamed = listViewportInstallations(MIXED, {
    listMappedPref: false,
    listNamedPref: true,
    listOsmPref: 'node',
  });
  assert.deepEqual(nodeNamed.map((row) => row.id), ['osm:node:1', 'google:abc']);

  const overflow = Array.from({ length: 61 }, (_, index) => record({
    id: index < 10 ? `google:${index}` : (index % 2 === 0 ? `osm:node:${index}` : `osm:way:${index}`),
    kind: index < 10 ? 'place_candidate' : 'installation',
    osmType: index < 10 ? undefined : (index % 2 === 0 ? 'node' : 'way'),
    hasName: index !== 11,
    name: index === 11 ? 'Military land' : `Site ${index}`,
  }));
  const andCap = listViewportInstallations(overflow, {
    listMappedPref: true,
    listNamedPref: true,
    listOsmPref: 'way',
  });
  assert.equal(andCap.length, 24);
  assert.ok(andCap.every((row) => row.id.startsWith('osm:way:')));
  assert.ok(andCap.every((row) => row.id !== 'osm:way:11'));
});

test('list OSM-type is distinct from class / footprints / named / globe osmType / 209 mapped', () => {
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
    filterInstallationsByListOsmType(afterGlobe, 'node').map((row) => row.id),
    ['osm:node:1', 'google:abc'],
  );
  const helper = read('src/data/installationListOsmFilter.js');
  assert.doesNotMatch(helper, /setLayerParams/);
  assert.doesNotMatch(helper, /from ['"].*militaryInstallation(s|ClassFilter|FootprintFilter|NamedFilter|OsmTypeFilter|MappedFilter)/);
  assert.doesNotMatch(helper, /from ['"].*militaryInstallations/);
  assert.doesNotMatch(helper, /from ['"].*installationListMappedFilter/);
  assert.doesNotMatch(helper, /from ['"].*installationListNamedFilter/);
});

test('list OSM-type is not a share-link field; LayerStateCoordinator restore keeps the persist key', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['military-installations'].sitesListOsmType, undefined);
  assert.equal(defaults.options['military-installations'].osmType, undefined);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=i'));
  assert.equal(omitted.options['military-installations'].sitesListOsmType, undefined);

  const state = normalizeLayerState({
    enabledLayerIds: ['military-installations'],
    options: { 'military-installations': { sitesListOsmType: 'way', osmType: 'way' } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /sitesListOsmType|sitesListOsm|listOsmType/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['military-installations'].sitesListOsmType, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'military-installations').sitesListOsmType, undefined);

  const storage = memoryStorage({ [SITES_LIST_OSM_TYPE_STORAGE_KEY]: 'node' });
  assert.equal(readSitesListOsmType(storage), 'node', 'coordinator restore of globe options does not wipe the list key');
});

test('militaryInstallations.js is unchanged', () => {
  const layer = read('src/data/militaryInstallations.js');
  assert.doesNotMatch(layer, /sitesListOsmType|installationListOsmFilter|meridian\.sitesListOsmType/);
  assert.doesNotMatch(layer, /listOsmPref|filterViewportSitesListOsm/);

  const mapped = read('src/data/installationListMappedFilter.js');
  assert.doesNotMatch(mapped, /sitesListOsmType|installationListOsmFilter/);

  const named = read('src/data/installationListNamedFilter.js');
  assert.doesNotMatch(named, /sitesListOsmType|installationListOsmFilter/);

  const diff = spawnSync('git', ['diff', 'origin/main', '--', 'src/data/militaryInstallations.js'], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  if (diff.status === 0) {
    assert.equal(diff.stdout, '', 'militaryInstallations.js must stay unchanged vs origin/main');
  }
});

test('chip sits on the Sites list after Named only', () => {
  const helper = read('src/data/installationListOsmFilter.js');
  const list = read('src/data/installationsViewportList.js');
  const html = read('index.html');
  const ui = read('src/ui.js');
  const css = read('style.css');
  const layerState = read('src/data/layerState.js');
  const license = read('LICENSE');
  const readme = read('README.md');

  assert.match(helper, /record\?\.osmType/);
  assert.match(helper, /meridian\.sitesListOsmType/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);

  assert.match(list, /filterViewportSitesListOsm|readSitesListOsmPref/);
  assert.match(list, /filterViewportSitesListNamed|readSitesListNamedPref/);
  assert.match(list, /filterViewportSitesList|readSitesListMappedPref/);
  assert.doesNotMatch(list, /milOsmType|militaryOsmTypeFilter|filterInstallationsByOsmType[^L]/);
  assert.doesNotMatch(list, /\/api\//);

  assert.doesNotMatch(layerState, /sitesListOsmType|sitesListOsm/);

  assert.match(html, /id="installation-osm-type-chips"/);
  assert.match(html, /id="installation-list-mapped-chips"/);
  assert.match(html, /id="installation-list-named-chips"/);
  assert.match(html, /id="installation-list-osm-chips"/);
  assert.match(html, /data-installation-list-osm="all"/);
  assert.match(html, /data-installation-list-osm="node"/);
  assert.match(html, /data-installation-list-osm="way"/);
  assert.doesNotMatch(html, /data-installation-list-osm="relation"/);
  assert.match(html, /Show every listed site regardless of OSM primitive/);
  assert.ok(
    html.indexOf('id="installation-list-named-chips"') < html.indexOf('id="installation-list-osm-chips"'),
    'list OSM-type sits after the list Named only chip',
  );
  assert.ok(
    html.indexOf('id="installations-viewport-list"') < html.indexOf('id="installation-list-osm-chips"'),
    'list OSM-type lives on the hosted Sites list',
  );
  assert.ok(
    html.indexOf('id="installation-osm-type-chips"') < html.indexOf('id="installation-list-osm-chips"'),
    'list OSM-type sits after the globe OSM-type chips',
  );

  assert.match(ui, /installation-list-osm-chips|data-installation-list-osm/);
  assert.match(ui, /_installationListOsmChips\.hidden = !enabled/);
  assert.match(ui, /writeSitesListOsmType\(/);
  assert.match(ui, /readSitesListOsmType\(/);
  const listInitAt = ui.indexOf('  _initInstallationListOsmChips()');
  const listInitEnd = ui.indexOf('\n  _', listInitAt + 10);
  const listInit = ui.slice(listInitAt, listInitEnd === -1 ? undefined : listInitEnd);
  assert.match(listInit, /writeSitesListOsmType\(/);
  assert.doesNotMatch(listInit, /setLayerParams/);
  assert.match(css, /installation-list-osm-chip/);

  assert.equal(existsSync(path.join(ROOT, 'api/military-installations/osm.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(readme, /quantum-earth/);

  const models = sitesListOsmTypeChipModels('way');
  assert.deepEqual(models.map((chip) => chip.label), ['All', 'Node', 'Way']);
  assert.deepEqual(models.map((chip) => chip.params.listOsmType), ['all', 'node', 'way']);
  assert.equal(models.filter((chip) => chip.active).length, 1);
  assert.equal(models.find((chip) => chip.params.listOsmType === 'way').active, true);
});
