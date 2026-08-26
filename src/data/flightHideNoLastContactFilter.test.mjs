import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as Cesium from 'cesium';

import {
  HIDE_NO_LAST_CONTACT_CHIP_ID,
  HIDE_NO_LAST_CONTACT_CHIP_LABEL,
  HIDE_NO_LAST_CONTACT_DEFAULT,
  HIDE_NO_LAST_CONTACT_STORAGE_KEY,
  contactHasLastContact,
  getHideNoLastContactEnabled,
  hideNoLastContactChipModel,
  hydrateHideNoLastContactEnabled,
  lastContactEpochMsField,
  normalizeHideNoLastContact,
  passesHideNoLastContactFilter,
  readHideNoLastContactEnabled,
  resetHideNoLastContactForTest,
  setHideNoLastContactEnabled,
  subscribeHideNoLastContactEnabled,
  writeHideNoLastContactEnabled,
} from './flightHideNoLastContactFilter.js';
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

function resetHideNoLastContactLayers() {
  resetHideNoLastContactForTest();
  setHeadingSectors('NESW');
  flightsLayer.setParams({
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
    ...extra,
  };
}

test('off keeps missing / non-finite lastContactEpochMs', () => {
  assert.equal(HIDE_NO_LAST_CONTACT_DEFAULT, false);
  assert.equal(HIDE_NO_LAST_CONTACT_STORAGE_KEY, 'meridian.flightHideNoLastContact');
  assert.equal(normalizeHideNoLastContact(undefined), false);
  assert.equal(normalizeHideNoLastContact(null), false);
  assert.equal(normalizeHideNoLastContact('nope'), false);
  assert.equal(normalizeHideNoLastContact(false), false);
  assert.equal(normalizeHideNoLastContact(true), true);
  assert.equal(normalizeHideNoLastContact('1'), true);

  assert.equal(lastContactEpochMsField(undefined), null);
  assert.equal(lastContactEpochMsField(null), null);
  assert.equal(lastContactEpochMsField(Number.NaN), null);
  assert.equal(lastContactEpochMsField(Number.POSITIVE_INFINITY), null);
  assert.equal(lastContactEpochMsField(0), 0);
  assert.equal(lastContactEpochMsField(HEARD_AT), HEARD_AT);

  assert.equal(contactHasLastContact({ lastContactEpochMs: 0 }), true);
  assert.equal(contactHasLastContact({ lastContactEpochMs: HEARD_AT }), true);
  assert.equal(contactHasLastContact({ lastContactEpochMs: null }), false);
  assert.equal(contactHasLastContact({ lastContactEpochMs: undefined }), false);
  assert.equal(contactHasLastContact({ lastContactEpochMs: Number.NaN }), false);
  assert.equal(contactHasLastContact({}), false);

  const missing = {};
  const empty = { lastContactEpochMs: null };
  const epochZero = { lastContactEpochMs: 0 };
  const heard = { lastContactEpochMs: HEARD_AT };
  const nanEpoch = { lastContactEpochMs: Number.NaN };

  for (const contact of [missing, empty, epochZero, heard, nanEpoch]) {
    assert.equal(passesHideNoLastContactFilter({ ...contact, hideNoLastContact: false }), true,
      'off keeps missing / non-finite lastContactEpochMs');
  }

  const chip = hideNoLastContactChipModel(false);
  assert.equal(chip.label, HIDE_NO_LAST_CONTACT_CHIP_LABEL);
  assert.equal(chip.id, HIDE_NO_LAST_CONTACT_CHIP_ID);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoLastContact: true });
  assert.deepEqual(hideNoLastContactChipModel(true).params, { hideNoLastContact: false });
});

