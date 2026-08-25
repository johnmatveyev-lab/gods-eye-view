// PLAN 120 — Density and Speed sliders. Wires existing
// setParams({ densityScale, speedScale }). Density 0.2–2.5 (default 1.0)
// changes dot spawn; speed 0.3–3.0 (default 1.0) scales ambient/live
// motion. Independent of Live | Sim, Uncovered Sim | Hide, and Jam viz.
// No extra TomTom/Overpass fetch. No new /api. Traffic is enabled-only
// (no cheap numeric layer-option slot), so prefs live in localStorage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DEFAULT_TRAFFIC_DENSITY,
  DEFAULT_TRAFFIC_SPEED,
  TRAFFIC_DENSITY_MAX,
  TRAFFIC_DENSITY_MIN,
  TRAFFIC_DENSITY_STORAGE_KEY,
  TRAFFIC_SPEED_MAX,
  TRAFFIC_SPEED_MIN,
  TRAFFIC_SPEED_STORAGE_KEY,
  clampTrafficDensity,
  clampTrafficSpeed,
  getTrafficDensity,
  getTrafficSpeed,
  readTrafficDensity,
  readTrafficSpeed,
  resetTrafficMotionCache,
  setTrafficDensity,
  setTrafficSpeed,
  trafficMotionSliders,
  writeTrafficDensity,
  writeTrafficSpeed,
} from './trafficMotion.js';
import trafficLayer from './traffic.js';

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

function restoreMotion() {
  resetTrafficMotionCache();
  trafficLayer.setParams({
    densityScale: DEFAULT_TRAFFIC_DENSITY,
    speedScale: DEFAULT_TRAFFIC_SPEED,
    jamViz: 'density',
    uncoveredRoads: 'sim',
    trafficSource: 'sim',
  });
}

test('stored keys, defaults, and clamps match the existing setParams contract', () => {
  assert.equal(TRAFFIC_DENSITY_STORAGE_KEY, 'meridian.trafficDensity');
  assert.equal(TRAFFIC_SPEED_STORAGE_KEY, 'meridian.trafficSpeed');
  assert.equal(DEFAULT_TRAFFIC_DENSITY, 1.0);
  assert.equal(DEFAULT_TRAFFIC_SPEED, 1.0);
  assert.equal(TRAFFIC_DENSITY_MIN, 0.2);
  assert.equal(TRAFFIC_DENSITY_MAX, 2.5);
  assert.equal(TRAFFIC_SPEED_MIN, 0.3);
  assert.equal(TRAFFIC_SPEED_MAX, 3.0);

  assert.equal(clampTrafficDensity(1), 1.0);
  assert.equal(clampTrafficDensity(0.2), 0.2);
  assert.equal(clampTrafficDensity(2.5), 2.5);
  assert.equal(clampTrafficDensity(0.05), 0.2);
  assert.equal(clampTrafficDensity(9), 2.5);
  assert.equal(clampTrafficDensity('bogus'), 1.0);
  assert.equal(clampTrafficDensity(NaN), 1.0);
  assert.equal(clampTrafficDensity(null), 1.0);

  assert.equal(clampTrafficSpeed(1), 1.0);
  assert.equal(clampTrafficSpeed(0.3), 0.3);
  assert.equal(clampTrafficSpeed(3), 3.0);
  assert.equal(clampTrafficSpeed(0.1), 0.3);
  assert.equal(clampTrafficSpeed(8), 3.0);
  assert.equal(clampTrafficSpeed('fast'), 1.0);
});

