import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  HIDE_NO_CALLSIGN_CHIP_ID,
  HIDE_NO_CALLSIGN_CHIP_LABEL,
  HIDE_NO_CALLSIGN_DEFAULT,
  HIDE_NO_CALLSIGN_STORAGE_KEY,
  callsignFieldText,
  contactHasCallsign,
  getHideNoCallsignEnabled,
  hideNoCallsignChipModel,
  hydrateHideNoCallsignEnabled,
  normalizeHideNoCallsign,
  passesHideNoCallsignFilter,
  readHideNoCallsignEnabled,
  resetHideNoCallsignForTest,
  setHideNoCallsignEnabled,
  subscribeHideNoCallsignEnabled,
  writeHideNoCallsignEnabled,
} from './flightHideNoCallsignFilter.js';
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

function resetHideNoCallsignLayers() {
  resetHideNoCallsignForTest();
  flightsLayer.setParams({
    hideNoCallsign: false,
    hideNoReg: false,
    hideNoType: false,
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

test('off keeps missing + present', () => {
  assert.equal(HIDE_NO_CALLSIGN_DEFAULT, false);
  assert.equal(HIDE_NO_CALLSIGN_STORAGE_KEY, 'meridian.flightHideNoCallsign');
  assert.equal(normalizeHideNoCallsign(undefined), false);
  assert.equal(normalizeHideNoCallsign(null), false);
  assert.equal(normalizeHideNoCallsign('nope'), false);
  assert.equal(normalizeHideNoCallsign(false), false);
  assert.equal(normalizeHideNoCallsign(true), true);
  assert.equal(normalizeHideNoCallsign('1'), true);

  assert.equal(callsignFieldText(undefined), '');
  assert.equal(callsignFieldText(null), '');
  assert.equal(callsignFieldText(''), '');
  assert.equal(callsignFieldText('   '), '');
  assert.equal(callsignFieldText('DAL123'), 'DAL123');
  assert.equal(callsignFieldText(' DAL123 '), 'DAL123');

  assert.equal(contactHasCallsign({ callsign: 'DAL123' }), true);
  assert.equal(contactHasCallsign({ callsign: '   ' }), false);
  assert.equal(contactHasCallsign({ callsign: null }), false);
  assert.equal(contactHasCallsign({}), false);

  const missing = {};
  const empty = { callsign: null };
  const present = { callsign: 'DAL123' };
  const whitespace = { callsign: '   ' };

  for (const contact of [missing, empty, present, whitespace]) {
    assert.equal(passesHideNoCallsignFilter({ ...contact, hideNoCallsign: false }), true,
      'off keeps missing + present');
  }

  const chip = hideNoCallsignChipModel(false);
  assert.equal(chip.label, HIDE_NO_CALLSIGN_CHIP_LABEL);
  assert.equal(chip.id, HIDE_NO_CALLSIGN_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoCallsign: true });
  assert.deepEqual(hideNoCallsignChipModel(true).params, { hideNoCallsign: false });
});

test('on drops empty/whitespace, keeps DAL123', () => {
  const missing = emptyBillboard();
  const present = emptyBillboard();
  const blank = emptyBillboard();
  const empty = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'a1b2c3',
    meta: { callsign: null, registration: 'N123AB', klass: 'airliner', onGround: false },
    billboard: missing,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'dal123',
    meta: { callsign: 'DAL123', registration: 'N123DL', klass: 'airliner', onGround: false },
    billboard: present,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'ws0001',
    meta: { callsign: '   ', registration: 'N1SWA', klass: 'airliner', onGround: false },
    billboard: blank,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'empty01',
    meta: { callsign: '', registration: 'N100UA', klass: 'airliner', onGround: false },
    billboard: empty,
  });
  try {
    assert.equal(flightsLayer.getParams().hideNoCallsign, false);
    assert.equal(missing.show, true);
    assert.equal(present.show, true);
    assert.equal(blank.show, true);
    assert.equal(empty.show, true);

    assert.equal(flightsLayer.setParams({ hideNoCallsign: true }), true);
    assert.equal(flightsLayer.getParams().hideNoCallsign, true);
    assert.equal(missing.show, false, 'missing callsign hides');
    assert.equal(present.show, true, 'DAL123 stays');
    assert.equal(blank.show, false, 'whitespace-only is empty');
    assert.equal(empty.show, false, 'empty callsign hides');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: { klass: 'airliner', onGround: false },
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().hideNoCallsign, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(present.show, true);

    flightsLayer.setParams({ hideNoCallsign: false });
    assert.equal(missing.show, true);
    assert.equal(blank.show, true);
    assert.equal(empty.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetHideNoCallsignLayers();
  }
});

test('selected id always kept', () => {
  const selected = emptyBillboard();
  const otherEmpty = emptyBillboard();
  const present = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: { callsign: null, registration: 'N9SEL', klass: 'airliner', onGround: false },
    billboard: selected,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: true,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'othhex',
    meta: { callsign: '', registration: 'N2OTH', klass: 'airliner', onGround: false },
    billboard: otherEmpty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'dal123',
    meta: { callsign: 'DAL123', registration: 'N123DL', klass: 'airliner', onGround: false },
    billboard: present,
  });
  try {
    flightsLayer.setParams({ hideNoCallsign: true });
    assert.equal(selected.show, true, 'tracked empty-callsign contact stays');
    assert.equal(otherEmpty.show, false);
    assert.equal(present.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked empty-callsign hides');
    assert.equal(present.show, true);
  } finally {
    resetHideNoCallsignLayers();
  }
});

