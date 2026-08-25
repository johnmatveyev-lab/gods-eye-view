// PLAN 81 — Invert scroll zoom. Input only. Persist meridian.invertScroll.
// Default is today's Cesium wheel-zoom sign. Toggle flips that sign; toggle
// back matches production. Pinch / pan / tilt stay as-is. Home / compass /
// crosshair chrome is not this control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  INVERT_SCROLL_CHANGE_EVENT,
  INVERT_SCROLL_DEFAULT,
  INVERT_SCROLL_STORAGE_KEY,
  applyZoomMovementSign,
  bindInvertScrollToggle,
  getInvertScroll,
  installWheelZoomSign,
  normalizeInvertScroll,
  readInvertScroll,
  resetInvertScrollCache,
  setInvertScroll,
  signedWheelZoomDelta,
  syncInvertScrollButton,
  writeInvertScroll,
} from './invertScroll.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const WHEEL = 'WHEEL';
const PINCH = 'PINCH';
const LEFT_DRAG = 'LEFT_DRAG';
const MIDDLE_DRAG = 'MIDDLE_DRAG';

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

function movement(startY, endY) {
  return {
    startPosition: { x: 10, y: startY },
    endPosition: { x: 10, y: endY },
  };
}

function wheelDelta(mv) {
  return mv.endPosition.y - mv.startPosition.y;
}

test('the stored key is meridian.invertScroll and the default stays production', () => {
  assert.equal(INVERT_SCROLL_STORAGE_KEY, 'meridian.invertScroll');
  assert.equal(INVERT_SCROLL_DEFAULT, false);
  assert.equal(normalizeInvertScroll(undefined), false);
  assert.equal(normalizeInvertScroll(null), false);
  assert.equal(normalizeInvertScroll(''), false);
  assert.equal(normalizeInvertScroll('bogus'), false);
  assert.equal(normalizeInvertScroll('0'), false);
  assert.equal(normalizeInvertScroll('1'), true);
  assert.equal(normalizeInvertScroll('true'), true);
  assert.equal(normalizeInvertScroll('on'), true);
  assert.equal(normalizeInvertScroll(true), true);
});

test('empty or unreadable storage keeps the production wheel direction', () => {
  resetInvertScrollCache();
  assert.equal(readInvertScroll(memoryStorage()), false);
  assert.equal(readInvertScroll(null), false);
  assert.equal(readInvertScroll({
    getItem() {
      throw new Error('blocked');
    },
  }), false);
});

test('reload keeps an Invert choice and writes 1|0 only', () => {
  const storage = memoryStorage();
  assert.equal(writeInvertScroll(storage, true), true);
  assert.equal(storage.getItem(INVERT_SCROLL_STORAGE_KEY), '1');
  resetInvertScrollCache();
  assert.equal(readInvertScroll(storage), true);

  assert.equal(writeInvertScroll(storage, false), false);
  assert.equal(storage.getItem(INVERT_SCROLL_STORAGE_KEY), '0');
});

test('toggle: wheel in is the opposite of today; toggle back matches production', () => {
  const productionIn = signedWheelZoomDelta(-80, false);
  const productionOut = signedWheelZoomDelta(80, false);
  assert.equal(productionIn, -80);
  assert.equal(productionOut, 80);
  assert.notEqual(productionIn, productionOut);

  assert.equal(signedWheelZoomDelta(-80, true), -productionIn);
  assert.equal(signedWheelZoomDelta(80, true), -productionOut);

  const today = movement(100, 40);
  const inverted = applyZoomMovementSign(today, { invert: true, type: WHEEL, wheelType: WHEEL });
  const restored = applyZoomMovementSign(today, { invert: false, type: WHEEL, wheelType: WHEEL });

  assert.equal(wheelDelta(today), -60, 'production Cesium wheel-in is a negative Y');
  assert.equal(wheelDelta(inverted), 60, 'invert flips that existing sign');
  assert.equal(wheelDelta(restored), wheelDelta(today), 'toggle off is identity');
  assert.equal(restored, today);
});

test('pinch, pan, and tilt movements stay as-is when invert is on', () => {
  const pinch = movement(20, 80);
  const pan = movement(50, 90);
  const tilt = movement(12, 44);

  assert.equal(
    applyZoomMovementSign(pinch, { invert: true, type: PINCH, wheelType: WHEEL }),
    pinch,
  );
  assert.equal(
    applyZoomMovementSign(pan, { invert: true, type: LEFT_DRAG, wheelType: WHEEL }),
    pan,
  );
  assert.equal(
    applyZoomMovementSign(tilt, { invert: true, type: MIDDLE_DRAG, wheelType: WHEEL }),
    tilt,
  );
  assert.equal(wheelDelta(pinch), 60);
  assert.equal(wheelDelta(pan), 40);
  assert.equal(wheelDelta(tilt), 32);
});

