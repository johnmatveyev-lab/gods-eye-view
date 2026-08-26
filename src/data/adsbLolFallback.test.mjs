import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  normalizeAdsbLolAircraftState,
  normalizeAdsbLolPointResponse,
} from './adsbLolFallback.js';
import { passesHideNoTypeFilter } from './flightHideNoTypeFilter.js';
import { passesHideNoHeadingFilter } from './flightHideNoHeadingFilter.js';
import { passesHideNoCallsignFilter } from './flightHideNoCallsignFilter.js';
import { passesHideNoSpeedFilter } from './flightHideNoSpeedFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('normalizes adsb.lol units into an OpenSky-compatible state vector', () => {
  const state = normalizeAdsbLolAircraftState({
    hex: 'A1B2C3',
    flight: 'UAL123 ',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
    alt_geom: 10200,
    gs: 200,
    track: 90,
    baro_rate: 600,
    seen_pos: 2,
    seen: 1,
    category: 'A3',
    squawk: '1200',
  }, 1000);

  assert.equal(state[0], 'a1b2c3');
  assert.equal(state[1], 'UAL123');
  assert.equal(state[2], null);
  assert.equal(state[3], 998);
  assert.equal(state[5], -97);
  assert.equal(state[6], 30);
  assert.equal(state[7], 3048);
  assert.ok(Math.abs(state[9] - 102.8888) < 0.001);
  assert.equal(state[10], 90);
  assert.ok(Math.abs(state[11] - 3.048) < 0.001);
  assert.equal(state[13], 3108.96);
  assert.equal(state[14], '1200');
  assert.equal(state[17], 4);
});

test('persists adsb.lol t and r on the normalized payload; missing t stays missing', () => {
  const aal2056 = normalizeAdsbLolAircraftState({
    hex: 'a1b2c3',
    flight: 'AAL2056',
    t: 'A321',
    r: 'N138AN',
    lat: 30.25,
    lon: -97.75,
    alt_baro: 36000,
    gs: 450,
    track: 90,
  }, 1000);

  assert.equal(aal2056.t, 'A321');
  assert.equal(aal2056.r, 'N138AN');
  assert.equal(aal2056[18], 'A321');
  assert.equal(aal2056[19], 'N138AN');
  assert.equal(aal2056[2], null, 'origin country stays unpublished');

  const wire = JSON.parse(JSON.stringify({
    time: 1000,
    states: [aal2056],
  }));
  assert.equal(wire.states[0][18], 'A321', 't survives JSON for the /api/opensky wire');
  assert.equal(wire.states[0][19], 'N138AN', 'r survives JSON for the /api/opensky wire');

  const missingType = normalizeAdsbLolAircraftState({
    hex: 'def456',
    flight: 'UNK1',
    r: 'N999ZZ',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
  }, 1000);
  assert.equal(missingType.t, null, 'missing t stays missing — do not invent');
  assert.equal(missingType[18], null);
  assert.equal(missingType.r, 'N999ZZ');

  const emptyType = normalizeAdsbLolAircraftState({
    hex: 'abc789',
    flight: 'JBU608',
    t: '   ',
    r: 'N981JT',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
  }, 1000);
  assert.equal(emptyType.t, null, 'whitespace t stays missing');
  assert.equal(emptyType[18], null);
  assert.equal(emptyType.r, 'N981JT');

  const crj2 = normalizeAdsbLolAircraftState({
    hex: '0d0c0b',
    flight: 'VTM304',
    t: 'CRJ2',
    r: 'XA-VCX',
    lat: 30,
    lon: -97,
    alt_baro: 28000,
  }, 1000);
  assert.equal(crj2.t, 'CRJ2');
  assert.equal(crj2.r, 'XA-VCX');

  // Existing Hide no type matcher — not rewritten. A published t stays;
  // a missing t still fail-closes.
  assert.equal(passesHideNoTypeFilter({ typeCode: aal2056.t, hideNoType: true }), true);
  assert.equal(passesHideNoTypeFilter({ typeCode: crj2.t, hideNoType: true }), true);
  assert.equal(passesHideNoTypeFilter({ typeCode: missingType.t, hideNoType: true }), false);
  assert.equal(passesHideNoTypeFilter({ typeCode: emptyType.t, hideNoType: true }), false);
  const helper = readFileSync(path.join(ROOT, 'src/data/flightHideNoTypeFilter.js'), 'utf8');
  assert.match(helper, /typeCodeFieldText/);
  assert.doesNotMatch(readFileSync(path.join(ROOT, 'src/data/adsbLolFallback.js'), 'utf8'), /typeCode/);
});

