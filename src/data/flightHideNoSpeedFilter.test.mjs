import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  HIDE_NO_SPEED_CHIP_ID,
  HIDE_NO_SPEED_CHIP_LABEL,
  HIDE_NO_SPEED_DEFAULT,
  HIDE_NO_SPEED_STORAGE_KEY,
  contactHasSpeed,
  getHideNoSpeedEnabled,
  hideNoSpeedChipModel,
  hydrateHideNoSpeedEnabled,
  normalizeHideNoSpeed,
  passesHideNoSpeedFilter,
  readHideNoSpeedEnabled,
  resetHideNoSpeedForTest,
  setHideNoSpeedEnabled,
  subscribeHideNoSpeedEnabled,
  velocityFieldMps,
  writeHideNoSpeedEnabled,
} from './flightHideNoSpeedFilter.js';
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

function resetHideNoSpeedLayers() {
  resetHideNoSpeedForTest();
  setHeadingSectors('NESW');
  flightsLayer.setParams({
    hideNoSpeed: false,
    hideNoCountry: false,
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

test('off keeps null velocity', () => {
  assert.equal(HIDE_NO_SPEED_DEFAULT, false);
  assert.equal(HIDE_NO_SPEED_STORAGE_KEY, 'meridian.flightHideNoSpeed');
  assert.equal(normalizeHideNoSpeed(undefined), false);
  assert.equal(normalizeHideNoSpeed(null), false);
  assert.equal(normalizeHideNoSpeed('nope'), false);
  assert.equal(normalizeHideNoSpeed(false), false);
  assert.equal(normalizeHideNoSpeed(true), true);
  assert.equal(normalizeHideNoSpeed('1'), true);

  assert.equal(velocityFieldMps(undefined), null);
  assert.equal(velocityFieldMps(null), null);
  assert.equal(velocityFieldMps(Number.NaN), null);
  assert.equal(velocityFieldMps(Number.POSITIVE_INFINITY), null);
  assert.equal(velocityFieldMps(0), 0);
  assert.equal(velocityFieldMps(200), 200);

  assert.equal(contactHasSpeed({ velocity: 0 }), true);
  assert.equal(contactHasSpeed({ velocity: 200 }), true);
  assert.equal(contactHasSpeed({ velocity: null }), false);
  assert.equal(contactHasSpeed({ velocity: undefined }), false);
  assert.equal(contactHasSpeed({ velocity: Number.NaN }), false);
  assert.equal(contactHasSpeed({}), false);

  const missing = {};
  const empty = { velocity: null };
  const parked = { velocity: 0 };
  const cruising = { velocity: 200 };
  const nanSpeed = { velocity: Number.NaN };

  for (const contact of [missing, empty, parked, cruising, nanSpeed]) {
    assert.equal(passesHideNoSpeedFilter({ ...contact, hideNoSpeed: false }), true,
      'off keeps null velocity');
  }

  const chip = hideNoSpeedChipModel(false);
  assert.equal(chip.label, HIDE_NO_SPEED_CHIP_LABEL);
  assert.equal(chip.id, HIDE_NO_SPEED_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoSpeed: true });
  assert.deepEqual(hideNoSpeedChipModel(true).params, { hideNoSpeed: false });
});

test('on keeps 0 and a finite speed and drops null/NaN', () => {
  const missing = emptyBillboard();
  const parked = emptyBillboard();
  const cruising = emptyBillboard();
  const empty = emptyBillboard();
  const nanSpeed = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'a1b2c3',
    meta: { velocity: undefined, true_track: 270, originCountry: 'United States', callsign: 'UNK1', registration: 'N123AB', klass: 'airliner', onGround: false },
    billboard: missing,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'park000',
    meta: { velocity: 0, true_track: 270, originCountry: 'United States', callsign: 'N000', registration: 'N000AA', klass: 'airliner', onGround: true },
    billboard: parked,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'cruise1',
    meta: { velocity: 200, true_track: 270, originCountry: 'United States', callsign: 'UAL100', registration: 'N100UA', klass: 'airliner', onGround: false },
    billboard: cruising,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'empty01',
    meta: { velocity: null, true_track: 270, originCountry: 'United States', callsign: 'NULL1', registration: 'N100UA', klass: 'airliner', onGround: false },
    billboard: empty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'nan0001',
    meta: { velocity: Number.NaN, true_track: 270, originCountry: 'United States', callsign: 'NAN1', registration: 'N1NAN', klass: 'airliner', onGround: false },
    billboard: nanSpeed,
  });
  try {
    assert.equal(flightsLayer.getParams().hideNoSpeed, false);
    assert.equal(missing.show, true);
    assert.equal(parked.show, true);
    assert.equal(cruising.show, true);
    assert.equal(empty.show, true);
    assert.equal(nanSpeed.show, true);

    assert.equal(flightsLayer.setParams({ hideNoSpeed: true }), true);
    assert.equal(flightsLayer.getParams().hideNoSpeed, true);
    assert.equal(missing.show, false, 'undefined velocity hides');
    assert.equal(parked.show, true, '0 stays (parked / on-ground)');
    assert.equal(cruising.show, true, 'finite speed stays');
    assert.equal(empty.show, false, 'null velocity hides');
    assert.equal(nanSpeed.show, false, 'NaN velocity hides');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: { klass: 'airliner', onGround: false },
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().hideNoSpeed, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(parked.show, true);
    assert.equal(cruising.show, true);

    flightsLayer.setParams({ hideNoSpeed: false });
    assert.equal(missing.show, true);
    assert.equal(empty.show, true);
    assert.equal(nanSpeed.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetHideNoSpeedLayers();
  }
});

test('selected id always kept', () => {
  const selected = emptyBillboard();
  const otherEmpty = emptyBillboard();
  const cruising = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: { velocity: null, true_track: 270, originCountry: 'United States', callsign: 'SEL1', registration: 'N9SEL', klass: 'airliner', onGround: false },
    billboard: selected,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: true,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'othhex',
    meta: { velocity: undefined, true_track: 270, originCountry: 'United States', callsign: 'OTH1', registration: 'N2OTH', klass: 'airliner', onGround: false },
    billboard: otherEmpty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'cruise1',
    meta: { velocity: 200, true_track: 270, originCountry: 'United States', callsign: 'UAL100', registration: 'N100UA', klass: 'airliner', onGround: false },
    billboard: cruising,
  });
  try {
    flightsLayer.setParams({ hideNoSpeed: true });
    assert.equal(selected.show, true, 'tracked missing-speed contact stays');
    assert.equal(otherEmpty.show, false);
    assert.equal(cruising.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked missing-speed hides');
    assert.equal(cruising.show, true);
  } finally {
    resetHideNoSpeedLayers();
  }
});

