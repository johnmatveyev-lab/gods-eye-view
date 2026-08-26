// PLAN 291 — Datacenter list Dated only toggle. Client-only filter of
// the already-bundled OSM / ODbL snapshot. Distinct from Plan 193
// hide-no-operator, Plan 206 All | AWS | Equinix, Plan 270 Named only,
// and Plan 285 Website only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DATACENTER_DATED_ONLY_CHIP_LABEL,
  DATACENTER_DATED_ONLY_CHIP_TITLE,
  DATACENTER_DATED_ONLY_STORAGE_KEY,
  DEFAULT_DATACENTER_DATED_ONLY,
  datacenterDatedOnlyChipModel,
  datacenterHasStartDate,
  datacenterMatchesDatedOnlyFilter,
  datacenterStartDateRaw,
  filterDatacentersByDatedOnly,
  getDatacenterListDatedOnly,
  hydrateDatacenterListDatedOnly,
  normalizeDatacenterListDatedOnly,
  readDatacenterListDatedOnly,
  resetDatacenterListDatedOnlyForTest,
  setDatacenterListDatedOnly,
  subscribeDatacenterListDatedOnly,
  writeDatacenterListDatedOnly,
} from './datacenterListDatedOnlyFilter.js';
import {
  filterDatacentersByListOperator,
} from './datacenterListOperatorFilter.js';
import {
  filterDatacentersByNamedOnly,
} from './datacenterListNamedFilter.js';
import {
  filterDatacentersByWebsiteOnly,
} from './datacenterListWebsiteFilter.js';
import {
  bindDatacenterInViewList,
  listDatacentersInView,
} from './datacenterList.js';
import { getContextStore } from './contextStore.js';
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

const DATED_EQUINIX = Object.freeze({
  id: 'dc-equinix-dated',
  label: 'Equinix DC12',
  latitude: 30.27,
  longitude: -97.74,
  visible: true,
  start_date: '1976',
  website: 'https://www.equinix.com/dc12',
  tags: {
    name: 'Equinix DC12',
    operator: 'Equinix',
    website: 'https://www.equinix.com/dc12',
    start_date: '1976',
  },
});
const DATED_AWS = Object.freeze({
  id: 'dc-aws-dated',
  label: 'AWS DFW-1',
  latitude: 30.24,
  longitude: -97.77,
  visible: true,
  tags: {
    name: 'AWS DFW-1',
    'operator:short': 'AWS',
    operator: 'Amazon Web Services',
    website: 'https://aws.amazon.com/dfw',
    start_date: '2012',
  },
});
const NO_DATE = Object.freeze({
  id: 'dc-no-date',
  label: 'Equinix DA1',
  latitude: 30.28,
  longitude: -97.73,
  visible: true,
  website: 'https://www.equinix.com/da1',
  tags: { name: 'Equinix DA1', operator: 'Equinix', website: 'https://www.equinix.com/da1' },
});
const EMPTY_DATE = Object.freeze({
  id: 'dc-empty-date',
  label: 'Empty date site',
  latitude: 30.29,
  longitude: -97.72,
  visible: true,
  start_date: '',
  tags: { start_date: '' },
});
const WHITESPACE_DATE = Object.freeze({
  id: 'dc-ws-date',
  label: 'Whitespace date site',
  latitude: 30.26,
  longitude: -97.75,
  visible: true,
  start_date: '   ',
  tags: { start_date: '  ' },
});
const GENERIC_NO_DATE = Object.freeze({
  id: 'dc-generic-no-date',
  label: 'Datacenter',
  latitude: 30.25,
  longitude: -97.76,
  visible: true,
  tags: { operator: 'Equinix' },
});
const GENERIC_DATED = Object.freeze({
  id: 'dc-generic-dated',
  label: 'Datacenter',
  latitude: 30.23,
  longitude: -97.71,
  visible: true,
  start_date: '1990',
  website: 'https://example.net/dc',
  tags: { operator: 'Equinix', website: 'https://example.net/dc', start_date: '1990' },
});
const LONDON = Object.freeze({
  id: 'dc-london',
  label: 'Equinix LD5',
  latitude: 51.5074,
  longitude: -0.1278,
  visible: true,
  start_date: '2010',
  website: 'https://www.equinix.com/ld5',
  tags: { operator: 'Equinix', website: 'https://www.equinix.com/ld5', start_date: '2010' },
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

function bundledStartDateCount() {
  const lines = src('src/data/local_data/datacenters/datacenters.geojsonl').split('\n');
  let total = 0;
  let dated = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    total += 1;
    const feature = JSON.parse(line);
    const raw = feature?.properties?.tags?.start_date ?? feature?.properties?.start_date;
    if (String(raw || '').trim()) dated += 1;
  }
  return { total, dated };
}

test('Off keeps no-date and dated rows', () => {
  resetDatacenterListDatedOnlyForTest();
  assert.equal(DEFAULT_DATACENTER_DATED_ONLY, false);
  assert.equal(DATACENTER_DATED_ONLY_CHIP_LABEL, 'Dated only');
  assert.equal(
    DATACENTER_DATED_ONLY_CHIP_TITLE,
    'Hide datacenters that have no OSM start_date',
  );
  assert.equal(normalizeDatacenterListDatedOnly(undefined), false);
  assert.equal(normalizeDatacenterListDatedOnly(null), false);
  assert.equal(normalizeDatacenterListDatedOnly(''), false);
  assert.equal(normalizeDatacenterListDatedOnly(false), false);
  assert.equal(normalizeDatacenterListDatedOnly(0), false);
  assert.equal(normalizeDatacenterListDatedOnly('0'), false);
  assert.equal(normalizeDatacenterListDatedOnly(true), true);
  assert.equal(normalizeDatacenterListDatedOnly('1'), true);
  assert.equal(normalizeDatacenterListDatedOnly('true'), true);
  assert.equal(normalizeDatacenterListDatedOnly('bogus'), null);

  const records = [DATED_EQUINIX, NO_DATE, EMPTY_DATE, WHITESPACE_DATE];
  assert.deepEqual(
    filterDatacentersByDatedOnly(records, false).map((row) => row.id),
    records.map((row) => row.id),
  );
  const listed = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    datedOnly: false,
  });
  assert.deepEqual(
    new Set(listed.map((site) => site.id)),
    new Set(records.map((row) => row.id)),
  );
  assert.ok(listed.some((site) => site.id === NO_DATE.id));
  assert.ok(listed.some((site) => site.id === DATED_EQUINIX.id));
  assert.equal(datacenterMatchesDatedOnlyFilter(NO_DATE, false), true);
  assert.deepEqual(filterDatacentersByDatedOnly(null), []);
  assert.deepEqual(filterDatacentersByDatedOnly(undefined), []);
});

