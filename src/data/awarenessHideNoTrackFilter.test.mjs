// PLAN 273 — Context Hide no track. Client-only filter of already-fetched
// getNearby records on the Global Context roster / NEXT walk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

import {
  AWARENESS_HIDE_NO_TRACK_CHIP_ID,
  AWARENESS_HIDE_NO_TRACK_CHIP_LABEL,
  AWARENESS_HIDE_NO_TRACK_DEFAULT,
  AWARENESS_HIDE_NO_TRACK_FAIL_OPEN_LAYER_IDS,
  AWARENESS_HIDE_NO_TRACK_LAYER_IDS,
  AWARENESS_HIDE_NO_TRACK_STORAGE_KEY,
  awarenessContactTrack,
  awarenessHideNoTrackChipModel,
  filterAwarenessHideNoTrackContacts,
  getAwarenessHideNoTrackEnabled,
  hydrateAwarenessHideNoTrackEnabled,
  normalizeAwarenessHideNoTrack,
  passesAwarenessHideNoTrackFilter,
  readAwarenessHideNoTrackEnabled,
  resetAwarenessHideNoTrackForTest,
  setAwarenessHideNoTrackEnabled,
  writeAwarenessHideNoTrackEnabled,
} from './awarenessHideNoTrackFilter.js';
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
  resetAwarenessFlightsOnlyForTest,
  setAwarenessFlightsOnlyEnabled,
} from './awarenessFlightsFilter.js';
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
  'launchesPanel.js',
  'rocketLaunches.js',
  'firmsHeatmap.js',
  'firmsList.js',
  'damsList.js',
  'datacenterList.js',
  'localGeojson.js',
  'adsbLolFallback.js',
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

const FLIGHT_NO_TRACK = Object.freeze({
  layerId: 'flights', icao24: 'dal001', callsign: 'DAL123', id: 'DAL123',
  distanceM: 8_000, track: null,
});
const FLIGHT_TRACKED = Object.freeze({
  layerId: 'flights', icao24: 'ual270', callsign: 'UAL270', id: 'UAL270',
  distanceM: 8_000, track: 270,
});
const FLIGHT_NORTH = Object.freeze({
  layerId: 'flights', icao24: 'n0rth', callsign: 'N0RTH', id: 'N0RTH',
  distanceM: 8_000, track: 0,
});
const MILITARY_NO_TRACK = Object.freeze({
  layerId: 'military', icao24: 'ae01ce', callsign: 'RCH001', id: 'RCH001',
  distanceM: 12_000, track: null,
});
const MILITARY_TRACKED = Object.freeze({
  layerId: 'military', icao24: 'ae02ff', callsign: 'RCH270', id: 'RCH270',
  distanceM: 12_000, track: 90,
});
const VESSEL = Object.freeze({
  layerId: 'ais-live-vessels', mmsi: '366999000', name: 'EVER GIVEN', id: '366999000',
  distanceM: 8_000,
});
const SITE = Object.freeze({
  layerId: 'military-installations', id: 'osm:way:2', name: 'Fort Hood', hasName: true,
  distanceM: 40_000,
});
const MISSING_LAYER = Object.freeze({
  icao24: 'nodist', callsign: 'NODIST', id: 'nodist', distanceM: 8_000,
});

test('Off keeps a civil flight with track null', () => {
  assert.equal(AWARENESS_HIDE_NO_TRACK_DEFAULT, false);
  assert.equal(AWARENESS_HIDE_NO_TRACK_STORAGE_KEY, 'meridian.awarenessHideNoTrack');
  assert.deepEqual([...AWARENESS_HIDE_NO_TRACK_LAYER_IDS], ['flights', 'military']);
  assert.deepEqual([...AWARENESS_HIDE_NO_TRACK_FAIL_OPEN_LAYER_IDS], [
    'ais-live-vessels',
    'military-installations',
  ]);
  assert.equal(AWARENESS_RADIUS_M, 250_000, 'do not shrink AWARENESS_RADIUS_M');

  for (const contact of [
    FLIGHT_NO_TRACK, FLIGHT_TRACKED, MILITARY_NO_TRACK, MILITARY_TRACKED, VESSEL, SITE,
  ]) {
    assert.equal(passesAwarenessHideNoTrackFilter(contact, { hideNoTrack: false }), true);
  }
  const kept = filterAwarenessHideNoTrackContacts(
    [FLIGHT_NO_TRACK, FLIGHT_TRACKED, MILITARY_NO_TRACK, VESSEL, SITE],
    { hideNoTrack: false },
  );
  assert.deepEqual(kept.map((row) => row.id), [
    'DAL123',
    'UAL270',
    'RCH001',
    '366999000',
    'osm:way:2',
  ]);
});

