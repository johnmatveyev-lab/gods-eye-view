import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  BIKESHARE_SELECTED_OVERLAY_SOURCE_OPTIONS,
  _applyBikeshareStatusForTest,
  _clearBikeshareSelectionForTest,
  _getBikeshareGbfsFetchCountForTest,
  _getBikeshareStationShowForTest,
  _resetBikeshareSystemPickerForTest,
  _seedBikeshareStationsForTest,
  _selectBikeshareStationForTest,
  _setBikeshareSelectionStateForTest,
  _setBikeshareSystemStorageForTest,
  createBikeshareSelectedOverlayEntry,
  listBikeshareSystems,
  loadBikeshareSystemStations,
  shouldShowBikeshareStation,
} from './bikeshare.js';
import bikeshareLayer from './bikeshare.js';
import {
  BIKESHARE_HIDE_CLOSED_STORAGE_KEY,
  BIKESHARE_HIDE_EMPTY_STORAGE_KEY,
  BIKESHARE_HIDE_FULL_STORAGE_KEY,
  BIKESHARE_SYSTEM_STORAGE_KEY,
  buildGbfsProxyUrl,
  readPersistedBikeshareHideClosed,
  readPersistedBikeshareHideEmpty,
  readPersistedBikeshareHideFull,
  writePersistedBikeshareHideClosed,
  writePersistedBikeshareHideEmpty,
  writePersistedBikeshareHideFull,
} from './bikeshareSystems.js';

function makeRecord() {
  return {
    stationId: '3790',
    stationName: 'Congress & 6th',
    bikesAvailable: 7,
    docksAvailable: 4,
    capacity: 11,
    isInstalled: true,
    isRenting: false,
    isReturning: true,
    point: {
      position: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 2),
      show: true,
    },
  };
}

test('selected bikeshare entry preserves source copy and protected-lane policy', () => {
  const record = makeRecord();
  const entry = createBikeshareSelectedOverlayEntry('austin-capmetro:3790', record);
  assert.equal(entry.position, record.point.position);
  assert.equal(entry.title, 'Congress & 6th');
  assert.deepEqual(entry.details, [
    '🚲 7 avail · 4 docks · 11 cap',
    '⚠️ Not renting',
  ]);
  assert.equal(entry.variant, 'selected');
  assert.equal(entry.selected, true);
  assert.equal(entry.protected, true);
  assert.equal(entry.paintLane, 'selected');
  assert.equal(entry.collisionGroup, 'ambient-card');
  assert.equal(entry.edgeFade, 'keyhole');
  assert.equal(entry.horizonCull, true);
});

test('real station select/clear path publishes one card and creates no native label graphic', () => {
  const calls = [];
  const overlayHost = {
    setEntries: (...args) => calls.push(['entries', ...args]),
    setVisible: (...args) => calls.push(['visible', ...args]),
    clearSource: (...args) => calls.push(['clear', ...args]),
  };
  const key = 'austin-capmetro:3790';
  const record = makeRecord();
  const viewer = { entities: new Cesium.EntityCollection() };
  _setBikeshareSelectionStateForTest({ viewer, key, record, overlayHost });
  try {
    _selectBikeshareStationForTest(key);
    assert.equal(record.point.show, false);
    assert.equal(viewer.entities.values.length, 1, 'runtime guard requires a real selected entity');
    assert.equal(viewer.entities.values[0].label, undefined);
    assert.ok(viewer.entities.values[0].point, 'selected point highlight remains native');

    const publication = calls.find(([type]) => type === 'entries');
    assert.ok(publication);
    assert.equal(publication[1], 'bikeshare-selected');
    assert.equal(publication[2].length, 1);
    assert.equal(publication[2][0].position, record.point.position);
    assert.deepEqual(publication[3], BIKESHARE_SELECTED_OVERLAY_SOURCE_OPTIONS);

    _clearBikeshareSelectionForTest();
    assert.equal(record.point.show, true);
    assert.equal(viewer.entities.values.length, 0);
    assert.deepEqual(calls.at(-1), ['clear', 'bikeshare-selected']);
  } finally {
    _clearBikeshareSelectionForTest();
  }
});

function gbfsPayload(stations) {
  return { data: { stations } };
}

