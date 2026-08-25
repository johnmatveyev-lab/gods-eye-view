import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AIRCRAFT_CLASS_CHIP_LABELS,
  AIRCRAFT_CLASS_FILTER_ALL,
  AIRCRAFT_CLASS_FILTER_IDS,
  aircraftClassFilterIsAllOn,
  aircraftClassFilterMap,
  aircraftClassPassesFilter,
  decodeAircraftClassFilter,
  encodeAircraftClassFilter,
  flightPassesOperatorFilters,
  normalizeAircraftClassFilter,
  toggleAircraftClassFilter,
} from './aircraftClassFilter.js';
import {
  aircraftMatchesAltitudeBand,
  getAltitudeBand,
  setAltitudeBand,
} from './flightAltitudeBand.js';
import flightsLayer from './flights.js';
import militaryFlightsLayer from './militaryFlights.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function only(...ids) {
  return normalizeAircraftClassFilter(ids);
}

const FLEET = Object.freeze([
  { id: 'heli-1', klass: 'helicopter' },
  { id: 'jet-1', klass: 'airliner' },
  { id: 'fast-1', klass: 'fastjet' },
  { id: 'wide-1', klass: 'widebody' },
  { id: 'ga-1', klass: 'light' },
  { id: 'glider-1', klass: 'glider' },
  { id: 'tprop-1', klass: 'turboprop' },
  { id: 'unknown-1', klass: null },
  { id: 'missing-1' },
]);

function visibleIds(filter, { trackedId = null } = {}) {
  return FLEET.filter((contact) => flightPassesOperatorFilters({
    ...contact,
    tracked: contact.id === trackedId,
    selected: contact.id === trackedId,
  }, { aircraftClassFilter: filter })).map((contact) => contact.id);
}

test('default all-on leaves the mixed fleet unchanged', () => {
  assert.equal(normalizeAircraftClassFilter(undefined), AIRCRAFT_CLASS_FILTER_ALL);
  assert.equal(aircraftClassFilterIsAllOn(AIRCRAFT_CLASS_FILTER_ALL), true);
  assert.deepEqual(visibleIds(AIRCRAFT_CLASS_FILTER_ALL), FLEET.map((contact) => contact.id));
  for (const klass of AIRCRAFT_CLASS_FILTER_IDS) {
    assert.equal(aircraftClassPassesFilter(klass, AIRCRAFT_CLASS_FILTER_ALL), true, klass);
  }
});

test('helicopter-only hides jets and restores when all chips return', () => {
  const heli = only('helicopter');
  assert.deepEqual(visibleIds(heli), ['heli-1', 'unknown-1', 'missing-1']);
  assert.equal(aircraftClassPassesFilter('airliner', heli), false);
  assert.equal(aircraftClassPassesFilter('fastjet', heli), false);
  assert.equal(aircraftClassPassesFilter('bizjet', heli), false);
  assert.equal(aircraftClassPassesFilter('widebody', heli), false);
  assert.equal(aircraftClassPassesFilter('helicopter', heli), true);
  assert.deepEqual(visibleIds(AIRCRAFT_CLASS_FILTER_ALL), FLEET.map((contact) => contact.id));
});

test('widebody+airliner hides GA and helicopters', () => {
  const heavies = only('widebody', 'airliner');
  const visible = visibleIds(heavies);
  assert.deepEqual(visible, ['jet-1', 'wide-1', 'unknown-1', 'missing-1']);
  assert.equal(visible.includes('ga-1'), false);
  assert.equal(visible.includes('heli-1'), false);
  assert.equal(visible.includes('glider-1'), false);
});

test('unknown or missing klass stays visible when chips isolate a class', () => {
  const heli = only('helicopter');
  assert.equal(aircraftClassPassesFilter(null, heli), true);
  assert.equal(aircraftClassPassesFilter('', heli), true);
  assert.equal(aircraftClassPassesFilter('tr3b', heli), true);
  assert.equal(aircraftClassPassesFilter('not-a-class', heli), true);
});

test('tracked contact whose class is unchecked stays visible until untracked', () => {
  const heli = only('helicopter');
  assert.equal(aircraftClassPassesFilter('airliner', heli, { tracked: true }), true);
  assert.equal(aircraftClassPassesFilter('airliner', heli, { selected: true }), true);
  assert.deepEqual(visibleIds(heli, { trackedId: 'jet-1' }), ['heli-1', 'jet-1', 'unknown-1', 'missing-1']);
  assert.deepEqual(visibleIds(heli, { trackedId: null }), ['heli-1', 'unknown-1', 'missing-1']);
});

