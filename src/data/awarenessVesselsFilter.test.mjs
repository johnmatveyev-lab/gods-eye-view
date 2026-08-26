// PLAN 251 — Context Vessels only. Client-only filter of already-fetched
// getNearby records on the Global Context roster / NEXT walk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

import {
  AWARENESS_VESSELS_CHIP_ID,
  AWARENESS_VESSELS_CHIP_LABEL,
  AWARENESS_VESSELS_DEFAULT,
  AWARENESS_VESSELS_LAYER_ID,
  AWARENESS_VESSELS_STORAGE_KEY,
  awarenessVesselsChipModel,
  filterAwarenessVesselsContacts,
  getAwarenessVesselsOnlyEnabled,
  hydrateAwarenessVesselsOnlyEnabled,
  normalizeAwarenessVesselsOnly,
  passesAwarenessVesselsFilter,
  readAwarenessVesselsOnlyEnabled,
  resetAwarenessVesselsOnlyForTest,
  setAwarenessVesselsOnlyEnabled,
  writeAwarenessVesselsOnlyEnabled,
} from './awarenessVesselsFilter.js';
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

test('Off keeps flight / vessel / site', () => {
  assert.equal(AWARENESS_VESSELS_DEFAULT, false);
  assert.equal(AWARENESS_VESSELS_STORAGE_KEY, 'meridian.awarenessVesselsOnly');
  assert.equal(AWARENESS_VESSELS_LAYER_ID, 'ais-live-vessels');
  assert.equal(AWARENESS_RADIUS_M, 250_000, 'do not shrink AWARENESS_RADIUS_M');

  for (const contact of [FLIGHT, MILITARY, VESSEL, SITE]) {
    assert.equal(passesAwarenessVesselsFilter(contact, { vesselsOnly: false }), true);
  }
  const kept = filterAwarenessVesselsContacts(
    [FLIGHT, MILITARY, VESSEL, SITE],
    { vesselsOnly: false },
  );
  assert.deepEqual(kept.map((row) => row.layerId), [
    'flights',
    'military',
    'ais-live-vessels',
    'military-installations',
  ]);
});

test('On keeps ais-live-vessels, drops flights and military-installations', () => {
  assert.equal(passesAwarenessVesselsFilter(VESSEL, { vesselsOnly: true }), true);
  assert.equal(passesAwarenessVesselsFilter(FLIGHT, { vesselsOnly: true }), false);
  assert.equal(passesAwarenessVesselsFilter(MILITARY, { vesselsOnly: true }), false);
  assert.equal(passesAwarenessVesselsFilter(SITE, { vesselsOnly: true }), false);

  const kept = filterAwarenessVesselsContacts(
    [FLIGHT, MILITARY, VESSEL, SITE],
    { vesselsOnly: true },
  );
  assert.deepEqual(kept.map((row) => row.layerId), ['ais-live-vessels']);
});

test('Subject always kept', () => {
  assert.equal(passesAwarenessVesselsFilter(FLIGHT, {
    vesselsOnly: true,
    subjectId: 'DAL123',
  }), true);
  assert.equal(passesAwarenessVesselsFilter(FLIGHT, {
    vesselsOnly: true,
    subjectId: 'flights:DAL123',
  }), true);
  assert.equal(passesAwarenessVesselsFilter(SITE, {
    vesselsOnly: true,
    subjectId: 'osm:way:2',
  }), true);
  assert.equal(passesAwarenessVesselsFilter(MILITARY, {
    vesselsOnly: true,
    subjectId: 'RCH001',
  }), true);
  assert.equal(passesAwarenessVesselsFilter(FLIGHT, {
    vesselsOnly: true,
    subjectId: 'other',
  }), false);
});

test('Missing layerId stays', () => {
  assert.equal(passesAwarenessVesselsFilter(MISSING_LAYER, { vesselsOnly: true }), true);
  assert.equal(passesAwarenessVesselsFilter({ icao24: 'abc123', callsign: 'NODIST' }, {
    vesselsOnly: true,
  }), true);
  assert.equal(passesAwarenessVesselsFilter({ layerId: '', icao24: 'x' }, {
    vesselsOnly: true,
  }), true);
  assert.equal(passesAwarenessVesselsFilter({ layerId: '   ', mmsi: '1' }, {
    vesselsOnly: true,
  }), true);
  const kept = filterAwarenessVesselsContacts(
    [MISSING_LAYER, FLIGHT, VESSEL],
    { vesselsOnly: true },
  );
  assert.deepEqual(kept.map((row) => row.icao24 || row.mmsi), ['nodist', '366999000']);
});

