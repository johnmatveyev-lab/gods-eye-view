// PLAN 260 — FIRMS list Hide no day/night toggle. Client-only hide-missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIRMS_LIST_HIDE_NO_DAYNIGHT,
  FIRMS_LIST_HIDE_NO_DAYNIGHT_CHIP_ID,
  FIRMS_LIST_HIDE_NO_DAYNIGHT_CHIP_LABEL,
  FIRMS_LIST_HIDE_NO_DAYNIGHT_STORAGE_KEY,
  filterFiresByListHideNoDaynight,
  fireHasListDaynight,
  fireListDaynightLabel,
  fireMeetsListHideNoDaynight,
  firmsListHideNoDaynightChipModel,
  getFirmsListHideNoDaynight,
  hydrateFirmsListHideNoDaynight,
  normalizeFirmsListHideNoDaynight,
  readFirmsListHideNoDaynight,
  resetFirmsListHideNoDaynightForTest,
  setFirmsListHideNoDaynight,
  writeFirmsListHideNoDaynight,
} from './firmsListHideNoDaynightFilter.js';
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

resetFirmsListHideNoDaynightForTest();

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

test('Off keeps empty daynight', () => {
  resetFirmsListHideNoDaynightForTest();
  assert.equal(normalizeFirmsListHideNoDaynight(undefined), DEFAULT_FIRMS_LIST_HIDE_NO_DAYNIGHT);
  assert.equal(normalizeFirmsListHideNoDaynight(null), false);
  assert.equal(DEFAULT_FIRMS_LIST_HIDE_NO_DAYNIGHT, false);
  assert.equal(FIRMS_LIST_HIDE_NO_DAYNIGHT_CHIP_LABEL, 'Hide no day/night');
  assert.equal(FIRMS_LIST_HIDE_NO_DAYNIGHT_CHIP_ID, 'hide-no-daynight');

  const mixed = [
    fire({ id: 'day', daynight: 'D' }),
    fire({ id: 'night', daynight: 'N' }),
    fire({ id: 'blank', daynight: '' }),
    fire({ id: 'missing', daynight: undefined }),
    fire({ id: 'ws', daynight: '   ' }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoDaynight(mixed, false).map((row) => row.id),
    ['day', 'night', 'blank', 'missing', 'ws'],
  );
  assert.equal(fireMeetsListHideNoDaynight({ daynight: '' }, false), true);
  assert.equal(fireMeetsListHideNoDaynight({ daynight: 'D' }, false), true);
  assert.equal(fireMeetsListHideNoDaynight({ daynight: 'N' }, false), true);

  const listed = listNearestFires(mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, false, false);
  assert.equal(listed.length, 5);
  assert.deepEqual(listed.map((row) => row.id).sort(), ['blank', 'day', 'missing', 'night', 'ws']);
});

test('On keeps D and N and drops empty', () => {
  resetFirmsListHideNoDaynightForTest();
  assert.equal(fireHasListDaynight({ daynight: 'D' }), true);
  assert.equal(fireHasListDaynight({ daynight: 'N' }), true);
  assert.equal(fireHasListDaynight({ daynight: ' D ' }), true);
  assert.equal(fireHasListDaynight({ daynight: ' N ' }), true);
  assert.equal(fireHasListDaynight({ satellite: 'N20', daynight: '' }), false);
  assert.equal(fireListDaynightLabel({ daynight: 'D' }), 'D');
  assert.equal(fireListDaynightLabel({ daynight: 'N' }), 'N');
  assert.equal(fireListDaynightLabel({ satellite: 'N20', daynight: '' }), '');
  assert.equal(fireListDaynightLabel({ daynight: '   ' }), '');
  assert.equal(fireListDaynightLabel({ daynight: '' }), '');
  assert.equal(fireListDaynightLabel({}), '');

  assert.equal(fireMeetsListHideNoDaynight({ daynight: 'D' }, true), true);
  assert.equal(fireMeetsListHideNoDaynight({ daynight: 'N' }, true), true);
  assert.equal(fireMeetsListHideNoDaynight({ daynight: ' D ' }, true), true);
  assert.equal(fireMeetsListHideNoDaynight({ satellite: 'N20', daynight: '' }, true), false);
  assert.equal(fireMeetsListHideNoDaynight({ daynight: '' }, true), false);
  assert.equal(fireMeetsListHideNoDaynight({ daynight: '   ' }, true), false);
  assert.equal(fireMeetsListHideNoDaynight({ daynight: undefined }, true), false);
  assert.equal(fireMeetsListHideNoDaynight({}, true), false);
  assert.equal(fireMeetsListHideNoDaynight({ daynight: 'X' }, true), false);
  assert.equal(fireMeetsListHideNoDaynight({ night: true }, true), false, 'boolean night is not list D/N');

  const mixed = [
    fire({ id: 'day', daynight: 'D' }),
    fire({ id: 'night', daynight: 'N' }),
    fire({ id: 'sat-only', satellite: 'N20', daynight: '' }),
    fire({ id: 'blank', daynight: '' }),
    fire({ id: 'ws', daynight: '\t' }),
    fire({ id: 'missing', daynight: undefined }),
    fire({ id: 'x', daynight: 'X' }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoDaynight(mixed, true).map((row) => row.id),
    ['day', 'night'],
  );
  const listed = listNearestFires(mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, false, true);
  assert.deepEqual(listed.map((row) => row.id).sort(), ['day', 'night']);
  assert.ok(!listed.some((row) => (
    row.id === 'blank' || row.id === 'ws' || row.id === 'missing' || row.id === 'sat-only' || row.id === 'x'
  )));
});

test('Selected id always kept', () => {
  resetFirmsListHideNoDaynightForTest();
  const unlabeled = fire({ id: 'keep-me', daynight: '', lat: 31 });
  assert.equal(fireMeetsListHideNoDaynight(unlabeled, true, { selectedId: 'keep-me' }), true);
  assert.equal(fireMeetsListHideNoDaynight(unlabeled, true, { selectedId: 'other' }), false);
  assert.deepEqual(
    filterFiresByListHideNoDaynight(
      [unlabeled, fire({ id: 'day', daynight: 'D' })],
      true,
      { selectedId: 'keep-me' },
    ).map((row) => row.id),
    ['keep-me', 'day'],
  );

  const selected = fire({ daynight: '', lat: 40, lon: -74 });
  const selectedId = fireDetectionKey(selected);
  const listed = listNearestFires(
    [selected, fire({ index: 1, daynight: 'D' })],
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
    true,
  );
  assert.equal(listed.some((row) => row.id === selectedId), true);
  assert.equal(fireListDaynightLabel(listed.find((row) => row.id === selectedId)), '');

  setFirmsListSelectedId(selectedId);
  const fromSession = listNearestFires(
    [selected, fire({ index: 2, daynight: 'N', lat: 30.3 })],
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
    true,
  );
  assert.equal(fromSession.some((row) => row.id === selectedId), true);
  setFirmsListSelectedId(null);
  resetFirmsListHideNoDaynightForTest();
});

test('Invalid storage reads as off', () => {
  resetFirmsListHideNoDaynightForTest();
  assert.equal(FIRMS_LIST_HIDE_NO_DAYNIGHT_STORAGE_KEY, 'meridian.firmsListHideNoDaynight');
  assert.equal(readFirmsListHideNoDaynight(memoryStorage()), DEFAULT_FIRMS_LIST_HIDE_NO_DAYNIGHT);
  assert.equal(readFirmsListHideNoDaynight(memoryStorage({ [FIRMS_LIST_HIDE_NO_DAYNIGHT_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readFirmsListHideNoDaynight(memoryStorage({ [FIRMS_LIST_HIDE_NO_DAYNIGHT_STORAGE_KEY]: 'yes' })), false);
  assert.equal(readFirmsListHideNoDaynight(memoryStorage({ [FIRMS_LIST_HIDE_NO_DAYNIGHT_STORAGE_KEY]: 'on' })), false);
  assert.equal(readFirmsListHideNoDaynight(memoryStorage({ [FIRMS_LIST_HIDE_NO_DAYNIGHT_STORAGE_KEY]: '2' })), false);
  assert.equal(normalizeFirmsListHideNoDaynight('nope'), null);
  assert.equal(normalizeFirmsListHideNoDaynight('1'), true);
  assert.equal(normalizeFirmsListHideNoDaynight('0'), false);
});

test('Persist flip survives reload', () => {
  resetFirmsListHideNoDaynightForTest();
  const storage = memoryStorage();
  assert.equal(readFirmsListHideNoDaynight(storage), DEFAULT_FIRMS_LIST_HIDE_NO_DAYNIGHT);
  assert.equal(setFirmsListHideNoDaynight(true, { storage }), true);
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_DAYNIGHT_STORAGE_KEY), '1');
  assert.equal(getFirmsListHideNoDaynight(), true);
  assert.equal(readFirmsListHideNoDaynight(memoryStorage(storage.snapshot())), true);

  resetFirmsListHideNoDaynightForTest();
  assert.equal(getFirmsListHideNoDaynight(), DEFAULT_FIRMS_LIST_HIDE_NO_DAYNIGHT);
  assert.equal(hydrateFirmsListHideNoDaynight(storage), true);
  assert.equal(getFirmsListHideNoDaynight(), true);

  setFirmsListHideNoDaynight(false, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_DAYNIGHT_STORAGE_KEY), '0');
  resetFirmsListHideNoDaynightForTest();
  assert.equal(hydrateFirmsListHideNoDaynight(memoryStorage(storage.snapshot())), false);
  writeFirmsListHideNoDaynight(true, storage);
  resetFirmsListHideNoDaynightForTest();
  assert.equal(hydrateFirmsListHideNoDaynight(storage), true);
  assert.equal(storage.snapshot()['meridian.firmsListConf'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListFrp'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListAge'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoSat'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoSensor'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoVersion'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsHideNoDaynight'], undefined);

  resetFirmsListHideNoDaynightForTest();
  setFirmsListHideNoDaynight(true, { storage });
  resetFirmsListHideNoDaynightForTest();
  hydrateFirmsListHideNoDaynight(storage);
  const rows = listNearestFires([
    fire({ daynight: '' }),
    fire({ index: 1, lat: 31, daynight: 'N' }),
  ], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW);
  assert.equal(getFirmsListHideNoDaynight(), true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].daynight, 'N');
  resetFirmsListHideNoDaynightForTest();
});

test('AND with 210 confidence, 219 FRP, 225 age, 230 hide-no-sat, 252 hide-no-sensor, and 256 hide-no-version before the cap', () => {
  resetFirmsListHideNoDaynightForTest();
  const fires = [];
  for (let i = 0; i < 80; i += 1) {
    const unlabeled = i < 50;
    const laterLow = i >= 50 && i < 65;
    fires.push(fire({
      index: i,
      lat: 30.27 + i * 0.2,
      lon: -97.74,
      // First 50 are unlabeled so a post-cap filter would starve D/N rows.
      satellite: unlabeled ? '' : 'N20',
      sensor: unlabeled ? '' : 'VIIRS',
      version: unlabeled ? '' : 'C6.1',
      daynight: unlabeled ? '' : (i % 2 === 0 ? 'D' : 'N'),
      acqMs: laterLow ? NOW - 12 * H : NOW - MIN20,
      frp: laterLow ? 1 : 100,
      confidence: laterLow ? 0.3 : 0.9,
    }));
  }
  const off = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, false, false);
  assert.equal(off.length, 50);
  assert.ok(off.every((row) => fireListDaynightLabel(row) === ''));

  const on = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, false, true);
  assert.equal(on.length, 30);
  assert.ok(on.every((row) => fireHasListDaynight(row)));
  assert.equal(on[0].lat, 30.27 + 50 * 0.2);

  const andAll = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'high', '10', null, '6', NOW, true, true, true, true);
  assert.equal(andAll.length, 15);
  assert.ok(andAll.every((row) => (
    fireHasListDaynight(row)
    && fireHasListVersion(row)
    && fireHasListSensor(row)
    && fireHasListSatellite(row)
    && row.frp >= 10
    && row.confidence >= 0.75
    && NOW - row.acqMs < 6 * H
  )));

  const priorOnly = fire({ id: 'prior', satellite: 'N20', sensor: 'VIIRS', version: 'C6.1', daynight: '' });
  const labeled = fire({ id: 'day', index: 1, lat: 31, daynight: 'D' });
  const priorOnDaynightOff = listNearestFires(
    [priorOnly, labeled], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, true, true, true, false,
  );
  assert.deepEqual(priorOnDaynightOff.map((row) => row.id).sort(), ['day', 'prior']);
  const allOn = listNearestFires(
    [priorOnly, labeled], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, true, true, true, true,
  );
  assert.deepEqual(allOn.map((row) => row.id), ['day']);
});

