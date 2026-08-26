// PLAN 288 — FIRMS list Hide no confidence toggle. Client-only hide-missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIRMS_LIST_HIDE_NO_CONFIDENCE,
  FIRMS_LIST_HIDE_NO_CONFIDENCE_CHIP_ID,
  FIRMS_LIST_HIDE_NO_CONFIDENCE_CHIP_LABEL,
  FIRMS_LIST_HIDE_NO_CONFIDENCE_STORAGE_KEY,
  filterFiresByListHideNoConfidence,
  fireHasListConfidence,
  fireMeetsListHideNoConfidence,
  firmsListHideNoConfidenceChipModel,
  getFirmsListHideNoConfidence,
  hydrateFirmsListHideNoConfidence,
  normalizeFirmsListHideNoConfidence,
  readFirmsListHideNoConfidence,
  resetFirmsListHideNoConfidenceForTest,
  setFirmsListHideNoConfidence,
  writeFirmsListHideNoConfidence,
} from './firmsListHideNoConfidenceFilter.js';
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
  FIRMS_LIST_CONF_STORAGE_KEY,
  fireMeetsListConf,
} from './firmsListConfFilter.js';
import { setFirmsListSelectedId } from './firmsListFrpFilter.js';
import { fireHasListSatellite } from './firmsListSatFilter.js';
import { fireHasListSensor } from './firmsListHideNoSensorFilter.js';
import { fireHasListVersion } from './firmsListHideNoVersionFilter.js';
import { fireHasListDaynight } from './firmsListHideNoDaynightFilter.js';
import { fireHasListAcq } from './firmsListHideNoAcqFilter.js';
import { fireHasListScan } from './firmsListHideNoScanFilter.js';
import { fireHasListTrack } from './firmsListHideNoTrackFilter.js';
import { fireHasListFrp } from './firmsListHideNoFrpFilter.js';
import {
  FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY,
  fireMeetsListHideNoFrp,
} from './firmsListHideNoFrpFilter.js';
import { FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY } from './firmsHideNoConfidenceFilter.js';
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

resetFirmsListHideNoConfidenceForTest();

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