test('Invalid storage reads as off', () => {
  assert.equal(normalizeAwarenessVesselsOnly(undefined), false);
  assert.equal(normalizeAwarenessVesselsOnly(null), false);
  assert.equal(normalizeAwarenessVesselsOnly('nope'), false);
  assert.equal(normalizeAwarenessVesselsOnly('{oops'), false);
  assert.equal(normalizeAwarenessVesselsOnly(false), false);
  assert.equal(normalizeAwarenessVesselsOnly(true), true);
  assert.equal(normalizeAwarenessVesselsOnly('1'), true);
  assert.equal(readAwarenessVesselsOnlyEnabled(memoryStorage()), false);
  assert.equal(readAwarenessVesselsOnlyEnabled(memoryStorage({
    [AWARENESS_VESSELS_STORAGE_KEY]: 'maybe',
  })), false);
  assert.equal(readAwarenessVesselsOnlyEnabled(memoryStorage({
    [AWARENESS_VESSELS_STORAGE_KEY]: '{oops',
  })), false);
  assert.equal(readAwarenessVesselsOnlyEnabled({
    getItem() { throw new Error('blocked'); },
  }), false);
});

test('Persist flip survives reload', () => {
  resetAwarenessVesselsOnlyForTest();
  const storage = memoryStorage();
  assert.equal(readAwarenessVesselsOnlyEnabled(storage), false);
  assert.equal(setAwarenessVesselsOnlyEnabled(true, { storage }), true);
  assert.deepEqual(storage.snapshot(), { [AWARENESS_VESSELS_STORAGE_KEY]: '1' });
  assert.equal(readAwarenessVesselsOnlyEnabled(storage), true);

  resetAwarenessVesselsOnlyForTest();
  assert.equal(getAwarenessVesselsOnlyEnabled(), false, 'in-memory reset is off');
  assert.equal(hydrateAwarenessVesselsOnlyEnabled(storage), true);
  assert.equal(getAwarenessVesselsOnlyEnabled(), true);
  assert.deepEqual(storage.snapshot(), { [AWARENESS_VESSELS_STORAGE_KEY]: '1' },
    'hydrate must not rewrite storage');

  assert.equal(writeAwarenessVesselsOnlyEnabled(false, storage), true);
  assert.equal(storage.snapshot()[AWARENESS_VESSELS_STORAGE_KEY], '0');
  resetAwarenessVesselsOnlyForTest();
});

test('LayerStateCoordinator restore stays local — no share-URL write', () => {
  const defaults = createDefaultLayerState();
  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), defaults).toString();
  assert.doesNotMatch(encoded, /awarenessVesselsOnly/);
  assert.doesNotMatch(encoded, /meridian\.awarenessVesselsOnly/);
  assert.equal(Object.hasOwn(defaults.options, 'military-awareness'), false);

  const layerState = data('layerState.js');
  assert.match(layerState, /id: 'military-awareness', token: 'g', disposition: 'enabled-only'/);
  assert.doesNotMatch(layerState, /awarenessVesselsOnly|AWARENESS_VESSELS/);

  const sharelink = src('sharelink.js');
  assert.doesNotMatch(sharelink, /awarenessVesselsOnly|meridian\.awarenessVesselsOnly/);
});

