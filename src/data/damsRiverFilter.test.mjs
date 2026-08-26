// PLAN 229 — Dam list River only toggle. Client-only filter of the
// already-bundled OSM / ODbL snapshot. Distinct from 205 output-floor,
// 218 Named only, and 224 Operator only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAM_RIVER_ONLY_CHIP_LABEL,
  DAM_RIVER_ONLY_CHIP_TITLE,
  DAM_RIVER_ONLY_STORAGE_KEY,
  DEFAULT_DAM_RIVER_ONLY,
  damHasRiver,
  damMatchesRiverFilter,
  damRiverRaw,
  damsRiverOnlyChipModel,
  filterDamsByRiverOnly,
  normalizeDamRiverOnly,
  readDamRiverOnly,
  writeDamRiverOnly,
} from './damsRiverFilter.js';
import { filterDamsByNamedOnly } from './damsNamedFilter.js';
import { filterDamsByOperatorOnly } from './damsOperatorFilter.js';
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

const COLORADO = Object.freeze({
  id: 'dam-colorado',
  label: 'Hoover Dam',
  latitude: 30.28,
  longitude: -97.74,
  visible: true,
  output: '6809 MW',
  operator: 'Reclamation',
  river: 'Colorado',
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
  id: 'dam-empty-river',
  label: 'Empty river',
  latitude: 30.32,
  longitude: -97.76,
  visible: true,
  output: '100 MW',
  river: '',
});

const WHITESPACE = Object.freeze({
  id: 'dam-ws-river',
  label: 'Whitespace river',
  latitude: 30.26,
  longitude: -97.73,
  visible: true,
  river: '   ',
});

const SMALL_NAMED = Object.freeze({
  id: 'dam-small',
  label: 'Podlubnik',
  latitude: 30.27,
  longitude: -97.735,
  visible: true,
  output: '330KW',
  operator: 'Reclamation',
  river: 'Colorado',
});

const FALLBACK_NAMED = Object.freeze({
  id: 'dam-fallback',
  label: 'Dam',
  latitude: 30.29,
  longitude: -97.745,
  visible: true,
  output: '2080 MW',
  operator: 'Reclamation',
  river: 'Colorado',
});

const OPERATOR_NO_RIVER = Object.freeze({
  id: 'dam-op-no-river',
  label: 'Operator no river',
  latitude: 30.275,
  longitude: -97.742,
  visible: true,
  output: '100 MW',
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
  assert.equal(DEFAULT_DAM_RIVER_ONLY, false);
  assert.equal(DAM_RIVER_ONLY_CHIP_LABEL, 'River only');
  assert.equal(DAM_RIVER_ONLY_CHIP_TITLE, 'Hide dams that have no OSM river');
  assert.equal(normalizeDamRiverOnly(undefined), false);
  assert.equal(normalizeDamRiverOnly(null), false);
  assert.equal(normalizeDamRiverOnly(''), false);
  assert.equal(normalizeDamRiverOnly(false), false);
  assert.equal(normalizeDamRiverOnly(0), false);
  assert.equal(normalizeDamRiverOnly('0'), false);
  assert.equal(normalizeDamRiverOnly(true), true);
  assert.equal(normalizeDamRiverOnly('1'), true);
  assert.equal(normalizeDamRiverOnly('true'), true);
  assert.equal(normalizeDamRiverOnly('bogus'), null);

  const records = [COLORADO, MISSING, EMPTY, WHITESPACE];
  assert.deepEqual(
    filterDamsByRiverOnly(records, false).map((row) => row.id),
    records.map((row) => row.id),
  );
  const listed = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    riverOnly: false,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set(records.map((row) => row.id)));
  assert.ok(listed.some((site) => site.id === MISSING.id));
  assert.ok(listed.some((site) => site.id === COLORADO.id));
  assert.equal(damMatchesRiverFilter(MISSING, false), true);
  assert.deepEqual(filterDamsByRiverOnly(null), []);
  assert.deepEqual(filterDamsByRiverOnly(undefined), []);
});

