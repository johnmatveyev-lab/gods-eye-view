// PLAN 263 — Context Military only. Client-only filter of already-fetched
// getNearby records on the Global Context roster / NEXT walk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

import {
  AWARENESS_MILITARY_CHIP_ID,
  AWARENESS_MILITARY_CHIP_LABEL,
  AWARENESS_MILITARY_DEFAULT,
  AWARENESS_MILITARY_LAYER_ID,
  AWARENESS_MILITARY_STORAGE_KEY,
  awarenessMilitaryChipModel,
  filterAwarenessMilitaryContacts,
  getAwarenessMilitaryOnlyEnabled,
  hydrateAwarenessMilitaryOnlyEnabled,
  normalizeAwarenessMilitaryOnly,
  passesAwarenessMilitaryFilter,
  readAwarenessMilitaryOnlyEnabled,
  resetAwarenessMilitaryOnlyForTest,
  setAwarenessMilitaryOnlyEnabled,
  writeAwarenessMilitaryOnlyEnabled,
} from './awarenessMilitaryFilter.js';
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
  assert.equal(AWARENESS_MILITARY_DEFAULT, false);
  assert.equal(AWARENESS_MILITARY_STORAGE_KEY, 'meridian.awarenessMilitaryOnly');
  assert.equal(AWARENESS_MILITARY_LAYER_ID, 'military');
  assert.equal(AWARENESS_RADIUS_M, 250_000, 'do not shrink AWARENESS_RADIUS_M');

  for (const contact of [FLIGHT, MILITARY, VESSEL, SITE]) {
    assert.equal(passesAwarenessMilitaryFilter(contact, { militaryOnly: false }), true);
  }
  const kept = filterAwarenessMilitaryContacts(
    [FLIGHT, MILITARY, VESSEL, SITE],
    { militaryOnly: false },
  );
  assert.deepEqual(kept.map((row) => row.layerId), [
    'flights',
    'military',
    'ais-live-vessels',
    'military-installations',
  ]);
});

test('On keeps military and drops flights + AIS + sites', () => {
  assert.equal(passesAwarenessMilitaryFilter(MILITARY, { militaryOnly: true }), true);
  assert.equal(passesAwarenessMilitaryFilter(FLIGHT, { militaryOnly: true }), false);
  assert.equal(passesAwarenessMilitaryFilter(VESSEL, { militaryOnly: true }), false);
  assert.equal(passesAwarenessMilitaryFilter(SITE, { militaryOnly: true }), false);

  const kept = filterAwarenessMilitaryContacts(
    [FLIGHT, MILITARY, VESSEL, SITE],
    { militaryOnly: true },
  );
  assert.deepEqual(kept.map((row) => row.layerId), ['military']);
});

test('Subject always kept, including civil / AIS / site', () => {
  assert.equal(passesAwarenessMilitaryFilter(FLIGHT, {
    militaryOnly: true,
    subjectId: 'DAL123',
  }), true);
  assert.equal(passesAwarenessMilitaryFilter(FLIGHT, {
    militaryOnly: true,
    subjectId: 'flights:DAL123',
  }), true);
  assert.equal(passesAwarenessMilitaryFilter(VESSEL, {
    militaryOnly: true,
    subjectId: '366999000',
  }), true);
  assert.equal(passesAwarenessMilitaryFilter(SITE, {
    militaryOnly: true,
    subjectId: 'osm:way:2',
  }), true);
  assert.equal(passesAwarenessMilitaryFilter(MILITARY, {
    militaryOnly: true,
    subjectId: 'RCH001',
  }), true);
  assert.equal(passesAwarenessMilitaryFilter(FLIGHT, {
    militaryOnly: true,
    subjectId: 'other',
  }), false);
});

test('Missing layerId stays', () => {
  assert.equal(passesAwarenessMilitaryFilter(MISSING_LAYER, { militaryOnly: true }), true);
  assert.equal(passesAwarenessMilitaryFilter({ icao24: 'abc123', callsign: 'NODIST' }, {
    militaryOnly: true,
  }), true);
  assert.equal(passesAwarenessMilitaryFilter({ layerId: '', icao24: 'x' }, {
    militaryOnly: true,
  }), true);
  assert.equal(passesAwarenessMilitaryFilter({ layerId: '   ', mmsi: '1' }, {
    militaryOnly: true,
  }), true);
  const kept = filterAwarenessMilitaryContacts(
    [MISSING_LAYER, FLIGHT, MILITARY],
    { militaryOnly: true },
  );
  assert.deepEqual(kept.map((row) => row.icao24 || row.id), ['nodist', 'ae01ce']);
});

