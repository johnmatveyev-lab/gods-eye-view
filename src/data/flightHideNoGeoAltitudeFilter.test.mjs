import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  HIDE_NO_GEO_ALTITUDE_CHIP_ID,
  HIDE_NO_GEO_ALTITUDE_CHIP_LABEL,
  HIDE_NO_GEO_ALTITUDE_DEFAULT,
  HIDE_NO_GEO_ALTITUDE_STORAGE_KEY,
  contactHasGeoAltitude,
  getHideNoGeoAltitudeEnabled,
  geoAltitudeFieldM,
  hideNoGeoAltitudeChipModel,
  hydrateHideNoGeoAltitudeEnabled,
  normalizeHideNoGeoAltitude,
  passesHideNoGeoAltitudeFilter,
  readHideNoGeoAltitudeEnabled,
  resetHideNoGeoAltitudeForTest,
  setHideNoGeoAltitudeEnabled,
  subscribeHideNoGeoAltitudeEnabled,
  writeHideNoGeoAltitudeEnabled,
} from './flightHideNoGeoAltitudeFilter.js';
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

function resetHideNoGeoAltitudeLayers() {
  resetHideNoGeoAltitudeForTest();
  setHeadingSectors('NESW');
  flightsLayer.setParams({
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

test('off keeps missing geo', () => {
  assert.equal(HIDE_NO_GEO_ALTITUDE_DEFAULT, false);
  assert.equal(HIDE_NO_GEO_ALTITUDE_STORAGE_KEY, 'meridian.flightHideNoGeoAltitude');
  assert.equal(normalizeHideNoGeoAltitude(undefined), false);
  assert.equal(normalizeHideNoGeoAltitude(null), false);
  assert.equal(normalizeHideNoGeoAltitude('nope'), false);
  assert.equal(normalizeHideNoGeoAltitude(false), false);
  assert.equal(normalizeHideNoGeoAltitude(true), true);
  assert.equal(normalizeHideNoGeoAltitude('1'), true);

  assert.equal(geoAltitudeFieldM(undefined), null);
  assert.equal(geoAltitudeFieldM(null), null);
  assert.equal(geoAltitudeFieldM(Number.NaN), null);
  assert.equal(geoAltitudeFieldM(Number.POSITIVE_INFINITY), null);
  assert.equal(geoAltitudeFieldM(0), 0);
  assert.equal(geoAltitudeFieldM(12_000), 12_000);

  assert.equal(contactHasGeoAltitude({ geoAltitudeM: 0 }), true);
  assert.equal(contactHasGeoAltitude({ geoAltitudeM: 12_000 }), true);
  assert.equal(contactHasGeoAltitude({ geoAltitudeM: null }), false);
  assert.equal(contactHasGeoAltitude({ geoAltitudeM: undefined }), false);
  assert.equal(contactHasGeoAltitude({ geoAltitudeM: Number.NaN }), false);
  assert.equal(contactHasGeoAltitude({}), false);

  const missing = {};
  const empty = { geoAltitudeM: null };
  const grounded = { geoAltitudeM: 0 };
  const cruising = { geoAltitudeM: 12_000 };
  const nanGeo = { geoAltitudeM: Number.NaN };

  for (const contact of [missing, empty, grounded, cruising, nanGeo]) {
    assert.equal(passesHideNoGeoAltitudeFilter({ ...contact, hideNoGeoAltitude: false }), true,
      'off keeps missing geo');
  }

  const chip = hideNoGeoAltitudeChipModel(false);
  assert.equal(chip.label, HIDE_NO_GEO_ALTITUDE_CHIP_LABEL);
  assert.equal(chip.id, HIDE_NO_GEO_ALTITUDE_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoGeoAltitude: true });
  assert.deepEqual(hideNoGeoAltitudeChipModel(true).params, { hideNoGeoAltitude: false });
});

test('on keeps 0 and drops missing / null / NaN', () => {
  const missing = emptyBillboard();
  const grounded = emptyBillboard();
  const cruising = emptyBillboard();
  const empty = emptyBillboard();
  const nanGeo = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'a1b2c3',
    meta: {
      geoAltitudeM: undefined,
      altitude: 12_000,
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
    icao24: 'gnd0000',
    meta: {
      geoAltitudeM: 0,
      altitude: 0,
      velocity: 0,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'N000',
      registration: 'N000AA',
      klass: 'airliner',
      onGround: true,
    },
    billboard: grounded,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'cruise1',
    meta: {
      geoAltitudeM: 12_000,
      altitude: 12_000,
      velocity: 200,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'UAL100',
      registration: 'N100UA',
      klass: 'airliner',
      onGround: false,
    },
    billboard: cruising,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'empty01',
    meta: {
      geoAltitudeM: null,
      altitude: 12_000,
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
      geoAltitudeM: Number.NaN,
      altitude: 12_000,
      velocity: 200,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'NAN1',
      registration: 'N1NAN',
      klass: 'airliner',
      onGround: false,
    },
    billboard: nanGeo,
  });
  try {
    assert.equal(flightsLayer.getParams().hideNoGeoAltitude, false);
    assert.equal(missing.show, true);
    assert.equal(grounded.show, true);
    assert.equal(cruising.show, true);
    assert.equal(empty.show, true);
    assert.equal(nanGeo.show, true);

    assert.equal(flightsLayer.setParams({ hideNoGeoAltitude: true }), true);
    assert.equal(flightsLayer.getParams().hideNoGeoAltitude, true);
    assert.equal(missing.show, false, 'undefined geoAltitudeM hides');
    assert.equal(grounded.show, true, '0 stays (on-ground / sea-level)');
    assert.equal(cruising.show, true, 'finite geoAltitudeM stays');
    assert.equal(empty.show, false, 'null geoAltitudeM hides');
    assert.equal(nanGeo.show, false, 'NaN geoAltitudeM hides');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: { klass: 'airliner', onGround: false, altitude: 12_000 },
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().hideNoGeoAltitude, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(grounded.show, true);
    assert.equal(cruising.show, true);

    flightsLayer.setParams({ hideNoGeoAltitude: false });
    assert.equal(missing.show, true);
    assert.equal(empty.show, true);
    assert.equal(nanGeo.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetHideNoGeoAltitudeLayers();
  }
});

test('selected / tracked always kept', () => {
  const selected = emptyBillboard();
  const otherEmpty = emptyBillboard();
  const cruising = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: {
      geoAltitudeM: null,
      altitude: 12_000,
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
      geoAltitudeM: undefined,
      altitude: 12_000,
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
    icao24: 'cruise1',
    meta: {
      geoAltitudeM: 12_000,
      altitude: 12_000,
      velocity: 200,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'UAL100',
      registration: 'N100UA',
      klass: 'airliner',
      onGround: false,
    },
    billboard: cruising,
  });
  try {
    flightsLayer.setParams({ hideNoGeoAltitude: true });
    assert.equal(selected.show, true, 'tracked missing-geo contact stays');
    assert.equal(otherEmpty.show, false);
    assert.equal(cruising.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked missing-geo hides');
    assert.equal(cruising.show, true);
  } finally {
    resetHideNoGeoAltitudeLayers();
  }
});

test('Hide no geo altitude ANDs with 95/166/188/203/214/222/227/234/244/255 and stays distinct from Plan 93 aviation alt-band', () => {
  const lowAviation = emptyBillboard();
  const highGeo = emptyBillboard();
  const highMissingGeo = emptyBillboard();
  const groundedZero = emptyBillboard();
  const registrationOnly = emptyBillboard();
  const emergencyGeo = emptyBillboard();
  const typedMissingGeo = emptyBillboard();
  const emptyCallsignGeo = emptyBillboard();
  const headedMissingGeo = emptyBillboard();
  const countryMissingGeo = emptyBillboard();
  const speedMissingGeo = emptyBillboard();
  const speedOnlyMissingGeo = emptyBillboard();
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
      geoAltitudeM: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: highGeo,
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
      geoAltitudeM: 2000,
      velocity: 80,
      verticalRate: 8,
    },
    billboard: lowAviation,
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
      geoAltitudeM: null,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: highMissingGeo,
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
    billboard: emergencyGeo,
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
      geoAltitudeM: null,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: typedMissingGeo,
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
    billboard: emptyCallsignGeo,
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
      geoAltitudeM: null,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: headedMissingGeo,
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
      geoAltitudeM: null,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: countryMissingGeo,
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
    billboard: speedMissingGeo,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andsp2',
    meta: {
      originCountry: 'United States',
      true_track: 270,
      callsign: 'SP2X',
      registration: 'N2SPD',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      geoAltitudeM: null,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: speedOnlyMissingGeo,
  });
  try {
    flightsLayer.setParams({
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
    });
    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highGeo.show, true, 'Plan 93: high aviation altitude stays');
    assert.equal(lowAviation.show, false, 'Plan 93: low aviation altitude hides');
    assert.equal(highMissingGeo.show, true, 'Plan 93 uses aviation altitude, not geo — missing geo stays');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ hideNoGeoAltitude: true });
    assert.equal(highGeo.show, true);
    assert.equal(lowAviation.show, true, 'finite 2000 m geo stays — Hide no geo altitude is not an alt-band');
    assert.equal(groundedZero.show, true, '0 stays — real on-ground / sea-level geo height');
    assert.equal(highMissingGeo.show, false, 'null geoAltitudeM hides while Plan 93 stays on aviation altitude');
    assert.equal(registrationOnly.show, true, 'geo-bearing registration-only stays — not Identified only');
    assert.equal(emergencyGeo.show, true, 'geo-bearing 7700 stays — Hide no geo altitude is not Emergencies only');
    assert.equal(typedMissingGeo.show, false, 'typed but missing geo still hides');
    assert.equal(headedMissingGeo.show, false, 'headed but missing geo still hides');
    assert.equal(countryMissingGeo.show, false, 'country-bearing but missing geo still hides');
    assert.equal(emptyCallsignGeo.show, true, 'geo-bearing empty-callsign stays until 227 is on');
    assert.equal(speedMissingGeo.show, true, 'geo-bearing missing-speed stays — not Hide no speed');
    assert.equal(speedOnlyMissingGeo.show, false, 'speed-bearing missing-geo hides — distinct from Plan 255');

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(highGeo.show, true);
    assert.equal(groundedZero.show, false, 'AND: grounded zero-geo contact hides under airborne-only');

    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highGeo.show, true, 'AND: in-band geo-bearing remains');
    assert.equal(lowAviation.show, false, 'AND: geo-bearing but out-of-aviation-band hides');
    assert.equal(highMissingGeo.show, false, 'AND: missing geo still hides under Plan 93 + 261');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ airborneOnly: false, callsignPrefixes: 'UAL' });
    assert.equal(highGeo.show, true, 'AND: matching geo-bearing remains');
    assert.equal(groundedZero.show, false, 'AND: prefix still hides a non-UAL geo-bearing');

    flightsLayer.setParams({ callsignPrefixes: '', aircraftClassFilter: 'airliner' });
    assert.equal(highGeo.show, true);
    assert.equal(groundedZero.show, false, 'AND: class chip still hides a helo geo-bearing');

    flightsLayer.setParams({ aircraftClassFilter: 'all', showClimb: false, showLevel: true, showDescent: true });
    assert.equal(highGeo.show, true, 'AND: level geo-bearing remains');
    assert.equal(lowAviation.show, false, 'AND: climbing geo-bearing hides when climb is off');

    flightsLayer.setParams({ showClimb: true, identifiedOnly: true });
    assert.equal(highGeo.show, true);
    assert.equal(registrationOnly.show, true, 'Identified only keeps geo-bearing registration-only');
    assert.equal(highMissingGeo.show, false, 'AND: Hide no geo altitude still drops missing geo');

    flightsLayer.setParams({ hideNoGeoAltitude: false });
    assert.equal(highMissingGeo.show, true, 'Identified only keeps missing-geo when Hide no geo altitude is off');

    flightsLayer.setParams({ hideNoGeoAltitude: true, identifiedOnly: false, emergenciesOnly: true });
    assert.equal(emergencyGeo.show, true, 'AND: Emergencies only keeps geo-bearing 7700');
    assert.equal(highGeo.show, false, 'AND: Emergencies only hides geo-bearing 1200');

    flightsLayer.setParams({ emergenciesOnly: false, hideNoSquawk: true });
    assert.equal(highGeo.show, true, 'AND: geo-bearing 1200 stays under Hide no squawk');
    assert.equal(highMissingGeo.show, false, 'AND: missing geo still hides');

    flightsLayer.setParams({ hideNoSquawk: false, hideNoType: true });
    assert.equal(highGeo.show, true, 'AND: geo-bearing typed stays under Hide no type');
    assert.equal(typedMissingGeo.show, false, 'AND: typed missing-geo still hides');
    assert.equal(highMissingGeo.show, false);

    flightsLayer.setParams({ hideNoType: false, hideNoReg: true });
    assert.equal(highGeo.show, true, 'AND: geo-bearing registered stays under Hide no registration');
    assert.equal(highMissingGeo.show, false);

    flightsLayer.setParams({ hideNoReg: false, hideNoCallsign: true });
    assert.equal(highGeo.show, true, 'AND: geo-bearing callsigned stays under Hide no callsign');
    assert.equal(emptyCallsignGeo.show, false, 'AND: Hide no callsign still drops geo-bearing empty-callsign');
    assert.equal(highMissingGeo.show, false);

    flightsLayer.setParams({ hideNoCallsign: false, hideNoHeading: true });
    assert.equal(highGeo.show, true, 'AND: geo-bearing headed stays under Hide no heading');
    assert.equal(headedMissingGeo.show, false, 'AND: headed missing-geo still hides');
    assert.equal(highMissingGeo.show, false);

    flightsLayer.setParams({ hideNoHeading: false, hideNoCountry: true });
    assert.equal(highGeo.show, true, 'AND: geo-bearing country stays under Hide no country');
    assert.equal(countryMissingGeo.show, false, 'AND: country-bearing missing-geo still hides');
    assert.equal(highMissingGeo.show, false);

    flightsLayer.setParams({ hideNoCountry: false, hideNoSpeed: true });
    assert.equal(highGeo.show, true, 'AND: geo-bearing speed stays under Hide no speed');
    assert.equal(speedMissingGeo.show, false, 'AND: Hide no speed still drops geo-bearing missing-speed');
    assert.equal(speedOnlyMissingGeo.show, false, 'AND: speed-bearing missing-geo still hides');
    assert.equal(highMissingGeo.show, false);
  } finally {
    resetHideNoGeoAltitudeLayers();
  }
});

