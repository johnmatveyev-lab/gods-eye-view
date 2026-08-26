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
import { resetEarthquakeListAgeFilterForTest } from './earthquakeListAgeFilter.js';
import { resetEarthquakeListDepthFilterForTest } from './earthquakeListDepthFilter.js';
import {
  DEFAULT_EARTHQUAKE_LIST_HIDE_NO_DEPTH as DEFAULT_HIDE,
  EARTHQUAKE_LIST_HIDE_NO_DEPTH_CHIP_ID,
  EARTHQUAKE_LIST_HIDE_NO_DEPTH_CHIP_LABEL,
  EARTHQUAKE_LIST_HIDE_NO_DEPTH_STORAGE_KEY,
  earthquakeListHideNoDepthChipModel,
  earthquakeListRowHasFiniteDepth,
  earthquakeListRowMatchesHideNoDepthFilter,
  filterEarthquakeListRowsByHideNoDepth,
  getEarthquakeListHideNoDepth,
  hydrateEarthquakeListHideNoDepth,
  normalizeEarthquakeListHideNoDepth,
  readEarthquakeListHideNoDepth,
  resetEarthquakeListHideNoDepthForTest,
  setEarthquakeListHideNoDepth,
  writeEarthquakeListHideNoDepth,
} from './earthquakeListHideNoDepthFilter.js';
import { resetEarthquakeListMagFilterForTest } from './earthquakeListMagFilter.js';
import { resetEarthquakeListHideNoPlaceForTest } from './earthquakeListPlaceFilter.js';
import { resetEarthquakeListRangeFilterForTest } from './earthquakeListRangeFilter.js';
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
    place: '42 km SW of Anchorage, Alaska',
    timeMs: 1_753_700_000_000,
    lat: 35.0,
    lon: -117.0,
    depthKm,
    ...overrides,
  };
}

const KM12 = quake('km12', 12, { timeMs: 1_753_700_000_400 });
const NULL_DEPTH = quake('null-depth', null, { timeMs: 1_753_700_000_300 });
const MISSING = quake('missing', undefined, { timeMs: 1_753_700_000_200 });
delete MISSING.depthKm;
const NAN_DEPTH = quake('nan-depth', Number.NaN, { timeMs: 1_753_700_000_100 });

beforeEach(() => {
  resetEarthquakeListMagFilterForTest();
  resetEarthquakeListDepthFilterForTest();
  resetEarthquakeListAgeFilterForTest();
  resetEarthquakeListRangeFilterForTest();
  resetEarthquakeListHideNoPlaceForTest();
  resetEarthquakeListHideNoDepthForTest();
});

test('off keeps null depth', () => {
  resetEarthquakeListHideNoDepthForTest();
  assert.equal(DEFAULT_HIDE, false);
  assert.equal(EARTHQUAKE_LIST_LIMIT, 50);
  assert.equal(normalizeEarthquakeListHideNoDepth(false), false);
  assert.equal(earthquakeListRowMatchesHideNoDepthFilter(NULL_DEPTH, false), true);
  assert.equal(earthquakeListRowMatchesHideNoDepthFilter(MISSING, false), true);
  assert.equal(earthquakeListRowMatchesHideNoDepthFilter(NAN_DEPTH, false), true);
  const rows = selectEarthquakeListRows([KM12, NULL_DEPTH, MISSING], {
    hideNoDepth: false,
  });
  assert.deepEqual(rows.map((row) => row.id), ['km12', 'null-depth', 'missing']);
  assert.equal(rows.find((row) => row.id === 'null-depth').depthKm, null);
  assert.equal(rows.find((row) => row.id === 'missing').depthKm, null);
  const implicit = selectEarthquakeListRows([KM12, NULL_DEPTH]);
  assert.deepEqual(implicit.map((row) => row.id), ['km12', 'null-depth']);
});

test('on keeps 12 km, drops null', () => {
  resetEarthquakeListHideNoDepthForTest();
  assert.equal(earthquakeListRowHasFiniteDepth(KM12), true);
  assert.equal(earthquakeListRowHasFiniteDepth(NULL_DEPTH), false);
  assert.equal(earthquakeListRowHasFiniteDepth(MISSING), false);
  assert.equal(earthquakeListRowHasFiniteDepth(NAN_DEPTH), false);
  assert.equal(earthquakeListRowMatchesHideNoDepthFilter(KM12, true), true);
  assert.equal(earthquakeListRowMatchesHideNoDepthFilter(NULL_DEPTH, true), false);
  assert.equal(earthquakeListRowMatchesHideNoDepthFilter(MISSING, true), false);
  assert.equal(earthquakeListRowMatchesHideNoDepthFilter(NAN_DEPTH, true), false);
  const rows = selectEarthquakeListRows(
    [KM12, NULL_DEPTH, MISSING, NAN_DEPTH],
    { hideNoDepth: true },
  );
  assert.deepEqual(rows.map((row) => row.id), ['km12']);
  assert.equal(rows[0].depthKm, 12);
});

