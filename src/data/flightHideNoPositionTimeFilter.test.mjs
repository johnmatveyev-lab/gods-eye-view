import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  HIDE_NO_POSITION_TIME_CHIP_ID,
  HIDE_NO_POSITION_TIME_CHIP_LABEL,
  HIDE_NO_POSITION_TIME_DEFAULT,
  HIDE_NO_POSITION_TIME_STORAGE_KEY,
  contactHasPositionTime,
  getHideNoPositionTimeEnabled,
  hideNoPositionTimeChipModel,
  hydrateHideNoPositionTimeEnabled,
  normalizeHideNoPositionTime,
  passesHideNoPositionTimeFilter,
  positionEpochMsField,
  readHideNoPositionTimeEnabled,
  resetHideNoPositionTimeForTest,
  setHideNoPositionTimeEnabled,
  subscribeHideNoPositionTimeEnabled,
  writeHideNoPositionTimeEnabled,
} from './flightHideNoPositionTimeFilter.js';
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

const FIX_AT = 1_724_000_000_000;

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

function resetHideNoPositionTimeLayers() {
  resetHideNoPositionTimeForTest();
  setHeadingSectors('NESW');
  flightsLayer.setParams({
    hideNoPositionTime: false,
    hideNoCategory: false,
    hideNoLastContact: false,
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

function liveMeta(extra = {}) {
  return {
    altitude: 10_000,
    geoAltitudeM: 10_000,
    verticalRate: 0,
    velocity: 200,
    true_track: 270,
    originCountry: 'United States',
    callsign: 'UAL100',
    registration: 'N100UA',
    typeCode: 'B738',
    squawk: '1200',
    klass: 'airliner',
    onGround: false,
    lastContactEpochMs: FIX_AT,
    category: 6,
    positionEpochMs: FIX_AT,
    ...extra,
  };
}

test('off keeps missing / non-finite / ≤0 positionEpochMs', () => {
  assert.equal(HIDE_NO_POSITION_TIME_DEFAULT, false);
  assert.equal(HIDE_NO_POSITION_TIME_STORAGE_KEY, 'meridian.flightHideNoPositionTime');
  assert.equal(normalizeHideNoPositionTime(undefined), false);
  assert.equal(normalizeHideNoPositionTime(null), false);
  assert.equal(normalizeHideNoPositionTime('nope'), false);
  assert.equal(normalizeHideNoPositionTime(false), false);
  assert.equal(normalizeHideNoPositionTime(true), true);
  assert.equal(normalizeHideNoPositionTime('1'), true);

  assert.equal(positionEpochMsField(undefined), null);
  assert.equal(positionEpochMsField(null), null);
  assert.equal(positionEpochMsField(Number.NaN), null);
  assert.equal(positionEpochMsField(Number.POSITIVE_INFINITY), null);
  assert.equal(positionEpochMsField(0), null, '0 is a sentinel, not Unix-epoch 0-stays');
  assert.equal(positionEpochMsField(-1), null);
  assert.equal(positionEpochMsField(FIX_AT), FIX_AT);

  assert.equal(contactHasPositionTime({ positionEpochMs: 0 }), false);
  assert.equal(contactHasPositionTime({ positionEpochMs: -5 }), false);
  assert.equal(contactHasPositionTime({ positionEpochMs: FIX_AT }), true);
  assert.equal(contactHasPositionTime({ positionEpochMs: null }), false);
  assert.equal(contactHasPositionTime({ positionEpochMs: undefined }), false);
  assert.equal(contactHasPositionTime({ positionEpochMs: Number.NaN }), false);
  assert.equal(contactHasPositionTime({}), false);

  const missing = {};
  const empty = { positionEpochMs: null };
  const epochZero = { positionEpochMs: 0 };
  const epochNeg = { positionEpochMs: -1000 };
  const fixed = { positionEpochMs: FIX_AT };
  const nanEpoch = { positionEpochMs: Number.NaN };

  for (const contact of [missing, empty, epochZero, epochNeg, fixed, nanEpoch]) {
    assert.equal(passesHideNoPositionTimeFilter({ ...contact, hideNoPositionTime: false }), true,
      'off keeps missing / non-finite / ≤0 positionEpochMs');
  }

  const chip = hideNoPositionTimeChipModel(false);
  assert.equal(chip.label, HIDE_NO_POSITION_TIME_CHIP_LABEL);
  assert.equal(chip.id, HIDE_NO_POSITION_TIME_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoPositionTime: true });
  assert.deepEqual(hideNoPositionTimeChipModel(true).params, { hideNoPositionTime: false });
});

test('on hides missing / non-finite / ≤0 positionEpochMs and keeps finite > 0', () => {
  const missing = emptyBillboard();
  const fixed = emptyBillboard();
  const empty = emptyBillboard();
  const nanEpoch = emptyBillboard();
  const epochZero = emptyBillboard();
  const epochNeg = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'a1b2c3',
    meta: liveMeta({
      callsign: 'UNK1',
      positionEpochMs: undefined,
    }),
    billboard: missing,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'fixed01',
    meta: liveMeta({ callsign: 'UAL100', registration: 'N100UA' }),
    billboard: fixed,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'empty01',
    meta: liveMeta({ callsign: 'NULL1', positionEpochMs: null }),
    billboard: empty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'nan0001',
    meta: liveMeta({ callsign: 'NAN1', registration: 'N1NAN', positionEpochMs: Number.NaN }),
    billboard: nanEpoch,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'epoch00',
    meta: liveMeta({ callsign: 'EPOCH0', registration: 'N0EPC', positionEpochMs: 0 }),
    billboard: epochZero,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'epochng',
    meta: liveMeta({ callsign: 'EPOCHN', registration: 'NNEPC', positionEpochMs: -1 }),
    billboard: epochNeg,
  });
  try {
    assert.equal(flightsLayer.getParams().hideNoPositionTime, false);
    assert.equal(missing.show, true);
    assert.equal(fixed.show, true);
    assert.equal(empty.show, true);
    assert.equal(nanEpoch.show, true);
    assert.equal(epochZero.show, true);
    assert.equal(epochNeg.show, true);

    assert.equal(flightsLayer.setParams({ hideNoPositionTime: true }), true);
    assert.equal(flightsLayer.getParams().hideNoPositionTime, true);
    assert.equal(missing.show, false, 'undefined positionEpochMs hides');
    assert.equal(fixed.show, true, 'finite positionEpochMs > 0 stays');
    assert.equal(empty.show, false, 'null positionEpochMs hides');
    assert.equal(nanEpoch.show, false, 'NaN positionEpochMs hides');
    assert.equal(epochZero.show, false, '0 is a sentinel and hides — not last-contact 0-stays');
    assert.equal(epochNeg.show, false, 'negative positionEpochMs hides');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: liveMeta({ klass: 'airliner', positionEpochMs: undefined }),
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().hideNoPositionTime, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(fixed.show, true);

    flightsLayer.setParams({ hideNoPositionTime: false });
    assert.equal(missing.show, true);
    assert.equal(empty.show, true);
    assert.equal(nanEpoch.show, true);
    assert.equal(epochZero.show, true);
    assert.equal(epochNeg.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetHideNoPositionTimeLayers();
  }
});

test('selected / tracked no-position-time still draws', () => {
  const selected = emptyBillboard();
  const otherEmpty = emptyBillboard();
  const fixed = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: liveMeta({
      callsign: 'SEL1',
      registration: 'N9SEL',
      positionEpochMs: null,
    }),
    billboard: selected,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: true,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'othhex',
    meta: liveMeta({
      callsign: 'OTH1',
      registration: 'N2OTH',
      positionEpochMs: undefined,
    }),
    billboard: otherEmpty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'fixed01',
    meta: liveMeta({ callsign: 'UAL100', registration: 'N100UA' }),
    billboard: fixed,
  });
  try {
    flightsLayer.setParams({ hideNoPositionTime: true });
    assert.equal(selected.show, true, 'tracked missing-position-time stays');
    assert.equal(otherEmpty.show, false);
    assert.equal(fixed.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked missing-position-time hides');
    assert.equal(fixed.show, true);
  } finally {
    resetHideNoPositionTimeLayers();
  }
});

