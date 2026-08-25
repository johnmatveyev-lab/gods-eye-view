import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  GRID_PREF_DEFAULT,
  GRID_STORAGE_KEY,
  MAX_GRID_LINES,
  attachGridOverlay,
  buildGridPolylines,
  describeGridLines,
  gridStepDegrees,
  normalizeGridPreference,
  peekGridPreference,
  readCameraGridView,
  readGridPreference,
  resolveGridStep,
  writeGridPreference,
} from './gridOverlay.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (name) => readFileSync(path.join(ROOT, 'src', name), 'utf8');
const root = (name) => readFileSync(path.join(ROOT, name), 'utf8');

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

function makeHost({
  heightM = 20_000_000,
  westDeg = -180,
  southDeg = -90,
  eastDeg = 180,
  northDeg = 90,
} = {}) {
  const state = {
    visible: false,
    lines: [],
    renders: 0,
    cameraListeners: 0,
    heightM,
    westDeg,
    southDeg,
    eastDeg,
    northDeg,
  };
  let cameraFn = null;
  const host = {
    getView() {
      return {
        heightM: state.heightM,
        westDeg: state.westDeg,
        southDeg: state.southDeg,
        eastDeg: state.eastDeg,
        northDeg: state.northDeg,
      };
    },
    setLines(lines) {
      state.lines = Array.isArray(lines) ? lines : [];
    },
    setVisible(visible) {
      state.visible = visible === true;
    },
    requestRender() {
      state.renders += 1;
    },
    onCameraChanged(fn) {
      cameraFn = fn;
      state.cameraListeners += 1;
      return () => {
        if (cameraFn === fn) cameraFn = null;
        state.cameraListeners = Math.max(0, state.cameraListeners - 1);
      };
    },
  };
  return {
    host,
    state,
    moveCamera(next) {
      Object.assign(state, next);
      cameraFn?.();
    },
  };
}

test('meridian.grid defaults off and persists exactly on or off', () => {
  assert.equal(GRID_STORAGE_KEY, 'meridian.grid');
  assert.equal(GRID_PREF_DEFAULT, 'off');
  assert.equal(readGridPreference(memoryStorage()), 'off');
  assert.equal(peekGridPreference(memoryStorage()), null);
  assert.equal(normalizeGridPreference(undefined), 'off');

  const storage = memoryStorage();
  assert.equal(writeGridPreference(storage, 'on'), 'on');
  assert.equal(storage.dump()[GRID_STORAGE_KEY], 'on');
  assert.equal(readGridPreference(storage), 'on');
  assert.equal(peekGridPreference(storage), 'on');

  assert.equal(writeGridPreference(storage, 'off'), 'off');
  assert.equal(storage.dump()[GRID_STORAGE_KEY], 'off');
  assert.equal(readGridPreference(storage), 'off');
});

test('unknown meridian.grid values fail closed to off', () => {
  assert.equal(normalizeGridPreference('maybe'), 'off');
  assert.equal(normalizeGridPreference(''), 'off');
  assert.equal(readGridPreference(memoryStorage({ [GRID_STORAGE_KEY]: 'all' })), 'off');
  assert.equal(peekGridPreference(memoryStorage({ [GRID_STORAGE_KEY]: 'all' })), null);
});

test('a locked store still returns the chosen value without throwing', () => {
  const locked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.equal(readGridPreference(locked), 'off');
  assert.equal(peekGridPreference(locked), null);
  assert.equal(writeGridPreference(locked, 'on'), 'on');
});

test('zoom-out coarsens the lat/lon step so the planet is not flooded', () => {
  const planet = gridStepDegrees(20_000_000);
  const regional = gridStepDegrees(1_200_000);
  const metro = gridStepDegrees(80_000);
  assert.equal(planet, 30);
  assert.ok(regional <= 10 && regional >= 5, `regional step should stay coarse, got ${regional}`);
  assert.ok(metro <= 2 && metro >= 1, `metro step should stay readable, got ${metro}`);
  assert.ok(planet > regional, 'zooming out must thin the grid');
  assert.ok(regional >= metro, 'zooming in may refine but stays coarse');

  const globe = describeGridLines({
    westDeg: -180,
    southDeg: -90,
    eastDeg: 180,
    northDeg: 90,
    stepDeg: resolveGridStep(20_000_000, {
      westDeg: -180, southDeg: -90, eastDeg: 180, northDeg: 90,
    }),
  });
  assert.ok(globe.lineCount > 0, 'planet view still has a usable grid');
  assert.ok(globe.lineCount <= MAX_GRID_LINES, `planet view flooded: ${globe.lineCount} lines`);
  assert.ok(globe.stepDeg >= 15, 'planet-scale step must stay coarse');
});

test('zoomed-in view keeps a readable step without drawing the whole globe', () => {
  const view = {
    westDeg: -75,
    southDeg: 39,
    eastDeg: -73,
    northDeg: 41,
  };
  const step = resolveGridStep(8_000, view);
  const desc = describeGridLines({ ...view, stepDeg: step });
  assert.ok(step <= 2, 'close-in step should be finer than the planet step');
  assert.ok(desc.lineCount > 0);
  assert.ok(desc.lineCount <= 20, `close-in viewport should not draw a globe of lines: ${desc.lineCount}`);
  assert.ok(desc.meridians.every((lon) => lon >= -75 && lon <= -73));
  assert.ok(desc.parallels.every((lat) => lat >= 39 && lat <= 41));

  const polylines = buildGridPolylines(desc);
  assert.equal(polylines.length, desc.lineCount);
  assert.ok(polylines.every((line) => line.positions.length >= 2));
});

