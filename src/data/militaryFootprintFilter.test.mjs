// PLAN 165 — Footprints only toggle. Client-only filter of already-fetched
// OSM/Places records. Distinct from 65–164 (not class chips / Hide parked /
// reviewed / FIRMS / satellites).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_INSTALLATION_FOOTPRINTS_ONLY,
  INSTALLATION_FOOTPRINTS_ONLY_CHIP_LABEL,
  INSTALLATION_FOOTPRINTS_ONLY_CHIP_TITLE,
  filterInstallationsByFootprint,
  installationFootprintsOnlyChipModel,
  installationHasUsableFootprint,
  installationMatchesFootprintFilter,
  normalizeInstallationFootprintsOnly,
} from './militaryFootprintFilter.js';
import { filterInstallationsByClass } from './militaryInstallationClassFilter.js';
import militaryInstallationsLayer from './militaryInstallations.js';
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
  { id: 'osm:way:1', class: 'airfield', name: 'Outlined airfield', footprint: RING },
  { id: 'osm:node:2', class: 'naval_base', name: 'Point naval', footprint: null },
  { id: 'osm:way:3', class: 'range', name: 'Outlined range', footprint: RING },
  { id: 'osm:node:4', class: 'military_land', name: 'Missing footprint' },
  { id: 'osm:way:5', class: 'military_land', name: 'Empty ring', footprint: [] },
  { id: 'osm:way:6', class: 'airfield', name: 'Two points', footprint: [[-97.7, 30.2], [-97.69, 30.21]] },
  { id: 'google:7', class: 'places_candidate', name: 'Places pin', footprint: null },
]);

const VIEWPORT = { south: 30, west: -98, north: 31, east: -97 };

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

test('Footprints only defaults off and matches the unfiltered set', () => {
  assert.equal(DEFAULT_INSTALLATION_FOOTPRINTS_ONLY, false);
  assert.equal(INSTALLATION_FOOTPRINTS_ONLY_CHIP_LABEL, 'Footprints only');
  assert.equal(
    INSTALLATION_FOOTPRINTS_ONLY_CHIP_TITLE,
    'Show only bases that already have a drawn footprint polygon',
  );
  assert.equal(normalizeInstallationFootprintsOnly(undefined), false);
  assert.equal(normalizeInstallationFootprintsOnly(null), false);
  assert.equal(normalizeInstallationFootprintsOnly(''), false);
  assert.equal(normalizeInstallationFootprintsOnly(false), false);
  assert.equal(normalizeInstallationFootprintsOnly(true), true);
  assert.equal(normalizeInstallationFootprintsOnly('1'), true);
  assert.equal(normalizeInstallationFootprintsOnly('true'), true);
  assert.equal(normalizeInstallationFootprintsOnly(0), false);
  assert.equal(normalizeInstallationFootprintsOnly('bogus'), null);
  assert.deepEqual(
    filterInstallationsByFootprint(MIXED, false).map((record) => record.id),
    MIXED.map((record) => record.id),
  );
  assert.deepEqual(filterInstallationsByFootprint(null), []);
  assert.deepEqual(filterInstallationsByFootprint(undefined), []);
});

test('on hides point-only pins and keeps usable footprint rings', () => {
  assert.equal(installationHasUsableFootprint({ footprint: RING }), true);
  assert.equal(installationHasUsableFootprint({ footprint: null }), false);
  assert.equal(installationHasUsableFootprint({}), false);
  assert.equal(installationHasUsableFootprint({ footprint: [] }), false);
  assert.equal(installationHasUsableFootprint({ footprint: [[-97.7, 30.2], [-97.69, 30.21]] }), false);
  assert.equal(installationHasUsableFootprint({ footprint: 'ring' }), false);
  const kept = filterInstallationsByFootprint(MIXED, true).map((record) => record.id);
  assert.deepEqual(kept, ['osm:way:1', 'osm:way:3']);
  assert.ok(!kept.includes('osm:node:2'));
  assert.ok(!kept.includes('osm:node:4'));
  assert.ok(!kept.includes('osm:way:5'));
  assert.ok(!kept.includes('osm:way:6'));
  assert.ok(!kept.includes('google:7'));
  assert.equal(installationMatchesFootprintFilter({ footprint: null }, true), false);
  assert.equal(installationMatchesFootprintFilter({ footprint: RING }, true), true);
  assert.equal(installationMatchesFootprintFilter({ footprint: null }, false), true);
});

test('selected point-only pin stays when Footprints only is on', () => {
  assert.equal(
    installationMatchesFootprintFilter({ id: 'osm:node:2', footprint: null }, true, {
      selectedId: 'osm:node:2',
    }),
    true,
  );
  assert.deepEqual(
    filterInstallationsByFootprint(MIXED, true, 'osm:node:2').map((record) => record.id),
    ['osm:way:1', 'osm:node:2', 'osm:way:3'],
  );
});

test('Footprints only ANDs with Plan 151 class chips', () => {
  const afterClass = filterInstallationsByClass(MIXED, 'ARLP');
  assert.deepEqual(
    afterClass.map((record) => record.id),
    ['osm:way:1', 'osm:way:3', 'osm:node:4', 'osm:way:5', 'osm:way:6', 'google:7'],
    'Naval off hides the point naval before Footprints only runs',
  );
  assert.deepEqual(
    filterInstallationsByFootprint(afterClass, true).map((record) => record.id),
    ['osm:way:1', 'osm:way:3'],
  );
  assert.deepEqual(
    filterInstallationsByFootprint(filterInstallationsByClass(MIXED, 'ARLP', 'osm:node:2'), true, 'osm:node:2')
      .map((record) => record.id),
    ['osm:way:1', 'osm:node:2', 'osm:way:3'],
    'selected point naval stays through both filters',
  );
});

