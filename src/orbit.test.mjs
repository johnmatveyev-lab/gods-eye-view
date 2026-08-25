import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { OrbitController } from './orbit.js';
import { REDUCE_MOTION_STORAGE_KEY, setReduceMotionOverride } from './reduceMotion.js';

function installMotionWindow({ osReduce = false, persist = null } = {}) {
  const store = new Map();
  if (persist !== null) store.set(REDUCE_MOTION_STORAGE_KEY, persist);
  const prior = globalThis.window;
  globalThis.window = {
    matchMedia: (query) => ({
      matches: osReduce && /prefers-reduced-motion:\s*reduce/.test(query),
      addEventListener() {},
      removeEventListener() {},
    }),
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return {
    restore() {
      if (prior === undefined) delete globalThis.window;
      else globalThis.window = prior;
    },
  };
}

function fakeViewer() {
  const listeners = new Set();
  return {
    camera: {
      heading: 0,
      lookAt() {},
      lookAtTransform() {},
    },
    scene: {
      preRender: {
        addEventListener(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
    },
    _listeners: listeners,
  };
}

test('OS reduce-motion refuses idle orbit start', () => {
  const env = installMotionWindow({ osReduce: true });
  try {
    const viewer = fakeViewer();
    const orbit = new OrbitController(viewer);
    orbit.start(Cesium.Cartesian3.fromDegrees(-97.74, 30.27, 0));
    assert.equal(orbit.active, false);
    assert.equal(viewer._listeners.size, 0);
  } finally {
    env.restore();
  }
});

test('toggle off restores idle orbit and persist on stops a running spin', () => {
  const env = installMotionWindow({ osReduce: true, persist: '0' });
  try {
    const viewer = fakeViewer();
    const orbit = new OrbitController(viewer);
    orbit.start(Cesium.Cartesian3.fromDegrees(-97.74, 30.27, 0), { radius: 400, pitch: -30 });
    assert.equal(orbit.active, true);
    assert.equal(viewer._listeners.size, 1);

    setReduceMotionOverride(true);
    assert.equal(orbit.active, false);
  } finally {
    env.restore();
  }
});
