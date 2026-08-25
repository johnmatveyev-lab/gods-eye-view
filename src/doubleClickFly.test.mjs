import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';
import * as Cesium from 'cesium';

import {
  DOUBLE_CLICK_FLY_ACTION,
  DOUBLE_CLICK_FLY_DEFAULT,
  DOUBLE_CLICK_FLY_DURATION_S,
  DOUBLE_CLICK_FLY_PITCH_DEG,
  DOUBLE_CLICK_FLY_PICK_ASKER,
  DOUBLE_CLICK_FLY_RANGE_M,
  DOUBLE_CLICK_FLY_STORAGE_KEY,
  bindDoubleClickFly,
  doubleClickFlyEnabledFromStoredValue,
  doubleClickFlyFraming,
  flyToDoubleClickPick,
  handleDoubleClickFly,
  pickWorldPositionAt,
  readDoubleClickFlyPreference,
  resolveDoubleClickFlyAction,
  writeDoubleClickFlyPreference,
} from './doubleClickFly.js';
import { isPickedWorldPosition } from './data/scenePick.js';
import {
  isOwnedByOtherLayer,
  registerPickOwner,
  unregisterPickOwner,
} from './data/pickRegistry.js';

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

function terrainPosition(lat = 30.2672, lon = -97.7431, height = 0) {
  return Cesium.Cartesian3.fromDegrees(lon, lat, height);
}

function makeViewer({
  pick = null,
  pickPosition = null,
  pickEllipsoid = null,
  globePick = null,
  headingDeg = 15,
  pitchDeg = -30,
  height = 4000,
} = {}) {
  const flights = [];
  return {
    flights,
    camera: {
      heading: Cesium.Math.toRadians(headingDeg),
      pitch: Cesium.Math.toRadians(pitchDeg),
      positionCartographic: { height, latitude: 0, longitude: 0 },
      pickEllipsoid() { return pickEllipsoid; },
      getPickRay() { return globePick ? { ok: true } : null; },
      flyToBoundingSphere(sphere, options) {
        flights.push({ sphere, options });
      },
      lookAt() {},
      lookAtTransform() {},
    },
    scene: {
      canvas: {},
      pickPositionSupported: true,
      pick() { return pick; },
      pickPosition() { return pickPosition; },
      globe: {
        pick() { return globePick; },
        getHeight() { return 0; },
      },
    },
  };
}

test('meridian.doubleClickFly defaults on and is the only new storage key', () => {
  assert.equal(DOUBLE_CLICK_FLY_STORAGE_KEY, 'meridian.doubleClickFly');
  assert.equal(DOUBLE_CLICK_FLY_DEFAULT, true);
  assert.equal(doubleClickFlyEnabledFromStoredValue(null), true);
  assert.equal(doubleClickFlyEnabledFromStoredValue(''), true);
  assert.equal(doubleClickFlyEnabledFromStoredValue('garbage'), true);
  assert.equal(doubleClickFlyEnabledFromStoredValue('0'), false);
  assert.equal(doubleClickFlyEnabledFromStoredValue('1'), true);
  assert.equal(readDoubleClickFlyPreference(memoryStorage()), true);
  assert.equal(readDoubleClickFlyPreference(memoryStorage({
    [DOUBLE_CLICK_FLY_STORAGE_KEY]: '0',
  })), false);

  const storage = memoryStorage();
  writeDoubleClickFlyPreference(storage, false);
  assert.equal(storage.getItem(DOUBLE_CLICK_FLY_STORAGE_KEY), '0');
  writeDoubleClickFlyPreference(storage, true);
  assert.equal(storage.getItem(DOUBLE_CLICK_FLY_STORAGE_KEY), '1');
  assert.deepEqual(storage.keys(), [DOUBLE_CLICK_FLY_STORAGE_KEY]);
});

test('double-click empty terrain flies to the pick with the landmark helper', () => {
  const viewer = makeViewer({ height: 12_000, headingDeg: 40, pitchDeg: -28 });
  const target = terrainPosition(30.2672, -97.7431, 120);
  const flights = [];
  const decision = handleDoubleClickFly(viewer, { position: { x: 200, y: 180 } }, {
    pick: () => null,
    pickWorld: () => target,
    overlayHit: null,
    flyTo(nextViewer, lat, lon, framing) {
      flights.push({ viewer: nextViewer, lat, lon, framing });
      return { ok: true };
    },
  });

  assert.equal(decision.action, DOUBLE_CLICK_FLY_ACTION.FLY);
  assert.equal(decision.reason, 'terrain');
  assert.equal(flights.length, 1);
  assert.equal(flights[0].viewer, viewer);
  assert.ok(Math.abs(flights[0].lat - 30.2672) < 1e-6);
  assert.ok(Math.abs(flights[0].lon + 97.7431) < 1e-6);
  assert.equal(flights[0].framing.range, DOUBLE_CLICK_FLY_RANGE_M);
  assert.equal(flights[0].framing.pitch, -28);
  assert.ok(Math.abs(flights[0].framing.heading - 40) < 1e-6);
  assert.equal(flights[0].framing.duration, DOUBLE_CLICK_FLY_DURATION_S);
  assert.equal(flights[0].framing.buildingHeight, 0);
});

