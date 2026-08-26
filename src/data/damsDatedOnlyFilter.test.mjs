// PLAN 279 — Dam list Dated only toggle. Client-only filter of the
// already-bundled OSM / ODbL snapshot. Distinct from 205 output-floor,
// 218 Named only, 224 Operator only, 229 River only, 240 Wikipedia only,
// and 249 Output only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAM_DATED_ONLY_CHIP_LABEL,
  DAM_DATED_ONLY_CHIP_TITLE,
  DAM_DATED_ONLY_STORAGE_KEY,
  DEFAULT_DAM_DATED_ONLY,
  damHasStartDate,
  damMatchesDatedOnlyFilter,
  damStartDateRaw,
  damsDatedOnlyChipModel,
  filterDamsByDatedOnly,
  normalizeDamDatedOnly,
  readDamDatedOnly,
  writeDamDatedOnly,
} from './damsDatedOnlyFilter.js';
import { filterDamsByNamedOnly } from './damsNamedFilter.js';
import { filterDamsByOperatorOnly } from './damsOperatorFilter.js';
import { damMeetsOutputFloor, filterDamsByOutputFloor } from './damsOutputFilter.js';
import { filterDamsByOutputOnly } from './damsOutputOnlyFilter.js';
import { filterDamsByRiverOnly } from './damsRiverFilter.js';
import { filterDamsByWikiOnly } from './damsWikiFilter.js';
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

const DATED = Object.freeze({
  id: 'dam-1967',
  label: 'Naghlu Dam',
  latitude: 30.28,
  longitude: -97.74,
  visible: true,
  start_date: '1967',
  output: '100 MW',
  operator: 'Reclamation',
  river: 'Kabul',
  wikipedia: 'en:Naghlu Dam',
});

const MISSING = Object.freeze({
  id: 'dam-missing-date',
  label: 'Untagged dam',
  latitude: 30.30,
  longitude: -97.75,
  visible: true,
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Untagged',
});

const EMPTY = Object.freeze({
  id: 'dam-empty-date',
  label: 'Empty date',
  latitude: 30.32,
  longitude: -97.76,
  visible: true,
  start_date: '',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Empty',
});

const WHITESPACE = Object.freeze({
  id: 'dam-ws-date',
  label: 'Whitespace date',
  latitude: 30.26,
  longitude: -97.73,
  visible: true,
  start_date: '   ',
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
  start_date: '1967',
  output: '2080 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Fallback Dam',
});

const NO_OUTPUT = Object.freeze({
  id: 'dam-dated-no-output',
  label: 'Dated no output',
  latitude: 30.275,
  longitude: -97.742,
  visible: true,
  start_date: '1912',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:No output',
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

function bundledStartDateByName(needle) {
  const lines = src('src/data/local_data/dams/dams.geojsonl').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const feature = JSON.parse(line);
    const name = String(feature?.properties?.name || '');
    const en = String(feature?.properties?.tags?.['name:en'] || '');
    if (name.includes(needle) || en.includes(needle)) {
      return feature.properties?.tags?.start_date ?? feature.properties?.start_date ?? null;
    }
  }
  return null;
}

test('off keeps undated and dated rows', () => {
  assert.equal(DEFAULT_DAM_DATED_ONLY, false);
  assert.equal(DAM_DATED_ONLY_CHIP_LABEL, 'Dated only');
  assert.equal(DAM_DATED_ONLY_CHIP_TITLE, 'Hide dams that have no OSM start_date');
  assert.equal(normalizeDamDatedOnly(undefined), false);
  assert.equal(normalizeDamDatedOnly(null), false);
  assert.equal(normalizeDamDatedOnly(''), false);
  assert.equal(normalizeDamDatedOnly(false), false);
  assert.equal(normalizeDamDatedOnly(0), false);
  assert.equal(normalizeDamDatedOnly('0'), false);
  assert.equal(normalizeDamDatedOnly(true), true);
  assert.equal(normalizeDamDatedOnly('1'), true);
  assert.equal(normalizeDamDatedOnly('true'), true);
  assert.equal(normalizeDamDatedOnly('bogus'), null);

  const records = [DATED, MISSING, EMPTY, WHITESPACE];
  assert.deepEqual(
    filterDamsByDatedOnly(records, false).map((row) => row.id),
    records.map((row) => row.id),
  );
  const listed = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    datedOnly: false,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set(records.map((row) => row.id)));
  assert.ok(listed.some((site) => site.id === MISSING.id));
  assert.ok(listed.some((site) => site.id === DATED.id));
  assert.equal(damMatchesDatedOnlyFilter(MISSING, false), true);
  assert.deepEqual(filterDamsByDatedOnly(null), []);
  assert.deepEqual(filterDamsByDatedOnly(undefined), []);
});