function mockGbfsFetch(feeds) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const feed = feeds.find((entry) => url === entry.proxyUrl);
    if (!feed) {
      return { ok: false, status: 404, json: async () => ({ error: 'missing' }) };
    }
    return { ok: true, json: async () => feed.payload };
  };
  return { calls, fetchImpl };
}

test('picking system A then B loads only that system through /api/gbfs', async () => {
  const systems = listBikeshareSystems();
  const systemA = systems.find((system) => system.id === 'nyc-citibike');
  const systemB = systems.find((system) => system.id === 'chicago-divvy');
  assert.ok(systemA && systemB);

  const { calls, fetchImpl } = mockGbfsFetch([
    {
      proxyUrl: buildGbfsProxyUrl(systemA.stationInformationUrl),
      payload: gbfsPayload([{ station_id: 'nyc-1', name: 'W 4 St', lat: 40.73, lon: -74.00, capacity: 20 }]),
    },
    {
      proxyUrl: buildGbfsProxyUrl(systemA.stationStatusUrl),
      payload: gbfsPayload([{ station_id: 'nyc-1', num_bikes_available: 4, num_docks_available: 16 }]),
    },
    {
      proxyUrl: buildGbfsProxyUrl(systemB.stationInformationUrl),
      payload: gbfsPayload([{ station_id: 'chi-1', name: 'Michigan Ave', lat: 41.88, lon: -87.62, capacity: 15 }]),
    },
    {
      proxyUrl: buildGbfsProxyUrl(systemB.stationStatusUrl),
      payload: gbfsPayload([{ station_id: 'chi-1', num_bikes_available: 9, num_docks_available: 6 }]),
    },
  ]);

  const first = await loadBikeshareSystemStations(systemA.id, { fetchImpl });
  assert.equal(first.unavailable, false);
  assert.deepEqual(first.proxyUrls, [
    buildGbfsProxyUrl(systemA.stationInformationUrl),
    buildGbfsProxyUrl(systemA.stationStatusUrl),
  ]);
  assert.ok(first.stations.has('nyc-1'));
  assert.equal(first.stations.has('chi-1'), false);
  assert.equal(first.status.get('nyc-1')?.bikesAvailable, 4);
  assert.ok(calls.every((url) => url.startsWith('/api/gbfs/')));
  assert.ok(calls.includes(buildGbfsProxyUrl(systemA.stationInformationUrl)));
  assert.equal(calls.includes(buildGbfsProxyUrl(systemB.stationInformationUrl)), false);

  const second = await loadBikeshareSystemStations(systemB.id, { fetchImpl });
  assert.equal(second.cityId, systemB.id);
  assert.ok(second.stations.has('chi-1'));
  assert.equal(second.stations.has('nyc-1'), false);
  assert.equal(second.status.get('chi-1')?.bikesAvailable, 9);
  assert.ok(calls.includes(buildGbfsProxyUrl(systemB.stationInformationUrl)));
});

test('empty GBFS feed is empty and unavailable', async () => {
  const austin = listBikeshareSystems().find((system) => system.id === 'austin-capmetro');
  assert.ok(austin);
  const { fetchImpl } = mockGbfsFetch([
    {
      proxyUrl: buildGbfsProxyUrl(austin.stationInformationUrl),
      payload: gbfsPayload([]),
    },
    {
      proxyUrl: buildGbfsProxyUrl(austin.stationStatusUrl),
      payload: gbfsPayload([]),
    },
  ]);

  const result = await loadBikeshareSystemStations(austin.id, { fetchImpl });
  assert.equal(result.cityId, austin.id);
  assert.equal(result.stations.size, 0);
  assert.equal(result.unavailable, true);
});

test('setSelectedSystem persists the last allowlisted system and rejects unknown ids', () => {
  const storage = new Map();
  _setBikeshareSystemStorageForTest({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); },
  });
  try {
    assert.equal(bikeshareLayer.setSelectedSystem('not-a-real-system'), false);
    assert.equal(bikeshareLayer.getSelectedSystem(), 'austin-capmetro');
    assert.equal(bikeshareLayer.setSelectedSystem('boston-bluebikes'), true);
    assert.equal(bikeshareLayer.getSelectedSystem(), 'boston-bluebikes');
    assert.equal(storage.get(BIKESHARE_SYSTEM_STORAGE_KEY), 'boston-bluebikes');
    const picker = bikeshareLayer.getRowControls().picker;
    assert.equal(picker.value, 'boston-bluebikes');
    assert.ok(picker.options.every((option) => listBikeshareSystems().some((system) => system.id === option.value)));
    assert.equal(picker.options.some((option) => /evil/i.test(option.value)), false);
  } finally {
    _resetBikeshareSystemPickerForTest();
  }
});

