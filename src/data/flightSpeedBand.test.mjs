import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DEFAULT_DISTANCE_UNIT,
  getDistanceUnit,
  resetDistanceUnitsForTests,
  setDistanceUnit,
} from '../units.js';
import {
  contactMatchesSpeedBand,
  contactPassesInFlightFilters,
  displaySpeedToKt,
  filterFlightContacts,
  isSpeedBandActive,
  ktToDisplaySpeed,
  normalizeSpeedBand,
  speedUnitSuffix,
} from './flightSpeedBand.js';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
  normalizeLayerState,
} from './layerState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** ~120 kt Cessna / slow GA. */
const GA_MPS = 61.73;
/** ~450 kt airliner cruise. */
const AIRLINER_MPS = 231.48;
/** ~500 kt fast jet. */
const JET_MPS = 257.2;

const CONTACTS = Object.freeze([
  { id: 'ga1', icao24: 'a00001', callsign: 'N123AB', velocity: GA_MPS, altitude: 1200, squawk: '1200', onGround: false },
  { id: 'al1', icao24: 'a00002', callsign: 'UAL123', velocity: AIRLINER_MPS, altitude: 10668, squawk: '1200', onGround: false },
  { id: 'jk1', icao24: 'ae0001', callsign: 'RCH001', velocity: JET_MPS, speedMps: JET_MPS, altitude: 9144, squawk: '1200', onGround: false },
  { id: 'unk', icao24: 'a00003', callsign: 'UNKNOWN', velocity: Number.NaN, altitude: 3000, squawk: '1200', onGround: false },
]);

test.afterEach(() => {
  resetDistanceUnitsForTests();
});

test('min 400 kt hides slow GA while airliners remain', () => {
  const band = normalizeSpeedBand({ minKt: 400 });
  assert.equal(isSpeedBandActive(band), true);
  assert.equal(contactMatchesSpeedBand(CONTACTS[0], band), false, '120 kt GA is below 400 kt');
  assert.equal(contactMatchesSpeedBand(CONTACTS[1], band), true, '450 kt airliner stays');
  assert.deepEqual(
    filterFlightContacts(CONTACTS, band).map((row) => row.id),
    ['al1', 'jk1', 'unk'],
  );
});

test('clear restores all contacts', () => {
  const band = normalizeSpeedBand({ minKt: 400, maxKt: 480 });
  assert.equal(filterFlightContacts(CONTACTS, band).length < CONTACTS.length, true);
  assert.deepEqual(
    filterFlightContacts(CONTACTS, normalizeSpeedBand({ minKt: null, maxKt: null })).map((row) => row.id),
    CONTACTS.map((row) => row.id),
  );
  assert.equal(isSpeedBandActive(normalizeSpeedBand(null)), false);
});

test('missing or non-finite velocity stays visible', () => {
  const band = normalizeSpeedBand({ minKt: 400 });
  assert.equal(contactMatchesSpeedBand({ id: 'n', velocity: null }, band), true);
  assert.equal(contactMatchesSpeedBand({ id: 'n', velocity: undefined }, band), true);
  assert.equal(contactMatchesSpeedBand({ id: 'n', velocity: Number.NaN }, band), true);
  assert.equal(contactMatchesSpeedBand({ id: 'n', velocity: Number.POSITIVE_INFINITY }, band), true);
  assert.equal(contactMatchesSpeedBand({ id: 'n' }, band), true);
});

test('tracked or selected contact outside the band stays visible until untracked', () => {
  const band = normalizeSpeedBand({ minKt: 400 });
  const ga = CONTACTS[0];
  assert.equal(contactMatchesSpeedBand(ga, band), false);
  assert.equal(contactMatchesSpeedBand(ga, band, { trackedId: 'ga1' }), true);
  assert.equal(contactMatchesSpeedBand(ga, band, { selectedId: 'a00001' }), true);
  assert.equal(contactMatchesSpeedBand(ga, band, { keepVisibleIds: ['ga1'] }), true);
  assert.equal(contactMatchesSpeedBand(ga, band, { trackedId: null, selectedId: null }), false);
});

test('military layer uses the same band against speedMps', () => {
  const band = normalizeSpeedBand({ minKt: 400 });
  const helo = { id: 'helo', icao24: 'ae1111', callsign: 'RCHHELO', speedMps: GA_MPS };
  const jet = { id: 'jet', icao24: 'ae2222', callsign: 'RCHJET', speedMps: JET_MPS };
  assert.equal(contactMatchesSpeedBand(helo, band), false);
  assert.equal(contactMatchesSpeedBand(jet, band), true);
  assert.equal(contactPassesInFlightFilters(helo, { speedBand: band }), false);
  assert.equal(contactPassesInFlightFilters(jet, { speedBand: band }), true);
});