test('selected id always kept', () => {
  resetEarthquakeListHideNoDepthForTest();
  const rows = selectEarthquakeListRows([KM12, NULL_DEPTH, MISSING], {
    hideNoDepth: true,
    selectedId: 'null-depth',
  });
  assert.deepEqual(rows.map((row) => row.id), ['km12', 'null-depth']);
  assert.equal(
    earthquakeListRowMatchesHideNoDepthFilter(NULL_DEPTH, true, { selectedId: 'null-depth' }),
    true,
  );
  assert.deepEqual(
    filterEarthquakeListRowsByHideNoDepth(
      [KM12, NULL_DEPTH, MISSING],
      true,
      { selectedId: 'missing' },
    ).map((row) => row.id),
    ['km12', 'missing'],
  );
});

test('invalid storage reads as off', () => {
  assert.equal(normalizeEarthquakeListHideNoDepth('nope'), false);
  assert.equal(normalizeEarthquakeListHideNoDepth(undefined), false);
  assert.equal(normalizeEarthquakeListHideNoDepth(null), false);
  assert.equal(normalizeEarthquakeListHideNoDepth('2'), false);
  assert.equal(normalizeEarthquakeListHideNoDepth('yes'), false);
  assert.equal(readEarthquakeListHideNoDepth(memoryStorage({
    [EARTHQUAKE_LIST_HIDE_NO_DEPTH_STORAGE_KEY]: 'bogus',
  })), DEFAULT_HIDE);
  assert.equal(readEarthquakeListHideNoDepth(memoryStorage({
    [EARTHQUAKE_LIST_HIDE_NO_DEPTH_STORAGE_KEY]: 'yes',
  })), DEFAULT_HIDE);
  assert.equal(readEarthquakeListHideNoDepth(memoryStorage()), DEFAULT_HIDE);
});

test('persist flip survives reload as 1 / 0', () => {
  resetEarthquakeListHideNoDepthForTest();
  const storage = memoryStorage();
  assert.equal(EARTHQUAKE_LIST_HIDE_NO_DEPTH_STORAGE_KEY, 'meridian.quakeListHideNoDepth');
  assert.equal(readEarthquakeListHideNoDepth(storage), DEFAULT_HIDE);
  assert.equal(setEarthquakeListHideNoDepth(true, { storage }), true);
  assert.equal(storage.getItem(EARTHQUAKE_LIST_HIDE_NO_DEPTH_STORAGE_KEY), '1');
  assert.equal(getEarthquakeListHideNoDepth(), true);

  resetEarthquakeListHideNoDepthForTest();
  assert.equal(getEarthquakeListHideNoDepth(), DEFAULT_HIDE);
  assert.equal(hydrateEarthquakeListHideNoDepth(storage), true);
  assert.equal(getEarthquakeListHideNoDepth(), true);

  assert.equal(setEarthquakeListHideNoDepth(false, { storage }), false);
  assert.equal(storage.getItem(EARTHQUAKE_LIST_HIDE_NO_DEPTH_STORAGE_KEY), '0');
  resetEarthquakeListHideNoDepthForTest();
  assert.equal(hydrateEarthquakeListHideNoDepth(storage), false);
  assert.equal(getEarthquakeListHideNoDepth(), false);
  writeEarthquakeListHideNoDepth(true, storage);
  assert.equal(storage.getItem(EARTHQUAKE_LIST_HIDE_NO_DEPTH_STORAGE_KEY), '1');
  resetEarthquakeListHideNoDepthForTest();
});

test('Hide no depth ANDs after mag, depth, age, range, and Hide no place', () => {
  resetEarthquakeListHideNoDepthForTest();
  const KM_PER_DEG = 6371 * Math.PI / 180;
  const namedFiniteNear = quake('named-finite', 12, {
    magnitude: 6.2,
    timeMs: 1_753_700_000_000,
    lat: 80 / KM_PER_DEG,
    lon: 0,
    place: '10 km W of Ridgecrest, CA',
  });
  const namedNullNear = quake('named-null', null, {
    magnitude: 6.1,
    timeMs: 1_753_700_000_000,
    lat: 80 / KM_PER_DEG,
    lon: 0,
    place: '12 km E of Yokohama, Japan',
  });
  const namedFarSmallDeepOld = quake('named-far', 400, {
    magnitude: 4.4,
    timeMs: 1_753_600_000_000,
    lat: 800 / KM_PER_DEG,
    lon: 0,
    place: '42 km SW of Anchorage, Alaska',
  });
  const anded = selectEarthquakeListRows(
    [namedFiniteNear, namedNullNear, namedFarSmallDeepOld],
    {
      origin: { lat: 0, lon: 0 },
      magFloor: '5',
      depthCeiling: '70',
      ageCeiling: 'all',
      rangeCeiling: '500',
      hideNoPlace: true,
      hideNoDepth: true,
    },
  );
  assert.deepEqual(anded.map((row) => row.id), ['named-finite']);
});