test('on drops empty/whitespace, keeps "Colorado"', () => {
  assert.equal(damRiverRaw(COLORADO), 'Colorado');
  assert.equal(damHasRiver(COLORADO), true);
  assert.equal(damHasRiver(MISSING), false);
  assert.equal(damHasRiver(EMPTY), false);
  assert.equal(damHasRiver(WHITESPACE), false);
  assert.equal(damMatchesRiverFilter(COLORADO, true), true);
  assert.equal(damMatchesRiverFilter(MISSING, true), false);
  assert.equal(damMatchesRiverFilter(EMPTY, true), false);
  assert.equal(damMatchesRiverFilter(WHITESPACE, true), false);
  assert.equal(damMatchesRiverFilter({ river: null }, true), false);

  const kept = filterDamsByRiverOnly([COLORADO, MISSING, EMPTY, WHITESPACE], true);
  assert.deepEqual(kept.map((row) => row.id), [COLORADO.id]);

  const listed = listDamsInView({
    enabled: true,
    records: [COLORADO, MISSING, EMPTY, WHITESPACE],
    view: AUSTIN_VIEW,
    riverOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [COLORADO.id]);
  assert.equal(listed[0].label, 'Hoover Dam');
});

test('context-store river counts', () => {
  const viaPropsAssociated = { id: 'via-props-assoc', properties: { associated_river: 'Colorado' } };
  assert.equal(damRiverRaw(viaPropsAssociated), 'Colorado');
  assert.equal(damMatchesRiverFilter(viaPropsAssociated, true), true);

  const viaPropsRiver = { id: 'via-props-river', properties: { river: 'Colorado' } };
  assert.equal(damRiverRaw(viaPropsRiver), 'Colorado');

  const viaTagsAssociated = { id: 'via-tags-assoc', properties: { tags: { associated_river: 'Colorado' } } };
  assert.equal(damRiverRaw(viaTagsAssociated), 'Colorado');

  const viaTagsRiver = { id: 'via-tags-river', tags: { river: 'Colorado' } };
  assert.equal(damRiverRaw(viaTagsRiver), 'Colorado');

  const viaRiverName = { id: 'via-river-name', tags: { 'river:name': 'Colorado' } };
  assert.equal(damRiverRaw(viaRiverName), 'Colorado');
  assert.equal(damMatchesRiverFilter(viaRiverName, true), true);

  const originalWindow = globalThis.window;
  globalThis.window = globalThis.window || {};
  try {
    const store = getContextStore();
    store.entities.set('local-dams:-898986', {
      properties: { tags: { associated_river: 'Colorado' } },
    });
    assert.equal(damRiverRaw({ id: '-898986' }), 'Colorado');
    assert.equal(damHasRiver({ id: '-898986' }), true);
    assert.equal(damMatchesRiverFilter({ id: '-898986' }, true), true);
    const listed = listDamsInView({
      enabled: true,
      records: [{
        id: '-898986',
        label: 'Hoover Dam',
        latitude: 30.28,
        longitude: -97.74,
        visible: true,
      }, MISSING],
      view: AUSTIN_VIEW,
      riverOnly: true,
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
    damMatchesRiverFilter(MISSING, true, { selectedId: MISSING.id }),
    true,
  );
  assert.deepEqual(
    filterDamsByRiverOnly([COLORADO, MISSING, EMPTY], true, MISSING.id).map((row) => row.id),
    [COLORADO.id, MISSING.id],
  );
  const listed = listDamsInView({
    enabled: true,
    records: [COLORADO, MISSING, EMPTY],
    view: AUSTIN_VIEW,
    riverOnly: true,
    selectedId: EMPTY.id,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set([COLORADO.id, EMPTY.id]));
});

test('AND with 205 output-floor, 218 Named only, 224 Operator only', () => {
  const records = [COLORADO, MISSING, SMALL_NAMED, FALLBACK_NAMED, OPERATOR_NO_RIVER];
  const afterFloor = filterDamsByOutputFloor(records, '10');
  assert.deepEqual(
    afterFloor.map((row) => row.id),
    [COLORADO.id, MISSING.id, FALLBACK_NAMED.id, OPERATOR_NO_RIVER.id],
    '10+ MW hides the named sub-10 MW plant before Named only / Operator only / River only',
  );
  const afterNamed = filterDamsByNamedOnly(afterFloor, true);
  assert.deepEqual(
    afterNamed.map((row) => row.id),
    [COLORADO.id, MISSING.id, OPERATOR_NO_RIVER.id],
  );
  const afterOperator = filterDamsByOperatorOnly(afterNamed, true);
  assert.deepEqual(
    afterOperator.map((row) => row.id),
    [COLORADO.id, OPERATOR_NO_RIVER.id],
  );
  assert.deepEqual(
    filterDamsByRiverOnly(afterOperator, true).map((row) => row.id),
    [COLORADO.id],
  );

  const listed = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    outputFloor: '10',
    namedOnly: true,
    operatorOnly: true,
    riverOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [COLORADO.id]);

  const selectedThroughAnd = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    outputFloor: '10',
    namedOnly: true,
    operatorOnly: true,
    riverOnly: true,
    selectedId: FALLBACK_NAMED.id,
  });
  assert.deepEqual(
    new Set(selectedThroughAnd.map((site) => site.id)),
    new Set([COLORADO.id, FALLBACK_NAMED.id]),
    'selected fallback Dam stays through output floor AND Named only AND Operator only AND River only',
  );
});

test('invalid storage reads as off', () => {
  assert.equal(DAM_RIVER_ONLY_STORAGE_KEY, 'meridian.damRiverOnly');
  assert.equal(readDamRiverOnly(memoryStorage()), false);
  assert.equal(readDamRiverOnly(memoryStorage({ [DAM_RIVER_ONLY_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readDamRiverOnly(memoryStorage({ [DAM_RIVER_ONLY_STORAGE_KEY]: 'bogus' })), false);
  assert.equal(readDamRiverOnly(memoryStorage({ [DAM_RIVER_ONLY_STORAGE_KEY]: '{}' })), false);
  assert.equal(readDamRiverOnly(memoryStorage({ [DAM_RIVER_ONLY_STORAGE_KEY]: '2' })), false);
  assert.equal(readDamRiverOnly({
    getItem() { throw new Error('blocked'); },
  }), false);
  assert.equal(writeDamRiverOnly('nope', memoryStorage()), false);
});

test('persist flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(writeDamRiverOnly(true, storage), true);
  assert.equal(storage.getItem(DAM_RIVER_ONLY_STORAGE_KEY), '1');
  assert.equal(readDamRiverOnly(storage), true);
  const reloaded = memoryStorage(storage.snapshot());
  assert.equal(readDamRiverOnly(reloaded), true);
  assert.equal(writeDamRiverOnly(false, storage), true);
  assert.equal(storage.getItem(DAM_RIVER_ONLY_STORAGE_KEY), '0');
  assert.equal(readDamRiverOnly(memoryStorage(storage.snapshot())), false);
  assert.equal(Object.keys(storage.snapshot()).join(','), DAM_RIVER_ONLY_STORAGE_KEY);
  assert.equal(damsRiverOnlyChipModel(false).params.riverOnly, true);
  assert.equal(damsRiverOnlyChipModel(true).params.riverOnly, false);
  assert.equal(damsRiverOnlyChipModel(false).active, false);
  assert.equal(damsRiverOnlyChipModel(true).active, true);
});

test('localGeojson.js is unchanged', () => {
  const diff = execSync('git diff -- HEAD -- src/data/localGeojson.js', {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(diff, '', 'Plan 229 must not edit localGeojson.js');
  const localGeojson = src('src/data/localGeojson.js');
  assert.doesNotMatch(localGeojson, /damRiverOnly|damsRiverFilter|meridian\.damRiverOnly/);
});

test('list chip sits on the dams in-view surface; persist is local; no share-URL or /api', () => {
  const html = src('index.html');
  const ui = src('src/ui.js');
  const list = src('src/data/damsList.js');
  const helper = src('src/data/damsRiverFilter.js');
  const layerState = src('src/data/layerState.js');
  const firstRun = src('src/firstRunExperience.js');
  const sharelink = src('src/sharelink.js');
  const css = src('style.css');
  const panel = html.match(/<div id="dams-in-view"[\s\S]*?<p class="in-view-site-list-credit"/);
  assert.ok(panel, 'dams-in-view markup is missing');
  assert.match(panel[0], /id="dams-output-chips"/);
  assert.match(panel[0], /id="dams-named-chips"/);
  assert.match(panel[0], /id="dams-operator-chips"/);
  assert.match(panel[0], /id="dams-river-chips"/);
  assert.match(panel[0], /data-dam-river="only"[^>]*>River only</);
  assert.ok(
    panel[0].indexOf('id="dams-operator-chips"') < panel[0].indexOf('id="dams-river-chips"'),
    'River only sits next to Operator only',
  );
  assert.ok(
    panel[0].indexOf('id="dams-river-chips"') < panel[0].indexOf('id="dams-in-view-items"'),
    'River only sits above the in-view items',
  );
  assert.match(html, /id="dams-in-view"[\s\S]*?© OpenStreetMap contributors/);
  assert.match(ui, /data-dam-river/);
  assert.match(ui, /writeDamRiverOnly|readDamRiverOnly/);
  assert.match(css, /dams-river-chip/);
  assert.match(list, /damMatchesRiverFilter|filterDamsByRiverOnly|riverOnly/);
  assert.match(list, /damMatchesOperatorFilter|operatorOnly/);
  assert.match(list, /damMatchesNamedFilter|namedOnly/);
  assert.match(list, /damMeetsOutputFloor|outputFloor/);
  assert.match(helper, /meridian\.damRiverOnly/);
  assert.doesNotMatch(helper, /fetch\s*\(/);
  assert.doesNotMatch(list, /fetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\/dams/);
  assert.doesNotMatch(helper, /hideNoOperator|militaryNamedOnly|hasName/);
  assert.doesNotMatch(list, /hideNoOperator|local-datacenters/);
  assert.doesNotMatch(layerState, /damRiverOnly|damsRiver/);
  assert.match(layerState, /id: 'local-dams', token: 'q', disposition: 'enabled-only'/);
  assert.match(firstRun, /meridian\.damRiverOnly/);
  assert.doesNotMatch(firstRun, /writeDamRiverOnly|setDamRiverOnly/);
  assert.doesNotMatch(sharelink, /damRiverOnly|meridian\.damRiverOnly/);
  assert.equal(existsSync(path.join(ROOT, 'api/dams.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/dams/river.js')), false);
});
