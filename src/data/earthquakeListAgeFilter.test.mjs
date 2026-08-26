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
  DEFAULT_EARTHQUAKE_LIST_AGE_FILTER as DEFAULT_AGE,
  EARTHQUAKE_LIST_AGE_CHIP_IDS,
  EARTHQUAKE_LIST_AGE_CHIP_LABELS,
  EARTHQUAKE_LIST_AGE_HOUR_MS,
  EARTHQUAKE_LIST_AGE_STORAGE_KEY,
  earthquakeListAgeCeilingMs,
  earthquakeListAgeChipModels,
  earthquakeListRowMatchesAgeCeiling,
  filterEarthquakeListRowsByAge,
  getEarthquakeListAgeFilter,
  hydrateEarthquakeListAgeFilter,
  normalizeEarthquakeListAgeFilter,
  readEarthquakeListAgeFilter,
  resetEarthquakeListAgeFilterForTest,
  setEarthquakeListAgeFilter,
  writeEarthquakeListAgeFilter,
} from './earthquakeListAgeFilter.js';
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

const NOW = 1_753_700_000_000;
const MINUTE_MS = 60 * 1000;

function quake(id, ageMs, overrides = {}) {
  return {
    id,
    magnitude: 5.2,
    place: id,
    timeMs: NOW - ageMs,
    lat: 35.0,
    lon: -117.0,
    depthKm: 15,
    ...overrides,
  };
}

const MIN20 = quake('min20', 20 * MINUTE_MS);
const H3 = quake('h3', 3 * EARTHQUAKE_LIST_AGE_HOUR_MS);
const H12 = quake('h12', 12 * EARTHQUAKE_LIST_AGE_HOUR_MS);
const MIXED = [MIN20, H3, H12];

beforeEach(() => {
  resetEarthquakeListAgeFilterForTest();
});

test('All keeps 20 min / 3 h / 12 h', () => {
  resetEarthquakeListAgeFilterForTest();
  assert.equal(DEFAULT_AGE, 'all');
  assert.equal(EARTHQUAKE_LIST_LIMIT, 50);
  const rows = selectEarthquakeListRows(MIXED, { ageCeiling: 'all', now: NOW });
  assert.deepEqual(rows.map((row) => row.id), ['min20', 'h3', 'h12']);
  assert.equal(rows.find((row) => row.id === 'min20').timeMs, NOW - 20 * MINUTE_MS);
  assert.equal(rows.find((row) => row.id === 'h3').timeMs, NOW - 3 * EARTHQUAKE_LIST_AGE_HOUR_MS);
  assert.equal(rows.find((row) => row.id === 'h12').timeMs, NOW - 12 * EARTHQUAKE_LIST_AGE_HOUR_MS);
  const implicit = selectEarthquakeListRows(MIXED, { now: NOW });
  assert.deepEqual(implicit.map((row) => row.id), rows.map((row) => row.id));
});

test('6 h drops 12 h keeps 3 h', () => {
  resetEarthquakeListAgeFilterForTest();
  const rows = selectEarthquakeListRows(MIXED, { ageCeiling: '6', now: NOW });
  assert.deepEqual(rows.map((row) => row.id), ['min20', 'h3']);
  assert.equal(rows.some((row) => row.id === 'h12'), false);
  assert.equal(earthquakeListRowMatchesAgeCeiling(H3, '6', { now: NOW }), true);
  assert.equal(earthquakeListRowMatchesAgeCeiling(H12, '6', { now: NOW }), false);
});

test('1 h keeps 20 min drops 3 h', () => {
  resetEarthquakeListAgeFilterForTest();
  const rows = selectEarthquakeListRows(MIXED, { ageCeiling: '1', now: NOW });
  assert.deepEqual(rows.map((row) => row.id), ['min20']);
  assert.equal(rows.some((row) => row.id === 'h3'), false);
  assert.equal(earthquakeListRowMatchesAgeCeiling(MIN20, '1', { now: NOW }), true);
  assert.equal(earthquakeListRowMatchesAgeCeiling(H3, '1', { now: NOW }), false);
});