function makeStationRecord({
  key,
  cityId,
  stationId,
  bikesAvailable,
  docksAvailable = 4,
  capacity = 10,
  isInstalled = true,
  isRenting = true,
  isReturning = true,
}) {
  return {
    key,
    cityId,
    stationId,
    stationName: stationId,
    bikesAvailable,
    docksAvailable,
    capacity,
    isInstalled,
    isRenting,
    isReturning,
    point: { position: Cesium.Cartesian3.fromDegrees(-97.74, 30.27, 2), show: true },
  };
}

test('hide empty off matches the current dots; on hides only 0-bike stations', () => {
  _resetBikeshareSystemPickerForTest();
  const cityId = 'austin-capmetro';
  const empty = makeStationRecord({
    key: `${cityId}:empty`,
    cityId,
    stationId: 'empty',
    bikesAvailable: 0,
  });
  const stocked = makeStationRecord({
    key: `${cityId}:stocked`,
    cityId,
    stationId: 'stocked',
    bikesAvailable: 5,
  });
  const unknown = makeStationRecord({
    key: `${cityId}:unknown`,
    cityId,
    stationId: 'unknown',
    bikesAvailable: null,
  });
  _seedBikeshareStationsForTest([empty, stocked, unknown], { cityId });

  assert.equal(bikeshareLayer.getParams().hideEmpty, false);
  assert.equal(_getBikeshareStationShowForTest(empty.key), true);
  assert.equal(_getBikeshareStationShowForTest(stocked.key), true);
  assert.equal(_getBikeshareStationShowForTest(unknown.key), true);

  const fetchesBefore = _getBikeshareGbfsFetchCountForTest();
  assert.equal(bikeshareLayer.setParams({ hideEmpty: true }), true);
  assert.equal(_getBikeshareGbfsFetchCountForTest(), fetchesBefore,
    'toggle must filter cached status, not refetch GBFS');
  assert.equal(_getBikeshareStationShowForTest(empty.key), false);
  assert.equal(_getBikeshareStationShowForTest(stocked.key), true);
  assert.equal(_getBikeshareStationShowForTest(unknown.key), true,
    'unknown / non-finite bikesAvailable stay visible');

  assert.equal(bikeshareLayer.setParams({ hideEmpty: false }), true);
  assert.equal(_getBikeshareStationShowForTest(empty.key), true);
  assert.equal(_getBikeshareStationShowForTest(stocked.key), true);
  _resetBikeshareSystemPickerForTest();
});

test('hide empty predicate keeps selected empty stations and unknown counts', () => {
  const empty = { key: 'austin-capmetro:empty', bikesAvailable: 0 };
  assert.equal(shouldShowBikeshareStation(empty, { hideEmpty: false }), true);
  assert.equal(shouldShowBikeshareStation(empty, { hideEmpty: true }), false);
  assert.equal(shouldShowBikeshareStation(empty, {
    hideEmpty: true,
    selectedKey: 'austin-capmetro:empty',
  }), true);
  assert.equal(shouldShowBikeshareStation({ bikesAvailable: Number.NaN }, { hideEmpty: true }), true);
  assert.equal(shouldShowBikeshareStation({ bikesAvailable: 3 }, { hideEmpty: true }), true);
});

