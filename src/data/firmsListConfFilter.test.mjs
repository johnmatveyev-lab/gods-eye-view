// PLAN 210 — FIRMS list confidence chips. Client-only exclusive All | High | Nominal+.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIRMS_LIST_CONF,
  FIRMS_LIST_CONF_CHIPS,
  FIRMS_LIST_CONF_HIGH_MIN,
  FIRMS_LIST_CONF_NOMINAL_MIN,
  FIRMS_LIST_CONF_STORAGE_KEY,
  filterFiresByListConf,
  fireMeetsListConf,
  firmsListConfChipModels,
  firmsListConfThreshold,
  getFirmsListConf,
  hydrateFirmsListConf,
  normalizeFirmsListConf,
  readFirmsListConf,
  resetFirmsListConfForTest,
  setFirmsListConf,
  writeFirmsListConf,
} from './firmsListConfFilter.js';
import {
  FIRMS_ACKNOWLEDGEMENT,
  FIRMS_LIST_LIMIT,
  formatFireListRow,
  listNearestFires,
  resolveFireListView,
} from './firmsList.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOW = Date.UTC(2026, 6, 17, 4, 0);
const ORIGIN = { lat: 30.27, lon: -97.74 };

resetFirmsListConfForTest();

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

test('normalizeFirmsListConf: default All; High and Nominal+ are exclusive ids', () => {
  assert.equal(normalizeFirmsListConf(undefined), DEFAULT_FIRMS_LIST_CONF);
  assert.equal(normalizeFirmsListConf('nope'), 'all');
  assert.equal(normalizeFirmsListConf('0.5'), 'all');
  assert.equal(normalizeFirmsListConf('0.8'), 'all');
  assert.equal(normalizeFirmsListConf('high'), 'high');
  assert.equal(normalizeFirmsListConf('nominal'), 'nominal');
  assert.equal(normalizeFirmsListConf('nominal+'), 'nominal');
  assert.deepEqual(FIRMS_LIST_CONF_CHIPS.map((chip) => chip.id), ['all', 'high', 'nominal']);
  assert.deepEqual(FIRMS_LIST_CONF_CHIPS.map((chip) => chip.label), ['All', 'High', 'Nominal+']);
  assert.equal(firmsListConfThreshold('high'), FIRMS_LIST_CONF_HIGH_MIN);
  assert.equal(firmsListConfThreshold('nominal'), FIRMS_LIST_CONF_NOMINAL_MIN);
  assert.equal(FIRMS_LIST_CONF_HIGH_MIN, 0.75);
  assert.equal(FIRMS_LIST_CONF_NOMINAL_MIN, 0.45);
});

test('High keeps ≥0.75 only; Nominal+ keeps ≥0.45; missing confidence stays visible', () => {
  assert.equal(fireMeetsListConf({ confidence: 0.9 }, 'high'), true);
  assert.equal(fireMeetsListConf({ confidence: 0.75 }, 'high'), true);
  assert.equal(fireMeetsListConf({ confidence: 0.74 }, 'high'), false);
  assert.equal(fireMeetsListConf({ confidence: 0.6 }, 'high'), false);
  assert.equal(fireMeetsListConf({ confidence: 0.3 }, 'high'), false);

  assert.equal(fireMeetsListConf({ confidence: 0.9 }, 'nominal'), true);
  assert.equal(fireMeetsListConf({ confidence: 0.45 }, 'nominal'), true);
  assert.equal(fireMeetsListConf({ confidence: 0.44 }, 'nominal'), false);
  assert.equal(fireMeetsListConf({ confidence: 0.3 }, 'nominal'), false);

  assert.equal(fireMeetsListConf({ confidence: 0.3 }, 'all'), true);
  assert.equal(fireMeetsListConf({ confidence: undefined }, 'high'), true);
  assert.equal(fireMeetsListConf({ confidence: null }, 'nominal'), true);
  assert.equal(fireMeetsListConf({ confidence: '' }, 'high'), true);
  assert.equal(fireMeetsListConf({ confidence: Number.NaN }, 'nominal'), true);
  assert.equal(fireMeetsListConf({}, 'high'), true);

  const mixed = [
    fire({ confidence: 0.9 }),
    fire({ confidence: 0.6 }),
    fire({ confidence: 0.3 }),
    fire({ confidence: undefined }),
  ];
  assert.deepEqual(filterFiresByListConf(mixed, 'all').map((row) => row.confidence), [0.9, 0.6, 0.3, undefined]);
  assert.deepEqual(filterFiresByListConf(mixed, 'high').map((row) => row.confidence), [0.9, undefined]);
  assert.deepEqual(filterFiresByListConf(mixed, 'nominal').map((row) => row.confidence), [0.9, 0.6, undefined]);
});

