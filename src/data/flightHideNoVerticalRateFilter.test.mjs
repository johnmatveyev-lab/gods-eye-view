import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  HIDE_NO_VERTICAL_RATE_CHIP_ID,
  HIDE_NO_VERTICAL_RATE_CHIP_LABEL,
  HIDE_NO_VERTICAL_RATE_DEFAULT,
  HIDE_NO_VERTICAL_RATE_STORAGE_KEY,
  contactHasVerticalRate,
  getHideNoVerticalRateEnabled,
  hideNoVerticalRateChipModel,
  hydrateHideNoVerticalRateEnabled,
  normalizeHideNoVerticalRate,
  passesHideNoVerticalRateFilter,
  readHideNoVerticalRateEnabled,
  resetHideNoVerticalRateForTest,
  setHideNoVerticalRateEnabled,
  subscribeHideNoVerticalRateEnabled,
  verticalRateFieldMps,
  writeHideNoVerticalRateEnabled,
} from './flightHideNoVerticalRateFilter.js';
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

function resetHideNoVerticalRateLayers() {
  resetHideNoVerticalRateForTest();
  setHeadingSectors('NESW');
  flightsLayer.setParams({
    hideNoVerticalRate: false,
    hideNoGeoAltitude: false,
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

test('off keeps missing / non-finite rate', () => {
  assert.equal(HIDE_NO_VERTICAL_RATE_DEFAULT, false);
  assert.equal(HIDE_NO_VERTICAL_RATE_STORAGE_KEY, 'meridian.flightHideNoVerticalRate');
  assert.equal(normalizeHideNoVerticalRate(undefined), false);
  assert.equal(normalizeHideNoVerticalRate(null), false);
  assert.equal(normalizeHideNoVerticalRate('nope'), false);
  assert.equal(normalizeHideNoVerticalRate(false), false);
  assert.equal(normalizeHideNoVerticalRate(true), true);
  assert.equal(normalizeHideNoVerticalRate('1'), true);

  assert.equal(verticalRateFieldMps(undefined), null);
  assert.equal(verticalRateFieldMps(null), null);
  assert.equal(verticalRateFieldMps(Number.NaN), null);
  assert.equal(verticalRateFieldMps(Number.POSITIVE_INFINITY), null);
  assert.equal(verticalRateFieldMps(0), 0);
  assert.equal(verticalRateFieldMps(5), 5);
  assert.equal(verticalRateFieldMps(-5), -5);

  assert.equal(contactHasVerticalRate({ verticalRate: 0 }), true);
  assert.equal(contactHasVerticalRate({ verticalRate: 5 }), true);
  assert.equal(contactHasVerticalRate({ verticalRate: -5 }), true);
  assert.equal(contactHasVerticalRate({ verticalRateMps: 0 }), true);
  assert.equal(contactHasVerticalRate({ verticalRate: null }), false);
  assert.equal(contactHasVerticalRate({ verticalRate: undefined }), false);
  assert.equal(contactHasVerticalRate({ verticalRate: Number.NaN }), false);
  assert.equal(contactHasVerticalRate({}), false);

  const missing = {};
  const empty = { verticalRate: null };
  const level = { verticalRate: 0 };
  const climb = { verticalRate: 5 };
  const descent = { verticalRate: -5 };
  const nanRate = { verticalRate: Number.NaN };
  const alias = { verticalRateMps: 5 };

  for (const contact of [missing, empty, level, climb, descent, nanRate, alias]) {
    assert.equal(passesHideNoVerticalRateFilter({ ...contact, hideNoVerticalRate: false }), true,
      'off keeps missing / non-finite rate');
  }

  const chip = hideNoVerticalRateChipModel(false);
  assert.equal(chip.label, HIDE_NO_VERTICAL_RATE_CHIP_LABEL);
  assert.equal(chip.id, HIDE_NO_VERTICAL_RATE_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoVerticalRate: true });
  assert.deepEqual(hideNoVerticalRateChipModel(true).params, { hideNoVerticalRate: false });
});

test('on hides missing / non-finite rate and keeps 0 and ±5 m/s', () => {
  const missing = emptyBillboard();
  const level = emptyBillboard();
  const climb = emptyBillboard();
  const descent = emptyBillboard();
  const empty = emptyBillboard();
  const nanRate = emptyBillboard();
  const alias = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'a1b2c3',
    meta: {
      verticalRate: undefined,
      altitude: 12_000,
      geoAltitudeM: 12_000,
      velocity: 200,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'UNK1',
      registration: 'N123AB',
      klass: 'airliner',
      onGround: false,
    },
    billboard: missing,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'level00',
    meta: {
      verticalRate: 0,
      altitude: 12_000,
      geoAltitudeM: 12_000,
      velocity: 200,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'LVL0',
      registration: 'N000LV',
      klass: 'airliner',
      onGround: false,
    },
    billboard: level,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'climb05',
    meta: {
      verticalRate: 5,
      altitude: 12_000,
      geoAltitudeM: 12_000,
      velocity: 200,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'CLB5',
      registration: 'N5CLB',
      klass: 'airliner',
      onGround: false,
    },
    billboard: climb,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'desc05',
    meta: {
      verticalRate: -5,
      altitude: 12_000,
      geoAltitudeM: 12_000,
      velocity: 200,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'DES5',
      registration: 'N5DES',
      klass: 'airliner',
      onGround: false,
    },
    billboard: descent,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'empty01',
    meta: {
      verticalRate: null,
      altitude: 12_000,
      geoAltitudeM: 12_000,
      velocity: 200,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'NULL1',
      registration: 'N100UA',
      klass: 'airliner',
      onGround: false,
    },
    billboard: empty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'nan0001',
    meta: {
      verticalRate: Number.NaN,
      altitude: 12_000,
      geoAltitudeM: 12_000,
      velocity: 200,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'NAN1',
      registration: 'N1NAN',
      klass: 'airliner',
      onGround: false,
    },
    billboard: nanRate,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'alias01',
    meta: {
      verticalRateMps: 5,
      altitude: 12_000,
      geoAltitudeM: 12_000,
      velocity: 200,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'ALS5',
      registration: 'N5ALS',
      klass: 'airliner',
      onGround: false,
    },
    billboard: alias,
  });
  try {
    assert.equal(flightsLayer.getParams().hideNoVerticalRate, false);
    assert.equal(missing.show, true);
    assert.equal(level.show, true);
    assert.equal(climb.show, true);
    assert.equal(descent.show, true);
    assert.equal(empty.show, true);
    assert.equal(nanRate.show, true);
    assert.equal(alias.show, true);

    assert.equal(flightsLayer.setParams({ hideNoVerticalRate: true }), true);
    assert.equal(flightsLayer.getParams().hideNoVerticalRate, true);
    assert.equal(missing.show, false, 'undefined verticalRate hides');
    assert.equal(level.show, true, '0 stays (real level flight)');
    assert.equal(climb.show, true, '+5 m/s stays — not a climb chip');
    assert.equal(descent.show, true, '−5 m/s stays — not a descent chip');
    assert.equal(empty.show, false, 'null verticalRate hides');
    assert.equal(nanRate.show, false, 'NaN verticalRate hides');
    assert.equal(alias.show, true, 'finite verticalRateMps stays');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: { klass: 'airliner', onGround: false, altitude: 12_000 },
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().hideNoVerticalRate, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(level.show, true);
    assert.equal(climb.show, true);
    assert.equal(descent.show, true);

    flightsLayer.setParams({ hideNoVerticalRate: false });
    assert.equal(missing.show, true);
    assert.equal(empty.show, true);
    assert.equal(nanRate.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetHideNoVerticalRateLayers();
  }
});

test('selected / tracked always kept', () => {
  const selected = emptyBillboard();
  const otherEmpty = emptyBillboard();
  const level = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: {
      verticalRate: null,
      altitude: 12_000,
      geoAltitudeM: 12_000,
      velocity: 200,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'SEL1',
      registration: 'N9SEL',
      klass: 'airliner',
      onGround: false,
    },
    billboard: selected,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: true,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'othhex',
    meta: {
      verticalRate: undefined,
      altitude: 12_000,
      geoAltitudeM: 12_000,
      velocity: 200,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'OTH1',
      registration: 'N2OTH',
      klass: 'airliner',
      onGround: false,
    },
    billboard: otherEmpty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'level01',
    meta: {
      verticalRate: 0,
      altitude: 12_000,
      geoAltitudeM: 12_000,
      velocity: 200,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'UAL100',
      registration: 'N100UA',
      klass: 'airliner',
      onGround: false,
    },
    billboard: level,
  });
  try {
    flightsLayer.setParams({ hideNoVerticalRate: true });
    assert.equal(selected.show, true, 'tracked missing-rate contact stays');
    assert.equal(otherEmpty.show, false);
    assert.equal(level.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked missing-rate hides');
    assert.equal(level.show, true);
  } finally {
    resetHideNoVerticalRateLayers();
  }
});

