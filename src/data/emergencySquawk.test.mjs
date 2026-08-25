import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  EMERGENCIES_ONLY_CHIP_ID,
  EMERGENCIES_ONLY_CHIP_LABEL,
  EMERGENCIES_ONLY_DEFAULT,
  EMERGENCY_HIGHLIGHT_CSS,
  EMERGENCY_HIGHLIGHT_DEFAULT,
  EMERGENCY_HIGHLIGHT_STORAGE_KEY,
  EMERGENCY_SQUAWKS,
  emergenciesOnlyChipModel,
  emergencyHighlightPaint,
  getEmergencyHighlightEnabled,
  hydrateEmergencyHighlightEnabled,
  isEmergencySquawk,
  normalizeEmergenciesOnly,
  normalizeEmergencyHighlightEnabled,
  normalizeSquawk,
  passesEmergenciesOnlyFilter,
  passesEmergencySquawkFilter,
  readEmergencyHighlightEnabled,
  resetEmergencyHighlightForTest,
  setEmergencyHighlightEnabled,
  shouldPaintEmergencyHighlight,
  subscribeEmergencyHighlightEnabled,
  writeEmergencyHighlightEnabled,
} from './emergencySquawk.js';
import flightsLayer, {
  _addFlightTrackingCandidateForTest,
  _applyOperatorContactVisibilityForTest,
  _contactIconColorForTest,
  _setTrackedFlightRefreshStateForTest,
} from './flights.js';
import militaryFlightsLayer, {
  _addMilitaryTrackingCandidateForTest,
  _militaryContactIconColorForTest,
  _setTrackedMilitaryRefreshStateForTest,
} from './militaryFlights.js';
import { normalizeAdsbLolAircraftState } from './adsbLolFallback.js';
import { aircraftMatchesAltitudeBand, setAltitudeBand } from './flightAltitudeBand.js';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
  normalizeLayerState,
} from './layerState.js';

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
  const highEmergency = { altitudeM: 37000 * 0.3048, onGround: false };
  assert.equal(aircraftMatchesAltitudeBand(highEmergency, 'surface'), false);
  assert.equal(aircraftMatchesAltitudeBand(highEmergency, 'gt30k'), true);

  const outOfBand = emergencyHighlightPaint({
    squawk: '7700',
    highlightEnabled: true,
    inAltitudeBand: aircraftMatchesAltitudeBand(highEmergency, 'surface'),
  });
  assert.equal(outOfBand.visible, false);
  assert.equal(outOfBand.highlighted, false);
  assert.equal(outOfBand.cssColor, null);
  assert.equal(shouldPaintEmergencyHighlight({
    squawk: '7500',
    highlightEnabled: true,
    inAltitudeBand: false,
  }), false);
  assert.equal(emergencyHighlightPaint({
    squawk: '7700',
    highlightEnabled: true,
    inAltitudeBand: aircraftMatchesAltitudeBand(highEmergency, 'gt30k'),
  }).highlighted, true);

  const moduleSource = data('emergencySquawk.js');
  const flights = data('flights.js');
  assert.match(moduleSource, /Altitude-band visibility still wins/);
  assert.match(moduleSource, /out-of-band contact stays hidden/);
  assert.match(flights, /inAltitudeBand: _inAltitudeBand\(icao24\)/);
  assert.match(flights, /Emergency squawk\s+does not punch through this hide/);
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
    ui.indexOf('_initKeepAboveToggle() {'),
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
    uiInit.indexOf('_initKeepAboveToggle() {'),
  ), /opensky-network|news\.google|\/api\//i);
});

