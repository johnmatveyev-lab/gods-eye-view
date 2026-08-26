import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  HIDE_NO_TYPE_CHIP_ID,
  HIDE_NO_TYPE_CHIP_LABEL,
  HIDE_NO_TYPE_DEFAULT,
  HIDE_NO_TYPE_STORAGE_KEY,
  contactHasTypeCode,
  getHideNoTypeEnabled,
  hideNoTypeChipModel,
  hydrateHideNoTypeEnabled,
  normalizeHideNoType,
  passesHideNoTypeFilter,
  readHideNoTypeEnabled,
  resetHideNoTypeForTest,
  setHideNoTypeEnabled,
  subscribeHideNoTypeEnabled,
  typeCodeFieldText,
  writeHideNoTypeEnabled,
} from './flightHideNoTypeFilter.js';
import flightsLayer, {
  _addFlightTrackingCandidateForTest,
  _applyOperatorContactVisibilityForTest,
  _setTrackedFlightRefreshStateForTest,
} from './flights.js';
import { setAltitudeBand } from './flightAltitudeBand.js';
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

function resetHideNoTypeLayers() {
  resetHideNoTypeForTest();
  flightsLayer.setParams({
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
    selectedFlightsTrackingId: null,
  });
  setAltitudeBand('all', { persist: false });
}

test('Hide no type defaults off and treats missing/null/blank/whitespace as empty', () => {
  assert.equal(HIDE_NO_TYPE_DEFAULT, false);
  assert.equal(HIDE_NO_TYPE_STORAGE_KEY, 'meridian.flightHideNoType');
  assert.equal(normalizeHideNoType(undefined), false);
  assert.equal(normalizeHideNoType(null), false);
  assert.equal(normalizeHideNoType('nope'), false);
  assert.equal(normalizeHideNoType(false), false);
  assert.equal(normalizeHideNoType(true), true);
  assert.equal(normalizeHideNoType('1'), true);

  assert.equal(typeCodeFieldText(undefined), '');
  assert.equal(typeCodeFieldText(null), '');
  assert.equal(typeCodeFieldText(''), '');
  assert.equal(typeCodeFieldText('   '), '');
  assert.equal(typeCodeFieldText('B738'), 'B738');
  assert.equal(typeCodeFieldText(' B738 '), 'B738');

  assert.equal(contactHasTypeCode({ typeCode: 'B738' }), true);
  assert.equal(contactHasTypeCode({ typeCode: '   ' }), false);
  assert.equal(contactHasTypeCode({ typeCode: null }), false);
  assert.equal(contactHasTypeCode({}), false);

  const missing = {};
  const empty = { typeCode: null };
  const typed = { typeCode: 'B738' };
  const whitespace = { typeCode: '   ' };

  for (const contact of [missing, empty, typed, whitespace]) {
    assert.equal(passesHideNoTypeFilter({ ...contact, hideNoType: false }), true,
      'off keeps missing typeCode');
  }
  assert.equal(passesHideNoTypeFilter({ ...missing, hideNoType: true }), false);
  assert.equal(passesHideNoTypeFilter({ ...empty, hideNoType: true }), false);
  assert.equal(passesHideNoTypeFilter({ typeCode: '', hideNoType: true }), false);
  assert.equal(passesHideNoTypeFilter({ ...whitespace, hideNoType: true }), false);
  assert.equal(passesHideNoTypeFilter({ ...typed, hideNoType: true }), true);

  const chip = hideNoTypeChipModel(false);
  assert.equal(chip.label, HIDE_NO_TYPE_CHIP_LABEL);
  assert.equal(chip.id, HIDE_NO_TYPE_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoType: true });
  assert.deepEqual(hideNoTypeChipModel(true).params, { hideNoType: false });
});

test('off keeps the current fleet; on hides empty typeCode and keeps B738', () => {
  const missing = emptyBillboard();
  const typed = emptyBillboard();
  const blank = emptyBillboard();
  const empty = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'a1b2c3',
    meta: { callsign: 'DAL123', typeCode: null, klass: 'airliner', onGround: false },
    billboard: missing,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'b73801',
    meta: { callsign: 'UAL100', typeCode: 'B738', klass: 'airliner', onGround: false },
    billboard: typed,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'ws0001',
    meta: { callsign: 'SWA1', typeCode: '   ', klass: 'airliner', onGround: false },
    billboard: blank,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'empty01',
    meta: { callsign: 'N123AB', typeCode: '', klass: 'small', onGround: false },
    billboard: empty,
  });
  try {
    assert.equal(flightsLayer.getParams().hideNoType, false);
    assert.equal(missing.show, true);
    assert.equal(typed.show, true);
    assert.equal(blank.show, true);
    assert.equal(empty.show, true);

    assert.equal(flightsLayer.setParams({ hideNoType: true }), true);
    assert.equal(flightsLayer.getParams().hideNoType, true);
    assert.equal(missing.show, false, 'missing typeCode hides');
    assert.equal(typed.show, true, 'B738 stays');
    assert.equal(blank.show, false, 'whitespace-only is empty');
    assert.equal(empty.show, false, 'empty typeCode hides');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: { klass: 'airliner', onGround: false },
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().hideNoType, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(typed.show, true);

    flightsLayer.setParams({ hideNoType: false });
    assert.equal(missing.show, true);
    assert.equal(blank.show, true);
    assert.equal(empty.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetHideNoTypeLayers();
  }
});

