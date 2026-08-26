// PLAN 269 — Context Flights only. Client-only filter of already-fetched
// getNearby records on the Global Context roster / NEXT walk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

import {
  AWARENESS_FLIGHTS_CHIP_ID,
  AWARENESS_FLIGHTS_CHIP_LABEL,
  AWARENESS_FLIGHTS_DEFAULT,
  AWARENESS_FLIGHTS_LAYER_ID,
  AWARENESS_FLIGHTS_STORAGE_KEY,
  awarenessFlightsChipModel,
  filterAwarenessFlightsContacts,
  getAwarenessFlightsOnlyEnabled,
  hydrateAwarenessFlightsOnlyEnabled,
  normalizeAwarenessFlightsOnly,
  passesAwarenessFlightsFilter,
  readAwarenessFlightsOnlyEnabled,
  resetAwarenessFlightsOnlyForTest,
  setAwarenessFlightsOnlyEnabled,
  writeAwarenessFlightsOnlyEnabled,
} from './awarenessFlightsFilter.js';
import {
  resetAwarenessIdentifiedForTest,
  setAwarenessIdentifiedEnabled,
} from './awarenessIdentifiedFilter.js';
import {
  resetAwarenessRangeForTest,
  setAwarenessRangeFilter,
} from './awarenessRangeFilter.js';
import {
  resetAwarenessAircraftOnlyForTest,
  setAwarenessAircraftOnlyEnabled,
} from './awarenessAircraftFilter.js';
import {
  resetAwarenessVesselsOnlyForTest,
  setAwarenessVesselsOnlyEnabled,
} from './awarenessVesselsFilter.js';
import {
  resetAwarenessSitesOnlyForTest,
  setAwarenessSitesOnlyEnabled,
} from './awarenessSitesFilter.js';
import {
  resetAwarenessMilitaryOnlyForTest,
  setAwarenessMilitaryOnlyEnabled,
} from './awarenessMilitaryFilter.js';
import {
  createDefaultLayerState,
  encodeLayerStateParams,
} from './layerState.js';
import militaryAwarenessLayer, {
  findCompatibleHistoryIndex,
} from './militaryAwareness.js';
import { AWARENESS_RADIUS_M } from './militaryAwarenessEngine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (name) => readFileSync(path.join(ROOT, 'src', name), 'utf8');
const data = (name) => readFileSync(path.join(ROOT, 'src/data', name), 'utf8');
const root = (name) => readFileSync(path.join(ROOT, name), 'utf8');

const HARD_NO_LAYER_FILES = [
  'flights.js',
  'militaryFlights.js',
  'aisLiveVessels.js',
  'militaryInstallations.js',
  'militaryAwarenessEngine.js',
  'firmsList.js',
  'firmsHeatmap.js',
  'earthquakeList.js',
  'damsList.js',
  'datacenterList.js',
  'launchesPanel.js',
  'localGeojson.js',
];

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

const FLIGHT = Object.freeze({
  layerId: 'flights', icao24: 'dal001', callsign: 'DAL123', id: 'DAL123', distanceM: 8_000,
});
const MILITARY = Object.freeze({
  layerId: 'military', icao24: 'ae01ce', callsign: 'RCH001', id: 'RCH001', distanceM: 12_000,
});
const VESSEL = Object.freeze({
  layerId: 'ais-live-vessels', mmsi: '366999000', name: 'EVER GIVEN', id: '366999000', distanceM: 8_000,
});
const SITE = Object.freeze({
  layerId: 'military-installations', id: 'osm:way:2', name: 'Fort Hood', hasName: true, distanceM: 40_000,
});
const MISSING_LAYER = Object.freeze({
  icao24: 'nodist', callsign: 'NODIST', id: 'nodist', distanceM: 8_000,
});

test('Off keeps all four cohorts', () => {
  assert.equal(AWARENESS_FLIGHTS_DEFAULT, false);
  assert.equal(AWARENESS_FLIGHTS_STORAGE_KEY, 'meridian.awarenessFlightsOnly');
  assert.equal(AWARENESS_FLIGHTS_LAYER_ID, 'flights');
  assert.equal(AWARENESS_RADIUS_M, 250_000, 'do not shrink AWARENESS_RADIUS_M');

  for (const contact of [FLIGHT, MILITARY, VESSEL, SITE]) {
    assert.equal(passesAwarenessFlightsFilter(contact, { flightsOnly: false }), true);
  }
  const kept = filterAwarenessFlightsContacts(
    [FLIGHT, MILITARY, VESSEL, SITE],
    { flightsOnly: false },
  );
  assert.deepEqual(kept.map((row) => row.layerId), [
    'flights',
    'military',
    'ais-live-vessels',
    'military-installations',
  ]);
});

