import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Cesium from 'cesium';
import {
  LOOK_PITCH_MAX_RAD,
  LOOK_PITCH_MIN_RAD,
  LOOK_SHORTCUT_OVERLAY_ENTRIES,
  LOOK_STEP_RAD,
  LOCK_TILT_STORAGE_KEY,
  applyCameraLook,
  clampLookPitch,
  handleLookKeyDown,
  isLookKeyIgnoredTarget,
  isTiltLocked,
  isViewerTiltLocked,
  resolveLookAction,
  resolveLookTarget,
} from './cameraLookKeys.js';
import {
  KEYBOARD_SHORTCUT_ENTRIES,
  bindKeyboardShortcutsToggle,
  handleShortcutsOverlayKeyDown,
  isShortcutsOverlayToggle,
  renderKeyboardShortcutsOverlay,
  setKeyboardShortcutsOverlayOpen,
} from './keyboardShortcutsOverlay.js';
import { applyKeyboardPan } from './keyboardPan.js';
import { shortcutOverlayLists } from './shortcutsOverlay.js';

const ui = fs.readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const license = fs.readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
const lookKeys = fs.readFileSync(new URL('./cameraLookKeys.js', import.meta.url), 'utf8');

const AUSTIN = { lon: -97.7431, lat: 30.2672 };

function keyEvent(key, extras = {}) {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    target: extras.target || { matches: () => false, closest: () => null },
    ...extras,
  };
}

function stubCamera({
  heading = Cesium.Math.toRadians(40),
  pitch = Cesium.Math.toRadians(-32),
  height = 1200,
  lon = AUSTIN.lon,
  lat = AUSTIN.lat,
} = {}) {
  const positionWC = Cesium.Cartesian3.fromDegrees(lon, lat, height);
  const lookAtCalls = [];
  const setViewCalls = [];
  return {
    heading,
    pitch,
    roll: 0,
    positionWC,
    positionCartographic: Cesium.Cartographic.fromCartesian(positionWC),
    lookAtCalls,
    setViewCalls,
    lookAt(target, hpr) {
      lookAtCalls.push({ target, hpr });
      this.heading = hpr.heading;
      this.pitch = hpr.pitch;
    },
    lookAtTransform() {},
    setView(options) {
      setViewCalls.push(options);
      if (Number.isFinite(options?.orientation?.heading)) this.heading = options.orientation.heading;
      if (Number.isFinite(options?.orientation?.pitch)) this.pitch = options.orientation.pitch;
    },
  };
}

function stubViewer(camera, extras = {}) {
  return {
    camera,
    trackedEntity: extras.trackedEntity || null,
    scene: {
      canvas: extras.canvas || { clientWidth: 800, clientHeight: 600 },
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
      screenSpaceCameraController: {
        enableTilt: extras.enableTilt !== false,
      },
      requestRender() { extras.renders = (extras.renders || 0) + 1; },
    },
  };
}

function applyPanIfWasd(event, pose) {
  const pans = { w: 'forward', a: 'left', s: 'back', d: 'right' };
  const key = String(event.key || '').toLowerCase();
  if (pans[key]) pose.pan = pans[key];
}

