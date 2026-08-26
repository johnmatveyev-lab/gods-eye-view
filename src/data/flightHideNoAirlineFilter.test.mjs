import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  HIDE_NO_AIRLINE_CHIP_ID,
  HIDE_NO_AIRLINE_CHIP_LABEL,
  HIDE_NO_AIRLINE_DEFAULT,
  HIDE_NO_AIRLINE_STORAGE_KEY,
  airlineFieldText,
  contactHasAirline,
  getHideNoAirlineEnabled,
  hideNoAirlineChipModel,
  hydrateHideNoAirlineEnabled,
  normalizeHideNoAirline,
  passesHideNoAirlineFilter,
  readHideNoAirlineEnabled,
  resetHideNoAirlineForTest,
  setHideNoAirlineEnabled,
  subscribeHideNoAirlineEnabled,
  writeHideNoAirlineEnabled,
} from './flightHideNoAirlineFilter.js';
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

function resetHideNoAirlineLayers() {
  resetHideNoAirlineForTest();
  setHeadingSectors('NESW');
  flightsLayer.setParams({
    hideNoAirline: false,
    hideNoTypeName: false,
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
    callsign: 'AAL123',
    registration: 'N100AA',
    typeCode: 'B738',
    typeName: 'Boeing 737-800',
    airline: 'American Airlines',
    squawk: '1200',
    klass: 'airliner',
    onGround: false,
    lastContactEpochMs: FIX_AT,
    category: 6,
    positionEpochMs: FIX_AT,
    ...extra,
  };
}

test('Hide no airline defaults off and treats missing/null/blank/whitespace as empty', () => {
  assert.equal(HIDE_NO_AIRLINE_DEFAULT, false);
  assert.equal(HIDE_NO_AIRLINE_STORAGE_KEY, 'meridian.flightHideNoAirline');
  assert.equal(normalizeHideNoAirline(undefined), false);
  assert.equal(normalizeHideNoAirline(null), false);
  assert.equal(normalizeHideNoAirline('nope'), false);
  assert.equal(normalizeHideNoAirline(false), false);
  assert.equal(normalizeHideNoAirline(true), true);
  assert.equal(normalizeHideNoAirline('1'), true);

  assert.equal(airlineFieldText(undefined), '');
  assert.equal(airlineFieldText(null), '');
  assert.equal(airlineFieldText(''), '');
  assert.equal(airlineFieldText('   '), '');
  assert.equal(airlineFieldText('American Airlines'), 'American Airlines');
  assert.equal(airlineFieldText(' American Airlines '), 'American Airlines');

  assert.equal(contactHasAirline({ airline: 'American Airlines' }), true);
  assert.equal(contactHasAirline({ airline: '   ' }), false);
  assert.equal(contactHasAirline({ airline: null }), false);
  assert.equal(contactHasAirline({}), false);

  const missing = {};
  const empty = { airline: null };
  const named = { airline: 'American Airlines' };
  const whitespace = { airline: '   ' };
  const callsignOnly = { callsign: 'AAL123', airline: '' };

  for (const contact of [missing, empty, named, whitespace, callsignOnly]) {
    assert.equal(passesHideNoAirlineFilter({ ...contact, hideNoAirline: false }), true,
      'off keeps missing airline');
  }
  assert.equal(passesHideNoAirlineFilter({ ...missing, hideNoAirline: true }), false);
  assert.equal(passesHideNoAirlineFilter({ ...empty, hideNoAirline: true }), false);
  assert.equal(passesHideNoAirlineFilter({ airline: '', hideNoAirline: true }), false);
  assert.equal(passesHideNoAirlineFilter({ ...whitespace, hideNoAirline: true }), false);
  assert.equal(passesHideNoAirlineFilter({ ...callsignOnly, hideNoAirline: true }), false,
    'callsign-only AAL123 still hides — distinct from 227');
  assert.equal(passesHideNoAirlineFilter({ ...named, hideNoAirline: true }), true);

  const chip = hideNoAirlineChipModel(false);
  assert.equal(chip.label, HIDE_NO_AIRLINE_CHIP_LABEL);
  assert.equal(chip.id, HIDE_NO_AIRLINE_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoAirline: true });
  assert.deepEqual(hideNoAirlineChipModel(true).params, { hideNoAirline: false });
});

