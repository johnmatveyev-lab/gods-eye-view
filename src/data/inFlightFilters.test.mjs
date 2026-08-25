import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import flightsLayer, {
  _addFlightTrackingCandidateForTest,
  _clearFlightFilterFixturesForTest,
  _setTrackedFlightIcaoForTest,
} from './flights.js';
import militaryFlightsLayer, {
  _addMilitaryTrackingCandidateForTest,
  _clearMilitaryFilterFixturesForTest,
  _setTrackedMilitaryIcaoForTest,
} from './militaryFlights.js';
import {
  DEFAULT_HEADING_SECTORS,
  HEADING_SECTORS,
  contactPassesInFlightFilters,
  contactTrueTrack,
  headingSectorChipModels,
  headingSectorFromTrueTrack,
  normalizeHeadingSectors,
  passesHeadingSectorFilter,
  toggleHeadingSector,
  _resetHeadingSectorsForTest,
  getHeadingSectors,
} from './inFlightFilters.js';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
  normalizeLayerState,
} from './layerState.js';
import {
  aircraftMatchesAltitudeBand,
  setAltitudeBand,
} from './flightAltitudeBand.js';
import {
  contactMatchesSpeedBand,
  contactPassesInFlightFilters as speedPassesInFlightFilters,
} from './flightSpeedBand.js';

function encode(state) {
  const params = new URLSearchParams([['v', '2']]);
  encodeLayerStateParams(params, state);
  return params.toString();
}

function contact(trueTrack, extra = {}) {
  return { true_track: trueTrack, ...extra };
}

test('heading sectors wrap 350° as N and split the compass into NESW', () => {
  assert.deepEqual(HEADING_SECTORS, ['N', 'E', 'S', 'W']);
  assert.equal(headingSectorFromTrueTrack(350), 'N');
  assert.equal(headingSectorFromTrueTrack(0), 'N');
  assert.equal(headingSectorFromTrueTrack(44.9), 'N');
  assert.equal(headingSectorFromTrueTrack(45), 'E');
  assert.equal(headingSectorFromTrueTrack(90), 'E');
  assert.equal(headingSectorFromTrueTrack(134.9), 'E');
  assert.equal(headingSectorFromTrueTrack(135), 'S');
  assert.equal(headingSectorFromTrueTrack(180), 'S');
  assert.equal(headingSectorFromTrueTrack(224.9), 'S');
  assert.equal(headingSectorFromTrueTrack(225), 'W');
  assert.equal(headingSectorFromTrueTrack(270), 'W');
  assert.equal(headingSectorFromTrueTrack(314.9), 'W');
  assert.equal(headingSectorFromTrueTrack(315), 'N');
  assert.equal(headingSectorFromTrueTrack(710), 'N');
  assert.equal(headingSectorFromTrueTrack(-10), 'N');
  assert.equal(headingSectorFromTrueTrack(Number.NaN), null);
  assert.equal(headingSectorFromTrueTrack(undefined), null);
  assert.equal(headingSectorFromTrueTrack(null), null);
});

test('E-only shows eastbound, W-only westbound, and all-on restores the current view', () => {
  const east = contact(90);
  const west = contact(270);
  const north = contact(350);
  const missing = contact(undefined);

  assert.equal(contactPassesInFlightFilters(east, { headingSectors: 'E' }), true);
  assert.equal(contactPassesInFlightFilters(west, { headingSectors: 'E' }), false);
  assert.equal(contactPassesInFlightFilters(north, { headingSectors: 'E' }), false);

  assert.equal(contactPassesInFlightFilters(west, { headingSectors: 'W' }), true);
  assert.equal(contactPassesInFlightFilters(east, { headingSectors: 'W' }), false);

  assert.equal(DEFAULT_HEADING_SECTORS, 'NESW');
  for (const heading of [90, 270, 350, 180]) {
    assert.equal(
      contactPassesInFlightFilters(contact(heading), { headingSectors: 'NESW' }),
      true,
      `${heading} stays visible when every sector is on`,
    );
  }
  assert.equal(contactPassesInFlightFilters(missing, { headingSectors: 'E' }), true);
  assert.equal(contactPassesInFlightFilters(contact(Number.NaN), { headingSectors: '' }), true);
  assert.equal(contactTrueTrack({ true_track: 90 }), 90);
  assert.equal(contactTrueTrack({ heading: 270 }), 270);
});

test('a tracked contact outside the selected sectors stays visible until untracked', () => {
  const westbound = contact(270, { icao24: 'aabbcc' });
  assert.equal(
    contactPassesInFlightFilters(westbound, { headingSectors: 'E' }, { trackedIcao: 'aabbcc' }),
    true,
  );
  assert.equal(
    contactPassesInFlightFilters(westbound, { headingSectors: 'E' }, { trackedIcao: null }),
    false,
  );
});

