import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  EMERGENCY_HIGHLIGHT_CSS,
  EMERGENCY_HIGHLIGHT_DEFAULT,
  EMERGENCY_HIGHLIGHT_STORAGE_KEY,
  EMERGENCY_SQUAWKS,
  emergencyHighlightPaint,
  getEmergencyHighlightEnabled,
  hydrateEmergencyHighlightEnabled,
  isEmergencySquawk,
  normalizeEmergencyHighlightEnabled,
  normalizeSquawk,
  readEmergencyHighlightEnabled,
  resetEmergencyHighlightForTest,
  setEmergencyHighlightEnabled,
  shouldPaintEmergencyHighlight,
  subscribeEmergencyHighlightEnabled,
  writeEmergencyHighlightEnabled,
} from './emergencySquawk.js';
import flightsLayer, {
  _addFlightTrackingCandidateForTest,
  _contactIconColorForTest,
  _setTrackedFlightRefreshStateForTest,
} from './flights.js';
import militaryFlightsLayer, {
  _addMilitaryTrackingCandidateForTest,
  _militaryContactIconColorForTest,
  _setTrackedMilitaryRefreshStateForTest,
} from './militaryFlights.js';
import { normalizeAdsbLolAircraftState } from './adsbLolFallback.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (name) => readFileSync(path.join(ROOT, 'src', name), 'utf8');
const data = (name) => readFileSync(path.join(ROOT, 'src/data', name), 'utf8');
const root = (name) => readFileSync(path.join(ROOT, name), 'utf8');

function memoryStorage(initial = {}) {
  const dataMap = { ...initial };
  return {
    getItem(key) {
      return Object.hasOwn(dataMap, key) ? dataMap[key] : null;
    },
    setItem(key, value) {
      dataMap[key] = String(value);
    },
    snapshot() {
      return { ...dataMap };
    },
  };
}

function emptyViewer() {
  return {
    isDestroyed: () => false,
    entities: { add() { return {}; }, remove() {} },
    scene: { requestRender() {} },
  };
}

function emptyBillboard(color = Cesium.Color.WHITE) {
  return {
    show: true,
    width: 20,
    height: 20,
    color,
    scale: 1,
    rotation: 0,
  };
}

test('fixture squawk 7700 highlights; 1200 does not', () => {
  const emergency = emergencyHighlightPaint({
    squawk: '7700',
    highlightEnabled: true,
    inAltitudeBand: true,
  });
  const vfr = emergencyHighlightPaint({
    squawk: '1200',
    highlightEnabled: true,
    inAltitudeBand: true,
  });

  assert.deepEqual(EMERGENCY_SQUAWKS, ['7500', '7600', '7700']);
  assert.equal(normalizeSquawk(7700), '7700');
  assert.equal(isEmergencySquawk('7700'), true);
  assert.equal(isEmergencySquawk(7500), true);
  assert.equal(isEmergencySquawk('7600'), true);
  assert.equal(isEmergencySquawk('1200'), false);
  assert.equal(isEmergencySquawk(null), false);
  assert.equal(emergency.highlighted, true);
  assert.equal(emergency.visible, true);
  assert.equal(emergency.cssColor, EMERGENCY_HIGHLIGHT_CSS);
  assert.equal(vfr.highlighted, false);
  assert.equal(vfr.visible, true);
  assert.equal(vfr.cssColor, null);
});

test('toggle off → no special paint', () => {
  const painted = emergencyHighlightPaint({
    squawk: '7700',
    highlightEnabled: false,
    inAltitudeBand: true,
  });
  assert.equal(shouldPaintEmergencyHighlight({
    squawk: '7700',
    highlightEnabled: false,
    inAltitudeBand: true,
  }), false);
  assert.equal(painted.highlighted, false);
  assert.equal(painted.cssColor, null);
  assert.equal(painted.visible, true, 'toggle off removes the highlight, not the contact');
});