test('Grid on draws lines; Grid off removes them', () => {
  const { host, state } = makeHost();
  const overlay = attachGridOverlay(host, { storage: memoryStorage() });
  assert.equal(overlay.isEnabled(), false);
  assert.equal(state.visible, false);
  assert.equal(state.lines.length, 0);

  overlay.setEnabled(true);
  assert.equal(overlay.isEnabled(), true);
  assert.equal(state.visible, true);
  assert.ok(state.lines.length > 0, 'enabled grid must draw lat/lon lines');
  assert.ok(state.renders >= 1);

  overlay.setEnabled(false);
  assert.equal(overlay.isEnabled(), false);
  assert.equal(state.visible, false);
  assert.equal(state.lines.length, 0);
  overlay.destroy();
});

test('camera zoom rebuilds a readable step and off stays gone', () => {
  const { host, state, moveCamera } = makeHost({ heightM: 20_000_000 });
  const overlay = attachGridOverlay(host, { storage: memoryStorage() });
  overlay.setEnabled(true);
  const planetCount = state.lines.length;
  assert.ok(planetCount > 0 && planetCount <= MAX_GRID_LINES);

  moveCamera({
    heightM: 12_000,
    westDeg: -0.8,
    southDeg: 51.3,
    eastDeg: 0.2,
    northDeg: 51.7,
  });
  const closeCount = state.lines.length;
  assert.ok(closeCount > 0);
  assert.ok(closeCount < planetCount, 'zooming in must drop the planet-scale line set');
  assert.ok(closeCount <= 20, `close-in flood: ${closeCount}`);

  overlay.setEnabled(false);
  moveCamera({ heightM: 20_000_000, westDeg: -180, southDeg: -90, eastDeg: 180, northDeg: 90 });
  assert.equal(state.visible, false);
  assert.equal(state.lines.length, 0);
  overlay.destroy();
  assert.equal(state.cameraListeners, 0);
});

test('readCameraGridView uses cartographic height and the view rectangle', () => {
  const camera = {
    positionCartographic: { height: 2_400_000 },
    computeViewRectangle() {
      return { west: -1.2, south: 0.4, east: -0.4, north: 0.9 };
    },
  };
  const view = readCameraGridView(camera, { toDegrees: (rad) => rad * 180 / Math.PI });
  assert.equal(view.heightM, 2_400_000);
  assert.ok(view.westDeg < view.eastDeg);
  assert.ok(view.southDeg < view.northDeg);

  const space = readCameraGridView({
    positionCartographic: { height: 40_000_000 },
    computeViewRectangle() { return undefined; },
  });
  assert.equal(space.westDeg, -180);
  assert.equal(space.eastDeg, 180);
});

test('DISPLAY ships a Grid on/off control wired to meridian.grid', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const display = html.match(/id="pp-toggles"[\s\S]*?id="clean-view-exit"/);
  assert.ok(display, 'Display markup is missing');
  assert.match(display[0], /id="grid-toggle"/);
  assert.match(display[0], /<span class="pp-label">Grid<\/span>/);
  assert.match(display[0], /aria-pressed="false"/);
  assert.match(display[0], /celestial-toggle[\s\S]*grid-toggle[\s\S]*clean-view-toggle/);
  assert.equal((html.match(/id="grid-toggle"/g) || []).length, 1);

  assert.match(ui, /from '\.\/gridOverlay\.js'/);
  assert.match(ui, /getElementById\('grid-toggle'\)/);
  assert.match(ui, /attachGridOverlay\(/);
  assert.match(ui, /createCesiumGridHost\(/);
  assert.match(ui, /_gridOverlay\?\.setEnabled\(/);
});

test('Grid is a local overlay, not a data layer, and invents no /api', () => {
  const overlay = src('gridOverlay.js');
  const ui = src('ui.js');
  const html = root('index.html');
  const layers = src('data/layerState.js');
  const aliases = src('data/layerAliases.js');
  const share = src('sharelink.js');
  const credits = src('data/dataCredits.js');

  assert.doesNotMatch(overlay, /\/api\//);
  assert.doesNotMatch(overlay, /opensky|google news|telegeography|quantum-earth/i);
  assert.doesNotMatch(overlay, /GridImageryProvider/);
  assert.match(overlay, /lat\/lon|graticule|meridian/i);

  assert.doesNotMatch(html, /data-layer-id="grid"/);
  assert.doesNotMatch(layers, /id:\s*'grid'/);
  assert.doesNotMatch(aliases, /\[\s*'grid'/);
  assert.doesNotMatch(share, /meridian\.grid/);
  assert.doesNotMatch(credits, /grid-overlay|graticule/);
  assert.doesNotMatch(ui, /registerLayer\([^)]*grid/i);
});

test('clean view may keep the grid; credits stay pinned', () => {
  const css = root('style.css');
  const ui = src('ui.js');
  const fade = css.slice(
    css.indexOf('body.ui-clean-view #title-bar'),
    css.indexOf('body.ui-clean-view #scene-runtime.active'),
  );
  assert.match(fade, /#pp-toggles/);
  assert.doesNotMatch(fade, /#cesium-credits/);
  assert.doesNotMatch(fade, /grid-overlay|cesium-grid/);
  assert.match(css, /body\.ui-clean-view #cesium-credits[\s\S]{0,80}opacity:\s*1/);
  assert.match(ui, /toggleCleanView\([\s\S]*?pinRequiredCredits\(\)/);
  assert.doesNotMatch(ui, /toggleCleanView\([\s\S]*?gridOverlay[\s\S]*?setEnabled\(false\)/);
});
