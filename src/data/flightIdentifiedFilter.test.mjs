import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  IDENTIFIED_ONLY_CHIP_ID,
  IDENTIFIED_ONLY_CHIP_LABEL,
  IDENTIFIED_ONLY_DEFAULT,
  IDENTIFIED_ONLY_STORAGE_KEY,
  contactHasIdent,
  getIdentifiedOnlyEnabled,
  hydrateIdentifiedOnlyEnabled,
  identifiedOnlyChipModel,
  identityFieldText,
  normalizeIdentifiedOnly,
  passesIdentifiedOnlyFilter,
  readIdentifiedOnlyEnabled,
  resetIdentifiedOnlyForTest,
  setIdentifiedOnlyEnabled,
  subscribeIdentifiedOnlyEnabled,
  writeIdentifiedOnlyEnabled,
} from './flightIdentifiedFilter.js';
import flightsLayer, {
  _addFlightTrackingCandidateForTest,
  _applyOperatorContactVisibilityForTest,
  _setTrackedFlightRefreshStateForTest,
} from './flights.js';
import militaryFlightsLayer, {
  _addMilitaryTrackingCandidateForTest,
  _applyOperatorContactVisibilityForTest as _applyMilitaryVisibilityForTest,
  _setTrackedMilitaryRefreshStateForTest,
} from './militaryFlights.js';
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

function resetIdentifiedOnlyLayers() {
  resetIdentifiedOnlyForTest();
  flightsLayer.setParams({
    identifiedOnly: false,
    airborneOnly: false,
    emergenciesOnly: false,
    callsignPrefixes: '',
    aircraftClassFilter: 'all',
    selectedFlightsTrackingId: null,
  });
  militaryFlightsLayer.setParams({
    identifiedOnly: false,
    airborneOnly: false,
    callsignPrefixes: '',
    aircraftClassFilter: 'all',
    selectedMilitaryTrackingId: null,
  });
  setAltitudeBand('all', { persist: false });
}

test('Identified-only defaults off and treats missing/null/blank/whitespace as empty', () => {
  assert.equal(IDENTIFIED_ONLY_DEFAULT, false);
  assert.equal(IDENTIFIED_ONLY_STORAGE_KEY, 'meridian.flightsIdentifiedOnly');
  assert.equal(normalizeIdentifiedOnly(undefined), false);
  assert.equal(normalizeIdentifiedOnly(null), false);
  assert.equal(normalizeIdentifiedOnly('nope'), false);
  assert.equal(normalizeIdentifiedOnly(false), false);
  assert.equal(normalizeIdentifiedOnly(true), true);
  assert.equal(normalizeIdentifiedOnly('1'), true);

  assert.equal(identityFieldText(undefined), '');
  assert.equal(identityFieldText(null), '');
  assert.equal(identityFieldText(''), '');
  assert.equal(identityFieldText('   '), '');
  assert.equal(identityFieldText('DAL123'), 'DAL123');
  assert.equal(identityFieldText(' N172SP '), 'N172SP');

  assert.equal(contactHasIdent({ callsign: 'abc123', registration: null }), true);
  assert.equal(contactHasIdent({ callsign: '', registration: 'N172SP' }), true);
  assert.equal(contactHasIdent({ callsign: '   ', registration: null }), false);
  assert.equal(contactHasIdent({ callsign: null, registration: '  ' }), false);
  assert.equal(contactHasIdent({}), false);

  const hexOnly = { callsign: '', registration: null };
  const airline = { callsign: 'DAL123', registration: '' };
  const ga = { callsign: '', registration: 'N172SP' };
  const whitespace = { callsign: '   ', registration: '  ' };

  for (const contact of [hexOnly, airline, ga, whitespace]) {
    assert.equal(passesIdentifiedOnlyFilter({ ...contact, identifiedOnly: false }), true);
  }
  assert.equal(passesIdentifiedOnlyFilter({ ...hexOnly, identifiedOnly: true }), false);
  assert.equal(passesIdentifiedOnlyFilter({ ...airline, identifiedOnly: true }), true);
  assert.equal(passesIdentifiedOnlyFilter({ ...ga, identifiedOnly: true }), true);
  assert.equal(passesIdentifiedOnlyFilter({ ...whitespace, identifiedOnly: true }), false);

  const chip = identifiedOnlyChipModel(false);
  assert.equal(chip.label, IDENTIFIED_ONLY_CHIP_LABEL);
  assert.equal(chip.id, IDENTIFIED_ONLY_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { identifiedOnly: true });
  assert.deepEqual(identifiedOnlyChipModel(true).params, { identifiedOnly: false });
});

