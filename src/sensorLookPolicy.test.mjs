// Sensor Look cycle — hosted users can find CRT/NVG/FLIR/Noir/Snow
// without voice. Existing looks only; same style ids the share URL and
// voice setter already use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ShareLinkManager, decodeShareViewUrl } from './sharelink.js';
import { readLastView } from './lastView.js';
import { createGevActionRunner } from './voice/gevActions.js';
import {
  SENSOR_LOOK_CYCLE,
  nextSensorLook,
  sensorLookLabel,
  cycleSensorLook,
} from './sensorLookPolicy.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

function makeShareManager(hash = '', { storage } = {}) {
  globalThis.window = {
    location: { hash, href: `http://localhost/${hash}` },
    localStorage: storage || memoryStorage(),
  };
  globalThis.history = {
    replaceState(_state, _title, nextHash) {
      window.location.hash = nextHash;
    },
  };
  const viewer = {
    camera: {
      changed: { addEventListener() {} },
      moveEnd: { addEventListener() { return () => {}; } },
      positionCartographic: { latitude: 0.528, longitude: -1.706, height: 800 },
      heading: 0.2,
      pitch: -0.6,
      roll: 0,
    },
  };
  return new ShareLinkManager(viewer, { storage: storage || window.localStorage, lastViewThrottleMs: 0 });
}

function fakeStyleManager(initial = 'normal') {
  return {
    activeStyle: initial,
    setStyle(styleName) {
      this.activeStyle = styleName;
    },
  };
}

test('Look cycle visits each existing sensor look and returns to default', () => {
  assert.deepEqual(SENSOR_LOOK_CYCLE, [
    'retro',
    'surveillance',
    'thermal',
    'noir',
    'snow',
    'normal',
  ]);
  assert.ok(!SENSOR_LOOK_CYCLE.includes('anime'), 'do not add new looks or include Anime');

  const seen = [];
  let style = 'normal';
  for (let i = 0; i < SENSOR_LOOK_CYCLE.length; i += 1) {
    style = nextSensorLook(style);
    seen.push(style);
  }
  assert.deepEqual(seen, ['retro', 'surveillance', 'thermal', 'noir', 'snow', 'normal']);
  assert.equal(nextSensorLook('anime'), 'retro');
  assert.equal(sensorLookLabel('retro'), 'CRT');
  assert.equal(sensorLookLabel('surveillance'), 'NVG');
  assert.equal(sensorLookLabel('thermal'), 'FLIR');
  assert.equal(sensorLookLabel('noir'), 'NOIR');
  assert.equal(sensorLookLabel('snow'), 'SNOW');
  assert.equal(sensorLookLabel('normal'), 'NORMAL');
});

test('Look cycle uses setStyle, the same setter the share URL serializes', () => {
  const manager = fakeStyleManager('normal');
  const applied = [];
  manager.setStyle = function setStyle(styleName) {
    applied.push(styleName);
    this.activeStyle = styleName;
  };
  assert.equal(cycleSensorLook(manager), 'retro');
  assert.deepEqual(applied, ['retro']);
  assert.equal(cycleSensorLook(manager), 'surveillance');
  assert.deepEqual(applied, ['retro', 'surveillance']);
});

test('share URL after NVG still opens NVG', () => {
  const storage = memoryStorage();
  const manager = makeShareManager('', { storage });
  const look = fakeStyleManager('normal');
  look.setStyle = function setStyle(styleName) {
    this.activeStyle = styleName;
    manager.onStyleChange(styleName);
  };
  cycleSensorLook(look); // CRT
  cycleSensorLook(look); // NVG
  assert.equal(look.activeStyle, 'surveillance');

  clearTimeout(manager._debounceTimer);
  manager._updateHash();
  manager._persistLastView();

  const liveHash = window.location.hash;
  assert.match(liveHash, /(?:^|[?#&])style=nvg(?:&|$)/);

  const restored = makeShareManager(liveHash).parseInitialHash();
  assert.equal(restored.style, 'surveillance');

  const lastViewHash = decodeShareViewUrl(readLastView(storage));
  assert.match(lastViewHash, /(?:^|&)style=nvg(?:&|$)/);
  assert.equal(makeShareManager(`#${lastViewHash}`).parseInitialHash().style, 'surveillance');
});

test('voice style commands stay in sync with the Look cycle ids', async () => {
  globalThis.window = globalThis.window || { clearTimeout, setTimeout, requestIdleCallback: null };
  const viewer = {
    clock: { onTick: { addEventListener: () => () => {} } },
    scene: { canvas: { addEventListener() {}, removeEventListener() {} } },
    camera: { moveEnd: { addEventListener() {} } },
  };
  const applied = [];
  const styleManager = {
    activeStyle: 'normal',
    setStyle(styleName) {
      applied.push(styleName);
      this.activeStyle = styleName;
    },
  };
  const runner = createGevActionRunner({
    viewer,
    styleManager,
    dataManager: { layers: new Map(), getAll: () => [] },
  });

  const voice = await runner('set_visual_style', { style: 'nvg' });
  assert.equal(voice.ok, true);
  assert.equal(voice.style, 'surveillance');
  assert.equal(styleManager.activeStyle, 'surveillance');

  const look = fakeStyleManager('retro');
  look.setStyle = function setStyle(styleName) {
    this.activeStyle = styleName;
  };
  assert.equal(cycleSensorLook(look), 'surveillance');
  assert.equal(look.activeStyle, voice.style);

  const flir = await runner('set_visual_style', { style: 'flir' });
  assert.equal(flir.style, 'thermal');
  assert.equal(nextSensorLook('surveillance'), flir.style);

  const def = await runner('set_visual_style', { style: 'default' });
  assert.equal(def.style, 'normal');
  assert.equal(nextSensorLook('snow'), def.style);
});

test('Look control is a discoverable cycle, not HUD layout, density, or reduce-motion', () => {
  assert.match(html, /id="look-cycle-btn"/);
  assert.match(html, /Look/);
  assert.doesNotMatch(
    html.match(/id="look-cycle-btn"[\s\S]{0,240}/)[0],
    /hud-layout|detection-density|reduce-motion|prefers-reduced-motion/,
  );
  assert.match(ui, /cycleSensorLook\(this\)|cycleLook\(/);
  assert.match(ui, /nextSensorLook|cycleSensorLook/);
  assert.match(css, /#command-dock #look-cycle-btn|#command-dock \.look-cycle-btn/);
});