test('tracked contact stays visible when Hide no type is on and it has no typeCode', () => {
  const selected = emptyBillboard();
  const otherEmpty = emptyBillboard();
  const typed = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: { callsign: 'DAL9', typeCode: null, klass: 'airliner', onGround: false },
    billboard: selected,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: true,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'othhex',
    meta: { callsign: 'SWA2', typeCode: '', klass: 'airliner', onGround: false },
    billboard: otherEmpty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'ual001',
    meta: { callsign: 'UAL100', typeCode: 'B738', klass: 'airliner', onGround: false },
    billboard: typed,
  });
  try {
    flightsLayer.setParams({ hideNoType: true });
    assert.equal(selected.show, true, 'tracked empty-type contact stays');
    assert.equal(otherEmpty.show, false);
    assert.equal(typed.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked empty-type hides');
    assert.equal(typed.show, true);
  } finally {
    resetHideNoTypeLayers();
  }
});

test('Hide no type ANDs with other flight chips and stays distinct from 166/188/203/class', () => {
  const lowTyped = emptyBillboard();
  const highTyped = emptyBillboard();
  const highEmpty = emptyBillboard();
  const parkedTyped = emptyBillboard();
  const hexTyped = emptyBillboard();
  const emergencyTyped = emptyBillboard();
  const classFromCategory = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'andhigh',
    meta: {
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
    billboard: highTyped,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andlow',
    meta: {
      callsign: 'UAL200',
      registration: '',
      typeCode: 'B738',
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 2000,
      velocity: 80,
      verticalRate: 8,
    },
    billboard: lowTyped,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhex',
    meta: {
      callsign: 'SWA9',
      registration: 'N9SW',
      typeCode: null,
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
    billboard: parkedTyped,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andvfr',
    meta: {
      callsign: '',
      registration: '',
      typeCode: 'C172',
      squawk: '1200',
      klass: 'small',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: hexTyped,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andemg',
    meta: {
      callsign: '',
      registration: '',
      typeCode: 'B738',
      squawk: '7700',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: emergencyTyped,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andcls',
    meta: {
      callsign: 'N9CLS',
      registration: 'N9CLS',
      typeCode: null,
      squawk: '1200',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
      velocity: 200,
      verticalRate: 0,
    },
    billboard: classFromCategory,
  });
  try {
    flightsLayer.setParams({
      hideNoType: true,
      hideNoSquawk: false,
      identifiedOnly: false,
      airborneOnly: false,
      emergenciesOnly: false,
      callsignPrefixes: '',
      aircraftClassFilter: 'all',
    });
    assert.equal(highTyped.show, true);
    assert.equal(lowTyped.show, true);
    assert.equal(highEmpty.show, false, 'empty typeCode hides while Identified only is off');
    assert.equal(parkedTyped.show, true);
    assert.equal(hexTyped.show, true, 'typed hex-only stays — distinct from Identified only');
    assert.equal(emergencyTyped.show, true, 'typed 7700 stays — Hide no type is not Emergencies only');
    assert.equal(classFromCategory.show, false, 'klass from category is not a typeCode');

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(highTyped.show, true);
    assert.equal(parkedTyped.show, false, 'AND: grounded typed contact hides under airborne-only');

    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highTyped.show, true, 'AND: in-band typed remains');
    assert.equal(lowTyped.show, false, 'AND: typed but out-of-band hides');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ airborneOnly: false, callsignPrefixes: 'UAL' });
    assert.equal(highTyped.show, true, 'AND: matching typed remains');
    assert.equal(parkedTyped.show, false, 'AND: prefix still hides a non-UAL typed');

    flightsLayer.setParams({ callsignPrefixes: '', aircraftClassFilter: 'airliner' });
    assert.equal(highTyped.show, true);
    assert.equal(parkedTyped.show, false, 'AND: class chip still hides a helo typed');

    flightsLayer.setParams({ aircraftClassFilter: 'all', speedMinKt: 200, speedMaxKt: null });
    assert.equal(highTyped.show, true, 'AND: in-band speed remains');
    assert.equal(lowTyped.show, false, 'AND: typed but below speed floor hides');

    flightsLayer.setParams({ speedMinKt: null, showClimb: false, showLevel: true, showDescent: true });
    assert.equal(highTyped.show, true, 'AND: level typed remains');
    assert.equal(lowTyped.show, false, 'AND: climbing typed hides when climb is off');

    flightsLayer.setParams({ showClimb: true, identifiedOnly: true });
    assert.equal(highTyped.show, true);
    assert.equal(hexTyped.show, false, 'AND: Identified only still hides hex-only typed');
    assert.equal(emergencyTyped.show, false, 'AND: Identified only still hides hex-only 7700 typed');
    assert.equal(highEmpty.show, false);

    flightsLayer.setParams({ identifiedOnly: false, emergenciesOnly: true });
    assert.equal(emergencyTyped.show, true, 'AND: Emergencies only keeps typed 7700');
    assert.equal(highTyped.show, false, 'AND: Emergencies only hides typed 1200 — distinct from Hide no type');

    flightsLayer.setParams({ emergenciesOnly: false, hideNoSquawk: true });
    assert.equal(highTyped.show, true, 'AND: typed 1200 stays under Hide no squawk');
    assert.equal(highEmpty.show, false, 'AND: empty typeCode still hides');
  } finally {
    resetHideNoTypeLayers();
  }
});

