import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  HIDE_NO_TYPE_NAME_CHIP_ID,
  HIDE_NO_TYPE_NAME_CHIP_LABEL,
  HIDE_NO_TYPE_NAME_DEFAULT,
  HIDE_NO_TYPE_NAME_STORAGE_KEY,
  contactHasTypeName,
  getHideNoTypeNameEnabled,
  hideNoTypeNameChipModel,
  hydrateHideNoTypeNameEnabled,
  normalizeHideNoTypeName,
  passesHideNoTypeNameFilter,
  readHideNoTypeNameEnabled,
  resetHideNoTypeNameForTest,
  setHideNoTypeNameEnabled,
  subscribeHideNoTypeNameEnabled,
  typeNameFieldText,
  writeHideNoTypeNameEnabled,
} from './flightHideNoTypeNameFilter.js';
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

function resetHideNoTypeNameLayers() {
  resetHideNoTypeNameForTest();
  setHeadingSectors('NESW');
  flightsLayer.setParams({
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
    callsign: 'UAL100',
    registration: 'N100UA',
    typeCode: 'B738',
    typeName: 'Boeing 737-800',
    squawk: '1200',
    klass: 'airliner',
    onGround: false,
    lastContactEpochMs: FIX_AT,
    category: 6,
    positionEpochMs: FIX_AT,
    ...extra,
  };
}

test('Hide no type name defaults off and treats missing/null/blank/whitespace as empty', () => {
  assert.equal(HIDE_NO_TYPE_NAME_DEFAULT, false);
  assert.equal(HIDE_NO_TYPE_NAME_STORAGE_KEY, 'meridian.flightHideNoTypeName');
  assert.equal(normalizeHideNoTypeName(undefined), false);
  assert.equal(normalizeHideNoTypeName(null), false);
  assert.equal(normalizeHideNoTypeName('nope'), false);
  assert.equal(normalizeHideNoTypeName(false), false);
  assert.equal(normalizeHideNoTypeName(true), true);
  assert.equal(normalizeHideNoTypeName('1'), true);

  assert.equal(typeNameFieldText(undefined), '');
  assert.equal(typeNameFieldText(null), '');
  assert.equal(typeNameFieldText(''), '');
  assert.equal(typeNameFieldText('   '), '');
  assert.equal(typeNameFieldText('Boeing 737-800'), 'Boeing 737-800');
  assert.equal(typeNameFieldText(' Boeing 737-800 '), 'Boeing 737-800');

  assert.equal(contactHasTypeName({ typeName: 'Boeing 737-800' }), true);
  assert.equal(contactHasTypeName({ typeName: '   ' }), false);
  assert.equal(contactHasTypeName({ typeName: null }), false);
  assert.equal(contactHasTypeName({}), false);

  const missing = {};
  const empty = { typeName: null };
  const named = { typeName: 'Boeing 737-800' };
  const whitespace = { typeName: '   ' };
  const typeCodeOnly = { typeCode: 'B738', typeName: '' };

  for (const contact of [missing, empty, named, whitespace, typeCodeOnly]) {
    assert.equal(passesHideNoTypeNameFilter({ ...contact, hideNoTypeName: false }), true,
      'off keeps missing typeName');
  }
  assert.equal(passesHideNoTypeNameFilter({ ...missing, hideNoTypeName: true }), false);
  assert.equal(passesHideNoTypeNameFilter({ ...empty, hideNoTypeName: true }), false);
  assert.equal(passesHideNoTypeNameFilter({ typeName: '', hideNoTypeName: true }), false);
  assert.equal(passesHideNoTypeNameFilter({ ...whitespace, hideNoTypeName: true }), false);
  assert.equal(passesHideNoTypeNameFilter({ ...typeCodeOnly, hideNoTypeName: true }), false,
    'typeCode-only B738 still hides — distinct from 214');
  assert.equal(passesHideNoTypeNameFilter({ ...named, hideNoTypeName: true }), true);

  const chip = hideNoTypeNameChipModel(false);
  assert.equal(chip.label, HIDE_NO_TYPE_NAME_CHIP_LABEL);
  assert.equal(chip.id, HIDE_NO_TYPE_NAME_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoTypeName: true });
  assert.deepEqual(hideNoTypeNameChipModel(true).params, { hideNoTypeName: false });
});

