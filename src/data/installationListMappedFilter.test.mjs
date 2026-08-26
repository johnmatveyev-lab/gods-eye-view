// PLAN 209 — Sites list Mapped only toggle. Client-only filter of
// already-fetched viewport rows. Distinct from 151 class, 165 footprints,
// 186 named, 202 osmType, and the globe Mapped only chip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SITES_MAPPED_ONLY,
  SITES_MAPPED_ONLY_CHIP_LABEL,
  SITES_MAPPED_ONLY_CHIP_TITLE,
  SITES_MAPPED_ONLY_STORAGE_KEY,
  filterInstallationsByMappedOnly,
  filterViewportSitesList,
  installationIsPlaceCandidate,
  installationMatchesMappedFilter,
  normalizeSitesMappedOnly,
  readSitesListMappedPref,
  readSitesMappedOnly,
  sitesMappedOnlyChipModel,
  writeSitesMappedOnly,
} from './installationListMappedFilter.js';
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
    id: 'google:land',
    kind: 'installation',
    class: 'military_land',
    name: 'Places Land',
    latitude: 30.22,
    longitude: -97.72,
    osmType: undefined,
  }),
  record({
    id: 'osm:relation:9',
    kind: undefined,
    class: 'range',
    name: 'Legacy Range',
    latitude: 30.23,
    longitude: -97.73,
    osmType: 'relation',
  }),
]);

test('Mapped only defaults off and keeps the current 50-row list', () => {
  assert.equal(DEFAULT_SITES_MAPPED_ONLY, false);
  assert.equal(filterViewportSitesList, filterInstallationsByMappedOnly);
  assert.equal(readSitesListMappedPref, readSitesMappedOnly);
  assert.equal(SITES_MAPPED_ONLY_CHIP_LABEL, 'Mapped only');
  assert.equal(SITES_MAPPED_ONLY_CHIP_TITLE, 'Hide Google Places candidates from this list');
  assert.equal(SITES_MAPPED_ONLY_STORAGE_KEY, 'meridian.sitesMappedOnly');
  assert.equal(normalizeSitesMappedOnly(undefined), false);
  assert.equal(normalizeSitesMappedOnly(null), false);
  assert.equal(normalizeSitesMappedOnly(''), false);
  assert.equal(normalizeSitesMappedOnly(false), false);
  assert.equal(normalizeSitesMappedOnly(true), true);
  assert.equal(normalizeSitesMappedOnly('1'), true);
  assert.equal(normalizeSitesMappedOnly('true'), true);
  assert.equal(normalizeSitesMappedOnly(0), false);
  assert.equal(normalizeSitesMappedOnly('bogus'), null);

  const overflow = Array.from({ length: 61 }, (_, index) => record({
    id: index % 3 === 0 ? `google:${index}` : `osm:node:${index}`,
    kind: index % 3 === 0 ? 'place_candidate' : 'installation',
    name: `Site ${index}`,
  }));
  const off = listViewportInstallations(overflow, { listMappedPref: false });
  assert.equal(off.length, 50);
  assert.equal(off.at(-1).id, 'osm:node:49');
  assert.ok(off.some((row) => row.id.startsWith('google:')));
  assert.deepEqual(
    filterInstallationsByMappedOnly(MIXED, false).map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterInstallationsByMappedOnly(null), []);
  assert.deepEqual(filterInstallationsByMappedOnly(undefined), []);
  assert.equal(installationMatchesMappedFilter(MIXED[2], false), true);
});

test('on hides google:* place_candidate rows and keeps osm:* installations', () => {
  assert.equal(installationIsPlaceCandidate(MIXED[2]), true);
  assert.equal(installationIsPlaceCandidate(MIXED[0]), false);
  assert.equal(installationIsPlaceCandidate({}), false);
  assert.equal(installationMatchesMappedFilter(MIXED[2], true), false);
  assert.equal(installationMatchesMappedFilter(MIXED[0], true), true);
  assert.equal(installationMatchesMappedFilter(MIXED[3], true), true, 'Places military_land stays');
  assert.equal(installationMatchesMappedFilter(MIXED[4], true), true, 'missing kind stays');

  const kept = filterInstallationsByMappedOnly(MIXED, true).map((row) => row.id);
  assert.deepEqual(kept, ['osm:node:1', 'osm:way:2', 'google:land', 'osm:relation:9']);
  assert.ok(!kept.includes('google:abc'));

  const rows = listViewportInstallations(MIXED, { listMappedPref: true });
  assert.deepEqual(rows.map((row) => row.id), ['osm:node:1', 'osm:way:2', 'google:land', 'osm:relation:9']);
  assert.ok(rows.every((row) => row.id !== 'google:abc'));
});

test('off keeps the mixed 50-row payload; on fills the cap from mapped rows', () => {
  const payload = Array.from({ length: 61 }, (_, index) => record({
    id: index < 10 ? `google:${index}` : `osm:node:${index}`,
    kind: index < 10 ? 'place_candidate' : 'installation',
    name: `Site ${index}`,
  }));
  const off = listViewportInstallations(payload, { listMappedPref: false });
  assert.equal(off.length, 50);
  assert.equal(off[0].id, 'google:0');
  assert.equal(off.at(-1).id, 'osm:node:49');

  const on = listViewportInstallations(payload, { listMappedPref: true });
  assert.equal(on.length, 50);
  assert.equal(on[0].id, 'osm:node:10');
  assert.equal(on.at(-1).id, 'osm:node:59');
  assert.ok(on.every((row) => !row.id.startsWith('google:')));
});