test('AND with watchlist / altitude / squawk / airborne / speed / climb-descent predicates', () => {
  const heli = { klass: 'helicopter', callsign: 'N123HE', altitudeM: 400, onGround: false, squawk: '1200', speedMps: 45, verticalRateMps: 2 };
  const jet = { klass: 'airliner', callsign: 'UAL88', altitudeM: 11000, onGround: false, squawk: '7700', speedMps: 220, verticalRateMps: -9 };
  const groundedHeli = { ...heli, onGround: true, speedMps: 2, verticalRateMps: 0 };
  const classHeli = { aircraftClassFilter: only('helicopter') };

  assert.equal(flightPassesOperatorFilters(heli, classHeli), true);
  assert.equal(flightPassesOperatorFilters(jet, classHeli), false);

  const watchlist = [(contact) => String(contact.callsign || '').includes('N123')];
  const altitude = [(contact) => Number(contact.altitudeM) < 1000];
  const squawk = [(contact) => contact.squawk === '7700'];
  const airborne = [(contact) => contact.onGround !== true];
  const speed = [(contact) => Number(contact.speedMps) < 80];
  const climb = [(contact) => Number(contact.verticalRateMps) > 0];

  assert.equal(flightPassesOperatorFilters(heli, { ...classHeli, andPredicates: watchlist }), true);
  assert.equal(flightPassesOperatorFilters({ ...heli, callsign: 'N999' }, { ...classHeli, andPredicates: watchlist }), false);
  assert.equal(flightPassesOperatorFilters(heli, { ...classHeli, andPredicates: altitude }), true);
  assert.equal(flightPassesOperatorFilters({ ...heli, altitudeM: 9000 }, { ...classHeli, andPredicates: altitude }), false);
  assert.equal(flightPassesOperatorFilters(jet, { aircraftClassFilter: AIRCRAFT_CLASS_FILTER_ALL, andPredicates: squawk }), true);
  assert.equal(flightPassesOperatorFilters(heli, { ...classHeli, andPredicates: squawk }), false);
  assert.equal(flightPassesOperatorFilters(heli, { ...classHeli, andPredicates: airborne }), true);
  assert.equal(flightPassesOperatorFilters(groundedHeli, { ...classHeli, andPredicates: airborne }), false);
  assert.equal(flightPassesOperatorFilters(heli, { ...classHeli, andPredicates: speed }), true);
  assert.equal(flightPassesOperatorFilters({ ...heli, speedMps: 200 }, { ...classHeli, andPredicates: speed }), false);
  assert.equal(flightPassesOperatorFilters(heli, { ...classHeli, andPredicates: climb }), true);
  assert.equal(flightPassesOperatorFilters({ ...heli, verticalRateMps: -4 }, { ...classHeli, andPredicates: climb }), false);

  assert.equal(flightPassesOperatorFilters(heli, {
    ...classHeli,
    andPredicates: [...watchlist, ...altitude, ...airborne, ...speed, ...climb],
  }), true);
  assert.equal(flightPassesOperatorFilters(jet, {
    aircraftClassFilter: only('helicopter'),
    andPredicates: squawk,
  }), false, 'class chip still ANDs — a 7700 jet stays hidden on helicopter-only');

  const previousBand = getAltitudeBand();
  try {
    setAltitudeBand('lt10k', { persist: false });
    const altitudeBand = [(contact) => aircraftMatchesAltitudeBand({
      altitudeM: contact.altitudeM,
      onGround: contact.onGround === true,
    }, getAltitudeBand())];
    assert.equal(flightPassesOperatorFilters(heli, { ...classHeli, andPredicates: altitudeBand }), true);
    assert.equal(flightPassesOperatorFilters({ ...heli, altitudeM: 12000 }, { ...classHeli, andPredicates: altitudeBand }), false);
    assert.equal(flightPassesOperatorFilters({ ...jet, altitudeM: 400 }, { ...classHeli, andPredicates: altitudeBand }), false);
  } finally {
    setAltitudeBand(previousBand, { persist: false });
  }
});

