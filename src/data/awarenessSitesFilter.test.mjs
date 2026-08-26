// PLAN 259 — Context Sites only. Client-only filter of already-fetched
// getNearby records on the Global Context roster / NEXT walk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

import {
  AWARENESS_SITES_CHIP_ID,
  AWARENESS_SITES_CHIP_LABEL,
  AWARENESS_SITES_DEFAULT,
  AWARENESS_SITES_LAYER_ID,
  AWARENESS_SITES_STORAGE_KEY,
  awarenessSitesChipModel,
  filterAwarenessSitesContacts,
  getAwarenessSitesOnlyEnabled,
  hydrateAwarenessSitesOnlyEnabled,
  normalizeAwarenessSitesOnly,
  passesAwarenessSitesFilter,
  readAwarenessSitesOnlyEnabled,
  resetAwarenessSitesOnlyForTest,
  setAwarenessSitesOnlyEnabled,
  writeAwarenessSitesOnlyEnabled,
} from './awarenessSitesFilter.js';
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
  assert.equal(AWARENESS_SITES_DEFAULT, false);
  assert.equal(AWARENESS_SITES_STORAGE_KEY, 'meridian.awarenessSitesOnly');
  assert.equal(AWARENESS_SITES_LAYER_ID, 'military-installations');
  assert.equal(AWARENESS_RADIUS_M, 250_000, 'do not shrink AWARENESS_RADIUS_M');

  for (const contact of [FLIGHT, MILITARY, VESSEL, SITE]) {
    assert.equal(passesAwarenessSitesFilter(contact, { sitesOnly: false }), true);
  }
  const kept = filterAwarenessSitesContacts(
    [FLIGHT, MILITARY, VESSEL, SITE],
    { sitesOnly: false },
  );
  assert.deepEqual(kept.map((row) => row.layerId), [
    'flights',
    'military',
    'ais-live-vessels',
    'military-installations',
  ]);
});

test('On keeps military-installations, drops flights and AIS', () => {
  assert.equal(passesAwarenessSitesFilter(SITE, { sitesOnly: true }), true);
  assert.equal(passesAwarenessSitesFilter(FLIGHT, { sitesOnly: true }), false);
  assert.equal(passesAwarenessSitesFilter(MILITARY, { sitesOnly: true }), false);
  assert.equal(passesAwarenessSitesFilter(VESSEL, { sitesOnly: true }), false);

  const kept = filterAwarenessSitesContacts(
    [FLIGHT, MILITARY, VESSEL, SITE],
    { sitesOnly: true },
  );
  assert.deepEqual(kept.map((row) => row.layerId), ['military-installations']);
});

test('Subject always kept', () => {
  assert.equal(passesAwarenessSitesFilter(FLIGHT, {
    sitesOnly: true,
    subjectId: 'DAL123',
  }), true);
  assert.equal(passesAwarenessSitesFilter(FLIGHT, {
    sitesOnly: true,
    subjectId: 'flights:DAL123',
  }), true);
  assert.equal(passesAwarenessSitesFilter(VESSEL, {
    sitesOnly: true,
    subjectId: '366999000',
  }), true);
  assert.equal(passesAwarenessSitesFilter(MILITARY, {
    sitesOnly: true,
    subjectId: 'RCH001',
  }), true);
  assert.equal(passesAwarenessSitesFilter(FLIGHT, {
    sitesOnly: true,
    subjectId: 'other',
  }), false);
});

test('Missing layerId stays', () => {
  assert.equal(passesAwarenessSitesFilter(MISSING_LAYER, { sitesOnly: true }), true);
  assert.equal(passesAwarenessSitesFilter({ icao24: 'abc123', callsign: 'NODIST' }, {
    sitesOnly: true,
  }), true);
  assert.equal(passesAwarenessSitesFilter({ layerId: '', icao24: 'x' }, {
    sitesOnly: true,
  }), true);
  assert.equal(passesAwarenessSitesFilter({ layerId: '   ', mmsi: '1' }, {
    sitesOnly: true,
  }), true);
  const kept = filterAwarenessSitesContacts(
    [MISSING_LAYER, FLIGHT, SITE],
    { sitesOnly: true },
  );
  assert.deepEqual(kept.map((row) => row.icao24 || row.id), ['nodist', 'osm:way:2']);
});