test('band displays in the PLAN 44 units toggle as kt / km/h / mph', () => {
  assert.equal(DEFAULT_DISTANCE_UNIT, 'km');
  assert.equal(getDistanceUnit(), 'km');
  assert.equal(speedUnitSuffix('km'), 'km/h');
  assert.equal(speedUnitSuffix('nm'), 'kt');
  assert.equal(speedUnitSuffix('mi'), 'mph');
  assert.equal(Math.round(ktToDisplaySpeed(400, 'nm')), 400);
  assert.equal(Math.round(ktToDisplaySpeed(400, 'km')), 741);
  assert.equal(Math.round(ktToDisplaySpeed(400, 'mi')), 460);
  assert.equal(Math.round(displaySpeedToKt(741, 'km')), 400);
  setDistanceUnit('nm', { persist: false });
  assert.equal(speedUnitSuffix(), 'kt');
});

test('tracked contact stays visible when AND matchers would hide it', () => {
  const band = normalizeSpeedBand({ minKt: 400 });
  assert.equal(contactPassesInFlightFilters(CONTACTS[0], {
    speedBand: band,
    trackedId: 'ga1',
    andMatchers: [() => false],
  }), true);
  assert.equal(contactPassesInFlightFilters(CONTACTS[0], {
    speedBand: band,
    andMatchers: [() => false],
  }), false);
});

test('AND with the landed PLAN 93 altitude-band module', async () => {
  const { aircraftMatchesAltitudeBand } = await import('./flightAltitudeBand.js');
  const altitude = (contact) => aircraftMatchesAltitudeBand({
    altitudeM: contact.altitude,
    onGround: contact.onGround === true,
  }, { id: 'gt30k' });
  const band = normalizeSpeedBand({ minKt: 400 });
  assert.equal(contactPassesInFlightFilters(CONTACTS[1], {
    speedBand: band,
    andMatchers: [altitude],
  }), true, '450 kt airliner at FL350 stays');
  assert.equal(contactPassesInFlightFilters(CONTACTS[0], {
    speedBand: band,
    andMatchers: [altitude],
  }), false, 'slow GA fails the speed band');
  assert.equal(contactPassesInFlightFilters({ ...CONTACTS[1], altitude: 300 }, {
    speedBand: band,
    andMatchers: [altitude],
  }), false, 'fast contact below the altitude band is hidden');
});

test('AND with watchlist / altitude / squawk / airborne-only matchers when supplied', () => {
  const band = normalizeSpeedBand({ minKt: 400 });
  const airliner = CONTACTS[1];
  const ga = CONTACTS[0];
  const watchlist = (contact) => contact.callsign === 'UAL123';
  const altitude = (contact) => Number(contact.altitude) >= 9000;
  const squawk = (contact) => contact.squawk === '1200';
  const airborne = (contact) => contact.onGround !== true;

  assert.equal(contactPassesInFlightFilters(airliner, {
    speedBand: band,
    andMatchers: [watchlist, altitude, squawk, airborne],
  }), true);
  assert.equal(contactPassesInFlightFilters(ga, {
    speedBand: band,
    andMatchers: [watchlist, altitude, squawk, airborne],
  }), false, 'slow GA fails the speed band even if other filters would keep an airliner');
  assert.equal(contactPassesInFlightFilters({ ...airliner, callsign: 'DAL9' }, {
    speedBand: band,
    andMatchers: [watchlist],
  }), false, 'speed-pass airliner still needs the watchlist');
  assert.equal(contactPassesInFlightFilters({ ...airliner, altitude: 300 }, {
    speedBand: band,
    andMatchers: [altitude],
  }), false);
  assert.equal(contactPassesInFlightFilters({ ...airliner, squawk: '7700' }, {
    speedBand: band,
    andMatchers: [(contact) => contact.squawk === '7700'],
  }), true);
  assert.equal(contactPassesInFlightFilters({ ...airliner, onGround: true }, {
    speedBand: band,
    andMatchers: [airborne],
  }), false);
});

