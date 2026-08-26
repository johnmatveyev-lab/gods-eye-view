// PLAN 302 leftover — Dam list Wikidata only toggle. Client-only filter
// of the already-bundled OSM / ODbL snapshot. Distinct from 205 output
// floor, 218 Named only, 224 Operator only, 229 River only, 240 Wikipedia
// only, 249 Output only, 279 Dated only, 287 Method only, and 297
// Website only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAM_WIKIDATA_ONLY_CHIP_LABEL,
  DAM_WIKIDATA_ONLY_CHIP_TITLE,
  DAM_WIKIDATA_ONLY_STORAGE_KEY,
  DEFAULT_DAM_WIKIDATA_ONLY,
  damHasWikidata,
  damMatchesWikidataFilter,
  damWikidataRaw,
  damsWikidataOnlyChipModel,
  filterDamsByWikidataOnly,
  normalizeDamWikidataOnly,
  readDamWikidataOnly,
  writeDamWikidataOnly,
} from './damsWikidataFilter.js';
import { filterDamsByNamedOnly } from './damsNamedFilter.js';
import { filterDamsByOperatorOnly } from './damsOperatorFilter.js';
import { damMeetsOutputFloor, filterDamsByOutputFloor } from './damsOutputFilter.js';
import { filterDamsByOutputOnly } from './damsOutputOnlyFilter.js';
import { filterDamsByRiverOnly } from './damsRiverFilter.js';
import { filterDamsByWikiOnly } from './damsWikiFilter.js';
import { filterDamsByDatedOnly } from './damsDatedOnlyFilter.js';
import { filterDamsByMethodOnly } from './damsMethodOnlyFilter.js';
import { filterDamsByWebsiteOnly } from './damsWebsiteFilter.js';
import { bindDamsInViewList, listDamsInView } from './damsList.js';
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

const WIKIDATA = Object.freeze({
  id: 'dam-qid',
  label: 'Itaipu Dam',
  latitude: 30.28,
  longitude: -97.74,
  visible: true,
  wikidata: 'Q201411',
  website: 'https://www.itaipu.gov.br/',
  'plant:method': 'water-storage',
  start_date: '1984',
  output: '14000 MW',
  operator: 'Itaipu Binacional',
  river: 'Parana',
  wikipedia: 'en:Itaipu Dam',
});

const MISSING = Object.freeze({
  id: 'dam-missing-qid',
  label: 'Untagged dam',
  latitude: 30.30,
  longitude: -97.75,
  visible: true,
  website: 'https://example.com/untagged',
  'plant:method': 'run-of-the-river',
  start_date: '1967',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
});

const EMPTY = Object.freeze({
  id: 'dam-empty-qid',
  label: 'Empty wikidata',
  latitude: 30.32,
  longitude: -97.76,
  visible: true,
  wikidata: '',
  website: 'https://example.com/empty',
  'plant:method': 'run-of-the-river',
  start_date: '1967',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Empty',
});

const WHITESPACE = Object.freeze({
  id: 'dam-ws-qid',
  label: 'Whitespace wikidata',
  latitude: 30.26,
  longitude: -97.73,
  visible: true,
  wikidata: '   ',
  website: 'https://example.com/ws',
  'plant:method': 'run-of-the-river',
  start_date: '1967',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Whitespace',
});

const WIKIPEDIA_ONLY = Object.freeze({
  id: 'dam-wikipedia-only',
  label: 'Naghlu Dam',
  latitude: 30.29,
  longitude: -97.745,
  visible: true,
  wikipedia: 'en:Naghlu Dam',
  website: 'https://example.com/naghlu',
  'plant:method': 'water-storage',
  start_date: '1967',
  output: '100 MW',
  operator: 'Reclamation',
  river: 'Kabul',
});

const WIKIDATA_ONLY = Object.freeze({
  id: 'dam-wikidata-only',
  label: 'Q-id only dam',
  latitude: 30.31,
  longitude: -97.755,
  visible: true,
  wikidata: 'Q4755783',
  website: 'https://example.com/qid-only',
  'plant:method': 'water-storage',
  start_date: '1967',
  output: '2080 MW',
  operator: 'Reclamation',
  river: 'Colorado',
});