test('Hide no position time ANDs with existing hide-no chips including 280 last contact and 284 category and stays distinct from Plan 93 / 95 / 203 / 214 / 222 / 227 / 234 / 244 / 255 / 261 / 268 / 274 / 280 / 284 / hide-ground', () => {
  const highFixed = emptyBillboard();
  const lowFixed = emptyBillboard();
  const missingPos = emptyBillboard();
  const groundedFixed = emptyBillboard();
  const geoOnlyMissingPos = emptyBillboard();
  const posOnlyMissingGeo = emptyBillboard();
  const rateOnlyMissingPos = emptyBillboard();
  const posOnlyMissingRate = emptyBillboard();
  const headedMissingPos = emptyBillboard();
  const countryMissingPos = emptyBillboard();
  const speedMissingPos = emptyBillboard();
  const speedOnlyMissingPos = emptyBillboard();
  const baroOnlyMissingPos = emptyBillboard();
  const posOnlyMissingBaro = emptyBillboard();
  const heardMissingPos = emptyBillboard();
  const posOnlyMissingContact = emptyBillboard();
  const categorizedMissingPos = emptyBillboard();
  const posOnlyMissingCategory = emptyBillboard();
  const typedMissingPos = emptyBillboard();
  const posOnlyMissingType = emptyBillboard();
  const squawkMissingPos = emptyBillboard();
  const posOnlyMissingSquawk = emptyBillboard();
  const regMissingPos = emptyBillboard();
  const posOnlyMissingReg = emptyBillboard();
  const callsignMissingPos = emptyBillboard();
  const posOnlyMissingCallsign = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'andhigh',
    meta: liveMeta({
      callsign: 'UAL100',
      registration: 'N100UA',
      altitude: 10_000,
      geoAltitudeM: 10_000,
      velocity: 200,
      verticalRate: 0,
    }),
    billboard: highFixed,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andlow',
    meta: liveMeta({
      callsign: 'UAL200',
      registration: 'N200UA',
      true_track: 0,
      altitude: 2000,
      geoAltitudeM: 2000,
      velocity: 80,
      verticalRate: 8,
    }),
    billboard: lowFixed,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhex',
    meta: liveMeta({
      callsign: 'SWA9',
      registration: 'N9SWA',
      positionEpochMs: null,
    }),
    billboard: missingPos,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andpark',
    meta: liveMeta({
      callsign: 'N123AB',
      registration: 'N123AB',
      typeCode: 'EC35',
      klass: 'helicopter',
      onGround: true,
      altitude: 0,
      geoAltitudeM: 0,
      velocity: 0,
      verticalRate: 0,
    }),
    billboard: groundedFixed,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andgeo',
    meta: liveMeta({
      callsign: 'GEO9',
      registration: 'N9GEO',
      positionEpochMs: null,
    }),
    billboard: geoOnlyMissingPos,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andg2',
    meta: liveMeta({
      callsign: 'G2XX',
      registration: 'N2GEO',
      geoAltitudeM: null,
    }),
    billboard: posOnlyMissingGeo,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andrate',
    meta: liveMeta({
      callsign: 'RTE9',
      registration: 'N9RTE',
      verticalRate: 5,
      positionEpochMs: null,
    }),
    billboard: rateOnlyMissingPos,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andr2',
    meta: liveMeta({
      callsign: 'R2XX',
      registration: 'N2RTE',
      verticalRate: null,
    }),
    billboard: posOnlyMissingRate,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhead',
    meta: liveMeta({
      callsign: 'HDG9',
      registration: 'N9HDG',
      positionEpochMs: null,
    }),
    billboard: headedMissingPos,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andcty',
    meta: liveMeta({
      callsign: 'CTY9',
      registration: 'N9CTY',
      positionEpochMs: null,
    }),
    billboard: countryMissingPos,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andspd',
    meta: liveMeta({
      callsign: 'SPD9',
      registration: 'N9SPD',
      velocity: null,
    }),
    billboard: speedMissingPos,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andsp2',
    meta: liveMeta({
      callsign: 'SP2X',
      registration: 'N2SPD',
      positionEpochMs: null,
    }),
    billboard: speedOnlyMissingPos,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andbaro',
    meta: liveMeta({
      callsign: 'BAR9',
      registration: 'N9BAR',
      positionEpochMs: null,
    }),
    billboard: baroOnlyMissingPos,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andb2',
    meta: liveMeta({
      callsign: 'B2XX',
      registration: 'N2BAR',
      altitude: null,
    }),
    billboard: posOnlyMissingBaro,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andlc',
    meta: liveMeta({
      callsign: 'LC9X',
      registration: 'N9LC',
      lastContactEpochMs: FIX_AT,
      positionEpochMs: null,
    }),
    billboard: heardMissingPos,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andlc2',
    meta: liveMeta({
      callsign: 'LC2X',
      registration: 'N2LC',
      lastContactEpochMs: null,
      positionEpochMs: FIX_AT,
    }),
    billboard: posOnlyMissingContact,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andcat',
    meta: liveMeta({
      callsign: 'CAT9',
      registration: 'N9CAT',
      category: 6,
      positionEpochMs: null,
    }),
    billboard: categorizedMissingPos,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andc2',
    meta: liveMeta({
      callsign: 'C2XX',
      registration: 'N2CAT',
      category: 0,
    }),
    billboard: posOnlyMissingCategory,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andtyp',
    meta: liveMeta({
      callsign: 'TYP9',
      registration: 'N9TYP',
      typeCode: 'B738',
      positionEpochMs: null,
    }),
    billboard: typedMissingPos,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andt2',
    meta: liveMeta({
      callsign: 'T2XX',
      registration: 'N2TYP',
      typeCode: null,
    }),
    billboard: posOnlyMissingType,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andsqk',
    meta: liveMeta({
      callsign: 'SQK9',
      registration: 'N9SQK',
      squawk: '1200',
      positionEpochMs: null,
    }),
    billboard: squawkMissingPos,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'ands2',
    meta: liveMeta({
      callsign: 'S2XX',
      registration: 'N2SQK',
      squawk: null,
    }),
    billboard: posOnlyMissingSquawk,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andreg',
    meta: liveMeta({
      callsign: 'REG9',
      registration: 'N9REG',
      positionEpochMs: null,
    }),
    billboard: regMissingPos,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andr3',
    meta: liveMeta({
      callsign: 'RG2X',
      registration: null,
    }),
    billboard: posOnlyMissingReg,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andcsn',
    meta: liveMeta({
      callsign: 'CSN9',
      registration: 'N9CSN',
      positionEpochMs: null,
    }),
    billboard: callsignMissingPos,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andcs2',
    meta: liveMeta({
      callsign: null,
      registration: 'N2CSN',
    }),
    billboard: posOnlyMissingCallsign,
  });
  try {
    flightsLayer.setParams({
      hideNoPositionTime: false,
      hideNoCategory: false,
      hideNoLastContact: false,
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
    assert.equal(highFixed.show, true, 'Plan 93: high aviation altitude stays');
    assert.equal(lowFixed.show, false, 'Plan 93: low aviation altitude hides');
    assert.equal(missingPos.show, true, 'Plan 93 named band uses baro, not position time — 10000 m missing-position-time stays');

    setAltitudeBand('all', { persist: false });
    assert.equal(missingPos.show, true, 'Plan 93 All pass-through: missing position time stays');
    assert.equal(lowFixed.show, true, 'Plan 93 All keeps 2000 m');

    flightsLayer.setParams({ hideNoPositionTime: true });
    assert.equal(highFixed.show, true, 'finite positionEpochMs > 0 stays — not an altitude-band chip');
    assert.equal(lowFixed.show, true, 'finite position time at 2000 m stays — not Plan 93');
    assert.equal(groundedFixed.show, true, 'grounded finite position time stays — not hide-ground');
    assert.equal(missingPos.show, false, 'null positionEpochMs hides while Plan 93 All would keep it');
    assert.equal(geoOnlyMissingPos.show, false, 'geo-bearing missing-position-time hides — distinct from Plan 261');
    assert.equal(posOnlyMissingGeo.show, true, 'fixed but missing-geo stays — not Hide no geo');
    assert.equal(rateOnlyMissingPos.show, false, 'rate-bearing missing-position-time hides — distinct from Plan 268');
    assert.equal(posOnlyMissingRate.show, true, 'fixed but missing-rate stays — not Hide no vertical rate');
    assert.equal(headedMissingPos.show, false, 'headed but missing position time still hides — distinct from Plan 234');
    assert.equal(countryMissingPos.show, false, 'country-bearing but missing position time still hides — distinct from Plan 244');
    assert.equal(speedMissingPos.show, true, 'fixed but missing-speed stays — not Hide no speed (255)');
    assert.equal(speedOnlyMissingPos.show, false, 'speed-bearing missing-position-time hides');
    assert.equal(baroOnlyMissingPos.show, false, 'baro-bearing missing-position-time hides — distinct from Plan 274');
    assert.equal(posOnlyMissingBaro.show, true, 'fixed but missing-baro stays — not Hide no baro');
    assert.equal(heardMissingPos.show, false, 'heard but missing position time hides — distinct from Plan 280');
    assert.equal(posOnlyMissingContact.show, true, 'fixed but missing last contact stays — not Hide no last contact');
    assert.equal(categorizedMissingPos.show, false, 'categorized but missing position time hides — distinct from Plan 284');
    assert.equal(posOnlyMissingCategory.show, true, 'fixed but category 0 stays — not Hide no category');
    assert.equal(typedMissingPos.show, false, 'typed but missing position time hides — distinct from Plan 214');
    assert.equal(posOnlyMissingType.show, true, 'fixed but missing typeCode stays — not Hide no type');
    assert.equal(squawkMissingPos.show, false, 'squawk-bearing missing-position-time hides — distinct from Plan 203');
    assert.equal(posOnlyMissingSquawk.show, true, 'fixed but missing squawk stays — not Hide no squawk');
    assert.equal(regMissingPos.show, false, 'reg-bearing missing-position-time hides — distinct from Plan 222');
    assert.equal(posOnlyMissingReg.show, true, 'fixed but missing reg stays — not Hide no reg');
    assert.equal(callsignMissingPos.show, false, 'callsign-bearing missing-position-time hides — distinct from Plan 227');
    assert.equal(posOnlyMissingCallsign.show, true, 'fixed but missing callsign stays — not Hide no callsign');

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(highFixed.show, true);
    assert.equal(groundedFixed.show, false, 'AND: grounded timed contact hides under airborne-only (95)');

    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highFixed.show, true, 'AND: in-band timed remains');
    assert.equal(lowFixed.show, false, 'AND: timed but out-of-aviation-band hides');
    assert.equal(missingPos.show, false, 'AND: missing position time still hides under Plan 93 + 294');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ airborneOnly: false, hideNoHeading: true });
    assert.equal(highFixed.show, true, 'AND: timed headed stays under Hide no heading');
    assert.equal(headedMissingPos.show, false, 'AND: headed missing-position-time still hides');

    flightsLayer.setParams({ hideNoHeading: false, hideNoCountry: true });
    assert.equal(highFixed.show, true, 'AND: timed country stays under Hide no country');
    assert.equal(countryMissingPos.show, false, 'AND: country-bearing missing-position-time still hides');

    flightsLayer.setParams({ hideNoCountry: false, hideNoSpeed: true });
    assert.equal(highFixed.show, true, 'AND: timed speed stays under Hide no speed');
    assert.equal(speedMissingPos.show, false, 'AND: Hide no speed still drops timed missing-speed');
    assert.equal(speedOnlyMissingPos.show, false, 'AND: speed-bearing missing-position-time still hides');

    flightsLayer.setParams({ hideNoSpeed: false, hideNoGeoAltitude: true });
    assert.equal(highFixed.show, true, 'AND: timed geo stays under Hide no geo altitude');
    assert.equal(posOnlyMissingGeo.show, false, 'AND: Hide no geo altitude still drops timed missing-geo');
    assert.equal(geoOnlyMissingPos.show, false, 'AND: geo-bearing missing-position-time still hides');
    assert.equal(missingPos.show, false);

    flightsLayer.setParams({ hideNoGeoAltitude: false, hideNoVerticalRate: true });
    assert.equal(highFixed.show, true, 'AND: timed rate stays under Hide no vertical rate');
    assert.equal(posOnlyMissingRate.show, false, 'AND: Hide no vertical rate still drops timed missing-rate');
    assert.equal(rateOnlyMissingPos.show, false, 'AND: rate-bearing missing-position-time still hides');
    assert.equal(missingPos.show, false);

    flightsLayer.setParams({ hideNoVerticalRate: false, hideNoBaroAltitude: true });
    assert.equal(highFixed.show, true, 'AND: timed baro stays under Hide no baro altitude');
    assert.equal(posOnlyMissingBaro.show, false, 'AND: Hide no baro still drops timed missing-baro');
    assert.equal(baroOnlyMissingPos.show, false, 'AND: baro-bearing missing-position-time still hides');
    assert.equal(missingPos.show, false);

    flightsLayer.setParams({ hideNoBaroAltitude: false, hideNoLastContact: true });
    assert.equal(highFixed.show, true, 'AND: timed heard stays under Hide no last contact');
    assert.equal(posOnlyMissingContact.show, false, 'AND: Hide no last contact still drops timed missing-last-contact');
    assert.equal(heardMissingPos.show, false, 'AND: heard missing-position-time still hides');
    assert.equal(missingPos.show, false);

    flightsLayer.setParams({ hideNoLastContact: false, hideNoCategory: true });
    assert.equal(highFixed.show, true, 'AND: timed categorized stays under Hide no category');
    assert.equal(posOnlyMissingCategory.show, false, 'AND: Hide no category still drops timed category 0');
    assert.equal(categorizedMissingPos.show, false, 'AND: categorized missing-position-time still hides');
    assert.equal(missingPos.show, false);

    flightsLayer.setParams({ hideNoCategory: false, hideNoType: true });
    assert.equal(highFixed.show, true, 'AND: timed with typeCode stays under Hide no type');
    assert.equal(posOnlyMissingType.show, false, 'AND: Hide no type still drops timed missing-typeCode');
    assert.equal(typedMissingPos.show, false, 'AND: typed missing-position-time still hides');

    flightsLayer.setParams({ hideNoType: false, hideNoSquawk: true });
    assert.equal(highFixed.show, true, 'AND: timed with squawk stays under Hide no squawk');
    assert.equal(posOnlyMissingSquawk.show, false, 'AND: Hide no squawk still drops timed missing-squawk');
    assert.equal(squawkMissingPos.show, false, 'AND: squawk-bearing missing-position-time still hides');

    flightsLayer.setParams({ hideNoSquawk: false, hideNoReg: true });
    assert.equal(highFixed.show, true, 'AND: timed with reg stays under Hide no reg');
    assert.equal(posOnlyMissingReg.show, false, 'AND: Hide no reg still drops timed missing-reg');
    assert.equal(regMissingPos.show, false, 'AND: reg-bearing missing-position-time still hides');

    flightsLayer.setParams({ hideNoReg: false, hideNoCallsign: true });
    assert.equal(highFixed.show, true, 'AND: timed with callsign stays under Hide no callsign');
    assert.equal(posOnlyMissingCallsign.show, false, 'AND: Hide no callsign still drops timed missing-callsign');
    assert.equal(callsignMissingPos.show, false, 'AND: callsign-bearing missing-position-time still hides');
  } finally {
    resetHideNoPositionTimeLayers();
  }
});