test('QA 49: Hide no country ON keeps unpublished country; Hide no speed still fail-closes missing velocity', () => {
  const unpublishedCruising = emptyBillboard();
  const publishedCruising = emptyBillboard();
  const unpublishedMissingSpeed = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'aa1416',
    meta: {
      originCountry: null,
      callsign: 'UAL1416',
      registration: 'N1416U',
      klass: 'airliner',
      onGround: false,
      velocity: 200,
      true_track: 90,
    },
    billboard: unpublishedCruising,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'usa001',
    meta: {
      originCountry: 'United States',
      callsign: 'UAL100',
      registration: 'N100UA',
      klass: 'airliner',
      onGround: false,
      velocity: 200,
      true_track: 90,
    },
    billboard: publishedCruising,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'aa0986',
    meta: {
      originCountry: null,
      callsign: 'DAL986',
      registration: 'N986DL',
      klass: 'airliner',
      onGround: false,
      velocity: null,
      true_track: 90,
    },
    billboard: unpublishedMissingSpeed,
  });
  try {
    flightsLayer.setParams({ hideNoCountry: true, hideNoSpeed: false });
    assert.equal(unpublishedCruising.show, true, 'QA 49: unpublished UAL1416 stays');
    assert.equal(publishedCruising.show, true, 'published country stays');
    assert.equal(unpublishedMissingSpeed.show, true, 'Hide no speed off keeps null velocity');

    flightsLayer.setParams({ hideNoSpeed: true });
    assert.equal(unpublishedCruising.show, true, 'QA 49 + 255: unpublished country with finite speed stays');
    assert.equal(publishedCruising.show, true, 'published country with finite speed stays');
    assert.equal(unpublishedMissingSpeed.show, false, 'Plan 255: missing velocity still fail-closes');
  } finally {
    resetHideNoSpeedLayers();
  }
});

