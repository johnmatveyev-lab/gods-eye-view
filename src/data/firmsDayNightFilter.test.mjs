// PLAN 137 — FIRMS Day | Night filter. Pure client-only predicates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFirmsDayNight,
  filterFiresByDayNight,
  fireMeetsDayNight,
  firmsDayNightChipModels,
  normalizeFirmsDayNight,
} from './firmsDayNightFilter.js';

const DAY = { daynight: 'D', night: false, frp: 10 };
const NIGHT = { daynight: 'N', night: true, frp: 20 };
const UNKNOWN_BLANK = { daynight: '', night: false, frp: 30 };
const UNKNOWN_FLAG = { daynight: 'X', frp: 40 };
const BARE_DAY = { night: false, frp: 50 };
const BARE_NIGHT = { night: true, frp: 60 };

test('normalizeFirmsDayNight: default both on; only explicit false turns a chip off', () => {
  assert.deepEqual(normalizeFirmsDayNight(), { showDay: true, showNight: true });
  assert.deepEqual(normalizeFirmsDayNight({}), { showDay: true, showNight: true });
  assert.deepEqual(normalizeFirmsDayNight({ showNight: false }), { showDay: true, showNight: false });
  assert.deepEqual(normalizeFirmsDayNight({ showDay: false, showNight: true }), {
    showDay: false,
    showNight: true,
  });
});

test('classifyFirmsDayNight: N/night, D, bare night=false as day, missing as unknown', () => {
  assert.equal(classifyFirmsDayNight(NIGHT), 'night');
  assert.equal(classifyFirmsDayNight(BARE_NIGHT), 'night');
  assert.equal(classifyFirmsDayNight(DAY), 'day');
  assert.equal(classifyFirmsDayNight(BARE_DAY), 'day');
  assert.equal(classifyFirmsDayNight(UNKNOWN_BLANK), 'unknown');
  assert.equal(classifyFirmsDayNight(UNKNOWN_FLAG), 'unknown');
  assert.equal(classifyFirmsDayNight({}), 'unknown');
  assert.equal(classifyFirmsDayNight(null), 'unknown');
});

test('both on keeps every detection; Night off hides N and keeps day', () => {
  const fires = [DAY, NIGHT, UNKNOWN_BLANK, BARE_DAY];
  assert.deepEqual(filterFiresByDayNight(fires, { showDay: true, showNight: true }).map((f) => f.frp), [10, 20, 30, 50]);
  assert.deepEqual(filterFiresByDayNight(fires, { showDay: true, showNight: false }).map((f) => f.frp), [10, 30, 50]);
  assert.deepEqual(filterFiresByDayNight(fires, { showDay: false, showNight: true }).map((f) => f.frp), [20, 30]);
});

test('missing and unknown daynight stay visible under every chip set', () => {
  const bothOff = { showDay: false, showNight: false };
  assert.equal(fireMeetsDayNight(UNKNOWN_BLANK, bothOff), true);
  assert.equal(fireMeetsDayNight(UNKNOWN_FLAG, bothOff), true);
  assert.equal(fireMeetsDayNight({}, { showDay: false }), true);
  assert.equal(fireMeetsDayNight(DAY, bothOff), false);
  assert.equal(fireMeetsDayNight(NIGHT, bothOff), false);
});

test('Day | Night chips toggle the opposite boolean and default both active', () => {
  const both = firmsDayNightChipModels();
  assert.deepEqual(both.map((chip) => chip.label), ['Day', 'Night']);
  assert.equal(both.every((chip) => chip.active), true);
  assert.deepEqual(both[0].params, { showDay: false });
  assert.deepEqual(both[1].params, { showNight: false });

  const nightOff = firmsDayNightChipModels({ showDay: true, showNight: false });
  assert.equal(nightOff.find((chip) => chip.label === 'Day').active, true);
  assert.equal(nightOff.find((chip) => chip.label === 'Night').active, false);
  assert.deepEqual(nightOff.find((chip) => chip.label === 'Night').params, { showNight: true });
});
