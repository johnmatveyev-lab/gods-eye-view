import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  EARTHQUAKE_LIST_LIMIT,
  EARTHQUAKE_LIST_UNAVAILABLE,
  getRowControls,
  selectEarthquakeListRows,
} from './earthquakeList.js';
import { resetEarthquakeListAgeFilterForTest } from './earthquakeListAgeFilter.js';
import { resetEarthquakeListDepthFilterForTest } from './earthquakeListDepthFilter.js';
import { resetEarthquakeListMagFilterForTest } from './earthquakeListMagFilter.js';
import {
  DEFAULT_EARTHQUAKE_LIST_HIDE_NO_PLACE as DEFAULT_HIDE,
  EARTHQUAKE_LIST_HIDE_NO_PLACE_CHIP_ID,
  EARTHQUAKE_LIST_HIDE_NO_PLACE_CHIP_LABEL,
  EARTHQUAKE_LIST_HIDE_NO_PLACE_STORAGE_KEY,
  earthquakeListHideNoPlaceChipModel,
  earthquakeListRowHasNamedPlace,
  earthquakeListRowMatchesPlaceFilter,
  filterEarthquakeListRowsByPlace,
  getEarthquakeListHideNoPlace,
  hydrateEarthquakeListHideNoPlace,
  normalizeEarthquakeListHideNoPlace,
  readEarthquakeListHideNoPlace,
  resetEarthquakeListHideNoPlaceForTest,
  setEarthquakeListHideNoPlace,
  writeEarthquakeListHideNoPlace,
} from './earthquakeListPlaceFilter.js';
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

function quake(id, place, overrides = {}) {
  return {
    id,
    magnitude: 5.2,
    place,
    timeMs: 1_753_700_000_000,
    lat: 35.0,
    lon: -117.0,
    depthKm: 15,
    ...overrides,
  };
}

const NAMED = quake('named', '42 km SW of Anchorage, Alaska', { timeMs: 1_753_700_000_400 });
const UNAVAILABLE = quake('unavailable', EARTHQUAKE_LIST_UNAVAILABLE, { timeMs: 1_753_700_000_300 });
const EMPTY = quake('empty', '', { timeMs: 1_753_700_000_200 });
const WHITESPACE = quake('ws', '   ', { timeMs: 1_753_700_000_100 });
const MISSING = quake('missing', undefined, { timeMs: 1_753_700_000_000 });
delete MISSING.place;

beforeEach(() => {
  resetEarthquakeListMagFilterForTest();
  resetEarthquakeListDepthFilterForTest();
  resetEarthquakeListAgeFilterForTest();
  resetEarthquakeListRangeFilterForTest();
  resetEarthquakeListHideNoPlaceForTest();
});

test('off keeps UNAVAILABLE', () => {
  resetEarthquakeListHideNoPlaceForTest();
  assert.equal(DEFAULT_HIDE, false);
  assert.equal(EARTHQUAKE_LIST_LIMIT, 50);
  assert.equal(normalizeEarthquakeListHideNoPlace(false), false);
  assert.equal(earthquakeListRowMatchesPlaceFilter(UNAVAILABLE, false), true);
  assert.equal(earthquakeListRowMatchesPlaceFilter(EMPTY, false), true);
  assert.equal(earthquakeListRowMatchesPlaceFilter(MISSING, false), true);
  const rows = selectEarthquakeListRows([NAMED, UNAVAILABLE, EMPTY], {
    hideNoPlace: false,
  });
  assert.deepEqual(rows.map((row) => row.id), ['named', 'unavailable', 'empty']);
  assert.equal(rows.find((row) => row.id === 'unavailable').place, EARTHQUAKE_LIST_UNAVAILABLE);
  assert.equal(rows.find((row) => row.id === 'empty').place, EARTHQUAKE_LIST_UNAVAILABLE);
  const implicit = selectEarthquakeListRows([NAMED, UNAVAILABLE]);
  assert.deepEqual(implicit.map((row) => row.id), ['named', 'unavailable']);
});

test('on keeps a region string, drops UNAVAILABLE and empty', () => {
  resetEarthquakeListHideNoPlaceForTest();
  assert.equal(earthquakeListRowHasNamedPlace(NAMED), true);
  assert.equal(earthquakeListRowHasNamedPlace(UNAVAILABLE), false);
  assert.equal(earthquakeListRowHasNamedPlace(EMPTY), false);
  assert.equal(earthquakeListRowHasNamedPlace(WHITESPACE), false);
  assert.equal(earthquakeListRowHasNamedPlace(MISSING), false);
  assert.equal(earthquakeListRowMatchesPlaceFilter(NAMED, true), true);
  assert.equal(earthquakeListRowMatchesPlaceFilter(UNAVAILABLE, true), false);
  assert.equal(earthquakeListRowMatchesPlaceFilter(EMPTY, true), false);
  assert.equal(earthquakeListRowMatchesPlaceFilter(WHITESPACE, true), false);
  assert.equal(earthquakeListRowMatchesPlaceFilter(MISSING, true), false);
  const rows = selectEarthquakeListRows(
    [NAMED, UNAVAILABLE, EMPTY, WHITESPACE, MISSING],
    { hideNoPlace: true },
  );
  assert.deepEqual(rows.map((row) => row.id), ['named']);
  assert.equal(rows[0].place, '42 km SW of Anchorage, Alaska');
  assert.equal(rows[0].place.includes('Anchorage'), true);
  assert.doesNotMatch(rows[0].place, /John|Jane|person/i);
});

