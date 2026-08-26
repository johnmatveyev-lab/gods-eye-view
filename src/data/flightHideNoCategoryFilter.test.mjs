import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  HIDE_NO_CATEGORY_CHIP_ID,
  HIDE_NO_CATEGORY_CHIP_LABEL,
  HIDE_NO_CATEGORY_DEFAULT,
  HIDE_NO_CATEGORY_STORAGE_KEY,
  categoryField,
  contactHasCategory,
  getHideNoCategoryEnabled,
  hideNoCategoryChipModel,
  hydrateHideNoCategoryEnabled,
  normalizeHideNoCategory,
  passesHideNoCategoryFilter,
  readHideNoCategoryEnabled,
  resetHideNoCategoryForTest,
  setHideNoCategoryEnabled,
  subscribeHideNoCategoryEnabled,
  writeHideNoCategoryEnabled,
} from './flightHideNoCategoryFilter.js';
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

const HEARD_AT = 1_724_000_000_000;

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

function resetHideNoCategoryLayers() {
  resetHideNoCategoryForTest();
  setHeadingSectors('NESW');
  flightsLayer.setParams({
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
    lastContactEpochMs: HEARD_AT,
    category: 6,
    ...extra,
  };
}

test('off keeps missing / non-finite / 0 category', () => {
  assert.equal(HIDE_NO_CATEGORY_DEFAULT, false);
  assert.equal(HIDE_NO_CATEGORY_STORAGE_KEY, 'meridian.flightHideNoCategory');
  assert.equal(normalizeHideNoCategory(undefined), false);
  assert.equal(normalizeHideNoCategory(null), false);
  assert.equal(normalizeHideNoCategory('nope'), false);
  assert.equal(normalizeHideNoCategory(false), false);
  assert.equal(normalizeHideNoCategory(true), true);
  assert.equal(normalizeHideNoCategory('1'), true);

  assert.equal(categoryField(undefined), null);
  assert.equal(categoryField(null), null);
  assert.equal(categoryField(Number.NaN), null);
  assert.equal(categoryField(Number.POSITIVE_INFINITY), null);
  assert.equal(categoryField(0), null, '0 is ADS-B no-information, not the heading/speed/baro 0-stays rule');
  assert.equal(categoryField('0'), null);
  assert.equal(categoryField(1), null, 'category 1 is also no-info');
  assert.equal(categoryField(2), 2);
  assert.equal(categoryField(6), 6);
  assert.equal(categoryField(18), 18);
  assert.equal(categoryField('A1'), 'A1');
  assert.equal(categoryField('a7'), 'A7');
  assert.equal(categoryField('B1'), 'B1');
  assert.equal(categoryField('A0'), null, 'A0 is no-information');
  assert.equal(categoryField('B0'), null, 'B0 is no-information');

  assert.equal(contactHasCategory({ category: 0 }), false);
  assert.equal(contactHasCategory({ category: 6 }), true);
  assert.equal(contactHasCategory({ category: 'A1' }), true);
  assert.equal(contactHasCategory({ category: 'B1' }), true);
  assert.equal(contactHasCategory({ category: null }), false);
  assert.equal(contactHasCategory({ category: undefined }), false);
  assert.equal(contactHasCategory({ category: Number.NaN }), false);
  assert.equal(contactHasCategory({}), false);

  const missing = {};
  const empty = { category: null };
  const noInfo = { category: 0 };
  const typed = { category: 6 };
  const nanCat = { category: Number.NaN };
  const emitter = { category: 'A1' };

  for (const contact of [missing, empty, noInfo, typed, nanCat, emitter]) {
    assert.equal(passesHideNoCategoryFilter({ ...contact, hideNoCategory: false }), true,
      'off keeps missing / non-finite / 0 category');
  }

  const chip = hideNoCategoryChipModel(false);
  assert.equal(chip.label, HIDE_NO_CATEGORY_CHIP_LABEL);
  assert.equal(chip.id, HIDE_NO_CATEGORY_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoCategory: true });
  assert.deepEqual(hideNoCategoryChipModel(true).params, { hideNoCategory: false });
});