test('invalid storage reads as off', () => {
  resetHideNoGeoAltitudeForTest();
  assert.equal(HIDE_NO_GEO_ALTITUDE_STORAGE_KEY, 'meridian.flightHideNoGeoAltitude');
  assert.equal(readHideNoGeoAltitudeEnabled(memoryStorage()), false);
  assert.equal(readHideNoGeoAltitudeEnabled(memoryStorage({ 'meridian.flightHideNoGeoAltitude': 'nope' })), false);
  assert.equal(readHideNoGeoAltitudeEnabled(memoryStorage({ 'meridian.flightHideNoGeoAltitude': 'yes' })), false);
  assert.equal(readHideNoGeoAltitudeEnabled({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');
});

test('persist flip survives reload', () => {
  resetHideNoGeoAltitudeForTest();
  const storage = memoryStorage();
  assert.equal(writeHideNoGeoAltitudeEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightHideNoGeoAltitude': '1' });
  assert.equal(readHideNoGeoAltitudeEnabled(storage), true);
  assert.equal(writeHideNoGeoAltitudeEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightHideNoGeoAltitude'], '0');

  const seen = [];
  const unsubscribe = subscribeHideNoGeoAltitudeEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getHideNoGeoAltitudeEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightHideNoGeoAltitude': '1' });
    assert.equal(hydrateHideNoGeoAltitudeEnabled(hydrated), true);
    assert.equal(getHideNoGeoAltitudeEnabled(), true);
    assert.equal(setHideNoGeoAltitudeEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightHideNoGeoAltitude'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetHideNoGeoAltitudeForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(Object.hasOwn(defaults, 'hideNoGeoAltitude'), false, 'not a share-URL option');
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(Object.hasOwn(omitted.options.flights, 'hideNoGeoAltitude'), false);

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { hideNoGeoAltitude: true } },
  }));
  assert.doesNotMatch(String(encodedOn.get('lo') || ''), /hideNoGeoAltitude/);
  const encodedOff = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: {} },
  }));
  assert.equal(String(encodedOn.get('lo') || ''), String(encodedOff.get('lo') || ''),
    'no share-URL write');

  hydrateHideNoGeoAltitudeEnabled(memoryStorage({ 'meridian.flightHideNoGeoAltitude': '1' }));
  flightsLayer.setParams({ airborneOnly: false, identifiedOnly: false, emergenciesOnly: false });
  assert.equal(getHideNoGeoAltitudeEnabled(), true, 'coordinator-style restore keeps the flip');
  assert.equal(flightsLayer.getParams().hideNoGeoAltitude, true);

  flightsLayer.setParams({ hideNoGeoAltitude: false });
  assert.equal(flightsLayer.getParams().hideNoGeoAltitude, false);
  flightsLayer.setParams({ hideNoGeoAltitude: true });
  assert.equal(flightsLayer.getParams().hideNoGeoAltitude, true);
  const chips = flightsLayer.getRowControls().chips;
  const chip = chips.find((entry) => entry.id === HIDE_NO_GEO_ALTITUDE_CHIP_ID);
  const speedIdx = chips.findIndex((entry) => entry.id === 'hide-no-speed');
  const geoIdx = chips.findIndex((entry) => entry.id === HIDE_NO_GEO_ALTITUDE_CHIP_ID);
  assert.equal(chip.label, HIDE_NO_GEO_ALTITUDE_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { hideNoGeoAltitude: false });
  assert.ok(speedIdx >= 0 && geoIdx === speedIdx + 1, 'Hide no geo altitude sits next to Hide no speed');
  flightsLayer.setParams({ hideNoGeoAltitude: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_GEO_ALTITUDE_CHIP_ID).active, false);
  resetHideNoGeoAltitudeForTest();
});