test('formatFireListRow still prints satelliteShortName or sensor', () => {
  assert.match(formatFireListRow(fire({ satellite: 'N20', sensor: '' }), ORIGIN, NOW).detail, /N20/);
  assert.match(formatFireListRow(fire({ satellite: '', sensor: 'VIIRS' }), ORIGIN, NOW).detail, /VIIRS/);
  assert.doesNotMatch(formatFireListRow(fire({ satellite: '', sensor: '' }), ORIGIN, NOW).detail, /N20|VIIRS/);
});

test('toggle chip is Hide no day/night and defaults inactive', () => {
  resetFirmsListHideNoDaynightForTest();
  const off = firmsListHideNoDaynightChipModel();
  assert.equal(off.label, 'Hide no day/night');
  assert.equal(off.active, false);
  assert.equal(off.group, 'ListDaynight');
  assert.deepEqual(off.params, { firmsListHideNoDaynight: true });
  const on = firmsListHideNoDaynightChipModel(true);
  assert.equal(on.active, true);
  assert.deepEqual(on.params, { firmsListHideNoDaynight: false });
  const controls = getRowControls();
  assert.equal(controls.listHideNoDaynight.label, 'Hide no day/night');
  assert.equal(controls.listHideNoDaynight.active, false);
  assert.equal(controls.listHideNoVersion.label, 'Hide no version');
  assert.equal(controls.hideNoSensor.label, 'Hide no sensor');
  assert.equal(controls.hideNoSat.label, 'Hide no satellite');
  setFirmsListHideNoDaynight(true, { persist: false });
  assert.equal(getRowControls().listHideNoDaynight.active, true);
  assert.equal(getRowControls().listHideNoVersion.active, false);
  assert.equal(getRowControls().hideNoSensor.active, false);
  assert.equal(getRowControls().hideNoSat.active, false);
  resetFirmsListHideNoDaynightForTest();
});