test('selected id always kept', () => {
  resetEarthquakeListHideNoPlaceForTest();
  const rows = selectEarthquakeListRows([NAMED, UNAVAILABLE, EMPTY], {
    hideNoPlace: true,
    selectedId: 'unavailable',
  });
  assert.deepEqual(rows.map((row) => row.id), ['named', 'unavailable']);
  assert.equal(
    earthquakeListRowMatchesPlaceFilter(UNAVAILABLE, true, { selectedId: 'unavailable' }),
    true,
  );
  assert.deepEqual(
    filterEarthquakeListRowsByPlace(
      [NAMED, UNAVAILABLE, EMPTY],
      true,
      { selectedId: 'empty' },
    ).map((row) => row.id),
    ['named', 'empty'],
  );
});

test('invalid storage reads as off', () => {
  assert.equal(normalizeEarthquakeListHideNoPlace('nope'), false);
  assert.equal(normalizeEarthquakeListHideNoPlace(undefined), false);
  assert.equal(normalizeEarthquakeListHideNoPlace(null), false);
  assert.equal(normalizeEarthquakeListHideNoPlace('2'), false);
  assert.equal(normalizeEarthquakeListHideNoPlace('yes'), false);
  assert.equal(readEarthquakeListHideNoPlace(memoryStorage({
    [EARTHQUAKE_LIST_HIDE_NO_PLACE_STORAGE_KEY]: 'bogus',
  })), DEFAULT_HIDE);
  assert.equal(readEarthquakeListHideNoPlace(memoryStorage({
    [EARTHQUAKE_LIST_HIDE_NO_PLACE_STORAGE_KEY]: 'yes',
  })), DEFAULT_HIDE);
  assert.equal(readEarthquakeListHideNoPlace(memoryStorage()), DEFAULT_HIDE);
});

test('persist flip survives reload as 1 / 0', () => {
  resetEarthquakeListHideNoPlaceForTest();
  const storage = memoryStorage();
  assert.equal(EARTHQUAKE_LIST_HIDE_NO_PLACE_STORAGE_KEY, 'meridian.quakeListHideNoPlace');
  assert.equal(readEarthquakeListHideNoPlace(storage), DEFAULT_HIDE);
  assert.equal(setEarthquakeListHideNoPlace(true, { storage }), true);
  assert.equal(storage.getItem(EARTHQUAKE_LIST_HIDE_NO_PLACE_STORAGE_KEY), '1');
  assert.equal(getEarthquakeListHideNoPlace(), true);

  resetEarthquakeListHideNoPlaceForTest();
  assert.equal(getEarthquakeListHideNoPlace(), DEFAULT_HIDE);
  assert.equal(hydrateEarthquakeListHideNoPlace(storage), true);
  assert.equal(getEarthquakeListHideNoPlace(), true);

  assert.equal(setEarthquakeListHideNoPlace(false, { storage }), false);
  assert.equal(storage.getItem(EARTHQUAKE_LIST_HIDE_NO_PLACE_STORAGE_KEY), '0');
  resetEarthquakeListHideNoPlaceForTest();
  assert.equal(hydrateEarthquakeListHideNoPlace(storage), false);
  assert.equal(getEarthquakeListHideNoPlace(), false);
  writeEarthquakeListHideNoPlace(true, storage);
  assert.equal(storage.getItem(EARTHQUAKE_LIST_HIDE_NO_PLACE_STORAGE_KEY), '1');
  resetEarthquakeListHideNoPlaceForTest();
});

test('Hide no place ANDs after mag, depth, age, and range', () => {
  resetEarthquakeListHideNoPlaceForTest();
  const KM_PER_DEG = 6371 * Math.PI / 180;
  const namedNear = quake('named-near', '10 km W of Ridgecrest, CA', {
    magnitude: 6.2,
    depthKm: 15,
    timeMs: 1_753_700_000_000,
    lat: 80 / KM_PER_DEG,
    lon: 0,
  });
  const unavailableNear = quake('unavailable-near', EARTHQUAKE_LIST_UNAVAILABLE, {
    magnitude: 6.1,
    depthKm: 12,
    timeMs: 1_753_700_000_000,
    lat: 80 / KM_PER_DEG,
    lon: 0,
  });
  const namedFarSmallDeepOld = quake('named-far', '12 km E of Yokohama, Japan', {
    magnitude: 4.4,
    depthKm: 400,
    timeMs: 1_753_600_000_000,
    lat: 800 / KM_PER_DEG,
    lon: 0,
  });
  const anded = selectEarthquakeListRows(
    [namedNear, unavailableNear, namedFarSmallDeepOld],
    {
      origin: { lat: 0, lon: 0 },
      magFloor: '5',
      depthCeiling: '70',
      ageCeiling: 'all',
      rangeCeiling: '500',
      hideNoPlace: true,
    },
  );
  assert.deepEqual(anded.map((row) => row.id), ['named-near']);
});