test('Emergencies only defaults off and reuses isEmergencySquawk', () => {
  assert.equal(EMERGENCIES_ONLY_DEFAULT, false);
  assert.equal(normalizeEmergenciesOnly(undefined), false);
  assert.equal(normalizeEmergenciesOnly(null), false);
  assert.equal(normalizeEmergenciesOnly('nope'), false);
  assert.equal(normalizeEmergenciesOnly(false), false);
  assert.equal(normalizeEmergenciesOnly(true), true);
  assert.equal(normalizeEmergenciesOnly('1'), true);

  const mixed = [
    { icao24: 'e7500', squawk: '7500' },
    { icao24: 'e7600', squawk: 7600 },
    { icao24: 'e7700', squawk: '7700' },
    { icao24: 'vfr', squawk: '1200' },
    { icao24: 'missing', squawk: null },
    { icao24: 'blank', squawk: '' },
    { icao24: 'other', squawk: '1234' },
  ];
  for (const contact of mixed) {
    assert.equal(passesEmergenciesOnlyFilter({ squawk: contact.squawk, emergenciesOnly: false }), true);
    assert.equal(passesEmergencySquawkFilter(contact, { emergenciesOnly: false }), true);
  }
  assert.equal(passesEmergenciesOnlyFilter({ squawk: '7500', emergenciesOnly: true }), true);
  assert.equal(passesEmergenciesOnlyFilter({ squawk: 7600, emergenciesOnly: true }), true);
  assert.equal(passesEmergenciesOnlyFilter({ squawk: '7700', emergenciesOnly: true }), true);
  assert.equal(passesEmergenciesOnlyFilter({ squawk: '1200', emergenciesOnly: true }), false);
  assert.equal(passesEmergenciesOnlyFilter({ squawk: null, emergenciesOnly: true }), false);
  assert.equal(passesEmergenciesOnlyFilter({ squawk: '', emergenciesOnly: true }), false);
  assert.equal(passesEmergenciesOnlyFilter({ squawk: '1234', emergenciesOnly: true }), false);
  assert.equal(passesEmergencySquawkFilter({ squawk: '7700' }, { emergenciesOnly: true }), true);
  assert.equal(passesEmergencySquawkFilter({ squawk: '1200' }, { emergenciesOnly: true }), false);

  const helper = data('emergencySquawk.js');
  assert.match(helper, /return isEmergencySquawk\(squawk\)/);
  assert.doesNotMatch(helper, /['"]7500['"].*['"]7600['"].*['"]7700['"].*['"]7500['"]/);
  assert.equal(emergenciesOnlyChipModel(false).label, EMERGENCIES_ONLY_CHIP_LABEL);
  assert.equal(emergenciesOnlyChipModel(false).id, EMERGENCIES_ONLY_CHIP_ID);
  assert.equal(emergenciesOnlyChipModel(false).active, false);
  assert.deepEqual(emergenciesOnlyChipModel(false).params, { emergenciesOnly: true });
  assert.deepEqual(emergenciesOnlyChipModel(true).params, { emergenciesOnly: false });
});

test('layer off shows all; on keeps 7500/7600/7700 and hides missing/other', () => {
  const hijack = emptyBillboard();
  const radio = emptyBillboard();
  const general = emptyBillboard();
  const vfr = emptyBillboard();
  const missing = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'aa7500',
    meta: { squawk: '7500', klass: 'airliner', onGround: false },
    billboard: hijack,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'aa7600',
    meta: { squawk: '7600', klass: 'airliner', onGround: false },
    billboard: radio,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'aa7700',
    meta: { squawk: '7700', klass: 'airliner', onGround: false },
    billboard: general,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'aa1200',
    meta: { squawk: '1200', klass: 'airliner', onGround: false },
    billboard: vfr,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'aanone',
    meta: { klass: 'airliner', onGround: false },
    billboard: missing,
  });
  try {
    assert.equal(flightsLayer.getParams().emergenciesOnly, false);
    assert.equal(hijack.show, true);
    assert.equal(radio.show, true);
    assert.equal(general.show, true);
    assert.equal(vfr.show, true);
    assert.equal(missing.show, true);

    assert.equal(flightsLayer.setParams({ emergenciesOnly: true }), true);
    assert.equal(flightsLayer.getParams().emergenciesOnly, true);
    assert.equal(hijack.show, true);
    assert.equal(radio.show, true);
    assert.equal(general.show, true);
    assert.equal(vfr.show, false, 'other squawk hides');
    assert.equal(missing.show, false, 'missing squawk hides');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'aa1234',
      meta: { squawk: '1234', klass: 'airliner', onGround: false },
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().emergenciesOnly, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(general.show, true);

    flightsLayer.setParams({ emergenciesOnly: false });
    assert.equal(vfr.show, true);
    assert.equal(missing.show, true);
    assert.equal(extra.show, true);
  } finally {
    flightsLayer.setParams({ emergenciesOnly: false, selectedFlightsTrackingId: null });
  }
});

test('selected non-emergency stays visible when Emergencies only is on', () => {
  const selected = emptyBillboard();
  const vfr = emptyBillboard();
  const emergency = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'sel1200',
    meta: { squawk: '1200', klass: 'airliner', onGround: false },
    billboard: selected,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: true,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'aa1201',
    meta: { squawk: '1200', klass: 'airliner', onGround: false },
    billboard: vfr,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'aa7701',
    meta: { squawk: '7700', klass: 'airliner', onGround: false },
    billboard: emergency,
  });
  try {
    flightsLayer.setParams({ emergenciesOnly: true });
    assert.equal(selected.show, true, 'selected VFR contact stays');
    assert.equal(vfr.show, false);
    assert.equal(emergency.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked non-emergency hides');
    assert.equal(emergency.show, true);
  } finally {
    flightsLayer.setParams({ emergenciesOnly: false, selectedFlightsTrackingId: null });
  }
});