test('Invalid storage reads as off', () => {
  assert.equal(normalizeAwarenessSitesOnly(undefined), false);
  assert.equal(normalizeAwarenessSitesOnly(null), false);
  assert.equal(normalizeAwarenessSitesOnly('nope'), false);
  assert.equal(normalizeAwarenessSitesOnly('{oops'), false);
  assert.equal(normalizeAwarenessSitesOnly(false), false);
  assert.equal(normalizeAwarenessSitesOnly(true), true);
  assert.equal(normalizeAwarenessSitesOnly('1'), true);
  assert.equal(readAwarenessSitesOnlyEnabled(memoryStorage()), false);
  assert.equal(readAwarenessSitesOnlyEnabled(memoryStorage({
    [AWARENESS_SITES_STORAGE_KEY]: 'maybe',
  })), false);
  assert.equal(readAwarenessSitesOnlyEnabled(memoryStorage({
    [AWARENESS_SITES_STORAGE_KEY]: '{oops',
  })), false);
  assert.equal(readAwarenessSitesOnlyEnabled({
    getItem() { throw new Error('blocked'); },
  }), false);
});

test('Persist flip survives reload', () => {
  resetAwarenessSitesOnlyForTest();
  const storage = memoryStorage();
  assert.equal(readAwarenessSitesOnlyEnabled(storage), false);
  assert.equal(setAwarenessSitesOnlyEnabled(true, { storage }), true);
  assert.deepEqual(storage.snapshot(), { [AWARENESS_SITES_STORAGE_KEY]: '1' });
  assert.equal(readAwarenessSitesOnlyEnabled(storage), true);

  resetAwarenessSitesOnlyForTest();
  assert.equal(getAwarenessSitesOnlyEnabled(), false, 'in-memory reset is off');
  assert.equal(hydrateAwarenessSitesOnlyEnabled(storage), true);
  assert.equal(getAwarenessSitesOnlyEnabled(), true);
  assert.deepEqual(storage.snapshot(), { [AWARENESS_SITES_STORAGE_KEY]: '1' },
    'hydrate must not rewrite storage');

  assert.equal(writeAwarenessSitesOnlyEnabled(false, storage), true);
  assert.equal(storage.snapshot()[AWARENESS_SITES_STORAGE_KEY], '0');
  resetAwarenessSitesOnlyForTest();
});

test('LayerStateCoordinator restore stays local — no share-URL write', () => {
  const defaults = createDefaultLayerState();
  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), defaults).toString();
  assert.doesNotMatch(encoded, /awarenessSitesOnly/);
  assert.doesNotMatch(encoded, /meridian\.awarenessSitesOnly/);
  assert.equal(Object.hasOwn(defaults.options, 'military-awareness'), false);

  const layerState = data('layerState.js');
  assert.match(layerState, /id: 'military-awareness', token: 'g', disposition: 'enabled-only'/);
  assert.doesNotMatch(layerState, /awarenessSitesOnly|AWARENESS_SITES/);

  const sharelink = src('sharelink.js');
  assert.doesNotMatch(sharelink, /awarenessSitesOnly|meridian\.awarenessSitesOnly/);
});

