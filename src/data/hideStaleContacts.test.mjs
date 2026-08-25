import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
  layerOptionsForRestore,
} from './layerState.js';
import {
  getHideStaleEnabled,
  passesHideStaleFilter,
  passesInFlightFilters,
  resetHideStaleEnabledForTest,
  setHideStaleEnabled,
  setHeadingSectors,
  _resetHeadingSectorsForTest,
} from './inFlightFilters.js';
import { resetAltitudeBandForTest, setAltitudeBand } from './flightAltitudeBand.js';
import flightsLayer, {
  _addFlightTrackingCandidateForTest,
  _setFlightFeedHealthForTest,
  _setTrackedFlightRefreshStateForTest,
} from './flights.js';
import militaryFlightsLayer, {
  _addMilitaryTrackingCandidateForTest,
  _setMilitaryFeedHealthForTest,
  _setTrackedMilitaryRefreshStateForTest,
} from './militaryFlights.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function encode(state) {
  return encodeLayerStateParams(new URLSearchParams({ v: '2' }), state).toString();
}

function billboard(show = true) {
  return {
    position: Cesium.Cartesian3.fromDegrees(-97.71, 30.21, 10_668),
    color: Cesium.Color.WHITE.clone(),
    show,
    width: 20,
    height: 20,
    scale: 1,
    rotation: 0,
  };
}

function modelVisual(show = true) {
  return { ready: true, show, computedScale: 1, modelMatrix: new Cesium.Matrix4() };
}

function seedCommercial({ trackedIcao = null, contacts }) {
  const first = contacts[0];
  _setTrackedFlightRefreshStateForTest({
    icao24: first.icao24,
    entity: trackedIcao === first.icao24 ? { billboard: { image: '' } } : null,
    billboard: first.billboard,
    billboardCollection: { show: true, remove() {} },
    viewer: { camera: { positionCartographic: null }, scene: { requestRender() {} }, entities: { remove() {} } },
    tracked: trackedIcao === first.icao24,
    models: first.model ? [[first.icao24, first.model]] : [],
    meta: {
      callsign: first.callsign || first.icao24,
      altitude: 10_668,
      klass: 'airliner',
      onGround: false,
      velocity: first.velocity ?? 128.6,
      true_track: first.true_track ?? 90,
    },
  });
  for (const contact of contacts.slice(1)) {
    _addFlightTrackingCandidateForTest({
      icao24: contact.icao24,
      meta: {
        callsign: contact.callsign || contact.icao24,
        altitude: 11_000,
        klass: 'airliner',
        onGround: false,
        velocity: contact.velocity ?? 128.6,
        true_track: contact.true_track ?? 90,
      },
      billboard: contact.billboard,
    });
    if (contact.model) {
      // Candidate helper does not accept models; layer tests that need a second
      // model go through the first-contact seed only.
    }
  }
  if (trackedIcao && trackedIcao !== first.icao24) {
    flightsLayer.setParams({ selectedFlightsTrackingId: trackedIcao });
  }
}

function seedMilitary({ trackedIcao = null, contacts }) {
  const first = contacts[0];
  _setTrackedMilitaryRefreshStateForTest({
    icao24: first.icao24,
    entity: trackedIcao === first.icao24 ? { billboard: { image: '' } } : null,
    billboard: first.billboard,
    billboardCollection: { show: true, remove() {} },
    viewer: { camera: { positionCartographic: null }, scene: { requestRender() {} }, entities: { remove() {} } },
    tracked: trackedIcao === first.icao24,
    models: first.model ? [[first.icao24, first.model]] : [],
    meta: {
      callsign: first.callsign || first.icao24,
      altitudeFt: 28_000,
      klass: 'fighter',
      onGround: false,
      speedMps: first.speedMps ?? 128.6,
    },
  });
  for (const contact of contacts.slice(1)) {
    _addMilitaryTrackingCandidateForTest({
      icao24: contact.icao24,
      meta: {
        callsign: contact.callsign || contact.icao24,
        altitudeFt: 30_000,
        klass: 'fighter',
        onGround: false,
        speedMps: contact.speedMps ?? 128.6,
      },
      billboard: contact.billboard,
    });
  }
}

function nearbyIds(layer, billboard) {
  return layer.getNearby(billboard.position, 250_000, 50).map((row) => row.icao24);
}