test('Hide no vertical rate ANDs with 95/166/188/203/214/222/227/234/244/255/261 and stays distinct from Plan 97 climb/level/descent', () => {
  const climbRate = emptyBillboard();
  const levelRate = emptyBillboard();
  const missingRate = emptyBillboard();
  const groundedZero = emptyBillboard();
  const registrationOnly = emptyBillboard();
  const emergencyRate = emptyBillboard();
  const typedMissingRate = emptyBillboard();
  const emptyCallsignRate = emptyBillboard();
  const headedMissingRate = emptyBillboard();
  const countryMissingRate = emptyBillboard();
  const speedMissingRate = emptyBillboard();
  const geoMissingRate = emptyBillboard();
  const rateMissingGeo = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'andlvl',
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
      geoAltitudeM: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: levelRate,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andclb',
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
      geoAltitudeM: 2000,
      velocity: 80,
      verticalRate: 5,
    },
    billboard: climbRate,
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
      geoAltitudeM: 12_000,
      velocity: 200,
      verticalRate: null,
    },
    billboard: missingRate,
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
      geoAltitudeM: 0,
      velocity: 0,
      verticalRate: 0,
    },
    billboard: groundedZero,
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
      geoAltitudeM: 12_000,
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
      geoAltitudeM: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: emergencyRate,
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
      geoAltitudeM: 12_000,
      velocity: 200,
      verticalRate: null,
    },
    billboard: typedMissingRate,
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
      geoAltitudeM: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: emptyCallsignRate,
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
      geoAltitudeM: 12_000,
      velocity: 200,
      verticalRate: null,
    },
    billboard: headedMissingRate,
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
      geoAltitudeM: 12_000,
      velocity: 200,
      verticalRate: null,
    },
    billboard: countryMissingRate,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andspd',
    meta: {
      originCountry: 'United States',
      true_track: 270,
      callsign: 'SPD9',
      registration: 'N9SPD',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      geoAltitudeM: 12_000,
      velocity: null,
      verticalRate: 0,
    },
    billboard: speedMissingRate,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andgeo',
    meta: {
      originCountry: 'United States',
      true_track: 270,
      callsign: 'GEO9',
      registration: 'N9GEO',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      geoAltitudeM: null,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: geoMissingRate,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andg2',
    meta: {
      originCountry: 'United States',
      true_track: 270,
      callsign: 'G2XX',
      registration: 'N2GEO',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      geoAltitudeM: null,
      velocity: 200,
      verticalRate: null,
    },
    billboard: rateMissingGeo,
  });
  try {
    flightsLayer.setParams({
      hideNoVerticalRate: false,
      hideNoGeoAltitude: false,
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
    });
    assert.equal(levelRate.show, true);
    assert.equal(climbRate.show, true);
    assert.equal(missingRate.show, true, 'Plan 97 fail-open: missing rate stays when Hide no vertical rate is off');

    flightsLayer.setParams({ showClimb: false, showLevel: true, showDescent: true });
    assert.equal(levelRate.show, true, 'Plan 97: level stays when climb is off');
    assert.equal(climbRate.show, false, 'Plan 97: +5 m/s hides when climb is off');
    assert.equal(missingRate.show, true, 'Plan 97 fail-open: missing rate still stays');

    flightsLayer.setParams({ showClimb: true, hideNoVerticalRate: true });
    assert.equal(levelRate.show, true, '0 stays — real level flight, not hide-ground');
    assert.equal(climbRate.show, true, '+5 m/s stays — Hide no vertical rate is not a climb chip');
    assert.equal(groundedZero.show, true, '0 stays on a grounded contact — not hide-ground');
    assert.equal(missingRate.show, false, 'null verticalRate hides — distinct from Plan 97 fail-open');
    assert.equal(registrationOnly.show, true, 'rate-bearing registration-only stays — not Identified only');
    assert.equal(emergencyRate.show, true, 'rate-bearing 7700 stays — not Emergencies only');
    assert.equal(typedMissingRate.show, false, 'typed but missing rate still hides');
    assert.equal(headedMissingRate.show, false, 'headed but missing rate still hides');
    assert.equal(countryMissingRate.show, false, 'country-bearing but missing rate still hides');
    assert.equal(emptyCallsignRate.show, true, 'rate-bearing empty-callsign stays until 227 is on');
    assert.equal(speedMissingRate.show, true, 'rate-bearing missing-speed stays — not Hide no speed');
    assert.equal(geoMissingRate.show, true, 'rate-bearing missing-geo stays — not Hide no geo altitude');
    assert.equal(rateMissingGeo.show, false, 'missing rate and missing geo hides');

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(levelRate.show, true);
    assert.equal(groundedZero.show, false, 'AND: grounded zero-rate contact hides under airborne-only');

    flightsLayer.setParams({ airborneOnly: false, callsignPrefixes: 'UAL' });
    assert.equal(levelRate.show, true, 'AND: matching rate-bearing remains');
    assert.equal(groundedZero.show, false, 'AND: prefix still hides a non-UAL rate-bearing');

    flightsLayer.setParams({ callsignPrefixes: '', aircraftClassFilter: 'airliner' });
    assert.equal(levelRate.show, true);
    assert.equal(groundedZero.show, false, 'AND: class chip still hides a helo rate-bearing');

    flightsLayer.setParams({ aircraftClassFilter: 'all', showClimb: false, showLevel: true, showDescent: true });
    assert.equal(levelRate.show, true, 'AND: level rate-bearing remains');
    assert.equal(climbRate.show, false, 'AND: climbing rate-bearing hides when climb is off');

    flightsLayer.setParams({ showClimb: true, identifiedOnly: true });
    assert.equal(levelRate.show, true);
    assert.equal(registrationOnly.show, true, 'Identified only keeps rate-bearing registration-only');
    assert.equal(missingRate.show, false, 'AND: Hide no vertical rate still drops missing rate');

    flightsLayer.setParams({ hideNoVerticalRate: false });
    assert.equal(missingRate.show, true, 'Identified only keeps missing-rate when Hide no vertical rate is off');

    flightsLayer.setParams({ hideNoVerticalRate: true, identifiedOnly: false, emergenciesOnly: true });
    assert.equal(emergencyRate.show, true, 'AND: Emergencies only keeps rate-bearing 7700');
    assert.equal(levelRate.show, false, 'AND: Emergencies only hides rate-bearing 1200');

    flightsLayer.setParams({ emergenciesOnly: false, hideNoSquawk: true });
    assert.equal(levelRate.show, true, 'AND: rate-bearing 1200 stays under Hide no squawk');
    assert.equal(missingRate.show, false, 'AND: missing rate still hides');

    flightsLayer.setParams({ hideNoSquawk: false, hideNoType: true });
    assert.equal(levelRate.show, true, 'AND: rate-bearing typed stays under Hide no type');
    assert.equal(typedMissingRate.show, false, 'AND: typed missing-rate still hides');
    assert.equal(missingRate.show, false);

    flightsLayer.setParams({ hideNoType: false, hideNoReg: true });
    assert.equal(levelRate.show, true, 'AND: rate-bearing registered stays under Hide no registration');
    assert.equal(missingRate.show, false);

    flightsLayer.setParams({ hideNoReg: false, hideNoCallsign: true });
    assert.equal(levelRate.show, true, 'AND: rate-bearing callsigned stays under Hide no callsign');
    assert.equal(emptyCallsignRate.show, false, 'AND: Hide no callsign still drops rate-bearing empty-callsign');
    assert.equal(missingRate.show, false);

    flightsLayer.setParams({ hideNoCallsign: false, hideNoHeading: true });
    assert.equal(levelRate.show, true, 'AND: rate-bearing headed stays under Hide no heading');
    assert.equal(headedMissingRate.show, false, 'AND: headed missing-rate still hides');
    assert.equal(missingRate.show, false);

    flightsLayer.setParams({ hideNoHeading: false, hideNoCountry: true });
    assert.equal(levelRate.show, true, 'AND: rate-bearing country stays under Hide no country');
    assert.equal(countryMissingRate.show, false, 'AND: country-bearing missing-rate still hides');
    assert.equal(missingRate.show, false);

    flightsLayer.setParams({ hideNoCountry: false, hideNoSpeed: true });
    assert.equal(levelRate.show, true, 'AND: rate-bearing speed stays under Hide no speed');
    assert.equal(speedMissingRate.show, false, 'AND: Hide no speed still drops rate-bearing missing-speed');
    assert.equal(missingRate.show, false);

    flightsLayer.setParams({ hideNoSpeed: false, hideNoGeoAltitude: true });
    assert.equal(levelRate.show, true, 'AND: rate-bearing geo stays under Hide no geo altitude');
    assert.equal(geoMissingRate.show, false, 'AND: Hide no geo altitude still drops rate-bearing missing-geo');
    assert.equal(rateMissingGeo.show, false, 'AND: missing-rate missing-geo still hides');
    assert.equal(missingRate.show, false);
  } finally {
    resetHideNoVerticalRateLayers();
  }
});

