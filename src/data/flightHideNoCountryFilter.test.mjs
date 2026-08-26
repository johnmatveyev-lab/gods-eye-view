import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  HIDE_NO_COUNTRY_CHIP_ID,
  HIDE_NO_COUNTRY_CHIP_LABEL,
  HIDE_NO_COUNTRY_DEFAULT,
  HIDE_NO_COUNTRY_STORAGE_KEY,
  contactHasCountry,
  getHideNoCountryEnabled,
  hideNoCountryChipModel,
  hydrateHideNoCountryEnabled,
  normalizeHideNoCountry,
  originCountryFieldText,
  passesHideNoCountryFilter,
  readHideNoCountryEnabled,
  resetHideNoCountryForTest,
  setHideNoCountryEnabled,
  subscribeHideNoCountryEnabled,
  writeHideNoCountryEnabled,
} from './flightHideNoCountryFilter.js';
import flightsLayer, {
  _addFlightTrackingCandidateForTest,
  _applyOperatorContactVisibilityForTest,
  _setTrackedFlightRefreshStateForTest,
} from './flights.js';
import { setAltitudeBand } from './flightAltitudeBand.js';
import { setHeadingSectors } from './inFlightFilters.js';
import { normalizeAdsbLolAircraftState } from './adsbLolFallback.js';
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

function resetHideNoCountryLayers() {
  resetHideNoCountryForTest();
  setHeadingSectors('NESW');
  flightsLayer.setParams({
    hideNoCountry: false,
    hideNoSpeed: false,
    hideNoHeading: false,
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
    headingSectors: 'NESW',
    selectedFlightsTrackingId: null,
  });
  setAltitudeBand('all', { persist: false });
}

test('off keeps empty country', () => {
  assert.equal(HIDE_NO_COUNTRY_DEFAULT, false);
  assert.equal(HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.flightHideNoCountry');
  assert.equal(normalizeHideNoCountry(undefined), false);
  assert.equal(normalizeHideNoCountry(null), false);
  assert.equal(normalizeHideNoCountry('nope'), false);
  assert.equal(normalizeHideNoCountry(false), false);
  assert.equal(normalizeHideNoCountry(true), true);
  assert.equal(normalizeHideNoCountry('1'), true);

  assert.equal(originCountryFieldText(undefined), '');
  assert.equal(originCountryFieldText(null), '');
  assert.equal(originCountryFieldText(''), '');
  assert.equal(originCountryFieldText('   '), '');
  assert.equal(originCountryFieldText('United States'), 'United States');
  assert.equal(originCountryFieldText(' United States '), 'United States');

  assert.equal(contactHasCountry({ originCountry: 'United States' }), true);
  assert.equal(contactHasCountry({ originCountry: '   ' }), false);
  assert.equal(contactHasCountry({ originCountry: null }), false);
  assert.equal(contactHasCountry({}), false);

  const missing = {};
  const empty = { originCountry: null };
  const present = { originCountry: 'United States' };
  const whitespace = { originCountry: '   ' };

  for (const contact of [missing, empty, present, whitespace]) {
    assert.equal(passesHideNoCountryFilter({ ...contact, hideNoCountry: false }), true,
      'off keeps empty country');
    assert.equal(passesHideNoCountryFilter({ ...contact, hideNoCountry: true }), true,
      'QA 49: on fail-opens unpublished/empty and keeps a published country');
  }

  const chip = hideNoCountryChipModel(false);
  assert.equal(chip.label, HIDE_NO_COUNTRY_CHIP_LABEL);
  assert.equal(chip.id, HIDE_NO_COUNTRY_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoCountry: true });
  assert.deepEqual(hideNoCountryChipModel(true).params, { hideNoCountry: false });
});