function detectedIds(layer) {
  return layer.getDetectableObjects({ maxCount: 50 }).map((row) => row.sourceId);
}

afterEach(() => {
  resetHideStaleEnabledForTest();
  resetAltitudeBandForTest();
  _resetHeadingSectorsForTest();
  flightsLayer.setParams({
    speedMinKt: null,
    speedMaxKt: null,
    headingSectors: 'NESW',
  });
  militaryFlightsLayer.setParams({ speedMinKt: null, speedMaxKt: null });
});

test('hide stale defaults off and is not missing-polls-or-backoff', () => {
  resetHideStaleEnabledForTest();
  assert.equal(getHideStaleEnabled(), false);
  const missing = new Map([['abc123', 1]]);
  assert.equal(passesHideStaleFilter({
    icao24: 'abc123',
    hideStale: false,
    missingPolls: missing,
  }), true);
  assert.equal(passesHideStaleFilter({
    icao24: 'abc123',
    hideStale: true,
    missingPolls: missing,
  }), false);
  assert.equal(passesHideStaleFilter({
    icao24: 'live01',
    hideStale: true,
    missingPolls: missing,
    backoff: true,
  }), true, 'global 429/backoff must not hide a live contact');
  assert.equal(passesHideStaleFilter({
    icao24: 'abc123',
    hideStale: true,
    missingPolls: missing,
    trackedIcao: 'abc123',
  }), true, 'tracked stale contact stays visible');
});

test('passesInFlightFilters ANDs hide stale with sibling 92-98 predicates when present', () => {
  resetHideStaleEnabledForTest();
  const live = { icao24: 'live01', hideStale: true, missingPolls: new Map() };
  assert.equal(passesInFlightFilters(live), true);
  assert.equal(passesInFlightFilters(live, {
    module: {
      passesWatchlistFilter: () => false,
    },
  }), false, 'watchlist (92) ANDs when present');
  assert.equal(passesInFlightFilters(live, {
    module: {
      passesAltitudeBandFilter: () => true,
      passesEmergencySquawkFilter: () => true,
      passesAirborneOnlyFilter: () => true,
      passesSpeedBandFilter: () => true,
      passesVerticalRateFilter: () => true,
      passesClassChipFilter: () => false,
    },
  }), false, 'class chips (98) ANDs when present');
});

test('Hide stale on skips coasting ghosts and keeps live contacts', () => {
  resetHideStaleEnabledForTest();
  const live = billboard();
  const stale = billboard();
  seedCommercial({
    contacts: [
      { icao24: 'live01', billboard: live, callsign: 'LIVE01' },
      { icao24: 'ghost1', billboard: stale, callsign: 'GHOST1' },
    ],
  });
  _setFlightFeedHealthForTest({ missingPolls: new Map([['ghost1', 2]]), backoff: false });
  assert.equal(flightsLayer.setParams({ hideStale: true }), true);
  assert.equal(stale.show, false);
  assert.equal(live.show, true);
  assert.deepEqual(nearbyIds(flightsLayer, live).sort(), ['live01']);
  assert.ok(!detectedIds(flightsLayer).includes('ghost1'));
  assert.ok(detectedIds(flightsLayer).includes('live01'));
});

test('Hide stale off restores the 45% fade path instead of hiding', () => {
  resetHideStaleEnabledForTest();
  const stale = billboard();
  seedCommercial({
    contacts: [{ icao24: 'ghost1', billboard: stale, callsign: 'GHOST1' }],
  });
  _setFlightFeedHealthForTest({ missingPolls: new Map([['ghost1', 1]]) });
  flightsLayer.setParams({ hideStale: true });
  assert.equal(stale.show, false);
  flightsLayer.setParams({ hideStale: false });
  assert.equal(stale.show, true);
  assert.equal(getHideStaleEnabled(), false);
  const flightsSrc = read('src/data/flights.js');
  const militarySrc = read('src/data/militaryFlights.js');
  assert.match(flightsSrc, /baseAlpha:\s*_missingPolls\.get\(icao24\) \? 0\.45 : 1/);
  assert.match(militarySrc, /baseAlpha:\s*_missingPolls\.get\(icao24\) \? 0\.45 : 1/);
});

