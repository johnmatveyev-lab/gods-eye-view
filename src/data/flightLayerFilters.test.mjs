// PLAN 100 — airline callsign prefix filter (client-only).
// This is not the exact-ident watchlist. Prefixes are 3-letter tokens only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callsignMatchesPrefixes,
  contactPassesFlightLayerFilters,
  filterFlightContacts,
  formatCallsignPrefixField,
  getCallsignPrefixField,
  parseCallsignPrefixes,
  resetCallsignPrefixFieldForTest,
  setCallsignPrefixField,
} from './flightLayerFilters.js';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
  normalizeLayerState,
} from './layerState.js';

const ROOT = dirname(fileURLToPath(import.meta.url));

const CONTACTS = Object.freeze([
  { icao24: 'a1', callsign: 'UAL123' },
  { icao24: 'a2', callsign: 'UAL456' },
  { icao24: 'a3', callsign: 'BAW12' },
  { icao24: 'a4', callsign: 'AAL99' },
  { icao24: 'ga', callsign: 'N123AB' },
  { icao24: 'hex', callsign: '' },
  { icao24: 'mil', callsign: 'RCH401' },
]);

function visibleIds(prefixes, extras = {}) {
  return filterFlightContacts(CONTACTS, { callsignPrefixes: prefixes }, extras)
    .map((contact) => contact.icao24);
}

test('parseCallsignPrefixes keeps only exact 3-letter tokens', () => {
  assert.deepEqual(parseCallsignPrefixes('UAL AAL BAW'), ['UAL', 'AAL', 'BAW']);
  assert.deepEqual(parseCallsignPrefixes('ual, aal'), ['UAL', 'AAL']);
  assert.deepEqual(parseCallsignPrefixes('  UAL123  '), []);
  assert.deepEqual(parseCallsignPrefixes('UA UAL A'), ['UAL']);
  assert.deepEqual(parseCallsignPrefixes(''), []);
  assert.deepEqual(parseCallsignPrefixes('   '), []);
  assert.deepEqual(parseCallsignPrefixes(['ual', 'baw']), ['UAL', 'BAW']);
});

test('prefix UAL shows UAL* only', () => {
  assert.deepEqual(visibleIds('UAL'), ['a1', 'a2']);
  assert.equal(callsignMatchesPrefixes('UAL123', ['UAL']), true);
  assert.equal(callsignMatchesPrefixes('  ual456  ', ['UAL']), true);
  assert.equal(callsignMatchesPrefixes('BAW12', ['UAL']), false);
});

test('UAL + BAW shows both airline prefixes', () => {
  assert.deepEqual(visibleIds('UAL BAW'), ['a1', 'a2', 'a3']);
});

test('clear restores all contacts', () => {
  assert.deepEqual(visibleIds('UAL'), ['a1', 'a2']);
  assert.deepEqual(visibleIds(''), CONTACTS.map((contact) => contact.icao24));
  assert.deepEqual(visibleIds('   '), CONTACTS.map((contact) => contact.icao24));
});

test('GA tails and hex-only contacts hide while a prefix is set', () => {
  const ids = visibleIds('UAL');
  assert.equal(ids.includes('ga'), false);
  assert.equal(ids.includes('hex'), false);
  assert.equal(callsignMatchesPrefixes('N123AB', ['UAL']), false);
  assert.equal(callsignMatchesPrefixes('', ['UAL']), false);
  assert.equal(callsignMatchesPrefixes(null, ['UAL']), false);
  assert.equal(callsignMatchesPrefixes('abc123', ['UAL']), false);
});

test('tracked contact outside the prefix stays visible until untracked', () => {
  assert.deepEqual(visibleIds('UAL', { trackedId: 'a4' }), ['a1', 'a2', 'a4']);
  assert.deepEqual(visibleIds('UAL', { selectedId: 'mil' }), ['a1', 'a2', 'mil']);
  assert.equal(contactPassesFlightLayerFilters(
    { icao24: 'a4', callsign: 'AAL99' },
    { callsignPrefixes: ['UAL'] },
    { trackedId: 'a4' },
  ), true);
  assert.equal(contactPassesFlightLayerFilters(
    { icao24: 'a4', callsign: 'AAL99' },
    { callsignPrefixes: ['UAL'] },
    {},
  ), false);
});