const SMALL_NAMED = Object.freeze({
  id: 'dam-small',
  label: 'Podlubnik',
  latitude: 30.27,
  longitude: -97.735,
  visible: true,
  wikidata: 'Q999001',
  website: 'https://example.com/podlubnik',
  'plant:method': 'run-of-the-river',
  start_date: '1967',
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
  website: 'https://example.com/fallback',
  'plant:method': 'water-storage',
  start_date: '1967',
  output: '2080 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Fallback Dam',
});

const NO_OUTPUT = Object.freeze({
  id: 'dam-qid-no-output',
  label: 'Wikidata no output',
  latitude: 30.275,
  longitude: -97.742,
  visible: true,
  wikidata: 'Q999002',
  website: 'https://example.com/no-output',
  'plant:method': 'water-pumped-storage',
  start_date: '1912',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:No output',
});

const NO_DATE = Object.freeze({
  id: 'dam-qid-no-date',
  label: 'Wikidata no date',
  latitude: 30.285,
  longitude: -97.748,
  visible: true,
  wikidata: 'Q999003',
  website: 'https://example.com/no-date',
  'plant:method': 'run-of-the-river',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:No date',
});

const NO_METHOD = Object.freeze({
  id: 'dam-qid-no-method',
  label: 'Wikidata no method',
  latitude: 30.277,
  longitude: -97.741,
  visible: true,
  wikidata: 'Q999004',
  website: 'https://example.com/no-method',
  start_date: '1967',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:No method',
});

const NO_WEBSITE = Object.freeze({
  id: 'dam-qid-no-website',
  label: 'Wikidata no website',
  latitude: 30.278,
  longitude: -97.739,
  visible: true,
  wikidata: 'Q999005',
  'plant:method': 'water-storage',
  start_date: '1967',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:No website',
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

function fakeNode(tag = 'div') {
  const children = [];
  const listeners = new Map();
  const node = {
    tag,
    type: tag === 'button' ? 'button' : '',
    className: '',
    hidden: false,
    textContent: '',
    dataset: {},
    children,
    ownerDocument: null,
    appendChild(child) {
      children.push(child);
      child.parent = this;
      return child;
    },
    replaceChildren(...next) {
      children.length = 0;
      for (const child of next) this.appendChild(child);
    },
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    setAttribute(name, value) {
      if (name === 'role') this.role = value;
    },
    closest(selector) {
      if (selector === '[data-dam-id]' && this.dataset.damId) return this;
      return this.parent?.closest?.(selector) || null;
    },
  };
  return node;
}

function fakeDocument() {
  const doc = {
    createElement(tag) {
      const node = fakeNode(tag);
      node.ownerDocument = doc;
      return node;
    },
  };
  return doc;
}

function bundledWikidataByName(needle) {
  const lines = src('src/data/local_data/dams/dams.geojsonl').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const feature = JSON.parse(line);
    const name = String(feature?.properties?.name || '');
    const en = String(feature?.properties?.tags?.['name:en'] || '');
    if (name.includes(needle) || en.includes(needle)) {
      const tags = feature.properties?.tags || {};
      return tags.wikidata ?? feature.properties?.wikidata ?? null;
    }
  }
  return null;
}

function bundledWikipediaByName(needle) {
  const lines = src('src/data/local_data/dams/dams.geojsonl').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const feature = JSON.parse(line);
    const name = String(feature?.properties?.name || '');
    const en = String(feature?.properties?.tags?.['name:en'] || '');
    if (name.includes(needle) || en.includes(needle)) {
      const tags = feature.properties?.tags || {};
      return tags.wikipedia ?? feature.properties?.wikipedia ?? null;
    }
  }
  return null;
}