test('invalid storage reads as off; persist flip survives reload', () => {
  resetHideNoTypeForTest();
  assert.equal(HIDE_NO_TYPE_STORAGE_KEY, 'meridian.flightHideNoType');
  assert.equal(readHideNoTypeEnabled(memoryStorage()), false);
  assert.equal(readHideNoTypeEnabled(memoryStorage({ 'meridian.flightHideNoType': 'nope' })), false);
  assert.equal(readHideNoTypeEnabled(memoryStorage({ 'meridian.flightHideNoType': 'yes' })), false);
  assert.equal(readHideNoTypeEnabled({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');

  const storage = memoryStorage();
  assert.equal(writeHideNoTypeEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightHideNoType': '1' });
  assert.equal(readHideNoTypeEnabled(storage), true);
  assert.equal(writeHideNoTypeEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightHideNoType'], '0');

  const seen = [];
  const unsubscribe = subscribeHideNoTypeEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getHideNoTypeEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightHideNoType': '1' });
    assert.equal(hydrateHideNoTypeEnabled(hydrated), true);
    assert.equal(getHideNoTypeEnabled(), true);
    assert.equal(setHideNoTypeEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightHideNoType'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetHideNoTypeForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(Object.hasOwn(defaults, 'hideNoType'), false, 'not a share-URL option');
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(Object.hasOwn(omitted.options.flights, 'hideNoType'), false);

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { hideNoType: true } },
  }));
  assert.doesNotMatch(String(encodedOn.get('lo') || ''), /hideNoType/);
  const encodedOff = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: {} },
  }));
  assert.equal(String(encodedOn.get('lo') || ''), String(encodedOff.get('lo') || ''),
    'no share-URL write');

  hydrateHideNoTypeEnabled(memoryStorage({ 'meridian.flightHideNoType': '1' }));
  flightsLayer.setParams({ airborneOnly: false, identifiedOnly: false, emergenciesOnly: false });
  assert.equal(getHideNoTypeEnabled(), true, 'coordinator-style restore keeps the flip');
  assert.equal(flightsLayer.getParams().hideNoType, true);

  flightsLayer.setParams({ hideNoType: false });
  assert.equal(flightsLayer.getParams().hideNoType, false);
  flightsLayer.setParams({ hideNoType: true });
  assert.equal(flightsLayer.getParams().hideNoType, true);
  const chip = flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_TYPE_CHIP_ID);
  assert.equal(chip.label, HIDE_NO_TYPE_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { hideNoType: false });
  flightsLayer.setParams({ hideNoType: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_TYPE_CHIP_ID).active, false);
  resetHideNoTypeForTest();
});

test('Hide no type is a flights-row chip: no DISPLAY rail, no new /api, military and adapter unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const flights = data('flights.js');
  const helper = data('flightHideNoTypeFilter.js');
  const military = data('militaryFlights.js');
  const adapter = data('adsbLolFallback.js');
  const manager = data('manager.js');
  assert.doesNotMatch(html, /hide-no-type|Hide no type/);
  assert.doesNotMatch(ui, /hideNoType|_initHideNoType/);
  assert.match(flights, /hideNoTypeChipModel\(/);
  assert.match(flights, /passesHideNoTypeFilter/);
  assert.match(flights, /_hideNoTypeMatcher/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /hideNoType|hide-no-type|flightHideNoTypeFilter/);
  assert.doesNotMatch(adapter, /hideNoType|hide-no-type|flightHideNoTypeFilter|typeCode/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.doesNotMatch(helper, /originCountry/);
  assert.match(helper, /meridian\.flightHideNoType/);
  assert.match(helper, /not written into the share URL/);
});

test('legal: already-fetched typeCode only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightHideNoTypeFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth/i);
  assert.match(moduleSource, /typeCode/);
});