test('On hides track-less flights and military; keeps finite track including 0', () => {
  assert.equal(passesAwarenessHideNoTrackFilter(FLIGHT_NO_TRACK, { hideNoTrack: true }), false);
  assert.equal(passesAwarenessHideNoTrackFilter(FLIGHT_TRACKED, { hideNoTrack: true }), true);
  assert.equal(passesAwarenessHideNoTrackFilter(FLIGHT_NORTH, { hideNoTrack: true }), true);
  assert.equal(passesAwarenessHideNoTrackFilter(MILITARY_NO_TRACK, { hideNoTrack: true }), false);
  assert.equal(passesAwarenessHideNoTrackFilter(MILITARY_TRACKED, { hideNoTrack: true }), true);
  assert.equal(passesAwarenessHideNoTrackFilter({
    ...FLIGHT_TRACKED, track: Number.NaN,
  }, { hideNoTrack: true }), false);
  assert.equal(passesAwarenessHideNoTrackFilter({
    ...FLIGHT_TRACKED, track: Number.POSITIVE_INFINITY,
  }, { hideNoTrack: true }), false);
  assert.equal(Number.isFinite(awarenessContactTrack(FLIGHT_NO_TRACK)), false);
  assert.equal(awarenessContactTrack(FLIGHT_TRACKED), 270);
  assert.equal(awarenessContactTrack(FLIGHT_NORTH), 0);

  const kept = filterAwarenessHideNoTrackContacts(
    [FLIGHT_NO_TRACK, FLIGHT_TRACKED, FLIGHT_NORTH, MILITARY_NO_TRACK, MILITARY_TRACKED],
    { hideNoTrack: true },
  );
  assert.deepEqual(kept.map((row) => row.id), ['UAL270', 'N0RTH', 'RCH270']);
});

test('AIS and site rows stay when On', () => {
  assert.equal(passesAwarenessHideNoTrackFilter(VESSEL, { hideNoTrack: true }), true);
  assert.equal(passesAwarenessHideNoTrackFilter(SITE, { hideNoTrack: true }), true);
  const kept = filterAwarenessHideNoTrackContacts(
    [FLIGHT_NO_TRACK, VESSEL, SITE, MILITARY_NO_TRACK],
    { hideNoTrack: true },
  );
  assert.deepEqual(kept.map((row) => row.layerId), [
    'ais-live-vessels',
    'military-installations',
  ]);
});

test('Subject stays when it has no track', () => {
  assert.equal(passesAwarenessHideNoTrackFilter(FLIGHT_NO_TRACK, {
    hideNoTrack: true,
    subjectId: 'DAL123',
  }), true);
  assert.equal(passesAwarenessHideNoTrackFilter(MILITARY_NO_TRACK, {
    hideNoTrack: true,
    subjectId: 'RCH001',
  }), true);
  assert.equal(passesAwarenessHideNoTrackFilter(MILITARY_NO_TRACK, {
    hideNoTrack: true,
    subjectId: 'military:RCH001',
  }), true);
  assert.equal(passesAwarenessHideNoTrackFilter(FLIGHT_NO_TRACK, {
    hideNoTrack: true,
    subjectId: 'other',
  }), false);
});