test('Hide no callsign ANDs with 95/166/188/203/214/222 and stays distinct from Identified only', () => {
  const lowCs = emptyBillboard();
  const highCs = emptyBillboard();
  const highEmpty = emptyBillboard();
  const parkedCs = emptyBillboard();
  const registrationOnly = emptyBillboard();
  const emergencyCs = emptyBillboard();
  const typedEmptyCs = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'andhigh',
    meta: {
      callsign: 'UAL100',
      registration: 'N100UA',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: highCs,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andlow',
    meta: {
      callsign: 'UAL200',
      registration: 'N200UA',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 2000,
      velocity: 80,
      verticalRate: 8,
    },
    billboard: lowCs,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhex',
    meta: {
      callsign: null,
      registration: 'N9SWA',
      typeCode: 'B738',
      squawk: '1200',
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
      typeCode: 'EC35',
      squawk: '1200',
      klass: 'helicopter',
      onGround: true,
      altitude: 0,
      velocity: 0,
      verticalRate: 0,
    },
    billboard: parkedCs,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andreg',
    meta: {
      callsign: '',
      registration: 'N123AB',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: registrationOnly,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andemg',
    meta: {
      callsign: 'AAL9',
      registration: 'N9AAL',
      typeCode: 'B738',
      squawk: '7700',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: emergencyCs,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andtyp',
    meta: {
      callsign: '',
      registration: 'N9TYP',
      typeCode: 'C172',
      squawk: '1200',
      klass: 'small',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: typedEmptyCs,
  });
  try {
    flightsLayer.setParams({
      hideNoCallsign: true,
      hideNoReg: false,
      hideNoType: false,
      hideNoSquawk: false,
      identifiedOnly: false,
      airborneOnly: false,
      emergenciesOnly: false,
      callsignPrefixes: '',
      aircraftClassFilter: 'all',
    });
    assert.equal(highCs.show, true);
    assert.equal(lowCs.show, true);
    assert.equal(highEmpty.show, false, 'empty callsign hides while Identified only is off');
    assert.equal(parkedCs.show, true);
    assert.equal(registrationOnly.show, false, 'registration-only hides — distinct from Identified only');
    assert.equal(emergencyCs.show, true, 'callsigned 7700 stays — Hide no callsign is not Emergencies only');
    assert.equal(typedEmptyCs.show, false, 'typed but empty callsign still hides');

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(highCs.show, true);
    assert.equal(parkedCs.show, false, 'AND: grounded callsigned contact hides under airborne-only');

    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highCs.show, true, 'AND: in-band callsigned remains');
    assert.equal(lowCs.show, false, 'AND: callsigned but out-of-band hides');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ airborneOnly: false, callsignPrefixes: 'UAL' });
    assert.equal(highCs.show, true, 'AND: matching callsigned remains');
    assert.equal(parkedCs.show, false, 'AND: prefix still hides a non-UAL callsigned');

    flightsLayer.setParams({ callsignPrefixes: '', aircraftClassFilter: 'airliner' });
    assert.equal(highCs.show, true);
    assert.equal(parkedCs.show, false, 'AND: class chip still hides a helo callsigned');

    flightsLayer.setParams({ aircraftClassFilter: 'all', speedMinKt: 200, speedMaxKt: null });
    assert.equal(highCs.show, true, 'AND: in-band speed remains');
    assert.equal(lowCs.show, false, 'AND: callsigned but below speed floor hides');

    flightsLayer.setParams({ speedMinKt: null, showClimb: false, showLevel: true, showDescent: true });
    assert.equal(highCs.show, true, 'AND: level callsigned remains');
    assert.equal(lowCs.show, false, 'AND: climbing callsigned hides when climb is off');

    flightsLayer.setParams({ showClimb: true, identifiedOnly: true });
    assert.equal(highCs.show, true);
    assert.equal(registrationOnly.show, false, 'AND: Hide no callsign still drops registration-only');
    assert.equal(highEmpty.show, false);

    flightsLayer.setParams({ hideNoCallsign: false });
    assert.equal(registrationOnly.show, true, 'Identified only keeps registration-only when Hide no callsign is off');

    flightsLayer.setParams({ hideNoCallsign: true, identifiedOnly: false, emergenciesOnly: true });
    assert.equal(emergencyCs.show, true, 'AND: Emergencies only keeps callsigned 7700');
    assert.equal(highCs.show, false, 'AND: Emergencies only hides callsigned 1200');

    flightsLayer.setParams({ emergenciesOnly: false, hideNoSquawk: true });
    assert.equal(highCs.show, true, 'AND: callsigned 1200 stays under Hide no squawk');
    assert.equal(highEmpty.show, false, 'AND: empty callsign still hides');

    flightsLayer.setParams({ hideNoSquawk: false, hideNoType: true });
    assert.equal(highCs.show, true, 'AND: callsigned typed stays under Hide no type');
    assert.equal(typedEmptyCs.show, false, 'AND: typed empty-callsign still hides');
    assert.equal(highEmpty.show, false);

    flightsLayer.setParams({ hideNoType: false, hideNoReg: true });
    assert.equal(highCs.show, true, 'AND: callsigned registered stays under Hide no registration');
    assert.equal(registrationOnly.show, false, 'AND: registered empty-callsign still hides');
    assert.equal(highEmpty.show, false);
  } finally {
    resetHideNoCallsignLayers();
  }
});