test('double-click aircraft tracks and does not fly to terrain', () => {
  registerPickOwner('flights', (pickedId) => pickedId === 'a1b2c3');
  try {
    const viewer = makeViewer();
    const flights = [];
    const decision = handleDoubleClickFly(viewer, { position: { x: 10, y: 10 } }, {
      pick: () => ({ id: 'a1b2c3' }),
      pickWorld: () => terrainPosition(),
      flyTo() { flights.push('flew'); return { ok: true }; },
    });
    assert.equal(decision.action, DOUBLE_CLICK_FLY_ACTION.TRACK);
    assert.equal(decision.reason, 'contact');
    assert.equal(flights.length, 0);
    assert.equal(
      isOwnedByOtherLayer(DOUBLE_CLICK_FLY_PICK_ASKER, 'a1b2c3'),
      true,
      'the existing pick registry still owns the aircraft',
    );
  } finally {
    unregisterPickOwner('flights');
  }
});

test('double-click on a contact card tracks and does not fly', () => {
  const flights = [];
  const decision = handleDoubleClickFly(makeViewer(), { position: { x: 40, y: 50 } }, {
    overlayHit: { sourceId: 'tracked', entryId: 'flights:a1b2c3' },
    pick: () => null,
    pickWorld: () => terrainPosition(),
    flyTo() { flights.push('flew'); return { ok: true }; },
  });
  assert.equal(decision.action, DOUBLE_CLICK_FLY_ACTION.TRACK);
  assert.equal(decision.reason, 'contact-card');
  assert.equal(flights.length, 0);
});