test('On drops no-date, keeps real start_date', () => {
  assert.equal(datacenterStartDateRaw(NO_DATE), null);
  assert.equal(datacenterStartDateRaw(EMPTY_DATE), null);
  assert.equal(datacenterStartDateRaw(WHITESPACE_DATE), null);
  assert.equal(datacenterStartDateRaw({}), null);
  assert.equal(datacenterHasStartDate(NO_DATE), false);
  assert.equal(datacenterHasStartDate(EMPTY_DATE), false);
  assert.equal(datacenterHasStartDate(WHITESPACE_DATE), false);
  assert.equal(datacenterMatchesDatedOnlyFilter(NO_DATE, true), false);
  assert.equal(datacenterMatchesDatedOnlyFilter(EMPTY_DATE, true), false);
  assert.equal(datacenterMatchesDatedOnlyFilter(WHITESPACE_DATE, true), false);
  assert.equal(datacenterMatchesDatedOnlyFilter({ start_date: null }, true), false);
  assert.equal(datacenterHasStartDate(DATED_EQUINIX), true);
  assert.equal(datacenterStartDateRaw(DATED_EQUINIX), '1976');
  assert.equal(datacenterMatchesDatedOnlyFilter(DATED_EQUINIX, true), true);

  const viaProps = { id: 'via-props', properties: { start_date: '1979' } };
  assert.equal(datacenterStartDateRaw(viaProps), '1979');
  assert.equal(datacenterMatchesDatedOnlyFilter(viaProps, true), true);

  const viaTags = { id: 'via-tags', tags: { start_date: '1973' } };
  assert.equal(datacenterStartDateRaw(viaTags), '1973');
  assert.equal(datacenterMatchesDatedOnlyFilter(viaTags, true), true);

  const viaPropTags = { id: 'via-prop-tags', properties: { tags: { start_date: '1990' } } };
  assert.equal(datacenterStartDateRaw(viaPropTags), '1990');

  const kept = filterDatacentersByDatedOnly(
    [DATED_EQUINIX, NO_DATE, EMPTY_DATE, WHITESPACE_DATE],
    true,
  );
  assert.deepEqual(kept.map((row) => row.id), [DATED_EQUINIX.id]);

  const listed = listDatacentersInView({
    enabled: true,
    records: [DATED_EQUINIX, NO_DATE, EMPTY_DATE, WHITESPACE_DATE],
    view: AUSTIN_VIEW,
    datedOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [DATED_EQUINIX.id]);
  assert.equal(listed[0].label, 'Equinix DC12');
  assert.equal(listed.some((site) => site.id === NO_DATE.id), false);
});

test('Selected no-date still lists', () => {
  assert.equal(
    datacenterMatchesDatedOnlyFilter(NO_DATE, true, { selectedId: NO_DATE.id }),
    true,
  );
  assert.deepEqual(
    filterDatacentersByDatedOnly(
      [DATED_EQUINIX, NO_DATE, EMPTY_DATE],
      true,
      NO_DATE.id,
    ).map((row) => row.id),
    [DATED_EQUINIX.id, NO_DATE.id],
  );
  const listed = listDatacentersInView({
    enabled: true,
    records: [DATED_EQUINIX, NO_DATE, EMPTY_DATE],
    view: AUSTIN_VIEW,
    datedOnly: true,
    selectedId: EMPTY_DATE.id,
  });
  assert.deepEqual(
    new Set(listed.map((site) => site.id)),
    new Set([DATED_EQUINIX.id, EMPTY_DATE.id]),
  );

  const outOfViewSelected = listDatacentersInView({
    enabled: true,
    records: [DATED_EQUINIX, LONDON],
    view: AUSTIN_VIEW,
    datedOnly: true,
    selectedId: LONDON.id,
  });
  assert.deepEqual(outOfViewSelected.map((site) => site.id), [DATED_EQUINIX.id]);
});

test('AND with operator chips + named-only + website-only', () => {
  const records = [
    DATED_EQUINIX,
    NO_DATE,
    DATED_AWS,
    GENERIC_NO_DATE,
    GENERIC_DATED,
  ];
  const afterEquinix = filterDatacentersByListOperator(records, 'equinix');
  assert.deepEqual(
    afterEquinix.map((row) => row.id),
    [DATED_EQUINIX.id, NO_DATE.id, GENERIC_NO_DATE.id, GENERIC_DATED.id],
    'Equinix keeps named + generic Equinix rows before Named only / Website only / Dated only',
  );
  const afterNamed = filterDatacentersByNamedOnly(afterEquinix, true);
  assert.deepEqual(
    afterNamed.map((row) => row.id),
    [DATED_EQUINIX.id, NO_DATE.id],
  );
  const afterWebsite = filterDatacentersByWebsiteOnly(afterNamed, true);
  assert.deepEqual(
    afterWebsite.map((row) => row.id),
    [DATED_EQUINIX.id, NO_DATE.id],
  );
  assert.deepEqual(
    filterDatacentersByDatedOnly(afterWebsite, true).map((row) => row.id),
    [DATED_EQUINIX.id],
  );

  const allDated = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'all',
    namedOnly: false,
    websiteOnly: false,
    datedOnly: true,
  });
  assert.deepEqual(allDated.map((site) => site.id).sort(), [
    DATED_AWS.id,
    DATED_EQUINIX.id,
    GENERIC_DATED.id,
  ]);

  const equinixNamedWebsiteDated = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'equinix',
    namedOnly: true,
    websiteOnly: true,
    datedOnly: true,
  });
  assert.deepEqual(equinixNamedWebsiteDated.map((site) => site.id), [DATED_EQUINIX.id]);

  const awsNamedWebsiteDated = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'aws',
    namedOnly: true,
    websiteOnly: true,
    datedOnly: true,
  });
  assert.deepEqual(awsNamedWebsiteDated.map((site) => site.id), [DATED_AWS.id]);

  const selectedThroughAnd = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'equinix',
    namedOnly: true,
    websiteOnly: true,
    datedOnly: true,
    selectedId: NO_DATE.id,
  });
  assert.deepEqual(
    new Set(selectedThroughAnd.map((site) => site.id)),
    new Set([DATED_EQUINIX.id, NO_DATE.id]),
    'selected no-date Equinix stays through operator AND Named only AND Website only AND Dated only',
  );

  const selectedFailedOperator = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'aws',
    namedOnly: true,
    websiteOnly: true,
    datedOnly: true,
    selectedId: NO_DATE.id,
  });
  assert.deepEqual(
    selectedFailedOperator.map((site) => site.id),
    [DATED_AWS.id],
    'selected Equinix no-date does not stay when AWS already dropped it',
  );
});

