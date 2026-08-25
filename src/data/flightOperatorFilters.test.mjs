import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIRBORNE_ONLY_DEFAULT,
  passesAirborneOnlyFilter,
  passesOperatorFlightFilters,
} from './flightOperatorFilters.js';

test('airborne-only defaults off so current grounded draw stays', () => {
  assert.equal(AIRBORNE_ONLY_DEFAULT, false);
  assert.equal(passesAirborneOnlyFilter({ onGround: true }), true);
  assert.equal(passesAirborneOnlyFilter({ onGround: true, airborneOnly: false }), true);
  assert.equal(passesOperatorFlightFilters({ onGround: true }), true);
});

test('airborne-only on hides parked and taxi contacts and keeps airborne', () => {
  assert.equal(passesAirborneOnlyFilter({ onGround: true, airborneOnly: true }), false);
  assert.equal(passesAirborneOnlyFilter({ onGround: false, airborneOnly: true }), true);
  assert.equal(passesAirborneOnlyFilter({ airborneOnly: true }), true,
    'missing onGround is not treated as grounded — no new heuristic');
});

test('a selected or tracked contact that lands stays visible', () => {
  assert.equal(passesAirborneOnlyFilter({
    onGround: true,
    airborneOnly: true,
    isSelectedOrTracked: true,
  }), true);
  assert.equal(passesAirborneOnlyFilter({
    onGround: true,
    airborneOnly: true,
    isSelectedOrTracked: false,
  }), false);
});

test('operator filters compose as AND with watchlist, altitude band, and squawk when present', () => {
  const airborne = { onGround: false, airborneOnly: true };
  assert.equal(passesOperatorFlightFilters(airborne), true);
  assert.equal(passesOperatorFlightFilters({
    ...airborne,
    passesIdentWatchlist: false,
  }), false);
  assert.equal(passesOperatorFlightFilters({
    ...airborne,
    passesAltitudeBand: false,
  }), false);
  assert.equal(passesOperatorFlightFilters({
    ...airborne,
    passesEmergencySquawk: false,
  }), false);
  assert.equal(passesOperatorFlightFilters({
    onGround: true,
    airborneOnly: true,
    passesIdentWatchlist: true,
    passesAltitudeBand: true,
    passesEmergencySquawk: true,
  }), false, 'grounded still loses even when sibling filters pass');
  assert.equal(passesOperatorFlightFilters({
    onGround: false,
    airborneOnly: true,
    passesIdentWatchlist: true,
    passesAltitudeBand: true,
    passesEmergencySquawk: true,
  }), true);
});
