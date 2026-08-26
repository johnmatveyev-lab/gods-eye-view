import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAdsbLolAircraftState,
  normalizeAdsbLolPointResponse,
} from './adsbLolFallback.js';

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
