import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAN_VIEW_FRACTION_S, setCameraKeepAbove } from './cameraVerbs.js';
import {
  KEYBOARD_PAN_SHORTCUTS,
  applyKeyboardPan,
  handleKeyboardPanKeyDown,
  isClaimedNonPanKey,
  isTypingTarget,
  keyboardPanDistanceM,
  panDirectionFromKey,
} from './keyboardPan.js';
import { listShortcutOverlayText, shortcutOverlayLists } from './shortcutsOverlay.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function keyEvent(key, extras = {}) {
  return {
    key,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    prevented: false,
    preventDefault() { this.prevented = true; },
    ...extras,
  };
}

function typingTarget(id = 'data-layer-filter') {
  return {
    id,
    tagName: 'INPUT',
    closest(selector) {
      return String(selector).includes('input') ? this : null;
    },
  };
}

function fakeCamera({ lon = -97.7431, lat = 30.2672, height = 800 } = {}) {
  return {
    positionCartographic: { longitude: lon, latitude: lat, height },
    moves: [],
    moveLeft(distance) {
      this.moves.push(['left', distance]);
      this.positionCartographic.longitude -= distance;
    },
    moveRight(distance) {
      this.moves.push(['right', distance]);
      this.positionCartographic.longitude += distance;
    },
    moveUp(distance) {
      this.moves.push(['up', distance]);
      this.positionCartographic.latitude += distance;
    },
    moveDown(distance) {
      this.moves.push(['down', distance]);
      this.positionCartographic.latitude -= distance;
    },
  };
}

test('W and arrows translate the camera over the globe', () => {
  const camera = fakeCamera();
  const startLat = camera.positionCartographic.latitude;
  const startLon = camera.positionCartographic.longitude;

  assert.deepEqual(applyKeyboardPan(keyEvent('w'), camera), {
    direction: 'up',
    distanceM: keyboardPanDistanceM(camera),
  });
  assert.equal(camera.moves[0][0], 'up');
  assert.ok(camera.positionCartographic.latitude > startLat);

  assert.equal(applyKeyboardPan(keyEvent('ArrowRight'), camera).direction, 'right');
  assert.equal(camera.moves[1][0], 'right');
  assert.ok(camera.positionCartographic.longitude > startLon);

  assert.equal(applyKeyboardPan(keyEvent('ArrowDown'), camera).direction, 'down');
  assert.equal(applyKeyboardPan(keyEvent('a'), camera).direction, 'left');
  assert.equal(panDirectionFromKey('s'), 'down');
  assert.equal(panDirectionFromKey('d'), 'right');
  assert.equal(panDirectionFromKey('ArrowUp'), 'up');
});

test('Shift uses the existing fast pan rate', () => {
  const camera = fakeCamera({ height: 1000 });
  const normal = keyboardPanDistanceM(camera, { shiftKey: false });
  const fast = keyboardPanDistanceM(camera, { shiftKey: true });
  assert.equal(normal, 1000 * PAN_VIEW_FRACTION_S.normal * (1 / 60));
  assert.equal(fast, 1000 * PAN_VIEW_FRACTION_S.fast * (1 / 60));
  assert.ok(fast > normal);

  applyKeyboardPan(keyEvent('w', { shiftKey: true }), camera);
  assert.equal(camera.moves[0][1], fast);
});

test('input focus does not pan (layer filter and radio search)', () => {
  const camera = fakeCamera();
  const filter = typingTarget('data-layer-filter');
  const radio = typingTarget('radio-station-search');
  assert.equal(isTypingTarget(filter), true);
  assert.equal(isTypingTarget(radio), true);

  assert.equal(applyKeyboardPan(keyEvent('w', { target: filter }), camera), null);
  assert.equal(applyKeyboardPan(keyEvent('ArrowUp', { target: radio }), camera), null);
  assert.deepEqual(camera.moves, []);

  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /id="data-layer-filter"/);
  assert.match(html, /id="radio-station-search"/);
  assert.match(ui, /handleKeyboardPanKeyDown\(e, this\.viewer\)/);
});

