import test from 'node:test';
import assert from 'node:assert/strict';
import { flyToAustin, flyToPreset } from './camera.js';
import { flyToGlobeView } from './locations.js';
import { REDUCE_MOTION_STORAGE_KEY } from './reduceMotion.js';

function installReduceMotion() {
  const store = new Map([[REDUCE_MOTION_STORAGE_KEY, '1']]);
  const prior = globalThis.window;
  globalThis.window = {
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
    },
  };
  return {
    restore() {
      if (prior === undefined) delete globalThis.window;
      else globalThis.window = prior;
    },
  };
}

function fakeCameraViewer() {
  const flights = [];
  const views = [];
  return {
    flights,
    views,
    camera: {
      flyTo(options) { flights.push(options); },
      setView(options) { views.push(options); },
      cancelFlight() {},
      positionCartographic: { longitude: -1.7, latitude: 0.53, height: 800 },
    },
  };
}

test('fly-to Home / Austin still flies under reduce-motion', () => {
  const env = installReduceMotion();
  const timers = [];
  const priorTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => { timers.push(fn); return 1; };
  try {
    const viewer = fakeCameraViewer();
    flyToAustin(viewer);
    assert.equal(viewer.views.length, 1, 'intro view still sets');
    assert.equal(timers.length, 1, 'cinematic follow-up is still scheduled');
    timers[0]();
    assert.equal(viewer.flights.length, 1);
    assert.ok(viewer.flights[0].destination);
    assert.ok(viewer.flights[0].duration > 0);

    const presetViewer = fakeCameraViewer();
    flyToPreset(presetViewer, 'austin');
    assert.equal(presetViewer.flights.length, 1);

    const globe = fakeCameraViewer();
    const target = flyToGlobeView(globe);
    assert.equal(globe.flights.length, 1);
    assert.ok(globe.flights[0].destination);
    assert.ok(Number.isFinite(target.heightM));
  } finally {
    globalThis.setTimeout = priorTimeout;
    env.restore();
  }
});
