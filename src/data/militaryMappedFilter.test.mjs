// PLAN 212 — Mapped only toggle (globe). Client-only filter of
// already-fetched OSM/Places records. Distinct from 209 (Sites list only)
// and from 151/165/186/202 (class / footprints / named / osmType).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_INSTALLATION_MAPPED_ONLY,
  INSTALLATION_MAPPED_ONLY_CHIP_LABEL,
  INSTALLATION_MAPPED_ONLY_CHIP_TITLE,
  MILITARY_MAPPED_ONLY_STORAGE_KEY,
  filterInstallationsByMapped,
  installationIsPlaceCandidate,
  installationMappedOnlyChipModel,
  installationMatchesMappedFilter,
  normalizeInstallationMappedOnly,
  readMilitaryMappedOnly,
  writeMilitaryMappedOnly,
} from './militaryMappedFilter.js';
import { filterInstallationsByClass } from './militaryInstallationClassFilter.js';
import { filterInstallationsByFootprint } from './militaryFootprintFilter.js';
import { filterInstallationsByNamed } from './militaryNamedFilter.js';
import { filterInstallationsByOsmType } from './militaryOsmTypeFilter.js';
import militaryInstallationsLayer from './militaryInstallations.js';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
  normalizeLayerState,
} from './layerState.js';
import {
  _resetRenderGovernorForTest,
} from '../renderGovernor.js';
import * as Cesium from 'cesium';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const RING = Object.freeze([
  [-97.71, 30.20],
  [-97.70, 30.20],
  [-97.70, 30.21],
  [-97.71, 30.21],
]);

const MIXED = Object.freeze([
  { id: 'osm:way:1', kind: 'installation', class: 'airfield', name: 'Outlined airfield', osmType: 'way', hasName: true, footprint: RING },
  { id: 'osm:node:2', kind: 'installation', class: 'naval_base', name: 'Point naval', osmType: 'node', hasName: true, footprint: null },
  { id: 'osm:relation:3', kind: 'installation', class: 'range', name: 'Relation range', osmType: 'relation', hasName: false, footprint: RING },
  { id: 'osm:way:4', kind: 'installation', class: 'military_land', name: 'Military land', osmType: 'way', hasName: false, footprint: RING },
  { id: 'google:5', kind: 'place_candidate', class: 'places_candidate', name: 'Camp Mabry', hasName: true, footprint: null },
  { id: 'google:6', kind: 'installation', class: 'military_land', name: 'Fort Hood', hasName: true, footprint: null },
  { id: 'google:7', class: 'places_candidate', name: 'Missing kind', hasName: true, footprint: null },
]);

const VIEWPORT = { south: 30, west: -98, north: 31, east: -97 };

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

function wayGeometry() {
  return [
    { lat: 30.20, lon: -97.71 },
    { lat: 30.20, lon: -97.70 },
    { lat: 30.21, lon: -97.70 },
    { lat: 30.21, lon: -97.71 },
  ];
}

async function runInstallationLoad(elements, { storage, places = [] } = {}) {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const requests = [];
  _resetRenderGovernorForTest();
  if (storage) globalThis.localStorage = storage;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.window = { dispatchEvent() {} };
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('/api/terrain/heights')) {
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    }
    if (href.includes('/api/google/text-search')) {
      requests.push(href);
      return {
        ok: true,
        status: 200,
        json: async () => ({ places }),
      };
    }
    requests.push(href);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 'fresh',
        retrievedAt: '2026-08-25T00:00:00.000Z',
        elements,
        elementCap: 700,
        saturated: false,
      }),
    };
  };
  const dataSources = [];
  const viewer = {
    camera: {
      moveEnd: { addEventListener() { return () => {}; } },
      flyToBoundingSphere() {},
      computeViewRectangle() {
        return {
          south: Cesium.Math.toRadians(VIEWPORT.south),
          west: Cesium.Math.toRadians(VIEWPORT.west),
          north: Cesium.Math.toRadians(VIEWPORT.north),
          east: Cesium.Math.toRadians(VIEWPORT.east),
        };
      },
    },
    scene: {
      canvas: { addEventListener() {}, removeEventListener() {} },
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
      pick() { return null; },
      requestRenderMode: false,
      maximumRenderTimeChange: 0,
      requestRender() {},
    },
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
  };

  militaryInstallationsLayer.init(viewer);
  militaryInstallationsLayer.enable();
  await militaryInstallationsLayer.update();

  return {
    requests,
    entities: () => dataSources[0]?.entities?.values || [],
    restore() {
      militaryInstallationsLayer.destroy(viewer);
      _resetRenderGovernorForTest();
      globalThis.fetch = originalFetch;
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
      if (originalStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = originalStorage;
    },
  };
}

