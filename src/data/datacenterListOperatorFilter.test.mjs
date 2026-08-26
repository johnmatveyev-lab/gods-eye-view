// PLAN 206 — Datacenter operator chips. Client-only exclusive All | AWS |
// Equinix on the in-view list. Persist meridian.dcOperator. Distinct from
// Plan 193 hide-no-operator. localGeojson.js stays unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DATACENTER_LIST_OPERATOR_CHIP_IDS,
  DATACENTER_LIST_OPERATOR_CHIPS,
  DATACENTER_LIST_OPERATOR_STORAGE_KEY,
  DEFAULT_DATACENTER_LIST_OPERATOR,
  datacenterListHasOperatorTag,
  datacenterListOperatorChipModels,
  datacenterListOperatorValues,
  datacenterMatchesListOperator,
  filterDatacentersByListOperator,
  getDatacenterListOperator,
  hydrateDatacenterListOperator,
  normalizeDatacenterListOperator,
  readDatacenterListOperator,
  resetDatacenterListOperatorForTest,
  setDatacenterListOperator,
  writeDatacenterListOperator,
} from './datacenterListOperatorFilter.js';
import {
  listDatacentersInView,
  bindDatacenterInViewList,
} from './datacenterList.js';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
  normalizeLayerState,
} from './layerState.js';

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

const AWS_SHORT = Object.freeze({
  id: 'dc-aws-short',
  label: 'DFW-1',
  latitude: 30.27,
  longitude: -97.74,
  visible: true,
  tags: { name: 'DFW-1', 'operator:short': 'AWS', operator: 'Amazon Web Services' },
});
const AWS_AMAZON = Object.freeze({
  id: 'dc-aws-amazon',
  label: 'Amazon Web Services',
  latitude: 30.28,
  longitude: -97.73,
  visible: true,
  tags: { name: 'Amazon Web Services', operator: 'Amazon Web Services' },
});
const AWS_AMAZON_ONLY = Object.freeze({
  id: 'dc-amazon',
  label: 'IAD-edge',
  latitude: 30.29,
  longitude: -97.72,
  visible: true,
  operator: 'Amazon',
});
const EQUINIX = Object.freeze({
  id: 'dc-equinix',
  label: 'DA1',
  latitude: 30.26,
  longitude: -97.75,
  visible: true,
  tags: { name: 'DA1', operator: 'Equinix' },
});
const DIGITAL_REALTY = Object.freeze({
  id: 'dc-dlr',
  label: 'DAL-3',
  latitude: 30.25,
  longitude: -97.76,
  visible: true,
  tags: { name: 'DAL-3', operator: 'Digital Realty' },
});
const MISSING = Object.freeze({
  id: 'dc-missing',
  label: 'ST2',
  latitude: 30.24,
  longitude: -97.77,
  visible: true,
  tags: { name: 'ST2' },
});
const EMPTY = Object.freeze({
  id: 'dc-empty',
  label: 'Unnamed hall',
  latitude: 30.23,
  longitude: -97.71,
  visible: true,
  tags: { name: 'Unnamed hall', operator: '' },
});
const LONDON = Object.freeze({
  id: 'dc-london',
  label: 'London DC',
  latitude: 51.5074,
  longitude: -0.1278,
  visible: true,
  tags: { operator: 'Equinix' },
});

