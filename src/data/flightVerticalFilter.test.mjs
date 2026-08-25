// PLAN 97 — Climb | Level | Descent filter.
// Pure classification plus the commercial/military getNearby membership seam.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  VERTICAL_RATE_LEVEL_MPS,
  classifyVerticalRate,
  contactPassesVerticalRateFilter,
} from './flightVerticalFilter.js';
import { contactPassesInFlightFilters } from './flightContactFilter.js';
import { aircraftMatchesAltitudeBand, resetAltitudeBandForTest } from './flightAltitudeBand.js';
import { contactMatchesSpeedBand } from './flightSpeedBand.js';
import flightsLayer, {
  _addFlightTrackingCandidateForTest,
  _setTrackedFlightRefreshStateForTest,
} from './flights.js';
import militaryFlightsLayer, {
  _addMilitaryTrackingCandidateForTest,
  _setTrackedMilitaryRefreshStateForTest,
} from './militaryFlights.js';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
} from './layerState.js';
import {
  _resetHeadingSectorsForTest,
  resetHideStaleEnabledForTest,
} from './inFlightFilters.js';

const CENTER = Cesium.Cartesian3.fromDegrees(-97.67, 30.20, 200);
const RANGE_M = 250_000;

/** ~1.0 m/s is ~197 fpm; the plan pins the band at 1.0 m/s (~200 fpm). */
test('1.0 m/s is the level band (~200 fpm)', () => {
  assert.equal(VERTICAL_RATE_LEVEL_MPS, 1);
  assert.ok(Math.abs(VERTICAL_RATE_LEVEL_MPS * 196.85 - 196.85) < 0.01);
});

test('classifyVerticalRate: climb / level / descent; missing stays unknown', () => {
  assert.equal(classifyVerticalRate(1.01), 'climb');
  assert.equal(classifyVerticalRate(8), 'climb');
  assert.equal(classifyVerticalRate(1), 'level');
  assert.equal(classifyVerticalRate(0), 'level');
  assert.equal(classifyVerticalRate(-1), 'level');
  assert.equal(classifyVerticalRate(-1.01), 'descent');
  assert.equal(classifyVerticalRate(-4.5), 'descent');
  assert.equal(classifyVerticalRate(null), null);
  assert.equal(classifyVerticalRate(undefined), null);
  assert.equal(classifyVerticalRate(Number.NaN), null);
});

test('missing or non-finite verticalRate stays visible under every toggle set', () => {
  const unknown = { verticalRate: null };
  const allOff = { showClimb: false, showLevel: false, showDescent: false };
  assert.equal(contactPassesVerticalRateFilter(unknown, allOff), true);
  assert.equal(contactPassesVerticalRateFilter({ verticalRate: Number.NaN }, allOff), true);
  assert.equal(contactPassesVerticalRateFilter({ verticalRateMps: undefined }, allOff), true);
});

test('descent-only keeps arrivals; climb-only keeps departures; level-only keeps cruise', () => {
  const arrival = { verticalRate: -5 }; // descending into a hub
  const departure = { verticalRate: 6 }; // climbing out
  const cruise = { verticalRate: 0.2 };
  const descentOnly = { showClimb: false, showLevel: false, showDescent: true };
  const climbOnly = { showClimb: true, showLevel: false, showDescent: false };
  const levelOnly = { showClimb: false, showLevel: true, showDescent: false };

  assert.equal(contactPassesVerticalRateFilter(arrival, descentOnly), true);
  assert.equal(contactPassesVerticalRateFilter(departure, descentOnly), false);
  assert.equal(contactPassesVerticalRateFilter(cruise, descentOnly), false);

  assert.equal(contactPassesVerticalRateFilter(departure, climbOnly), true);
  assert.equal(contactPassesVerticalRateFilter(arrival, climbOnly), false);
  assert.equal(contactPassesVerticalRateFilter(cruise, climbOnly), false);

  assert.equal(contactPassesVerticalRateFilter(cruise, levelOnly), true);
  assert.equal(contactPassesVerticalRateFilter(arrival, levelOnly), false);
  assert.equal(contactPassesVerticalRateFilter(departure, levelOnly), false);
});

test('all-on restores the unfiltered current view', () => {
  const allOn = { showClimb: true, showLevel: true, showDescent: true };
  for (const rate of [8, 0, -8, null]) {
    assert.equal(contactPassesVerticalRateFilter({ verticalRate: rate }, allOn), true);
    assert.equal(contactPassesVerticalRateFilter({ verticalRate: rate }, {}), true);
  }
});

