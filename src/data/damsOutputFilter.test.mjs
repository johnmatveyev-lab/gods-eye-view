// PLAN 205 — Dam output-floor chips. Client-only filter of the bundled OSM snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAM_OUTPUT_FLOOR_CHIPS,
  DAM_OUTPUT_STORAGE_KEY,
  DEFAULT_DAM_OUTPUT_FLOOR,
  damMeetsOutputFloor,
  damOutputFloorMw,
  damOutputRaw,
  damsOutputChipModels,
  filterDamsByOutputFloor,
  normalizeDamOutputFloor,
  parseDamOutputMw,
  readDamOutputFloor,
  writeDamOutputFloor,
} from './damsOutputFilter.js';
import { getContextStore } from './contextStore.js';
import { listDamsInView } from './damsList.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

const AUSTIN_VIEW = Object.freeze({
  west: -98.0,
  south: 30.1,
  east: -97.5,
  north: 30.5,
  centerLat: 30.2672,
  centerLon: -97.7431,
});

const PODLUBNIK = Object.freeze({
  id: '-19953989',
  label: 'HE Podlubnik - Centrala',
  latitude: 30.28,
  longitude: -97.74,
  visible: true,
  output: '330KW',
});

const NAGHLU = Object.freeze({
  id: '-19754263',
  label: 'Naghlu',
  latitude: 30.30,
  longitude: -97.75,
  visible: true,
  output: '100 MW',
});

const ITAIPU = Object.freeze({
  id: '-19685440',
  label: 'Usina Hidrelétrica de Itaipu',
  latitude: 30.32,
  longitude: -97.76,
  visible: true,
  output: '14000 MW',
});

const UNTAGGED = Object.freeze({
  id: 'dam-unknown',
  label: 'Untagged dam',
  latitude: 30.26,
  longitude: -97.73,
  visible: true,
});

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    snapshot: () => ({ ...data }),
  };
}

function bundledOutputByName(needle) {
  const lines = src('src/data/local_data/dams/dams.geojsonl').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const feature = JSON.parse(line);
    const name = String(feature?.properties?.name || '');
    if (name.includes(needle)) return feature.properties.output;
  }
  return null;
}

test('normalizeDamOutputFloor: All / 10 / 100 only; anything else is All', () => {
  assert.equal(DEFAULT_DAM_OUTPUT_FLOOR, 'all');
  assert.equal(normalizeDamOutputFloor('all'), 'all');
  assert.equal(normalizeDamOutputFloor(0), 'all');
  assert.equal(normalizeDamOutputFloor('0'), 'all');
  assert.equal(normalizeDamOutputFloor(10), '10');
  assert.equal(normalizeDamOutputFloor('10'), '10');
  assert.equal(normalizeDamOutputFloor(100), '100');
  assert.equal(normalizeDamOutputFloor('100'), '100');
  assert.equal(normalizeDamOutputFloor('50'), 'all');
  assert.equal(normalizeDamOutputFloor('1000'), 'all');
  assert.equal(normalizeDamOutputFloor(undefined), 'all');
  assert.equal(normalizeDamOutputFloor(null), 'all');
  assert.deepEqual(DAM_OUTPUT_FLOOR_CHIPS.map((chip) => chip.id), ['all', '10', '100']);
  assert.deepEqual(DAM_OUTPUT_FLOOR_CHIPS.map((chip) => chip.label), ['All', '10+ MW', '100+ MW']);
  assert.equal(damOutputFloorMw('all'), 0);
  assert.equal(damOutputFloorMw('10'), 10);
  assert.equal(damOutputFloorMw('100'), 100);
});

test('parseDamOutputMw: KW/1000, MW as-is; yes and junk stay unparseable', () => {
  assert.equal(parseDamOutputMw('330KW'), 0.33);
  assert.equal(parseDamOutputMw('948 kW'), 0.948);
  assert.equal(parseDamOutputMw('100 MW'), 100);
  assert.equal(parseDamOutputMw('14000 MW'), 14000);
  assert.equal(parseDamOutputMw('233.1 MW'), 233.1);
  assert.equal(parseDamOutputMw('16 MW;yes'), 16);
  assert.equal(parseDamOutputMw('yes'), null);
  assert.equal(parseDamOutputMw(''), null);
  assert.equal(parseDamOutputMw(null), null);
  assert.equal(parseDamOutputMw(undefined), null);
});