test('alt band still hides out-of-band even if emergency', () => {
  // Documented product rule: altitude-band visibility still wins. An
  // emergency squawk does not punch through an out-of-band hide.
  const outOfBand = emergencyHighlightPaint({
    squawk: '7700',
    highlightEnabled: true,
    inAltitudeBand: false,
  });
  assert.equal(outOfBand.visible, false);
  assert.equal(outOfBand.highlighted, false);
  assert.equal(outOfBand.cssColor, null);
  assert.equal(shouldPaintEmergencyHighlight({
    squawk: '7500',
    highlightEnabled: true,
    inAltitudeBand: false,
  }), false);

  const moduleSource = data('emergencySquawk.js');
  assert.match(moduleSource, /Altitude-band visibility still wins/);
  assert.match(moduleSource, /out-of-band contact stays hidden/);
});

test('highlight uses the existing annotation alert red, not a new hue', () => {
  const screen = src('annotations/screenAnnotationRenderer.js');
  const world = src('annotations/worldAnnotationRenderer.js');
  const tools = src('voice/realtimeTools.js');
  assert.equal(EMERGENCY_HIGHLIGHT_CSS, '#ff6b6b');
  assert.match(screen, /red:\s*'#ff6b6b'/);
  assert.match(world, /red:\s*'#ff6b6b'/);
  assert.match(tools, /red = alert/);
});

test('adsb.lol current payload already carries squawk at state\[14\]', () => {
  const state = normalizeAdsbLolAircraftState({
    hex: 'abc123',
    flight: 'TEST1',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
    squawk: '7700',
  }, 1000);
  assert.equal(state[14], '7700');

  const vfr = normalizeAdsbLolAircraftState({
    hex: 'def456',
    flight: 'N123AB',
    lat: 30,
    lon: -97,
    alt_baro: 3500,
    squawk: '1200',
  }, 1000);
  assert.equal(vfr[14], '1200');
});

test('civilian and military contacts paint 7700 and leave 1200 alone', () => {
  resetEmergencyHighlightForTest();
  setEmergencyHighlightEnabled(true, { persist: false });
  try {
    _setTrackedFlightRefreshStateForTest({
      icao24: 'aa7700',
      meta: { squawk: '7700', klass: 'large', onGround: false },
      billboard: emptyBillboard(),
      billboardCollection: {},
      viewer: emptyViewer(),
      entity: {},
      tracked: false,
    });
    _addFlightTrackingCandidateForTest({
      icao24: 'aa1200',
      meta: { squawk: '1200', klass: 'small', onGround: false },
      billboard: emptyBillboard(),
    });

    const emergency = _contactIconColorForTest('aa7700');
    const vfr = _contactIconColorForTest('aa1200');
    assert.ok(emergency.equals(Cesium.Color.fromCssColorString(EMERGENCY_HIGHLIGHT_CSS)));
    assert.ok(vfr.equals(Cesium.Color.WHITE));

    setEmergencyHighlightEnabled(false, { persist: false });
    assert.ok(_contactIconColorForTest('aa7700').equals(Cesium.Color.WHITE),
      'toggle off returns the ordinary fleet tint');

    _setTrackedMilitaryRefreshStateForTest({
      icao24: 'ae7700',
      meta: { squawk: '7700', klass: 'fastjet', onGround: false },
      billboard: emptyBillboard(),
      billboardCollection: {},
      viewer: emptyViewer(),
      entity: {},
      tracked: false,
    });
    _addMilitaryTrackingCandidateForTest({
      icao24: 'ae1200',
      meta: { squawk: '1200', klass: 'fastjet', onGround: false },
      billboard: emptyBillboard(),
    });
    setEmergencyHighlightEnabled(true, { persist: false });
    const milEmergency = _militaryContactIconColorForTest('ae7700');
    const milVfr = _militaryContactIconColorForTest('ae1200');
    assert.ok(milEmergency.equals(Cesium.Color.fromCssColorString(EMERGENCY_HIGHLIGHT_CSS)));
    assert.ok(milVfr.equals(Cesium.Color.fromCssColorString('#FFB800')));
  } finally {
    resetEmergencyHighlightForTest();
    flightsLayer.setParams?.({ selectedFlightsTrackingId: null });
    militaryFlightsLayer.setParams?.({ selectedMilitaryTrackingId: null });
  }
});