test('Invalid storage reads as off', () => {
  assert.equal(normalizeAwarenessMilitaryOnly(undefined), false);
  assert.equal(normalizeAwarenessMilitaryOnly(null), false);
  assert.equal(normalizeAwarenessMilitaryOnly('nope'), false);
  assert.equal(normalizeAwarenessMilitaryOnly('{oops'), false);
  assert.equal(normalizeAwarenessMilitaryOnly(false), false);
  assert.equal(normalizeAwarenessMilitaryOnly(true), true);
  assert.equal(normalizeAwarenessMilitaryOnly('1'), true);
  assert.equal(readAwarenessMilitaryOnlyEnabled(memoryStorage()), false);
  assert.equal(readAwarenessMilitaryOnlyEnabled(memoryStorage({
    [AWARENESS_MILITARY_STORAGE_KEY]: 'maybe',
  })), false);
  assert.equal(readAwarenessMilitaryOnlyEnabled(memoryStorage({
    [AWARENESS_MILITARY_STORAGE_KEY]: '{oops',
  })), false);
  assert.equal(readAwarenessMilitaryOnlyEnabled({
    getItem() { throw new Error('blocked'); },
  }), false);
});

test('Persist flip survives reload', () => {
  resetAwarenessMilitaryOnlyForTest();
  const storage = memoryStorage();
  assert.equal(readAwarenessMilitaryOnlyEnabled(storage), false);
  assert.equal(setAwarenessMilitaryOnlyEnabled(true, { storage }), true);
  assert.deepEqual(storage.snapshot(), { [AWARENESS_MILITARY_STORAGE_KEY]: '1' });
  assert.equal(readAwarenessMilitaryOnlyEnabled(storage), true);

  resetAwarenessMilitaryOnlyForTest();
  assert.equal(getAwarenessMilitaryOnlyEnabled(), false, 'in-memory reset is off');
  assert.equal(hydrateAwarenessMilitaryOnlyEnabled(storage), true);
  assert.equal(getAwarenessMilitaryOnlyEnabled(), true);
  assert.deepEqual(storage.snapshot(), { [AWARENESS_MILITARY_STORAGE_KEY]: '1' },
    'hydrate must not rewrite storage');

  assert.equal(writeAwarenessMilitaryOnlyEnabled(false, storage), true);
  assert.equal(storage.snapshot()[AWARENESS_MILITARY_STORAGE_KEY], '0');
  resetAwarenessMilitaryOnlyForTest();
});

test('LayerStateCoordinator restore stays local — no share-URL write', () => {
  const defaults = createDefaultLayerState();
  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), defaults).toString();
  assert.doesNotMatch(encoded, /awarenessMilitaryOnly/);
  assert.doesNotMatch(encoded, /meridian\.awarenessMilitaryOnly/);
  assert.equal(Object.hasOwn(defaults.options, 'military-awareness'), false);

  const layerState = data('layerState.js');
  assert.match(layerState, /id: 'military-awareness', token: 'g', disposition: 'enabled-only'/);
  assert.doesNotMatch(layerState, /awarenessMilitaryOnly|AWARENESS_MILITARY/);

  const sharelink = src('sharelink.js');
  assert.doesNotMatch(sharelink, /awarenessMilitaryOnly|meridian\.awarenessMilitaryOnly/);
});