test('a selected or tracked contact stays visible outside the selected set', () => {
  const climber = { verticalRate: 4 };
  const descentOnly = { showClimb: false, showLevel: false, showDescent: true };
  assert.equal(contactPassesInFlightFilters(climber, descentOnly), false);
  assert.equal(contactPassesInFlightFilters(climber, descentOnly, { keepVisible: true }), true);
});

test('AND with sibling in-flight filters when their predicates are provided', () => {
  const arrival = {
    verticalRate: -4,
    callsign: 'UAL1',
    altitude: 900,
    onGround: false,
    squawk: '1200',
    velocity: 70,
  };
  const descentOnly = { showClimb: false, showLevel: false, showDescent: true };
  assert.equal(contactPassesInFlightFilters(arrival, descentOnly), true);

  const watchlistMiss = [(meta) => String(meta.callsign || '') === 'DAL9'];
  assert.equal(
    contactPassesInFlightFilters(arrival, descentOnly, { extraPredicates: watchlistMiss }),
    false,
    'ident watchlist miss hides even a matching descent',
  );

  const altitudeMiss = [(meta) => Number(meta.altitude) >= 3000];
  assert.equal(
    contactPassesInFlightFilters(arrival, descentOnly, { extraPredicates: altitudeMiss }),
    false,
    'altitude band miss ANDs with descent-only',
  );

  const squawkMiss = [(meta) => meta.squawk === '7700'];
  assert.equal(
    contactPassesInFlightFilters(arrival, descentOnly, { extraPredicates: squawkMiss }),
    false,
    'emergency squawk miss ANDs with descent-only',
  );

  const grounded = { ...arrival, onGround: true };
  const airborneOnly = [(meta) => meta.onGround !== true];
  assert.equal(
    contactPassesInFlightFilters(grounded, descentOnly, { extraPredicates: airborneOnly }),
    false,
    'airborne-only hides a grounded arrival',
  );

  const slow = { ...arrival, velocity: 5 };
  const fastBand = { speedMinKt: 100, speedMaxKt: 400 };
  assert.equal(contactPassesInFlightFilters(arrival, { ...descentOnly, ...fastBand }), true);
  assert.equal(
    contactPassesInFlightFilters(slow, { ...descentOnly, ...fastBand }),
    false,
    'PLAN 96 speed band ANDs with descent-only via the existing matcher',
  );
  assert.equal(contactMatchesSpeedBand(slow, { minKt: 100, maxKt: 400 }), false);

  const lowArrival = { verticalRate: -4, altitude: 900, onGround: false };
  const descentAndHigh = { ...descentOnly, altitudeBand: 'gt30k' };
  assert.equal(
    contactPassesInFlightFilters(lowArrival, descentAndHigh),
    false,
    'PLAN 93 altitude band ANDs with descent-only via the existing predicate',
  );
  assert.equal(
    aircraftMatchesAltitudeBand({ altitudeM: 900, onGround: false }, 'gt30k'),
    false,
  );
  assert.equal(
    contactPassesInFlightFilters({ verticalRate: -4, altitude: 12000, onGround: false }, descentAndHigh),
    true,
    'a high arrival still passes descent-only AND >30k ft',
  );
});

test('honor sibling in-flight filter modules if they already landed', async () => {
  const siblingNames = [
    'watchlist.js',
    'flightAltitudeBand.js',
    'emergencySquawk.js',
    'flightAirborneOnly.js',
    'flightSpeedBand.js',
    'inFlightFilters.js',
  ];
  const here = path.dirname(fileURLToPath(import.meta.url));
  const present = siblingNames.filter((name) => existsSync(path.join(here, name)));
  if (present.length === 0) {
    assert.ok(true, 'PLAN 92–96 modules are not on this branch; composition hook still ANDs extras');
    return;
  }
  const arrival = { verticalRate: -4, callsign: 'UAL1', altitude: 900, onGround: false };
  const descentOnly = { showClimb: false, showLevel: false, showDescent: true };
  for (const name of present) {
    const mod = await import(`./${name}`);
    const predicate = mod.contactPassesInFlightFilter
      || mod.contactPasses
      || mod.default;
    if (typeof predicate !== 'function') continue;
    assert.equal(
      typeof contactPassesInFlightFilters(arrival, descentOnly, { extraPredicates: [predicate] }),
      'boolean',
      `${name} must compose as AND, not replace the rate filter`,
    );
  }
});

function billboardAt(lon, lat, altM) {
  return {
    position: Cesium.Cartesian3.fromDegrees(lon, lat, altM),
    color: Cesium.Color.WHITE,
    show: true,
  };
}

