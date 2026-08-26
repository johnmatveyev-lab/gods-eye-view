// PLAN 266 — FIRMS list Hide no acq toggle. Client-only hide-missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIRMS_LIST_HIDE_NO_ACQ,
  FIRMS_LIST_HIDE_NO_ACQ_CHIP_ID,
  FIRMS_LIST_HIDE_NO_ACQ_CHIP_LABEL,
  FIRMS_LIST_HIDE_NO_ACQ_STORAGE_KEY,
  filterFiresByListHideNoAcq,
  fireHasListAcq,
  fireListAcqMs,
  fireMeetsListHideNoAcq,
  firmsListHideNoAcqChipModel,
  getFirmsListHideNoAcq,
  hydrateFirmsListHideNoAcq,
  normalizeFirmsListHideNoAcq,
  readFirmsListHideNoAcq,
  resetFirmsListHideNoAcqForTest,
  setFirmsListHideNoAcq,
  writeFirmsListHideNoAcq,
} from './firmsListHideNoAcqFilter.js';
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

resetFirmsListHideNoAcqForTest();

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

test('Off keeps acqMs 0 / non-finite / missing', () => {
  resetFirmsListHideNoAcqForTest();
  assert.equal(normalizeFirmsListHideNoAcq(undefined), DEFAULT_FIRMS_LIST_HIDE_NO_ACQ);
  assert.equal(normalizeFirmsListHideNoAcq(null), false);
  assert.equal(DEFAULT_FIRMS_LIST_HIDE_NO_ACQ, false);
  assert.equal(FIRMS_LIST_HIDE_NO_ACQ_CHIP_LABEL, 'Hide no acq');
  assert.equal(FIRMS_LIST_HIDE_NO_ACQ_CHIP_ID, 'hide-no-acq');

  const mixed = [
    fire({ id: 'dated', acqMs: NOW - 2 * H }),
    fire({ id: 'zero', acqMs: 0 }),
    fire({ id: 'missing', acqMs: undefined }),
    fire({ id: 'naned', acqMs: Number.NaN }),
    fire({ id: 'inf', acqMs: Number.POSITIVE_INFINITY }),
    fire({ id: 'neg', acqMs: -1 }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoAcq(mixed, false).map((row) => row.id),
    ['dated', 'zero', 'missing', 'naned', 'inf', 'neg'],
  );
  assert.equal(fireMeetsListHideNoAcq({ acqMs: 0 }, false), true);
  assert.equal(fireMeetsListHideNoAcq({ acqMs: Number.NaN }, false), true);
  assert.equal(fireMeetsListHideNoAcq({}, false), true);
  assert.equal(fireMeetsListHideNoAcq({ acqMs: NOW }, false), true);

  const listed = listNearestFires(
    mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, false, false, false,
  );
  assert.equal(listed.length, 6);
  assert.deepEqual(
    listed.map((row) => row.id).sort(),
    ['dated', 'inf', 'missing', 'naned', 'neg', 'zero'],
  );
});

test('On hides those and keeps a real epoch', () => {
  resetFirmsListHideNoAcqForTest();
  assert.equal(fireHasListAcq({ acqMs: NOW }), true);
  assert.equal(fireHasListAcq({ acqMs: 1 }), true);
  assert.equal(fireHasListAcq({ acqMs: 0 }), false);
  assert.equal(fireHasListAcq({ acqMs: Number.NaN }), false);
  assert.equal(fireHasListAcq({ acqMs: Number.POSITIVE_INFINITY }), false);
  assert.equal(fireHasListAcq({ acqMs: -1 }), false);
  assert.equal(fireHasListAcq({}), false);
  assert.equal(fireHasListAcq(null), false);
  assert.equal(fireListAcqMs({ acqMs: NOW }), NOW);
  assert.equal(fireListAcqMs({ acqMs: 0 }), 0);
  assert.equal(fireListAcqMs({ acqMs: Number.NaN }), 0);
  assert.equal(fireListAcqMs({}), 0);

  assert.equal(fireMeetsListHideNoAcq({ acqMs: NOW }, true), true);
  assert.equal(fireMeetsListHideNoAcq({ acqMs: 1 }, true), true);
  assert.equal(fireMeetsListHideNoAcq({ acqMs: 0 }, true), false);
  assert.equal(fireMeetsListHideNoAcq({ acqMs: Number.NaN }, true), false);
  assert.equal(fireMeetsListHideNoAcq({ acqMs: Number.POSITIVE_INFINITY }, true), false);
  assert.equal(fireMeetsListHideNoAcq({ acqMs: -1 }, true), false);
  assert.equal(fireMeetsListHideNoAcq({}, true), false);
  assert.equal(fireMeetsListHideNoAcq({ acqMs: undefined }, true), false);

  const mixed = [
    fire({ id: 'dated', acqMs: NOW - 2 * H }),
    fire({ id: 'zero', acqMs: 0 }),
    fire({ id: 'sat-only', satellite: 'N20', acqMs: 0 }),
    fire({ id: 'missing', acqMs: undefined }),
    fire({ id: 'naned', acqMs: Number.NaN }),
    fire({ id: 'inf', acqMs: Number.POSITIVE_INFINITY }),
    fire({ id: 'neg', acqMs: -1 }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoAcq(mixed, true).map((row) => row.id),
    ['dated'],
  );
  const listed = listNearestFires(
    mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, false, false, true,
  );
  assert.deepEqual(listed.map((row) => row.id), ['dated']);
  assert.ok(!listed.some((row) => (
    row.id === 'zero' || row.id === 'missing' || row.id === 'naned'
    || row.id === 'inf' || row.id === 'neg' || row.id === 'sat-only'
  )));
});

test('Selected id always kept', () => {
  resetFirmsListHideNoAcqForTest();
  const unlabeled = fire({ id: 'keep-me', acqMs: 0, lat: 31 });
  assert.equal(fireMeetsListHideNoAcq(unlabeled, true, { selectedId: 'keep-me' }), true);
  assert.equal(fireMeetsListHideNoAcq(unlabeled, true, { selectedId: 'other' }), false);
  assert.deepEqual(
    filterFiresByListHideNoAcq(
      [unlabeled, fire({ id: 'dated', acqMs: NOW - 2 * H })],
      true,
      { selectedId: 'keep-me' },
    ).map((row) => row.id),
    ['keep-me', 'dated'],
  );

  const selected = fire({ acqMs: 0, lat: 40, lon: -74 });
  const selectedId = fireDetectionKey(selected);
  const listed = listNearestFires(
    [selected, fire({ index: 1, acqMs: NOW - 2 * H })],
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
    true,
  );
  assert.equal(listed.some((row) => row.id === selectedId), true);
  assert.equal(fireListAcqMs(listed.find((row) => row.id === selectedId)), 0);

  setFirmsListSelectedId(selectedId);
  const fromSession = listNearestFires(
    [selected, fire({ index: 2, acqMs: NOW - MIN20, lat: 30.3 })],
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
    true,
  );
  assert.equal(fromSession.some((row) => row.id === selectedId), true);
  setFirmsListSelectedId(null);
  resetFirmsListHideNoAcqForTest();
});

test('Invalid storage reads as off', () => {
  resetFirmsListHideNoAcqForTest();
  assert.equal(FIRMS_LIST_HIDE_NO_ACQ_STORAGE_KEY, 'meridian.firmsListHideNoAcq');
  assert.equal(readFirmsListHideNoAcq(memoryStorage()), DEFAULT_FIRMS_LIST_HIDE_NO_ACQ);
  assert.equal(readFirmsListHideNoAcq(memoryStorage({ [FIRMS_LIST_HIDE_NO_ACQ_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readFirmsListHideNoAcq(memoryStorage({ [FIRMS_LIST_HIDE_NO_ACQ_STORAGE_KEY]: 'yes' })), false);
  assert.equal(readFirmsListHideNoAcq(memoryStorage({ [FIRMS_LIST_HIDE_NO_ACQ_STORAGE_KEY]: 'on' })), false);
  assert.equal(readFirmsListHideNoAcq(memoryStorage({ [FIRMS_LIST_HIDE_NO_ACQ_STORAGE_KEY]: '2' })), false);
  assert.equal(normalizeFirmsListHideNoAcq('nope'), null);
  assert.equal(normalizeFirmsListHideNoAcq('1'), true);
  assert.equal(normalizeFirmsListHideNoAcq('0'), false);
});

test('Persist flip survives reload', () => {
  resetFirmsListHideNoAcqForTest();
  const storage = memoryStorage();
  assert.equal(readFirmsListHideNoAcq(storage), DEFAULT_FIRMS_LIST_HIDE_NO_ACQ);
  assert.equal(setFirmsListHideNoAcq(true, { storage }), true);
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_ACQ_STORAGE_KEY), '1');
  assert.equal(getFirmsListHideNoAcq(), true);
  assert.equal(readFirmsListHideNoAcq(memoryStorage(storage.snapshot())), true);

  resetFirmsListHideNoAcqForTest();
  assert.equal(getFirmsListHideNoAcq(), DEFAULT_FIRMS_LIST_HIDE_NO_ACQ);
  assert.equal(hydrateFirmsListHideNoAcq(storage), true);
  assert.equal(getFirmsListHideNoAcq(), true);

  setFirmsListHideNoAcq(false, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_ACQ_STORAGE_KEY), '0');
  resetFirmsListHideNoAcqForTest();
  assert.equal(hydrateFirmsListHideNoAcq(memoryStorage(storage.snapshot())), false);
  writeFirmsListHideNoAcq(true, storage);
  resetFirmsListHideNoAcqForTest();
  assert.equal(hydrateFirmsListHideNoAcq(storage), true);
  assert.equal(storage.snapshot()['meridian.firmsListConf'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListFrp'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListAge'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoSat'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoSensor'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoVersion'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoDaynight'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsHideNoAcq'], undefined);

  resetFirmsListHideNoAcqForTest();
  setFirmsListHideNoAcq(true, { storage });
  resetFirmsListHideNoAcqForTest();
  hydrateFirmsListHideNoAcq(storage);
  const rows = listNearestFires([
    fire({ acqMs: 0 }),
    fire({ index: 1, lat: 31, acqMs: NOW - MIN20 }),
  ], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW);
  assert.equal(getFirmsListHideNoAcq(), true);
  assert.equal(rows.length, 1);
  assert.ok(fireHasListAcq(rows[0]));
  resetFirmsListHideNoAcqForTest();
});

test('AND with 210/219/225/230/252/256/260 list chips before the cap', () => {
  resetFirmsListHideNoAcqForTest();
  const fires = [];
  for (let i = 0; i < 80; i += 1) {
    const unlabeled = i < 50;
    const laterLow = i >= 50 && i < 65;
    fires.push(fire({
      index: i,
      lat: 30.27 + i * 0.2,
      lon: -97.74,
      // First 50 lack acq (and labels) so a post-cap filter would starve dated rows.
      satellite: unlabeled ? '' : 'N20',
      sensor: unlabeled ? '' : 'VIIRS',
      version: unlabeled ? '' : 'C6.1',
      daynight: unlabeled ? '' : (i % 2 === 0 ? 'D' : 'N'),
      acqMs: unlabeled ? 0 : (laterLow ? NOW - 12 * H : NOW - MIN20),
      frp: laterLow ? 1 : 100,
      confidence: laterLow ? 0.3 : 0.9,
    }));
  }
  const off = listNearestFires(
    fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, false, false, false,
  );
  assert.equal(off.length, 50);
  assert.ok(off.every((row) => !fireHasListAcq(row)));

  const on = listNearestFires(
    fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, false, false, true,
  );
  assert.equal(on.length, 30);
  assert.ok(on.every((row) => fireHasListAcq(row)));
  assert.equal(on[0].lat, 30.27 + 50 * 0.2);

  const andAll = listNearestFires(
    fires, ORIGIN, FIRMS_LIST_LIMIT, 'high', '10', null, '6', NOW, true, true, true, true, true,
  );
  assert.equal(andAll.length, 15);
  assert.ok(andAll.every((row) => (
    fireHasListAcq(row)
    && fireHasListDaynight(row)
    && fireHasListVersion(row)
    && fireHasListSensor(row)
    && fireHasListSatellite(row)
    && row.frp >= 10
    && row.confidence >= 0.75
    && NOW - row.acqMs < 6 * H
  )));

  const priorOnly = fire({
    id: 'prior', satellite: 'N20', sensor: 'VIIRS', version: 'C6.1', daynight: 'D', acqMs: 0,
  });
  const dated = fire({ id: 'dated', index: 1, lat: 31 });
  const priorOnAcqOff = listNearestFires(
    [priorOnly, dated], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, true, true, true, true, false,
  );
  assert.deepEqual(priorOnAcqOff.map((row) => row.id).sort(), ['dated', 'prior']);
  const allOn = listNearestFires(
    [priorOnly, dated], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, true, true, true, true, true,
  );
  assert.deepEqual(allOn.map((row) => row.id), ['dated']);
});

test('formatFireListRow still prints satelliteShortName or sensor', () => {
  assert.match(formatFireListRow(fire({ satellite: 'N20', sensor: '' }), ORIGIN, NOW).detail, /N20/);
  assert.match(formatFireListRow(fire({ satellite: '', sensor: 'VIIRS' }), ORIGIN, NOW).detail, /VIIRS/);
  assert.doesNotMatch(formatFireListRow(fire({ satellite: '', sensor: '' }), ORIGIN, NOW).detail, /N20|VIIRS/);
});

test('toggle chip is Hide no acq and defaults inactive', () => {
  resetFirmsListHideNoAcqForTest();
  const off = firmsListHideNoAcqChipModel();
  assert.equal(off.label, 'Hide no acq');
  assert.equal(off.active, false);
  assert.equal(off.group, 'ListAcq');
  assert.deepEqual(off.params, { firmsListHideNoAcq: true });
  const on = firmsListHideNoAcqChipModel(true);
  assert.equal(on.active, true);
  assert.deepEqual(on.params, { firmsListHideNoAcq: false });
  const controls = getRowControls();
  assert.equal(controls.listHideNoAcq.label, 'Hide no acq');
  assert.equal(controls.listHideNoAcq.active, false);
  assert.equal(controls.listHideNoDaynight.label, 'Hide no day/night');
  assert.equal(controls.listHideNoVersion.label, 'Hide no version');
  assert.equal(controls.hideNoSensor.label, 'Hide no sensor');
  assert.equal(controls.hideNoSat.label, 'Hide no satellite');
  setFirmsListHideNoAcq(true, { persist: false });
  assert.equal(getRowControls().listHideNoAcq.active, true);
  assert.equal(getRowControls().listHideNoDaynight.active, false);
  assert.equal(getRowControls().listHideNoVersion.active, false);
  assert.equal(getRowControls().hideNoSensor.active, false);
  assert.equal(getRowControls().hideNoSat.active, false);
  resetFirmsListHideNoAcqForTest();
});

test('resolveFireListView off matches the unfiltered list and keeps the NASA acknowledgement', () => {
  const fires = [
    fire({ acqMs: NOW - 2 * H }),
    fire({ index: 1, lat: 40, lon: -74, acqMs: 0 }),
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
  });
  const implicit = resolveFireListView({ fires, camera: ORIGIN, now: NOW, listHideNoAcq: false });
  assert.equal(off.status, 'ready');
  assert.equal(off.rows.length, 2);
  assert.equal(implicit.rows.length, 2);
  assert.equal(off.acknowledgement, FIRMS_ACKNOWLEDGEMENT);
  assert.match(FIRMS_ACKNOWLEDGEMENT, /NASA's Fire Information for Resource Management System \(FIRMS\)/);

  const hidden = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    listHideNoAcq: true,
  });
  assert.equal(hidden.rows.length, 1);
  assert.match(hidden.rows[0].title, /120 MW/);
});

test('LayerStateCoordinator restore keeps the toggle and does not write a share URL', () => {
  resetFirmsListHideNoAcqForTest();
  const storage = memoryStorage();
  setFirmsListHideNoAcq(true, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_ACQ_STORAGE_KEY), '1');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['local-firms'],
    options: { 'local-firms': { satelliteFilter: 'N20' } },
  }));
  assert.doesNotMatch(encoded.toString(), /firmsListHideNoAcq|meridian\.firmsListHideNoAcq/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetFirmsListHideNoAcqForTest();
  assert.equal(getFirmsListHideNoAcq(), DEFAULT_FIRMS_LIST_HIDE_NO_ACQ);
  assert.equal(hydrateFirmsListHideNoAcq(storage), true);
  assert.equal(getFirmsListHideNoAcq(), true);
  resetFirmsListHideNoAcqForTest();
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
  assert.doesNotMatch(markup[0], /id="fires-list-acq-chips"|data-firms-list-hide-no-acq|Hide no acq/);
  assert.ok(
    markup[0].indexOf('id="fires-area-chips"') < markup[0].indexOf('id="fires-list-conf-chips"'),
    '226 pixel-area chips stay ahead of the list filters',
  );
  assert.ok(
    markup[0].indexOf('id="fires-list-age-chips"') < markup[0].indexOf('id="fires-list-meta"'),
    '225 list age chips stay on the FIRES panel',
  );
  assert.match(markup[0], /NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.doesNotMatch(ui, /firmsListHideNoAcq|setFirmsListHideNoAcq|hydrateFirmsListHideNoAcq|_initFirmsListAcq|data-firms-list-hide-no-acq/);
  assert.match(list, /fireMeetsListHideNoAcq|getFirmsListHideNoAcq/);
  assert.match(list, /hydrateFirmsListHideNoAcq|firmsListHideNoAcqChipModel/);
  assert.match(list, /getRowControls/);
  assert.match(list, /listHideNoAcq/);
  assert.match(list, /fireMeetsListHideNoDaynight|listHideNoDaynight/);
  assert.match(list, /fireMeetsListHideNoVersion|listHideNoVersion/);
  assert.match(list, /fireMeetsListHideNoSensor|hideNoSensor/);
  assert.match(list, /fireMeetsListHideNoSat|hideNoSat/);
  assert.doesNotMatch(heatmap, /firmsListHideNoAcq|listHideNoAcq|FIRMS_LIST_HIDE_NO_ACQ/);
  assert.match(heatmap, /getRowControls|firmsHideNoAcqChipModel/);
  assert.doesNotMatch(adapt, /firmsListHideNoAcq|listHideNoAcq/);
  assert.doesNotMatch(csv, /firmsListHideNoAcq|listHideNoAcq/);
  assert.doesNotMatch(layerState, /firmsListHideNoAcq|listHideNoAcq/);
  assert.match(changelog, /meridian\.firmsListHideNoAcq/);
  assert.match(changelog, /Hide no acq/);
  assert.doesNotMatch(list, /firms\.modaps\.eosdis\.nasa\.gov/);
  assert.doesNotMatch(list, /from '\.\/firmsHeatmap\.js'|from '\.\/firmsAdapt\.js'|from '\.\/firmsCsv\.js'|from '\.\/firmsHideNoAcqFilter\.js'/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/listAcq.js')), false);
  assert.match(heatmap, /satelliteFilter|firmsSatelliteChipModels/);
});