test('All keeps the current 50-row list; High and Nominal+ apply before the cap', () => {
  const fires = [];
  for (let i = 0; i < 80; i += 1) {
    fires.push(fire({
      index: i,
      lat: 30.27 + i * 0.2,
      lon: -97.74,
      // First 50 are low; later rows are high so a post-cap filter would starve.
      confidence: i < 50 ? 0.3 : 0.9,
      frp: 10 + i,
    }));
  }
  const all = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'all');
  assert.equal(all.length, 50);
  assert.equal(all[0].lat, 30.27);
  assert.equal(all[49].lat, 30.27 + 49 * 0.2);
  assert.ok(all.every((row) => row.confidence === 0.3));

  const high = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'high');
  assert.equal(high.length, 30);
  assert.ok(high.every((row) => row.confidence >= 0.75));
  assert.equal(high[0].lat, 30.27 + 50 * 0.2);
  assert.ok(!high.some((row) => row.confidence < 0.75));

  const nominal = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'nominal');
  assert.equal(nominal.length, 30);
  assert.ok(nominal.every((row) => row.confidence >= 0.45));
});

test('formatFireListRow buckets reuse the High / Nominal+ thresholds', () => {
  assert.match(formatFireListRow(fire({ confidence: 0.75 }), ORIGIN, NOW).detail, /high/);
  assert.match(formatFireListRow(fire({ confidence: 0.45 }), ORIGIN, NOW).detail, /nominal/);
  assert.match(formatFireListRow(fire({ confidence: 0.3 }), ORIGIN, NOW).detail, /low/);
});

test('flip persist survives reload and All is the default', () => {
  resetFirmsListConfForTest();
  const storage = memoryStorage();
  assert.equal(FIRMS_LIST_CONF_STORAGE_KEY, 'meridian.firmsListConf');
  assert.equal(readFirmsListConf(storage), DEFAULT_FIRMS_LIST_CONF);
  assert.equal(setFirmsListConf('high', { storage }), 'high');
  assert.equal(storage.getItem(FIRMS_LIST_CONF_STORAGE_KEY), 'high');
  assert.equal(getFirmsListConf(), 'high');
  assert.equal(readFirmsListConf(memoryStorage(storage.snapshot())), 'high');

  resetFirmsListConfForTest();
  assert.equal(getFirmsListConf(), DEFAULT_FIRMS_LIST_CONF);
  assert.equal(hydrateFirmsListConf(storage), 'high');
  assert.equal(getFirmsListConf(), 'high');

  setFirmsListConf('nominal', { storage });
  resetFirmsListConfForTest();
  assert.equal(hydrateFirmsListConf(memoryStorage(storage.snapshot())), 'nominal');
  writeFirmsListConf(DEFAULT_FIRMS_LIST_CONF, storage);
  resetFirmsListConfForTest();
  assert.equal(hydrateFirmsListConf(storage), 'all');
  assert.equal(storage.snapshot()['meridian.firmsScan'], undefined);

  resetFirmsListConfForTest();
  setFirmsListConf('high', { storage });
  resetFirmsListConfForTest();
  hydrateFirmsListConf(storage);
  const rows = listNearestFires([
    fire({ confidence: 0.3 }),
    fire({ index: 1, lat: 31, confidence: 0.9 }),
  ], ORIGIN);
  assert.equal(getFirmsListConf(), 'high');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].confidence, 0.9);
  resetFirmsListConfForTest();
});

