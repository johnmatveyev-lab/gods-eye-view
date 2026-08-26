// PLAN 249 — Dam list Output only toggle. Client-only filter of the
// already-bundled OSM / ODbL snapshot. Distinct from 205 output-floor,
// 218 Named only, 224 Operator only, 229 River only, and 240 Wikipedia only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAM_OUTPUT_ONLY_CHIP_LABEL,
  DAM_OUTPUT_ONLY_CHIP_TITLE,
  DAM_OUTPUT_ONLY_STORAGE_KEY,
  DEFAULT_DAM_OUTPUT_ONLY,
  damHasParseableOutput,
  damMatchesOutputOnlyFilter,
  damsOutputOnlyChipModel,
  filterDamsByOutputOnly,
  normalizeDamOutputOnly,
  readDamOutputOnly,
  writeDamOutputOnly,
} from './damsOutputOnlyFilter.js';
import { filterDamsByNamedOnly } from './damsNamedFilter.js';
import { filterDamsByOperatorOnly } from './damsOperatorFilter.js';
import { damMeetsOutputFloor, filterDamsByOutputFloor } from './damsOutputFilter.js';
import { filterDamsByRiverOnly } from './damsRiverFilter.js';
import { filterDamsByWikiOnly } from './damsWikiFilter.js';
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

const WITH_120 = Object.freeze({
  id: 'dam-120',
  label: 'Hoover Dam',
  latitude: 30.28,
  longitude: -97.74,
  visible: true,
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Hoover Dam',
});

const MISSING = Object.freeze({
  id: 'dam-missing-output',
  label: 'Untagged dam',
  latitude: 30.30,
  longitude: -97.75,
  visible: true,
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Untagged',
});

const EMPTY = Object.freeze({
  id: 'dam-empty-output',
  label: 'Empty output',
  latitude: 30.32,
  longitude: -97.76,
  visible: true,
  output: '',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Empty',
});

const UNPARSEABLE = Object.freeze({
  id: 'dam-yes-output',
  label: 'Yes output',
  latitude: 30.26,
  longitude: -97.73,
  visible: true,
  output: 'yes',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Yes',
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
  wikipedia: 'en:Podlubnik',
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
  wikipedia: 'en:Fallback Dam',
});

