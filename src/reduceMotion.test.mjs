import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  REDUCE_MOTION_STORAGE_KEY,
  applyReduceMotionDocument,
  decorativeFlowTimeSeconds,
  decorativePulseFactor,
  initReduceMotion,
  isReduceMotionEnabled,
  osPrefersReducedMotion,
  prefersReducedMotion,
  readReduceMotionOverride,
  setReduceMotionOverride,
  subscribeReduceMotion,
} from './reduceMotion.js';

function installHarness({ osReduce = false, persist = null } = {}) {
  const store = new Map();
  if (persist !== null) store.set(REDUCE_MOTION_STORAGE_KEY, persist);
  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  const mediaListeners = new Set();
  const storageListeners = new Set();
  const documentElement = {
    dataset: {},
    classList: {
      names: new Set(),
      toggle(name, force) {
        if (force) this.names.add(name);
        else this.names.delete(name);
      },
      contains(name) { return this.names.has(name); },
    },
  };
  globalThis.window = {
    matchMedia: (query) => ({
      matches: osReduce && /prefers-reduced-motion:\s*reduce/.test(query),
      addEventListener(_type, listener) { mediaListeners.add(listener); },
      removeEventListener(_type, listener) { mediaListeners.delete(listener); },
    }),
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
    },
    addEventListener(type, listener) {
      if (type === 'storage') storageListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'storage') storageListeners.delete(listener);
    },
  };
  globalThis.document = { documentElement };
  return {
    documentElement,
    mediaListeners,
    storageListeners,
    restore() {
      if (priorWindow === undefined) delete globalThis.window;
      else globalThis.window = priorWindow;
      if (priorDocument === undefined) delete globalThis.document;
      else globalThis.document = priorDocument;
    },
  };
}

test('unset persist follows the OS reduce-motion query', () => {
  const env = installHarness({ osReduce: true });
  try {
    assert.equal(osPrefersReducedMotion(), true);
    assert.equal(readReduceMotionOverride(), null);
    assert.equal(isReduceMotionEnabled(), true);
    assert.equal(prefersReducedMotion(), true);
  } finally {
    env.restore();
  }

  const off = installHarness({ osReduce: false });
  try {
    assert.equal(osPrefersReducedMotion(), false);
    assert.equal(isReduceMotionEnabled(), false);
  } finally {
    off.restore();
  }
});

test('meridian.reduceMotion persist overrides the OS in both directions', () => {
  const forceOn = installHarness({ osReduce: false, persist: '1' });
  try {
    assert.equal(readReduceMotionOverride(), true);
    assert.equal(isReduceMotionEnabled(), true);
  } finally {
    forceOn.restore();
  }

  const forceOff = installHarness({ osReduce: true, persist: '0' });
  try {
    assert.equal(readReduceMotionOverride(), false);
    assert.equal(isReduceMotionEnabled(), false, 'toggle off restores motion even when the OS wants reduce');
  } finally {
    forceOff.restore();
  }
});

test('setReduceMotionOverride writes meridian.reduceMotion and stamps the document', () => {
  const env = installHarness({ osReduce: true });
  try {
    const seen = [];
    const unsubscribe = subscribeReduceMotion((enabled) => seen.push(enabled));
    setReduceMotionOverride(false);
    assert.equal(window.localStorage.getItem(REDUCE_MOTION_STORAGE_KEY), '0');
    assert.equal(isReduceMotionEnabled(), false);
    assert.equal(env.documentElement.dataset.reduceMotion, 'false');
    assert.equal(env.documentElement.classList.contains('reduce-motion'), false);
    assert.deepEqual(seen, [false]);

    setReduceMotionOverride(true);
    assert.equal(window.localStorage.getItem(REDUCE_MOTION_STORAGE_KEY), '1');
    assert.equal(isReduceMotionEnabled(), true);
    assert.equal(env.documentElement.dataset.reduceMotion, 'true');
    assert.equal(env.documentElement.classList.contains('reduce-motion'), true);
    assert.deepEqual(seen, [false, true]);
    unsubscribe();
  } finally {
    env.restore();
  }
});

test('applyReduceMotionDocument and initReduceMotion publish data-reduce-motion', () => {
  const env = installHarness({ osReduce: true });
  try {
    assert.equal(applyReduceMotionDocument(), true);
    assert.equal(env.documentElement.dataset.reduceMotion, 'true');
    const stop = initReduceMotion();
    assert.equal(typeof stop, 'function');
    assert.ok(env.mediaListeners.size >= 1);
    assert.ok(env.storageListeners.size >= 1);
    stop();
  } finally {
    env.restore();
  }
});

test('decorative pulse and trail flourish freeze under reduce-motion', () => {
  const env = installHarness({ osReduce: true });
  try {
    assert.equal(decorativePulseFactor(1234), 1);
    assert.equal(decorativeFlowTimeSeconds(2500), 0);
  } finally {
    env.restore();
  }

  const motion = installHarness({ osReduce: false, persist: '0' });
  try {
    const pulse = decorativePulseFactor(Math.PI / 0.005 / 2);
    assert.ok(pulse > 0.99 && pulse < 1.01);
    assert.equal(decorativeFlowTimeSeconds(2500), 2.5);
  } finally {
    motion.restore();
  }
});

test('idle spin is gated and Home fly-to stays a real camera flight', () => {
  const orbit = fs.readFileSync(new URL('./orbit.js', import.meta.url), 'utf8');
  const camera = fs.readFileSync(new URL('./camera.js', import.meta.url), 'utf8');
  const locations = fs.readFileSync(new URL('./locations.js', import.meta.url), 'utf8');
  const verbs = fs.readFileSync(new URL('./cameraVerbs.js', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');

  assert.match(orbit, /isReduceMotionEnabled\(\)/);
  assert.match(orbit, /if \(isReduceMotionEnabled\(\)\) return;/);
  assert.match(verbs, /from '\.\/reduceMotion\.js'/);
  assert.match(verbs, /mode === 'continuous' && prefersReducedMotion\(\)/);
  assert.match(ui, /id="reduce-motion-toggle"|getElementById\('reduce-motion-toggle'\)/);
  assert.match(html, /id="reduce-motion-toggle"/);
  assert.match(main, /initReduceMotion\(\)/);
  assert.match(main, /initReduceMotion\(\)[\s\S]*initLogoGaze\(\)/);

  assert.doesNotMatch(camera, /isReduceMotionEnabled|prefersReducedMotion|reduceMotion/);
  assert.doesNotMatch(locations, /isReduceMotionEnabled|prefersReducedMotion|reduceMotion/);
  assert.match(camera, /viewer\.camera\.flyTo\(/);
  assert.match(locations, /export function flyToGlobeView[\s\S]*viewer\.camera\.flyTo\(/);
  assert.match(ui, /resetToGlobeView\(\)[\s\S]*flyToGlobeView\(this\.viewer/);

  assert.match(css, /html\[data-reduce-motion="true"\][\s\S]*animation:\s*none/);
  assert.match(css, /html:not\(\[data-reduce-motion="false"\]\) \.hud-bracket/);
  assert.match(css, /html\[data-reduce-motion="true"\] #detection-toggle\.panoptic/);
});
