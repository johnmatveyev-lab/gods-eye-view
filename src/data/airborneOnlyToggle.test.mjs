import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Cesium from 'cesium';
import flightsLayer, {
  _addFlightTrackingCandidateForTest,
  _applyOperatorContactVisibilityForTest,
  _setTrackedFlightRefreshStateForTest,
} from './flights.js';
import militaryFlightsLayer, {
  _addMilitaryTrackingCandidateForTest,
  _applyOperatorContactVisibilityForTest as _applyMilitaryOperatorContactVisibilityForTest,
  _setTrackedMilitaryRefreshStateForTest,
} from './militaryFlights.js';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
  normalizeLayerState,
} from './layerState.js';
import { setAltitudeBand } from './flightAltitudeBand.js';

const uiSource = fs.readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
const indexHtml = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const flightsSource = fs.readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
const militarySource = fs.readFileSync(new URL('./militaryFlights.js', import.meta.url), 'utf8');
const apiFiles = fs.readdirSync(new URL('../../api', import.meta.url), { withFileTypes: true });

const GROUND_SCALE = 0.8;

function billboard({ show = true, scale = 1 } = {}) {
  return {
    show,
    scale,
    width: 20,
    height: 20,
    color: Cesium.Color.WHITE,
    rotation: 0,
  };
}

function viewerStub() {
  return {
    isDestroyed: () => false,
    entities: { remove() {} },
    scene: { requestRender() {} },
  };
}

function seedCivilFleet() {
  const parked = billboard({ scale: GROUND_SCALE });
  const taxi = billboard({ scale: GROUND_SCALE });
  const air = billboard({ scale: 1 });
  const tracked = billboard({ scale: 1 });
  _setTrackedFlightRefreshStateForTest({
    icao24: 'aaa001',
    entity: { billboard: {} },
    meta: { klass: 'airliner', onGround: false },
    billboard: tracked,
    billboardCollection: { show: true },
    viewer: viewerStub(),
    tracked: true,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'aaa010',
    meta: { klass: 'airliner', onGround: true },
    billboard: parked,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'aaa011',
    meta: { klass: 'airliner', onGround: true },
    billboard: taxi,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'aaa012',
    meta: { klass: 'airliner', onGround: false },
    billboard: air,
  });
  return { parked, taxi, air, tracked };
}

function seedMilitaryFleet() {
  const parked = billboard({ scale: GROUND_SCALE });
  const air = billboard({ scale: 1 });
  _setTrackedMilitaryRefreshStateForTest({
    icao24: 'adf001',
    entity: { billboard: {} },
    meta: { klass: 'fastjet', onGround: false },
    billboard: air,
    billboardCollection: { show: true },
    viewer: viewerStub(),
    tracked: false,
  });
  _addMilitaryTrackingCandidateForTest({
    icao24: 'adf010',
    meta: { klass: 'fastjet', onGround: true },
    billboard: parked,
  });
  return { parked, air };
}

function resetCivil() {
  setAltitudeBand('all', { persist: false });
  flightsLayer.setParams({ airborneOnly: false, speedMinKt: null, speedMaxKt: null, callsignPrefixes: '' });
  _setTrackedFlightRefreshStateForTest({
    icao24: 'reset00',
    entity: null,
    meta: { onGround: false },
    billboard: billboard(),
    billboardCollection: { show: true },
    viewer: viewerStub(),
    tracked: false,
  });
}

function resetMilitary() {
  militaryFlightsLayer.setParams({ airborneOnly: false, callsignPrefixes: '' });
  _setTrackedMilitaryRefreshStateForTest({
    icao24: 'reset00',
    entity: null,
    meta: { onGround: false },
    billboard: billboard(),
    billboardCollection: { show: true },
    viewer: viewerStub(),
    tracked: false,
  });
}

