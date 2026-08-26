import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  EARTHQUAKE_LIST_LIMIT,
  getRowControls,
  selectEarthquakeListRows,
} from './earthquakeList.js';
import {
  DEFAULT_EARTHQUAKE_LIST_RANGE_FILTER as DEFAULT_RANGE,
  EARTHQUAKE_LIST_RANGE_CHIP_IDS,
  EARTHQUAKE_LIST_RANGE_CHIP_LABELS,
  EARTHQUAKE_LIST_RANGE_STORAGE_KEY,
  earthquakeListRangeCeilingKm,
  earthquakeListRangeChipModels,
  earthquakeListRowMatchesRangeCeiling,
  filterEarthquakeListRowsByRange,
  getEarthquakeListRangeFilter,
  hydrateEarthquakeListRangeFilter,
  normalizeEarthquakeListRangeFilter,
  readEarthquakeListRangeFilter,
  resetEarthquakeListRangeFilterForTest,
  setEarthquakeListRangeFilter,
  writeEarthquakeListRangeFilter,
} from './earthquakeListRangeFilter.js';
import { resetEarthquakeListAgeFilterForTest } from './earthquakeListAgeFilter.js';
import { resetEarthquakeListDepthFilterForTest } from './earthquakeListDepthFilter.js';
import { resetEarthquakeListMagFilterForTest } from './earthquakeListMagFilter.js';
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

const ORIGIN = { lat: 0, lon: 0 };
const KM_PER_DEG = 6371 * Math.PI / 180;

function quake(id, distanceKm, overrides = {}) {
  return {
    id,
    magnitude: 5.2,
    place: id,
    timeMs: 1_753_700_000_000 + Math.round(distanceKm),
    lat: distanceKm / KM_PER_DEG,
    lon: 0,
    depthKm: 15,
    ...overrides,
  };
}

const KM80 = quake('km80', 80);
const KM400 = quake('km400', 400);
const KM800 = quake('km800', 800);
const MIXED = [KM80, KM400, KM800];

beforeEach(() => {
  resetEarthquakeListMagFilterForTest();
  resetEarthquakeListDepthFilterForTest();
  resetEarthquakeListAgeFilterForTest();
  resetEarthquakeListRangeFilterForTest();
});

test('All keeps 80 km and 800 km', () => {
  resetEarthquakeListRangeFilterForTest();
  assert.equal(DEFAULT_RANGE, 'all');
  assert.equal(EARTHQUAKE_LIST_LIMIT, 50);
  const rows = selectEarthquakeListRows([KM80, KM800], {
    origin: ORIGIN,
    rangeCeiling: 'all',
  });
  assert.deepEqual(rows.map((row) => row.id), ['km80', 'km800']);
  assert.ok(rows.find((row) => row.id === 'km80').distanceKm < 90);
  assert.ok(rows.find((row) => row.id === 'km800').distanceKm > 790);
  const implicit = selectEarthquakeListRows([KM80, KM800], { origin: ORIGIN });
  assert.deepEqual(implicit.map((row) => row.id), rows.map((row) => row.id));
});

test('<500 km keeps 80/400, drops 800', () => {
  resetEarthquakeListRangeFilterForTest();
  const rows = selectEarthquakeListRows(MIXED, { origin: ORIGIN, rangeCeiling: '500' });
  assert.deepEqual(rows.map((row) => row.id), ['km80', 'km400']);
  assert.equal(rows.some((row) => row.id === 'km800'), false);
  assert.equal(earthquakeListRowMatchesRangeCeiling({ distanceKm: 80 }, '500'), true);
  assert.equal(earthquakeListRowMatchesRangeCeiling({ distanceKm: 400 }, '500'), true);
  assert.equal(earthquakeListRowMatchesRangeCeiling({ distanceKm: 800 }, '500'), false);
});

test('<100 km keeps 80, drops 400', () => {
  resetEarthquakeListRangeFilterForTest();
  const rows = selectEarthquakeListRows(MIXED, { origin: ORIGIN, rangeCeiling: '100' });
  assert.deepEqual(rows.map((row) => row.id), ['km80']);
  assert.equal(rows.some((row) => row.id === 'km400'), false);
  assert.equal(earthquakeListRowMatchesRangeCeiling({ distanceKm: 80 }, '100'), true);
  assert.equal(earthquakeListRowMatchesRangeCeiling({ distanceKm: 400 }, '100'), false);
});

test('no origin stays', () => {
  resetEarthquakeListRangeFilterForTest();
  const rows = selectEarthquakeListRows(MIXED, { rangeCeiling: '100' });
  assert.deepEqual(rows.map((row) => row.id), ['km800', 'km400', 'km80']);
  assert.equal(earthquakeListRowMatchesRangeCeiling(KM800, '100', { hasOrigin: false }), true);
});

