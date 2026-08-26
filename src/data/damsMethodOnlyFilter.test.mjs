// PLAN 287 — Dam list Method only toggle. Client-only filter of the
// already-bundled OSM / ODbL snapshot. Distinct from 205 output-floor,
// 218 Named only, 224 Operator only, 229 River only, 240 Wikipedia only,
// 249 Output only, and 279 Dated only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAM_METHOD_ONLY_CHIP_LABEL,
  DAM_METHOD_ONLY_CHIP_TITLE,
  DAM_METHOD_ONLY_STORAGE_KEY,
  DEFAULT_DAM_METHOD_ONLY,
  damHasPlantMethod,
  damMatchesMethodOnlyFilter,
  damPlantMethodRaw,
  damsMethodOnlyChipModel,
  filterDamsByMethodOnly,
  normalizeDamMethodOnly,
  readDamMethodOnly,
  writeDamMethodOnly,
} from './damsMethodOnlyFilter.js';
import { filterDamsByNamedOnly } from './damsNamedFilter.js';
import { filterDamsByOperatorOnly } from './damsOperatorFilter.js';
import { damMeetsOutputFloor, filterDamsByOutputFloor } from './damsOutputFilter.js';
import { filterDamsByOutputOnly } from './damsOutputOnlyFilter.js';
import { filterDamsByRiverOnly } from './damsRiverFilter.js';
import { filterDamsByWikiOnly } from './damsWikiFilter.js';
import { filterDamsByDatedOnly } from './damsDatedOnlyFilter.js';
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

const METHOD = Object.freeze({
  id: 'dam-rot',
  label: 'Barrage de Mobayi-Mbongo',
  latitude: 30.28,
  longitude: -97.74,
  visible: true,
  'plant:method': 'run-of-the-river',
  start_date: '1967',
  output: '100 MW',
  operator: 'Reclamation',
  river: 'Kabul',
  wikipedia: 'en:Barrage de Mobayi-Mbongo',
});

const MISSING = Object.freeze({
  id: 'dam-missing-method',
  label: 'Untagged dam',
  latitude: 30.30,
  longitude: -97.75,
  visible: true,
  start_date: '1967',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Untagged',
});

const EMPTY = Object.freeze({
  id: 'dam-empty-method',
  label: 'Empty method',
  latitude: 30.32,
  longitude: -97.76,
  visible: true,
  'plant:method': '',
  start_date: '1967',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Empty',
});

const WHITESPACE = Object.freeze({
  id: 'dam-ws-method',
  label: 'Whitespace method',
  latitude: 30.26,
  longitude: -97.73,
  visible: true,
  'plant:method': '   ',
  start_date: '1967',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Whitespace',
});

const SMALL_NAMED = Object.freeze({
  id: 'dam-small',
  label: 'Podlubnik',
  latitude: 30.27,
  longitude: -97.735,
  visible: true,
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
  'plant:method': 'water-storage',
  start_date: '1967',
  output: '2080 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Fallback Dam',
});

const NO_OUTPUT = Object.freeze({
  id: 'dam-method-no-output',
  label: 'Method no output',
  latitude: 30.275,
  longitude: -97.742,
  visible: true,
  'plant:method': 'water-pumped-storage',
  start_date: '1912',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:No output',
});

const NO_DATE = Object.freeze({
  id: 'dam-method-no-date',
  label: 'Method no date',
  latitude: 30.285,
  longitude: -97.748,
  visible: true,
  'plant:method': 'run-of-the-river',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:No date',
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

function bundledPlantMethodByName(needle) {
  const lines = src('src/data/local_data/dams/dams.geojsonl').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const feature = JSON.parse(line);
    const name = String(feature?.properties?.name || '');
    const en = String(feature?.properties?.tags?.['name:en'] || '');
    if (name.includes(needle) || en.includes(needle)) {
      return feature.properties?.tags?.['plant:method']
        ?? feature.properties?.['plant:method']
        ?? null;
    }
  }
  return null;
}

test('off keeps no-method and method rows', () => {
  assert.equal(DEFAULT_DAM_METHOD_ONLY, false);
  assert.equal(DAM_METHOD_ONLY_CHIP_LABEL, 'Method only');
  assert.equal(DAM_METHOD_ONLY_CHIP_TITLE, 'Hide dams that have no OSM plant:method');
  assert.equal(normalizeDamMethodOnly(undefined), false);
  assert.equal(normalizeDamMethodOnly(null), false);
  assert.equal(normalizeDamMethodOnly(''), false);
  assert.equal(normalizeDamMethodOnly(false), false);
  assert.equal(normalizeDamMethodOnly(0), false);
  assert.equal(normalizeDamMethodOnly('0'), false);
  assert.equal(normalizeDamMethodOnly(true), true);
  assert.equal(normalizeDamMethodOnly('1'), true);
  assert.equal(normalizeDamMethodOnly('true'), true);
  assert.equal(normalizeDamMethodOnly('bogus'), null);

  const records = [METHOD, MISSING, EMPTY, WHITESPACE];
  assert.deepEqual(
    filterDamsByMethodOnly(records, false).map((row) => row.id),
    records.map((row) => row.id),
  );
  const listed = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    methodOnly: false,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set(records.map((row) => row.id)));
  assert.ok(listed.some((site) => site.id === MISSING.id));
  assert.ok(listed.some((site) => site.id === METHOD.id));
  assert.equal(damMatchesMethodOnlyFilter(MISSING, false), true);
  assert.deepEqual(filterDamsByMethodOnly(null), []);
  assert.deepEqual(filterDamsByMethodOnly(undefined), []);
});

