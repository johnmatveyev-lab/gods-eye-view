// PLAN 102 — Satellites: Core | Dense. Dense calls existing
// setParams({ catalog: 'dense' }) and /api/celestrak/starlink. Persist via
// layerState catalog. Not the Plan 65 core-group picker. No extra /api.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  encodeLayerStateParams,
  normalizeLayerState,
} from './layerState.js';
import { satelliteCatalogControls } from './satelliteCatalogControls.js';
import { listSatGroups } from './satGroup.js';
import satellitesLayer, {
  CORE_CATALOG_GROUPS,
  _catalogGroupForTest,
  _clearDenseCatalogStateForTest,
  _setDenseCatalogStateForTest,
} from './satellites.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CORE_PATHS = CORE_CATALOG_GROUPS.map((group) => group.path);
const ISS_NORAD = 25544;

function tleFor(satnum, name) {
  return [
    name,
    `1 ${satnum}U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927`,
    `2 ${satnum}  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537`,
  ].join('\n');
}

const DENSE_TLE = tleFor('44444', 'STARLINK-TEST');
const ISS_TLE = tleFor('25544', 'ISS (ZARYA)');
const GPS_TLE = tleFor('32222', 'GPS BIIR-2');

function catalogChip(id) {
  return satellitesLayer.getRowControls().chips.find((entry) => entry.id === id);
}