test('QA 49: Hide no country ON keeps unpublished/null originCountry; a published country still stays', () => {
  const ual1416 = emptyBillboard();
  const dal986 = emptyBillboard();
  const swa1412 = emptyBillboard();
  const published = emptyBillboard();
  const blank = emptyBillboard();
  const empty = emptyBillboard();
  const ualState = normalizeAdsbLolAircraftState({
    hex: 'aa1416', flight: 'UAL1416', lat: 30, lon: -97, alt_baro: 36000, gs: 450, track: 90,
  }, 1000);
  const dalState = normalizeAdsbLolAircraftState({
    hex: 'aa0986', flight: 'DAL986', lat: 33, lon: -84, alt_baro: 34000, gs: 430, track: 80,
  }, 1000);
  const swaState = normalizeAdsbLolAircraftState({
    hex: 'aa1412', flight: 'SWA1412', lat: 32, lon: -96, alt_baro: 32000, gs: 420, track: 270,
  }, 1000);
  assert.equal(ualState[2], null, 'commercial adapter never writes state[2]');
  assert.equal(dalState[2], null);
  assert.equal(swaState[2], null);
  assert.equal(passesHideNoCountryFilter({ originCountry: ualState[2], hideNoCountry: true }), true);
  assert.equal(passesHideNoCountryFilter({ originCountry: 'United States', hideNoCountry: true }), true);
  assert.equal(originCountryFieldText(ualState[2]), '', 'do not invent a country');

  _setTrackedFlightRefreshStateForTest({
    icao24: ualState[0],
    meta: { originCountry: ualState[2], callsign: 'UAL1416', registration: 'N1416U', klass: 'airliner', onGround: false, velocity: 200 },
    billboard: ual1416,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: dalState[0],
    meta: { originCountry: dalState[2], callsign: 'DAL986', registration: 'N986DL', klass: 'airliner', onGround: false, velocity: 200 },
    billboard: dal986,
  });
  _addFlightTrackingCandidateForTest({
    icao24: swaState[0],
    meta: { originCountry: swaState[2], callsign: 'SWA1412', registration: 'N1412S', klass: 'airliner', onGround: false, velocity: 200 },
    billboard: swa1412,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'usa001',
    meta: { originCountry: 'United States', callsign: 'UAL100', registration: 'N100UA', klass: 'airliner', onGround: false, velocity: 200 },
    billboard: published,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'ws0001',
    meta: { originCountry: '   ', callsign: 'WS001', registration: 'N1WS', klass: 'airliner', onGround: false, velocity: 200 },
    billboard: blank,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'empty01',
    meta: { originCountry: '', callsign: 'EMP1', registration: 'N100UA', klass: 'airliner', onGround: false, velocity: 200 },
    billboard: empty,
  });
  try {
    assert.equal(flightsLayer.getParams().hideNoCountry, false);
    assert.equal(ual1416.show, true);
    assert.equal(dal986.show, true);
    assert.equal(swa1412.show, true);
    assert.equal(published.show, true);

    assert.equal(flightsLayer.setParams({ hideNoCountry: true }), true);
    assert.equal(flightsLayer.getParams().hideNoCountry, true);
    assert.equal(ual1416.show, true, 'QA 49: unpublished UAL1416 stays');
    assert.equal(dal986.show, true, 'QA 49: unpublished DAL986 stays');
    assert.equal(swa1412.show, true, 'QA 49: unpublished SWA1412 stays');
    assert.equal(published.show, true, 'published United States stays');
    assert.equal(blank.show, true, 'whitespace-only fail-opens');
    assert.equal(empty.show, true, 'empty originCountry fail-opens');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: { klass: 'airliner', onGround: false, velocity: 200 },
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().hideNoCountry, true, 'refresh keeps the toggle');
    assert.equal(extra.show, true, 'QA 49: missing originCountry fail-opens on refresh');
    assert.equal(published.show, true);

    flightsLayer.setParams({ hideNoCountry: false });
    assert.equal(ual1416.show, true);
    assert.equal(blank.show, true);
    assert.equal(empty.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetHideNoCountryLayers();
  }
});

