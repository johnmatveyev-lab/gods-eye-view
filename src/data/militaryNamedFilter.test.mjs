// PLAN 186 — Named only toggle. Client-only filter of already-fetched
// OSM/Places records. Distinct from 65–185 (not class chips / Footprints
// only / Hide parked / reviewed / FIRMS / satellites).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_INSTALLATION_NAMED_ONLY,
  INSTALLATION_NAMED_ONLY_CHIP_LABEL,
  INSTALLATION_NAMED_ONLY_CHIP_TITLE,
  MILITARY_NAMED_ONLY_STORAGE_KEY,
  filterInstallationsByNamed,
  installationHasName,
  installationMatchesNamedFilter,
  installationNamedOnlyChipModel,
  normalizeInstallationNamedOnly,
  readMilitaryNamedOnly,
  writeMilitaryNamedOnly,
} from './militaryNamedFilter.js';
import { filterInstallationsByClass } from './militaryInstallationClassFilter.js';
import { filterInstallationsByFootprint } from './militaryFootprintFilter.js';
import { normalizeMilitaryInstallations } from './militaryInstallationData.js';
import militaryInstallationsLayer from './militaryInstallations.js';
import { createDefaultLayerState, decodeLayerStateParams, encodeLayerStateParams, layerOptionsForRestore, normalizeLayerState } from './layerState.js';
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
  { id: 'osm:way:1', class: 'airfield', name: 'Military airfield', hasName: false, footprint: RING },
  { id: 'osm:way:2', class: 'airfield', name: 'Fort X', hasName: true, footprint: RING },
  { id: 'osm:way:3', class: 'range', name: 'Firing range', hasName: false, footprint: null },
  { id: 'osm:node:4', class: 'naval_base', name: 'Naval Station', hasName: true, footprint: null },
  { id: 'google:5', class: 'places_candidate', name: 'Camp Mabry', hasName: true, footprint: null },
  { id: 'osm:way:6', class: 'military_land', name: 'Military land', hasName: false },
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

async function runInstallationLoad(elements) {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requests = [];
  _resetRenderGovernorForTest();
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
    },
  };
}

test('Named only defaults off and matches the unfiltered set', () => {
  assert.equal(DEFAULT_INSTALLATION_NAMED_ONLY, false);
  assert.equal(INSTALLATION_NAMED_ONLY_CHIP_LABEL, 'Named only');
  assert.equal(
    INSTALLATION_NAMED_ONLY_CHIP_TITLE,
    'Show only installations that already have an OSM or Places name',
  );
  assert.equal(normalizeInstallationNamedOnly(undefined), false);
  assert.equal(normalizeInstallationNamedOnly(null), false);
  assert.equal(normalizeInstallationNamedOnly(''), false);
  assert.equal(normalizeInstallationNamedOnly(false), false);
  assert.equal(normalizeInstallationNamedOnly(true), true);
  assert.equal(normalizeInstallationNamedOnly('1'), true);
  assert.equal(normalizeInstallationNamedOnly('true'), true);
  assert.equal(normalizeInstallationNamedOnly(0), false);
  assert.equal(normalizeInstallationNamedOnly('bogus'), null);
  assert.deepEqual(
    filterInstallationsByNamed(MIXED, false).map((record) => record.id),
    MIXED.map((record) => record.id),
  );
  assert.deepEqual(filterInstallationsByNamed(null), []);
  assert.deepEqual(filterInstallationsByNamed(undefined), []);
});

test('on hides unnamed class-labeled ways and keeps Fort X plus Places', () => {
  assert.equal(installationHasName({ hasName: false }), false);
  assert.equal(installationHasName({ hasName: true }), true);
  assert.equal(installationHasName({}), false);
  const kept = filterInstallationsByNamed(MIXED, true).map((record) => record.id);
  assert.deepEqual(kept, ['osm:way:2', 'osm:node:4', 'google:5']);
  assert.ok(!kept.includes('osm:way:1'), 'unnamed airfield hides');
  assert.ok(kept.includes('osm:way:2'), 'Fort X stays');
  assert.ok(kept.includes('google:5'), 'Places candidate stays');
  assert.equal(installationMatchesNamedFilter({ hasName: false }, true), false);
  assert.equal(installationMatchesNamedFilter({ hasName: true }, true), true);
  assert.equal(installationMatchesNamedFilter({ hasName: false }, false), true);
});

test('selected unnamed pin stays when Named only is on; All/off restores', () => {
  assert.equal(
    installationMatchesNamedFilter({ id: 'osm:way:1', hasName: false }, true, {
      selectedId: 'osm:way:1',
    }),
    true,
  );
  assert.deepEqual(
    filterInstallationsByNamed(MIXED, true, 'osm:way:1').map((record) => record.id),
    ['osm:way:1', 'osm:way:2', 'osm:node:4', 'google:5'],
  );
  assert.deepEqual(
    filterInstallationsByNamed(MIXED, false).map((record) => record.id),
    MIXED.map((record) => record.id),
    'All/off restores the current view',
  );
});

