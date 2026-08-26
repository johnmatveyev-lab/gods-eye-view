// PLAN 250 — Sites list Footprints only toggle. Client-only filter of
// already-fetched viewport rows. Distinct from 165 globe footprints,
// 151/243 class, 186/220 named, 202/235 OSM-type, 209 list mapped, and
// 212 globe mapped.
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_SITES_LIST_FOOTPRINTS_ONLY,
  SITES_LIST_FOOTPRINTS_ONLY_CHIP_ID,
  SITES_LIST_FOOTPRINTS_ONLY_CHIP_LABEL,
  SITES_LIST_FOOTPRINTS_ONLY_CHIP_TITLE,
  SITES_LIST_FOOTPRINTS_ONLY_STORAGE_KEY,
  filterInstallationsByListFootprint,
  filterViewportSitesListFootprint,
  getSitesListFootprintsOnlyFilter,
  hydrateSitesListFootprintsOnlyFilter,
  installationListHasFootprint,
  installationMatchesListFootprintFilter,
  normalizeSitesListFootprintsOnly,
  readSitesListFootprintsOnly,
  readSitesListFootprintsPref,
  resetSitesListFootprintsOnlyFilterForTest,
  setSitesListFootprintsOnlyFilter,
  sitesListFootprintsOnlyChipModel,
  writeSitesListFootprintsOnly,
} from './installationListFootprintFilter.js';
import { filterInstallationsByMappedOnly } from './installationListMappedFilter.js';
import { filterInstallationsByNamedOnly } from './installationListNamedFilter.js';
import { filterInstallationsByListOsmType } from './installationListOsmFilter.js';
import {
  filterInstallationsByListClass,
  resetSitesListClassFilterForTest,
} from './installationListClassFilter.js';
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

const RING = Object.freeze([
  [-97.71, 30.20],
  [-97.70, 30.20],
  [-97.70, 30.21],
]);

const MIXED = Object.freeze([
  record(),
  record({
    id: 'osm:way:2',
    class: 'naval_base',
    name: 'Naval Station',
    latitude: 30.2,
    longitude: -97.7,
    osmType: 'way',
    footprint: RING,
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
    footprint: null,
  }),
  record({
    id: 'osm:way:land',
    class: 'military_land',
    name: 'Military land',
    latitude: 30.22,
    longitude: -97.72,
    osmType: 'way',
    hasName: false,
    footprint: [],
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
    footprint: RING,
  }),
]);

beforeEach(() => {
  resetSitesListFootprintsOnlyFilterForTest();
  resetSitesListClassFilterForTest();
});

afterEach(() => {
  resetSitesListFootprintsOnlyFilterForTest();
  resetSitesListClassFilterForTest();
});

test('Off keeps null footprint', () => {
  assert.equal(DEFAULT_SITES_LIST_FOOTPRINTS_ONLY, false);
  assert.equal(filterViewportSitesListFootprint, filterInstallationsByListFootprint);
  assert.equal(readSitesListFootprintsPref, readSitesListFootprintsOnly);
  assert.equal(SITES_LIST_FOOTPRINTS_ONLY_CHIP_LABEL, 'Footprints only');
  assert.equal(SITES_LIST_FOOTPRINTS_ONLY_CHIP_TITLE, 'Hide listed sites that have no footprint polygon');
  assert.equal(SITES_LIST_FOOTPRINTS_ONLY_STORAGE_KEY, 'meridian.sitesListFootprintsOnly');
  assert.equal(normalizeSitesListFootprintsOnly(undefined), false);
  assert.equal(normalizeSitesListFootprintsOnly(null), false);
  assert.equal(normalizeSitesListFootprintsOnly(''), false);
  assert.equal(normalizeSitesListFootprintsOnly(false), false);
  assert.equal(normalizeSitesListFootprintsOnly(true), true);
  assert.equal(normalizeSitesListFootprintsOnly('1'), true);
  assert.equal(normalizeSitesListFootprintsOnly('true'), true);
  assert.equal(normalizeSitesListFootprintsOnly(0), false);
  assert.equal(normalizeSitesListFootprintsOnly('bogus'), null);

  const overflow = Array.from({ length: 61 }, (_, index) => record({
    id: `osm:node:${index}`,
    name: `Site ${index}`,
    footprint: index % 2 === 0 ? RING : null,
  }));
  const off = listViewportInstallations(overflow, { listFootprintsPref: false });
  assert.equal(off.length, 50);
  assert.equal(off.at(-1).id, 'osm:node:49');
  assert.ok(off.some((row) => row.id === 'osm:node:1'));
  assert.deepEqual(
    filterInstallationsByListFootprint(MIXED, false).map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterInstallationsByListFootprint(null), []);
  assert.deepEqual(filterInstallationsByListFootprint(undefined), []);
  assert.equal(installationMatchesListFootprintFilter(MIXED[0], false), true);
  assert.equal(installationMatchesListFootprintFilter(MIXED[3], false), true);
  const implicit = listViewportInstallations(MIXED);
  assert.ok(implicit.some((row) => row.id === 'osm:node:1'));
  assert.equal(MIXED.find((row) => row.id === 'osm:node:1')?.footprint, null);
});