test('militaryFlights.js and aisLiveVessels.js are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const style = root('style.css');
  const flights = data('flights.js');
  const helper = data('flightHideNoGeoAltitudeFilter.js');
  const military = data('militaryFlights.js');
  const ais = data('aisLiveVessels.js');
  const adapter = data('adsbLolFallback.js');
  const manager = data('manager.js');
  assert.doesNotMatch(html, /hide-no-geo-altitude|Hide no geo altitude/);
  assert.doesNotMatch(ui, /hideNoGeoAltitude|_initHideNoGeoAltitude/);
  assert.doesNotMatch(style, /hide-no-geo-altitude|hideNoGeoAltitude/);
  assert.match(flights, /hideNoGeoAltitudeChipModel\(/);
  assert.match(flights, /passesHideNoGeoAltitudeFilter/);
  assert.match(flights, /_hideNoGeoAltitudeMatcher/);
  assert.match(flights, /const geoAltitudeM = Number\.isFinite\(geo_alt\) \? geo_alt : null;/);
  assert.doesNotMatch(flights, /geoAltitudeM: stickyNumber/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /hideNoGeoAltitude|hide-no-geo-altitude|flightHideNoGeoAltitudeFilter/);
  assert.doesNotMatch(ais, /flightHideNoGeoAltitudeFilter|meridian\.flightHideNoGeoAltitude/);
  assert.doesNotMatch(adapter, /hideNoGeoAltitude|hide-no-geo-altitude|flightHideNoGeoAltitudeFilter/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.doesNotMatch(helper, /OpenSky|opensky/i);
  assert.match(helper, /geoAltitudeM/);
  assert.match(helper, /meridian\.flightHideNoGeoAltitude/);
  assert.match(helper, /not written into the share URL/);
  assert.match(helper, /Plan 93 altitude-band/);
  assert.match(helper, /not sticky/);
});

test('legal: already-fetched geoAltitudeM only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightHideNoGeoAltitudeFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth|OpenSky|opensky/i);
  assert.match(moduleSource, /geoAltitudeM/);
});