test('Hide no speed ANDs with 95/166/188/203/214/222/227/234/244 and stays distinct from the fail-open speed floor', () => {
  const lowSpeed = emptyBillboard();
  const highSpeed = emptyBillboard();
  const highMissing = emptyBillboard();
  const parkedZero = emptyBillboard();
  const registrationOnly = emptyBillboard();
  const emergencySpeed = emptyBillboard();
  const typedMissingSpeed = emptyBillboard();
  const emptyCallsignSpeed = emptyBillboard();
  const headedMissingSpeed = emptyBillboard();
  const countryMissingSpeed = emptyBillboard();
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
    billboard: highSpeed,
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
    billboard: lowSpeed,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhex',
    meta: {
      originCountry: 'United States',
      true_track: 270,
      callsign: 'SWA9',
      registration: 'N9SWA',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      velocity: null,
      verticalRate: 0,
    },
    billboard: highMissing,
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
    billboard: parkedZero,
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
    billboard: emergencySpeed,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andtyp',
    meta: {
      originCountry: 'United States',
      true_track: 270,
      callsign: 'C172X',
      registration: 'N9TYP',
      typeCode: 'C172',
      squawk: '1200',
      klass: 'small',
      onGround: false,
      altitude: 12_000,
      velocity: null,
      verticalRate: 0,
    },
    billboard: typedMissingSpeed,
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
    billboard: emptyCallsignSpeed,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhead',
    meta: {
      originCountry: 'United States',
      true_track: 270,
      callsign: 'HDG9',
      registration: 'N9HDG',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      velocity: null,
      verticalRate: 0,
    },
    billboard: headedMissingSpeed,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andcty',
    meta: {
      originCountry: 'United States',
      true_track: 270,
      callsign: 'CTY9',
      registration: 'N9CTY',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      velocity: null,
      verticalRate: 0,
    },
    billboard: countryMissingSpeed,
  });
  try {
    flightsLayer.setParams({
      hideNoSpeed: false,
      hideNoCountry: false,
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
      speedMinKt: 200,
      speedMaxKt: null,
    });
    assert.equal(highMissing.show, true, 'fail-open speed-band floor keeps missing velocity');
    assert.equal(highSpeed.show, true, '200 m/s stays under the 200 kt floor');
    assert.equal(lowSpeed.show, false, '80 m/s hides under the speed-band floor');
    assert.equal(parkedZero.show, false, '0 hides under the speed-band floor');

    flightsLayer.setParams({ speedMinKt: null, hideNoSpeed: true });
    assert.equal(highSpeed.show, true);
    assert.equal(lowSpeed.show, true, 'finite 80 stays — Hide no speed is not a floor');
    assert.equal(parkedZero.show, true, '0 stays — real parked / on-ground speed');
    assert.equal(highMissing.show, false, 'null velocity hides while the speed-band floor stays fail-open');
    assert.equal(registrationOnly.show, true, 'speed-bearing registration-only stays — not Identified only');
    assert.equal(emergencySpeed.show, true, 'speed-bearing 7700 stays — Hide no speed is not Emergencies only');
    assert.equal(typedMissingSpeed.show, false, 'typed but missing speed still hides');
    assert.equal(headedMissingSpeed.show, false, 'headed but missing speed still hides');
    assert.equal(countryMissingSpeed.show, false, 'country-bearing but missing speed still hides');
    assert.equal(emptyCallsignSpeed.show, true, 'speed-bearing empty-callsign stays until 227 is on');

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(highSpeed.show, true);
    assert.equal(parkedZero.show, false, 'AND: grounded zero-speed contact hides under airborne-only');

    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highSpeed.show, true, 'AND: in-band speed-bearing remains');
    assert.equal(lowSpeed.show, false, 'AND: speed-bearing but out-of-band hides');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ airborneOnly: false, callsignPrefixes: 'UAL' });
    assert.equal(highSpeed.show, true, 'AND: matching speed-bearing remains');
    assert.equal(parkedZero.show, false, 'AND: prefix still hides a non-UAL speed-bearing');

    flightsLayer.setParams({ callsignPrefixes: '', aircraftClassFilter: 'airliner' });
    assert.equal(highSpeed.show, true);
    assert.equal(parkedZero.show, false, 'AND: class chip still hides a helo speed-bearing');

    flightsLayer.setParams({ aircraftClassFilter: 'all', speedMinKt: 200, speedMaxKt: null });
    assert.equal(highSpeed.show, true, 'AND: in-band speed remains');
    assert.equal(lowSpeed.show, false, 'AND: finite but below speed floor hides');
    assert.equal(parkedZero.show, false, 'AND: 0 still fails the speed-band floor');
    assert.equal(highMissing.show, false, 'AND: missing speed still hides');

    flightsLayer.setParams({ speedMinKt: null, showClimb: false, showLevel: true, showDescent: true });
    assert.equal(highSpeed.show, true, 'AND: level speed-bearing remains');
    assert.equal(lowSpeed.show, false, 'AND: climbing speed-bearing hides when climb is off');

    flightsLayer.setParams({ showClimb: true, identifiedOnly: true });
    assert.equal(highSpeed.show, true);
    assert.equal(registrationOnly.show, true, 'Identified only keeps speed-bearing registration-only');
    assert.equal(highMissing.show, false, 'AND: Hide no speed still drops missing speed');

    flightsLayer.setParams({ hideNoSpeed: false });
    assert.equal(highMissing.show, true, 'Identified only keeps missing-speed when Hide no speed is off');

    flightsLayer.setParams({ hideNoSpeed: true, identifiedOnly: false, emergenciesOnly: true });
    assert.equal(emergencySpeed.show, true, 'AND: Emergencies only keeps speed-bearing 7700');
    assert.equal(highSpeed.show, false, 'AND: Emergencies only hides speed-bearing 1200');

    flightsLayer.setParams({ emergenciesOnly: false, hideNoSquawk: true });
    assert.equal(highSpeed.show, true, 'AND: speed-bearing 1200 stays under Hide no squawk');
    assert.equal(highMissing.show, false, 'AND: missing speed still hides');

    flightsLayer.setParams({ hideNoSquawk: false, hideNoType: true });
    assert.equal(highSpeed.show, true, 'AND: speed-bearing typed stays under Hide no type');
    assert.equal(typedMissingSpeed.show, false, 'AND: typed missing-speed still hides');
    assert.equal(highMissing.show, false);

    flightsLayer.setParams({ hideNoType: false, hideNoReg: true });
    assert.equal(highSpeed.show, true, 'AND: speed-bearing registered stays under Hide no registration');
    assert.equal(highMissing.show, false);

    flightsLayer.setParams({ hideNoReg: false, hideNoCallsign: true });
    assert.equal(highSpeed.show, true, 'AND: speed-bearing callsigned stays under Hide no callsign');
    assert.equal(emptyCallsignSpeed.show, false, 'AND: Hide no callsign still drops speed-bearing empty-callsign');
    assert.equal(highMissing.show, false);

    flightsLayer.setParams({ hideNoCallsign: false, hideNoHeading: true });
    assert.equal(highSpeed.show, true, 'AND: speed-bearing headed stays under Hide no heading');
    assert.equal(headedMissingSpeed.show, false, 'AND: headed missing-speed still hides');
    assert.equal(highMissing.show, false);

    flightsLayer.setParams({ hideNoHeading: false, hideNoCountry: true });
    assert.equal(highSpeed.show, true, 'AND: speed-bearing country stays under Hide no country');
    assert.equal(countryMissingSpeed.show, false, 'AND: country-bearing missing-speed still hides');
    assert.equal(highMissing.show, false);
  } finally {
    resetHideNoSpeedLayers();
  }
});