test('invalid storage reads as off', () => {
  resetHideNoPositionTimeForTest();
  assert.equal(HIDE_NO_POSITION_TIME_STORAGE_KEY, 'meridian.flightHideNoPositionTime');
  assert.equal(readHideNoPositionTimeEnabled(memoryStorage()), false);
  assert.equal(readHideNoPositionTimeEnabled(memoryStorage({ 'meridian.flightHideNoPositionTime': 'nope' })), false);
  assert.equal(readHideNoPositionTimeEnabled(memoryStorage({ 'meridian.flightHideNoPositionTime': 'yes' })), false);
  assert.equal(readHideNoPositionTimeEnabled({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');
});

test('persist flip survives reload', () => {
  resetHideNoPositionTimeForTest();
  const storage = memoryStorage();
  assert.equal(writeHideNoPositionTimeEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightHideNoPositionTime': '1' });
  assert.equal(readHideNoPositionTimeEnabled(storage), true);
  assert.equal(writeHideNoPositionTimeEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightHideNoPositionTime'], '0');

  const seen = [];
  const unsubscribe = subscribeHideNoPositionTimeEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getHideNoPositionTimeEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightHideNoPositionTime': '1' });
    assert.equal(hydrateHideNoPositionTimeEnabled(hydrated), true);
    assert.equal(getHideNoPositionTimeEnabled(), true);
    assert.equal(setHideNoPositionTimeEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightHideNoPositionTime'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetHideNoPositionTimeForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(Object.hasOwn(defaults, 'hideNoPositionTime'), false, 'not a share-URL option');
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(Object.hasOwn(omitted.options.flights, 'hideNoPositionTime'), false);

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { hideNoPositionTime: true } },
  }));
  assert.doesNotMatch(String(encodedOn.get('lo') || ''), /hideNoPositionTime/);
  const encodedOff = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: {} },
  }));
  assert.equal(String(encodedOn.get('lo') || ''), String(encodedOff.get('lo') || ''),
    'no share-URL write');

  hydrateHideNoPositionTimeEnabled(memoryStorage({ 'meridian.flightHideNoPositionTime': '1' }));
  flightsLayer.setParams({ airborneOnly: false, identifiedOnly: false, emergenciesOnly: false });
  assert.equal(getHideNoPositionTimeEnabled(), true, 'coordinator-style restore keeps the flip');
  assert.equal(flightsLayer.getParams().hideNoPositionTime, true);

  flightsLayer.setParams({ hideNoPositionTime: false });
  assert.equal(flightsLayer.getParams().hideNoPositionTime, false);
  flightsLayer.setParams({ hideNoPositionTime: true });
  assert.equal(flightsLayer.getParams().hideNoPositionTime, true);
  const chips = flightsLayer.getRowControls().chips;
  const chip = chips.find((entry) => entry.id === HIDE_NO_POSITION_TIME_CHIP_ID);
  const categoryIdx = chips.findIndex((entry) => entry.id === 'hide-no-category');
  const posIdx = chips.findIndex((entry) => entry.id === HIDE_NO_POSITION_TIME_CHIP_ID);
  assert.equal(chip.label, HIDE_NO_POSITION_TIME_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { hideNoPositionTime: false });
  assert.ok(categoryIdx >= 0 && posIdx === categoryIdx + 1, 'Hide no position time sits next to Hide no category');
  flightsLayer.setParams({ hideNoPositionTime: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_POSITION_TIME_CHIP_ID).active, false);
  resetHideNoPositionTimeForTest();
});

