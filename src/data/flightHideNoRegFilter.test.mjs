import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  HIDE_NO_REG_CHIP_ID,
  HIDE_NO_REG_CHIP_LABEL,
  HIDE_NO_REG_DEFAULT,
  HIDE_NO_REG_STORAGE_KEY,
  contactHasRegistration,
  getHideNoRegEnabled,
  hideNoRegChipModel,
  hydrateHideNoRegEnabled,
  normalizeHideNoReg,
  passesHideNoRegFilter,
  readHideNoRegEnabled,
  registrationFieldText,
  resetHideNoRegForTest,
  setHideNoRegEnabled,
  subscribeHideNoRegEnabled,
  writeHideNoRegEnabled,
} from './flightHideNoRegFilter.js';
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

function resetHideNoRegLayers() {
  resetHideNoRegForTest();
  flightsLayer.setParams({
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

test('Hide no registration defaults off and treats missing/null/blank/whitespace as empty', () => {
  assert.equal(HIDE_NO_REG_DEFAULT, false);
  assert.equal(HIDE_NO_REG_STORAGE_KEY, 'meridian.flightHideNoReg');
  assert.equal(normalizeHideNoReg(undefined), false);
  assert.equal(normalizeHideNoReg(null), false);
  assert.equal(normalizeHideNoReg('nope'), false);
  assert.equal(normalizeHideNoReg(false), false);
  assert.equal(normalizeHideNoReg(true), true);
  assert.equal(normalizeHideNoReg('1'), true);

  assert.equal(registrationFieldText(undefined), '');
  assert.equal(registrationFieldText(null), '');
  assert.equal(registrationFieldText(''), '');
  assert.equal(registrationFieldText('   '), '');
  assert.equal(registrationFieldText('N123AB'), 'N123AB');
  assert.equal(registrationFieldText(' N123AB '), 'N123AB');

  assert.equal(contactHasRegistration({ registration: 'N123AB' }), true);
  assert.equal(contactHasRegistration({ registration: '   ' }), false);
  assert.equal(contactHasRegistration({ registration: null }), false);
  assert.equal(contactHasRegistration({}), false);

  const missing = {};
  const empty = { registration: null };
  const present = { registration: 'N123AB' };
  const whitespace = { registration: '   ' };

  for (const contact of [missing, empty, present, whitespace]) {
    assert.equal(passesHideNoRegFilter({ ...contact, hideNoReg: false }), true,
      'off keeps missing + present');
  }
  assert.equal(passesHideNoRegFilter({ ...missing, hideNoReg: true }), false);
  assert.equal(passesHideNoRegFilter({ ...empty, hideNoReg: true }), false);
  assert.equal(passesHideNoRegFilter({ registration: '', hideNoReg: true }), false);
  assert.equal(passesHideNoRegFilter({ ...whitespace, hideNoReg: true }), false);
  assert.equal(passesHideNoRegFilter({ ...present, hideNoReg: true }), true);

  const chip = hideNoRegChipModel(false);
  assert.equal(chip.label, HIDE_NO_REG_CHIP_LABEL);
  assert.equal(chip.id, HIDE_NO_REG_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoReg: true });
  assert.deepEqual(hideNoRegChipModel(true).params, { hideNoReg: false });
});

test('off keeps missing + present; on drops empty/whitespace and keeps N123AB', () => {
  const missing = emptyBillboard();
  const present = emptyBillboard();
  const blank = emptyBillboard();
  const empty = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'a1b2c3',
    meta: { callsign: 'DAL123', registration: null, klass: 'airliner', onGround: false },
    billboard: missing,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'n123ab',
    meta: { callsign: 'N123AB', registration: 'N123AB', klass: 'small', onGround: false },
    billboard: present,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'ws0001',
    meta: { callsign: 'SWA1', registration: '   ', klass: 'airliner', onGround: false },
    billboard: blank,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'empty01',
    meta: { callsign: 'UAL100', registration: '', klass: 'airliner', onGround: false },
    billboard: empty,
  });
  try {
    assert.equal(flightsLayer.getParams().hideNoReg, false);
    assert.equal(missing.show, true);
    assert.equal(present.show, true);
    assert.equal(blank.show, true);
    assert.equal(empty.show, true);

    assert.equal(flightsLayer.setParams({ hideNoReg: true }), true);
    assert.equal(flightsLayer.getParams().hideNoReg, true);
    assert.equal(missing.show, false, 'missing registration hides');
    assert.equal(present.show, true, 'N123AB stays');
    assert.equal(blank.show, false, 'whitespace-only is empty');
    assert.equal(empty.show, false, 'empty registration hides');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: { klass: 'airliner', onGround: false },
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().hideNoReg, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(present.show, true);

    flightsLayer.setParams({ hideNoReg: false });
    assert.equal(missing.show, true);
    assert.equal(blank.show, true);
    assert.equal(empty.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetHideNoRegLayers();
  }
});

test('selected id always kept when Hide no registration is on', () => {
  const selected = emptyBillboard();
  const otherEmpty = emptyBillboard();
  const present = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: { callsign: 'DAL9', registration: null, klass: 'airliner', onGround: false },
    billboard: selected,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: true,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'othhex',
    meta: { callsign: 'SWA2', registration: '', klass: 'airliner', onGround: false },
    billboard: otherEmpty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'n123ab',
    meta: { callsign: 'N123AB', registration: 'N123AB', klass: 'small', onGround: false },
    billboard: present,
  });
  try {
    flightsLayer.setParams({ hideNoReg: true });
    assert.equal(selected.show, true, 'tracked empty-registration contact stays');
    assert.equal(otherEmpty.show, false);
    assert.equal(present.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked empty-registration hides');
    assert.equal(present.show, true);
  } finally {
    resetHideNoRegLayers();
  }
});