test('Mapped only defaults off and keeps current stems', () => {
  assert.equal(DEFAULT_INSTALLATION_MAPPED_ONLY, false);
  assert.equal(INSTALLATION_MAPPED_ONLY_CHIP_LABEL, 'Mapped only');
  assert.equal(
    INSTALLATION_MAPPED_ONLY_CHIP_TITLE,
    'Show only OSM-mapped installations, hiding Google Places extras',
  );
  assert.equal(normalizeInstallationMappedOnly(undefined), false);
  assert.equal(normalizeInstallationMappedOnly(null), false);
  assert.equal(normalizeInstallationMappedOnly(''), false);
  assert.equal(normalizeInstallationMappedOnly(false), false);
  assert.equal(normalizeInstallationMappedOnly(true), true);
  assert.equal(normalizeInstallationMappedOnly('1'), true);
  assert.equal(normalizeInstallationMappedOnly('true'), true);
  assert.equal(normalizeInstallationMappedOnly(0), false);
  assert.equal(normalizeInstallationMappedOnly('bogus'), null);
  assert.deepEqual(
    filterInstallationsByMapped(MIXED, false).map((record) => record.id),
    MIXED.map((record) => record.id),
    'Off keeps current stems',
  );
  assert.deepEqual(filterInstallationsByMapped(null), []);
  assert.deepEqual(filterInstallationsByMapped(undefined), []);
});

test('on hides google:* place_candidate and keeps osm:* installations', () => {
  assert.equal(installationIsPlaceCandidate({ kind: 'place_candidate' }), true);
  assert.equal(installationIsPlaceCandidate({ kind: 'installation' }), false);
  assert.equal(installationIsPlaceCandidate({}), false);
  assert.equal(installationIsPlaceCandidate({ kind: undefined }), false);
  const kept = filterInstallationsByMapped(MIXED, true).map((record) => record.id);
  assert.deepEqual(kept, [
    'osm:way:1', 'osm:node:2', 'osm:relation:3', 'osm:way:4', 'google:6', 'google:7',
  ]);
  assert.ok(!kept.includes('google:5'), 'google:* place_candidate hides');
  assert.ok(kept.includes('osm:way:1'), 'osm:* installation stays');
  assert.ok(kept.includes('osm:node:2'), 'osm:* installation stays');
  assert.ok(kept.includes('google:6'), 'Google row classified installation stays');
  assert.ok(kept.includes('google:7'), 'missing kind stays');
  assert.equal(installationMatchesMappedFilter({ kind: 'place_candidate' }, true), false);
  assert.equal(installationMatchesMappedFilter({ kind: 'installation' }, true), true);
  assert.equal(installationMatchesMappedFilter({}, true), true);
  assert.equal(installationMatchesMappedFilter({ kind: 'place_candidate' }, false), true);
});

test('selected Google candidate stays when Mapped only is on; All/off restores', () => {
  assert.equal(
    installationMatchesMappedFilter({ id: 'google:5', kind: 'place_candidate' }, true, {
      selectedId: 'google:5',
    }),
    true,
  );
  assert.deepEqual(
    filterInstallationsByMapped(MIXED, true, 'google:5').map((record) => record.id),
    ['osm:way:1', 'osm:node:2', 'osm:relation:3', 'osm:way:4', 'google:5', 'google:6', 'google:7'],
  );
  assert.deepEqual(
    filterInstallationsByMapped(MIXED, false).map((record) => record.id),
    MIXED.map((record) => record.id),
    'All/off restores the current view',
  );
});

