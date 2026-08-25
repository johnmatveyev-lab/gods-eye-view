// PLAN 195 — Military Identified-only toggle. Client-only filter of
// already-fetched military contacts. Distinct from civil Plan 188
// (meridian.flightsIdentifiedOnly / flights.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  MILITARY_FLIGHTS_IDENTIFIED_ONLY_STORAGE_KEY,
  MILITARY_IDENTIFIED_ONLY_CHIP_ID,
  MILITARY_IDENTIFIED_ONLY_CHIP_LABEL,
  MILITARY_IDENTIFIED_ONLY_DEFAULT,
  filterMilitaryContactsByIdentifiedOnly,
  getMilitaryFlightsIdentifiedOnly,
  hydrateMilitaryFlightsIdentifiedOnly,
  identityFieldText,
  militaryContactHasIdent,
  militaryIdentifiedOnlyChipModel,
  normalizeMilitaryIdentifiedOnly,
  passesMilitaryIdentifiedOnlyFilter,
  readMilitaryFlightsIdentifiedOnly,
  resetMilitaryFlightsIdentifiedOnlyForTest,
  setMilitaryFlightsIdentifiedOnly,
  subscribeMilitaryFlightsIdentifiedOnly,
  writeMilitaryFlightsIdentifiedOnly,
} from './militaryFlightIdentifiedFilter.js';
import militaryFlightsLayer, {
  _addMilitaryTrackingCandidateForTest,
  _applyOperatorContactVisibilityForTest,
  _setTrackedMilitaryRefreshStateForTest,
} from './militaryFlights.js';
import { setAltitudeBand } from './flightAltitudeBand.js';
import { contactPassesInFlightFilters } from './flightSpeedBand.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (name) => readFileSync(path.join(ROOT, 'src', name), 'utf8');
const data = (name) => readFileSync(path.join(ROOT, 'src/data', name), 'utf8');
const root = (name) => readFileSync(path.join(ROOT, name), 'utf8');

const MIXED = Object.freeze([
  { icao24: 'hex001', callsign: '', registration: null, klass: 'airliner', onGround: false, altitudeFt: 37000 },
  { icao24: 'rch001', callsign: 'RCH123', registration: '', klass: 'airliner', onGround: false, altitudeFt: 37000 },
  { icao24: 'tail01', callsign: '', registration: '05-8152', klass: 'airliner', onGround: false, altitudeFt: 3500 },
  { icao24: 'ws0001', callsign: '   ', registration: '  ', klass: 'airliner', onGround: false, altitudeFt: 37000 },
  { icao24: 'park01', callsign: 'HMX001', registration: '86-0036', klass: 'helicopter', onGround: true, altitudeFt: 0 },
]);

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

function resetMilitaryIdentifiedOnlyLayer() {
  resetMilitaryFlightsIdentifiedOnlyForTest();
  militaryFlightsLayer.setParams({
    identifiedOnly: false,
    airborneOnly: false,
    callsignPrefixes: '',
    aircraftClassFilter: 'all',
    showClimb: true,
    showLevel: true,
    showDescent: true,
    selectedMilitaryTrackingId: null,
  });
  setAltitudeBand('all', { persist: false });
}