test('selected empty station stays visible until deselected', () => {
  _resetBikeshareSystemPickerForTest();
  const cityId = 'austin-capmetro';
  const key = `${cityId}:3790`;
  const record = makeStationRecord({
    key,
    cityId,
    stationId: '3790',
    bikesAvailable: 4,
  });
  const viewer = { entities: new Cesium.EntityCollection() };
  const overlayHost = {
    setEntries() {},
    setVisible() {},
    clearSource() {},
  };
  _setBikeshareSelectionStateForTest({ viewer, key, record, overlayHost });
  _seedBikeshareStationsForTest([record], { cityId });
  try {
    _selectBikeshareStationForTest(key);
    assert.equal(record.point.show, false);
    assert.equal(viewer.entities.values.length, 1);

    bikeshareLayer.setParams({ hideEmpty: true });
    _applyBikeshareStatusForTest(cityId, new Map([
      ['3790', { bikesAvailable: 0, docksAvailable: 8, isInstalled: true, isRenting: true, isReturning: true }],
    ]));
    assert.equal(record.bikesAvailable, 0);
    assert.equal(viewer.entities.values.length, 1, 'selected highlight stays after the dock empties');
    assert.equal(record.point.show, false);

    _clearBikeshareSelectionForTest();
    assert.equal(record.point.show, false, 'deselected empty station is hidden while the filter is on');
  } finally {
    _clearBikeshareSelectionForTest();
    _resetBikeshareSystemPickerForTest();
  }
});

test('failed GBFS status still filters last-good availability', () => {
  _resetBikeshareSystemPickerForTest();
  const cityId = 'austin-capmetro';
  const empty = makeStationRecord({
    key: `${cityId}:empty`,
    cityId,
    stationId: 'empty',
    bikesAvailable: 0,
  });
  const stocked = makeStationRecord({
    key: `${cityId}:stocked`,
    cityId,
    stationId: 'stocked',
    bikesAvailable: 2,
  });
  _seedBikeshareStationsForTest([empty, stocked], { cityId });
  const fetchesBefore = _getBikeshareGbfsFetchCountForTest();
  bikeshareLayer.setParams({ hideEmpty: true });
  assert.equal(_getBikeshareGbfsFetchCountForTest(), fetchesBefore);
  assert.equal(_getBikeshareStationShowForTest(empty.key), false);
  assert.equal(_getBikeshareStationShowForTest(stocked.key), true);
  _resetBikeshareSystemPickerForTest();
});

test('system picker still switches allowlisted systems while hide empty is on', () => {
  const storage = new Map();
  _setBikeshareSystemStorageForTest({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); },
  });
  try {
    bikeshareLayer.setParams({ hideEmpty: true });
    assert.equal(bikeshareLayer.setSelectedSystem('chicago-divvy'), true);
    assert.equal(bikeshareLayer.getSelectedSystem(), 'chicago-divvy');
    assert.equal(storage.get(BIKESHARE_SYSTEM_STORAGE_KEY), 'chicago-divvy');
    const controls = bikeshareLayer.getRowControls();
    assert.equal(controls.picker.value, 'chicago-divvy');
    assert.ok(controls.picker.options.every((option) => (
      listBikeshareSystems().some((system) => system.id === option.value)
    )));
    assert.equal(controls.chips[0].id, 'hide-empty');
    assert.equal(controls.chips[0].active, true);
    assert.equal(bikeshareLayer.setSelectedSystem('not-a-real-system'), false);
    assert.equal(bikeshareLayer.getSelectedSystem(), 'chicago-divvy');
  } finally {
    _resetBikeshareSystemPickerForTest();
  }
});

test('hide empty persists with the bikeshare layer and adds no new endpoint', () => {
  const storage = new Map();
  const store = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); },
  };
  _setBikeshareSystemStorageForTest(store);
  try {
    assert.equal(writePersistedBikeshareHideEmpty(true, store), true);
    assert.equal(storage.get(BIKESHARE_HIDE_EMPTY_STORAGE_KEY), '1');
    assert.equal(readPersistedBikeshareHideEmpty(store), true);
    bikeshareLayer.setParams({ hideEmpty: true });
    assert.equal(storage.get(BIKESHARE_HIDE_EMPTY_STORAGE_KEY), '1');
    assert.equal(bikeshareLayer.getParams().hideEmpty, true);
    assert.match(buildGbfsProxyUrl('https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json'), /^\/api\/gbfs\//);
  } finally {
    _resetBikeshareSystemPickerForTest();
  }
});