test('militaryFlights.js and stay-off layers are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const style = root('style.css');
  const flights = data('flights.js');
  const helper = data('flightHideNoPositionTimeFilter.js');
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
  assert.doesNotMatch(html, /hide-no-position-time|Hide no position time/);
  assert.doesNotMatch(ui, /hideNoPositionTime|_initHideNoPositionTime/);
  assert.doesNotMatch(style, /hide-no-position-time|hideNoPositionTime/);
  assert.match(flights, /hideNoPositionTimeChipModel\(/);
  assert.match(flights, /passesHideNoPositionTimeFilter/);
  assert.match(flights, /_hideNoPositionTimeMatcher/);
  assert.match(flights, /positionEpochMs: stickyNumber\(/);
  assert.match(flights, /Number\.isFinite\(time_position\) && time_position > 0/);
  assert.match(flights, /time_position \* 1000/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /hideNoPositionTime|hide-no-position-time|flightHideNoPositionTimeFilter/);
  assert.doesNotMatch(ais, /flightHideNoPositionTimeFilter|meridian\.flightHideNoPositionTime/);
  assert.doesNotMatch(adapter, /hideNoPositionTime|hide-no-position-time|flightHideNoPositionTimeFilter/);
  assert.doesNotMatch(awareness, /hideNoPositionTime|flightHideNoPositionTimeFilter/);
  assert.doesNotMatch(launchesPanel, /hideNoPositionTime|flightHideNoPositionTimeFilter/);
  assert.doesNotMatch(rocketLaunches, /hideNoPositionTime|flightHideNoPositionTimeFilter/);
  assert.doesNotMatch(firmsHeatmap, /hideNoPositionTime|flightHideNoPositionTimeFilter/);
  assert.doesNotMatch(firmsList, /hideNoPositionTime|flightHideNoPositionTimeFilter/);
  assert.doesNotMatch(damsList, /hideNoPositionTime|flightHideNoPositionTimeFilter/);
  assert.doesNotMatch(datacenterList, /hideNoPositionTime|flightHideNoPositionTimeFilter/);
  assert.doesNotMatch(localGeojson, /hideNoPositionTime|flightHideNoPositionTimeFilter/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.doesNotMatch(helper, /OpenSky|opensky/i);
  assert.match(helper, /positionEpochMs/);
  assert.match(helper, /time_position/);
  assert.match(helper, /meridian\.flightHideNoPositionTime/);
  assert.match(helper, /not written into the share URL/);
  assert.match(helper, /Plan 93 altitude-band/);
  assert.match(helper, /Hide no last contact \(280/);
  assert.match(helper, /Hide no category \(284/);
  assert.match(helper, /0 stays/);
  assert.match(helper, /airborne-only \/ hide-ground/);
  assert.doesNotMatch(helper, /hide-ground chip|add hide-ground/i);
});

test('legal: already-fetched positionEpochMs only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightHideNoPositionTimeFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth|OpenSky|opensky/i);
  assert.match(moduleSource, /positionEpochMs/);
});