test('on drops no-method, keeps real method', () => {
  assert.equal(damPlantMethodRaw(METHOD), 'run-of-the-river');
  assert.equal(damHasPlantMethod(METHOD), true);
  assert.equal(damMatchesMethodOnlyFilter(METHOD, true), true);
  assert.equal(damHasPlantMethod(EMPTY), false);
  assert.equal(damMatchesMethodOnlyFilter(EMPTY, true), false);
  assert.equal(damHasPlantMethod(MISSING), false);
  assert.equal(damMatchesMethodOnlyFilter(MISSING, true), false);
  assert.equal(damHasPlantMethod(WHITESPACE), false);
  assert.equal(damMatchesMethodOnlyFilter(WHITESPACE, true), false);

  const kept = filterDamsByMethodOnly([METHOD, MISSING, EMPTY, WHITESPACE], true);
  assert.deepEqual(kept.map((row) => row.id), [METHOD.id]);

  const listed = listDamsInView({
    enabled: true,
    records: [METHOD, MISSING, EMPTY, WHITESPACE],
    view: AUSTIN_VIEW,
    methodOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [METHOD.id]);
  assert.equal(listed[0].label, 'Barrage de Mobayi-Mbongo');
});

test('selected no-method still lists', () => {
  assert.equal(
    damMatchesMethodOnlyFilter(MISSING, true, { selectedId: MISSING.id }),
    true,
  );
  assert.deepEqual(
    filterDamsByMethodOnly([METHOD, MISSING, EMPTY], true, MISSING.id).map((row) => row.id),
    [METHOD.id, MISSING.id],
  );
  const listed = listDamsInView({
    enabled: true,
    records: [METHOD, MISSING, EMPTY],
    view: AUSTIN_VIEW,
    methodOnly: true,
    selectedId: EMPTY.id,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set([METHOD.id, EMPTY.id]));
});

test('AND with named / operator / river / wiki / output / dated', () => {
  const records = [
    METHOD,
    MISSING,
    SMALL_NAMED,
    FALLBACK_NAMED,
    NO_OUTPUT,
    NO_DATE,
  ];
  assert.equal(damMeetsOutputFloor(MISSING, '10'), true, '205 fail-open keeps missing output');
  const afterFloor = filterDamsByOutputFloor(records, '10');
  assert.deepEqual(
    afterFloor.map((row) => row.id),
    [METHOD.id, MISSING.id, FALLBACK_NAMED.id, NO_OUTPUT.id, NO_DATE.id],
    '10+ MW hides the named sub-10 MW plant before presence chips',
  );
  const afterNamed = filterDamsByNamedOnly(afterFloor, true);
  assert.deepEqual(
    afterNamed.map((row) => row.id),
    [METHOD.id, MISSING.id, NO_OUTPUT.id, NO_DATE.id],
  );
  const afterOperator = filterDamsByOperatorOnly(afterNamed, true);
  assert.deepEqual(
    afterOperator.map((row) => row.id),
    [METHOD.id, MISSING.id, NO_OUTPUT.id, NO_DATE.id],
  );
  const afterRiver = filterDamsByRiverOnly(afterOperator, true);
  assert.deepEqual(
    afterRiver.map((row) => row.id),
    [METHOD.id, MISSING.id, NO_OUTPUT.id, NO_DATE.id],
  );
  const afterWiki = filterDamsByWikiOnly(afterRiver, true);
  assert.deepEqual(
    afterWiki.map((row) => row.id),
    [METHOD.id, MISSING.id, NO_OUTPUT.id, NO_DATE.id],
  );
  const afterOutputOnly = filterDamsByOutputOnly(afterWiki, true);
  assert.deepEqual(
    afterOutputOnly.map((row) => row.id),
    [METHOD.id, MISSING.id, NO_DATE.id],
  );
  const afterDated = filterDamsByDatedOnly(afterOutputOnly, true);
  assert.deepEqual(
    afterDated.map((row) => row.id),
    [METHOD.id, MISSING.id],
  );
  assert.deepEqual(
    filterDamsByMethodOnly(afterDated, true).map((row) => row.id),
    [METHOD.id],
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
  });
  assert.deepEqual(listed.map((site) => site.id), [METHOD.id]);

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
    selectedId: FALLBACK_NAMED.id,
  });
  assert.deepEqual(
    new Set(selectedThroughAnd.map((site) => site.id)),
    new Set([METHOD.id, FALLBACK_NAMED.id]),
    'selected fallback Dam stays through output floor AND Named only AND Operator only AND River only AND Wikipedia only AND Output only AND Dated only AND Method only',
  );
});

