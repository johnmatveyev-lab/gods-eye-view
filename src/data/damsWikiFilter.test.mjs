// PLAN 240 — Dam list Wikipedia only toggle. Client-only filter of the
// already-bundled OSM / ODbL snapshot. Distinct from 205 output-floor,
// 218 Named only, 224 Operator only, and 229 River only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAM_WIKI_ONLY_CHIP_LABEL,
  DAM_WIKI_ONLY_CHIP_TITLE,
  DAM_WIKI_ONLY_STORAGE_KEY,
  DEFAULT_DAM_WIKI_ONLY,
  damHasWiki,
  damMatchesWikiFilter,
  damWikiRaw,
  damWikidataRaw,
  damWikipediaRaw,
  damsWikiOnlyChipModel,
  filterDamsByWikiOnly,
  normalizeDamWikiOnly,
  readDamWikiOnly,
  writeDamWikiOnly,
} from './damsWikiFilter.js';
import { filterDamsByNamedOnly } from './damsNamedFilter.js';
import { filterDamsByOperatorOnly } from './damsOperatorFilter.js';
import { filterDamsByOutputFloor } from './damsOutputFilter.js';
import { filterDamsByRiverOnly } from './damsRiverFilter.js';
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

const WIKI_AND_DATA = Object.freeze({
  id: 'dam-wiki-both',
  label: 'Hoover Dam',
  latitude: 30.28,
  longitude: -97.74,
  visible: true,
  output: '6809 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Hoover Dam',
  wikidata: 'Q172822',
});

const WIKIPEDIA_ONLY = Object.freeze({
  id: 'dam-wikipedia-only',
  label: 'Naghlu Dam',
  latitude: 30.29,
  longitude: -97.745,
  visible: true,
  output: '100 MW',
  operator: 'Reclamation',
  river: 'Kabul',
  wikipedia: 'en:Naghlu Dam',
});

const WIKIDATA_ONLY = Object.freeze({
  id: 'dam-wikidata-only',
  label: 'Itaipu Dam',
  latitude: 30.31,
  longitude: -97.755,
  visible: true,
  output: '14000 MW',
  operator: 'Itaipu Binacional',
  river: 'Parana',
  wikidata: 'Q201411',
});

const MISSING = Object.freeze({
  id: 'dam-missing-wiki',
  label: 'Untagged dam',
  latitude: 30.30,
  longitude: -97.75,
  visible: true,
  output: '14000 MW',
  operator: 'Reclamation',
  river: 'Colorado',
});

const EMPTY = Object.freeze({
  id: 'dam-empty-wiki',
  label: 'Empty wiki',
  latitude: 30.32,
  longitude: -97.76,
  visible: true,
  output: '100 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: '',
  wikidata: '',
});