test('zoom-to-pointer stays wheel-only; double-click uses fly-to', () => {
  const moduleSource = src('doubleClickFly.js');
  const zoomToPointer = src('zoomToPointer.js');
  const ui = src('ui.js');
  const cameraVerbs = src('cameraVerbs.js');

  assert.doesNotMatch(moduleSource, /addEventListener\(\s*['"]wheel['"]/);
  assert.doesNotMatch(moduleSource, /zoomIn|zoomOut|enableZoom|zoomToward|bindZoomToPointerWheel/);
  assert.match(moduleSource, /LEFT_DOUBLE_CLICK/);
  assert.match(moduleSource, /flyToLandmark/);
  assert.match(ui, /bindDoubleClickFly/);
  assert.match(ui, /bindZoomToPointerWheel/);
  assert.match(zoomToPointer, /addEventListener\?\.\('wheel'/);
  assert.doesNotMatch(zoomToPointer, /LEFT_DOUBLE_CLICK|dblclick/);
  assert.match(
    cameraVerbs,
    /for \(const evt of \['pointerdown', 'wheel'\]\)/,
    'manual camera reclaim still listens for wheel; double-click is not that path',
  );
  assert.doesNotMatch(ui, /bindDoubleClickFly[\s\S]{0,400}addEventListener\(\s*['"]wheel['"]/);
  assert.doesNotMatch(moduleSource, /invertScroll|signedWheelZoomDelta|zoomToPointer/);
  const measure = src('measure.js');
  assert.match(measure, /LEFT_CLICK/);
  assert.doesNotMatch(measure, /LEFT_DOUBLE_CLICK|dblclick/);
});

test('preference off and cockpit and measure and sky misses do not fly', () => {
  const flights = [];
  const flyTo = () => { flights.push('flew'); return { ok: true }; };
  const target = terrainPosition();

  assert.equal(resolveDoubleClickFlyAction({
    enabled: false,
    worldPosition: target,
  }).action, DOUBLE_CLICK_FLY_ACTION.IGNORE);

  assert.equal(handleDoubleClickFly(makeViewer(), { position: { x: 1, y: 1 } }, {
    enabled: false,
    pickWorld: () => target,
    flyTo,
  }).reason, 'disabled');

  assert.equal(handleDoubleClickFly(makeViewer(), { position: { x: 1, y: 1 } }, {
    cockpitActive: true,
    pickWorld: () => target,
    flyTo,
  }).reason, 'cockpit');

  assert.equal(handleDoubleClickFly(makeViewer(), { position: { x: 1, y: 1 } }, {
    measureActive: true,
    pickWorld: () => target,
    flyTo,
  }).reason, 'measure');

  assert.equal(handleDoubleClickFly(makeViewer(), { position: { x: 1, y: 1 } }, {
    pickWorld: () => null,
    flyTo,
  }).reason, 'miss');

  assert.equal(flights.length, 0);
});

test('framing keeps a close readable height/tilt and rejects nadir', () => {
  const close = makeViewer({ height: 420, pitchDeg: -26, headingDeg: 80 });
  const closeFrame = doubleClickFlyFraming(close);
  assert.equal(closeFrame.range, 420);
  assert.equal(closeFrame.pitch, -26);

  const nadir = makeViewer({ height: 20_000, pitchDeg: -89, headingDeg: 0 });
  const nadirFrame = doubleClickFlyFraming(nadir);
  assert.equal(nadirFrame.range, DOUBLE_CLICK_FLY_RANGE_M);
  assert.equal(nadirFrame.pitch, DOUBLE_CLICK_FLY_PITCH_DEG);
});

test('pickWorldPositionAt uses the existing depth → ellipsoid → globe cascade', () => {
  const surface = terrainPosition(40.7, -74, 10);
  const viewer = makeViewer({
    pickPosition: new Cesium.Cartesian3(500, 0, 0),
    pickEllipsoid: surface,
  });
  const picked = pickWorldPositionAt(viewer, { x: 12, y: 24 });
  assert.equal(isPickedWorldPosition(picked), true);
  const carto = Cesium.Cartographic.fromCartesian(picked);
  assert.ok(Math.abs(Cesium.Math.toDegrees(carto.latitude) - 40.7) < 1e-6);
});

test('flyToDoubleClickPick returns null for a degenerate cartesian', () => {
  const flights = [];
  assert.equal(flyToDoubleClickPick(makeViewer(), new Cesium.Cartesian3(500, 0, 0), {
    flyTo() { flights.push('flew'); },
  }), null);
  assert.equal(flights.length, 0);
});

test('bindDoubleClickFly listens for LEFT_DOUBLE_CLICK only', () => {
  const actions = [];
  const fakeCesium = {
    ScreenSpaceEventType: { LEFT_DOUBLE_CLICK: 'LEFT_DOUBLE_CLICK', WHEEL: 'WHEEL' },
    ScreenSpaceEventHandler: class {
      constructor() { this.destroyed = false; }
      setInputAction(fn, type) { actions.push({ fn, type }); }
      destroy() { this.destroyed = true; }
    },
  };
  const viewer = makeViewer();
  const remove = bindDoubleClickFly(viewer, { Cesium: fakeCesium, enabled: false });
  assert.deepEqual(actions.map((entry) => entry.type), ['LEFT_DOUBLE_CLICK']);
  assert.equal(typeof actions[0].fn, 'function');
  remove();
});

test('ui wires the helper through explicit navigation and first-run does not write it', () => {
  const ui = src('ui.js');
  const firstRun = src('firstRunExperience.js');

  assert.match(ui, /readDoubleClickFlyPreference/);
  assert.match(ui, /bindDoubleClickFly/);
  assert.match(ui, /_runExplicitNavigation\(\s*'pick'/);
  assert.match(ui, /flyToLandmark/);
  assert.match(ui, /hitTestWorldOverlay/);
  assert.match(ui, /isMeasureActive/);
  assert.match(ui, /_removeDoubleClickFly/);
  assert.match(firstRun, /meridian\.doubleClickFly/);
  assert.doesNotMatch(firstRun, /writeDoubleClickFlyPreference|bindDoubleClickFly|_initDoubleClickFly/);
});

test('no /api, no OSM feature lists, camera only', () => {
  const moduleSource = src('doubleClickFly.js');
  assert.doesNotMatch(moduleSource, /\/api\//);
  assert.doesNotMatch(moduleSource, /nominatim|overpass|openstreetmap|osm/i);
  assert.doesNotMatch(moduleSource, /opensky|news\.google|telegeography|quantum-earth/i);
  assert.doesNotMatch(moduleSource, /person-search|people search/i);
});

test('legal: camera only, Meridian title, MIT credit, no banned sources', () => {
  const moduleSource = src('doubleClickFly.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /OpenSky|Google News|TeleGeography|God'?s Eye View|quantum-earth/i);
});