test('invalid storage reads as off', () => {
  resetHideNoSpeedForTest();
  assert.equal(HIDE_NO_SPEED_STORAGE_KEY, 'meridian.flightHideNoSpeed');
  assert.equal(readHideNoSpeedEnabled(memoryStorage()), false);
  assert.equal(readHideNoSpeedEnabled(memoryStorage({ 'meridian.flightHideNoSpeed': 'nope' })), false);
  assert.equal(readHideNoSpeedEnabled(memoryStorage({ 'meridian.flightHideNoSpeed': 'yes' })), false);
  assert.equal(readHideNoSpeedEnabled({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');
});

test('persist flip survives reload', () => {
  resetHideNoSpeedForTest();
  const storage = memoryStorage();
  assert.equal(writeHideNoSpeedEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightHideNoSpeed': '1' });
  assert.equal(readHideNoSpeedEnabled(storage), true);
  assert.equal(writeHideNoSpeedEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightHideNoSpeed'], '0');

  const seen = [];
  const unsubscribe = subscribeHideNoSpeedEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getHideNoSpeedEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightHideNoSpeed': '1' });
    assert.equal(hydrateHideNoSpeedEnabled(hydrated), true);
    assert.equal(getHideNoSpeedEnabled(), true);
    assert.equal(setHideNoSpeedEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightHideNoSpeed'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetHideNoSpeedForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(Object.hasOwn(defaults, 'hideNoSpeed'), false, 'not a share-URL option');
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(Object.hasOwn(omitted.options.flights, 'hideNoSpeed'), false);

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { hideNoSpeed: true } },
  }));
  assert.doesNotMatch(String(encodedOn.get('lo') || ''), /hideNoSpeed/);
  const encodedOff = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: {} },
  }));
  assert.equal(String(encodedOn.get('lo') || ''), String(encodedOff.get('lo') || ''),
    'no share-URL write');

  hydrateHideNoSpeedEnabled(memoryStorage({ 'meridian.flightHideNoSpeed': '1' }));
  flightsLayer.setParams({ airborneOnly: false, identifiedOnly: false, emergenciesOnly: false });
  assert.equal(getHideNoSpeedEnabled(), true, 'coordinator-style restore keeps the flip');
  assert.equal(flightsLayer.getParams().hideNoSpeed, true);

  flightsLayer.setParams({ hideNoSpeed: false });
  assert.equal(flightsLayer.getParams().hideNoSpeed, false);
  flightsLayer.setParams({ hideNoSpeed: true });
  assert.equal(flightsLayer.getParams().hideNoSpeed, true);
  const chips = flightsLayer.getRowControls().chips;
  const chip = chips.find((entry) => entry.id === HIDE_NO_SPEED_CHIP_ID);
  const countryIdx = chips.findIndex((entry) => entry.id === 'hide-no-country');
  const speedIdx = chips.findIndex((entry) => entry.id === HIDE_NO_SPEED_CHIP_ID);
  assert.equal(chip.label, HIDE_NO_SPEED_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { hideNoSpeed: false });
  assert.ok(countryIdx >= 0 && speedIdx === countryIdx + 1, 'Hide no speed sits next to Hide no country');
  flightsLayer.setParams({ hideNoSpeed: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_SPEED_CHIP_ID).active, false);
  resetHideNoSpeedForTest();
});