test('on hides missing / non-finite / 0 category and keeps a real emitter category', () => {
  const missing = emptyBillboard();
  const typed = emptyBillboard();
  const empty = emptyBillboard();
  const nanCat = emptyBillboard();
  const noInfo = emptyBillboard();
  const emitterA1 = emptyBillboard();
  const emitterB1 = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'a1b2c3',
    meta: liveMeta({
      callsign: 'UNK1',
      category: undefined,
    }),
    billboard: missing,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'typed01',
    meta: liveMeta({ callsign: 'UAL100', registration: 'N100UA', category: 6 }),
    billboard: typed,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'empty01',
    meta: liveMeta({ callsign: 'NULL1', category: null }),
    billboard: empty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'nan0001',
    meta: liveMeta({ callsign: 'NAN1', registration: 'N1NAN', category: Number.NaN }),
    billboard: nanCat,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'cat0000',
    meta: liveMeta({ callsign: 'NOINFO', registration: 'N0CAT', category: 0 }),
    billboard: noInfo,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'emita1',
    meta: liveMeta({ callsign: 'LITE1', registration: 'N1A1', category: 'A1' }),
    billboard: emitterA1,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'emitb1',
    meta: liveMeta({ callsign: 'GLD1', registration: 'N1B1', category: 'B1' }),
    billboard: emitterB1,
  });
  try {
    assert.equal(flightsLayer.getParams().hideNoCategory, false);
    assert.equal(missing.show, true);
    assert.equal(typed.show, true);
    assert.equal(empty.show, true);
    assert.equal(nanCat.show, true);
    assert.equal(noInfo.show, true);
    assert.equal(emitterA1.show, true);
    assert.equal(emitterB1.show, true);

    assert.equal(flightsLayer.setParams({ hideNoCategory: true }), true);
    assert.equal(flightsLayer.getParams().hideNoCategory, true);
    assert.equal(missing.show, false, 'undefined category hides');
    assert.equal(typed.show, true, 'real emitter category 6 stays');
    assert.equal(empty.show, false, 'null category hides');
    assert.equal(nanCat.show, false, 'NaN category hides');
    assert.equal(noInfo.show, false, 'category 0 is no-information and hides');
    assert.equal(emitterA1.show, true, 'string A1 stays');
    assert.equal(emitterB1.show, true, 'string B1 stays');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: liveMeta({ klass: 'airliner', category: 0 }),
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().hideNoCategory, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(typed.show, true);

    flightsLayer.setParams({ hideNoCategory: false });
    assert.equal(missing.show, true);
    assert.equal(empty.show, true);
    assert.equal(nanCat.show, true);
    assert.equal(noInfo.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetHideNoCategoryLayers();
  }
});

test('selected / tracked always kept', () => {
  const selected = emptyBillboard();
  const otherEmpty = emptyBillboard();
  const typed = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: liveMeta({
      callsign: 'SEL1',
      registration: 'N9SEL',
      category: 0,
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
      category: undefined,
    }),
    billboard: otherEmpty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'typed01',
    meta: liveMeta({ callsign: 'UAL100', registration: 'N100UA', category: 6 }),
    billboard: typed,
  });
  try {
    flightsLayer.setParams({ hideNoCategory: true });
    assert.equal(selected.show, true, 'tracked no-category stays');
    assert.equal(otherEmpty.show, false);
    assert.equal(typed.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked no-category hides');
    assert.equal(typed.show, true);
  } finally {
    resetHideNoCategoryLayers();
  }
});

