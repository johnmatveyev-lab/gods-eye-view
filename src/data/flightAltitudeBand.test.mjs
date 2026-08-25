import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { normalizeAdsbLolAircraftState } from './adsbLolFallback.js';
import {
  ALT_BAND_10K_M,
  ALT_BAND_30K_M,
  ALT_BAND_IDS,
  ALT_BAND_STORAGE_KEY,
  aircraftMatchesAltitudeBand,
  altitudeBandStopLabels,
  applyAltitudeBandToFlights,
  filterFlightsByAltitudeBand,
  getAltitudeBand,
  hydrateAltitudeBand,
  normalizeAltitudeBand,
  readAltitudeBand,
  resetAltitudeBandForTest,
  setAltitudeBand,
  watchlistHighlightAllowed,
  writeAltitudeBand,
} from './flightAltitudeBand.js';
import { formatDistanceMeters } from '../units.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const indexHtml = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const uiSource = readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');
const flightsSource = readFileSync(path.join(ROOT, 'src', 'data', 'flights.js'), 'utf8');
const firstRunSource = readFileSync(path.join(ROOT, 'src', 'firstRunExperience.js'), 'utf8');
const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    snapshot: () => ({ ...data }),
  };
}

function contactFromAdsb(aircraft) {
  const state = normalizeAdsbLolAircraftState({
    hex: aircraft.hex || 'a00001',
    lat: 30.2,
    lon: -97.7,
    ...aircraft,
  }, 1_700_000_000);
  return {
    icao24: state[0],
    callsign: state[1],
    altitudeM: state[7],
    onGround: state[8] === true,
  };
}

const GROUND = contactFromAdsb({ hex: 'gnd001', alt_baro: 'ground', flight: 'GND1' });
const LOW = contactFromAdsb({ hex: 'low001', alt_baro: 3500, flight: 'LOW1' });
const MID = contactFromAdsb({ hex: 'mid001', alt_baro: 18000, flight: 'MID1' });
const HIGH = contactFromAdsb({ hex: 'hi0001', alt_baro: 37000, flight: 'HIGH1' });
const PAYLOAD = [GROUND, LOW, MID, HIGH];

test('adsb.lol 10k/30k feet are the same meter stops the filter uses', () => {
  assert.equal(ALT_BAND_10K_M, 10000 * 0.3048);
  assert.equal(ALT_BAND_30K_M, 30000 * 0.3048);
  assert.equal(contactFromAdsb({ alt_baro: 10000 }).altitudeM, ALT_BAND_10K_M);
  assert.equal(contactFromAdsb({ alt_baro: 30000 }).altitudeM, ALT_BAND_30K_M);
  assert.equal(GROUND.onGround, true);
  assert.equal(GROUND.altitudeM, null);
});

test('>30k hides ground contacts; All restores them', () => {
  const highOnly = filterFlightsByAltitudeBand(PAYLOAD, 'gt30k');
  assert.deepEqual(highOnly.map((row) => row.icao24), ['hi0001']);
  assert.equal(highOnly.some((row) => row.onGround), false);

  const restored = filterFlightsByAltitudeBand(PAYLOAD, 'all');
  assert.equal(restored.length, 4);
  assert.equal(restored.some((row) => row.onGround), true);
  assert.deepEqual(restored.map((row) => row.icao24), ['gnd001', 'low001', 'mid001', 'hi0001']);
});

test('preset bands split surface / <10k / 10-30k / >30k on aviation meters', () => {
  assert.equal(aircraftMatchesAltitudeBand(GROUND, 'surface'), true);
  assert.equal(aircraftMatchesAltitudeBand(LOW, 'surface'), false);
  assert.equal(aircraftMatchesAltitudeBand(LOW, 'lt10k'), true);
  assert.equal(aircraftMatchesAltitudeBand(GROUND, 'lt10k'), false);
  assert.equal(aircraftMatchesAltitudeBand(MID, 'mid'), true);
  assert.equal(aircraftMatchesAltitudeBand(LOW, 'mid'), false);
  assert.equal(aircraftMatchesAltitudeBand(HIGH, 'gt30k'), true);
  assert.equal(aircraftMatchesAltitudeBand(MID, 'gt30k'), false);
  assert.deepEqual(filterFlightsByAltitudeBand(PAYLOAD, 'lt10k').map((row) => row.icao24), ['low001']);
  assert.deepEqual(filterFlightsByAltitudeBand(PAYLOAD, 'mid').map((row) => row.icao24), ['mid001']);
  assert.deepEqual(filterFlightsByAltitudeBand(PAYLOAD, 'surface').map((row) => row.icao24), ['gnd001']);
});