test('installWheelZoomSign flips only WHEEL getMovement, then uninstall restores production', () => {
  const calls = [];
  const host = {
    getMovement(type) {
      calls.push(type);
      return movement(0, type === WHEEL ? -25 : 40);
    },
  };
  let invert = true;
  const remove = installWheelZoomSign(host, () => invert, WHEEL);

  const wheel = host.getMovement(WHEEL);
  const pinch = host.getMovement(PINCH);
  const pan = host.getMovement(LEFT_DRAG);
  assert.equal(wheelDelta(wheel), 25);
  assert.equal(wheelDelta(pinch), 40);
  assert.equal(wheelDelta(pan), 40);

  invert = false;
  assert.equal(wheelDelta(host.getMovement(WHEEL)), -25);

  remove();
  assert.equal(wheelDelta(host.getMovement(WHEEL)), -25);
  assert.deepEqual(calls, [WHEEL, PINCH, LEFT_DRAG, WHEEL, WHEEL]);
});

test('get/setInvertScroll persist through a cache reset the way a reload would', () => {
  const storage = memoryStorage();
  resetInvertScrollCache();
  assert.equal(getInvertScroll(storage), false);
  assert.equal(setInvertScroll(true, storage), true);
  resetInvertScrollCache();
  assert.equal(getInvertScroll(storage), true);
});

test('the Invert scroll toggle paints pressed state and persists the click', () => {
  const storage = memoryStorage();
  resetInvertScrollCache();
  const button = {
    attrs: { 'aria-pressed': 'false' },
    active: false,
    getAttribute(name) {
      return this.attrs[name];
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    classList: {
      toggle: (name, force) => {
        if (name === 'active') button.active = Boolean(force);
      },
    },
    listeners: new Map(),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    },
    removeEventListener(type) {
      this.listeners.delete(type);
    },
    click() {
      this.listeners.get('click')?.({ preventDefault() {} });
    },
  };
  const seen = [];

  bindInvertScrollToggle(button, {
    storage,
    onChange: (value) => seen.push(value),
  });
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.active, false);

  button.click();
  assert.equal(getInvertScroll(storage), true);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.active, true);
  assert.deepEqual(seen, [true]);

  button.click();
  assert.equal(getInvertScroll(storage), false);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(seen, [true, false]);

  syncInvertScrollButton(button, true);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
});

test('DISPLAY hosts Invert scroll; Home / compass / crosshair stay on existing chrome', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');
  const camera = readFileSync(path.join(ROOT, 'src', 'camera.js'), 'utf8');
  const thermal = readFileSync(path.join(ROOT, 'src', 'styles', 'thermal.js'), 'utf8');
  const surveillance = readFileSync(path.join(ROOT, 'src', 'styles', 'surveillance.js'), 'utf8');

  const display = html.match(/id="pp-toggles"[\s\S]*?id="clean-view-exit"/)[0];
  assert.match(display, /id="invert-scroll-toggle"/);
  assert.match(display, /Invert scroll/);
  assert.match(html, /id="invert-scroll-toggle"[^>]*aria-pressed="false"/);

  const topCenter = html.match(/id="top-center-actions"[\s\S]*?<\/nav>/)[0];
  assert.doesNotMatch(topCenter, /invert-scroll/);
  assert.match(topCenter, /id="home-view"/);
  assert.match(html, /id="cockpit-compass-tape"/);
  assert.match(html, /id="reset-globe-view"/);

  assert.match(ui, /installWheelZoomSign\(/);
  assert.match(ui, /Cesium\.CameraEventType\.WHEEL/);
  assert.doesNotMatch(ui, /enableRotate\s*=/);
  assert.doesNotMatch(ui, /enableTilt\s*=/);
  assert.doesNotMatch(ui, /enableTranslate\s*=/);
  assert.doesNotMatch(ui, /zoomEventTypes\s*=/);

  assert.match(camera, /export function flyToHomeView/);
  assert.match(ui, /this\.goHome\(\)/);
  assert.match(thermal, /float crosshair\(vec2 uv\)/);
  assert.match(surveillance, /float crosshair\(vec2 uv\)/);
});

test('share URLs, first-run missions, and /api stay out of invert scroll', () => {
  const share = readFileSync(path.join(ROOT, 'src', 'sharelink.js'), 'utf8');
  const firstRun = readFileSync(path.join(ROOT, 'src', 'firstRunExperience.js'), 'utf8');
  const invert = readFileSync(path.join(ROOT, 'src', 'invertScroll.js'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');

  assert.equal(share.includes('meridian.invertScroll'), false);
  assert.doesNotMatch(share, /params\.set\('invertScroll'/);
  assert.doesNotMatch(firstRun, /meridian\.invertScroll/);
  assert.doesNotMatch(invert, /\/api\//);
  assert.doesNotMatch(ui.match(/invertScroll|installWheelZoomSign[\s\S]{0,400}/)?.[0] || '', /\/api\//);
});

test('title stays Meridian; MIT credit and legal exclusions stay intact', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const invert = readFileSync(path.join(ROOT, 'src', 'invertScroll.js'), 'utf8');

  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(invert, /OpenSky/);
  assert.doesNotMatch(invert, /Google News/);
  assert.doesNotMatch(invert, /TeleGeography/);
  assert.doesNotMatch(invert, /quantum-earth/);
  assert.doesNotMatch(invert, /God's Eye View series/);
});

test('the change event name is meridian:invertScroll', () => {
  assert.equal(INVERT_SCROLL_CHANGE_EVENT, 'meridian:invertScroll');
});
