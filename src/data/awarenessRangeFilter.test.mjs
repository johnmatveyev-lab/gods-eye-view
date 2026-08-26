// PLAN 221 — Context range-floor chips. Client-only exclusive All | <50 km |
// <10 km filter of already-fetched getNearby records on the Global Context
// roster / NEXT walk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

import {
  AWARENESS_RANGE_10_M,
  AWARENESS_RANGE_50_M,
  AWARENESS_RANGE_CHIP_IDS,
  AWARENESS_RANGE_CHIP_LABELS,
  AWARENESS_RANGE_DEFAULT,
  AWARENESS_RANGE_STORAGE_KEY,
  awarenessContactDistanceM,
  awarenessRangeCeilingM,
  awarenessRangeChipModels,
  filterAwarenessRangeContacts,
  getAwarenessRangeFilter,
  hydrateAwarenessRangeFilter,
  normalizeAwarenessRange,
  passesAwarenessRangeFilter,
  readAwarenessRangeFilter,
  resetAwarenessRangeForTest,
  setAwarenessRangeFilter,
  writeAwarenessRangeFilter,
} from './awarenessRangeFilter.js';
import {
  resetAwarenessIdentifiedForTest,
  setAwarenessIdentifiedEnabled,
} from './awarenessIdentifiedFilter.js';
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

const KM_8 = Object.freeze({ icao24: 'near8', callsign: 'NEAR8', distanceM: 8_000 });
const KM_40 = Object.freeze({ icao24: 'mid40', callsign: 'MID40', distanceM: 40_000 });
const KM_200 = Object.freeze({ icao24: 'far200', callsign: 'FAR200', distanceM: 200_000 });
const FLIGHT_DISTANCE = Object.freeze({ icao24: 'adsb8', callsign: 'ADSB8', distance: 8_000 });
const MISSING = Object.freeze({ icao24: 'nodist', callsign: 'NODIST' });
const NON_FINITE = Object.freeze({ icao24: 'nan', callsign: 'NAN', distanceM: Number.NaN });
const HEX_FAR = Object.freeze({ icao24: 'abc123', callsign: '', id: 'abc123', distanceM: 8_000 });

test('All keeps 8/40/200 km', () => {
  assert.equal(AWARENESS_RANGE_DEFAULT, 'all');
  assert.equal(AWARENESS_RANGE_STORAGE_KEY, 'meridian.awarenessRange');
  assert.deepEqual(AWARENESS_RANGE_CHIP_IDS, ['all', '50', '10']);
  assert.deepEqual(
    AWARENESS_RANGE_CHIP_IDS.map((id) => AWARENESS_RANGE_CHIP_LABELS[id]),
    ['All', '<50 km', '<10 km'],
  );
  assert.equal(awarenessRangeCeilingM('all'), null);
  assert.equal(awarenessRangeCeilingM('50'), AWARENESS_RANGE_50_M);
  assert.equal(awarenessRangeCeilingM('10'), AWARENESS_RANGE_10_M);
  assert.equal(AWARENESS_RADIUS_M, 250_000, 'do not shrink AWARENESS_RADIUS_M');

  for (const contact of [KM_8, KM_40, KM_200, FLIGHT_DISTANCE]) {
    assert.equal(passesAwarenessRangeFilter(contact, { range: 'all' }), true);
  }
  const kept = filterAwarenessRangeContacts([KM_8, KM_40, KM_200], { range: 'all' });
  assert.deepEqual(kept.map((row) => row.icao24), ['near8', 'mid40', 'far200']);
});

test('50 drops 200 keeps 40', () => {
  assert.equal(passesAwarenessRangeFilter(KM_8, { range: '50' }), true);
  assert.equal(passesAwarenessRangeFilter(KM_40, { range: '50' }), true);
  assert.equal(passesAwarenessRangeFilter(KM_200, { range: '50' }), false);
  assert.equal(passesAwarenessRangeFilter({ distanceM: 50_000 }, { range: '50' }), false);
  const kept = filterAwarenessRangeContacts([KM_8, KM_40, KM_200], { range: '50' });
  assert.deepEqual(kept.map((row) => row.icao24), ['near8', 'mid40']);
});

test('10 keeps 8 drops 40', () => {
  assert.equal(passesAwarenessRangeFilter(KM_8, { range: '10' }), true);
  assert.equal(passesAwarenessRangeFilter(FLIGHT_DISTANCE, { range: '10' }), true);
  assert.equal(passesAwarenessRangeFilter(KM_40, { range: '10' }), false);
  assert.equal(passesAwarenessRangeFilter(KM_200, { range: '10' }), false);
  const kept = filterAwarenessRangeContacts([KM_8, KM_40, KM_200, FLIGHT_DISTANCE], { range: '10' });
  assert.deepEqual(kept.map((row) => row.icao24), ['near8', 'adsb8']);
});