test('resolveFireListView off matches the unfiltered list and keeps the NASA acknowledgement', () => {
  const fires = [
    fire({ daynight: 'D' }),
    fire({ index: 1, lat: 40, lon: -74, daynight: '' }),
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
  });
  const implicit = resolveFireListView({ fires, camera: ORIGIN, now: NOW, listHideNoDaynight: false });
  assert.equal(off.status, 'ready');
  assert.equal(off.rows.length, 2);
  assert.equal(implicit.rows.length, 2);
  assert.equal(off.acknowledgement, FIRMS_ACKNOWLEDGEMENT);
  assert.match(FIRMS_ACKNOWLEDGEMENT, /NASA's Fire Information for Resource Management System \(FIRMS\)/);

  const hidden = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    listHideNoDaynight: true,
  });
  assert.equal(hidden.rows.length, 1);
  assert.match(hidden.rows[0].title, /120 MW/);
});

test('LayerStateCoordinator restore keeps the toggle and does not write a share URL', () => {
  resetFirmsListHideNoDaynightForTest();
  const storage = memoryStorage();
  setFirmsListHideNoDaynight(true, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_DAYNIGHT_STORAGE_KEY), '1');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['local-firms'],
    options: { 'local-firms': { satelliteFilter: 'N20' } },
  }));
  assert.doesNotMatch(encoded.toString(), /firmsListHideNoDaynight|meridian\.firmsListHideNoDaynight/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetFirmsListHideNoDaynightForTest();
  assert.equal(getFirmsListHideNoDaynight(), DEFAULT_FIRMS_LIST_HIDE_NO_DAYNIGHT);
  assert.equal(hydrateFirmsListHideNoDaynight(storage), true);
  assert.equal(getFirmsListHideNoDaynight(), true);
  resetFirmsListHideNoDaynightForTest();
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
  assert.doesNotMatch(markup[0], /id="fires-list-daynight-chips"|data-firms-list-hide-no-daynight|Hide no day\/night/);
  assert.ok(
    markup[0].indexOf('id="fires-area-chips"') < markup[0].indexOf('id="fires-list-conf-chips"'),
    '226 pixel-area chips stay ahead of the list filters',
  );
  assert.ok(
    markup[0].indexOf('id="fires-list-age-chips"') < markup[0].indexOf('id="fires-list-meta"'),
    '225 list age chips stay on the FIRES panel',
  );
  assert.match(markup[0], /NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.doesNotMatch(ui, /firmsListHideNoDaynight|setFirmsListHideNoDaynight|hydrateFirmsListHideNoDaynight|_initFirmsListDaynight|data-firms-list-hide-no-daynight/);
  assert.match(list, /fireMeetsListHideNoDaynight|getFirmsListHideNoDaynight/);
  assert.match(list, /hydrateFirmsListHideNoDaynight|firmsListHideNoDaynightChipModel/);
  assert.match(list, /getRowControls/);
  assert.match(list, /listHideNoDaynight/);
  assert.match(list, /fireMeetsListHideNoVersion|listHideNoVersion/);
  assert.match(list, /fireMeetsListHideNoSensor|hideNoSensor/);
  assert.match(list, /fireMeetsListHideNoSat|hideNoSat/);
  assert.doesNotMatch(heatmap, /firmsListHideNoDaynight|listHideNoDaynight|FIRMS_LIST_HIDE_NO_DAYNIGHT/);
  assert.match(heatmap, /getRowControls|firmsHideNoDaynightChipModel/);
  assert.doesNotMatch(adapt, /firmsListHideNoDaynight|listHideNoDaynight/);
  assert.doesNotMatch(csv, /firmsListHideNoDaynight|listHideNoDaynight/);
  assert.doesNotMatch(layerState, /firmsListHideNoDaynight|listHideNoDaynight/);
  assert.match(changelog, /meridian\.firmsListHideNoDaynight/);
  assert.match(changelog, /Hide no day\/night/);
  assert.doesNotMatch(list, /firms\.modaps\.eosdis\.nasa\.gov/);
  assert.doesNotMatch(list, /from '\.\/firmsHeatmap\.js'|from '\.\/firmsAdapt\.js'|from '\.\/firmsCsv\.js'|from '\.\/firmsHideNoDaynightFilter\.js'/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/listDaynight.js')), false);
  assert.match(heatmap, /satelliteFilter|firmsSatelliteChipModels/);
});