test('off keeps the current fleet including missing typeName; on hides typeCode-only B738 and keeps Boeing 737-800', () => {
  const missing = emptyBillboard();
  const named = emptyBillboard();
  const blank = emptyBillboard();
  const empty = emptyBillboard();
  const typeCodeOnly = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'a1b2c3',
    meta: liveMeta({ callsign: 'DAL123', typeName: null }),
    billboard: missing,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'b73801',
    meta: liveMeta({ callsign: 'UAL100' }),
    billboard: named,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'ws0001',
    meta: liveMeta({ callsign: 'SWA1', typeName: '   ' }),
    billboard: blank,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'empty01',
    meta: liveMeta({ callsign: 'N123AB', typeName: '' }),
    billboard: empty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'tcode01',
    meta: liveMeta({ callsign: 'AAL1', typeCode: 'B738', typeName: '' }),
    billboard: typeCodeOnly,
  });
  try {
    assert.equal(flightsLayer.getParams().hideNoTypeName, false);
    assert.equal(missing.show, true);
    assert.equal(named.show, true);
    assert.equal(blank.show, true);
    assert.equal(empty.show, true);
    assert.equal(typeCodeOnly.show, true);

    assert.equal(flightsLayer.setParams({ hideNoTypeName: true }), true);
    assert.equal(flightsLayer.getParams().hideNoTypeName, true);
    assert.equal(missing.show, false, 'missing typeName hides');
    assert.equal(named.show, true, 'Boeing 737-800 stays');
    assert.equal(blank.show, false, 'whitespace-only is empty');
    assert.equal(empty.show, false, 'empty typeName hides');
    assert.equal(typeCodeOnly.show, false, 'typeCode-only B738 hides');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: liveMeta({ klass: 'airliner', typeName: undefined }),
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().hideNoTypeName, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(named.show, true);

    flightsLayer.setParams({ hideNoTypeName: false });
    assert.equal(missing.show, true);
    assert.equal(blank.show, true);
    assert.equal(empty.show, true);
    assert.equal(typeCodeOnly.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetHideNoTypeNameLayers();
  }
});

test('selected / tracked no-type-name still draws', () => {
  const selected = emptyBillboard();
  const otherEmpty = emptyBillboard();
  const named = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: liveMeta({
      callsign: 'DAL9',
      typeName: null,
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
      typeName: '',
    }),
    billboard: otherEmpty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'ual001',
    meta: liveMeta({ callsign: 'UAL100' }),
    billboard: named,
  });
  try {
    flightsLayer.setParams({ hideNoTypeName: true });
    assert.equal(selected.show, true, 'tracked empty-type-name contact stays');
    assert.equal(otherEmpty.show, false);
    assert.equal(named.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked empty-type-name hides');
    assert.equal(named.show, true);
  } finally {
    resetHideNoTypeNameLayers();
  }
});