test('heading ANDs with other in-flight predicates when those plans are present', () => {
  const eastHigh = contact(90, { altitudeM: 11000, callsign: 'UAL100' });
  const eastLow = contact(90, { altitudeM: 300, callsign: 'UAL100' });
  const westHigh = contact(270, { altitudeM: 11000, callsign: 'UAL100' });

  const altitudeBand = (row) => aircraftMatchesAltitudeBand(row, 'gt30k');
  assert.equal(
    contactPassesInFlightFilters(eastHigh, { headingSectors: 'E', extraPredicates: [altitudeBand] }),
    true,
  );
  assert.equal(
    contactPassesInFlightFilters(eastLow, { headingSectors: 'E', extraPredicates: [altitudeBand] }),
    false,
    'eastbound still has to pass the PLAN 93 altitude band',
  );
  assert.equal(
    contactPassesInFlightFilters(westHigh, { headingSectors: 'E', extraPredicates: [altitudeBand] }),
    false,
    'a westbound high flyer still fails the heading chip',
  );

  const eastFast = contact(90, { velocity: 250 });
  const eastSlow = contact(90, { velocity: 40 });
  const westFast = contact(270, { velocity: 250 });
  const cruise = { minKt: 400 };
  const headingEast = (row) => passesHeadingSectorFilter(contactTrueTrack(row), 'E');
  assert.equal(contactMatchesSpeedBand(eastFast, cruise), true);
  assert.equal(
    speedPassesInFlightFilters(eastFast, { speedBand: cruise, andMatchers: [headingEast] }),
    true,
  );
  assert.equal(
    speedPassesInFlightFilters(eastSlow, { speedBand: cruise, andMatchers: [headingEast] }),
    false,
    'eastbound still has to pass the PLAN 96 speed band',
  );
  assert.equal(
    speedPassesInFlightFilters(westFast, { speedBand: cruise, andMatchers: [headingEast] }),
    false,
    'a westbound fast contact still fails the heading chip',
  );
});

test('chip models default all-on and toggle one sector at a time', () => {
  assert.equal(normalizeHeadingSectors('we'), 'EW');
  assert.equal(normalizeHeadingSectors({ N: true, E: false, S: true, W: true }), 'NSW');
  assert.equal(toggleHeadingSector('NESW', 'E'), 'NSW');
  assert.equal(toggleHeadingSector('NSW', 'E'), 'NESW');
  assert.equal(toggleHeadingSector('E', 'E'), '');

  const chips = headingSectorChipModels('NESW');
  assert.deepEqual(chips.map((chip) => chip.label), ['N', 'E', 'S', 'W']);
  assert.ok(chips.every((chip) => chip.active === true));
  assert.equal(chips.find((chip) => chip.id === 'heading-E').params.headingSectors, 'NSW');
});

