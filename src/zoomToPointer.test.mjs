// PLAN 83 — Zoom to pointer. Wheel zooms about the globe pick under the
// cursor when on; off keeps today's center zoom. Invert scroll flips sign only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isPickedWorldPosition } from './data/scenePick.js';
import {
  INVERT_SCROLL_STORAGE_KEY,
  ZOOM_TO_POINTER_DEFAULT,
  ZOOM_TO_POINTER_STORAGE_KEY,
  applyWheelZoom,
  bindZoomToPointerWheel,
  invertScrollEnabled,
  normalizeZoomToPointer,
  peekZoomToPointerPreference,
  pickGlobeAtWindow,
  readZoomToPointerPreference,
  resolveWheelZoomMode,
  setWheelZoomEventEnabled,
  signedWheelDelta,
  syncZoomToPointerButton,
  wheelZoomMeters,
  writeZoomToPointerPreference,
  zoomToPointerEnabled,
} from './zoomToPointer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const src = (name) => readFileSync(join(__dirname, name), 'utf8');
const root = (name) => readFileSync(join(repoRoot, name), 'utf8');

const WHEEL = 3;
const AUSTIN = { x: -740_000, y: -5_460_000, z: 3_190_000 };

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    dump() {
      return Object.fromEntries(values);
    },
  };
}

function vec(x, y, z) {
  return { x, y, z };
}

function sub(a, b) {
  return vec(a.x - b.x, a.y - b.y, a.z - b.z);
}

function mag(a) {
  return Math.hypot(a.x, a.y, a.z);
}

function norm(a) {
  const length = mag(a);
  return vec(a.x / length, a.y / length, a.z / length);
}

function almostEqualVec(a, b, epsilon = 1e-8) {
  return Math.abs(a.x - b.x) < epsilon
    && Math.abs(a.y - b.y) < epsilon
    && Math.abs(a.z - b.z) < epsilon;
}

function directionTo(from, to) {
  return norm(sub(to, from));
}

function mockCamera({ position, direction } = {}) {
  const camera = {
    position: vec(position?.x ?? 0, position?.y ?? 0, position?.z ?? 2000),
    direction: vec(direction?.x ?? 0, direction?.y ?? 0, direction?.z ?? -1),
    cancelled: 0,
    moves: [],
    zooms: [],
    cancelFlight() {
      this.cancelled += 1;
    },
    move(dir, amount) {
      this.moves.push({ dir: { ...dir }, amount });
      this.position.x += dir.x * amount;
      this.position.y += dir.y * amount;
      this.position.z += dir.z * amount;
    },
    zoomIn(amount) {
      this.zooms.push({ kind: 'in', amount });
      this.move(this.direction, amount);
    },
    zoomOut(amount) {
      this.zooms.push({ kind: 'out', amount });
      this.move(this.direction, -amount);
    },
  };
  return camera;
}

function mockViewer({ pick, camera, wheelTypes = [1, WHEEL, 4] } = {}) {
  const listeners = [];
  const canvas = {
    clientWidth: 800,
    clientHeight: 600,
    getBoundingClientRect() {
      return { left: 10, top: 20, width: 800, height: 600 };
    },
    addEventListener(type, fn, options) {
      listeners.push({ type, fn, options });
    },
    removeEventListener(type, fn) {
      const index = listeners.findIndex((row) => row.type === type && row.fn === fn);
      if (index >= 0) listeners.splice(index, 1);
    },
    listeners,
  };
  const controller = { zoomEventTypes: [...wheelTypes] };
  const scene = {
    canvas,
    pickPositionSupported: pick !== undefined,
    pickPosition() {
      return pick === undefined ? null : pick;
    },
    screenSpaceCameraController: controller,
    requestRender() {
      this.rendered = (this.rendered || 0) + 1;
    },
    rendered: 0,
    globe: {
      pick() {
        return null;
      },
    },
  };
  return {
    canvas,
    camera: camera || mockCamera(),
    scene,
    controller,
  };
}

test('meridian.zoomToPointer defaults off in production and persists on|off', () => {
  assert.equal(ZOOM_TO_POINTER_STORAGE_KEY, 'meridian.zoomToPointer');
  assert.equal(ZOOM_TO_POINTER_DEFAULT, 'off');
  assert.equal(readZoomToPointerPreference(memoryStorage()), 'off');
  assert.equal(peekZoomToPointerPreference(memoryStorage()), null);
  assert.equal(zoomToPointerEnabled(undefined), false);
  assert.equal(normalizeZoomToPointer('maybe'), 'off');

  const storage = memoryStorage();
  assert.equal(writeZoomToPointerPreference(storage, 'on'), 'on');
  assert.equal(storage.dump()[ZOOM_TO_POINTER_STORAGE_KEY], 'on');
  assert.equal(readZoomToPointerPreference(storage), 'on');
  assert.equal(zoomToPointerEnabled('on'), true);

  assert.equal(writeZoomToPointerPreference(storage, 'off'), 'off');
  assert.equal(storage.dump()[ZOOM_TO_POINTER_STORAGE_KEY], 'off');
  assert.equal(readZoomToPointerPreference(storage), 'off');
});

