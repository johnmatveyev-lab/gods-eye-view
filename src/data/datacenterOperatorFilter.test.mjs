// PLAN 193 — Hide no operator toggle. Client-only filter of already-loaded
// OSM datacenter pins. Distinct from neighboring local-layer chips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DATACENTER_HIDE_NO_OPERATOR_CHIP_LABEL,
  DATACENTER_HIDE_NO_OPERATOR_CHIP_TITLE,
  DATACENTER_HIDE_NO_OPERATOR_STORAGE_KEY,
  DEFAULT_DATACENTER_HIDE_NO_OPERATOR,
  datacenterHasOperator,
  datacenterHideNoOperatorChipModel,
  datacenterOperatorText,
  datacenterPassesOperatorFilter,
  filterDatacentersByOperator,
  getDatacenterHideNoOperator,
  hydrateDatacenterHideNoOperator,
  normalizeDatacenterHideNoOperator,
  readDatacenterHideNoOperator,
  resetDatacenterHideNoOperatorForTest,
  setDatacenterHideNoOperator,
  writeDatacenterHideNoOperator,
} from './datacenterOperatorFilter.js';
import { createLocalGeoJsonLayer, localInfrastructureOverlayCopy } from './localGeojson.js';
import { listDamsInView } from './damsList.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function src(relative) {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    snapshot: () => ({ ...data }),
  };
}

const EQUINIX = Object.freeze({
  id: 'dc-equinix',
  tags: { name: 'DFW-1', operator: 'Equinix' },
});
const EMPTY = Object.freeze({
  id: 'dc-empty',
  tags: { name: 'Unnamed hall', operator: '' },
});
const MISSING = Object.freeze({
  id: 'dc-missing',
  tags: { name: 'Nameless pin' },
});
const WHITESPACE = Object.freeze({
  id: 'dc-space',
  tags: { name: 'Blank op', operator: '   ' },
});
const SHORT_ONLY = Object.freeze({
  id: 'dc-short',
  tags: { name: 'AWS edge', 'operator:short': 'AWS' },
});
const PROPS_OPERATOR = Object.freeze({
  id: 'dc-props',
  operator: 'Digital Realty',
  tags: { name: 'DAL-3' },
});
const MIXED = Object.freeze([
  EQUINIX, EMPTY, MISSING, WHITESPACE, SHORT_ONLY, PROPS_OPERATOR,
]);

const DAMS = Object.freeze([
  { id: 'dam-1', label: 'Mansfield Dam', latitude: 30.39, longitude: -97.91, visible: true },
  { id: 'dam-2', label: 'Longhorn Dam', latitude: 30.25, longitude: -97.71, visible: true },
]);

class MockLayerEvent {
  constructor() {
    this.listeners = new Set();
  }

  addEventListener(listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  raise(...args) {
    for (const listener of [...this.listeners]) listener(...args);
  }
}

function polygonFeature(id, properties) {
  return JSON.stringify({
    type: 'Feature',
    id,
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [[[-97.70, 30.20], [-97.69, 30.20], [-97.69, 30.21], [-97.70, 30.20]]],
    },
  });
}

function serveFeatures(features) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => features.join('\n'),
  });
}

async function createLayerHarness({
  layerId = 'local-datacenters',
  name = 'Datacenters',
  color = '#00ffff',
  fetchImpl,
} = {}) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const preRender = new MockLayerEvent();
  const moveEnd = new MockLayerEvent();
  const dataSources = [];
  globalThis.window = { dispatchEvent() {} };
  const viewer = {
    selectedEntity: undefined,
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
    camera: {
      positionWC: Cesium.Cartesian3.fromDegrees(-97.695, 30.205, 100_000),
      frustum: { fov: Math.PI / 3 },
      moveEnd,
      flyTo() {},
    },
    scene: {
      canvas: { clientWidth: 800, clientHeight: 600 },
      preRender,
      sampleHeightSupported: false,
      sampleHeight() { return undefined; },
      pick() { return null; },
      requestRender() {},
    },
  };
  const layer = createLocalGeoJsonLayer({
    id: layerId,
    url: `/${layerId}.geojsonl`,
    name,
    color,
    overlayHost: { setVisible() {}, setEntries() {}, clearSource() {} },
    projectToWindow: () => ({ x: 400, y: 300 }),
    screenSpaceEventHandlerFactory: () => ({
      setInputAction() {},
      destroy() {},
    }),
  });
  globalThis.fetch = fetchImpl;
  try {
    await layer.enable(viewer);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return {
    layer,
    viewer,
    preRender,
    cleanup() {
      if (!globalThis.window) globalThis.window = { dispatchEvent() {} };
      layer.destroy(viewer);
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    },
  };
}

