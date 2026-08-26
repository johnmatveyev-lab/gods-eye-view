import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { resetEarthquakeListAgeFilterForTest } from './earthquakeListAgeFilter.js';
import { resetEarthquakeListDepthFilterForTest } from './earthquakeListDepthFilter.js';
import {
  EARTHQUAKE_LIST_LIMIT,
  selectEarthquakeListRows,
} from './earthquakeList.js';
import {
  DEFAULT_EARTHQUAKE_LIST_MAG_FILTER as DEFAULT_MAG,
  EARTHQUAKE_LIST_MAG_CHIP_IDS,
  EARTHQUAKE_LIST_MAG_CHIP_LABELS,
  EARTHQUAKE_LIST_MAG_STORAGE_KEY,
  earthquakeListMagChipModels,
  earthquakeListMagFloor,
  earthquakeListRowMatchesMagFloor,
  filterEarthquakeListRowsByMag,
  getEarthquakeListMagFilter,
  hydrateEarthquakeListMagFilter,
  normalizeEarthquakeListMagFilter,
  readEarthquakeListMagFilter,
  resetEarthquakeListMagFilterForTest,
  setEarthquakeListMagFilter,
  writeEarthquakeListMagFilter,
} from './earthquakeListMagFilter.js';
import {
  LayerStateCoordinator,
  encodeLayerStateParams,
  normalizeLayerState,
} from './layerState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = (name) => readFileSync(path.join(ROOT, 'src', name), 'utf8');
const ROOT_FILE = (name) => readFileSync(path.join(ROOT, name), 'utf8');

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    snapshot: () => ({ ...data }),
  };
}

const M4 = {
  id: 'm4',
  magnitude: 4.4,
  place: 'Ridgecrest',
  timeMs: 1_753_600_400_000,
  lat: 35.62,
  lon: -117.67,
};
const M5 = {
  id: 'm5',
  magnitude: 5.2,
  place: 'Anchorage',
  timeMs: 1_753_600_300_000,
  lat: 61.02,
  lon: -150.41,
};
const M6 = {
  id: 'm6',
  magnitude: 6.1,
  place: 'Noto',
  timeMs: 1_753_600_200_000,
  lat: 37.5,
  lon: 137.3,
};
const M7 = {
  id: 'm7',
  magnitude: 7.0,
  place: 'Kamchatka',
  timeMs: 1_753_600_100_000,
  lat: 52.0,
  lon: 159.0,
};

function crowdOutRecords() {
  const small = Array.from({ length: 60 }, (_, index) => ({
    id: `small-${String(index).padStart(2, '0')}`,
    magnitude: 2.6,
    place: `Small ${index}`,
    timeMs: 1_753_700_000_000 + index,
    lat: 10 + (index * 0.1),
    lon: -120,
  }));
  return [...small, M4, M5, M6, M7];
}

beforeEach(() => {
  resetEarthquakeListMagFilterForTest();
  resetEarthquakeListDepthFilterForTest();
  resetEarthquakeListAgeFilterForTest();
});

test('All keeps the current 50-row list', () => {
  resetEarthquakeListMagFilterForTest();
  assert.equal(DEFAULT_MAG, 'all');
  assert.equal(EARTHQUAKE_LIST_LIMIT, 50);
  const records = crowdOutRecords();
  const all = selectEarthquakeListRows(records, { magFloor: 'all' });
  const implicit = selectEarthquakeListRows(records);
  assert.equal(all.length, EARTHQUAKE_LIST_LIMIT);
  assert.deepEqual(all.map((row) => row.id), implicit.map((row) => row.id));
  assert.equal(all.some((row) => row.magnitude >= 5), false, 'recent M2s crowd out large events on All');
  assert.ok(all.every((row) => row.id.startsWith('small-')));
});

test('5+ hides below M5 then applies the 50-row cap', () => {
  resetEarthquakeListMagFilterForTest();
  const rows = selectEarthquakeListRows(crowdOutRecords(), { magFloor: '5' });
  assert.deepEqual(rows.map((row) => row.id), ['m5', 'm6', 'm7']);
  assert.ok(rows.every((row) => row.magnitude >= 5));
  assert.equal(rows.some((row) => row.id === 'm4' || row.id.startsWith('small-')), false);
});

test('6+ keeps large events only', () => {
  resetEarthquakeListMagFilterForTest();
  const rows = selectEarthquakeListRows(crowdOutRecords(), { magFloor: '6' });
  assert.deepEqual(rows.map((row) => row.id), ['m6', 'm7']);
  assert.ok(rows.every((row) => row.magnitude >= 6));
});

test('missing magnitude still drops before the floor is applied', () => {
  resetEarthquakeListMagFilterForTest();
  const missing = { id: 'no-mag', place: 'Nowhere', timeMs: 9e15, lat: 1, lon: 2 };
  const rows = selectEarthquakeListRows([missing, M6], { magFloor: 'all' });
  assert.deepEqual(rows.map((row) => row.id), ['m6']);
  assert.equal(earthquakeListRowMatchesMagFloor(missing, '5'), false);
  assert.equal(earthquakeListRowMatchesMagFloor({ magnitude: 5 }, '5'), true);
  assert.equal(earthquakeListRowMatchesMagFloor({ mag: 4.9 }, '5'), false);
});

