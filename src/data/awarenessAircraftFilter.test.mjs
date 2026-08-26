// PLAN 231 — Context Aircraft only. Client-only filter of already-fetched
// getNearby records on the Global Context roster / NEXT walk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

import {
  AWARENESS_AIRCRAFT_CHIP_ID,
  AWARENESS_AIRCRAFT_CHIP_LABEL,
  AWARENESS_AIRCRAFT_DEFAULT,
  AWARENESS_AIRCRAFT_STORAGE_KEY,
  awarenessAircraftChipModel,
  filterAwarenessAircraftContacts,
  getAwarenessAircraftOnlyEnabled,
  hydrateAwarenessAircraftOnlyEnabled,
  normalizeAwarenessAircraftOnly,
  passesAwarenessAircraftFilter,
  readAwarenessAircraftOnlyEnabled,
  resetAwarenessAircraftOnlyForTest,
  setAwarenessAircraftOnlyEnabled,
  writeAwarenessAircraftOnlyEnabled,
} from './awarenessAircraftFilter.js';
import {
  resetAwarenessIdentifiedForTest,
  setAwarenessIdentifiedEnabled,
} from './awarenessIdentifiedFilter.js';
import {
  resetAwarenessRangeForTest,
  setAwarenessRangeFilter,
} from './awarenessRangeFilter.js';
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
const HEX_FLIGHT = Object.freeze({
  layerId: 'flights', icao24: 'abc123', callsign: '', id: 'abc123', distanceM: 8_000,
});
const MISSING_LAYER = Object.freeze({
  icao24: 'nodist', callsign: 'NODIST', id: 'nodist', distanceM: 8_000,
});

test('Off keeps all four cohorts', () => {
  assert.equal(AWARENESS_AIRCRAFT_DEFAULT, false);
  assert.equal(AWARENESS_AIRCRAFT_STORAGE_KEY, 'meridian.awarenessAircraftOnly');
  assert.equal(AWARENESS_RADIUS_M, 250_000, 'do not shrink AWARENESS_RADIUS_M');

  for (const contact of [FLIGHT, MILITARY, VESSEL, SITE]) {
    assert.equal(passesAwarenessAircraftFilter(contact, { aircraftOnly: false }), true);
  }
  const kept = filterAwarenessAircraftContacts(
    [FLIGHT, MILITARY, VESSEL, SITE],
    { aircraftOnly: false },
  );
  assert.deepEqual(kept.map((row) => row.layerId), [
    'flights',
    'military',
    'ais-live-vessels',
    'military-installations',
  ]);
});

test('On drops vessel/site, keeps flight/military', () => {
  assert.equal(passesAwarenessAircraftFilter(FLIGHT, { aircraftOnly: true }), true);
  assert.equal(passesAwarenessAircraftFilter(MILITARY, { aircraftOnly: true }), true);
  assert.equal(passesAwarenessAircraftFilter(VESSEL, { aircraftOnly: true }), false);
  assert.equal(passesAwarenessAircraftFilter(SITE, { aircraftOnly: true }), false);

  const kept = filterAwarenessAircraftContacts(
    [FLIGHT, MILITARY, VESSEL, SITE],
    { aircraftOnly: true },
  );
  assert.deepEqual(kept.map((row) => row.layerId), ['flights', 'military']);
});

test('Subject vessel stays', () => {
  assert.equal(passesAwarenessAircraftFilter(VESSEL, {
    aircraftOnly: true,
    subjectId: '366999000',
  }), true);
  assert.equal(passesAwarenessAircraftFilter(VESSEL, {
    aircraftOnly: true,
    subjectId: 'ais-live-vessels:366999000',
  }), true);
  assert.equal(passesAwarenessAircraftFilter(SITE, {
    aircraftOnly: true,
    subjectId: 'osm:way:2',
  }), true);
  assert.equal(passesAwarenessAircraftFilter(VESSEL, {
    aircraftOnly: true,
    subjectId: 'other',
  }), false);
});

test('Missing layerId stays', () => {
  assert.equal(passesAwarenessAircraftFilter(MISSING_LAYER, { aircraftOnly: true }), true);
  assert.equal(passesAwarenessAircraftFilter({ mmsi: '366123456', name: 'VESSEL' }, {
    aircraftOnly: true,
  }), true);
  assert.equal(passesAwarenessAircraftFilter({ layerId: '', icao24: 'x' }, {
    aircraftOnly: true,
  }), true);
  assert.equal(passesAwarenessAircraftFilter({ layerId: '   ', mmsi: '1' }, {
    aircraftOnly: true,
  }), true);
  const kept = filterAwarenessAircraftContacts(
    [MISSING_LAYER, VESSEL, FLIGHT],
    { aircraftOnly: true },
  );
  assert.deepEqual(kept.map((row) => row.icao24 || row.mmsi), ['nodist', 'dal001']);
});