test('Missing layerId stays', () => {
  assert.equal(passesAwarenessHideNoTrackFilter(MISSING_LAYER, { hideNoTrack: true }), true);
  assert.equal(passesAwarenessHideNoTrackFilter({ icao24: 'abc123', callsign: 'NODIST' }, {
    hideNoTrack: true,
  }), true);
  assert.equal(passesAwarenessHideNoTrackFilter({ layerId: '', icao24: 'x', track: null }, {
    hideNoTrack: true,
  }), true);
  const kept = filterAwarenessHideNoTrackContacts(
    [MISSING_LAYER, FLIGHT_NO_TRACK, FLIGHT_TRACKED],
    { hideNoTrack: true },
  );
  assert.deepEqual(kept.map((row) => row.icao24 || row.id), ['nodist', 'ual270']);
});

test('Invalid storage reads as off', () => {
  assert.equal(normalizeAwarenessHideNoTrack(undefined), false);
  assert.equal(normalizeAwarenessHideNoTrack(null), false);
  assert.equal(normalizeAwarenessHideNoTrack('nope'), false);
  assert.equal(normalizeAwarenessHideNoTrack('{oops'), false);
  assert.equal(normalizeAwarenessHideNoTrack(false), false);
  assert.equal(normalizeAwarenessHideNoTrack(true), true);
  assert.equal(normalizeAwarenessHideNoTrack('1'), true);
  assert.equal(readAwarenessHideNoTrackEnabled(memoryStorage()), false);
  assert.equal(readAwarenessHideNoTrackEnabled(memoryStorage({
    [AWARENESS_HIDE_NO_TRACK_STORAGE_KEY]: 'maybe',
  })), false);
  assert.equal(readAwarenessHideNoTrackEnabled(memoryStorage({
    [AWARENESS_HIDE_NO_TRACK_STORAGE_KEY]: '{oops',
  })), false);
  assert.equal(readAwarenessHideNoTrackEnabled({
    getItem() { throw new Error('blocked'); },
  }), false);
});

test('Persist flip survives reload', () => {
  resetAwarenessHideNoTrackForTest();
  const storage = memoryStorage();
  assert.equal(readAwarenessHideNoTrackEnabled(storage), false);
  assert.equal(setAwarenessHideNoTrackEnabled(true, { storage }), true);
  assert.deepEqual(storage.snapshot(), { [AWARENESS_HIDE_NO_TRACK_STORAGE_KEY]: '1' });
  assert.equal(readAwarenessHideNoTrackEnabled(storage), true);

  resetAwarenessHideNoTrackForTest();
  assert.equal(getAwarenessHideNoTrackEnabled(), false, 'in-memory reset is off');
  assert.equal(hydrateAwarenessHideNoTrackEnabled(storage), true);
  assert.equal(getAwarenessHideNoTrackEnabled(), true);
  assert.deepEqual(storage.snapshot(), { [AWARENESS_HIDE_NO_TRACK_STORAGE_KEY]: '1' },
    'hydrate must not rewrite storage');

  assert.equal(writeAwarenessHideNoTrackEnabled(false, storage), true);
  assert.equal(storage.snapshot()[AWARENESS_HIDE_NO_TRACK_STORAGE_KEY], '0');
  resetAwarenessHideNoTrackForTest();
});

test('LayerStateCoordinator restore stays local — no share-URL write', () => {
  const defaults = createDefaultLayerState();
  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), defaults).toString();
  assert.doesNotMatch(encoded, /awarenessHideNoTrack/);
  assert.doesNotMatch(encoded, /meridian\.awarenessHideNoTrack/);
  assert.equal(Object.hasOwn(defaults.options, 'military-awareness'), false);

  const layerState = data('layerState.js');
  assert.match(layerState, /id: 'military-awareness', token: 'g', disposition: 'enabled-only'/);
  assert.doesNotMatch(layerState, /awarenessHideNoTrack|AWARENESS_HIDE_NO_TRACK/);

  const sharelink = src('sharelink.js');
  assert.doesNotMatch(sharelink, /awarenessHideNoTrack|meridian\.awarenessHideNoTrack/);
});