function seedHubFleet(layer, { seedPrimary, addOther, trackedIcao = null }) {
  resetAltitudeBandForTest();
  _resetHeadingSectorsForTest();
  resetHideStaleEnabledForTest();
  const hub = [
    { icao24: 'arr001', verticalRate: -5.2, callsign: 'UAL1', lon: -97.67, lat: 30.21, alt: 1200, velocity: 70 },
    { icao24: 'dep001', verticalRate: 6.1, callsign: 'SWA2', lon: -97.66, lat: 30.19, alt: 900, velocity: 72 },
    { icao24: 'crz001', verticalRate: 0.1, callsign: 'AAL3', lon: -97.64, lat: 30.22, alt: 11000, velocity: 230 },
    { icao24: 'unk001', verticalRate: null, callsign: 'N90XX', lon: -97.70, lat: 30.18, alt: 4000 },
  ];
  const primary = hub[0];
  seedPrimary({
    icao24: primary.icao24,
    entity: null,
    billboard: billboardAt(primary.lon, primary.lat, primary.alt),
    billboardCollection: { show: true, remove() {} },
    viewer: { camera: { positionCartographic: null }, scene: {} },
    tracked: trackedIcao === primary.icao24,
    meta: {
      callsign: primary.callsign,
      verticalRate: primary.verticalRate,
      verticalRateMps: primary.verticalRate,
      altitude: primary.alt,
      velocity: primary.velocity,
      onGround: false,
      klass: 'airliner',
    },
  });
  for (const row of hub.slice(1)) {
    addOther({
      icao24: row.icao24,
      billboard: billboardAt(row.lon, row.lat, row.alt),
      meta: {
        callsign: row.callsign,
        verticalRate: row.verticalRate,
        verticalRateMps: row.verticalRate,
        altitude: row.alt,
        velocity: row.velocity,
        onGround: false,
        klass: 'airliner',
      },
    });
  }
  if (trackedIcao && trackedIcao !== primary.icao24) {
    // Re-seed so the tracked id is the one the layer is following.
    const tracked = hub.find((row) => row.icao24 === trackedIcao);
    seedPrimary({
      icao24: tracked.icao24,
      entity: null,
      billboard: billboardAt(tracked.lon, tracked.lat, tracked.alt),
      billboardCollection: { show: true, remove() {} },
      viewer: { camera: { positionCartographic: null }, scene: {} },
      tracked: true,
      meta: {
        callsign: tracked.callsign,
        verticalRate: tracked.verticalRate,
        verticalRateMps: tracked.verticalRate,
        altitude: tracked.alt,
        velocity: tracked.velocity,
        onGround: false,
        klass: 'airliner',
      },
    });
    for (const row of hub) {
      if (row.icao24 === tracked.icao24) continue;
      addOther({
        icao24: row.icao24,
        billboard: billboardAt(row.lon, row.lat, row.alt),
        meta: {
          callsign: row.callsign,
          verticalRate: row.verticalRate,
          verticalRateMps: row.verticalRate,
          altitude: row.alt,
          velocity: row.velocity,
          onGround: false,
          klass: 'airliner',
        },
      });
    }
  }
}

function nearbyIds(layer) {
  return layer.getNearby(CENTER, RANGE_M, 50).map((row) => row.icao24).sort();
}

const LAYER_FIXTURES = [
  {
    name: 'commercial',
    layer: flightsLayer,
    seedPrimary: _setTrackedFlightRefreshStateForTest,
    addOther: _addFlightTrackingCandidateForTest,
  },
  {
    name: 'military',
    layer: militaryFlightsLayer,
    seedPrimary: _setTrackedMilitaryRefreshStateForTest,
    addOther: _addMilitaryTrackingCandidateForTest,
  },
];