test('persists adsb.lol true_heading / mag_heading into the track slot; dir is unused', () => {
  const aa0013 = normalizeAdsbLolAircraftState({
    hex: 'ac8577',
    flight: 'AA0013',
    lat: 30.25,
    lon: -97.75,
    alt_baro: 36000,
    gs: 420,
    track: null,
    true_heading: 180,
    dir: 45,
  }, 1000);
  assert.equal(aa0013[10], 180, 'missing track + true_heading 180 keeps 180');

  const wire = JSON.parse(JSON.stringify({
    time: 1000,
    states: [aa0013],
  }));
  assert.equal(wire.states[0][10], 180, 'heading survives JSON for the /api/opensky wire');

  const westMag = normalizeAdsbLolAircraftState({
    hex: 'a733e6',
    flight: '9999',
    lat: 30.25,
    lon: -97.75,
    alt_baro: 8000,
    gs: 180,
    track: null,
    mag_heading: 270,
    dir: 90,
  }, 1000);
  assert.equal(westMag[10], 270, 'missing track + mag_heading 270 keeps 270');
  assert.equal(JSON.parse(JSON.stringify(westMag))[10], 270);

  const publishedTrack = normalizeAdsbLolAircraftState({
    hex: 'abc123',
    flight: 'UAL1',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
    track: 90,
    true_heading: 180,
    mag_heading: 270,
    dir: 45,
  }, 1000);
  assert.equal(publishedTrack[10], 90, 'published track wins; true_heading ignored');

  const missingHeading = normalizeAdsbLolAircraftState({
    hex: 'def456',
    flight: 'UNK1',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
    track: null,
    dir: 123,
  }, 1000);
  assert.equal(missingHeading[10], null, 'missing track + missing headings stays missing');

  const dirOnly = normalizeAdsbLolAircraftState({
    hex: 'fedcba',
    flight: 'DIR1',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
    dir: 45,
  }, 1000);
  assert.equal(dirOnly[10], null, 'dir is never written as heading');

  // Existing Hide no heading matcher — not rewritten. A persisted heading
  // stays; a missing heading still fail-closes.
  assert.equal(passesHideNoHeadingFilter({ true_track: aa0013[10], hideNoHeading: true }), true);
  assert.equal(passesHideNoHeadingFilter({ true_track: westMag[10], hideNoHeading: true }), true);
  assert.equal(passesHideNoHeadingFilter({ true_track: missingHeading[10], hideNoHeading: true }), false);
  assert.equal(passesHideNoHeadingFilter({ true_track: dirOnly[10], hideNoHeading: true }), false);

  const adapter = readFileSync(path.join(ROOT, 'src/data/adsbLolFallback.js'), 'utf8');
  assert.doesNotMatch(adapter, /aircraft\?\.dir/);
  assert.doesNotMatch(adapter, /hideNoHeading|hide-no-heading|flightHideNoHeadingFilter/);
});

test('persists published flight only in the callsign slot; r stays on registration', () => {
  const published = normalizeAdsbLolAircraftState({
    hex: 'a1b2c3',
    flight: 'UAL123',
    r: 'N138AN',
    t: 'A321',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
    track: 90,
  }, 1000);
  assert.equal(published[1], 'UAL123', 'published flight copies into state[1]');
  assert.equal(published[19], 'N138AN', 'r still lands on the registration slot');
  assert.equal(published.r, 'N138AN');

  // Cached adsblol 200 leftovers: unpublished / blank / whitespace flight
  // with published r (civil N752MC/C30J, A-7306/B734, ZP804/P8). Hide no
  // callsign must hide these — do not copy r into the callsign slot.
  const n752mc = normalizeAdsbLolAircraftState({
    hex: 'abc111',
    r: 'N752MC',
    t: 'C30J',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
  }, 1000);
  assert.equal(n752mc[1], null, 'unpublished flight stays empty — do not copy r');
  assert.equal(n752mc[19], 'N752MC');
  assert.equal(n752mc.r, 'N752MC');
  assert.equal(n752mc.t, 'C30J');

  const blankFlight = normalizeAdsbLolAircraftState({
    hex: 'abc222',
    flight: '',
    r: 'A-7306',
    t: 'B734',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
  }, 1000);
  assert.equal(blankFlight[1], null, 'blank flight stays empty — do not copy r');
  assert.equal(blankFlight[19], 'A-7306');

  const whitespaceFlight = normalizeAdsbLolAircraftState({
    hex: 'abc333',
    flight: '   ',
    r: 'ZP804',
    t: 'P8',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
  }, 1000);
  assert.equal(whitespaceFlight[1], null, 'whitespace flight stays empty — do not copy r');
  assert.equal(whitespaceFlight[19], 'ZP804');

  const missingBoth = normalizeAdsbLolAircraftState({
    hex: 'abc444',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
  }, 1000);
  assert.equal(missingBoth[1], null, 'missing flight and r stay empty');
  assert.equal(missingBoth[19], null);

  const wire = JSON.parse(JSON.stringify({
    time: 1000,
    states: [n752mc],
  }));
  assert.equal(wire.states[0][1], null, 'empty callsign survives JSON for the /api/opensky wire');
  assert.equal(wire.states[0][19], 'N752MC', 'r still survives JSON on the registration slot');

  // Existing Hide no callsign matcher — not rewritten. Unpublished flight
  // fail-closes; published flight stays. Registration is not a callsign.
  assert.equal(passesHideNoCallsignFilter({ callsign: published[1], hideNoCallsign: true }), true);
  assert.equal(passesHideNoCallsignFilter({ callsign: n752mc[1], hideNoCallsign: true }), false);
  assert.equal(passesHideNoCallsignFilter({ callsign: blankFlight[1], hideNoCallsign: true }), false);
  assert.equal(passesHideNoCallsignFilter({ callsign: whitespaceFlight[1], hideNoCallsign: true }), false);
  assert.equal(passesHideNoCallsignFilter({ callsign: missingBoth[1], hideNoCallsign: true }), false);

  const adapter = readFileSync(path.join(ROOT, 'src/data/adsbLolFallback.js'), 'utf8');
  assert.doesNotMatch(adapter, /flight \|\| aircraft\?\.r/);
  assert.doesNotMatch(adapter, /hideNoCallsign|hide-no-callsign|flightHideNoCallsignFilter/);
});