test('AND with 213 Identified only, 221 range, 231 Aircraft only, 251 Vessels only, and 259 Sites only', () => {
  resetAwarenessIdentifiedForTest();
  resetAwarenessRangeForTest();
  resetAwarenessAircraftOnlyForTest();
  resetAwarenessVesselsOnlyForTest();
  resetAwarenessSitesOnlyForTest();
  resetAwarenessMilitaryOnlyForTest();
  const awareness = data('militaryAwareness.js');
  assert.match(awareness, /filterAwarenessMilitaryContacts|passesAwarenessMilitaryFilter/);
  assert.match(awareness, /filterAwarenessSitesContacts|passesAwarenessSitesFilter/);
  assert.match(awareness, /filterAwarenessVesselsContacts|passesAwarenessVesselsFilter/);
  assert.match(awareness, /filterAwarenessAircraftContacts|passesAwarenessAircraftFilter/);
  assert.match(awareness, /filterAwarenessIdentifiedContacts|passesAwarenessIdentifiedFilter/);
  assert.match(awareness, /filterAwarenessRangeContacts|passesAwarenessRangeFilter/);
  assert.match(
    awareness,
    /if \(aircraftClass\) \{[\s\S]*passesAwarenessIdentifiedFilter[\s\S]*passesAwarenessRangeFilter[\s\S]*passesAwarenessAircraftFilter[\s\S]*passesAwarenessVesselsFilter[\s\S]*passesAwarenessSitesFilter[\s\S]*passesAwarenessMilitaryFilter/,
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

  setAwarenessMilitaryOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 3, 'military-only skips civil flights, AIS, and sites and keeps military');
  assert.equal(findCompatibleHistoryIndex(history, 3, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'military-only has nothing after the military flight');

  setAwarenessAircraftOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 3, 'AND: aircraft-only + military-only keeps the military flight');

  setAwarenessAircraftOnlyEnabled(false, { persist: false });
  setAwarenessVesselsOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'AND: vessels-only + military-only leaves the walk empty');

  setAwarenessVesselsOnlyEnabled(false, { persist: false });
  setAwarenessSitesOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'AND: sites-only + military-only leaves the walk empty');

  setAwarenessSitesOnlyEnabled(false, { persist: false });
  setAwarenessIdentifiedEnabled(true, { persist: false });
  setAwarenessRangeFilter('10', { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 3, 'AND: identified + <10 km + military-only keeps the named nearby military flight');
  resetAwarenessIdentifiedForTest();
  resetAwarenessRangeForTest();
  resetAwarenessAircraftOnlyForTest();
  resetAwarenessVesselsOnlyForTest();
  resetAwarenessSitesOnlyForTest();
  resetAwarenessMilitaryOnlyForTest();
});

test('militaryAwareness setParams flips Military-only without a share token', () => {
  resetAwarenessMilitaryOnlyForTest();
  assert.equal(militaryAwarenessLayer.getParams().militaryOnly, false);
  assert.equal(militaryAwarenessLayer.setParams({ militaryOnly: true }), undefined);
  assert.equal(militaryAwarenessLayer.getParams().militaryOnly, true);
  assert.equal(getAwarenessMilitaryOnlyEnabled(), true);
  militaryAwarenessLayer.setParams({ militaryOnly: false });
  assert.equal(militaryAwarenessLayer.getParams().militaryOnly, false);
  resetAwarenessMilitaryOnlyForTest();
});

test('Context panel chip is wired; in-flight layer files are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const awareness = data('militaryAwareness.js');
  const helper = data('awarenessMilitaryFilter.js');
  const engine = data('militaryAwarenessEngine.js');

  assert.match(awareness, /data-awareness-action="military-only"/);
  assert.match(awareness, /AWARENESS_MILITARY_CHIP_LABEL|Military only/);
  assert.match(awareness, /setAwarenessMilitaryOnlyEnabled|militaryOnly/);
  assert.doesNotMatch(ui, /awarenessMilitaryOnly|_initAwarenessMilitary/);
  assert.doesNotMatch(html, /awarenessMilitaryOnly|_initAwarenessMilitary/);

  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.match(helper, /meridian\.awarenessMilitaryOnly/);
  assert.match(engine, /export const AWARENESS_RADIUS_M = 250000/);

  for (const file of HARD_NO_LAYER_FILES) {
    const source = data(file);
    assert.doesNotMatch(source, /awarenessMilitaryOnly|meridian\.awarenessMilitaryOnly/);
    assert.doesNotMatch(source, /AWARENESS_MILITARY/);
  }

  const chip = awarenessMilitaryChipModel(false);
  assert.equal(chip.id, AWARENESS_MILITARY_CHIP_ID);
  assert.equal(chip.label, AWARENESS_MILITARY_CHIP_LABEL);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { militaryOnly: true });
  assert.deepEqual(awarenessMilitaryChipModel(true).params, { militaryOnly: false });
});

test('militaryAwarenessEngine.js is unchanged', () => {
  const engine = data('militaryAwarenessEngine.js');
  assert.doesNotMatch(engine, /awarenessMilitaryOnly|AWARENESS_MILITARY/);
  assert.doesNotMatch(engine, /Military only/);
  assert.match(engine, /export const AWARENESS_RADIUS_M = 250000/);
});

test('legal: already-fetched fields only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('awarenessMilitaryFilter.js');
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