test('Q/E change heading and WASD still pans', () => {
  const camera = stubCamera({ heading: Cesium.Math.toRadians(90) });
  const viewer = stubViewer(camera);
  const pose = { pan: null };

  const q = handleLookKeyDown(keyEvent('q'), viewer);
  assert.equal(q.kind, 'heading');
  assert.equal(q.direction, 'left');
  assert.ok(camera.heading < Cesium.Math.toRadians(90));
  applyPanIfWasd(keyEvent('q'), pose);
  assert.equal(pose.pan, null, 'Q is yaw, not pan');

  const headingAfterQ = camera.heading;
  const e = handleLookKeyDown(keyEvent('e'), viewer);
  assert.equal(e.kind, 'heading');
  assert.equal(e.direction, 'right');
  assert.ok(camera.heading > headingAfterQ);

  for (const [key, expected] of [['w', 'forward'], ['a', 'left'], ['s', 'back'], ['d', 'right']]) {
    const before = camera.heading;
    const result = handleLookKeyDown(keyEvent(key), viewer);
    assert.equal(result, null, `${key} must not be a look key`);
    assert.equal(camera.heading, before);
    pose.pan = null;
    applyPanIfWasd(keyEvent(key), pose);
    assert.equal(pose.pan, expected);
  }

  const panCamera = {
    positionCartographic: { height: 800 },
    moves: [],
    moveUp(distance) { this.moves.push(['up', distance]); },
    moveDown(distance) { this.moves.push(['down', distance]); },
    moveLeft(distance) { this.moves.push(['left', distance]); },
    moveRight(distance) { this.moves.push(['right', distance]); },
  };
  assert.equal(applyKeyboardPan(keyEvent('q'), panCamera), null);
  assert.equal(applyKeyboardPan(keyEvent('e'), panCamera), null);
  assert.equal(applyKeyboardPan(keyEvent('r'), panCamera), null);
  assert.ok(applyKeyboardPan(keyEvent('w'), panCamera));
  assert.equal(panCamera.moves[0][0], 'up');
});

test('lock tilt on: pitch keys no-op', () => {
  const camera = stubCamera({ pitch: Cesium.Math.toRadians(-40) });
  const headingBefore = camera.heading;
  const pitchBefore = camera.pitch;
  const viewer = stubViewer(camera);

  for (const key of ['r', 'PageUp', 'PageDown']) {
    const blocked = handleLookKeyDown(keyEvent(key), viewer, { tiltLocked: true });
    assert.equal(blocked.kind, 'blocked', `${key} must report blocked`);
    assert.equal(camera.pitch, pitchBefore, `${key} must not change pitch`);
  }

  const enableTiltViewer = stubViewer(camera, { enableTilt: false });
  assert.equal(handleLookKeyDown(keyEvent('r'), enableTiltViewer).kind, 'blocked');
  assert.equal(camera.pitch, pitchBefore);

  const storage = { getItem: (k) => (k === LOCK_TILT_STORAGE_KEY ? '1' : null) };
  assert.equal(isTiltLocked({ storage }), true);
  assert.equal(handleLookKeyDown(keyEvent('PageUp'), stubViewer(camera), { storage }).kind, 'blocked');
  assert.equal(camera.pitch, pitchBefore);

  const yaw = handleLookKeyDown(keyEvent('q'), viewer, { tiltLocked: true });
  assert.equal(yaw.kind, 'heading');
  assert.ok(camera.heading !== headingBefore, 'lock tilt must not block Q/E');
});

