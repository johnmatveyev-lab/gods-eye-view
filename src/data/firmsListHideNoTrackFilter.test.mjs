// PLAN 276 — FIRMS list Hide no track toggle. Client-only hide-missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIRMS_LIST_HIDE_NO_TRACK,
  FIRMS_LIST_HIDE_NO_TRACK_CHIP_ID,
  FIRMS_LIST_HIDE_NO_TRACK_CHIP_LABEL,
  FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY,
  filterFiresByListHideNoTrack,
  fireHasListTrack,
  fireListTrackKm,
  fireMeetsListHideNoTrack,
  firmsListHideNoTrackChipModel,
  getFirmsListHideNoTrack,
  hydrateFirmsListHideNoTrack,
  normalizeFirmsListHideNoTrack,
  readFirmsListHideNoTrack,
  resetFirmsListHideNoTrackForTest,
  setFirmsListHideNoTrack,
  writeFirmsListHideNoTrack,
} from './firmsListHideNoTrackFilter.js';
import {
  FIRMS_ACKNOWLEDGEMENT,
  FIRMS_LIST_LIMIT,
  formatFireListRow,
  getRowControls,
  listNearestFires,
  resolveFireListView,
} from './firmsList.js';
import { fireDetectionKey } from './firmsLabels.js';
import { setFirmsListSelectedId } from './firmsListFrpFilter.js';
import { fireHasListSatellite } from './firmsListSatFilter.js';
import { fireHasListSensor } from './firmsListHideNoSensorFilter.js';
import { fireHasListVersion } from './firmsListHideNoVersionFilter.js';
import { fireHasListDaynight } from './firmsListHideNoDaynightFilter.js';
import { fireHasListAcq } from './firmsListHideNoAcqFilter.js';
import { fireHasListScan } from './firmsListHideNoScanFilter.js';
import {
  FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY,
  fireMeetsListHideNoScan,
} from './firmsListHideNoScanFilter.js';
import { fireMeetsTrackCeiling, FIRMS_TRACK_STORAGE_KEY } from './firmsTrackFilter.js';
import {
  LayerStateCoordinator,
  encodeLayerStateParams,
  normalizeLayerState,
} from './layerState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOW = Date.UTC(2026, 6, 17, 4, 0);
const ORIGIN = { lat: 30.27, lon: -97.74 };
const MIN20 = 20 * 60 * 1000;
const H = 3600000;

resetFirmsListHideNoTrackForTest();

function fire(overrides = {}) {
  return {
    index: 0,
    lat: 30.27,
    lon: -97.74,
    frp: 120,
    confidence: 0.9,
    satellite: 'N20',
    sensor: 'VIIRS',
    version: 'C6.1',
    daynight: 'D',
    acqMs: NOW - 2 * H,
    scanKm: 1.0,
    trackKm: 1.0,
    ...overrides,
  };
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    snapshot: () => ({ ...data }),
  };
}

function fileSha(relPath) {
  return createHash('sha256').update(readFileSync(path.join(ROOT, relPath))).digest('hex');
}

const FIRMS_CSV_SHA = fileSha('src/data/firmsCsv.js');
const FIRMS_ADAPT_SHA = fileSha('src/data/firmsAdapt.js');
const FIRMS_HEATMAP_SHA = fileSha('src/data/firmsHeatmap.js');
const FLIGHTS_SHA = fileSha('src/data/flights.js');
const DAMS_LIST_SHA = fileSha('src/data/damsList.js');
const DATACENTER_LIST_SHA = fileSha('src/data/datacenterList.js');
const LAUNCHES_PANEL_SHA = fileSha('src/data/launchesPanel.js');
const MILITARY_SHA = fileSha('src/data/militaryAwareness.js');
const LOCAL_GEOJSON_SHA = fileSha('src/data/localGeojson.js');
const ROCKET_LAUNCHES_SHA = fileSha('src/data/rocketLaunches.js');
const INDEX_SHA = fileSha('index.html');
const UI_SHA = fileSha('src/ui.js');
const STYLE_SHA = fileSha('style.css');