test('AND with 213 Identified only, 221 range, and 231 Aircraft only', () => {
  resetAwarenessIdentifiedForTest();
  resetAwarenessRangeForTest();
  resetAwarenessAircraftOnlyForTest();
  resetAwarenessVesselsOnlyForTest();
  const awareness = data('militaryAwareness.js');
  assert.match(awareness, /filterAwarenessVesselsContacts|passesAwarenessVesselsFilter/);
  assert.match(awareness, /filterAwarenessAircraftContacts|passesAwarenessAircraftFilter/);
  assert.match(awareness, /filterAwarenessIdentifiedContacts|passesAwarenessIdentifiedFilter/);
  assert.match(awareness, /filterAwarenessRangeContacts|passesAwarenessRangeFilter/);
  assert.match(
    awareness,
    /if \(aircraftClass\) \{[\s\S]*passesAwarenessIdentifiedFilter[\s\S]*passesAwarenessRangeFilter[\s\S]*passesAwarenessAircraftFilter[\s\S]*passesAwarenessVesselsFilter/,
  );

  const history = [
    { layerId: 'flights', id: 'hex001', callsign: '', distanceM: 8_000 },
    { layerId: 'flights', id: 'dal001', callsign: 'DAL123', aircraftClass: 'airliner', distanceM: 8_000 },
    { layerId: 'flights', id: 'far200', callsign: 'FAR200', aircraftClass: 'airliner', distanceM: 200_000 },
    { layerId: 'ais-live-vessels', id: '366999000', mmsi: '366999000', name: 'EVER GIVEN', distanceM: 8_000 },
    { layerId: 'military-installations', id: 'osm:way:2', name: 'Fort Hood', hasName: true, distanceM: 8_000 },
  ];
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 0, 'defaults keep a hex-only nearby aircraft');
  assert.equal(findCompatibleHistoryIndex(history, 2, 1, {
    resolveItem: (subject) => subject,
  }), 3, 'defaults still walk onto a vessel');

  setAwarenessVesselsOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 3, 'vessels-only skips flights and sites and keeps AIS');
  assert.equal(findCompatibleHistoryIndex(history, 3, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'vessels-only drops the site after the vessel');

  setAwarenessAircraftOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'AND: aircraft-only + vessels-only leaves the walk empty');

  setAwarenessAircraftOnlyEnabled(false, { persist: false });
  setAwarenessIdentifiedEnabled(true, { persist: false });
  setAwarenessRangeFilter('10', { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 3, 'AND: identified + <10 km + vessels-only keeps the named nearby vessel');
  resetAwarenessIdentifiedForTest();
  resetAwarenessRangeForTest();
  resetAwarenessAircraftOnlyForTest();
  resetAwarenessVesselsOnlyForTest();
});

test('militaryAwareness setParams flips Vessels-only without a share token', () => {
  resetAwarenessVesselsOnlyForTest();
  assert.equal(militaryAwarenessLayer.getParams().vesselsOnly, false);
  assert.equal(militaryAwarenessLayer.setParams({ vesselsOnly: true }), undefined);
  assert.equal(militaryAwarenessLayer.getParams().vesselsOnly, true);
  assert.equal(getAwarenessVesselsOnlyEnabled(), true);
  militaryAwarenessLayer.setParams({ vesselsOnly: false });
  assert.equal(militaryAwarenessLayer.getParams().vesselsOnly, false);
  resetAwarenessVesselsOnlyForTest();
});

test('Context panel chip is wired; in-flight layer files are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const awareness = data('militaryAwareness.js');
  const helper = data('awarenessVesselsFilter.js');
  const engine = data('militaryAwarenessEngine.js');

  assert.match(awareness, /data-awareness-action="vessels-only"/);
  assert.match(awareness, /AWARENESS_VESSELS_CHIP_LABEL|Vessels only/);
  assert.match(awareness, /setAwarenessVesselsOnlyEnabled|vesselsOnly/);
  assert.doesNotMatch(ui, /awarenessVesselsOnly|_initAwarenessVessels/);

  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.match(helper, /meridian\.awarenessVesselsOnly/);
  assert.match(engine, /export const AWARENESS_RADIUS_M = 250000/);

  for (const file of HARD_NO_LAYER_FILES) {
    const source = data(file);
    assert.doesNotMatch(source, /awarenessVesselsOnly|meridian\.awarenessVesselsOnly/);
    assert.doesNotMatch(source, /AWARENESS_VESSELS/);
  }

  const panelStart = html.indexOf('id="military-awareness-panel"');
  assert.ok(panelStart >= 0);
  const panelHtml = html.slice(panelStart);
  assert.match(panelHtml, /data-awareness-action="vessels-only"/);
  assert.match(panelHtml, /Vessels only/);
  assert.match(panelHtml, /data-awareness-action="aircraft-only"/);
  assert.match(panelHtml, /data-awareness-action="identified-only"/);
  assert.match(panelHtml, /data-awareness-action="range"/);
  const chip = awarenessVesselsChipModel(false);
  assert.equal(chip.id, AWARENESS_VESSELS_CHIP_ID);
  assert.equal(chip.label, AWARENESS_VESSELS_CHIP_LABEL);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { vesselsOnly: true });
  assert.deepEqual(awarenessVesselsChipModel(true).params, { vesselsOnly: false });
});

test('militaryAwarenessEngine.js is unchanged', () => {
  const engine = data('militaryAwarenessEngine.js');
  assert.doesNotMatch(engine, /awarenessVesselsOnly|AWARENESS_VESSELS/);
  assert.doesNotMatch(engine, /Vessels only/);
  assert.match(engine, /export const AWARENESS_RADIUS_M = 250000/);
});

test('legal: already-fetched fields only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('awarenessVesselsFilter.js');
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