test('Hide no registration ANDs with 95/166/188/203/214 and stays distinct from Identified only', () => {
  const lowReg = emptyBillboard();
  const highReg = emptyBillboard();
  const highEmpty = emptyBillboard();
  const parkedReg = emptyBillboard();
  const callsignOnly = emptyBillboard();
  const emergencyReg = emptyBillboard();
  const typedEmptyReg = emptyBillboard();
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
    billboard: highReg,
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
    billboard: lowReg,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhex',
    meta: {
      callsign: 'SWA9',
      registration: null,
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
    billboard: parkedReg,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andcsn',
    meta: {
      callsign: 'DAL123',
      registration: '',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: callsignOnly,
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
    billboard: emergencyReg,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andtyp',
    meta: {
      callsign: 'N9TYP',
      registration: '',
      typeCode: 'C172',
      squawk: '1200',
      klass: 'small',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: typedEmptyReg,
  });
  try {
    flightsLayer.setParams({
      hideNoReg: true,
      hideNoType: false,
      hideNoSquawk: false,
      identifiedOnly: false,
      airborneOnly: false,
      emergenciesOnly: false,
      callsignPrefixes: '',
      aircraftClassFilter: 'all',
    });
    assert.equal(highReg.show, true);
    assert.equal(lowReg.show, true);
    assert.equal(highEmpty.show, false, 'empty registration hides while Identified only is off');
    assert.equal(parkedReg.show, true);
    assert.equal(callsignOnly.show, false, 'callsign-only hides — distinct from Identified only');
    assert.equal(emergencyReg.show, true, 'registered 7700 stays — Hide no registration is not Emergencies only');
    assert.equal(typedEmptyReg.show, false, 'typed but empty registration still hides');

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(highReg.show, true);
    assert.equal(parkedReg.show, false, 'AND: grounded registered contact hides under airborne-only');

    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highReg.show, true, 'AND: in-band registered remains');
    assert.equal(lowReg.show, false, 'AND: registered but out-of-band hides');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ airborneOnly: false, callsignPrefixes: 'UAL' });
    assert.equal(highReg.show, true, 'AND: matching registered remains');
    assert.equal(parkedReg.show, false, 'AND: prefix still hides a non-UAL registered');

    flightsLayer.setParams({ callsignPrefixes: '', aircraftClassFilter: 'airliner' });
    assert.equal(highReg.show, true);
    assert.equal(parkedReg.show, false, 'AND: class chip still hides a helo registered');

    flightsLayer.setParams({ aircraftClassFilter: 'all', speedMinKt: 200, speedMaxKt: null });
    assert.equal(highReg.show, true, 'AND: in-band speed remains');
    assert.equal(lowReg.show, false, 'AND: registered but below speed floor hides');

    flightsLayer.setParams({ speedMinKt: null, showClimb: false, showLevel: true, showDescent: true });
    assert.equal(highReg.show, true, 'AND: level registered remains');
    assert.equal(lowReg.show, false, 'AND: climbing registered hides when climb is off');

    flightsLayer.setParams({ showClimb: true, identifiedOnly: true });
    assert.equal(highReg.show, true);
    assert.equal(callsignOnly.show, false, 'AND: Hide no registration still drops callsign-only');
    assert.equal(highEmpty.show, false);

    flightsLayer.setParams({ hideNoReg: false });
    assert.equal(callsignOnly.show, true, 'Identified only keeps callsign-only when Hide no registration is off');

    flightsLayer.setParams({ hideNoReg: true, identifiedOnly: false, emergenciesOnly: true });
    assert.equal(emergencyReg.show, true, 'AND: Emergencies only keeps registered 7700');
    assert.equal(highReg.show, false, 'AND: Emergencies only hides registered 1200');

    flightsLayer.setParams({ emergenciesOnly: false, hideNoSquawk: true });
    assert.equal(highReg.show, true, 'AND: registered 1200 stays under Hide no squawk');
    assert.equal(highEmpty.show, false, 'AND: empty registration still hides');

    flightsLayer.setParams({ hideNoSquawk: false, hideNoType: true });
    assert.equal(highReg.show, true, 'AND: registered typed stays under Hide no type');
    assert.equal(typedEmptyReg.show, false, 'AND: typed empty-registration still hides');
    assert.equal(highEmpty.show, false);
  } finally {
    resetHideNoRegLayers();
  }
});