test('Missing distance stays', () => {
  assert.equal(Number.isFinite(awarenessContactDistanceM(MISSING)), false);
  assert.equal(Number.isFinite(awarenessContactDistanceM(NON_FINITE)), false);
  assert.equal(passesAwarenessRangeFilter(MISSING, { range: '10' }), true);
  assert.equal(passesAwarenessRangeFilter(NON_FINITE, { range: '50' }), true);
  assert.equal(passesAwarenessRangeFilter({ distance: '' }, { range: '10' }), true);
  const kept = filterAwarenessRangeContacts([MISSING, NON_FINITE, KM_200], { range: '10' });
  assert.deepEqual(kept.map((row) => row.icao24), ['nodist', 'nan']);
});

test('Subject always kept', () => {
  assert.equal(passesAwarenessRangeFilter(KM_200, {
    range: '10',
    subjectId: 'far200',
  }), true);
  assert.equal(passesAwarenessRangeFilter(KM_200, {
    range: '10',
    subjectId: 'flights:far200',
  }), true);
  assert.equal(passesAwarenessRangeFilter(KM_200, {
    range: '10',
    subjectId: 'other',
  }), false);
});

test('Invalid storage reads as All', () => {
  assert.equal(normalizeAwarenessRange(undefined), 'all');
  assert.equal(normalizeAwarenessRange(null), 'all');
  assert.equal(normalizeAwarenessRange('nope'), 'all');
  assert.equal(normalizeAwarenessRange('{oops'), 'all');
  assert.equal(readAwarenessRangeFilter(memoryStorage()), 'all');
  assert.equal(readAwarenessRangeFilter(memoryStorage({
    [AWARENESS_RANGE_STORAGE_KEY]: 'maybe',
  })), 'all');
  assert.equal(readAwarenessRangeFilter(memoryStorage({
    [AWARENESS_RANGE_STORAGE_KEY]: '{oops',
  })), 'all');
  assert.equal(readAwarenessRangeFilter({
    getItem() { throw new Error('blocked'); },
  }), 'all');
});

test('Persist flip survives reload', () => {
  resetAwarenessRangeForTest();
  const storage = memoryStorage();
  assert.equal(readAwarenessRangeFilter(storage), 'all');
  assert.equal(setAwarenessRangeFilter('50', { storage }), '50');
  assert.deepEqual(storage.snapshot(), { [AWARENESS_RANGE_STORAGE_KEY]: '50' });
  assert.equal(readAwarenessRangeFilter(storage), '50');

  resetAwarenessRangeForTest();
  assert.equal(getAwarenessRangeFilter(), 'all', 'in-memory reset is All');
  assert.equal(hydrateAwarenessRangeFilter(storage), '50');
  assert.equal(getAwarenessRangeFilter(), '50');
  assert.deepEqual(storage.snapshot(), { [AWARENESS_RANGE_STORAGE_KEY]: '50' },
    'hydrate must not rewrite storage');

  assert.equal(writeAwarenessRangeFilter('10', storage), true);
  assert.equal(storage.snapshot()[AWARENESS_RANGE_STORAGE_KEY], '10');
  resetAwarenessRangeForTest();
});

test('LayerStateCoordinator restore stays local — no share-URL write', () => {
  const defaults = createDefaultLayerState();
  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), defaults).toString();
  assert.doesNotMatch(encoded, /awarenessRange/);
  assert.doesNotMatch(encoded, /meridian\.awarenessRange/);
  assert.equal(Object.hasOwn(defaults.options, 'military-awareness'), false);

  const layerState = data('layerState.js');
  assert.match(layerState, /id: 'military-awareness', token: 'g', disposition: 'enabled-only'/);
  assert.doesNotMatch(layerState, /awarenessRange|AWARENESS_RANGE/);

  const sharelink = src('sharelink.js');
  assert.doesNotMatch(sharelink, /awarenessRange|meridian\.awarenessRange/);
});