test('missing timeMs stays', () => {
  resetEarthquakeListAgeFilterForTest();
  const missing = quake('no-time', 0);
  delete missing.timeMs;
  const nanTime = quake('nan-time', 0, { timeMs: Number.NaN });
  const rows = selectEarthquakeListRows([missing, nanTime, H12], { ageCeiling: '1', now: NOW });
  assert.deepEqual(rows.map((row) => row.id), ['nan-time', 'no-time']);
  assert.equal(formatEarthquakeListRow(missing).timeMs, null);
  assert.equal(earthquakeListRowMatchesAgeCeiling(missing, '1', { now: NOW }), true);
  assert.equal(earthquakeListRowMatchesAgeCeiling({ timeMs: null }, '6', { now: NOW }), true);
  assert.equal(earthquakeListRowMatchesAgeCeiling({ time: 'nope' }, '1', { now: NOW }), true);
});

test('selected id always kept', () => {
  resetEarthquakeListAgeFilterForTest();
  const rows = selectEarthquakeListRows(MIXED, {
    ageCeiling: '1',
    selectedId: 'h12',
    now: NOW,
  });
  assert.deepEqual(rows.map((row) => row.id), ['min20', 'h12']);
  assert.equal(
    earthquakeListRowMatchesAgeCeiling(H12, '1', { selectedId: 'h12', now: NOW }),
    true,
  );
  assert.deepEqual(
    filterEarthquakeListRowsByAge(MIXED, '6', { selectedId: 'h12', now: NOW }).map((row) => row.id),
    ['min20', 'h3', 'h12'],
  );
});

test('invalid storage reads as All', () => {
  assert.equal(normalizeEarthquakeListAgeFilter('nope'), 'all');
  assert.equal(normalizeEarthquakeListAgeFilter(undefined), 'all');
  assert.equal(normalizeEarthquakeListAgeFilter(null), 'all');
  assert.equal(readEarthquakeListAgeFilter(memoryStorage({
    [EARTHQUAKE_LIST_AGE_STORAGE_KEY]: 'bogus',
  })), DEFAULT_AGE);
  assert.equal(readEarthquakeListAgeFilter(memoryStorage({
    [EARTHQUAKE_LIST_AGE_STORAGE_KEY]: '24',
  })), DEFAULT_AGE);
  assert.equal(readEarthquakeListAgeFilter(memoryStorage()), DEFAULT_AGE);
});

test('persist flip survives reload', () => {
  resetEarthquakeListAgeFilterForTest();
  const storage = memoryStorage();
  assert.equal(EARTHQUAKE_LIST_AGE_STORAGE_KEY, 'meridian.quakeListAge');
  assert.equal(readEarthquakeListAgeFilter(storage), DEFAULT_AGE);
  assert.equal(setEarthquakeListAgeFilter('6', { storage }), '6');
  assert.equal(storage.getItem(EARTHQUAKE_LIST_AGE_STORAGE_KEY), '6');
  assert.equal(getEarthquakeListAgeFilter(), '6');

  resetEarthquakeListAgeFilterForTest();
  assert.equal(getEarthquakeListAgeFilter(), DEFAULT_AGE);
  assert.equal(hydrateEarthquakeListAgeFilter(storage), '6');
  assert.equal(getEarthquakeListAgeFilter(), '6');

  assert.equal(setEarthquakeListAgeFilter('1', { storage }), '1');
  resetEarthquakeListAgeFilterForTest();
  assert.equal(hydrateEarthquakeListAgeFilter(storage), '1');
  assert.equal(getEarthquakeListAgeFilter(), '1');
  writeEarthquakeListAgeFilter(DEFAULT_AGE, storage);
  assert.equal(storage.getItem(EARTHQUAKE_LIST_AGE_STORAGE_KEY), DEFAULT_AGE);
  resetEarthquakeListAgeFilterForTest();
});

test('earthquakes.js is unchanged', () => {
  const layer = SRC('data/earthquakes.js');
  assert.doesNotMatch(layer, /quakeListAge|earthquakeListAgeFilter|earthquake-list-age/);
  assert.match(layer, /timeMs: num\(raw\?\.time\)/);
  assert.match(layer, /getListRecords\(\)/);
});