test('off keeps current draw including no-wikidata rows', () => {
  assert.equal(DEFAULT_DAM_WIKIDATA_ONLY, false);
  assert.equal(DAM_WIKIDATA_ONLY_CHIP_LABEL, 'Wikidata only');
  assert.equal(DAM_WIKIDATA_ONLY_CHIP_TITLE, 'Hide dams that have no OSM Wikidata Q-id');
  assert.equal(normalizeDamWikidataOnly(undefined), false);
  assert.equal(normalizeDamWikidataOnly(null), false);
  assert.equal(normalizeDamWikidataOnly(''), false);
  assert.equal(normalizeDamWikidataOnly(false), false);
  assert.equal(normalizeDamWikidataOnly(0), false);
  assert.equal(normalizeDamWikidataOnly('0'), false);
  assert.equal(normalizeDamWikidataOnly(true), true);
  assert.equal(normalizeDamWikidataOnly('1'), true);
  assert.equal(normalizeDamWikidataOnly('true'), true);
  assert.equal(normalizeDamWikidataOnly('bogus'), null);

  const records = [WIKIDATA, MISSING, EMPTY, WHITESPACE, WIKIPEDIA_ONLY];
  assert.deepEqual(
    filterDamsByWikidataOnly(records, false).map((row) => row.id),
    records.map((row) => row.id),
  );
  const listed = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    wikidataOnly: false,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set(records.map((row) => row.id)));
  assert.ok(listed.some((site) => site.id === MISSING.id));
  assert.ok(listed.some((site) => site.id === WIKIDATA.id));
  assert.ok(listed.some((site) => site.id === WIKIPEDIA_ONLY.id));
  assert.equal(damMatchesWikidataFilter(MISSING, false), true);
  assert.deepEqual(filterDamsByWikidataOnly(null), []);
  assert.deepEqual(filterDamsByWikidataOnly(undefined), []);
});