test('selected id always kept', () => {
  const selected = emptyBillboard();
  const otherEmpty = emptyBillboard();
  const present = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: { originCountry: null, callsign: 'SEL1', registration: 'N9SEL', klass: 'airliner', onGround: false },
    billboard: selected,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: true,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'othhex',
    meta: { originCountry: '', callsign: 'OTH1', registration: 'N2OTH', klass: 'airliner', onGround: false },
    billboard: otherEmpty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'usa001',
    meta: { originCountry: 'United States', callsign: 'UAL100', registration: 'N100UA', klass: 'airliner', onGround: false },
    billboard: present,
  });
  try {
    flightsLayer.setParams({ hideNoCountry: true });
    assert.equal(selected.show, true, 'tracked empty-country contact stays');
    assert.equal(otherEmpty.show, true, 'QA 49: untracked unpublished country fail-opens');
    assert.equal(present.show, true, 'published country stays');

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, true, 'QA 49: untracked unpublished country still stays');
    assert.equal(present.show, true);
  } finally {
    resetHideNoCountryLayers();
  }
});

test('Hide no country ANDs with 95/166/188/203/214/222/227/234 and stays distinct', () => {
  const lowCountry = emptyBillboard();
  const highCountry = emptyBillboard();
  const highEmpty = emptyBillboard();
  const parkedCountry = emptyBillboard();
  const registrationOnly = emptyBillboard();
  const emergencyCountry = emptyBillboard();
  const typedEmptyCountry = emptyBillboard();
  const emptyCallsignCountry = emptyBillboard();
  const headedEmptyCountry = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'andhigh',
    meta: {
      originCountry: 'United States',
      true_track: 270,
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
    billboard: highCountry,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andlow',
    meta: {
      originCountry: 'United States',
      true_track: 0,
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
    billboard: lowCountry,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhex',
    meta: {
      originCountry: null,
      true_track: 270,
      callsign: 'SWA9',
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
      originCountry: 'United States',
      true_track: 270,
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
    billboard: parkedCountry,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andreg',
    meta: {
      originCountry: 'United States',
      true_track: 0,
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
      originCountry: 'United States',
      true_track: 270,
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
    billboard: emergencyCountry,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andtyp',
    meta: {
      originCountry: '',
      true_track: 270,
      callsign: 'C172X',
      registration: 'N9TYP',
      typeCode: 'C172',
      squawk: '1200',
      klass: 'small',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: typedEmptyCountry,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andcs',
    meta: {
      originCountry: 'United States',
      true_track: 270,
      callsign: '',
      registration: 'N9NOCS',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: emptyCallsignCountry,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhead',
    meta: {
      originCountry: '',
      true_track: 270,
      callsign: 'HDG9',
      registration: 'N9HDG',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: headedEmptyCountry,
  });
  try {
    flightsLayer.setParams({
      hideNoCountry: true,
      hideNoHeading: false,
      hideNoCallsign: false,
      hideNoReg: false,
      hideNoType: false,
      hideNoSquawk: false,
      identifiedOnly: false,
      airborneOnly: false,
      emergenciesOnly: false,
      callsignPrefixes: '',
      aircraftClassFilter: 'all',
    });
    assert.equal(highCountry.show, true);
    assert.equal(lowCountry.show, true);
    assert.equal(highEmpty.show, true, 'QA 49: unpublished country fail-opens while Identified only is off');
    assert.equal(parkedCountry.show, true);
    assert.equal(registrationOnly.show, true, 'country-bearing registration-only stays — not Identified only');
    assert.equal(emergencyCountry.show, true, 'country-bearing 7700 stays — Hide no country is not Emergencies only');
    assert.equal(typedEmptyCountry.show, true, 'QA 49: typed unpublished country fail-opens');
    assert.equal(headedEmptyCountry.show, true, 'QA 49: headed unpublished country fail-opens');

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(highCountry.show, true);
    assert.equal(parkedCountry.show, false, 'AND: grounded country-bearing contact hides under airborne-only');

    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highCountry.show, true, 'AND: in-band country-bearing remains');
    assert.equal(lowCountry.show, false, 'AND: country-bearing but out-of-band hides');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ airborneOnly: false, callsignPrefixes: 'UAL' });
    assert.equal(highCountry.show, true, 'AND: matching country-bearing remains');
    assert.equal(parkedCountry.show, false, 'AND: prefix still hides a non-UAL country-bearing');

    flightsLayer.setParams({ callsignPrefixes: '', aircraftClassFilter: 'airliner' });
    assert.equal(highCountry.show, true);
    assert.equal(parkedCountry.show, false, 'AND: class chip still hides a helo country-bearing');

    flightsLayer.setParams({ aircraftClassFilter: 'all', speedMinKt: 200, speedMaxKt: null });
    assert.equal(highCountry.show, true, 'AND: in-band speed remains');
    assert.equal(lowCountry.show, false, 'AND: country-bearing but below speed floor hides');

    flightsLayer.setParams({ speedMinKt: null, showClimb: false, showLevel: true, showDescent: true });
    assert.equal(highCountry.show, true, 'AND: level country-bearing remains');
    assert.equal(lowCountry.show, false, 'AND: climbing country-bearing hides when climb is off');

    flightsLayer.setParams({ showClimb: true, identifiedOnly: true });
    assert.equal(highCountry.show, true);
    assert.equal(registrationOnly.show, true, 'Identified only keeps country-bearing registration-only');
    assert.equal(highEmpty.show, true, 'QA 49: Identified only + unpublished country still stays');

    flightsLayer.setParams({ hideNoCountry: false });
    assert.equal(highEmpty.show, true, 'Identified only keeps empty-country when Hide no country is off');

    flightsLayer.setParams({ hideNoCountry: true, identifiedOnly: false, emergenciesOnly: true });
    assert.equal(emergencyCountry.show, true, 'AND: Emergencies only keeps country-bearing 7700');
    assert.equal(highCountry.show, false, 'AND: Emergencies only hides country-bearing 1200');

    flightsLayer.setParams({ emergenciesOnly: false, hideNoSquawk: true });
    assert.equal(highCountry.show, true, 'AND: country-bearing 1200 stays under Hide no squawk');
    assert.equal(highEmpty.show, true, 'QA 49: unpublished country stays under Hide no squawk');

    flightsLayer.setParams({ hideNoSquawk: false, hideNoType: true });
    assert.equal(highCountry.show, true, 'AND: country-bearing typed stays under Hide no type');
    assert.equal(typedEmptyCountry.show, true, 'QA 49: typed unpublished country stays under Hide no type');
    assert.equal(highEmpty.show, true);

    flightsLayer.setParams({ hideNoType: false, hideNoReg: true });
    assert.equal(highCountry.show, true, 'AND: country-bearing registered stays under Hide no registration');
    assert.equal(highEmpty.show, true, 'QA 49: unpublished registered country stays');

    flightsLayer.setParams({ hideNoReg: false, hideNoCallsign: true });
    assert.equal(highCountry.show, true, 'AND: country-bearing callsigned stays under Hide no callsign');
    assert.equal(emptyCallsignCountry.show, false, 'AND: Hide no callsign still drops country-bearing empty-callsign');
    assert.equal(highEmpty.show, true, 'QA 49: unpublished callsigned country stays');

    flightsLayer.setParams({ hideNoCallsign: false, hideNoHeading: true });
    assert.equal(highCountry.show, true, 'AND: country-bearing headed stays under Hide no heading');
    assert.equal(headedEmptyCountry.show, true, 'QA 49: headed unpublished country stays');
    assert.equal(highEmpty.show, true);
  } finally {
    resetHideNoCountryLayers();
  }
});

test('invalid storage reads as off', () => {
  resetHideNoCountryForTest();
  assert.equal(HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.flightHideNoCountry');
  assert.equal(readHideNoCountryEnabled(memoryStorage()), false);
  assert.equal(readHideNoCountryEnabled(memoryStorage({ 'meridian.flightHideNoCountry': 'nope' })), false);
  assert.equal(readHideNoCountryEnabled(memoryStorage({ 'meridian.flightHideNoCountry': 'yes' })), false);
  assert.equal(readHideNoCountryEnabled({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');
});

test('persist flip survives reload', () => {
  resetHideNoCountryForTest();
  const storage = memoryStorage();
  assert.equal(writeHideNoCountryEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightHideNoCountry': '1' });
  assert.equal(readHideNoCountryEnabled(storage), true);
  assert.equal(writeHideNoCountryEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightHideNoCountry'], '0');

  const seen = [];
  const unsubscribe = subscribeHideNoCountryEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getHideNoCountryEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightHideNoCountry': '1' });
    assert.equal(hydrateHideNoCountryEnabled(hydrated), true);
    assert.equal(getHideNoCountryEnabled(), true);
    assert.equal(setHideNoCountryEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightHideNoCountry'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetHideNoCountryForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(Object.hasOwn(defaults, 'hideNoCountry'), false, 'not a share-URL option');
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(Object.hasOwn(omitted.options.flights, 'hideNoCountry'), false);

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { hideNoCountry: true } },
  }));
  assert.doesNotMatch(String(encodedOn.get('lo') || ''), /hideNoCountry/);
  const encodedOff = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: {} },
  }));
  assert.equal(String(encodedOn.get('lo') || ''), String(encodedOff.get('lo') || ''),
    'no share-URL write');

  hydrateHideNoCountryEnabled(memoryStorage({ 'meridian.flightHideNoCountry': '1' }));
  flightsLayer.setParams({ airborneOnly: false, identifiedOnly: false, emergenciesOnly: false });
  assert.equal(getHideNoCountryEnabled(), true, 'coordinator-style restore keeps the flip');
  assert.equal(flightsLayer.getParams().hideNoCountry, true);

  flightsLayer.setParams({ hideNoCountry: false });
  assert.equal(flightsLayer.getParams().hideNoCountry, false);
  flightsLayer.setParams({ hideNoCountry: true });
  assert.equal(flightsLayer.getParams().hideNoCountry, true);
  const chip = flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_COUNTRY_CHIP_ID);
  assert.equal(chip.label, HIDE_NO_COUNTRY_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { hideNoCountry: false });
  flightsLayer.setParams({ hideNoCountry: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_COUNTRY_CHIP_ID).active, false);
  resetHideNoCountryForTest();
});

