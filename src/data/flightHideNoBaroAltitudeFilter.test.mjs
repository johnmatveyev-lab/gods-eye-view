import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  HIDE_NO_BARO_ALTITUDE_CHIP_ID,
  HIDE_NO_BARO_ALTITUDE_CHIP_LABEL,
  HIDE_NO_BARO_ALTITUDE_DEFAULT,
  HIDE_NO_BARO_ALTITUDE_STORAGE_KEY,
  baroAltitudeFieldM,
  contactHasBaroAltitude,
  getHideNoBaroAltitudeEnabled,
  hideNoBaroAltitudeChipModel,
  hydrateHideNoBaroAltitudeEnabled,
  normalizeHideNoBaroAltitude,
  passesHideNoBaroAltitudeFilter,
  readHideNoBaroAltitudeEnabled,
  resetHideNoBaroAltitudeForTest,
  setHideNoBaroAltitudeEnabled,
  subscribeHideNoBaroAltitudeEnabled,
  writeHideNoBaroAltitudeEnabled,
} from './flightHideNoBaroAltitudeFilter.js';
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

function resetHideNoBaroAltitudeLayers() {
  resetHideNoBaroAltitudeForTest();
  setHeadingSectors('NESW');
  flightsLayer.setParams({
    hideNoBaroAltitude: false,
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

test('off keeps missing / non-finite baro', () => {
  assert.equal(HIDE_NO_BARO_ALTITUDE_DEFAULT, false);
  assert.equal(HIDE_NO_BARO_ALTITUDE_STORAGE_KEY, 'meridian.flightHideNoBaroAltitude');
  assert.equal(normalizeHideNoBaroAltitude(undefined), false);
  assert.equal(normalizeHideNoBaroAltitude(null), false);
  assert.equal(normalizeHideNoBaroAltitude('nope'), false);
  assert.equal(normalizeHideNoBaroAltitude(false), false);
  assert.equal(normalizeHideNoBaroAltitude(true), true);
  assert.equal(normalizeHideNoBaroAltitude('1'), true);

  assert.equal(baroAltitudeFieldM(undefined), null);
  assert.equal(baroAltitudeFieldM(null), null);
  assert.equal(baroAltitudeFieldM(Number.NaN), null);
  assert.equal(baroAltitudeFieldM(Number.POSITIVE_INFINITY), null);
  assert.equal(baroAltitudeFieldM(0), 0);
  assert.equal(baroAltitudeFieldM(10_000), 10_000);

  assert.equal(contactHasBaroAltitude({ altitude: 0 }), true);
  assert.equal(contactHasBaroAltitude({ altitude: 10_000 }), true);
  assert.equal(contactHasBaroAltitude({ altitudeM: 0 }), true);
  assert.equal(contactHasBaroAltitude({ altitudeM: 10_000 }), true);
  assert.equal(contactHasBaroAltitude({ altitude: null }), false);
  assert.equal(contactHasBaroAltitude({ altitude: undefined }), false);
  assert.equal(contactHasBaroAltitude({ altitude: Number.NaN }), false);
  assert.equal(contactHasBaroAltitude({}), false);

  const missing = {};
  const empty = { altitude: null };
  const grounded = { altitude: 0 };
  const cruising = { altitude: 10_000 };
  const nanBaro = { altitude: Number.NaN };
  const alias = { altitudeM: 10_000 };

  for (const contact of [missing, empty, grounded, cruising, nanBaro, alias]) {
    assert.equal(passesHideNoBaroAltitudeFilter({ ...contact, hideNoBaroAltitude: false }), true,
      'off keeps missing / non-finite baro');
  }

  const chip = hideNoBaroAltitudeChipModel(false);
  assert.equal(chip.label, HIDE_NO_BARO_ALTITUDE_CHIP_LABEL);
  assert.equal(chip.id, HIDE_NO_BARO_ALTITUDE_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoBaroAltitude: true });
  assert.deepEqual(hideNoBaroAltitudeChipModel(true).params, { hideNoBaroAltitude: false });
});

test('on hides missing / non-finite baro and keeps 0 and 10000 m', () => {
  const missing = emptyBillboard();
  const grounded = emptyBillboard();
  const cruising = emptyBillboard();
  const empty = emptyBillboard();
  const nanBaro = emptyBillboard();
  const alias = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'a1b2c3',
    meta: {
      altitude: undefined,
      geoAltitudeM: 10_000,
      verticalRate: 0,
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
      altitude: 0,
      geoAltitudeM: 0,
      verticalRate: 0,
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
      altitude: 10_000,
      geoAltitudeM: 10_000,
      verticalRate: 0,
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
      altitude: null,
      geoAltitudeM: 10_000,
      verticalRate: 0,
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
      altitude: Number.NaN,
      geoAltitudeM: 10_000,
      verticalRate: 0,
      velocity: 200,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'NAN1',
      registration: 'N1NAN',
      klass: 'airliner',
      onGround: false,
    },
    billboard: nanBaro,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'alias01',
    meta: {
      altitudeM: 10_000,
      geoAltitudeM: 10_000,
      verticalRate: 0,
      velocity: 200,
      true_track: 270,
      originCountry: 'United States',
      callsign: 'ALS1',
      registration: 'N1ALS',
      klass: 'airliner',
      onGround: false,
    },
    billboard: alias,
  });
  try {
    assert.equal(flightsLayer.getParams().hideNoBaroAltitude, false);
    assert.equal(missing.show, true);
    assert.equal(grounded.show, true);
    assert.equal(cruising.show, true);
    assert.equal(empty.show, true);
    assert.equal(nanBaro.show, true);
    assert.equal(alias.show, true);

    assert.equal(flightsLayer.setParams({ hideNoBaroAltitude: true }), true);
    assert.equal(flightsLayer.getParams().hideNoBaroAltitude, true);
    assert.equal(missing.show, false, 'undefined altitude hides');
    assert.equal(grounded.show, true, '0 stays (on-ground / sea-level baro)');
    assert.equal(cruising.show, true, '10000 m stays');
    assert.equal(empty.show, false, 'null altitude hides');
    assert.equal(nanBaro.show, false, 'NaN altitude hides');
    assert.equal(alias.show, true, 'finite altitudeM stays');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: { klass: 'airliner', onGround: false, geoAltitudeM: 10_000 },
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().hideNoBaroAltitude, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(grounded.show, true);
    assert.equal(cruising.show, true);

    flightsLayer.setParams({ hideNoBaroAltitude: false });
    assert.equal(missing.show, true);
    assert.equal(empty.show, true);
    assert.equal(nanBaro.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetHideNoBaroAltitudeLayers();
  }
});

test('selected / tracked always kept', () => {
  const selected = emptyBillboard();
  const otherEmpty = emptyBillboard();
  const cruising = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: {
      altitude: null,
      geoAltitudeM: 10_000,
      verticalRate: 0,
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
      altitude: undefined,
      geoAltitudeM: 10_000,
      verticalRate: 0,
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
      altitude: 10_000,
      geoAltitudeM: 10_000,
      verticalRate: 0,
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
    flightsLayer.setParams({ hideNoBaroAltitude: true });
    assert.equal(selected.show, true, 'tracked missing-baro contact stays');
    assert.equal(otherEmpty.show, false);
    assert.equal(cruising.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked missing-baro hides');
    assert.equal(cruising.show, true);
  } finally {
    resetHideNoBaroAltitudeLayers();
  }
});

test('Hide no baro altitude ANDs with geo / vertical rate / speed / country / heading / airborne-only and stays distinct from Plan 93 / 261 / 268 / hide-ground', () => {
  const lowBaro = emptyBillboard();
  const highBaro = emptyBillboard();
  const missingBaro = emptyBillboard();
  const groundedZero = emptyBillboard();
  const geoOnlyMissingBaro = emptyBillboard();
  const baroOnlyMissingGeo = emptyBillboard();
  const rateOnlyMissingBaro = emptyBillboard();
  const baroOnlyMissingRate = emptyBillboard();
  const headedMissingBaro = emptyBillboard();
  const countryMissingBaro = emptyBillboard();
  const speedMissingBaro = emptyBillboard();
  const speedOnlyMissingBaro = emptyBillboard();
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
      altitude: 10_000,
      geoAltitudeM: 10_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: highBaro,
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
    billboard: lowBaro,
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
      altitude: null,
      geoAltitudeM: 10_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: missingBaro,
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
      altitude: null,
      geoAltitudeM: 10_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: geoOnlyMissingBaro,
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
      altitude: 10_000,
      geoAltitudeM: null,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: baroOnlyMissingGeo,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andrate',
    meta: {
      originCountry: 'United States',
      true_track: 270,
      callsign: 'RTE9',
      registration: 'N9RTE',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: null,
      geoAltitudeM: 10_000,
      velocity: 200,
      verticalRate: 5,
    },
    billboard: rateOnlyMissingBaro,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andr2',
    meta: {
      originCountry: 'United States',
      true_track: 270,
      callsign: 'R2XX',
      registration: 'N2RTE',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 10_000,
      geoAltitudeM: 10_000,
      velocity: 200,
      verticalRate: null,
    },
    billboard: baroOnlyMissingRate,
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
      altitude: null,
      geoAltitudeM: 10_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: headedMissingBaro,
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
      altitude: null,
      geoAltitudeM: 10_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: countryMissingBaro,
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
      altitude: 10_000,
      geoAltitudeM: 10_000,
      velocity: null,
      verticalRate: 0,
    },
    billboard: speedMissingBaro,
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
      altitude: null,
      geoAltitudeM: 10_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: speedOnlyMissingBaro,
  });
  try {
    flightsLayer.setParams({
      hideNoBaroAltitude: false,
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
    });
    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highBaro.show, true, 'Plan 93: high aviation altitude stays');
    assert.equal(lowBaro.show, false, 'Plan 93: low aviation altitude hides');
    assert.equal(missingBaro.show, false, 'Plan 93 named band fail-closes missing baro');

    setAltitudeBand('all', { persist: false });
    assert.equal(missingBaro.show, true, 'Plan 93 All pass-through: missing baro stays');
    assert.equal(lowBaro.show, true, 'Plan 93 All keeps 2000 m');

    flightsLayer.setParams({ hideNoBaroAltitude: true });
    assert.equal(highBaro.show, true, '10000 m stays — not an altitude-band chip');
    assert.equal(lowBaro.show, true, 'finite 2000 m baro stays — Hide no baro altitude is not an alt-band');
    assert.equal(groundedZero.show, true, '0 stays — real on-ground / sea-level baro, not hide-ground');
    assert.equal(missingBaro.show, false, 'null altitude hides while Plan 93 All would keep it');
    assert.equal(geoOnlyMissingBaro.show, false, 'geo-bearing missing-baro hides — distinct from Plan 261');
    assert.equal(baroOnlyMissingGeo.show, true, 'baro-bearing missing-geo stays — not Hide no geo');
    assert.equal(rateOnlyMissingBaro.show, false, 'rate-bearing missing-baro hides — distinct from Plan 268');
    assert.equal(baroOnlyMissingRate.show, true, 'baro-bearing missing-rate stays — not Hide no vertical rate');
    assert.equal(headedMissingBaro.show, false, 'headed but missing baro still hides');
    assert.equal(countryMissingBaro.show, false, 'country-bearing but missing baro still hides');
    assert.equal(speedMissingBaro.show, true, 'baro-bearing missing-speed stays — not Hide no speed');
    assert.equal(speedOnlyMissingBaro.show, false, 'speed-bearing missing-baro hides');

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(highBaro.show, true);
    assert.equal(groundedZero.show, false, 'AND: grounded zero-baro contact hides under airborne-only');

    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highBaro.show, true, 'AND: in-band baro-bearing remains');
    assert.equal(lowBaro.show, false, 'AND: baro-bearing but out-of-aviation-band hides');
    assert.equal(missingBaro.show, false, 'AND: missing baro still hides under Plan 93 + 274');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ airborneOnly: false, hideNoHeading: true });
    assert.equal(highBaro.show, true, 'AND: baro-bearing headed stays under Hide no heading');
    assert.equal(headedMissingBaro.show, false, 'AND: headed missing-baro still hides');

    flightsLayer.setParams({ hideNoHeading: false, hideNoCountry: true });
    assert.equal(highBaro.show, true, 'AND: baro-bearing country stays under Hide no country');
    assert.equal(countryMissingBaro.show, false, 'AND: country-bearing missing-baro still hides');

    flightsLayer.setParams({ hideNoCountry: false, hideNoSpeed: true });
    assert.equal(highBaro.show, true, 'AND: baro-bearing speed stays under Hide no speed');
    assert.equal(speedMissingBaro.show, false, 'AND: Hide no speed still drops baro-bearing missing-speed');
    assert.equal(speedOnlyMissingBaro.show, false, 'AND: speed-bearing missing-baro still hides');

    flightsLayer.setParams({ hideNoSpeed: false, hideNoGeoAltitude: true });
    assert.equal(highBaro.show, true, 'AND: baro-bearing geo stays under Hide no geo altitude');
    assert.equal(baroOnlyMissingGeo.show, false, 'AND: Hide no geo altitude still drops baro-bearing missing-geo');
    assert.equal(geoOnlyMissingBaro.show, false, 'AND: geo-bearing missing-baro still hides');
    assert.equal(missingBaro.show, false);

    flightsLayer.setParams({ hideNoGeoAltitude: false, hideNoVerticalRate: true });
    assert.equal(highBaro.show, true, 'AND: baro-bearing rate stays under Hide no vertical rate');
    assert.equal(baroOnlyMissingRate.show, false, 'AND: Hide no vertical rate still drops baro-bearing missing-rate');
    assert.equal(rateOnlyMissingBaro.show, false, 'AND: rate-bearing missing-baro still hides');
    assert.equal(missingBaro.show, false);
  } finally {
    resetHideNoBaroAltitudeLayers();
  }
});