test('hide full off matches the current dots; on hides only 0-dock stations', () => {
  _resetBikeshareSystemPickerForTest();
  const cityId = 'austin-capmetro';
  const full = makeStationRecord({
    key: `${cityId}:full`,
    cityId,
    stationId: 'full',
    bikesAvailable: 8,
    docksAvailable: 0,
  });
  const open = makeStationRecord({
    key: `${cityId}:open`,
    cityId,
    stationId: 'open',
    bikesAvailable: 3,
    docksAvailable: 5,
  });
  const unknown = makeStationRecord({
    key: `${cityId}:unknown`,
    cityId,
    stationId: 'unknown',
    bikesAvailable: 2,
    docksAvailable: null,
  });
  _seedBikeshareStationsForTest([full, open, unknown], { cityId });

  assert.equal(bikeshareLayer.getParams().hideFull, false);
  assert.equal(_getBikeshareStationShowForTest(full.key), true);
  assert.equal(_getBikeshareStationShowForTest(open.key), true);
  assert.equal(_getBikeshareStationShowForTest(unknown.key), true);

  const fetchesBefore = _getBikeshareGbfsFetchCountForTest();
  assert.equal(bikeshareLayer.setParams({ hideFull: true }), true);
  assert.equal(_getBikeshareGbfsFetchCountForTest(), fetchesBefore,
    'toggle must filter cached status, not refetch GBFS');
  assert.equal(_getBikeshareStationShowForTest(full.key), false);
  assert.equal(_getBikeshareStationShowForTest(open.key), true);
  assert.equal(_getBikeshareStationShowForTest(unknown.key), true,
    'unknown / non-finite docksAvailable stay visible');

  assert.equal(bikeshareLayer.setParams({ hideFull: false }), true);
  assert.equal(_getBikeshareStationShowForTest(full.key), true);
  assert.equal(_getBikeshareStationShowForTest(open.key), true);
  _resetBikeshareSystemPickerForTest();
});

test('hide empty and hide full AND independently', () => {
  _resetBikeshareSystemPickerForTest();
  const cityId = 'austin-capmetro';
  const empty = makeStationRecord({
    key: `${cityId}:empty`,
    cityId,
    stationId: 'empty',
    bikesAvailable: 0,
    docksAvailable: 6,
  });
  const full = makeStationRecord({
    key: `${cityId}:full`,
    cityId,
    stationId: 'full',
    bikesAvailable: 7,
    docksAvailable: 0,
  });
  const both = makeStationRecord({
    key: `${cityId}:both`,
    cityId,
    stationId: 'both',
    bikesAvailable: 0,
    docksAvailable: 0,
  });
  const usable = makeStationRecord({
    key: `${cityId}:usable`,
    cityId,
    stationId: 'usable',
    bikesAvailable: 4,
    docksAvailable: 3,
  });
  const closed = makeStationRecord({
    key: `${cityId}:closed`,
    cityId,
    stationId: 'closed',
    bikesAvailable: 4,
    docksAvailable: 3,
    isRenting: false,
  });
  _seedBikeshareStationsForTest([empty, full, both, usable, closed], { cityId });

  bikeshareLayer.setParams({ hideEmpty: true });
  assert.equal(_getBikeshareStationShowForTest(empty.key), false);
  assert.equal(_getBikeshareStationShowForTest(full.key), true);
  assert.equal(_getBikeshareStationShowForTest(both.key), false);
  assert.equal(_getBikeshareStationShowForTest(usable.key), true);
  assert.equal(_getBikeshareStationShowForTest(closed.key), true,
    'Hide empty does not hide a stocked closed station');

  bikeshareLayer.setParams({ hideFull: true });
  assert.equal(_getBikeshareStationShowForTest(empty.key), false);
  assert.equal(_getBikeshareStationShowForTest(full.key), false);
  assert.equal(_getBikeshareStationShowForTest(both.key), false);
  assert.equal(_getBikeshareStationShowForTest(usable.key), true);
  assert.equal(_getBikeshareStationShowForTest(closed.key), true,
    'Hide full does not hide an open-dock closed station');

  bikeshareLayer.setParams({ hideClosed: true });
  assert.equal(_getBikeshareStationShowForTest(empty.key), false);
  assert.equal(_getBikeshareStationShowForTest(full.key), false);
  assert.equal(_getBikeshareStationShowForTest(usable.key), true);
  assert.equal(_getBikeshareStationShowForTest(closed.key), false);

  bikeshareLayer.setParams({ hideEmpty: false, hideFull: false });
  assert.equal(_getBikeshareStationShowForTest(empty.key), true);
  assert.equal(_getBikeshareStationShowForTest(full.key), true);
  assert.equal(_getBikeshareStationShowForTest(closed.key), false);
  assert.equal(_getBikeshareStationShowForTest(usable.key), true);
  _resetBikeshareSystemPickerForTest();
});