test('AND with 213 identified-only still consults the range chip', () => {
  resetAwarenessIdentifiedForTest();
  resetAwarenessRangeForTest();
  const awareness = data('militaryAwareness.js');
  assert.match(awareness, /filterAwarenessRangeContacts|passesAwarenessRangeFilter/);
  assert.match(awareness, /filterAwarenessIdentifiedContacts|passesAwarenessIdentifiedFilter/);
  assert.match(
    awareness,
    /if \(aircraftClass\) \{[\s\S]*passesAwarenessIdentifiedFilter[\s\S]*passesAwarenessRangeFilter/,
  );

  const history = [
    { layerId: 'flights', id: 'hex001', callsign: '', distanceM: 8_000 },
    { layerId: 'flights', id: 'dal001', callsign: 'DAL123', aircraftClass: 'airliner', distanceM: 8_000 },
    { layerId: 'flights', id: 'far200', callsign: 'FAR200', aircraftClass: 'airliner', distanceM: 200_000 },
    { layerId: 'ais-live-vessels', id: '366999000', name: 'EVER GIVEN', distanceM: 8_000 },
  ];
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    aircraftOnly: true,
    resolveItem: (subject) => subject,
  }), 0, 'defaults keep a hex-only nearby aircraft');

  setAwarenessIdentifiedEnabled(true, { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    aircraftOnly: true,
    resolveItem: (subject) => subject,
  }), 1, 'identified-only skips hex-only and keeps a callsign aircraft');

  setAwarenessRangeFilter('10', { persist: false });
  assert.equal(findCompatibleHistoryIndex(history, -1, 1, {
    aircraftOnly: true,
    aircraftClass: 'airliner',
    resolveItem: (subject) => subject,
  }), 1, 'AND: class + identified + <10 km keeps the nearby callsign');
  assert.equal(findCompatibleHistoryIndex(history, 1, 1, {
    aircraftOnly: true,
    aircraftClass: 'airliner',
    resolveItem: (subject) => subject,
  }), -1, 'AND: <10 km drops the 200 km callsign');
  resetAwarenessIdentifiedForTest();
  resetAwarenessRangeForTest();
});

test('militaryAwareness setParams flips range without a share token', () => {
  resetAwarenessRangeForTest();
  assert.equal(militaryAwarenessLayer.getParams().range, 'all');
  assert.equal(militaryAwarenessLayer.setParams({ range: '50' }), undefined);
  assert.equal(militaryAwarenessLayer.getParams().range, '50');
  assert.equal(getAwarenessRangeFilter(), '50');
  militaryAwarenessLayer.setParams({ range: 'all' });
  assert.equal(militaryAwarenessLayer.getParams().range, 'all');
  resetAwarenessRangeForTest();
});

test('Context panel chips are wired; globe layer files are unchanged', () => {
  const html = root('index.html');
  const ui = src('ui.js');
  const awareness = data('militaryAwareness.js');
  const helper = data('awarenessRangeFilter.js');
  const engine = data('militaryAwarenessEngine.js');

  assert.match(awareness, /data-awareness-action="range"/);
  assert.match(awareness, /data-awareness-range/);
  assert.match(awareness, /awarenessRangeChipModels|rangeChipsHtml/);
  assert.match(awareness, /setAwarenessRangeFilter|range:/);
  assert.doesNotMatch(ui, /awarenessRange|_initAwarenessRange/);

  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(|XMLHttpRequest|EventSource/);
  assert.match(helper, /meridian\.awarenessRange/);
  assert.match(engine, /export const AWARENESS_RADIUS_M = 250000/);

  for (const file of HARD_NO_LAYER_FILES) {
    const source = data(file);
    assert.doesNotMatch(source, /awarenessRange|meridian\.awarenessRange/);
    assert.doesNotMatch(source, /AWARENESS_RANGE/);
  }

  const panelStart = html.indexOf('id="military-awareness-panel"');
  assert.ok(panelStart >= 0);
  const panelHtml = html.slice(panelStart);
  assert.match(panelHtml, /data-awareness-action="range"/);
  assert.match(panelHtml, /(?:<|&lt;)50 km/);
  assert.match(panelHtml, /(?:<|&lt;)10 km/);
  assert.match(panelHtml, /data-awareness-action="identified-only"/);
  const models = awarenessRangeChipModels('all');
  assert.deepEqual(models.map((chip) => chip.label), ['All', '<50 km', '<10 km']);
  assert.deepEqual(models.map((chip) => chip.active), [true, false, false]);
  assert.deepEqual(models[1].params, { range: '50' });
  assert.deepEqual(awarenessRangeChipModels('10').map((chip) => chip.active), [false, false, true]);
});

test('legal: already-fetched fields only, Meridian title, MIT credit unchanged', () => {
  const moduleSource = data('awarenessRangeFilter.js');
  const html = root('index.html');
  const license = root('LICENSE');
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.doesNotMatch(moduleSource, /\/api\//);
  assert.doesNotMatch(moduleSource, /google\.com\/news|telegeography|quantum-earth/i);
  assert.doesNotMatch(moduleSource, /AWARENESS_RADIUS_M\s*=/);
});