test('Hide no type name ANDs with hide-no-type and 188 / 222 / 227 / 284 / 294 and stays distinct from 214 / 188 / 222 / 227 / 284 / 294 / hide-ground', () => {
  const highNamed = emptyBillboard();
  const lowNamed = emptyBillboard();
  const typeCodeOnly = emptyBillboard();
  const nameOnlyMissingType = emptyBillboard();
  const groundedNamed = emptyBillboard();
  const hexNamed = emptyBillboard();
  const namedMissingReg = emptyBillboard();
  const namedMissingCallsign = emptyBillboard();
  const categorizedMissingName = emptyBillboard();
  const namedMissingCategory = emptyBillboard();
  const timedMissingName = emptyBillboard();
  const namedMissingPos = emptyBillboard();
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
    billboard: highNamed,
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
    billboard: lowNamed,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andtco',
    meta: liveMeta({
      callsign: 'TCO1',
      registration: 'N1TCO',
      typeCode: 'B738',
      typeName: '',
    }),
    billboard: typeCodeOnly,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andtnm',
    meta: liveMeta({
      callsign: 'TNM1',
      registration: 'N1TNM',
      typeCode: null,
      typeName: 'Boeing 737-800',
    }),
    billboard: nameOnlyMissingType,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andpark',
    meta: liveMeta({
      callsign: 'N123AB',
      registration: 'N123AB',
      typeCode: 'EC35',
      typeName: 'Eurocopter EC135',
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
    icao24: 'andcsn',
    meta: liveMeta({
      callsign: null,
      registration: 'N9CSN',
    }),
    billboard: namedMissingCallsign,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andcat',
    meta: liveMeta({
      callsign: 'CAT9',
      registration: 'N9CAT',
      category: 6,
      typeName: '',
    }),
    billboard: categorizedMissingName,
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
      typeName: '',
    }),
    billboard: timedMissingName,
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
  try {
    flightsLayer.setParams({
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
    assert.equal(typeCodeOnly.show, true, 'off keeps typeCode-only B738');
    assert.equal(nameOnlyMissingType.show, true);
    assert.equal(groundedNamed.show, true, 'off keeps grounded named — not hide-ground');

    flightsLayer.setParams({ hideNoTypeName: true });
    assert.equal(highNamed.show, true, 'Boeing 737-800 stays — not a typeCode chip');
    assert.equal(lowNamed.show, true);
    assert.equal(typeCodeOnly.show, false, 'typeCode present + typeName missing hides — distinct from 214');
    assert.equal(nameOnlyMissingType.show, true, 'named but missing typeCode stays — not Hide no type');
    assert.equal(groundedNamed.show, true, 'grounded named stays — not hide-ground');
    assert.equal(hexNamed.show, true, 'named hex-only stays — distinct from Identified only (188)');
    assert.equal(namedMissingReg.show, true, 'named but missing reg stays — not Hide no reg (222)');
    assert.equal(namedMissingCallsign.show, true, 'named but missing callsign stays — not Hide no callsign (227)');
    assert.equal(categorizedMissingName.show, false, 'categorized but missing typeName hides — distinct from 284');
    assert.equal(namedMissingCategory.show, true, 'named but category 0 stays — not Hide no category');
    assert.equal(timedMissingName.show, false, 'timed but missing typeName hides — distinct from 294');
    assert.equal(namedMissingPos.show, true, 'named but missing position time stays — not Hide no position time');

    flightsLayer.setParams({ hideNoType: true });
    assert.equal(highNamed.show, true, 'AND: named typed stays under Hide no type');
    assert.equal(nameOnlyMissingType.show, false, 'AND: Hide no type still drops named missing-typeCode');
    assert.equal(typeCodeOnly.show, false, 'AND with hide-no-type: typeCode present, typeName missing still hides');

    flightsLayer.setParams({ hideNoType: false, identifiedOnly: true });
    assert.equal(highNamed.show, true, 'AND: named identified stays under 188');
    assert.equal(hexNamed.show, false, 'AND: Identified only still hides hex-only named');

    flightsLayer.setParams({ identifiedOnly: false, hideNoReg: true });
    assert.equal(highNamed.show, true, 'AND: named with reg stays under Hide no reg');
    assert.equal(namedMissingReg.show, false, 'AND: Hide no reg still drops named missing-reg');

    flightsLayer.setParams({ hideNoReg: false, hideNoCallsign: true });
    assert.equal(highNamed.show, true, 'AND: named with callsign stays under Hide no callsign');
    assert.equal(namedMissingCallsign.show, false, 'AND: Hide no callsign still drops named missing-callsign');

    flightsLayer.setParams({ hideNoCallsign: false, hideNoCategory: true });
    assert.equal(highNamed.show, true, 'AND: named categorized stays under Hide no category');
    assert.equal(namedMissingCategory.show, false, 'AND: Hide no category still drops named category 0');
    assert.equal(categorizedMissingName.show, false, 'AND: categorized missing-typeName still hides');

    flightsLayer.setParams({ hideNoCategory: false, hideNoPositionTime: true });
    assert.equal(highNamed.show, true, 'AND: named timed stays under Hide no position time');
    assert.equal(namedMissingPos.show, false, 'AND: Hide no position time still drops named missing-position-time');
    assert.equal(timedMissingName.show, false, 'AND: timed missing-typeName still hides');

    flightsLayer.setParams({ hideNoPositionTime: false, airborneOnly: true });
    assert.equal(highNamed.show, true);
    assert.equal(groundedNamed.show, false, 'AND: grounded named hides under airborne-only');
  } finally {
    resetHideNoTypeNameLayers();
  }
});

test('invalid storage reads as off', () => {
  resetHideNoTypeNameForTest();
  assert.equal(HIDE_NO_TYPE_NAME_STORAGE_KEY, 'meridian.flightHideNoTypeName');
  assert.equal(readHideNoTypeNameEnabled(memoryStorage()), false);
  assert.equal(readHideNoTypeNameEnabled(memoryStorage({ 'meridian.flightHideNoTypeName': 'nope' })), false);
  assert.equal(readHideNoTypeNameEnabled(memoryStorage({ 'meridian.flightHideNoTypeName': 'yes' })), false);
  assert.equal(readHideNoTypeNameEnabled({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');
});

test('persist flip survives reload; no share-URL write', () => {
  resetHideNoTypeNameForTest();
  const storage = memoryStorage();
  assert.equal(writeHideNoTypeNameEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightHideNoTypeName': '1' });
  assert.equal(readHideNoTypeNameEnabled(storage), true);
  assert.equal(writeHideNoTypeNameEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightHideNoTypeName'], '0');

  const seen = [];
  const unsubscribe = subscribeHideNoTypeNameEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getHideNoTypeNameEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightHideNoTypeName': '1' });
    assert.equal(hydrateHideNoTypeNameEnabled(hydrated), true);
    assert.equal(getHideNoTypeNameEnabled(), true);
    assert.equal(setHideNoTypeNameEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightHideNoTypeName'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetHideNoTypeNameForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(Object.hasOwn(defaults, 'hideNoTypeName'), false, 'not a share-URL option');
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(Object.hasOwn(omitted.options.flights, 'hideNoTypeName'), false);

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { hideNoTypeName: true } },
  }));
  assert.doesNotMatch(String(encodedOn.get('lo') || ''), /hideNoTypeName/);
  const encodedOff = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: {} },
  }));
  assert.equal(String(encodedOn.get('lo') || ''), String(encodedOff.get('lo') || ''),
    'no share-URL write');

  hydrateHideNoTypeNameEnabled(memoryStorage({ 'meridian.flightHideNoTypeName': '1' }));
  flightsLayer.setParams({ airborneOnly: false, identifiedOnly: false, emergenciesOnly: false });
  assert.equal(getHideNoTypeNameEnabled(), true, 'coordinator-style restore keeps the flip');
  assert.equal(flightsLayer.getParams().hideNoTypeName, true);

  flightsLayer.setParams({ hideNoTypeName: false });
  assert.equal(flightsLayer.getParams().hideNoTypeName, false);
  flightsLayer.setParams({ hideNoTypeName: true });
  assert.equal(flightsLayer.getParams().hideNoTypeName, true);
  const chips = flightsLayer.getRowControls().chips;
  const chip = chips.find((entry) => entry.id === HIDE_NO_TYPE_NAME_CHIP_ID);
  const typeIdx = chips.findIndex((entry) => entry.id === 'hide-no-type');
  const nameIdx = chips.findIndex((entry) => entry.id === HIDE_NO_TYPE_NAME_CHIP_ID);
  assert.equal(chip.label, HIDE_NO_TYPE_NAME_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { hideNoTypeName: false });
  assert.ok(typeIdx >= 0 && nameIdx === typeIdx + 1, 'Hide no type name sits next to Hide no type');
  flightsLayer.setParams({ hideNoTypeName: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_TYPE_NAME_CHIP_ID).active, false);
  resetHideNoTypeNameForTest();
});

