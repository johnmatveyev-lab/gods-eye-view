import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import satellitesLayer, {
  _clearDenseCatalogStateForTest,
  _satelliteVisualStateForTest,
  _setDenseCatalogStateForTest,
  _setSatellitePresentationForTest,
} from './satellites.js';
import { getSatGroup, resetSatGroupCache, setSatGroup } from './satGroup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VIEWER = { scene: { primitives: { add: (p) => p, remove() {} } } };
const ISS_NORAD = 25544;
const CORE_NORAD = 33333;
const DENSE_NORAD = 44444;

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

function orbitsChip() {
  return satellitesLayer.getRowControls().chips.find((entry) => entry.id === 'orbits');
}

function catalogChip() {
  return satellitesLayer.getRowControls().chips.find((entry) => entry.id === 'catalog');
}

async function settleDense(maxTicks = 50) {
  for (let i = 0; i < maxTicks; i += 1) {
    const chip = catalogChip();
    if (chip && !chip.busy) return chip;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return catalogChip();
}

test('ORBITS chip is stateless and only writes showOrbits', () => {
  try {
    _setDenseCatalogStateForTest({ showOrbits: true });
    const chip = orbitsChip();
    assert.ok(chip, 'satellites row declares an ORBITS chip');
    assert.equal(chip.label, 'ORBITS');
    assert.equal(chip.active, true);
    assert.equal(chip.state, 'active');
    assert.deepEqual(chip.params, { showOrbits: false });
    assert.equal(Object.hasOwn(chip.params, 'catalog'), false);
    assert.equal(Object.hasOwn(chip.params, 'satGroup'), false);
    assert.ok(catalogChip(), 'DENSE catalog chip is unchanged');
    assert.ok(
      (satellitesLayer.getRowControls().selects || []).some((entry) => entry.id === 'sat-group'),
      'Plan 65 CelesTrak group picker stays on the row',
    );

    satellitesLayer.setParams({ showOrbits: false });
    const idle = orbitsChip();
    assert.equal(idle.active, false);
    assert.equal(idle.state, 'idle');
    assert.deepEqual(idle.params, { showOrbits: true });
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('ORBITS off hides rings and leaves ISS, core, and dense points', () => {
  try {
    _setSatellitePresentationForTest({
      catalog: 'dense',
      showPoints: true,
      showOrbits: true,
      points: [ISS_NORAD, CORE_NORAD, DENSE_NORAD],
      orbits: [ISS_NORAD],
    });
    const before = _satelliteVisualStateForTest();
    assert.equal(before.catalog, 'dense');
    assert.equal(before.showOrbits, true);
    assert.equal(before.orbitShows[ISS_NORAD], true);
    assert.equal(before.pointCollectionShow, true);
    assert.deepEqual(before.pointIds.sort((a, b) => a - b), [ISS_NORAD, CORE_NORAD, DENSE_NORAD]);

    satellitesLayer.setParams({ showOrbits: false });
    const after = _satelliteVisualStateForTest();
    assert.equal(after.showOrbits, false);
    assert.equal(after.orbitShows[ISS_NORAD], false);
    assert.equal(after.pointCollectionShow, true);
    assert.equal(after.showPoints, true);
    assert.equal(after.catalog, 'dense');
    assert.deepEqual(after.pointIds.sort((a, b) => a - b), [ISS_NORAD, CORE_NORAD, DENSE_NORAD]);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('ORBITS on restores rings without flipping catalog mode', () => {
  try {
    _setSatellitePresentationForTest({
      catalog: 'dense',
      showOrbits: false,
      points: [ISS_NORAD, CORE_NORAD, DENSE_NORAD],
      orbits: [ISS_NORAD],
    });
    assert.equal(_satelliteVisualStateForTest().orbitShows[ISS_NORAD], false);

    satellitesLayer.setParams({ showOrbits: true });
    const restored = _satelliteVisualStateForTest();
    assert.equal(restored.showOrbits, true);
    assert.equal(restored.orbitShows[ISS_NORAD], true);
    assert.equal(restored.catalog, 'dense');
    assert.deepEqual(restored.pointIds.sort((a, b) => a - b), [ISS_NORAD, CORE_NORAD, DENSE_NORAD]);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('toggling orbits does not fetch CelesTrak or change satGroup', () => {
  const originalFetch = globalThis.fetch;
  const storage = memoryStorage();
  const fetches = [];
  try {
    resetSatGroupCache();
    setSatGroup('weather', storage);
    globalThis.fetch = async (url) => {
      fetches.push(String(url));
      return { ok: false, status: 502 };
    };
    _setSatellitePresentationForTest({
      catalog: 'core',
      showOrbits: true,
      points: [ISS_NORAD],
      orbits: [ISS_NORAD],
    });

    satellitesLayer.setParams({ showOrbits: false }, { storage });
    satellitesLayer.setParams({ showOrbits: true }, { storage });
    assert.deepEqual(fetches, []);
    assert.equal(getSatGroup(storage), 'weather');
    assert.equal(satellitesLayer.getParams().catalog, 'core');
    assert.equal(satellitesLayer.getParams().satGroup, 'weather');
  } finally {
    globalThis.fetch = originalFetch;
    resetSatGroupCache();
    _clearDenseCatalogStateForTest();
  }
});

test('a failed CelesTrak fetch leaves the orbits toggle unchanged', async () => {
  const originalFetch = globalThis.fetch;
  const warn = console.warn;
  const log = console.log;
  console.warn = () => {};
  console.log = () => {};
  try {
    _setSatellitePresentationForTest({
      catalog: 'core',
      showOrbits: false,
      points: [ISS_NORAD, CORE_NORAD],
      orbits: [ISS_NORAD],
    });
    globalThis.fetch = async () => ({ ok: false, status: 502 });

    await satellitesLayer.update(VIEWER);
    assert.equal(satellitesLayer.getParams().showOrbits, false);
    assert.equal(satellitesLayer.getParams().catalog, 'core');
    assert.equal(_satelliteVisualStateForTest().orbitShows[ISS_NORAD], false);
    assert.deepEqual(
      _satelliteVisualStateForTest().pointIds.sort((a, b) => a - b),
      [ISS_NORAD, CORE_NORAD],
    );

    satellitesLayer.setParams({ catalog: 'dense' });
    const settled = await settleDense();
    assert.equal(settled.state, 'error');
    assert.equal(satellitesLayer.getParams().catalog, 'core');
    assert.equal(satellitesLayer.getParams().showOrbits, false);
  } finally {
    console.warn = warn;
    console.log = log;
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('orbit chrome does not add an API endpoint', () => {
  const satellites = readFileSync(path.join(ROOT, 'src/data/satellites.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  assert.match(satellites, /id: 'orbits'/);
  assert.match(layerState, /booleanOption\('showOrbits', 'o', true\)/);
  assert.doesNotMatch(satellites, /\/api\/(?!celestrak)/);
  assert.doesNotMatch(layerState, /\/api\//);
});