test('a locked store still returns the chosen value without throwing', () => {
  const locked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.equal(readZoomToPointerPreference(locked), 'off');
  assert.equal(peekZoomToPointerPreference(locked), null);
  assert.equal(writeZoomToPointerPreference(locked, 'on'), 'on');
});

test('on + city pick keeps that city on the same camera ray', () => {
  const city = { ...AUSTIN };
  assert.equal(isPickedWorldPosition(city), true);
  const camera = mockCamera({
    position: vec(city.x - 4000, city.y + 2500, city.z + 8000),
    direction: vec(0, 0, -1),
  });
  const before = directionTo(camera.position, city);
  const distanceBefore = mag(sub(city, camera.position));

  const result = applyWheelZoom({
    camera,
    pick: city,
    zoomToPointer: true,
    deltaY: -120,
  });

  assert.equal(result.mode, 'pointer');
  assert.ok(result.amount > 0, 'scroll up zooms in');
  assert.ok(almostEqualVec(directionTo(camera.position, city), before), 'city stays under the cursor');
  assert.ok(mag(sub(city, camera.position)) < distanceBefore, 'camera moved toward the city');
  assert.equal(camera.zooms.length, 0, 'pointer zoom does not use center zoomIn');
});

test('off keeps current center zoom even when a city is under the cursor', () => {
  const city = { ...AUSTIN };
  const camera = mockCamera({
    position: vec(city.x - 4000, city.y + 2500, city.z + 8000),
    direction: vec(0, 0, -1),
  });
  const before = directionTo(camera.position, city);

  const result = applyWheelZoom({
    camera,
    pick: city,
    zoomToPointer: false,
    deltaY: -120,
  });

  assert.equal(result.mode, 'center');
  assert.equal(camera.zooms[0]?.kind, 'in');
  assert.equal(
    almostEqualVec(directionTo(camera.position, city), before),
    false,
    'center zoom lets the city slide on screen',
  );
});

test('no pick falls back to center zoom while the control is on', () => {
  const camera = mockCamera({ position: vec(0, 0, 5000), direction: vec(0, 0, -1) });
  const result = applyWheelZoom({
    camera,
    pick: null,
    zoomToPointer: true,
    deltaY: -80,
  });
  assert.equal(result.mode, 'center');
  assert.equal(camera.zooms[0]?.kind, 'in');
});

test('invert scroll flips direction only — the pointer city stays the pivot', () => {
  assert.equal(signedWheelDelta(-100, false), -100);
  assert.equal(signedWheelDelta(-100, true), 100);
  assert.equal(signedWheelDelta(80, true), -80);
  assert.equal(INVERT_SCROLL_STORAGE_KEY, 'meridian.invertScroll');
  assert.equal(invertScrollEnabled(memoryStorage()), false);
  assert.equal(invertScrollEnabled(memoryStorage({ [INVERT_SCROLL_STORAGE_KEY]: 'on' })), true);

  const city = { ...AUSTIN };
  const start = vec(city.x - 4000, city.y + 2500, city.z + 8000);
  const camera = mockCamera({ position: { ...start }, direction: vec(0, 0, -1) });
  const before = directionTo(camera.position, city);
  const distanceBefore = mag(sub(city, camera.position));

  const result = applyWheelZoom({
    camera,
    pick: city,
    zoomToPointer: true,
    deltaY: -120,
    invertScroll: true,
  });

  assert.equal(result.mode, 'pointer');
  assert.equal(result.invertScroll, true);
  assert.ok(result.amount < 0, 'invert turns scroll-up into zoom-out');
  assert.ok(almostEqualVec(directionTo(camera.position, city), before), 'invert does not change the pivot');
  assert.ok(mag(sub(city, camera.position)) > distanceBefore, 'camera backed away from the city');
});

test('resolveWheelZoomMode and pick cascade use the existing globe pick guard', () => {
  assert.equal(resolveWheelZoomMode({ zoomToPointer: true, pick: AUSTIN }), 'pointer');
  assert.equal(resolveWheelZoomMode({ zoomToPointer: true, pick: null }), 'center');
  assert.equal(resolveWheelZoomMode({ zoomToPointer: false, pick: AUSTIN }), 'center');
  assert.equal(resolveWheelZoomMode({ zoomToPointer: true, pick: { x: 500, y: 0, z: 0 } }), 'center');

  const city = { ...AUSTIN };
  const viewer = mockViewer({ pick: city });
  assert.deepEqual(pickGlobeAtWindow(viewer, { x: 120, y: 80 }), city);

  const sky = mockViewer({ pick: { x: 500, y: 0, z: 0 } });
  sky.camera.pickEllipsoid = () => null;
  assert.equal(pickGlobeAtWindow(sky, { x: 10, y: 10 }), null);
});