test('off keeps the current fleet including missing airline; on hides callsign-only AAL123 and keeps American Airlines', () => {
  const missing = emptyBillboard();
  const named = emptyBillboard();
  const blank = emptyBillboard();
  const empty = emptyBillboard();
  const callsignOnly = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'a1b2c3',
    meta: liveMeta({ callsign: 'AAL123', airline: null }),
    billboard: missing,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'aal001',
    meta: liveMeta({ callsign: 'AAL100' }),
    billboard: named,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'ws0001',
    meta: liveMeta({ callsign: 'SWA1', airline: '   ' }),
    billboard: blank,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'empty01',
    meta: liveMeta({ callsign: 'N123AB', airline: '' }),
    billboard: empty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'csonly1',
    meta: liveMeta({ callsign: 'AAL123', airline: '' }),
    billboard: callsignOnly,
  });
  try {
    assert.equal(flightsLayer.getParams().hideNoAirline, false);
    assert.equal(missing.show, true);
    assert.equal(named.show, true);
    assert.equal(blank.show, true);
    assert.equal(empty.show, true);
    assert.equal(callsignOnly.show, true);

    assert.equal(flightsLayer.setParams({ hideNoAirline: true }), true);
    assert.equal(flightsLayer.getParams().hideNoAirline, true);
    assert.equal(missing.show, false, 'missing airline hides');
    assert.equal(named.show, true, 'American Airlines stays');
    assert.equal(blank.show, false, 'whitespace-only is empty');
    assert.equal(empty.show, false, 'empty airline hides');
    assert.equal(callsignOnly.show, false, 'callsign-only AAL123 hides');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: liveMeta({ klass: 'airliner', airline: undefined }),
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().hideNoAirline, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(named.show, true);

    flightsLayer.setParams({ hideNoAirline: false });
    assert.equal(missing.show, true);
    assert.equal(blank.show, true);
    assert.equal(empty.show, true);
    assert.equal(callsignOnly.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetHideNoAirlineLayers();
  }
});

test('selected / tracked no-airline still draws', () => {
  const selected = emptyBillboard();
  const otherEmpty = emptyBillboard();
  const named = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: liveMeta({
      callsign: 'AAL9',
      airline: null,
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
      callsign: 'SWA2',
      airline: '',
    }),
    billboard: otherEmpty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'aal001',
    meta: liveMeta({ callsign: 'AAL100' }),
    billboard: named,
  });
  try {
    flightsLayer.setParams({ hideNoAirline: true });
    assert.equal(selected.show, true, 'tracked empty-airline contact stays');
    assert.equal(otherEmpty.show, false);
    assert.equal(named.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked empty-airline hides');
    assert.equal(named.show, true);
  } finally {
    resetHideNoAirlineLayers();
  }
});

