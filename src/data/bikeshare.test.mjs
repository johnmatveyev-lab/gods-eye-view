import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  BIKESHARE_SELECTED_OVERLAY_SOURCE_OPTIONS,
  _clearBikeshareSelectionForTest,
  _resetBikeshareSystemPickerForTest,
  _selectBikeshareStationForTest,
  _setBikeshareSelectionStateForTest,
  _setBikeshareSystemStorageForTest,
  createBikeshareSelectedOverlayEntry,
  listBikeshareSystems,
  loadBikeshareSystemStations,
} from './bikeshare.js';
import bikeshareLayer from './bikeshare.js';
import { BIKESHARE_SYSTEM_STORAGE_KEY, buildGbfsProxyUrl } from './bikeshareSystems.js';

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