test('Off keeps missing / null / non-finite confidence', () => {
  resetFirmsListHideNoConfidenceForTest();
  assert.equal(normalizeFirmsListHideNoConfidence(undefined), DEFAULT_FIRMS_LIST_HIDE_NO_CONFIDENCE);
  assert.equal(normalizeFirmsListHideNoConfidence(null), false);
  assert.equal(DEFAULT_FIRMS_LIST_HIDE_NO_CONFIDENCE, false);
  assert.equal(FIRMS_LIST_HIDE_NO_CONFIDENCE_CHIP_LABEL, 'Hide no confidence');
  assert.equal(FIRMS_LIST_HIDE_NO_CONFIDENCE_CHIP_ID, 'hide-no-confidence');

  const mixed = [
    fire({ id: 'rated', confidence: 0.9 }),
    fire({ id: 'zero', confidence: 0 }),
    fire({ id: 'missing', confidence: undefined }),
    fire({ id: 'nulled', confidence: null }),
    fire({ id: 'naned', confidence: Number.NaN }),
    fire({ id: 'inf', confidence: Number.POSITIVE_INFINITY }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoConfidence(mixed, false).map((row) => row.id),
    ['rated', 'zero', 'missing', 'nulled', 'naned', 'inf'],
  );
  assert.equal(fireMeetsListHideNoConfidence({ confidence: 0 }, false), true);
  assert.equal(fireMeetsListHideNoConfidence({ confidence: null }, false), true);
  assert.equal(fireMeetsListHideNoConfidence({ confidence: Number.NaN }, false), true);
  assert.equal(fireMeetsListHideNoConfidence({}, false), true);
  assert.equal(fireMeetsListHideNoConfidence({ confidence: 0.9 }, false), true);

  const listed = listNearestFires(
    mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false, false, false,
  );
  assert.equal(listed.length, 6);
  assert.deepEqual(
    listed.map((row) => row.id).sort(),
    ['inf', 'missing', 'naned', 'nulled', 'rated', 'zero'],
  );
});

test('On hides those, keeps rated confidence including 0', () => {
  resetFirmsListHideNoConfidenceForTest();
  assert.equal(fireHasListConfidence({ confidence: 0.9 }), true);
  assert.equal(fireHasListConfidence({ confidence: 0.53 }), true);
  assert.equal(fireHasListConfidence({ confidence: 0 }), true);
  assert.equal(fireHasListConfidence({ confidence: '0' }), true);
  assert.equal(fireHasListConfidence({ confidence: null }), false);
  assert.equal(fireHasListConfidence({ confidence: Number.NaN }), false);
  assert.equal(fireHasListConfidence({ confidence: Number.POSITIVE_INFINITY }), false);
  assert.equal(fireHasListConfidence({}), false);
  assert.equal(fireHasListConfidence(null), false);

  assert.equal(fireMeetsListHideNoConfidence({ confidence: 0.9 }, true), true);
  assert.equal(fireMeetsListHideNoConfidence({ confidence: 0.53 }, true), true);
  assert.equal(fireMeetsListHideNoConfidence({ confidence: 0 }, true), true);
  assert.equal(fireMeetsListHideNoConfidence({ confidence: null }, true), false);
  assert.equal(fireMeetsListHideNoConfidence({ confidence: Number.NaN }, true), false);
  assert.equal(fireMeetsListHideNoConfidence({ confidence: Number.POSITIVE_INFINITY }, true), false);
  assert.equal(fireMeetsListHideNoConfidence({}, true), false);
  assert.equal(fireMeetsListHideNoConfidence({ confidence: undefined }, true), false);

  const mixed = [
    fire({ id: 'rated', confidence: 0.9 }),
    fire({ id: 'zero', confidence: 0 }),
    fire({ id: 'frp-only', frp: 120, confidence: undefined }),
    fire({ id: 'missing', confidence: undefined }),
    fire({ id: 'nulled', confidence: null }),
    fire({ id: 'naned', confidence: Number.NaN }),
    fire({ id: 'inf', confidence: Number.POSITIVE_INFINITY }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoConfidence(mixed, true).map((row) => row.id),
    ['rated', 'zero'],
  );
  const listed = listNearestFires(
    mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false, false, true,
  );
  assert.deepEqual(listed.map((row) => row.id).sort(), ['rated', 'zero']);
  assert.ok(!listed.some((row) => (
    row.id === 'missing' || row.id === 'nulled' || row.id === 'naned'
    || row.id === 'inf' || row.id === 'frp-only'
  )));
});

test('Selected no-confidence still lists', () => {
  resetFirmsListHideNoConfidenceForTest();
  const unlabeled = fire({ id: 'keep-me', confidence: null, lat: 31 });
  assert.equal(fireMeetsListHideNoConfidence(unlabeled, true, { selectedId: 'keep-me' }), true);
  assert.equal(fireMeetsListHideNoConfidence(unlabeled, true, { selectedId: 'other' }), false);
  assert.deepEqual(
    filterFiresByListHideNoConfidence(
      [unlabeled, fire({ id: 'rated', confidence: 0.9 })],
      true,
      { selectedId: 'keep-me' },
    ).map((row) => row.id),
    ['keep-me', 'rated'],
  );

  const selected = fire({ confidence: null, lat: 40, lon: -74 });
  const selectedId = fireDetectionKey(selected);
  const listed = listNearestFires(
    [selected, fire({ index: 1, confidence: 0.9 })],
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
    false,
    true,
  );
  assert.equal(listed.some((row) => row.id === selectedId), true);
  assert.equal(fireHasListConfidence(listed.find((row) => row.id === selectedId)), false);

  setFirmsListSelectedId(selectedId);
  const fromSession = listNearestFires(
    [selected, fire({ index: 2, confidence: 0.9, acqMs: NOW - MIN20, lat: 30.3 })],
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
    false,
    true,
  );
  assert.equal(fromSession.some((row) => row.id === selectedId), true);
  setFirmsListSelectedId(null);
  resetFirmsListHideNoConfidenceForTest();
});

test('Invalid / corrupt storage reads as off', () => {
  resetFirmsListHideNoConfidenceForTest();
  assert.equal(FIRMS_LIST_HIDE_NO_CONFIDENCE_STORAGE_KEY, 'meridian.firmsListHideNoConfidence');
  assert.equal(readFirmsListHideNoConfidence(memoryStorage()), DEFAULT_FIRMS_LIST_HIDE_NO_CONFIDENCE);
  assert.equal(readFirmsListHideNoConfidence(memoryStorage({ [FIRMS_LIST_HIDE_NO_CONFIDENCE_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readFirmsListHideNoConfidence(memoryStorage({ [FIRMS_LIST_HIDE_NO_CONFIDENCE_STORAGE_KEY]: 'yes' })), false);
  assert.equal(readFirmsListHideNoConfidence(memoryStorage({ [FIRMS_LIST_HIDE_NO_CONFIDENCE_STORAGE_KEY]: 'on' })), false);
  assert.equal(readFirmsListHideNoConfidence(memoryStorage({ [FIRMS_LIST_HIDE_NO_CONFIDENCE_STORAGE_KEY]: '2' })), false);
  assert.equal(normalizeFirmsListHideNoConfidence('nope'), null);
  assert.equal(normalizeFirmsListHideNoConfidence('1'), true);
  assert.equal(normalizeFirmsListHideNoConfidence('0'), false);
});

test('Persist / hydrate, no share-URL write', () => {
  resetFirmsListHideNoConfidenceForTest();
  const storage = memoryStorage();
  assert.equal(readFirmsListHideNoConfidence(storage), DEFAULT_FIRMS_LIST_HIDE_NO_CONFIDENCE);
  assert.equal(setFirmsListHideNoConfidence(true, { storage }), true);
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_CONFIDENCE_STORAGE_KEY), '1');
  assert.equal(getFirmsListHideNoConfidence(), true);
  assert.equal(readFirmsListHideNoConfidence(memoryStorage(storage.snapshot())), true);

  resetFirmsListHideNoConfidenceForTest();
  assert.equal(getFirmsListHideNoConfidence(), DEFAULT_FIRMS_LIST_HIDE_NO_CONFIDENCE);
  assert.equal(hydrateFirmsListHideNoConfidence(storage), true);
  assert.equal(getFirmsListHideNoConfidence(), true);

  setFirmsListHideNoConfidence(false, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_CONFIDENCE_STORAGE_KEY), '0');
  resetFirmsListHideNoConfidenceForTest();
  assert.equal(hydrateFirmsListHideNoConfidence(memoryStorage(storage.snapshot())), false);
  writeFirmsListHideNoConfidence(true, storage);
  resetFirmsListHideNoConfidenceForTest();
  assert.equal(hydrateFirmsListHideNoConfidence(storage), true);
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
  assert.equal(storage.snapshot()[FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY], undefined);
  assert.equal(storage.snapshot()[FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY], undefined);

  resetFirmsListHideNoConfidenceForTest();
  setFirmsListHideNoConfidence(true, { storage });
  resetFirmsListHideNoConfidenceForTest();
  hydrateFirmsListHideNoConfidence(storage);
  const rows = listNearestFires([
    fire({ confidence: null }),
    fire({ index: 1, lat: 31, confidence: 0.9, acqMs: NOW - MIN20 }),
  ], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW);
  assert.equal(getFirmsListHideNoConfidence(), true);
  assert.equal(rows.length, 1);
  assert.ok(fireHasListConfidence(rows[0]));
  resetFirmsListHideNoConfidenceForTest();
});

test('AND with list conf / FRP / age floors and hide-no sat/sensor/version/daynight/acq/scan/track/FRP', () => {
  resetFirmsListHideNoConfidenceForTest();
  const fires = [];
  for (let i = 0; i < 80; i += 1) {
    const unlabeled = i < 50;
    const laterLow = i >= 50 && i < 65;
    fires.push(fire({
      index: i,
      lat: 30.27 + i * 0.2,
      lon: -97.74,
      // First 50 lack confidence (and labels/FRP) so a post-cap filter would starve rated rows.
      satellite: unlabeled ? '' : 'N20',
      sensor: unlabeled ? '' : 'VIIRS',
      version: unlabeled ? '' : 'C6.1',
      daynight: unlabeled ? '' : (i % 2 === 0 ? 'D' : 'N'),
      acqMs: unlabeled ? 0 : (laterLow ? NOW - 12 * H : NOW - MIN20),
      scanKm: unlabeled ? 0 : 1.0,
      trackKm: unlabeled ? 0 : 1.0,
      frp: unlabeled ? 0 : (laterLow ? 1 : 100),
      confidence: unlabeled ? null : (laterLow ? 0.3 : 0.9),
    }));
  }
  const off = listNearestFires(
    fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false, false, false,
  );
  assert.equal(off.length, 50);
  assert.ok(off.every((row) => !fireHasListConfidence(row)));

  const on = listNearestFires(
    fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false, false, true,
  );
  assert.equal(on.length, 30);
  assert.ok(on.every((row) => fireHasListConfidence(row)));
  assert.equal(on[0].lat, 30.27 + 50 * 0.2);

  const andAll = listNearestFires(
    fires, ORIGIN, FIRMS_LIST_LIMIT, 'high', '10', null, '6', NOW,
    true, true, true, true, true, true, true, true, true,
  );
  assert.equal(andAll.length, 15);
  assert.ok(andAll.every((row) => (
    fireHasListConfidence(row)
    && fireHasListFrp(row)
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
    frp: 120,
    confidence: null,
  });
  const rated = fire({ id: 'rated', index: 1, lat: 31 });
  const priorOnConfOff = listNearestFires(
    [priorOnly, rated], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    true, true, true, true, true, true, true, true, false,
  );
  assert.deepEqual(priorOnConfOff.map((row) => row.id).sort(), ['prior', 'rated']);
  const allOn = listNearestFires(
    [priorOnly, rated], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    true, true, true, true, true, true, true, true, true,
  );
  assert.deepEqual(allOn.map((row) => row.id), ['rated']);
});

test('Distinct from the list conf floor and from globe meridian.firmsHideNoConfidence', () => {
  resetFirmsListHideNoConfidenceForTest();
  assert.notEqual(FIRMS_LIST_HIDE_NO_CONFIDENCE_STORAGE_KEY, FIRMS_LIST_CONF_STORAGE_KEY);
  assert.notEqual(FIRMS_LIST_HIDE_NO_CONFIDENCE_STORAGE_KEY, FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY);
  assert.notEqual(FIRMS_LIST_HIDE_NO_CONFIDENCE_STORAGE_KEY, FIRMS_LIST_HIDE_NO_FRP_STORAGE_KEY);
  assert.equal(FIRMS_LIST_CONF_STORAGE_KEY, 'meridian.firmsListConf');
  assert.equal(FIRMS_HIDE_NO_CONFIDENCE_STORAGE_KEY, 'meridian.firmsHideNoConfidence');

  const noConf = { confidence: undefined, frp: 120 };
  const zero = { confidence: 0, frp: 120 };
  const low = { confidence: 0.3, frp: 120 };
  const high = { confidence: 0.9, frp: 120 };
  const noFrp = { confidence: 0.9, frp: 0 };

  assert.equal(fireMeetsListConf(noConf, 'high'), true, 'list conf floor fail-opens missing confidence');
  assert.equal(fireMeetsListHideNoConfidence(noConf, true), false, 'list Hide no confidence fail-closes missing');
  assert.equal(fireMeetsListConf(zero, 'high'), false, 'list conf High drops 0');
  assert.equal(fireMeetsListHideNoConfidence(zero, true), true, 'Hide no confidence keeps 0 as a real rating');
  assert.equal(fireMeetsListConf(low, 'high'), false, 'list conf High drops 0.3');
  assert.equal(fireMeetsListHideNoConfidence(low, true), true, 'Hide no confidence keeps a real 0.3');
  assert.equal(fireMeetsListHideNoConfidence(high, true), true);
  assert.equal(fireMeetsListHideNoFrp(noConf, true), true, '282 hide-no-FRP keeps a real MW');
  assert.equal(fireMeetsListHideNoFrp(noFrp, true), false);
  assert.equal(fireMeetsListHideNoConfidence(noFrp, true), true, 'Hide no confidence keeps rated conf even without FRP');

  const confOnly = fire({ id: 'conf-only', frp: 0, confidence: 0.9 });
  const frpOnly = fire({ id: 'frp-only', index: 1, lat: 31, frp: 120, confidence: null });
  const both = fire({ id: 'both', index: 2, lat: 32, frp: 120, confidence: 0.9 });
  const frpOnConfOff = listNearestFires(
    [confOnly, frpOnly, both], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false, true, false,
  );
  assert.deepEqual(frpOnConfOff.map((row) => row.id).sort(), ['both', 'frp-only']);
  const frpOffConfOn = listNearestFires(
    [confOnly, frpOnly, both], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false, false, true,
  );
  assert.deepEqual(frpOffConfOn.map((row) => row.id).sort(), ['both', 'conf-only']);

  const floorHigh = listNearestFires(
    [fire({ id: 'missing', confidence: undefined }), fire({ id: 'zero', index: 1, lat: 31, confidence: 0 }), fire({ id: 'high', index: 2, lat: 32, confidence: 0.9 })],
    ORIGIN, FIRMS_LIST_LIMIT, 'high', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false, false, false,
  );
  assert.deepEqual(floorHigh.map((row) => row.id).sort(), ['high', 'missing']);
  const hideNoConf = listNearestFires(
    [fire({ id: 'missing', confidence: undefined }), fire({ id: 'zero', index: 1, lat: 31, confidence: 0 }), fire({ id: 'high', index: 2, lat: 32, confidence: 0.9 })],
    ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW,
    false, false, false, false, false, false, false, false, true,
  );
  assert.deepEqual(hideNoConf.map((row) => row.id).sort(), ['high', 'zero']);
});

test('formatFireListRow still prints satelliteShortName or sensor', () => {
  assert.match(formatFireListRow(fire({ satellite: 'N20', sensor: '' }), ORIGIN, NOW).detail, /N20/);
  assert.match(formatFireListRow(fire({ satellite: '', sensor: 'VIIRS' }), ORIGIN, NOW).detail, /VIIRS/);
  assert.doesNotMatch(formatFireListRow(fire({ satellite: '', sensor: '' }), ORIGIN, NOW).detail, /N20|VIIRS/);
});

test('toggle chip is Hide no confidence and defaults inactive', () => {
  resetFirmsListHideNoConfidenceForTest();
  const off = firmsListHideNoConfidenceChipModel();
  assert.equal(off.label, 'Hide no confidence');
  assert.equal(off.active, false);
  assert.equal(off.group, 'ListHideNoConfidence');
  assert.deepEqual(off.params, { firmsListHideNoConfidence: true });
  const on = firmsListHideNoConfidenceChipModel(true);
  assert.equal(on.active, true);
  assert.deepEqual(on.params, { firmsListHideNoConfidence: false });
  const controls = getRowControls();
  assert.equal(controls.listHideNoConfidence.label, 'Hide no confidence');
  assert.equal(controls.listHideNoConfidence.active, false);
  assert.equal(controls.listHideNoFrp.label, 'Hide no FRP');
  assert.equal(controls.listHideNoTrack.label, 'Hide no track');
  assert.equal(controls.listHideNoScan.label, 'Hide no scan');
  assert.equal(controls.listHideNoAcq.label, 'Hide no acq');
  assert.equal(controls.listHideNoDaynight.label, 'Hide no day/night');
  assert.equal(controls.listHideNoVersion.label, 'Hide no version');
  assert.equal(controls.hideNoSensor.label, 'Hide no sensor');
  assert.equal(controls.hideNoSat.label, 'Hide no satellite');
  setFirmsListHideNoConfidence(true, { persist: false });
  assert.equal(getRowControls().listHideNoConfidence.active, true);
  assert.equal(getRowControls().listHideNoFrp.active, false);
  assert.equal(getRowControls().listHideNoTrack.active, false);
  assert.equal(getRowControls().listHideNoScan.active, false);
  assert.equal(getRowControls().listHideNoAcq.active, false);
  assert.equal(getRowControls().listHideNoDaynight.active, false);
  assert.equal(getRowControls().listHideNoVersion.active, false);
  assert.equal(getRowControls().hideNoSensor.active, false);
  assert.equal(getRowControls().hideNoSat.active, false);
  resetFirmsListHideNoConfidenceForTest();
});

test('resolveFireListView off matches the unfiltered list and keeps the NASA acknowledgement', () => {
  const fires = [
    fire({ confidence: 0.9 }),
    fire({ index: 1, lat: 40, lon: -74, confidence: null }),
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
    listHideNoConfidence: false,
  });
  const implicit = resolveFireListView({ fires, camera: ORIGIN, now: NOW, listHideNoConfidence: false });
  assert.equal(off.status, 'ready');
  assert.equal(off.rows.length, 2);
  assert.equal(implicit.rows.length, 2);
  assert.equal(off.acknowledgement, FIRMS_ACKNOWLEDGEMENT);
  assert.match(FIRMS_ACKNOWLEDGEMENT, /NASA's Fire Information for Resource Management System \(FIRMS\)/);

  const hidden = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    listHideNoConfidence: true,
  });
  assert.equal(hidden.rows.length, 1);
  assert.match(hidden.rows[0].title, /120 MW/);
});

test('LayerStateCoordinator restore keeps the toggle and does not write a share URL', () => {
  resetFirmsListHideNoConfidenceForTest();
  const storage = memoryStorage();
  setFirmsListHideNoConfidence(true, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_CONFIDENCE_STORAGE_KEY), '1');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['local-firms'],
    options: { 'local-firms': { satelliteFilter: 'N20' } },
  }));
  assert.doesNotMatch(encoded.toString(), /firmsListHideNoConfidence|meridian\.firmsListHideNoConfidence|meridian\.firmsHideNoConfidence/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetFirmsListHideNoConfidenceForTest();
  assert.equal(getFirmsListHideNoConfidence(), DEFAULT_FIRMS_LIST_HIDE_NO_CONFIDENCE);
  assert.equal(hydrateFirmsListHideNoConfidence(storage), true);
  assert.equal(getFirmsListHideNoConfidence(), true);
  resetFirmsListHideNoConfidenceForTest();
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
  const listConf = readFileSync(path.join(ROOT, 'src/data/firmsListConfFilter.js'), 'utf8');
  const hideNoFrp = readFileSync(path.join(ROOT, 'src/data/firmsListHideNoFrpFilter.js'), 'utf8');
  const globeHide = readFileSync(path.join(ROOT, 'src/data/firmsHideNoConfidenceFilter.js'), 'utf8');
  const markup = html.match(/<div id="fires-panel"[\s\S]*?<p id="fires-list-ack"[\s\S]*?<\/p>/);
  assert.ok(markup, 'fires-panel markup is missing');
  assert.match(markup[0], /id="fires-area-chips"/);
  assert.match(markup[0], /id="fires-list-conf-chips"/);
  assert.match(markup[0], /id="fires-list-frp-chips"/);
  assert.match(markup[0], /id="fires-list-age-chips"/);
  assert.doesNotMatch(markup[0], /id="fires-list-confidence-presence-chips"|data-firms-list-hide-no-confidence|Hide no confidence/);
  assert.ok(
    markup[0].indexOf('id="fires-area-chips"') < markup[0].indexOf('id="fires-list-conf-chips"'),
    '226 pixel-area chips stay ahead of the list filters',
  );
  assert.ok(
    markup[0].indexOf('id="fires-list-age-chips"') < markup[0].indexOf('id="fires-list-meta"'),
    '225 list age chips stay on the FIRES panel',
  );
  assert.match(markup[0], /NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.doesNotMatch(ui, /firmsListHideNoConfidence|setFirmsListHideNoConfidence|hydrateFirmsListHideNoConfidence|_initFirmsListConfidencePresence|data-firms-list-hide-no-confidence/);
  assert.doesNotMatch(style, /firmsListHideNoConfidence|data-firms-list-hide-no-confidence|Hide no confidence/);
  assert.match(list, /fireMeetsListHideNoConfidence|getFirmsListHideNoConfidence/);
  assert.match(list, /hydrateFirmsListHideNoConfidence|firmsListHideNoConfidenceChipModel/);
  assert.match(list, /getRowControls/);
  assert.match(list, /listHideNoConfidence/);
  assert.match(list, /fireMeetsListHideNoFrp|listHideNoFrp/);
  assert.match(list, /fireMeetsListHideNoTrack|listHideNoTrack/);
  assert.match(list, /fireMeetsListHideNoScan|listHideNoScan/);
  assert.match(list, /fireMeetsListHideNoAcq|listHideNoAcq/);
  assert.match(list, /fireMeetsListHideNoDaynight|listHideNoDaynight/);
  assert.match(list, /fireMeetsListHideNoVersion|listHideNoVersion/);
  assert.match(list, /fireMeetsListHideNoSensor|hideNoSensor/);
  assert.match(list, /fireMeetsListHideNoSat|hideNoSat/);
  assert.doesNotMatch(heatmap, /firmsListHideNoConfidence|listHideNoConfidence|FIRMS_LIST_HIDE_NO_CONFIDENCE/);
  assert.match(heatmap, /getRowControls|firmsTrackChipModels/);
  assert.doesNotMatch(adapt, /firmsListHideNoConfidence|listHideNoConfidence/);
  assert.doesNotMatch(csv, /firmsListHideNoConfidence|listHideNoConfidence/);
  assert.doesNotMatch(layerState, /firmsListHideNoConfidence|listHideNoConfidence/);
  assert.doesNotMatch(listConf, /firmsListHideNoConfidence|listHideNoConfidence|FIRMS_LIST_HIDE_NO_CONFIDENCE/);
  assert.doesNotMatch(hideNoFrp, /firmsListHideNoConfidence|listHideNoConfidence|FIRMS_LIST_HIDE_NO_CONFIDENCE/);
  assert.doesNotMatch(globeHide, /firmsListHideNoConfidence|listHideNoConfidence|FIRMS_LIST_HIDE_NO_CONFIDENCE/);
  assert.match(changelog, /meridian\.firmsListHideNoConfidence/);
  assert.match(changelog, /Hide no confidence/);
  assert.doesNotMatch(list, /firms\.modaps\.eosdis\.nasa\.gov/);
  assert.doesNotMatch(list, /from '\.\/firmsHeatmap\.js'|from '\.\/firmsAdapt\.js'|from '\.\/firmsCsv\.js'|from '\.\/firmsTrackFilter\.js'|from '\.\/firmsHideNoConfidenceFilter\.js'/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/listConfidencePresence.js')), false);
  assert.match(heatmap, /satelliteFilter|firmsSatelliteChipModels/);
});