test('layers AND class chips with landed altitude and speed filters', () => {
  const flightsSrc = fs.readFileSync(path.join(ROOT, 'src', 'data', 'flights.js'), 'utf8');
  const militarySrc = fs.readFileSync(path.join(ROOT, 'src', 'data', 'militaryFlights.js'), 'utf8');
  assert.match(flightsSrc, /aircraftMatchesAltitudeBand/);
  assert.match(flightsSrc, /_classAndMatcher/);
  assert.match(flightsSrc, /contactPassesInFlightFilters/);
  assert.match(flightsSrc, /andMatchers: \[_altitudeAndMatcher, _headingAndMatcher, _hideStaleAndMatcher, _classAndMatcher, _prefixAndMatcher, _airborneOnlyMatcher, _verticalRateAndMatcher, _emergenciesOnlyMatcher, _identifiedOnlyMatcher\]/);
  assert.equal(flightsSrc.includes("from './flightAltitudeBand.js'"), true);
  assert.equal(flightsSrc.includes("from './flightSpeedBand.js'"), true);
  assert.match(militarySrc, /_classAndMatcher/);
  assert.match(militarySrc, /contactPassesInFlightFilters/);
});

test('commercial and military layers persist and honor the same class chips', () => {
  const heli = only('helicopter');
  assert.equal(flightsLayer.setParams({ aircraftClassFilter: heli }), true);
  assert.equal(militaryFlightsLayer.setParams({ aircraftClassFilter: heli }), true);
  assert.equal(flightsLayer.getParams().aircraftClassFilter, heli);
  assert.equal(militaryFlightsLayer.getParams().aircraftClassFilter, heli);

  assert.equal(flightsLayer.setParams({ aircraftClassFilter: AIRCRAFT_CLASS_FILTER_ALL }), true);
  assert.equal(militaryFlightsLayer.setParams({ aircraftClassFilter: AIRCRAFT_CLASS_FILTER_ALL }), true);
  assert.equal(flightsLayer.getParams().aircraftClassFilter, AIRCRAFT_CLASS_FILTER_ALL);
  assert.equal(militaryFlightsLayer.getParams().aircraftClassFilter, AIRCRAFT_CLASS_FILTER_ALL);
});

test('toggle and codec stay on the classifyAircraft vocabulary', () => {
  let filter = AIRCRAFT_CLASS_FILTER_ALL;
  for (const id of AIRCRAFT_CLASS_FILTER_IDS) {
    if (id === 'helicopter') continue;
    filter = toggleAircraftClassFilter(filter, id);
  }
  assert.equal(filter, only('helicopter'));
  assert.equal(toggleAircraftClassFilter(filter, 'helicopter'), '0');
  assert.equal(toggleAircraftClassFilter('0', 'helicopter'), only('helicopter'));
  assert.equal(toggleAircraftClassFilter(only('helicopter'), 'airliner'), only('helicopter', 'airliner'));

  const map = aircraftClassFilterMap(only('widebody', 'airliner'));
  assert.equal(map.widebody, true);
  assert.equal(map.airliner, true);
  assert.equal(map.light, false);
  assert.equal(map.helicopter, false);

  assert.equal(encodeAircraftClassFilter(AIRCRAFT_CLASS_FILTER_ALL), 'all');
  assert.equal(decodeAircraftClassFilter(encodeAircraftClassFilter(only('helicopter'))), only('helicopter'));
  assert.equal(normalizeAircraftClassFilter({ helicopter: true }), only('helicopter'));
  assert.equal(normalizeAircraftClassFilter('nope'), null);
});

test('DISPLAY chips cover every classifyAircraft id and default all on', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /id="aircraft-class-chips"/);
  for (const id of AIRCRAFT_CLASS_FILTER_IDS) {
    assert.match(html, new RegExp(`data-aircraft-class="${id}"[^>]*aria-pressed="true"`));
    assert.ok(AIRCRAFT_CLASS_CHIP_LABELS[id]);
  }
});

test('skylight MIT credit is untouched and no new /api is added', () => {
  const aircraftClass = fs.readFileSync(path.join(ROOT, 'src', 'data', 'aircraftClass.js'), 'utf8');
  assert.match(aircraftClass, /skylight \(https:\/\/github.com\/cpaczek\/skylight, MIT\)/);
  const filterSrc = fs.readFileSync(path.join(ROOT, 'src', 'data', 'aircraftClassFilter.js'), 'utf8');
  assert.equal(/fetch\s*\(/.test(filterSrc), false);
  assert.equal(filterSrc.includes('/api/'), false);
});
