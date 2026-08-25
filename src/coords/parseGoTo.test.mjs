import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mgrs from 'mgrs';
import { flyToGoTo, flyToHomeView, HOME_VIEW } from '../camera.js';
import {
  CAMERA_COORDS_COPY_ID,
  CAMERA_COORDS_MGRS_ID,
  CAMERA_COORDS_ROOT_ID,
  CAMERA_COORDS_VALUE_ID,
  destroyCameraCoords,
  formatLatLon,
  formatMgrs,
  initCameraCoords,
  syncCameraCoords,
} from '../copyCameraCoords.js';
import { GOTO_INVALID_STATUS, parseGoTo } from './parseGoTo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');
const src = (name) => readFileSync(join(__dirname, '..', name), 'utf8');
const root = (name) => readFileSync(join(repoRoot, name), 'utf8');

const CONUS_LAT_LON = Object.freeze({ lat: 37.8, lon: -122.4 });
const START_POSE = Object.freeze({
  lat: HOME_VIEW.lat,
  lon: HOME_VIEW.lon,
  alt: 1400,
  heading: 40,
  pitch: -25,
});

function expectedMgrs(lat, lon) {
  const raw = mgrs.forward([lon, lat], 4);
  const match = raw.match(/^(\d{1,2}[A-Z])([A-Z]{2})(\d+)$/);
  assert.ok(match, `mgrs.forward should yield a grid for ${lat},${lon}`);
  const [, zone, square, coords] = match;
  const half = coords.length / 2;
  return {
    raw,
    spaced: `${zone} ${square} ${coords.slice(0, half)} ${coords.slice(half)}`,
    labeled: `MGRS ${zone} ${square} ${coords.slice(0, half)} ${coords.slice(half)}`,
  };
}

const CONUS_MGRS = expectedMgrs(CONUS_LAT_LON.lat, CONUS_LAT_LON.lon);

function toCarto(pose) {
  return {
    latitude: pose.lat * Math.PI / 180,
    longitude: pose.lon * Math.PI / 180,
    height: pose.alt ?? 600,
  };
}

function makeViewer(pose = START_POSE) {
  const camera = {
    positionCartographic: toCarto(pose),
    heading: (pose.heading ?? 0) * Math.PI / 180,
    pitch: (pose.pitch ?? -30) * Math.PI / 180,
    roll: 0,
    cancelFlight() { this.cancelled += 1; },
    flyTo(options) { this.flights.push(options); },
    cancelled: 0,
    flights: [],
  };
  return { camera };
}

function applyGoTo(viewer, raw, statuses = []) {
  const parsed = parseGoTo(raw);
  if (!parsed.ok) {
    statuses.push(GOTO_INVALID_STATUS);
    return { ok: false, moved: false, flights: viewer.camera.flights.length };
  }
  const target = flyToGoTo(viewer, parsed, { duration: 0 });
  return { ok: true, moved: true, target, flights: viewer.camera.flights.length };
}

