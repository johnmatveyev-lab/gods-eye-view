// PLAN 297 leftover — Dam list Website only toggle. Client-only filter
// of the already-bundled OSM / ODbL snapshot. Distinct from 205 output
// floor, 218 Named only, 224 Operator only, 229 River only, 240 Wikipedia
// only, 249 Output only, 279 Dated only, 287 Method only, and datacenter
// 285 Website only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAM_WEBSITE_ONLY_CHIP_LABEL,
  DAM_WEBSITE_ONLY_CHIP_TITLE,
  DAM_WEBSITE_ONLY_STORAGE_KEY,
  DEFAULT_DAM_WEBSITE_ONLY,
  damHasWebsite,
  damMatchesWebsiteFilter,
  damWebsiteRaw,
  damsWebsiteOnlyChipModel,
  filterDamsByWebsiteOnly,
  normalizeDamWebsiteOnly,
  readDamWebsiteOnly,
  writeDamWebsiteOnly,
} from './damsWebsiteFilter.js';
import { filterDamsByNamedOnly } from './damsNamedFilter.js';
import { filterDamsByOperatorOnly } from './damsOperatorFilter.js';
import { damMeetsOutputFloor, filterDamsByOutputFloor } from './damsOutputFilter.js';
import { filterDamsByOutputOnly } from './damsOutputOnlyFilter.js';
import { filterDamsByRiverOnly } from './damsRiverFilter.js';
import { filterDamsByWikiOnly } from './damsWikiFilter.js';
import { filterDamsByDatedOnly } from './damsDatedOnlyFilter.js';
import { filterDamsByMethodOnly } from './damsMethodOnlyFilter.js';
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

const WEBSITE = Object.freeze({
  id: 'dam-web',
  label: 'Grand Coulee Dam',
  latitude: 30.28,
  longitude: -97.74,
  visible: true,
  website: 'https://usbr.gov/pn/grandcoulee/',
  'plant:method': 'water-storage',
  start_date: '1942',
  output: '6809 MW',
  operator: 'Reclamation',
  river: 'Columbia',
  wikipedia: 'en:Grand Coulee Dam',
});

const MISSING = Object.freeze({
  id: 'dam-missing-web',
  label: 'Untagged dam',
  latitude: 30.30,
  longitude: -97.75,
  visible: true,
  'plant:method': 'run-of-the-river',
  start_date: '1967',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Untagged',
});

const EMPTY = Object.freeze({
  id: 'dam-empty-web',
  label: 'Empty website',
  latitude: 30.32,
  longitude: -97.76,
  visible: true,
  website: '',
  'plant:method': 'run-of-the-river',
  start_date: '1967',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Empty',
});

const WHITESPACE = Object.freeze({
  id: 'dam-ws-web',
  label: 'Whitespace website',
  latitude: 30.26,
  longitude: -97.73,
  visible: true,
  website: '   ',
  'plant:method': 'run-of-the-river',
  start_date: '1967',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:Whitespace',
});

const CONTACT = Object.freeze({
  id: 'dam-contact-web',
  label: 'Zhigulyovskaya Dam',
  latitude: 30.275,
  longitude: -97.738,
  visible: true,
  'contact:website': 'http://www.zhiges.rushydro.ru/',
  'plant:method': 'water-storage',
  start_date: '1955-12-29',
  output: '2488 MW',
  operator: 'RusHydro',
  river: 'Volga',
  wikipedia: 'ru:Жигулёвская ГЭС',
});

const SMALL_NAMED = Object.freeze({
  id: 'dam-small',
  label: 'Podlubnik',
  latitude: 30.27,
  longitude: -97.735,
  visible: true,
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
  id: 'dam-web-no-output',
  label: 'Website no output',
  latitude: 30.275,
  longitude: -97.742,
  visible: true,
  website: 'https://example.com/no-output',
  'plant:method': 'water-pumped-storage',
  start_date: '1912',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:No output',
});

const NO_DATE = Object.freeze({
  id: 'dam-web-no-date',
  label: 'Website no date',
  latitude: 30.285,
  longitude: -97.748,
  visible: true,
  website: 'https://example.com/no-date',
  'plant:method': 'run-of-the-river',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:No date',
});