test('non-finite distance stays', () => {
  resetEarthquakeListRangeFilterForTest();
  const missing = quake('no-dist', 800);
  const nanDist = { ...KM800, id: 'nan-dist', distanceKm: Number.NaN };
  assert.equal(earthquakeListRowMatchesRangeCeiling({ id: 'no-dist' }, '100'), true);
  assert.equal(earthquakeListRowMatchesRangeCeiling(nanDist, '100'), true);
  assert.equal(earthquakeListRowMatchesRangeCeiling({ distanceKm: null }, '500'), true);
  assert.equal(earthquakeListRowMatchesRangeCeiling({ distance: 'nope' }, '100'), true);
  assert.equal(earthquakeListRowMatchesRangeCeiling({ distanceKm: Number.POSITIVE_INFINITY }, '100'), true);
  const rows = selectEarthquakeListRows([missing, KM80], {
    origin: { lat: Number.NaN, lon: Number.NaN },
    rangeCeiling: '100',
  });
  assert.deepEqual(rows.map((row) => row.id), ['no-dist', 'km80']);
});

test('selected id always kept', () => {
  resetEarthquakeListRangeFilterForTest();
  const rows = selectEarthquakeListRows(MIXED, {
    origin: ORIGIN,
    rangeCeiling: '100',
    selectedId: 'km800',
  });
  assert.deepEqual(rows.map((row) => row.id), ['km80', 'km800']);
  assert.equal(
    earthquakeListRowMatchesRangeCeiling({ id: 'km800', distanceKm: 800 }, '100', {
      selectedId: 'km800',
    }),
    true,
  );
  assert.deepEqual(
    filterEarthquakeListRowsByRange(
      [{ id: 'km80', distanceKm: 80 }, { id: 'km800', distanceKm: 800 }],
      '500',
      { selectedId: 'km800' },
    ).map((row) => row.id),
    ['km80', 'km800'],
  );
});

test('invalid storage reads as All', () => {
  assert.equal(normalizeEarthquakeListRangeFilter('nope'), 'all');
  assert.equal(normalizeEarthquakeListRangeFilter(undefined), 'all');
  assert.equal(normalizeEarthquakeListRangeFilter(null), 'all');
  assert.equal(readEarthquakeListRangeFilter(memoryStorage({
    [EARTHQUAKE_LIST_RANGE_STORAGE_KEY]: 'bogus',
  })), DEFAULT_RANGE);
  assert.equal(readEarthquakeListRangeFilter(memoryStorage({
    [EARTHQUAKE_LIST_RANGE_STORAGE_KEY]: '250',
  })), DEFAULT_RANGE);
  assert.equal(readEarthquakeListRangeFilter(memoryStorage()), DEFAULT_RANGE);
});

test('persist flip survives reload', () => {
  resetEarthquakeListRangeFilterForTest();
  const storage = memoryStorage();
  assert.equal(EARTHQUAKE_LIST_RANGE_STORAGE_KEY, 'meridian.quakeListRange');
  assert.equal(readEarthquakeListRangeFilter(storage), DEFAULT_RANGE);
  assert.equal(setEarthquakeListRangeFilter('500', { storage }), '500');
  assert.equal(storage.getItem(EARTHQUAKE_LIST_RANGE_STORAGE_KEY), '500');
  assert.equal(getEarthquakeListRangeFilter(), '500');

  resetEarthquakeListRangeFilterForTest();
  assert.equal(getEarthquakeListRangeFilter(), DEFAULT_RANGE);
  assert.equal(hydrateEarthquakeListRangeFilter(storage), '500');
  assert.equal(getEarthquakeListRangeFilter(), '500');

  assert.equal(setEarthquakeListRangeFilter('100', { storage }), '100');
  resetEarthquakeListRangeFilterForTest();
  assert.equal(hydrateEarthquakeListRangeFilter(storage), '100');
  assert.equal(getEarthquakeListRangeFilter(), '100');
  writeEarthquakeListRangeFilter(DEFAULT_RANGE, storage);
  assert.equal(storage.getItem(EARTHQUAKE_LIST_RANGE_STORAGE_KEY), DEFAULT_RANGE);
  resetEarthquakeListRangeFilterForTest();
});

test('earthquakes.js is unchanged', () => {
  const layer = SRC('data/earthquakes.js');
  assert.doesNotMatch(layer, /quakeListRange|earthquakeListRangeFilter|earthquake-list-range/);
  assert.match(layer, /getListRecords\(\)/);
});