test('DISPLAY ships an Airborne only toggle that is default-off', () => {
  assert.match(
    indexHtml,
    /id="airborne-only-toggle"[^>]*aria-pressed="false"/,
    'index.html: Airborne only paints unpressed on first paint',
  );
  assert.match(indexHtml, /id="airborne-only-toggle"[\s\S]*?<span class="pp-label">Airborne only<\/span>/);
  assert.equal((indexHtml.match(/id="airborne-only-toggle"/g) || []).length, 1);
  assert.doesNotMatch(indexHtml, /class="pp-toggle-btn active" id="airborne-only-toggle"/);
  assert.doesNotMatch(indexHtml, /data-cockpit-display-slot="airborne"/);
  assert.match(uiSource, /this\._airborneOnly = false;/);
  assert.match(uiSource, /_initAirborneOnlyToggle/);
  assert.match(uiSource, /setLayerParams\('flights', \{ airborneOnly:/);
  assert.match(uiSource, /setLayerParams\('military', \{ airborneOnly:/);
});

test('both flight layers persist airborneOnly with existing flight options and use onGround only', () => {
  const defaults = createDefaultLayerState().options.flights;
  assert.equal(defaults.airborneOnly, false);
  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { airborneOnly: true } },
  }));
  assert.match(String(encodedOn.get('lo')), /f\.a\.1/);
  const decoded = decodeLayerStateParams(encodedOn);
  assert.equal(decoded.options.flights.airborneOnly, true);
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(omitted.options.flights.airborneOnly, false,
    'an absent token keeps the historical off meaning');

  assert.match(flightsSource, /from '\.\/flightOperatorFilters\.js'/);
  assert.match(militarySource, /from '\.\/flightOperatorFilters\.js'/);
  assert.match(flightsSource, /passesAirborneOnlyFilter/);
  assert.match(militarySource, /passesAirborneOnlyFilter/);
  assert.match(flightsSource, /_airborneOnlyMatcher/);
  assert.match(militarySource, /_airborneOnlyMatcher/);
  assert.match(flightsSource, /andMatchers: \[_altitudeAndMatcher, _headingAndMatcher, _hideStaleAndMatcher, _classAndMatcher, _prefixAndMatcher, _airborneOnlyMatcher\]/);
  assert.match(militarySource, /andMatchers: \[_headingAndMatcher, _hideStaleAndMatcher, _classAndMatcher, _prefixAndMatcher, _airborneOnlyMatcher\]/);
  assert.match(flightsSource, /onGround: info\?\.onGround === true/);
  assert.match(militarySource, /onGround: info\?\.onGround === true/);
  assert.doesNotMatch(uiSource, /\/api\/.*airborne/);
  assert.equal(apiFiles.some((entry) => /airborne|watchlist|squawk/i.test(entry.name)), false,
    'no new airborne/watchlist/squawk endpoints');
});

test('toggle on hides parked and taxi contacts and keeps airborne; off restores grounded style', () => {
  resetCivil();
  const { parked, taxi, air, tracked } = seedCivilFleet();
  try {
    assert.equal(flightsLayer.getParams().airborneOnly, false);
    assert.equal(parked.show, true);
    assert.equal(taxi.show, true);
    assert.equal(air.show, true);

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(flightsLayer.getParams().airborneOnly, true);
    assert.equal(parked.show, false, 'parked contact is skipped');
    assert.equal(taxi.show, false, 'taxi contact is skipped');
    assert.equal(air.show, true, 'airborne remains');
    assert.equal(tracked.show, true, 'tracked airborne remains');
    assert.equal(parked.scale, GROUND_SCALE, 'hide does not restyle grounded');

    flightsLayer.setParams({ airborneOnly: false });
    assert.equal(parked.show, true);
    assert.equal(taxi.show, true);
    assert.equal(air.show, true);
    assert.equal(parked.scale, GROUND_SCALE, 'grounded return at current grounded style');
    assert.equal(taxi.scale, GROUND_SCALE);
  } finally {
    resetCivil();
  }
});

test('a tracked contact that lands stays visible until untracked', () => {
  resetCivil();
  const landed = billboard({ scale: GROUND_SCALE });
  _setTrackedFlightRefreshStateForTest({
    icao24: 'landed1',
    entity: { billboard: {} },
    meta: { klass: 'airliner', onGround: true },
    billboard: landed,
    billboardCollection: { show: true },
    viewer: viewerStub(),
    tracked: true,
  });
  try {
    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(landed.show, true, 'follow does not vanish on landing');
    assert.equal(landed.scale, GROUND_SCALE);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(landed.show, false, 'untracked landed contact hides');
    assert.equal(landed.scale, GROUND_SCALE, 'untrack restore keeps grounded style');
  } finally {
    resetCivil();
  }
});