test('persists adsb.lol tas / ias into the velocity slot when gs is missing', () => {
  const publishedGs = normalizeAdsbLolAircraftState({
    hex: 'a1b2c3',
    flight: 'UAL123',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
    gs: 200,
    tas: 420,
    ias: 180,
  }, 1000);
  assert.ok(Math.abs(publishedGs[9] - 102.8888) < 0.001, 'gs 200 keeps gs (converted)');

  const tasOnly = normalizeAdsbLolAircraftState({
    hex: 'ac8577',
    flight: 'AA0013',
    lat: 30.25,
    lon: -97.75,
    alt_baro: 36000,
    tas: 420,
  }, 1000);
  assert.ok(Math.abs(tasOnly[9] - (420 * 0.514444)) < 0.001, 'missing gs + tas 420 keeps tas × 0.514444');

  const wire = JSON.parse(JSON.stringify({
    time: 1000,
    states: [tasOnly],
  }));
  assert.ok(Math.abs(wire.states[0][9] - (420 * 0.514444)) < 0.001, 'velocity survives JSON for the /api/opensky wire');

  const iasOnly = normalizeAdsbLolAircraftState({
    hex: 'a733e6',
    flight: '9999',
    lat: 30.25,
    lon: -97.75,
    alt_baro: 8000,
    ias: 180,
  }, 1000);
  assert.ok(Math.abs(iasOnly[9] - (180 * 0.514444)) < 0.001, 'missing gs + ias 180 keeps ias converted');
  assert.ok(Math.abs(JSON.parse(JSON.stringify(iasOnly))[9] - (180 * 0.514444)) < 0.001);

  const tasOverIas = normalizeAdsbLolAircraftState({
    hex: 'abc123',
    flight: 'UAL1',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
    tas: 420,
    ias: 180,
  }, 1000);
  assert.ok(Math.abs(tasOverIas[9] - (420 * 0.514444)) < 0.001, 'missing gs + tas wins over ias');

  const missingSpeed = normalizeAdsbLolAircraftState({
    hex: 'def456',
    flight: 'UNK1',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
  }, 1000);
  assert.equal(missingSpeed[9], null, 'missing gs/tas/ias stays null — never 0');

  // Existing Hide no speed matcher — not rewritten. A persisted velocity
  // stays; a missing velocity still fail-closes. Off (default draw) still
  // passes when gs is present.
  assert.equal(passesHideNoSpeedFilter({ velocity: publishedGs[9], hideNoSpeed: true }), true);
  assert.equal(passesHideNoSpeedFilter({ velocity: tasOnly[9], hideNoSpeed: true }), true);
  assert.equal(passesHideNoSpeedFilter({ velocity: iasOnly[9], hideNoSpeed: true }), true);
  assert.equal(passesHideNoSpeedFilter({ velocity: missingSpeed[9], hideNoSpeed: true }), false);
  assert.equal(passesHideNoSpeedFilter({ velocity: publishedGs[9] }), true, 'default draw unchanged when gs is present');

  const adapter = readFileSync(path.join(ROOT, 'src/data/adsbLolFallback.js'), 'utf8');
  assert.doesNotMatch(adapter, /hideNoSpeed|hide-no-speed|flightHideNoSpeedFilter/);
});

test('keeps grounded fallback contacts and rejects rows without positions', () => {
  const normalized = normalizeAdsbLolPointResponse({
    now: 1_700_000_000_000,
    ac: [
      { hex: 'abc123', lat: 0, lon: 0, alt_baro: 'ground', gs: 8 },
      { hex: 'def456', lat: null, lon: 10, alt_baro: 5000 },
    ],
  });

  assert.equal(normalized.time, 1_700_000_000);
  assert.equal(normalized.states.length, 1);
  assert.equal(normalized.states[0][7], null);
  assert.equal(normalized.states[0][8], true);
});