test('On keeps a ring, drops null/empty', () => {
  assert.equal(installationListHasFootprint(MIXED[1]), true);
  assert.equal(installationListHasFootprint(MIXED[4]), true);
  assert.equal(installationListHasFootprint(MIXED[0]), false);
  assert.equal(installationListHasFootprint(MIXED[3]), false);
  assert.equal(installationListHasFootprint({}), false);
  assert.equal(installationListHasFootprint({ footprint: null }), false);
  assert.equal(installationListHasFootprint({ footprint: [] }), false);
  assert.equal(installationMatchesListFootprintFilter(MIXED[1], true), true);
  assert.equal(installationMatchesListFootprintFilter(MIXED[4], true), true);
  assert.equal(installationMatchesListFootprintFilter(MIXED[0], true), false);
  assert.equal(installationMatchesListFootprintFilter(MIXED[2], true), false);
  assert.equal(installationMatchesListFootprintFilter(MIXED[3], true), false);
  assert.equal(installationMatchesListFootprintFilter({ id: 'x' }, true), false);
  assert.equal(installationMatchesListFootprintFilter({ id: 'x', footprint: null }, true), false);
  assert.equal(installationMatchesListFootprintFilter({ id: 'x', footprint: [] }, true), false);

  const kept = filterInstallationsByListFootprint(MIXED, true).map((row) => row.id);
  assert.deepEqual(kept, ['osm:way:2', 'osm:relation:9']);
  assert.ok(!kept.includes('osm:node:1'));
  assert.ok(!kept.includes('google:abc'));
  assert.ok(!kept.includes('osm:way:land'));

  const rows = listViewportInstallations(MIXED, { listFootprintsPref: true });
  assert.deepEqual(rows.map((row) => row.id), ['osm:way:2', 'osm:relation:9']);
  assert.ok(rows.every((row) => row.id !== 'osm:node:1'));
});

test('Selected id always kept', () => {
  assert.equal(
    installationMatchesListFootprintFilter({ id: 'osm:node:1', footprint: null }, true, {
      selectedId: 'osm:node:1',
    }),
    true,
  );
  assert.deepEqual(
    filterInstallationsByListFootprint(MIXED, true, 'osm:node:1').map((row) => row.id),
    ['osm:node:1', 'osm:way:2', 'osm:relation:9'],
  );
  const rows = listViewportInstallations(MIXED, {
    listFootprintsPref: true,
    selectedId: 'osm:node:1',
  });
  assert.ok(rows.some((row) => row.id === 'osm:node:1'));
  assert.deepEqual(
    rows.map((row) => row.id),
    ['osm:node:1', 'osm:way:2', 'osm:relation:9'],
  );
});

