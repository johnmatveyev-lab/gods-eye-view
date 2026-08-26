import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  EARTHQUAKE_LIST_LIMIT,
  formatEarthquakeListRow,
  selectEarthquakeListRows,
} from './earthquakeList.js';
import {
  DEFAULT_EARTHQUAKE_LIST_DEPTH_FILTER as DEFAULT_DEPTH,
  EARTHQUAKE_LIST_DEPTH_CHIP_IDS,
  EARTHQUAKE_LIST_DEPTH_CHIP_LABELS,
  EARTHQUAKE_LIST_DEPTH_STORAGE_KEY,
  earthquakeListDepthCeilingKm,
  earthquakeListDepthChipModels,
  earthquakeListRowMatchesDepthCeiling,
  filterEarthquakeListRowsByDepth,
  getEarthquakeListDepthFilter,
  hydrateEarthquakeListDepthFilter,
  normalizeEarthquakeListDepthFilter,
  readEarthquakeListDepthFilter,
  resetEarthquakeListDepthFilterForTest,
  setEarthquakeListDepthFilter,
  writeEarthquakeListDepthFilter,
} from './earthquakeListDepthFilter.js';
import { resetEarthquakeListAgeFilterForTest } from './earthquakeListAgeFilter.js';
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

function quake(id, depthKm, overrides = {}) {
  return {
    id,
    magnitude: 5.2,
    place: id,
    timeMs: 1_753_600_000_000,
    lat: 35.0,
    lon: -117.0,
    depthKm,
    ...overrides,
  };
}

const D15 = quake('d15', 15, { timeMs: 1_753_600_400_000 });
const D70 = quake('d70', 70, { timeMs: 1_753_600_300_000 });
const D80 = quake('d80', 80, { timeMs: 1_753_600_200_000 });
const D400 = quake('d400', 400, { timeMs: 1_753_600_100_000 });
const MIXED = [D15, D70, D80, D400];

beforeEach(() => {
  resetEarthquakeListDepthFilterForTest();
  resetEarthquakeListAgeFilterForTest();
});

test('All keeps 15/80/400 km', () => {
  resetEarthquakeListDepthFilterForTest();
  assert.equal(DEFAULT_DEPTH, 'all');
  assert.equal(EARTHQUAKE_LIST_LIMIT, 50);
  const rows = selectEarthquakeListRows(MIXED, { depthCeiling: 'all' });
  assert.deepEqual(rows.map((row) => row.id), ['d15', 'd70', 'd80', 'd400']);
  assert.equal(rows.find((row) => row.id === 'd15').depthKm, 15);
  assert.equal(rows.find((row) => row.id === 'd80').depthKm, 80);
  assert.equal(rows.find((row) => row.id === 'd400').depthKm, 400);
  const implicit = selectEarthquakeListRows(MIXED);
  assert.deepEqual(implicit.map((row) => row.id), rows.map((row) => row.id));
});

test('<70 drops 80 and 400', () => {
  resetEarthquakeListDepthFilterForTest();
  const rows = selectEarthquakeListRows(MIXED, { depthCeiling: '70' });
  assert.deepEqual(rows.map((row) => row.id), ['d15']);
  assert.equal(rows.some((row) => row.id === 'd80' || row.id === 'd400'), false);
  assert.equal(earthquakeListRowMatchesDepthCeiling(D15, '70'), true);
  assert.equal(earthquakeListRowMatchesDepthCeiling(D80, '70'), false);
  assert.equal(earthquakeListRowMatchesDepthCeiling(D400, '70'), false);
});

test('<20 keeps 15 drops 70', () => {
  resetEarthquakeListDepthFilterForTest();
  const rows = selectEarthquakeListRows(MIXED, { depthCeiling: '20' });
  assert.deepEqual(rows.map((row) => row.id), ['d15']);
  assert.equal(rows.some((row) => row.id === 'd70'), false);
  assert.equal(earthquakeListRowMatchesDepthCeiling(D15, '20'), true);
  assert.equal(earthquakeListRowMatchesDepthCeiling(D70, '20'), false);
});