const WHITESPACE = Object.freeze({
  id: 'dam-ws-wiki',
  label: 'Whitespace wiki',
  latitude: 30.26,
  longitude: -97.73,
  visible: true,
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: '   ',
  wikidata: '  ',
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

const OPERATOR_NO_WIKI = Object.freeze({
  id: 'dam-op-no-wiki',
  label: 'Operator no wiki',
  latitude: 30.275,
  longitude: -97.742,
  visible: true,
  output: '100 MW',
  operator: 'Reclamation',
  river: 'Colorado',
});

const RIVER_NO_WIKI = Object.freeze({
  id: 'dam-river-no-wiki',
  label: 'River no wiki',
  latitude: 30.276,
  longitude: -97.741,
  visible: true,
  output: '100 MW',
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

test('off keeps no-wiki', () => {
  assert.equal(DEFAULT_DAM_WIKI_ONLY, false);
  assert.equal(DAM_WIKI_ONLY_CHIP_LABEL, 'Wikipedia only');
  assert.equal(DAM_WIKI_ONLY_CHIP_TITLE, 'Hide dams that have no OSM Wikipedia or Wikidata page');
  assert.equal(normalizeDamWikiOnly(undefined), false);
  assert.equal(normalizeDamWikiOnly(null), false);
  assert.equal(normalizeDamWikiOnly(''), false);
  assert.equal(normalizeDamWikiOnly(false), false);
  assert.equal(normalizeDamWikiOnly(0), false);
  assert.equal(normalizeDamWikiOnly('0'), false);
  assert.equal(normalizeDamWikiOnly(true), true);
  assert.equal(normalizeDamWikiOnly('1'), true);
  assert.equal(normalizeDamWikiOnly('true'), true);
  assert.equal(normalizeDamWikiOnly('bogus'), null);

  const records = [WIKI_AND_DATA, MISSING, EMPTY, WHITESPACE];
  assert.deepEqual(
    filterDamsByWikiOnly(records, false).map((row) => row.id),
    records.map((row) => row.id),
  );
  const listed = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    wikiOnly: false,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set(records.map((row) => row.id)));
  assert.ok(listed.some((site) => site.id === MISSING.id));
  assert.ok(listed.some((site) => site.id === WIKI_AND_DATA.id));
  assert.equal(damMatchesWikiFilter(MISSING, false), true);
  assert.deepEqual(filterDamsByWikiOnly(null), []);
  assert.deepEqual(filterDamsByWikiOnly(undefined), []);
});

test('on keeps wikipedia-only and wikidata-only', () => {
  assert.equal(damWikipediaRaw(WIKIPEDIA_ONLY), 'en:Naghlu Dam');
  assert.equal(damWikidataRaw(WIKIPEDIA_ONLY), null);
  assert.equal(damWikiRaw(WIKIPEDIA_ONLY), 'en:Naghlu Dam');
  assert.equal(damHasWiki(WIKIPEDIA_ONLY), true);
  assert.equal(damMatchesWikiFilter(WIKIPEDIA_ONLY, true), true);

  assert.equal(damWikipediaRaw(WIKIDATA_ONLY), null);
  assert.equal(damWikidataRaw(WIKIDATA_ONLY), 'Q201411');
  assert.equal(damWikiRaw(WIKIDATA_ONLY), 'Q201411');
  assert.equal(damHasWiki(WIKIDATA_ONLY), true);
  assert.equal(damMatchesWikiFilter(WIKIDATA_ONLY, true), true);

  const kept = filterDamsByWikiOnly([WIKIPEDIA_ONLY, WIKIDATA_ONLY, MISSING], true);
  assert.deepEqual(kept.map((row) => row.id), [WIKIPEDIA_ONLY.id, WIKIDATA_ONLY.id]);

  const listed = listDamsInView({
    enabled: true,
    records: [WIKIPEDIA_ONLY, WIKIDATA_ONLY, MISSING],
    view: AUSTIN_VIEW,
    wikiOnly: true,
  });
  assert.deepEqual(
    new Set(listed.map((site) => site.id)),
    new Set([WIKIPEDIA_ONLY.id, WIKIDATA_ONLY.id]),
  );
});

test('on drops both-empty', () => {
  assert.equal(damHasWiki(MISSING), false);
  assert.equal(damHasWiki(EMPTY), false);
  assert.equal(damHasWiki(WHITESPACE), false);
  assert.equal(damMatchesWikiFilter(MISSING, true), false);
  assert.equal(damMatchesWikiFilter(EMPTY, true), false);
  assert.equal(damMatchesWikiFilter(WHITESPACE, true), false);
  assert.equal(damMatchesWikiFilter({ wikipedia: null, wikidata: null }, true), false);
  assert.equal(damHasWiki({ tags: { 'operator:wikidata': 'Q6840876' } }), false);

  const kept = filterDamsByWikiOnly([WIKI_AND_DATA, MISSING, EMPTY, WHITESPACE], true);
  assert.deepEqual(kept.map((row) => row.id), [WIKI_AND_DATA.id]);

  const listed = listDamsInView({
    enabled: true,
    records: [WIKI_AND_DATA, MISSING, EMPTY, WHITESPACE],
    view: AUSTIN_VIEW,
    wikiOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [WIKI_AND_DATA.id]);
  assert.equal(listed[0].label, 'Hoover Dam');
});

test('context-store wikipedia / wikidata counts', () => {
  const viaPropsWikipedia = { id: 'via-props-wiki', properties: { wikipedia: 'en:Hoover Dam' } };
  assert.equal(damWikipediaRaw(viaPropsWikipedia), 'en:Hoover Dam');
  assert.equal(damMatchesWikiFilter(viaPropsWikipedia, true), true);

  const viaPropsWikidata = { id: 'via-props-data', properties: { wikidata: 'Q172822' } };
  assert.equal(damWikidataRaw(viaPropsWikidata), 'Q172822');

  const viaTagsWikipedia = { id: 'via-tags-wiki', properties: { tags: { wikipedia: 'en:Hoover Dam' } } };
  assert.equal(damWikipediaRaw(viaTagsWikipedia), 'en:Hoover Dam');

  const viaTagsWikidata = { id: 'via-tags-data', tags: { wikidata: 'Q172822' } };
  assert.equal(damWikidataRaw(viaTagsWikidata), 'Q172822');
  assert.equal(damMatchesWikiFilter(viaTagsWikidata, true), true);

  const originalWindow = globalThis.window;
  globalThis.window = globalThis.window || {};
  try {
    const store = getContextStore();
    store.entities.set('local-dams:-19754263', {
      properties: { tags: { wikipedia: 'en:Naghlu Dam', wikidata: 'Q4755783' } },
    });
    assert.equal(damWikipediaRaw({ id: '-19754263' }), 'en:Naghlu Dam');
    assert.equal(damWikidataRaw({ id: '-19754263' }), 'Q4755783');
    assert.equal(damHasWiki({ id: '-19754263' }), true);
    assert.equal(damMatchesWikiFilter({ id: '-19754263' }, true), true);
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
      wikiOnly: true,
    });
    assert.deepEqual(listed.map((site) => site.id), ['-19754263']);
    store.entities.delete('local-dams:-19754263');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('selected id always kept', () => {
  assert.equal(
    damMatchesWikiFilter(MISSING, true, { selectedId: MISSING.id }),
    true,
  );
  assert.deepEqual(
    filterDamsByWikiOnly([WIKI_AND_DATA, MISSING, EMPTY], true, MISSING.id).map((row) => row.id),
    [WIKI_AND_DATA.id, MISSING.id],
  );
  const listed = listDamsInView({
    enabled: true,
    records: [WIKI_AND_DATA, MISSING, EMPTY],
    view: AUSTIN_VIEW,
    wikiOnly: true,
    selectedId: EMPTY.id,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set([WIKI_AND_DATA.id, EMPTY.id]));
});

test('AND with 205 output-floor, 218 Named only, 224 Operator only, 229 River only', () => {
  const records = [
    WIKI_AND_DATA,
    MISSING,
    SMALL_NAMED,
    FALLBACK_NAMED,
    OPERATOR_NO_WIKI,
    RIVER_NO_WIKI,
  ];
  const afterFloor = filterDamsByOutputFloor(records, '10');
  assert.deepEqual(
    afterFloor.map((row) => row.id),
    [WIKI_AND_DATA.id, MISSING.id, FALLBACK_NAMED.id, OPERATOR_NO_WIKI.id, RIVER_NO_WIKI.id],
    '10+ MW hides the named sub-10 MW plant before Named only / Operator only / River only / Wikipedia only',
  );
  const afterNamed = filterDamsByNamedOnly(afterFloor, true);
  assert.deepEqual(
    afterNamed.map((row) => row.id),
    [WIKI_AND_DATA.id, MISSING.id, OPERATOR_NO_WIKI.id, RIVER_NO_WIKI.id],
  );
  const afterOperator = filterDamsByOperatorOnly(afterNamed, true);
  assert.deepEqual(
    afterOperator.map((row) => row.id),
    [WIKI_AND_DATA.id, MISSING.id, OPERATOR_NO_WIKI.id, RIVER_NO_WIKI.id],
  );
  const afterRiver = filterDamsByRiverOnly(afterOperator, true);
  assert.deepEqual(
    afterRiver.map((row) => row.id),
    [WIKI_AND_DATA.id, MISSING.id, OPERATOR_NO_WIKI.id, RIVER_NO_WIKI.id],
  );
  assert.deepEqual(
    filterDamsByWikiOnly(afterRiver, true).map((row) => row.id),
    [WIKI_AND_DATA.id],
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
  });
  assert.deepEqual(listed.map((site) => site.id), [WIKI_AND_DATA.id]);

  const selectedThroughAnd = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    outputFloor: '10',
    namedOnly: true,
    operatorOnly: true,
    riverOnly: true,
    wikiOnly: true,
    selectedId: FALLBACK_NAMED.id,
  });
  assert.deepEqual(
    new Set(selectedThroughAnd.map((site) => site.id)),
    new Set([WIKI_AND_DATA.id, FALLBACK_NAMED.id]),
    'selected fallback Dam stays through output floor AND Named only AND Operator only AND River only AND Wikipedia only',
  );
});

test('invalid storage reads as off', () => {
  assert.equal(DAM_WIKI_ONLY_STORAGE_KEY, 'meridian.damWikiOnly');
  assert.equal(readDamWikiOnly(memoryStorage()), false);
  assert.equal(readDamWikiOnly(memoryStorage({ [DAM_WIKI_ONLY_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readDamWikiOnly(memoryStorage({ [DAM_WIKI_ONLY_STORAGE_KEY]: 'bogus' })), false);
  assert.equal(readDamWikiOnly(memoryStorage({ [DAM_WIKI_ONLY_STORAGE_KEY]: '{}' })), false);
  assert.equal(readDamWikiOnly(memoryStorage({ [DAM_WIKI_ONLY_STORAGE_KEY]: '2' })), false);
  assert.equal(readDamWikiOnly({
    getItem() { throw new Error('blocked'); },
  }), false);
  assert.equal(writeDamWikiOnly('nope', memoryStorage()), false);
});

test('persist flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(writeDamWikiOnly(true, storage), true);
  assert.equal(storage.getItem(DAM_WIKI_ONLY_STORAGE_KEY), '1');
  assert.equal(readDamWikiOnly(storage), true);
  const reloaded = memoryStorage(storage.snapshot());
  assert.equal(readDamWikiOnly(reloaded), true);
  assert.equal(writeDamWikiOnly(false, storage), true);
  assert.equal(storage.getItem(DAM_WIKI_ONLY_STORAGE_KEY), '0');
  assert.equal(readDamWikiOnly(memoryStorage(storage.snapshot())), false);
  assert.equal(Object.keys(storage.snapshot()).join(','), DAM_WIKI_ONLY_STORAGE_KEY);
  assert.equal(damsWikiOnlyChipModel(false).params.wikiOnly, true);
  assert.equal(damsWikiOnlyChipModel(true).params.wikiOnly, false);
  assert.equal(damsWikiOnlyChipModel(false).active, false);
  assert.equal(damsWikiOnlyChipModel(true).active, true);
});

test('localGeojson.js is unchanged', () => {
  const diff = execSync('git diff -- HEAD -- src/data/localGeojson.js', {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(diff, '', 'Plan 240 must not edit localGeojson.js');
  const localGeojson = src('src/data/localGeojson.js');
  assert.doesNotMatch(localGeojson, /damWikiOnly|damsWikiFilter|meridian\.damWikiOnly/);
});

test('list chip sits on the dams in-view surface; persist is local; no share-URL or /api', () => {
  const html = src('index.html');
  const ui = src('src/ui.js');
  const list = src('src/data/damsList.js');
  const helper = src('src/data/damsWikiFilter.js');
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
  assert.match(panel[0], /data-dam-wiki="only"[^>]*>Wikipedia only</);
  assert.ok(
    panel[0].indexOf('id="dams-river-chips"') < panel[0].indexOf('id="dams-wiki-chips"'),
    'Wikipedia only sits next to River only',
  );
  assert.ok(
    panel[0].indexOf('id="dams-wiki-chips"') < panel[0].indexOf('id="dams-in-view-items"'),
    'Wikipedia only sits above the in-view items',
  );
  assert.match(html, /id="dams-in-view"[\s\S]*?© OpenStreetMap contributors/);
  assert.match(ui, /data-dam-wiki/);
  assert.match(ui, /writeDamWikiOnly|readDamWikiOnly/);
  assert.match(css, /dams-wiki-chip/);
  assert.match(list, /damMatchesWikiFilter|filterDamsByWikiOnly|wikiOnly/);
  assert.match(list, /damMatchesRiverFilter|riverOnly/);
  assert.match(list, /damMatchesOperatorFilter|operatorOnly/);
  assert.match(list, /damMatchesNamedFilter|namedOnly/);
  assert.match(list, /damMeetsOutputFloor|outputFloor/);
  assert.match(helper, /meridian\.damWikiOnly/);
  assert.doesNotMatch(helper, /fetch\s*\(/);
  assert.doesNotMatch(list, /fetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\/dams/);
  assert.doesNotMatch(helper, /hideNoOperator|militaryNamedOnly|hasName/);
  assert.doesNotMatch(list, /hideNoOperator|local-datacenters/);
  assert.doesNotMatch(layerState, /damWikiOnly|damsWiki/);
  assert.match(layerState, /id: 'local-dams', token: 'q', disposition: 'enabled-only'/);
  assert.match(firstRun, /meridian\.damWikiOnly/);
  assert.doesNotMatch(firstRun, /writeDamWikiOnly|setDamWikiOnly/);
  assert.doesNotMatch(sharelink, /damWikiOnly|meridian\.damWikiOnly/);
  assert.equal(existsSync(path.join(ROOT, 'api/dams.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/dams/wiki.js')), false);
});