test('does not steal already-claimed ?, F, or H', () => {
  const camera = fakeCamera();
  assert.equal(isClaimedNonPanKey('?'), true);
  assert.equal(isClaimedNonPanKey('f'), true);
  assert.equal(isClaimedNonPanKey('H'), true);
  assert.equal(panDirectionFromKey('?'), null);
  assert.equal(panDirectionFromKey('f'), null);
  assert.equal(panDirectionFromKey('h'), null);
  assert.equal(applyKeyboardPan(keyEvent('?'), camera), null);
  assert.equal(applyKeyboardPan(keyEvent('f'), camera), null);
  assert.equal(applyKeyboardPan(keyEvent('h'), camera), null);
  assert.deepEqual(camera.moves, []);

  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const panCall = ui.indexOf('handleKeyboardPanKeyDown(e, this.viewer)');
  const hudHotkey = ui.indexOf("e.key.toLowerCase() === 'h'");
  const dataHotkey = ui.indexOf("e.key.toLowerCase() === 'f'");
  assert.ok(panCall > 0 && hudHotkey > panCall && dataHotkey > panCall);
});

test('keep-above still lifts if they drive into terrain', () => {
  const camera = fakeCamera({ height: 80 });
  const terrainM = 2000;
  const clearanceM = 20;
  setCameraKeepAbove((cam) => {
    const floor = terrainM + clearanceM;
    if (cam.positionCartographic.height < floor) {
      cam.positionCartographic.height = floor;
    }
  });
  try {
    const moved = applyKeyboardPan(keyEvent('w'), camera);
    assert.ok(moved);
    assert.equal(camera.moves[0][0], 'up');
    assert.equal(camera.positionCartographic.height, terrainM + clearanceM);
  } finally {
    setCameraKeepAbove(null);
  }
});

test('overlay lists the new keys after this ships', () => {
  const text = listShortcutOverlayText();
  assert.match(text, /W A S D — Pan camera/);
  assert.match(text, /Arrow keys — Pan camera/);
  assert.match(text, /Shift \+ WASD \/ arrows — Pan faster/);
  assert.equal(shortcutOverlayLists('W A S D'), true);
  assert.equal(shortcutOverlayLists('Arrow keys'), true);
  assert.ok(KEYBOARD_PAN_SHORTCUTS.some((row) => row.keys.includes('W A S D')));

  const overlay = readFileSync(path.join(ROOT, 'src/shortcutsOverlay.js'), 'utf8');
  assert.match(overlay, /KEYBOARD_PAN_SHORTCUTS/);
  assert.match(overlay, /keys: '\?'/);
  assert.match(overlay, /keys: 'H'/);
  assert.match(overlay, /keys: 'F'/);
});

test('cockpit and tracking do not steal the globe pan keys', () => {
  const camera = fakeCamera();
  const viewer = { camera, trackedEntity: { id: 'flight-1' } };
  assert.equal(handleKeyboardPanKeyDown(keyEvent('w'), viewer), false);
  assert.deepEqual(camera.moves, []);

  const priorBody = globalThis.document;
  globalThis.document = {
    body: { classList: { contains: (name) => name === 'cockpit-mode' } },
  };
  try {
    assert.equal(handleKeyboardPanKeyDown(keyEvent('w'), { camera }), false);
    assert.deepEqual(camera.moves, []);
  } finally {
    if (priorBody === undefined) delete globalThis.document;
    else globalThis.document = priorBody;
  }
});

test('keyboard pan adds no /api route and stays on input only', () => {
  const apiDir = path.join(ROOT, 'api');
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else files.push(path.relative(apiDir, absolute).split(path.sep).join('/'));
    }
  };
  visit(apiDir);
  assert.ok(!files.some((file) => /keyboard|wasd|pan/i.test(file)));

  const helper = readFileSync(path.join(ROOT, 'src/keyboardPan.js'), 'utf8');
  assert.doesNotMatch(helper, /\/api\//);
  assert.match(helper, /translateCamera/);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/keyboardPan.js'), 'utf8');
  const overlay = readFileSync(path.join(ROOT, 'src/shortcutsOverlay.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth/i);
  assert.doesNotMatch(overlay, /opensky|news\.google|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
  assert.equal(existsSync(path.join(ROOT, 'quantum-earth')), false);
});