test('AND with 213 Identified only, 221 range, 231 Aircraft only, and 251 Vessels only', () => {
  resetAwarenessIdentifiedForTest();
  resetAwarenessRangeForTest();
  resetAwarenessAircraftOnlyForTest();
  resetAwarenessVesselsOnlyForTest();
  resetAwarenessSitesOnlyForTest();
  const awareness = data('militaryAwareness.js');
  assert.match(awareness, /filterAwarenessSitesContacts|passesAwarenessSitesFilter/);
  assert.match(awareness, /filterAwarenessVesselsContacts|passesAwarenessVesselsFilter/);
  assert.match(awareness, /filterAwarenessAircraftContacts|passesAwarenessAircraftFilter/);
  assert.match(awareness, /filterAwarenessIdentifiedContacts|passesAwarenessIdentifiedFilter/);
  assert.match(awareness, /filterAwarenessRangeContacts|passesAwarenessRangeFilter/);
  assert.match(
    awareness,
    /if \(aircraftClass\) \{[\s\S]*passesAwarenessIdentifiedFilter[\s\S]*passesAwarenessRangeFilter[\s\S]*passesAwarenessAircraftFilter[\s\S]*passesAwarenessVesselsFilter[\s\S]*passesAwarenessSitesFilter/,
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

  setAwarenessSitesOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 4, 'sites-only skips flights and AIS and keeps the site');
  assert.equal(findCompatibleHistoryIndex(history, 4, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'sites-only has nothing after the site');

  setAwarenessAircraftOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'AND: aircraft-only + sites-only leaves the walk empty');

  setAwarenessAircraftOnlyEnabled(false, { persist: false });
  setAwarenessVesselsOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'AND: vessels-only + sites-only leaves the walk empty');

  setAwarenessVesselsOnlyEnabled(false, { persist: false });
  setAwarenessIdentifiedEnabled(true, { persist: false });
  setAwarenessRangeFilter('10', { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 4, 'AND: identified + <10 km + sites-only keeps the named nearby site');
  resetAwarenessIdentifiedForTest();
  resetAwarenessRangeForTest();
  resetAwarenessAircraftOnlyForTest();
  resetAwarenessVesselsOnlyForTest();
  resetAwarenessSitesOnlyForTest();
});

test('militaryAwareness setParams flips Sites-only without a share token', () => {
  resetAwarenessSitesOnlyForTest();
  assert.equal(militaryAwarenessLayer.getParams().sitesOnly, false);
  assert.equal(militaryAwarenessLayer.setParams({ sitesOnly: true }), undefined);
  assert.equal(militaryAwarenessLayer.getParams().sitesOnly, true);
  assert.equal(getAwarenessSitesOnlyEnabled(), true);
  militaryAwarenessLayer.setParams({ sitesOnly: false });
  assert.equal(militaryAwarenessLayer.getParams().sitesOnly, false);
  resetAwarenessSitesOnlyForTest();
});

test('Context panel chip is wired; in-flight layer files are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const awareness = data('militaryAwareness.js');
  const helper = data('awarenessSitesFilter.js');
  const engine = data('militaryAwarenessEngine.js');

  assert.match(awareness, /data-awareness-action="sites-only"/);
  assert.match(awareness, /AWARENESS_SITES_CHIP_LABEL|Sites only/);
  assert.match(awareness, /setAwarenessSitesOnlyEnabled|sitesOnly/);
  assert.doesNotMatch(ui, /awarenessSitesOnly|_initAwarenessSites/);
  assert.doesNotMatch(html, /awarenessSitesOnly|_initAwarenessSites/);

  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.match(helper, /meridian\.awarenessSitesOnly/);
  assert.match(engine, /export const AWARENESS_RADIUS_M = 250000/);

  for (const file of HARD_NO_LAYER_FILES) {
    const source = data(file);
    assert.doesNotMatch(source, /awarenessSitesOnly|meridian\.awarenessSitesOnly/);
    assert.doesNotMatch(source, /AWARENESS_SITES/);
  }

  const chip = awarenessSitesChipModel(false);
  assert.equal(chip.id, AWARENESS_SITES_CHIP_ID);
  assert.equal(chip.label, AWARENESS_SITES_CHIP_LABEL);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { sitesOnly: true });
  assert.deepEqual(awarenessSitesChipModel(true).params, { sitesOnly: false });
});

test('militaryAwarenessEngine.js is unchanged', () => {
  const engine = data('militaryAwarenessEngine.js');
  assert.doesNotMatch(engine, /awarenessSitesOnly|AWARENESS_SITES/);
  assert.doesNotMatch(engine, /Sites only/);
  assert.match(engine, /export const AWARENESS_RADIUS_M = 250000/);
});

test('legal: already-fetched fields only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('awarenessSitesFilter.js');
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