test('hide full predicate keeps selected full stations and unknown dock counts', () => {
  const full = { key: 'austin-capmetro:full', docksAvailable: 0 };
  assert.equal(shouldShowBikeshareStation(full, { hideFull: false }), true);
  assert.equal(shouldShowBikeshareStation(full, { hideFull: true }), false);
  assert.equal(shouldShowBikeshareStation(full, {
    hideFull: true,
    selectedKey: 'austin-capmetro:full',
  }), true);
  assert.equal(shouldShowBikeshareStation({ docksAvailable: Number.NaN }, { hideFull: true }), true);
  assert.equal(shouldShowBikeshareStation({ docksAvailable: 3 }, { hideFull: true }), true);
  assert.equal(shouldShowBikeshareStation({
    bikesAvailable: 0,
    docksAvailable: 0,
  }, { hideEmpty: true, hideFull: true }), false);
});

test('selected full station stays visible until deselected', () => {
  _resetBikeshareSystemPickerForTest();
  const cityId = 'austin-capmetro';
  const key = `${cityId}:3790`;
  const record = makeStationRecord({
    key,
    cityId,
    stationId: '3790',
    bikesAvailable: 4,
    docksAvailable: 6,
  });
  const viewer = { entities: new Cesium.EntityCollection() };
  const overlayHost = {
    setEntries() {},
    setVisible() {},
    clearSource() {},
  };
  _setBikeshareSelectionStateForTest({ viewer, key, record, overlayHost });
  _seedBikeshareStationsForTest([record], { cityId });
  try {
    _selectBikeshareStationForTest(key);
    assert.equal(record.point.show, false);
    assert.equal(viewer.entities.values.length, 1);

    bikeshareLayer.setParams({ hideFull: true });
    _applyBikeshareStatusForTest(cityId, new Map([
      ['3790', { bikesAvailable: 10, docksAvailable: 0, isInstalled: true, isRenting: true, isReturning: true }],
    ]));
    assert.equal(record.docksAvailable, 0);
    assert.equal(viewer.entities.values.length, 1, 'selected highlight stays after the station fills');
    assert.equal(record.point.show, false);

    _clearBikeshareSelectionForTest();
    assert.equal(record.point.show, false, 'deselected full station is hidden while the filter is on');
  } finally {
    _clearBikeshareSelectionForTest();
    _resetBikeshareSystemPickerForTest();
  }
});

test('system picker still switches allowlisted systems while hide full is on', () => {
  const storage = new Map();
  _setBikeshareSystemStorageForTest({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); },
  });
  try {
    bikeshareLayer.setParams({ hideFull: true });
    assert.equal(bikeshareLayer.setSelectedSystem('chicago-divvy'), true);
    assert.equal(bikeshareLayer.getSelectedSystem(), 'chicago-divvy');
    assert.equal(storage.get(BIKESHARE_SYSTEM_STORAGE_KEY), 'chicago-divvy');
    const controls = bikeshareLayer.getRowControls();
    assert.equal(controls.picker.value, 'chicago-divvy');
    assert.ok(controls.picker.options.every((option) => (
      listBikeshareSystems().some((system) => system.id === option.value)
    )));
    assert.equal(controls.chips[0].id, 'hide-empty');
    assert.equal(controls.chips[1].id, 'hide-full');
    assert.equal(controls.chips[1].active, true);
    assert.equal(controls.chips[0].active, false);
    assert.equal(bikeshareLayer.setSelectedSystem('not-a-real-system'), false);
    assert.equal(bikeshareLayer.getSelectedSystem(), 'chicago-divvy');
  } finally {
    _resetBikeshareSystemPickerForTest();
  }
});