test('bundled snapshot already carries 330KW / 100 MW / Itaipu-class 14000 MW', () => {
  assert.equal(bundledOutputByName('Podlubnik'), '330KW');
  assert.equal(bundledOutputByName('Itaipu'), '14000 MW');
  assert.equal(parseDamOutputMw(bundledOutputByName('نغلو')), 100);
  const localGeojson = src('src/data/localGeojson.js');
  assert.match(localGeojson, /props\.output \? `\$\{layerTitle\(layerId\)\} \$\{props\.output\}`/);
  assert.doesNotMatch(localGeojson, /damOutput|damsOutputFilter|meridian\.damOutput/);
});

test('All keeps the current in-view list; 10+ MW hides sub-10 MW; 100+ MW keeps Itaipu-class', () => {
  const records = [PODLUBNIK, NAGHLU, ITAIPU, UNTAGGED];
  const all = listDamsInView({ enabled: true, records, view: AUSTIN_VIEW });
  const filteredAll = listDamsInView({
    enabled: true, records, view: AUSTIN_VIEW, outputFloor: 'all',
  });
  assert.deepEqual(all.map((site) => site.id), filteredAll.map((site) => site.id));
  assert.deepEqual(new Set(all.map((site) => site.id)), new Set([
    UNTAGGED.id, PODLUBNIK.id, NAGHLU.id, ITAIPU.id,
  ]));

  const ten = listDamsInView({
    enabled: true, records, view: AUSTIN_VIEW, outputFloor: '10',
  });
  assert.deepEqual(new Set(ten.map((site) => site.id)), new Set([UNTAGGED.id, NAGHLU.id, ITAIPU.id]));
  assert.equal(ten.some((site) => site.id === PODLUBNIK.id), false);

  const hundred = listDamsInView({
    enabled: true, records, view: AUSTIN_VIEW, outputFloor: '100',
  });
  assert.deepEqual(new Set(hundred.map((site) => site.id)), new Set([UNTAGGED.id, NAGHLU.id, ITAIPU.id]));
  assert.equal(hundred.some((site) => site.label.includes('Itaipu')), true);
  assert.equal(damMeetsOutputFloor(ITAIPU, '100'), true);
  assert.equal(damMeetsOutputFloor(PODLUBNIK, '10'), false);
  assert.equal(damMeetsOutputFloor(NAGHLU, '100'), true);
});

test('missing, unparseable, and yes output stay visible at every floor', () => {
  const yes = { output: 'yes' };
  const missing = {};
  const nulled = { output: null };
  const empty = { output: '' };
  assert.equal(damMeetsOutputFloor(missing, '10'), true);
  assert.equal(damMeetsOutputFloor(nulled, '100'), true);
  assert.equal(damMeetsOutputFloor(empty, '100'), true);
  assert.equal(damMeetsOutputFloor(yes, '10'), true);
  assert.equal(damMeetsOutputFloor(yes, '100'), true);
  assert.deepEqual(
    filterDamsByOutputFloor([missing, PODLUBNIK, yes, ITAIPU], '10').map((row) => row.output ?? row.id),
    [undefined, 'yes', '14000 MW'],
  );
});