test('wheel meters keep a stable sign so invert is only a sign flip', () => {
  const inward = wheelZoomMeters(-120, 10_000);
  const outward = wheelZoomMeters(120, 10_000);
  assert.ok(inward > 0);
  assert.ok(outward < 0);
  assert.equal(inward, -outward);
  assert.equal(wheelZoomMeters(signedWheelDelta(-120, true), 10_000), outward);
});

test('on disables Cesium wheel zoom; off leaves the default center wheel', () => {
  const controller = { zoomEventTypes: [1, WHEEL, 4] };
  setWheelZoomEventEnabled(controller, false, WHEEL);
  assert.deepEqual(controller.zoomEventTypes, [1, 4]);
  setWheelZoomEventEnabled(controller, true, WHEEL);
  assert.deepEqual(controller.zoomEventTypes, [1, 4, WHEEL]);
});

test('bound wheel: on keeps the city; off does not steal Cesium center zoom', () => {
  const city = { ...AUSTIN };
  const storage = memoryStorage({ [ZOOM_TO_POINTER_STORAGE_KEY]: 'on' });
  const camera = mockCamera({
    position: vec(city.x - 4000, city.y + 2500, city.z + 8000),
    direction: vec(0, 0, -1),
  });
  const viewer = mockViewer({ pick: city, camera });
  const before = directionTo(camera.position, city);

  const unbind = bindZoomToPointerWheel(viewer, { storage, wheelType: WHEEL });
  assert.ok(!viewer.controller.zoomEventTypes.includes(WHEEL), 'Cesium wheel is off while pointer zoom is on');

  const handler = viewer.canvas.listeners.find((row) => row.type === 'wheel');
  assert.ok(handler, 'canvas wheel listener is installed');
  const event = {
    clientX: 210,
    clientY: 140,
    deltaY: -120,
    ctrlKey: false,
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
  handler.fn(event);
  assert.equal(event.prevented, true);
  assert.ok(almostEqualVec(directionTo(camera.position, city), before));

  writeZoomToPointerPreference(storage, 'off');
  const centerCamera = mockCamera({
    position: vec(city.x - 4000, city.y + 2500, city.z + 8000),
    direction: vec(0, 0, -1),
  });
  viewer.camera = centerCamera;
  const offEvent = {
    clientX: 210,
    clientY: 140,
    deltaY: -120,
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
  handler.fn(offEvent);
  assert.equal(offEvent.prevented, false, 'off leaves the event for Cesium center zoom');
  assert.equal(centerCamera.moves.length, 0);

  unbind();
  assert.ok(viewer.controller.zoomEventTypes.includes(WHEEL));
  assert.equal(viewer.canvas.listeners.length, 0);
});

test('Display ships a Zoom to pointer control wired to meridian.zoomToPointer', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  assert.match(html, /id="zoom-to-pointer-toggle"/);
  assert.match(html, /<span class="pp-label">Zoom to pointer<\/span>/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(ui, /bindZoomToPointerWheel\(/);
  assert.match(ui, /writeZoomToPointerPreference\(/);
  assert.match(ui, /ZOOM_TO_POINTER_STORAGE_KEY|meridian\.zoomToPointer/);
  assert.match(ui, /getElementById\('zoom-to-pointer-toggle'\)/);
});

test('sync button reflects off by default', () => {
  const button = {
    classes: new Set(),
    attrs: {},
    classList: {
      toggle(name, on) {
        if (on) button.classes.add(name);
        else button.classes.delete(name);
      },
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
  };
  syncZoomToPointerButton(button, false);
  assert.equal(button.classes.has('active'), false);
  assert.equal(button.attrs['aria-pressed'], 'false');
  syncZoomToPointerButton(button, true);
  assert.equal(button.classes.has('active'), true);
  assert.equal(button.attrs['aria-pressed'], 'true');
});

test('camera only: no /api, no lock-tilt mutation, legal pins stay put', () => {
  const moduleSource = src('zoomToPointer.js');
  const ui = src('ui.js');
  const license = root('LICENSE');
  const title = root('index.html').match(/<title>([^<]*)<\/title>/);

  assert.equal(title?.[1], 'Meridian');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /\/api\//);
  assert.doesNotMatch(moduleSource, /enableLook|enableTilt|enableRotate|lockTilt/);
  assert.doesNotMatch(moduleSource, /opensky|news\.google|telegeography|quantum-earth|God'?s Eye View/i);
  assert.doesNotMatch(ui, /zoomToPointer[\s\S]{0,200}enableTilt/);
});