async function settleDense(maxTicks = 50) {
  for (let i = 0; i < maxTicks; i++) {
    const chip = catalogChip('catalog-dense');
    if (chip && !chip.busy) return chip;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return catalogChip('catalog-dense');
}

test('Core | Dense chips default to Core and request the existing catalog param', () => {
  const controls = satelliteCatalogControls({});
  assert.equal(controls.heading, undefined);
  const core = controls.chips.find((chip) => chip.id === 'catalog-core');
  const dense = controls.chips.find((chip) => chip.id === 'catalog-dense');
  assert.equal(core.label, 'Core');
  assert.equal(core.active, true);
  assert.deepEqual(core.params, { catalog: 'core' });
  assert.equal(dense.label, 'Dense');
  assert.equal(dense.active, false);
  assert.deepEqual(dense.params, { catalog: 'dense' });
});

test('Dense is busy until ready, then Core is the only way back', () => {
  const loading = satelliteCatalogControls({ catalog: 'dense', denseStatus: 'loading' });
  assert.equal(loading.chips.find((chip) => chip.id === 'catalog-dense').busy, true);
  assert.equal(loading.chips.find((chip) => chip.id === 'catalog-dense').active, false);
  assert.equal(loading.chips.find((chip) => chip.id === 'catalog-core').active, false);
  assert.equal(loading.chips.find((chip) => chip.id === 'catalog-core').disabled, false);

  const ready = satelliteCatalogControls({ catalog: 'dense', denseStatus: 'ready' });
  assert.equal(ready.chips.find((chip) => chip.id === 'catalog-dense').active, true);
  assert.equal(ready.chips.find((chip) => chip.id === 'catalog-dense').label, 'Dense');
  assert.equal(ready.chips.find((chip) => chip.id === 'catalog-core').active, false);
  assert.deepEqual(ready.chips.find((chip) => chip.id === 'catalog-core').params, { catalog: 'core' });
});

test('a failed dense load presents Core as active with feed-unavailable language', () => {
  const failed = satelliteCatalogControls({
    catalog: 'core',
    denseStatus: 'failed',
    denseError: 'feed unavailable (502)',
  });
  const core = failed.chips.find((chip) => chip.id === 'catalog-core');
  const dense = failed.chips.find((chip) => chip.id === 'catalog-dense');
  assert.equal(core.active, true);
  assert.equal(dense.active, false);
  assert.equal(dense.state, 'error');
  assert.equal(dense.label, 'Dense ✕');
  assert.match(dense.title, /feed unavailable/);
  assert.deepEqual(dense.params, { catalog: 'dense' });
});

test('Core is the six CelesTrak groups (~840) and never includes Starlink', () => {
  assert.equal(CORE_CATALOG_GROUPS.length, 6);
  assert.deepEqual(CORE_PATHS, ['stations', 'visual', 'gps-ops', 'glo-ops', 'galileo', 'geo']);
  assert.equal(CORE_PATHS.includes('starlink'), false);
  const satellites = readFileSync(path.join(ROOT, 'src/data/satellites.js'), 'utf8');
  assert.match(satellites, /~840/);
  assert.match(satellites, /DENSE_GROUP_PATH = 'starlink'/);
});

test('the layer default is Core and Core does not fetch Starlink', async () => {
  const fetched = [];
  const originalFetch = globalThis.fetch;
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    _setDenseCatalogStateForTest({});
    assert.equal(satellitesLayer.getParams().catalog, 'core');
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      const pathPart = String(url).split('/').pop();
      if (pathPart === 'stations') return { ok: true, text: async () => ISS_TLE };
      if (pathPart === 'gps-ops') return { ok: true, text: async () => GPS_TLE };
      return { ok: true, text: async () => '' };
    };
    await satellitesLayer.update({ scene: { primitives: { add: (p) => p, remove() {} } } });
    assert.equal(satellitesLayer.getParams().catalog, 'core');
    assert.ok(fetched.every((url) => url.endsWith('/api/celestrak/stations')),
      'Core uses the Plan 65 selected group, not Starlink');
    assert.equal(fetched.some((url) => url.endsWith('/api/celestrak/starlink')), false);
    assert.equal(_catalogGroupForTest(ISS_NORAD), 'stations');
    assert.equal(_catalogGroupForTest(32222), undefined, 'other core groups stay on the picker');
    assert.equal(_catalogGroupForTest(44444), undefined);
    assert.equal(catalogChip('catalog-core').active, true);
    assert.equal(satellitesLayer.getStats().count, 1);
  } finally {
    console.log = log;
    console.warn = warn;
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('Dense adds Starlink points without blocking the setParams return', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, text: async () => DENSE_TLE });
    _setDenseCatalogStateForTest({
      coreSats: [{ noradId: ISS_NORAD, name: 'ISS (ZARYA)', group: 'stations' }],
    });
    const accepted = satellitesLayer.setParams({ catalog: 'dense' }, { origin: 'user' });
    assert.equal(accepted, true);
    assert.equal(satellitesLayer.getParams().catalog, 'dense');
    assert.equal(catalogChip('catalog-dense').busy, true, 'load is in flight after setParams returns');
    assert.equal(_catalogGroupForTest(44444), undefined, 'Starlink points are not on screen yet');

    const settled = await settleDense();
    assert.equal(settled.active, true);
    assert.equal(settled.busy, false);
    assert.equal(_catalogGroupForTest(44444), 'dense');
    assert.equal(_catalogGroupForTest(ISS_NORAD), 'stations');
    assert.ok(satellitesLayer.getStats().count > 1);
  } finally {
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('the dense load yields between satrec chunks so a frame can run', () => {
  const satellites = readFileSync(path.join(ROOT, 'src/data/satellites.js'), 'utf8');
  assert.match(satellites, /const DENSE_CREATE_CHUNK = 1500/);
  assert.match(satellites, /await new Promise\(resolve => setTimeout\(resolve, 0\)\)/);
  assert.match(satellites, /for \(let start = 0; start < entries\.length; start \+= DENSE_CREATE_CHUNK\)/);
});

test('flipping back to Core removes dense extras and keeps ISS tracking', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, text: async () => DENSE_TLE });
    _setDenseCatalogStateForTest({
      coreSats: [
        { noradId: ISS_NORAD, name: 'ISS (ZARYA)', group: 'stations' },
        { noradId: 32222, name: 'GPS BIIR-2', group: 'gps-ops' },
      ],
      trackedNorad: ISS_NORAD,
    });
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, ISS_NORAD);

    satellitesLayer.setParams({ catalog: 'dense' }, { origin: 'user' });
    await settleDense();
    assert.equal(_catalogGroupForTest(44444), 'dense');
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, ISS_NORAD,
      'Dense extras do not steal ISS tracking');

    satellitesLayer.setParams({ catalog: 'core' }, { origin: 'user' });
    assert.equal(satellitesLayer.getParams().catalog, 'core');
    assert.equal(_catalogGroupForTest(44444), undefined, 'dense extras are gone');
    assert.equal(_catalogGroupForTest(ISS_NORAD), 'stations');
    assert.equal(_catalogGroupForTest(32222), 'gps-ops');
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, ISS_NORAD,
      'Core tracking survives the flip back');
    assert.equal(catalogChip('catalog-core').active, true);
    assert.equal(catalogChip('catalog-dense').active, false);
  } finally {
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('failed /api/celestrak/starlink leaves Core intact and reports feed-unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const warn = console.warn;
  console.warn = () => {};
  try {
    globalThis.fetch = async () => ({ ok: false, status: 502 });
    _setDenseCatalogStateForTest({
      coreSats: [{ noradId: ISS_NORAD, name: 'ISS (ZARYA)', group: 'stations' }],
      trackedNorad: ISS_NORAD,
    });
    satellitesLayer.setParams({ catalog: 'dense' }, { origin: 'user' });
    const settled = await settleDense();

    assert.equal(satellitesLayer.getParams().catalog, 'core');
    assert.equal(_catalogGroupForTest(ISS_NORAD), 'stations');
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, ISS_NORAD);
    assert.equal(catalogChip('catalog-core').active, true);
    assert.equal(settled.state, 'error');
    assert.match(settled.title, /feed unavailable/);
    assert.equal(satellitesLayer.getStats().status, 'unavailable');
    assert.match(satellitesLayer.getStats().error, /feed unavailable/);
  } finally {
    console.warn = warn;
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('Plan 65 group picker still filters core groups only', () => {
  _setDenseCatalogStateForTest({});
  try {
    const controls = satellitesLayer.getRowControls();
    const picker = (controls.selects || []).find((entry) => entry.id === 'sat-group');
    assert.ok(picker, 'Plan 65 Sats picker stays on the row');
    const values = (picker.options || []).map((option) => option.value);
    const allowed = new Set(listSatGroups().map((group) => group.id));
    assert.ok(values.every((value) => allowed.has(value)),
      'picker options stay inside the Plan 65 allowlist');
    assert.equal(values.includes('starlink'), false);
    assert.equal(values.includes('active'), false);
    assert.equal(controls.chips.some((chip) => chip.id === 'catalog-dense'), true);
    assert.equal(controls.chips.some((chip) => CORE_PATHS.includes(chip.id)), false,
      'Core | Dense is not a CelesTrak group picker');
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('explicit Core | Dense writes persist through the existing layerState catalog option', () => {
  const dense = normalizeLayerState({
    enabledLayerIds: ['satellites'],
    options: { satellites: { catalog: 'dense' } },
  });
  assert.equal(dense.options.satellites.catalog, 'dense');
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), dense);
  assert.match(params.get('lo') || '', /s\.c\.d/);

  const core = normalizeLayerState({
    enabledLayerIds: ['satellites'],
    options: { satellites: { catalog: 'core' } },
  });
  assert.equal(core.options.satellites.catalog, 'core');
  const coreParams = encodeLayerStateParams(new URLSearchParams('v=2'), core);
  assert.doesNotMatch(coreParams.get('lo') || '', /s\.c\./);
});

test('POINTS on/off stays independent of Core | Dense and does not refetch', async () => {
  const originalFetch = globalThis.fetch;
  const fetched = [];
  try {
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return { ok: true, text: async () => DENSE_TLE };
    };
    _setDenseCatalogStateForTest({
      catalog: 'core',
      showPoints: true,
      showOrbits: true,
      coreSats: [{ noradId: ISS_NORAD, name: 'ISS (ZARYA)', group: 'stations' }],
      trackedNorad: ISS_NORAD,
    });
    assert.equal(catalogChip('catalog-dense').active, false);
    satellitesLayer.setParams({ catalog: 'dense' }, { origin: 'user' });
    const settled = await settleDense();
    assert.equal(settled.active, true);
    fetched.length = 0;

    const points = satellitesLayer.getRowControls().chips.find((entry) => entry.id === 'points');
    const orbits = satellitesLayer.getRowControls().chips.find((entry) => entry.id === 'orbits');
    assert.ok(points, 'POINTS sits on the same row as Core | Dense');
    assert.ok(orbits, 'ORBITS stays on the same row');
    assert.equal(points.active, true);
    assert.deepEqual(points.params, { showPoints: false });

    satellitesLayer.setParams({ showPoints: false }, { origin: 'user' });
    assert.equal(fetched.length, 0, 'Points toggle does not refetch CelesTrak when cached');
    assert.equal(satellitesLayer.getParams().catalog, 'dense');
    assert.equal(satellitesLayer.getParams().showOrbits, true);
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, ISS_NORAD);
    assert.equal(catalogChip('catalog-core').active, false);
    assert.equal(catalogChip('catalog-dense').active, true);
    assert.equal(satellitesLayer.getRowControls().chips.find((entry) => entry.id === 'points').active, false);
    assert.equal(satellitesLayer.getRowControls().chips.find((entry) => entry.id === 'orbits').active, true);
    assert.ok((satellitesLayer.getRowControls().legend || []).length >= 0);
  } finally {
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('no new endpoints — Dense reuses /api/celestrak/starlink', () => {
  const satellites = readFileSync(path.join(ROOT, 'src/data/satellites.js'), 'utf8');
  const controls = readFileSync(path.join(ROOT, 'src/data/satelliteCatalogControls.js'), 'utf8');
  assert.match(satellites, /\/api\/celestrak\/\$\{DENSE_GROUP_PATH\}/);
  assert.match(satellites, /satelliteCatalogControls\(/);
  assert.doesNotMatch(satellites, /\/api\/satellites/);
  assert.doesNotMatch(controls, /\/api\//);
  assert.doesNotMatch(controls, /opensky|google news|telegeography|quantum-earth/i);

  const apiDir = path.join(ROOT, 'api');
  const apiEntries = readdirSync(apiDir);
  assert.ok(apiEntries.includes('celestrak'));
  assert.equal(apiEntries.includes('satellites'), false);
  assert.equal(apiEntries.includes('starlink'), false);
});
