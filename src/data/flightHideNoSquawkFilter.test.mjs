import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  HIDE_NO_SQUAWK_CHIP_ID,
  HIDE_NO_SQUAWK_CHIP_LABEL,
  HIDE_NO_SQUAWK_DEFAULT,
  HIDE_NO_SQUAWK_STORAGE_KEY,
  contactHasSquawk,
  getHideNoSquawkEnabled,
  hideNoSquawkChipModel,
  hydrateHideNoSquawkEnabled,
  normalizeHideNoSquawk,
  passesHideNoSquawkFilter,
  readHideNoSquawkEnabled,
  resetHideNoSquawkForTest,
  setHideNoSquawkEnabled,
  squawkFieldText,
  subscribeHideNoSquawkEnabled,
  writeHideNoSquawkEnabled,
} from './flightHideNoSquawkFilter.js';
import flightsLayer, {
  _addFlightTrackingCandidateForTest,
  _applyOperatorContactVisibilityForTest,
  _setTrackedFlightRefreshStateForTest,
} from './flights.js';
import { setAltitudeBand } from './flightAltitudeBand.js';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
  normalizeLayerState,
} from './layerState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (name) => readFileSync(path.join(ROOT, 'src', name), 'utf8');
const data = (name) => readFileSync(path.join(ROOT, 'src/data', name), 'utf8');
const root = (name) => readFileSync(path.join(ROOT, name), 'utf8');

function memoryStorage(initial = {}) {
  const dataMap = { ...initial };
  return {
    getItem(key) {
      return Object.hasOwn(dataMap, key) ? dataMap[key] : null;
    },
    setItem(key, value) {
      dataMap[key] = String(value);
    },
    snapshot() {
      return { ...dataMap };
    },
  };
}

function emptyViewer() {
  return {
    isDestroyed: () => false,
    entities: { add() { return {}; }, remove() {} },
    scene: { requestRender() {} },
  };
}

function emptyBillboard(color = Cesium.Color.WHITE) {
  return {
    show: true,
    width: 20,
    height: 20,
    color,
    scale: 1,
    rotation: 0,
  };
}

function resetHideNoSquawkLayers() {
  resetHideNoSquawkForTest();
  flightsLayer.setParams({
    hideNoSquawk: false,
    identifiedOnly: false,
    airborneOnly: false,
    emergenciesOnly: false,
    callsignPrefixes: '',
    aircraftClassFilter: 'all',
    showClimb: true,
    showLevel: true,
    showDescent: true,
    speedMinKt: null,
    speedMaxKt: null,
    selectedFlightsTrackingId: null,
  });
  setAltitudeBand('all', { persist: false });
}

