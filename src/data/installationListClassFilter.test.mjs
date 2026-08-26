// PLAN 243 — Sites list class chips All | Airfield | Naval. Client-only
// filter of already-fetched viewport rows. Distinct from 151 globe class,
// 165 footprints, 186/220 named, 202/235 OSM-type, 209 list mapped, and
// 212 globe mapped.
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_SITES_LIST_CLASS,
  SITES_LIST_CLASS_CHIP_IDS,
  SITES_LIST_CLASS_STORAGE_KEY,
  filterInstallationsByListClass,
  filterViewportSitesListClass,
  getSitesListClassFilter,
  hydrateSitesListClassFilter,
  installationListClass,
  installationMatchesListClassFilter,
  normalizeSitesListClass,
  readSitesListClassPref,
  readSitesListClass,
  resetSitesListClassFilterForTest,
  setSitesListClassFilter,
  sitesListClassChipModels,
  writeSitesListClass,
} from './installationListClassFilter.js';
import { filterInstallationsByMappedOnly } from './installationListMappedFilter.js';
import { filterInstallationsByNamedOnly } from './installationListNamedFilter.js';
import { filterInstallationsByListOsmType } from './installationListOsmFilter.js';
import { resetSitesListFootprintsOnlyFilterForTest } from './installationListFootprintFilter.js';
import {
  getParams,
  getRowControls,
  listViewportInstallations,
  setParams,
} from './installationsViewportList.js';
import { filterInstallationsByClass } from './militaryInstallationClassFilter.js';
import { filterInstallationsByFootprint } from './militaryFootprintFilter.js';
import { filterInstallationsByNamed } from './militaryNamedFilter.js';
import { filterInstallationsByOsmType } from './militaryOsmTypeFilter.js';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
  layerOptionsForRestore,
  LayerStateCoordinator,
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

beforeEach(() => {
  resetSitesListClassFilterForTest();
  resetSitesListFootprintsOnlyFilterForTest();
});

afterEach(() => {
  resetSitesListClassFilterForTest();
  resetSitesListFootprintsOnlyFilterForTest();
});

test('All keeps airfield / naval_base / range / military_land', () => {
  assert.deepEqual([...SITES_LIST_CLASS_CHIP_IDS], ['all', 'airfield', 'naval']);
  assert.equal(DEFAULT_SITES_LIST_CLASS, 'all');
  assert.equal(filterViewportSitesListClass, filterInstallationsByListClass);
  assert.equal(readSitesListClassPref, readSitesListClass);
  assert.equal(SITES_LIST_CLASS_STORAGE_KEY, 'meridian.sitesListClass');
  assert.equal(normalizeSitesListClass(undefined), 'all');
  assert.equal(normalizeSitesListClass(null), 'all');
  assert.equal(normalizeSitesListClass(''), 'all');
  assert.equal(normalizeSitesListClass('all'), 'all');
  assert.equal(normalizeSitesListClass('AIRFIELD'), 'airfield');
  assert.equal(normalizeSitesListClass('naval'), 'naval');
  assert.equal(normalizeSitesListClass('naval_base'), 'naval');
  assert.equal(normalizeSitesListClass('range'), null);
  assert.equal(normalizeSitesListClass('nope'), null);
  assert.equal(normalizeSitesListClass(false), null);

  const overflow = Array.from({ length: 61 }, (_, index) => record({
    id: `osm:node:${index}`,
    class: index % 2 === 0 ? 'airfield' : 'naval_base',
    name: `Site ${index}`,
  }));
  const all = listViewportInstallations(overflow, { listClassPref: 'all' });
  assert.equal(all.length, 50);
  assert.equal(all.at(-1).id, 'osm:node:49');
  assert.ok(all.some((row) => row.id === 'osm:node:0'));
  assert.ok(all.some((row) => row.id === 'osm:node:1'));
  assert.deepEqual(
    filterInstallationsByListClass(MIXED, 'all').map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterInstallationsByListClass(null), []);
  assert.deepEqual(filterInstallationsByListClass(undefined), []);
  assert.equal(installationMatchesListClassFilter(MIXED[0], 'all'), true);
  assert.equal(installationMatchesListClassFilter(MIXED[1], 'all'), true);
  assert.equal(installationMatchesListClassFilter(MIXED[3], 'all'), true);
  assert.equal(installationMatchesListClassFilter(MIXED[4], 'all'), true);
});