test('invalid storage reads as off', () => {
  resetHideNoVerticalRateForTest();
  assert.equal(HIDE_NO_VERTICAL_RATE_STORAGE_KEY, 'meridian.flightHideNoVerticalRate');
  assert.equal(readHideNoVerticalRateEnabled(memoryStorage()), false);
  assert.equal(readHideNoVerticalRateEnabled(memoryStorage({ 'meridian.flightHideNoVerticalRate': 'nope' })), false);
  assert.equal(readHideNoVerticalRateEnabled(memoryStorage({ 'meridian.flightHideNoVerticalRate': 'yes' })), false);
  assert.equal(readHideNoVerticalRateEnabled({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');
});

test('persist flip survives reload', () => {
  resetHideNoVerticalRateForTest();
  const storage = memoryStorage();
  assert.equal(writeHideNoVerticalRateEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightHideNoVerticalRate': '1' });
  assert.equal(readHideNoVerticalRateEnabled(storage), true);
  assert.equal(writeHideNoVerticalRateEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightHideNoVerticalRate'], '0');

  const seen = [];
  const unsubscribe = subscribeHideNoVerticalRateEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getHideNoVerticalRateEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightHideNoVerticalRate': '1' });
    assert.equal(hydrateHideNoVerticalRateEnabled(hydrated), true);
    assert.equal(getHideNoVerticalRateEnabled(), true);
    assert.equal(setHideNoVerticalRateEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightHideNoVerticalRate'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetHideNoVerticalRateForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(Object.hasOwn(defaults, 'hideNoVerticalRate'), false, 'not a share-URL option');
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(Object.hasOwn(omitted.options.flights, 'hideNoVerticalRate'), false);

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { hideNoVerticalRate: true } },
  }));
  assert.doesNotMatch(String(encodedOn.get('lo') || ''), /hideNoVerticalRate/);
  const encodedOff = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: {} },
  }));
  assert.equal(String(encodedOn.get('lo') || ''), String(encodedOff.get('lo') || ''),
    'no share-URL write');

  hydrateHideNoVerticalRateEnabled(memoryStorage({ 'meridian.flightHideNoVerticalRate': '1' }));
  flightsLayer.setParams({ airborneOnly: false, identifiedOnly: false, emergenciesOnly: false });
  assert.equal(getHideNoVerticalRateEnabled(), true, 'coordinator-style restore keeps the flip');
  assert.equal(flightsLayer.getParams().hideNoVerticalRate, true);

  flightsLayer.setParams({ hideNoVerticalRate: false });
  assert.equal(flightsLayer.getParams().hideNoVerticalRate, false);
  flightsLayer.setParams({ hideNoVerticalRate: true });
  assert.equal(flightsLayer.getParams().hideNoVerticalRate, true);
  const chips = flightsLayer.getRowControls().chips;
  const chip = chips.find((entry) => entry.id === HIDE_NO_VERTICAL_RATE_CHIP_ID);
  const geoIdx = chips.findIndex((entry) => entry.id === 'hide-no-geo-altitude');
  const rateIdx = chips.findIndex((entry) => entry.id === HIDE_NO_VERTICAL_RATE_CHIP_ID);
  assert.equal(chip.label, HIDE_NO_VERTICAL_RATE_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { hideNoVerticalRate: false });
  assert.ok(geoIdx >= 0 && rateIdx === geoIdx + 2, 'Hide no vertical rate stays after Hide no geo altitude and Hide no baro altitude');
  flightsLayer.setParams({ hideNoVerticalRate: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_VERTICAL_RATE_CHIP_ID).active, false);
  resetHideNoVerticalRateForTest();
});

