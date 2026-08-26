// PLAN 219 — FIRMS list FRP-floor chips. Client-only exclusive All | 10+ MW | 100+ MW.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIRMS_LIST_FRP,
  FIRMS_LIST_FRP_CHIPS,
  FIRMS_LIST_FRP_STORAGE_KEY,
  filterFiresByListFrp,
  fireMeetsListFrp,
  firmsListFrpChipModels,
  firmsListFrpThresholdMw,
  getFirmsListFrp,
  hydrateFirmsListFrp,
  normalizeFirmsListFrp,
  readFirmsListFrp,
  resetFirmsListFrpForTest,
  setFirmsListFrp,
  setFirmsListSelectedId,
  writeFirmsListFrp,
} from './firmsListFrpFilter.js';
import {
  FIRMS_ACKNOWLEDGEMENT,
  FIRMS_LIST_LIMIT,
  formatFireListRow,
  listNearestFires,
  resolveFireListView,
} from './firmsList.js';
import { fireDetectionKey } from './firmsLabels.js';
import {
  LayerStateCoordinator,
  encodeLayerStateParams,
  normalizeLayerState,
} from './layerState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOW = Date.UTC(2026, 6, 17, 4, 0);
const ORIGIN = { lat: 30.27, lon: -97.74 };

resetFirmsListFrpForTest();