test('military-layer contacts honor the same prefixes', () => {
  assert.equal(contactPassesFlightLayerFilters(
    { icao24: 'mil', callsign: 'RCH401' },
    { callsignPrefixes: ['RCH'] },
  ), true);
  assert.equal(contactPassesFlightLayerFilters(
    { icao24: 'mil', callsign: 'RCH401' },
    { callsignPrefixes: ['UAL'] },
  ), false);
  assert.deepEqual(visibleIds('RCH'), ['mil']);
});

test('AND composition with sibling in-flight filters when those exist', async () => {
  const ualHigh = { icao24: 'a1', callsign: 'UAL123', altitudeM: 11000, onGround: false, speedMps: 220, verticalRateMps: 8, squawk: '1200', aircraftClass: 'airliner', lastContactAgeS: 2, true_track: 90 };
  const ualLow = { icao24: 'a2', callsign: 'UAL456', altitudeM: 400, onGround: true, speedMps: 10, verticalRateMps: 0, squawk: '1200', aircraftClass: 'airliner', lastContactAgeS: 90, true_track: 270 };
  const prefixes = { callsignPrefixes: ['UAL'] };

  assert.deepEqual(
    filterFlightContacts([ualHigh, ualLow, CONTACTS[2]], prefixes).map((row) => row.icao24),
    ['a1', 'a2'],
  );

  assert.equal(contactPassesFlightLayerFilters(ualHigh, prefixes, {
    andPredicates: [() => true],
  }), true);
  assert.equal(contactPassesFlightLayerFilters(ualHigh, prefixes, {
    andPredicates: [() => false],
  }), false, 'prefix ANDs extra predicates rather than replacing them');

  const { aircraftMatchesAltitudeBand } = await import('./flightAltitudeBand.js');
  const { contactMatchesSpeedBand } = await import('./flightSpeedBand.js');
  const { contactTrueTrack, passesHeadingSectorFilter } = await import('./inFlightFilters.js');
  const altitudeGt30k = (contact) => aircraftMatchesAltitudeBand(contact, { id: 'gt30k' });
  const speedFast = (contact) => contactMatchesSpeedBand(contact, { minKt: 200 });
  const headingEast = (contact) => passesHeadingSectorFilter(contactTrueTrack(contact), 'E');
  const { aircraftClassPassesFilter } = await import('./aircraftClassFilter.js');
  const classAirliner = (contact) => aircraftClassPassesFilter(contact.aircraftClass, 'airliner');
  assert.deepEqual(
    filterFlightContacts([ualHigh, ualLow], prefixes, { andPredicates: [altitudeGt30k] })
      .map((row) => row.icao24),
    ['a1'],
    'UAL prefix AND gt30k altitude keeps only the high United contact',
  );
  assert.deepEqual(
    filterFlightContacts([ualHigh, ualLow], prefixes, { andPredicates: [speedFast] })
      .map((row) => row.icao24),
    ['a1'],
    'UAL prefix AND 200kt+ speed keeps only the fast United contact',
  );
  assert.deepEqual(
    filterFlightContacts([ualHigh, ualLow], prefixes, { andPredicates: [headingEast] })
      .map((row) => row.icao24),
    ['a1'],
    'UAL prefix AND eastbound heading keeps only the eastbound United contact',
  );
  const heli = { ...ualHigh, icao24: 'h1', callsign: 'UAL999', aircraftClass: 'helicopter' };
  assert.deepEqual(
    filterFlightContacts([ualHigh, heli], prefixes, { andPredicates: [classAirliner] })
      .map((row) => row.icao24),
    ['a1'],
    'UAL prefix AND airliner class chip keeps the jet and hides the helo',
  );

  const siblingSpecs = [
    ['./flightWatchlist.js', 'contactPassesWatchlist'],
    ['./flightSquawkFilter.js', 'contactPassesSquawkFilter'],
    ['./flightAirborneFilter.js', 'contactPassesAirborneFilter'],
    ['./flightSpeedFilter.js', 'contactPassesSpeedFilter'],
    ['./flightVerticalRateFilter.js', 'contactPassesVerticalRateFilter'],
    ['./flightClassFilter.js', 'contactPassesClassFilter'],
    ['./flightStaleFilter.js', 'contactPassesStaleFilter'],
    ['./inFlightFilters.js', 'passesHideStaleFilter'],
  ];
  const andPredicates = [altitudeGt30k, speedFast, headingEast];
  for (const [file, exportName] of siblingSpecs) {
    if (!existsSync(join(ROOT, file))) continue;
    const mod = await import(file);
    if (typeof mod[exportName] === 'function') andPredicates.push(mod[exportName]);
  }

  const both = filterFlightContacts([ualHigh, ualLow], prefixes, { andPredicates });
  for (const row of both) {
    assert.match(String(row.callsign), /^UAL/);
    for (const predicate of andPredicates) {
      assert.equal(predicate(row, prefixes, {}), true, `${row.icao24} must pass every present sibling filter`);
    }
  }
});

