import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  HIDE_NO_HEADING_CHIP_ID,
  HIDE_NO_HEADING_CHIP_LABEL,
  HIDE_NO_HEADING_DEFAULT,
  HIDE_NO_HEADING_STORAGE_KEY,
  contactHasHeading,
  getHideNoHeadingEnabled,
  headingFieldDegrees,
  hideNoHeadingChipModel,
  hydrateHideNoHeadingEnabled,
  normalizeHideNoHeading,
  passesHideNoHeadingFilter,
  readHideNoHeadingEnabled,
  resetHideNoHeadingForTest,
  setHideNoHeadingEnabled,
  subscribeHideNoHeadingEnabled,
  writeHideNoHeadingEnabled,
} from './flightHideNoHeadingFilter.js';
import flightsLayer, {
  _addFlightTrackingCandidateForTest,
  _applyOperatorContactVisibilityForTest,
  _setTrackedFlightRefreshStateForTest,
} from './flights.js';
import { setAltitudeBand } from './flightAltitudeBand.js';
import { setHeadingSectors } from './inFlightFilters.js';
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

function resetHideNoHeadingLayers() {
  resetHideNoHeadingForTest();
  setHeadingSectors('NESW');
  flightsLayer.setParams({
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

test('off keeps missing + 0 + 270', () => {
  assert.equal(HIDE_NO_HEADING_DEFAULT, false);
  assert.equal(HIDE_NO_HEADING_STORAGE_KEY, 'meridian.flightHideNoHeading');
  assert.equal(normalizeHideNoHeading(undefined), false);
  assert.equal(normalizeHideNoHeading(null), false);
  assert.equal(normalizeHideNoHeading('nope'), false);
  assert.equal(normalizeHideNoHeading(false), false);
  assert.equal(normalizeHideNoHeading(true), true);
  assert.equal(normalizeHideNoHeading('1'), true);

  assert.equal(headingFieldDegrees(undefined), null);
  assert.equal(headingFieldDegrees(null), null);
  assert.equal(headingFieldDegrees(Number.NaN), null);
  assert.equal(headingFieldDegrees(0), 0);
  assert.equal(headingFieldDegrees(270), 270);

  assert.equal(contactHasHeading({ true_track: 0 }), true);
  assert.equal(contactHasHeading({ true_track: 270 }), true);
  assert.equal(contactHasHeading({ true_track: null }), false);
  assert.equal(contactHasHeading({ true_track: undefined }), false);
  assert.equal(contactHasHeading({}), false);

  const missing = {};
  const empty = { true_track: null };
  const north = { true_track: 0 };
  const west = { true_track: 270 };

  for (const contact of [missing, empty, north, west]) {
    assert.equal(passesHideNoHeadingFilter({ ...contact, hideNoHeading: false }), true,
      'off keeps missing + 0 + 270');
  }

  const chip = hideNoHeadingChipModel(false);
  assert.equal(chip.label, HIDE_NO_HEADING_CHIP_LABEL);
  assert.equal(chip.id, HIDE_NO_HEADING_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoHeading: true });
  assert.deepEqual(hideNoHeadingChipModel(true).params, { hideNoHeading: false });
});

test('on drops null/undefined, keeps 0 and 270', () => {
  const missing = emptyBillboard();
  const north = emptyBillboard();
  const west = emptyBillboard();
  const empty = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'a1b2c3',
    meta: { true_track: undefined, callsign: 'UNK1', registration: 'N123AB', klass: 'airliner', onGround: false },
    billboard: missing,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'north00',
    meta: { true_track: 0, callsign: 'N000', registration: 'N000AA', klass: 'airliner', onGround: false },
    billboard: north,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'west270',
    meta: { true_track: 270, callsign: 'W270', registration: 'N270WW', klass: 'airliner', onGround: false },
    billboard: west,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'empty01',
    meta: { true_track: null, callsign: 'NULL1', registration: 'N100UA', klass: 'airliner', onGround: false },
    billboard: empty,
  });
  try {
    assert.equal(flightsLayer.getParams().hideNoHeading, false);
    assert.equal(missing.show, true);
    assert.equal(north.show, true);
    assert.equal(west.show, true);
    assert.equal(empty.show, true);

    assert.equal(flightsLayer.setParams({ hideNoHeading: true }), true);
    assert.equal(flightsLayer.getParams().hideNoHeading, true);
    assert.equal(missing.show, false, 'undefined true_track hides');
    assert.equal(north.show, true, '0 stays (north)');
    assert.equal(west.show, true, '270 stays');
    assert.equal(empty.show, false, 'null true_track hides');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: { klass: 'airliner', onGround: false },
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().hideNoHeading, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(north.show, true);

    flightsLayer.setParams({ hideNoHeading: false });
    assert.equal(missing.show, true);
    assert.equal(empty.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetHideNoHeadingLayers();
  }
});

test('selected id always kept', () => {
  const selected = emptyBillboard();
  const otherEmpty = emptyBillboard();
  const north = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: { true_track: null, callsign: 'SEL1', registration: 'N9SEL', klass: 'airliner', onGround: false },
    billboard: selected,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: true,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'othhex',
    meta: { true_track: undefined, callsign: 'OTH1', registration: 'N2OTH', klass: 'airliner', onGround: false },
    billboard: otherEmpty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'north00',
    meta: { true_track: 0, callsign: 'N000', registration: 'N000AA', klass: 'airliner', onGround: false },
    billboard: north,
  });
  try {
    flightsLayer.setParams({ hideNoHeading: true });
    assert.equal(selected.show, true, 'tracked missing-heading contact stays');
    assert.equal(otherEmpty.show, false);
    assert.equal(north.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked missing-heading hides');
    assert.equal(north.show, true);
  } finally {
    resetHideNoHeadingLayers();
  }
});

