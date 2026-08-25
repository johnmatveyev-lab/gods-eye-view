import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

import { flyToHomeView, HOME_VIEW } from './camera.js';
import { applyNorthUp } from './cameraNorthUp.js';
import {
  CAMERA_EVENT,
  LOCK_TILT_DEFAULT,
  LOCK_TILT_STORAGE_KEY,
  applyHeadingOnly,
  applyLockTiltToController,
  applyUserRotateDelta,
  captureControllerEvents,
  holdLockedPitch,
  lockTiltEnabledFromStoredValue,
  readLockTiltPreference,
  writeLockTiltPreference,
} from './lockTilt.js';

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

function stubCamera({
  heading = 0.4,
  pitch = -0.52,
  roll = 0.12,
} = {}) {
  const setViewCalls = [];
  return {
    heading,
    pitch,
    roll,
    setViewCalls,
    setView(options) {
      setViewCalls.push(options);
      if (Number.isFinite(options?.orientation?.heading)) this.heading = options.orientation.heading;
      if (Number.isFinite(options?.orientation?.pitch)) this.pitch = options.orientation.pitch;
      if (Number.isFinite(options?.orientation?.roll)) this.roll = options.orientation.roll;
    },
  };
}

function defaultController() {
  return {
    enableTilt: true,
    enableRotate: true,
    enableZoom: true,
    enableLook: true,
    tiltEventTypes: [
      CAMERA_EVENT.MIDDLE_DRAG,
      CAMERA_EVENT.PINCH,
      { eventType: CAMERA_EVENT.LEFT_DRAG, modifier: 1 },
      { eventType: CAMERA_EVENT.RIGHT_DRAG, modifier: 1 },
    ],
    rotateEventTypes: CAMERA_EVENT.LEFT_DRAG,
    zoomEventTypes: [CAMERA_EVENT.RIGHT_DRAG, CAMERA_EVENT.WHEEL, CAMERA_EVENT.PINCH],
    lookEventTypes: { eventType: CAMERA_EVENT.LEFT_DRAG, modifier: 0 },
  };
}

test('meridian.lockTilt defaults off so the current free camera stays', () => {
  assert.equal(LOCK_TILT_STORAGE_KEY, 'meridian.lockTilt');
  assert.equal(LOCK_TILT_DEFAULT, false);
  assert.equal(lockTiltEnabledFromStoredValue(null), false);
  assert.equal(lockTiltEnabledFromStoredValue(''), false);
  assert.equal(lockTiltEnabledFromStoredValue('garbage'), false);
  assert.equal(lockTiltEnabledFromStoredValue('0'), false);
  assert.equal(lockTiltEnabledFromStoredValue('1'), true);
  assert.equal(lockTiltEnabledFromStoredValue('true'), true);
  assert.equal(readLockTiltPreference(memoryStorage()), false);
  assert.equal(readLockTiltPreference(memoryStorage({ [LOCK_TILT_STORAGE_KEY]: '1' })), true);
});