test('on hides missing / non-finite lastContactEpochMs and keeps a finite epoch', () => {
  const missing = emptyBillboard();
  const heard = emptyBillboard();
  const empty = emptyBillboard();
  const nanEpoch = emptyBillboard();
  const epochZero = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'a1b2c3',
    meta: liveMeta({
      callsign: 'UNK1',
      lastContactEpochMs: undefined,
    }),
    billboard: missing,
    billboardCollection: {},
    viewer: emptyViewer(),
    entity: {},
    tracked: false,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'heard01',
    meta: liveMeta({ callsign: 'UAL100', registration: 'N100UA' }),
    billboard: heard,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'empty01',
    meta: liveMeta({ callsign: 'NULL1', lastContactEpochMs: null }),
    billboard: empty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'nan0001',
    meta: liveMeta({ callsign: 'NAN1', registration: 'N1NAN', lastContactEpochMs: Number.NaN }),
    billboard: nanEpoch,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'epoch00',
    meta: liveMeta({ callsign: 'EPOCH0', registration: 'N0EPC', lastContactEpochMs: 0 }),
    billboard: epochZero,
  });
  try {
    assert.equal(flightsLayer.getParams().hideNoLastContact, false);
    assert.equal(missing.show, true);
    assert.equal(heard.show, true);
    assert.equal(empty.show, true);
    assert.equal(nanEpoch.show, true);
    assert.equal(epochZero.show, true);

    assert.equal(flightsLayer.setParams({ hideNoLastContact: true }), true);
    assert.equal(flightsLayer.getParams().hideNoLastContact, true);
    assert.equal(missing.show, false, 'undefined lastContactEpochMs hides');
    assert.equal(heard.show, true, 'finite epoch stays');
    assert.equal(empty.show, false, 'null lastContactEpochMs hides');
    assert.equal(nanEpoch.show, false, 'NaN lastContactEpochMs hides');
    assert.equal(epochZero.show, true, '0 is a finite epoch and stays');

    const extra = emptyBillboard();
    _addFlightTrackingCandidateForTest({
      icao24: 'hexnew',
      meta: liveMeta({ klass: 'airliner', lastContactEpochMs: undefined }),
      billboard: extra,
    });
    _applyOperatorContactVisibilityForTest();
    assert.equal(flightsLayer.getParams().hideNoLastContact, true, 'refresh keeps the toggle');
    assert.equal(extra.show, false);
    assert.equal(heard.show, true);

    flightsLayer.setParams({ hideNoLastContact: false });
    assert.equal(missing.show, true);
    assert.equal(empty.show, true);
    assert.equal(nanEpoch.show, true);
    assert.equal(extra.show, true);
  } finally {
    resetHideNoLastContactLayers();
  }
});

test('selected / tracked always kept', () => {
  const selected = emptyBillboard();
  const otherEmpty = emptyBillboard();
  const heard = emptyBillboard();
  _setTrackedFlightRefreshStateForTest({
    icao24: 'selhex',
    meta: liveMeta({
      callsign: 'SEL1',
      registration: 'N9SEL',
      lastContactEpochMs: null,
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
      lastContactEpochMs: undefined,
    }),
    billboard: otherEmpty,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'heard01',
    meta: liveMeta({ callsign: 'UAL100', registration: 'N100UA' }),
    billboard: heard,
  });
  try {
    flightsLayer.setParams({ hideNoLastContact: true });
    assert.equal(selected.show, true, 'tracked missing-last-contact stays');
    assert.equal(otherEmpty.show, false);
    assert.equal(heard.show, true);

    flightsLayer.setParams({ selectedFlightsTrackingId: null });
    _applyOperatorContactVisibilityForTest();
    assert.equal(selected.show, false, 'untracked missing-last-contact hides');
    assert.equal(heard.show, true);
  } finally {
    resetHideNoLastContactLayers();
  }
});