test('invalid storage reads as off', () => {
  resetHideNoBaroAltitudeForTest();
  assert.equal(HIDE_NO_BARO_ALTITUDE_STORAGE_KEY, 'meridian.flightHideNoBaroAltitude');
  assert.equal(readHideNoBaroAltitudeEnabled(memoryStorage()), false);
  assert.equal(readHideNoBaroAltitudeEnabled(memoryStorage({ 'meridian.flightHideNoBaroAltitude': 'nope' })), false);
  assert.equal(readHideNoBaroAltitudeEnabled(memoryStorage({ 'meridian.flightHideNoBaroAltitude': 'yes' })), false);
  assert.equal(readHideNoBaroAltitudeEnabled({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');
});

test('persist flip survives reload', () => {
  resetHideNoBaroAltitudeForTest();
  const storage = memoryStorage();
  assert.equal(writeHideNoBaroAltitudeEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightHideNoBaroAltitude': '1' });
  assert.equal(readHideNoBaroAltitudeEnabled(storage), true);
  assert.equal(writeHideNoBaroAltitudeEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightHideNoBaroAltitude'], '0');

  const seen = [];
  const unsubscribe = subscribeHideNoBaroAltitudeEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getHideNoBaroAltitudeEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightHideNoBaroAltitude': '1' });
    assert.equal(hydrateHideNoBaroAltitudeEnabled(hydrated), true);
    assert.equal(getHideNoBaroAltitudeEnabled(), true);
    assert.equal(setHideNoBaroAltitudeEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightHideNoBaroAltitude'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetHideNoBaroAltitudeForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(Object.hasOwn(defaults, 'hideNoBaroAltitude'), false, 'not a share-URL option');
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(Object.hasOwn(omitted.options.flights, 'hideNoBaroAltitude'), false);

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { hideNoBaroAltitude: true } },
  }));
  assert.doesNotMatch(String(encodedOn.get('lo') || ''), /hideNoBaroAltitude/);
  const encodedOff = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: {} },
  }));
  assert.equal(String(encodedOn.get('lo') || ''), String(encodedOff.get('lo') || ''),
    'no share-URL write');

  hydrateHideNoBaroAltitudeEnabled(memoryStorage({ 'meridian.flightHideNoBaroAltitude': '1' }));
  flightsLayer.setParams({ airborneOnly: false, identifiedOnly: false, emergenciesOnly: false });
  assert.equal(getHideNoBaroAltitudeEnabled(), true, 'coordinator-style restore keeps the flip');
  assert.equal(flightsLayer.getParams().hideNoBaroAltitude, true);

  flightsLayer.setParams({ hideNoBaroAltitude: false });
  assert.equal(flightsLayer.getParams().hideNoBaroAltitude, false);
  flightsLayer.setParams({ hideNoBaroAltitude: true });
  assert.equal(flightsLayer.getParams().hideNoBaroAltitude, true);
  const chips = flightsLayer.getRowControls().chips;
  const chip = chips.find((entry) => entry.id === HIDE_NO_BARO_ALTITUDE_CHIP_ID);
  const geoIdx = chips.findIndex((entry) => entry.id === 'hide-no-geo-altitude');
  const baroIdx = chips.findIndex((entry) => entry.id === HIDE_NO_BARO_ALTITUDE_CHIP_ID);
  assert.equal(chip.label, HIDE_NO_BARO_ALTITUDE_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { hideNoBaroAltitude: false });
  assert.ok(geoIdx >= 0 && baroIdx === geoIdx + 1, 'Hide no baro altitude sits next to Hide no geo altitude');
  flightsLayer.setParams({ hideNoBaroAltitude: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_BARO_ALTITUDE_CHIP_ID).active, false);
  resetHideNoBaroAltitudeForTest();
});