test('Off keeps trackKm 0 / non-finite / missing', () => {
  resetFirmsListHideNoTrackForTest();
  assert.equal(normalizeFirmsListHideNoTrack(undefined), DEFAULT_FIRMS_LIST_HIDE_NO_TRACK);
  assert.equal(normalizeFirmsListHideNoTrack(null), false);
  assert.equal(DEFAULT_FIRMS_LIST_HIDE_NO_TRACK, false);
  assert.equal(FIRMS_LIST_HIDE_NO_TRACK_CHIP_LABEL, 'Hide no track');
  assert.equal(FIRMS_LIST_HIDE_NO_TRACK_CHIP_ID, 'hide-no-track');

  const mixed = [
    fire({ id: 'tracked', trackKm: 1.0 }),
    fire({ id: 'zero', trackKm: 0 }),
    fire({ id: 'missing', trackKm: undefined }),
    fire({ id: 'naned', trackKm: Number.NaN }),
    fire({ id: 'inf', trackKm: Number.POSITIVE_INFINITY }),
    fire({ id: 'neg', trackKm: -1 }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoTrack(mixed, false).map((row) => row.id),
    ['tracked', 'zero', 'missing', 'naned', 'inf', 'neg'],
  );
  assert.equal(fireMeetsListHideNoTrack({ trackKm: 0 }, false), true);
  assert.equal(fireMeetsListHideNoTrack({ trackKm: Number.NaN }, false), true);
  assert.equal(fireMeetsListHideNoTrack({}, false), true);
  assert.equal(fireMeetsListHideNoTrack({ trackKm: 1.0 }, false), true);

  const listed = listNearestFires(
    mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false,
  );
  assert.equal(listed.length, 6);
  assert.deepEqual(
    listed.map((row) => row.id).sort(),
    ['inf', 'missing', 'naned', 'neg', 'tracked', 'zero'],
  );
});

test('On hides those and keeps a real track (1.0 km)', () => {
  resetFirmsListHideNoTrackForTest();
  assert.equal(fireHasListTrack({ trackKm: 1.0 }), true);
  assert.equal(fireHasListTrack({ trackKm: 0.36 }), true);
  assert.equal(fireHasListTrack({ trackKm: 0 }), false);
  assert.equal(fireHasListTrack({ trackKm: Number.NaN }), false);
  assert.equal(fireHasListTrack({ trackKm: Number.POSITIVE_INFINITY }), false);
  assert.equal(fireHasListTrack({ trackKm: -1 }), false);
  assert.equal(fireHasListTrack({}), false);
  assert.equal(fireHasListTrack(null), false);
  assert.equal(fireListTrackKm({ trackKm: 1.0 }), 1.0);
  assert.equal(fireListTrackKm({ trackKm: 0 }), 0);
  assert.equal(fireListTrackKm({ trackKm: Number.NaN }), 0);
  assert.equal(fireListTrackKm({}), 0);

  assert.equal(fireMeetsListHideNoTrack({ trackKm: 1.0 }, true), true);
  assert.equal(fireMeetsListHideNoTrack({ trackKm: 0.36 }, true), true);
  assert.equal(fireMeetsListHideNoTrack({ trackKm: 0 }, true), false);
  assert.equal(fireMeetsListHideNoTrack({ trackKm: Number.NaN }, true), false);
  assert.equal(fireMeetsListHideNoTrack({ trackKm: Number.POSITIVE_INFINITY }, true), false);
  assert.equal(fireMeetsListHideNoTrack({ trackKm: -1 }, true), false);
  assert.equal(fireMeetsListHideNoTrack({}, true), false);
  assert.equal(fireMeetsListHideNoTrack({ trackKm: undefined }, true), false);

  const mixed = [
    fire({ id: 'tracked', trackKm: 1.0 }),
    fire({ id: 'zero', trackKm: 0 }),
    fire({ id: 'scan-only', scanKm: 1.0, trackKm: 0 }),
    fire({ id: 'missing', trackKm: undefined }),
    fire({ id: 'naned', trackKm: Number.NaN }),
    fire({ id: 'inf', trackKm: Number.POSITIVE_INFINITY }),
    fire({ id: 'neg', trackKm: -1 }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoTrack(mixed, true).map((row) => row.id),
    ['tracked'],
  );
  const listed = listNearestFires(
    mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, true,
  );
  assert.deepEqual(listed.map((row) => row.id), ['tracked']);
  assert.ok(!listed.some((row) => (
    row.id === 'zero' || row.id === 'missing' || row.id === 'naned'
    || row.id === 'inf' || row.id === 'neg' || row.id === 'scan-only'
  )));
});

test('Selected id always kept', () => {
  resetFirmsListHideNoTrackForTest();
  const unlabeled = fire({ id: 'keep-me', trackKm: 0, lat: 31 });
  assert.equal(fireMeetsListHideNoTrack(unlabeled, true, { selectedId: 'keep-me' }), true);
  assert.equal(fireMeetsListHideNoTrack(unlabeled, true, { selectedId: 'other' }), false);
  assert.deepEqual(
    filterFiresByListHideNoTrack(
      [unlabeled, fire({ id: 'tracked', trackKm: 1.0 })],
      true,
      { selectedId: 'keep-me' },
    ).map((row) => row.id),
    ['keep-me', 'tracked'],
  );

  const selected = fire({ trackKm: 0, lat: 40, lon: -74 });
  const selectedId = fireDetectionKey(selected);
  const listed = listNearestFires(
    [selected, fire({ index: 1, trackKm: 1.0 })],
    ORIGIN,
    FIRMS_LIST_LIMIT,
    'all',
    'all',
    selectedId,
    'all',
    NOW,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
  );
  assert.equal(listed.some((row) => row.id === selectedId), true);
  assert.equal(fireListTrackKm(listed.find((row) => row.id === selectedId)), 0);

  setFirmsListSelectedId(selectedId);
  const fromSession = listNearestFires(
    [selected, fire({ index: 2, trackKm: 1.0, acqMs: NOW - MIN20, lat: 30.3 })],
    ORIGIN,
    FIRMS_LIST_LIMIT,
    'all',
    'all',
    undefined,
    'all',
    NOW,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
  );
  assert.equal(fromSession.some((row) => row.id === selectedId), true);
  setFirmsListSelectedId(null);
  resetFirmsListHideNoTrackForTest();
});

test('Invalid storage reads as off', () => {
  resetFirmsListHideNoTrackForTest();
  assert.equal(FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY, 'meridian.firmsListHideNoTrack');
  assert.equal(readFirmsListHideNoTrack(memoryStorage()), DEFAULT_FIRMS_LIST_HIDE_NO_TRACK);
  assert.equal(readFirmsListHideNoTrack(memoryStorage({ [FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readFirmsListHideNoTrack(memoryStorage({ [FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY]: 'yes' })), false);
  assert.equal(readFirmsListHideNoTrack(memoryStorage({ [FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY]: 'on' })), false);
  assert.equal(readFirmsListHideNoTrack(memoryStorage({ [FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY]: '2' })), false);
  assert.equal(normalizeFirmsListHideNoTrack('nope'), null);
  assert.equal(normalizeFirmsListHideNoTrack('1'), true);
  assert.equal(normalizeFirmsListHideNoTrack('0'), false);
});

test('Persist flip survives reload', () => {
  resetFirmsListHideNoTrackForTest();
  const storage = memoryStorage();
  assert.equal(readFirmsListHideNoTrack(storage), DEFAULT_FIRMS_LIST_HIDE_NO_TRACK);
  assert.equal(setFirmsListHideNoTrack(true, { storage }), true);
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY), '1');
  assert.equal(getFirmsListHideNoTrack(), true);
  assert.equal(readFirmsListHideNoTrack(memoryStorage(storage.snapshot())), true);

  resetFirmsListHideNoTrackForTest();
  assert.equal(getFirmsListHideNoTrack(), DEFAULT_FIRMS_LIST_HIDE_NO_TRACK);
  assert.equal(hydrateFirmsListHideNoTrack(storage), true);
  assert.equal(getFirmsListHideNoTrack(), true);

  setFirmsListHideNoTrack(false, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY), '0');
  resetFirmsListHideNoTrackForTest();
  assert.equal(hydrateFirmsListHideNoTrack(memoryStorage(storage.snapshot())), false);
  writeFirmsListHideNoTrack(true, storage);
  resetFirmsListHideNoTrackForTest();
  assert.equal(hydrateFirmsListHideNoTrack(storage), true);
  assert.equal(storage.snapshot()['meridian.firmsListConf'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListFrp'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListAge'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoSat'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoSensor'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoVersion'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoDaynight'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoAcq'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoScan'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsTrack'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsHideNoBrightness'], undefined);

  resetFirmsListHideNoTrackForTest();
  setFirmsListHideNoTrack(true, { storage });
  resetFirmsListHideNoTrackForTest();
  hydrateFirmsListHideNoTrack(storage);
  const rows = listNearestFires([
    fire({ trackKm: 0 }),
    fire({ index: 1, lat: 31, trackKm: 1.0, acqMs: NOW - MIN20 }),
  ], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW);
  assert.equal(getFirmsListHideNoTrack(), true);
  assert.equal(rows.length, 1);
  assert.ok(fireHasListTrack(rows[0]));
  resetFirmsListHideNoTrackForTest();
});

test('AND with 210/219/225/230/252/256/260/266/271 list chips before the cap', () => {
  resetFirmsListHideNoTrackForTest();
  const fires = [];
  for (let i = 0; i < 80; i += 1) {
    const unlabeled = i < 50;
    const laterLow = i >= 50 && i < 65;
    fires.push(fire({
      index: i,
      lat: 30.27 + i * 0.2,
      lon: -97.74,
      // First 50 lack track (and labels/scan) so a post-cap filter would starve tracked rows.
      satellite: unlabeled ? '' : 'N20',
      sensor: unlabeled ? '' : 'VIIRS',
      version: unlabeled ? '' : 'C6.1',
      daynight: unlabeled ? '' : (i % 2 === 0 ? 'D' : 'N'),
      acqMs: unlabeled ? 0 : (laterLow ? NOW - 12 * H : NOW - MIN20),
      scanKm: unlabeled ? 0 : 1.0,
      trackKm: unlabeled ? 0 : 1.0,
      frp: laterLow ? 1 : 100,
      confidence: laterLow ? 0.3 : 0.9,
    }));
  }
  const off = listNearestFires(
    fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false,
  );
  assert.equal(off.length, 50);
  assert.ok(off.every((row) => !fireHasListTrack(row)));

  const on = listNearestFires(
    fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, true,
  );
  assert.equal(on.length, 30);
  assert.ok(on.every((row) => fireHasListTrack(row)));
  assert.equal(on[0].lat, 30.27 + 50 * 0.2);

  const andAll = listNearestFires(
    fires, ORIGIN, FIRMS_LIST_LIMIT, 'high', '10', null, '6', NOW,
    true, true, true, true, true, true, true,
  );
  assert.equal(andAll.length, 15);
  assert.ok(andAll.every((row) => (
    fireHasListTrack(row)
    && fireHasListScan(row)
    && fireHasListAcq(row)
    && fireHasListDaynight(row)
    && fireHasListVersion(row)
    && fireHasListSensor(row)
    && fireHasListSatellite(row)
    && row.frp >= 10
    && row.confidence >= 0.75
    && NOW - row.acqMs < 6 * H
  )));

  const priorOnly = fire({
    id: 'prior',
    satellite: 'N20',
    sensor: 'VIIRS',
    version: 'C6.1',
    daynight: 'D',
    acqMs: NOW - 2 * H,
    scanKm: 1.0,
    trackKm: 0,
  });
  const tracked = fire({ id: 'tracked', index: 1, lat: 31 });
  const priorOnTrackOff = listNearestFires(
    [priorOnly, tracked], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    true, true, true, true, true, true, false,
  );
  assert.deepEqual(priorOnTrackOff.map((row) => row.id).sort(), ['prior', 'tracked']);
  const allOn = listNearestFires(
    [priorOnly, tracked], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    true, true, true, true, true, true, true,
  );
  assert.deepEqual(allOn.map((row) => row.id), ['tracked']);
});

test('Distinct from globe track-size ceiling and from 271 hide-no-scan', () => {
  resetFirmsListHideNoTrackForTest();
  assert.notEqual(FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY, FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY);
  assert.notEqual(FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY, FIRMS_TRACK_STORAGE_KEY);
  assert.equal(FIRMS_TRACK_STORAGE_KEY, 'meridian.firmsTrack');

  const noTrack = { trackKm: 0, scanKm: 1.0 };
  const noScan = { trackKm: 1.0, scanKm: 0 };
  const both = { trackKm: 1.0, scanKm: 1.0 };

  assert.equal(fireMeetsTrackCeiling(noTrack, '0.5'), true, 'globe track ceiling fail-opens missing track');
  assert.equal(fireMeetsListHideNoTrack(noTrack, true), false, 'list Hide no track fail-closes missing track');
  assert.equal(fireMeetsListHideNoTrack(both, true), true);
  assert.equal(fireMeetsListHideNoScan(noTrack, true), true, '271 hide-no-scan keeps a real scan');
  assert.equal(fireMeetsListHideNoScan(noScan, true), false);
  assert.equal(fireMeetsListHideNoTrack(noScan, true), true, 'Hide no track keeps a real track even without scan');

  const scanOnly = fire({ id: 'scan-only', scanKm: 1.0, trackKm: 0 });
  const trackOnly = fire({ id: 'track-only', index: 1, lat: 31, scanKm: 0, trackKm: 1.0 });
  const bothSized = fire({ id: 'both', index: 2, lat: 32, scanKm: 1.0, trackKm: 1.0 });
  const scanOnTrackOff = listNearestFires(
    [scanOnly, trackOnly, bothSized], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, true, false,
  );
  assert.deepEqual(scanOnTrackOff.map((row) => row.id).sort(), ['both', 'scan-only']);
  const scanOffTrackOn = listNearestFires(
    [scanOnly, trackOnly, bothSized], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, true,
  );
  assert.deepEqual(scanOffTrackOn.map((row) => row.id).sort(), ['both', 'track-only']);
});

test('formatFireListRow still prints satelliteShortName or sensor', () => {
  assert.match(formatFireListRow(fire({ satellite: 'N20', sensor: '' }), ORIGIN, NOW).detail, /N20/);
  assert.match(formatFireListRow(fire({ satellite: '', sensor: 'VIIRS' }), ORIGIN, NOW).detail, /VIIRS/);
  assert.doesNotMatch(formatFireListRow(fire({ satellite: '', sensor: '' }), ORIGIN, NOW).detail, /N20|VIIRS/);
});

test('toggle chip is Hide no track and defaults inactive', () => {
  resetFirmsListHideNoTrackForTest();
  const off = firmsListHideNoTrackChipModel();
  assert.equal(off.label, 'Hide no track');
  assert.equal(off.active, false);
  assert.equal(off.group, 'ListTrack');
  assert.deepEqual(off.params, { firmsListHideNoTrack: true });
  const on = firmsListHideNoTrackChipModel(true);
  assert.equal(on.active, true);
  assert.deepEqual(on.params, { firmsListHideNoTrack: false });
  const controls = getRowControls();
  assert.equal(controls.listHideNoTrack.label, 'Hide no track');
  assert.equal(controls.listHideNoTrack.active, false);
  assert.equal(controls.listHideNoScan.label, 'Hide no scan');
  assert.equal(controls.listHideNoAcq.label, 'Hide no acq');
  assert.equal(controls.listHideNoDaynight.label, 'Hide no day/night');
  assert.equal(controls.listHideNoVersion.label, 'Hide no version');
  assert.equal(controls.hideNoSensor.label, 'Hide no sensor');
  assert.equal(controls.hideNoSat.label, 'Hide no satellite');
  setFirmsListHideNoTrack(true, { persist: false });
  assert.equal(getRowControls().listHideNoTrack.active, true);
  assert.equal(getRowControls().listHideNoScan.active, false);
  assert.equal(getRowControls().listHideNoAcq.active, false);
  assert.equal(getRowControls().listHideNoDaynight.active, false);
  assert.equal(getRowControls().listHideNoVersion.active, false);
  assert.equal(getRowControls().hideNoSensor.active, false);
  assert.equal(getRowControls().hideNoSat.active, false);
  resetFirmsListHideNoTrackForTest();
});

test('resolveFireListView off matches the unfiltered list and keeps the NASA acknowledgement', () => {
  const fires = [
    fire({ trackKm: 1.0 }),
    fire({ index: 1, lat: 40, lon: -74, trackKm: 0 }),
  ];
  const off = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    listConf: 'all',
    listFrp: 'all',
    listAge: 'all',
    hideNoSat: false,
    hideNoSensor: false,
    listHideNoVersion: false,
    listHideNoDaynight: false,
    listHideNoAcq: false,
    listHideNoScan: false,
    listHideNoTrack: false,
  });
  const implicit = resolveFireListView({ fires, camera: ORIGIN, now: NOW, listHideNoTrack: false });
  assert.equal(off.status, 'ready');
  assert.equal(off.rows.length, 2);
  assert.equal(implicit.rows.length, 2);
  assert.equal(off.acknowledgement, FIRMS_ACKNOWLEDGEMENT);
  assert.match(FIRMS_ACKNOWLEDGEMENT, /NASA's Fire Information for Resource Management System \(FIRMS\)/);

  const hidden = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    listHideNoTrack: true,
  });
  assert.equal(hidden.rows.length, 1);
  assert.match(hidden.rows[0].title, /120 MW/);
});