const NO_WIKI = Object.freeze({
  id: 'dam-no-wiki',
  label: 'Output no wiki',
  latitude: 30.275,
  longitude: -97.742,
  visible: true,
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
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

test('off keeps no-output', () => {
  assert.equal(DEFAULT_DAM_OUTPUT_ONLY, false);
  assert.equal(DAM_OUTPUT_ONLY_CHIP_LABEL, 'Output only');
  assert.equal(DAM_OUTPUT_ONLY_CHIP_TITLE, 'Hide dams that have no parseable plant output');
  assert.equal(normalizeDamOutputOnly(undefined), false);
  assert.equal(normalizeDamOutputOnly(null), false);
  assert.equal(normalizeDamOutputOnly(''), false);
  assert.equal(normalizeDamOutputOnly(false), false);
  assert.equal(normalizeDamOutputOnly(0), false);
  assert.equal(normalizeDamOutputOnly('0'), false);
  assert.equal(normalizeDamOutputOnly(true), true);
  assert.equal(normalizeDamOutputOnly('1'), true);
  assert.equal(normalizeDamOutputOnly('true'), true);
  assert.equal(normalizeDamOutputOnly('bogus'), null);

  const records = [WITH_120, MISSING, EMPTY, UNPARSEABLE];
  assert.deepEqual(
    filterDamsByOutputOnly(records, false).map((row) => row.id),
    records.map((row) => row.id),
  );
  const listed = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    outputOnly: false,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set(records.map((row) => row.id)));
  assert.ok(listed.some((site) => site.id === MISSING.id));
  assert.ok(listed.some((site) => site.id === WITH_120.id));
  assert.equal(damMatchesOutputOnlyFilter(MISSING, false), true);
  assert.deepEqual(filterDamsByOutputOnly(null), []);
  assert.deepEqual(filterDamsByOutputOnly(undefined), []);
});

test('on keeps 120 MW, drops empty', () => {
  assert.equal(damHasParseableOutput(WITH_120), true);
  assert.equal(damMatchesOutputOnlyFilter(WITH_120, true), true);
  assert.equal(damHasParseableOutput(EMPTY), false);
  assert.equal(damMatchesOutputOnlyFilter(EMPTY, true), false);
  assert.equal(damHasParseableOutput(MISSING), false);
  assert.equal(damMatchesOutputOnlyFilter(MISSING, true), false);
  assert.equal(damHasParseableOutput(UNPARSEABLE), false);
  assert.equal(damMatchesOutputOnlyFilter(UNPARSEABLE, true), false);

  const kept = filterDamsByOutputOnly([WITH_120, MISSING, EMPTY, UNPARSEABLE], true);
  assert.deepEqual(kept.map((row) => row.id), [WITH_120.id]);

  const listed = listDamsInView({
    enabled: true,
    records: [WITH_120, MISSING, EMPTY, UNPARSEABLE],
    view: AUSTIN_VIEW,
    outputOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [WITH_120.id]);
  assert.equal(listed[0].label, 'Hoover Dam');
});

test('selected id always kept', () => {
  assert.equal(
    damMatchesOutputOnlyFilter(MISSING, true, { selectedId: MISSING.id }),
    true,
  );
  assert.deepEqual(
    filterDamsByOutputOnly([WITH_120, MISSING, EMPTY], true, MISSING.id).map((row) => row.id),
    [WITH_120.id, MISSING.id],
  );
  const listed = listDamsInView({
    enabled: true,
    records: [WITH_120, MISSING, EMPTY],
    view: AUSTIN_VIEW,
    outputOnly: true,
    selectedId: EMPTY.id,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set([WITH_120.id, EMPTY.id]));
});

test('invalid storage reads as off', () => {
  assert.equal(DAM_OUTPUT_ONLY_STORAGE_KEY, 'meridian.damOutputOnly');
  assert.equal(readDamOutputOnly(memoryStorage()), false);
  assert.equal(readDamOutputOnly(memoryStorage({ [DAM_OUTPUT_ONLY_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readDamOutputOnly(memoryStorage({ [DAM_OUTPUT_ONLY_STORAGE_KEY]: 'bogus' })), false);
  assert.equal(readDamOutputOnly(memoryStorage({ [DAM_OUTPUT_ONLY_STORAGE_KEY]: '{}' })), false);
  assert.equal(readDamOutputOnly(memoryStorage({ [DAM_OUTPUT_ONLY_STORAGE_KEY]: '2' })), false);
  assert.equal(readDamOutputOnly({
    getItem() { throw new Error('blocked'); },
  }), false);
  assert.equal(writeDamOutputOnly('nope', memoryStorage()), false);
});

test('AND with 205 output-floor, 218 Named only, 224 Operator only, 229 River only, 240 Wikipedia only', () => {
  const records = [
    WITH_120,
    MISSING,
    SMALL_NAMED,
    FALLBACK_NAMED,
    NO_WIKI,
  ];
  assert.equal(damMeetsOutputFloor(MISSING, '10'), true, '205 fail-open keeps missing output');
  const afterFloor = filterDamsByOutputFloor(records, '10');
  assert.deepEqual(
    afterFloor.map((row) => row.id),
    [WITH_120.id, MISSING.id, FALLBACK_NAMED.id, NO_WIKI.id],
    '10+ MW hides the named sub-10 MW plant before Named only / Operator only / River only / Wikipedia only / Output only',
  );
  const afterNamed = filterDamsByNamedOnly(afterFloor, true);
  assert.deepEqual(
    afterNamed.map((row) => row.id),
    [WITH_120.id, MISSING.id, NO_WIKI.id],
  );
  const afterOperator = filterDamsByOperatorOnly(afterNamed, true);
  assert.deepEqual(
    afterOperator.map((row) => row.id),
    [WITH_120.id, MISSING.id, NO_WIKI.id],
  );
  const afterRiver = filterDamsByRiverOnly(afterOperator, true);
  assert.deepEqual(
    afterRiver.map((row) => row.id),
    [WITH_120.id, MISSING.id, NO_WIKI.id],
  );
  const afterWiki = filterDamsByWikiOnly(afterRiver, true);
  assert.deepEqual(
    afterWiki.map((row) => row.id),
    [WITH_120.id, MISSING.id],
  );
  assert.deepEqual(
    filterDamsByOutputOnly(afterWiki, true).map((row) => row.id),
    [WITH_120.id],
  );

  const listed = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    outputFloor: '10',
    namedOnly: true,
    operatorOnly: true,
    riverOnly: true,
    wikiOnly: true,
    outputOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [WITH_120.id]);

  const selectedThroughAnd = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    outputFloor: '10',
    namedOnly: true,
    operatorOnly: true,
    riverOnly: true,
    wikiOnly: true,
    outputOnly: true,
    selectedId: FALLBACK_NAMED.id,
  });
  assert.deepEqual(
    new Set(selectedThroughAnd.map((site) => site.id)),
    new Set([WITH_120.id, FALLBACK_NAMED.id]),
    'selected fallback Dam stays through output floor AND Named only AND Operator only AND River only AND Wikipedia only AND Output only',
  );
});

test('context-store plant:output:electricity / properties.output counts', () => {
  const viaProps = { id: 'via-props-output', properties: { output: '120 MW' } };
  assert.equal(damHasParseableOutput(viaProps), true);
  assert.equal(damMatchesOutputOnlyFilter(viaProps, true), true);

  const viaTags = { id: 'via-tags-output', properties: { tags: { 'plant:output:electricity': '120 MW' } } };
  assert.equal(damHasParseableOutput(viaTags), true);
  assert.equal(damMatchesOutputOnlyFilter(viaTags, true), true);

  const originalWindow = globalThis.window;
  globalThis.window = globalThis.window || {};
  try {
    const store = getContextStore();
    store.entities.set('local-dams:-19754263', {
      properties: { tags: { 'plant:output:electricity': '120 MW' } },
    });
    assert.equal(damHasParseableOutput({ id: '-19754263' }), true);
    assert.equal(damMatchesOutputOnlyFilter({ id: '-19754263' }, true), true);
    const listed = listDamsInView({
      enabled: true,
      records: [{
        id: '-19754263',
        label: 'Naghlu Dam',
        latitude: 30.28,
        longitude: -97.74,
        visible: true,
      }, MISSING],
      view: AUSTIN_VIEW,
      outputOnly: true,
    });
    assert.deepEqual(listed.map((site) => site.id), ['-19754263']);
    store.entities.delete('local-dams:-19754263');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('persist flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(writeDamOutputOnly(true, storage), true);
  assert.equal(storage.getItem(DAM_OUTPUT_ONLY_STORAGE_KEY), '1');
  assert.equal(readDamOutputOnly(storage), true);
  const reloaded = memoryStorage(storage.snapshot());
  assert.equal(readDamOutputOnly(reloaded), true);
  assert.equal(writeDamOutputOnly(false, storage), true);
  assert.equal(storage.getItem(DAM_OUTPUT_ONLY_STORAGE_KEY), '0');
  assert.equal(readDamOutputOnly(memoryStorage(storage.snapshot())), false);
  assert.equal(Object.keys(storage.snapshot()).join(','), DAM_OUTPUT_ONLY_STORAGE_KEY);
  assert.equal(damsOutputOnlyChipModel(false).params.outputOnly, true);
  assert.equal(damsOutputOnlyChipModel(true).params.outputOnly, false);
  assert.equal(damsOutputOnlyChipModel(false).active, false);
  assert.equal(damsOutputOnlyChipModel(true).active, true);
});

test('localGeojson.js is unchanged', () => {
  const diff = execSync('git diff -- HEAD -- src/data/localGeojson.js', {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(diff, '', 'Plan 249 must not edit localGeojson.js');
  const localGeojson = src('src/data/localGeojson.js');
  assert.doesNotMatch(localGeojson, /damOutputOnly|damsOutputOnlyFilter|meridian\.damOutputOnly/);
});

test('list chip sits on the dams in-view surface; persist is local; no share-URL or /api', () => {
  const html = src('index.html');
  const ui = src('src/ui.js');
  const list = src('src/data/damsList.js');
  const helper = src('src/data/damsOutputOnlyFilter.js');
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
  assert.match(panel[0], /id="dams-wiki-chips"/);
  assert.match(panel[0], /id="dams-output-only-chips"/);
  assert.match(panel[0], /data-dam-output-only="only"[^>]*>Output only</);
  assert.ok(
    panel[0].indexOf('id="dams-wiki-chips"') < panel[0].indexOf('id="dams-output-only-chips"'),
    'Output only sits next to Wikipedia only',
  );
  assert.ok(
    panel[0].indexOf('id="dams-output-only-chips"') < panel[0].indexOf('id="dams-in-view-items"'),
    'Output only sits above the in-view items',
  );
  assert.match(html, /id="dams-in-view"[\s\S]*?© OpenStreetMap contributors/);
  assert.match(ui, /data-dam-output-only/);
  assert.match(ui, /writeDamOutputOnly|readDamOutputOnly/);
  assert.match(css, /dams-output-only-chip/);
  assert.match(list, /damMatchesOutputOnlyFilter|filterDamsByOutputOnly|outputOnly/);
  assert.match(list, /damMatchesWikiFilter|wikiOnly/);
  assert.match(list, /damMatchesRiverFilter|riverOnly/);
  assert.match(list, /damMatchesOperatorFilter|operatorOnly/);
  assert.match(list, /damMatchesNamedFilter|namedOnly/);
  assert.match(list, /damMeetsOutputFloor|outputFloor/);
  assert.match(helper, /meridian\.damOutputOnly/);
  assert.doesNotMatch(helper, /fetch\s*\(/);
  assert.doesNotMatch(list, /fetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\/dams/);
  assert.doesNotMatch(helper, /hideNoOperator|militaryNamedOnly|hasName/);
  assert.doesNotMatch(list, /hideNoOperator|local-datacenters/);
  assert.doesNotMatch(layerState, /damOutputOnly|damsOutputOnly/);
  assert.match(layerState, /id: 'local-dams', token: 'q', disposition: 'enabled-only'/);
  assert.match(firstRun, /meridian\.damOutputOnly/);
  assert.doesNotMatch(firstRun, /writeDamOutputOnly|setDamOutputOnly/);
  assert.doesNotMatch(sharelink, /damOutputOnly|meridian\.damOutputOnly/);
  assert.equal(existsSync(path.join(ROOT, 'api/dams.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/dams/output-only.js')), false);
});