test('Airfield keeps airfield, drops naval_base', () => {
  assert.equal(installationListClass('airfield'), 'airfield');
  assert.equal(installationListClass('naval_base'), 'naval_base');
  assert.equal(installationListClass('range'), 'range');
  assert.equal(installationListClass('military_land'), 'military_land');
  assert.equal(installationListClass(undefined), null);
  assert.equal(installationMatchesListClassFilter(MIXED[0], 'airfield'), true);
  assert.equal(installationMatchesListClassFilter(MIXED[1], 'airfield'), false);
  assert.equal(installationMatchesListClassFilter(MIXED[3], 'airfield'), false);
  assert.equal(installationMatchesListClassFilter(MIXED[4], 'airfield'), false);

  const kept = filterInstallationsByListClass(MIXED, 'airfield').map((row) => row.id);
  assert.deepEqual(kept, ['osm:node:1', 'google:abc']);
  assert.ok(!kept.includes('osm:way:2'));
  assert.ok(!kept.includes('osm:way:land'));
  assert.ok(!kept.includes('osm:relation:9'));

  const rows = listViewportInstallations(MIXED, { listClassPref: 'airfield' });
  assert.deepEqual(rows.map((row) => row.id), ['osm:node:1', 'google:abc']);
});

test('Naval keeps naval_base, drops airfield', () => {
  assert.equal(installationMatchesListClassFilter(MIXED[1], 'naval'), true);
  assert.equal(installationMatchesListClassFilter(MIXED[0], 'naval'), false);
  assert.equal(installationMatchesListClassFilter(MIXED[3], 'naval'), false);
  assert.equal(installationMatchesListClassFilter(MIXED[4], 'naval'), false);

  const kept = filterInstallationsByListClass(MIXED, 'naval').map((row) => row.id);
  assert.deepEqual(kept, ['osm:way:2', 'google:abc']);
  assert.ok(!kept.includes('osm:node:1'));

  const rows = listViewportInstallations(MIXED, { listClassPref: 'naval' });
  assert.deepEqual(rows.map((row) => row.id), ['osm:way:2', 'google:abc']);
});

test('Missing class stays', () => {
  assert.equal(installationMatchesListClassFilter(MIXED[2], 'airfield'), true, 'Places extra stays');
  assert.equal(installationMatchesListClassFilter(MIXED[2], 'naval'), true, 'Places extra stays');
  assert.equal(installationMatchesListClassFilter({}, 'airfield'), true);
  assert.equal(installationMatchesListClassFilter({ id: 'google:land', class: undefined }, 'naval'), true);
  assert.equal(installationMatchesListClassFilter({ id: 'google:land', class: '' }, 'airfield'), true);
  assert.equal(installationMatchesListClassFilter({ id: 'x', class: 'unknown' }, 'naval'), true);

  const rows = listViewportInstallations([MIXED[2], MIXED[0]], { listClassPref: 'naval' });
  assert.deepEqual(rows.map((row) => row.id), ['google:abc']);
});

test('Selected id always kept', () => {
  assert.equal(
    installationMatchesListClassFilter({ id: 'osm:way:2', class: 'naval_base' }, 'airfield', {
      selectedId: 'osm:way:2',
    }),
    true,
  );
  assert.deepEqual(
    filterInstallationsByListClass(MIXED, 'airfield', 'osm:way:2').map((row) => row.id),
    ['osm:node:1', 'osm:way:2', 'google:abc'],
  );
  const rows = listViewportInstallations(MIXED, { listClassPref: 'airfield', selectedId: 'osm:way:2' });
  assert.ok(rows.some((row) => row.id === 'osm:way:2'));
  assert.deepEqual(
    rows.map((row) => row.id),
    ['osm:node:1', 'osm:way:2', 'google:abc'],
  );
});

test('Invalid storage reads as All', () => {
  assert.equal(readSitesListClass(memoryStorage({ [SITES_LIST_CLASS_STORAGE_KEY]: 'nope' })), 'all');
  assert.equal(readSitesListClass(memoryStorage({ [SITES_LIST_CLASS_STORAGE_KEY]: 'range' })), 'all');
  assert.equal(readSitesListClass(memoryStorage({ [SITES_LIST_CLASS_STORAGE_KEY]: '2' })), 'all');
  assert.equal(readSitesListClass(memoryStorage()), 'all');
  assert.equal(writeSitesListClass('nope', memoryStorage()), false);
  assert.equal(writeSitesListClass('range', memoryStorage()), false);
});