test('invalid / corrupt storage reads as off', () => {
  assert.equal(DAM_METHOD_ONLY_STORAGE_KEY, 'meridian.damMethodOnly');
  assert.equal(readDamMethodOnly(memoryStorage()), false);
  assert.equal(readDamMethodOnly(memoryStorage({ [DAM_METHOD_ONLY_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readDamMethodOnly(memoryStorage({ [DAM_METHOD_ONLY_STORAGE_KEY]: 'bogus' })), false);
  assert.equal(readDamMethodOnly(memoryStorage({ [DAM_METHOD_ONLY_STORAGE_KEY]: '{}' })), false);
  assert.equal(readDamMethodOnly(memoryStorage({ [DAM_METHOD_ONLY_STORAGE_KEY]: '2' })), false);
  assert.equal(readDamMethodOnly({
    getItem() { throw new Error('blocked'); },
  }), false);
  assert.equal(writeDamMethodOnly('nope', memoryStorage()), false);
});

test('persist / hydrate, no share-URL write', () => {
  const storage = memoryStorage();
  assert.equal(writeDamMethodOnly(true, storage), true);
  assert.equal(storage.getItem(DAM_METHOD_ONLY_STORAGE_KEY), '1');
  assert.equal(readDamMethodOnly(storage), true);
  const reloaded = memoryStorage(storage.snapshot());
  assert.equal(readDamMethodOnly(reloaded), true);
  assert.equal(writeDamMethodOnly(false, storage), true);
  assert.equal(storage.getItem(DAM_METHOD_ONLY_STORAGE_KEY), '0');
  assert.equal(readDamMethodOnly(memoryStorage(storage.snapshot())), false);
  assert.equal(Object.keys(storage.snapshot()).join(','), DAM_METHOD_ONLY_STORAGE_KEY);
  assert.equal(damsMethodOnlyChipModel(false).params.methodOnly, true);
  assert.equal(damsMethodOnlyChipModel(true).params.methodOnly, false);
  assert.equal(damsMethodOnlyChipModel(false).active, false);
  assert.equal(damsMethodOnlyChipModel(true).active, true);

  const items = fakeNode('div');
  items.ownerDocument = fakeDocument();
  const binder = bindDamsInViewList({
    root: fakeNode('section'),
    items,
    getEnabled: () => true,
    getRecords: () => [METHOD, MISSING],
    getView: () => AUSTIN_VIEW,
    getMethodOnly: () => readDamMethodOnly(storage),
    flyTo() {},
  });
  writeDamMethodOnly(true, storage);
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), [METHOD.id]);
  writeDamMethodOnly(false, storage);
  binder.refresh();
  assert.deepEqual(new Set(binder.sites().map((site) => site.id)), new Set([METHOD.id, MISSING.id]));
  binder.destroy();
});

test('properties.plant:method, tags.plant:method, and context local-dams:${id} count', () => {
  const viaProps = { id: 'via-props-method', properties: { 'plant:method': 'water-storage' } };
  assert.equal(damPlantMethodRaw(viaProps), 'water-storage');
  assert.equal(damMatchesMethodOnlyFilter(viaProps, true), true);

  const viaTags = { id: 'via-tags-method', properties: { tags: { 'plant:method': 'run-of-the-river' } } };
  assert.equal(damPlantMethodRaw(viaTags), 'run-of-the-river');
  assert.equal(damMatchesMethodOnlyFilter(viaTags, true), true);

  const viaRecordTags = { id: 'via-record-tags', tags: { 'plant:method': 'water-pumped-storage' } };
  assert.equal(damPlantMethodRaw(viaRecordTags), 'water-pumped-storage');

  const originalWindow = globalThis.window;
  globalThis.window = globalThis.window || {};
  try {
    const store = getContextStore();
    store.entities.set('local-dams:-14467328', {
      properties: { tags: { 'plant:method': 'run-of-the-river' } },
    });
    assert.equal(damPlantMethodRaw({ id: '-14467328' }), 'run-of-the-river');
    assert.equal(damMatchesMethodOnlyFilter({ id: '-14467328' }, true), true);
    const listed = listDamsInView({
      enabled: true,
      records: [{
        id: '-14467328',
        label: 'Barrage de Mobayi-Mbongo',
        latitude: 30.28,
        longitude: -97.74,
        visible: true,
      }, MISSING],
      view: AUSTIN_VIEW,
      methodOnly: true,
    });
    assert.deepEqual(listed.map((site) => site.id), ['-14467328']);
    store.entities.delete('local-dams:-14467328');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('bundled snapshot already carries tags.plant:method; distinct from 205/218/224/229/240/249/279', () => {
  assert.equal(bundledPlantMethodByName('Mobayi-Mbongo'), 'run-of-the-river');
  const helper = src('src/data/damsMethodOnlyFilter.js');
  const list = src('src/data/damsList.js');
  assert.match(helper, /meridian\.damMethodOnly/);
  assert.doesNotMatch(helper, /damOutputFloor|namedOnly|operatorOnly|riverOnly|wikiOnly|outputOnly|datedOnly|hideNoOperator/);
  assert.match(list, /damMatchesMethodOnlyFilter|methodOnly/);
  assert.match(list, /damMatchesDatedOnlyFilter|datedOnly/);
  assert.match(list, /damMatchesOutputOnlyFilter|outputOnly/);
  assert.match(list, /damMatchesWikiFilter|wikiOnly/);
  assert.match(list, /damMatchesRiverFilter|riverOnly/);
  assert.match(list, /damMatchesOperatorFilter|operatorOnly/);
  assert.match(list, /damMatchesNamedFilter|namedOnly/);
  assert.match(list, /damMeetsOutputFloor|outputFloor/);
  assert.ok(
    list.indexOf('damMatchesDatedOnlyFilter') < list.indexOf('damMatchesMethodOnlyFilter'),
    'Method only ANDs after Dated only',
  );
  assert.ok(
    helper.includes('meridian.damMethodOnly') && !helper.includes('meridian.damDatedOnly'),
    'Method only persist key is distinct from Dated only',
  );
});

test('localGeojson.js is unchanged', () => {
  const diff = execSync('git diff -- HEAD -- src/data/localGeojson.js', {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(diff, '', 'Plan 287 must not edit localGeojson.js');
  const localGeojson = src('src/data/localGeojson.js');
  assert.doesNotMatch(localGeojson, /damMethodOnly|damsMethodOnlyFilter|meridian\.damMethodOnly/);
});

test('list chip sits on the dams in-view surface; persist is local; no share-URL or /api', () => {
  const html = src('index.html');
  const ui = src('src/ui.js');
  const list = src('src/data/damsList.js');
  const helper = src('src/data/damsMethodOnlyFilter.js');
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
  assert.match(panel[0], /id="dams-dated-only-chips"/);
  assert.match(panel[0], /id="dams-method-only-chips"/);
  assert.match(panel[0], /data-dam-method-only="only"[^>]*>Method only</);
  assert.match(panel[0], /data-dam-dated-only="only"[^>]*>Dated only</);
  assert.match(panel[0], /data-dam-output-only="only"[^>]*>Output only</);
  assert.ok(
    panel[0].indexOf('id="dams-dated-only-chips"') < panel[0].indexOf('id="dams-method-only-chips"'),
    'Method only sits next to Dated only',
  );
  assert.ok(
    panel[0].indexOf('id="dams-method-only-chips"') < panel[0].indexOf('id="dams-in-view-items"'),
    'Method only sits above the in-view items',
  );
  assert.match(html, /id="dams-in-view"[\s\S]*?© OpenStreetMap contributors/);
  assert.match(ui, /data-dam-method-only/);
  assert.match(ui, /writeDamMethodOnly|readDamMethodOnly/);
  assert.match(css, /dams-method-only-chip/);
  assert.match(list, /damMatchesMethodOnlyFilter|filterDamsByMethodOnly|methodOnly/);
  assert.doesNotMatch(list, /getRowControls/);
  assert.doesNotMatch(helper, /getRowControls/);
  assert.doesNotMatch(helper, /fetch\s*\(/);
  assert.doesNotMatch(list, /fetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\/dams/);
  assert.doesNotMatch(helper, /hideNoOperator|militaryNamedOnly|hasName/);
  assert.doesNotMatch(list, /hideNoOperator|local-datacenters/);
  assert.doesNotMatch(layerState, /damMethodOnly|damsMethodOnly/);
  assert.match(layerState, /id: 'local-dams', token: 'q', disposition: 'enabled-only'/);
  assert.match(firstRun, /meridian\.damMethodOnly/);
  assert.doesNotMatch(firstRun, /writeDamMethodOnly|setDamMethodOnly/);
  assert.doesNotMatch(sharelink, /damMethodOnly|meridian\.damMethodOnly/);
  assert.equal(existsSync(path.join(ROOT, 'api/dams.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/dams/method-only.js')), false);
});