test('Identified-only defaults off and treats missing/null/blank/whitespace as empty', () => {
  assert.equal(MILITARY_IDENTIFIED_ONLY_DEFAULT, false);
  assert.equal(MILITARY_FLIGHTS_IDENTIFIED_ONLY_STORAGE_KEY, 'meridian.militaryFlightsIdentifiedOnly');
  assert.notEqual(MILITARY_FLIGHTS_IDENTIFIED_ONLY_STORAGE_KEY, 'meridian.flightsIdentifiedOnly');
  assert.equal(normalizeMilitaryIdentifiedOnly(undefined), false);
  assert.equal(normalizeMilitaryIdentifiedOnly(null), false);
  assert.equal(normalizeMilitaryIdentifiedOnly('nope'), false);
  assert.equal(normalizeMilitaryIdentifiedOnly(false), false);
  assert.equal(normalizeMilitaryIdentifiedOnly(true), true);
  assert.equal(normalizeMilitaryIdentifiedOnly('1'), true);

  assert.equal(identityFieldText(undefined), '');
  assert.equal(identityFieldText(null), '');
  assert.equal(identityFieldText(''), '');
  assert.equal(identityFieldText('   '), '');
  assert.equal(identityFieldText('RCH123'), 'RCH123');
  assert.equal(identityFieldText(' 05-8152 '), '05-8152');

  assert.equal(militaryContactHasIdent({ callsign: 'RCH123', registration: null }), true);
  assert.equal(militaryContactHasIdent({ callsign: '', registration: '05-8152' }), true);
  assert.equal(militaryContactHasIdent({ callsign: '   ', registration: null }), false);
  assert.equal(militaryContactHasIdent({ callsign: null, registration: '  ' }), false);
  assert.equal(militaryContactHasIdent({}), false);

  for (const contact of MIXED) {
    assert.equal(passesMilitaryIdentifiedOnlyFilter({ ...contact, identifiedOnly: false }), true);
  }
  assert.equal(passesMilitaryIdentifiedOnlyFilter({ ...MIXED[0], identifiedOnly: true }), false);
  assert.equal(passesMilitaryIdentifiedOnlyFilter({ ...MIXED[1], identifiedOnly: true }), true);
  assert.equal(passesMilitaryIdentifiedOnlyFilter({ ...MIXED[2], identifiedOnly: true }), true);
  assert.equal(passesMilitaryIdentifiedOnlyFilter({ ...MIXED[3], identifiedOnly: true }), false);

  assert.deepEqual(
    filterMilitaryContactsByIdentifiedOnly(MIXED, false).map((row) => row.icao24),
    MIXED.map((row) => row.icao24),
  );
  assert.deepEqual(
    filterMilitaryContactsByIdentifiedOnly(MIXED, true).map((row) => row.icao24),
    ['rch001', 'tail01', 'park01'],
  );
  assert.deepEqual(filterMilitaryContactsByIdentifiedOnly(null), []);

  const chip = militaryIdentifiedOnlyChipModel(false);
  assert.equal(chip.label, MILITARY_IDENTIFIED_ONLY_CHIP_LABEL);
  assert.equal(chip.id, MILITARY_IDENTIFIED_ONLY_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { identifiedOnly: true });
  assert.deepEqual(militaryIdentifiedOnlyChipModel(true).params, { identifiedOnly: false });
});