test('on drops undated, keeps dated', () => {
  assert.equal(damStartDateRaw(DATED), '1967');
  assert.equal(damHasStartDate(DATED), true);
  assert.equal(damMatchesDatedOnlyFilter(DATED, true), true);
  assert.equal(damHasStartDate(EMPTY), false);
  assert.equal(damMatchesDatedOnlyFilter(EMPTY, true), false);
  assert.equal(damHasStartDate(MISSING), false);
  assert.equal(damMatchesDatedOnlyFilter(MISSING, true), false);
  assert.equal(damHasStartDate(WHITESPACE), false);
  assert.equal(damMatchesDatedOnlyFilter(WHITESPACE, true), false);

  const kept = filterDamsByDatedOnly([DATED, MISSING, EMPTY, WHITESPACE], true);
  assert.deepEqual(kept.map((row) => row.id), [DATED.id]);

  const listed = listDamsInView({
    enabled: true,
    records: [DATED, MISSING, EMPTY, WHITESPACE],
    view: AUSTIN_VIEW,
    datedOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [DATED.id]);
  assert.equal(listed[0].label, 'Naghlu Dam');
});

test('selected undated row still lists', () => {
  assert.equal(
    damMatchesDatedOnlyFilter(MISSING, true, { selectedId: MISSING.id }),
    true,
  );
  assert.deepEqual(
    filterDamsByDatedOnly([DATED, MISSING, EMPTY], true, MISSING.id).map((row) => row.id),
    [DATED.id, MISSING.id],
  );
  const listed = listDamsInView({
    enabled: true,
    records: [DATED, MISSING, EMPTY],
    view: AUSTIN_VIEW,
    datedOnly: true,
    selectedId: EMPTY.id,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set([DATED.id, EMPTY.id]));
});

test('AND with named / operator / river / wiki / output', () => {
  const records = [
    DATED,
    MISSING,
    SMALL_NAMED,
    FALLBACK_NAMED,
    NO_OUTPUT,
  ];
  assert.equal(damMeetsOutputFloor(MISSING, '10'), true, '205 fail-open keeps missing output');
  const afterFloor = filterDamsByOutputFloor(records, '10');
  assert.deepEqual(
    afterFloor.map((row) => row.id),
    [DATED.id, MISSING.id, FALLBACK_NAMED.id, NO_OUTPUT.id],
    '10+ MW hides the named sub-10 MW plant before presence chips',
  );
  const afterNamed = filterDamsByNamedOnly(afterFloor, true);
  assert.deepEqual(
    afterNamed.map((row) => row.id),
    [DATED.id, MISSING.id, NO_OUTPUT.id],
  );
  const afterOperator = filterDamsByOperatorOnly(afterNamed, true);
  assert.deepEqual(
    afterOperator.map((row) => row.id),
    [DATED.id, MISSING.id, NO_OUTPUT.id],
  );
  const afterRiver = filterDamsByRiverOnly(afterOperator, true);
  assert.deepEqual(
    afterRiver.map((row) => row.id),
    [DATED.id, MISSING.id, NO_OUTPUT.id],
  );
  const afterWiki = filterDamsByWikiOnly(afterRiver, true);
  assert.deepEqual(
    afterWiki.map((row) => row.id),
    [DATED.id, MISSING.id, NO_OUTPUT.id],
  );
  const afterOutputOnly = filterDamsByOutputOnly(afterWiki, true);
  assert.deepEqual(
    afterOutputOnly.map((row) => row.id),
    [DATED.id, MISSING.id],
  );
  assert.deepEqual(
    filterDamsByDatedOnly(afterOutputOnly, true).map((row) => row.id),
    [DATED.id],
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
  });
  assert.deepEqual(listed.map((site) => site.id), [DATED.id]);

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
    selectedId: FALLBACK_NAMED.id,
  });
  assert.deepEqual(
    new Set(selectedThroughAnd.map((site) => site.id)),
    new Set([DATED.id, FALLBACK_NAMED.id]),
    'selected fallback Dam stays through output floor AND Named only AND Operator only AND River only AND Wikipedia only AND Output only AND Dated only',
  );
});

