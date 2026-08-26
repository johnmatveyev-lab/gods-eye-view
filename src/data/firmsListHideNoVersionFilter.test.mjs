// PLAN 256 — FIRMS list Hide no version toggle. Client-only hide-missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIRMS_LIST_HIDE_NO_VERSION,
  FIRMS_LIST_HIDE_NO_VERSION_CHIP_ID,
  FIRMS_LIST_HIDE_NO_VERSION_CHIP_LABEL,
  FIRMS_LIST_HIDE_NO_VERSION_STORAGE_KEY,
  filterFiresByListHideNoVersion,
  fireHasListVersion,
  fireListVersionLabel,
  fireMeetsListHideNoVersion,
  firmsListHideNoVersionChipModel,
  getFirmsListHideNoVersion,
  hydrateFirmsListHideNoVersion,
  normalizeFirmsListHideNoVersion,
  readFirmsListHideNoVersion,
  resetFirmsListHideNoVersionForTest,
  setFirmsListHideNoVersion,
  writeFirmsListHideNoVersion,
} from './firmsListHideNoVersionFilter.js';
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

resetFirmsListHideNoVersionForTest();

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

test('Off keeps empty version', () => {
  resetFirmsListHideNoVersionForTest();
  assert.equal(normalizeFirmsListHideNoVersion(undefined), DEFAULT_FIRMS_LIST_HIDE_NO_VERSION);
  assert.equal(normalizeFirmsListHideNoVersion(null), false);
  assert.equal(DEFAULT_FIRMS_LIST_HIDE_NO_VERSION, false);
  assert.equal(FIRMS_LIST_HIDE_NO_VERSION_CHIP_LABEL, 'Hide no version');
  assert.equal(FIRMS_LIST_HIDE_NO_VERSION_CHIP_ID, 'hide-no-version');

  const mixed = [
    fire({ id: 'c61', version: 'C6.1' }),
    fire({ id: 'blank', version: '' }),
    fire({ id: 'missing', version: undefined }),
    fire({ id: 'ws', version: '   ' }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoVersion(mixed, false).map((row) => row.id),
    ['c61', 'blank', 'missing', 'ws'],
  );
  assert.equal(fireMeetsListHideNoVersion({ version: '' }, false), true);
  assert.equal(fireMeetsListHideNoVersion({ version: 'C6.1' }, false), true);

  const listed = listNearestFires(mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, false);
  assert.equal(listed.length, 4);
  assert.deepEqual(listed.map((row) => row.id).sort(), ['blank', 'c61', 'missing', 'ws']);
});

test('On keeps C6.1 and drops empty', () => {
  resetFirmsListHideNoVersionForTest();
  assert.equal(fireHasListVersion({ version: 'C6.1' }), true);
  assert.equal(fireHasListVersion({ version: ' C6.1 ' }), true);
  assert.equal(fireHasListVersion({ version: '2.0NRT' }), true);
  assert.equal(fireHasListVersion({ satellite: 'N20', version: '' }), false);
  assert.equal(fireListVersionLabel({ version: 'C6.1' }), 'C6.1');
  assert.equal(fireListVersionLabel({ satellite: 'N20', version: '' }), '');
  assert.equal(fireListVersionLabel({ version: '   ' }), '');
  assert.equal(fireListVersionLabel({ version: '' }), '');
  assert.equal(fireListVersionLabel({}), '');

  assert.equal(fireMeetsListHideNoVersion({ version: 'C6.1' }, true), true);
  assert.equal(fireMeetsListHideNoVersion({ version: ' C6.1 ' }, true), true);
  assert.equal(fireMeetsListHideNoVersion({ satellite: 'N20', version: '' }, true), false);
  assert.equal(fireMeetsListHideNoVersion({ version: '' }, true), false);
  assert.equal(fireMeetsListHideNoVersion({ version: '   ' }, true), false);
  assert.equal(fireMeetsListHideNoVersion({ version: undefined }, true), false);
  assert.equal(fireMeetsListHideNoVersion({}, true), false);

  const mixed = [
    fire({ id: 'c61', version: 'C6.1' }),
    fire({ id: 'sat-only', satellite: 'N20', version: '' }),
    fire({ id: 'blank', version: '' }),
    fire({ id: 'ws', version: '\t' }),
    fire({ id: 'missing', version: undefined }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoVersion(mixed, true).map((row) => row.id),
    ['c61'],
  );
  const listed = listNearestFires(mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, true);
  assert.deepEqual(listed.map((row) => row.id), ['c61']);
  assert.ok(!listed.some((row) => row.id === 'blank' || row.id === 'ws' || row.id === 'missing' || row.id === 'sat-only'));
});

test('Selected id always kept', () => {
  resetFirmsListHideNoVersionForTest();
  const unlabeled = fire({ id: 'keep-me', version: '', lat: 31 });
  assert.equal(fireMeetsListHideNoVersion(unlabeled, true, { selectedId: 'keep-me' }), true);
  assert.equal(fireMeetsListHideNoVersion(unlabeled, true, { selectedId: 'other' }), false);
  assert.deepEqual(
    filterFiresByListHideNoVersion(
      [unlabeled, fire({ id: 'c61', version: 'C6.1' })],
      true,
      { selectedId: 'keep-me' },
    ).map((row) => row.id),
    ['keep-me', 'c61'],
  );

  const selected = fire({ version: '', lat: 40, lon: -74 });
  const selectedId = fireDetectionKey(selected);
  const listed = listNearestFires(
    [selected, fire({ index: 1, version: 'C6.1' })],
    ORIGIN,
    FIRMS_LIST_LIMIT,
    'all',
    'all',
    selectedId,
    'all',
    NOW,
    false,
    false,
    true,
  );
  assert.equal(listed.some((row) => row.id === selectedId), true);
  assert.equal(fireListVersionLabel(listed.find((row) => row.id === selectedId)), '');

  setFirmsListSelectedId(selectedId);
  const fromSession = listNearestFires(
    [selected, fire({ index: 2, version: 'C6.1', lat: 30.3 })],
    ORIGIN,
    FIRMS_LIST_LIMIT,
    'all',
    'all',
    undefined,
    'all',
    NOW,
    false,
    false,
    true,
  );
  assert.equal(fromSession.some((row) => row.id === selectedId), true);
  setFirmsListSelectedId(null);
  resetFirmsListHideNoVersionForTest();
});

test('Invalid storage reads as off', () => {
  resetFirmsListHideNoVersionForTest();
  assert.equal(FIRMS_LIST_HIDE_NO_VERSION_STORAGE_KEY, 'meridian.firmsListHideNoVersion');
  assert.equal(readFirmsListHideNoVersion(memoryStorage()), DEFAULT_FIRMS_LIST_HIDE_NO_VERSION);
  assert.equal(readFirmsListHideNoVersion(memoryStorage({ [FIRMS_LIST_HIDE_NO_VERSION_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readFirmsListHideNoVersion(memoryStorage({ [FIRMS_LIST_HIDE_NO_VERSION_STORAGE_KEY]: 'yes' })), false);
  assert.equal(readFirmsListHideNoVersion(memoryStorage({ [FIRMS_LIST_HIDE_NO_VERSION_STORAGE_KEY]: 'on' })), false);
  assert.equal(readFirmsListHideNoVersion(memoryStorage({ [FIRMS_LIST_HIDE_NO_VERSION_STORAGE_KEY]: '2' })), false);
  assert.equal(normalizeFirmsListHideNoVersion('nope'), null);
  assert.equal(normalizeFirmsListHideNoVersion('1'), true);
  assert.equal(normalizeFirmsListHideNoVersion('0'), false);
});

test('Persist flip survives reload', () => {
  resetFirmsListHideNoVersionForTest();
  const storage = memoryStorage();
  assert.equal(readFirmsListHideNoVersion(storage), DEFAULT_FIRMS_LIST_HIDE_NO_VERSION);
  assert.equal(setFirmsListHideNoVersion(true, { storage }), true);
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_VERSION_STORAGE_KEY), '1');
  assert.equal(getFirmsListHideNoVersion(), true);
  assert.equal(readFirmsListHideNoVersion(memoryStorage(storage.snapshot())), true);

  resetFirmsListHideNoVersionForTest();
  assert.equal(getFirmsListHideNoVersion(), DEFAULT_FIRMS_LIST_HIDE_NO_VERSION);
  assert.equal(hydrateFirmsListHideNoVersion(storage), true);
  assert.equal(getFirmsListHideNoVersion(), true);

  setFirmsListHideNoVersion(false, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_VERSION_STORAGE_KEY), '0');
  resetFirmsListHideNoVersionForTest();
  assert.equal(hydrateFirmsListHideNoVersion(memoryStorage(storage.snapshot())), false);
  writeFirmsListHideNoVersion(true, storage);
  resetFirmsListHideNoVersionForTest();
  assert.equal(hydrateFirmsListHideNoVersion(storage), true);
  assert.equal(storage.snapshot()['meridian.firmsListConf'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListFrp'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListAge'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoSat'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoSensor'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsHideNoVersion'], undefined);

  resetFirmsListHideNoVersionForTest();
  setFirmsListHideNoVersion(true, { storage });
  resetFirmsListHideNoVersionForTest();
  hydrateFirmsListHideNoVersion(storage);
  const rows = listNearestFires([
    fire({ version: '' }),
    fire({ index: 1, lat: 31, version: 'C6.1' }),
  ], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW);
  assert.equal(getFirmsListHideNoVersion(), true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version, 'C6.1');
  resetFirmsListHideNoVersionForTest();
});

test('AND with 210 confidence, 219 FRP, 225 age, 230 hide-no-sat, and 252 hide-no-sensor before the cap', () => {
  resetFirmsListHideNoVersionForTest();
  const fires = [];
  for (let i = 0; i < 80; i += 1) {
    const unlabeled = i < 50;
    const laterLow = i >= 50 && i < 65;
    fires.push(fire({
      index: i,
      lat: 30.27 + i * 0.2,
      lon: -97.74,
      // First 50 are unlabeled so a post-cap filter would starve named versions.
      satellite: unlabeled ? '' : 'N20',
      sensor: unlabeled ? '' : 'VIIRS',
      version: unlabeled ? '' : 'C6.1',
      acqMs: laterLow ? NOW - 12 * H : NOW - MIN20,
      frp: laterLow ? 1 : 100,
      confidence: laterLow ? 0.3 : 0.9,
    }));
  }
  const off = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, false);
  assert.equal(off.length, 50);
  assert.ok(off.every((row) => fireListVersionLabel(row) === ''));

  const on = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false, true);
  assert.equal(on.length, 30);
  assert.ok(on.every((row) => fireHasListVersion(row)));
  assert.equal(on[0].lat, 30.27 + 50 * 0.2);

  const andAll = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'high', '10', null, '6', NOW, true, true, true);
  assert.equal(andAll.length, 15);
  assert.ok(andAll.every((row) => (
    fireHasListVersion(row)
    && fireHasListSensor(row)
    && fireHasListSatellite(row)
    && row.frp >= 10
    && row.confidence >= 0.75
    && NOW - row.acqMs < 6 * H
  )));

  const satSensorOnly = fire({ id: 'sat-sensor', satellite: 'N20', sensor: 'VIIRS', version: '' });
  const named = fire({ id: 'c61', index: 1, lat: 31, version: 'C6.1' });
  const priorOnVersionOff = listNearestFires(
    [satSensorOnly, named], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, true, true, false,
  );
  assert.deepEqual(priorOnVersionOff.map((row) => row.id).sort(), ['c61', 'sat-sensor']);
  const allOn = listNearestFires(
    [satSensorOnly, named], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, true, true, true,
  );
  assert.deepEqual(allOn.map((row) => row.id), ['c61']);
});

test('formatFireListRow still prints satelliteShortName or sensor', () => {
  assert.match(formatFireListRow(fire({ satellite: 'N20', sensor: '' }), ORIGIN, NOW).detail, /N20/);
  assert.match(formatFireListRow(fire({ satellite: '', sensor: 'VIIRS' }), ORIGIN, NOW).detail, /VIIRS/);
  assert.doesNotMatch(formatFireListRow(fire({ satellite: '', sensor: '' }), ORIGIN, NOW).detail, /N20|VIIRS/);
});

test('toggle chip is Hide no version and defaults inactive', () => {
  resetFirmsListHideNoVersionForTest();
  const off = firmsListHideNoVersionChipModel();
  assert.equal(off.label, 'Hide no version');
  assert.equal(off.active, false);
  assert.equal(off.group, 'ListVersion');
  assert.deepEqual(off.params, { firmsListHideNoVersion: true });
  const on = firmsListHideNoVersionChipModel(true);
  assert.equal(on.active, true);
  assert.deepEqual(on.params, { firmsListHideNoVersion: false });
  const controls = getRowControls();
  assert.equal(controls.listHideNoVersion.label, 'Hide no version');
  assert.equal(controls.listHideNoVersion.active, false);
  assert.equal(controls.hideNoSensor.label, 'Hide no sensor');
  assert.equal(controls.hideNoSat.label, 'Hide no satellite');
  setFirmsListHideNoVersion(true, { persist: false });
  assert.equal(getRowControls().listHideNoVersion.active, true);
  assert.equal(getRowControls().hideNoSensor.active, false);
  assert.equal(getRowControls().hideNoSat.active, false);
  resetFirmsListHideNoVersionForTest();
});

test('resolveFireListView off matches the unfiltered list and keeps the NASA acknowledgement', () => {
  const fires = [
    fire({ version: 'C6.1' }),
    fire({ index: 1, lat: 40, lon: -74, version: '' }),
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
  });
  const implicit = resolveFireListView({ fires, camera: ORIGIN, now: NOW, listHideNoVersion: false });
  assert.equal(off.status, 'ready');
  assert.equal(off.rows.length, 2);
  assert.equal(implicit.rows.length, 2);
  assert.equal(off.acknowledgement, FIRMS_ACKNOWLEDGEMENT);
  assert.match(FIRMS_ACKNOWLEDGEMENT, /NASA's Fire Information for Resource Management System \(FIRMS\)/);

  const hidden = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    listHideNoVersion: true,
  });
  assert.equal(hidden.rows.length, 1);
  assert.match(hidden.rows[0].title, /120 MW/);
});