test('hex-only hides; DAL123 and empty-callsign N172SP stay; off restores', () => {
  const hex = emptyBillboard();
  const dal = emptyBillboard();
  const ga = emptyBillboard();
  const blank = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'a1b2c3',
    meta: { callsign: '', registration: null, klass: 'airliner', onGround: false },
    billboard: hex,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'dal001',
    meta: { callsign: 'DAL123', registration: '', klass: 'airliner', onGround: false },
    billboard: dal,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'ga0001',
    meta: { callsign: '', registration: 'N172SP', klass: 'small', onGround: false },
    billboard: ga,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'ws0001',
    meta: { callsign: '   ', registration: '  ', klass: 'airliner', onGround: false },
    billboard: blank,
  });
  try {
    assert.equal(flightsLayer.getParams().identifiedOnly, false);
    assert.equal(hex.show, true);
    assert.equal(dal.show, true);
    assert.equal(ga.show, true);
    assert.equal(blank.show, true);

    assert.equal(flightsLayer.setParams({ identifiedOnly: true }), true);
    assert.equal(flightsLayer.getParams().identifiedOnly, true);
    assert.equal(hex.show, false, 'hex-only contact hides');
    assert.equal(dal.show, true, 'DAL123 stays');
    assert.equal(ga.show, true, 'empty callsign with registration N172SP stays');
    assert.equal(blank.show, false, 'whitespace-only is empty');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: { klass: 'airliner', onGround: false },
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().identifiedOnly, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(dal.show, true);

    flightsLayer.setParams({ identifiedOnly: false });
    assert.equal(hex.show, true);
    assert.equal(blank.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetIdentifiedOnlyLayers();
  }
});

test('selected hex-only contact stays visible when Identified-only is on', () => {
  const selected = emptyBillboard();
  const otherHex = emptyBillboard();
  const airline = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: { callsign: null, registration: '', klass: 'airliner', onGround: false },
    billboard: selected,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: true,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'othhex',
    meta: { callsign: '', registration: null, klass: 'airliner', onGround: false },
    billboard: otherHex,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'ual001',
    meta: { callsign: 'UAL100', registration: 'N100UA', klass: 'airliner', onGround: false },
    billboard: airline,
  });
  try {
    flightsLayer.setParams({ identifiedOnly: true });
    assert.equal(selected.show, true, 'selected hex-only contact stays');
    assert.equal(otherHex.show, false);
    assert.equal(airline.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked hex-only hides');
    assert.equal(airline.show, true);
  } finally {
    resetIdentifiedOnlyLayers();
  }
});

test('Identified-only ANDs with existing flights filters', () => {
  const lowIdentified = emptyBillboard();
  const highIdentified = emptyBillboard();
  const highHex = emptyBillboard();
  const parkedIdentified = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'andhigh',
    meta: {
      callsign: 'UAL100',
      registration: 'N100UA',
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
    },
    billboard: highIdentified,
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
      klass: 'airliner',
      onGround: false,
      altitude: 2000,
    },
    billboard: lowIdentified,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhex',
    meta: {
      callsign: '',
      registration: null,
      klass: 'airliner',
      onGround: false,
      altitude: 12_000,
    },
    billboard: highHex,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andpark',
    meta: {
      callsign: 'N123AB',
      registration: 'N123AB',
      klass: 'helicopter',
      onGround: true,
      altitude: 0,
    },
    billboard: parkedIdentified,
  });
  try {
    flightsLayer.setParams({
      identifiedOnly: true,
      airborneOnly: false,
      emergenciesOnly: false,
      callsignPrefixes: '',
      aircraftClassFilter: 'all',
    });
    assert.equal(highIdentified.show, true);
    assert.equal(lowIdentified.show, true);
    assert.equal(highHex.show, false);
    assert.equal(parkedIdentified.show, true);

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(highIdentified.show, true);
    assert.equal(parkedIdentified.show, false, 'AND: grounded identified hides under airborne-only');

    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highIdentified.show, true, 'AND: in-band identified remains');
    assert.equal(lowIdentified.show, false, 'AND: identified but out-of-band hides');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ airborneOnly: false, callsignPrefixes: 'UAL' });
    assert.equal(highIdentified.show, true, 'AND: matching identified remains');
    assert.equal(parkedIdentified.show, false, 'AND: prefix still hides a non-UAL identified');

    flightsLayer.setParams({ callsignPrefixes: '', aircraftClassFilter: 'airliner' });
    assert.equal(highIdentified.show, true);
    assert.equal(parkedIdentified.show, false, 'AND: class chip still hides a helo identified');
  } finally {
    resetIdentifiedOnlyLayers();
  }
});

