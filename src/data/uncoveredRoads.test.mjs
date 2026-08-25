// PLAN 107 — Uncovered: Sim | Hide. Distinct from Plan 69 Live | Sim.
// Sim keeps today's white ambient dots on roads TomTom has no flow for.
// Hide spawns nothing on those roads; colored live flow stays. Preference
// lives in localStorage `meridian.uncoveredRoads`. Share URLs stay out.
// No extra /api. Applies on the next camera-driven load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DEFAULT_UNCOVERED_ROADS,
  UNCOVERED_ROADS_STORAGE_KEY,
  getUncoveredRoads,
  normalizeUncoveredRoads,
  readUncoveredRoads,
  resetUncoveredRoadsCache,
  setUncoveredRoads,
  uncoveredRoadSpawns,
  uncoveredRoadsControls,
  writeUncoveredRoads,
} from './uncoveredRoads.js';
import trafficLayer from './traffic.js';
import { resetTrafficSourceCache, setTrafficSource } from './trafficSource.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function restoreTrafficPrefs() {
  resetUncoveredRoadsCache();
  resetTrafficSourceCache();
  trafficLayer.setParams({ uncoveredRoads: 'sim', trafficSource: 'live' });
}

test('the stored key is meridian.uncoveredRoads and the default is Sim', () => {
  assert.equal(UNCOVERED_ROADS_STORAGE_KEY, 'meridian.uncoveredRoads');
  assert.equal(DEFAULT_UNCOVERED_ROADS, 'sim');
  assert.equal(normalizeUncoveredRoads('hide'), 'hide');
  assert.equal(normalizeUncoveredRoads('sim'), 'sim');
  assert.equal(normalizeUncoveredRoads('bogus'), 'sim');
  assert.equal(normalizeUncoveredRoads(null), 'sim');
});

test('Sim matches the current mixed live+white-dot paint', () => {
  assert.equal(uncoveredRoadSpawns({
    liveMode: true,
    hasFlow: true,
    uncoveredRoads: 'sim',
  }), true, 'colored live flow still paints');
  assert.equal(uncoveredRoadSpawns({
    liveMode: true,
    hasFlow: false,
    uncoveredRoads: 'sim',
  }), true, 'uncovered roads keep white ambient dots');
});

test('Hide removes white ambient dots and keeps colored live flow', () => {
  assert.equal(uncoveredRoadSpawns({
    liveMode: true,
    hasFlow: false,
    uncoveredRoads: 'hide',
  }), false, 'uncovered roads spawn nothing');
  assert.equal(uncoveredRoadSpawns({
    liveMode: true,
    hasFlow: true,
    uncoveredRoads: 'hide',
  }), true, 'matched live flow still paints');
});

test('Live|Sim source toggle still works independently of Uncovered', () => {
  // Whole-feed Sim (Plan 69) is not liveMode — every road is ambient, so
  // Hide must not blank the built-in model.
  assert.equal(uncoveredRoadSpawns({
    liveMode: false,
    hasFlow: false,
    uncoveredRoads: 'hide',
  }), true);
  assert.equal(uncoveredRoadSpawns({
    liveMode: false,
    hasFlow: false,
    uncoveredRoads: 'sim',
  }), true);

  const controls = uncoveredRoadsControls({ uncoveredRoads: 'hide' });
  assert.equal(controls.heading, 'Uncovered');
  assert.equal(controls.chips.find((chip) => chip.id === 'uncovered-sim').params.uncoveredRoads, 'sim');
  assert.equal(controls.chips.find((chip) => chip.id === 'uncovered-hide').params.uncoveredRoads, 'hide');
  assert.equal(controls.chips.every((chip) => !chip.params.trafficSource), true);
});

test('Uncovered chips default to Sim and only write uncoveredRoads', () => {
  const controls = uncoveredRoadsControls({ uncoveredRoads: 'sim' });
  const sim = controls.chips.find((chip) => chip.id === 'uncovered-sim');
  const hide = controls.chips.find((chip) => chip.id === 'uncovered-hide');
  assert.equal(sim.label, 'Sim');
  assert.equal(hide.label, 'Hide');
  assert.equal(sim.active, true);
  assert.equal(hide.active, false);
  assert.equal(sim.disabled, false);
  assert.equal(hide.disabled, false);
  assert.deepEqual(Object.keys(sim.params), ['uncoveredRoads']);
  assert.deepEqual(Object.keys(hide.params), ['uncoveredRoads']);
});

test('reload keeps a Hide choice and writes sim|hide only', () => {
  const storage = memoryStorage();
  assert.equal(writeUncoveredRoads('hide', storage), 'hide');
  assert.equal(storage.getItem(UNCOVERED_ROADS_STORAGE_KEY), 'hide');
  resetUncoveredRoadsCache();
  assert.equal(readUncoveredRoads(storage), 'hide');
  assert.equal(writeUncoveredRoads('SIM', storage), 'sim');
  assert.equal(storage.getItem(UNCOVERED_ROADS_STORAGE_KEY), 'sim');
});