test('Named only ANDs with Plan 151 class chips and Plan 165 Footprints only', () => {
  const afterClass = filterInstallationsByClass(MIXED, 'ARLP');
  assert.deepEqual(
    afterClass.map((record) => record.id),
    ['osm:way:1', 'osm:way:2', 'osm:way:3', 'google:5', 'osm:way:6'],
    'Naval off hides the named naval before Named only runs',
  );
  assert.deepEqual(
    filterInstallationsByNamed(afterClass, true).map((record) => record.id),
    ['osm:way:2', 'google:5'],
  );
  assert.deepEqual(
    filterInstallationsByNamed(
      filterInstallationsByFootprint(afterClass, true),
      true,
    ).map((record) => record.id),
    ['osm:way:2'],
    'class chips AND Footprints only AND Named only',
  );
  assert.deepEqual(
    filterInstallationsByNamed(
      filterInstallationsByFootprint(
        filterInstallationsByClass(MIXED, 'ARLP', 'osm:way:1'),
        true,
        'osm:way:1',
      ),
      true,
      'osm:way:1',
    ).map((record) => record.id),
    ['osm:way:1', 'osm:way:2'],
    'selected unnamed airfield stays through all three filters',
  );
});

test('normalize stamps hasName from tags.name / name:en', () => {
  const result = normalizeMilitaryInstallations({ elements: [
    { type: 'way', id: 1, center: { lat: 30.2, lon: -97.7 }, tags: { military: 'airfield' } },
    { type: 'way', id: 2, center: { lat: 30.3, lon: -97.6 }, tags: { military: 'airfield', name: 'Fort X' } },
    { type: 'way', id: 3, center: { lat: 30.4, lon: -97.5 }, tags: { military: 'range', 'name:en': 'Camp Swift' } },
    { type: 'node', id: 4, lat: 30.5, lon: -97.4, tags: { military: 'range', name: '   ' } },
  ] });
  assert.equal(result.records[0].hasName, false);
  assert.equal(result.records[0].name, 'Military airfield');
  assert.equal(result.records[1].hasName, true);
  assert.equal(result.records[1].name, 'Fort X');
  assert.equal(result.records[2].hasName, true);
  assert.equal(result.records[2].name, 'Camp Swift');
  assert.equal(result.records[3].hasName, false);
});

test('persist helpers use meridian.militaryNamedOnly', () => {
  assert.equal(MILITARY_NAMED_ONLY_STORAGE_KEY, 'meridian.militaryNamedOnly');
  const storage = memoryStorage();
  assert.equal(readMilitaryNamedOnly(storage), false);
  assert.equal(writeMilitaryNamedOnly(true, storage), true);
  assert.equal(storage.getItem(MILITARY_NAMED_ONLY_STORAGE_KEY), '1');
  assert.equal(readMilitaryNamedOnly(storage), true);
  assert.equal(writeMilitaryNamedOnly(false, storage), true);
  assert.equal(storage.getItem(MILITARY_NAMED_ONLY_STORAGE_KEY), '0');
  assert.equal(readMilitaryNamedOnly(storage), false);
  assert.equal(writeMilitaryNamedOnly('nope', storage), false);
  assert.equal(storage.getItem(MILITARY_NAMED_ONLY_STORAGE_KEY), '0');
});