test('missing depth stays', () => {
  resetEarthquakeListDepthFilterForTest();
  const missing = quake('no-depth', undefined, { timeMs: 1_753_600_500_000 });
  delete missing.depthKm;
  const nanDepth = quake('nan-depth', Number.NaN, { timeMs: 1_753_600_450_000 });
  const rows = selectEarthquakeListRows([missing, nanDepth, D400], { depthCeiling: '20' });
  assert.deepEqual(rows.map((row) => row.id), ['no-depth', 'nan-depth']);
  assert.equal(formatEarthquakeListRow(missing).depthKm, null);
  assert.equal(earthquakeListRowMatchesDepthCeiling(missing, '20'), true);
  assert.equal(earthquakeListRowMatchesDepthCeiling({ depthKm: null }, '70'), true);
  assert.equal(earthquakeListRowMatchesDepthCeiling({ depth: 'nope' }, '20'), true);
});

test('selected id always kept', () => {
  resetEarthquakeListDepthFilterForTest();
  const rows = selectEarthquakeListRows(MIXED, {
    depthCeiling: '20',
    selectedId: 'd400',
  });
  assert.deepEqual(rows.map((row) => row.id), ['d15', 'd400']);
  assert.equal(
    earthquakeListRowMatchesDepthCeiling(D400, '20', { selectedId: 'd400' }),
    true,
  );
  assert.deepEqual(
    filterEarthquakeListRowsByDepth(MIXED, '70', { selectedId: 'd80' }).map((row) => row.id),
    ['d15', 'd80'],
  );
});

test('invalid storage reads as All', () => {
  assert.equal(normalizeEarthquakeListDepthFilter('nope'), 'all');
  assert.equal(normalizeEarthquakeListDepthFilter(undefined), 'all');
  assert.equal(normalizeEarthquakeListDepthFilter(null), 'all');
  assert.equal(readEarthquakeListDepthFilter(memoryStorage({
    [EARTHQUAKE_LIST_DEPTH_STORAGE_KEY]: 'bogus',
  })), DEFAULT_DEPTH);
  assert.equal(readEarthquakeListDepthFilter(memoryStorage({
    [EARTHQUAKE_LIST_DEPTH_STORAGE_KEY]: 'shallow',
  })), DEFAULT_DEPTH);
  assert.equal(readEarthquakeListDepthFilter(memoryStorage()), DEFAULT_DEPTH);
});

test('persist flip survives reload', () => {
  resetEarthquakeListDepthFilterForTest();
  const storage = memoryStorage();
  assert.equal(EARTHQUAKE_LIST_DEPTH_STORAGE_KEY, 'meridian.quakeListDepth');
  assert.equal(readEarthquakeListDepthFilter(storage), DEFAULT_DEPTH);
  assert.equal(setEarthquakeListDepthFilter('70', { storage }), '70');
  assert.equal(storage.getItem(EARTHQUAKE_LIST_DEPTH_STORAGE_KEY), '70');
  assert.equal(getEarthquakeListDepthFilter(), '70');

  resetEarthquakeListDepthFilterForTest();
  assert.equal(getEarthquakeListDepthFilter(), DEFAULT_DEPTH);
  assert.equal(hydrateEarthquakeListDepthFilter(storage), '70');
  assert.equal(getEarthquakeListDepthFilter(), '70');

  assert.equal(setEarthquakeListDepthFilter('20', { storage }), '20');
  resetEarthquakeListDepthFilterForTest();
  assert.equal(hydrateEarthquakeListDepthFilter(storage), '20');
  assert.equal(getEarthquakeListDepthFilter(), '20');
  writeEarthquakeListDepthFilter(DEFAULT_DEPTH, storage);
  assert.equal(storage.getItem(EARTHQUAKE_LIST_DEPTH_STORAGE_KEY), DEFAULT_DEPTH);
  resetEarthquakeListDepthFilterForTest();
});

test('earthquakes.js is unchanged', () => {
  const layer = SRC('data/earthquakes.js');
  assert.doesNotMatch(layer, /quakeListDepth|earthquakeListDepthFilter|earthquake-list-depth/);
  assert.match(layer, /depthKm: num\(raw\?\.depth\)/);
  assert.match(layer, /getListRecords\(\)/);
});