test('Persist flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(readSitesListClass(storage), DEFAULT_SITES_LIST_CLASS);
  assert.equal(writeSitesListClass('airfield', storage), true);
  assert.equal(storage.getItem(SITES_LIST_CLASS_STORAGE_KEY), 'airfield');
  assert.equal(readSitesListClass(storage), 'airfield');
  assert.equal(readSitesListClass(memoryStorage(storage.snapshot())), 'airfield', 'reload keeps Airfield');

  const restored = listViewportInstallations(MIXED, {
    listClassPref: readSitesListClass(memoryStorage(storage.snapshot())),
  });
  assert.deepEqual(restored.map((row) => row.id), ['osm:node:1', 'google:abc']);

  assert.equal(writeSitesListClass('naval', storage), true);
  assert.equal(readSitesListClass(memoryStorage(storage.snapshot())), 'naval', 'reload keeps Naval');
  assert.equal(writeSitesListClass('all', storage), true);
  assert.equal(storage.getItem(SITES_LIST_CLASS_STORAGE_KEY), 'all');
  assert.equal(writeSitesListClass('nope', storage), false);
  assert.equal(storage.getItem(SITES_LIST_CLASS_STORAGE_KEY), 'all');
});

test('AND with 209 mapped-only, 220 named-only, and 235 OSM-type', () => {
  const afterList = filterInstallationsByListClass(
    filterInstallationsByListOsmType(
      filterInstallationsByNamedOnly(
        filterInstallationsByMappedOnly(MIXED, true),
        true,
      ),
      'way',
    ),
    'naval',
  ).map((row) => row.id);
  assert.deepEqual(afterList, ['osm:way:2']);

  const both = listViewportInstallations(MIXED, {
    listMappedPref: true,
    listNamedPref: true,
    listOsmPref: 'way',
    listClassPref: 'naval',
  });
  assert.deepEqual(both.map((row) => row.id), ['osm:way:2']);
  assert.ok(both.every((row) => row.id !== 'google:abc'));
  assert.ok(both.every((row) => row.id !== 'osm:way:land'));
  assert.ok(both.every((row) => row.id !== 'osm:node:1'));
  assert.ok(both.every((row) => row.id !== 'osm:relation:9'));

  const airfieldNode = listViewportInstallations(MIXED, {
    listMappedPref: false,
    listNamedPref: true,
    listOsmPref: 'node',
    listClassPref: 'airfield',
  });
  assert.deepEqual(airfieldNode.map((row) => row.id), ['osm:node:1', 'google:abc']);

  const overflow = Array.from({ length: 61 }, (_, index) => record({
    id: index < 10 ? `google:${index}` : (index % 2 === 0 ? `osm:node:${index}` : `osm:way:${index}`),
    kind: index < 10 ? 'place_candidate' : 'installation',
    class: index < 10 ? 'places_candidate' : (index % 2 === 0 ? 'airfield' : 'naval_base'),
    osmType: index < 10 ? undefined : (index % 2 === 0 ? 'node' : 'way'),
    hasName: index !== 11,
    name: index === 11 ? 'Military land' : `Site ${index}`,
  }));
  const andCap = listViewportInstallations(overflow, {
    listMappedPref: true,
    listNamedPref: true,
    listOsmPref: 'way',
    listClassPref: 'naval',
  });
  assert.equal(andCap.length, 24);
  assert.ok(andCap.every((row) => row.id.startsWith('osm:way:')));
  assert.ok(andCap.every((row) => row.id !== 'osm:way:11'));
});