test('On keeps civil flights and drops military + AIS + sites', () => {
  assert.equal(passesAwarenessFlightsFilter(FLIGHT, { flightsOnly: true }), true);
  assert.equal(passesAwarenessFlightsFilter(MILITARY, { flightsOnly: true }), false);
  assert.equal(passesAwarenessFlightsFilter(VESSEL, { flightsOnly: true }), false);
  assert.equal(passesAwarenessFlightsFilter(SITE, { flightsOnly: true }), false);

  const kept = filterAwarenessFlightsContacts(
    [FLIGHT, MILITARY, VESSEL, SITE],
    { flightsOnly: true },
  );
  assert.deepEqual(kept.map((row) => row.layerId), ['flights']);
});

test('Subject always kept, including mil / AIS / site', () => {
  assert.equal(passesAwarenessFlightsFilter(MILITARY, {
    flightsOnly: true,
    subjectId: 'RCH001',
  }), true);
  assert.equal(passesAwarenessFlightsFilter(MILITARY, {
    flightsOnly: true,
    subjectId: 'military:RCH001',
  }), true);
  assert.equal(passesAwarenessFlightsFilter(VESSEL, {
    flightsOnly: true,
    subjectId: '366999000',
  }), true);
  assert.equal(passesAwarenessFlightsFilter(SITE, {
    flightsOnly: true,
    subjectId: 'osm:way:2',
  }), true);
  assert.equal(passesAwarenessFlightsFilter(FLIGHT, {
    flightsOnly: true,
    subjectId: 'DAL123',
  }), true);
  assert.equal(passesAwarenessFlightsFilter(MILITARY, {
    flightsOnly: true,
    subjectId: 'other',
  }), false);
});

test('Missing layerId stays', () => {
  assert.equal(passesAwarenessFlightsFilter(MISSING_LAYER, { flightsOnly: true }), true);
  assert.equal(passesAwarenessFlightsFilter({ icao24: 'abc123', callsign: 'NODIST' }, {
    flightsOnly: true,
  }), true);
  assert.equal(passesAwarenessFlightsFilter({ layerId: '', icao24: 'x' }, {
    flightsOnly: true,
  }), true);
  assert.equal(passesAwarenessFlightsFilter({ layerId: '   ', mmsi: '1' }, {
    flightsOnly: true,
  }), true);
  const kept = filterAwarenessFlightsContacts(
    [MISSING_LAYER, MILITARY, FLIGHT],
    { flightsOnly: true },
  );
  assert.deepEqual(kept.map((row) => row.icao24 || row.id), ['nodist', 'dal001']);
});

test('Invalid storage reads as off', () => {
  assert.equal(normalizeAwarenessFlightsOnly(undefined), false);
  assert.equal(normalizeAwarenessFlightsOnly(null), false);
  assert.equal(normalizeAwarenessFlightsOnly('nope'), false);
  assert.equal(normalizeAwarenessFlightsOnly('{oops'), false);
  assert.equal(normalizeAwarenessFlightsOnly(false), false);
  assert.equal(normalizeAwarenessFlightsOnly(true), true);
  assert.equal(normalizeAwarenessFlightsOnly('1'), true);
  assert.equal(readAwarenessFlightsOnlyEnabled(memoryStorage()), false);
  assert.equal(readAwarenessFlightsOnlyEnabled(memoryStorage({
    [AWARENESS_FLIGHTS_STORAGE_KEY]: 'maybe',
  })), false);
  assert.equal(readAwarenessFlightsOnlyEnabled(memoryStorage({
    [AWARENESS_FLIGHTS_STORAGE_KEY]: '{oops',
  })), false);
  assert.equal(readAwarenessFlightsOnlyEnabled({
    getItem() { throw new Error('blocked'); },
  }), false);
});