test('units toggle relabels the stops and keeps the same meter math', () => {
  const km = altitudeBandStopLabels('km');
  const nm = altitudeBandStopLabels('nm');
  const mi = altitudeBandStopLabels('mi');

  assert.equal(km.all, 'All');
  assert.equal(km.surface, 'Surface');
  assert.equal(km.lt10k, `<${formatDistanceMeters(ALT_BAND_10K_M, 'km')}`);
  assert.equal(km.mid, `${formatDistanceMeters(ALT_BAND_10K_M, 'km')}–${formatDistanceMeters(ALT_BAND_30K_M, 'km')}`);
  assert.equal(km.gt30k, `>${formatDistanceMeters(ALT_BAND_30K_M, 'km')}`);

  assert.equal(nm.lt10k, `<${formatDistanceMeters(ALT_BAND_10K_M, 'nm')}`);
  assert.equal(nm.gt30k, `>${formatDistanceMeters(ALT_BAND_30K_M, 'nm')}`);
  assert.equal(mi.lt10k, `<${formatDistanceMeters(ALT_BAND_10K_M, 'mi')}`);
  assert.equal(mi.gt30k, `>${formatDistanceMeters(ALT_BAND_30K_M, 'mi')}`);

  assert.notEqual(km.lt10k, nm.lt10k);
  assert.notEqual(km.gt30k, mi.gt30k);

  const highKm = filterFlightsByAltitudeBand(PAYLOAD, normalizeAltitudeBand('gt30k'));
  const highNm = filterFlightsByAltitudeBand(PAYLOAD, normalizeAltitudeBand({ id: 'gt30k', unit: 'nm' }));
  assert.deepEqual(highKm.map((row) => row.icao24), highNm.map((row) => row.icao24));
  assert.equal(normalizeAltitudeBand('gt30k').minM, ALT_BAND_30K_M);
  assert.equal(normalizeAltitudeBand({ id: 'gt30k', unit: 'mi' }).minM, ALT_BAND_30K_M);
});

test('empty band yields an empty layer and does not hang', () => {
  const empty = applyAltitudeBandToFlights(PAYLOAD, { minM: 8000, maxM: 1000 });
  assert.equal(empty.hang, false);
  assert.equal(empty.visible.length, 0);
  assert.equal(empty.hidden.length, 4);
  assert.deepEqual(filterFlightsByAltitudeBand(PAYLOAD, { minM: 50_000, maxM: 60_000 }), []);
  assert.equal(aircraftMatchesAltitudeBand(HIGH, { minM: 20_000, maxM: 1000 }), false);
});

test('watchlist still highlights only when the ident is in-band and in the payload', () => {
  assert.equal(watchlistHighlightAllowed({
    watched: true,
    inPayload: true,
    inBand: aircraftMatchesAltitudeBand(HIGH, 'gt30k'),
  }), true);
  assert.equal(watchlistHighlightAllowed({
    watched: true,
    inPayload: true,
    inBand: aircraftMatchesAltitudeBand(GROUND, 'gt30k'),
  }), false);
  assert.equal(watchlistHighlightAllowed({
    watched: true,
    inPayload: false,
    inBand: true,
  }), false);
});

test('meridian.altBand persists and reload keeps the choice', () => {
  resetAltitudeBandForTest();
  const storage = memoryStorage();
  assert.equal(ALT_BAND_STORAGE_KEY, 'meridian.altBand');
  assert.equal(readAltitudeBand(storage).id, 'all');
  assert.equal(setAltitudeBand('gt30k', { storage }).id, 'gt30k');
  assert.equal(storage.getItem(ALT_BAND_STORAGE_KEY), 'gt30k');
  assert.equal(getAltitudeBand().id, 'gt30k');

  resetAltitudeBandForTest();
  assert.equal(getAltitudeBand().id, 'all');
  assert.equal(hydrateAltitudeBand(storage).id, 'gt30k');
  assert.equal(getAltitudeBand().id, 'gt30k');
  writeAltitudeBand('all', storage);
  assert.equal(storage.getItem(ALT_BAND_STORAGE_KEY), 'all');
  resetAltitudeBandForTest();
});

test('DISPLAY chrome and flights layer stay client-side on the current payload', () => {
  assert.deepEqual(ALT_BAND_IDS, ['all', 'surface', 'lt10k', 'mid', 'gt30k']);
  assert.match(indexHtml, /id="alt-band-row"/);
  assert.match(indexHtml, /data-alt-band="all"/);
  assert.match(indexHtml, /data-alt-band="gt30k"/);
  assert.match(uiSource, /hydrateAltitudeBand|setAltitudeBand/);
  assert.match(uiSource, /altitudeBandStopLabels/);
  assert.match(uiSource, /subscribeDistanceUnit/);
  assert.match(flightsSource, /aircraftMatchesAltitudeBand|filterFlightsByAltitudeBand|applyAltitudeBandToFlights/);
  assert.match(flightsSource, /hydrateAltitudeBand|getAltitudeBand|subscribeAltitudeBand/);
  assert.doesNotMatch(uiSource.slice(uiSource.indexOf('_initAltitudeBand'), uiSource.indexOf('_initAltitudeBand') + 800), /fetch\(|\/api\//);
  assert.doesNotMatch(flightsSource, /opensky-network\.org|google\.com\/news|telegeography/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
});

test('first-run missions do not write meridian.altBand', () => {
  const code = firstRunSource.slice(firstRunSource.indexOf('export function shouldShowFirstRun'));
  assert.match(firstRunSource, /meridian\.altBand/);
  for (const forbidden of ['setAltitudeBand', 'writeAltitudeBand', 'hydrateAltitudeBand']) {
    assert.doesNotMatch(code, new RegExp(forbidden), `a mission must never touch ${forbidden}`);
  }
});
