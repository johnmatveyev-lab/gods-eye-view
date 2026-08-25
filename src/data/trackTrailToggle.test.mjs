import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Cesium from 'cesium';
import {
  getTrailsEnabled,
  resetTrailsEnabledForTest,
  setTrailsEnabled,
} from './trailPreference.js';
import flightsLayer, {
  _setFlightTrailDrawingStateForTest,
  _setTrackedFlightRefreshStateForTest,
} from './flights.js';
import militaryFlightsLayer, {
  _setMilitaryTrailDrawingStateForTest,
  _setTrackedMilitaryRefreshStateForTest,
} from './militaryFlights.js';
import {
  _getVesselFeedStateForTest,
  _setVesselStateForTest,
} from './aisLiveVessels.js';

const uiSource = fs.readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
const indexHtml = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const flightsSource = fs.readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
const militarySource = fs.readFileSync(new URL('./militaryFlights.js', import.meta.url), 'utf8');
const aisSource = fs.readFileSync(new URL('./aisLiveVessels.js', import.meta.url), 'utf8');

function memoryStorage() {
  const data = {};
  return {
    getItem(key) {
      return Object.hasOwn(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
  };
}

function makeTrailSpy() {
  return {
    visible: true,
    clearCalls: 0,
    setVisible(next) { this.visible = next !== false; },
    clear() { this.clearCalls += 1; },
    setPositions() {},
    destroy() {},
  };
}

function trackedViewer() {
  return {
    isDestroyed: () => false,
    entities: { remove() {} },
    scene: { requestRender() {} },
  };
}

function trackedBillboard() {
  return {
    show: true,
    width: 20,
    height: 20,
    color: Cesium.Color.WHITE,
    scale: 1,
    rotation: 0,
  };
}

test('DISPLAY ships a Trails toggle that is default-on and outside cockpit', () => {
  assert.match(
    indexHtml,
    /class="pp-toggle-btn active" id="trails-toggle" aria-pressed="true"/,
    'index.html: Trails paints lit on first paint, matching the default ON',
  );
  assert.match(indexHtml, /id="trails-toggle"[\s\S]*?<span class="pp-label">Trails<\/span>/);
  assert.equal((indexHtml.match(/id="trails-toggle"/g) || []).length, 1,
    'Trails must have one stateful DOM owner');
  assert.doesNotMatch(indexHtml, /data-cockpit-display-slot="trails"/,
    'trails off is a map-mode drawing hide, not a cockpit control');
  assert.match(uiSource, /hydrateTrailsEnabled/);
  assert.match(uiSource, /meridian\.trails/);
  assert.match(uiSource, /setTrailsEnabled\(!this\._trailsEnabled/);
  assert.doesNotMatch(uiSource, /data-cockpit-display-slot="trails"/);
});

test('the existing trail renderer is what the toggle hides, not a new trail', () => {
  for (const [name, source] of [
    ['flights.js', flightsSource],
    ['militaryFlights.js', militarySource],
    ['aisLiveVessels.js', aisSource],
  ]) {
    assert.match(source, /from '\.\/trailPreference\.js'/, `${name} consults the hosted preference`);
    assert.match(source, /trailDrawingVisible/, `${name} uses the shared hide rule`);
    assert.match(source, /createTrail\(/, `${name} still draws through the existing renderer`);
    assert.match(source, /\.setVisible\(/, `${name} hides with setVisible, not a new primitive`);
  }
  assert.match(flightsSource, /_clearTrail\(\)/);
  assert.match(militarySource, /_clearTrail\(\)/);
  assert.doesNotMatch(uiSource, /\/api\/.*trail/, 'no trails API');
  assert.doesNotMatch(indexHtml, /OpenSky|Google News RSS|TeleGeography/);
});

test('track + trails off hides the already-drawn trail and still follows', () => {
  resetTrailsEnabledForTest();
  const trail = makeTrailSpy();
  const trailHead = { show: true };
  const viewer = trackedViewer();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'abc123',
    entity: { billboard: {} },
    meta: { klass: 'airliner' },
    billboard: trackedBillboard(),
    billboardCollection: {},
    viewer,
  });
  _setFlightTrailDrawingStateForTest({ trail, trailHeadEntity: trailHead });
  try {
    assert.equal(flightsLayer.getParams().selectedFlightsTrackingId, 'abc123');
    assert.equal(setTrailsEnabled(false, { persist: false }), false);
    assert.equal(getTrailsEnabled(), false);
    assert.equal(trail.visible, false, 'already-drawn body hides');
    assert.equal(trailHead.show, false, 'already-drawn head hides');
    assert.equal(trail.clearCalls, 0, 'trails off only hides drawing');
    assert.equal(flightsLayer.getParams().selectedFlightsTrackingId, 'abc123',
      'track still follows while trails are off');

    setTrailsEnabled(true, { persist: false });
    assert.equal(trail.visible, true);
    assert.equal(trailHead.show, true);
    assert.equal(flightsLayer.getParams().selectedFlightsTrackingId, 'abc123');
  } finally {
    resetTrailsEnabledForTest();
    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _setFlightTrailDrawingStateForTest({ trail: null, trailHeadEntity: null });
  }
});

test('stop tracking still clears the target while trails are off', () => {
  resetTrailsEnabledForTest();
  const trail = makeTrailSpy();
  const viewer = trackedViewer();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'def456',
    entity: { billboard: {} },
    meta: { klass: 'airliner' },
    billboard: trackedBillboard(),
    billboardCollection: {},
    viewer,
  });
  _setFlightTrailDrawingStateForTest({ trail, trailHeadEntity: { show: false } });
  try {
    setTrailsEnabled(false, { persist: false });
    assert.equal(flightsLayer.getParams().selectedFlightsTrackingId, 'def456');
    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    assert.equal(flightsLayer.getParams().selectedFlightsTrackingId, null,
      'stop tracking still clears the target');
    assert.equal(trail.clearCalls, 1, 'deselect still clears the accumulated trail');
  } finally {
    resetTrailsEnabledForTest();
    _setFlightTrailDrawingStateForTest({ trail: null, trailHeadEntity: null });
  }
});

test('models off + trails off still tracks', () => {
  resetTrailsEnabledForTest();
  const trail = makeTrailSpy();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'aaa111',
    entity: { billboard: {} },
    meta: { klass: 'airliner' },
    billboard: trackedBillboard(),
    billboardCollection: {},
    viewer: trackedViewer(),
  });
  _setFlightTrailDrawingStateForTest({ trail, trailHeadEntity: { show: true } });
  try {
    flightsLayer.setParams({ models3d: false });
    setTrailsEnabled(false, { persist: false });
    assert.equal(flightsLayer.getParams().models3d, false);
    assert.equal(getTrailsEnabled(), false);
    assert.equal(trail.visible, false);
    assert.equal(flightsLayer.getParams().selectedFlightsTrackingId, 'aaa111',
      'neither models off nor trails off drops the tracked target');
  } finally {
    flightsLayer.setParams({ models3d: true });
    resetTrailsEnabledForTest();
    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _setFlightTrailDrawingStateForTest({ trail: null, trailHeadEntity: null });
  }
});

