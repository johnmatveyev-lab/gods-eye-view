// PLAN 202 — Military OSM-type chips All | Way | Node | Relation.
// Client-only filter of already-fetched OSM/Places records. Distinct from
// 151/165/186 (not class chips / Footprints only / Named only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_INSTALLATION_OSM_TYPE,
  INSTALLATION_OSM_TYPE_CHIP_IDS,
  MILITARY_OSM_TYPE_STORAGE_KEY,
  filterInstallationsByOsmType,
  installationMatchesOsmTypeFilter,
  installationOsmType,
  installationOsmTypeChipModels,
  normalizeInstallationOsmType,
  readMilitaryOsmType,
  writeMilitaryOsmType,
} from './militaryOsmTypeFilter.js';
import { filterInstallationsByClass } from './militaryInstallationClassFilter.js';
import { filterInstallationsByFootprint } from './militaryFootprintFilter.js';
import { filterInstallationsByNamed } from './militaryNamedFilter.js';
import { normalizeMilitaryInstallations } from './militaryInstallationData.js';
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
  { id: 'osm:way:1', class: 'airfield', name: 'Outlined airfield', osmType: 'way', hasName: true, footprint: RING },
  { id: 'osm:node:2', class: 'naval_base', name: 'Point naval', osmType: 'node', hasName: true, footprint: null },
  { id: 'osm:relation:3', class: 'range', name: 'Relation range', osmType: 'relation', hasName: false, footprint: RING },
  { id: 'osm:way:4', class: 'military_land', name: 'Military land', osmType: 'way', hasName: false, footprint: RING },
  { id: 'google:5', class: 'places_candidate', name: 'Camp Mabry', hasName: true, footprint: null },
  { id: 'osm:node:6', class: 'airfield', name: 'Point airfield', osmType: 'node', hasName: true, footprint: null },
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