test('Hide no category ANDs with existing hide-no chips including 280 last contact and stays distinct from Plan 93 / 214 / 234 / 244 / 255 / 261 / 268 / 274 / 280 / hide-ground / class chips', () => {
  const highTyped = emptyBillboard();
  const lowTyped = emptyBillboard();
  const missingCategory = emptyBillboard();
  const groundedTyped = emptyBillboard();
  const geoOnlyMissingCategory = emptyBillboard();
  const categoryOnlyMissingGeo = emptyBillboard();
  const rateOnlyMissingCategory = emptyBillboard();
  const categoryOnlyMissingRate = emptyBillboard();
  const headedMissingCategory = emptyBillboard();
  const countryMissingCategory = emptyBillboard();
  const speedMissingCategory = emptyBillboard();
  const speedOnlyMissingCategory = emptyBillboard();
  const baroOnlyMissingCategory = emptyBillboard();
  const categoryOnlyMissingBaro = emptyBillboard();
  const heardMissingCategory = emptyBillboard();
  const categoryOnlyMissingContact = emptyBillboard();
  const typedNoTypeCode = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'andhigh',
    meta: liveMeta({
      callsign: 'UAL100',
      registration: 'N100UA',
      altitude: 10_000,
      geoAltitudeM: 10_000,
      velocity: 200,
      verticalRate: 0,
      category: 6,
    }),
    billboard: highTyped,
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
      category: 2,
    }),
    billboard: lowTyped,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhex',
    meta: liveMeta({
      callsign: 'SWA9',
      registration: 'N9SWA',
      category: 0,
    }),
    billboard: missingCategory,
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
      category: 8,
    }),
    billboard: groundedTyped,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andgeo',
    meta: liveMeta({
      callsign: 'GEO9',
      registration: 'N9GEO',
      category: null,
    }),
    billboard: geoOnlyMissingCategory,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andg2',
    meta: liveMeta({
      callsign: 'G2XX',
      registration: 'N2GEO',
      geoAltitudeM: null,
      category: 4,
    }),
    billboard: categoryOnlyMissingGeo,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andrate',
    meta: liveMeta({
      callsign: 'RTE9',
      registration: 'N9RTE',
      verticalRate: 5,
      category: 0,
    }),
    billboard: rateOnlyMissingCategory,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andr2',
    meta: liveMeta({
      callsign: 'R2XX',
      registration: 'N2RTE',
      verticalRate: null,
      category: 5,
    }),
    billboard: categoryOnlyMissingRate,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhead',
    meta: liveMeta({
      callsign: 'HDG9',
      registration: 'N9HDG',
      category: 0,
    }),
    billboard: headedMissingCategory,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andcty',
    meta: liveMeta({
      callsign: 'CTY9',
      registration: 'N9CTY',
      category: 0,
    }),
    billboard: countryMissingCategory,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andspd',
    meta: liveMeta({
      callsign: 'SPD9',
      registration: 'N9SPD',
      velocity: null,
      category: 3,
    }),
    billboard: speedMissingCategory,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andsp2',
    meta: liveMeta({
      callsign: 'SP2X',
      registration: 'N2SPD',
      category: 0,
    }),
    billboard: speedOnlyMissingCategory,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andbaro',
    meta: liveMeta({
      callsign: 'BAR9',
      registration: 'N9BAR',
      category: 0,
    }),
    billboard: baroOnlyMissingCategory,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andb2',
    meta: liveMeta({
      callsign: 'B2XX',
      registration: 'N2BAR',
      altitude: null,
      category: 7,
    }),
    billboard: categoryOnlyMissingBaro,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andlc',
    meta: liveMeta({
      callsign: 'LC9',
      registration: 'N9LC',
      lastContactEpochMs: HEARD_AT,
      category: 0,
    }),
    billboard: heardMissingCategory,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andlc2',
    meta: liveMeta({
      callsign: 'LC2X',
      registration: 'N2LC',
      lastContactEpochMs: null,
      category: 18,
    }),
    billboard: categoryOnlyMissingContact,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andtyp',
    meta: liveMeta({
      callsign: 'TYP9',
      registration: 'N9TYP',
      typeCode: null,
      category: 6,
    }),
    billboard: typedNoTypeCode,
  });
  try {
    flightsLayer.setParams({
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
    assert.equal(highTyped.show, true, 'Plan 93: high aviation altitude stays');
    assert.equal(lowTyped.show, false, 'Plan 93: low aviation altitude hides');
    assert.equal(missingCategory.show, true, 'Plan 93 named band uses baro, not category — 10000 m no-category stays');

    setAltitudeBand('all', { persist: false });
    assert.equal(missingCategory.show, true, 'Plan 93 All pass-through: missing category stays');
    assert.equal(lowTyped.show, true, 'Plan 93 All keeps 2000 m');

    flightsLayer.setParams({ hideNoCategory: true });
    assert.equal(highTyped.show, true, 'real category stays — not an altitude-band chip');
    assert.equal(lowTyped.show, true, 'real category at 2000 m stays — not Plan 93');
    assert.equal(groundedTyped.show, true, 'grounded real category stays — not hide-ground');
    assert.equal(missingCategory.show, false, 'category 0 hides while Plan 93 All would keep it');
    assert.equal(geoOnlyMissingCategory.show, false, 'geo-bearing no-category hides — distinct from Plan 261');
    assert.equal(categoryOnlyMissingGeo.show, true, 'typed but missing-geo stays — not Hide no geo');
    assert.equal(rateOnlyMissingCategory.show, false, 'rate-bearing no-category hides — distinct from Plan 268');
    assert.equal(categoryOnlyMissingRate.show, true, 'typed but missing-rate stays — not Hide no vertical rate');
    assert.equal(headedMissingCategory.show, false, 'headed but no category still hides — distinct from Plan 234');
    assert.equal(countryMissingCategory.show, false, 'country-bearing but no category still hides — distinct from Plan 244');
    assert.equal(speedMissingCategory.show, true, 'typed but missing-speed stays — not Hide no speed (255)');
    assert.equal(speedOnlyMissingCategory.show, false, 'speed-bearing no-category hides');
    assert.equal(baroOnlyMissingCategory.show, false, 'baro-bearing no-category hides — distinct from Plan 274');
    assert.equal(categoryOnlyMissingBaro.show, true, 'typed but missing-baro stays — not Hide no baro');
    assert.equal(heardMissingCategory.show, false, 'heard but category 0 hides — distinct from Plan 280');
    assert.equal(categoryOnlyMissingContact.show, true, 'typed but missing last contact stays — not Hide no last contact');
    assert.equal(typedNoTypeCode.show, true, 'typed category without typeCode stays — not Hide no type (214)');

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(highTyped.show, true);
    assert.equal(groundedTyped.show, false, 'AND: grounded typed contact hides under airborne-only');

    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highTyped.show, true, 'AND: in-band typed remains');
    assert.equal(lowTyped.show, false, 'AND: typed but out-of-aviation-band hides');
    assert.equal(missingCategory.show, false, 'AND: no-category still hides under Plan 93 + 284');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ airborneOnly: false, hideNoHeading: true });
    assert.equal(highTyped.show, true, 'AND: typed headed stays under Hide no heading');
    assert.equal(headedMissingCategory.show, false, 'AND: headed no-category still hides');

    flightsLayer.setParams({ hideNoHeading: false, hideNoCountry: true });
    assert.equal(highTyped.show, true, 'AND: typed country stays under Hide no country');
    assert.equal(countryMissingCategory.show, false, 'AND: country-bearing no-category still hides');

    flightsLayer.setParams({ hideNoCountry: false, hideNoSpeed: true });
    assert.equal(highTyped.show, true, 'AND: typed speed stays under Hide no speed');
    assert.equal(speedMissingCategory.show, false, 'AND: Hide no speed still drops typed missing-speed');
    assert.equal(speedOnlyMissingCategory.show, false, 'AND: speed-bearing no-category still hides');

    flightsLayer.setParams({ hideNoSpeed: false, hideNoGeoAltitude: true });
    assert.equal(highTyped.show, true, 'AND: typed geo stays under Hide no geo altitude');
    assert.equal(categoryOnlyMissingGeo.show, false, 'AND: Hide no geo altitude still drops typed missing-geo');
    assert.equal(geoOnlyMissingCategory.show, false, 'AND: geo-bearing no-category still hides');
    assert.equal(missingCategory.show, false);

    flightsLayer.setParams({ hideNoGeoAltitude: false, hideNoVerticalRate: true });
    assert.equal(highTyped.show, true, 'AND: typed rate stays under Hide no vertical rate');
    assert.equal(categoryOnlyMissingRate.show, false, 'AND: Hide no vertical rate still drops typed missing-rate');
    assert.equal(rateOnlyMissingCategory.show, false, 'AND: rate-bearing no-category still hides');
    assert.equal(missingCategory.show, false);

    flightsLayer.setParams({ hideNoVerticalRate: false, hideNoBaroAltitude: true });
    assert.equal(highTyped.show, true, 'AND: typed baro stays under Hide no baro altitude');
    assert.equal(categoryOnlyMissingBaro.show, false, 'AND: Hide no baro still drops typed missing-baro');
    assert.equal(baroOnlyMissingCategory.show, false, 'AND: baro-bearing no-category still hides');
    assert.equal(missingCategory.show, false);

    flightsLayer.setParams({ hideNoBaroAltitude: false, hideNoLastContact: true });
    assert.equal(highTyped.show, true, 'AND: typed heard stays under Hide no last contact');
    assert.equal(categoryOnlyMissingContact.show, false, 'AND: Hide no last contact still drops typed missing-last-contact');
    assert.equal(heardMissingCategory.show, false, 'AND: heard no-category still hides');
    assert.equal(missingCategory.show, false);

    flightsLayer.setParams({ hideNoLastContact: false, hideNoType: true });
    assert.equal(highTyped.show, true, 'AND: typed with typeCode stays under Hide no type');
    assert.equal(typedNoTypeCode.show, false, 'AND: Hide no type still drops typed-category missing-typeCode');
    assert.equal(missingCategory.show, false, 'AND: type-bearing no-category still hides');

    flightsLayer.setParams({ hideNoType: false, aircraftClassFilter: 'helicopter' });
    assert.equal(groundedTyped.show, true, 'class chip keeps helicopter with category 8 — not this presence chip');
    assert.equal(highTyped.show, false, 'class chip hides airliner — distinct from Hide no category');
    flightsLayer.setParams({ aircraftClassFilter: 'all' });
    assert.equal(highTyped.show, true);
  } finally {
    resetHideNoCategoryLayers();
  }
});