test('hide full persists with the bikeshare layer and adds no new endpoint', () => {
  const storage = new Map();
  const store = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); },
  };
  _setBikeshareSystemStorageForTest(store);
  try {
    assert.equal(writePersistedBikeshareHideFull(true, store), true);
    assert.equal(storage.get(BIKESHARE_HIDE_FULL_STORAGE_KEY), '1');
    assert.equal(readPersistedBikeshareHideFull(store), true);
    bikeshareLayer.setParams({ hideFull: true });
    assert.equal(storage.get(BIKESHARE_HIDE_FULL_STORAGE_KEY), '1');
    assert.equal(bikeshareLayer.getParams().hideFull, true);
    assert.equal(bikeshareLayer.getParams().hideEmpty, false);
    assert.match(buildGbfsProxyUrl('https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json'), /^\/api\/gbfs\//);
  } finally {
    _resetBikeshareSystemPickerForTest();
  }
});

test('hide closed off matches the current dots; on hides muted / not-renting stations', () => {
  _resetBikeshareSystemPickerForTest();
  const cityId = 'austin-capmetro';
  const notInstalled = makeStationRecord({
    key: `${cityId}:not-installed`,
    cityId,
    stationId: 'not-installed',
    bikesAvailable: 4,
    isInstalled: false,
  });
  const notRenting = makeStationRecord({
    key: `${cityId}:not-renting`,
    cityId,
    stationId: 'not-renting',
    bikesAvailable: 5,
    isRenting: false,
  });
  const notReturning = makeStationRecord({
    key: `${cityId}:not-returning`,
    cityId,
    stationId: 'not-returning',
    bikesAvailable: 3,
    isReturning: false,
  });
  const open = makeStationRecord({
    key: `${cityId}:open`,
    cityId,
    stationId: 'open',
    bikesAvailable: 6,
  });
  const unknown = makeStationRecord({
    key: `${cityId}:unknown`,
    cityId,
    stationId: 'unknown',
    bikesAvailable: 2,
    isInstalled: undefined,
    isRenting: undefined,
    isReturning: undefined,
  });
  _seedBikeshareStationsForTest([notInstalled, notRenting, notReturning, open, unknown], { cityId });

  assert.equal(bikeshareLayer.getParams().hideClosed, false);
  assert.equal(_getBikeshareStationShowForTest(notInstalled.key), true);
  assert.equal(_getBikeshareStationShowForTest(notRenting.key), true);
  assert.equal(_getBikeshareStationShowForTest(notReturning.key), true);
  assert.equal(_getBikeshareStationShowForTest(open.key), true);
  assert.equal(_getBikeshareStationShowForTest(unknown.key), true);

  const fetchesBefore = _getBikeshareGbfsFetchCountForTest();
  assert.equal(bikeshareLayer.setParams({ hideClosed: true }), true);
  assert.equal(_getBikeshareGbfsFetchCountForTest(), fetchesBefore,
    'toggle must filter cached status, not refetch GBFS');
  assert.equal(_getBikeshareStationShowForTest(notInstalled.key), false);
  assert.equal(_getBikeshareStationShowForTest(notRenting.key), false);
  assert.equal(_getBikeshareStationShowForTest(notReturning.key), false);
  assert.equal(_getBikeshareStationShowForTest(open.key), true);
  assert.equal(_getBikeshareStationShowForTest(unknown.key), true,
    'unknown operational flags stay visible');

  assert.equal(bikeshareLayer.setParams({ hideClosed: false }), true);
  assert.equal(_getBikeshareStationShowForTest(notInstalled.key), true);
  assert.equal(_getBikeshareStationShowForTest(notRenting.key), true);
  _resetBikeshareSystemPickerForTest();
});

test('hide closed predicate keeps selected closed stations and unknown flags', () => {
  const closed = { key: 'austin-capmetro:closed', isRenting: false };
  assert.equal(shouldShowBikeshareStation(closed, { hideClosed: false }), true);
  assert.equal(shouldShowBikeshareStation(closed, { hideClosed: true }), false);
  assert.equal(shouldShowBikeshareStation(closed, {
    hideClosed: true,
    selectedKey: 'austin-capmetro:closed',
  }), true);
  assert.equal(shouldShowBikeshareStation({
    isInstalled: false,
  }, { hideClosed: true }), false);
  assert.equal(shouldShowBikeshareStation({
    isReturning: false,
  }, { hideClosed: true }), false);
  assert.equal(shouldShowBikeshareStation({}, { hideClosed: true }), true);
  assert.equal(shouldShowBikeshareStation({
    isInstalled: true,
    isRenting: true,
    isReturning: true,
  }, { hideClosed: true }), true);
  assert.equal(shouldShowBikeshareStation({
    bikesAvailable: 0,
    isRenting: false,
  }, { hideEmpty: true, hideClosed: true }), false);
});