test('list class is distinct from globe class / footprints / named / osmType / 209 mapped', () => {
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
    filterInstallationsByListClass(afterGlobe, 'airfield').map((row) => row.id),
    ['osm:node:1', 'google:abc'],
  );
  const helper = read('src/data/installationListClassFilter.js');
  assert.doesNotMatch(helper, /setLayerParams/);
  assert.doesNotMatch(helper, /from ['"].*militaryInstallation(s|ClassFilter|FootprintFilter|NamedFilter|OsmTypeFilter|MappedFilter)/);
  assert.doesNotMatch(helper, /from ['"].*militaryInstallations/);
  assert.doesNotMatch(helper, /from ['"].*installationListMappedFilter/);
  assert.doesNotMatch(helper, /from ['"].*installationListNamedFilter/);
  assert.doesNotMatch(helper, /from ['"].*installationListOsmFilter/);
});

test('list class is not a share-link field; LayerStateCoordinator restore keeps the persist key', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['military-installations'].sitesListClass, undefined);
  assert.equal(defaults.options['military-installations'].installationClassFilter, 'all');

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=i'));
  assert.equal(omitted.options['military-installations'].sitesListClass, undefined);

  const state = normalizeLayerState({
    enabledLayerIds: ['military-installations'],
    options: { 'military-installations': { sitesListClass: 'airfield', installationClassFilter: 'A' } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /sitesListClass|listClass/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['military-installations'].sitesListClass, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'military-installations').sitesListClass, undefined);

  const storage = memoryStorage({ [SITES_LIST_CLASS_STORAGE_KEY]: 'naval' });
  assert.equal(readSitesListClass(storage), 'naval', 'coordinator restore of globe options does not wipe the list key');

  resetSitesListClassFilterForTest();
  setSitesListClassFilter('airfield', { storage });
  assert.equal(storage.getItem(SITES_LIST_CLASS_STORAGE_KEY), 'airfield');
  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['military-installations'],
  }));
  assert.doesNotMatch(encoded.get('lo') || '', /sitesListClass|listClass|m\.sc/);
  assert.doesNotMatch(encoded.toString(), /sitesListClass|meridian\.sitesListClass/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetSitesListClassFilterForTest();
  assert.equal(getSitesListClassFilter(), DEFAULT_SITES_LIST_CLASS);
  assert.equal(hydrateSitesListClassFilter(storage), 'airfield');
  assert.equal(getSitesListClassFilter(), 'airfield');
  assert.equal(storage.getItem(SITES_LIST_CLASS_STORAGE_KEY), 'airfield');
});

test('militaryInstallations.js is unchanged', () => {
  const layer = read('src/data/militaryInstallations.js');
  assert.doesNotMatch(layer, /sitesListClass|installationListClassFilter|meridian\.sitesListClass/);
  assert.doesNotMatch(layer, /listClassPref|filterViewportSitesListClass/);

  const mapped = read('src/data/installationListMappedFilter.js');
  assert.doesNotMatch(mapped, /sitesListClass|installationListClassFilter/);

  const named = read('src/data/installationListNamedFilter.js');
  assert.doesNotMatch(named, /sitesListClass|installationListClassFilter/);

  const osm = read('src/data/installationListOsmFilter.js');
  assert.doesNotMatch(osm, /sitesListClass|installationListClassFilter/);

  const diff = spawnSync('git', ['diff', 'origin/main', '--', 'src/data/militaryInstallations.js'], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  if (diff.status === 0) {
    assert.equal(diff.stdout, '', 'militaryInstallations.js must stay unchanged vs origin/main');
  }
});

test('getRowControls owns All | Airfield | Naval after OSM-type', () => {
  const helper = read('src/data/installationListClassFilter.js');
  const list = read('src/data/installationsViewportList.js');
  const html = read('index.html');
  const ui = read('src/ui.js');
  const layerState = read('src/data/layerState.js');
  const license = read('LICENSE');
  const readme = read('README.md');

  assert.match(helper, /record\?\.class|installationListClass\(record\?\.class\)/);
  assert.match(helper, /meridian\.sitesListClass/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);

  assert.match(list, /filterViewportSitesListClass|readSitesListClassPref/);
  assert.match(list, /filterViewportSitesListOsm|readSitesListOsmPref/);
  assert.match(list, /filterViewportSitesListNamed|readSitesListNamedPref/);
  assert.match(list, /filterViewportSitesList|readSitesListMappedPref/);
  assert.match(list, /getRowControls/);
  assert.match(list, /hydrateSitesListClassFilter|setSitesListClassFilter|getSitesListClassFilter/);
  assert.doesNotMatch(list, /milClass|militaryInstallationClassFilter|filterInstallationsByClass[^L]/);
  assert.doesNotMatch(list, /\/api\//);

  assert.doesNotMatch(layerState, /sitesListClass/);
  assert.doesNotMatch(ui, /sitesListClass|setSitesListClassFilter|_initInstallationListClass/);
  assert.doesNotMatch(html, /data-installation-list-class|installation-list-class-chips/);

  assert.equal(existsSync(path.join(ROOT, 'api/military-installations/class.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(readme, /quantum-earth/);

  resetSitesListClassFilterForTest();
  const models = sitesListClassChipModels('naval');
  assert.deepEqual(models.map((chip) => chip.label), ['All', 'Airfield', 'Naval']);
  assert.deepEqual(models.map((chip) => chip.params.listClass), ['all', 'airfield', 'naval']);
  assert.equal(models.filter((chip) => chip.active).length, 1);
  assert.equal(models.find((chip) => chip.params.listClass === 'naval').active, true);

  const chips = getRowControls().chips;
  assert.deepEqual(chips.map((chip) => chip.label), ['All', 'Airfield', 'Naval', 'Footprints only']);
  assert.equal(chips.filter((chip) => chip.params?.listClass && chip.active).length, 1);
  assert.equal(chips.find((chip) => chip.params.listClass === 'all').active, true);
  assert.equal(chips.find((chip) => chip.label === 'Footprints only').active, false);

  assert.equal(getParams().listClass, 'all');
  assert.equal(setParams({ listClass: 'airfield' }), true);
  assert.equal(getParams().listClass, 'airfield');
  assert.equal(getRowControls().chips.find((chip) => chip.params.listClass === 'airfield').active, true);
});