test('invalid storage reads as off', () => {
  resetHideNoCategoryForTest();
  assert.equal(HIDE_NO_CATEGORY_STORAGE_KEY, 'meridian.flightHideNoCategory');
  assert.equal(readHideNoCategoryEnabled(memoryStorage()), false);
  assert.equal(readHideNoCategoryEnabled(memoryStorage({ 'meridian.flightHideNoCategory': 'nope' })), false);
  assert.equal(readHideNoCategoryEnabled(memoryStorage({ 'meridian.flightHideNoCategory': 'yes' })), false);
  assert.equal(readHideNoCategoryEnabled({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');
});

test('persist flip survives reload', () => {
  resetHideNoCategoryForTest();
  const storage = memoryStorage();
  assert.equal(writeHideNoCategoryEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightHideNoCategory': '1' });
  assert.equal(readHideNoCategoryEnabled(storage), true);
  assert.equal(writeHideNoCategoryEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightHideNoCategory'], '0');

  const seen = [];
  const unsubscribe = subscribeHideNoCategoryEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getHideNoCategoryEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightHideNoCategory': '1' });
    assert.equal(hydrateHideNoCategoryEnabled(hydrated), true);
    assert.equal(getHideNoCategoryEnabled(), true);
    assert.equal(setHideNoCategoryEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightHideNoCategory'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetHideNoCategoryForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(Object.hasOwn(defaults, 'hideNoCategory'), false, 'not a share-URL option');
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(Object.hasOwn(omitted.options.flights, 'hideNoCategory'), false);

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { hideNoCategory: true } },
  }));
  assert.doesNotMatch(String(encodedOn.get('lo') || ''), /hideNoCategory/);
  const encodedOff = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: {} },
  }));
  assert.equal(String(encodedOn.get('lo') || ''), String(encodedOff.get('lo') || ''),
    'no share-URL write');

  hydrateHideNoCategoryEnabled(memoryStorage({ 'meridian.flightHideNoCategory': '1' }));
  flightsLayer.setParams({ airborneOnly: false, identifiedOnly: false, emergenciesOnly: false });
  assert.equal(getHideNoCategoryEnabled(), true, 'coordinator-style restore keeps the flip');
  assert.equal(flightsLayer.getParams().hideNoCategory, true);

  flightsLayer.setParams({ hideNoCategory: false });
  assert.equal(flightsLayer.getParams().hideNoCategory, false);
  flightsLayer.setParams({ hideNoCategory: true });
  assert.equal(flightsLayer.getParams().hideNoCategory, true);
  const chips = flightsLayer.getRowControls().chips;
  const chip = chips.find((entry) => entry.id === HIDE_NO_CATEGORY_CHIP_ID);
  const lastContactIdx = chips.findIndex((entry) => entry.id === 'hide-no-last-contact');
  const categoryIdx = chips.findIndex((entry) => entry.id === HIDE_NO_CATEGORY_CHIP_ID);
  assert.equal(chip.label, HIDE_NO_CATEGORY_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { hideNoCategory: false });
  assert.ok(lastContactIdx >= 0 && categoryIdx === lastContactIdx + 1, 'Hide no category sits next to Hide no last contact');
  flightsLayer.setParams({ hideNoCategory: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_CATEGORY_CHIP_ID).active, false);
  resetHideNoCategoryForTest();
});