test('properties.output and already-registered context output both match', () => {
  const viaProps = { id: 'via-props', properties: { output: '330KW' } };
  assert.equal(damOutputRaw(viaProps), '330KW');
  assert.equal(damMeetsOutputFloor(viaProps, '10'), false);

  const originalWindow = globalThis.window;
  globalThis.window = globalThis.window || {};
  try {
    const store = getContextStore();
    store.entities.set('local-dams:-19685440', {
      properties: { output: '14000 MW' },
    });
    assert.equal(damOutputRaw({ id: '-19685440' }), '14000 MW');
    assert.equal(damMeetsOutputFloor({ id: '-19685440' }, '100'), true);
    store.entities.delete('local-dams:-19685440');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('meridian.damOutput persists and a flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(DAM_OUTPUT_STORAGE_KEY, 'meridian.damOutput');
  assert.equal(readDamOutputFloor(storage), DEFAULT_DAM_OUTPUT_FLOOR);
  assert.equal(writeDamOutputFloor('10', storage), '10');
  assert.equal(storage.getItem(DAM_OUTPUT_STORAGE_KEY), '10');
  assert.equal(readDamOutputFloor(storage), '10');
  assert.equal(writeDamOutputFloor('100', storage), '100');
  assert.equal(storage.getItem(DAM_OUTPUT_STORAGE_KEY), '100');
  const reloaded = memoryStorage(storage.snapshot());
  assert.equal(readDamOutputFloor(reloaded), '100');
  writeDamOutputFloor('all', storage);
  assert.equal(storage.getItem(DAM_OUTPUT_STORAGE_KEY), 'all');
  assert.equal(Object.keys(storage.snapshot()).join(','), DAM_OUTPUT_STORAGE_KEY);
});

test('exclusive chips are All | 10+ MW | 100+ MW and write damOutput', () => {
  const models = damsOutputChipModels();
  assert.deepEqual(models.map((chip) => chip.label), ['All', '10+ MW', '100+ MW']);
  assert.deepEqual(models.map((chip) => chip.params.damOutput), ['all', '10', '100']);
  assert.equal(models[0].active, true);
  assert.equal(models.every((chip) => chip.group === 'Output'), true);
  assert.deepEqual(damsOutputChipModels('100').map((chip) => chip.active), [false, false, true]);
});

test('list chips sit on the dams in-view surface; persist is local; no share-URL or /api', () => {
  const html = src('index.html');
  const ui = src('src/ui.js');
  const list = src('src/data/damsList.js');
  const helper = src('src/data/damsOutputFilter.js');
  const layerState = src('src/data/layerState.js');
  const firstRun = src('src/firstRunExperience.js');
  const localGeojson = src('src/data/localGeojson.js');
  const panel = html.match(/<div id="dams-in-view"[\s\S]*?<p class="in-view-site-list-credit"/);
  assert.ok(panel, 'dams-in-view markup is missing');
  assert.match(panel[0], /id="dams-output-chips"/);
  assert.match(panel[0], /data-dam-output="all"[^>]*>All</);
  assert.match(panel[0], /data-dam-output="10"[^>]*>10\+ MW</);
  assert.match(panel[0], /data-dam-output="100"[^>]*>100\+ MW</);
  assert.ok(
    panel[0].indexOf('id="dams-output-chips"') < panel[0].indexOf('id="dams-in-view-items"'),
    'output chips sit above the in-view items',
  );
  assert.match(ui, /data-dam-output/);
  assert.match(ui, /writeDamOutputFloor|readDamOutputFloor/);
  assert.match(list, /damMeetsOutputFloor|filterDamsByOutputFloor|outputFloor/);
  assert.match(helper, /meridian\.damOutput/);
  assert.doesNotMatch(helper, /fetch\s*\(/);
  assert.doesNotMatch(list, /fetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\/dams/);
  assert.doesNotMatch(helper, /hideNoOperator/);
  assert.doesNotMatch(list, /hideNoOperator|local-datacenters/);
  assert.doesNotMatch(layerState, /damOutput|damsOutput/);
  assert.match(layerState, /id: 'local-dams', token: 'q', disposition: 'enabled-only'/);
  assert.match(firstRun, /meridian\.damOutput/);
  assert.doesNotMatch(firstRun, /writeDamOutputFloor|setDamOutputFloor/);
  assert.doesNotMatch(localGeojson, /damOutput|damsOutputFilter/);
  assert.equal(existsSync(path.join(ROOT, 'api/dams.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/dams/output.js')), false);
});