test('slider chrome emits setParams keys only and stays independent of other traffic chips', () => {
  const sliders = trafficMotionSliders({ densityScale: 1, speedScale: 1 });
  assert.deepEqual(sliders.map((slider) => slider.label), ['Density', 'Speed']);
  assert.deepEqual(sliders.map((slider) => slider.param), ['densityScale', 'speedScale']);
  assert.deepEqual(sliders.map((slider) => slider.params), [
    { densityScale: 1 },
    { speedScale: 1 },
  ]);
  for (const slider of sliders) {
    assert.equal(Object.keys(slider.params).length, 1);
    assert.equal(slider.params.trafficSource, undefined);
    assert.equal(slider.params.uncoveredRoads, undefined);
    assert.equal(slider.params.jamViz, undefined);
  }

  const density = sliders.find((slider) => slider.id === 'traffic-density');
  assert.equal(density.min, 0.2);
  assert.equal(density.max, 2.5);
  assert.equal(density.step, 0.1);
  assert.equal(density.value, 1.0);

  const speed = sliders.find((slider) => slider.id === 'traffic-speed');
  assert.equal(speed.min, 0.3);
  assert.equal(speed.max, 3.0);
  assert.equal(speed.step, 0.1);
  assert.equal(speed.value, 1.0);

  const thin = trafficMotionSliders({ densityScale: 0.2, speedScale: 0.3 });
  assert.equal(thin.find((slider) => slider.id === 'traffic-density').value, 0.2);
  assert.equal(thin.find((slider) => slider.id === 'traffic-speed').value, 0.3);
  assert.deepEqual(thin.find((slider) => slider.id === 'traffic-density').params, { densityScale: 0.2 });

  const thick = trafficMotionSliders({ densityScale: 2.5, speedScale: 3 });
  assert.equal(thick.find((slider) => slider.id === 'traffic-density').value, 2.5);
  assert.equal(thick.find((slider) => slider.id === 'traffic-speed').value, 3.0);
});

test('reload keeps a Density/Speed choice and writes the numeric scales only', () => {
  const storage = memoryStorage();
  assert.equal(writeTrafficDensity(0.2, storage), 0.2);
  assert.equal(storage.getItem(TRAFFIC_DENSITY_STORAGE_KEY), '0.2');
  assert.equal(writeTrafficSpeed(3, storage), 3);
  assert.equal(storage.getItem(TRAFFIC_SPEED_STORAGE_KEY), '3');
  resetTrafficMotionCache();
  assert.equal(readTrafficDensity(storage), 0.2);
  assert.equal(readTrafficSpeed(storage), 3);
  assert.equal(writeTrafficDensity(9, storage), 2.5);
  assert.equal(writeTrafficSpeed(0.05, storage), 0.3);
});

test('empty or unreadable storage keeps the 1.0 defaults', () => {
  resetTrafficMotionCache();
  assert.equal(readTrafficDensity(memoryStorage()), 1.0);
  assert.equal(readTrafficSpeed(memoryStorage()), 1.0);
  assert.equal(readTrafficDensity(null), 1.0);
  assert.equal(readTrafficSpeed({
    getItem() {
      throw new Error('blocked');
    },
  }), 1.0);
});

test('get/set persist through a cache reset the way a reload would', () => {
  const storage = memoryStorage();
  resetTrafficMotionCache();
  assert.equal(getTrafficDensity(storage), 1.0);
  assert.equal(getTrafficSpeed(storage), 1.0);
  assert.equal(setTrafficDensity(2.5, storage), 2.5);
  assert.equal(setTrafficSpeed(0.3, storage), 0.3);
  resetTrafficMotionCache();
  assert.equal(getTrafficDensity(storage), 2.5);
  assert.equal(getTrafficSpeed(storage), 0.3);
  setTrafficDensity(1, storage);
  setTrafficSpeed(1, storage);
  resetTrafficMotionCache();
});

test('setParams wires density and speed only and leaves Live|Sim, Uncovered, and Jam alone', () => {
  restoreMotion();
  try {
    const tilesBefore = trafficLayer.getStats().tilesFetched;
    trafficLayer.setParams({ densityScale: 0.2 });
    const afterDensity = trafficLayer.getParams();
    assert.equal(afterDensity.densityScale, 0.2);
    assert.equal(afterDensity.speedScale, 1.0);
    assert.equal(afterDensity.jamViz, 'density');
    assert.equal(afterDensity.uncoveredRoads, 'sim');
    assert.equal(afterDensity.trafficSource, 'sim');
    assert.equal(trafficLayer.getStats().tilesFetched, tilesBefore);

    trafficLayer.setParams({ speedScale: 3 });
    const afterSpeed = trafficLayer.getParams();
    assert.equal(afterSpeed.densityScale, 0.2);
    assert.equal(afterSpeed.speedScale, 3);
    assert.equal(afterSpeed.jamViz, 'density');
    assert.equal(afterSpeed.uncoveredRoads, 'sim');
    assert.equal(afterSpeed.trafficSource, 'sim');
    assert.equal(trafficLayer.getStats().tilesFetched, tilesBefore);

    trafficLayer.setParams({ jamViz: 'heatline' });
    assert.equal(trafficLayer.getParams().densityScale, 0.2);
    assert.equal(trafficLayer.getParams().speedScale, 3);
    trafficLayer.setParams({ uncoveredRoads: 'hide' });
    assert.equal(trafficLayer.getParams().densityScale, 0.2);
    trafficLayer.setParams({ trafficSource: 'live' });
    assert.equal(trafficLayer.getParams().speedScale, 3);
    assert.equal(trafficLayer.getParams().densityScale, 0.2);

    trafficLayer.setParams({ densityScale: 2.5, speedScale: 0.3 });
    assert.equal(trafficLayer.getParams().densityScale, 2.5);
    assert.equal(trafficLayer.getParams().speedScale, 0.3);
    trafficLayer.setParams({ densityScale: 1, speedScale: 1 });
    assert.equal(trafficLayer.getParams().densityScale, 1);
    assert.equal(trafficLayer.getParams().speedScale, 1);
    assert.equal(trafficLayer.getStats().tilesFetched, tilesBefore);
  } finally {
    restoreMotion();
  }
});

