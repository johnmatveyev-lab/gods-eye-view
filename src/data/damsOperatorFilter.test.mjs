// PLAN 224 — Dam list Operator only toggle. Client-only filter of the
// already-bundled OSM / ODbL snapshot. Distinct from 205 output-floor
// and 218 Named only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAM_OPERATOR_ONLY_CHIP_LABEL,
  DAM_OPERATOR_ONLY_CHIP_TITLE,
  DAM_OPERATOR_ONLY_STORAGE_KEY,
  DEFAULT_DAM_OPERATOR_ONLY,
  damHasOperator,
  damMatchesOperatorFilter,
  damOperatorRaw,
  damsOperatorOnlyChipModel,
  filterDamsByOperatorOnly,
  normalizeDamOperatorOnly,
  readDamOperatorOnly,
  writeDamOperatorOnly,
} from './damsOperatorFilter.js';
import { filterDamsByNamedOnly } from './damsNamedFilter.js';
import { filterDamsByOutputFloor } from './damsOutputFilter.js';
import { listDamsInView } from './damsList.js';
import { getContextStore } from './contextStore.js';

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

const RECLAMATION = Object.freeze({
  id: 'dam-reclamation',
  label: 'Grand Coulee Dam',
  latitude: 30.28,
  longitude: -97.74,
  visible: true,
  output: '6809 MW',
  operator: 'Reclamation',
});

const MISSING = Object.freeze({
  id: 'dam-missing',
  label: 'Untagged dam',
  latitude: 30.30,
  longitude: -97.75,
  visible: true,
  output: '14000 MW',
});

const EMPTY = Object.freeze({
  id: 'dam-empty-op',
  label: 'Empty operator',
  latitude: 30.32,
  longitude: -97.76,
  visible: true,
  output: '100 MW',
  operator: '',
});

const WHITESPACE = Object.freeze({
  id: 'dam-ws-op',
  label: 'Whitespace operator',
  latitude: 30.26,
  longitude: -97.73,
  visible: true,
  operator: '   ',
});

const SMALL_NAMED = Object.freeze({
  id: 'dam-small',
  label: 'Podlubnik',
  latitude: 30.27,
  longitude: -97.735,
  visible: true,
  output: '330KW',
  operator: 'Reclamation',
});

const FALLBACK_NAMED = Object.freeze({
  id: 'dam-fallback',
  label: 'Dam',
  latitude: 30.29,
  longitude: -97.745,
  visible: true,
  output: '2080 MW',
  operator: 'Reclamation',
});

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.hasOwn(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    snapshot() {
      return { ...data };
    },
  };
}

test('off keeps missing + present', () => {
  assert.equal(DEFAULT_DAM_OPERATOR_ONLY, false);
  assert.equal(DAM_OPERATOR_ONLY_CHIP_LABEL, 'Operator only');
  assert.equal(DAM_OPERATOR_ONLY_CHIP_TITLE, 'Hide dams that have no OSM operator');
  assert.equal(normalizeDamOperatorOnly(undefined), false);
  assert.equal(normalizeDamOperatorOnly(null), false);
  assert.equal(normalizeDamOperatorOnly(''), false);
  assert.equal(normalizeDamOperatorOnly(false), false);
  assert.equal(normalizeDamOperatorOnly(0), false);
  assert.equal(normalizeDamOperatorOnly('0'), false);
  assert.equal(normalizeDamOperatorOnly(true), true);
  assert.equal(normalizeDamOperatorOnly('1'), true);
  assert.equal(normalizeDamOperatorOnly('true'), true);
  assert.equal(normalizeDamOperatorOnly('bogus'), null);

  const records = [RECLAMATION, MISSING, EMPTY, WHITESPACE];
  assert.deepEqual(
    filterDamsByOperatorOnly(records, false).map((row) => row.id),
    records.map((row) => row.id),
  );
  const listed = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorOnly: false,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set(records.map((row) => row.id)));
  assert.ok(listed.some((site) => site.id === MISSING.id));
  assert.ok(listed.some((site) => site.id === RECLAMATION.id));
  assert.equal(damMatchesOperatorFilter(MISSING, false), true);
  assert.deepEqual(filterDamsByOperatorOnly(null), []);
  assert.deepEqual(filterDamsByOperatorOnly(undefined), []);
});