test('Hide no last contact ANDs with existing hide-no chips including 274 baro and stays distinct from Plan 93 / 234 / 244 / 255 / 261 / 268 / 274 / hide-ground', () => {
  const highHeard = emptyBillboard();
  const lowHeard = emptyBillboard();
  const missingContact = emptyBillboard();
  const groundedHeard = emptyBillboard();
  const geoOnlyMissingContact = emptyBillboard();
  const contactOnlyMissingGeo = emptyBillboard();
  const rateOnlyMissingContact = emptyBillboard();
  const contactOnlyMissingRate = emptyBillboard();
  const headedMissingContact = emptyBillboard();
  const countryMissingContact = emptyBillboard();
  const speedMissingContact = emptyBillboard();
  const speedOnlyMissingContact = emptyBillboard();
  const baroOnlyMissingContact = emptyBillboard();
  const contactOnlyMissingBaro = emptyBillboard();
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
    billboard: highHeard,
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
    billboard: lowHeard,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhex',
    meta: liveMeta({
      callsign: 'SWA9',
      registration: 'N9SWA',
      lastContactEpochMs: null,
    }),
    billboard: missingContact,
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
    billboard: groundedHeard,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andgeo',
    meta: liveMeta({
      callsign: 'GEO9',
      registration: 'N9GEO',
      lastContactEpochMs: null,
    }),
    billboard: geoOnlyMissingContact,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andg2',
    meta: liveMeta({
      callsign: 'G2XX',
      registration: 'N2GEO',
      geoAltitudeM: null,
    }),
    billboard: contactOnlyMissingGeo,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andrate',
    meta: liveMeta({
      callsign: 'RTE9',
      registration: 'N9RTE',
      verticalRate: 5,
      lastContactEpochMs: null,
    }),
    billboard: rateOnlyMissingContact,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andr2',
    meta: liveMeta({
      callsign: 'R2XX',
      registration: 'N2RTE',
      verticalRate: null,
    }),
    billboard: contactOnlyMissingRate,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andhead',
    meta: liveMeta({
      callsign: 'HDG9',
      registration: 'N9HDG',
      lastContactEpochMs: null,
    }),
    billboard: headedMissingContact,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andcty',
    meta: liveMeta({
      callsign: 'CTY9',
      registration: 'N9CTY',
      lastContactEpochMs: null,
    }),
    billboard: countryMissingContact,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andspd',
    meta: liveMeta({
      callsign: 'SPD9',
      registration: 'N9SPD',
      velocity: null,
    }),
    billboard: speedMissingContact,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andsp2',
    meta: liveMeta({
      callsign: 'SP2X',
      registration: 'N2SPD',
      lastContactEpochMs: null,
    }),
    billboard: speedOnlyMissingContact,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andbaro',
    meta: liveMeta({
      callsign: 'BAR9',
      registration: 'N9BAR',
      lastContactEpochMs: null,
    }),
    billboard: baroOnlyMissingContact,
  });
  _addFlightTrackingCandidateForTest({
    icao24: 'andb2',
    meta: liveMeta({
      callsign: 'B2XX',
      registration: 'N2BAR',
      altitude: null,
    }),
    billboard: contactOnlyMissingBaro,
  });
  try {
    flightsLayer.setParams({
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
    assert.equal(highHeard.show, true, 'Plan 93: high aviation altitude stays');
    assert.equal(lowHeard.show, false, 'Plan 93: low aviation altitude hides');
    assert.equal(missingContact.show, true, 'Plan 93 named band uses baro, not last contact — 10000 m missing-last-contact stays');

    setAltitudeBand('all', { persist: false });
    assert.equal(missingContact.show, true, 'Plan 93 All pass-through: missing last contact stays');
    assert.equal(lowHeard.show, true, 'Plan 93 All keeps 2000 m');

    flightsLayer.setParams({ hideNoLastContact: true });
    assert.equal(highHeard.show, true, 'finite epoch stays — not an altitude-band chip');
    assert.equal(lowHeard.show, true, 'finite epoch at 2000 m stays — not Plan 93');
    assert.equal(groundedHeard.show, true, 'grounded finite epoch stays — not hide-ground');
    assert.equal(missingContact.show, false, 'null lastContactEpochMs hides while Plan 93 All would keep it');
    assert.equal(geoOnlyMissingContact.show, false, 'geo-bearing missing-last-contact hides — distinct from Plan 261');
    assert.equal(contactOnlyMissingGeo.show, true, 'heard but missing-geo stays — not Hide no geo');
    assert.equal(rateOnlyMissingContact.show, false, 'rate-bearing missing-last-contact hides — distinct from Plan 268');
    assert.equal(contactOnlyMissingRate.show, true, 'heard but missing-rate stays — not Hide no vertical rate');
    assert.equal(headedMissingContact.show, false, 'headed but missing last contact still hides — distinct from Plan 234');
    assert.equal(countryMissingContact.show, false, 'country-bearing but missing last contact still hides — distinct from Plan 244');
    assert.equal(speedMissingContact.show, true, 'heard but missing-speed stays — not Hide no speed (255)');
    assert.equal(speedOnlyMissingContact.show, false, 'speed-bearing missing-last-contact hides');
    assert.equal(baroOnlyMissingContact.show, false, 'baro-bearing missing-last-contact hides — distinct from Plan 274');
    assert.equal(contactOnlyMissingBaro.show, true, 'heard but missing-baro stays — not Hide no baro');

    flightsLayer.setParams({ airborneOnly: true });
    assert.equal(highHeard.show, true);
    assert.equal(groundedHeard.show, false, 'AND: grounded heard contact hides under airborne-only');

    setAltitudeBand('gt30k', { persist: false });
    assert.equal(highHeard.show, true, 'AND: in-band heard remains');
    assert.equal(lowHeard.show, false, 'AND: heard but out-of-aviation-band hides');
    assert.equal(missingContact.show, false, 'AND: missing last contact still hides under Plan 93 + 280');

    setAltitudeBand('all', { persist: false });
    flightsLayer.setParams({ airborneOnly: false, hideNoHeading: true });
    assert.equal(highHeard.show, true, 'AND: heard headed stays under Hide no heading');
    assert.equal(headedMissingContact.show, false, 'AND: headed missing-last-contact still hides');

    flightsLayer.setParams({ hideNoHeading: false, hideNoCountry: true });
    assert.equal(highHeard.show, true, 'AND: heard country stays under Hide no country');
    assert.equal(countryMissingContact.show, false, 'AND: country-bearing missing-last-contact still hides');

    flightsLayer.setParams({ hideNoCountry: false, hideNoSpeed: true });
    assert.equal(highHeard.show, true, 'AND: heard speed stays under Hide no speed');
    assert.equal(speedMissingContact.show, false, 'AND: Hide no speed still drops heard missing-speed');
    assert.equal(speedOnlyMissingContact.show, false, 'AND: speed-bearing missing-last-contact still hides');

    flightsLayer.setParams({ hideNoSpeed: false, hideNoGeoAltitude: true });
    assert.equal(highHeard.show, true, 'AND: heard geo stays under Hide no geo altitude');
    assert.equal(contactOnlyMissingGeo.show, false, 'AND: Hide no geo altitude still drops heard missing-geo');
    assert.equal(geoOnlyMissingContact.show, false, 'AND: geo-bearing missing-last-contact still hides');
    assert.equal(missingContact.show, false);

    flightsLayer.setParams({ hideNoGeoAltitude: false, hideNoVerticalRate: true });
    assert.equal(highHeard.show, true, 'AND: heard rate stays under Hide no vertical rate');
    assert.equal(contactOnlyMissingRate.show, false, 'AND: Hide no vertical rate still drops heard missing-rate');
    assert.equal(rateOnlyMissingContact.show, false, 'AND: rate-bearing missing-last-contact still hides');
    assert.equal(missingContact.show, false);

    flightsLayer.setParams({ hideNoVerticalRate: false, hideNoBaroAltitude: true });
    assert.equal(highHeard.show, true, 'AND: heard baro stays under Hide no baro altitude');
    assert.equal(contactOnlyMissingBaro.show, false, 'AND: Hide no baro still drops heard missing-baro');
    assert.equal(baroOnlyMissingContact.show, false, 'AND: baro-bearing missing-last-contact still hides');
    assert.equal(missingContact.show, false);
  } finally {
    resetHideNoLastContactLayers();
  }
});