test('Hide no operator defaults off and Equinix stays', () => {
  assert.equal(DEFAULT_DATACENTER_HIDE_NO_OPERATOR, false);
  assert.equal(DATACENTER_HIDE_NO_OPERATOR_CHIP_LABEL, 'Hide no operator');
  assert.equal(DATACENTER_HIDE_NO_OPERATOR_CHIP_TITLE, 'Hide datacenters with no operator');
  assert.equal(datacenterOperatorText(EQUINIX), 'Equinix');
  assert.equal(datacenterHasOperator(EQUINIX), true);
  assert.equal(datacenterPassesOperatorFilter(EQUINIX, true), true);
  assert.equal(datacenterPassesOperatorFilter(EQUINIX, false), true);
  assert.deepEqual(
    filterDatacentersByOperator(MIXED, false).map((row) => row.id),
    MIXED.map((row) => row.id),
  );
});

test('empty / missing / whitespace operator hide when on; off restores', () => {
  assert.equal(datacenterOperatorText(EMPTY), '');
  assert.equal(datacenterOperatorText(MISSING), '');
  assert.equal(datacenterOperatorText(WHITESPACE), '');
  assert.equal(datacenterHasOperator(EMPTY), false);
  assert.equal(datacenterHasOperator(MISSING), false);
  assert.equal(datacenterHasOperator(WHITESPACE), false);
  assert.equal(datacenterPassesOperatorFilter(EMPTY, true), false);
  assert.equal(datacenterPassesOperatorFilter(MISSING, true), false);
  assert.equal(datacenterPassesOperatorFilter(WHITESPACE, true), false);
  assert.equal(datacenterPassesOperatorFilter(EMPTY, false), true);
  const hidden = filterDatacentersByOperator(MIXED, true);
  assert.deepEqual(hidden.map((row) => row.id), ['dc-equinix', 'dc-short', 'dc-props']);
  assert.deepEqual(
    filterDatacentersByOperator(MIXED, false).map((row) => row.id),
    MIXED.map((row) => row.id),
    'off restores the current view',
  );
});

test('operator:short and props.operator match overlay copy', () => {
  assert.equal(datacenterOperatorText(SHORT_ONLY), 'AWS');
  assert.equal(datacenterOperatorText(PROPS_OPERATOR), 'Digital Realty');
  assert.deepEqual(localInfrastructureOverlayCopy(SHORT_ONLY, 'local-datacenters'), {
    title: 'AWS edge',
    details: ['AWS'],
  });
  assert.deepEqual(localInfrastructureOverlayCopy(PROPS_OPERATOR, 'local-datacenters'), {
    title: 'DAL-3',
    details: ['Digital Realty'],
  });
  assert.equal(
    localInfrastructureOverlayCopy(EQUINIX, 'local-datacenters').details[0],
    datacenterOperatorText(EQUINIX),
  );
  assert.equal(datacenterOperatorText({
    properties: { tags: { operator: 'Equinix' } },
  }), 'Equinix');
  assert.equal(datacenterOperatorText({
    id: 'stem',
    operator: 'Equinix',
    entity: {},
  }), 'Equinix');
});

test('selected / fly-to target stays when Hide no operator is on', () => {
  assert.equal(
    datacenterPassesOperatorFilter(EMPTY, true, { selectedId: 'dc-empty' }),
    true,
  );
  assert.deepEqual(
    filterDatacentersByOperator(MIXED, true, 'dc-empty').map((row) => row.id),
    ['dc-equinix', 'dc-empty', 'dc-short', 'dc-props'],
  );
});