test('helper reads record.footprint and the chip sits next to class chips', () => {
  const helper = readFileSync(new URL('./militaryFootprintFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/militaryInstallations.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  assert.match(helper, /record\?\.footprint/);
  assert.doesNotMatch(helper, /\.geometry\b|record\.ring|record\.polygon/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.match(source, /footprintsOnly/);
  assert.match(source, /filterInstallationsByFootprint|installationMatchesFootprintFilter/);
  assert.match(html, /id="installation-footprint-chips"/);
  assert.match(html, /data-installation-footprint="only"/);
  assert.match(html, /Footprints only/);
  assert.match(html, /id="installation-class-chips"/);
  assert.match(ui, /installation-footprint-chips|data-installation-footprint/);
  assert.match(ui, /_installationFootprintChips\.hidden = !enabled/);
  assert.match(css, /installation-footprint-chip/);
  assert.match(layerState, /footprintsOnly/);
  assert.doesNotMatch(source, /\/api\/military-installations\/footprint/);
  assert.equal(existsSync(path.join(ROOT, 'api/military-installations/footprint.js')), false);
  assert.doesNotMatch(source, /earthquakes\.js|satellites\.js|OpenSky|Google News|TeleGeography|quantum-earth|God's Eye View/);
  assert.doesNotMatch(helper, /earthquakes\.js|satellites\.js|OpenSky|Google News|TeleGeography/);
  assert.equal(installationFootprintsOnlyChipModel(false).params.footprintsOnly, true);
  assert.equal(installationFootprintsOnlyChipModel(true).params.footprintsOnly, false);
});

test('layer setParams hides point pins; selected stays; refresh keeps toggle', async () => {
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
      id: 3,
      center: { lat: 30.22, lon: -97.72 },
      tags: { military: 'range', name: 'Outlined Range' },
      geometry: wayGeometry(),
    },
    {
      type: 'node',
      id: 4,
      lat: 30.23,
      lon: -97.73,
      tags: { military: 'base', name: 'Point Land' },
    },
  ]);
  try {
    const ids = () => run.entities().map((entity) => entity.id).sort();
    assert.deepEqual(ids(), [
      'osm:node:2', 'osm:node:4', 'osm:way:1', 'osm:way:3',
    ]);
    assert.equal(militaryInstallationsLayer.getParams().footprintsOnly, false);
    const fetchesBefore = run.requests.length;
    assert.equal(militaryInstallationsLayer.setParams({ footprintsOnly: true }), true);
    assert.equal(run.requests.length, fetchesBefore, 'Footprints only must not refetch Overpass');
    assert.equal(militaryInstallationsLayer.getParams().footprintsOnly, true);
    assert.deepEqual(ids(), ['osm:way:1', 'osm:way:3']);
    assert.deepEqual(
      militaryInstallationsLayer.getViewportRecords().map((record) => record.id).sort(),
      ['osm:way:1', 'osm:way:3'],
    );

    assert.equal(militaryInstallationsLayer.focusById('osm:node:2'), true);
    assert.ok(ids().includes('osm:node:2'), 'selected point naval stays');
    assert.ok(
      militaryInstallationsLayer.getViewportRecords().some((record) => record.id === 'osm:node:2'),
    );

    assert.equal(militaryInstallationsLayer.setParams({ installationClassFilter: 'ARLP' }), true);
    assert.deepEqual(
      ids().sort(),
      ['osm:node:2', 'osm:way:1', 'osm:way:3'],
      'class chips AND Footprints only; selected point naval still stays',
    );

    await militaryInstallationsLayer.update();
    assert.equal(militaryInstallationsLayer.getParams().footprintsOnly, true, 'viewport refresh keeps the toggle');
    assert.equal(militaryInstallationsLayer.getParams().installationClassFilter, 'ARLP');
    assert.ok(ids().includes('osm:node:2'));
    assert.ok(ids().includes('osm:way:1'));
    assert.equal(militaryInstallationsLayer.setParams({ footprintsOnly: 'nope' }), false);
    assert.equal(militaryInstallationsLayer.getParams().footprintsOnly, true);
  } finally {
    run.restore();
  }
});

test('Austin-style geom-only way is painted; Footprints only keeps it and hides the node', async () => {
  const run = await runInstallationLoad([
    {
      type: 'node',
      id: 42,
      lat: 30.27,
      lon: -97.73,
      tags: { military: 'base', name: 'Audie Murphy Training Center' },
    },
    {
      type: 'way',
      id: 27894251,
      tags: { landuse: 'military', name: 'Camp Mabry' },
      geometry: wayGeometry(),
    },
  ]);
  try {
    const ids = () => run.entities().map((entity) => entity.id).sort();
    assert.deepEqual(ids(), ['osm:node:42', 'osm:way:27894251'], 'chip off shows the node pin and the geom-only way');
    assert.equal(militaryInstallationsLayer.setParams({ footprintsOnly: true }), true);
    assert.deepEqual(ids(), ['osm:way:27894251'], 'chip on keeps the outlined way and hides the node');
    assert.deepEqual(
      militaryInstallationsLayer.getViewportRecords().map((record) => record.id),
      ['osm:way:27894251'],
    );
  } finally {
    run.restore();
  }
});