const MIXED = Object.freeze([
  AWS_SHORT, AWS_AMAZON, AWS_AMAZON_ONLY, EQUINIX, DIGITAL_REALTY, MISSING, EMPTY,
]);

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    snapshot: () => ({ ...data }),
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
      if (selector === '[data-datacenter-id]' && this.dataset.datacenterId) return this;
      return this.parent?.closest?.(selector) || null;
    },
    click(id) {
      const target = id
        ? children.find((child) => child.dataset.datacenterId === id)
        : children[0];
      listeners.get('click')?.({ target });
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

function parseBundledDatacenters() {
  const text = src('src/data/local_data/datacenters/datacenters.geojsonl');
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

test('All keeps the current in-view list', () => {
  resetDatacenterListOperatorForTest();
  assert.equal(DEFAULT_DATACENTER_LIST_OPERATOR, 'all');
  assert.deepEqual(DATACENTER_LIST_OPERATOR_CHIP_IDS, ['all', 'aws', 'equinix']);
  assert.deepEqual(DATACENTER_LIST_OPERATOR_CHIPS.map((chip) => chip.label), [
    'All', 'AWS', 'Equinix',
  ]);
  const unfiltered = listDatacentersInView({
    enabled: true,
    records: MIXED,
    view: AUSTIN_VIEW,
  });
  const all = listDatacentersInView({
    enabled: true,
    records: MIXED,
    view: AUSTIN_VIEW,
    operatorFilter: 'all',
  });
  assert.deepEqual(all.map((site) => site.id), unfiltered.map((site) => site.id));
  assert.deepEqual(
    filterDatacentersByListOperator(MIXED, 'all').map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.equal(datacenterMatchesListOperator(MISSING, 'all'), true);
  assert.equal(datacenterMatchesListOperator(EMPTY, 'all'), true);
  assert.equal(datacenterMatchesListOperator(DIGITAL_REALTY, 'all'), true);
});

test('AWS keeps Amazon / AWS rows; Equinix keeps Equinix rows', () => {
  assert.deepEqual(datacenterListOperatorValues(AWS_SHORT), ['AWS', 'Amazon Web Services']);
  assert.equal(datacenterMatchesListOperator(AWS_SHORT, 'aws'), true);
  assert.equal(datacenterMatchesListOperator(AWS_AMAZON, 'aws'), true);
  assert.equal(datacenterMatchesListOperator(AWS_AMAZON_ONLY, 'aws'), true);
  assert.equal(datacenterMatchesListOperator(EQUINIX, 'aws'), false);
  assert.equal(datacenterMatchesListOperator(DIGITAL_REALTY, 'aws'), false);
  assert.equal(datacenterMatchesListOperator(MISSING, 'aws'), false);
  assert.equal(datacenterMatchesListOperator(EMPTY, 'aws'), false);

  assert.equal(datacenterMatchesListOperator(EQUINIX, 'equinix'), true);
  assert.equal(datacenterMatchesListOperator(AWS_SHORT, 'equinix'), false);
  assert.equal(datacenterMatchesListOperator(MISSING, 'equinix'), false);

  const aws = listDatacentersInView({
    enabled: true,
    records: MIXED,
    view: AUSTIN_VIEW,
    operatorFilter: 'aws',
  });
  assert.deepEqual(aws.map((site) => site.id).sort(), [
    'dc-amazon', 'dc-aws-amazon', 'dc-aws-short',
  ]);

  const equinix = listDatacentersInView({
    enabled: true,
    records: MIXED,
    view: AUSTIN_VIEW,
    operatorFilter: 'equinix',
  });
  assert.deepEqual(equinix.map((site) => site.id), ['dc-equinix']);
});

test('missing operator stays on All and drops on AWS / Equinix', () => {
  assert.equal(datacenterListHasOperatorTag(MISSING), false);
  assert.equal(datacenterListHasOperatorTag(EMPTY), false);
  assert.equal(datacenterListHasOperatorTag(AWS_SHORT), true);
  assert.equal(datacenterMatchesListOperator(MISSING, 'all'), true);
  assert.equal(datacenterMatchesListOperator(EMPTY, 'all'), true);
  assert.equal(datacenterMatchesListOperator(MISSING, 'aws'), false);
  assert.equal(datacenterMatchesListOperator(EMPTY, 'equinix'), false);
  assert.equal(datacenterMatchesListOperator({
    id: 'payload-only',
    label: 'Datacenter',
    latitude: 30.27,
    longitude: -97.74,
  }, 'aws'), false);
  assert.equal(datacenterMatchesListOperator({
    id: 'payload-aws',
    label: 'AWS',
    latitude: 30.27,
    longitude: -97.74,
  }, 'aws'), true, 'live list payload falls back to label when tags are absent');
});

test('bundled snapshot matcher keeps AWS / Equinix tag counts', () => {
  const features = parseBundledDatacenters();
  assert.ok(features.length > 4000);
  const aws = features.filter((row) => datacenterMatchesListOperator(row, 'aws'));
  const equinix = features.filter((row) => datacenterMatchesListOperator(row, 'equinix'));
  const all = filterDatacentersByListOperator(features, 'all');
  assert.equal(all.length, features.length);
  assert.ok(aws.length >= 287, `expected at least 287 AWS rows, got ${aws.length}`);
  assert.ok(equinix.length >= 174, `expected at least 174 Equinix rows, got ${equinix.length}`);
  assert.equal(aws.some((row) => datacenterMatchesListOperator(row, 'equinix')), false);
  const shortAws = features.filter((row) => {
    const tags = row.properties?.tags || {};
    return String(tags['operator:short'] || '').toLowerCase() === 'aws';
  });
  assert.equal(shortAws.length, 287);
  assert.ok(shortAws.every((row) => datacenterMatchesListOperator(row, 'aws')));
});

test('meridian.dcOperator persists and reload keeps the choice', () => {
  resetDatacenterListOperatorForTest();
  const storage = memoryStorage();
  assert.equal(DATACENTER_LIST_OPERATOR_STORAGE_KEY, 'meridian.dcOperator');
  assert.equal(readDatacenterListOperator(storage), DEFAULT_DATACENTER_LIST_OPERATOR);
  assert.equal(normalizeDatacenterListOperator(undefined), 'all');
  assert.equal(normalizeDatacenterListOperator('AWS'), 'aws');
  assert.equal(normalizeDatacenterListOperator('Amazon Web Services'), 'aws');
  assert.equal(normalizeDatacenterListOperator('equinix'), 'equinix');
  assert.equal(normalizeDatacenterListOperator('bogus'), 'all');
  assert.equal(setDatacenterListOperator('aws', { storage }), 'aws');
  assert.equal(storage.getItem(DATACENTER_LIST_OPERATOR_STORAGE_KEY), 'aws');
  assert.equal(getDatacenterListOperator(), 'aws');

  resetDatacenterListOperatorForTest();
  assert.equal(getDatacenterListOperator(), DEFAULT_DATACENTER_LIST_OPERATOR);
  assert.equal(hydrateDatacenterListOperator(storage), 'aws');
  assert.equal(getDatacenterListOperator(), 'aws');
  assert.equal(writeDatacenterListOperator('equinix', storage), true);
  assert.equal(readDatacenterListOperator(memoryStorage(storage.snapshot())), 'equinix');
  writeDatacenterListOperator(DEFAULT_DATACENTER_LIST_OPERATOR, storage);
  assert.equal(storage.getItem(DATACENTER_LIST_OPERATOR_STORAGE_KEY), 'all');
  resetDatacenterListOperatorForTest();
});

test('LayerStateCoordinator restore re-reads meridian.dcOperator; no share-URL write', () => {
  resetDatacenterListOperatorForTest();
  const storage = memoryStorage({ [DATACENTER_LIST_OPERATOR_STORAGE_KEY]: 'equinix' });
  assert.equal(hydrateDatacenterListOperator(storage), 'equinix');
  assert.equal(getDatacenterListOperator(), 'equinix');

  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['local-datacenters'], undefined);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=d'));
  assert.equal(omitted.options['local-datacenters'], undefined);

  const state = normalizeLayerState({
    enabledLayerIds: ['local-datacenters'],
    options: { 'local-datacenters': { dcOperator: 'aws' } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /dcOperator|d\.o\.|dcOperator/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['local-datacenters'], undefined);
  assert.equal(getDatacenterListOperator(), 'equinix', 'coordinator-style restore of enabled-only keeps the chip');
  resetDatacenterListOperatorForTest();
});

test('hosted list applies the exclusive chip and All restores the current view', () => {
  resetDatacenterListOperatorForTest();
  const doc = fakeDocument();
  const root = fakeNode('div');
  const items = fakeNode('div');
  items.ownerDocument = doc;
  const count = fakeNode('output');
  setDatacenterListOperator('all', { persist: false });
  const binder = bindDatacenterInViewList({
    root,
    items,
    count,
    getEnabled: () => true,
    getRecords: () => [AWS_SHORT, EQUINIX, MISSING, LONDON],
    getView: () => AUSTIN_VIEW,
    flyTo() {},
  });
  const allIds = binder.sites().map((site) => site.id);
  assert.deepEqual(allIds, ['dc-aws-short', 'dc-equinix', 'dc-missing']);

  setDatacenterListOperator('aws', { persist: false });
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), ['dc-aws-short']);

  setDatacenterListOperator('equinix', { persist: false });
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), ['dc-equinix']);

  setDatacenterListOperator('all', { persist: false });
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), allIds);
  binder.destroy();
  resetDatacenterListOperatorForTest();
});