test('Hide no squawk defaults off and treats missing/null/blank/whitespace as empty', () => {
  assert.equal(HIDE_NO_SQUAWK_DEFAULT, false);
  assert.equal(HIDE_NO_SQUAWK_STORAGE_KEY, 'meridian.flightHideNoSquawk');
  assert.equal(normalizeHideNoSquawk(undefined), false);
  assert.equal(normalizeHideNoSquawk(null), false);
  assert.equal(normalizeHideNoSquawk('nope'), false);
  assert.equal(normalizeHideNoSquawk(false), false);
  assert.equal(normalizeHideNoSquawk(true), true);
  assert.equal(normalizeHideNoSquawk('1'), true);

  assert.equal(squawkFieldText(undefined), '');
  assert.equal(squawkFieldText(null), '');
  assert.equal(squawkFieldText(''), '');
  assert.equal(squawkFieldText('   '), '');
  assert.equal(squawkFieldText('1200'), '1200');
  assert.equal(squawkFieldText(' 7700 '), '7700');

  assert.equal(contactHasSquawk({ squawk: '1200' }), true);
  assert.equal(contactHasSquawk({ squawk: '7700' }), true);
  assert.equal(contactHasSquawk({ squawk: '7500' }), true);
  assert.equal(contactHasSquawk({ squawk: '   ' }), false);
  assert.equal(contactHasSquawk({ squawk: null }), false);
  assert.equal(contactHasSquawk({}), false);

  const empty = { squawk: null };
  const vfr = { squawk: '1200' };
  const emergency = { squawk: '7700' };
  const whitespace = { squawk: '   ' };

  for (const contact of [empty, vfr, emergency, whitespace]) {
    assert.equal(passesHideNoSquawkFilter({ ...contact, hideNoSquawk: false }), true);
  }
  assert.equal(passesHideNoSquawkFilter({ ...empty, hideNoSquawk: true }), false);
  assert.equal(passesHideNoSquawkFilter({ ...vfr, hideNoSquawk: true }), true);
  assert.equal(passesHideNoSquawkFilter({ ...emergency, hideNoSquawk: true }), true);
  assert.equal(passesHideNoSquawkFilter({ ...whitespace, hideNoSquawk: true }), false);

  const chip = hideNoSquawkChipModel(false);
  assert.equal(chip.label, HIDE_NO_SQUAWK_CHIP_LABEL);
  assert.equal(chip.id, HIDE_NO_SQUAWK_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoSquawk: true });
  assert.deepEqual(hideNoSquawkChipModel(true).params, { hideNoSquawk: false });
});

test('off keeps the current fleet; on hides empty squawk and keeps 1200/7700', () => {
  const empty = emptyBillboard();
  const vfr = emptyBillboard();
  const emergency = emptyBillboard();
  const blank = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'a1b2c3',
    meta: { callsign: 'DAL123', squawk: null, klass: 'airliner', onGround: false },
    billboard: empty,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'vfr001',
    meta: { callsign: 'N123AB', squawk: '1200', klass: 'small', onGround: false },
    billboard: vfr,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'emg001',
    meta: { callsign: 'UAL100', squawk: '7700', klass: 'airliner', onGround: false },
    billboard: emergency,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'ws0001',
    meta: { callsign: 'SWA1', squawk: '   ', klass: 'airliner', onGround: false },
    billboard: blank,
  });
  try {
    assert.equal(flightsLayer.getParams().hideNoSquawk, false);
    assert.equal(empty.show, true);
    assert.equal(vfr.show, true);
    assert.equal(emergency.show, true);
    assert.equal(blank.show, true);

    assert.equal(flightsLayer.setParams({ hideNoSquawk: true }), true);
    assert.equal(flightsLayer.getParams().hideNoSquawk, true);
    assert.equal(empty.show, false, 'empty-squawk contact hides');
    assert.equal(vfr.show, true, '1200 stays');
    assert.equal(emergency.show, true, '7700 stays');
    assert.equal(blank.show, false, 'whitespace-only is empty');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: { klass: 'airliner', onGround: false },
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().hideNoSquawk, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(vfr.show, true);

    flightsLayer.setParams({ hideNoSquawk: false });
    assert.equal(empty.show, true);
    assert.equal(blank.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetHideNoSquawkLayers();
  }
});

test('tracked contact stays visible when Hide no squawk is on and it has no squawk', () => {
  const selected = emptyBillboard();
  const otherEmpty = emptyBillboard();
  const coded = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: { callsign: 'DAL9', squawk: null, klass: 'airliner', onGround: false },
    billboard: selected,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: true,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'othhex',
    meta: { callsign: 'SWA2', squawk: '', klass: 'airliner', onGround: false },
    billboard: otherEmpty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'ual001',
    meta: { callsign: 'UAL100', squawk: '1200', klass: 'airliner', onGround: false },
    billboard: coded,
  });
  try {
    flightsLayer.setParams({ hideNoSquawk: true });
    assert.equal(selected.show, true, 'tracked empty-squawk contact stays');
    assert.equal(otherEmpty.show, false);
    assert.equal(coded.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked empty-squawk hides');
    assert.equal(coded.show, true);
  } finally {
    resetHideNoSquawkLayers();
  }
});

