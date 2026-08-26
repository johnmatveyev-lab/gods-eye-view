// PLAN 252 — FIRMS list Hide no sensor toggle. Client-only hide-missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIRMS_LIST_HIDE_NO_SENSOR,
  FIRMS_LIST_HIDE_NO_SENSOR_CHIP_ID,
  FIRMS_LIST_HIDE_NO_SENSOR_CHIP_LABEL,
  FIRMS_LIST_HIDE_NO_SENSOR_STORAGE_KEY,
  filterFiresByListHideNoSensor,
  fireHasListSensor,
  fireListSensorLabel,
  fireMeetsListHideNoSensor,
  firmsListHideNoSensorChipModel,
  getFirmsListHideNoSensor,
  hydrateFirmsListHideNoSensor,
  normalizeFirmsListHideNoSensor,
  readFirmsListHideNoSensor,
  resetFirmsListHideNoSensorForTest,
  setFirmsListHideNoSensor,
  writeFirmsListHideNoSensor,
} from './firmsListHideNoSensorFilter.js';
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

resetFirmsListHideNoSensorForTest();

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

test('Off keeps empty sensor', () => {
  resetFirmsListHideNoSensorForTest();
  assert.equal(normalizeFirmsListHideNoSensor(undefined), DEFAULT_FIRMS_LIST_HIDE_NO_SENSOR);
  assert.equal(normalizeFirmsListHideNoSensor(null), false);
  assert.equal(DEFAULT_FIRMS_LIST_HIDE_NO_SENSOR, false);
  assert.equal(FIRMS_LIST_HIDE_NO_SENSOR_CHIP_LABEL, 'Hide no sensor');
  assert.equal(FIRMS_LIST_HIDE_NO_SENSOR_CHIP_ID, 'hide-no-sensor');

  const mixed = [
    fire({ id: 'viirs', sensor: 'VIIRS' }),
    fire({ id: 'blank', sensor: '' }),
    fire({ id: 'missing', sensor: undefined }),
    fire({ id: 'ws', sensor: '   ' }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoSensor(mixed, false).map((row) => row.id),
    ['viirs', 'blank', 'missing', 'ws'],
  );
  assert.equal(fireMeetsListHideNoSensor({ sensor: '' }, false), true);
  assert.equal(fireMeetsListHideNoSensor({ sensor: 'VIIRS' }, false), true);

  const listed = listNearestFires(mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false);
  assert.equal(listed.length, 4);
  assert.deepEqual(listed.map((row) => row.id).sort(), ['blank', 'missing', 'viirs', 'ws']);
});

test('On keeps VIIRS, drops empty', () => {
  resetFirmsListHideNoSensorForTest();
  assert.equal(fireHasListSensor({ sensor: 'VIIRS' }), true);
  assert.equal(fireHasListSensor({ sensor: ' VIIRS ' }), true);
  assert.equal(fireHasListSensor({ sensor: 'MODIS' }), true);
  assert.equal(fireHasListSensor({ satellite: 'N20', sensor: '' }), false);
  assert.equal(fireListSensorLabel({ sensor: 'VIIRS' }), 'VIIRS');
  assert.equal(fireListSensorLabel({ satellite: 'N20', sensor: '' }), '');
  assert.equal(fireListSensorLabel({ sensor: '   ' }), '');
  assert.equal(fireListSensorLabel({ sensor: '' }), '');
  assert.equal(fireListSensorLabel({}), '');

  assert.equal(fireMeetsListHideNoSensor({ sensor: 'VIIRS' }, true), true);
  assert.equal(fireMeetsListHideNoSensor({ sensor: ' VIIRS ' }, true), true);
  assert.equal(fireMeetsListHideNoSensor({ satellite: 'N20', sensor: '' }, true), false);
  assert.equal(fireMeetsListHideNoSensor({ sensor: '' }, true), false);
  assert.equal(fireMeetsListHideNoSensor({ sensor: '   ' }, true), false);
  assert.equal(fireMeetsListHideNoSensor({ sensor: undefined }, true), false);
  assert.equal(fireMeetsListHideNoSensor({}, true), false);

  const mixed = [
    fire({ id: 'viirs', sensor: 'VIIRS' }),
    fire({ id: 'sat-only', satellite: 'N20', sensor: '' }),
    fire({ id: 'blank', sensor: '' }),
    fire({ id: 'ws', sensor: '\t' }),
    fire({ id: 'missing', sensor: undefined }),
  ];
  assert.deepEqual(
    filterFiresByListHideNoSensor(mixed, true).map((row) => row.id),
    ['viirs'],
  );
  const listed = listNearestFires(mixed, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, true);
  assert.deepEqual(listed.map((row) => row.id), ['viirs']);
  assert.ok(!listed.some((row) => row.id === 'blank' || row.id === 'ws' || row.id === 'missing' || row.id === 'sat-only'));
});

test('Selected id always kept', () => {
  resetFirmsListHideNoSensorForTest();
  const unlabeled = fire({ id: 'keep-me', sensor: '', lat: 31 });
  assert.equal(fireMeetsListHideNoSensor(unlabeled, true, { selectedId: 'keep-me' }), true);
  assert.equal(fireMeetsListHideNoSensor(unlabeled, true, { selectedId: 'other' }), false);
  assert.deepEqual(
    filterFiresByListHideNoSensor(
      [unlabeled, fire({ id: 'viirs', sensor: 'VIIRS' })],
      true,
      { selectedId: 'keep-me' },
    ).map((row) => row.id),
    ['keep-me', 'viirs'],
  );

  const selected = fire({ sensor: '', lat: 40, lon: -74 });
  const selectedId = fireDetectionKey(selected);
  const listed = listNearestFires(
    [selected, fire({ index: 1, sensor: 'VIIRS' })],
    ORIGIN,
    FIRMS_LIST_LIMIT,
    'all',
    'all',
    selectedId,
    'all',
    NOW,
    false,
    true,
  );
  assert.equal(listed.some((row) => row.id === selectedId), true);
  assert.equal(fireListSensorLabel(listed.find((row) => row.id === selectedId)), '');

  setFirmsListSelectedId(selectedId);
  const fromSession = listNearestFires(
    [selected, fire({ index: 2, sensor: 'VIIRS', lat: 30.3 })],
    ORIGIN,
    FIRMS_LIST_LIMIT,
    'all',
    'all',
    undefined,
    'all',
    NOW,
    false,
    true,
  );
  assert.equal(fromSession.some((row) => row.id === selectedId), true);
  setFirmsListSelectedId(null);
  resetFirmsListHideNoSensorForTest();
});

test('Invalid storage reads as off', () => {
  resetFirmsListHideNoSensorForTest();
  assert.equal(FIRMS_LIST_HIDE_NO_SENSOR_STORAGE_KEY, 'meridian.firmsListHideNoSensor');
  assert.equal(readFirmsListHideNoSensor(memoryStorage()), DEFAULT_FIRMS_LIST_HIDE_NO_SENSOR);
  assert.equal(readFirmsListHideNoSensor(memoryStorage({ [FIRMS_LIST_HIDE_NO_SENSOR_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readFirmsListHideNoSensor(memoryStorage({ [FIRMS_LIST_HIDE_NO_SENSOR_STORAGE_KEY]: 'yes' })), false);
  assert.equal(readFirmsListHideNoSensor(memoryStorage({ [FIRMS_LIST_HIDE_NO_SENSOR_STORAGE_KEY]: 'on' })), false);
  assert.equal(readFirmsListHideNoSensor(memoryStorage({ [FIRMS_LIST_HIDE_NO_SENSOR_STORAGE_KEY]: '2' })), false);
  assert.equal(normalizeFirmsListHideNoSensor('nope'), null);
  assert.equal(normalizeFirmsListHideNoSensor('1'), true);
  assert.equal(normalizeFirmsListHideNoSensor('0'), false);
});

test('Persist flip survives reload', () => {
  resetFirmsListHideNoSensorForTest();
  const storage = memoryStorage();
  assert.equal(readFirmsListHideNoSensor(storage), DEFAULT_FIRMS_LIST_HIDE_NO_SENSOR);
  assert.equal(setFirmsListHideNoSensor(true, { storage }), true);
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_SENSOR_STORAGE_KEY), '1');
  assert.equal(getFirmsListHideNoSensor(), true);
  assert.equal(readFirmsListHideNoSensor(memoryStorage(storage.snapshot())), true);

  resetFirmsListHideNoSensorForTest();
  assert.equal(getFirmsListHideNoSensor(), DEFAULT_FIRMS_LIST_HIDE_NO_SENSOR);
  assert.equal(hydrateFirmsListHideNoSensor(storage), true);
  assert.equal(getFirmsListHideNoSensor(), true);

  setFirmsListHideNoSensor(false, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_SENSOR_STORAGE_KEY), '0');
  resetFirmsListHideNoSensorForTest();
  assert.equal(hydrateFirmsListHideNoSensor(memoryStorage(storage.snapshot())), false);
  writeFirmsListHideNoSensor(true, storage);
  resetFirmsListHideNoSensorForTest();
  assert.equal(hydrateFirmsListHideNoSensor(storage), true);
  assert.equal(storage.snapshot()['meridian.firmsListConf'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListFrp'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListAge'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsListHideNoSat'], undefined);
  assert.equal(storage.snapshot()['meridian.firmsHideNoSensor'], undefined);

  resetFirmsListHideNoSensorForTest();
  setFirmsListHideNoSensor(true, { storage });
  resetFirmsListHideNoSensorForTest();
  hydrateFirmsListHideNoSensor(storage);
  const rows = listNearestFires([
    fire({ sensor: '' }),
    fire({ index: 1, lat: 31, sensor: 'VIIRS' }),
  ], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW);
  assert.equal(getFirmsListHideNoSensor(), true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sensor, 'VIIRS');
  resetFirmsListHideNoSensorForTest();
});

test('AND with 210 confidence, 219 FRP, 225 age, and 230 hide-no-sat before the cap', () => {
  resetFirmsListHideNoSensorForTest();
  const fires = [];
  for (let i = 0; i < 80; i += 1) {
    const unlabeled = i < 50;
    const laterLow = i >= 50 && i < 65;
    fires.push(fire({
      index: i,
      lat: 30.27 + i * 0.2,
      lon: -97.74,
      // First 50 are unlabeled so a post-cap filter would starve named sensors.
      satellite: unlabeled ? '' : 'N20',
      sensor: unlabeled ? '' : 'VIIRS',
      acqMs: laterLow ? NOW - 12 * H : NOW - MIN20,
      frp: laterLow ? 1 : 100,
      confidence: laterLow ? 0.3 : 0.9,
    }));
  }
  const off = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, false);
  assert.equal(off.length, 50);
  assert.ok(off.every((row) => fireListSensorLabel(row) === ''));

  const on = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, false, true);
  assert.equal(on.length, 30);
  assert.ok(on.every((row) => fireHasListSensor(row)));
  assert.equal(on[0].lat, 30.27 + 50 * 0.2);

  const andAll = listNearestFires(fires, ORIGIN, FIRMS_LIST_LIMIT, 'high', '10', null, '6', NOW, true, true);
  assert.equal(andAll.length, 15);
  assert.ok(andAll.every((row) => (
    fireHasListSensor(row)
    && fireHasListSatellite(row)
    && row.frp >= 10
    && row.confidence >= 0.75
    && NOW - row.acqMs < 6 * H
  )));

  const satOnly = fire({ id: 'sat-only', satellite: 'N20', sensor: '' });
  const named = fire({ id: 'viirs', index: 1, lat: 31, sensor: 'VIIRS' });
  const satOnSensorOff = listNearestFires(
    [satOnly, named], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, true, false,
  );
  assert.deepEqual(satOnSensorOff.map((row) => row.id).sort(), ['sat-only', 'viirs']);
  const bothOn = listNearestFires(
    [satOnly, named], ORIGIN, FIRMS_LIST_LIMIT, 'all', 'all', null, 'all', NOW, true, true,
  );
  assert.deepEqual(bothOn.map((row) => row.id), ['viirs']);
});

test('formatFireListRow still prints satelliteShortName or sensor', () => {
  assert.match(formatFireListRow(fire({ satellite: 'N20', sensor: '' }), ORIGIN, NOW).detail, /N20/);
  assert.match(formatFireListRow(fire({ satellite: '', sensor: 'VIIRS' }), ORIGIN, NOW).detail, /VIIRS/);
  assert.doesNotMatch(formatFireListRow(fire({ satellite: '', sensor: '' }), ORIGIN, NOW).detail, /N20|VIIRS/);
});

test('toggle chip is Hide no sensor and defaults inactive', () => {
  resetFirmsListHideNoSensorForTest();
  const off = firmsListHideNoSensorChipModel();
  assert.equal(off.label, 'Hide no sensor');
  assert.equal(off.active, false);
  assert.equal(off.group, 'ListSensor');
  assert.deepEqual(off.params, { firmsListHideNoSensor: true });
  const on = firmsListHideNoSensorChipModel(true);
  assert.equal(on.active, true);
  assert.deepEqual(on.params, { firmsListHideNoSensor: false });
  const controls = getRowControls();
  assert.equal(controls.hideNoSensor.label, 'Hide no sensor');
  assert.equal(controls.hideNoSensor.active, false);
  assert.equal(controls.hideNoSat.label, 'Hide no satellite');
  setFirmsListHideNoSensor(true, { persist: false });
  assert.equal(getRowControls().hideNoSensor.active, true);
  assert.equal(getRowControls().hideNoSat.active, false);
  resetFirmsListHideNoSensorForTest();
});

test('resolveFireListView off matches the unfiltered list and keeps the NASA acknowledgement', () => {
  const fires = [
    fire({ satellite: '', sensor: 'VIIRS' }),
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
    hideNoSensor: false,
  });
  const implicit = resolveFireListView({ fires, camera: ORIGIN, now: NOW, hideNoSensor: false });
  assert.equal(off.status, 'ready');
  assert.equal(off.rows.length, 2);
  assert.equal(implicit.rows.length, 2);
  assert.equal(off.acknowledgement, FIRMS_ACKNOWLEDGEMENT);
  assert.match(FIRMS_ACKNOWLEDGEMENT, /NASA's Fire Information for Resource Management System \(FIRMS\)/);

  const hidden = resolveFireListView({
    fires,
    camera: ORIGIN,
    now: NOW,
    hideNoSensor: true,
  });
  assert.equal(hidden.rows.length, 1);
  assert.match(hidden.rows[0].detail, /VIIRS/);
});

test('LayerStateCoordinator restore keeps the toggle and does not write a share URL', () => {
  resetFirmsListHideNoSensorForTest();
  const storage = memoryStorage();
  setFirmsListHideNoSensor(true, { storage });
  assert.equal(storage.getItem(FIRMS_LIST_HIDE_NO_SENSOR_STORAGE_KEY), '1');

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['local-firms'],
    options: { 'local-firms': { satelliteFilter: 'N20' } },
  }));
  assert.doesNotMatch(encoded.toString(), /firmsListHideNoSensor|meridian\.firmsListHideNoSensor/);
  assert.ok(typeof LayerStateCoordinator === 'function');

  resetFirmsListHideNoSensorForTest();
  assert.equal(getFirmsListHideNoSensor(), DEFAULT_FIRMS_LIST_HIDE_NO_SENSOR);
  assert.equal(hydrateFirmsListHideNoSensor(storage), true);
  assert.equal(getFirmsListHideNoSensor(), true);
  resetFirmsListHideNoSensorForTest();
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
  assert.doesNotMatch(markup[0], /id="fires-list-sensor-chips"|data-firms-list-hide-no-sensor|Hide no sensor/);
  assert.ok(
    markup[0].indexOf('id="fires-area-chips"') < markup[0].indexOf('id="fires-list-conf-chips"'),
    '226 pixel-area chips stay ahead of the list filters',
  );
  assert.ok(
    markup[0].indexOf('id="fires-list-age-chips"') < markup[0].indexOf('id="fires-list-meta"'),
    '225 list age chips stay on the FIRES panel',
  );
  assert.match(markup[0], /NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.doesNotMatch(ui, /firmsListHideNoSensor|setFirmsListHideNoSensor|hydrateFirmsListHideNoSensor|_initFirmsListSensor|data-firms-list-hide-no-sensor/);
  assert.match(list, /fireMeetsListHideNoSensor|getFirmsListHideNoSensor/);
  assert.match(list, /hydrateFirmsListHideNoSensor|firmsListHideNoSensorChipModel/);
  assert.match(list, /getRowControls/);
  assert.match(list, /hideNoSensor/);
  assert.match(list, /fireMeetsListHideNoSat|hideNoSat/);
  assert.doesNotMatch(heatmap, /firmsListHideNoSensor|listHideNoSensor|FIRMS_LIST_HIDE_NO_SENSOR/);
  assert.match(heatmap, /getRowControls|firmsHideNoSensorChipModel/);
  assert.doesNotMatch(adapt, /firmsListHideNoSensor|listHideNoSensor/);
  assert.doesNotMatch(csv, /firmsListHideNoSensor|listHideNoSensor/);
  assert.doesNotMatch(layerState, /firmsListHideNoSensor|listHideNoSensor/);
  assert.match(changelog, /meridian\.firmsListHideNoSensor/);
  assert.match(changelog, /Hide no sensor/);
  assert.doesNotMatch(list, /firms\.modaps\.eosdis\.nasa\.gov/);
  assert.doesNotMatch(list, /from '\.\/firmsHeatmap\.js'|from '\.\/firmsAdapt\.js'|from '\.\/firmsCsv\.js'|from '\.\/firmsHideNoSensorFilter\.js'/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/listSensor.js')), false);
  assert.match(heatmap, /satelliteFilter|firmsSatelliteChipModels/);
});