test('militaryFlights.js and adsbLolFallback.js are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const style = root('style.css');
  const flights = data('flights.js');
  const helper = data('flightHideNoTypeNameFilter.js');
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
  assert.doesNotMatch(html, /hide-no-type-name|Hide no type name/);
  assert.doesNotMatch(ui, /hideNoTypeName|_initHideNoTypeName/);
  assert.doesNotMatch(style, /hide-no-type-name|hideNoTypeName/);
  assert.match(flights, /hideNoTypeNameChipModel\(/);
  assert.match(flights, /passesHideNoTypeNameFilter/);
  assert.match(flights, /_hideNoTypeNameMatcher/);
  assert.match(flights, /typeName: prevMeta\?\.typeName \?\? null,/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /hideNoTypeName|hide-no-type-name|flightHideNoTypeNameFilter/);
  assert.doesNotMatch(ais, /flightHideNoTypeNameFilter|meridian\.flightHideNoTypeName/);
  assert.doesNotMatch(adapter, /hideNoTypeName|hide-no-type-name|flightHideNoTypeNameFilter/);
  assert.doesNotMatch(awareness, /hideNoTypeName|flightHideNoTypeNameFilter/);
  assert.doesNotMatch(launchesPanel, /hideNoTypeName|flightHideNoTypeNameFilter/);
  assert.doesNotMatch(rocketLaunches, /hideNoTypeName|flightHideNoTypeNameFilter/);
  assert.doesNotMatch(firmsHeatmap, /hideNoTypeName|flightHideNoTypeNameFilter/);
  assert.doesNotMatch(firmsList, /hideNoTypeName|flightHideNoTypeNameFilter/);
  assert.doesNotMatch(damsList, /hideNoTypeName|flightHideNoTypeNameFilter/);
  assert.doesNotMatch(datacenterList, /hideNoTypeName|flightHideNoTypeNameFilter/);
  assert.doesNotMatch(militaryInstallations, /hideNoTypeName|flightHideNoTypeNameFilter/);
  assert.doesNotMatch(aircraftClass, /hideNoTypeName|flightHideNoTypeNameFilter|hide-no-type-name/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.doesNotMatch(helper, /OpenSky|opensky/i);
  assert.match(helper, /typeName/);
  assert.match(helper, /Boeing 737-800/);
  assert.match(helper, /meridian\.flightHideNoTypeName/);
  assert.match(helper, /not written into the share URL/);
  assert.match(helper, /Hide no type \(214/);
  assert.match(helper, /Hide no position time \(294/);
  assert.match(helper, /airborne-only \/ hide-ground/);
  assert.doesNotMatch(helper, /hide-ground chip|add hide-ground/i);
});

test('legal: already-fetched typeName only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightHideNoTypeNameFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth|OpenSky|opensky/i);
  assert.match(moduleSource, /typeName/);
  assert.doesNotMatch(moduleSource, /aircraft\.emergency|ownOp|\bdesc\b/);
});