test('militaryFlights.js and stay-off layers are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const style = root('style.css');
  const flights = data('flights.js');
  const helper = data('flightHideNoCategoryFilter.js');
  const classifier = data('aircraftClass.js');
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
  assert.doesNotMatch(html, /hide-no-category|Hide no category/);
  assert.doesNotMatch(ui, /hideNoCategory|_initHideNoCategory/);
  assert.doesNotMatch(style, /hide-no-category|hideNoCategory/);
  assert.match(flights, /hideNoCategoryChipModel\(/);
  assert.match(flights, /passesHideNoCategoryFilter/);
  assert.match(flights, /_hideNoCategoryMatcher/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /hideNoCategory|hide-no-category|flightHideNoCategoryFilter/);
  assert.doesNotMatch(ais, /flightHideNoCategoryFilter|meridian\.flightHideNoCategory/);
  assert.doesNotMatch(adapter, /hideNoCategory|hide-no-category|flightHideNoCategoryFilter/);
  assert.doesNotMatch(awareness, /hideNoCategory|flightHideNoCategoryFilter/);
  assert.doesNotMatch(launchesPanel, /hideNoCategory|flightHideNoCategoryFilter/);
  assert.doesNotMatch(rocketLaunches, /hideNoCategory|flightHideNoCategoryFilter/);
  assert.doesNotMatch(firmsHeatmap, /hideNoCategory|flightHideNoCategoryFilter/);
  assert.doesNotMatch(firmsList, /hideNoCategory|flightHideNoCategoryFilter/);
  assert.doesNotMatch(damsList, /hideNoCategory|flightHideNoCategoryFilter/);
  assert.doesNotMatch(datacenterList, /hideNoCategory|flightHideNoCategoryFilter/);
  assert.doesNotMatch(localGeojson, /hideNoCategory|flightHideNoCategoryFilter/);
  assert.doesNotMatch(classifier, /hideNoCategory|flightHideNoCategoryFilter|meridian\.flightHideNoCategory/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.doesNotMatch(helper, /OpenSky|opensky/i);
  assert.match(helper, /category/);
  assert.match(helper, /meridian\.flightHideNoCategory/);
  assert.match(helper, /not written into the share URL/);
  assert.match(helper, /Plan 93 altitude-band/);
  assert.match(helper, /Hide no last contact \(280/);
  assert.match(helper, /0 stays/);
  assert.match(helper, /airborne-only \/ hide-ground/);
  assert.doesNotMatch(helper, /hide-ground chip|add hide-ground/i);
});

test('legal: already-fetched category only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightHideNoCategoryFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth|OpenSky|opensky/i);
  assert.match(moduleSource, /category/);
});