test('commercial and military layers share the chips, persist them, and hide filtered contacts', () => {
  _resetHeadingSectorsForTest();
  _clearFlightFilterFixturesForTest();
  _clearMilitaryFilterFixturesForTest();

  try {
    assert.equal(getHeadingSectors(), 'NESW');
    assert.equal(flightsLayer.getParams().headingSectors, 'NESW');
    assert.equal(militaryFlightsLayer.getParams().headingSectors, 'NESW');

    const eastBb = { show: true };
    const westBb = { show: true };
    const missingBb = { show: true };
    const trackedWestBb = { show: true };
    _addFlightTrackingCandidateForTest({
      icao24: 'easta1',
      meta: { true_track: 90, callsign: 'AAL1' },
      billboard: eastBb,
    });
    _addFlightTrackingCandidateForTest({
      icao24: 'westa1',
      meta: { true_track: 270, callsign: 'AAL2' },
      billboard: westBb,
    });
    _addFlightTrackingCandidateForTest({
      icao24: 'none01',
      meta: { true_track: Number.NaN, callsign: 'UNK1' },
      billboard: missingBb,
    });
    _addFlightTrackingCandidateForTest({
      icao24: 'track1',
      meta: { true_track: 270, callsign: 'AAL9' },
      billboard: trackedWestBb,
    });

    const milEast = { show: true };
    const milWest = { show: true };
    _addMilitaryTrackingCandidateForTest({
      icao24: 'mileast',
      meta: { true_track: 80 },
      billboard: milEast,
    });
    _addMilitaryTrackingCandidateForTest({
      icao24: 'milwest',
      meta: { true_track: 260 },
      billboard: milWest,
    });

    _setTrackedFlightIcaoForTest('track1');
    assert.equal(flightsLayer.setParams({ headingSectors: 'E' }), true);
    assert.equal(flightsLayer.getParams().headingSectors, 'E');
    assert.equal(militaryFlightsLayer.getParams().headingSectors, 'E');
    assert.equal(eastBb.show, true);
    assert.equal(westBb.show, false);
    assert.equal(missingBb.show, true);
    assert.equal(trackedWestBb.show, true, 'tracked westbound stays up while E-only is selected');
    assert.equal(milEast.show, true);
    assert.equal(milWest.show, false, 'military layer honors the same chips');

    _setTrackedFlightIcaoForTest(null);
    flightsLayer.setParams({ headingSectors: 'E' });
    assert.equal(trackedWestBb.show, false, 'untracking a westbound contact hides it under E-only');

    flightsLayer.setParams({ headingSectors: 'NESW' });
    assert.equal(eastBb.show, true);
    assert.equal(westBb.show, true);
    assert.equal(milWest.show, true);

    const chips = flightsLayer.getRowControls().chips.filter((chip) => chip.id.startsWith('heading-'));
    const milChips = militaryFlightsLayer.getRowControls().chips.filter((chip) => chip.id.startsWith('heading-'));
    assert.equal(chips.length, 4);
    assert.equal(milChips.length, 4);
    assert.ok(chips.every((chip) => chip.active));
    assert.deepEqual(chips.map((chip) => chip.label), ['N', 'E', 'S', 'W']);

    flightsLayer.setParams({ headingSectors: 'W' });
    const armed = flightsLayer.getRowControls().chips.find((chip) => chip.id === 'heading-W');
    assert.equal(armed.active, true);
    assert.equal(flightsLayer.getRowControls().chips.find((chip) => chip.id === 'heading-E').active, false);
    assert.equal(militaryFlightsLayer.getRowControls().chips.find((chip) => chip.id === 'heading-W').active, true);

    const eastHighBb = { show: true };
    const eastLowBb = { show: true };
    _addFlightTrackingCandidateForTest({
      icao24: 'easthi',
      meta: { true_track: 90, altitude: 11000, callsign: 'UAL1' },
      billboard: eastHighBb,
    });
    _addFlightTrackingCandidateForTest({
      icao24: 'eastlo',
      meta: { true_track: 90, altitude: 300, callsign: 'UAL2' },
      billboard: eastLowBb,
    });
    flightsLayer.setParams({ headingSectors: 'E' });
    setAltitudeBand('gt30k', { persist: false });
    assert.equal(eastHighBb.show, true, 'eastbound above FL300 stays visible');
    assert.equal(eastLowBb.show, false, 'eastbound still has to pass PLAN 93 altitude');
    setAltitudeBand('all', { persist: false });
    assert.equal(eastLowBb.show, true, 'restoring All altitude shows the eastbound low flyer');

    const emergencyWestBb = { show: true };
    _addFlightTrackingCandidateForTest({
      icao24: 'em7700',
      meta: { true_track: 270, altitude: 11000, squawk: '7700', callsign: 'SOS1' },
      billboard: emergencyWestBb,
    });
    flightsLayer.setParams({ headingSectors: 'E' });
    assert.equal(emergencyWestBb.show, false, 'PLAN 94 highlight does not punch through heading hide');

    const eastFastBb = { show: true };
    const eastSlowBb = { show: true };
    _addFlightTrackingCandidateForTest({
      icao24: 'faste1',
      meta: { true_track: 90, altitude: 11000, velocity: 250, callsign: 'UAL3' },
      billboard: eastFastBb,
    });
    _addFlightTrackingCandidateForTest({
      icao24: 'slowe1',
      meta: { true_track: 90, altitude: 11000, velocity: 40, callsign: 'UAL4' },
      billboard: eastSlowBb,
    });
    flightsLayer.setParams({ headingSectors: 'E', speedMinKt: 400, speedMaxKt: null });
    assert.equal(eastFastBb.show, true, 'eastbound cruise stays visible under PLAN 96 min speed');
    assert.equal(eastSlowBb.show, false, 'eastbound still has to pass the PLAN 96 speed band');
    flightsLayer.setParams({ speedMinKt: null, speedMaxKt: null });
    assert.equal(eastSlowBb.show, true, 'clearing the speed band restores the eastbound slow flyer');
  } finally {
    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ speedMinKt: null, speedMaxKt: null, headingSectors: 'NESW' });
    _setTrackedFlightIcaoForTest(null);
    _setTrackedMilitaryIcaoForTest(null);
    _clearFlightFilterFixturesForTest();
    _clearMilitaryFilterFixturesForTest();
    _resetHeadingSectorsForTest();
  }
});

test('heading sectors persist on the existing flights option owner and add no API routes', () => {
  const defaults = createDefaultLayerState().options.flights;
  assert.equal(defaults.headingSectors, 'NESW');

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(omitted.options.flights.headingSectors, 'NESW');

  const eastOnly = normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { headingSectors: 'E', models3d: false } },
  });
  const encoded = encode(eastOnly);
  assert.match(encoded, /f\.h\.e/);
  assert.equal(decodeLayerStateParams(new URLSearchParams(encoded)).options.flights.headingSectors, 'E');

  const allOff = normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { headingSectors: '', models3d: false } },
  });
  const offEncoded = encode(allOff);
  assert.match(offEncoded, /f\.h\.-/);
  assert.equal(decodeLayerStateParams(new URLSearchParams(offEncoded)).options.flights.headingSectors, '');

  const apiDir = path.join(process.cwd(), 'api');
  const apiFiles = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else apiFiles.push(path.relative(apiDir, absolute).split(path.sep).join('/'));
    }
  };
  visit(apiDir);
  assert.equal(apiFiles.some((file) => /heading|sector/i.test(file)), false);
});