test('Hide no airline ANDs with 188 / 214 / 222 / 227 / 284 / 294 / 299 and stays distinct from 166 / 188 / 214 / 222 / 227 / 284 / 294 / 299 / hide-ground', () => {
  const highNamed = emptyBillboard();
  const lowNamed = emptyBillboard();
  const callsignOnly = emptyBillboard();
  const airlineOnlyMissingCallsign = emptyBillboard();
  const groundedNamed = emptyBillboard();
  const hexNamed = emptyBillboard();
  const namedMissingReg = emptyBillboard();
  const namedMissingType = emptyBillboard();
  const typedMissingAirline = emptyBillboard();
  const namedMissingTypeName = emptyBillboard();
  const typeNamedMissingAirline = emptyBillboard();
  const categorizedMissingAirline = emptyBillboard();
  const namedMissingCategory = emptyBillboard();
  const timedMissingAirline = emptyBillboard();
  const namedMissingPos = emptyBillboard();
  const emergencyNamed = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'andhigh',
    meta: liveMeta({
      callsign: 'AAL100',
      registration: 'N100AA',
      altitude: 10_000,
      geoAltitudeM: 10_000,
      velocity: 200,
      verticalRate: 0,
    }),
    billboard: highNamed,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andlow',
    meta: liveMeta({
      callsign: 'AAL200',
      registration: 'N200AA',
      true_track: 0,
      altitude: 2000,
      geoAltitudeM: 2000,
      velocity: 80,
      verticalRate: 8,
    }),
    billboard: lowNamed,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andcso',
    meta: liveMeta({
      callsign: 'AAL123',
      registration: 'N1CSO',
      airline: '',
    }),
    billboard: callsignOnly,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andaln',
    meta: liveMeta({
      callsign: null,
      registration: 'N1ALN',
      airline: 'American Airlines',
    }),
    billboard: airlineOnlyMissingCallsign,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andpark',
    meta: liveMeta({
      callsign: 'N123AB',
      registration: 'N123AB',
      typeCode: 'EC35',
      typeName: 'Eurocopter EC135',
      airline: 'American Airlines',
      klass: 'helicopter',
      onGround: true,
      altitude: 0,
      geoAltitudeM: 0,
      velocity: 0,
      verticalRate: 0,
    }),
    billboard: groundedNamed,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhex',
    meta: liveMeta({
      callsign: '',
      registration: '',
      typeCode: 'C172',
      typeName: 'Cessna 172',
      airline: 'American Airlines',
    }),
    billboard: hexNamed,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andreg',
    meta: liveMeta({
      callsign: 'REG9',
      registration: null,
    }),
    billboard: namedMissingReg,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andtyp',
    meta: liveMeta({
      callsign: 'TYP9',
      registration: 'N9TYP',
      typeCode: null,
    }),
    billboard: namedMissingType,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andt2',
    meta: liveMeta({
      callsign: 'T2XX',
      registration: 'N2TYP',
      typeCode: 'B738',
      airline: '',
    }),
    billboard: typedMissingAirline,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andtnm',
    meta: liveMeta({
      callsign: 'TNM9',
      registration: 'N9TNM',
      typeName: '',
    }),
    billboard: namedMissingTypeName,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andtn2',
    meta: liveMeta({
      callsign: 'TN2X',
      registration: 'N2TNM',
      typeName: 'Boeing 737-800',
      airline: '',
    }),
    billboard: typeNamedMissingAirline,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andcat',
    meta: liveMeta({
      callsign: 'CAT9',
      registration: 'N9CAT',
      category: 6,
      airline: '',
    }),
    billboard: categorizedMissingAirline,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andc2',
    meta: liveMeta({
      callsign: 'C2XX',
      registration: 'N2CAT',
      category: 0,
    }),
    billboard: namedMissingCategory,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andpos',
    meta: liveMeta({
      callsign: 'POS9',
      registration: 'N9POS',
      positionEpochMs: FIX_AT,
      airline: '',
    }),
    billboard: timedMissingAirline,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andp2',
    meta: liveMeta({
      callsign: 'P2XX',
      registration: 'N2POS',
      positionEpochMs: null,
    }),
    billboard: namedMissingPos,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andemg',
    meta: liveMeta({
      callsign: 'EMG9',
      registration: 'N9EMG',
      squawk: '7700',
    }),
    billboard: emergencyNamed,
  });
  try {
    flightsLayer.setParams({
      hideNoAirline: false,
      hideNoTypeName: false,
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
    assert.equal(highNamed.show, true);
    assert.equal(callsignOnly.show, true, 'off keeps callsign-only AAL123');
    assert.equal(airlineOnlyMissingCallsign.show, true);
    assert.equal(groundedNamed.show, true, 'off keeps grounded named — not hide-ground');
    assert.equal(emergencyNamed.show, true, 'off keeps airline-bearing 7700 — not Emergencies only');

    flightsLayer.setParams({ hideNoAirline: true });
    assert.equal(highNamed.show, true, 'American Airlines stays — not a callsign chip');
    assert.equal(lowNamed.show, true);
    assert.equal(callsignOnly.show, false, 'callsign present + airline missing hides — distinct from 227');
    assert.equal(airlineOnlyMissingCallsign.show, true, 'named but missing callsign stays — not Hide no callsign');
    assert.equal(groundedNamed.show, true, 'grounded named stays — not hide-ground');
    assert.equal(hexNamed.show, true, 'named hex-only stays — distinct from Identified only (188)');
    assert.equal(namedMissingReg.show, true, 'named but missing reg stays — not Hide no reg (222)');
    assert.equal(namedMissingType.show, true, 'named but missing typeCode stays — not Hide no type (214)');
    assert.equal(typedMissingAirline.show, false, 'typed but missing airline hides — distinct from 214');
    assert.equal(namedMissingTypeName.show, true, 'named but missing typeName stays — not Hide no type name (299)');
    assert.equal(typeNamedMissingAirline.show, false, 'type-named but missing airline hides — distinct from 299');
    assert.equal(categorizedMissingAirline.show, false, 'categorized but missing airline hides — distinct from 284');
    assert.equal(namedMissingCategory.show, true, 'named but category 0 stays — not Hide no category');
    assert.equal(timedMissingAirline.show, false, 'timed but missing airline hides — distinct from 294');
    assert.equal(namedMissingPos.show, true, 'named but missing position time stays — not Hide no position time');
    assert.equal(emergencyNamed.show, true, 'airline-bearing 7700 stays — not Emergencies only (166)');

    flightsLayer.setParams({ hideNoCallsign: true });
    assert.equal(highNamed.show, true, 'AND: named with callsign stays under Hide no callsign');
    assert.equal(airlineOnlyMissingCallsign.show, false, 'AND: Hide no callsign still drops named missing-callsign');
    assert.equal(callsignOnly.show, false, 'AND with hide-no-callsign: callsign present, airline missing still hides');

    flightsLayer.setParams({ hideNoCallsign: false, identifiedOnly: true });
    assert.equal(highNamed.show, true, 'AND: named identified stays under 188');
    assert.equal(hexNamed.show, false, 'AND: Identified only still hides hex-only named');

    flightsLayer.setParams({ identifiedOnly: false, hideNoType: true });
    assert.equal(highNamed.show, true, 'AND: named typed stays under Hide no type');
    assert.equal(namedMissingType.show, false, 'AND: Hide no type still drops named missing-typeCode');
    assert.equal(typedMissingAirline.show, false, 'AND with 214: typeCode present, airline missing still hides');

    flightsLayer.setParams({ hideNoType: false, hideNoReg: true });
    assert.equal(highNamed.show, true, 'AND: named with reg stays under Hide no reg');
    assert.equal(namedMissingReg.show, false, 'AND: Hide no reg still drops named missing-reg');

    flightsLayer.setParams({ hideNoReg: false, hideNoTypeName: true });
    assert.equal(highNamed.show, true, 'AND: named typed-name stays under Hide no type name');
    assert.equal(namedMissingTypeName.show, false, 'AND: Hide no type name still drops named missing-typeName');
    assert.equal(typeNamedMissingAirline.show, false, 'AND with 299: typeName present, airline missing still hides');

    flightsLayer.setParams({ hideNoTypeName: false, hideNoCategory: true });
    assert.equal(highNamed.show, true, 'AND: named categorized stays under Hide no category');
    assert.equal(namedMissingCategory.show, false, 'AND: Hide no category still drops named category 0');
    assert.equal(categorizedMissingAirline.show, false, 'AND: categorized missing-airline still hides');

    flightsLayer.setParams({ hideNoCategory: false, hideNoPositionTime: true });
    assert.equal(highNamed.show, true, 'AND: named timed stays under Hide no position time');
    assert.equal(namedMissingPos.show, false, 'AND: Hide no position time still drops named missing-position-time');
    assert.equal(timedMissingAirline.show, false, 'AND: timed missing-airline still hides');

    flightsLayer.setParams({ hideNoPositionTime: false, emergenciesOnly: true });
    assert.equal(emergencyNamed.show, true, 'AND: Emergencies only keeps airline-bearing 7700');
    assert.equal(highNamed.show, false, 'AND: Emergencies only hides airline-bearing 1200 — distinct from 166');

    flightsLayer.setParams({ emergenciesOnly: false, airborneOnly: true });
    assert.equal(highNamed.show, true);
    assert.equal(groundedNamed.show, false, 'AND: grounded named hides under airborne-only');
  } finally {
    resetHideNoAirlineLayers();
  }
});