test('Hide no squawk ANDs with other flight chips and stays distinct from 166/188', () => {
  const lowIdentified = emptyBillboard();
  const highIdentified = emptyBillboard();
  const highEmpty = emptyBillboard();
  const parkedIdentified = emptyBillboard();
  const vfrIdentified = emptyBillboard();
  const emergencyHex = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'andhigh',
    meta: {
      callsign: 'UAL100',
      registration: 'N100UA',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: highIdentified,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andlow',
    meta: {
      callsign: 'UAL200',
      registration: '',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 2000,
      velocity: 80,
      verticalRate: 8,
    },
    billboard: lowIdentified,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhex',
    meta: {
      callsign: 'SWA9',
      registration: 'N9SW',
      squawk: null,
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: highEmpty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andpark',
    meta: {
      callsign: 'N123AB',
      registration: 'N123AB',
      squawk: '1200',
      klass: 'helicopter',
      onGround: true,
      altitude: 0,
      velocity: 0,
      verticalRate: 0,
    },
    billboard: parkedIdentified,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andvfr',
    meta: {
      callsign: '',
      registration: '',
      squawk: '1200',
      klass: 'small',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: vfrIdentified,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andemg',
    meta: {
      callsign: '',
      registration: '',
      squawk: '7700',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: emergencyHex,
  });
  try {
    flightsLayer.setParams({
      hideNoSquawk: true,
      identifiedOnly: false,
      airborneOnly: false,
      emergenciesOnly: false,
      callsignPrefixes: '',
      aircraftClassFilter: 'all',
    });
    assert.equal(highIdentified.show, true);
    assert.equal(lowIdentified.show, true);
    assert.equal(highEmpty.show, false, 'empty squawk hides while Identified only is off');
    assert.equal(parkedIdentified.show, true);
    assert.equal(vfrIdentified.show, true, '1200 hex-only stays — distinct from Identified only');
    assert.equal(emergencyHex.show, true, '7700 stays — Hide no squawk is not Emergencies only');

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(highIdentified.show, true);
    assert.equal(parkedIdentified.show, false, 'AND: grounded coded contact hides under airborne-only');

    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highIdentified.show, true, 'AND: in-band coded remains');
    assert.equal(lowIdentified.show, false, 'AND: coded but out-of-band hides');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ airborneOnly: false, callsignPrefixes: 'UAL' });
    assert.equal(highIdentified.show, true, 'AND: matching coded remains');
    assert.equal(parkedIdentified.show, false, 'AND: prefix still hides a non-UAL coded');

    flightsLayer.setParams({ callsignPrefixes: '', aircraftClassFilter: 'airliner' });
    assert.equal(highIdentified.show, true);
    assert.equal(parkedIdentified.show, false, 'AND: class chip still hides a helo coded');

    flightsLayer.setParams({ aircraftClassFilter: 'all', speedMinKt: 200, speedMaxKt: null });
    assert.equal(highIdentified.show, true, 'AND: in-band speed remains');
    assert.equal(lowIdentified.show, false, 'AND: coded but below speed floor hides');

    flightsLayer.setParams({ speedMinKt: null, showClimb: false, showLevel: true, showDescent: true });
    assert.equal(highIdentified.show, true, 'AND: level coded remains');
    assert.equal(lowIdentified.show, false, 'AND: climbing coded hides when climb is off');

    flightsLayer.setParams({ showClimb: true, identifiedOnly: true });
    assert.equal(highIdentified.show, true);
    assert.equal(vfrIdentified.show, false, 'AND: Identified only still hides hex-only 1200');
    assert.equal(emergencyHex.show, false, 'AND: Identified only still hides hex-only 7700');
    assert.equal(highEmpty.show, false);

    flightsLayer.setParams({ identifiedOnly: false, emergenciesOnly: true });
    assert.equal(emergencyHex.show, true, 'AND: Emergencies only keeps 7700');
    assert.equal(highIdentified.show, false, 'AND: Emergencies only hides 1200 — distinct from Hide no squawk');
    assert.equal(vfrIdentified.show, false);
  } finally {
    resetHideNoSquawkLayers();
  }
});