test('meridian.datacenterHideNoOperator persists and reload keeps the choice', () => {
  resetDatacenterHideNoOperatorForTest();
  const storage = memoryStorage();
  assert.equal(DATACENTER_HIDE_NO_OPERATOR_STORAGE_KEY, 'meridian.datacenterHideNoOperator');
  assert.equal(readDatacenterHideNoOperator(storage), DEFAULT_DATACENTER_HIDE_NO_OPERATOR);
  assert.equal(normalizeDatacenterHideNoOperator(undefined), false);
  assert.equal(normalizeDatacenterHideNoOperator(null), false);
  assert.equal(normalizeDatacenterHideNoOperator(''), false);
  assert.equal(normalizeDatacenterHideNoOperator(true), true);
  assert.equal(normalizeDatacenterHideNoOperator('1'), true);
  assert.equal(normalizeDatacenterHideNoOperator('bogus'), null);
  assert.equal(setDatacenterHideNoOperator(true, { storage }), true);
  assert.equal(storage.getItem(DATACENTER_HIDE_NO_OPERATOR_STORAGE_KEY), '1');
  assert.equal(getDatacenterHideNoOperator(), true);

  resetDatacenterHideNoOperatorForTest();
  assert.equal(getDatacenterHideNoOperator(), DEFAULT_DATACENTER_HIDE_NO_OPERATOR);
  assert.equal(hydrateDatacenterHideNoOperator(storage), true);
  assert.equal(getDatacenterHideNoOperator(), true);
  writeDatacenterHideNoOperator(DEFAULT_DATACENTER_HIDE_NO_OPERATOR, storage);
  assert.equal(storage.getItem(DATACENTER_HIDE_NO_OPERATOR_STORAGE_KEY), '0');
  resetDatacenterHideNoOperatorForTest();
});

test('dams list is unchanged by the datacenter operator filter', () => {
  const listed = listDamsInView({
    enabled: true,
    records: DAMS,
    view: { west: -98, south: 30, east: -97, north: 31, centerLat: 30.3, centerLon: -97.8 },
  });
  assert.deepEqual(listed.map((row) => row.id).sort(), ['dam-1', 'dam-2']);
  assert.deepEqual(
    filterDatacentersByOperator(MIXED, true).map((row) => row.id),
    ['dc-equinix', 'dc-short', 'dc-props'],
  );
  assert.deepEqual(listed.map((row) => row.id).sort(), ['dam-1', 'dam-2']);
});

test('datacenter layer wires the chip; dams do not', async () => {
  resetDatacenterHideNoOperatorForTest();
  const dcFeatures = [
    polygonFeature('dc-equinix', { name: 'DFW-1', tags: { name: 'DFW-1', operator: 'Equinix' } }),
    polygonFeature('dc-empty', { name: 'Unnamed hall', tags: { name: 'Unnamed hall', operator: '' } }),
  ];
  const damFeatures = [
    polygonFeature('dam-1', { name: 'Mansfield Dam', tags: { associated_river: 'Colorado' } }),
    polygonFeature('dam-2', { name: 'Longhorn Dam', tags: { associated_river: 'Colorado' } }),
  ];
  const dc = await createLayerHarness({
    layerId: 'local-datacenters',
    fetchImpl: serveFeatures(dcFeatures),
  });
  const dams = await createLayerHarness({
    layerId: 'local-dams',
    name: 'Dams',
    color: '#0088ff',
    fetchImpl: serveFeatures(damFeatures),
  });
  try {
    assert.equal(typeof dc.layer.getRowControls, 'function');
    assert.equal(typeof dc.layer.setParams, 'function');
    assert.equal(typeof dc.layer.getParams, 'function');
    assert.equal(dc.layer.getParams().hideNoOperator, false);
    const chip = dc.layer.getRowControls().chips.find((entry) => entry.id === 'hide-no-operator');
    assert.equal(chip.label, 'Hide no operator');
    assert.equal(chip.active, false);
    assert.equal(chip.params.hideNoOperator, true);
    assert.deepEqual(
      datacenterHideNoOperatorChipModel(false).params,
      { hideNoOperator: true },
    );

    const offIds = dc.layer.getListPayload().map((row) => row.id);
    assert.ok(offIds.includes('dc-equinix'));
    assert.ok(offIds.includes('dc-empty'));
    assert.equal(dc.layer.getListPayload().find((row) => row.id === 'dc-empty')?.visible, true);

    assert.equal(dc.layer.setParams({ hideNoOperator: true }), true);
    assert.equal(dc.layer.getParams().hideNoOperator, true);
    assert.equal(dc.layer.getRowControls().chips.find((entry) => entry.id === 'hide-no-operator')?.active, true);
    const onPayload = dc.layer.getListPayload();
    assert.equal(onPayload.find((row) => row.id === 'dc-equinix')?.visible, true);
    assert.equal(onPayload.find((row) => row.id === 'dc-empty')?.visible, false);

    dc.viewer.selectedEntity = { __localLayerId: 'local-datacenters', id: 'dc-empty' };
    assert.equal(
      dc.layer.getListPayload().find((row) => row.id === 'dc-empty')?.visible,
      true,
      'selected empty-operator pin stays',
    );

    assert.equal(dc.layer.setParams({ hideNoOperator: false }), true);
    assert.equal(dc.layer.getListPayload().find((row) => row.id === 'dc-empty')?.visible, true);

    assert.equal(dc.layer.setParams({ hideNoOperator: 'nope' }), false);
    assert.equal(dc.layer.getParams().hideNoOperator, false);

    assert.equal(typeof dams.layer.getRowControls, 'undefined');
    assert.equal(typeof dams.layer.setParams, 'undefined');
    const damPayload = dams.layer.getListPayload();
    assert.equal(damPayload.length, 2);
    assert.ok(damPayload.every((row) => row.visible !== false));
    assert.deepEqual(damPayload.map((row) => row.id).sort(), ['dam-1', 'dam-2']);
  } finally {
    dc.cleanup();
    dams.cleanup();
    resetDatacenterHideNoOperatorForTest();
  }
});