test('honors sibling in-flight filter modules when they have already landed', async () => {
  const siblings = [
    ['./flightIdentWatchlist.js', ['contactMatchesWatchlist', 'contactMatchesIdentWatchlist']],
    ['./flightAltitudeBand.js', ['contactMatchesAltitudeBand', 'aircraftMatchesAltitudeBand']],
    ['./emergencySquawk.js', ['contactMatchesEmergencySquawk', 'contactMatchesSquawk', 'isEmergencySquawk']],
    ['./flightAirborneOnly.js', ['contactMatchesAirborneOnly', 'contactIsAirborne']],
  ];
  const matchers = [];
  for (const [specifier, names] of siblings) {
    const file = path.join(ROOT, 'src/data', path.basename(specifier));
    if (!existsSync(file)) continue;
    const mod = await import(specifier);
    const fn = names.map((name) => mod[name]).find((value) => typeof value === 'function');
    if (fn) matchers.push(fn);
  }
  if (!matchers.length) {
    assert.equal(contactPassesInFlightFilters(CONTACTS[1], { speedBand: { minKt: 400 } }), true);
    return;
  }
  assert.equal(
    contactPassesInFlightFilters(CONTACTS[1], { speedBand: { minKt: 400 }, andMatchers: matchers }),
    contactPassesInFlightFilters(CONTACTS[1], { speedBand: { minKt: 400 } })
      && matchers.every((fn) => fn(CONTACTS[1], { speedBand: { minKt: 400 } })),
  );
});

test('both flight layers persist the band through existing layer options', () => {
  const flights = readFileSync(path.join(ROOT, 'src/data/flights.js'), 'utf8');
  const military = readFileSync(path.join(ROOT, 'src/data/militaryFlights.js'), 'utf8');
  assert.match(flights, /speedMinKt: _speedMinKt/);
  assert.match(flights, /_applySpeedBandParams\(params\)/);
  assert.match(flights, /andMatchers: \[_altitudeAndMatcher, _headingAndMatcher, _hideStaleAndMatcher, _classAndMatcher, _prefixAndMatcher, _airborneOnlyMatcher\]/);
  assert.match(military, /speedMinKt: _speedMinKt/);
  assert.match(military, /_applySpeedBandParams\(params\)/);

  const encoded = encodeLayerStateParams(new URLSearchParams(), normalizeLayerState({
    enabledLayerIds: ['flights', 'military'],
    options: { flights: { speedMinKt: 400 } },
  }));
  assert.match(encoded.get('lo'), /f\.s\.400/);
  const decoded = decodeLayerStateParams(new URLSearchParams(`v=2&l=f.m&lo=${encoded.get('lo')}`));
  assert.equal(decoded.options.flights.speedMinKt, 400);
  assert.equal(decoded.options.flights.speedMaxKt, null);

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(defaults.speedMinKt, null);
  assert.equal(defaults.speedMaxKt, null);
  const clear = encodeLayerStateParams(new URLSearchParams(), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { speedMinKt: null, speedMaxKt: null } },
  }));
  assert.equal(clear.get('lo')?.includes('f.s.') || false, false);
});

test('chrome is client-only and adds no new endpoints', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const flights = readFileSync(path.join(ROOT, 'src/data/flights.js'), 'utf8');
  const military = readFileSync(path.join(ROOT, 'src/data/militaryFlights.js'), 'utf8');
  const band = readFileSync(path.join(ROOT, 'src/data/flightSpeedBand.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  assert.match(html, /id="speed-band-row"/);
  assert.match(html, /id="speed-band-min"/);
  assert.match(html, /id="speed-band-max"/);
  assert.match(html, /id="speed-band-clear"/);
  assert.match(html, /id="speed-band-unit"/);
  assert.match(ui, /from '\.\/data\/flightSpeedBand\.js'/);
  assert.match(ui, /speedMinKt|normalizeSpeedBand|speedUnitSuffix/);
  assert.match(flights, /contactPassesInFlightFilters|contactMatchesSpeedBand/);
  assert.match(military, /contactPassesInFlightFilters|contactMatchesSpeedBand/);
  assert.match(flights, /meta\.velocity/);
  assert.match(band, /velocityMps|speedMps/);

  assert.doesNotMatch(band, /\/api\/[a-z0-9-]*speed/);
  assert.doesNotMatch(ui, /\/api\/[a-z0-9-]*speed/);
  assert.doesNotMatch(flights, /\/api\/[a-z0-9-]*speed-band/);
  assert.doesNotMatch(band, /opensky-network|news\.google|telegeography|quantum-earth|God'?s Eye View series/i);
  assert.doesNotMatch(ui, /quantum-earth/i);
  assert.equal(pkg.name, 'meridian');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
});