test('Mapped only ANDs with class / footprints / named / osmType', () => {
  const afterClass = filterInstallationsByClass(MIXED, 'ARLP');
  assert.deepEqual(
    afterClass.map((record) => record.id),
    ['osm:way:1', 'osm:relation:3', 'osm:way:4', 'google:5', 'google:6', 'google:7'],
    'Naval off hides the point naval before Mapped only runs',
  );
  assert.deepEqual(
    filterInstallationsByMapped(afterClass, true).map((record) => record.id),
    ['osm:way:1', 'osm:relation:3', 'osm:way:4', 'google:6', 'google:7'],
  );
  assert.deepEqual(
    filterInstallationsByMapped(
      filterInstallationsByOsmType(
        filterInstallationsByNamed(
          filterInstallationsByFootprint(afterClass, true),
          true,
        ),
        'way',
      ),
      true,
    ).map((record) => record.id),
    ['osm:way:1'],
    'class chips AND Footprints only AND Named only AND Way AND Mapped only',
  );
  assert.deepEqual(
    filterInstallationsByMapped(
      filterInstallationsByOsmType(
        filterInstallationsByNamed(
          filterInstallationsByFootprint(
            filterInstallationsByClass(MIXED, 'ARLP', 'google:5'),
            true,
            'google:5',
          ),
          true,
          'google:5',
        ),
        'way',
        'google:5',
      ),
      true,
      'google:5',
    ).map((record) => record.id),
    ['osm:way:1', 'google:5'],
    'selected Google candidate stays through all five filters',
  );
});

test('persist helpers use meridian.milMappedOnly and flip survives reload', () => {
  assert.equal(MILITARY_MAPPED_ONLY_STORAGE_KEY, 'meridian.milMappedOnly');
  const storage = memoryStorage();
  assert.equal(readMilitaryMappedOnly(storage), false);
  assert.equal(writeMilitaryMappedOnly(true, storage), true);
  assert.equal(storage.getItem(MILITARY_MAPPED_ONLY_STORAGE_KEY), '1');
  assert.equal(readMilitaryMappedOnly(storage), true);
  assert.equal(writeMilitaryMappedOnly(true, memoryStorage(storage.snapshot())), true);
  assert.equal(
    readMilitaryMappedOnly(memoryStorage(storage.snapshot())),
    true,
    'reload keeps Mapped only on',
  );
  assert.equal(writeMilitaryMappedOnly(false, storage), true);
  assert.equal(storage.getItem(MILITARY_MAPPED_ONLY_STORAGE_KEY), '0');
  assert.equal(readMilitaryMappedOnly(storage), false);
  assert.equal(writeMilitaryMappedOnly('nope', storage), false);
  assert.equal(storage.getItem(MILITARY_MAPPED_ONLY_STORAGE_KEY), '0');
});

test('Mapped only is not a share-link field', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['military-installations'].mappedOnly, undefined);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=i'));
  assert.equal(omitted.options['military-installations'].mappedOnly, undefined);

  const state = normalizeLayerState({
    enabledLayerIds: ['military-installations'],
    options: { 'military-installations': { mappedOnly: true } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /mappedOnly|i\.m\.|milMappedOnly/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['military-installations'].mappedOnly, undefined);
});