test('lock tilt persists only meridian.lockTilt and never opens /api', () => {
  const storage = memoryStorage();
  writeLockTiltPreference(storage, true);
  assert.equal(storage.getItem(LOCK_TILT_STORAGE_KEY), '1');
  writeLockTiltPreference(storage, false);
  assert.equal(storage.getItem(LOCK_TILT_STORAGE_KEY), '0');
  assert.deepEqual(storage.keys(), [LOCK_TILT_STORAGE_KEY]);

  const moduleSource = src('lockTilt.js');
  assert.doesNotMatch(moduleSource, /\/api\//);
  assert.doesNotMatch(moduleSource, /opensky/i);
  assert.doesNotMatch(moduleSource, /news\.google/i);
  assert.doesNotMatch(moduleSource, /telegeography/i);
  assert.doesNotMatch(moduleSource, /quantum-earth/i);
});

test('lock on: user rotate yaws and keeps pitch constant', () => {
  const pitch = -0.61;
  const camera = stubCamera({ heading: 0.2, pitch, roll: 0.18 });
  const after = applyUserRotateDelta(camera, {
    headingDelta: 0.35,
    pitchDelta: -0.4,
    lockTilt: true,
  });

  assert.ok(Math.abs(after.heading - 0.55) < 1e-9);
  assert.equal(after.pitch, pitch);
  assert.equal(camera.pitch, pitch);
  assert.equal(after.roll, 0);
  assert.equal(camera.roll, 0);
});

test('lock off: current tumble returns heading and pitch', () => {
  const camera = stubCamera({ heading: 0.1, pitch: -0.3, roll: 0 });
  const after = applyUserRotateDelta(camera, {
    headingDelta: 0.2,
    pitchDelta: -0.15,
    lockTilt: false,
  });

  assert.ok(Math.abs(after.heading - 0.3) < 1e-9);
  assert.ok(Math.abs(after.pitch - -0.45) < 1e-9);
  assert.equal(camera.pitch, after.pitch);
});

test('controller lock remaps tumble to heading-only and leaves wheel zoom', () => {
  const controller = defaultController();
  const snapshot = captureControllerEvents(controller);

  applyLockTiltToController(controller, true, { snapshot });
  assert.equal(controller.enableTilt, false);
  assert.equal(controller.enableRotate, true);
  assert.equal(controller.enableZoom, true);
  assert.deepEqual(controller.tiltEventTypes, []);
  const rotate = [].concat(controller.rotateEventTypes);
  assert.ok(rotate.includes(CAMERA_EVENT.RIGHT_DRAG), 'right-drag yaws instead of tumbling');
  assert.ok(rotate.includes(CAMERA_EVENT.MIDDLE_DRAG), 'middle-drag yaws instead of tilting');
  const zoom = [].concat(controller.zoomEventTypes);
  assert.ok(zoom.includes(CAMERA_EVENT.WHEEL), 'invert-scroll / wheel zoom stays wheel-owned');
  assert.equal(zoom.includes(CAMERA_EVENT.RIGHT_DRAG), false, 'right-drag is not zoom while locked');

  applyLockTiltToController(controller, false, { snapshot });
  assert.equal(controller.enableTilt, true);
  assert.deepEqual(controller.tiltEventTypes, snapshot.tiltEventTypes);
  assert.deepEqual(controller.rotateEventTypes, snapshot.rotateEventTypes);
  assert.deepEqual(controller.zoomEventTypes, snapshot.zoomEventTypes);
});

test('compass still north-ups heading only and keeps pitch', () => {
  const pitch = -0.48;
  const camera = stubCamera({ heading: 1.1, pitch, roll: 0.2 });
  applyLockTiltToController(defaultController(), true);
  const headingOnly = applyHeadingOnly(camera, 0);
  assert.equal(headingOnly.heading, 0);
  assert.equal(headingOnly.pitch, pitch);

  const compassCamera = stubCamera({ heading: 1.1, pitch, roll: 0.2 });
  const applied = applyNorthUp(compassCamera, null);
  assert.equal(applied.heading, 0);
  assert.equal(applied.pitch, pitch);
  assert.equal(compassCamera.heading, 0);
  assert.equal(compassCamera.pitch, pitch);
  assert.equal(compassCamera.roll, 0);
});

test('Home and cockpit still set their own pitch while lock is on', () => {
  const flights = [];
  const viewer = {
    camera: {
      heading: 1.4,
      pitch: -0.2,
      cancelFlight() {},
      flyTo(options) { flights.push(options); },
    },
  };
  applyLockTiltToController(defaultController(), true);
  const target = flyToHomeView(viewer);
  assert.equal(target.pitch, HOME_VIEW.pitch);
  assert.equal(flights[0].orientation.pitch, HOME_VIEW.pitch * Math.PI / 180);

  const cockpit = stubCamera({ heading: 0.3, pitch: -0.2 });
  cockpit.setView({
    destination: { x: 1, y: 2, z: 3 },
    orientation: { heading: 0.9, pitch: -0.05, roll: 0 },
  });
  assert.equal(cockpit.pitch, -0.05);
  assert.equal(cockpit.heading, 0.9);
});

test('user-drag hold restores pitch without touching a later Home pitch', () => {
  const camera = stubCamera({ heading: 0.25, pitch: -0.4, roll: 0.3 });
  holdLockedPitch(camera, -0.4);
  assert.equal(camera.pitch, -0.4);
  assert.equal(camera.roll, 0);

  camera.pitch = -0.11;
  camera.roll = 0.4;
  holdLockedPitch(camera, -0.4);
  assert.equal(camera.pitch, -0.4);
  assert.equal(camera.roll, 0);
});

test('DISPLAY Lock tilt control is camera-constraint only', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const moduleSource = src('lockTilt.js');
  const license = root('LICENSE');

  assert.match(html, /id="lock-tilt-toggle"/);
  assert.match(html, /<span class="pp-label">Lock tilt<\/span>/);
  assert.match(html, /id="lock-tilt-toggle"[^>]*aria-pressed="false"/);
  assert.match(ui, /setLockTiltEnabled/);
  assert.match(ui, /applyLockTiltToController/);
  assert.match(ui, /LOCK_TILT_STORAGE_KEY/);
  assert.match(ui, /applyUserRotateDelta|holdLockedPitch/);
  assert.doesNotMatch(ui, /\/api\/.*lockTilt|\/api\/.*lock-tilt/);
  assert.doesNotMatch(moduleSource, /createWorldImagery|IonWorldImagery|photoreal/);
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /OpenSky|Google News|TeleGeography|God'?s Eye View|quantum-earth/i);
});

test('share URLs do not carry meridian.lockTilt', () => {
  const share = src('sharelink.js');
  assert.doesNotMatch(share, /lockTilt|lock-tilt|meridian\.lockTilt/);
});