const NO_METHOD = Object.freeze({
  id: 'dam-web-no-method',
  label: 'Website no method',
  latitude: 30.277,
  longitude: -97.741,
  visible: true,
  website: 'https://example.com/no-method',
  start_date: '1967',
  output: '120 MW',
  operator: 'Reclamation',
  river: 'Colorado',
  wikipedia: 'en:No method',
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

function bundledWebsiteByName(needle) {
  const lines = src('src/data/local_data/dams/dams.geojsonl').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const feature = JSON.parse(line);
    const name = String(feature?.properties?.name || '');
    const en = String(feature?.properties?.tags?.['name:en'] || '');
    if (name.includes(needle) || en.includes(needle)) {
      const tags = feature.properties?.tags || {};
      return tags.website
        ?? tags['contact:website']
        ?? feature.properties?.website
        ?? feature.properties?.['contact:website']
        ?? null;
    }
  }
  return null;
}

test('off keeps no-website and website rows', () => {
  assert.equal(DEFAULT_DAM_WEBSITE_ONLY, false);
  assert.equal(DAM_WEBSITE_ONLY_CHIP_LABEL, 'Website only');
  assert.equal(DAM_WEBSITE_ONLY_CHIP_TITLE, 'Hide dams that have no OSM website');
  assert.equal(normalizeDamWebsiteOnly(undefined), false);
  assert.equal(normalizeDamWebsiteOnly(null), false);
  assert.equal(normalizeDamWebsiteOnly(''), false);
  assert.equal(normalizeDamWebsiteOnly(false), false);
  assert.equal(normalizeDamWebsiteOnly(0), false);
  assert.equal(normalizeDamWebsiteOnly('0'), false);
  assert.equal(normalizeDamWebsiteOnly(true), true);
  assert.equal(normalizeDamWebsiteOnly('1'), true);
  assert.equal(normalizeDamWebsiteOnly('true'), true);
  assert.equal(normalizeDamWebsiteOnly('bogus'), null);

  const records = [WEBSITE, MISSING, EMPTY, WHITESPACE];
  assert.deepEqual(
    filterDamsByWebsiteOnly(records, false).map((row) => row.id),
    records.map((row) => row.id),
  );
  const listed = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    websiteOnly: false,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set(records.map((row) => row.id)));
  assert.ok(listed.some((site) => site.id === MISSING.id));
  assert.ok(listed.some((site) => site.id === WEBSITE.id));
  assert.equal(damMatchesWebsiteFilter(MISSING, false), true);
  assert.deepEqual(filterDamsByWebsiteOnly(null), []);
  assert.deepEqual(filterDamsByWebsiteOnly(undefined), []);
});