test('militaryFlights.js and stay-off layers are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const style = root('style.css');
  const flights = data('flights.js');
  const helper = data('flightHideNoBaroAltitudeFilter.js');
  const military = data('militaryFlights.js');
  const ais = data('aisLiveVessels.js');
  const adapter = data('adsbLolFallback.js');
  const awareness = data('militaryAwareness.js');
  const launchesPanel = data('launchesPanel.js');
  const rocketLaunches = data('rocketLaunches.js');
  const firmsHeatmap = data('firmsHeatmap.js');
  const firmsList = data('firmsList.js');
  const damsList = data('damsList.js');
  const datacenterList = data('datacenterList.js');
  const localGeojson = data('localGeojson.js');
  const manager = data('manager.js');
  assert.doesNotMatch(html, /hide-no-baro-altitude|Hide no baro altitude/);
  assert.doesNotMatch(ui, /hideNoBaroAltitude|_initHideNoBaroAltitude/);
  assert.doesNotMatch(style, /hide-no-baro-altitude|hideNoBaroAltitude/);
  assert.match(flights, /hideNoBaroAltitudeChipModel\(/);
  assert.match(flights, /passesHideNoBaroAltitudeFilter/);
  assert.match(flights, /_hideNoBaroAltitudeMatcher/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /hideNoBaroAltitude|hide-no-baro-altitude|flightHideNoBaroAltitudeFilter/);
  assert.doesNotMatch(ais, /flightHideNoBaroAltitudeFilter|meridian\.flightHideNoBaroAltitude/);
  assert.doesNotMatch(adapter, /hideNoBaroAltitude|hide-no-baro-altitude|flightHideNoBaroAltitudeFilter/);
  assert.doesNotMatch(awareness, /hideNoBaroAltitude|flightHideNoBaroAltitudeFilter/);
  assert.doesNotMatch(launchesPanel, /hideNoBaroAltitude|flightHideNoBaroAltitudeFilter/);
  assert.doesNotMatch(rocketLaunches, /hideNoBaroAltitude|flightHideNoBaroAltitudeFilter/);
  assert.doesNotMatch(firmsHeatmap, /hideNoBaroAltitude|flightHideNoBaroAltitudeFilter/);
  assert.doesNotMatch(firmsList, /hideNoBaroAltitude|flightHideNoBaroAltitudeFilter/);
  assert.doesNotMatch(damsList, /hideNoBaroAltitude|flightHideNoBaroAltitudeFilter/);
  assert.doesNotMatch(datacenterList, /hideNoBaroAltitude|flightHideNoBaroAltitudeFilter/);
  assert.doesNotMatch(localGeojson, /hideNoBaroAltitude|flightHideNoBaroAltitudeFilter/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.doesNotMatch(helper, /OpenSky|opensky/i);
  assert.match(helper, /altitudeM/);
  assert.match(helper, /meridian\.flightHideNoBaroAltitude/);
  assert.match(helper, /not written into the share URL/);
  assert.match(helper, /Plan 93 altitude-band/);
  assert.match(helper, /Hide no geo altitude \(Plan 261/);
  assert.match(helper, /Hide no vertical rate \(Plan 268/);
});

test('legal: already-fetched altitude / altitudeM only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightHideNoBaroAltitudeFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth|OpenSky|opensky/i);
  assert.match(moduleSource, /altitudeM/);
});