function fire(overrides = {}) {
  return {
    index: 0,
    lat: 30.27,
    lon: -97.74,
    frp: 120,
    confidence: 0.9,
    satellite: 'N20',
    sensor: 'VIIRS',
    acqMs: NOW - 2 * 3600000,
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

test('All keeps 1/10/100 MW', () => {
  resetFirmsListFrpForTest();
  assert.equal(normalizeFirmsListFrp(undefined), DEFAULT_FIRMS_LIST_FRP);
  assert.equal(normalizeFirmsListFrp('nope'), 'all');
  assert.equal(normalizeFirmsListFrp('50'), 'all', 'globe FRP 50 is not a list chip');
  assert.equal(normalizeFirmsListFrp('10'), '10');
  assert.equal(normalizeFirmsListFrp('10+'), '10');
  assert.equal(normalizeFirmsListFrp('100'), '100');
  assert.equal(firmsListFrpThresholdMw('all'), null);
  assert.equal(firmsListFrpThresholdMw('10'), 10);
  assert.equal(firmsListFrpThresholdMw('100'), 100);
  assert.deepEqual(FIRMS_LIST_FRP_CHIPS.map((chip) => chip.id), ['all', '10', '100']);
  assert.deepEqual(FIRMS_LIST_FRP_CHIPS.map((chip) => chip.label), ['All', '10+ MW', '100+ MW']);

  const mixed = [
    fire({ id: 'mw1', frp: 1 }),
    fire({ id: 'mw10', frp: 10 }),
    fire({ id: 'mw100', frp: 100 }),
  ];
  assert.deepEqual(filterFiresByListFrp(mixed, 'all').map((row) => row.frp), [1, 10, 100]);
  assert.equal(fireMeetsListFrp({ frp: 1 }, 'all'), true);
  assert.equal(fireMeetsListFrp({ frp: 10 }, 'all'), true);
  assert.equal(fireMeetsListFrp({ frp: 100 }, 'all'), true);

  const listed = listNearestFires(mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all');
  assert.deepEqual(listed.map((row) => row.frp).sort((a, b) => a - b), [1, 10, 100]);
});

test('10+ drops 1', () => {
  resetFirmsListFrpForTest();
  assert.equal(fireMeetsListFrp({ frp: 1 }, '10'), false);
  assert.equal(fireMeetsListFrp({ frp: 9.9 }, '10'), false);
  assert.equal(fireMeetsListFrp({ frp: 10 }, '10'), true);
  assert.equal(fireMeetsListFrp({ frp: 100 }, '10'), true);

  const mixed = [
    fire({ id: 'mw1', frp: 1 }),
    fire({ id: 'mw10', frp: 10 }),
    fire({ id: 'mw100', frp: 100 }),
  ];
  assert.deepEqual(filterFiresByListFrp(mixed, '10').map((row) => row.frp), [10, 100]);
  const listed = listNearestFires(mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', '10');
  assert.deepEqual(listed.map((row) => row.frp).sort((a, b) => a - b), [10, 100]);
  assert.ok(!listed.some((row) => row.frp === 1));
});

test('100+ keeps 100 drops 10', () => {
  resetFirmsListFrpForTest();
  assert.equal(fireMeetsListFrp({ frp: 10 }, '100'), false);
  assert.equal(fireMeetsListFrp({ frp: 99.9 }, '100'), false);
  assert.equal(fireMeetsListFrp({ frp: 100 }, '100'), true);

  const mixed = [
    fire({ id: 'mw1', frp: 1 }),
    fire({ id: 'mw10', frp: 10 }),
    fire({ id: 'mw100', frp: 100 }),
  ];
  assert.deepEqual(filterFiresByListFrp(mixed, '100').map((row) => row.frp), [100]);
  const listed = listNearestFires(mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', '100');
  assert.deepEqual(listed.map((row) => row.frp), [100]);
  assert.ok(!listed.some((row) => row.frp === 10));
});

test('Missing FRP stays', () => {
  resetFirmsListFrpForTest();
  assert.equal(fireMeetsListFrp({ frp: undefined }, '10'), true);
  assert.equal(fireMeetsListFrp({ frp: null }, '100'), true);
  assert.equal(fireMeetsListFrp({ frp: '' }, '10'), true);
  assert.equal(fireMeetsListFrp({ frp: Number.NaN }, '100'), true);
  assert.equal(fireMeetsListFrp({}, '10'), true);

  const mixed = [
    fire({ id: 'mw1', frp: 1 }),
    fire({ id: 'missing', frp: undefined }),
    fire({ id: 'mw100', frp: 100 }),
  ];
  assert.deepEqual(filterFiresByListFrp(mixed, '10').map((row) => row.id), ['missing', 'mw100']);
  const listed = listNearestFires([
    fire({ frp: undefined, lat: 30.28 }),
    fire({ index: 1, frp: 1, lat: 30.29 }),
  ], ORIGIN, FIRMS_LIST_LIMIT, 'all', '100');
  assert.equal(listed.length, 1);
  assert.equal(Number.isFinite(listed[0].frp), false);
});

test('Selected id always kept', () => {
  resetFirmsListFrpForTest();
  const weak = fire({ id: 'keep-me', frp: 1, lat: 31 });
  assert.equal(fireMeetsListFrp(weak, '100', { selectedId: 'keep-me' }), true);
  assert.equal(fireMeetsListFrp(weak, '100', { selectedId: 'other' }), false);
  assert.deepEqual(
    filterFiresByListFrp([weak, fire({ id: 'mw10', frp: 10 })], '100', { selectedId: 'keep-me' })
      .map((row) => row.id),
    ['keep-me'],
  );

  const selected = fire({ frp: 1, lat: 40, lon: -74 });
  const selectedId = fireDetectionKey(selected);
  const listed = listNearestFires(
    [selected, fire({ index: 1, frp: 100 })],
    ORIGIN,
    FIRMS_LIST_LIMIT,
    'all',
    '100',
    selectedId,
  );
  assert.equal(listed.some((row) => row.id === selectedId), true);
  assert.equal(listed.find((row) => row.id === selectedId).frp, 1);

  setFirmsListSelectedId(selectedId);
  const fromSession = listNearestFires(
    [selected, fire({ index: 2, frp: 100, lat: 30.3 })],
    ORIGIN,
    FIRMS_LIST_LIMIT,
    'all',
    '100',
  );
  assert.equal(fromSession.some((row) => row.id === selectedId), true);
  resetFirmsListFrpForTest();
});

test('Invalid storage reads as All', () => {
  resetFirmsListFrpForTest();
  assert.equal(FIRMS_LIST_FRP_STORAGE_KEY, 'meridian.firmsListFrp');
  assert.equal(readFirmsListFrp(memoryStorage()), DEFAULT_FIRMS_LIST_FRP);
  assert.equal(readFirmsListFrp(memoryStorage({ [FIRMS_LIST_FRP_STORAGE_KEY]: 'nope' })), 'all');
  assert.equal(readFirmsListFrp(memoryStorage({ [FIRMS_LIST_FRP_STORAGE_KEY]: '50' })), 'all');
  assert.equal(readFirmsListFrp(memoryStorage({ [FIRMS_LIST_FRP_STORAGE_KEY]: '0.5' })), 'all');
  assert.equal(normalizeFirmsListFrp('high'), 'all');
});

test('Persist flip survives reload', () => {
  resetFirmsListFrpForTest();
  const storage = memoryStorage();
  assert.equal(readFirmsListFrp(storage), DEFAULT_FIRMS_LIST_FRP);
  assert.equal(setFirmsListFrp('10', { storage }), '10');
  assert.equal(storage.getItem(FIRMS_LIST_FRP_STORAGE_KEY), '10');
  assert.equal(getFirmsListFrp(), '10');
  assert.equal(readFirmsListFrp(memoryStorage(storage.snapshot())), '10');

  resetFirmsListFrpForTest();
  assert.equal(getFirmsListFrp(), DEFAULT_FIRMS_LIST_FRP);
  assert.equal(hydrateFirmsListFrp(storage), '10');
  assert.equal(getFirmsListFrp(), '10');

  setFirmsListFrp('100', { storage });
  resetFirmsListFrpForTest();
  assert.equal(hydrateFirmsListFrp(memoryStorage(storage.snapshot())), '100');
  writeFirmsListFrp(DEFAULT_FIRMS_LIST_FRP, storage);
  resetFirmsListFrpForTest();
  assert.equal(hydrateFirmsListFrp(storage), 'all');
  assert.equal(storage.snapshot()['meridian.firmsFrp'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListConf'], undefined);

  resetFirmsListFrpForTest();
  setFirmsListFrp('100', { storage });
  resetFirmsListFrpForTest();
  hydrateFirmsListFrp(storage);
  const rows = listNearestFires([
    fire({ frp: 1 }),
    fire({ index: 1, lat: 31, frp: 100 }),
  ], ORIGIN);
  assert.equal(getFirmsListFrp(), '100');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].frp, 100);
  resetFirmsListFrpForTest();
});

test('All | 10+ MW | 100+ MW apply before the cap and AND with list confidence', () => {
  resetFirmsListFrpForTest();
  const fires = [];
  for (let i = 0; i < 80; i += 1) {
    fires.push(fire({
      index: i,
      lat: 30.27 + i * 0.2,
      lon: -97.74,
      // First 50 are 1 MW so a post-cap filter would starve 100 MW rows.
      frp: i < 50 ? 1 : (i < 65 ? 10 : 100),
      confidence: i < 65 ? 0.3 : 0.9,
    }));
  }
  const all = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all');
  assert.equal(all.length, 50);
  assert.ok(all.every((row) => row.frp === 1));

  const ten = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', '10');
  assert.equal(ten.length, 30);
  assert.ok(ten.every((row) => row.frp >= 10));
  assert.equal(ten[0].lat, 30.27 + 50 * 0.2);

  const hundred = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', '100');
  assert.equal(hundred.length, 15);
  assert.ok(hundred.every((row) => row.frp >= 100));

  const andHigh = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'high', '10');
  assert.equal(andHigh.length, 15);
  assert.ok(andHigh.every((row) => row.frp >= 10 && row.confidence >= 0.75));
});

test('formatFireListRow still prints FRP in the title', () => {
  assert.match(formatFireListRow(fire({ frp: 1 }), ORIGIN, NOW).title, /1\.0 MW/);
  assert.match(formatFireListRow(fire({ frp: 10 }), ORIGIN, NOW).title, /10 MW/);
  assert.match(formatFireListRow(fire({ frp: 100 }), ORIGIN, NOW).title, /100 MW/);
});

test('exclusive chips are All | 10+ MW | 100+ MW and only one is active', () => {
  const models = firmsListFrpChipModels();
  assert.deepEqual(models.map((chip) => chip.label), ['All', '10+ MW', '100+ MW']);
  assert.deepEqual(models.map((chip) => chip.params.firmsListFrp), ['all', '10', '100']);
  assert.equal(models[0].active, true);
  assert.equal(models.filter((chip) => chip.active).length, 1);
  assert.equal(models.every((chip) => chip.group === 'ListFrp'), true);
  assert.deepEqual(firmsListFrpChipModels('10').map((chip) => chip.active), [false, true, false]);
  assert.deepEqual(firmsListFrpChipModels('100').map((chip) => chip.active), [false, false, true]);
});

test('resolveFireListView All matches the unfiltered list and keeps the NASA acknowledgement', () => {
  const fires = [
    fire({ frp: 100 }),
    fire({ index: 1, lat: 40, lon: -74, frp: 1 }),
  ];
  const all = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    listConf: 'all',
    listFrp: 'all',
  });
  const implicit = resolveFireListView({ fires, camera: ORIGIN, now: NOW, listFrp: 'all' });
  assert.equal(all.status, 'ready');
  assert.equal(all.rows.length, 2);
  assert.equal(implicit.rows.length, 2);
  assert.equal(all.acknowledgement, FIRMS_ACKNOWLEDGEMENT);
  assert.match(FIRMS_ACKNOWLEDGEMENT, /NASA's Fire Information for Resource Management System \(FIRMS\)/);

  const hundred = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    listFrp: '100',
  });
  assert.equal(hundred.rows.length, 1);
  assert.match(hundred.rows[0].title, /100 MW/);
});

test('LayerStateCoordinator restore keeps the list floor and does not write a share URL', () => {
  resetFirmsListFrpForTest();
  const storage = memoryStorage();
  setFirmsListFrp('100', { storage });
  assert.equal(storage.getItem(FIRMS_LIST_FRP_STORAGE_KEY), '100');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['local-firms'],
    options: { 'local-firms': { frpFloor: '50' } },
  }));
  assert.doesNotMatch(encoded.toString(), /firmsListFrp|meridian\.firmsListFrp/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetFirmsListFrpForTest();
  assert.equal(getFirmsListFrp(), DEFAULT_FIRMS_LIST_FRP);
  assert.equal(hydrateFirmsListFrp(storage), '100');
  assert.equal(getFirmsListFrp(), '100');
  resetFirmsListFrpForTest();
});