test('Identified-only persists meridian.flightsIdentifiedOnly and flights.identifiedOnly', () => {
  resetIdentifiedOnlyForTest();
  assert.equal(IDENTIFIED_ONLY_STORAGE_KEY, 'meridian.flightsIdentifiedOnly');
  assert.equal(readIdentifiedOnlyEnabled(memoryStorage()), false);
  const storage = memoryStorage();
  assert.equal(writeIdentifiedOnlyEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightsIdentifiedOnly': '1' });
  assert.equal(readIdentifiedOnlyEnabled(storage), true);
  assert.equal(writeIdentifiedOnlyEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightsIdentifiedOnly'], '0');

  const seen = [];
  const unsubscribe = subscribeIdentifiedOnlyEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getIdentifiedOnlyEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightsIdentifiedOnly': '1' });
    assert.equal(hydrateIdentifiedOnlyEnabled(hydrated), true);
    assert.equal(getIdentifiedOnlyEnabled(), true);
    assert.equal(setIdentifiedOnlyEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightsIdentifiedOnly'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetIdentifiedOnlyForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(defaults.identifiedOnly, false);
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(omitted.options.flights.identifiedOnly, false, 'absent token stays OFF');

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { identifiedOnly: true } },
  }));
  assert.match(String(encodedOn.get('lo')), /f\.i\.1/);
  const decoded = decodeLayerStateParams(encodedOn);
  assert.equal(decoded.options.flights.identifiedOnly, true);

  flightsLayer.setParams({ identifiedOnly: false });
  assert.equal(flightsLayer.getParams().identifiedOnly, false);
  flightsLayer.setParams({ identifiedOnly: true });
  assert.equal(flightsLayer.getParams().identifiedOnly, true);
  const chip = flightsLayer.getRowControls().chips.find((entry) => entry.id === IDENTIFIED_ONLY_CHIP_ID);
  assert.equal(chip.label, IDENTIFIED_ONLY_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { identifiedOnly: false });
  flightsLayer.setParams({ identifiedOnly: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === IDENTIFIED_ONLY_CHIP_ID).active, false);
});

test('military Identified-only is a separate persist and chip from civil', () => {
  const hex = emptyBillboard();
  const callsign = emptyBillboard();
  _setTrackedMilitaryRefreshStateForTest({
    icao24: 'ae0001',
    meta: { callsign: '', registration: null, klass: 'airliner', onGround: false },
    billboard: hex,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addMilitaryTrackingCandidateForTest({
    icao24: 'rch001',
    meta: { callsign: 'RCH001', registration: '', klass: 'airliner', onGround: false },
    billboard: callsign,
  });
  try {
    assert.equal(militaryFlightsLayer.getParams().identifiedOnly, false);
    assert.equal(hex.show, true);
    assert.equal(callsign.show, true);

    flightsLayer.setParams({ identifiedOnly: true });
    assert.equal(militaryFlightsLayer.getParams().identifiedOnly, false,
      'civil persist does not arm the military toggle');
    _applyMilitaryVisibilityForTest();
    assert.equal(hex.show, true, 'civil Identified-only does not hide military hexes');
    assert.equal(callsign.show, true);
    assert.equal(
      militaryFlightsLayer.getRowControls().chips.some((entry) => entry.id === IDENTIFIED_ONLY_CHIP_ID),
      true,
      'military row ships its own Identified-only chip',
    );

    militaryFlightsLayer.setParams({ identifiedOnly: true });
    assert.equal(militaryFlightsLayer.getParams().identifiedOnly, true);
    assert.equal(hex.show, false, 'military Identified-only hides hex-only tracks');
    assert.equal(callsign.show, true);
  } finally {
    resetIdentifiedOnlyLayers();
  }
});

test('Identified-only is a flights-row chip: no DISPLAY rail, no new /api', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const flights = data('flights.js');
  const helper = data('flightIdentifiedFilter.js');
  const military = data('militaryFlights.js');
  const awarenessStart = html.indexOf('id="military-awareness-panel"');
  const beforeAwareness = awarenessStart === -1 ? html : html.slice(0, awarenessStart);
  assert.doesNotMatch(beforeAwareness, /identified-only|Identified only/,
    'flights Identified-only stays a data-row chip, not DISPLAY-rail HTML');
  assert.doesNotMatch(ui, /identifiedOnly|_initIdentifiedOnly/);
  assert.match(flights, /identifiedOnlyChipModel\(/);
  assert.match(flights, /passesIdentifiedOnlyFilter/);
  assert.match(flights, /_identifiedOnlyMatcher/);
  assert.match(military, /_identifiedOnlyMatcher/);
  assert.match(military, /passesMilitaryIdentifiedOnlyFilter/);
  assert.match(military, /militaryIdentifiedOnlyChipModel/);
  assert.doesNotMatch(military, /from '\.\/flightIdentifiedFilter\.js'/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.match(helper, /meridian\.flightsIdentifiedOnly/);
});

test('legal: already-fetched fields only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightIdentifiedFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth/i);
  assert.match(moduleSource, /callsign/);
  assert.match(moduleSource, /registration/);
});