test('Emergencies only ANDs with existing flights filters', () => {
  setAltitudeBand('all', { persist: false });
  const lowEmergency = emptyBillboard();
  const highEmergency = emptyBillboard();
  const highVfr = emptyBillboard();
  const parkedEmergency = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'and7700',
    meta: {
      squawk: '7700',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      callsign: 'UAL100',
    },
    billboard: highEmergency,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'and7500',
    meta: {
      squawk: '7500',
      klass: 'airliner',
      onGround: false,
      altitude: 2000,
      callsign: 'UAL200',
    },
    billboard: lowEmergency,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'and1200',
    meta: {
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      callsign: 'UAL300',
    },
    billboard: highVfr,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andpark',
    meta: {
      squawk: '7700',
      klass: 'helicopter',
      onGround: true,
      altitude: 0,
      callsign: 'N123AB',
    },
    billboard: parkedEmergency,
  });
  try {
    flightsLayer.setParams({
      emergenciesOnly: true,
      airborneOnly: false,
      callsignPrefixes: '',
      aircraftClassFilter: 'all',
    });
    assert.equal(highEmergency.show, true);
    assert.equal(lowEmergency.show, true);
    assert.equal(highVfr.show, false);
    assert.equal(parkedEmergency.show, true);

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(highEmergency.show, true);
    assert.equal(parkedEmergency.show, false, 'AND: grounded emergency hides under airborne-only');

    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highEmergency.show, true, 'AND: in-band emergency remains');
    assert.equal(lowEmergency.show, false, 'AND: in-emergency but out-of-band hides');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ airborneOnly: false, callsignPrefixes: 'UAL' });
    assert.equal(highEmergency.show, true, 'AND: matching emergency remains');
    assert.equal(parkedEmergency.show, false, 'AND: prefix still hides a non-UAL emergency');

    flightsLayer.setParams({ callsignPrefixes: '', aircraftClassFilter: 'airliner' });
    assert.equal(highEmergency.show, true);
    assert.equal(parkedEmergency.show, false, 'AND: class chip still hides a helo emergency');
  } finally {
    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({
      emergenciesOnly: false,
      airborneOnly: false,
      callsignPrefixes: '',
      aircraftClassFilter: 'all',
      selectedFlightsTrackingId: null,
    });
  }
});

test('Emergencies only persists on flights.emergenciesOnly and paints as a chip', () => {
  const defaults = createDefaultLayerState().options.flights;
  assert.equal(defaults.emergenciesOnly, false);
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(omitted.options.flights.emergenciesOnly, false, 'absent token stays OFF');

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { emergenciesOnly: true } },
  }));
  assert.match(String(encodedOn.get('lo')), /f\.q\.1/);
  const decoded = decodeLayerStateParams(encodedOn);
  assert.equal(decoded.options.flights.emergenciesOnly, true);

  flightsLayer.setParams({ emergenciesOnly: false });
  assert.equal(flightsLayer.getParams().emergenciesOnly, false);
  flightsLayer.setParams({ emergenciesOnly: true });
  assert.equal(flightsLayer.getParams().emergenciesOnly, true);
  const chip = flightsLayer.getRowControls().chips.find((entry) => entry.id === EMERGENCIES_ONLY_CHIP_ID);
  assert.equal(chip.label, EMERGENCIES_ONLY_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { emergenciesOnly: false });
  flightsLayer.setParams({ emergenciesOnly: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === EMERGENCIES_ONLY_CHIP_ID).active, false);
});

test('Emergencies only does not change emergency paint', () => {
  resetEmergencyHighlightForTest();
  setEmergencyHighlightEnabled(true, { persist: false });
  try {
    _setTrackedFlightRefreshStateForTest({
      icao24: 'paint70',
      meta: { squawk: '7700', klass: 'large', onGround: false },
      billboard: emptyBillboard(),
      billboardCollection: {},
      viewer: emptyViewer(),
      entity: {},
      tracked: false,
    });
    _addFlightTrackingCandidateForTest({
      icao24: 'paint12',
      meta: { squawk: '1200', klass: 'small', onGround: false },
      billboard: emptyBillboard(),
    });
    const beforeEmergency = _contactIconColorForTest('paint70');
    const beforeVfr = _contactIconColorForTest('paint12');
    flightsLayer.setParams({ emergenciesOnly: true });
    assert.ok(beforeEmergency.equals(_contactIconColorForTest('paint70')));
    assert.ok(beforeVfr.equals(_contactIconColorForTest('paint12')));
    assert.ok(_contactIconColorForTest('paint70').equals(Cesium.Color.fromCssColorString(EMERGENCY_HIGHLIGHT_CSS)));
    assert.ok(_contactIconColorForTest('paint12').equals(Cesium.Color.WHITE));
  } finally {
    resetEmergencyHighlightForTest();
    flightsLayer.setParams({ emergenciesOnly: false, selectedFlightsTrackingId: null });
  }
});

test('Emergencies only is a flights-row chip: no DISPLAY rail, no new /api', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const flights = data('flights.js');
  const helper = data('emergencySquawk.js');
  const military = data('militaryFlights.js');
  assert.doesNotMatch(html, /emergencies-only|Emergencies only/);
  assert.doesNotMatch(ui, /emergenciesOnly|_initEmergenciesOnly/);
  assert.match(flights, /emergenciesOnlyChipModel\(_emergenciesOnly\)/);
  assert.match(flights, /passesEmergenciesOnlyFilter/);
  assert.match(flights, /_emergenciesOnlyMatcher/);
  assert.doesNotMatch(flights, /opensky-network|news\.google|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.doesNotMatch(military, /_emergenciesOnlyMatcher|emergenciesOnlyChipModel/);
  assert.match(flights, /shouldPaintEmergencyHighlight/);
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
