import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cockpitEnterControlVisible,
  cockpitExitControlVisible,
  isCockpitEligibleSelection,
  requestCockpitEnter,
} from './cockpitEnterControl.js';

test('enter control is visible only for a selected aircraft', () => {
  assert.equal(cockpitEnterControlVisible({
    cockpitActive: false,
    selectedAircraft: { layerId: 'flights', icao24: 'abc123' },
  }), true);
  assert.equal(cockpitEnterControlVisible({
    cockpitActive: false,
    selectedAircraft: { layerId: 'military', icao24: 'ae01ce' },
  }), true);
  assert.equal(cockpitEnterControlVisible({
    cockpitActive: false,
    selectedAircraft: null,
  }), false, 'deselect hides the control');
});

test('enter control stays hidden while already in cockpit', () => {
  assert.equal(cockpitEnterControlVisible({
    cockpitActive: true,
    selectedAircraft: { layerId: 'flights', icao24: 'abc123' },
  }), false);
});

test('cockpit enter is aircraft-only and never offered for people', () => {
  assert.equal(isCockpitEligibleSelection({ layerId: 'people', id: 'p1' }), false);
  assert.equal(isCockpitEligibleSelection({ layerId: 'person', id: 'p1' }), false);
  assert.equal(isCockpitEligibleSelection({ kind: 'person', id: 'p1' }), false);
  assert.equal(isCockpitEligibleSelection({ layerId: 'ais-live-vessels', id: 'mmsi' }), false);
  assert.equal(isCockpitEligibleSelection({ layerId: 'satellites', id: '25544' }), false);
  assert.equal(isCockpitEligibleSelection({ layerId: 'military-installations', id: 'site' }), false);
  assert.equal(isCockpitEligibleSelection({ layerId: 'flights', icao24: 'abc123' }), true);
  assert.equal(cockpitEnterControlVisible({
    cockpitActive: false,
    selectedAircraft: { layerId: 'people', id: 'p1' },
  }), false);
});

test('exit control is visible only while cockpit is active', () => {
  assert.equal(cockpitExitControlVisible({ cockpitActive: true }), true);
  assert.equal(cockpitExitControlVisible({ cockpitActive: false }), false);
});

test('requestCockpitEnter uses the existing enter action after Contacts is ready', async () => {
  const calls = [];
  const result = await requestCockpitEnter({
    isEntryAllowed: () => true,
    setContextMode: async () => {
      calls.push('context');
      return { ok: true };
    },
    controlCockpit: async (action) => {
      calls.push(action);
      return { ok: true, action: 'control_cockpit' };
    },
  });
  assert.deepEqual(calls, ['enter']);
  assert.equal(result.ok, true);
});

test('requestCockpitEnter establishes Contacts before the existing enter action', async () => {
  const calls = [];
  const result = await requestCockpitEnter({
    isEntryAllowed: () => calls.includes('context'),
    setContextMode: async (mode, options) => {
      calls.push('context');
      assert.equal(mode, 'flights');
      assert.equal(options.claimVisualAuthority, false);
      return { ok: true };
    },
    controlCockpit: async (action) => {
      calls.push(action);
      return { ok: true, action: 'control_cockpit' };
    },
  });
  assert.deepEqual(calls, ['context', 'enter']);
  assert.equal(result.ok, true);
});

test('requestCockpitEnter does not enter when Contacts cannot be established', async () => {
  const calls = [];
  const result = await requestCockpitEnter({
    isEntryAllowed: () => false,
    setContextMode: async () => {
      calls.push('context');
      return { ok: false, error: 'Contacts context could not be established for Cockpit entry' };
    },
    controlCockpit: async () => {
      calls.push('enter');
      return { ok: true };
    },
  });
  assert.deepEqual(calls, ['context']);
  assert.equal(result.ok, false);
  assert.match(result.error, /Contacts/);
});
