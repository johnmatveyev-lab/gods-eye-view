// PLAN 230 — FIRMS list Hide no satellite toggle. Client-only hide-missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIRMS_LIST_HIDE_NO_SAT,
  FIRMS_LIST_HIDE_NO_SAT_CHIP_ID,
  FIRMS_LIST_HIDE_NO_SAT_CHIP_LABEL,
  FIRMS_LIST_HIDE_NO_SAT_STORAGE_KEY,
  filterFiresByListHideNoSat,
  fireHasListSatellite,
  fireListSatelliteLabel,
  fireMeetsListHideNoSat,
  firmsListHideNoSatChipModel,
  getFirmsListHideNoSat,
  hydrateFirmsListHideNoSat,
  normalizeFirmsListHideNoSat,
  readFirmsListHideNoSat,
  resetFirmsListHideNoSatForTest,
  setFirmsListHideNoSat,
  writeFirmsListHideNoSat,
} from './firmsListSatFilter.js';
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

resetFirmsListHideNoSatForTest();

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

test('Off keeps missing + present', () => {
  resetFirmsListHideNoSatForTest();
  assert.equal(normalizeFirmsListHideNoSat(undefined), DEFAULT_FIRMS_LIST_HIDE_NO_SAT);
  assert.equal(normalizeFirmsListHideNoSat(null), false);
  assert.equal(DEFAULT_FIRMS_LIST_HIDE_NO_SAT, false);
  assert.equal(FIRMS_LIST_HIDE_NO_SAT_CHIP_LABEL, 'Hide no satellite');
  assert.equal(FIRMS_LIST_HIDE_NO_SAT_CHIP_ID, 'hide-no-sat');

  const mixed = [
    fire({ id: 'n20', satellite: 'N20', sensor: 'VIIRS' }),
    fire({ id: 'blank', satellite: '', sensor: '' }),
    fire({ id: 'missing', satellite: undefined, sensor: undefined }),
    fire({ id: 'ws', satellite: '   ', sensor: '  ' }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoSat(mixed, false).map((row) => row.id),
    ['n20', 'blank', 'missing', 'ws'],
  );
  assert.equal(fireMeetsListHideNoSat({ satellite: '', sensor: '' }, false), true);
  assert.equal(fireMeetsListHideNoSat({ satellite: 'N20' }, false), true);

  const listed = listNearestFires(mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false);
  assert.equal(listed.length, 4);
  assert.deepEqual(listed.map((row) => row.id).sort(), ['blank', 'missing', 'n20', 'ws']);
});

test('On drops empty/whitespace, keeps N20 / VIIRS', () => {
  resetFirmsListHideNoSatForTest();
  assert.equal(fireHasListSatellite({ satellite: 'N20', sensor: '' }), true);
  assert.equal(fireHasListSatellite({ satellite: '', sensor: 'VIIRS' }), true);
  assert.equal(fireHasListSatellite({ satellite: 'NOAA-20' }), true);
  assert.equal(fireListSatelliteLabel({ satellite: 'N20' }), 'N20');
  assert.equal(fireListSatelliteLabel({ satellite: '', sensor: 'VIIRS' }), 'VIIRS');
  assert.equal(fireListSatelliteLabel({ satellite: '   ', sensor: '  ' }), '');
  assert.equal(fireListSatelliteLabel({ satellite: '', sensor: '' }), '');
  assert.equal(fireListSatelliteLabel({}), '');

  assert.equal(fireMeetsListHideNoSat({ satellite: 'N20' }, true), true);
  assert.equal(fireMeetsListHideNoSat({ satellite: '', sensor: 'VIIRS' }, true), true);
  assert.equal(fireMeetsListHideNoSat({ satellite: '', sensor: '' }, true), false);
  assert.equal(fireMeetsListHideNoSat({ satellite: '   ', sensor: '  ' }, true), false);
  assert.equal(fireMeetsListHideNoSat({ satellite: undefined, sensor: undefined }, true), false);
  assert.equal(fireMeetsListHideNoSat({}, true), false);

  const mixed = [
    fire({ id: 'n20', satellite: 'N20', sensor: '' }),
    fire({ id: 'viirs', satellite: '', sensor: 'VIIRS' }),
    fire({ id: 'blank', satellite: '', sensor: '' }),
    fire({ id: 'ws', satellite: '   ', sensor: '\t' }),
    fire({ id: 'missing' , satellite: undefined, sensor: undefined }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoSat(mixed, true).map((row) => row.id),
    ['n20', 'viirs'],
  );
  const listed = listNearestFires(mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, true);
  assert.deepEqual(listed.map((row) => row.id).sort(), ['n20', 'viirs']);
  assert.ok(!listed.some((row) => row.id === 'blank' || row.id === 'ws' || row.id === 'missing'));
});

test('Selected id always kept', () => {
  resetFirmsListHideNoSatForTest();
  const unlabeled = fire({ id: 'keep-me', satellite: '', sensor: '', lat: 31 });
  assert.equal(fireMeetsListHideNoSat(unlabeled, true, { selectedId: 'keep-me' }), true);
  assert.equal(fireMeetsListHideNoSat(unlabeled, true, { selectedId: 'other' }), false);
  assert.deepEqual(
    filterFiresByListHideNoSat(
      [unlabeled, fire({ id: 'n20', satellite: 'N20' })],
      true,
      { selectedId: 'keep-me' },
    ).map((row) => row.id),
    ['keep-me', 'n20'],
  );

  const selected = fire({ satellite: '', sensor: '', lat: 40, lon: -74 });
  const selectedId = fireDetectionKey(selected);
  const listed = listNearestFires(
    [selected, fire({ index: 1, satellite: 'N20', sensor: 'VIIRS' })],
    ORIGIN,
    FIRMS_LIST_LIMIT,
    'all',
    'all',
    selectedId,
    'all',
    NOW,
    true,
  );
  assert.equal(listed.some((row) => row.id === selectedId), true);
  assert.equal(fireListSatelliteLabel(listed.find((row) => row.id === selectedId)), '');

  setFirmsListSelectedId(selectedId);
  const fromSession = listNearestFires(
    [selected, fire({ index: 2, satellite: 'N20', lat: 30.3 })],
    ORIGIN,
    FIRMS_LIST_LIMIT,
    'all',
    'all',
    undefined,
    'all',
    NOW,
    true,
  );
  assert.equal(fromSession.some((row) => row.id === selectedId), true);
  setFirmsListSelectedId(null);
  resetFirmsListHideNoSatForTest();
});

test('Invalid storage reads as off', () => {
  resetFirmsListHideNoSatForTest();
  assert.equal(FIRMS_LIST_HIDE_NO_SAT_STORAGE_KEY, 'meridian.firmsListHideNoSat');
  assert.equal(readFirmsListHideNoSat(memoryStorage()), DEFAULT_FIRMS_LIST_HIDE_NO_SAT);
  assert.equal(readFirmsListHideNoSat(memoryStorage({ [FIRMS_LIST_HIDE_NO_SAT_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readFirmsListHideNoSat(memoryStorage({ [FIRMS_LIST_HIDE_NO_SAT_STORAGE_KEY]: 'yes' })), false);
  assert.equal(readFirmsListHideNoSat(memoryStorage({ [FIRMS_LIST_HIDE_NO_SAT_STORAGE_KEY]: 'on' })), false);
  assert.equal(readFirmsListHideNoSat(memoryStorage({ [FIRMS_LIST_HIDE_NO_SAT_STORAGE_KEY]: '2' })), false);
  assert.equal(normalizeFirmsListHideNoSat('nope'), null);
  assert.equal(normalizeFirmsListHideNoSat('1'), true);
  assert.equal(normalizeFirmsListHideNoSat('0'), false);
});

test('Persist flip survives reload', () => {
  resetFirmsListHideNoSatForTest();
  const storage = memoryStorage();
  assert.equal(readFirmsListHideNoSat(storage), DEFAULT_FIRMS_LIST_HIDE_NO_SAT);
  assert.equal(setFirmsListHideNoSat(true, { storage }), true);
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_SAT_STORAGE_KEY), '1');
  assert.equal(getFirmsListHideNoSat(), true);
  assert.equal(readFirmsListHideNoSat(memoryStorage(storage.snapshot())), true);

  resetFirmsListHideNoSatForTest();
  assert.equal(getFirmsListHideNoSat(), DEFAULT_FIRMS_LIST_HIDE_NO_SAT);
  assert.equal(hydrateFirmsListHideNoSat(storage), true);
  assert.equal(getFirmsListHideNoSat(), true);

  setFirmsListHideNoSat(false, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_SAT_STORAGE_KEY), '0');
  resetFirmsListHideNoSatForTest();
  assert.equal(hydrateFirmsListHideNoSat(memoryStorage(storage.snapshot())), false);
  writeFirmsListHideNoSat(true, storage);
  resetFirmsListHideNoSatForTest();
  assert.equal(hydrateFirmsListHideNoSat(storage), true);
  assert.equal(storage.snapshot()['meridian.firmsListConf'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListFrp'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListAge'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsSat'], undefined);

  resetFirmsListHideNoSatForTest();
  setFirmsListHideNoSat(true, { storage });
  resetFirmsListHideNoSatForTest();
  hydrateFirmsListHideNoSat(storage);
  const rows = listNearestFires([
    fire({ satellite: '', sensor: '' }),
    fire({ index: 1, lat: 31, satellite: 'N20', sensor: 'VIIRS' }),
  ], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW);
  assert.equal(getFirmsListHideNoSat(), true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].satellite, 'N20');
  resetFirmsListHideNoSatForTest();
});

test('AND with 210 confidence, 219 FRP, 225 age before the cap', () => {
  resetFirmsListHideNoSatForTest();
  const fires = [];
  for (let i = 0; i < 80; i += 1) {
    const unlabeled = i < 50;
    const laterLow = i >= 50 && i < 65;
    fires.push(fire({
      index: i,
      lat: 30.27 + i * 0.2,
      lon: -97.74,
      // First 50 are unlabeled so a post-cap filter would starve labeled rows.
      satellite: unlabeled ? '' : 'N20',
      sensor: unlabeled ? '' : 'VIIRS',
      acqMs: laterLow ? NOW - 12 * H : NOW - MIN20,
      frp: laterLow ? 1 : 100,
      confidence: laterLow ? 0.3 : 0.9,
    }));
  }
  const off = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false);
  assert.equal(off.length, 50);
  assert.ok(off.every((row) => fireListSatelliteLabel(row) === ''));

  const on = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, true);
  assert.equal(on.length, 30);
  assert.ok(on.every((row) => fireHasListSatellite(row)));
  assert.equal(on[0].lat, 30.27 + 50 * 0.2);

  const andAll = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'high', '10', null, '6', NOW, true);
  assert.equal(andAll.length, 15);
  assert.ok(andAll.every((row) => (
    fireHasListSatellite(row)
    && row.frp >= 10
    && row.confidence >= 0.75
    && NOW - row.acqMs < 6 * H
  )));
});

test('formatFireListRow still prints satelliteShortName or sensor', () => {
  assert.match(formatFireListRow(fire({ satellite: 'N20', sensor: '' }), ORIGIN, NOW).detail, /N20/);
  assert.match(formatFireListRow(fire({ satellite: '', sensor: 'VIIRS' }), ORIGIN, NOW).detail, /VIIRS/);
  assert.doesNotMatch(formatFireListRow(fire({ satellite: '', sensor: '' }), ORIGIN, NOW).detail, /N20|VIIRS/);
});

test('toggle chip is Hide no satellite and defaults inactive', () => {
  resetFirmsListHideNoSatForTest();
  const off = firmsListHideNoSatChipModel();
  assert.equal(off.label, 'Hide no satellite');
  assert.equal(off.active, false);
  assert.equal(off.group, 'ListSat');
  assert.deepEqual(off.params, { firmsListHideNoSat: true });
  const on = firmsListHideNoSatChipModel(true);
  assert.equal(on.active, true);
  assert.deepEqual(on.params, { firmsListHideNoSat: false });
  const controls = getRowControls();
  assert.equal(controls.hideNoSat.label, 'Hide no satellite');
  assert.equal(controls.hideNoSat.active, false);
  setFirmsListHideNoSat(true, { persist: false });
  assert.equal(getRowControls().hideNoSat.active, true);
  resetFirmsListHideNoSatForTest();
});

test('resolveFireListView off matches the unfiltered list and keeps the NASA acknowledgement', () => {
  const fires = [
    fire({ satellite: 'N20' }),
    fire({ index: 1, lat: 40, lon: -74, satellite: '', sensor: '' }),
  ];
  const off = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    listConf: 'all',
    listFrp: 'all',
    listAge: 'all',
    hideNoSat: false,
  });
  const implicit = resolveFireListView({ fires, camera: ORIGIN, now: NOW, hideNoSat: false });
  assert.equal(off.status, 'ready');
  assert.equal(off.rows.length, 2);
  assert.equal(implicit.rows.length, 2);
  assert.equal(off.acknowledgement, FIRMS_ACKNOWLEDGEMENT);
  assert.match(FIRMS_ACKNOWLEDGEMENT, /NASA's Fire Information for Resource Management System \(FIRMS\)/);

  const hidden = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    hideNoSat: true,
  });
  assert.equal(hidden.rows.length, 1);
  assert.match(hidden.rows[0].detail, /N20/);
});