test('Invalid storage reads as off', () => {
  assert.equal(normalizeAwarenessAircraftOnly(undefined), false);
  assert.equal(normalizeAwarenessAircraftOnly(null), false);
  assert.equal(normalizeAwarenessAircraftOnly('nope'), false);
  assert.equal(normalizeAwarenessAircraftOnly('{oops'), false);
  assert.equal(normalizeAwarenessAircraftOnly(false), false);
  assert.equal(normalizeAwarenessAircraftOnly(true), true);
  assert.equal(normalizeAwarenessAircraftOnly('1'), true);
  assert.equal(readAwarenessAircraftOnlyEnabled(memoryStorage()), false);
  assert.equal(readAwarenessAircraftOnlyEnabled(memoryStorage({
    [AWARENESS_AIRCRAFT_STORAGE_KEY]: 'maybe',
  })), false);
  assert.equal(readAwarenessAircraftOnlyEnabled(memoryStorage({
    [AWARENESS_AIRCRAFT_STORAGE_KEY]: '{oops',
  })), false);
  assert.equal(readAwarenessAircraftOnlyEnabled({
    getItem() { throw new Error('blocked'); },
  }), false);
});

test('Persist flip survives reload', () => {
  resetAwarenessAircraftOnlyForTest();
  const storage = memoryStorage();
  assert.equal(readAwarenessAircraftOnlyEnabled(storage), false);
  assert.equal(setAwarenessAircraftOnlyEnabled(true, { storage }), true);
  assert.deepEqual(storage.snapshot(), { [AWARENESS_AIRCRAFT_STORAGE_KEY]: '1' });
  assert.equal(readAwarenessAircraftOnlyEnabled(storage), true);

  resetAwarenessAircraftOnlyForTest();
  assert.equal(getAwarenessAircraftOnlyEnabled(), false, 'in-memory reset is off');
  assert.equal(hydrateAwarenessAircraftOnlyEnabled(storage), true);
  assert.equal(getAwarenessAircraftOnlyEnabled(), true);
  assert.deepEqual(storage.snapshot(), { [AWARENESS_AIRCRAFT_STORAGE_KEY]: '1' },
    'hydrate must not rewrite storage');

  assert.equal(writeAwarenessAircraftOnlyEnabled(false, storage), true);
  assert.equal(storage.snapshot()[AWARENESS_AIRCRAFT_STORAGE_KEY], '0');
  resetAwarenessAircraftOnlyForTest();
});

test('LayerStateCoordinator restore stays local — no share-URL write', () => {
  const defaults = createDefaultLayerState();
  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), defaults).toString();
  assert.doesNotMatch(encoded, /awarenessAircraftOnly/);
  assert.doesNotMatch(encoded, /meridian\.awarenessAircraftOnly/);
  assert.equal(Object.hasOwn(defaults.options, 'military-awareness'), false);

  const layerState = data('layerState.js');
  assert.match(layerState, /id: 'military-awareness', token: 'g', disposition: 'enabled-only'/);
  assert.doesNotMatch(layerState, /awarenessAircraftOnly|AWARENESS_AIRCRAFT/);

  const sharelink = src('sharelink.js');
  assert.doesNotMatch(sharelink, /awarenessAircraftOnly|meridian\.awarenessAircraftOnly/);
});