test('refresh keeps Hide no operator on already-loaded datacenter features', async () => {
  resetDatacenterHideNoOperatorForTest();
  const fetches = [];
  const features = [
    polygonFeature('dc-equinix', { tags: { name: 'DFW-1', operator: 'Equinix' } }),
    polygonFeature('dc-empty', { tags: { name: 'Unnamed hall' } }),
  ];
  const env = await createLayerHarness({
    fetchImpl: async (url) => {
      fetches.push(String(url));
      return serveFeatures(features)();
    },
  });
  try {
    assert.equal(fetches.length, 1);
    assert.equal(env.layer.setParams({ hideNoOperator: true }), true);
    env.layer.disable(env.viewer);
    await env.layer.enable(env.viewer);
    assert.equal(fetches.length, 1, 'refresh must not fetch again');
    assert.equal(env.layer.getParams().hideNoOperator, true);
    assert.equal(env.layer.getListPayload().find((row) => row.id === 'dc-equinix')?.visible, true);
    assert.equal(env.layer.getListPayload().find((row) => row.id === 'dc-empty')?.visible, false);
  } finally {
    env.cleanup();
    resetDatacenterHideNoOperatorForTest();
  }
});

test('client-only: no extra GeoJSON fetch, no new /api, dams and HTML stay clean', () => {
  const helper = src('src/data/datacenterOperatorFilter.js');
  const layer = src('src/data/localGeojson.js');
  const localLayers = src('src/data/localLayers.js');
  const damsList = src('src/data/damsList.js');
  const markup = src('index.html');
  const ui = src('src/ui.js');
  const license = src('LICENSE');
  const readme = src('README.md');
  const firstRun = src('src/firstRunExperience.js');

  assert.doesNotMatch(helper, /\bfetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.match(helper, /meridian\.datacenterHideNoOperator/);
  assert.match(helper, /tags\.operator/);
  assert.match(helper, /operator:short/);
  assert.match(helper, /props\.operator/);
  assert.match(layer, /datacenterOperatorText/);
  assert.match(layer, /datacenterPassesOperatorFilter/);
  assert.match(layer, /hideNoOperator/);
  assert.match(layer, /id === 'local-datacenters'/);
  assert.match(localLayers, /id:\s*'local-dams'/);
  assert.doesNotMatch(damsList, /hideNoOperator|Hide no operator|datacenterOperatorFilter/);
  assert.doesNotMatch(markup, /hide-no-operator|Hide no operator|hideNoOperator/);
  assert.doesNotMatch(ui, /hide-no-operator|Hide no operator|hideNoOperator/);
  assert.doesNotMatch(helper, /google\.com\/news|telegeography|quantum-earth/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /Meridian is an \*\*independent commercial product\*\*/);
  assert.match(firstRun, /meridian\.datacenterHideNoOperator/);
  const firstRunFn = firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun'));
  assert.doesNotMatch(firstRunFn, /setDatacenterHideNoOperator|writeDatacenterHideNoOperator/);
});