test('LayerStateCoordinator restore keeps the toggle and does not write a share URL', () => {
  resetFirmsListHideNoVersionForTest();
  const storage = memoryStorage();
  setFirmsListHideNoVersion(true, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_VERSION_STORAGE_KEY), '1');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['local-firms'],
    options: { 'local-firms': { satelliteFilter: 'N20' } },
  }));
  assert.doesNotMatch(encoded.toString(), /firmsListHideNoVersion|meridian\.firmsListHideNoVersion/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetFirmsListHideNoVersionForTest();
  assert.equal(getFirmsListHideNoVersion(), DEFAULT_FIRMS_LIST_HIDE_NO_VERSION);
  assert.equal(hydrateFirmsListHideNoVersion(storage), true);
  assert.equal(getFirmsListHideNoVersion(), true);
  resetFirmsListHideNoVersionForTest();
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
  assert.doesNotMatch(markup[0], /id="fires-list-version-chips"|data-firms-list-hide-no-version|Hide no version/);
  assert.ok(
    markup[0].indexOf('id="fires-area-chips"') < markup[0].indexOf('id="fires-list-conf-chips"'),
    '226 pixel-area chips stay ahead of the list filters',
  );
  assert.ok(
    markup[0].indexOf('id="fires-list-age-chips"') < markup[0].indexOf('id="fires-list-meta"'),
    '225 list age chips stay on the FIRES panel',
  );
  assert.match(markup[0], /NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.doesNotMatch(ui, /firmsListHideNoVersion|setFirmsListHideNoVersion|hydrateFirmsListHideNoVersion|_initFirmsListVersion|data-firms-list-hide-no-version/);
  assert.match(list, /fireMeetsListHideNoVersion|getFirmsListHideNoVersion/);
  assert.match(list, /hydrateFirmsListHideNoVersion|firmsListHideNoVersionChipModel/);
  assert.match(list, /getRowControls/);
  assert.match(list, /listHideNoVersion/);
  assert.match(list, /fireMeetsListHideNoSensor|hideNoSensor/);
  assert.match(list, /fireMeetsListHideNoSat|hideNoSat/);
  assert.doesNotMatch(heatmap, /firmsListHideNoVersion|listHideNoVersion|FIRMS_LIST_HIDE_NO_VERSION/);
  assert.match(heatmap, /getRowControls|firmsHideNoVersionChipModel/);
  assert.doesNotMatch(adapt, /firmsListHideNoVersion|listHideNoVersion/);
  assert.doesNotMatch(csv, /firmsListHideNoVersion|listHideNoVersion/);
  assert.doesNotMatch(layerState, /firmsListHideNoVersion|listHideNoVersion/);
  assert.match(changelog, /meridian\.firmsListHideNoVersion/);
  assert.match(changelog, /Hide no version/);
  assert.doesNotMatch(list, /firms\.modaps\.eosdis\.nasa\.gov/);
  assert.doesNotMatch(list, /from '\.\/firmsHeatmap\.js'|from '\.\/firmsAdapt\.js'|from '\.\/firmsCsv\.js'|from '\.\/firmsHideNoVersionFilter\.js'/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/listVersion.js')), false);
  assert.match(heatmap, /satelliteFilter|firmsSatelliteChipModels/);
});