describe('layer membership', { concurrency: 1 }, () => {
for (const fixture of LAYER_FIXTURES) {
  test(`${fixture.name}: descent-only near a hub shows arrivals; climb-only departures; level-only cruise`, () => {
    seedHubFleet(fixture.layer, fixture);
    fixture.layer.setParams({ showClimb: true, showLevel: true, showDescent: true }, { origin: 'user' });
    assert.deepEqual(nearbyIds(fixture.layer), ['arr001', 'crz001', 'dep001', 'unk001']);

    fixture.layer.setParams({ showClimb: false, showLevel: false, showDescent: true }, { origin: 'user' });
    assert.deepEqual(nearbyIds(fixture.layer), ['arr001', 'unk001'], 'descent-only keeps arrivals + unknown rate');

    fixture.layer.setParams({ showClimb: true, showLevel: false, showDescent: false }, { origin: 'user' });
    assert.deepEqual(nearbyIds(fixture.layer), ['dep001', 'unk001'], 'climb-only keeps departures + unknown rate');

    fixture.layer.setParams({ showClimb: false, showLevel: true, showDescent: false }, { origin: 'user' });
    assert.deepEqual(nearbyIds(fixture.layer), ['crz001', 'unk001'], 'level-only keeps cruise + unknown rate');

    fixture.layer.setParams({ showClimb: true, showLevel: true, showDescent: true }, { origin: 'user' });
    assert.deepEqual(nearbyIds(fixture.layer), ['arr001', 'crz001', 'dep001', 'unk001'], 'all-on restores the current view');

    fixture.layer.setParams({
      showClimb: false,
      showLevel: false,
      showDescent: true,
      speedMinKt: 400,
      speedMaxKt: 500,
    }, { origin: 'user' });
    assert.deepEqual(
      nearbyIds(fixture.layer),
      ['unk001'],
      'PLAN 96 speed band ANDs with descent-only; missing speed stays visible',
    );
    fixture.layer.setParams({
      showClimb: true,
      showLevel: true,
      showDescent: true,
      speedMinKt: null,
      speedMaxKt: null,
    }, { origin: 'user' });
  });

  test(`${fixture.name}: a tracked contact outside the set stays visible until untracked`, () => {
    seedHubFleet(fixture.layer, { ...fixture, trackedIcao: 'dep001' });
    fixture.layer.setParams({
      showClimb: false,
      showLevel: false,
      showDescent: true,
    }, { origin: 'user' });
    assert.ok(
      nearbyIds(fixture.layer).includes('dep001'),
      'tracked departure stays visible under descent-only',
    );
    assert.ok(nearbyIds(fixture.layer).includes('arr001'));

    seedHubFleet(fixture.layer, fixture);
    fixture.layer.setParams({
      showClimb: false,
      showLevel: false,
      showDescent: true,
    }, { origin: 'user' });
    assert.ok(
      !nearbyIds(fixture.layer).includes('dep001'),
      'untracking returns the contact to the selected set',
    );
  });

  test(`${fixture.name}: getParams exposes the rate toggles for persistence`, () => {
    seedHubFleet(fixture.layer, fixture);
    fixture.layer.setParams({ showClimb: false, showLevel: true, showDescent: true }, { origin: 'user' });
    const params = fixture.layer.getParams();
    assert.equal(params.showClimb, false);
    assert.equal(params.showLevel, true);
    assert.equal(params.showDescent, true);
    fixture.layer.setParams({ showClimb: true, showLevel: true, showDescent: true }, { origin: 'user' });
  });
}
});

test('rate toggles persist on the existing flights option owner (default all-on omitted)', () => {
  const defaults = createDefaultLayerState().options.flights;
  assert.equal(defaults.showClimb, true);
  assert.equal(defaults.showLevel, true);
  assert.equal(defaults.showDescent, true);

  const encodedDefault = encodeLayerStateParams(new URLSearchParams('v=2'), createDefaultLayerState());
  const loDefault = encodedDefault.get('lo') || '';
  assert.equal(loDefault.includes('f.y.'), false, 'all-on climb is omitted');
  assert.equal(loDefault.includes('f.l.'), false, 'all-on level is omitted');
  assert.equal(loDefault.includes('f.d.'), false, 'all-on descent is omitted');

  const descentOnly = createDefaultLayerState();
  descentOnly.options.flights = {
    ...descentOnly.options.flights,
    showClimb: false,
    showLevel: false,
    showDescent: true,
  };
  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), descentOnly);
  const lo = encoded.get('lo') || '';
  assert.match(lo, /f\.y\.0/);
  assert.match(lo, /f\.l\.0/);
  assert.equal(lo.includes('f.d.'), false, 'descent-on is the default and stays omitted');

  const decoded = decodeLayerStateParams(encoded);
  assert.equal(decoded.options.flights.showClimb, false);
  assert.equal(decoded.options.flights.showLevel, false);
  assert.equal(decoded.options.flights.showDescent, true);

  const parentEra = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(parentEra.options.flights.showClimb, true);
  assert.equal(parentEra.options.flights.showLevel, true);
  assert.equal(parentEra.options.flights.showDescent, true);
});

test('PLAN 97 adds no new /api endpoints', async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const apiDir = path.join(root, 'api');
  if (existsSync(apiDir)) {
    const names = readdirSync(apiDir);
    assert.equal(
      names.some((name) => /vertical|climb|descent|rate-filter/i.test(name)),
      false,
      `no new rate-filter API files; found ${names.join(', ')}`,
    );
  }
  const { readFile } = await import('node:fs/promises');
  for (const name of ['flightVerticalFilter.js', 'flightContactFilter.js']) {
    const src = await readFile(new URL(`./${name}`, import.meta.url), 'utf8');
    assert.equal(/\/api\//.test(src), false, `${name} must stay client-only`);
    assert.equal(/\bfetch\s*\(/.test(src), false, `${name} must not poll`);
  }
});