test('invalid / corrupt storage reads as off', () => {
  assert.equal(DAM_DATED_ONLY_STORAGE_KEY, 'meridian.damDatedOnly');
  assert.equal(readDamDatedOnly(memoryStorage()), false);
  assert.equal(readDamDatedOnly(memoryStorage({ [DAM_DATED_ONLY_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readDamDatedOnly(memoryStorage({ [DAM_DATED_ONLY_STORAGE_KEY]: 'bogus' })), false);
  assert.equal(readDamDatedOnly(memoryStorage({ [DAM_DATED_ONLY_STORAGE_KEY]: '{}' })), false);
  assert.equal(readDamDatedOnly(memoryStorage({ [DAM_DATED_ONLY_STORAGE_KEY]: '2' })), false);
  assert.equal(readDamDatedOnly({
    getItem() { throw new Error('blocked'); },
  }), false);
  assert.equal(writeDamDatedOnly('nope', memoryStorage()), false);
});

test('persist / hydrate, no share-URL write', () => {
  const storage = memoryStorage();
  assert.equal(writeDamDatedOnly(true, storage), true);
  assert.equal(storage.getItem(DAM_DATED_ONLY_STORAGE_KEY), '1');
  assert.equal(readDamDatedOnly(storage), true);
  const reloaded = memoryStorage(storage.snapshot());
  assert.equal(readDamDatedOnly(reloaded), true);
  assert.equal(writeDamDatedOnly(false, storage), true);
  assert.equal(storage.getItem(DAM_DATED_ONLY_STORAGE_KEY), '0');
  assert.equal(readDamDatedOnly(memoryStorage(storage.snapshot())), false);
  assert.equal(Object.keys(storage.snapshot()).join(','), DAM_DATED_ONLY_STORAGE_KEY);
  assert.equal(damsDatedOnlyChipModel(false).params.datedOnly, true);
  assert.equal(damsDatedOnlyChipModel(true).params.datedOnly, false);
  assert.equal(damsDatedOnlyChipModel(false).active, false);
  assert.equal(damsDatedOnlyChipModel(true).active, true);

  const items = fakeNode('div');
  items.ownerDocument = fakeDocument();
  const binder = bindDamsInViewList({
    root: fakeNode('section'),
    items,
    getEnabled: () => true,
    getRecords: () => [DATED, MISSING],
    getView: () => AUSTIN_VIEW,
    getDatedOnly: () => readDamDatedOnly(storage),
    flyTo() {},
  });
  writeDamDatedOnly(true, storage);
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), [DATED.id]);
  writeDamDatedOnly(false, storage);
  binder.refresh();
  assert.deepEqual(new Set(binder.sites().map((site) => site.id)), new Set([DATED.id, MISSING.id]));
  binder.destroy();
});

test('properties.start_date, tags.start_date, and context local-dams:${id} count', () => {
  const viaProps = { id: 'via-props-date', properties: { start_date: '1967' } };
  assert.equal(damStartDateRaw(viaProps), '1967');
  assert.equal(damMatchesDatedOnlyFilter(viaProps, true), true);

  const viaTags = { id: 'via-tags-date', properties: { tags: { start_date: '1912' } } };
  assert.equal(damStartDateRaw(viaTags), '1912');
  assert.equal(damMatchesDatedOnlyFilter(viaTags, true), true);

  const viaRecordTags = { id: 'via-record-tags', tags: { start_date: '1942-01' } };
  assert.equal(damStartDateRaw(viaRecordTags), '1942-01');

  const originalWindow = globalThis.window;
  globalThis.window = globalThis.window || {};
  try {
    const store = getContextStore();
    store.entities.set('local-dams:-19754263', {
      properties: { tags: { start_date: '1967' } },
    });
    assert.equal(damStartDateRaw({ id: '-19754263' }), '1967');
    assert.equal(damMatchesDatedOnlyFilter({ id: '-19754263' }, true), true);
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
      datedOnly: true,
    });
    assert.deepEqual(listed.map((site) => site.id), ['-19754263']);
    store.entities.delete('local-dams:-19754263');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('bundled snapshot already carries tags.start_date; distinct from 205/218/224/229/240/249', () => {
  assert.equal(bundledStartDateByName('Naghlu'), '1967');
  const helper = src('src/data/damsDatedOnlyFilter.js');
  const list = src('src/data/damsList.js');
  assert.match(helper, /meridian\.damDatedOnly/);
  assert.doesNotMatch(helper, /damOutputFloor|namedOnly|operatorOnly|riverOnly|wikiOnly|outputOnly|hideNoOperator/);
  assert.match(list, /damMatchesDatedOnlyFilter|datedOnly/);
  assert.match(list, /damMatchesOutputOnlyFilter|outputOnly/);
  assert.match(list, /damMatchesWikiFilter|wikiOnly/);
  assert.match(list, /damMatchesRiverFilter|riverOnly/);
  assert.match(list, /damMatchesOperatorFilter|operatorOnly/);
  assert.match(list, /damMatchesNamedFilter|namedOnly/);
  assert.match(list, /damMeetsOutputFloor|outputFloor/);
  assert.ok(
    list.indexOf('damMatchesOutputOnlyFilter') < list.indexOf('damMatchesDatedOnlyFilter'),
    'Dated only ANDs after Output only',
  );
});

test('localGeojson.js is unchanged', () => {
  const diff = execSync('git diff -- HEAD -- src/data/localGeojson.js', {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(diff, '', 'Plan 279 must not edit localGeojson.js');
  const localGeojson = src('src/data/localGeojson.js');
  assert.doesNotMatch(localGeojson, /damDatedOnly|damsDatedOnlyFilter|meridian\.damDatedOnly/);
});

test('list chip sits on the dams in-view surface; persist is local; no share-URL or /api', () => {
  const html = src('index.html');
  const ui = src('src/ui.js');
  const list = src('src/data/damsList.js');
  const helper = src('src/data/damsDatedOnlyFilter.js');
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
  assert.match(panel[0], /data-dam-dated-only="only"[^>]*>Dated only</);
  assert.ok(
    panel[0].indexOf('id="dams-output-only-chips"') < panel[0].indexOf('id="dams-dated-only-chips"'),
    'Dated only sits next to Output only',
  );
  assert.ok(
    panel[0].indexOf('id="dams-dated-only-chips"') < panel[0].indexOf('id="dams-in-view-items"'),
    'Dated only sits above the in-view items',
  );
  assert.match(html, /id="dams-in-view"[\s\S]*?© OpenStreetMap contributors/);
  assert.match(ui, /data-dam-dated-only/);
  assert.match(ui, /writeDamDatedOnly|readDamDatedOnly/);
  assert.match(css, /dams-dated-only-chip/);
  assert.match(list, /damMatchesDatedOnlyFilter|filterDamsByDatedOnly|datedOnly/);
  assert.doesNotMatch(list, /getRowControls/);
  assert.doesNotMatch(helper, /getRowControls/);
  assert.doesNotMatch(helper, /fetch\s*\(/);
  assert.doesNotMatch(list, /fetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\/dams/);
  assert.doesNotMatch(helper, /hideNoOperator|militaryNamedOnly|hasName/);
  assert.doesNotMatch(list, /hideNoOperator|local-datacenters/);
  assert.doesNotMatch(layerState, /damDatedOnly|damsDatedOnly/);
  assert.match(layerState, /id: 'local-dams', token: 'q', disposition: 'enabled-only'/);
  assert.match(firstRun, /meridian\.damDatedOnly/);
  assert.doesNotMatch(firstRun, /writeDamDatedOnly|setDamDatedOnly/);
  assert.doesNotMatch(sharelink, /damDatedOnly|meridian\.damDatedOnly/);
  assert.equal(existsSync(path.join(ROOT, 'api/dams.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/dams/dated-only.js')), false);
});