test('invalid storage reads as off', () => {
  resetHideNoLastContactForTest();
  assert.equal(HIDE_NO_LAST_CONTACT_STORAGE_KEY, 'meridian.flightHideNoLastContact');
  assert.equal(readHideNoLastContactEnabled(memoryStorage()), false);
  assert.equal(readHideNoLastContactEnabled(memoryStorage({ 'meridian.flightHideNoLastContact': 'nope' })), false);
  assert.equal(readHideNoLastContactEnabled(memoryStorage({ 'meridian.flightHideNoLastContact': 'yes' })), false);
  assert.equal(readHideNoLastContactEnabled({
    getItem() { throw new Error('quota'); },
  }), false, 'storage throw fails closed to off');
});

test('persist flip survives reload', () => {
  resetHideNoLastContactForTest();
  const storage = memoryStorage();
  assert.equal(writeHideNoLastContactEnabled(true, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.flightHideNoLastContact': '1' });
  assert.equal(readHideNoLastContactEnabled(storage), true);
  assert.equal(writeHideNoLastContactEnabled(false, storage), true);
  assert.equal(storage.snapshot()['meridian.flightHideNoLastContact'], '0');

  const seen = [];
  const unsubscribe = subscribeHideNoLastContactEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getHideNoLastContactEnabled(), false);
    const hydrated = memoryStorage({ 'meridian.flightHideNoLastContact': '1' });
    assert.equal(hydrateHideNoLastContactEnabled(hydrated), true);
    assert.equal(getHideNoLastContactEnabled(), true);
    assert.equal(setHideNoLastContactEnabled(false, { storage }), false);
    assert.equal(storage.snapshot()['meridian.flightHideNoLastContact'], '0');
    assert.ok(seen.includes(true));
    assert.ok(seen.includes(false));
  } finally {
    unsubscribe();
    resetHideNoLastContactForTest();
  }

  const defaults = createDefaultLayerState().options.flights;
  assert.equal(Object.hasOwn(defaults, 'hideNoLastContact'), false, 'not a share-URL option');
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=f'));
  assert.equal(Object.hasOwn(omitted.options.flights, 'hideNoLastContact'), false);

  const encodedOn = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: { hideNoLastContact: true } },
  }));
  assert.doesNotMatch(String(encodedOn.get('lo') || ''), /hideNoLastContact/);
  const encodedOff = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['flights'],
    options: { flights: {} },
  }));
  assert.equal(String(encodedOn.get('lo') || ''), String(encodedOff.get('lo') || ''),
    'no share-URL write');

  hydrateHideNoLastContactEnabled(memoryStorage({ 'meridian.flightHideNoLastContact': '1' }));
  flightsLayer.setParams({ airborneOnly: false, identifiedOnly: false, emergenciesOnly: false });
  assert.equal(getHideNoLastContactEnabled(), true, 'coordinator-style restore keeps the flip');
  assert.equal(flightsLayer.getParams().hideNoLastContact, true);

  flightsLayer.setParams({ hideNoLastContact: false });
  assert.equal(flightsLayer.getParams().hideNoLastContact, false);
  flightsLayer.setParams({ hideNoLastContact: true });
  assert.equal(flightsLayer.getParams().hideNoLastContact, true);
  const chips = flightsLayer.getRowControls().chips;
  const chip = chips.find((entry) => entry.id === HIDE_NO_LAST_CONTACT_CHIP_ID);
  const baroIdx = chips.findIndex((entry) => entry.id === 'hide-no-baro-altitude');
  const lastContactIdx = chips.findIndex((entry) => entry.id === HIDE_NO_LAST_CONTACT_CHIP_ID);
  assert.equal(chip.label, HIDE_NO_LAST_CONTACT_CHIP_LABEL);
  assert.equal(chip.active, true);
  assert.deepEqual(chip.params, { hideNoLastContact: false });
  assert.ok(baroIdx >= 0 && lastContactIdx === baroIdx + 1, 'Hide no last contact sits next to Hide no baro altitude');
  flightsLayer.setParams({ hideNoLastContact: false });
  assert.equal(flightsLayer.getRowControls().chips.find((entry) => entry.id === HIDE_NO_LAST_CONTACT_CHIP_ID).active, false);
  resetHideNoLastContactForTest();
});