test('military tracking uses the same hide-without-stop rule', () => {
  resetTrailsEnabledForTest();
  const trail = makeTrailSpy();
  const trailHead = { show: true };
  _setTrackedMilitaryRefreshStateForTest({
    icao24: 'ae01ce',
    entity: { billboard: {} },
    meta: { klass: 'fastjet' },
    billboard: trackedBillboard(),
    billboardCollection: {},
    viewer: trackedViewer(),
  });
  _setMilitaryTrailDrawingStateForTest({ trail, trailHeadEntity: trailHead });
  try {
    setTrailsEnabled(false, { persist: false });
    assert.equal(trail.visible, false);
    assert.equal(trailHead.show, false);
    assert.equal(trail.clearCalls, 0);
    assert.equal(militaryFlightsLayer.getParams().selectedMilitaryTrackingId, 'ae01ce');

    militaryFlightsLayer.setParams({ selectedMilitaryTrackingId: null });
    assert.equal(militaryFlightsLayer.getParams().selectedMilitaryTrackingId, null);
    assert.equal(trail.clearCalls, 1);
  } finally {
    resetTrailsEnabledForTest();
    _setMilitaryTrailDrawingStateForTest({ trail: null, trailHeadEntity: null });
  }
});

test('a selected-vessel trail hides with the same preference and still deselects', () => {
  resetTrailsEnabledForTest();
  const trail = makeTrailSpy();
  _setVesselStateForTest({
    viewer: {},
    records: [{ mmsi: '244660000', lat: 51.9, lon: 4.0 }],
    selectedRecord: { mmsi: '244660000', lat: 51.9, lon: 4.0 },
    trail,
    trailMmsi: '244660000',
    trailPositions: [new Cesium.Cartesian3(1, 2, 3), new Cesium.Cartesian3(4, 5, 6)],
  });
  try {
    setTrailsEnabled(false, { persist: false });
    assert.equal(trail.visible, false);
    assert.equal(trail.clearCalls, 0);
    assert.equal(_getVesselFeedStateForTest().trailMmsi, '244660000');
    assert.equal(_getVesselFeedStateForTest().selectedMmsi, '244660000');
  } finally {
    resetTrailsEnabledForTest();
    _setVesselStateForTest({ enabled: false });
  }
});

test('the UI persist path writes meridian.trails and does not invent an API', () => {
  const persist = uiSource.slice(
    uiSource.indexOf('_initTrailsToggle() {'),
    uiSource.indexOf('_initHUDToggle() {'),
  );
  assert.match(persist, /hydrateTrailsEnabled/);
  assert.match(persist, /setTrailsEnabled\(!this\._trailsEnabled/);
  assert.doesNotMatch(persist, /fetch\(|\/api\//);
  assert.doesNotMatch(uiSource, /_setModels3dEnabled\(false\).*setTrailsEnabled|setTrailsEnabled.*_clearTracking/);

  const storage = memoryStorage();
  setTrailsEnabled(false, { storage });
  assert.equal(storage.getItem('meridian.trails'), '0');
  resetTrailsEnabledForTest();
});