test('getRowControls exposes Hide no depth without replacing range or place chips', () => {
  resetEarthquakeListHideNoDepthForTest();
  const model = earthquakeListHideNoDepthChipModel(false);
  assert.equal(model.id, EARTHQUAKE_LIST_HIDE_NO_DEPTH_CHIP_ID);
  assert.equal(model.label, EARTHQUAKE_LIST_HIDE_NO_DEPTH_CHIP_LABEL);
  assert.equal(model.active, false);
  assert.equal(model.params.hideNoDepth, true);
  assert.equal(earthquakeListHideNoDepthChipModel(true).params.hideNoDepth, false);
  const controls = getRowControls();
  assert.deepEqual(controls.chips.map((chip) => chip.label), ['All', '<500 km', '<100 km']);
  assert.equal(controls.hideNoPlace.label, 'Hide no place');
  assert.equal(controls.hideNoDepth.label, 'Hide no depth');
  assert.equal(controls.hideNoDepth.active, false);
  setEarthquakeListHideNoDepth(true, { persist: false });
  assert.equal(getRowControls().hideNoDepth.active, true);
  assert.equal(getRowControls().hideNoPlace.active, false);
});

test('earthquakes.js is unchanged', () => {
  const layer = SRC('data/earthquakes.js');
  assert.doesNotMatch(layer, /quakeListHideNoDepth|earthquakeListHideNoDepthFilter|hide-no-depth|hideNoDepth/);
  assert.match(layer, /getListRecords\(\)/);
});

test('LayerStateCoordinator restore keeps the toggle and does not write a share URL', () => {
  resetEarthquakeListHideNoDepthForTest();
  const storage = memoryStorage();
  setEarthquakeListHideNoDepth(true, { storage });
  assert.equal(storage.getItem(EARTHQUAKE_LIST_HIDE_NO_DEPTH_STORAGE_KEY), '1');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['earthquakes'],
  }));
  assert.doesNotMatch(encoded.get('lo') || '', /quakeListHideNoDepth|hideNoDepth|m\.qd/);
  assert.doesNotMatch(encoded.toString(), /quakeListHideNoDepth|meridian\.quakeListHideNoDepth/);
  assert.doesNotMatch(SRC('data/layerState.js'), /quakeListHideNoDepth|meridian\.quakeListHideNoDepth/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetEarthquakeListHideNoDepthForTest();
  assert.equal(getEarthquakeListHideNoDepth(), DEFAULT_HIDE);
  assert.equal(hydrateEarthquakeListHideNoDepth(storage), true);
  assert.equal(getEarthquakeListHideNoDepth(), true);
  assert.equal(storage.getItem(EARTHQUAKE_LIST_HIDE_NO_DEPTH_STORAGE_KEY), '1');
  resetEarthquakeListHideNoDepthForTest();
});

test('list Hide no depth stays off the globe layer and share surface', () => {
  const helper = SRC('data/earthquakeListHideNoDepthFilter.js');
  const list = SRC('data/earthquakeList.js');
  const layer = SRC('data/earthquakes.js');
  const layerState = SRC('data/layerState.js');
  const sharelink = SRC('sharelink.js');
  const ui = SRC('ui.js');
  const html = ROOT_FILE('index.html');
  const license = ROOT_FILE('LICENSE');
  const readme = ROOT_FILE('README.md');

  assert.match(helper, /meridian\.quakeListHideNoDepth/);
  assert.match(helper, /region string, never a person name/);
  assert.match(list, /earthquakeListRowMatchesHideNoDepthFilter|filterEarthquakeListRowsByHideNoDepth/);
  assert.match(list, /getRowControls/);
  assert.match(list, /hideNoDepth/);
  assert.doesNotMatch(ui, /quakeListHideNoDepth|setEarthquakeListHideNoDepth|_initEarthquakeListHideNoDepth/);
  assert.doesNotMatch(html, /earthquake-list-hide-no-depth|hide-no-depth|Hide no depth/);
  assert.doesNotMatch(layer, /quakeListHideNoDepth|earthquakeListHideNoDepthFilter/);
  assert.doesNotMatch(layerState, /quakeListHideNoDepth/);
  assert.doesNotMatch(sharelink, /quakeListHideNoDepth|meridian\.quakeListHideNoDepth/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(list, /\/api\/earthquakes/);
  assert.doesNotMatch(helper, /telegeography|quantum-earth|opensky-network|news\.google/i);
  assert.doesNotMatch(helper, /hideGround|HIDE_GROUND|hide-ground/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
});
