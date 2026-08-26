// PLAN 271 — FIRMS list Hide no scan toggle. Client-only hide-missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIRMS_LIST_HIDE_NO_SCAN,
  FIRMS_LIST_HIDE_NO_SCAN_CHIP_ID,
  FIRMS_LIST_HIDE_NO_SCAN_CHIP_LABEL,
  FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY,
  filterFiresByListHideNoScan,
  fireHasListScan,
  fireListScanKm,
  fireMeetsListHideNoScan,
  firmsListHideNoScanChipModel,
  getFirmsListHideNoScan,
  hydrateFirmsListHideNoScan,
  normalizeFirmsListHideNoScan,
  readFirmsListHideNoScan,
  resetFirmsListHideNoScanForTest,
  setFirmsListHideNoScan,
  writeFirmsListHideNoScan,
} from './firmsListHideNoScanFilter.js';
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

resetFirmsListHideNoScanForTest();

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

test('Off keeps scanKm 0 / non-finite / missing', () => {
  resetFirmsListHideNoScanForTest();
  assert.equal(normalizeFirmsListHideNoScan(undefined), DEFAULT_FIRMS_LIST_HIDE_NO_SCAN);
  assert.equal(normalizeFirmsListHideNoScan(null), false);
  assert.equal(DEFAULT_FIRMS_LIST_HIDE_NO_SCAN, false);
  assert.equal(FIRMS_LIST_HIDE_NO_SCAN_CHIP_LABEL, 'Hide no scan');
  assert.equal(FIRMS_LIST_HIDE_NO_SCAN_CHIP_ID, 'hide-no-scan');

  const mixed = [
    fire({ id: 'scanned', scanKm: 1.0 }),
    fire({ id: 'zero', scanKm: 0 }),
    fire({ id: 'missing', scanKm: undefined }),
    fire({ id: 'naned', scanKm: Number.NaN }),
    fire({ id: 'inf', scanKm: Number.POSITIVE_INFINITY }),
    fire({ id: 'neg', scanKm: -1 }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoScan(mixed, false).map((row) => row.id),
    ['scanned', 'zero', 'missing', 'naned', 'inf', 'neg'],
  );
  assert.equal(fireMeetsListHideNoScan({ scanKm: 0 }, false), true);
  assert.equal(fireMeetsListHideNoScan({ scanKm: Number.NaN }, false), true);
  assert.equal(fireMeetsListHideNoScan({}, false), true);
  assert.equal(fireMeetsListHideNoScan({ scanKm: 1.0 }, false), true);

  const listed = listNearestFires(
    mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, false, false, false, false,
  );
  assert.equal(listed.length, 6);
  assert.deepEqual(
    listed.map((row) => row.id).sort(),
    ['inf', 'missing', 'naned', 'neg', 'scanned', 'zero'],
  );
});

test('On hides those and keeps a real scan (1.0 km)', () => {
  resetFirmsListHideNoScanForTest();
  assert.equal(fireHasListScan({ scanKm: 1.0 }), true);
  assert.equal(fireHasListScan({ scanKm: 0.375 }), true);
  assert.equal(fireHasListScan({ scanKm: 0 }), false);
  assert.equal(fireHasListScan({ scanKm: Number.NaN }), false);
  assert.equal(fireHasListScan({ scanKm: Number.POSITIVE_INFINITY }), false);
  assert.equal(fireHasListScan({ scanKm: -1 }), false);
  assert.equal(fireHasListScan({}), false);
  assert.equal(fireHasListScan(null), false);
  assert.equal(fireListScanKm({ scanKm: 1.0 }), 1.0);
  assert.equal(fireListScanKm({ scanKm: 0 }), 0);
  assert.equal(fireListScanKm({ scanKm: Number.NaN }), 0);
  assert.equal(fireListScanKm({}), 0);

  assert.equal(fireMeetsListHideNoScan({ scanKm: 1.0 }, true), true);
  assert.equal(fireMeetsListHideNoScan({ scanKm: 0.375 }, true), true);
  assert.equal(fireMeetsListHideNoScan({ scanKm: 0 }, true), false);
  assert.equal(fireMeetsListHideNoScan({ scanKm: Number.NaN }, true), false);
  assert.equal(fireMeetsListHideNoScan({ scanKm: Number.POSITIVE_INFINITY }, true), false);
  assert.equal(fireMeetsListHideNoScan({ scanKm: -1 }, true), false);
  assert.equal(fireMeetsListHideNoScan({}, true), false);
  assert.equal(fireMeetsListHideNoScan({ scanKm: undefined }, true), false);

  const mixed = [
    fire({ id: 'scanned', scanKm: 1.0 }),
    fire({ id: 'zero', scanKm: 0 }),
    fire({ id: 'sat-only', satellite: 'N20', scanKm: 0 }),
    fire({ id: 'missing', scanKm: undefined }),
    fire({ id: 'naned', scanKm: Number.NaN }),
    fire({ id: 'inf', scanKm: Number.POSITIVE_INFINITY }),
    fire({ id: 'neg', scanKm: -1 }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoScan(mixed, true).map((row) => row.id),
    ['scanned'],
  );
  const listed = listNearestFires(
    mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, false, false, false, true,
  );
  assert.deepEqual(listed.map((row) => row.id), ['scanned']);
  assert.ok(!listed.some((row) => (
    row.id === 'zero' || row.id === 'missing' || row.id === 'naned'
    || row.id === 'inf' || row.id === 'neg' || row.id === 'sat-only'
  )));
});

test('Selected id always kept', () => {
  resetFirmsListHideNoScanForTest();
  const unlabeled = fire({ id: 'keep-me', scanKm: 0, lat: 31 });
  assert.equal(fireMeetsListHideNoScan(unlabeled, true, { selectedId: 'keep-me' }), true);
  assert.equal(fireMeetsListHideNoScan(unlabeled, true, { selectedId: 'other' }), false);
  assert.deepEqual(
    filterFiresByListHideNoScan(
      [unlabeled, fire({ id: 'scanned', scanKm: 1.0 })],
      true,
      { selectedId: 'keep-me' },
    ).map((row) => row.id),
    ['keep-me', 'scanned'],
  );

  const selected = fire({ scanKm: 0, lat: 40, lon: -74 });
  const selectedId = fireDetectionKey(selected);
  const listed = listNearestFires(
    [selected, fire({ index: 1, scanKm: 1.0 })],
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
    true,
  );
  assert.equal(listed.some((row) => row.id === selectedId), true);
  assert.equal(fireListScanKm(listed.find((row) => row.id === selectedId)), 0);

  setFirmsListSelectedId(selectedId);
  const fromSession = listNearestFires(
    [selected, fire({ index: 2, scanKm: 1.0, acqMs: NOW - MIN20, lat: 30.3 })],
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
    true,
  );
  assert.equal(fromSession.some((row) => row.id === selectedId), true);
  setFirmsListSelectedId(null);
  resetFirmsListHideNoScanForTest();
});

test('Invalid storage reads as off', () => {
  resetFirmsListHideNoScanForTest();
  assert.equal(FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY, 'meridian.firmsListHideNoScan');
  assert.equal(readFirmsListHideNoScan(memoryStorage()), DEFAULT_FIRMS_LIST_HIDE_NO_SCAN);
  assert.equal(readFirmsListHideNoScan(memoryStorage({ [FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readFirmsListHideNoScan(memoryStorage({ [FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY]: 'yes' })), false);
  assert.equal(readFirmsListHideNoScan(memoryStorage({ [FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY]: 'on' })), false);
  assert.equal(readFirmsListHideNoScan(memoryStorage({ [FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY]: '2' })), false);
  assert.equal(normalizeFirmsListHideNoScan('nope'), null);
  assert.equal(normalizeFirmsListHideNoScan('1'), true);
  assert.equal(normalizeFirmsListHideNoScan('0'), false);
});

test('Persist flip survives reload', () => {
  resetFirmsListHideNoScanForTest();
  const storage = memoryStorage();
  assert.equal(readFirmsListHideNoScan(storage), DEFAULT_FIRMS_LIST_HIDE_NO_SCAN);
  assert.equal(setFirmsListHideNoScan(true, { storage }), true);
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY), '1');
  assert.equal(getFirmsListHideNoScan(), true);
  assert.equal(readFirmsListHideNoScan(memoryStorage(storage.snapshot())), true);

  resetFirmsListHideNoScanForTest();
  assert.equal(getFirmsListHideNoScan(), DEFAULT_FIRMS_LIST_HIDE_NO_SCAN);
  assert.equal(hydrateFirmsListHideNoScan(storage), true);
  assert.equal(getFirmsListHideNoScan(), true);

  setFirmsListHideNoScan(false, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY), '0');
  resetFirmsListHideNoScanForTest();
  assert.equal(hydrateFirmsListHideNoScan(memoryStorage(storage.snapshot())), false);
  writeFirmsListHideNoScan(true, storage);
  resetFirmsListHideNoScanForTest();
  assert.equal(hydrateFirmsListHideNoScan(storage), true);
  assert.equal(storage.snapshot()['meridian.firmsListConf'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListFrp'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListAge'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoSat'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoSensor'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoVersion'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoDaynight'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoAcq'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsScan'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsHideNoBrightness'], undefined);

  resetFirmsListHideNoScanForTest();
  setFirmsListHideNoScan(true, { storage });
  resetFirmsListHideNoScanForTest();
  hydrateFirmsListHideNoScan(storage);
  const rows = listNearestFires([
    fire({ scanKm: 0 }),
    fire({ index: 1, lat: 31, scanKm: 1.0, acqMs: NOW - MIN20 }),
  ], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW);
  assert.equal(getFirmsListHideNoScan(), true);
  assert.equal(rows.length, 1);
  assert.ok(fireHasListScan(rows[0]));
  resetFirmsListHideNoScanForTest();
});

test('AND with 210/219/225/230/252/256/260/266 list chips before the cap', () => {
  resetFirmsListHideNoScanForTest();
  const fires = [];
  for (let i = 0; i < 80; i += 1) {
    const unlabeled = i < 50;
    const laterLow = i >= 50 && i < 65;
    fires.push(fire({
      index: i,
      lat: 30.27 + i * 0.2,
      lon: -97.74,
      // First 50 lack scan (and labels) so a post-cap filter would starve scanned rows.
      satellite: unlabeled ? '' : 'N20',
      sensor: unlabeled ? '' : 'VIIRS',
      version: unlabeled ? '' : 'C6.1',
      daynight: unlabeled ? '' : (i % 2 === 0 ? 'D' : 'N'),
      acqMs: unlabeled ? 0 : (laterLow ? NOW - 12 * H : NOW - MIN20),
      scanKm: unlabeled ? 0 : 1.0,
      frp: laterLow ? 1 : 100,
      confidence: laterLow ? 0.3 : 0.9,
    }));
  }
  const off = listNearestFires(
    fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, false, false, false, false,
  );
  assert.equal(off.length, 50);
  assert.ok(off.every((row) => !fireHasListScan(row)));

  const on = listNearestFires(
    fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, false, false, false, true,
  );
  assert.equal(on.length, 30);
  assert.ok(on.every((row) => fireHasListScan(row)));
  assert.equal(on[0].lat, 30.27 + 50 * 0.2);

  const andAll = listNearestFires(
    fires, ORIGIN, FIRMS_LIST_LIMIT, 'high', '10', null, '6', NOW, true, true, true, true, true, true,
  );
  assert.equal(andAll.length, 15);
  assert.ok(andAll.every((row) => (
    fireHasListScan(row)
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
    scanKm: 0,
  });
  const scanned = fire({ id: 'scanned', index: 1, lat: 31 });
  const priorOnScanOff = listNearestFires(
    [priorOnly, scanned], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, true, true, true, true, true, false,
  );
  assert.deepEqual(priorOnScanOff.map((row) => row.id).sort(), ['prior', 'scanned']);
  const allOn = listNearestFires(
    [priorOnly, scanned], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, true, true, true, true, true, true,
  );
  assert.deepEqual(allOn.map((row) => row.id), ['scanned']);
});

test('formatFireListRow still prints satelliteShortName or sensor', () => {
  assert.match(formatFireListRow(fire({ satellite: 'N20', sensor: '' }), ORIGIN, NOW).detail, /N20/);
  assert.match(formatFireListRow(fire({ satellite: '', sensor: 'VIIRS' }), ORIGIN, NOW).detail, /VIIRS/);
  assert.doesNotMatch(formatFireListRow(fire({ satellite: '', sensor: '' }), ORIGIN, NOW).detail, /N20|VIIRS/);
});

test('toggle chip is Hide no scan and defaults inactive', () => {
  resetFirmsListHideNoScanForTest();
  const off = firmsListHideNoScanChipModel();
  assert.equal(off.label, 'Hide no scan');
  assert.equal(off.active, false);
  assert.equal(off.group, 'ListScan');
  assert.deepEqual(off.params, { firmsListHideNoScan: true });
  const on = firmsListHideNoScanChipModel(true);
  assert.equal(on.active, true);
  assert.deepEqual(on.params, { firmsListHideNoScan: false });
  const controls = getRowControls();
  assert.equal(controls.listHideNoScan.label, 'Hide no scan');
  assert.equal(controls.listHideNoScan.active, false);
  assert.equal(controls.listHideNoAcq.label, 'Hide no acq');
  assert.equal(controls.listHideNoDaynight.label, 'Hide no day/night');
  assert.equal(controls.listHideNoVersion.label, 'Hide no version');
  assert.equal(controls.hideNoSensor.label, 'Hide no sensor');
  assert.equal(controls.hideNoSat.label, 'Hide no satellite');
  setFirmsListHideNoScan(true, { persist: false });
  assert.equal(getRowControls().listHideNoScan.active, true);
  assert.equal(getRowControls().listHideNoAcq.active, false);
  assert.equal(getRowControls().listHideNoDaynight.active, false);
  assert.equal(getRowControls().listHideNoVersion.active, false);
  assert.equal(getRowControls().hideNoSensor.active, false);
  assert.equal(getRowControls().hideNoSat.active, false);
  resetFirmsListHideNoScanForTest();
});

test('resolveFireListView off matches the unfiltered list and keeps the NASA acknowledgement', () => {
  const fires = [
    fire({ scanKm: 1.0 }),
    fire({ index: 1, lat: 40, lon: -74, scanKm: 0 }),
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
  });
  const implicit = resolveFireListView({ fires, camera: ORIGIN, now: NOW, listHideNoScan: false });
  assert.equal(off.status, 'ready');
  assert.equal(off.rows.length, 2);
  assert.equal(implicit.rows.length, 2);
  assert.equal(off.acknowledgement, FIRMS_ACKNOWLEDGEMENT);
  assert.match(FIRMS_ACKNOWLEDGEMENT, /NASA's Fire Information for Resource Management System \(FIRMS\)/);

  const hidden = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    listHideNoScan: true,
  });
  assert.equal(hidden.rows.length, 1);
  assert.match(hidden.rows[0].title, /120 MW/);
});

test('LayerStateCoordinator restore keeps the toggle and does not write a share URL', () => {
  resetFirmsListHideNoScanForTest();
  const storage = memoryStorage();
  setFirmsListHideNoScan(true, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_SCAN_STORAGE_KEY), '1');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['local-firms'],
    options: { 'local-firms': { satelliteFilter: 'N20' } },
  }));
  assert.doesNotMatch(encoded.toString(), /firmsListHideNoScan|meridian\.firmsListHideNoScan/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetFirmsListHideNoScanForTest();
  assert.equal(getFirmsListHideNoScan(), DEFAULT_FIRMS_LIST_HIDE_NO_SCAN);
  assert.equal(hydrateFirmsListHideNoScan(storage), true);
  assert.equal(getFirmsListHideNoScan(), true);
  resetFirmsListHideNoScanForTest();
});

test('firmsCsv.js, firmsAdapt.js, firmsHeatmap.js are unchanged', () => {
  assert.equal(fileSha('src/data/firmsCsv.js'), FIRMS_CSV_SHA);
  assert.equal(fileSha('src/data/firmsAdapt.js'), FIRMS_ADAPT_SHA);
  assert.equal(fileSha('src/data/firmsHeatmap.js'), FIRMS_HEATMAP_SHA);

  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const list = readFileSync(path.join(ROOT, 'src/data/firmsList.js'), 'utf8');
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const adapt = readFileSync(path.join(ROOT, 'src/data/firmsAdapt.js'), 'utf8');
  const csv = readFileSync(path.join(ROOT, 'src/data/firmsCsv.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const markup = html.match(/<div id="fires-panel"[\s\S]*?<p id="fires-list-ack"[\s\S]*?<\/p>/);
  assert.ok(markup, 'fires-panel markup is missing');
  assert.match(markup[0], /id="fires-area-chips"/);
  assert.match(markup[0], /id="fires-list-conf-chips"/);
  assert.match(markup[0], /id="fires-list-frp-chips"/);
  assert.match(markup[0], /id="fires-list-age-chips"/);
  assert.doesNotMatch(markup[0], /id="fires-list-scan-chips"|data-firms-list-hide-no-scan|Hide no scan/);
  assert.ok(
    markup[0].indexOf('id="fires-area-chips"') < markup[0].indexOf('id="fires-list-conf-chips"'),
    '226 pixel-area chips stay ahead of the list filters',
  );
  assert.ok(
    markup[0].indexOf('id="fires-list-age-chips"') < markup[0].indexOf('id="fires-list-meta"'),
    '225 list age chips stay on the FIRES panel',
  );
  assert.match(markup[0], /NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.doesNotMatch(ui, /firmsListHideNoScan|setFirmsListHideNoScan|hydrateFirmsListHideNoScan|_initFirmsListScan|data-firms-list-hide-no-scan/);
  assert.match(list, /fireMeetsListHideNoScan|getFirmsListHideNoScan/);
  assert.match(list, /hydrateFirmsListHideNoScan|firmsListHideNoScanChipModel/);
  assert.match(list, /getRowControls/);
  assert.match(list, /listHideNoScan/);
  assert.match(list, /fireMeetsListHideNoAcq|listHideNoAcq/);
  assert.match(list, /fireMeetsListHideNoDaynight|listHideNoDaynight/);
  assert.match(list, /fireMeetsListHideNoVersion|listHideNoVersion/);
  assert.match(list, /fireMeetsListHideNoSensor|hideNoSensor/);
  assert.match(list, /fireMeetsListHideNoSat|hideNoSat/);
  assert.doesNotMatch(heatmap, /firmsListHideNoScan|listHideNoScan|FIRMS_LIST_HIDE_NO_SCAN/);
  assert.match(heatmap, /getRowControls|scanCeiling|firmsScanChipModels/);
  assert.doesNotMatch(adapt, /firmsListHideNoScan|listHideNoScan/);
  assert.doesNotMatch(csv, /firmsListHideNoScan|listHideNoScan/);
  assert.doesNotMatch(layerState, /firmsListHideNoScan|listHideNoScan/);
  assert.match(changelog, /meridian\.firmsListHideNoScan/);
  assert.match(changelog, /Hide no scan/);
  assert.doesNotMatch(list, /firms\.modaps\.eosdis\.nasa\.gov/);
  assert.doesNotMatch(list, /from '\.\/firmsHeatmap\.js'|from '\.\/firmsAdapt\.js'|from '\.\/firmsCsv\.js'|from '\.\/firmsScanFilter\.js'|from '\.\/firmsHideNoAcqFilter\.js'/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/listScan.js')), false);
  assert.match(heatmap, /satelliteFilter|firmsSatelliteChipModels/);
});