test('firmsCsv/adapt/heatmap are unchanged', () => {
  assert.equal(fileSha('src/data/firmsCsv.js'), FIRMS_CSV_SHA);
  assert.equal(fileSha('src/data/firmsAdapt.js'), FIRMS_ADAPT_SHA);
  assert.equal(fileSha('src/data/firmsHeatmap.js'), FIRMS_HEATMAP_SHA);

  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const panel = readFileSync(path.join(ROOT, 'src/data/firmsListPanel.js'), 'utf8');
  const list = readFileSync(path.join(ROOT, 'src/data/firmsList.js'), 'utf8');
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const adapt = readFileSync(path.join(ROOT, 'src/data/firmsAdapt.js'), 'utf8');
  const csv = readFileSync(path.join(ROOT, 'src/data/firmsCsv.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const firstRun = readFileSync(path.join(ROOT, 'src/firstRunExperience.js'), 'utf8');
  const markup = html.match(/<div id="fires-panel"[\s\S]*?<p id="fires-list-ack"[\s\S]*?<\/p>/);
  assert.ok(markup, 'fires-panel markup is missing');
  assert.match(markup[0], /id="fires-list-frp-chips"/);
  assert.match(markup[0], /data-firms-list-frp="all"[^>]*>All</);
  assert.match(markup[0], /data-firms-list-frp="10"[^>]*>10\+ MW</);
  assert.match(markup[0], /data-firms-list-frp="100"[^>]*>100\+ MW</);
  assert.ok(
    markup[0].indexOf('id="fires-list-conf-chips"') < markup[0].indexOf('id="fires-list-frp-chips"'),
    'list FRP chips sit after the 210 list confidence chips',
  );
  assert.ok(
    markup[0].indexOf('id="fires-list-frp-chips"') < markup[0].indexOf('id="fires-list-meta"'),
    'list FRP chips sit on the FIRES panel above the list meta',
  );
  assert.match(markup[0], /NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.match(ui, /data-firms-list-frp/);
  assert.match(ui, /setFirmsListFrp/);
  assert.match(ui, /hydrateFirmsListFrp/);
  assert.doesNotMatch(ui, /setLayerParams\?\.\('local-firms', \{[^}]*firmsListFrp/);
  assert.match(panel, /setFirmsListFrp|hydrateFirmsListFrp/);
  assert.match(list, /fireMeetsListFrp|getFirmsListFrp/);
  assert.doesNotMatch(heatmap, /firmsListFrp|listFrp|FIRMS_LIST_FRP/);
  assert.doesNotMatch(adapt, /firmsListFrp|listFrp/);
  assert.doesNotMatch(csv, /firmsListFrp|listFrp/);
  assert.doesNotMatch(layerState, /firmsListFrp|listFrp/);
  assert.match(layerState, /enumOption\('frpFloor', 'f', 'all', \['all', '10', '50', '100'\]/);
  assert.match(firstRun, /meridian\.firmsListFrp/);
  assert.doesNotMatch(firstRun, /writeFirmsListFrp|hydrateFirmsListFrp/);
  assert.match(firstRun, /setFirmsListFrp/);
  assert.doesNotMatch(list, /firms\.modaps\.eosdis\.nasa\.gov/);
  assert.doesNotMatch(list, /from '\.\/firmsHeatmap\.js'|from '\.\/firmsAdapt\.js'|from '\.\/firmsCsv\.js'/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/listFrp.js')), false);
  assert.match(heatmap, /All.*10\+.*50\+.*100\+ MW|FIRMS_FRP_FLOOR_CHIPS/);
});