test('on drops no-website / whitespace; keeps a real website', () => {
  assert.equal(damWebsiteRaw(WEBSITE), 'https://usbr.gov/pn/grandcoulee/');
  assert.equal(damHasWebsite(WEBSITE), true);
  assert.equal(damMatchesWebsiteFilter(WEBSITE, true), true);
  assert.equal(damHasWebsite(EMPTY), false);
  assert.equal(damMatchesWebsiteFilter(EMPTY, true), false);
  assert.equal(damHasWebsite(MISSING), false);
  assert.equal(damMatchesWebsiteFilter(MISSING, true), false);
  assert.equal(damHasWebsite(WHITESPACE), false);
  assert.equal(damMatchesWebsiteFilter(WHITESPACE, true), false);
  assert.equal(damWebsiteRaw(CONTACT), 'http://www.zhiges.rushydro.ru/');
  assert.equal(damHasWebsite(CONTACT), true);

  const kept = filterDamsByWebsiteOnly([WEBSITE, MISSING, EMPTY, WHITESPACE, CONTACT], true);
  assert.deepEqual(kept.map((row) => row.id), [WEBSITE.id, CONTACT.id]);

  const listed = listDamsInView({
    enabled: true,
    records: [WEBSITE, MISSING, EMPTY, WHITESPACE],
    view: AUSTIN_VIEW,
    websiteOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [WEBSITE.id]);
  assert.equal(listed[0].label, 'Grand Coulee Dam');
});

test('selected no-website still lists', () => {
  assert.equal(
    damMatchesWebsiteFilter(MISSING, true, { selectedId: MISSING.id }),
    true,
  );
  assert.deepEqual(
    filterDamsByWebsiteOnly([WEBSITE, MISSING, EMPTY], true, MISSING.id).map((row) => row.id),
    [WEBSITE.id, MISSING.id],
  );
  const listed = listDamsInView({
    enabled: true,
    records: [WEBSITE, MISSING, EMPTY],
    view: AUSTIN_VIEW,
    websiteOnly: true,
    selectedId: EMPTY.id,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set([WEBSITE.id, EMPTY.id]));
});

test('AND with 205/218/224/229/240/249/279/287', () => {
  const records = [
    WEBSITE,
    MISSING,
    SMALL_NAMED,
    FALLBACK_NAMED,
    NO_OUTPUT,
    NO_DATE,
    NO_METHOD,
  ];
  assert.equal(damMeetsOutputFloor(MISSING, '10'), true, '205 fail-open keeps missing output');
  const afterFloor = filterDamsByOutputFloor(records, '10');
  assert.deepEqual(
    afterFloor.map((row) => row.id),
    [WEBSITE.id, MISSING.id, FALLBACK_NAMED.id, NO_OUTPUT.id, NO_DATE.id, NO_METHOD.id],
    '10+ MW hides the named sub-10 MW plant before presence chips',
  );
  const afterNamed = filterDamsByNamedOnly(afterFloor, true);
  assert.deepEqual(
    afterNamed.map((row) => row.id),
    [WEBSITE.id, MISSING.id, NO_OUTPUT.id, NO_DATE.id, NO_METHOD.id],
  );
  const afterOperator = filterDamsByOperatorOnly(afterNamed, true);
  assert.deepEqual(
    afterOperator.map((row) => row.id),
    [WEBSITE.id, MISSING.id, NO_OUTPUT.id, NO_DATE.id, NO_METHOD.id],
  );
  const afterRiver = filterDamsByRiverOnly(afterOperator, true);
  assert.deepEqual(
    afterRiver.map((row) => row.id),
    [WEBSITE.id, MISSING.id, NO_OUTPUT.id, NO_DATE.id, NO_METHOD.id],
  );
  const afterWiki = filterDamsByWikiOnly(afterRiver, true);
  assert.deepEqual(
    afterWiki.map((row) => row.id),
    [WEBSITE.id, MISSING.id, NO_OUTPUT.id, NO_DATE.id, NO_METHOD.id],
  );
  const afterOutputOnly = filterDamsByOutputOnly(afterWiki, true);
  assert.deepEqual(
    afterOutputOnly.map((row) => row.id),
    [WEBSITE.id, MISSING.id, NO_DATE.id, NO_METHOD.id],
  );
  const afterDated = filterDamsByDatedOnly(afterOutputOnly, true);
  assert.deepEqual(
    afterDated.map((row) => row.id),
    [WEBSITE.id, MISSING.id, NO_METHOD.id],
  );
  const afterMethod = filterDamsByMethodOnly(afterDated, true);
  assert.deepEqual(
    afterMethod.map((row) => row.id),
    [WEBSITE.id, MISSING.id],
  );
  assert.deepEqual(
    filterDamsByWebsiteOnly(afterMethod, true).map((row) => row.id),
    [WEBSITE.id],
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
  });
  assert.deepEqual(listed.map((site) => site.id), [WEBSITE.id]);

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
    selectedId: FALLBACK_NAMED.id,
  });
  assert.deepEqual(
    new Set(selectedThroughAnd.map((site) => site.id)),
    new Set([WEBSITE.id, FALLBACK_NAMED.id]),
    'selected fallback Dam stays through output floor AND Named only AND Operator only AND River only AND Wikipedia only AND Output only AND Dated only AND Method only AND Website only',
  );
});