test('a simulated backoff/429 does not hide the live fleet', () => {
  resetHideStaleEnabledForTest();
  const live = billboard();
  const liveModel = modelVisual(true);
  seedCommercial({
    contacts: [{ icao24: 'live01', billboard: live, model: liveModel, callsign: 'LIVE01' }],
  });
  _setFlightFeedHealthForTest({ missingPolls: new Map(), backoff: true });
  flightsLayer.setParams({ hideStale: true });
  assert.equal(live.show, true);
  assert.equal(liveModel.show, true);
  assert.ok(nearbyIds(flightsLayer, live).includes('live01'));
});

test('tracked stale contact stays visible until untracked', () => {
  resetHideStaleEnabledForTest();
  const trackedBb = billboard(false);
  const ghost = billboard();
  seedCommercial({
    trackedIcao: 'trk001',
    contacts: [
      { icao24: 'trk001', billboard: trackedBb, callsign: 'TRK001' },
      { icao24: 'ghost1', billboard: ghost, callsign: 'GHOST1' },
    ],
  });
  _setFlightFeedHealthForTest({
    missingPolls: new Map([['trk001', 2], ['ghost1', 1]]),
  });
  flightsLayer.setParams({ hideStale: true });
  assert.equal(ghost.show, false);
  assert.ok(
    nearbyIds(flightsLayer, trackedBb).includes('trk001')
      || flightsLayer.getParams().selectedFlightsTrackingId === 'trk001',
    'tracked identity remains selected while stale',
  );
  flightsLayer.setParams({ selectedFlightsTrackingId: null });
  assert.equal(trackedBb.show, false, 'untracked stale ghost hides once Hide stale is on');
});

test('military layer honors the same Hide stale toggle', () => {
  resetHideStaleEnabledForTest();
  const live = billboard();
  const stale = billboard();
  seedMilitary({
    contacts: [
      { icao24: 'ae0001', billboard: live, callsign: 'RCH001' },
      { icao24: 'ae0002', billboard: stale, callsign: 'RCH002' },
    ],
  });
  _setMilitaryFeedHealthForTest({ missingPolls: new Map([['ae0002', 2]]) });
  assert.equal(militaryFlightsLayer.setParams({ hideStale: true }), true);
  assert.equal(getHideStaleEnabled(), true, 'one shared flights option, both layers');
  assert.equal(stale.show, false);
  assert.equal(live.show, true);
  assert.deepEqual(nearbyIds(militaryFlightsLayer, live), ['ae0001']);
  militaryFlightsLayer.setParams({ hideStale: false });
  assert.equal(stale.show, true);
});

test('Hide stale ANDs with the landed altitude band (PLAN 93)', () => {
  resetHideStaleEnabledForTest();
  resetAltitudeBandForTest();
  const highLive = billboard();
  const highStale = billboard();
  seedCommercial({
    contacts: [
      { icao24: 'high01', billboard: highLive, callsign: 'HIGH01' },
      { icao24: 'high02', billboard: highStale, callsign: 'HIGH02' },
    ],
  });
  _setFlightFeedHealthForTest({ missingPolls: new Map([['high02', 1]]) });
  setAltitudeBand('gt30k', { persist: false });
  flightsLayer.setParams({ hideStale: true });
  assert.equal(highLive.show, true, 'in-band live contact remains');
  assert.equal(highStale.show, false, 'in-band stale ghost is still hidden');
  setAltitudeBand('surface', { persist: false });
  assert.equal(highLive.show, false, 'altitude band still hides airborne contacts');
  assert.equal(highStale.show, false, 'stale ghost stays hidden under AND');
});

test('Hide stale ANDs with the landed ground-speed band (PLAN 96)', () => {
  resetHideStaleEnabledForTest();
  const cruiseLive = billboard();
  const cruiseStale = billboard();
  seedCommercial({
    contacts: [
      { icao24: 'spd001', billboard: cruiseLive, callsign: 'SPD001' },
      { icao24: 'spd002', billboard: cruiseStale, callsign: 'SPD002' },
    ],
  });
  _setFlightFeedHealthForTest({ missingPolls: new Map([['spd002', 1]]) });
  flightsLayer.setParams({ hideStale: true });
  assert.equal(cruiseLive.show, true, 'in-band live contact remains');
  assert.equal(cruiseStale.show, false, 'in-band stale ghost is still hidden');
  flightsLayer.setParams({ speedMinKt: 400, speedMaxKt: null });
  assert.equal(cruiseLive.show, false, 'speed band still hides slower live contacts');
  assert.equal(cruiseStale.show, false, 'stale ghost stays hidden under AND');
});