test('Invalid storage reads as off', () => {
  assert.equal(readSitesListFootprintsOnly(memoryStorage({
    [SITES_LIST_FOOTPRINTS_ONLY_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readSitesListFootprintsOnly(memoryStorage({
    [SITES_LIST_FOOTPRINTS_ONLY_STORAGE_KEY]: 'yes',
  })), false);
  assert.equal(readSitesListFootprintsOnly(memoryStorage({
    [SITES_LIST_FOOTPRINTS_ONLY_STORAGE_KEY]: '2',
  })), false);
  assert.equal(readSitesListFootprintsOnly(memoryStorage()), false);
  assert.equal(writeSitesListFootprintsOnly('nope', memoryStorage()), false);
});

test('Persist flip survives reload as 1 / 0', () => {
  const storage = memoryStorage();
  assert.equal(readSitesListFootprintsOnly(storage), DEFAULT_SITES_LIST_FOOTPRINTS_ONLY);
  assert.equal(writeSitesListFootprintsOnly(true, storage), true);
  assert.equal(storage.getItem(SITES_LIST_FOOTPRINTS_ONLY_STORAGE_KEY), '1');
  assert.equal(readSitesListFootprintsOnly(storage), true);
  assert.equal(readSitesListFootprintsOnly(memoryStorage(storage.snapshot())), true, 'reload keeps on');

  const restored = listViewportInstallations(MIXED, {
    listFootprintsPref: readSitesListFootprintsOnly(memoryStorage(storage.snapshot())),
  });
  assert.deepEqual(restored.map((row) => row.id), ['osm:way:2', 'osm:relation:9']);

  assert.equal(writeSitesListFootprintsOnly(false, storage), true);
  assert.equal(storage.getItem(SITES_LIST_FOOTPRINTS_ONLY_STORAGE_KEY), '0');
  assert.equal(readSitesListFootprintsOnly(memoryStorage(storage.snapshot())), false, 'reload keeps off');
  assert.equal(writeSitesListFootprintsOnly('nope', storage), false);
  assert.equal(storage.getItem(SITES_LIST_FOOTPRINTS_ONLY_STORAGE_KEY), '0');
});

test('AND with 209 mapped-only, 220 named-only, 235 OSM-type, and 243 class', () => {
  const afterList = filterInstallationsByListFootprint(
    filterInstallationsByListClass(
      filterInstallationsByListOsmType(
        filterInstallationsByNamedOnly(
          filterInstallationsByMappedOnly(MIXED, true),
          true,
        ),
        'way',
      ),
      'naval',
    ),
    true,
  ).map((row) => row.id);
  assert.deepEqual(afterList, ['osm:way:2']);

  const both = listViewportInstallations(MIXED, {
    listMappedPref: true,
    listNamedPref: true,
    listOsmPref: 'way',
    listClassPref: 'naval',
    listFootprintsPref: true,
  });
  assert.deepEqual(both.map((row) => row.id), ['osm:way:2']);
  assert.ok(both.every((row) => row.id !== 'google:abc'));
  assert.ok(both.every((row) => row.id !== 'osm:way:land'));
  assert.ok(both.every((row) => row.id !== 'osm:node:1'));
  assert.ok(both.every((row) => row.id !== 'osm:relation:9'));

  const airfieldOff = listViewportInstallations(MIXED, {
    listMappedPref: false,
    listNamedPref: true,
    listOsmPref: 'all',
    listClassPref: 'airfield',
    listFootprintsPref: false,
  });
  assert.deepEqual(airfieldOff.map((row) => row.id), ['osm:node:1', 'google:abc']);

  const overflow = Array.from({ length: 61 }, (_, index) => record({
    id: index < 10 ? `google:${index}` : (index % 2 === 0 ? `osm:node:${index}` : `osm:way:${index}`),
    kind: index < 10 ? 'place_candidate' : 'installation',
    class: index < 10 ? 'places_candidate' : (index % 2 === 0 ? 'airfield' : 'naval_base'),
    osmType: index < 10 ? undefined : (index % 2 === 0 ? 'node' : 'way'),
    hasName: index !== 11,
    name: index === 11 ? 'Military land' : `Site ${index}`,
    footprint: index % 2 === 1 ? RING : null,
  }));
  const andCap = listViewportInstallations(overflow, {
    listMappedPref: true,
    listNamedPref: true,
    listOsmPref: 'way',
    listClassPref: 'naval',
    listFootprintsPref: true,
  });
  assert.equal(andCap.length, 24);
  assert.ok(andCap.every((row) => row.id.startsWith('osm:way:')));
  assert.ok(andCap.every((row) => row.id !== 'osm:way:11'));
});

test('list Footprints only is distinct from globe class / footprints / named / osmType / 209 mapped', () => {
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
    filterInstallationsByListFootprint(afterGlobe, true).map((row) => row.id),
    ['osm:way:2', 'osm:relation:9'],
  );
  const helper = read('src/data/installationListFootprintFilter.js');
  assert.doesNotMatch(helper, /setLayerParams/);
  assert.doesNotMatch(helper, /from ['"].*militaryInstallation(s|ClassFilter|FootprintFilter|NamedFilter|OsmTypeFilter|MappedFilter)/);
  assert.doesNotMatch(helper, /from ['"].*militaryInstallations/);
  assert.doesNotMatch(helper, /from ['"].*installationListMappedFilter/);
  assert.doesNotMatch(helper, /from ['"].*installationListNamedFilter/);
  assert.doesNotMatch(helper, /from ['"].*installationListOsmFilter/);
  assert.doesNotMatch(helper, /from ['"].*installationListClassFilter/);
});

test('list Footprints only is not a share-link field; LayerStateCoordinator restore keeps the persist key', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['military-installations'].sitesListFootprintsOnly, undefined);
  assert.equal(defaults.options['military-installations'].footprintsOnly, false);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=i'));
  assert.equal(omitted.options['military-installations'].sitesListFootprintsOnly, undefined);

  const state = normalizeLayerState({
    enabledLayerIds: ['military-installations'],
    options: { 'military-installations': { sitesListFootprintsOnly: true, footprintsOnly: true } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /sitesListFootprintsOnly|listFootprintsOnly/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['military-installations'].sitesListFootprintsOnly, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'military-installations').sitesListFootprintsOnly, undefined);

  const storage = memoryStorage({ [SITES_LIST_FOOTPRINTS_ONLY_STORAGE_KEY]: '1' });
  assert.equal(
    readSitesListFootprintsOnly(storage),
    true,
    'coordinator restore of globe options does not wipe the list key',
  );

  resetSitesListFootprintsOnlyFilterForTest();
  setSitesListFootprintsOnlyFilter(true, { storage });
  assert.equal(storage.getItem(SITES_LIST_FOOTPRINTS_ONLY_STORAGE_KEY), '1');
  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['military-installations'],
  }));
  assert.doesNotMatch(encoded.get('lo') || '', /sitesListFootprintsOnly|listFootprintsOnly|m\.sf/);
  assert.doesNotMatch(encoded.toString(), /sitesListFootprintsOnly|meridian\.sitesListFootprintsOnly/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetSitesListFootprintsOnlyFilterForTest();
  assert.equal(getSitesListFootprintsOnlyFilter(), DEFAULT_SITES_LIST_FOOTPRINTS_ONLY);
  assert.equal(hydrateSitesListFootprintsOnlyFilter(storage), true);
  assert.equal(getSitesListFootprintsOnlyFilter(), true);
  assert.equal(storage.getItem(SITES_LIST_FOOTPRINTS_ONLY_STORAGE_KEY), '1');
});

test('militaryInstallations.js is unchanged', () => {
  const layer = read('src/data/militaryInstallations.js');
  assert.doesNotMatch(layer, /sitesListFootprintsOnly|installationListFootprintFilter|meridian\.sitesListFootprintsOnly/);
  assert.doesNotMatch(layer, /listFootprintsPref|filterViewportSitesListFootprint/);

  const mapped = read('src/data/installationListMappedFilter.js');
  assert.doesNotMatch(mapped, /sitesListFootprintsOnly|installationListFootprintFilter/);

  const named = read('src/data/installationListNamedFilter.js');
  assert.doesNotMatch(named, /sitesListFootprintsOnly|installationListFootprintFilter/);

  const osm = read('src/data/installationListOsmFilter.js');
  assert.doesNotMatch(osm, /sitesListFootprintsOnly|installationListFootprintFilter/);

  const klass = read('src/data/installationListClassFilter.js');
  assert.doesNotMatch(klass, /sitesListFootprintsOnly|installationListFootprintFilter/);

  const diff = spawnSync('git', ['diff', 'origin/main', '--', 'src/data/militaryInstallations.js'], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  if (diff.status === 0) {
    assert.equal(diff.stdout, '', 'militaryInstallations.js must stay unchanged vs origin/main');
  }
});

test('getRowControls owns Footprints only after class chips', () => {
  const helper = read('src/data/installationListFootprintFilter.js');
  const list = read('src/data/installationsViewportList.js');
  const html = read('index.html');
  const ui = read('src/ui.js');
  const layerState = read('src/data/layerState.js');
  const license = read('LICENSE');
  const readme = read('README.md');

  assert.match(helper, /record\?\.footprint|installationListHasFootprint/);
  assert.match(helper, /meridian\.sitesListFootprintsOnly/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);
  assert.doesNotMatch(helper, /OpenSky|God's Eye View/i);

  assert.match(list, /filterViewportSitesListFootprint|readSitesListFootprintsPref/);
  assert.match(list, /filterViewportSitesListClass|readSitesListClassPref/);
  assert.match(list, /filterViewportSitesListOsm|readSitesListOsmPref/);
  assert.match(list, /filterViewportSitesListNamed|readSitesListNamedPref/);
  assert.match(list, /filterViewportSitesList|readSitesListMappedPref/);
  assert.match(list, /getRowControls/);
  assert.match(list, /hydrateSitesListFootprintsOnlyFilter|setSitesListFootprintsOnlyFilter|getSitesListFootprintsOnlyFilter/);
  assert.doesNotMatch(list, /milFootprint|militaryFootprintFilter|filterInstallationsByFootprint[^L]/);
  assert.doesNotMatch(list, /\/api\//);

  assert.doesNotMatch(layerState, /sitesListFootprintsOnly/);
  assert.doesNotMatch(ui, /sitesListFootprintsOnly|setSitesListFootprintsOnlyFilter|_initInstallationListFootprint/);
  assert.doesNotMatch(html, /data-installation-list-footprints|installation-list-footprint-chips/);

  assert.equal(existsSync(path.join(ROOT, 'api/military-installations/footprint.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(readme, /quantum-earth/);

  resetSitesListFootprintsOnlyFilterForTest();
  resetSitesListClassFilterForTest();
  const model = sitesListFootprintsOnlyChipModel(false);
  assert.equal(model.id, SITES_LIST_FOOTPRINTS_ONLY_CHIP_ID);
  assert.equal(model.label, 'Footprints only');
  assert.equal(model.active, false);
  assert.equal(model.params.listFootprintsOnly, true);
  assert.equal(sitesListFootprintsOnlyChipModel(true).params.listFootprintsOnly, false);

  const chips = getRowControls().chips;
  assert.deepEqual(chips.map((chip) => chip.label), ['All', 'Airfield', 'Naval', 'Footprints only']);
  assert.equal(chips.find((chip) => chip.params.listClass === 'all').active, true);
  assert.equal(chips.find((chip) => chip.label === 'Footprints only').active, false);

  assert.equal(getParams().listFootprintsOnly, false);
  assert.equal(setParams({ listFootprintsOnly: true }), true);
  assert.equal(getParams().listFootprintsOnly, true);
  assert.equal(getParams().listClass, 'all');
  assert.equal(getRowControls().chips.find((chip) => chip.label === 'Footprints only').active, true);
});
