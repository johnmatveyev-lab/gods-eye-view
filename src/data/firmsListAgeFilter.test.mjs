// PLAN 225 — FIRMS list age-floor chips. Client-only exclusive All | <6 h | <1 h.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIRMS_LIST_AGE,
  FIRMS_LIST_AGE_CHIPS,
  FIRMS_LIST_AGE_STORAGE_KEY,
  filterFiresByListAge,
  fireMeetsListAge,
  firmsListAgeChipModels,
  firmsListAgeThresholdHours,
  getFirmsListAge,
  hydrateFirmsListAge,
  normalizeFirmsListAge,
  readFirmsListAge,
  resetFirmsListAgeForTest,
  setFirmsListAge,
  writeFirmsListAge,
} from './firmsListAgeFilter.js';
import {
  FIRMS_ACKNOWLEDGEMENT,
  FIRMS_LIST_LIMIT,
  formatFireListRow,
  listNearestFires,
  resolveFireListView,
} from './firmsList.js';
import { fireDetectionKey } from './firmsLabels.js';
import { setFirmsListSelectedId } from './firmsListFrpFilter.js';
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

resetFirmsListAgeForTest();

function fire(overrides = {}) {
  return {
    index: 0,
    lat: 30.27,
    lon: -97.74,
    frp: 120,
    confidence: 0.9,
    satellite: 'N20',
    sensor: 'VIIRS',
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

test('All keeps 20 min / 3 h / 12 h', () => {
  resetFirmsListAgeForTest();
  assert.equal(normalizeFirmsListAge(undefined), DEFAULT_FIRMS_LIST_AGE);
  assert.equal(normalizeFirmsListAge('nope'), 'all');
  assert.equal(normalizeFirmsListAge('12'), 'all', 'globe age 12 is not a list chip');
  assert.equal(normalizeFirmsListAge('24'), 'all', 'globe age 24 is not a list chip');
  assert.equal(normalizeFirmsListAge('6'), '6');
  assert.equal(normalizeFirmsListAge('<6 h'), '6');
  assert.equal(normalizeFirmsListAge('1'), '1');
  assert.equal(firmsListAgeThresholdHours('all'), null);
  assert.equal(firmsListAgeThresholdHours('6'), 6);
  assert.equal(firmsListAgeThresholdHours('1'), 1);
  assert.deepEqual(FIRMS_LIST_AGE_CHIPS.map((chip) => chip.id), ['all', '6', '1']);
  assert.deepEqual(FIRMS_LIST_AGE_CHIPS.map((chip) => chip.label), ['All', '<6 h', '<1 h']);

  const mixed = [
    fire({ id: 'm20', acqMs: NOW - MIN20 }),
    fire({ id: 'h3', acqMs: NOW - 3 * H }),
    fire({ id: 'h12', acqMs: NOW - 12 * H }),
  ];
  assert.deepEqual(filterFiresByListAge(mixed, 'all', { now: NOW }).map((row) => row.id), ['m20', 'h3', 'h12']);
  assert.equal(fireMeetsListAge({ acqMs: NOW - MIN20 }, 'all', { now: NOW }), true);
  assert.equal(fireMeetsListAge({ acqMs: NOW - 3 * H }, 'all', { now: NOW }), true);
  assert.equal(fireMeetsListAge({ acqMs: NOW - 12 * H }, 'all', { now: NOW }), true);

  const listed = listNearestFires(mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW);
  assert.deepEqual(listed.map((row) => row.id).sort(), ['h12', 'h3', 'm20']);
});

test('6 h drops 12 h keeps 3 h', () => {
  resetFirmsListAgeForTest();
  assert.equal(fireMeetsListAge({ acqMs: NOW - 12 * H }, '6', { now: NOW }), false);
  assert.equal(fireMeetsListAge({ acqMs: NOW - 3 * H }, '6', { now: NOW }), true);
  assert.equal(fireMeetsListAge({ acqMs: NOW - MIN20 }, '6', { now: NOW }), true);
  assert.equal(fireMeetsListAge({ acqMs: NOW - 6 * H }, '6', { now: NOW }), false);

  const mixed = [
    fire({ id: 'm20', acqMs: NOW - MIN20 }),
    fire({ id: 'h3', acqMs: NOW - 3 * H }),
    fire({ id: 'h12', acqMs: NOW - 12 * H }),
  ];
  assert.deepEqual(filterFiresByListAge(mixed, '6', { now: NOW }).map((row) => row.id), ['m20', 'h3']);
  const listed = listNearestFires(mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, '6', NOW);
  assert.deepEqual(listed.map((row) => row.id).sort(), ['h3', 'm20']);
  assert.ok(!listed.some((row) => row.id === 'h12'));
});

test('1 h keeps 20 min drops 3 h', () => {
  resetFirmsListAgeForTest();
  assert.equal(fireMeetsListAge({ acqMs: NOW - MIN20 }, '1', { now: NOW }), true);
  assert.equal(fireMeetsListAge({ acqMs: NOW - 3 * H }, '1', { now: NOW }), false);
  assert.equal(fireMeetsListAge({ acqMs: NOW - H }, '1', { now: NOW }), false);

  const mixed = [
    fire({ id: 'm20', acqMs: NOW - MIN20 }),
    fire({ id: 'h3', acqMs: NOW - 3 * H }),
    fire({ id: 'h12', acqMs: NOW - 12 * H }),
  ];
  assert.deepEqual(filterFiresByListAge(mixed, '1', { now: NOW }).map((row) => row.id), ['m20']);
  const listed = listNearestFires(mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, '1', NOW);
  assert.deepEqual(listed.map((row) => row.id), ['m20']);
  assert.ok(!listed.some((row) => row.id === 'h3'));
});

test('Missing acqMs stays', () => {
  resetFirmsListAgeForTest();
  assert.equal(fireMeetsListAge({ acqMs: undefined }, '1', { now: NOW }), true);
  assert.equal(fireMeetsListAge({ acqMs: null }, '6', { now: NOW }), true);
  assert.equal(fireMeetsListAge({ acqMs: '' }, '1', { now: NOW }), true);
  assert.equal(fireMeetsListAge({ acqMs: Number.NaN }, '6', { now: NOW }), true);
  assert.equal(fireMeetsListAge({}, '1', { now: NOW }), true);

  const mixed = [
    fire({ id: 'h12', acqMs: NOW - 12 * H }),
    fire({ id: 'missing', acqMs: undefined }),
    fire({ id: 'm20', acqMs: NOW - MIN20 }),
  ];
  assert.deepEqual(filterFiresByListAge(mixed, '1', { now: NOW }).map((row) => row.id), ['missing', 'm20']);
  const listed = listNearestFires([
    fire({ acqMs: undefined, lat: 30.28 }),
    fire({ index: 1, acqMs: NOW - 12 * H, lat: 30.29 }),
  ], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, '1', NOW);
  assert.equal(listed.length, 1);
  assert.equal(Number.isFinite(listed[0].acqMs), false);
});

test('Selected id always kept', () => {
  resetFirmsListAgeForTest();
  const old = fire({ id: 'keep-me', acqMs: NOW - 12 * H, lat: 31 });
  assert.equal(fireMeetsListAge(old, '1', { selectedId: 'keep-me', now: NOW }), true);
  assert.equal(fireMeetsListAge(old, '1', { selectedId: 'other', now: NOW }), false);
  assert.deepEqual(
    filterFiresByListAge(
      [old, fire({ id: 'm20', acqMs: NOW - MIN20 })],
      '1',
      { selectedId: 'keep-me', now: NOW },
    ).map((row) => row.id),
    ['keep-me', 'm20'],
  );

  const selected = fire({ acqMs: NOW - 12 * H, lat: 40, lon: -74 });
  const selectedId = fireDetectionKey(selected);
  const listed = listNearestFires(
    [selected, fire({ index: 1, acqMs: NOW - MIN20 })],
    ORIGIN,
    FIRMS_LIST_LIMIT,
    'all',
    'all',
    selectedId,
    '1',
    NOW,
  );
  assert.equal(listed.some((row) => row.id === selectedId), true);
  assert.equal(listed.find((row) => row.id === selectedId).acqMs, NOW - 12 * H);

  setFirmsListSelectedId(selectedId);
  const fromSession = listNearestFires(
    [selected, fire({ index: 2, acqMs: NOW - MIN20, lat: 30.3 })],
    ORIGIN,
    FIRMS_LIST_LIMIT,
    'all',
    'all',
    undefined,
    '1',
    NOW,
  );
  assert.equal(fromSession.some((row) => row.id === selectedId), true);
  setFirmsListSelectedId(null);
  resetFirmsListAgeForTest();
});

test('Invalid storage reads as All', () => {
  resetFirmsListAgeForTest();
  assert.equal(FIRMS_LIST_AGE_STORAGE_KEY, 'meridian.firmsListAge');
  assert.equal(readFirmsListAge(memoryStorage()), DEFAULT_FIRMS_LIST_AGE);
  assert.equal(readFirmsListAge(memoryStorage({ [FIRMS_LIST_AGE_STORAGE_KEY]: 'nope' })), 'all');
  assert.equal(readFirmsListAge(memoryStorage({ [FIRMS_LIST_AGE_STORAGE_KEY]: '12' })), 'all');
  assert.equal(readFirmsListAge(memoryStorage({ [FIRMS_LIST_AGE_STORAGE_KEY]: '24' })), 'all');
  assert.equal(normalizeFirmsListAge('high'), 'all');
});

test('Persist flip survives reload', () => {
  resetFirmsListAgeForTest();
  const storage = memoryStorage();
  assert.equal(readFirmsListAge(storage), DEFAULT_FIRMS_LIST_AGE);
  assert.equal(setFirmsListAge('6', { storage }), '6');
  assert.equal(storage.getItem(FIRMS_LIST_AGE_STORAGE_KEY), '6');
  assert.equal(getFirmsListAge(), '6');
  assert.equal(readFirmsListAge(memoryStorage(storage.snapshot())), '6');

  resetFirmsListAgeForTest();
  assert.equal(getFirmsListAge(), DEFAULT_FIRMS_LIST_AGE);
  assert.equal(hydrateFirmsListAge(storage), '6');
  assert.equal(getFirmsListAge(), '6');

  setFirmsListAge('1', { storage });
  resetFirmsListAgeForTest();
  assert.equal(hydrateFirmsListAge(memoryStorage(storage.snapshot())), '1');
  writeFirmsListAge(DEFAULT_FIRMS_LIST_AGE, storage);
  resetFirmsListAgeForTest();
  assert.equal(hydrateFirmsListAge(storage), 'all');
  assert.equal(storage.snapshot()['meridian.firmsAge'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListConf'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListFrp'], undefined);

  resetFirmsListAgeForTest();
  setFirmsListAge('1', { storage });
  resetFirmsListAgeForTest();
  hydrateFirmsListAge(storage);
  const rows = listNearestFires([
    fire({ acqMs: NOW - 12 * H }),
    fire({ index: 1, lat: 31, acqMs: NOW - MIN20 }),
  ], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, undefined, NOW);
  assert.equal(getFirmsListAge(), '1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].acqMs, NOW - MIN20);
  resetFirmsListAgeForTest();
});

test('All | <6 h | <1 h apply before the cap and AND with list confidence and FRP', () => {
  resetFirmsListAgeForTest();
  const fires = [];
  for (let i = 0; i < 80; i += 1) {
    fires.push(fire({
      index: i,
      lat: 30.27 + i * 0.2,
      lon: -97.74,
      // First 50 are 12 h so a post-cap filter would starve recent rows.
      acqMs: i < 50 ? NOW - 12 * H : (i < 65 ? NOW - 3 * H : NOW - MIN20),
      frp: i < 65 ? 1 : 100,
      confidence: i < 65 ? 0.3 : 0.9,
    }));
  }
  const all = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW);
  assert.equal(all.length, 50);
  assert.ok(all.every((row) => row.acqMs === NOW - 12 * H));

  const six = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, '6', NOW);
  assert.equal(six.length, 30);
  assert.ok(six.every((row) => NOW - row.acqMs < 6 * H));
  assert.equal(six[0].lat, 30.27 + 50 * 0.2);

  const one = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, '1', NOW);
  assert.equal(one.length, 15);
  assert.ok(one.every((row) => NOW - row.acqMs < H));

  const andHighFrp = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'high', '10', null, '6', NOW);
  assert.equal(andHighFrp.length, 15);
  assert.ok(andHighFrp.every((row) => (
    NOW - row.acqMs < 6 * H && row.frp >= 10 && row.confidence >= 0.75
  )));
});

