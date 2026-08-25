/**
 * PLAN 79 — on-globe scale bar. Local overlay. Persist meridian.scaleBar.
 * Units (44) already own km|nm|mi labels; this bar is the missing ruler.
 * Grid stays independent. Credits stay on in clean view.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  SCALE_BAR_DEFAULT,
  SCALE_BAR_STORAGE_KEY,
  SCALE_BAR_TARGET_PX,
  computeScaleBar,
  initScaleBarPreference,
  isScaleBarEnabled,
  metersPerPixelFromCamera,
  niceScaleNumber,
  peekScaleBarPreference,
  readScaleBarPreference,
  resetScaleBarForTests,
  setScaleBarEnabled,
  scaleBarFromViewer,
  writeScaleBarPreference,
} from './scaleBar.js';
import { setDistanceUnit, resetDistanceUnitsForTests } from './units.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test.afterEach(() => {
  resetScaleBarForTests();
  resetDistanceUnitsForTests();
});

test('meridian.scaleBar defaults on and persists on|off', () => {
  assert.equal(SCALE_BAR_STORAGE_KEY, 'meridian.scaleBar');
  assert.equal(SCALE_BAR_DEFAULT, 'on');
  const storage = memoryStorage();
  assert.equal(readScaleBarPreference(storage), 'on');
  assert.equal(peekScaleBarPreference(storage), null);
  assert.equal(initScaleBarPreference({ storage }), true);

  assert.equal(writeScaleBarPreference(storage, 'off'), 'off');
  assert.equal(storage.getItem(SCALE_BAR_STORAGE_KEY), 'off');
  assert.equal(readScaleBarPreference(storage), 'off');
  assert.equal(initScaleBarPreference({ storage }), false);

  assert.equal(writeScaleBarPreference(storage, 'on'), 'on');
  assert.equal(storage.getItem(SCALE_BAR_STORAGE_KEY), 'on');
  assert.equal(readScaleBarPreference(storage), 'on');
});

test('a locked store still returns the chosen value without throwing', () => {
  const locked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.equal(readScaleBarPreference(locked), 'on');
  assert.equal(peekScaleBarPreference(locked), null);
  assert.equal(writeScaleBarPreference(locked, 'off'), 'off');
  assert.equal(setScaleBarEnabled(false, { storage: locked }), false);
});

test('bar length and label follow the km vs nm unit toggle', () => {
  const metersPerPixel = 1000;
  const km = computeScaleBar({ metersPerPixel, unit: 'km' });
  const nm = computeScaleBar({ metersPerPixel, unit: 'nm' });
  const mi = computeScaleBar({ metersPerPixel, unit: 'mi' });

  assert.ok(km && nm && mi, 'each unit must produce a bar');
  assert.equal(km.unit, 'km');
  assert.equal(nm.unit, 'nm');
  assert.equal(mi.unit, 'mi');
  assert.match(km.label, /km$/);
  assert.match(nm.label, /nmi$/);
  assert.match(mi.label, /mi$/);
  assert.notEqual(km.label, nm.label, 'km and nm must not share a label');
  assert.notEqual(km.widthPx, nm.widthPx, 'km and nm bars must have different pixel lengths');
  assert.ok(Math.abs(km.lengthMeters - km.widthPx * metersPerPixel) < 1e-6);
  assert.ok(Math.abs(nm.lengthMeters - nm.widthPx * metersPerPixel) < 1e-6);
  assert.ok(Math.abs(nm.lengthMeters / 1852 - 50) < 1e-6, '96 km of ground should snap to 50 nmi');
  assert.ok(Math.abs(km.lengthMeters / 1000 - 100) < 1e-6, '96 km of ground should snap to 100 km');
});

test('zoom in and out updates the painted length', () => {
  const far = computeScaleBar({ metersPerPixel: 1000, unit: 'km' });
  const near = computeScaleBar({ metersPerPixel: 100, unit: 'km' });
  assert.ok(far && near);
  assert.notEqual(far.label, near.label);
  assert.ok(far.lengthMeters > near.lengthMeters, 'zooming in must shorten the represented distance');

  const high = metersPerPixelFromCamera({
    heightM: 1_000_000,
    fovyRad: Math.PI / 3,
    viewportHeightPx: 900,
  });
  const low = metersPerPixelFromCamera({
    heightM: 10_000,
    fovyRad: Math.PI / 3,
    viewportHeightPx: 900,
  });
  assert.ok(high > low * 50, 'camera height is the pixel scale');
  const highBar = computeScaleBar({ metersPerPixel: high, unit: 'km' });
  const lowBar = computeScaleBar({ metersPerPixel: low, unit: 'km' });
  assert.notEqual(highBar.label, lowBar.label);
  assert.ok(highBar.lengthMeters > lowBar.lengthMeters);
});

test('the viewer helper uses the existing camera-height / fovy scale', () => {
  const viewer = {
    camera: {
      positionCartographic: { height: 100_000 },
      frustum: { fovy: Math.PI / 3 },
    },
    scene: { canvas: { clientHeight: 900 } },
  };
  const expected = metersPerPixelFromCamera({
    heightM: 100_000,
    fovyRad: Math.PI / 3,
    viewportHeightPx: 900,
  });
  const km = scaleBarFromViewer(viewer, { unit: 'km' });
  const nm = scaleBarFromViewer(viewer, { unit: 'nm' });
  assert.equal(km.lengthMeters / expected, km.widthPx);
  assert.notEqual(km.label, nm.label);
  assert.equal(scaleBarFromViewer({ camera: {} }, { unit: 'km' }), null);
});

test('nice numbers stay on the 1-2-5 scale', () => {
  assert.equal(niceScaleNumber(12), 10);
  assert.equal(niceScaleNumber(18), 20);
  assert.equal(niceScaleNumber(46), 50);
  assert.equal(niceScaleNumber(80), 100);
  assert.equal(computeScaleBar({ metersPerPixel: Number.NaN }), null);
  assert.equal(computeScaleBar({ metersPerPixel: 0 }), null);
});

test('scale bar is independent of the angular grid', () => {
  const source = readFileSync(new URL('./scaleBar.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /graticule|gridOverlay|latLonGrid|meridian\.grid/i);
  assert.doesNotMatch(source, /\/api\//);
  assert.match(source, /SCALE_BAR_STORAGE_KEY = 'meridian\.scaleBar'/);
  assert.match(source, /focalLengthPx/);
});

test('Display ships a Scale toggle and the overlay stays with credits in clean view', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');

  assert.match(html, /id="scale-bar-toggle"/);
  assert.match(html, /<span class="pp-label">Scale<\/span>/);
  assert.match(html, /id="scale-bar"/);
  assert.match(html, /class="scale-bar"/);
  assert.match(ui, /setScaleBarEnabled|installScaleBar/);
  assert.match(ui, /meridian\.scaleBar|initScaleBarPreference|installScaleBar\(/);

  const hideBlock = css.slice(
    css.indexOf('body.ui-clean-view #title-bar'),
    css.indexOf('body.ui-clean-view #scene-runtime.active'),
  );
  assert.doesNotMatch(hideBlock, /#scale-bar/);
  assert.doesNotMatch(hideBlock, /#cesium-credits/);

  assert.match(
    css,
    /body\.ui-clean-view #cesium-credits[\s\S]*?visibility:\s*visible\s*!important/,
    'credits must stay on in clean view',
  );
  assert.match(
    css,
    /body\.ui-clean-view #scale-bar[\s\S]*?visibility:\s*visible\s*!important/,
    'the scale bar must stay visible next to credits in clean view',
  );
});

test('session toggle does not leak into an injected store default', () => {
  assert.equal(isScaleBarEnabled(), true);
  assert.equal(setScaleBarEnabled(false, { persist: false }), false);
  assert.equal(isScaleBarEnabled(), false);
  const storage = memoryStorage();
  assert.equal(initScaleBarPreference({ storage }), true);
});