test('Named only persists on military-installations and defaults off', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['military-installations'].namedOnly, false);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=i'));
  assert.equal(omitted.options['military-installations'].namedOnly, false,
    'existing i links keep unlabeled pins visible');

  const state = normalizeLayerState({
    enabledLayerIds: ['military-installations'],
    options: { 'military-installations': { namedOnly: true } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.match(params.get('lo'), /i\.n\.1/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['military-installations'].namedOnly, true);
  assert.equal(layerOptionsForRestore(decoded, 'military-installations').namedOnly, true);
});

test('helper reads record.hasName and the chip sits next to class chips', () => {
  const helper = readFileSync(new URL('./militaryNamedFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/militaryInstallations.js'), 'utf8');
  const data = readFileSync(path.join(ROOT, 'src/data/militaryInstallationData.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  assert.match(helper, /record\?\.hasName/);
  assert.match(helper, /meridian\.militaryNamedOnly/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.match(data, /hasName:/);
  assert.match(data, /tags\.name \|\| tags\['name:en'\]/);
  assert.match(source, /namedOnly/);
  assert.match(source, /filterInstallationsByNamed|installationMatchesNamedFilter/);
  assert.match(source, /writeMilitaryNamedOnly/);
  assert.match(source, /hasName: true/);
  assert.match(html, /id="installation-named-chips"/);
  assert.match(html, /data-installation-named="only"/);
  assert.match(html, /Named only/);
  assert.match(html, /id="installation-class-chips"/);
  assert.match(html, /id="installation-footprint-chips"/);
  assert.match(ui, /installation-named-chips|data-installation-named/);
  assert.match(ui, /_installationNamedChips\.hidden = !enabled/);
  assert.match(css, /installation-named-chip/);
  assert.match(layerState, /namedOnly/);
  assert.doesNotMatch(source, /\/api\/military-installations\/named/);
  assert.equal(existsSync(path.join(ROOT, 'api/military-installations/named.js')), false);
  assert.doesNotMatch(source, /earthquakes\.js|satellites\.js|Google News|TeleGeography|quantum-earth|God's Eye View/);
  assert.doesNotMatch(helper, /earthquakes\.js|satellites\.js|Google News|TeleGeography/);
  assert.equal(installationNamedOnlyChipModel(false).params.namedOnly, true);
  assert.equal(installationNamedOnlyChipModel(true).params.namedOnly, false);
});

test('layer setParams hides unnamed ways; selected stays; refresh keeps toggle', async () => {
  const run = await runInstallationLoad([
    {
      type: 'way',
      id: 1,
      center: { lat: 30.20, lon: -97.70 },
      tags: { military: 'airfield' },
      geometry: wayGeometry(),
    },
    {
      type: 'way',
      id: 2,
      center: { lat: 30.21, lon: -97.71 },
      tags: { military: 'airfield', name: 'Fort X' },
      geometry: wayGeometry(),
    },
    {
      type: 'way',
      id: 3,
      center: { lat: 30.22, lon: -97.72 },
      tags: { military: 'range' },
      geometry: wayGeometry(),
    },
    {
      type: 'node',
      id: 4,
      lat: 30.23,
      lon: -97.73,
      tags: { military: 'naval_base', name: 'Naval Station' },
    },
  ]);
  try {
    const ids = () => run.entities().map((entity) => entity.id).sort();
    assert.deepEqual(ids(), [
      'osm:node:4', 'osm:way:1', 'osm:way:2', 'osm:way:3',
    ]);
    assert.equal(militaryInstallationsLayer.getParams().namedOnly, false);
    const fetchesBefore = run.requests.length;
    assert.equal(militaryInstallationsLayer.setParams({ namedOnly: true }), true);
    assert.equal(run.requests.length, fetchesBefore, 'Named only must not refetch Overpass');
    assert.equal(militaryInstallationsLayer.getParams().namedOnly, true);
    assert.deepEqual(ids(), ['osm:node:4', 'osm:way:2']);
    assert.deepEqual(
      militaryInstallationsLayer.getViewportRecords().map((record) => record.id).sort(),
      ['osm:node:4', 'osm:way:2'],
    );

    assert.equal(militaryInstallationsLayer.focusById('osm:way:1'), true);
    assert.ok(ids().includes('osm:way:1'), 'selected unnamed airfield stays');
    assert.ok(
      militaryInstallationsLayer.getViewportRecords().some((record) => record.id === 'osm:way:1'),
    );

    assert.equal(militaryInstallationsLayer.setParams({ installationClassFilter: 'ARLP' }), true);
    assert.deepEqual(
      ids().sort(),
      ['osm:way:1', 'osm:way:2'],
      'class chips AND Named only; selected unnamed airfield still stays',
    );

    assert.equal(militaryInstallationsLayer.setParams({ footprintsOnly: true }), true);
    assert.deepEqual(
      ids().sort(),
      ['osm:way:1', 'osm:way:2'],
      'Footprints only still ANDs; selected unnamed outlined way stays',
    );

    await militaryInstallationsLayer.update();
    assert.equal(militaryInstallationsLayer.getParams().namedOnly, true, 'viewport refresh keeps the toggle');
    assert.equal(militaryInstallationsLayer.getParams().installationClassFilter, 'ARLP');
    assert.equal(militaryInstallationsLayer.getParams().footprintsOnly, true);
    assert.ok(ids().includes('osm:way:1'));
    assert.ok(ids().includes('osm:way:2'));
    assert.equal(militaryInstallationsLayer.setParams({ namedOnly: 'nope' }), false);
    assert.equal(militaryInstallationsLayer.getParams().namedOnly, true);

    assert.equal(militaryInstallationsLayer.setParams({ namedOnly: false }), true);
    assert.ok(ids().includes('osm:way:3'), 'All/off restores unnamed range when class chip allows');
  } finally {
    run.restore();
  }
});