test('military layer honors the same airborne-only toggle', () => {
  resetMilitary();
  const { parked, air } = seedMilitaryFleet();
  try {
    assert.equal(militaryFlightsLayer.getParams().airborneOnly, false);
    militaryFlightsLayer.setParams({ airborneOnly: true });
    assert.equal(militaryFlightsLayer.getParams().airborneOnly, true);
    assert.equal(parked.show, false);
    assert.equal(air.show, true);
    assert.equal(parked.scale, GROUND_SCALE);

    militaryFlightsLayer.setParams({ airborneOnly: false });
    assert.equal(parked.show, true);
    assert.equal(air.show, true);
    assert.equal(parked.scale, GROUND_SCALE);
    _applyMilitaryOperatorContactVisibilityForTest();
    assert.equal(parked.show, true);
  } finally {
    resetMilitary();
  }
});

test('airborne-only ANDs with the flights altitude band', () => {
  resetCivil();
  const parked = billboard({ scale: GROUND_SCALE });
  const low = billboard();
  const high = billboard();
  _addFlightTrackingCandidateForTest({
    icao24: 'and010',
    meta: { klass: 'airliner', onGround: true, altitude: 0 },
    billboard: parked,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'and011',
    meta: { klass: 'airliner', onGround: false, altitude: 2000 },
    billboard: low,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'and012',
    meta: { klass: 'airliner', onGround: false, altitude: 12_000 },
    billboard: high,
  });
  try {
    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(parked.show, false, 'grounded hide under airborne-only even in All');
    assert.equal(low.show, true);
    assert.equal(high.show, true);

    setAltitudeBand('lt10k', { persist: false });
    assert.equal(parked.show, false, 'AND: grounded stay hidden in the pattern band');
    assert.equal(low.show, true, 'AND: in-band airborne remain');
    assert.equal(high.show, false, 'AND: out-of-band airborne hide');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ airborneOnly: false });
    assert.equal(parked.show, true, 'toggle off restores grounded at current style');
    assert.equal(parked.scale, GROUND_SCALE);
    assert.equal(low.show, true);
    assert.equal(high.show, true);
  } finally {
    resetCivil();
  }
});

test('airborne-only ANDs with the airline callsign prefix filter', () => {
  resetCivil();
  const parkedUal = billboard({ scale: GROUND_SCALE });
  const ualAir = billboard();
  const aalAir = billboard();
  _addFlightTrackingCandidateForTest({
    icao24: 'pre010',
    meta: { klass: 'airliner', onGround: true, callsign: 'UAL100' },
    billboard: parkedUal,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'pre011',
    meta: { klass: 'airliner', onGround: false, callsign: 'UAL101' },
    billboard: ualAir,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'pre012',
    meta: { klass: 'airliner', onGround: false, callsign: 'AAL200' },
    billboard: aalAir,
  });
  try {
    flightsLayer.setParams({ airborneOnly: true, callsignPrefixes: 'UAL' });
    assert.equal(parkedUal.show, false, 'AND: grounded UAL hide under airborne-only');
    assert.equal(ualAir.show, true, 'AND: matching airborne remain');
    assert.equal(aalAir.show, false, 'AND: non-matching airborne hide');
  } finally {
    resetCivil();
  }
});

test('airborne-only ANDs with the ground-speed band and does not punch through emergency paint', () => {
  resetCivil();
  const parked = billboard({ scale: GROUND_SCALE });
  const cruise = billboard();
  _addFlightTrackingCandidateForTest({
    icao24: 'spd010',
    meta: { klass: 'airliner', onGround: true, altitude: 0, velocity: 8 },
    billboard: parked,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'spd011',
    meta: { klass: 'airliner', onGround: false, altitude: 8000, velocity: 120 },
    billboard: cruise,
  });
  try {
    flightsLayer.setParams({ airborneOnly: true, speedMinKt: 50, speedMaxKt: 500 });
    assert.equal(parked.show, false, 'AND: grounded hide even when speed is in-band');
    assert.equal(cruise.show, true, 'AND: in-band airborne remain');
    assert.match(flightsSource, /Emergency squawk does not punch through this hide/);
    assert.doesNotMatch(indexHtml, /data-cockpit-display-slot="airborne"/);
  } finally {
    resetCivil();
  }
});
