// PLAN 80 — camera crosshair. CSS plus at the copy-coords / measure aim point.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

import {
  CROSSHAIR_DEFAULT,
  CROSSHAIR_ELEMENT_ID,
  CROSSHAIR_STORAGE_KEY,
  _resetCameraCrosshairForTest,
  copyViewCenterCoords,
  createCrosshairElement,
  crosshairEnabledFromStoredValue,
  destroyCameraCrosshair,
  formatViewCenterCoords,
  getViewportCenterPx,
  installCameraCrosshair,
  isCameraCrosshairEnabled,
  readCrosshairPreference,
  setCameraCrosshairEnabled,
  syncCrosshairOverlay,
  writeCrosshairPreference,
} from './cameraCrosshair.js';
import { cameraCenterCoords, formatLatLon } from './copyCameraCoords.js';

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
    removeItem(key) {
      map.delete(key);
    },
    keys() {
      return [...map.keys()];
    },
  };
}

function fakeDocument() {
  const nodes = [];
  const doc = {
    createElement(tag) {
      const el = {
        tagName: String(tag).toUpperCase(),
        id: '',
        hidden: false,
        attrs: {},
        setAttribute(name, value) { this.attrs[name] = String(value); },
        getAttribute(name) { return this.attrs[name] ?? null; },
        remove() {
          const idx = nodes.indexOf(this);
          if (idx >= 0) nodes.splice(idx, 1);
        },
      };
      return el;
    },
  };
  return {
    doc,
    container: {
      ownerDocument: doc,
      children: nodes,
      querySelector(sel) {
        return nodes.find((node) => sel === `#${node.id}`) || null;
      },
      appendChild(node) {
        nodes.push(node);
        return node;
      },
    },
  };
}

test('missing meridian.crosshair defaults off', () => {
  _resetCameraCrosshairForTest();
  assert.equal(CROSSHAIR_STORAGE_KEY, 'meridian.crosshair');
  assert.equal(CROSSHAIR_DEFAULT, false);
  assert.equal(crosshairEnabledFromStoredValue(null), false);
  assert.equal(crosshairEnabledFromStoredValue(''), false);
  assert.equal(crosshairEnabledFromStoredValue('garbage'), false);
  assert.equal(crosshairEnabledFromStoredValue('0'), false);
  assert.equal(crosshairEnabledFromStoredValue('1'), true);
  assert.equal(crosshairEnabledFromStoredValue('true'), true);
  assert.equal(readCrosshairPreference(memoryStorage()), false);
  assert.equal(readCrosshairPreference(memoryStorage({ [CROSSHAIR_STORAGE_KEY]: '1' })), true);
});