test('invalid storage reads as off; persist flip survives reload', () => {
  resetHideNoRegForTest();
  assert.equal(HIDE_NO_REG_STORAGE_KEY, 'meridian.flightHideNoReg');
  assert.equal(readHideNoRegEnabled(memoryStorage()), false);
  assert.equal(readHideNoRegEnabled(memoryStorage({ 'meridian.flightHideNoReg': 'nope' })), false);
  assert.equal(readHideNoRegEnabled(memoryStorage({ 'meridian.flightHideNoReg': 'yes' })), false);
  assert.equal(readHideNoRegEnabled({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');

  const storage = memoryStorage();
  assert.equal(writeHideNoRegEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightHideNoReg': '1' });
  assert.equal(readHideNoRegEnabled(storage), true);
  assert.equal(writeHideNoRegEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightHideNoReg'], '0');

  const seen = [];
  const unsubscribe = subscribeHideNoRegEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getHideNoRegEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightHideNoReg': '1' });
    assert.equal(hydrateHideNoRegEnabled(hydrated), true);
    assert.equal(getHideNoRegEnabled(), true);
    assert.equal(setHideNoRegEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightHideNoReg'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetHideNoRegForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(Object.hasOwn(defaults, 'hideNoReg'), false, 'not a share-URL option');
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(Object.hasOwn(omitted.options.flights, 'hideNoReg'), false);

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { hideNoReg: true } },
  }));
  assert.doesNotMatch(String(encodedOn.get('lo') || ''), /hideNoReg/);
  const encodedOff = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: {} },
  }));
  assert.equal(String(encodedOn.get('lo') || ''), String(encodedOff.get('lo') || ''),
    'no share-URL write');

  hydrateHideNoRegEnabled(memoryStorage({ 'meridian.flightHideNoReg': '1' }));
  flightsLayer.setParams({ airborneOnly: false, identifiedOnly: false, emergenciesOnly: false });
  assert.equal(getHideNoRegEnabled(), true, 'coordinator-style restore keeps the flip');
  assert.equal(flightsLayer.getParams().hideNoReg, true);

  flightsLayer.setParams({ hideNoReg: false });
  assert.equal(flightsLayer.getParams().hideNoReg, false);
  flightsLayer.setParams({ hideNoReg: true });
  assert.equal(flightsLayer.getParams().hideNoReg, true);
  const chip = flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_REG_CHIP_ID);
  assert.equal(chip.label, HIDE_NO_REG_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { hideNoReg: false });
  flightsLayer.setParams({ hideNoReg: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_REG_CHIP_ID).active, false);
  resetHideNoRegForTest();
});

test('Hide no registration is a flights-row chip: no DISPLAY rail, no new /api, military unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const flights = data('flights.js');
  const helper = data('flightHideNoRegFilter.js');
  const military = data('militaryFlights.js');
  const adapter = data('adsbLolFallback.js');
  const manager = data('manager.js');
  assert.doesNotMatch(html, /hide-no-reg|Hide no registration/);
  assert.doesNotMatch(ui, /hideNoReg|_initHideNoReg/);
  assert.match(flights, /hideNoRegChipModel\(/);
  assert.match(flights, /passesHideNoRegFilter/);
  assert.match(flights, /_hideNoRegMatcher/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /hideNoReg|hide-no-reg|flightHideNoRegFilter/);
  assert.doesNotMatch(adapter, /hideNoReg|hide-no-reg|flightHideNoRegFilter/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.doesNotMatch(helper, /originCountry/);
  assert.match(helper, /meridian\.flightHideNoReg/);
  assert.match(helper, /not written into the share URL/);
});

test('legal: already-fetched registration only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightHideNoRegFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth/i);
  assert.match(moduleSource, /registration/);
});