test('militaryFlights.js and stay-off layers are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const style = root('style.css');
  const flights = data('flights.js');
  const helper = data('flightHideNoLastContactFilter.js');
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
  assert.doesNotMatch(html, /hide-no-last-contact|Hide no last contact/);
  assert.doesNotMatch(ui, /hideNoLastContact|_initHideNoLastContact/);
  assert.doesNotMatch(style, /hide-no-last-contact|hideNoLastContact/);
  assert.match(flights, /hideNoLastContactChipModel\(/);
  assert.match(flights, /passesHideNoLastContactFilter/);
  assert.match(flights, /_hideNoLastContactMatcher/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(military, /hideNoLastContact|hide-no-last-contact|flightHideNoLastContactFilter/);
  assert.doesNotMatch(ais, /flightHideNoLastContactFilter|meridian\.flightHideNoLastContact/);
  assert.doesNotMatch(adapter, /hideNoLastContact|hide-no-last-contact|flightHideNoLastContactFilter/);
  assert.doesNotMatch(awareness, /hideNoLastContact|flightHideNoLastContactFilter/);
  assert.doesNotMatch(launchesPanel, /hideNoLastContact|flightHideNoLastContactFilter/);
  assert.doesNotMatch(rocketLaunches, /hideNoLastContact|flightHideNoLastContactFilter/);
  assert.doesNotMatch(firmsHeatmap, /hideNoLastContact|flightHideNoLastContactFilter/);
  assert.doesNotMatch(firmsList, /hideNoLastContact|flightHideNoLastContactFilter/);
  assert.doesNotMatch(damsList, /hideNoLastContact|flightHideNoLastContactFilter/);
  assert.doesNotMatch(datacenterList, /hideNoLastContact|flightHideNoLastContactFilter/);
  assert.doesNotMatch(localGeojson, /hideNoLastContact|flightHideNoLastContactFilter/);
  assert.doesNotMatch(flights, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.doesNotMatch(helper, /OpenSky|opensky/i);
  assert.match(helper, /lastContactEpochMs/);
  assert.match(helper, /meridian\.flightHideNoLastContact/);
  assert.match(helper, /not written into the share URL/);
  assert.match(helper, /Plan 93 altitude-band/);
  assert.match(helper, /Hide no baro altitude \(274/);
  assert.match(helper, /airborne-only \/ hide-ground/);
  assert.doesNotMatch(helper, /hide-ground chip|add hide-ground/i);
});

test('legal: already-fetched lastContactEpochMs only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('flightHideNoLastContactFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /God'?s Eye View|GEV rebrand|quantum-earth|OpenSky|opensky/i);
  assert.match(moduleSource, /lastContactEpochMs/);
});