test('selected closed station stays visible until deselected', () => {
  _resetBikeshareSystemPickerForTest();
  const cityId = 'austin-capmetro';
  const key = `${cityId}:3790`;
  const record = makeStationRecord({
    key,
    cityId,
    stationId: '3790',
    bikesAvailable: 4,
    docksAvailable: 6,
  });
  const viewer = { entities: new Cesium.EntityCollection() };
  const overlayHost = {
    setEntries() {},
    setVisible() {},
    clearSource() {},
  };
  _setBikeshareSelectionStateForTest({ viewer, key, record, overlayHost });
  _seedBikeshareStationsForTest([record], { cityId });
  try {
    _selectBikeshareStationForTest(key);
    assert.equal(record.point.show, false);
    assert.equal(viewer.entities.values.length, 1);

    bikeshareLayer.setParams({ hideClosed: true });
    _applyBikeshareStatusForTest(cityId, new Map([
      ['3790', { bikesAvailable: 4, docksAvailable: 6, isInstalled: true, isRenting: false, isReturning: true }],
    ]));
    assert.equal(record.isRenting, false);
    assert.equal(viewer.entities.values.length, 1, 'selected highlight stays after the station closes');
    assert.equal(viewer.entities.values[0].show, true, 'selected closed station stays drawn');
    assert.equal(record.point.show, false);

    _clearBikeshareSelectionForTest();
    assert.equal(record.point.show, false, 'deselected closed station is hidden while the filter is on');
  } finally {
    _clearBikeshareSelectionForTest();
    _resetBikeshareSystemPickerForTest();
  }
});

test('system picker still switches allowlisted systems while hide closed is on', () => {
  const storage = new Map();
  _setBikeshareSystemStorageForTest({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); },
  });
  try {
    bikeshareLayer.setParams({ hideClosed: true });
    assert.equal(bikeshareLayer.setSelectedSystem('chicago-divvy'), true);
    assert.equal(bikeshareLayer.getSelectedSystem(), 'chicago-divvy');
    assert.equal(storage.get(BIKESHARE_SYSTEM_STORAGE_KEY), 'chicago-divvy');
    const controls = bikeshareLayer.getRowControls();
    assert.equal(controls.picker.value, 'chicago-divvy');
    assert.ok(controls.picker.options.every((option) => (
      listBikeshareSystems().some((system) => system.id === option.value)
    )));
    assert.equal(controls.chips[0].id, 'hide-empty');
    assert.equal(controls.chips[1].id, 'hide-full');
    assert.equal(controls.chips[2].id, 'hide-closed');
    assert.equal(controls.chips[2].active, true);
    assert.equal(controls.chips[0].active, false);
    assert.equal(controls.chips[1].active, false);
    assert.equal(bikeshareLayer.setSelectedSystem('not-a-real-system'), false);
    assert.equal(bikeshareLayer.getSelectedSystem(), 'chicago-divvy');
  } finally {
    _resetBikeshareSystemPickerForTest();
  }
});

test('hide closed persists with the bikeshare layer and adds no new endpoint', () => {
  const storage = new Map();
  const store = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); },
  };
  _setBikeshareSystemStorageForTest(store);
  try {
    assert.equal(writePersistedBikeshareHideClosed(true, store), true);
    assert.equal(storage.get(BIKESHARE_HIDE_CLOSED_STORAGE_KEY), '1');
    assert.equal(readPersistedBikeshareHideClosed(store), true);
    bikeshareLayer.setParams({ hideClosed: true });
    assert.equal(storage.get(BIKESHARE_HIDE_CLOSED_STORAGE_KEY), '1');
    assert.equal(bikeshareLayer.getParams().hideClosed, true);
    assert.equal(bikeshareLayer.getParams().hideEmpty, false);
    assert.equal(bikeshareLayer.getParams().hideFull, false);
    assert.match(buildGbfsProxyUrl('https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json'), /^\/api\/gbfs\//);
  } finally {
    _resetBikeshareSystemPickerForTest();
  }
});