test('Persist flip survives reload', () => {
  resetAwarenessFlightsOnlyForTest();
  const storage = memoryStorage();
  assert.equal(readAwarenessFlightsOnlyEnabled(storage), false);
  assert.equal(setAwarenessFlightsOnlyEnabled(true, { storage }), true);
  assert.deepEqual(storage.snapshot(), { [AWARENESS_FLIGHTS_STORAGE_KEY]: '1' });
  assert.equal(readAwarenessFlightsOnlyEnabled(storage), true);

  resetAwarenessFlightsOnlyForTest();
  assert.equal(getAwarenessFlightsOnlyEnabled(), false, 'in-memory reset is off');
  assert.equal(hydrateAwarenessFlightsOnlyEnabled(storage), true);
  assert.equal(getAwarenessFlightsOnlyEnabled(), true);
  assert.deepEqual(storage.snapshot(), { [AWARENESS_FLIGHTS_STORAGE_KEY]: '1' },
    'hydrate must not rewrite storage');

  assert.equal(writeAwarenessFlightsOnlyEnabled(false, storage), true);
  assert.equal(storage.snapshot()[AWARENESS_FLIGHTS_STORAGE_KEY], '0');
  resetAwarenessFlightsOnlyForTest();
});

test('LayerStateCoordinator restore stays local — no share-URL write', () => {
  const defaults = createDefaultLayerState();
  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), defaults).toString();
  assert.doesNotMatch(encoded, /awarenessFlightsOnly/);
  assert.doesNotMatch(encoded, /meridian\.awarenessFlightsOnly/);
  assert.equal(Object.hasOwn(defaults.options, 'military-awareness'), false);

  const layerState = data('layerState.js');
  assert.match(layerState, /id: 'military-awareness', token: 'g', disposition: 'enabled-only'/);
  assert.doesNotMatch(layerState, /awarenessFlightsOnly|AWARENESS_FLIGHTS/);

  const sharelink = src('sharelink.js');
  assert.doesNotMatch(sharelink, /awarenessFlightsOnly|meridian\.awarenessFlightsOnly/);
});

test('AND with 213 Identified only, 221 range, 231 Aircraft only, 251 Vessels only, 259 Sites only, and 263 Military only', () => {
  resetAwarenessIdentifiedForTest();
  resetAwarenessRangeForTest();
  resetAwarenessAircraftOnlyForTest();
  resetAwarenessVesselsOnlyForTest();
  resetAwarenessSitesOnlyForTest();
  resetAwarenessMilitaryOnlyForTest();
  resetAwarenessFlightsOnlyForTest();
  const awareness = data('militaryAwareness.js');
  assert.match(awareness, /filterAwarenessFlightsContacts|passesAwarenessFlightsFilter/);
  assert.match(awareness, /filterAwarenessMilitaryContacts|passesAwarenessMilitaryFilter/);
  assert.match(awareness, /filterAwarenessSitesContacts|passesAwarenessSitesFilter/);
  assert.match(awareness, /filterAwarenessVesselsContacts|passesAwarenessVesselsFilter/);
  assert.match(awareness, /filterAwarenessAircraftContacts|passesAwarenessAircraftFilter/);
  assert.match(awareness, /filterAwarenessIdentifiedContacts|passesAwarenessIdentifiedFilter/);
  assert.match(awareness, /filterAwarenessRangeContacts|passesAwarenessRangeFilter/);
  assert.match(
    awareness,
    /if \(aircraftClass\) \{[\s\S]*passesAwarenessIdentifiedFilter[\s\S]*passesAwarenessRangeFilter[\s\S]*passesAwarenessAircraftFilter[\s\S]*passesAwarenessVesselsFilter[\s\S]*passesAwarenessSitesFilter[\s\S]*passesAwarenessMilitaryFilter[\s\S]*passesAwarenessFlightsFilter/,
  );

  const history = [
    { layerId: 'flights', id: 'hex001', callsign: '', distanceM: 8_000 },
    { layerId: 'flights', id: 'dal001', callsign: 'DAL123', aircraftClass: 'airliner', distanceM: 8_000 },
    { layerId: 'flights', id: 'far200', callsign: 'FAR200', aircraftClass: 'airliner', distanceM: 200_000 },
    { layerId: 'military', id: 'RCH001', callsign: 'RCH001', aircraftClass: 'military', distanceM: 8_000 },
    { layerId: 'ais-live-vessels', id: '366999000', mmsi: '366999000', name: 'EVER GIVEN', distanceM: 8_000 },
    { layerId: 'military-installations', id: 'osm:way:2', name: 'Fort Hood', hasName: true, distanceM: 8_000 },
  ];
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 0, 'defaults keep a hex-only nearby aircraft');
  assert.equal(findCompatibleHistoryIndex(history, 2, 1, {
    resolveItem: (subject) => subject,
  }), 3, 'defaults still walk onto a military flight');

  setAwarenessFlightsOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 0, 'flights-only keeps civil flights');
  assert.equal(findCompatibleHistoryIndex(history, 2, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'flights-only skips military, AIS, and sites');

  setAwarenessAircraftOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 0, 'AND: aircraft-only + flights-only keeps civil flights');

  setAwarenessAircraftOnlyEnabled(false, { persist: false });
  setAwarenessVesselsOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'AND: vessels-only + flights-only leaves the walk empty');

  setAwarenessVesselsOnlyEnabled(false, { persist: false });
  setAwarenessSitesOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'AND: sites-only + flights-only leaves the walk empty');

  setAwarenessSitesOnlyEnabled(false, { persist: false });
  setAwarenessMilitaryOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'AND: military-only + flights-only leaves the walk empty');

  setAwarenessMilitaryOnlyEnabled(false, { persist: false });
  setAwarenessIdentifiedEnabled(true, { persist: false });
  setAwarenessRangeFilter('10', { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 1, 'AND: identified + <10 km + flights-only keeps the named nearby civil flight');
  resetAwarenessIdentifiedForTest();
  resetAwarenessRangeForTest();
  resetAwarenessAircraftOnlyForTest();
  resetAwarenessVesselsOnlyForTest();
  resetAwarenessSitesOnlyForTest();
  resetAwarenessMilitaryOnlyForTest();
  resetAwarenessFlightsOnlyForTest();
});