test('invalid storage reads as off', () => {
  resetHideNoAirlineForTest();
  assert.equal(HIDE_NO_AIRLINE_STORAGE_KEY, 'meridian.flightHideNoAirline');
  assert.equal(readHideNoAirlineEnabled(memoryStorage()), false);
  assert.equal(readHideNoAirlineEnabled(memoryStorage({ 'meridian.flightHideNoAirline': 'nope' })), false);
  assert.equal(readHideNoAirlineEnabled(memoryStorage({ 'meridian.flightHideNoAirline': 'yes' })), false);
  assert.equal(readHideNoAirlineEnabled({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');
});

test('persist flip survives reload; no share-URL write', () => {
  resetHideNoAirlineForTest();
  const storage = memoryStorage();
  assert.equal(writeHideNoAirlineEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightHideNoAirline': '1' });
  assert.equal(readHideNoAirlineEnabled(storage), true);
  assert.equal(writeHideNoAirlineEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightHideNoAirline'], '0');

  const seen = [];
  const unsubscribe = subscribeHideNoAirlineEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getHideNoAirlineEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightHideNoAirline': '1' });
    assert.equal(hydrateHideNoAirlineEnabled(hydrated), true);
    assert.equal(getHideNoAirlineEnabled(), true);
    assert.equal(setHideNoAirlineEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightHideNoAirline'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetHideNoAirlineForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(Object.hasOwn(defaults, 'hideNoAirline'), false, 'not a share-URL option');
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(Object.hasOwn(omitted.options.flights, 'hideNoAirline'), false);

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { hideNoAirline: true } },
  }));
  assert.doesNotMatch(String(encodedOn.get('lo') || ''), /hideNoAirline/);
  const encodedOff = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: {} },
  }));
  assert.equal(String(encodedOn.get('lo') || ''), String(encodedOff.get('lo') || ''),
    'no share-URL write');

  hydrateHideNoAirlineEnabled(memoryStorage({ 'meridian.flightHideNoAirline': '1' }));
  flightsLayer.setParams({ airborneOnly: false, identifiedOnly: false, emergenciesOnly: false });
  assert.equal(getHideNoAirlineEnabled(), true, 'coordinator-style restore keeps the flip');
  assert.equal(flightsLayer.getParams().hideNoAirline, true);

  flightsLayer.setParams({ hideNoAirline: false });
  assert.equal(flightsLayer.getParams().hideNoAirline, false);
  flightsLayer.setParams({ hideNoAirline: true });
  assert.equal(flightsLayer.getParams().hideNoAirline, true);
  const chips = flightsLayer.getRowControls().chips;
  const chip = chips.find((entry) => entry.id === HIDE_NO_AIRLINE_CHIP_ID);
  const callsignIdx = chips.findIndex((entry) => entry.id === 'hide-no-callsign');
  const airlineIdx = chips.findIndex((entry) => entry.id === HIDE_NO_AIRLINE_CHIP_ID);
  assert.equal(chip.label, HIDE_NO_AIRLINE_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { hideNoAirline: false });
  assert.ok(callsignIdx >= 0 && airlineIdx === callsignIdx + 1, 'Hide no airline sits next to Hide no callsign');
  flightsLayer.setParams({ hideNoAirline: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_AIRLINE_CHIP_ID).active, false);
  resetHideNoAirlineForTest();
});