test('invalid / corrupt storage reads as off', () => {
  assert.equal(DAM_WEBSITE_ONLY_STORAGE_KEY, 'meridian.damWebsiteOnly');
  assert.equal(readDamWebsiteOnly(memoryStorage()), false);
  assert.equal(readDamWebsiteOnly(memoryStorage({ [DAM_WEBSITE_ONLY_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readDamWebsiteOnly(memoryStorage({ [DAM_WEBSITE_ONLY_STORAGE_KEY]: 'bogus' })), false);
  assert.equal(readDamWebsiteOnly(memoryStorage({ [DAM_WEBSITE_ONLY_STORAGE_KEY]: '{}' })), false);
  assert.equal(readDamWebsiteOnly(memoryStorage({ [DAM_WEBSITE_ONLY_STORAGE_KEY]: '2' })), false);
  assert.equal(readDamWebsiteOnly({
    getItem() { throw new Error('blocked'); },
  }), false);
  assert.equal(writeDamWebsiteOnly('nope', memoryStorage()), false);
});

test('persist / hydrate, no share-URL write', () => {
  const storage = memoryStorage();
  assert.equal(writeDamWebsiteOnly(true, storage), true);
  assert.equal(storage.getItem(DAM_WEBSITE_ONLY_STORAGE_KEY), '1');
  assert.equal(readDamWebsiteOnly(storage), true);
  const reloaded = memoryStorage(storage.snapshot());
  assert.equal(readDamWebsiteOnly(reloaded), true);
  assert.equal(writeDamWebsiteOnly(false, storage), true);
  assert.equal(storage.getItem(DAM_WEBSITE_ONLY_STORAGE_KEY), '0');
  assert.equal(readDamWebsiteOnly(memoryStorage(storage.snapshot())), false);
  assert.equal(Object.keys(storage.snapshot()).join(','), DAM_WEBSITE_ONLY_STORAGE_KEY);
  assert.equal(damsWebsiteOnlyChipModel(false).params.websiteOnly, true);
  assert.equal(damsWebsiteOnlyChipModel(true).params.websiteOnly, false);
  assert.equal(damsWebsiteOnlyChipModel(false).active, false);
  assert.equal(damsWebsiteOnlyChipModel(true).active, true);

  const items = fakeNode('div');
  items.ownerDocument = fakeDocument();
  const binder = bindDamsInViewList({
    root: fakeNode('section'),
    items,
    getEnabled: () => true,
    getRecords: () => [WEBSITE, MISSING],
    getView: () => AUSTIN_VIEW,
    getWebsiteOnly: () => readDamWebsiteOnly(storage),
    flyTo() {},
  });
  writeDamWebsiteOnly(true, storage);
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), [WEBSITE.id]);
  writeDamWebsiteOnly(false, storage);
  binder.refresh();
  assert.deepEqual(new Set(binder.sites().map((site) => site.id)), new Set([WEBSITE.id, MISSING.id]));
  binder.destroy();
});

test('properties.website, tags.website, contact:website, and context local-dams:${id} count', () => {
  const viaProps = { id: 'via-props-web', properties: { website: 'https://example.com/props' } };
  assert.equal(damWebsiteRaw(viaProps), 'https://example.com/props');
  assert.equal(damMatchesWebsiteFilter(viaProps, true), true);

  const viaTags = { id: 'via-tags-web', properties: { tags: { website: 'https://example.com/tags' } } };
  assert.equal(damWebsiteRaw(viaTags), 'https://example.com/tags');
  assert.equal(damMatchesWebsiteFilter(viaTags, true), true);

  const viaContact = { id: 'via-contact', properties: { tags: { 'contact:website': 'https://example.com/contact' } } };
  assert.equal(damWebsiteRaw(viaContact), 'https://example.com/contact');
  assert.equal(damMatchesWebsiteFilter(viaContact, true), true);

  const viaRecordTags = { id: 'via-record-tags', tags: { website: 'https://example.com/record-tags' } };
  assert.equal(damWebsiteRaw(viaRecordTags), 'https://example.com/record-tags');

  const originalWindow = globalThis.window;
  globalThis.window = globalThis.window || {};
  try {
    const store = getContextStore();
    store.entities.set('local-dams:-898986', {
      properties: { tags: { website: 'https://usbr.gov/pn/grandcoulee/' } },
    });
    assert.equal(damWebsiteRaw({ id: '-898986' }), 'https://usbr.gov/pn/grandcoulee/');
    assert.equal(damMatchesWebsiteFilter({ id: '-898986' }, true), true);
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
      websiteOnly: true,
    });
    assert.deepEqual(listed.map((site) => site.id), ['-898986']);
    store.entities.delete('local-dams:-898986');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('bundled snapshot already carries website; distinct from 205/218/224/229/240/249/279/287 and datacenter 285', () => {
  assert.equal(bundledWebsiteByName('Grand Coulee'), 'https://usbr.gov/pn/grandcoulee/');
  assert.equal(bundledWebsiteByName('Zhigulyovskaya'), 'http://www.zhiges.rushydro.ru/');
  const helper = src('src/data/damsWebsiteFilter.js');
  const list = src('src/data/damsList.js');
  const dcHelper = src('src/data/datacenterListWebsiteFilter.js');
  assert.match(helper, /meridian\.damWebsiteOnly/);
  assert.doesNotMatch(helper, /meridian\.dcWebsiteOnly/);
  assert.doesNotMatch(helper, /damOutputFloor|namedOnly|operatorOnly|riverOnly|wikiOnly|outputOnly|datedOnly|methodOnly|hideNoOperator/);
  assert.match(helper, /contact:website/);
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
    list.indexOf('damMatchesMethodOnlyFilter') < list.indexOf('damMatchesWebsiteFilter'),
    'Website only ANDs after Method only',
  );
  assert.ok(
    helper.includes('meridian.damWebsiteOnly') && !helper.includes('meridian.damMethodOnly'),
    'Website only persist key is distinct from Method only',
  );
  assert.ok(
    helper.includes('meridian.damWebsiteOnly') && !dcHelper.includes('meridian.damWebsiteOnly'),
    'Dam Website only persist key is distinct from datacenter 285',
  );
  assert.match(dcHelper, /meridian\.dcWebsiteOnly/);
  assert.doesNotMatch(helper, /local-datacenters/);
  assert.match(helper, /local-dams:/);
});

test('localGeojson.js is unchanged', () => {
  const diff = execSync('git diff -- HEAD -- src/data/localGeojson.js', {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(diff, '', 'Plan 297 leftover must not edit localGeojson.js');
  const localGeojson = src('src/data/localGeojson.js');
  assert.doesNotMatch(localGeojson, /damWebsiteOnly|damsWebsiteFilter|meridian\.damWebsiteOnly/);
});

test('list chip sits on the dams in-view surface; persist is local; no share-URL or /api', () => {
  const html = src('index.html');
  const ui = src('src/ui.js');
  const list = src('src/data/damsList.js');
  const helper = src('src/data/damsWebsiteFilter.js');
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
  assert.match(panel[0], /data-dam-website-only="only"[^>]*>Website only</);
  assert.match(panel[0], /data-dam-method-only="only"[^>]*>Method only</);
  assert.ok(
    panel[0].indexOf('id="dams-method-only-chips"') < panel[0].indexOf('id="dams-website-only-chips"'),
    'Website only sits next to Method only',
  );
  assert.ok(
    panel[0].indexOf('id="dams-website-only-chips"') < panel[0].indexOf('id="dams-in-view-items"'),
    'Website only sits above the in-view items',
  );
  assert.match(html, /id="dams-in-view"[\s\S]*?© OpenStreetMap contributors/);
  assert.match(ui, /data-dam-website-only/);
  assert.match(ui, /writeDamWebsiteOnly|readDamWebsiteOnly/);
  assert.match(css, /dams-website-only-chip/);
  assert.match(list, /damMatchesWebsiteFilter|filterDamsByWebsiteOnly|websiteOnly/);
  assert.doesNotMatch(list, /getRowControls/);
  assert.doesNotMatch(helper, /getRowControls/);
  assert.doesNotMatch(helper, /fetch\s*\(/);
  assert.doesNotMatch(list, /fetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\/dams/);
  assert.doesNotMatch(helper, /hideNoOperator|militaryNamedOnly|hasName|dcWebsiteOnly/);
  assert.doesNotMatch(list, /hideNoOperator|local-datacenters/);
  assert.doesNotMatch(dcList, /damWebsiteOnly|damsWebsiteFilter|meridian\.damWebsiteOnly/);
  assert.doesNotMatch(layerState, /damWebsiteOnly|damsWebsite/);
  assert.match(layerState, /id: 'local-dams', token: 'q', disposition: 'enabled-only'/);
  assert.doesNotMatch(firstRun, /writeDamWebsiteOnly|setDamWebsiteOnly/);
  assert.doesNotMatch(sharelink, /damWebsiteOnly|meridian\.damWebsiteOnly/);
  assert.equal(existsSync(path.join(ROOT, 'api/dams.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/dams/website-only.js')), false);
});