test('distinct from Plan 193 hide-no-operator; localGeojson.js is unchanged', () => {
  const helper = src('src/data/datacenterListOperatorFilter.js');
  const list = src('src/data/datacenterList.js');
  const layer = src('src/data/localGeojson.js');
  const layerState = src('src/data/layerState.js');
  const markup = src('index.html');
  const ui = src('src/ui.js');
  const firstRun = src('src/firstRunExperience.js');
  const license = src('LICENSE');
  const readme = src('README.md');

  assert.equal(existsSync(path.join(ROOT, 'src/data/datacenterOperatorFilter.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/datacenters/operator.js')), false);
  assert.doesNotMatch(helper, /\bfetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.match(helper, /meridian\.dcOperator/);
  assert.match(helper, /operator:short/);
  assert.match(helper, /tags\.operator/);
  assert.match(helper, /meridian\.datacenterHideNoOperator/);
  assert.doesNotMatch(helper, /Hide no operator/);
  assert.match(list, /datacenterMatchesListOperator|filterDatacentersByListOperator/);
  assert.doesNotMatch(layer, /datacenterListOperatorFilter|dcOperator|meridian\.dcOperator/);
  assert.doesNotMatch(layerState, /dcOperator|meridian\.dcOperator/);
  assert.match(markup, /id="datacenter-operator-chips"/);
  assert.match(markup, /data-dc-operator="all"/);
  assert.match(markup, /data-dc-operator="aws"/);
  assert.match(markup, /data-dc-operator="equinix"/);
  assert.match(markup, /DATACENTERS IN VIEW/);
  assert.ok(
    markup.indexOf('id="datacenter-in-view"') < markup.indexOf('data-dc-operator="all"'),
    'chips live on the in-view datacenter list',
  );
  assert.ok(
    markup.indexOf('data-dc-operator="equinix"') < markup.indexOf('id="dams-in-view"'),
    'chips stay on the datacenter list, not the dams list',
  );
  assert.match(ui, /setDatacenterListOperator|hydrateDatacenterListOperator/);
  assert.match(ui, /data-dc-operator/);
  assert.doesNotMatch(ui, /hideNoOperator|Hide no operator/);
  assert.match(firstRun, /meridian\.dcOperator/);
  const firstRunFn = firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun'));
  assert.doesNotMatch(firstRunFn, /setDatacenterListOperator|writeDatacenterListOperator|hydrateDatacenterListOperator/);
  assert.doesNotMatch(helper, /google\.com\/news|telegeography|quantum-earth/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /Meridian is an \*\*independent commercial product\*\*/);
  assert.deepEqual(
    datacenterListOperatorChipModels('aws').map((chip) => chip.active),
    [false, true, false],
  );
});