async function runInstallationLoad(elements, { storage } = {}) {
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

test('All defaults and matches the current unfiltered set', () => {
  assert.deepEqual([...INSTALLATION_OSM_TYPE_CHIP_IDS], ['all', 'way', 'node', 'relation']);
  assert.equal(DEFAULT_INSTALLATION_OSM_TYPE, 'all');
  assert.equal(normalizeInstallationOsmType(undefined), 'all');
  assert.equal(normalizeInstallationOsmType(null), 'all');
  assert.equal(normalizeInstallationOsmType(''), 'all');
  assert.equal(normalizeInstallationOsmType('all'), 'all');
  assert.equal(normalizeInstallationOsmType('WAY'), 'way');
  assert.equal(normalizeInstallationOsmType('node'), 'node');
  assert.equal(normalizeInstallationOsmType('relation'), 'relation');
  assert.equal(normalizeInstallationOsmType('nope'), null);
  assert.equal(normalizeInstallationOsmType(false), null);
  assert.deepEqual(
    filterInstallationsByOsmType(MIXED, 'all').map((record) => record.id),
    MIXED.map((record) => record.id),
  );
  assert.deepEqual(filterInstallationsByOsmType(null), []);
  assert.deepEqual(filterInstallationsByOsmType(undefined), []);
});

test('Way hides nodes and relations; Node hides ways and relations; Relation hides nodes and ways', () => {
  assert.equal(installationOsmType('way'), 'way');
  assert.equal(installationOsmType('node'), 'node');
  assert.equal(installationOsmType('relation'), 'relation');
  assert.equal(installationOsmType(undefined), null);
  assert.equal(installationOsmType(''), null);

  const ways = filterInstallationsByOsmType(MIXED, 'way').map((record) => record.id);
  assert.deepEqual(ways, ['osm:way:1', 'osm:way:4', 'google:5']);
  assert.ok(!ways.includes('osm:node:2'));
  assert.ok(!ways.includes('osm:relation:3'));
  assert.ok(!ways.includes('osm:node:6'));
  assert.ok(ways.includes('google:5'), 'missing osmType stays visible');

  const nodes = filterInstallationsByOsmType(MIXED, 'node').map((record) => record.id);
  assert.deepEqual(nodes, ['osm:node:2', 'google:5', 'osm:node:6']);
  assert.ok(!nodes.includes('osm:way:1'));
  assert.ok(!nodes.includes('osm:relation:3'));

  const relations = filterInstallationsByOsmType(MIXED, 'relation').map((record) => record.id);
  assert.deepEqual(relations, ['osm:relation:3', 'google:5']);
  assert.ok(!relations.includes('osm:way:1'));
  assert.ok(!relations.includes('osm:node:2'));

  assert.equal(installationMatchesOsmTypeFilter({ osmType: 'node' }, 'way'), false);
  assert.equal(installationMatchesOsmTypeFilter({ osmType: 'way' }, 'way'), true);
  assert.equal(installationMatchesOsmTypeFilter({ osmType: 'relation' }, 'all'), true);
  assert.equal(installationMatchesOsmTypeFilter({}, 'way'), true, 'Places candidate with no osmType stays');
});

test('selected site stays when its type is not the active chip', () => {
  assert.equal(
    installationMatchesOsmTypeFilter({ id: 'osm:node:2', osmType: 'node' }, 'way', {
      selectedId: 'osm:node:2',
    }),
    true,
  );
  assert.deepEqual(
    filterInstallationsByOsmType(MIXED, 'way', 'osm:node:2').map((record) => record.id),
    ['osm:way:1', 'osm:node:2', 'osm:way:4', 'google:5'],
  );
  assert.deepEqual(
    filterInstallationsByOsmType(MIXED, 'all').map((record) => record.id),
    MIXED.map((record) => record.id),
    'All restores the current view',
  );
});

test('OSM-type chips AND with Plan 151 class chips, Plan 165 Footprints only, and Plan 186 Named only', () => {
  const afterClass = filterInstallationsByClass(MIXED, 'ARLP');
  assert.deepEqual(
    afterClass.map((record) => record.id),
    ['osm:way:1', 'osm:relation:3', 'osm:way:4', 'google:5', 'osm:node:6'],
    'Naval off hides the point naval before OSM-type runs',
  );
  assert.deepEqual(
    filterInstallationsByOsmType(afterClass, 'way').map((record) => record.id),
    ['osm:way:1', 'osm:way:4', 'google:5'],
  );
  assert.deepEqual(
    filterInstallationsByOsmType(
      filterInstallationsByNamed(
        filterInstallationsByFootprint(afterClass, true),
        true,
      ),
      'way',
    ).map((record) => record.id),
    ['osm:way:1'],
    'class chips AND Footprints only AND Named only AND Way (Places pin has no footprint)',
  );
  assert.deepEqual(
    filterInstallationsByOsmType(
      filterInstallationsByNamed(
        filterInstallationsByFootprint(
          filterInstallationsByClass(MIXED, 'ARLP', 'osm:node:2'),
          true,
          'osm:node:2',
        ),
        true,
        'osm:node:2',
      ),
      'way',
      'osm:node:2',
    ).map((record) => record.id),
    ['osm:way:1', 'osm:node:2'],
    'selected point naval stays through all four filters',
  );
});

test('normalize already stamps osmType from the Overpass element', () => {
  const result = normalizeMilitaryInstallations({ elements: [
    { type: 'way', id: 1, center: { lat: 30.2, lon: -97.7 }, tags: { military: 'airfield', name: 'Fort X' } },
    { type: 'node', id: 2, lat: 30.3, lon: -97.6, tags: { military: 'naval_base', name: 'Naval Station' } },
    { type: 'relation', id: 3, center: { lat: 30.4, lon: -97.5 }, tags: { military: 'range', name: 'Range Complex' } },
  ] });
  assert.equal(result.records[0].osmType, 'way');
  assert.equal(result.records[1].osmType, 'node');
  assert.equal(result.records[2].osmType, 'relation');
});

test('persist helpers use meridian.milOsmType and flip survives reload', () => {
  assert.equal(MILITARY_OSM_TYPE_STORAGE_KEY, 'meridian.milOsmType');
  const storage = memoryStorage();
  assert.equal(readMilitaryOsmType(storage), 'all');
  assert.equal(writeMilitaryOsmType('way', storage), true);
  assert.equal(storage.getItem(MILITARY_OSM_TYPE_STORAGE_KEY), 'way');
  assert.equal(readMilitaryOsmType(storage), 'way');
  assert.equal(writeMilitaryOsmType('node', storage), true);
  assert.equal(readMilitaryOsmType(memoryStorage(storage.snapshot())), 'node', 'reload keeps Node');
  assert.equal(writeMilitaryOsmType('relation', storage), true);
  assert.equal(readMilitaryOsmType(memoryStorage(storage.snapshot())), 'relation', 'reload keeps Relation');
  assert.equal(writeMilitaryOsmType('all', storage), true);
  assert.equal(storage.getItem(MILITARY_OSM_TYPE_STORAGE_KEY), 'all');
  assert.equal(writeMilitaryOsmType('nope', storage), false);
  assert.equal(storage.getItem(MILITARY_OSM_TYPE_STORAGE_KEY), 'all');
});

test('OSM type is not a share-link field', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['military-installations'].osmType, undefined);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=i'));
  assert.equal(omitted.options['military-installations'].osmType, undefined);

  const state = normalizeLayerState({
    enabledLayerIds: ['military-installations'],
    options: { 'military-installations': { osmType: 'way' } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /osmType|i\.o\.|milOsmType/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['military-installations'].osmType, undefined);
});

test('helper reads record.osmType and exclusive chips sit next to class chips', () => {
  const helper = readFileSync(new URL('./militaryOsmTypeFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/militaryInstallations.js'), 'utf8');
  const data = readFileSync(path.join(ROOT, 'src/data/militaryInstallationData.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  assert.match(helper, /record\?\.osmType/);
  assert.match(helper, /meridian\.milOsmType/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.match(data, /osmType: type/);
  assert.match(source, /osmType/);
  assert.match(source, /filterInstallationsByOsmType|installationMatchesOsmTypeFilter/);
  assert.match(source, /writeMilitaryOsmType/);
  assert.match(source, /readMilitaryOsmType/);
  assert.match(html, /id="installation-osm-type-chips"/);
  assert.match(html, /data-installation-osm-type="all"/);
  assert.match(html, /data-installation-osm-type="way"/);
  assert.match(html, /data-installation-osm-type="node"/);
  assert.match(html, /data-installation-osm-type="relation"/);
  assert.match(html, />All</);
  assert.match(html, />Way</);
  assert.match(html, />Node</);
  assert.match(html, />Relation</);
  assert.match(html, /id="installation-class-chips"/);
  assert.match(html, /id="installation-footprint-chips"/);
  assert.match(html, /id="installation-named-chips"/);
  assert.match(ui, /installation-osm-type-chips|data-installation-osm-type/);
  assert.match(ui, /_installationOsmTypeChips\.hidden = !enabled/);
  assert.match(css, /installation-osm-type-chip/);
  assert.doesNotMatch(layerState, /osmType|milOsmType/);
  assert.doesNotMatch(source, /\/api\/military-installations\/osm/);
  assert.equal(existsSync(path.join(ROOT, 'api/military-installations/osm.js')), false);
  assert.doesNotMatch(source, /earthquakes\.js|satellites\.js|Google News|TeleGeography|quantum-earth|God's Eye View/);
  assert.doesNotMatch(helper, /earthquakes\.js|satellites\.js|Google News|TeleGeography/);
  const models = installationOsmTypeChipModels('way');
  assert.deepEqual(models.map((chip) => chip.label), ['All', 'Way', 'Node', 'Relation']);
  assert.deepEqual(models.map((chip) => chip.params.osmType), ['all', 'way', 'node', 'relation']);
  assert.equal(models.filter((chip) => chip.active).length, 1);
  assert.equal(models.find((chip) => chip.params.osmType === 'way').active, true);
});

test('layer setParams hides other primitives; selected stays; refresh keeps chip', async () => {
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
      type: 'relation',
      id: 3,
      center: { lat: 30.22, lon: -97.72 },
      tags: { military: 'range', name: 'Relation Range' },
      geometry: wayGeometry(),
    },
    {
      type: 'way',
      id: 4,
      center: { lat: 30.23, lon: -97.73 },
      tags: { military: 'base', name: 'Land Way' },
      geometry: wayGeometry(),
    },
  ], { storage });
  try {
    const ids = () => run.entities().map((entity) => entity.id).sort();
    assert.deepEqual(ids(), [
      'osm:node:2', 'osm:relation:3', 'osm:way:1', 'osm:way:4',
    ]);
    assert.equal(militaryInstallationsLayer.getParams().osmType, 'all');
    const fetchesBefore = run.requests.length;
    assert.equal(militaryInstallationsLayer.setParams({ osmType: 'way' }), true);
    assert.equal(run.requests.length, fetchesBefore, 'OSM-type chips must not refetch Overpass');
    assert.equal(militaryInstallationsLayer.getParams().osmType, 'way');
    assert.equal(storage.getItem(MILITARY_OSM_TYPE_STORAGE_KEY), 'way');
    assert.deepEqual(ids(), ['osm:way:1', 'osm:way:4']);
    assert.deepEqual(
      militaryInstallationsLayer.getViewportRecords().map((record) => record.id).sort(),
      ['osm:way:1', 'osm:way:4'],
    );

    assert.equal(militaryInstallationsLayer.setParams({ osmType: 'node' }), true);
    assert.deepEqual(ids(), ['osm:node:2']);
    assert.equal(militaryInstallationsLayer.setParams({ osmType: 'relation' }), true);
    assert.deepEqual(ids(), ['osm:relation:3']);

    assert.equal(militaryInstallationsLayer.focusById('osm:node:2'), true);
    assert.ok(ids().includes('osm:node:2'), 'selected point naval stays');
    assert.ok(
      militaryInstallationsLayer.getViewportRecords().some((record) => record.id === 'osm:node:2'),
    );

    assert.equal(militaryInstallationsLayer.setParams({ installationClassFilter: 'ARLP' }), true);
    assert.deepEqual(
      ids().sort(),
      ['osm:node:2', 'osm:relation:3'],
      'class chips AND OSM type; selected point naval still stays',
    );

    assert.equal(militaryInstallationsLayer.setParams({ footprintsOnly: true }), true);
    assert.deepEqual(
      ids().sort(),
      ['osm:node:2', 'osm:relation:3'],
      'Footprints only still ANDs; selected point naval stays',
    );

    assert.equal(militaryInstallationsLayer.setParams({ namedOnly: true }), true);
    assert.ok(ids().includes('osm:node:2'), 'Named only still ANDs; selected stays');

    await militaryInstallationsLayer.update();
    assert.equal(militaryInstallationsLayer.getParams().osmType, 'relation', 'viewport refresh keeps the chip set');
    assert.equal(militaryInstallationsLayer.getParams().installationClassFilter, 'ARLP');
    assert.equal(militaryInstallationsLayer.getParams().footprintsOnly, true);
    assert.equal(militaryInstallationsLayer.getParams().namedOnly, true);
    assert.ok(ids().includes('osm:node:2'));
    assert.ok(ids().includes('osm:relation:3'));
    assert.equal(militaryInstallationsLayer.setParams({ osmType: 'nope' }), false);
    assert.equal(militaryInstallationsLayer.getParams().osmType, 'relation');

    assert.equal(militaryInstallationsLayer.setParams({ osmType: 'all' }), true);
    assert.ok(ids().includes('osm:way:1'), 'All restores ways when class chip allows');
    assert.ok(ids().includes('osm:way:4'));
  } finally {
    run.restore();
  }
});

test('flip persist survives reload via LayerStateCoordinator-style init re-read', async () => {
  const storage = memoryStorage({ [MILITARY_OSM_TYPE_STORAGE_KEY]: 'way' });
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
      type: 'relation',
      id: 3,
      center: { lat: 30.22, lon: -97.72 },
      tags: { military: 'range', name: 'Relation Range' },
    },
  ], { storage });
  try {
    const ids = () => run.entities().map((entity) => entity.id).sort();
    assert.equal(militaryInstallationsLayer.getParams().osmType, 'way');
    assert.deepEqual(ids(), ['osm:way:1'], 'init re-reads meridian.milOsmType');
    assert.equal(militaryInstallationsLayer.setParams({ installationClassFilter: 'all' }), true);
    assert.equal(militaryInstallationsLayer.getParams().osmType, 'way', 'coordinator-style restore of other options keeps OSM type');
  } finally {
    run.restore();
  }
});