test('militaryAwareness setParams flips Flights-only without a share token', () => {
  resetAwarenessFlightsOnlyForTest();
  assert.equal(militaryAwarenessLayer.getParams().flightsOnly, false);
  assert.equal(militaryAwarenessLayer.setParams({ flightsOnly: true }), undefined);
  assert.equal(militaryAwarenessLayer.getParams().flightsOnly, true);
  assert.equal(getAwarenessFlightsOnlyEnabled(), true);
  militaryAwarenessLayer.setParams({ flightsOnly: false });
  assert.equal(militaryAwarenessLayer.getParams().flightsOnly, false);
  resetAwarenessFlightsOnlyForTest();
});

test('Context panel chip is wired; in-flight layer files are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const awareness = data('militaryAwareness.js');
  const helper = data('awarenessFlightsFilter.js');
  const engine = data('militaryAwarenessEngine.js');

  assert.match(awareness, /data-awareness-action="flights-only"/);
  assert.match(awareness, /AWARENESS_FLIGHTS_CHIP_LABEL|Flights only/);
  assert.match(awareness, /setAwarenessFlightsOnlyEnabled|flightsOnly/);
  assert.doesNotMatch(ui, /awarenessFlightsOnly|_initAwarenessFlights/);
  assert.doesNotMatch(html, /awarenessFlightsOnly|_initAwarenessFlights/);

  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.match(helper, /meridian\.awarenessFlightsOnly/);
  assert.match(engine, /export const AWARENESS_RADIUS_M = 250000/);

  for (const file of HARD_NO_LAYER_FILES) {
    const source = data(file);
    assert.doesNotMatch(source, /awarenessFlightsOnly|meridian\.awarenessFlightsOnly/);
    assert.doesNotMatch(source, /AWARENESS_FLIGHTS/);
  }

  const chip = awarenessFlightsChipModel(false);
  assert.equal(chip.id, AWARENESS_FLIGHTS_CHIP_ID);
  assert.equal(chip.label, AWARENESS_FLIGHTS_CHIP_LABEL);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { flightsOnly: true });
  assert.deepEqual(awarenessFlightsChipModel(true).params, { flightsOnly: false });
});

test('militaryAwarenessEngine.js is unchanged', () => {
  const engine = data('militaryAwarenessEngine.js');
  assert.doesNotMatch(engine, /awarenessFlightsOnly|AWARENESS_FLIGHTS/);
  assert.doesNotMatch(engine, /Flights only/);
  assert.match(engine, /export const AWARENESS_RADIUS_M = 250000/);
});

test('legal: already-fetched fields only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('awarenessFlightsFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /\/api\//);
  assert.doesNotMatch(moduleSource, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(moduleSource, /God's Eye View|gods-eye-view/i);
  assert.doesNotMatch(moduleSource, /OpenSky/i);
  assert.doesNotMatch(moduleSource, /AWARENESS_RADIUS_M\s*=/);
  assert.doesNotMatch(moduleSource, /hide-ground|hideGround/);
});