test('hex-only hides; RCH123 and empty-callsign tail stay; off restores', () => {
  const hex = emptyBillboard();
  const rch = emptyBillboard();
  const tail = emptyBillboard();
  const blank = emptyBillboard();
  _setTrackedMilitaryRefreshStateForTest({
    icao24: 'hex001',
    meta: { callsign: '', registration: null, klass: 'airliner', onGround: false },
    billboard: hex,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addMilitaryTrackingCandidateForTest({
    icao24: 'rch001',
    meta: { callsign: 'RCH123', registration: '', klass: 'airliner', onGround: false },
    billboard: rch,
  });
  _addMilitaryTrackingCandidateForTest({
    icao24: 'tail01',
    meta: { callsign: '', registration: '05-8152', klass: 'airliner', onGround: false },
    billboard: tail,
  });
  _addMilitaryTrackingCandidateForTest({
    icao24: 'ws0001',
    meta: { callsign: '   ', registration: '  ', klass: 'airliner', onGround: false },
    billboard: blank,
  });
  try {
    assert.equal(militaryFlightsLayer.getParams().identifiedOnly, false);
    assert.equal(hex.show, true);
    assert.equal(rch.show, true);
    assert.equal(tail.show, true);
    assert.equal(blank.show, true);

    assert.equal(militaryFlightsLayer.setParams({ identifiedOnly: true }), true);
    assert.equal(militaryFlightsLayer.getParams().identifiedOnly, true);
    assert.equal(hex.show, false, 'hex-only mil contact hides');
    assert.equal(rch.show, true, 'RCH123 stays');
    assert.equal(tail.show, true, 'empty callsign with a tail stays');
    assert.equal(blank.show, false, 'whitespace-only is empty');

    const extra = emptyBillboard();
    _addMilitaryTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: { klass: 'airliner', onGround: false },
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(militaryFlightsLayer.getParams().identifiedOnly, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(rch.show, true);

    militaryFlightsLayer.setParams({ identifiedOnly: false });
    assert.equal(hex.show, true);
    assert.equal(blank.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetMilitaryIdentifiedOnlyLayer();
  }
});

test('selected hex-only military contact stays visible when Identified-only is on', () => {
  const selected = emptyBillboard();
  const otherHex = emptyBillboard();
  const tanker = emptyBillboard();
  _setTrackedMilitaryRefreshStateForTest({
    icao24: 'selhex',
    meta: { callsign: null, registration: '', klass: 'airliner', onGround: false },
    billboard: selected,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: true,
  });
  _addMilitaryTrackingCandidateForTest({
    icao24: 'othhex',
    meta: { callsign: '', registration: null, klass: 'airliner', onGround: false },
    billboard: otherHex,
  });
  _addMilitaryTrackingCandidateForTest({
    icao24: 'rch100',
    meta: { callsign: 'RCH100', registration: '62-3578', klass: 'airliner', onGround: false },
    billboard: tanker,
  });
  try {
    militaryFlightsLayer.setParams({ identifiedOnly: true });
    assert.equal(selected.show, true, 'selected hex-only contact stays');
    assert.equal(otherHex.show, false);
    assert.equal(tanker.show, true);

    militaryFlightsLayer.setParams({ selectedMilitaryTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked hex-only hides');
    assert.equal(tanker.show, true);
  } finally {
    resetMilitaryIdentifiedOnlyLayer();
  }
});

test('Identified-only ANDs with existing military-flight filters', () => {
  const lowIdentified = emptyBillboard();
  const highIdentified = emptyBillboard();
  const highHex = emptyBillboard();
  const parkedIdentified = emptyBillboard();
  _setTrackedMilitaryRefreshStateForTest({
    icao24: 'andhigh',
    meta: {
      callsign: 'RCH100',
      registration: '62-3578',
      klass: 'airliner',
      onGround: false,
      altitudeFt: 37000,
      verticalRateMps: 0,
    },
    billboard: highIdentified,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addMilitaryTrackingCandidateForTest({
    icao24: 'andlow',
    meta: {
      callsign: 'RCH200',
      registration: '',
      klass: 'airliner',
      onGround: false,
      altitudeFt: 3500,
      verticalRateMps: 8,
    },
    billboard: lowIdentified,
  });
  _addMilitaryTrackingCandidateForTest({
    icao24: 'andhex',
    meta: {
      callsign: '',
      registration: null,
      klass: 'airliner',
      onGround: false,
      altitudeFt: 37000,
    },
    billboard: highHex,
  });
  _addMilitaryTrackingCandidateForTest({
    icao24: 'andpark',
    meta: {
      callsign: 'HMX001',
      registration: '86-0036',
      klass: 'helicopter',
      onGround: true,
      altitudeFt: 0,
    },
    billboard: parkedIdentified,
  });
  try {
    militaryFlightsLayer.setParams({
      identifiedOnly: true,
      airborneOnly: false,
      callsignPrefixes: '',
      aircraftClassFilter: 'all',
      showClimb: true,
      showLevel: true,
      showDescent: true,
    });
    assert.equal(highIdentified.show, true);
    assert.equal(lowIdentified.show, true);
    assert.equal(highHex.show, false);
    assert.equal(parkedIdentified.show, true);

    militaryFlightsLayer.setParams({ airborneOnly: true });
    assert.equal(highIdentified.show, true);
    assert.equal(parkedIdentified.show, false, 'AND: grounded identified hides under airborne-only');

    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highIdentified.show, true, 'AND: in-band identified remains');
    assert.equal(lowIdentified.show, false, 'AND: identified but out-of-band hides');

    setAltitudeBand('all', { persist: false });
    militaryFlightsLayer.setParams({ airborneOnly: false, callsignPrefixes: 'RCH' });
    assert.equal(highIdentified.show, true, 'AND: matching identified remains');
    assert.equal(parkedIdentified.show, false, 'AND: prefix still hides a non-RCH identified');

    militaryFlightsLayer.setParams({ callsignPrefixes: '', aircraftClassFilter: 'airliner' });
    assert.equal(highIdentified.show, true);
    assert.equal(parkedIdentified.show, false, 'AND: class chip still hides a helo identified');

    militaryFlightsLayer.setParams({ aircraftClassFilter: 'all', showClimb: false, showLevel: true });
    _applyOperatorContactVisibilityForTest();
    assert.equal(highIdentified.show, true, 'AND: level identified remains');
    assert.equal(lowIdentified.show, false, 'AND: climbing identified hides when climb is off');

    const identified = filterMilitaryContactsByIdentifiedOnly(MIXED, true);
    const afterSpeed = identified.filter((contact) => contactPassesInFlightFilters(contact, {
      id: contact.icao24,
      speedBand: { minKt: 0, maxKt: null },
    }));
    assert.deepEqual(afterSpeed.map((row) => row.icao24), ['rch001', 'tail01', 'park01']);
  } finally {
    resetMilitaryIdentifiedOnlyLayer();
  }
});

test('persist meridian.militaryFlightsIdentifiedOnly separately from civil', () => {
  resetMilitaryFlightsIdentifiedOnlyForTest();
  assert.equal(MILITARY_FLIGHTS_IDENTIFIED_ONLY_STORAGE_KEY, 'meridian.militaryFlightsIdentifiedOnly');
  assert.equal(readMilitaryFlightsIdentifiedOnly(memoryStorage()), false);
  const storage = memoryStorage();
  assert.equal(writeMilitaryFlightsIdentifiedOnly(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.militaryFlightsIdentifiedOnly': '1' });
  assert.equal(Object.hasOwn(storage.snapshot(), 'meridian.flightsIdentifiedOnly'), false);
  assert.equal(readMilitaryFlightsIdentifiedOnly(storage), true);
  assert.equal(writeMilitaryFlightsIdentifiedOnly(false, storage), true);
  assert.equal(storage.snapshot()['meridian.militaryFlightsIdentifiedOnly'], '0');

  const seen = [];
  const unsubscribe = subscribeMilitaryFlightsIdentifiedOnly((enabled) => seen.push(enabled));
  try {
    assert.equal(getMilitaryFlightsIdentifiedOnly(), false);
    const hydrated = memoryStorage({ 'meridian.militaryFlightsIdentifiedOnly': '1' });
    assert.equal(hydrateMilitaryFlightsIdentifiedOnly(hydrated), true);
    assert.equal(getMilitaryFlightsIdentifiedOnly(), true);
    assert.equal(setMilitaryFlightsIdentifiedOnly(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.militaryFlightsIdentifiedOnly'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetMilitaryFlightsIdentifiedOnlyForTest();
  }

  militaryFlightsLayer.setParams({ identifiedOnly: false });
  assert.equal(militaryFlightsLayer.getParams().identifiedOnly, false);
  militaryFlightsLayer.setParams({ identifiedOnly: true });
  assert.equal(militaryFlightsLayer.getParams().identifiedOnly, true);
  const chip = militaryFlightsLayer.getRowControls().chips.find((entry) => (
    entry.id === MILITARY_IDENTIFIED_ONLY_CHIP_ID
  ));
  assert.equal(chip.label, MILITARY_IDENTIFIED_ONLY_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { identifiedOnly: false });
  militaryFlightsLayer.setParams({ identifiedOnly: false });
  assert.equal(
    militaryFlightsLayer.getRowControls().chips.find((entry) => (
      entry.id === MILITARY_IDENTIFIED_ONLY_CHIP_ID
    )).active,
    false,
  );
});

test('Identified-only is a military-row chip: no DISPLAY rail, no flights.js, no new /api', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const flights = data('flights.js');
  const helper = data('militaryFlightIdentifiedFilter.js');
  const military = data('militaryFlights.js');
  const manager = data('manager.js');
  assert.doesNotMatch(html, /identified-only|Identified only/);
  assert.doesNotMatch(ui, /identifiedOnly|_initIdentifiedOnly|militaryFlightsIdentifiedOnly/);
  assert.doesNotMatch(flights, /identifiedOnly|militaryFlightIdentifiedFilter|militaryFlightsIdentifiedOnly/);
  assert.match(military, /militaryIdentifiedOnlyChipModel\(/);
  assert.match(military, /passesMilitaryIdentifiedOnlyFilter/);
  assert.match(military, /_identifiedOnlyMatcher/);
  assert.match(military, /hydrateMilitaryFlightsIdentifiedOnly/);
  assert.match(
    military,
    /andMatchers: \[_altitudeAndMatcher, _headingAndMatcher, _hideStaleAndMatcher, _classAndMatcher, _prefixAndMatcher, _airborneOnlyMatcher, _verticalRateAndMatcher, _identifiedOnlyMatcher\]/,
  );
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.match(helper, /meridian\.militaryFlightsIdentifiedOnly/);
  assert.doesNotMatch(helper, /MILITARY_FLIGHTS_IDENTIFIED_ONLY_STORAGE_KEY = 'meridian\.flightsIdentifiedOnly'/);
  assert.equal(existsSync(path.join(ROOT, 'api/military/identified-only.js')), false);
});

test('legal: already-fetched fields only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('militaryFlightIdentifiedFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth/i);
  assert.match(moduleSource, /callsign/);
  assert.match(moduleSource, /registration/);
});
