// PLAN 282 — FIRMS list Hide no FRP toggle. Client-only hide-missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIRMS_LIST_HIDE_NO_FRP,
  FIRMS_LIST_HIDE_NO_FRP_CHIP_ID,
  FIRMS_LIST_HIDE_NO_FRP_CHIP_LABEL,
  FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY,
  filterFiresByListHideNoFrp,
  fireHasListFrp,
  fireListFrpMw,
  fireMeetsListHideNoFrp,
  firmsListHideNoFrpChipModel,
  getFirmsListHideNoFrp,
  hydrateFirmsListHideNoFrp,
  normalizeFirmsListHideNoFrp,
  readFirmsListHideNoFrp,
  resetFirmsListHideNoFrpForTest,
  setFirmsListHideNoFrp,
  writeFirmsListHideNoFrp,
} from './firmsListHideNoFrpFilter.js';
import {
  FIRMS_ACKNOWLEDGEMENT,
  FIRMS_LIST_LIMIT,
  formatFireListRow,
  getRowControls,
  listNearestFires,
  resolveFireListView,
} from './firmsList.js';
import { fireDetectionKey } from './firmsLabels.js';
import {
  FIRMS_LIST_FRP_STORAGE_KEY,
  fireMeetsListFrp,
  setFirmsListSelectedId,
} from './firmsListFrpFilter.js';
import { fireHasListSatellite } from './firmsListSatFilter.js';
import { fireHasListSensor } from './firmsListHideNoSensorFilter.js';
import { fireHasListVersion } from './firmsListHideNoVersionFilter.js';
import { fireHasListDaynight } from './firmsListHideNoDaynightFilter.js';
import { fireHasListAcq } from './firmsListHideNoAcqFilter.js';
import { fireHasListScan } from './firmsListHideNoScanFilter.js';
import { fireHasListTrack } from './firmsListHideNoTrackFilter.js';
import {
  FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY,
  fireMeetsListHideNoTrack,
} from './firmsListHideNoTrackFilter.js';
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
const GLOBE_HIDE_NO_FRP_STORAGE_KEY = 'meridian.firmsHideNoFrp';

resetFirmsListHideNoFrpForTest();

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

