import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

import {
  KEEP_ABOVE_DEFAULT,
  KEEP_ABOVE_MARGIN_M,
  KEEP_ABOVE_STORAGE_KEY,
  cameraLiftHeightM,
  clampCameraAboveGround,
  decideCameraAboveGround,
  hydrateKeepAboveEnabled,
  installKeepAboveGround,
  keepAboveEnabledFromStoredValue,
  readKeepAbovePreference,
  resetKeepAboveEnabledForTest,
  resolveCameraGroundHeightM,
  setKeepAboveEnabled,
  writeKeepAbovePreference,
} from './cameraAboveGround.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (name) => readFileSync(path.join(ROOT, 'src', name), 'utf8');
const root = (name) => readFileSync(path.join(ROOT, name), 'utf8');

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    keys() {
      return [...map.keys()];
    },
  };
}

function makeCamera({ lonRad = 0, latRad = 0, height = 100 } = {}) {
  return {
    positionCartographic: { longitude: lonRad, latitude: latRad, height },
    position: { x: 0, y: 0, z: height },
  };
}

function eventChannel() {
  const listeners = new Set();
  return {
    addEventListener(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    raise() {
      for (const fn of [...listeners]) fn();
    },
    size() {
      return listeners.size;
    },
  };
}

test('keep-above defaults on and persists only meridian.keepAbove', () => {
  assert.equal(KEEP_ABOVE_STORAGE_KEY, 'meridian.keepAbove');
  assert.equal(KEEP_ABOVE_DEFAULT, true);
  assert.ok(KEEP_ABOVE_MARGIN_M > 0 && KEEP_ABOVE_MARGIN_M <= 8,
    'margin is a small clearance, not an aircraft floor');
  assert.equal(keepAboveEnabledFromStoredValue(undefined), true);
  assert.equal(keepAboveEnabledFromStoredValue(null), true);
  assert.equal(keepAboveEnabledFromStoredValue('nope'), true);
  assert.equal(keepAboveEnabledFromStoredValue('0'), false);
  assert.equal(keepAboveEnabledFromStoredValue(false), false);
  assert.equal(keepAboveEnabledFromStoredValue('1'), true);

  const storage = memoryStorage();
  assert.equal(readKeepAbovePreference(storage), true, 'absent key is default ON');
  assert.equal(writeKeepAbovePreference(storage, false), true);
  assert.deepEqual(storage.keys(), [KEEP_ABOVE_STORAGE_KEY]);
  assert.equal(storage.getItem(KEEP_ABOVE_STORAGE_KEY), '0');
  assert.equal(readKeepAbovePreference(storage), false);
  assert.equal(writeKeepAbovePreference(storage, true), true);
  assert.equal(storage.getItem(KEEP_ABOVE_STORAGE_KEY), '1');
});

test('hostile or missing storage fails open to keep-above on', () => {
  assert.equal(readKeepAbovePreference(null), true);
  assert.equal(readKeepAbovePreference({
    getItem() { throw new Error('blocked'); },
  }), true);
  assert.equal(writeKeepAbovePreference({
    setItem() { throw new Error('blocked'); },
  }, false), false);
});

test('zoom into a mountain lifts the camera to ground plus a small margin', () => {
  const mountain = 1600;
  assert.equal(cameraLiftHeightM(400, mountain), mountain + KEEP_ABOVE_MARGIN_M);
  assert.equal(cameraLiftHeightM(mountain + 80, mountain), null, 'already clear stays put');
  assert.equal(cameraLiftHeightM(mountain + KEEP_ABOVE_MARGIN_M, mountain), null);

  const decision = decideCameraAboveGround({
    cameraHeightM: 200,
    groundHeightM: mountain,
  });
  assert.equal(decision.lifted, true);
  assert.equal(decision.heightM, mountain + KEEP_ABOVE_MARGIN_M);
  assert.equal(decision.reason, 'below-ground');
});

test('globe.getHeight wins when present; cached /api/terrain/heights floor is the fallback', () => {
  assert.equal(resolveCameraGroundHeightM({ globeHeight: 138.4, cachedFloor: 120 }), 138.4);
  assert.equal(resolveCameraGroundHeightM({ globeHeight: undefined, cachedFloor: 120 }), 120);
  assert.equal(resolveCameraGroundHeightM({ globeHeight: 0, cachedFloor: 12 }), 0,
    'sea-level globe height is a real floor, not missing data');
  assert.equal(resolveCameraGroundHeightM({}), null);
});

test('terrain 503 / unknown ground skips the lift and does not throw', async () => {
  const camera = makeCamera({ height: -40 });
  const heights = [];
  const result = await clampCameraAboveGround({
    camera,
    globeGetHeight() { throw new Error('terrain heights proxy HTTP 503'); },
    cachedFloor() { return null; },
    async warmFloor() { throw new Error('HTTP 503'); },
    enabled: true,
    cockpitActive: false,
    setHeight(_carto, heightM) { heights.push(heightM); },
  });
  assert.equal(result.lifted, false);
  assert.equal(result.reason, 'no-ground');
  assert.deepEqual(heights, [], 'a down terrain helper must not invent a lift');
});

test('cockpit interior wins: keep-above does not lift while cockpit owns the camera', async () => {
  const camera = makeCamera({ height: 10 });
  const heights = [];
  const result = await clampCameraAboveGround({
    camera,
    globeGetHeight: () => 400,
    cachedFloor: () => 400,
    enabled: true,
    cockpitActive: true,
    setHeight(_carto, heightM) { heights.push(heightM); },
  });
  assert.equal(result.lifted, false);
  assert.equal(result.reason, 'cockpit');
  assert.deepEqual(heights, []);
});

test('toggle off skips the lift so an operator can still go underground', async () => {
  const camera = makeCamera({ height: 10 });
  const result = await clampCameraAboveGround({
    camera,
    globeGetHeight: () => 400,
    enabled: false,
    cockpitActive: false,
    setHeight() { throw new Error('disabled clamp must not write the camera'); },
  });
  assert.equal(result.lifted, false);
  assert.equal(result.reason, 'disabled');
});

test('after a camera move the installer lifts a buried view using existing helpers', async () => {
  const changed = eventChannel();
  const moveEnd = eventChannel();
  const camera = makeCamera({
    lonRad: (-97.7431 * Math.PI) / 180,
    latRad: (30.2672 * Math.PI) / 180,
    height: 80,
  });
  const viewer = {
    camera: { ...camera, changed, moveEnd, position: { x: 1, y: 2, z: 80 } },
    scene: {
      globe: { getHeight: () => 220 },
      requestRenderCount: 0,
      requestRender() { this.requestRenderCount += 1; },
    },
  };
  const dispose = installKeepAboveGround(viewer, {
    isEnabled: () => true,
    isCockpitActive: () => false,
    getCachedFloor: () => null,
    setCameraCartesian(next) { viewer.camera.position = next; },
  });
  try {
    moveEnd.raise();
    await Promise.resolve();
    assert.equal(viewer.camera.position.height, 220 + KEEP_ABOVE_MARGIN_M);
    assert.ok(viewer.scene.requestRenderCount >= 1);
  } finally {
    dispose();
  }
});

test('installer skips lift on terrain 503 and while cockpit is active', async () => {
  const moveEnd = eventChannel();
  const camera = makeCamera({ height: 12 });
  const viewer = {
    camera: { ...camera, changed: eventChannel(), moveEnd, position: { x: 0, y: 0, z: 12 } },
    scene: {
      globe: {
        getHeight() { throw Object.assign(new Error('unavailable'), { status: 503 }); },
      },
      requestRender() { this.requestRenderCount = (this.requestRenderCount || 0) + 1; },
    },
  };
  const before = { ...viewer.camera.position };
  const dispose = installKeepAboveGround(viewer, {
    isEnabled: () => true,
    isCockpitActive: () => false,
    getCachedFloor: () => null,
    async warmFloor() { throw new Error('HTTP 503'); },
    setCameraCartesian() { throw new Error('503 must not write the camera'); },
  });
  try {
    moveEnd.raise();
    await Promise.resolve();
    assert.deepEqual(viewer.camera.position, before);
  } finally {
    dispose();
  }

  viewer.camera.positionCartographic.height = 12;
  const cockpitDispose = installKeepAboveGround(viewer, {
    isEnabled: () => true,
    isCockpitActive: () => true,
    getCachedFloor: () => 900,
    setCameraCartesian() { throw new Error('cockpit must keep the interior camera'); },
  });
  try {
    viewer.scene.globe.getHeight = () => 900;
    moveEnd.raise();
    await Promise.resolve();
    assert.equal(viewer.camera.positionCartographic.height, 12);
  } finally {
    cockpitDispose();
  }
});

test('live preference hydrates meridian.keepAbove without rewriting storage', () => {
  resetKeepAboveEnabledForTest();
  try {
    const storage = memoryStorage({ 'meridian.keepAbove': '0' });
    assert.equal(hydrateKeepAboveEnabled(storage), false);
    assert.equal(storage.getItem(KEEP_ABOVE_STORAGE_KEY), '0');
    assert.equal(setKeepAboveEnabled(true, { storage }), true);
    assert.equal(storage.getItem(KEEP_ABOVE_STORAGE_KEY), '1');
  } finally {
    resetKeepAboveEnabledForTest();
  }
});

test('DISPLAY ships Keep above ground default-on; cockpit enter path is untouched', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const moduleSource = src('cameraAboveGround.js');
  const cockpit = src('cockpitTracking.js');
  const license = root('LICENSE');

  assert.match(
    html,
    /class="pp-toggle-btn active" id="keep-above-toggle" aria-pressed="true"/,
    'index.html: Keep above paints lit on first paint',
  );
  assert.match(html, /id="keep-above-toggle"[\s\S]*?<span class="pp-label">Above<\/span>/);
  assert.equal((html.match(/id="keep-above-toggle"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-cockpit-display-slot="keep-above"/,
    'keep-above is a map camera clamp, not a cockpit interior control');

  assert.match(ui, /hydrateKeepAboveEnabled/);
  assert.match(ui, /installKeepAboveGround/);
  assert.match(ui, /meridian\.keepAbove/);
  assert.match(ui, /setKeepAboveEnabled\(!this\._keepAboveEnabled/);
  assert.match(ui, /this\.cockpitView\?\.active === true/,
    'installer must skip when the existing cockpit camera is driving');

  assert.match(cockpit, /export function enterCockpitWithTracking/);
  assert.doesNotMatch(cockpit, /keepAbove|cameraAboveGround|installKeepAboveGround/,
    'cockpit enter still uses the existing owner, not this clamp');

  assert.doesNotMatch(moduleSource, /\/api\/(?!terrain\/heights)/);
  assert.match(moduleSource, /cachedGroundFloor|globe\.getHeight|getHeight/);
  assert.doesNotMatch(moduleSource, /OpenSky|Google News|TeleGeography|quantum-earth|God'?s Eye View/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(html, /<title>Meridian<\/title>/);
});