test('invalid storage reads as off', () => {
  resetHideNoCallsignForTest();
  assert.equal(HIDE_NO_CALLSIGN_STORAGE_KEY, 'meridian.flightHideNoCallsign');
  assert.equal(readHideNoCallsignEnabled(memoryStorage()), false);
  assert.equal(readHideNoCallsignEnabled(memoryStorage({ 'meridian.flightHideNoCallsign': 'nope' })), false);
  assert.equal(readHideNoCallsignEnabled(memoryStorage({ 'meridian.flightHideNoCallsign': 'yes' })), false);
  assert.equal(readHideNoCallsignEnabled({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');
});

test('persist flip survives reload', () => {
  resetHideNoCallsignForTest();
  const storage = memoryStorage();
  assert.equal(writeHideNoCallsignEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightHideNoCallsign': '1' });
  assert.equal(readHideNoCallsignEnabled(storage), true);
  assert.equal(writeHideNoCallsignEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightHideNoCallsign'], '0');

  const seen = [];
  const unsubscribe = subscribeHideNoCallsignEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getHideNoCallsignEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightHideNoCallsign': '1' });
    assert.equal(hydrateHideNoCallsignEnabled(hydrated), true);
    assert.equal(getHideNoCallsignEnabled(), true);
    assert.equal(setHideNoCallsignEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightHideNoCallsign'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetHideNoCallsignForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(Object.hasOwn(defaults, 'hideNoCallsign'), false, 'not a share-URL option');
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(Object.hasOwn(omitted.options.flights, 'hideNoCallsign'), false);

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { hideNoCallsign: true } },
  }));
  assert.doesNotMatch(String(encodedOn.get('lo') || ''), /hideNoCallsign/);
  const encodedOff = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: {} },
  }));
  assert.equal(String(encodedOn.get('lo') || ''), String(encodedOff.get('lo') || ''),
    'no share-URL write');

  hydrateHideNoCallsignEnabled(memoryStorage({ 'meridian.flightHideNoCallsign': '1' }));
  flightsLayer.setParams({ airborneOnly: false, identifiedOnly: false, emergenciesOnly: false });
  assert.equal(getHideNoCallsignEnabled(), true, 'coordinator-style restore keeps the flip');
  assert.equal(flightsLayer.getParams().hideNoCallsign, true);

  flightsLayer.setParams({ hideNoCallsign: false });
  assert.equal(flightsLayer.getParams().hideNoCallsign, false);
  flightsLayer.setParams({ hideNoCallsign: true });
  assert.equal(flightsLayer.getParams().hideNoCallsign, true);
  const chip = flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_CALLSIGN_CHIP_ID);
  assert.equal(chip.label, HIDE_NO_CALLSIGN_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { hideNoCallsign: false });
  flightsLayer.setParams({ hideNoCallsign: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_CALLSIGN_CHIP_ID).active, false);
  resetHideNoCallsignForTest();
});

test('militaryFlights.js is unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const flights = data('flights.js');
  const helper = data('flightHideNoCallsignFilter.js');
  const military = data('militaryFlights.js');
  const adapter = data('adsbLolFallback.js');
  const manager = data('manager.js');
  assert.doesNotMatch(html, /hide-no-callsign|Hide no callsign/);
  assert.doesNotMatch(ui, /hideNoCallsign|_initHideNoCallsign/);
  assert.match(flights, /hideNoCallsignChipModel\(/);
  assert.match(flights, /passesHideNoCallsignFilter/);
  assert.match(flights, /_hideNoCallsignMatcher/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /hideNoCallsign|hide-no-callsign|flightHideNoCallsignFilter/);
  assert.doesNotMatch(adapter, /hideNoCallsign|hide-no-callsign|flightHideNoCallsignFilter/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.doesNotMatch(helper, /originCountry/);
  assert.match(helper, /meridian\.flightHideNoCallsign/);
  assert.match(helper, /not written into the share URL/);
});

test('legal: already-fetched callsign only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightHideNoCallsignFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth/i);
  assert.match(moduleSource, /callsign/);
});