test('Off keeps missing / non-finite / frp <= 0', () => {
  resetFirmsListHideNoFrpForTest();
  assert.equal(normalizeFirmsListHideNoFrp(undefined), DEFAULT_FIRMS_LIST_HIDE_NO_FRP);
  assert.equal(normalizeFirmsListHideNoFrp(null), false);
  assert.equal(DEFAULT_FIRMS_LIST_HIDE_NO_FRP, false);
  assert.equal(FIRMS_LIST_HIDE_NO_FRP_CHIP_LABEL, 'Hide no FRP');
  assert.equal(FIRMS_LIST_HIDE_NO_FRP_CHIP_ID, 'hide-no-frp');

  const mixed = [
    fire({ id: 'powered', frp: 120 }),
    fire({ id: 'zero', frp: 0 }),
    fire({ id: 'missing', frp: undefined }),
    fire({ id: 'naned', frp: Number.NaN }),
    fire({ id: 'inf', frp: Number.POSITIVE_INFINITY }),
    fire({ id: 'neg', frp: -1 }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoFrp(mixed, false).map((row) => row.id),
    ['powered', 'zero', 'missing', 'naned', 'inf', 'neg'],
  );
  assert.equal(fireMeetsListHideNoFrp({ frp: 0 }, false), true);
  assert.equal(fireMeetsListHideNoFrp({ frp: Number.NaN }, false), true);
  assert.equal(fireMeetsListHideNoFrp({}, false), true);
  assert.equal(fireMeetsListHideNoFrp({ frp: 120 }, false), true);

  const listed = listNearestFires(
    mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false, false,
  );
  assert.equal(listed.length, 6);
  assert.deepEqual(
    listed.map((row) => row.id).sort(),
    ['inf', 'missing', 'naned', 'neg', 'powered', 'zero'],
  );
});

test('On hides those and keeps real MW', () => {
  resetFirmsListHideNoFrpForTest();
  assert.equal(fireHasListFrp({ frp: 120 }), true);
  assert.equal(fireHasListFrp({ frp: 0.53 }), true);
  assert.equal(fireHasListFrp({ frp: 0 }), false);
  assert.equal(fireHasListFrp({ frp: Number.NaN }), false);
  assert.equal(fireHasListFrp({ frp: Number.POSITIVE_INFINITY }), false);
  assert.equal(fireHasListFrp({ frp: -1 }), false);
  assert.equal(fireHasListFrp({}), false);
  assert.equal(fireHasListFrp(null), false);
  assert.equal(fireListFrpMw({ frp: 120 }), 120);
  assert.equal(fireListFrpMw({ frp: 0 }), 0);
  assert.equal(fireListFrpMw({ frp: Number.NaN }), 0);
  assert.equal(fireListFrpMw({}), 0);

  assert.equal(fireMeetsListHideNoFrp({ frp: 120 }, true), true);
  assert.equal(fireMeetsListHideNoFrp({ frp: 0.53 }, true), true);
  assert.equal(fireMeetsListHideNoFrp({ frp: 0 }, true), false);
  assert.equal(fireMeetsListHideNoFrp({ frp: Number.NaN }, true), false);
  assert.equal(fireMeetsListHideNoFrp({ frp: Number.POSITIVE_INFINITY }, true), false);
  assert.equal(fireMeetsListHideNoFrp({ frp: -1 }, true), false);
  assert.equal(fireMeetsListHideNoFrp({}, true), false);
  assert.equal(fireMeetsListHideNoFrp({ frp: undefined }, true), false);

  const mixed = [
    fire({ id: 'powered', frp: 120 }),
    fire({ id: 'zero', frp: 0 }),
    fire({ id: 'track-only', trackKm: 1.0, frp: 0 }),
    fire({ id: 'missing', frp: undefined }),
    fire({ id: 'naned', frp: Number.NaN }),
    fire({ id: 'inf', frp: Number.POSITIVE_INFINITY }),
    fire({ id: 'neg', frp: -1 }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoFrp(mixed, true).map((row) => row.id),
    ['powered'],
  );
  const listed = listNearestFires(
    mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false, true,
  );
  assert.deepEqual(listed.map((row) => row.id), ['powered']);
  assert.ok(!listed.some((row) => (
    row.id === 'zero' || row.id === 'missing' || row.id === 'naned'
    || row.id === 'inf' || row.id === 'neg' || row.id === 'track-only'
  )));
});

test('Selected no-FRP still lists', () => {
  resetFirmsListHideNoFrpForTest();
  const unlabeled = fire({ id: 'keep-me', frp: 0, lat: 31 });
  assert.equal(fireMeetsListHideNoFrp(unlabeled, true, { selectedId: 'keep-me' }), true);
  assert.equal(fireMeetsListHideNoFrp(unlabeled, true, { selectedId: 'other' }), false);
  assert.deepEqual(
    filterFiresByListHideNoFrp(
      [unlabeled, fire({ id: 'powered', frp: 120 })],
      true,
      { selectedId: 'keep-me' },
    ).map((row) => row.id),
    ['keep-me', 'powered'],
  );

  const selected = fire({ frp: 0, lat: 40, lon: -74 });
  const selectedId = fireDetectionKey(selected);
  const listed = listNearestFires(
    [selected, fire({ index: 1, frp: 120 })],
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
    false,
    true,
  );
  assert.equal(listed.some((row) => row.id === selectedId), true);
  assert.equal(fireListFrpMw(listed.find((row) => row.id === selectedId)), 0);

  setFirmsListSelectedId(selectedId);
  const fromSession = listNearestFires(
    [selected, fire({ index: 2, frp: 120, acqMs: NOW - MIN20, lat: 30.3 })],
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
    false,
    true,
  );
  assert.equal(fromSession.some((row) => row.id === selectedId), true);
  setFirmsListSelectedId(null);
  resetFirmsListHideNoFrpForTest();
});

test('Invalid / corrupt storage reads as off', () => {
  resetFirmsListHideNoFrpForTest();
  assert.equal(FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY, 'meridian.firmsListHideNoFrp');
  assert.equal(readFirmsListHideNoFrp(memoryStorage()), DEFAULT_FIRMS_LIST_HIDE_NO_FRP);
  assert.equal(readFirmsListHideNoFrp(memoryStorage({ [FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readFirmsListHideNoFrp(memoryStorage({ [FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY]: 'yes' })), false);
  assert.equal(readFirmsListHideNoFrp(memoryStorage({ [FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY]: 'on' })), false);
  assert.equal(readFirmsListHideNoFrp(memoryStorage({ [FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY]: '2' })), false);
  assert.equal(normalizeFirmsListHideNoFrp('nope'), null);
  assert.equal(normalizeFirmsListHideNoFrp('1'), true);
  assert.equal(normalizeFirmsListHideNoFrp('0'), false);
});

test('Persist / hydrate, no share-URL write', () => {
  resetFirmsListHideNoFrpForTest();
  const storage = memoryStorage();
  assert.equal(readFirmsListHideNoFrp(storage), DEFAULT_FIRMS_LIST_HIDE_NO_FRP);
  assert.equal(setFirmsListHideNoFrp(true, { storage }), true);
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY), '1');
  assert.equal(getFirmsListHideNoFrp(), true);
  assert.equal(readFirmsListHideNoFrp(memoryStorage(storage.snapshot())), true);

  resetFirmsListHideNoFrpForTest();
  assert.equal(getFirmsListHideNoFrp(), DEFAULT_FIRMS_LIST_HIDE_NO_FRP);
  assert.equal(hydrateFirmsListHideNoFrp(storage), true);
  assert.equal(getFirmsListHideNoFrp(), true);

  setFirmsListHideNoFrp(false, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY), '0');
  resetFirmsListHideNoFrpForTest();
  assert.equal(hydrateFirmsListHideNoFrp(memoryStorage(storage.snapshot())), false);
  writeFirmsListHideNoFrp(true, storage);
  resetFirmsListHideNoFrpForTest();
  assert.equal(hydrateFirmsListHideNoFrp(storage), true);
  assert.equal(storage.snapshot()['meridian.firmsListConf'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListFrp'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListAge'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoSat'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoSensor'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoVersion'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoDaynight'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoAcq'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoScan'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoTrack'], undefined);
  assert.equal(storage.snapshot()[GLOBE_HIDE_NO_FRP_STORAGE_KEY], undefined);

  resetFirmsListHideNoFrpForTest();
  setFirmsListHideNoFrp(true, { storage });
  resetFirmsListHideNoFrpForTest();
  hydrateFirmsListHideNoFrp(storage);
  const rows = listNearestFires([
    fire({ frp: 0 }),
    fire({ index: 1, lat: 31, frp: 120, acqMs: NOW - MIN20 }),
  ], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW);
  assert.equal(getFirmsListHideNoFrp(), true);
  assert.equal(rows.length, 1);
  assert.ok(fireHasListFrp(rows[0]));
  resetFirmsListHideNoFrpForTest();
});

test('AND with conf/FRP-floor/age + hide-no chips including 276 hide-no-track', () => {
  resetFirmsListHideNoFrpForTest();
  const fires = [];
  for (let i = 0; i < 80; i += 1) {
    const unlabeled = i < 50;
    const laterLow = i >= 50 && i < 65;
    fires.push(fire({
      index: i,
      lat: 30.27 + i * 0.2,
      lon: -97.74,
      // First 50 lack FRP (and labels/track) so a post-cap filter would starve powered rows.
      satellite: unlabeled ? '' : 'N20',
      sensor: unlabeled ? '' : 'VIIRS',
      version: unlabeled ? '' : 'C6.1',
      daynight: unlabeled ? '' : (i % 2 === 0 ? 'D' : 'N'),
      acqMs: unlabeled ? 0 : (laterLow ? NOW - 12 * H : NOW - MIN20),
      scanKm: unlabeled ? 0 : 1.0,
      trackKm: unlabeled ? 0 : 1.0,
      frp: unlabeled ? 0 : (laterLow ? 1 : 100),
      confidence: laterLow ? 0.3 : 0.9,
    }));
  }
  const off = listNearestFires(
    fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false, false,
  );
  assert.equal(off.length, 50);
  assert.ok(off.every((row) => !fireHasListFrp(row)));

  const on = listNearestFires(
    fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false, true,
  );
  assert.equal(on.length, 30);
  assert.ok(on.every((row) => fireHasListFrp(row)));
  assert.equal(on[0].lat, 30.27 + 50 * 0.2);

  const andAll = listNearestFires(
    fires, ORIGIN, FIRMS_LIST_LIMIT, 'high', '10', null, '6', NOW,
    true, true, true, true, true, true, true, true,
  );
  assert.equal(andAll.length, 15);
  assert.ok(andAll.every((row) => (
    fireHasListFrp(row)
    && fireHasListTrack(row)
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
    trackKm: 1.0,
    frp: 0,
  });
  const powered = fire({ id: 'powered', index: 1, lat: 31 });
  const priorOnFrpOff = listNearestFires(
    [priorOnly, powered], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    true, true, true, true, true, true, true, false,
  );
  assert.deepEqual(priorOnFrpOff.map((row) => row.id).sort(), ['powered', 'prior']);
  const allOn = listNearestFires(
    [priorOnly, powered], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    true, true, true, true, true, true, true, true,
  );
  assert.deepEqual(allOn.map((row) => row.id), ['powered']);
});

test('Distinct from the list FRP floor and from globe 281 meridian.firmsHideNoFrp', () => {
  resetFirmsListHideNoFrpForTest();
  assert.notEqual(FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY, FIRMS_LIST_FRP_STORAGE_KEY);
  assert.notEqual(FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY, GLOBE_HIDE_NO_FRP_STORAGE_KEY);
  assert.notEqual(FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY, FIRMS_LIST_HIDE_NO_TRACK_STORAGE_KEY);
  assert.equal(FIRMS_LIST_FRP_STORAGE_KEY, 'meridian.firmsListFrp');
  assert.equal(GLOBE_HIDE_NO_FRP_STORAGE_KEY, 'meridian.firmsHideNoFrp');

  const noFrp = { frp: undefined, trackKm: 1.0 };
  const lowFrp = { frp: 5, trackKm: 1.0 };
  const highFrp = { frp: 120, trackKm: 1.0 };
  const noTrack = { frp: 120, trackKm: 0 };

  assert.equal(fireMeetsListFrp(noFrp, '10'), true, 'list FRP floor fail-opens missing FRP');
  assert.equal(fireMeetsListHideNoFrp(noFrp, true), false, 'list Hide no FRP fail-closes missing FRP');
  assert.equal(fireMeetsListFrp(lowFrp, '10'), false, 'list FRP floor drops 5 MW at 10+');
  assert.equal(fireMeetsListHideNoFrp(lowFrp, true), true, 'Hide no FRP keeps a real 5 MW');
  assert.equal(fireMeetsListHideNoFrp(highFrp, true), true);
  assert.equal(fireMeetsListHideNoTrack(noFrp, true), true, '276 hide-no-track keeps a real track');
  assert.equal(fireMeetsListHideNoTrack(noTrack, true), false);
  assert.equal(fireMeetsListHideNoFrp(noTrack, true), true, 'Hide no FRP keeps real MW even without track');

  const frpOnly = fire({ id: 'frp-only', trackKm: 0, frp: 120 });
  const trackOnly = fire({ id: 'track-only', index: 1, lat: 31, trackKm: 1.0, frp: 0 });
  const both = fire({ id: 'both', index: 2, lat: 32, trackKm: 1.0, frp: 120 });
  const trackOnFrpOff = listNearestFires(
    [frpOnly, trackOnly, both], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, true, false,
  );
  assert.deepEqual(trackOnFrpOff.map((row) => row.id).sort(), ['both', 'track-only']);
  const trackOffFrpOn = listNearestFires(
    [frpOnly, trackOnly, both], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false, true,
  );
  assert.deepEqual(trackOffFrpOn.map((row) => row.id).sort(), ['both', 'frp-only']);

  const floor10 = listNearestFires(
    [fire({ id: 'missing', frp: undefined }), fire({ id: 'five', index: 1, lat: 31, frp: 5 }), fire({ id: 'hundred', index: 2, lat: 32, frp: 120 })],
    ORIGIN, FIRMS_LIST_LIMIT, 'all', '10', null, 'all', NOW,
    false, false, false, false, false, false, false, false,
  );
  assert.deepEqual(floor10.map((row) => row.id).sort(), ['hundred', 'missing']);
  const hideNoFrp = listNearestFires(
    [fire({ id: 'missing', frp: undefined }), fire({ id: 'five', index: 1, lat: 31, frp: 5 }), fire({ id: 'hundred', index: 2, lat: 32, frp: 120 })],
    ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false, true,
  );
  assert.deepEqual(hideNoFrp.map((row) => row.id).sort(), ['five', 'hundred']);
});

test('formatFireListRow still prints satelliteShortName or sensor', () => {
  assert.match(formatFireListRow(fire({ satellite: 'N20', sensor: '' }), ORIGIN, NOW).detail, /N20/);
  assert.match(formatFireListRow(fire({ satellite: '', sensor: 'VIIRS' }), ORIGIN, NOW).detail, /VIIRS/);
  assert.doesNotMatch(formatFireListRow(fire({ satellite: '', sensor: '' }), ORIGIN, NOW).detail, /N20|VIIRS/);
});

test('toggle chip is Hide no FRP and defaults inactive', () => {
  resetFirmsListHideNoFrpForTest();
  const off = firmsListHideNoFrpChipModel();
  assert.equal(off.label, 'Hide no FRP');
  assert.equal(off.active, false);
  assert.equal(off.group, 'ListHideNoFrp');
  assert.deepEqual(off.params, { firmsListHideNoFrp: true });
  const on = firmsListHideNoFrpChipModel(true);
  assert.equal(on.active, true);
  assert.deepEqual(on.params, { firmsListHideNoFrp: false });
  const controls = getRowControls();
  assert.equal(controls.listHideNoFrp.label, 'Hide no FRP');
  assert.equal(controls.listHideNoFrp.active, false);
  assert.equal(controls.listHideNoTrack.label, 'Hide no track');
  assert.equal(controls.listHideNoScan.label, 'Hide no scan');
  assert.equal(controls.listHideNoAcq.label, 'Hide no acq');
  assert.equal(controls.listHideNoDaynight.label, 'Hide no day/night');
  assert.equal(controls.listHideNoVersion.label, 'Hide no version');
  assert.equal(controls.hideNoSensor.label, 'Hide no sensor');
  assert.equal(controls.hideNoSat.label, 'Hide no satellite');
  setFirmsListHideNoFrp(true, { persist: false });
  assert.equal(getRowControls().listHideNoFrp.active, true);
  assert.equal(getRowControls().listHideNoTrack.active, false);
  assert.equal(getRowControls().listHideNoScan.active, false);
  assert.equal(getRowControls().listHideNoAcq.active, false);
  assert.equal(getRowControls().listHideNoDaynight.active, false);
  assert.equal(getRowControls().listHideNoVersion.active, false);
  assert.equal(getRowControls().hideNoSensor.active, false);
  assert.equal(getRowControls().hideNoSat.active, false);
  resetFirmsListHideNoFrpForTest();
});

test('resolveFireListView off matches the unfiltered list and keeps the NASA acknowledgement', () => {
  const fires = [
    fire({ frp: 120 }),
    fire({ index: 1, lat: 40, lon: -74, frp: 0 }),
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
    listHideNoFrp: false,
  });
  const implicit = resolveFireListView({ fires, camera: ORIGIN, now: NOW, listHideNoFrp: false });
  assert.equal(off.status, 'ready');
  assert.equal(off.rows.length, 2);
  assert.equal(implicit.rows.length, 2);
  assert.equal(off.acknowledgement, FIRMS_ACKNOWLEDGEMENT);
  assert.match(FIRMS_ACKNOWLEDGEMENT, /NASA's Fire Information for Resource Management System \(FIRMS\)/);

  const hidden = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    listHideNoFrp: true,
  });
  assert.equal(hidden.rows.length, 1);
  assert.match(hidden.rows[0].title, /120 MW/);
});

test('LayerStateCoordinator restore keeps the toggle and does not write a share URL', () => {
  resetFirmsListHideNoFrpForTest();
  const storage = memoryStorage();
  setFirmsListHideNoFrp(true, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY), '1');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['local-firms'],
    options: { 'local-firms': { satelliteFilter: 'N20' } },
  }));
  assert.doesNotMatch(encoded.toString(), /firmsListHideNoFrp|meridian\.firmsListHideNoFrp|meridian\.firmsHideNoFrp/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetFirmsListHideNoFrpForTest();
  assert.equal(getFirmsListHideNoFrp(), DEFAULT_FIRMS_LIST_HIDE_NO_FRP);
  assert.equal(hydrateFirmsListHideNoFrp(storage), true);
  assert.equal(getFirmsListHideNoFrp(), true);
  resetFirmsListHideNoFrpForTest();
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
  const listFrp = readFileSync(path.join(ROOT, 'src/data/firmsListFrpFilter.js'), 'utf8');
  const hideNoTrack = readFileSync(path.join(ROOT, 'src/data/firmsListHideNoTrackFilter.js'), 'utf8');
  const markup = html.match(/<div id="fires-panel"[\s\S]*?<p id="fires-list-ack"[\s\S]*?<\/p>/);
  assert.ok(markup, 'fires-panel markup is missing');
  assert.match(markup[0], /id="fires-area-chips"/);
  assert.match(markup[0], /id="fires-list-conf-chips"/);
  assert.match(markup[0], /id="fires-list-frp-chips"/);
  assert.match(markup[0], /id="fires-list-age-chips"/);
  assert.doesNotMatch(markup[0], /id="fires-list-frp-presence-chips"|data-firms-list-hide-no-frp|Hide no FRP/);
  assert.ok(
    markup[0].indexOf('id="fires-area-chips"') < markup[0].indexOf('id="fires-list-conf-chips"'),
    '226 pixel-area chips stay ahead of the list filters',
  );
  assert.ok(
    markup[0].indexOf('id="fires-list-age-chips"') < markup[0].indexOf('id="fires-list-meta"'),
    '225 list age chips stay on the FIRES panel',
  );
  assert.match(markup[0], /NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.doesNotMatch(ui, /firmsListHideNoFrp|setFirmsListHideNoFrp|hydrateFirmsListHideNoFrp|_initFirmsListFrpPresence|data-firms-list-hide-no-frp/);
  assert.doesNotMatch(style, /firmsListHideNoFrp|data-firms-list-hide-no-frp|Hide no FRP/);
  assert.match(list, /fireMeetsListHideNoFrp|getFirmsListHideNoFrp/);
  assert.match(list, /hydrateFirmsListHideNoFrp|firmsListHideNoFrpChipModel/);
  assert.match(list, /getRowControls/);
  assert.match(list, /listHideNoFrp/);
  assert.match(list, /fireMeetsListHideNoTrack|listHideNoTrack/);
  assert.match(list, /fireMeetsListHideNoScan|listHideNoScan/);
  assert.match(list, /fireMeetsListHideNoAcq|listHideNoAcq/);
  assert.match(list, /fireMeetsListHideNoDaynight|listHideNoDaynight/);
  assert.match(list, /fireMeetsListHideNoVersion|listHideNoVersion/);
  assert.match(list, /fireMeetsListHideNoSensor|hideNoSensor/);
  assert.match(list, /fireMeetsListHideNoSat|hideNoSat/);
  assert.doesNotMatch(heatmap, /firmsListHideNoFrp|listHideNoFrp|FIRMS_LIST_HIDE_NO_FRP/);
  assert.match(heatmap, /getRowControls|firmsTrackChipModels/);
  assert.doesNotMatch(adapt, /firmsListHideNoFrp|listHideNoFrp/);
  assert.doesNotMatch(csv, /firmsListHideNoFrp|listHideNoFrp/);
  assert.doesNotMatch(layerState, /firmsListHideNoFrp|listHideNoFrp/);
  assert.doesNotMatch(listFrp, /firmsListHideNoFrp|listHideNoFrp|FIRMS_LIST_HIDE_NO_FRP/);
  assert.doesNotMatch(hideNoTrack, /firmsListHideNoFrp|listHideNoFrp|FIRMS_LIST_HIDE_NO_FRP/);
  assert.match(changelog, /meridian\.firmsListHideNoFrp/);
  assert.match(changelog, /Hide no FRP/);
  assert.doesNotMatch(list, /firms\.modaps\.eosdis\.nasa\.gov/);
  assert.doesNotMatch(list, /from '\.\/firmsHeatmap\.js'|from '\.\/firmsAdapt\.js'|from '\.\/firmsCsv\.js'|from '\.\/firmsTrackFilter\.js'|from '\.\/firmsHideNoAcqFilter\.js'/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/listFrpPresence.js')), false);
  assert.match(heatmap, /satelliteFilter|firmsSatelliteChipModels/);
});