test('AND with 213/221/231/251/259/263/269', () => {
  resetAwarenessIdentifiedForTest();
  resetAwarenessRangeForTest();
  resetAwarenessAircraftOnlyForTest();
  resetAwarenessVesselsOnlyForTest();
  resetAwarenessSitesOnlyForTest();
  resetAwarenessMilitaryOnlyForTest();
  resetAwarenessFlightsOnlyForTest();
  resetAwarenessHideNoTrackForTest();
  const awareness = data('militaryAwareness.js');
  assert.match(awareness, /filterAwarenessHideNoTrackContacts|passesAwarenessHideNoTrackFilter/);
  assert.match(awareness, /filterAwarenessFlightsContacts|passesAwarenessFlightsFilter/);
  assert.match(awareness, /filterAwarenessMilitaryContacts|passesAwarenessMilitaryFilter/);
  assert.match(awareness, /filterAwarenessSitesContacts|passesAwarenessSitesFilter/);
  assert.match(awareness, /filterAwarenessVesselsContacts|passesAwarenessVesselsFilter/);
  assert.match(awareness, /filterAwarenessAircraftContacts|passesAwarenessAircraftFilter/);
  assert.match(awareness, /filterAwarenessIdentifiedContacts|passesAwarenessIdentifiedFilter/);
  assert.match(awareness, /filterAwarenessRangeContacts|passesAwarenessRangeFilter/);
  assert.match(
    awareness,
    /if \(aircraftClass\) \{[\s\S]*passesAwarenessIdentifiedFilter[\s\S]*passesAwarenessRangeFilter[\s\S]*passesAwarenessAircraftFilter[\s\S]*passesAwarenessVesselsFilter[\s\S]*passesAwarenessSitesFilter[\s\S]*passesAwarenessMilitaryFilter[\s\S]*passesAwarenessFlightsFilter[\s\S]*passesAwarenessHideNoTrackFilter/,
  );

  const history = [
    { layerId: 'flights', id: 'hex001', callsign: '', distanceM: 8_000, track: null },
    { layerId: 'flights', id: 'dal001', callsign: 'DAL123', aircraftClass: 'airliner', distanceM: 8_000, track: 270 },
    { layerId: 'flights', id: 'far200', callsign: 'FAR200', aircraftClass: 'airliner', distanceM: 200_000, track: 180 },
    { layerId: 'military', id: 'RCH001', callsign: 'RCH001', aircraftClass: 'military', distanceM: 8_000, track: 90 },
    { layerId: 'military', id: 'RCH000', callsign: 'RCH000', aircraftClass: 'military', distanceM: 8_000, track: null },
    { layerId: 'ais-live-vessels', id: '366999000', mmsi: '366999000', name: 'EVER GIVEN', distanceM: 8_000 },
    { layerId: 'military-installations', id: 'osm:way:2', name: 'Fort Hood', hasName: true, distanceM: 8_000 },
  ];
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 0, 'defaults keep a hex-only nearby aircraft with no track');
  assert.equal(findCompatibleHistoryIndex(history, 3, 1, {
    resolveItem: (subject) => subject,
  }), 4, 'defaults still walk onto a military flight with no track');

  setAwarenessHideNoTrackEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 1, 'hide-no-track skips the track-less civil flight');
  assert.equal(findCompatibleHistoryIndex(history, 3, 1, {
    resolveItem: (subject) => subject,
  }), 5, 'hide-no-track skips track-less military and keeps AIS');

  setAwarenessFlightsOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 1, 'AND: flights-only + hide-no-track keeps the headed civil flight');
  assert.equal(findCompatibleHistoryIndex(history, 2, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'AND: flights-only + hide-no-track drops military / AIS / sites');

  setAwarenessFlightsOnlyEnabled(false, { persist: false });
  setAwarenessAircraftOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 1, 'AND: aircraft-only + hide-no-track keeps headed flights');
  assert.equal(findCompatibleHistoryIndex(history, 3, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'AND: aircraft-only + hide-no-track drops AIS and the track-less military');

  setAwarenessAircraftOnlyEnabled(false, { persist: false });
  setAwarenessVesselsOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 5, 'AND: vessels-only + hide-no-track keeps AIS (fail open)');

  setAwarenessVesselsOnlyEnabled(false, { persist: false });
  setAwarenessSitesOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 6, 'AND: sites-only + hide-no-track keeps the site (fail open)');

  setAwarenessSitesOnlyEnabled(false, { persist: false });
  setAwarenessMilitaryOnlyEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 3, 'AND: military-only + hide-no-track keeps the headed military flight');
  assert.equal(findCompatibleHistoryIndex(history, 3, 1, {
    resolveItem: (subject) => subject,
  }), -1, 'AND: military-only + hide-no-track drops the track-less military');

  setAwarenessMilitaryOnlyEnabled(false, { persist: false });
  setAwarenessIdentifiedEnabled(true, { persist: false });
  setAwarenessRangeFilter('10', { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    resolveItem: (subject) => subject,
  }), 1, 'AND: identified + <10 km + hide-no-track keeps the named nearby headed civil flight');
  resetAwarenessIdentifiedForTest();
  resetAwarenessRangeForTest();
  resetAwarenessAircraftOnlyForTest();
  resetAwarenessVesselsOnlyForTest();
  resetAwarenessSitesOnlyForTest();
  resetAwarenessMilitaryOnlyForTest();
  resetAwarenessFlightsOnlyForTest();
  resetAwarenessHideNoTrackForTest();
});