test('LayerStateCoordinator restore keeps the toggle and does not write a share URL', () => {
  resetFirmsListHideNoTrackForTest();
  const storage = memoryStorage();
  setFirmsListHideNoTrack(true, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY), '1');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['local-firms'],
    options: { 'local-firms': { satelliteFilter: 'N20' } },
  }));
  assert.doesNotMatch(encoded.toString(), /firmsListHideNoTrack|meridian\.firmsListHideNoTrack/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetFirmsListHideNoTrackForTest();
  assert.equal(getFirmsListHideNoTrack(), DEFAULT_FIRMS_LIST_HIDE_NO_TRACK);
  assert.equal(hydrateFirmsListHideNoTrack(storage), true);
  assert.equal(getFirmsListHideNoTrack(), true);
  resetFirmsListHideNoTrackForTest();
});

test('stay-off files and NASA acknowledgement are unchanged', () => {
  assert.equal(fileSha('src/data/firmsCsv.js'), FIRMS_CSV_SHA);
  assert.equal(fileSha('src/data/firmsAdapt.js'), FIRMS_ADAPT_SHA);
  assert.equal(fileSha('src/data/firmsHeatmap.js'), FIRMS_HEATMAP_SHA);
  assert.equal(fileSha('src/data/flights.js'), FLIGHTS_SHA);
  assert.equal(fileSha('src/data/damsList.js'), DAMS_LIST_SHA);
  assert.equal(fileSha('src/data/datacenterList.js'), DATACENTER_LIST_SHA);
  assert.equal(fileSha('src/data/launchesPanel.js'), LAUNCHES_PANEL_SHA);
  assert.equal(fileSha('src/data/militaryAwareness.js'), MILITARY_SHA);
  assert.equal(fileSha('src/data/localGeojson.js'), LOCAL_GEOJSON_SHA);
  assert.equal(fileSha('src/data/rocketLaunches.js'), ROCKET_LAUNCHES_SHA);
  assert.equal(fileSha('index.html'), INDEX_SHA);
  assert.equal(fileSha('src/ui.js'), UI_SHA);
  assert.equal(fileSha('style.css'), STYLE_SHA);

  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const style = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const list = readFileSync(path.join(ROOT, 'src/data/firmsList.js'), 'utf8');
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const adapt = readFileSync(path.join(ROOT, 'src/data/firmsAdapt.js'), 'utf8');
  const csv = readFileSync(path.join(ROOT, 'src/data/firmsCsv.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const trackCeiling = readFileSync(path.join(ROOT, 'src/data/firmsTrackFilter.js'), 'utf8');
  const hideNoScan = readFileSync(path.join(ROOT, 'src/data/firmsListHideNoScanFilter.js'), 'utf8');
  const markup = html.match(/<div id="fires-panel"[\s\S]*?<p id="fires-list-ack"[\s\S]*?<\/p>/);
  assert.ok(markup, 'fires-panel markup is missing');
  assert.match(markup[0], /id="fires-area-chips"/);
  assert.match(markup[0], /id="fires-list-conf-chips"/);
  assert.match(markup[0], /id="fires-list-frp-chips"/);
  assert.match(markup[0], /id="fires-list-age-chips"/);
  assert.doesNotMatch(markup[0], /id="fires-list-track-chips"|data-firms-list-hide-no-track|Hide no track/);
  assert.ok(
    markup[0].indexOf('id="fires-area-chips"') < markup[0].indexOf('id="fires-list-conf-chips"'),
    '226 pixel-area chips stay ahead of the list filters',
  );
  assert.ok(
    markup[0].indexOf('id="fires-list-age-chips"') < markup[0].indexOf('id="fires-list-meta"'),
    '225 list age chips stay on the FIRES panel',
  );
  assert.match(markup[0], /NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.doesNotMatch(ui, /firmsListHideNoTrack|setFirmsListHideNoTrack|hydrateFirmsListHideNoTrack|_initFirmsListTrack|data-firms-list-hide-no-track/);
  assert.doesNotMatch(style, /firmsListHideNoTrack|data-firms-list-hide-no-track|Hide no track/);
  assert.match(list, /fireMeetsListHideNoTrack|getFirmsListHideNoTrack/);
  assert.match(list, /hydrateFirmsListHideNoTrack|firmsListHideNoTrackChipModel/);
  assert.match(list, /getRowControls/);
  assert.match(list, /listHideNoTrack/);
  assert.match(list, /fireMeetsListHideNoScan|listHideNoScan/);
  assert.match(list, /fireMeetsListHideNoAcq|listHideNoAcq/);
  assert.match(list, /fireMeetsListHideNoDaynight|listHideNoDaynight/);
  assert.match(list, /fireMeetsListHideNoVersion|listHideNoVersion/);
  assert.match(list, /fireMeetsListHideNoSensor|hideNoSensor/);
  assert.match(list, /fireMeetsListHideNoSat|hideNoSat/);
  assert.doesNotMatch(heatmap, /firmsListHideNoTrack|listHideNoTrack|FIRMS_LIST_HIDE_NO_TRACK/);
  assert.match(heatmap, /getRowControls|trackCeiling|firmsTrackChipModels/);
  assert.doesNotMatch(adapt, /firmsListHideNoTrack|listHideNoTrack/);
  assert.doesNotMatch(csv, /firmsListHideNoTrack|listHideNoTrack/);
  assert.doesNotMatch(layerState, /firmsListHideNoTrack|listHideNoTrack/);
  assert.doesNotMatch(trackCeiling, /firmsListHideNoTrack|listHideNoTrack|FIRMS_LIST_HIDE_NO_TRACK/);
  assert.doesNotMatch(hideNoScan, /firmsListHideNoTrack|listHideNoTrack|FIRMS_LIST_HIDE_NO_TRACK/);
  assert.match(changelog, /meridian\.firmsListHideNoTrack/);
  assert.match(changelog, /Hide no track/);
  assert.doesNotMatch(list, /firms\.modaps\.eosdis\.nasa\.gov/);
  assert.doesNotMatch(list, /from '\.\/firmsHeatmap\.js'|from '\.\/firmsAdapt\.js'|from '\.\/firmsCsv\.js'|from '\.\/firmsTrackFilter\.js'|from '\.\/firmsHideNoAcqFilter\.js'/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/listTrack.js')), false);
  assert.match(heatmap, /satelliteFilter|firmsSatelliteChipModels/);
});