test('AND with 213 Identified only and 221 range', () => {
  resetAwarenessIdentifiedForTest();
  resetAwarenessRangeForTest();
  resetAwarenessAircraftOnlyForTest();
  const awareness = data('militaryAwareness.js');
  assert.match(awareness, /filterAwarenessAircraftContacts|passesAwarenessAircraftFilter/);
  assert.match(awareness, /filterAwarenessIdentifiedContacts|passesAwarenessIdentifiedFilter/);
  assert.match(awareness, /filterAwarenessRangeContacts|passesAwarenessRangeFilter/);
  assert.match(
    awareness,
    /if \(aircraftClass\) \{[\s\S]*passesAwarenessIdentifiedFilter[\s\S]*passesAwarenessRangeFilter[\s\S]*passesAwarenessAircraftFilter/,
  );

  const history = [
    { layerId: 'flights', id: 'hex001', callsign: '', distanceM: 8_000 },
    { layerId: 'flights', id: 'dal001', callsign: 'DAL123', aircraftClass: 'airliner', distanceM: 8_000 },
    { layerId: 'flights', id: 'far200', callsign: 'FAR200', aircraftClass: 'airliner', distanceM: 200_000 },
    { layerId: 'ais-live-vessels', id: '366999000', name: 'EVER GIVEN', distanceM: 8_000 },
    { layerId: 'military-installations', id: 'osm:way:2', name: 'Fort Hood', hasName: true, distanceM: 8_000 },
  ];
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 0, 'defaults keep a hex-only nearby aircraft');
  assert.equal(findCompatibleHistoryIndex(history, 2, 1, {
    resolveItem: (subject) => subject,
  }), 3, 'defaults still walk onto a vessel');

  setAwarenessAircraftOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, 2, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'aircraft-only drops vessel and site after the last flight');
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 0, 'aircraft-only still keeps a hex-only flight');

  setAwarenessIdentifiedEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 1, 'AND: identified-only skips hex-only and keeps a callsign aircraft');

  setAwarenessRangeFilter('10', { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    aircraftClass: 'airliner',
    resolveItem: (subject) => subject,
  }), 1, 'AND: class + identified + <10 km + aircraft-only keeps the nearby callsign');
  assert.equal(findCompatibleHistoryIndex(history, 1, 1, {
    aircraftClass: 'airliner',
    resolveItem: (subject) => subject,
  }), -1, 'AND: <10 km drops the 200 km callsign and aircraft-only drops the vessel');
  resetAwarenessIdentifiedForTest();
  resetAwarenessRangeForTest();
  resetAwarenessAircraftOnlyForTest();
});

test('militaryAwareness setParams flips Aircraft-only without a share token', () => {
  resetAwarenessAircraftOnlyForTest();
  assert.equal(militaryAwarenessLayer.getParams().aircraftOnly, false);
  assert.equal(militaryAwarenessLayer.setParams({ aircraftOnly: true }), undefined);
  assert.equal(militaryAwarenessLayer.getParams().aircraftOnly, true);
  assert.equal(getAwarenessAircraftOnlyEnabled(), true);
  militaryAwarenessLayer.setParams({ aircraftOnly: false });
  assert.equal(militaryAwarenessLayer.getParams().aircraftOnly, false);
  resetAwarenessAircraftOnlyForTest();
});

test('Context panel chip is wired; in-flight layer files are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const awareness = data('militaryAwareness.js');
  const helper = data('awarenessAircraftFilter.js');
  const engine = data('militaryAwarenessEngine.js');

  assert.match(awareness, /data-awareness-action="aircraft-only"/);
  assert.match(awareness, /AWARENESS_AIRCRAFT_CHIP_LABEL|Aircraft only/);
  assert.match(awareness, /setAwarenessAircraftOnlyEnabled|aircraftOnly/);
  assert.doesNotMatch(ui, /awarenessAircraftOnly|_initAwarenessAircraft/);

  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.match(helper, /meridian\.awarenessAircraftOnly/);
  assert.match(engine, /export const AWARENESS_RADIUS_M = 250000/);

  for (const file of HARD_NO_LAYER_FILES) {
    const source = data(file);
    assert.doesNotMatch(source, /awarenessAircraftOnly|meridian\.awarenessAircraftOnly/);
    assert.doesNotMatch(source, /AWARENESS_AIRCRAFT/);
  }

  const panelStart = html.indexOf('id="military-awareness-panel"');
  assert.ok(panelStart >= 0);
  const panelHtml = html.slice(panelStart);
  assert.match(panelHtml, /data-awareness-action="aircraft-only"/);
  assert.match(panelHtml, /Aircraft only/);
  assert.match(panelHtml, /data-awareness-action="identified-only"/);
  assert.match(panelHtml, /data-awareness-action="range"/);
  const chip = awarenessAircraftChipModel(false);
  assert.equal(chip.id, AWARENESS_AIRCRAFT_CHIP_ID);
  assert.equal(chip.label, AWARENESS_AIRCRAFT_CHIP_LABEL);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { aircraftOnly: true });
  assert.deepEqual(awarenessAircraftChipModel(true).params, { aircraftOnly: false });
});

test('militaryAwarenessEngine.js is unchanged', () => {
  const engine = data('militaryAwarenessEngine.js');
  assert.doesNotMatch(engine, /awarenessAircraftOnly|AWARENESS_AIRCRAFT/);
  assert.doesNotMatch(engine, /Aircraft only/);
  assert.match(engine, /export const AWARENESS_RADIUS_M = 250000/);
});

test('legal: already-fetched fields only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('awarenessAircraftFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /\/api\//);
  assert.doesNotMatch(moduleSource, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(moduleSource, /God's Eye View|gods-eye-view/i);
  assert.doesNotMatch(moduleSource, /AWARENESS_RADIUS_M\s*=/);
  assert.doesNotMatch(moduleSource, /hide-ground|hideGround/);
});