test('formatFireListRow still prints age from acqMs', () => {
  assert.match(formatFireListRow(fire({ acqMs: NOW - MIN20 }), ORIGIN, NOW).detail, /<1h/);
  assert.match(formatFireListRow(fire({ acqMs: NOW - 3 * H }), ORIGIN, NOW).detail, /3h/);
  assert.match(formatFireListRow(fire({ acqMs: NOW - 12 * H }), ORIGIN, NOW).detail, /12h/);
});

test('exclusive chips are All | <6 h | <1 h and only one is active', () => {
  const models = firmsListAgeChipModels();
  assert.deepEqual(models.map((chip) => chip.label), ['All', '<6 h', '<1 h']);
  assert.deepEqual(models.map((chip) => chip.params.firmsListAge), ['all', '6', '1']);
  assert.equal(models[0].active, true);
  assert.equal(models.filter((chip) => chip.active).length, 1);
  assert.equal(models.every((chip) => chip.group === 'ListAge'), true);
  assert.deepEqual(firmsListAgeChipModels('6').map((chip) => chip.active), [false, true, false]);
  assert.deepEqual(firmsListAgeChipModels('1').map((chip) => chip.active), [false, false, true]);
});

test('resolveFireListView All matches the unfiltered list and keeps the NASA acknowledgement', () => {
  const fires = [
    fire({ acqMs: NOW - MIN20 }),
    fire({ index: 1, lat: 40, lon: -74, acqMs: NOW - 12 * H }),
  ];
  const all = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    listConf: 'all',
    listFrp: 'all',
    listAge: 'all',
  });
  const implicit = resolveFireListView({ fires, camera: ORIGIN, now: NOW, listAge: 'all' });
  assert.equal(all.status, 'ready');
  assert.equal(all.rows.length, 2);
  assert.equal(implicit.rows.length, 2);
  assert.equal(all.acknowledgement, FIRMS_ACKNOWLEDGEMENT);
  assert.match(FIRMS_ACKNOWLEDGEMENT, /NASA's Fire Information for Resource Management System \(FIRMS\)/);

  const one = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    listAge: '1',
  });
  assert.equal(one.rows.length, 1);
  assert.match(one.rows[0].detail, /<1h/);
});