test('militaryFlights.js and aisLiveVessels.js are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const style = root('style.css');
  const flights = data('flights.js');
  const helper = data('flightHideNoVerticalRateFilter.js');
  const military = data('militaryFlights.js');
  const ais = data('aisLiveVessels.js');
  const adapter = data('adsbLolFallback.js');
  const manager = data('manager.js');
  assert.doesNotMatch(html, /hide-no-vertical-rate|Hide no vertical rate/);
  assert.doesNotMatch(ui, /hideNoVerticalRate|_initHideNoVerticalRate/);
  assert.doesNotMatch(style, /hide-no-vertical-rate|hideNoVerticalRate/);
  assert.match(flights, /hideNoVerticalRateChipModel\(/);
  assert.match(flights, /passesHideNoVerticalRateFilter/);
  assert.match(flights, /_hideNoVerticalRateMatcher/);
  assert.match(flights, /verticalRate: stickyNumber\(vertical_rate, prevMeta\?\.verticalRate, null\)/);
  assert.match(flights, /typeCode: stickyText\(state\[18\] \?\? state\.t, prevMeta\?\.typeCode\) \|\| null,/);
  assert.match(flights, /registration: stickyText\(state\[19\] \?\? state\.r, prevMeta\?\.registration\) \|\| null,/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /hideNoVerticalRate|hide-no-vertical-rate|flightHideNoVerticalRateFilter/);
  assert.doesNotMatch(ais, /flightHideNoVerticalRateFilter|meridian\.flightHideNoVerticalRate/);
  assert.doesNotMatch(adapter, /hideNoVerticalRate|hide-no-vertical-rate|flightHideNoVerticalRateFilter/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.doesNotMatch(helper, /OpenSky|opensky/i);
  assert.match(helper, /verticalRate/);
  assert.match(helper, /verticalRateMps/);
  assert.match(helper, /meridian\.flightHideNoVerticalRate/);
  assert.match(helper, /not written into the share URL/);
  assert.match(helper, /Plan 97 climb/);
  assert.match(helper, /Hide no geo altitude \(Plan 261/);
  assert.match(helper, /Hide no speed \(Plan 255/);
});

test('legal: already-fetched verticalRate only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightHideNoVerticalRateFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth|OpenSky|opensky/i);
  assert.match(moduleSource, /verticalRate/);
});