test('helper reads record.kind and the chip sits next to class chips', () => {
  const helper = readFileSync(new URL('./militaryMappedFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/militaryInstallations.js'), 'utf8');
  const list = readFileSync(path.join(ROOT, 'src/data/installationsViewportList.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  assert.match(helper, /record\?\.kind === 'place_candidate'/);
  assert.match(helper, /meridian\.milMappedOnly/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.match(source, /mappedOnly/);
  assert.match(source, /filterInstallationsByMapped|installationMatchesMappedFilter/);
  assert.match(source, /writeMilitaryMappedOnly/);
  assert.match(source, /readMilitaryMappedOnly/);
  assert.match(html, /id="installation-mapped-chips"/);
  assert.match(html, /data-installation-mapped="only"/);
  assert.match(html, /Mapped only/);
  assert.match(html, /id="installation-class-chips"/);
  assert.match(html, /id="installation-footprint-chips"/);
  assert.match(html, /id="installation-named-chips"/);
  assert.match(html, /id="installation-osm-type-chips"/);
  assert.match(ui, /installation-mapped-chips|data-installation-mapped/);
  assert.match(ui, /_installationMappedChips\.hidden = !enabled/);
  assert.match(css, /installation-mapped-chip/);
  assert.doesNotMatch(layerState, /mappedOnly|milMappedOnly/);
  assert.doesNotMatch(source, /\/api\/military-installations\/mapped/);
  assert.equal(existsSync(path.join(ROOT, 'api/military-installations/mapped.js')), false);
  assert.doesNotMatch(source, /earthquakes\.js|satellites\.js|Google News|TeleGeography|quantum-earth|God's Eye View/);
  assert.doesNotMatch(helper, /earthquakes\.js|satellites\.js|Google News|TeleGeography/);
  assert.doesNotMatch(list, /mappedOnly|milMappedOnly|militaryMappedFilter|filterInstallationsByMapped/);
  assert.doesNotMatch(list, /place_candidate/);
  assert.equal(installationMappedOnlyChipModel(false).params.mappedOnly, true);
  assert.equal(installationMappedOnlyChipModel(true).params.mappedOnly, false);
});

test('layer setParams hides place_candidate; selected stays; refresh keeps toggle', async () => {
  const storage = memoryStorage();
  const run = await runInstallationLoad([
    {
      type: 'way',
      id: 1,
      center: { lat: 30.20, lon: -97.70 },
      tags: { military: 'airfield', name: 'Outlined Airfield' },
      geometry: wayGeometry(),
    },
    {
      type: 'node',
      id: 2,
      lat: 30.21,
      lon: -97.71,
      tags: { military: 'naval_base', name: 'Point Naval' },
    },
    {
      type: 'way',
      id: 4,
      center: { lat: 30.23, lon: -97.73 },
      tags: { military: 'base', name: 'Land Way' },
      geometry: wayGeometry(),
    },
  ], {
    storage,
    places: [
      {
        id: 'place-cand-1',
        name: 'Camp Mabry',
        latitude: 30.24,
        longitude: -97.74,
        primaryType: 'point_of_interest',
        types: ['establishment'],
      },
      {
        id: 'place-install-1',
        name: 'Fort Hood',
        latitude: 30.25,
        longitude: -97.75,
        primaryType: 'military_base',
        types: ['military_base'],
      },
    ],
  });
  try {
    await militaryInstallationsLayer.searchNearby();
    const ids = () => run.entities().map((entity) => entity.id).sort();
    assert.deepEqual(ids(), [
      'google:place-cand-1', 'google:place-install-1', 'osm:node:2', 'osm:way:1', 'osm:way:4',
    ]);
    assert.equal(militaryInstallationsLayer.getParams().mappedOnly, false);
    const fetchesBefore = run.requests.length;
    assert.equal(militaryInstallationsLayer.setParams({ mappedOnly: true }), true);
    assert.equal(run.requests.length, fetchesBefore, 'Mapped only must not refetch Overpass or Places');
    assert.equal(militaryInstallationsLayer.getParams().mappedOnly, true);
    assert.equal(storage.getItem(MILITARY_MAPPED_ONLY_STORAGE_KEY), '1');
    assert.deepEqual(ids(), ['google:place-install-1', 'osm:node:2', 'osm:way:1', 'osm:way:4']);
    assert.ok(!ids().includes('google:place-cand-1'), 'google:* place_candidate hides on the globe');
    assert.ok(ids().includes('osm:way:1'), 'osm:* installation stays');
    assert.ok(ids().includes('google:place-install-1'), 'Google military_base installation stays');
    assert.deepEqual(
      militaryInstallationsLayer.getViewportRecords().map((record) => record.id).sort(),
      ['google:place-install-1', 'osm:node:2', 'osm:way:1', 'osm:way:4'],
    );

    assert.equal(militaryInstallationsLayer.focusById('google:place-cand-1'), true);
    assert.ok(ids().includes('google:place-cand-1'), 'selected Google candidate stays');
    assert.ok(
      militaryInstallationsLayer.getViewportRecords().some((record) => record.id === 'google:place-cand-1'),
    );

    assert.equal(militaryInstallationsLayer.setParams({ installationClassFilter: 'ARLP' }), true);
    assert.ok(ids().includes('google:place-cand-1'), 'class chips AND Mapped only; selected candidate still stays');
    assert.ok(ids().includes('osm:way:1'));
    assert.ok(!ids().includes('osm:node:2'), 'Naval off still ANDs');

    assert.equal(militaryInstallationsLayer.setParams({ footprintsOnly: true }), true);
    assert.ok(ids().includes('google:place-cand-1'), 'Footprints only still ANDs; selected stays');
    assert.ok(ids().includes('osm:way:1'));

    assert.equal(militaryInstallationsLayer.setParams({ namedOnly: true }), true);
    assert.ok(ids().includes('google:place-cand-1'), 'Named only still ANDs; selected stays');

    assert.equal(militaryInstallationsLayer.setParams({ osmType: 'way' }), true);
    assert.ok(ids().includes('google:place-cand-1'), 'OSM-type still ANDs; selected stays');
    assert.ok(ids().includes('osm:way:1'));

    await militaryInstallationsLayer.update();
    assert.equal(militaryInstallationsLayer.getParams().mappedOnly, true, 'viewport refresh keeps the toggle');
    assert.equal(militaryInstallationsLayer.getParams().installationClassFilter, 'ARLP');
    assert.equal(militaryInstallationsLayer.getParams().footprintsOnly, true);
    assert.equal(militaryInstallationsLayer.getParams().namedOnly, true);
    assert.equal(militaryInstallationsLayer.getParams().osmType, 'way');
    assert.ok(ids().includes('osm:way:1'));
    assert.equal(militaryInstallationsLayer.setParams({ mappedOnly: 'nope' }), false);
    assert.equal(militaryInstallationsLayer.getParams().mappedOnly, true);

    assert.equal(militaryInstallationsLayer.setParams({ mappedOnly: false }), true);
    assert.ok(ids().includes('osm:way:1'), 'All/off keeps current OSM stems when other chips allow');
  } finally {
    run.restore();
  }
});

test('flip persist survives reload via LayerStateCoordinator-style init re-read', async () => {
  const storage = memoryStorage({ [MILITARY_MAPPED_ONLY_STORAGE_KEY]: '1' });
  const run = await runInstallationLoad([
    {
      type: 'way',
      id: 1,
      center: { lat: 30.20, lon: -97.70 },
      tags: { military: 'airfield', name: 'Outlined Airfield' },
      geometry: wayGeometry(),
    },
    {
      type: 'node',
      id: 2,
      lat: 30.21,
      lon: -97.71,
      tags: { military: 'naval_base', name: 'Point Naval' },
    },
  ], {
    storage,
    places: [
      {
        id: 'place-cand-1',
        name: 'Camp Mabry',
        latitude: 30.24,
        longitude: -97.74,
        primaryType: 'point_of_interest',
        types: ['establishment'],
      },
    ],
  });
  try {
    await militaryInstallationsLayer.searchNearby();
    const ids = () => run.entities().map((entity) => entity.id).sort();
    assert.equal(militaryInstallationsLayer.getParams().mappedOnly, true);
    assert.deepEqual(ids(), ['osm:node:2', 'osm:way:1'], 'init re-reads meridian.milMappedOnly');
    assert.ok(!ids().includes('google:place-cand-1'));
    assert.equal(militaryInstallationsLayer.setParams({ installationClassFilter: 'all' }), true);
    assert.equal(militaryInstallationsLayer.getParams().mappedOnly, true, 'coordinator-style restore of other options keeps Mapped only');
  } finally {
    run.restore();
  }
});