test('Hide no squawk persists meridian.flightHideNoSquawk and survives coordinator restore', () => {
  resetHideNoSquawkForTest();
  assert.equal(HIDE_NO_SQUAWK_STORAGE_KEY, 'meridian.flightHideNoSquawk');
  assert.equal(readHideNoSquawkEnabled(memoryStorage()), false);
  const storage = memoryStorage();
  assert.equal(writeHideNoSquawkEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightHideNoSquawk': '1' });
  assert.equal(readHideNoSquawkEnabled(storage), true);
  assert.equal(writeHideNoSquawkEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightHideNoSquawk'], '0');

  const seen = [];
  const unsubscribe = subscribeHideNoSquawkEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getHideNoSquawkEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightHideNoSquawk': '1' });
    assert.equal(hydrateHideNoSquawkEnabled(hydrated), true);
    assert.equal(getHideNoSquawkEnabled(), true);
    assert.equal(setHideNoSquawkEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightHideNoSquawk'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetHideNoSquawkForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(Object.hasOwn(defaults, 'hideNoSquawk'), false, 'not a share-URL option');
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(Object.hasOwn(omitted.options.flights, 'hideNoSquawk'), false);

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { hideNoSquawk: true } },
  }));
  assert.doesNotMatch(String(encodedOn.get('lo') || ''), /hideNoSquawk/);
  const encodedOff = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: {} },
  }));
  assert.equal(String(encodedOn.get('lo') || ''), String(encodedOff.get('lo') || ''),
    'no share-URL write');

  hydrateHideNoSquawkEnabled(memoryStorage({ 'meridian.flightHideNoSquawk': '1' }));
  flightsLayer.setParams({ airborneOnly: false, identifiedOnly: false, emergenciesOnly: false });
  assert.equal(getHideNoSquawkEnabled(), true, 'coordinator-style restore keeps the flip');
  assert.equal(flightsLayer.getParams().hideNoSquawk, true);

  flightsLayer.setParams({ hideNoSquawk: false });
  assert.equal(flightsLayer.getParams().hideNoSquawk, false);
  flightsLayer.setParams({ hideNoSquawk: true });
  assert.equal(flightsLayer.getParams().hideNoSquawk, true);
  const chip = flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_SQUAWK_CHIP_ID);
  assert.equal(chip.label, HIDE_NO_SQUAWK_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { hideNoSquawk: false });
  flightsLayer.setParams({ hideNoSquawk: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_SQUAWK_CHIP_ID).active, false);
  resetHideNoSquawkForTest();
});

test('Hide no squawk is a flights-row chip: no DISPLAY rail, no new /api, military untouched', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const flights = data('flights.js');
  const helper = data('flightHideNoSquawkFilter.js');
  const military = data('militaryFlights.js');
  const manager = data('manager.js');
  assert.doesNotMatch(html, /hide-no-squawk|Hide no squawk/);
  assert.doesNotMatch(ui, /hideNoSquawk|_initHideNoSquawk/);
  assert.match(flights, /hideNoSquawkChipModel\(/);
  assert.match(flights, /passesHideNoSquawkFilter/);
  assert.match(flights, /_hideNoSquawkMatcher/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /hideNoSquawk|hide-no-squawk|flightHideNoSquawkFilter/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.match(helper, /meridian\.flightHideNoSquawk/);
  assert.match(helper, /not written into the share URL/);
});

test('legal: already-fetched squawk only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightHideNoSquawkFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth/i);
  assert.match(moduleSource, /squawk/);
});