test('empty or unreadable storage keeps the Sim default', () => {
  resetUncoveredRoadsCache();
  assert.equal(readUncoveredRoads(memoryStorage()), 'sim');
  assert.equal(readUncoveredRoads(null), 'sim');
  assert.equal(readUncoveredRoads({
    getItem() {
      throw new Error('blocked');
    },
  }), 'sim');
});

test('get/setUncoveredRoads persist through a cache reset the way a reload would', () => {
  const storage = memoryStorage();
  resetUncoveredRoadsCache();
  assert.equal(getUncoveredRoads(storage), 'sim');
  assert.equal(setUncoveredRoads('hide', storage), 'hide');
  resetUncoveredRoadsCache();
  assert.equal(getUncoveredRoads(storage), 'hide');
});

test('setParams wires uncoveredRoads only and leaves Live|Sim alone', () => {
  restoreTrafficPrefs();
  try {
    const beforeSource = trafficLayer.getParams().trafficSource;
    trafficLayer.setParams({ uncoveredRoads: 'hide' });
    assert.equal(trafficLayer.getParams().uncoveredRoads, 'hide');
    assert.equal(trafficLayer.getParams().trafficSource, beforeSource);
    const hideChip = trafficLayer.getRowControls().chips.find((chip) => chip.id === 'uncovered-hide');
    assert.equal(hideChip.active, true);
    assert.equal(hideChip.group, 'Uncovered');

    setTrafficSource('sim');
    trafficLayer.setParams({ trafficSource: 'sim' });
    assert.equal(trafficLayer.getParams().uncoveredRoads, 'hide');
    assert.equal(trafficLayer.getParams().trafficSource, 'sim');
    const sourceSim = trafficLayer.getRowControls().chips.find((chip) => chip.id === 'traffic-source-sim');
    assert.equal(sourceSim.active, true);
    const uncoveredHide = trafficLayer.getRowControls().chips.find((chip) => chip.id === 'uncovered-hide');
    assert.equal(uncoveredHide.active, true);
  } finally {
    restoreTrafficPrefs();
  }
});

test('the traffic layer uses the existing uncoveredRoads param and does not refetch', () => {
  const traffic = readFileSync(path.join(ROOT, 'src/data/traffic.js'), 'utf8');
  assert.match(traffic, /from '\.\/uncoveredRoads\.js'/);
  assert.match(traffic, /uncoveredRoadSpawns\(/);
  assert.match(traffic, /uncoveredRoadsControls\(/);
  assert.match(traffic, /params\.uncoveredRoads/);
  assert.match(traffic, /setUncoveredRoads\(/);

  const setParamsFn = traffic.slice(
    traffic.indexOf('setParams(params = {})'),
    traffic.indexOf('getParams()'),
  );
  const uncoveredBranch = setParamsFn.slice(
    setParamsFn.indexOf("params.uncoveredRoads === 'sim'"),
    setParamsFn.indexOf("params.jamViz"),
  );
  assert.match(uncoveredBranch, /setUncoveredRoads/);
  assert.doesNotMatch(uncoveredBranch, /setTrafficSource/);
  assert.doesNotMatch(uncoveredBranch, /applyResolvedTrafficSource/);
  assert.doesNotMatch(uncoveredBranch, /applyTrafficSourceVisuals/);
  assert.doesNotMatch(uncoveredBranch, /fetchFlowForBounds/);
  assert.doesNotMatch(uncoveredBranch, /\/api\/overpass/);
  assert.doesNotMatch(uncoveredBranch, /\/api\/tomtom/);
});

test('share URLs stay enabled-only and no extra /api is added', () => {
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const traffic = readFileSync(path.join(ROOT, 'src/data/traffic.js'), 'utf8');
  const uncovered = readFileSync(path.join(ROOT, 'src/data/uncoveredRoads.js'), 'utf8');
  const share = readFileSync(path.join(ROOT, 'src/sharelink.js'), 'utf8');
  assert.match(layerState, /id: 'traffic', token: 't', disposition: 'enabled-only'/);
  assert.equal(share.includes('meridian.uncoveredRoads'), false);
  assert.doesNotMatch(share, /params\.set\('uncoveredRoads'/);
  assert.doesNotMatch(traffic, /\/api\/uncovered/);
  assert.doesNotMatch(uncovered, /\/api\/uncovered/);
  assert.doesNotMatch(uncovered, /\/api\/tomtom/);
  assert.doesNotMatch(uncovered, /\/api\/overpass/);
});