test('Emergency highlight defaults on and persists meridian.emergencyHighlight', () => {
  assert.equal(EMERGENCY_HIGHLIGHT_DEFAULT, true);
  assert.equal(EMERGENCY_HIGHLIGHT_STORAGE_KEY, 'meridian.emergencyHighlight');
  assert.equal(normalizeEmergencyHighlightEnabled(undefined), true);
  assert.equal(normalizeEmergencyHighlightEnabled(null), true);
  assert.equal(normalizeEmergencyHighlightEnabled('nope'), true);
  assert.equal(normalizeEmergencyHighlightEnabled('0'), false);
  assert.equal(normalizeEmergencyHighlightEnabled(false), false);
  assert.equal(normalizeEmergencyHighlightEnabled('1'), true);

  const storage = memoryStorage();
  assert.equal(readEmergencyHighlightEnabled(storage), true);
  assert.equal(writeEmergencyHighlightEnabled(false, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.emergencyHighlight': '0' });
  assert.equal(readEmergencyHighlightEnabled(storage), false);
});

test('the live preference hydrates and notifies without inventing an API', () => {
  resetEmergencyHighlightForTest();
  const seen = [];
  const unsubscribe = subscribeEmergencyHighlightEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getEmergencyHighlightEnabled(), true);
    const storage = memoryStorage({ 'meridian.emergencyHighlight': '0' });
    assert.equal(hydrateEmergencyHighlightEnabled(storage), false);
    assert.equal(getEmergencyHighlightEnabled(), false);
    assert.deepEqual(storage.snapshot(), { 'meridian.emergencyHighlight': '0' });

    assert.equal(setEmergencyHighlightEnabled(true, { storage }), true);
    assert.equal(storage.snapshot()['meridian.emergencyHighlight'], '1');
    assert.deepEqual(seen, [false, true]);
  } finally {
    unsubscribe();
    resetEmergencyHighlightForTest();
  }
});

test('DISPLAY ships an Emergency highlight toggle; click still tracks', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const flights = data('flights.js');
  const military = data('militaryFlights.js');
  const moduleSource = data('emergencySquawk.js');

  assert.match(
    html,
    /class="pp-toggle-btn active" id="emergency-highlight-toggle" aria-pressed="true"/,
    'index.html: Emergency paints lit on first paint, matching the default ON',
  );
  assert.match(html, /id="emergency-highlight-toggle"[\s\S]*?<span class="pp-label">Emergency<\/span>/);
  assert.equal((html.match(/id="emergency-highlight-toggle"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-cockpit-display-slot="emergency"/);

  const persist = ui.slice(
    ui.indexOf('_initEmergencyHighlightToggle() {'),
    ui.indexOf('_initHUDToggle() {'),
  );
  assert.match(persist, /hydrateEmergencyHighlightEnabled/);
  assert.match(persist, /setEmergencyHighlightEnabled\(!this\._emergencyHighlightEnabled/);
  assert.doesNotMatch(persist, /fetch\(|\/api\//);
  assert.doesNotMatch(persist, /untrack|clearTracking|selectedFlightsTrackingId|selectedMilitaryTrackingId/);

  assert.match(flights, /normalizeSquawk\(state\[14\]\)/);
  assert.match(flights, /shouldPaintEmergencyHighlight/);
  assert.match(military, /normalizeSquawk\(aircraft\?\.squawk\)/);
  assert.match(military, /shouldPaintEmergencyHighlight/);
  assert.match(flights, /bindTrackingClickGesture/);
  assert.match(military, /bindTrackingClickGesture/);
  assert.doesNotMatch(moduleSource, /untrack|track_entity|bindTrackingClickGesture/);
});

test('client-side only: no \/api, OpenSky, Google News, or invented incidents', () => {
  const moduleSource = data('emergencySquawk.js');
  const uiInit = src('ui.js');
  assert.doesNotMatch(moduleSource, /\/api\//);
  assert.doesNotMatch(moduleSource, /opensky-network|news\.google|telegeography|quantum-earth/i);
  assert.doesNotMatch(moduleSource, /fetch\(|XMLHttpRequest|EventSource/);
  assert.match(moduleSource, /not an alert service/);
  assert.match(moduleSource, /current payload field only/);
  assert.doesNotMatch(uiInit.slice(
    uiInit.indexOf('_initEmergencyHighlightToggle() {'),
    uiInit.indexOf('_initHUDToggle() {'),
  ), /opensky-network|news\.google|\/api\//i);
});

test('legal: public squawk only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('emergencySquawk.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth/i);
  assert.match(html, /Not a verified emergency/);
  assert.match(html, /Public squawk field only/);
});