test('Hide no heading ANDs with 95/166/188/203/214/222/227 and stays distinct from 101 NESW', () => {
  const lowHeaded = emptyBillboard();
  const highHeaded = emptyBillboard();
  const highMissing = emptyBillboard();
  const parkedHeaded = emptyBillboard();
  const registrationOnly = emptyBillboard();
  const emergencyHeaded = emptyBillboard();
  const typedMissingHead = emptyBillboard();
  const emptyCallsignHeaded = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'andhigh',
    meta: {
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
    billboard: highHeaded,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andlow',
    meta: {
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
    billboard: lowHeaded,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhex',
    meta: {
      true_track: null,
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
    billboard: highMissing,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andpark',
    meta: {
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
    billboard: parkedHeaded,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andreg',
    meta: {
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
    billboard: emergencyHeaded,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andtyp',
    meta: {
      true_track: null,
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
    billboard: typedMissingHead,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andcs',
    meta: {
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
    billboard: emptyCallsignHeaded,
  });
  try {
    flightsLayer.setParams({
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
      headingSectors: 'E',
    });
    assert.equal(highMissing.show, true, '101 NESW fail-open keeps missing heading');
    assert.equal(highHeaded.show, false, '270 is west — E-only hides it');
    assert.equal(lowHeaded.show, false, '0 is north — E-only hides it');

    flightsLayer.setParams({ headingSectors: 'NESW', hideNoHeading: true });
    assert.equal(highHeaded.show, true);
    assert.equal(lowHeaded.show, true, '0 stays when Hide no heading is on');
    assert.equal(highMissing.show, false, 'null heading hides while NESW chips stay fail-open');
    assert.equal(parkedHeaded.show, true);
    assert.equal(registrationOnly.show, true, 'headed registration-only stays — not Identified only');
    assert.equal(emergencyHeaded.show, true, 'headed 7700 stays — Hide no heading is not Emergencies only');
    assert.equal(typedMissingHead.show, false, 'typed but missing heading still hides');
    assert.equal(emptyCallsignHeaded.show, true, 'headed empty-callsign stays until 227 is on');

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(highHeaded.show, true);
    assert.equal(parkedHeaded.show, false, 'AND: grounded headed contact hides under airborne-only');

    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highHeaded.show, true, 'AND: in-band headed remains');
    assert.equal(lowHeaded.show, false, 'AND: headed but out-of-band hides');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ airborneOnly: false, callsignPrefixes: 'UAL' });
    assert.equal(highHeaded.show, true, 'AND: matching headed remains');
    assert.equal(parkedHeaded.show, false, 'AND: prefix still hides a non-UAL headed');

    flightsLayer.setParams({ callsignPrefixes: '', aircraftClassFilter: 'airliner' });
    assert.equal(highHeaded.show, true);
    assert.equal(parkedHeaded.show, false, 'AND: class chip still hides a helo headed');

    flightsLayer.setParams({ aircraftClassFilter: 'all', speedMinKt: 200, speedMaxKt: null });
    assert.equal(highHeaded.show, true, 'AND: in-band speed remains');
    assert.equal(lowHeaded.show, false, 'AND: headed but below speed floor hides');

    flightsLayer.setParams({ speedMinKt: null, showClimb: false, showLevel: true, showDescent: true });
    assert.equal(highHeaded.show, true, 'AND: level headed remains');
    assert.equal(lowHeaded.show, false, 'AND: climbing headed hides when climb is off');

    flightsLayer.setParams({ showClimb: true, identifiedOnly: true });
    assert.equal(highHeaded.show, true);
    assert.equal(registrationOnly.show, true, 'Identified only keeps headed registration-only');
    assert.equal(highMissing.show, false, 'AND: Hide no heading still drops missing heading');

    flightsLayer.setParams({ hideNoHeading: false });
    assert.equal(highMissing.show, true, 'Identified only keeps missing-heading when Hide no heading is off');

    flightsLayer.setParams({ hideNoHeading: true, identifiedOnly: false, emergenciesOnly: true });
    assert.equal(emergencyHeaded.show, true, 'AND: Emergencies only keeps headed 7700');
    assert.equal(highHeaded.show, false, 'AND: Emergencies only hides headed 1200');

    flightsLayer.setParams({ emergenciesOnly: false, hideNoSquawk: true });
    assert.equal(highHeaded.show, true, 'AND: headed 1200 stays under Hide no squawk');
    assert.equal(highMissing.show, false, 'AND: missing heading still hides');

    flightsLayer.setParams({ hideNoSquawk: false, hideNoType: true });
    assert.equal(highHeaded.show, true, 'AND: headed typed stays under Hide no type');
    assert.equal(typedMissingHead.show, false, 'AND: typed missing-heading still hides');
    assert.equal(highMissing.show, false);

    flightsLayer.setParams({ hideNoType: false, hideNoReg: true });
    assert.equal(highHeaded.show, true, 'AND: headed registered stays under Hide no registration');
    assert.equal(highMissing.show, false);

    flightsLayer.setParams({ hideNoReg: false, hideNoCallsign: true });
    assert.equal(highHeaded.show, true, 'AND: headed callsigned stays under Hide no callsign');
    assert.equal(emptyCallsignHeaded.show, false, 'AND: Hide no callsign still drops headed empty-callsign');
    assert.equal(highMissing.show, false);
  } finally {
    resetHideNoHeadingLayers();
  }
});

test('invalid storage reads as off', () => {
  resetHideNoHeadingForTest();
  assert.equal(HIDE_NO_HEADING_STORAGE_KEY, 'meridian.flightHideNoHeading');
  assert.equal(readHideNoHeadingEnabled(memoryStorage()), false);
  assert.equal(readHideNoHeadingEnabled(memoryStorage({ 'meridian.flightHideNoHeading': 'nope' })), false);
  assert.equal(readHideNoHeadingEnabled(memoryStorage({ 'meridian.flightHideNoHeading': 'yes' })), false);
  assert.equal(readHideNoHeadingEnabled({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');
});

test('persist flip survives reload', () => {
  resetHideNoHeadingForTest();
  const storage = memoryStorage();
  assert.equal(writeHideNoHeadingEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightHideNoHeading': '1' });
  assert.equal(readHideNoHeadingEnabled(storage), true);
  assert.equal(writeHideNoHeadingEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightHideNoHeading'], '0');

  const seen = [];
  const unsubscribe = subscribeHideNoHeadingEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getHideNoHeadingEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightHideNoHeading': '1' });
    assert.equal(hydrateHideNoHeadingEnabled(hydrated), true);
    assert.equal(getHideNoHeadingEnabled(), true);
    assert.equal(setHideNoHeadingEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightHideNoHeading'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetHideNoHeadingForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(Object.hasOwn(defaults, 'hideNoHeading'), false, 'not a share-URL option');
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(Object.hasOwn(omitted.options.flights, 'hideNoHeading'), false);

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { hideNoHeading: true } },
  }));
  assert.doesNotMatch(String(encodedOn.get('lo') || ''), /hideNoHeading/);
  const encodedOff = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: {} },
  }));
  assert.equal(String(encodedOn.get('lo') || ''), String(encodedOff.get('lo') || ''),
    'no share-URL write');

  hydrateHideNoHeadingEnabled(memoryStorage({ 'meridian.flightHideNoHeading': '1' }));
  flightsLayer.setParams({ airborneOnly: false, identifiedOnly: false, emergenciesOnly: false });
  assert.equal(getHideNoHeadingEnabled(), true, 'coordinator-style restore keeps the flip');
  assert.equal(flightsLayer.getParams().hideNoHeading, true);

  flightsLayer.setParams({ hideNoHeading: false });
  assert.equal(flightsLayer.getParams().hideNoHeading, false);
  flightsLayer.setParams({ hideNoHeading: true });
  assert.equal(flightsLayer.getParams().hideNoHeading, true);
  const chip = flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_HEADING_CHIP_ID);
  assert.equal(chip.label, HIDE_NO_HEADING_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { hideNoHeading: false });
  flightsLayer.setParams({ hideNoHeading: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_HEADING_CHIP_ID).active, false);
  resetHideNoHeadingForTest();
});

test('militaryFlights.js is unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const flights = data('flights.js');
  const helper = data('flightHideNoHeadingFilter.js');
  const military = data('militaryFlights.js');
  const adapter = data('adsbLolFallback.js');
  const manager = data('manager.js');
  assert.doesNotMatch(html, /hide-no-heading|Hide no heading/);
  assert.doesNotMatch(ui, /hideNoHeading|_initHideNoHeading/);
  assert.match(flights, /hideNoHeadingChipModel\(/);
  assert.match(flights, /passesHideNoHeadingFilter/);
  assert.match(flights, /_hideNoHeadingMatcher/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /hideNoHeading|hide-no-heading|flightHideNoHeadingFilter/);
  assert.doesNotMatch(adapter, /hideNoHeading|hide-no-heading|flightHideNoHeadingFilter/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.doesNotMatch(helper, /originCountry/);
  assert.match(helper, /meridian\.flightHideNoHeading/);
  assert.match(helper, /not written into the share URL/);
});

test('legal: already-fetched true_track only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightHideNoHeadingFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth/i);
  assert.match(moduleSource, /true_track/);
});