class MockButton {
  constructor(id) {
    this.id = id;
    this.textContent = '';
    this.title = '';
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
  }

  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(handler);
  }

  removeEventListener(name, handler) {
    this.listeners.get(name)?.delete(handler);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

class MockRoot {
  constructor() {
    this.id = CAMERA_COORDS_ROOT_ID;
    this.hidden = false;
    this.dataset = {};
  }
}

class MockMgrs {
  constructor() {
    this.id = CAMERA_COORDS_MGRS_ID;
    this.textContent = '';
    this.hidden = true;
  }
}

function makeCesiumEvent() {
  const listeners = new Set();
  return {
    addEventListener(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    raise() {
      for (const callback of [...listeners]) callback();
    },
  };
}

function installReadout(viewer) {
  const changed = makeCesiumEvent();
  const moveEnd = makeCesiumEvent();
  viewer.camera.changed = changed;
  viewer.camera.moveEnd = moveEnd;
  const mgrsEl = new MockMgrs();
  initCameraCoords({
    viewer,
    force: true,
    root: new MockRoot(),
    valueButton: new MockButton(CAMERA_COORDS_VALUE_ID),
    copyButton: new MockButton(CAMERA_COORDS_COPY_ID),
    mgrsEl,
  });
  return {
    mgrsEl,
    finishFlight(pose) {
      viewer.camera.positionCartographic = toCarto(pose);
      moveEnd.raise();
      syncCameraCoords();
    },
    cleanup() {
      destroyCameraCoords();
    },
  };
}

describe('parseGoTo', () => {
  it('accepts a CONUS MGRS grid via mgrs.toPoint', () => {
    const compact = parseGoTo(CONUS_MGRS.raw);
    const spaced = parseGoTo(CONUS_MGRS.spaced);
    const labeled = parseGoTo(CONUS_MGRS.labeled);
    assert.equal(compact.ok, true);
    assert.equal(compact.kind, 'mgrs');
    assert.equal(spaced.ok, true);
    assert.equal(labeled.ok, true);
    const [lon, lat] = mgrs.toPoint(CONUS_MGRS.raw);
    assert.ok(Math.abs(compact.lat - lat) < 1e-8);
    assert.ok(Math.abs(compact.lon - lon) < 1e-8);
    assert.ok(Math.abs(spaced.lat - lat) < 1e-8);
    assert.ok(Math.abs(labeled.lat - lat) < 1e-8);
  });

  it('accepts decimal lat, lon and an optional height', () => {
    const parsed = parseGoTo('37.8, -122.4');
    assert.deepEqual(parsed, { ok: true, lat: 37.8, lon: -122.4, kind: 'latlon' });
    const withHeight = parseGoTo('37.8,-122.4,1500');
    assert.equal(withHeight.ok, true);
    assert.equal(withHeight.lat, 37.8);
    assert.equal(withHeight.lon, -122.4);
    assert.equal(withHeight.alt, 1500);
    const copied = parseGoTo(`37.8000,-122.4000\n${CONUS_MGRS.labeled}`);
    assert.equal(copied.ok, true);
    assert.equal(copied.kind, 'latlon');
    assert.equal(copied.lat, 37.8);
    assert.equal(copied.lon, -122.4);
  });

  it('rejects junk and empty input', () => {
    for (const raw of ['', '   ', 'not a place', 'hello', '91, 0', '0, 181', 'OpenSky']) {
      assert.deepEqual(parseGoTo(raw), { ok: false }, raw);
    }
  });
});

describe('Go-to flies the existing Home/share camera helper', () => {
  it('pasting a CONUS MGRS centers the camera on that point', () => {
    const viewer = makeViewer();
    const result = applyGoTo(viewer, CONUS_MGRS.raw);
    const [lon, lat] = mgrs.toPoint(CONUS_MGRS.raw);
    assert.equal(result.ok, true);
    assert.equal(result.moved, true);
    assert.equal(result.flights, 1);
    assert.ok(Math.abs(result.target.lat - lat) < 1e-8);
    assert.ok(Math.abs(result.target.lon - lon) < 1e-8);
    assert.equal(result.target.alt, START_POSE.alt);
    assert.ok(Math.abs(result.target.heading - START_POSE.heading) < 1e-8);
    assert.ok(Math.abs(result.target.pitch - START_POSE.pitch) < 1e-8);
    assert.equal(viewer.camera.flights[0].orientation.heading, viewer.camera.heading);
    assert.equal(viewer.camera.flights[0].orientation.pitch, viewer.camera.pitch);
  });

  it('pasting 37.8, -122.4 centers the camera on that point', () => {
    const viewer = makeViewer();
    const result = applyGoTo(viewer, '37.8, -122.4');
    assert.equal(result.ok, true);
    assert.equal(result.target.lat, 37.8);
    assert.equal(result.target.lon, -122.4);
    assert.equal(result.target.alt, START_POSE.alt);
    assert.equal(result.flights, 1);
  });

  it('uses the pasted height when one is included', () => {
    const viewer = makeViewer();
    const result = applyGoTo(viewer, '37.8, -122.4, 2200');
    assert.equal(result.target.alt, 2200);
    assert.ok(Math.abs(result.target.heading - START_POSE.heading) < 1e-8);
  });

  it('junk or empty input does not move the camera and reports a short status', () => {
    const viewer = makeViewer();
    const statuses = [];
    const empty = applyGoTo(viewer, '   ', statuses);
    const junk = applyGoTo(viewer, 'not a grid', statuses);
    assert.deepEqual(empty, { ok: false, moved: false, flights: 0 });
    assert.deepEqual(junk, { ok: false, moved: false, flights: 0 });
    assert.deepEqual(statuses, [GOTO_INVALID_STATUS, GOTO_INVALID_STATUS]);
    assert.equal(viewer.camera.flights.length, 0);
    assert.equal(GOTO_INVALID_STATUS, 'Invalid coordinates');
  });

  it('pointer MGRS readout still updates after the flight', () => {
    const viewer = makeViewer();
    const readout = installReadout(viewer);
    try {
      assert.equal(readout.mgrsEl.textContent, formatMgrs(START_POSE.lat, START_POSE.lon));
      const result = applyGoTo(viewer, '37.8, -122.4');
      assert.equal(result.moved, true);
      readout.finishFlight({ lat: 37.8, lon: -122.4, alt: START_POSE.alt });
      assert.equal(readout.mgrsEl.textContent, formatMgrs(37.8, -122.4));
      assert.notEqual(readout.mgrsEl.textContent, formatMgrs(START_POSE.lat, START_POSE.lon));
      assert.equal(readout.mgrsEl.hidden, false);
    } finally {
      readout.cleanup();
    }
  });

  it('Home still flies to HOME_VIEW after a go-to', () => {
    const viewer = makeViewer();
    const go = applyGoTo(viewer, '37.8, -122.4');
    assert.equal(go.moved, true);
    viewer.camera.positionCartographic = toCarto({ lat: 37.8, lon: -122.4, alt: START_POSE.alt });
    const home = flyToHomeView(viewer, { duration: 0 });
    assert.equal(home.lat, HOME_VIEW.lat);
    assert.equal(home.lon, HOME_VIEW.lon);
    assert.equal(home.alt, HOME_VIEW.alt);
    assert.equal(home.heading, HOME_VIEW.heading);
    assert.equal(home.pitch, HOME_VIEW.pitch);
    assert.equal(viewer.camera.flights.length, 2);
  });
});

describe('Go-to chrome: field next to the readout, no new camera mode, no /api', () => {
  it('sits next to #camera-coords with a Go submit', () => {
    const html = root('index.html');
    const block = html.match(/id="top-center-actions"[\s\S]*?<\/nav>/)[0];
    assert.match(block, /id="camera-coords"/);
    assert.match(block, /id="camera-coords-mgrs"/);
    assert.match(block, /id="go-to"/);
    assert.match(block, /id="go-to-input"/);
    assert.match(block, /id="go-to-submit"/);
    assert.match(block, /camera-coords[\s\S]*id="go-to"/);
    assert.match(block, /placeholder="MGRS or lat, lon"/);
    assert.match(block, />Go</);
    assert.match(html, /<title>Meridian<\/title>/);
  });

  it('StyleManager parses then flies with flyToGoTo; Home is unchanged', () => {
    const ui = src('ui.js');
    const camera = src('camera.js');
    assert.match(ui, /from '\.\/coords\/parseGoTo\.js'/);
    assert.match(ui, /flyToGoTo/);
    assert.match(ui, /_initGoToField\(\)/);
    assert.match(ui, /goToCoords\(\)/);
    assert.match(ui, /parseGoTo\(this\._goToInput\?\.value\)/);
    assert.match(ui, /flyToGoTo\(this\.viewer, parsed\)/);
    assert.match(ui, /GOTO_INVALID_STATUS/);
    assert.match(ui, /goHome\(\)\s*\{/);
    assert.match(ui, /flyToHomeView\(this\.viewer\)/);
    assert.match(camera, /export function flyToHomeView/);
    assert.match(camera, /export function flyToGoTo/);
    const goFn = ui.match(/goToCoords\(\)\s*\{[\s\S]*?\n  \}/)[0];
    assert.doesNotMatch(goFn, /\/api\//);
    assert.doesNotMatch(goFn, /geocode|places|OpenSky|Google News|TeleGeography|quantum-earth/i);
    assert.doesNotMatch(goFn, /setCameraMode|cameraMode/);
    const homeFn = ui.match(/goHome\(\)\s*\{[\s\S]*?\n  \}/)[0];
    assert.match(homeFn, /flyToHomeView\(this\.viewer\)/);
    assert.doesNotMatch(homeFn, /flyToGoTo/);
  });

  it('does not invent /api, geocoding, or a second MGRS readout', () => {
    const parse = src('coords/parseGoTo.js');
    const camera = src('camera.js');
    const html = root('index.html');
    const coordsBlock = html.match(/id="camera-coords"[\s\S]*?<\/div>/)?.[0] || '';
    assert.match(parse, /from 'mgrs'|from "mgrs"/);
    assert.match(parse, /toPoint/);
    assert.doesNotMatch(parse, /\/api\//);
    assert.doesNotMatch(parse, /geocode|places|OpenSky|Google News|TeleGeography|quantum-earth/i);
    assert.doesNotMatch(camera, /\/api\/goto|\/api\/mgrs/);
    assert.match(coordsBlock, /camera-coords-mgrs/);
    assert.equal((coordsBlock.match(/id="camera-coords-copy"/g) || []).length, 1);
    assert.doesNotMatch(coordsBlock, /id="go-to"/);
    const apiDir = join(repoRoot, 'api');
    const apiFiles = readdirSync(apiDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    assert.equal(apiFiles.includes('goto.js'), false);
    assert.equal(apiFiles.includes('mgrs.js'), false);
    const license = root('LICENSE');
    assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
    assert.equal(formatLatLon(CONUS_LAT_LON.lat, CONUS_LAT_LON.lon), '37.8000,-122.4000');
  });
});