test('militaryAwareness setParams flips Hide no track without a share token', () => {
  resetAwarenessHideNoTrackForTest();
  assert.equal(militaryAwarenessLayer.getParams().hideNoTrack, false);
  assert.equal(militaryAwarenessLayer.setParams({ hideNoTrack: true }), undefined);
  assert.equal(militaryAwarenessLayer.getParams().hideNoTrack, true);
  assert.equal(getAwarenessHideNoTrackEnabled(), true);
  militaryAwarenessLayer.setParams({ hideNoTrack: false });
  assert.equal(militaryAwarenessLayer.getParams().hideNoTrack, false);
  resetAwarenessHideNoTrackForTest();
});

test('Context panel chip is wired; in-flight layer files are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const awareness = data('militaryAwareness.js');
  const helper = data('awarenessHideNoTrackFilter.js');
  const engine = data('militaryAwarenessEngine.js');

  assert.match(awareness, /data-awareness-action="hide-no-track"/);
  assert.match(awareness, /AWARENESS_HIDE_NO_TRACK_CHIP_LABEL|Hide no track/);
  assert.match(awareness, /setAwarenessHideNoTrackEnabled|hideNoTrack/);
  assert.match(awareness, /hydrateAwarenessHideNoTrackEnabled/);
  assert.doesNotMatch(ui, /awarenessHideNoTrack|_initAwarenessHideNoTrack/);
  assert.doesNotMatch(html, /awarenessHideNoTrack|_initAwarenessHideNoTrack/);

  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.match(helper, /meridian\.awarenessHideNoTrack/);
  assert.match(engine, /export const AWARENESS_RADIUS_M = 250000/);

  for (const file of HARD_NO_LAYER_FILES) {
    const source = data(file);
    assert.doesNotMatch(source, /awarenessHideNoTrack|meridian\.awarenessHideNoTrack/);
    assert.doesNotMatch(source, /AWARENESS_HIDE_NO_TRACK/);
  }

  const chip = awarenessHideNoTrackChipModel(false);
  assert.equal(chip.id, AWARENESS_HIDE_NO_TRACK_CHIP_ID);
  assert.equal(chip.label, AWARENESS_HIDE_NO_TRACK_CHIP_LABEL);
  assert.equal(chip.active, false);
  assert.deepEqual(chip.params, { hideNoTrack: true });
  assert.deepEqual(awarenessHideNoTrackChipModel(true).params, { hideNoTrack: false });
});

test('militaryAwarenessEngine.js is unchanged', () => {
  const engine = data('militaryAwarenessEngine.js');
  assert.doesNotMatch(engine, /awarenessHideNoTrack|AWARENESS_HIDE_NO_TRACK/);
  assert.doesNotMatch(engine, /Hide no track/);
  assert.match(engine, /export const AWARENESS_RADIUS_M = 250000/);
});

test('legal: already-fetched fields only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('awarenessHideNoTrackFilter.js');
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