test('crosshair persists only meridian.crosshair and never opens /api', () => {
  const storage = memoryStorage();
  writeCrosshairPreference(storage, true);
  assert.equal(storage.getItem(CROSSHAIR_STORAGE_KEY), '1');
  writeCrosshairPreference(storage, false);
  assert.equal(storage.getItem(CROSSHAIR_STORAGE_KEY), '0');
  assert.deepEqual(storage.keys(), [CROSSHAIR_STORAGE_KEY]);

  const moduleSource = src('cameraCrosshair.js');
  assert.doesNotMatch(moduleSource, /\/api\//);
  assert.doesNotMatch(moduleSource, /entities\.add|viewer\.entities/);
  assert.doesNotMatch(moduleSource, /clerk/i);
  assert.doesNotMatch(moduleSource, /opensky/i);
  assert.doesNotMatch(moduleSource, /news\.google/i);
  assert.doesNotMatch(moduleSource, /telegeography/i);
  assert.doesNotMatch(moduleSource, /quantum-earth/i);
});

test('on: plus at center; off: gone', () => {
  _resetCameraCrosshairForTest();
  const { container } = fakeDocument();
  const el = installCameraCrosshair({ container }, { enabled: false });
  assert.ok(el);
  assert.equal(el.id, CROSSHAIR_ELEMENT_ID);
  assert.equal(el.hidden, true);
  assert.equal(isCameraCrosshairEnabled(), false);

  setCameraCrosshairEnabled(true);
  assert.equal(el.hidden, false);
  assert.equal(isCameraCrosshairEnabled(), true);

  setCameraCrosshairEnabled(false);
  assert.equal(el.hidden, true);
  assert.equal(isCameraCrosshairEnabled(), false);
  destroyCameraCrosshair();
});

test('copy-coords still matches the canvas-center aim point', async () => {
  const canvas = { clientWidth: 1280, clientHeight: 720 };
  const center = getViewportCenterPx(canvas);
  assert.deepEqual(center, { x: 640, y: 360 });
  assert.deepEqual(getViewportCenterPx({ width: 800, height: 600 }), { x: 400, y: 300 });

  const actions = src('voice/gevActions.js');
  assert.match(actions, /import \{ getViewportCenterPx \} from '\.\.\/cameraCrosshair\.js'/);
  assert.match(
    actions,
    /const \{ x, y \} = getViewportCenterPx\(canvas\);\s*const center = new Cesium\.Cartesian2\(x, y\);/,
    'getViewTargetCartesian must pick the same pixel the plus marks',
  );

  const copySource = src('copyCameraCoords.js');
  assert.match(copySource, /positionCartographic/);
  assert.match(copySource, /camera-center \(not a cursor pick\)/);
  const home = cameraCenterCoords({ lat: 30.2672, lon: -97.7431 });
  assert.deepEqual(home, { lat: 30.2672, lon: -97.7431 });
  assert.equal(formatLatLon(home.lat, home.lon), '30.2672,-97.7431');
  const fromCarto = cameraCenterCoords({
    positionCartographic: {
      latitude: 30.2672 * Math.PI / 180,
      longitude: -97.7431 * Math.PI / 180,
    },
  });
  assert.deepEqual(fromCarto, { lat: 30.2672, lon: -97.7431 });

  const text = formatViewCenterCoords(30.267200, -97.743100);
  assert.equal(text, '30.267200, -97.743100');
  const written = [];
  const copied = await copyViewCenterCoords({
    latitudeDeg: 30.267200,
    longitudeDeg: -97.743100,
    clipboard: { writeText: async (value) => { written.push(value); } },
  });
  assert.equal(copied.ok, true);
  assert.equal(copied.text, text);
  assert.deepEqual(written, [text]);
  assert.equal(await copyViewCenterCoords({ latitudeDeg: Number.NaN, longitudeDeg: 0 }).then((r) => r.ok), false);
});

test('DISPLAY Crosshair control is overlay-only and independent of grid/scale/layers', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const css = root('style.css');
  const overlay = src('cameraCrosshair.js');

  assert.match(html, /id="crosshair-toggle"/);
  assert.match(html, /<span class="pp-label">Crosshair<\/span>/);
  assert.match(ui, /setCrosshairEnabled/);
  assert.match(ui, /CROSSHAIR_STORAGE_KEY/);
  assert.match(ui, /installCameraCrosshair|setCameraCrosshairEnabled/);

  assert.doesNotMatch(overlay, /scale.?bar|grid.?overlay|createWorldImagery|setStack\(/);
  assert.doesNotMatch(html, /id="crosshair-toggle"[\s\S]{0,200}grid/i);
  assert.match(css, /#camera-crosshair::before/);
  assert.match(css, /#camera-crosshair::after/);
  assert.match(css, /#camera-crosshair::before[\s\S]*?left:\s*50%/);
  assert.match(css, /#camera-crosshair::before[\s\S]*?top:\s*50%/);
  assert.match(css, /#camera-crosshair::after[\s\S]*?left:\s*50%/);
  assert.match(css, /#camera-crosshair::after[\s\S]*?top:\s*50%/);
  assert.match(css, /#camera-crosshair\[hidden\] \{\s*display: none;/);
});

test('fullscreen and clean view keep the plus centered; credits stay on', () => {
  const css = root('style.css');
  const overlay = src('cameraCrosshair.js');
  const main = src('main.js');
  const hideBlock = css.slice(
    css.indexOf('body.ui-clean-view #title-bar'),
    css.indexOf('body.ui-clean-view #scene-runtime.active'),
  );
  assert.doesNotMatch(hideBlock, /#camera-crosshair/);
  assert.doesNotMatch(css, /body\.ui-clean-view #camera-crosshair/);
  assert.doesNotMatch(css, /:fullscreen #camera-crosshair|:fullscreen[\s\S]{0,80}#camera-crosshair/);
  assert.match(css, /#camera-crosshair \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;/);
  assert.match(main, /installCameraCrosshair\(viewer/);
  assert.match(main, /id = 'cesium-credits'/);
  assert.match(css, /body\.ui-clean-view #cesium-credits/);
  assert.doesNotMatch(overlay, /cesium-credits|creditContainer|display:\s*none/);
});

test('legal: local overlay only, Meridian title, MIT credit, no banned sources', () => {
  const overlay = src('cameraCrosshair.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(overlay, /OpenSky|Google News|TeleGeography|God'?s Eye View|quantum-earth/i);
  assert.doesNotMatch(html, /id="crosshair-toggle"[\s\S]*OpenSky/);
});

test('sync and install stay idempotent', () => {
  _resetCameraCrosshairForTest();
  const { container } = fakeDocument();
  const first = installCameraCrosshair({ container });
  const second = installCameraCrosshair({ container }, { enabled: true });
  assert.equal(first, second);
  assert.equal(container.children.length, 1);
  assert.equal(syncCrosshairOverlay(null, true), false);
  const orphan = createCrosshairElement(container.ownerDocument);
  assert.equal(orphan.hidden, true);
  syncCrosshairOverlay(orphan, true);
  assert.equal(orphan.hidden, false);
  destroyCameraCrosshair();
});