test('on drops empty/whitespace, keeps "Reclamation"', () => {
  assert.equal(damOperatorRaw(RECLAMATION), 'Reclamation');
  assert.equal(damHasOperator(RECLAMATION), true);
  assert.equal(damHasOperator(MISSING), false);
  assert.equal(damHasOperator(EMPTY), false);
  assert.equal(damHasOperator(WHITESPACE), false);
  assert.equal(damMatchesOperatorFilter(RECLAMATION, true), true);
  assert.equal(damMatchesOperatorFilter(MISSING, true), false);
  assert.equal(damMatchesOperatorFilter(EMPTY, true), false);
  assert.equal(damMatchesOperatorFilter(WHITESPACE, true), false);
  assert.equal(damMatchesOperatorFilter({ operator: null }, true), false);

  const kept = filterDamsByOperatorOnly([RECLAMATION, MISSING, EMPTY, WHITESPACE], true);
  assert.deepEqual(kept.map((row) => row.id), [RECLAMATION.id]);

  const listed = listDamsInView({
    enabled: true,
    records: [RECLAMATION, MISSING, EMPTY, WHITESPACE],
    view: AUSTIN_VIEW,
    operatorOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [RECLAMATION.id]);
  assert.equal(listed[0].label, 'Grand Coulee Dam');
});

test('context-store operator counts', () => {
  const viaProps = { id: 'via-props', properties: { operator: 'Reclamation' } };
  assert.equal(damOperatorRaw(viaProps), 'Reclamation');
  assert.equal(damMatchesOperatorFilter(viaProps, true), true);

  const viaTags = { id: 'via-tags', properties: { tags: { operator: 'Reclamation' } } };
  assert.equal(damOperatorRaw(viaTags), 'Reclamation');

  const viaShort = { id: 'via-short', tags: { 'operator:short': 'USBR' } };
  assert.equal(damOperatorRaw(viaShort), 'USBR');
  assert.equal(damMatchesOperatorFilter(viaShort, true), true);

  const originalWindow = globalThis.window;
  globalThis.window = globalThis.window || {};
  try {
    const store = getContextStore();
    store.entities.set('local-dams:-898986', {
      properties: { tags: { operator: 'Reclamation' } },
    });
    assert.equal(damOperatorRaw({ id: '-898986' }), 'Reclamation');
    assert.equal(damHasOperator({ id: '-898986' }), true);
    assert.equal(damMatchesOperatorFilter({ id: '-898986' }, true), true);
    const listed = listDamsInView({
      enabled: true,
      records: [{
        id: '-898986',
        label: 'Grand Coulee Dam',
        latitude: 30.28,
        longitude: -97.74,
        visible: true,
      }, MISSING],
      view: AUSTIN_VIEW,
      operatorOnly: true,
    });
    assert.deepEqual(listed.map((site) => site.id), ['-898986']);
    store.entities.delete('local-dams:-898986');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('selected id always kept', () => {
  assert.equal(
    damMatchesOperatorFilter(MISSING, true, { selectedId: MISSING.id }),
    true,
  );
  assert.deepEqual(
    filterDamsByOperatorOnly([RECLAMATION, MISSING, EMPTY], true, MISSING.id).map((row) => row.id),
    [RECLAMATION.id, MISSING.id],
  );
  const listed = listDamsInView({
    enabled: true,
    records: [RECLAMATION, MISSING, EMPTY],
    view: AUSTIN_VIEW,
    operatorOnly: true,
    selectedId: EMPTY.id,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set([RECLAMATION.id, EMPTY.id]));
});

test('Operator only ANDs with Plan 205 output-floor and Plan 218 Named only', () => {
  const records = [RECLAMATION, MISSING, SMALL_NAMED, FALLBACK_NAMED];
  const afterFloor = filterDamsByOutputFloor(records, '10');
  assert.deepEqual(
    afterFloor.map((row) => row.id),
    [RECLAMATION.id, MISSING.id, FALLBACK_NAMED.id],
    '10+ MW hides the named sub-10 MW plant before Named only / Operator only',
  );
  const afterNamed = filterDamsByNamedOnly(afterFloor, true);
  assert.deepEqual(
    afterNamed.map((row) => row.id),
    [RECLAMATION.id, MISSING.id],
  );
  assert.deepEqual(
    filterDamsByOperatorOnly(afterNamed, true).map((row) => row.id),
    [RECLAMATION.id],
  );

  const listed = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    outputFloor: '10',
    namedOnly: true,
    operatorOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [RECLAMATION.id]);

  const selectedThroughAnd = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    outputFloor: '10',
    namedOnly: true,
    operatorOnly: true,
    selectedId: FALLBACK_NAMED.id,
  });
  assert.deepEqual(
    new Set(selectedThroughAnd.map((site) => site.id)),
    new Set([RECLAMATION.id, FALLBACK_NAMED.id]),
    'selected fallback Dam stays through output floor AND Named only AND Operator only',
  );
});

test('invalid storage reads as off', () => {
  assert.equal(DAM_OPERATOR_ONLY_STORAGE_KEY, 'meridian.damOperatorOnly');
  assert.equal(readDamOperatorOnly(memoryStorage()), false);
  assert.equal(readDamOperatorOnly(memoryStorage({ [DAM_OPERATOR_ONLY_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readDamOperatorOnly(memoryStorage({ [DAM_OPERATOR_ONLY_STORAGE_KEY]: 'bogus' })), false);
  assert.equal(readDamOperatorOnly(memoryStorage({ [DAM_OPERATOR_ONLY_STORAGE_KEY]: '{}' })), false);
  assert.equal(readDamOperatorOnly(memoryStorage({ [DAM_OPERATOR_ONLY_STORAGE_KEY]: '2' })), false);
  assert.equal(readDamOperatorOnly({
    getItem() { throw new Error('blocked'); },
  }), false);
  assert.equal(writeDamOperatorOnly('nope', memoryStorage()), false);
});

test('persist flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(writeDamOperatorOnly(true, storage), true);
  assert.equal(storage.getItem(DAM_OPERATOR_ONLY_STORAGE_KEY), '1');
  assert.equal(readDamOperatorOnly(storage), true);
  const reloaded = memoryStorage(storage.snapshot());
  assert.equal(readDamOperatorOnly(reloaded), true);
  assert.equal(writeDamOperatorOnly(false, storage), true);
  assert.equal(storage.getItem(DAM_OPERATOR_ONLY_STORAGE_KEY), '0');
  assert.equal(readDamOperatorOnly(memoryStorage(storage.snapshot())), false);
  assert.equal(Object.keys(storage.snapshot()).join(','), DAM_OPERATOR_ONLY_STORAGE_KEY);
  assert.equal(damsOperatorOnlyChipModel(false).params.operatorOnly, true);
  assert.equal(damsOperatorOnlyChipModel(true).params.operatorOnly, false);
  assert.equal(damsOperatorOnlyChipModel(false).active, false);
  assert.equal(damsOperatorOnlyChipModel(true).active, true);
});

test('localGeojson.js is unchanged', () => {
  const diff = execSync('git diff -- HEAD -- src/data/localGeojson.js', {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(diff, '', 'Plan 224 must not edit localGeojson.js');
  const localGeojson = src('src/data/localGeojson.js');
  assert.doesNotMatch(localGeojson, /damOperatorOnly|damsOperatorFilter|meridian\.damOperatorOnly/);
});

test('list chip sits on the dams in-view surface; persist is local; no share-URL or /api', () => {
  const html = src('index.html');
  const ui = src('src/ui.js');
  const list = src('src/data/damsList.js');
  const helper = src('src/data/damsOperatorFilter.js');
  const layerState = src('src/data/layerState.js');
  const firstRun = src('src/firstRunExperience.js');
  const sharelink = src('src/sharelink.js');
  const css = src('style.css');
  const panel = html.match(/<div id="dams-in-view"[\s\S]*?<p class="in-view-site-list-credit"/);
  assert.ok(panel, 'dams-in-view markup is missing');
  assert.match(panel[0], /id="dams-output-chips"/);
  assert.match(panel[0], /id="dams-named-chips"/);
  assert.match(panel[0], /id="dams-operator-chips"/);
  assert.match(panel[0], /data-dam-operator="only"[^>]*>Operator only</);
  assert.ok(
    panel[0].indexOf('id="dams-named-chips"') < panel[0].indexOf('id="dams-operator-chips"'),
    'Operator only sits next to Named only',
  );
  assert.ok(
    panel[0].indexOf('id="dams-operator-chips"') < panel[0].indexOf('id="dams-in-view-items"'),
    'Operator only sits above the in-view items',
  );
  assert.match(html, /id="dams-in-view"[\s\S]*?© OpenStreetMap contributors/);
  assert.match(ui, /data-dam-operator/);
  assert.match(ui, /writeDamOperatorOnly|readDamOperatorOnly/);
  assert.match(css, /dams-operator-chip/);
  assert.match(list, /damMatchesOperatorFilter|filterDamsByOperatorOnly|operatorOnly/);
  assert.match(list, /damMatchesNamedFilter|namedOnly/);
  assert.match(list, /damMeetsOutputFloor|outputFloor/);
  assert.match(helper, /meridian\.damOperatorOnly/);
  assert.doesNotMatch(helper, /fetch\s*\(/);
  assert.doesNotMatch(list, /fetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\/dams/);
  assert.doesNotMatch(helper, /hideNoOperator|militaryNamedOnly|hasName/);
  assert.doesNotMatch(list, /hideNoOperator|local-datacenters/);
  assert.doesNotMatch(layerState, /damOperatorOnly|damsOperator/);
  assert.match(layerState, /id: 'local-dams', token: 'q', disposition: 'enabled-only'/);
  assert.match(firstRun, /meridian\.damOperatorOnly/);
  assert.doesNotMatch(firstRun, /writeDamOperatorOnly|setDamOperatorOnly/);
  assert.doesNotMatch(sharelink, /damOperatorOnly|meridian\.damOperatorOnly/);
  assert.equal(existsSync(path.join(ROOT, 'api/dams.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/dams/operator.js')), false);
});