test('Hide stale ANDs with landed heading sectors (PLAN 101)', () => {
  resetHideStaleEnabledForTest();
  const eastLive = billboard();
  const eastStale = billboard();
  seedCommercial({
    contacts: [
      { icao24: 'east01', billboard: eastLive, callsign: 'EAST01', true_track: 90 },
      { icao24: 'east02', billboard: eastStale, callsign: 'EAST02', true_track: 90 },
    ],
  });
  _setFlightFeedHealthForTest({ missingPolls: new Map([['east02', 1]]) });
  flightsLayer.setParams({ hideStale: true });
  assert.equal(eastLive.show, true, 'eastbound live contact remains');
  assert.equal(eastStale.show, false, 'eastbound stale ghost is still hidden');
  setHeadingSectors('W');
  flightsLayer.setParams({ headingSectors: 'W' });
  assert.equal(eastLive.show, false, 'heading sector still hides eastbound live contacts');
  assert.equal(eastStale.show, false, 'stale ghost stays hidden under AND');
});

test('Hide stale persists on existing flight layer options and paints as a chip', () => {
  resetHideStaleEnabledForTest();
  const defaults = createDefaultLayerState().options.flights;
  assert.equal(defaults.hideStale, false);
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(omitted.options.flights.hideStale, false, 'absent token stays OFF');

  const on = createDefaultLayerState();
  on.enabledLayerIds = ['flights', 'military'];
  on.options.flights = { ...on.options.flights, hideStale: true };
  const encoded = encode(on);
  assert.match(encoded, /f\.g\.1/, 'ON is written explicitly on the flights option owner');
  const decoded = decodeLayerStateParams(new URLSearchParams(encoded));
  assert.equal(decoded.options.flights.hideStale, true);
  const restoredFlights = layerOptionsForRestore(decoded, 'flights');
  const restoredMilitary = layerOptionsForRestore(decoded, 'military');
  assert.equal(restoredFlights.hideStale, true);
  assert.equal(restoredMilitary.hideStale, true, 'military mirrors the flights option owner');

  resetHideStaleEnabledForTest();
  assert.equal(flightsLayer.getParams().hideStale, false);
  flightsLayer.setParams({ hideStale: true });
  assert.equal(flightsLayer.getParams().hideStale, true);
  assert.equal(militaryFlightsLayer.getParams().hideStale, true);

  const flightsChip = flightsLayer.getRowControls().chips.find((chip) => chip.id === 'hide-stale');
  const militaryChip = militaryFlightsLayer.getRowControls().chips.find((chip) => chip.id === 'hide-stale');
  assert.equal(flightsChip.label, 'Hide stale');
  assert.equal(flightsChip.active, true);
  assert.deepEqual(flightsChip.params, { hideStale: false });
  assert.equal(militaryChip.active, true);
  assert.deepEqual(militaryChip.params, { hideStale: false });
});

test('no new /api endpoints or poll / staleness heuristic', () => {
  const flightsSrc = read('src/data/flights.js');
  const militarySrc = read('src/data/militaryFlights.js');
  const filterSrc = read('src/data/inFlightFilters.js');
  const vite = read('vite.config.js');
  for (const source of [flightsSrc, militarySrc, filterSrc]) {
    assert.doesNotMatch(source, /\/api\/[a-z0-9-]*stale/);
    assert.doesNotMatch(source, /opensky-network\.org|news\.google\.com|telegeography|submarinecablemap/i);
    assert.doesNotMatch(source, /quantum-earth|God'?s Eye View/i);
  }
  assert.match(flightsSrc, /MISSING_POLL_LIMIT/);
  assert.match(flightsSrc, /staleCoastLimitSeconds/);
  assert.match(filterSrc, /_missingPolls|missingPolls/);
  assert.match(filterSrc, /never the global feed backoff|must not/);
  assert.doesNotMatch(vite, /hide-stale|hideStale/);
});