test('on keeps a Q-id and hides named wikipedia-less empty wikidata', () => {
  assert.equal(damWikidataRaw(WIKIDATA), 'Q201411');
  assert.equal(damHasWikidata(WIKIDATA), true);
  assert.equal(damMatchesWikidataFilter(WIKIDATA, true), true);
  assert.equal(damHasWikidata(EMPTY), false);
  assert.equal(damMatchesWikidataFilter(EMPTY, true), false);
  assert.equal(damHasWikidata(MISSING), false);
  assert.equal(damMatchesWikidataFilter(MISSING, true), false);
  assert.equal(damHasWikidata(WHITESPACE), false);
  assert.equal(damMatchesWikidataFilter(WHITESPACE, true), false);

  const kept = filterDamsByWikidataOnly([WIKIDATA, MISSING, EMPTY, WHITESPACE], true);
  assert.deepEqual(kept.map((row) => row.id), [WIKIDATA.id]);

  const listed = listDamsInView({
    enabled: true,
    records: [WIKIDATA, MISSING, EMPTY, WHITESPACE],
    view: AUSTIN_VIEW,
    wikidataOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [WIKIDATA.id]);
  assert.equal(listed[0].label, 'Itaipu Dam');
});

test('a wikipedia-only row with no Q-id hides when on', () => {
  assert.equal(damWikidataRaw(WIKIPEDIA_ONLY), null);
  assert.equal(damHasWikidata(WIKIPEDIA_ONLY), false);
  assert.equal(damMatchesWikidataFilter(WIKIPEDIA_ONLY, true), false);
  assert.equal(damWikidataRaw(WIKIDATA_ONLY), 'Q4755783');
  assert.equal(damHasWikidata(WIKIDATA_ONLY), true);
  assert.equal(damMatchesWikidataFilter(WIKIDATA_ONLY, true), true);

  const kept = filterDamsByWikidataOnly([WIKIDATA, WIKIPEDIA_ONLY, WIKIDATA_ONLY], true);
  assert.deepEqual(kept.map((row) => row.id), [WIKIDATA.id, WIKIDATA_ONLY.id]);

  const listed = listDamsInView({
    enabled: true,
    records: [WIKIDATA, WIKIPEDIA_ONLY, MISSING],
    view: AUSTIN_VIEW,
    wikidataOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [WIKIDATA.id]);
});

test('selected no-wikidata still lists', () => {
  assert.equal(
    damMatchesWikidataFilter(MISSING, true, { selectedId: MISSING.id }),
    true,
  );
  assert.deepEqual(
    filterDamsByWikidataOnly([WIKIDATA, MISSING, EMPTY], true, MISSING.id).map((row) => row.id),
    [WIKIDATA.id, MISSING.id],
  );
  const listed = listDamsInView({
    enabled: true,
    records: [WIKIDATA, MISSING, EMPTY],
    view: AUSTIN_VIEW,
    wikidataOnly: true,
    selectedId: EMPTY.id,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set([WIKIDATA.id, EMPTY.id]));
});

test('AND with Wiki only / Website only / 205 / 218 / 224 / 229 / 249 / 279 / 287', () => {
  const records = [
    WIKIDATA,
    MISSING,
    WIKIPEDIA_ONLY,
    SMALL_NAMED,
    FALLBACK_NAMED,
    NO_OUTPUT,
    NO_DATE,
    NO_METHOD,
    NO_WEBSITE,
  ];
  assert.equal(damMeetsOutputFloor(MISSING, '10'), true, '205 fail-open keeps missing output');
  const afterFloor = filterDamsByOutputFloor(records, '10');
  assert.deepEqual(
    afterFloor.map((row) => row.id),
    [
      WIKIDATA.id,
      MISSING.id,
      WIKIPEDIA_ONLY.id,
      FALLBACK_NAMED.id,
      NO_OUTPUT.id,
      NO_DATE.id,
      NO_METHOD.id,
      NO_WEBSITE.id,
    ],
    '10+ MW hides the named sub-10 MW plant before presence chips',
  );
  const afterNamed = filterDamsByNamedOnly(afterFloor, true);
  assert.deepEqual(
    afterNamed.map((row) => row.id),
    [WIKIDATA.id, MISSING.id, WIKIPEDIA_ONLY.id, NO_OUTPUT.id, NO_DATE.id, NO_METHOD.id, NO_WEBSITE.id],
  );
  const afterOperator = filterDamsByOperatorOnly(afterNamed, true);
  assert.deepEqual(
    afterOperator.map((row) => row.id),
    [WIKIDATA.id, MISSING.id, WIKIPEDIA_ONLY.id, NO_OUTPUT.id, NO_DATE.id, NO_METHOD.id, NO_WEBSITE.id],
  );
  const afterRiver = filterDamsByRiverOnly(afterOperator, true);
  assert.deepEqual(
    afterRiver.map((row) => row.id),
    [WIKIDATA.id, MISSING.id, WIKIPEDIA_ONLY.id, NO_OUTPUT.id, NO_DATE.id, NO_METHOD.id, NO_WEBSITE.id],
  );
  const afterWiki = filterDamsByWikiOnly(afterRiver, true);
  assert.deepEqual(
    afterWiki.map((row) => row.id),
    [WIKIDATA.id, WIKIPEDIA_ONLY.id, NO_OUTPUT.id, NO_DATE.id, NO_METHOD.id, NO_WEBSITE.id],
  );
  const afterOutputOnly = filterDamsByOutputOnly(afterWiki, true);
  assert.deepEqual(
    afterOutputOnly.map((row) => row.id),
    [WIKIDATA.id, WIKIPEDIA_ONLY.id, NO_DATE.id, NO_METHOD.id, NO_WEBSITE.id],
  );
  const afterDated = filterDamsByDatedOnly(afterOutputOnly, true);
  assert.deepEqual(
    afterDated.map((row) => row.id),
    [WIKIDATA.id, WIKIPEDIA_ONLY.id, NO_METHOD.id, NO_WEBSITE.id],
  );
  const afterMethod = filterDamsByMethodOnly(afterDated, true);
  assert.deepEqual(
    afterMethod.map((row) => row.id),
    [WIKIDATA.id, WIKIPEDIA_ONLY.id, NO_WEBSITE.id],
  );
  const afterWebsite = filterDamsByWebsiteOnly(afterMethod, true);
  assert.deepEqual(
    afterWebsite.map((row) => row.id),
    [WIKIDATA.id, WIKIPEDIA_ONLY.id],
  );
  assert.deepEqual(
    filterDamsByWikidataOnly(afterWebsite, true).map((row) => row.id),
    [WIKIDATA.id],
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
    datedOnly: true,
    methodOnly: true,
    websiteOnly: true,
    wikidataOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [WIKIDATA.id]);

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
    datedOnly: true,
    methodOnly: true,
    websiteOnly: true,
    wikidataOnly: true,
    selectedId: FALLBACK_NAMED.id,
  });
  assert.deepEqual(
    new Set(selectedThroughAnd.map((site) => site.id)),
    new Set([WIKIDATA.id, FALLBACK_NAMED.id]),
    'selected fallback Dam stays through output floor AND Named only AND Operator only AND River only AND Wikipedia only AND Output only AND Dated only AND Method only AND Website only AND Wikidata only',
  );
});

test('distinct from 240 Wikipedia only, 297 Website only, and the rest', () => {
  assert.deepEqual(
    filterDamsByWikiOnly([WIKIDATA, WIKIPEDIA_ONLY, WIKIDATA_ONLY, MISSING], true).map((row) => row.id),
    [WIKIDATA.id, WIKIPEDIA_ONLY.id, WIKIDATA_ONLY.id],
    'Wikipedia only keeps wikipedia-only and wikidata-only rows',
  );
  assert.deepEqual(
    filterDamsByWikidataOnly([WIKIDATA, WIKIPEDIA_ONLY, WIKIDATA_ONLY, MISSING], true).map((row) => row.id),
    [WIKIDATA.id, WIKIDATA_ONLY.id],
    'Wikidata only hides a wikipedia-only row with no Q-id',
  );
  assert.deepEqual(
    filterDamsByWebsiteOnly([WIKIDATA, NO_WEBSITE], true).map((row) => row.id),
    [WIKIDATA.id],
  );
  assert.deepEqual(
    filterDamsByWikidataOnly([WIKIDATA, NO_WEBSITE], true).map((row) => row.id),
    [WIKIDATA.id, NO_WEBSITE.id],
    'Wikidata only keeps a Q-id row that Website only would hide',
  );
  assert.equal(damHasWikidata({ tags: { 'operator:wikidata': 'Q6840876' } }), false);
  assert.equal(damHasWikidata({ wikipedia: 'en:Hoover Dam' }), false);
  assert.equal(damMatchesWikidataFilter({ wikipedia: 'en:Hoover Dam' }, true), false);
});

test('invalid / corrupt storage reads as off', () => {
  assert.equal(DAM_WIKIDATA_ONLY_STORAGE_KEY, 'meridian.damWikidataOnly');
  assert.equal(readDamWikidataOnly(memoryStorage()), false);
  assert.equal(readDamWikidataOnly(memoryStorage({ [DAM_WIKIDATA_ONLY_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readDamWikidataOnly(memoryStorage({ [DAM_WIKIDATA_ONLY_STORAGE_KEY]: 'bogus' })), false);
  assert.equal(readDamWikidataOnly(memoryStorage({ [DAM_WIKIDATA_ONLY_STORAGE_KEY]: '{}' })), false);
  assert.equal(readDamWikidataOnly(memoryStorage({ [DAM_WIKIDATA_ONLY_STORAGE_KEY]: '2' })), false);
  assert.equal(readDamWikidataOnly({
    getItem() { throw new Error('blocked'); },
  }), false);
  assert.equal(writeDamWikidataOnly('nope', memoryStorage()), false);
});

test('persist / hydrate, no share-URL write', () => {
  const storage = memoryStorage();
  assert.equal(writeDamWikidataOnly(true, storage), true);
  assert.equal(storage.getItem(DAM_WIKIDATA_ONLY_STORAGE_KEY), '1');
  assert.equal(readDamWikidataOnly(storage), true);
  const reloaded = memoryStorage(storage.snapshot());
  assert.equal(readDamWikidataOnly(reloaded), true);
  assert.equal(writeDamWikidataOnly(false, storage), true);
  assert.equal(storage.getItem(DAM_WIKIDATA_ONLY_STORAGE_KEY), '0');
  assert.equal(readDamWikidataOnly(memoryStorage(storage.snapshot())), false);
  assert.equal(Object.keys(storage.snapshot()).join(','), DAM_WIKIDATA_ONLY_STORAGE_KEY);
  assert.equal(damsWikidataOnlyChipModel(false).params.wikidataOnly, true);
  assert.equal(damsWikidataOnlyChipModel(true).params.wikidataOnly, false);
  assert.equal(damsWikidataOnlyChipModel(false).active, false);
  assert.equal(damsWikidataOnlyChipModel(true).active, true);

  const items = fakeNode('div');
  items.ownerDocument = fakeDocument();
  const binder = bindDamsInViewList({
    root: fakeNode('section'),
    items,
    getEnabled: () => true,
    getRecords: () => [WIKIDATA, MISSING],
    getView: () => AUSTIN_VIEW,
    getWikidataOnly: () => readDamWikidataOnly(storage),
    flyTo() {},
  });
  writeDamWikidataOnly(true, storage);
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), [WIKIDATA.id]);
  writeDamWikidataOnly(false, storage);
  binder.refresh();
  assert.deepEqual(new Set(binder.sites().map((site) => site.id)), new Set([WIKIDATA.id, MISSING.id]));
  binder.destroy();
});

test('properties.wikidata, tags.wikidata, and context local-dams:${id} count', () => {
  const viaProps = { id: 'via-props-qid', properties: { wikidata: 'Q172822' } };
  assert.equal(damWikidataRaw(viaProps), 'Q172822');
  assert.equal(damMatchesWikidataFilter(viaProps, true), true);

  const viaTags = { id: 'via-tags-qid', properties: { tags: { wikidata: 'Q201411' } } };
  assert.equal(damWikidataRaw(viaTags), 'Q201411');
  assert.equal(damMatchesWikidataFilter(viaTags, true), true);

  const viaRecordTags = { id: 'via-record-tags', tags: { wikidata: 'Q4755783' } };
  assert.equal(damWikidataRaw(viaRecordTags), 'Q4755783');

  const originalWindow = globalThis.window;
  globalThis.window = globalThis.window || {};
  try {
    const store = getContextStore();
    store.entities.set('local-dams:-19754263', {
      properties: { tags: { wikidata: 'Q4755783' } },
    });
    assert.equal(damWikidataRaw({ id: '-19754263' }), 'Q4755783');
    assert.equal(damMatchesWikidataFilter({ id: '-19754263' }, true), true);
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
      wikidataOnly: true,
    });
    assert.deepEqual(listed.map((site) => site.id), ['-19754263']);
    store.entities.delete('local-dams:-19754263');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('bundled snapshot already carries wikidata; distinct from 205/218/224/229/240/249/279/287/297', () => {
  assert.equal(bundledWikidataByName('Naghlu'), 'Q4755783');
  assert.equal(bundledWikipediaByName('Naghlu'), 'en:Naghlu Dam');
  assert.equal(bundledWikidataByName('Itaipu'), 'Q244169');
  const helper = src('src/data/damsWikidataFilter.js');
  const list = src('src/data/damsList.js');
  const wikiHelper = src('src/data/damsWikiFilter.js');
  const websiteHelper = src('src/data/damsWebsiteFilter.js');
  assert.match(helper, /meridian\.damWikidataOnly/);
  assert.doesNotMatch(helper, /meridian\.damWikiOnly/);
  assert.doesNotMatch(helper, /meridian\.damWebsiteOnly/);
  assert.doesNotMatch(helper, /damOutputFloor|namedOnly|operatorOnly|riverOnly|wikiOnly|outputOnly|datedOnly|methodOnly|websiteOnly|hideNoOperator/);
  assert.match(list, /damMatchesWikidataFilter|wikidataOnly/);
  assert.match(list, /damMatchesWebsiteFilter|websiteOnly/);
  assert.match(list, /damMatchesMethodOnlyFilter|methodOnly/);
  assert.match(list, /damMatchesDatedOnlyFilter|datedOnly/);
  assert.match(list, /damMatchesOutputOnlyFilter|outputOnly/);
  assert.match(list, /damMatchesWikiFilter|wikiOnly/);
  assert.match(list, /damMatchesRiverFilter|riverOnly/);
  assert.match(list, /damMatchesOperatorFilter|operatorOnly/);
  assert.match(list, /damMatchesNamedFilter|namedOnly/);
  assert.match(list, /damMeetsOutputFloor|outputFloor/);
  assert.ok(
    list.indexOf('damMatchesWebsiteFilter') < list.indexOf('damMatchesWikidataFilter'),
    'Wikidata only ANDs after Website only',
  );
  assert.ok(
    helper.includes('meridian.damWikidataOnly') && !helper.includes('meridian.damWebsiteOnly'),
    'Wikidata only persist key is distinct from Website only',
  );
  assert.ok(
    helper.includes('meridian.damWikidataOnly') && !wikiHelper.includes('meridian.damWikidataOnly'),
    'Wikidata only persist key is distinct from Wikipedia only',
  );
  assert.match(wikiHelper, /meridian\.damWikiOnly/);
  assert.match(websiteHelper, /meridian\.damWebsiteOnly/);
  assert.doesNotMatch(helper, /local-datacenters/);
  assert.match(helper, /local-dams:/);
});

test('localGeojson.js is unchanged', () => {
  const diff = execSync('git diff -- HEAD -- src/data/localGeojson.js', {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(diff, '', 'Plan 302 leftover must not edit localGeojson.js');
  const localGeojson = src('src/data/localGeojson.js');
  assert.doesNotMatch(localGeojson, /damWikidataOnly|damsWikidataFilter|meridian\.damWikidataOnly/);
});

test('list chip sits on the dams in-view surface; persist is local; no share-URL or /api', () => {
  const html = src('index.html');
  const ui = src('src/ui.js');
  const list = src('src/data/damsList.js');
  const helper = src('src/data/damsWikidataFilter.js');
  const layerState = src('src/data/layerState.js');
  const firstRun = src('src/firstRunExperience.js');
  const sharelink = src('src/sharelink.js');
  const css = src('style.css');
  const dcList = src('src/data/datacenterList.js');
  const panel = html.match(/<div id="dams-in-view"[\s\S]*?<p class="in-view-site-list-credit"/);
  assert.ok(panel, 'dams-in-view markup is missing');
  assert.match(panel[0], /id="dams-output-chips"/);
  assert.match(panel[0], /id="dams-named-chips"/);
  assert.match(panel[0], /id="dams-operator-chips"/);
  assert.match(panel[0], /id="dams-river-chips"/);
  assert.match(panel[0], /id="dams-wiki-chips"/);
  assert.match(panel[0], /id="dams-output-only-chips"/);
  assert.match(panel[0], /id="dams-dated-only-chips"/);
  assert.match(panel[0], /id="dams-method-only-chips"/);
  assert.match(panel[0], /id="dams-website-only-chips"/);
  assert.match(panel[0], /id="dams-wikidata-only-chips"/);
  assert.match(panel[0], /data-dam-wikidata-only="only"[^>]*>Wikidata only</);
  assert.match(panel[0], /data-dam-website-only="only"[^>]*>Website only</);
  assert.match(panel[0], /data-dam-wiki="only"[^>]*>Wikipedia only</);
  assert.ok(
    panel[0].indexOf('id="dams-website-only-chips"') < panel[0].indexOf('id="dams-wikidata-only-chips"'),
    'Wikidata only sits next to Website only',
  );
  assert.ok(
    panel[0].indexOf('id="dams-wikidata-only-chips"') < panel[0].indexOf('id="dams-in-view-items"'),
    'Wikidata only sits above the in-view items',
  );
  assert.match(html, /id="dams-in-view"[\s\S]*?© OpenStreetMap contributors/);
  assert.match(ui, /data-dam-wikidata-only/);
  assert.match(ui, /writeDamWikidataOnly|readDamWikidataOnly/);
  assert.match(css, /dams-wikidata-only-chip/);
  assert.match(list, /damMatchesWikidataFilter|filterDamsByWikidataOnly|wikidataOnly/);
  assert.doesNotMatch(list, /getRowControls/);
  assert.doesNotMatch(helper, /getRowControls/);
  assert.doesNotMatch(helper, /fetch\s*\(/);
  assert.doesNotMatch(list, /fetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\/dams/);
  assert.doesNotMatch(helper, /hideNoOperator|militaryNamedOnly|hasName|dcWebsiteOnly/);
  assert.doesNotMatch(list, /hideNoOperator|local-datacenters/);
  assert.doesNotMatch(dcList, /damWikidataOnly|damsWikidataFilter|meridian\.damWikidataOnly/);
  assert.doesNotMatch(layerState, /damWikidataOnly|damsWikidata/);
  assert.match(layerState, /id: 'local-dams', token: 'q', disposition: 'enabled-only'/);
  assert.doesNotMatch(firstRun, /writeDamWikidataOnly|setDamWikidataOnly/);
  assert.doesNotMatch(sharelink, /damWikidataOnly|meridian\.damWikidataOnly/);
  assert.equal(existsSync(path.join(ROOT, 'api/dams.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/dams/wikidata-only.js')), false);
});