test('LayerStateCoordinator restore keeps the toggle and does not write a share URL', () => {
  resetFirmsListHideNoSatForTest();
  const storage = memoryStorage();
  setFirmsListHideNoSat(true, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_SAT_STORAGE_KEY), '1');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['local-firms'],
    options: { 'local-firms': { satelliteFilter: 'N20' } },
  }));
  assert.doesNotMatch(encoded.toString(), /firmsListHideNoSat|meridian\.firmsListHideNoSat/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetFirmsListHideNoSatForTest();
  assert.equal(getFirmsListHideNoSat(), DEFAULT_FIRMS_LIST_HIDE_NO_SAT);
  assert.equal(hydrateFirmsListHideNoSat(storage), true);
  assert.equal(getFirmsListHideNoSat(), true);
  resetFirmsListHideNoSatForTest();
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
  assert.doesNotMatch(markup[0], /id="fires-list-sat-chips"|data-firms-list-hide-no-sat|Hide no satellite/);
  assert.ok(
    markup[0].indexOf('id="fires-area-chips"') < markup[0].indexOf('id="fires-list-conf-chips"'),
    '226 pixel-area chips stay ahead of the list filters',
  );
  assert.ok(
    markup[0].indexOf('id="fires-list-age-chips"') < markup[0].indexOf('id="fires-list-meta"'),
    '225 list age chips stay on the FIRES panel',
  );
  assert.match(markup[0], /NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.doesNotMatch(ui, /firmsListHideNoSat|setFirmsListHideNoSat|hydrateFirmsListHideNoSat|_initFirmsListSat|data-firms-list-hide-no-sat/);
  assert.match(list, /fireMeetsListHideNoSat|getFirmsListHideNoSat/);
  assert.match(list, /hydrateFirmsListHideNoSat|firmsListHideNoSatChipModel/);
  assert.match(list, /getRowControls/);
  assert.match(list, /hideNoSat/);
  assert.doesNotMatch(heatmap, /firmsListHideNoSat|listHideNoSat|FIRMS_LIST_HIDE_NO_SAT/);
  assert.match(heatmap, /getRowControls|firmsHideNoSatelliteChipModel/);
  assert.doesNotMatch(adapt, /firmsListHideNoSat|listHideNoSat/);
  assert.doesNotMatch(csv, /firmsListHideNoSat|listHideNoSat/);
  assert.doesNotMatch(layerState, /firmsListHideNoSat|listHideNoSat/);
  assert.match(changelog, /meridian\.firmsListHideNoSat/);
  assert.match(changelog, /Hide no satellite/);
  assert.doesNotMatch(list, /firms\.modaps\.eosdis\.nasa\.gov/);
  assert.doesNotMatch(list, /from '\.\/firmsHeatmap\.js'|from '\.\/firmsAdapt\.js'|from '\.\/firmsCsv\.js'/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/listSat.js')), false);
  assert.match(heatmap, /satelliteFilter|firmsSatelliteChipModels/);
});