test('Mapped only is distinct from class / footprints / named / osmType globe chips', () => {
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
    filterInstallationsByMappedOnly(afterGlobe, true).map((row) => row.id),
    ['osm:node:1', 'osm:way:2', 'google:land', 'osm:relation:9'],
  );
  const helper = read('src/data/installationListMappedFilter.js');
  assert.doesNotMatch(helper, /setLayerParams/);
  assert.doesNotMatch(helper, /from ['"].*militaryInstallation(s|ClassFilter|FootprintFilter|NamedFilter|OsmTypeFilter|MappedFilter)/);
  assert.doesNotMatch(helper, /from ['"].*militaryInstallations/);
});

test('meridian.sitesMappedOnly persists and reload keeps the flip', () => {
  const storage = memoryStorage();
  assert.equal(readSitesMappedOnly(storage), DEFAULT_SITES_MAPPED_ONLY);
  assert.equal(writeSitesMappedOnly(true, storage), true);
  assert.equal(storage.getItem(SITES_MAPPED_ONLY_STORAGE_KEY), '1');
  assert.equal(readSitesMappedOnly(storage), true);
  assert.equal(readSitesMappedOnly(memoryStorage(storage.snapshot())), true, 'reload keeps on');

  const restored = listViewportInstallations(MIXED, {
    listMappedPref: readSitesMappedOnly(memoryStorage(storage.snapshot())),
  });
  assert.deepEqual(restored.map((row) => row.id), ['osm:node:1', 'osm:way:2', 'google:land', 'osm:relation:9']);

  assert.equal(writeSitesMappedOnly(false, storage), true);
  assert.equal(storage.getItem(SITES_MAPPED_ONLY_STORAGE_KEY), '0');
  assert.equal(readSitesMappedOnly(memoryStorage(storage.snapshot())), false, 'reload keeps off');
  assert.equal(writeSitesMappedOnly('nope', storage), false);
  assert.equal(storage.getItem(SITES_MAPPED_ONLY_STORAGE_KEY), '0');
});

test('Mapped only is not a share-link field; LayerStateCoordinator restore keeps the persist key', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['military-installations'].sitesMappedOnly, undefined);
  assert.equal(defaults.options['military-installations'].mappedOnly, undefined);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=i'));
  assert.equal(omitted.options['military-installations'].sitesMappedOnly, undefined);

  const state = normalizeLayerState({
    enabledLayerIds: ['military-installations'],
    options: { 'military-installations': { sitesMappedOnly: true, mappedOnly: true } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /sitesMappedOnly|mappedOnly|i\.m\.|sitesMapped/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['military-installations'].sitesMappedOnly, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'military-installations').sitesMappedOnly, undefined);

  const storage = memoryStorage({ [SITES_MAPPED_ONLY_STORAGE_KEY]: '1' });
  assert.equal(readSitesMappedOnly(storage), true, 'coordinator restore of globe options does not wipe the list key');
});

test('chip sits on the Sites list; militaryInstallations.js is unchanged', () => {
  const helper = read('src/data/installationListMappedFilter.js');
  const list = read('src/data/installationsViewportList.js');
  const layer = read('src/data/militaryInstallations.js');
  const html = read('index.html');
  const ui = read('src/ui.js');
  const css = read('style.css');
  const layerState = read('src/data/layerState.js');
  const license = read('LICENSE');
  const readme = read('README.md');

  assert.match(helper, /record\?\.kind/);
  assert.match(helper, /place_candidate/);
  assert.match(helper, /meridian\.sitesMappedOnly/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);

  assert.match(list, /filterViewportSitesList|readSitesListMappedPref/);
  assert.doesNotMatch(list, /mappedOnly|milMappedOnly|militaryMappedFilter|filterInstallationsByMapped/);
  assert.doesNotMatch(list, /place_candidate/);
  assert.doesNotMatch(list, /\/api\//);

  assert.doesNotMatch(layer, /sitesMappedOnly|installationListMappedFilter/);
  assert.doesNotMatch(layerState, /sitesMappedOnly|sitesMapped/);

  assert.match(html, /id="installation-mapped-chips"/);
  assert.match(html, /data-installation-mapped="only"/);
  assert.match(html, /id="installation-list-mapped-chips"/);
  assert.match(html, /data-installation-list-mapped="only"/);
  assert.match(html, /Hide Google Places candidates from this list/);
  assert.match(html, /id="installation-class-chips"/);
  assert.match(html, /id="installation-footprint-chips"/);
  assert.match(html, /id="installation-named-chips"/);
  assert.match(html, /id="installation-osm-type-chips"/);
  assert.ok(
    html.indexOf('id="installation-mapped-chips"') < html.indexOf('id="installation-list-mapped-chips"'),
    'list Mapped only sits after the globe Mapped only chip',
  );
  assert.ok(
    html.indexOf('id="installations-viewport-list"') < html.indexOf('id="installation-list-mapped-chips"'),
    'list Mapped only lives on the hosted Sites list',
  );

  assert.match(ui, /installation-list-mapped-chips|data-installation-list-mapped/);
  assert.match(ui, /_installationListMappedChips\.hidden = !enabled/);
  assert.match(ui, /writeSitesMappedOnly\(/);
  assert.match(ui, /readSitesMappedOnly\(/);
  const listInit = ui.slice(ui.indexOf('_initInstallationListMappedChip'));
  assert.doesNotMatch(listInit, /setLayerParams/);
  assert.match(css, /installation-list-mapped-chip/);

  assert.equal(existsSync(path.join(ROOT, 'api/military-installations/mapped.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(readme, /quantum-earth/);

  assert.equal(sitesMappedOnlyChipModel(false).params.mappedOnly, true);
  assert.equal(sitesMappedOnlyChipModel(true).params.mappedOnly, false);
  assert.equal(sitesMappedOnlyChipModel(false).label, 'Mapped only');
});