test('militaryFlights.js is unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const flights = data('flights.js');
  const helper = data('flightHideNoCountryFilter.js');
  const military = data('militaryFlights.js');
  const adapter = data('adsbLolFallback.js');
  const manager = data('manager.js');
  assert.doesNotMatch(html, /hide-no-country|Hide no country/);
  assert.doesNotMatch(ui, /hideNoCountry|_initHideNoCountry/);
  assert.match(flights, /hideNoCountryChipModel\(/);
  assert.match(flights, /passesHideNoCountryFilter/);
  assert.match(flights, /_hideNoCountryMatcher/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /hideNoCountry|hide-no-country|flightHideNoCountryFilter/);
  assert.doesNotMatch(adapter, /hideNoCountry|hide-no-country|flightHideNoCountryFilter/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.doesNotMatch(helper, /OpenSky|opensky/i);
  assert.match(helper, /originCountry/);
  assert.match(helper, /meridian\.flightHideNoCountry/);
  assert.match(helper, /not written into the share URL/);
  assert.match(helper, /fail-open/);
  assert.match(helper, /Never invents a country/);
  assert.doesNotMatch(adapter, /hideNoCountry|flightHideNoCountryFilter/);
});

test('legal: already-fetched originCountry only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightHideNoCountryFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth|OpenSky|opensky/i);
  assert.match(moduleSource, /originCountry/);
});