test('getRowControls exposes Hide no place without replacing range chips', () => {
  resetEarthquakeListHideNoPlaceForTest();
  const model = earthquakeListHideNoPlaceChipModel(false);
  assert.equal(model.id, EARTHQUAKE_LIST_HIDE_NO_PLACE_CHIP_ID);
  assert.equal(model.label, EARTHQUAKE_LIST_HIDE_NO_PLACE_CHIP_LABEL);
  assert.equal(model.active, false);
  assert.equal(model.params.hideNoPlace, true);
  assert.equal(earthquakeListHideNoPlaceChipModel(true).params.hideNoPlace, false);
  const controls = getRowControls();
  assert.deepEqual(controls.chips.map((chip) => chip.label), ['All', '<500 km', '<100 km']);
  assert.equal(controls.hideNoPlace.label, 'Hide no place');
  assert.equal(controls.hideNoPlace.active, false);
  setEarthquakeListHideNoPlace(true, { persist: false });
  assert.equal(getRowControls().hideNoPlace.active, true);
});

test('earthquakes.js is unchanged', () => {
  const layer = SRC('data/earthquakes.js');
  assert.doesNotMatch(layer, /quakeListHideNoPlace|earthquakeListPlaceFilter|hide-no-place|hideNoPlace/);
  assert.match(layer, /getListRecords\(\)/);
});

test('LayerStateCoordinator restore keeps the toggle and does not write a share URL', () => {
  resetEarthquakeListHideNoPlaceForTest();
  const storage = memoryStorage();
  setEarthquakeListHideNoPlace(true, { storage });
  assert.equal(storage.getItem(EARTHQUAKE_LIST_HIDE_NO_PLACE_STORAGE_KEY), '1');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['earthquakes'],
  }));
  assert.doesNotMatch(encoded.get('lo') || '', /quakeListHideNoPlace|hideNoPlace|m\.qp/);
  assert.doesNotMatch(encoded.toString(), /quakeListHideNoPlace|meridian\.quakeListHideNoPlace/);
  assert.doesNotMatch(SRC('data/layerState.js'), /quakeListHideNoPlace|meridian\.quakeListHideNoPlace/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetEarthquakeListHideNoPlaceForTest();
  assert.equal(getEarthquakeListHideNoPlace(), DEFAULT_HIDE);
  assert.equal(hydrateEarthquakeListHideNoPlace(storage), true);
  assert.equal(getEarthquakeListHideNoPlace(), true);
  assert.equal(storage.getItem(EARTHQUAKE_LIST_HIDE_NO_PLACE_STORAGE_KEY), '1');
  resetEarthquakeListHideNoPlaceForTest();
});

test('list Hide no place stays off the globe layer and share surface', () => {
  const helper = SRC('data/earthquakeListPlaceFilter.js');
  const list = SRC('data/earthquakeList.js');
  const layer = SRC('data/earthquakes.js');
  const layerState = SRC('data/layerState.js');
  const sharelink = SRC('sharelink.js');
  const ui = SRC('ui.js');
  const html = ROOT_FILE('index.html');
  const license = ROOT_FILE('LICENSE');
  const readme = ROOT_FILE('README.md');

  assert.match(helper, /meridian\.quakeListHideNoPlace/);
  assert.match(helper, /region string, never a person name/);
  assert.match(list, /earthquakeListRowMatchesPlaceFilter|filterEarthquakeListRowsByPlace/);
  assert.match(list, /getRowControls/);
  assert.match(list, /hideNoPlace/);
  assert.doesNotMatch(ui, /quakeListHideNoPlace|setEarthquakeListHideNoPlace|_initEarthquakeListPlace/);
  assert.doesNotMatch(html, /earthquake-list-place|hide-no-place|Hide no place/);
  assert.doesNotMatch(layer, /quakeListHideNoPlace|earthquakeListPlaceFilter/);
  assert.doesNotMatch(layerState, /quakeListHideNoPlace/);
  assert.doesNotMatch(sharelink, /quakeListHideNoPlace|meridian\.quakeListHideNoPlace/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(list, /\/api\/earthquakes/);
  assert.doesNotMatch(helper, /telegeography|quantum-earth|opensky-network|news\.google/i);
  assert.doesNotMatch(helper, /hideGround|HIDE_GROUND|hide-ground/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
});