test('LayerStateCoordinator restore keeps the list floor and does not write a share URL', () => {
  resetFirmsListAgeForTest();
  const storage = memoryStorage();
  setFirmsListAge('1', { storage });
  assert.equal(storage.getItem(FIRMS_LIST_AGE_STORAGE_KEY), '1');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['local-firms'],
    options: { 'local-firms': { ageWindow: '6' } },
  }));
  assert.doesNotMatch(encoded.toString(), /firmsListAge|meridian\.firmsListAge/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetFirmsListAgeForTest();
  assert.equal(getFirmsListAge(), DEFAULT_FIRMS_LIST_AGE);
  assert.equal(hydrateFirmsListAge(storage), '1');
  assert.equal(getFirmsListAge(), '1');
  resetFirmsListAgeForTest();
});

test('firmsCsv.js / firmsAdapt.js / firmsHeatmap.js are unchanged', () => {
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
  assert.match(markup[0], /id="fires-list-age-chips"/);
  assert.match(markup[0], /data-firms-list-age="all"[^>]*>All</);
  assert.match(markup[0], /data-firms-list-age="6"[^>]*>&lt;6 h</);
  assert.match(markup[0], /data-firms-list-age="1"[^>]*>&lt;1 h</);
  assert.ok(
    markup[0].indexOf('id="fires-list-frp-chips"') < markup[0].indexOf('id="fires-list-age-chips"'),
    'list age chips sit after the 219 list FRP chips',
  );
  assert.ok(
    markup[0].indexOf('id="fires-list-age-chips"') < markup[0].indexOf('id="fires-list-meta"'),
    'list age chips sit on the FIRES panel above the list meta',
  );
  assert.match(markup[0], /NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.match(ui, /data-firms-list-age/);
  assert.match(ui, /setFirmsListAge/);
  assert.match(ui, /hydrateFirmsListAge/);
  assert.doesNotMatch(ui, /setLayerParams\?\.\('local-firms', \{[^}]*firmsListAge/);
  assert.match(panel, /setFirmsListAge|hydrateFirmsListAge/);
  assert.match(list, /fireMeetsListAge|getFirmsListAge/);
  assert.doesNotMatch(heatmap, /firmsListAge|listAge|FIRMS_LIST_AGE/);
  assert.doesNotMatch(adapt, /firmsListAge|listAge/);
  assert.doesNotMatch(csv, /firmsListAge|listAge/);
  assert.doesNotMatch(layerState, /firmsListAge|listAge/);
  assert.match(layerState, /enumOption\('ageWindow', 'a', '24', \['6', '12', '24'\]/);
  assert.match(firstRun, /meridian\.firmsListAge/);
  assert.doesNotMatch(firstRun, /writeFirmsListAge|hydrateFirmsListAge/);
  assert.match(firstRun, /setFirmsListAge/);
  assert.doesNotMatch(list, /firms\.modaps\.eosdis\.nasa\.gov/);
  assert.doesNotMatch(list, /from '\.\/firmsHeatmap\.js'|from '\.\/firmsAdapt\.js'|from '\.\/firmsCsv\.js'/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/listAge.js')), false);
  assert.match(heatmap, /FIRMS_AGE_WINDOW_CHIPS|'6'.*'12'.*'24'/);
});