test('exclusive chips are All | High | Nominal+ and only one is active', () => {
  const models = firmsListConfChipModels();
  assert.deepEqual(models.map((chip) => chip.label), ['All', 'High', 'Nominal+']);
  assert.deepEqual(models.map((chip) => chip.params.firmsListConf), ['all', 'high', 'nominal']);
  assert.equal(models[0].active, true);
  assert.equal(models.filter((chip) => chip.active).length, 1);
  assert.equal(models.every((chip) => chip.group === 'ListConf'), true);
  assert.deepEqual(firmsListConfChipModels('high').map((chip) => chip.active), [false, true, false]);
  assert.deepEqual(firmsListConfChipModels('nominal').map((chip) => chip.active), [false, false, true]);
});

test('resolveFireListView All matches the unfiltered list and keeps the NASA acknowledgement', () => {
  const fires = [
    fire({ confidence: 0.9 }),
    fire({ index: 1, lat: 40, lon: -74, confidence: 0.3 }),
  ];
  const all = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    listConf: 'all',
  });
  const implicit = resolveFireListView({ fires, camera: ORIGIN, now: NOW });
  assert.equal(all.status, 'ready');
  assert.equal(all.rows.length, 2);
  assert.equal(implicit.rows.length, 2);
  assert.equal(all.acknowledgement, FIRMS_ACKNOWLEDGEMENT);
  assert.match(FIRMS_ACKNOWLEDGEMENT, /NASA's Fire Information for Resource Management System \(FIRMS\)/);

  const high = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    listConf: 'high',
  });
  assert.equal(high.rows.length, 1);
  assert.match(high.rows[0].detail, /high/);
});

test('FIRES list chips sit on the list panel and stay off the globe / share-URL path', () => {
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
  assert.match(markup[0], /id="fires-list-conf-chips"/);
  assert.match(markup[0], /data-firms-list-conf="all"[^>]*>All</);
  assert.match(markup[0], /data-firms-list-conf="high"[^>]*>High</);
  assert.match(markup[0], /data-firms-list-conf="nominal"[^>]*>Nominal\+</);
  assert.ok(
    markup[0].indexOf('id="fires-scan-chips"') < markup[0].indexOf('id="fires-list-conf-chips"'),
    'list confidence chips sit after the 204 scan chips',
  );
  assert.ok(
    markup[0].indexOf('id="fires-track-chips"') < markup[0].indexOf('id="fires-list-conf-chips"'),
    'list confidence chips sit after the 211 track chips',
  );
  assert.ok(
    markup[0].indexOf('id="fires-list-conf-chips"') < markup[0].indexOf('id="fires-list-meta"'),
    'list confidence chips sit on the FIRES panel above the list meta',
  );
  assert.match(markup[0], /NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.match(ui, /data-firms-list-conf/);
  assert.match(ui, /setFirmsListConf/);
  assert.match(ui, /hydrateFirmsListConf/);
  assert.doesNotMatch(ui, /setLayerParams\?\.\('local-firms', \{[^}]*firmsListConf/);
  assert.match(panel, /setFirmsListConf|hydrateFirmsListConf/);
  assert.match(list, /fireMeetsListConf|getFirmsListConf/);
  assert.doesNotMatch(heatmap, /firmsListConf|listConf|FIRMS_LIST_CONF/);
  assert.doesNotMatch(adapt, /firmsListConf|listConf/);
  assert.doesNotMatch(csv, /firmsListConf|listConf/);
  assert.doesNotMatch(layerState, /firmsListConf|listConf/);
  assert.match(layerState, /confidenceFloor[\s\S]*'0\.5'[\s\S]*'0\.8'/);
  assert.match(firstRun, /meridian\.firmsListConf/);
  assert.doesNotMatch(firstRun, /writeFirmsListConf|hydrateFirmsListConf/);
  assert.match(firstRun, /setFirmsListConf/);
  assert.doesNotMatch(list, /firms\.modaps\.eosdis\.nasa\.gov/);
  assert.doesNotMatch(list, /from '\.\/firmsHeatmap\.js'|from '\.\/firmsAdapt\.js'|from '\.\/firmsCsv\.js'/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/listConf.js')), false);
  assert.match(heatmap, /'0\.5', label: '0\.5\+'/);
  assert.match(heatmap, /'0\.8', label: '0\.8\+'/);
});