test('context-store start_date counts', () => {
  const originalWindow = globalThis.window;
  globalThis.window = globalThis.window || {};
  try {
    const store = getContextStore();
    store.entities.set('local-datacenters:424945736', {
      properties: { tags: { start_date: '1976' } },
    });
    assert.equal(datacenterStartDateRaw({ id: '424945736' }), '1976');
    assert.equal(datacenterHasStartDate({ id: '424945736' }), true);
    assert.equal(datacenterMatchesDatedOnlyFilter({ id: '424945736' }, true), true);
    const listed = listDatacentersInView({
      enabled: true,
      records: [{
        id: '424945736',
        label: 'Centurylink LAX',
        latitude: 30.28,
        longitude: -97.74,
        visible: true,
      }, NO_DATE],
      view: AUSTIN_VIEW,
      datedOnly: true,
    });
    assert.deepEqual(listed.map((site) => site.id), ['424945736']);
    store.entities.delete('local-datacenters:424945736');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('Invalid / corrupt storage reads as off', () => {
  assert.equal(DATACENTER_DATED_ONLY_STORAGE_KEY, 'meridian.dcDatedOnly');
  assert.equal(readDatacenterListDatedOnly(memoryStorage()), false);
  assert.equal(readDatacenterListDatedOnly(memoryStorage({
    [DATACENTER_DATED_ONLY_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readDatacenterListDatedOnly(memoryStorage({
    [DATACENTER_DATED_ONLY_STORAGE_KEY]: 'bogus',
  })), false);
  assert.equal(readDatacenterListDatedOnly(memoryStorage({
    [DATACENTER_DATED_ONLY_STORAGE_KEY]: '{}',
  })), false);
  assert.equal(readDatacenterListDatedOnly(memoryStorage({
    [DATACENTER_DATED_ONLY_STORAGE_KEY]: '2',
  })), false);
  assert.equal(readDatacenterListDatedOnly({
    getItem() { throw new Error('blocked'); },
  }), false);
  assert.equal(writeDatacenterListDatedOnly('nope', memoryStorage()), false);
});

test('Persist / hydrate, no share-URL write', () => {
  resetDatacenterListDatedOnlyForTest();
  const storage = memoryStorage();
  assert.equal(writeDatacenterListDatedOnly(true, storage), true);
  assert.equal(storage.getItem(DATACENTER_DATED_ONLY_STORAGE_KEY), '1');
  assert.equal(readDatacenterListDatedOnly(storage), true);
  const reloaded = memoryStorage(storage.snapshot());
  assert.equal(readDatacenterListDatedOnly(reloaded), true);
  assert.equal(setDatacenterListDatedOnly(true, { storage }), true);
  assert.equal(getDatacenterListDatedOnly(), true);
  const seen = [];
  const unsubscribe = subscribeDatacenterListDatedOnly((value) => { seen.push(value); });
  assert.equal(setDatacenterListDatedOnly(false, { persist: false }), false);
  assert.deepEqual(seen, [false]);
  unsubscribe();

  resetDatacenterListDatedOnlyForTest();
  assert.equal(getDatacenterListDatedOnly(), DEFAULT_DATACENTER_DATED_ONLY);
  assert.equal(hydrateDatacenterListDatedOnly(storage), true);
  assert.equal(getDatacenterListDatedOnly(), true);
  assert.equal(writeDatacenterListDatedOnly(false, storage), true);
  assert.equal(storage.getItem(DATACENTER_DATED_ONLY_STORAGE_KEY), '0');
  assert.equal(readDatacenterListDatedOnly(memoryStorage(storage.snapshot())), false);
  assert.equal(Object.keys(storage.snapshot()).join(','), DATACENTER_DATED_ONLY_STORAGE_KEY);
  assert.equal(datacenterDatedOnlyChipModel(false).params.dcDatedOnly, true);
  assert.equal(datacenterDatedOnlyChipModel(true).params.dcDatedOnly, false);
  assert.equal(datacenterDatedOnlyChipModel(false).active, false);
  assert.equal(datacenterDatedOnlyChipModel(true).active, true);
  assert.equal(datacenterDatedOnlyChipModel(false).label, 'Dated only');

  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['local-datacenters'], undefined);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=d'));
  assert.equal(omitted.options['local-datacenters'], undefined);

  const state = normalizeLayerState({
    enabledLayerIds: ['local-datacenters'],
    options: { 'local-datacenters': { dcDatedOnly: true } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /dcDatedOnly|d\.d\.|datedOnly/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['local-datacenters'], undefined);
  assert.equal(getDatacenterListDatedOnly(), true, 'coordinator-style restore of enabled-only keeps the chip');
  resetDatacenterListDatedOnlyForTest();
});

test('hosted list applies Dated only from getListPayload session state', () => {
  resetDatacenterListDatedOnlyForTest();
  const doc = fakeDocument();
  const root = fakeNode('div');
  const items = fakeNode('div');
  items.ownerDocument = doc;
  const count = fakeNode('output');
  setDatacenterListDatedOnly(false, { persist: false });
  const binder = bindDatacenterInViewList({
    root,
    items,
    count,
    getEnabled: () => true,
    getRecords: () => [DATED_EQUINIX, NO_DATE, LONDON],
    getView: () => AUSTIN_VIEW,
    flyTo() {},
  });
  const offIds = binder.sites().map((site) => site.id);
  assert.deepEqual(offIds, [DATED_EQUINIX.id, NO_DATE.id]);

  setDatacenterListDatedOnly(true, { persist: false });
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), [DATED_EQUINIX.id]);

  setDatacenterListDatedOnly(false, { persist: false });
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), offIds);
  binder.destroy();
  resetDatacenterListDatedOnlyForTest();
});

test('distinct from Plan 193 hide-no-operator, Plan 206 operator chips, Plan 270 Named only, and Plan 285 Website only', () => {
  const counts = bundledStartDateCount();
  assert.equal(counts.total, 4351);
  assert.equal(counts.dated, 188, 'bundled OSM / ODbL snapshot already carries start_date');

  const helper = src('src/data/datacenterListDatedOnlyFilter.js');
  const list = src('src/data/datacenterList.js');
  const named = src('src/data/datacenterListNamedFilter.js');
  const operator = src('src/data/datacenterListOperatorFilter.js');
  const website = src('src/data/datacenterListWebsiteFilter.js');
  const layer = src('src/data/localGeojson.js');
  const layerState = src('src/data/layerState.js');
  const markup = src('index.html');
  const ui = src('src/ui.js');
  const firstRun = src('src/firstRunExperience.js');
  const sharelink = src('src/sharelink.js');
  const css = src('style.css');
  const license = src('LICENSE');
  const readme = src('README.md');
  const damsDated = src('src/data/damsDatedOnlyFilter.js');

  assert.equal(existsSync(path.join(ROOT, 'src/data/datacenterOperatorFilter.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/datacenters/dated-only.js')), false);
  assert.doesNotMatch(helper, /\bfetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.match(helper, /meridian\.dcDatedOnly/);
  assert.match(helper, /meridian\.datacenterHideNoOperator/);
  assert.match(helper, /meridian\.dcOperator/);
  assert.match(helper, /meridian\.dcNamedOnly/);
  assert.match(helper, /meridian\.dcWebsiteOnly/);
  assert.doesNotMatch(helper, /Hide no operator/);
  assert.doesNotMatch(helper, /dcOperator:|setDatacenterListOperator/);
  assert.doesNotMatch(helper, /setDatacenterListNamedOnly|dcNamedOnly:/);
  assert.doesNotMatch(helper, /setDatacenterListWebsiteOnly|dcWebsiteOnly:/);
  assert.match(list, /datacenterMatchesDatedOnlyFilter|filterDatacentersByDatedOnly/);
  assert.match(list, /datacenterMatchesWebsiteFilter/);
  assert.match(list, /datacenterMatchesNamedFilter/);
  assert.match(list, /datacenterMatchesListOperator/);
  assert.ok(
    list.indexOf('datacenterMatchesWebsiteFilter') < list.indexOf('datacenterMatchesDatedOnlyFilter'),
    'Dated only ANDs after the Plan 285 Website only matcher',
  );
  assert.ok(
    list.indexOf('datacenterMatchesNamedFilter') < list.indexOf('datacenterMatchesWebsiteFilter'),
    'Website only still ANDs after the Plan 270 Named only matcher',
  );
  assert.ok(
    list.indexOf('datacenterMatchesListOperator') < list.indexOf('datacenterMatchesNamedFilter'),
    'Named only still ANDs after the Plan 206 operator matcher',
  );
  assert.doesNotMatch(named, /dcDatedOnly|datacenterListDatedOnlyFilter|Dated only/);
  assert.doesNotMatch(operator, /dcDatedOnly|datacenterListDatedOnlyFilter|Dated only/);
  assert.doesNotMatch(website, /dcDatedOnly|datacenterListDatedOnlyFilter|Dated only/);
  assert.doesNotMatch(layer, /datacenterListDatedOnlyFilter|dcDatedOnly|meridian\.dcDatedOnly/);
  assert.doesNotMatch(layerState, /dcDatedOnly|meridian\.dcDatedOnly/);
  assert.match(damsDated, /meridian\.damDatedOnly/);
  assert.doesNotMatch(damsDated, /meridian\.dcDatedOnly|datacenterListDatedOnlyFilter/);
  const panel = markup.match(/<div id="datacenter-in-view"[\s\S]*?<p class="in-view-site-list-credit"/);
  assert.ok(panel, 'datacenter-in-view markup is missing');
  assert.match(panel[0], /id="datacenter-operator-chips"/);
  assert.match(panel[0], /id="datacenter-named-chips"/);
  assert.match(panel[0], /id="datacenter-website-chips"/);
  assert.match(panel[0], /id="datacenter-dated-chips"/);
  assert.match(panel[0], /data-dc-named="only"[^>]*>Named only</);
  assert.match(panel[0], /data-dc-website="only"[^>]*>Website only</);
  assert.match(panel[0], /data-dc-dated="only"[^>]*>Dated only</);
  assert.ok(
    panel[0].indexOf('id="datacenter-website-chips"') < panel[0].indexOf('id="datacenter-dated-chips"'),
    'Dated only sits after the Plan 285 Website only chip',
  );
  assert.ok(
    panel[0].indexOf('id="datacenter-dated-chips"') < panel[0].indexOf('id="datacenter-in-view-items"'),
    'Dated only sits above the in-view items',
  );
  assert.match(markup, /DATACENTERS IN VIEW/);
  assert.match(ui, /setDatacenterListDatedOnly|hydrateDatacenterListDatedOnly/);
  assert.match(ui, /data-dc-dated/);
  assert.match(ui, /_initDatacenterDatedChip/);
  assert.doesNotMatch(ui, /hideNoOperator|Hide no operator/);
  const datedChipFn = ui.slice(ui.indexOf('_syncDatacenterDatedChip() {'));
  assert.match(datedChipFn, /data-dc-dated/);
  assert.doesNotMatch(
    datedChipFn.slice(0, datedChipFn.indexOf('_initFullscreenButton')),
    /getRowControls/,
  );
  assert.match(css, /datacenter-dated-chip/);
  const firstRunFn = firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun'));
  assert.doesNotMatch(firstRunFn, /setDatacenterListDatedOnly|writeDatacenterListDatedOnly|hydrateDatacenterListDatedOnly/);
  assert.doesNotMatch(sharelink, /dcDatedOnly|meridian\.dcDatedOnly/);
  assert.doesNotMatch(helper, /google\.com\/news|telegeography|quantum-earth|OpenSky/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /Meridian is an \*\*independent commercial product\*\*/);
  assert.match(src('index.html'), /<title>Meridian<\/title>/);
  assert.doesNotMatch(src('index.html'), /God.s Eye View branding/i);

  const localDiff = execSync(
    'git diff -- HEAD -- src/data/localGeojson.js src/data/datacenterListOperatorFilter.js src/data/datacenterListNamedFilter.js src/data/datacenterListWebsiteFilter.js',
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  assert.equal(localDiff, '', 'Plan 291 must not edit localGeojson.js, Plan 206, Plan 270, or Plan 285');
});