test('militaryFlights.js and aisLiveVessels.js are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const style = root('style.css');
  const flights = data('flights.js');
  const helper = data('flightHideNoSpeedFilter.js');
  const military = data('militaryFlights.js');
  const ais = data('aisLiveVessels.js');
  const adapter = data('adsbLolFallback.js');
  const manager = data('manager.js');
  assert.doesNotMatch(html, /hide-no-speed|Hide no speed/);
  assert.doesNotMatch(ui, /hideNoSpeed|_initHideNoSpeed/);
  assert.doesNotMatch(style, /hide-no-speed|hideNoSpeed/);
  assert.match(flights, /hideNoSpeedChipModel\(/);
  assert.match(flights, /passesHideNoSpeedFilter/);
  assert.match(flights, /_hideNoSpeedMatcher/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /hideNoSpeed|hide-no-speed|flightHideNoSpeedFilter/);
  assert.doesNotMatch(ais, /flightHideNoSpeedFilter|meridian\.flightHideNoSpeed/);
  assert.doesNotMatch(adapter, /hideNoSpeed|hide-no-speed|flightHideNoSpeedFilter/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.doesNotMatch(helper, /OpenSky|opensky/i);
  assert.match(helper, /meta\.velocity/);
  assert.match(helper, /meridian\.flightHideNoSpeed/);
  assert.match(helper, /not written into the share URL/);
  assert.match(helper, /fail-open speed-band floor/);
});

test('legal: already-fetched velocity only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightHideNoSpeedFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth|OpenSky|opensky/i);
  assert.match(moduleSource, /velocity/);
});