test('F still opens the data panel and does not pitch', () => {
  const camera = stubCamera({ pitch: Cesium.Math.toRadians(-28) });
  const pitchBefore = camera.pitch;
  const result = handleLookKeyDown(keyEvent('f'), stubViewer(camera));
  assert.equal(result, null);
  assert.equal(camera.pitch, pitchBefore);
  assert.equal(resolveLookAction(keyEvent('f')), null);
  assert.match(ui, /e\.key\.toLowerCase\(\) === 'f'/);
  assert.match(ui, /getElementById\('data-panel'\)\.classList\.toggle\('active'\)/);
  assert.match(ui, /f = data-panel — fullscreen uses the button/);
  assert.doesNotMatch(lookKeys, /['"]f['"]|KeyF/);
  assert.ok(!LOOK_SHORTCUT_OVERLAY_ENTRIES.some((row) => /\bF\b/.test(row.keys)));
});

test('look keys ignore typing in inputs', () => {
  const camera = stubCamera();
  const headingBefore = camera.heading;
  const pitchBefore = camera.pitch;
  const input = {
    matches: (sel) => String(sel).includes('input'),
    closest: () => input,
    isContentEditable: false,
  };
  assert.equal(isLookKeyIgnoredTarget(input), true);
  assert.equal(resolveLookAction(keyEvent('q', { target: input })), null);
  assert.equal(handleLookKeyDown(keyEvent('r', { target: input }), stubViewer(camera)), null);
  assert.equal(camera.heading, headingBefore);
  assert.equal(camera.pitch, pitchBefore);
});

test('C is not a pitch key; cockpit and ? stay claimed elsewhere', () => {
  assert.equal(resolveLookAction(keyEvent('c')), null);
  assert.equal(resolveLookAction(keyEvent('h')), null);
  assert.equal(resolveLookAction(keyEvent('?')), null);
  assert.match(ui, /if \(key === 'c' && !event\.metaKey && !event\.ctrlKey && !event\.altKey\)/);
  assert.match(html, /aria-keyshortcuts="Escape C"/);
  assert.equal(isShortcutsOverlayToggle(keyEvent('?')), true);
});

test('R / PageUp / PageDown pitch; clamps stay in the map band', () => {
  const camera = stubCamera({ pitch: Cesium.Math.toRadians(-40) });
  const viewer = stubViewer(camera);
  const up = handleLookKeyDown(keyEvent('r'), viewer);
  assert.equal(up.kind, 'pitch');
  assert.equal(up.direction, 'up');
  assert.ok(camera.pitch > Cesium.Math.toRadians(-40));

  const pageUp = resolveLookAction(keyEvent('PageUp'));
  assert.equal(pageUp.kind, 'pitch');
  assert.equal(pageUp.direction, 'up');

  const down = handleLookKeyDown(keyEvent('PageDown'), viewer);
  assert.equal(down.kind, 'pitch');
  assert.equal(down.direction, 'down');

  assert.equal(clampLookPitch(0), LOOK_PITCH_MAX_RAD);
  assert.equal(clampLookPitch(-Math.PI), LOOK_PITCH_MIN_RAD);
  const ceiling = stubCamera({ pitch: LOOK_PITCH_MAX_RAD });
  applyCameraLook(ceiling, { kind: 'pitch', deltaRad: LOOK_STEP_RAD });
  assert.equal(ceiling.pitch, LOOK_PITCH_MAX_RAD);
});

test('look-at Q/E keeps the ground target and range while changing heading', () => {
  const camera = stubCamera({ heading: Cesium.Math.toRadians(80), pitch: Cesium.Math.toRadians(-30) });
  const target = Cesium.Cartesian3.fromDegrees(AUSTIN.lon, AUSTIN.lat, 0);
  const rangeBefore = Cesium.Cartesian3.distance(camera.positionWC, target);
  const applied = applyCameraLook(camera, { kind: 'heading', deltaRad: -LOOK_STEP_RAD }, target);
  assert.equal(applied.mode, 'lookAt');
  assert.equal(applied.range, rangeBefore);
  assert.equal(camera.lookAtCalls.length, 1);
  assert.equal(camera.lookAtCalls[0].target, target);
  assert.equal(camera.pitch, Cesium.Math.toRadians(-30));
  assert.ok(Math.abs(camera.heading - (Cesium.Math.toRadians(80) - LOOK_STEP_RAD)) < 1e-9);
});

test('shortcuts overlay lists Q/E and the actual pitch keys', () => {
  const keys = KEYBOARD_SHORTCUT_ENTRIES.map((row) => row.keys).join('\n');
  assert.match(keys, /Q \/ E/);
  assert.match(keys, /R \/ Page Up/);
  assert.match(keys, /Page Down/);
  assert.match(keys, /\bF\b/);
  assert.match(keys, /\bH\b/);
  assert.match(keys, /\bC\b/);
  assert.match(keys, /\bN\b/);
  assert.match(keys, /\?/);
  assert.ok(KEYBOARD_SHORTCUT_ENTRIES.some((row) => String(row.label || row.action).includes('Yaw heading')));
  assert.ok(KEYBOARD_SHORTCUT_ENTRIES.some((row) => String(row.label || row.action).includes('Pitch up')));
  assert.ok(KEYBOARD_SHORTCUT_ENTRIES.some((row) => row.keys === 'F' && /data/i.test(row.label || row.action)));
  assert.match(html, /id="keyboard-shortcuts-overlay"/);
  assert.match(html, /id="keyboard-shortcuts-list"/);
  assert.match(html, /Pitch is R \/ Page Up \/ Page Down/);
  assert.match(ui, /tiltLocked: this\._lockTiltEnabled === true/);
  assert.match(ui, /bindKeyboardShortcutsToggle/);
  assert.equal(shortcutOverlayLists('Q / E'), true);
  assert.equal(shortcutOverlayLists('R / Page Up'), true);
  assert.equal(shortcutOverlayLists('Page Down'), true);
  assert.match(ui, /handleLookKeyDown/);
  assert.match(ui, /handleShortcutsOverlayKeyDown/);
  assert.match(ui, /handleKeyboardPanKeyDown/);
  assert.doesNotMatch(ui, /\/api\/.*look|\/api\/.*heading-key/);
});

test('shortcuts chrome button toggles the overlay', () => {
  const overlay = { hidden: true, setAttribute() {} };
  const button = {
    listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    removeEventListener(type) { delete this.listeners[type]; },
    setAttribute() {},
  };
  const list = { replaceChildren() {}, append() {} };
  const doc = {
    getElementById(id) {
      if (id === 'keyboard-shortcuts-toggle') return button;
      if (id === 'keyboard-shortcuts-overlay') return overlay;
      if (id === 'keyboard-shortcuts-list') return list;
      return null;
    },
    createElement() {
      const node = { className: '', textContent: '', children: [], append() {} };
      return node;
    },
  };
  const unbind = bindKeyboardShortcutsToggle(doc);
  button.listeners.click({ preventDefault() {} });
  assert.equal(overlay.hidden, false);
  button.listeners.click({ preventDefault() {} });
  assert.equal(overlay.hidden, true);
  unbind();
  assert.equal(button.listeners.click, undefined);
  setKeyboardShortcutsOverlayOpen(true, doc);
  assert.equal(overlay.hidden, false);
});

test('shortcuts overlay renderer writes every catalog row', () => {
  const rows = [];
  const list = {
    replaceChildren() { rows.length = 0; },
    append(row) { rows.push(row); },
  };
  const overlay = { hidden: true, setAttribute() {} };
  const doc = {
    getElementById(id) {
      if (id === 'keyboard-shortcuts-list') return list;
      if (id === 'keyboard-shortcuts-overlay') return overlay;
      return null;
    },
    createElement() {
      const node = { className: '', textContent: '', children: [] };
      node.append = (...kids) => { node.children.push(...kids); };
      return node;
    },
  };
  assert.equal(renderKeyboardShortcutsOverlay(doc), KEYBOARD_SHORTCUT_ENTRIES.length);
  assert.equal(rows.length, KEYBOARD_SHORTCUT_ENTRIES.length);
  const text = rows.map((row) => row.children.map((c) => c.textContent).join(' ')).join('\n');
  assert.match(text, /Q \/ E/);
  assert.match(text, /R \/ Page Up/);
  assert.match(text, /Page Down/);
  assert.equal(handleShortcutsOverlayKeyDown(keyEvent('?'), doc), true);
  assert.equal(overlay.hidden, false);
});

test('viewer tilt-lock helper reads enableTilt and storage', () => {
  const viewer = stubViewer(stubCamera(), { enableTilt: false });
  assert.equal(isViewerTiltLocked(viewer), true);
  assert.equal(isViewerTiltLocked(stubViewer(stubCamera()), { storage: { getItem: () => '0' } }), false);
});

test('resolveLookTarget rejects empty canvases and non-Earth picks', () => {
  assert.equal(resolveLookTarget(null), null);
  assert.equal(resolveLookTarget({ camera: {}, scene: { canvas: { clientWidth: 0, clientHeight: 0 } } }), null);
  const earth = Cesium.Cartesian3.fromDegrees(AUSTIN.lon, AUSTIN.lat, 0);
  const hit = {
    camera: { pickEllipsoid() { return earth; } },
    scene: { canvas: { clientWidth: 800, clientHeight: 600 } },
  };
  assert.equal(resolveLookTarget(hit), earth);
});

test('look keys stay input-only and keep the MIT credit', () => {
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(lookKeys, /OpenSky|Google News|TeleGeography|quantum-earth/i);
});