test('shared prefix field is what both flight layers persist and apply', () => {
  resetCallsignPrefixFieldForTest();
  assert.equal(getCallsignPrefixField(), '');
  assert.equal(setCallsignPrefixField('ual  baw'), 'UAL BAW');
  assert.equal(getCallsignPrefixField(), 'UAL BAW');
  assert.deepEqual(parseCallsignPrefixes(getCallsignPrefixField()), ['UAL', 'BAW']);
  assert.equal(formatCallsignPrefixField(['ual', 'baw']), 'UAL BAW');
  resetCallsignPrefixFieldForTest();
  assert.equal(getCallsignPrefixField(), '');
});

test('flights and military setParams share the same prefixes via existing layer options', async () => {
  const { default: flightsLayer } = await import('./flights.js');
  const { default: militaryFlightsLayer } = await import('./militaryFlights.js');
  resetCallsignPrefixFieldForTest();
  assert.equal(flightsLayer.getParams().callsignPrefixes, '');
  assert.equal(militaryFlightsLayer.getParams().callsignPrefixes, '');

  assert.equal(flightsLayer.setParams({ callsignPrefixes: 'UAL AAL' }), true);
  assert.equal(flightsLayer.getParams().callsignPrefixes, 'UAL AAL');
  assert.equal(militaryFlightsLayer.getParams().callsignPrefixes, 'UAL AAL');

  assert.equal(militaryFlightsLayer.setParams({ callsignPrefixes: '' }), true);
  assert.equal(flightsLayer.getParams().callsignPrefixes, '');
  assert.equal(militaryFlightsLayer.getParams().callsignPrefixes, '');
  resetCallsignPrefixFieldForTest();
});

test('prefix persists with existing flight layer options and omits when empty', () => {
  const empty = createDefaultLayerState();
  assert.equal(empty.options.flights.callsignPrefixes, '');
  const encodedEmpty = encodeLayerStateParams(new URLSearchParams('v=2'), {
    ...empty,
    enabledLayerIds: ['flights'],
  });
  assert.equal(String(encodedEmpty.get('lo') || '').includes('f.p.'), false);

  const withPrefix = normalizeLayerState({
    enabledLayerIds: ['flights', 'military'],
    options: { flights: { callsignPrefixes: 'ual aal' } },
  });
  assert.equal(withPrefix.options.flights.callsignPrefixes, 'UAL AAL');
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), withPrefix);
  assert.match(params.get('lo'), /f\.c\.UAL-AAL/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options.flights.callsignPrefixes, 'UAL AAL');
});

test('both flight layers expose the same PREFIX field chrome', async () => {
  const { default: flightsLayer } = await import('./flights.js');
  const { default: militaryFlightsLayer } = await import('./militaryFlights.js');
  resetCallsignPrefixFieldForTest();
  setCallsignPrefixField('BAW');
  for (const [name, layer] of [['flights', flightsLayer], ['military', militaryFlightsLayer]]) {
    const controls = layer.getRowControls();
    assert.equal(controls.field?.id, 'callsign-prefixes', `${name} declares the prefix field`);
    assert.equal(controls.field?.label, 'PREFIX');
    assert.equal(controls.field?.value, 'BAW');
    assert.match(controls.field?.placeholder || '', /UAL/);
  }
  resetCallsignPrefixFieldForTest();
});

test('adds no new /api endpoints or poll/adsbdb lookup', () => {
  const src = readFileSync(join(ROOT, 'flightLayerFilters.js'), 'utf8');
  assert.doesNotMatch(src, /\/api\//);
  assert.doesNotMatch(src, /adsbdb/i);
  assert.doesNotMatch(src, /opensky/i);
});