test('exclusive chips normalize to All | <6 h | <1 h and AND with mag and depth', () => {
  resetEarthquakeListAgeFilterForTest();
  assert.deepEqual(EARTHQUAKE_LIST_AGE_CHIP_IDS, ['all', '6', '1']);
  assert.deepEqual(
    EARTHQUAKE_LIST_AGE_CHIP_IDS.map((id) => EARTHQUAKE_LIST_AGE_CHIP_LABELS[id]),
    ['All', '<6 h', '<1 h'],
  );
  assert.equal(normalizeEarthquakeListAgeFilter('<6 h'), '6');
  assert.equal(normalizeEarthquakeListAgeFilter('<1h'), '1');
  assert.equal(earthquakeListAgeCeilingMs('all'), null);
  assert.equal(earthquakeListAgeCeilingMs('6'), 6 * EARTHQUAKE_LIST_AGE_HOUR_MS);
  assert.equal(earthquakeListAgeCeilingMs('1'), 1 * EARTHQUAKE_LIST_AGE_HOUR_MS);
  const models = earthquakeListAgeChipModels('6');
  assert.deepEqual(models.map((chip) => chip.active), [false, true, false]);
  const oldLargeShallow = quake('old-m6', 12 * EARTHQUAKE_LIST_AGE_HOUR_MS, {
    magnitude: 6.1,
    depthKm: 15,
  });
  const recentSmallDeep = quake('recent-m4', 20 * MINUTE_MS, {
    magnitude: 4.4,
    depthKm: 400,
  });
  const recentLargeShallow = quake('recent-m6', 20 * MINUTE_MS, {
    magnitude: 6.2,
    depthKm: 15,
  });
  const anded = selectEarthquakeListRows(
    [oldLargeShallow, recentSmallDeep, recentLargeShallow],
    { magFloor: '5', depthCeiling: '70', ageCeiling: '6', now: NOW },
  );
  assert.deepEqual(anded.map((row) => row.id), ['recent-m6']);
});

test('LayerStateCoordinator restore keeps the list ceiling and does not write a share URL', () => {
  resetEarthquakeListAgeFilterForTest();
  const storage = memoryStorage();
  setEarthquakeListAgeFilter('1', { storage });
  assert.equal(storage.getItem(EARTHQUAKE_LIST_AGE_STORAGE_KEY), '1');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['earthquakes'],
  }));
  assert.doesNotMatch(encoded.get('lo') || '', /quakeListAge|listAge|m\.qa/);
  assert.doesNotMatch(encoded.toString(), /quakeListAge|meridian\.quakeListAge/);
  assert.doesNotMatch(SRC('data/layerState.js'), /quakeListAge|meridian\.quakeListAge/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetEarthquakeListAgeFilterForTest();
  assert.equal(getEarthquakeListAgeFilter(), DEFAULT_AGE);
  assert.equal(hydrateEarthquakeListAgeFilter(storage), '1');
  assert.equal(getEarthquakeListAgeFilter(), '1');
  assert.equal(storage.getItem(EARTHQUAKE_LIST_AGE_STORAGE_KEY), '1');
  resetEarthquakeListAgeFilterForTest();
});

test('first-run missions do not write meridian.quakeListAge', () => {
  const firstRunSource = SRC('firstRunExperience.js');
  const code = firstRunSource.slice(firstRunSource.indexOf('export function shouldShowFirstRun'));
  assert.match(firstRunSource, /meridian\.quakeListAge/);
  for (const forbidden of [
    'setEarthquakeListAgeFilter',
    'writeEarthquakeListAgeFilter',
    'hydrateEarthquakeListAgeFilter',
  ]) {
    assert.doesNotMatch(code, new RegExp(forbidden), `a mission must never touch ${forbidden}`);
  }
});

test('list age chips stay off the globe layer and share surface', () => {
  const helper = SRC('data/earthquakeListAgeFilter.js');
  const list = SRC('data/earthquakeList.js');
  const layer = SRC('data/earthquakes.js');
  const layerState = SRC('data/layerState.js');
  const sharelink = SRC('sharelink.js');
  const html = ROOT_FILE('index.html');
  const ui = SRC('ui.js');
  const license = ROOT_FILE('LICENSE');
  const readme = ROOT_FILE('README.md');

  assert.match(helper, /meridian\.quakeListAge/);
  assert.match(list, /earthquakeListRowMatchesAgeCeiling|filterEarthquakeListRowsByAge/);
  assert.match(list, /timeMs:/);
  assert.match(html, /id="earthquake-list-age-chips"/);
  assert.match(html, /data-earthquake-list-age="all"/);
  assert.match(html, /data-earthquake-list-age="6"/);
  assert.match(html, /data-earthquake-list-age="1"/);
  assert.match(html, /&lt;6 h|&lt;1 h|<6 h|<1 h/);
  assert.match(ui, /setEarthquakeListAgeFilter/);
  assert.doesNotMatch(layer, /quakeListAge|earthquakeListAgeFilter/);
  assert.doesNotMatch(layerState, /quakeListAge/);
  assert.doesNotMatch(sharelink, /quakeListAge|meridian\.quakeListAge/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(list, /\/api\/earthquakes/);
  assert.doesNotMatch(helper, /telegeography|quantum-earth/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
});