test('militaryFlights.js and adsbLolFallback.js are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const style = root('style.css');
  const flights = data('flights.js');
  const helper = data('flightHideNoAirlineFilter.js');
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
  const militaryInstallations = data('militaryInstallations.js');
  const aircraftClass = data('aircraftClass.js');
  const manager = data('manager.js');
  assert.doesNotMatch(html, /hide-no-airline|Hide no airline/);
  assert.doesNotMatch(ui, /hideNoAirline|_initHideNoAirline/);
  assert.doesNotMatch(style, /hide-no-airline|hideNoAirline/);
  assert.match(flights, /hideNoAirlineChipModel\(/);
  assert.match(flights, /passesHideNoAirlineFilter/);
  assert.match(flights, /_hideNoAirlineMatcher/);
  assert.match(flights, /airline: prevMeta\?\.airline \?\? null,/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /hideNoAirline|hide-no-airline|flightHideNoAirlineFilter/);
  assert.doesNotMatch(ais, /flightHideNoAirlineFilter|meridian\.flightHideNoAirline/);
  assert.doesNotMatch(adapter, /hideNoAirline|hide-no-airline|flightHideNoAirlineFilter/);
  assert.doesNotMatch(awareness, /hideNoAirline|flightHideNoAirlineFilter/);
  assert.doesNotMatch(launchesPanel, /hideNoAirline|flightHideNoAirlineFilter/);
  assert.doesNotMatch(rocketLaunches, /hideNoAirline|flightHideNoAirlineFilter/);
  assert.doesNotMatch(firmsHeatmap, /hideNoAirline|flightHideNoAirlineFilter/);
  assert.doesNotMatch(firmsList, /hideNoAirline|flightHideNoAirlineFilter/);
  assert.doesNotMatch(damsList, /hideNoAirline|flightHideNoAirlineFilter/);
  assert.doesNotMatch(datacenterList, /hideNoAirline|flightHideNoAirlineFilter/);
  assert.doesNotMatch(militaryInstallations, /hideNoAirline|flightHideNoAirlineFilter/);
  assert.doesNotMatch(aircraftClass, /hideNoAirline|flightHideNoAirlineFilter|hide-no-airline/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.doesNotMatch(helper, /OpenSky|opensky/i);
  assert.match(helper, /airline/);
  assert.match(helper, /American Airlines/);
  assert.match(helper, /meridian\.flightHideNoAirline/);
  assert.match(helper, /not written into the share URL/);
  assert.match(helper, /Hide no callsign \(227/);
  assert.match(helper, /Hide no type name \(299/);
  assert.match(helper, /airborne-only \/ hide-ground/);
  assert.doesNotMatch(helper, /hide-ground chip|add hide-ground/i);
});

test('legal: already-fetched airline only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightHideNoAirlineFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth|OpenSky|opensky/i);
  assert.match(moduleSource, /airline/);
  assert.doesNotMatch(moduleSource, /aircraft\.emergency|ownOp|\bdesc\b/);
});