test('exclusive chips normalize to All | 5+ | 6+', () => {
  assert.deepEqual(EARTHQUAKE_LIST_MAG_CHIP_IDS, ['all', '5', '6']);
  assert.deepEqual(
    EARTHQUAKE_LIST_MAG_CHIP_IDS.map((id) => EARTHQUAKE_LIST_MAG_CHIP_LABELS[id]),
    ['All', '5+', '6+'],
  );
  assert.equal(normalizeEarthquakeListMagFilter('5+'), '5');
  assert.equal(normalizeEarthquakeListMagFilter('6+'), '6');
  assert.equal(normalizeEarthquakeListMagFilter('nope'), 'all');
  assert.equal(earthquakeListMagFloor('all'), null);
  assert.equal(earthquakeListMagFloor('5'), 5);
  assert.equal(earthquakeListMagFloor('6'), 6);
  const models = earthquakeListMagChipModels('5');
  assert.deepEqual(models.map((chip) => chip.active), [false, true, false]);
  assert.deepEqual(
    filterEarthquakeListRowsByMag([M4, M5, M6], 'all').map((row) => row.id),
    ['m4', 'm5', 'm6'],
  );
});

test('meridian.quakeListMag persists and reload keeps the floor', () => {
  resetEarthquakeListMagFilterForTest();
  const storage = memoryStorage();
  assert.equal(EARTHQUAKE_LIST_MAG_STORAGE_KEY, 'meridian.quakeListMag');
  assert.equal(readEarthquakeListMagFilter(storage), DEFAULT_MAG);
  assert.equal(setEarthquakeListMagFilter('5', { storage }), '5');
  assert.equal(storage.getItem(EARTHQUAKE_LIST_MAG_STORAGE_KEY), '5');
  assert.equal(getEarthquakeListMagFilter(), '5');

  resetEarthquakeListMagFilterForTest();
  assert.equal(getEarthquakeListMagFilter(), DEFAULT_MAG);
  assert.equal(hydrateEarthquakeListMagFilter(storage), '5');
  assert.equal(getEarthquakeListMagFilter(), '5');
  writeEarthquakeListMagFilter(DEFAULT_MAG, storage);
  assert.equal(storage.getItem(EARTHQUAKE_LIST_MAG_STORAGE_KEY), DEFAULT_MAG);
  resetEarthquakeListMagFilterForTest();
});

test('LayerStateCoordinator restore keeps the list floor and does not write a share URL', () => {
  resetEarthquakeListMagFilterForTest();
  const storage = memoryStorage();
  setEarthquakeListMagFilter('6', { storage });
  assert.equal(storage.getItem(EARTHQUAKE_LIST_MAG_STORAGE_KEY), '6');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['earthquakes'],
  }));
  assert.doesNotMatch(encoded.get('lo') || '', /quakeListMag|listMag|m\.q/);
  assert.doesNotMatch(encoded.toString(), /quakeListMag|meridian\.quakeListMag/);
  assert.doesNotMatch(SRC('data/layerState.js'), /quakeListMag|meridian\.quakeListMag/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetEarthquakeListMagFilterForTest();
  assert.equal(getEarthquakeListMagFilter(), DEFAULT_MAG);
  assert.equal(hydrateEarthquakeListMagFilter(storage), '6');
  assert.equal(getEarthquakeListMagFilter(), '6');
  assert.equal(storage.getItem(EARTHQUAKE_LIST_MAG_STORAGE_KEY), '6');
  resetEarthquakeListMagFilterForTest();
});

test('first-run missions do not write meridian.quakeListMag', () => {
  const firstRunSource = SRC('firstRunExperience.js');
  const code = firstRunSource.slice(firstRunSource.indexOf('export function shouldShowFirstRun'));
  assert.match(firstRunSource, /meridian\.quakeListMag/);
  for (const forbidden of [
    'setEarthquakeListMagFilter',
    'writeEarthquakeListMagFilter',
    'hydrateEarthquakeListMagFilter',
  ]) {
    assert.doesNotMatch(code, new RegExp(forbidden), `a mission must never touch ${forbidden}`);
  }
});

test('list mag chips stay off the globe layer and share surface', () => {
  const helper = SRC('data/earthquakeListMagFilter.js');
  const list = SRC('data/earthquakeList.js');
  const layer = SRC('data/earthquakes.js');
  const layerState = SRC('data/layerState.js');
  const sharelink = SRC('sharelink.js');
  const html = ROOT_FILE('index.html');
  const ui = SRC('ui.js');
  const license = ROOT_FILE('LICENSE');
  const readme = ROOT_FILE('README.md');

  assert.match(helper, /meridian\.quakeListMag/);
  assert.match(list, /earthquakeListRowMatchesMagFloor|filterEarthquakeListRowsByMag/);
  assert.match(html, /id="earthquake-list-mag-chips"/);
  assert.match(html, /data-earthquake-list-mag="all"/);
  assert.match(html, /data-earthquake-list-mag="5"/);
  assert.match(html, /data-earthquake-list-mag="6"/);
  assert.match(ui, /setEarthquakeListMagFilter/);
  assert.doesNotMatch(layer, /quakeListMag|earthquakeListMagFilter/);
  assert.doesNotMatch(layerState, /quakeListMag/);
  assert.doesNotMatch(sharelink, /quakeListMag|meridian\.quakeListMag/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(list, /\/api\/earthquakes/);
  assert.doesNotMatch(helper, /telegeography|quantum-earth/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
});