test('the traffic row exposes Density and Speed sliders through existing setParams', () => {
  restoreMotion();
  try {
    const controls = trafficLayer.getRowControls();
    const sliders = controls.sliders || [];
    assert.deepEqual(sliders.map((slider) => slider.id), ['traffic-density', 'traffic-speed']);
    assert.deepEqual(sliders.map((slider) => slider.param), ['densityScale', 'speedScale']);
    assert.equal(sliders.find((slider) => slider.id === 'traffic-density').value, 1);
    assert.equal(sliders.find((slider) => slider.id === 'traffic-speed').value, 1);
    trafficLayer.setParams({ densityScale: 0.2, speedScale: 3 });
    const after = trafficLayer.getRowControls().sliders;
    assert.equal(after.find((slider) => slider.id === 'traffic-density').value, 0.2);
    assert.equal(after.find((slider) => slider.id === 'traffic-speed').value, 3);
  } finally {
    restoreMotion();
  }
});

test('density changes spawn math and speed changes motion; 1.0 is current', () => {
  const traffic = readFileSync(path.join(ROOT, 'src/data/traffic.js'), 'utf8');
  const compute = traffic.slice(
    traffic.indexOf('function computeDotCount'),
    traffic.indexOf('function allocateRoadDotBudgets'),
  );
  assert.match(compute, /\* _densityScale/);
  assert.doesNotMatch(compute, /fetchFlowForBounds/);
  assert.doesNotMatch(compute, /\/api\/overpass/);
  assert.doesNotMatch(compute, /\/api\/tomtom/);

  const spawn = traffic.slice(
    traffic.indexOf('function spawnDotsForRoad'),
    traffic.indexOf('function animate()'),
  );
  assert.match(spawn, /baseMps \* _speedScale/);
  assert.doesNotMatch(spawn, /fetchFlowForBounds/);
  assert.doesNotMatch(spawn, /\/api\/overpass/);
  assert.doesNotMatch(spawn, /\/api\/tomtom/);
});

test('the traffic layer wires setParams({ densityScale, speedScale }) and does not add an endpoint', () => {
  const traffic = readFileSync(path.join(ROOT, 'src/data/traffic.js'), 'utf8');
  const motion = readFileSync(path.join(ROOT, 'src/data/trafficMotion.js'), 'utf8');
  assert.match(traffic, /from '\.\/trafficMotion\.js'/);
  assert.match(traffic, /trafficMotionSliders\(/);
  assert.match(traffic, /params\.densityScale/);
  assert.match(traffic, /params\.speedScale/);
  assert.match(traffic, /setTrafficDensity\(/);
  assert.match(traffic, /setTrafficSpeed\(/);
  assert.doesNotMatch(traffic, /\/api\/density/);
  assert.doesNotMatch(traffic, /\/api\/speed/);
  assert.doesNotMatch(motion, /\/api\//);
  assert.doesNotMatch(motion, /\/api\/tomtom/);
  assert.doesNotMatch(motion, /\/api\/overpass/);
});

test('share URLs and layer options stay out — no cheap numeric slot exists', () => {
  const share = readFileSync(path.join(ROOT, 'src/sharelink.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  assert.equal(share.includes('meridian.trafficDensity'), false);
  assert.equal(share.includes('meridian.trafficSpeed'), false);
  assert.doesNotMatch(share, /params\.set\('densityScale'/);
  assert.doesNotMatch(share, /params\.set\('speedScale'/);
  assert.match(layerState, /id: 'traffic', token: 't', disposition: 'enabled-only'/);
  assert.doesNotMatch(layerState, /densityScale|speedScale|trafficDensity|trafficSpeed/);
});