test('exclusive chips normalize to All | <500 km | <100 km and AND with mag, depth, and age', () => {
  resetEarthquakeListRangeFilterForTest();
  assert.deepEqual(EARTHQUAKE_LIST_RANGE_CHIP_IDS, ['all', '500', '100']);
  assert.deepEqual(
    EARTHQUAKE_LIST_RANGE_CHIP_IDS.map((id) => EARTHQUAKE_LIST_RANGE_CHIP_LABELS[id]),
    ['All', '<500 km', '<100 km'],
  );
  assert.equal(normalizeEarthquakeListRangeFilter('<500 km'), '500');
  assert.equal(normalizeEarthquakeListRangeFilter('<100km'), '100');
  assert.equal(earthquakeListRangeCeilingKm('all'), null);
  assert.equal(earthquakeListRangeCeilingKm('500'), 500);
  assert.equal(earthquakeListRangeCeilingKm('100'), 100);
  const models = earthquakeListRangeChipModels('500');
  assert.deepEqual(models.map((chip) => chip.active), [false, true, false]);
  const rangeChips = getRowControls().chips;
  assert.deepEqual(rangeChips.map((chip) => chip.label), ['All', '<500 km', '<100 km']);
  const farLargeShallowRecent = quake('far-m6', 800, {
    magnitude: 6.1,
    depthKm: 15,
    timeMs: 1_753_700_000_000,
  });
  const nearSmallDeepOld = quake('near-m4', 80, {
    magnitude: 4.4,
    depthKm: 400,
    timeMs: 1_753_600_000_000,
  });
  const nearLargeShallowRecent = quake('near-m6', 80, {
    magnitude: 6.2,
    depthKm: 15,
    timeMs: 1_753_700_000_000,
  });
  const anded = selectEarthquakeListRows(
    [farLargeShallowRecent, nearSmallDeepOld, nearLargeShallowRecent],
    {
      origin: ORIGIN,
      magFloor: '5',
      depthCeiling: '70',
      ageCeiling: 'all',
      rangeCeiling: '500',
    },
  );
  assert.deepEqual(anded.map((row) => row.id), ['near-m6']);
});

test('LayerStateCoordinator restore keeps the list ceiling and does not write a share URL', () => {
  resetEarthquakeListRangeFilterForTest();
  const storage = memoryStorage();
  setEarthquakeListRangeFilter('100', { storage });
  assert.equal(storage.getItem(EARTHQUAKE_LIST_RANGE_STORAGE_KEY), '100');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['earthquakes'],
  }));
  assert.doesNotMatch(encoded.get('lo') || '', /quakeListRange|listRange|m\.qr/);
  assert.doesNotMatch(encoded.toString(), /quakeListRange|meridian\.quakeListRange/);
  assert.doesNotMatch(SRC('data/layerState.js'), /quakeListRange|meridian\.quakeListRange/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetEarthquakeListRangeFilterForTest();
  assert.equal(getEarthquakeListRangeFilter(), DEFAULT_RANGE);
  assert.equal(hydrateEarthquakeListRangeFilter(storage), '100');
  assert.equal(getEarthquakeListRangeFilter(), '100');
  assert.equal(storage.getItem(EARTHQUAKE_LIST_RANGE_STORAGE_KEY), '100');
  resetEarthquakeListRangeFilterForTest();
});

test('first-run missions do not write meridian.quakeListRange', () => {
  const firstRunSource = SRC('firstRunExperience.js');
  const code = firstRunSource.slice(firstRunSource.indexOf('export function shouldShowFirstRun'));
  for (const forbidden of [
    'setEarthquakeListRangeFilter',
    'writeEarthquakeListRangeFilter',
    'hydrateEarthquakeListRangeFilter',
  ]) {
    assert.doesNotMatch(code, new RegExp(forbidden), `a mission must never touch ${forbidden}`);
  }
});

test('list range chips stay off the globe layer and share surface', () => {
  const helper = SRC('data/earthquakeListRangeFilter.js');
  const list = SRC('data/earthquakeList.js');
  const layer = SRC('data/earthquakes.js');
  const layerState = SRC('data/layerState.js');
  const sharelink = SRC('sharelink.js');
  const ui = SRC('ui.js');
  const license = ROOT_FILE('LICENSE');
  const readme = ROOT_FILE('README.md');

  assert.match(helper, /meridian\.quakeListRange/);
  assert.match(list, /earthquakeListRowMatchesRangeCeiling|filterEarthquakeListRowsByRange/);
  assert.match(list, /getRowControls/);
  assert.match(list, /distanceKm/);
  assert.doesNotMatch(ui, /quakeListRange|setEarthquakeListRangeFilter|_initEarthquakeListRange/);
  assert.doesNotMatch(layer, /quakeListRange|earthquakeListRangeFilter/);
  assert.doesNotMatch(layerState, /quakeListRange/);
  assert.doesNotMatch(sharelink, /quakeListRange|meridian\.quakeListRange/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(list, /\/api\/earthquakes/);
  assert.doesNotMatch(helper, /telegeography|quantum-earth/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
});