test('exclusive chips normalize to All | <70 km | <20 km and AND with the mag floor', () => {
  resetEarthquakeListDepthFilterForTest();
  assert.deepEqual(EARTHQUAKE_LIST_DEPTH_CHIP_IDS, ['all', '70', '20']);
  assert.deepEqual(
    EARTHQUAKE_LIST_DEPTH_CHIP_IDS.map((id) => EARTHQUAKE_LIST_DEPTH_CHIP_LABELS[id]),
    ['All', '<70 km', '<20 km'],
  );
  assert.equal(normalizeEarthquakeListDepthFilter('<70 km'), '70');
  assert.equal(normalizeEarthquakeListDepthFilter('<20km'), '20');
  assert.equal(earthquakeListDepthCeilingKm('all'), null);
  assert.equal(earthquakeListDepthCeilingKm('70'), 70);
  assert.equal(earthquakeListDepthCeilingKm('20'), 20);
  const models = earthquakeListDepthChipModels('70');
  assert.deepEqual(models.map((chip) => chip.active), [false, true, false]);
  const deepLarge = quake('deep-m6', 400, { magnitude: 6.1 });
  const shallowSmall = quake('shallow-m4', 15, { magnitude: 4.4 });
  const shallowLarge = quake('shallow-m6', 15, { magnitude: 6.2 });
  const anded = selectEarthquakeListRows(
    [deepLarge, shallowSmall, shallowLarge],
    { magFloor: '5', depthCeiling: '70' },
  );
  assert.deepEqual(anded.map((row) => row.id), ['shallow-m6']);
});

test('LayerStateCoordinator restore keeps the list ceiling and does not write a share URL', () => {
  resetEarthquakeListDepthFilterForTest();
  const storage = memoryStorage();
  setEarthquakeListDepthFilter('20', { storage });
  assert.equal(storage.getItem(EARTHQUAKE_LIST_DEPTH_STORAGE_KEY), '20');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['earthquakes'],
  }));
  assert.doesNotMatch(encoded.get('lo') || '', /quakeListDepth|listDepth|m\.qd/);
  assert.doesNotMatch(encoded.toString(), /quakeListDepth|meridian\.quakeListDepth/);
  assert.doesNotMatch(SRC('data/layerState.js'), /quakeListDepth|meridian\.quakeListDepth/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetEarthquakeListDepthFilterForTest();
  assert.equal(getEarthquakeListDepthFilter(), DEFAULT_DEPTH);
  assert.equal(hydrateEarthquakeListDepthFilter(storage), '20');
  assert.equal(getEarthquakeListDepthFilter(), '20');
  assert.equal(storage.getItem(EARTHQUAKE_LIST_DEPTH_STORAGE_KEY), '20');
  resetEarthquakeListDepthFilterForTest();
});

test('first-run missions do not write meridian.quakeListDepth', () => {
  const firstRunSource = SRC('firstRunExperience.js');
  const code = firstRunSource.slice(firstRunSource.indexOf('export function shouldShowFirstRun'));
  assert.match(firstRunSource, /meridian\.quakeListDepth/);
  for (const forbidden of [
    'setEarthquakeListDepthFilter',
    'writeEarthquakeListDepthFilter',
    'hydrateEarthquakeListDepthFilter',
  ]) {
    assert.doesNotMatch(code, new RegExp(forbidden), `a mission must never touch ${forbidden}`);
  }
});

test('list depth chips stay off the globe layer and share surface', () => {
  const helper = SRC('data/earthquakeListDepthFilter.js');
  const list = SRC('data/earthquakeList.js');
  const layer = SRC('data/earthquakes.js');
  const layerState = SRC('data/layerState.js');
  const sharelink = SRC('sharelink.js');
  const html = ROOT_FILE('index.html');
  const ui = SRC('ui.js');
  const license = ROOT_FILE('LICENSE');
  const readme = ROOT_FILE('README.md');

  assert.match(helper, /meridian\.quakeListDepth/);
  assert.match(list, /earthquakeListRowMatchesDepthCeiling|filterEarthquakeListRowsByDepth/);
  assert.match(list, /depthKm:/);
  assert.match(html, /id="earthquake-list-depth-chips"/);
  assert.match(html, /data-earthquake-list-depth="all"/);
  assert.match(html, /data-earthquake-list-depth="70"/);
  assert.match(html, /data-earthquake-list-depth="20"/);
  assert.match(html, /&lt;70 km|&lt;20 km|<70 km|<20 km/);
  assert.match(ui, /setEarthquakeListDepthFilter/);
  assert.doesNotMatch(layer, /quakeListDepth|earthquakeListDepthFilter/);
  assert.doesNotMatch(layerState, /quakeListDepth/);
  assert.doesNotMatch(sharelink, /quakeListDepth|meridian\.quakeListDepth/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(list, /\/api\/earthquakes/);
  assert.doesNotMatch(helper, /telegeography|quantum-earth/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
});
