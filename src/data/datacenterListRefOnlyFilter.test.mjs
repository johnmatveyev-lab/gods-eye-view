// PLAN 304 leftover — Datacenter list Ref only toggle. Client-only
// filter of the already-bundled OSM / ODbL snapshot. Distinct from Plan
// 193 hide-no-operator, Plan 206 All | AWS | Equinix, Plan 270 Named
// only, Plan 285 Website only, Plan 291 Dated only, and Plan 301 Owner
// only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DATACENTER_REF_ONLY_CHIP_LABEL,
  DATACENTER_REF_ONLY_CHIP_TITLE,
  DATACENTER_REF_ONLY_STORAGE_KEY,
  DEFAULT_DATACENTER_REF_ONLY,
  datacenterHasRef,
  datacenterMatchesRefOnlyFilter,
  datacenterRefOnlyChipModel,
  datacenterRefRaw,
  filterDatacentersByRefOnly,
  getDatacenterListRefOnly,
  hydrateDatacenterListRefOnly,
  normalizeDatacenterListRefOnly,
  readDatacenterListRefOnly,
  resetDatacenterListRefOnlyForTest,
  setDatacenterListRefOnly,
  subscribeDatacenterListRefOnly,
  writeDatacenterListRefOnly,
} from './datacenterListRefOnlyFilter.js';
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
  filterDatacentersByDatedOnly,
} from './datacenterListDatedOnlyFilter.js';
import {
  filterDatacentersByOwnerOnly,
} from './datacenterListOwnerOnlyFilter.js';
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

const REFFED_EQUINIX = Object.freeze({
  id: 'dc-equinix-ref',
  label: 'Equinix DC12',
  latitude: 30.27,
  longitude: -97.74,
  visible: true,
  owner: 'Digital Realty',
  start_date: '1976',
  website: 'https://www.equinix.com/dc12',
  ref: 'DC12',
  tags: {
    name: 'Equinix DC12',
    operator: 'Equinix',
    owner: 'Digital Realty',
    website: 'https://www.equinix.com/dc12',
    start_date: '1976',
    ref: 'DC12',
  },
});
const REFFED_AWS = Object.freeze({
  id: 'dc-aws-ref',
  label: 'AWS DFW-1',
  latitude: 30.24,
  longitude: -97.77,
  visible: true,
  tags: {
    name: 'AWS DFW-1',
    'operator:short': 'AWS',
    operator: 'Amazon Web Services',
    owner: 'Amazon Data Services, Inc.',
    website: 'https://aws.amazon.com/dfw',
    start_date: '2012',
    ref: 'DFW1',
  },
});
const NAMED_OWNER_NO_REF = Object.freeze({
  id: 'dc-named-owner-no-ref',
  label: 'Equinix DA1',
  latitude: 30.28,
  longitude: -97.73,
  visible: true,
  owner: 'Digital Realty',
  website: 'https://www.equinix.com/da1',
  start_date: '2000',
  ref: '',
  tags: {
    name: 'Equinix DA1',
    operator: 'Equinix',
    owner: 'Digital Realty',
    website: 'https://www.equinix.com/da1',
    start_date: '2000',
    ref: '',
  },
});
const EMPTY_REF = Object.freeze({
  id: 'dc-empty-ref',
  label: 'Empty ref site',
  latitude: 30.29,
  longitude: -97.72,
  visible: true,
  ref: '',
  tags: { ref: '' },
});
const WHITESPACE_REF = Object.freeze({
  id: 'dc-ws-ref',
  label: 'Whitespace ref site',
  latitude: 30.26,
  longitude: -97.75,
  visible: true,
  ref: '   ',
  tags: { ref: '  ' },
});
const GENERIC_NO_REF = Object.freeze({
  id: 'dc-generic-no-ref',
  label: 'Datacenter',
  latitude: 30.25,
  longitude: -97.76,
  visible: true,
  tags: { operator: 'Equinix' },
});
const GENERIC_REFFED = Object.freeze({
  id: 'dc-generic-reffed',
  label: 'Datacenter',
  latitude: 30.23,
  longitude: -97.71,
  visible: true,
  owner: 'Claro Argentina',
  start_date: '1990',
  website: 'https://example.net/dc',
  ref: 'BUE1',
  tags: {
    operator: 'Equinix',
    owner: 'Claro Argentina',
    website: 'https://example.net/dc',
    start_date: '1990',
    ref: 'BUE1',
  },
});
const LONDON = Object.freeze({
  id: 'dc-london',
  label: 'Equinix LD5',
  latitude: 51.5074,
  longitude: -0.1278,
  visible: true,
  owner: 'Equinix Ltd',
  start_date: '2010',
  website: 'https://www.equinix.com/ld5',
  ref: 'LD5',
  tags: {
    operator: 'Equinix',
    owner: 'Equinix Ltd',
    website: 'https://www.equinix.com/ld5',
    start_date: '2010',
    ref: 'LD5',
  },
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

function bundledRefCount() {
  const lines = src('src/data/local_data/datacenters/datacenters.geojsonl').split('\n');
  let total = 0;
  let reffed = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    total += 1;
    const feature = JSON.parse(line);
    const raw = feature?.properties?.tags?.ref ?? feature?.properties?.ref;
    if (String(raw || '').trim()) reffed += 1;
  }
  return { total, reffed };
}

test('Off keeps current draw including no-ref rows', () => {
  resetDatacenterListRefOnlyForTest();
  assert.equal(DEFAULT_DATACENTER_REF_ONLY, false);
  assert.equal(DATACENTER_REF_ONLY_CHIP_LABEL, 'Ref only');
  assert.equal(
    DATACENTER_REF_ONLY_CHIP_TITLE,
    'Hide datacenters that have no OSM ref',
  );
  assert.equal(normalizeDatacenterListRefOnly(undefined), false);
  assert.equal(normalizeDatacenterListRefOnly(null), false);
  assert.equal(normalizeDatacenterListRefOnly(''), false);
  assert.equal(normalizeDatacenterListRefOnly(false), false);
  assert.equal(normalizeDatacenterListRefOnly(0), false);
  assert.equal(normalizeDatacenterListRefOnly('0'), false);
  assert.equal(normalizeDatacenterListRefOnly(true), true);
  assert.equal(normalizeDatacenterListRefOnly('1'), true);
  assert.equal(normalizeDatacenterListRefOnly('true'), true);
  assert.equal(normalizeDatacenterListRefOnly('bogus'), null);

  const records = [REFFED_EQUINIX, NAMED_OWNER_NO_REF, EMPTY_REF, WHITESPACE_REF];
  assert.deepEqual(
    filterDatacentersByRefOnly(records, false).map((row) => row.id),
    records.map((row) => row.id),
  );
  const listed = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    refOnly: false,
  });
  assert.deepEqual(
    new Set(listed.map((site) => site.id)),
    new Set(records.map((row) => row.id)),
  );
  assert.ok(listed.some((site) => site.id === NAMED_OWNER_NO_REF.id));
  assert.ok(listed.some((site) => site.id === REFFED_EQUINIX.id));
  assert.equal(datacenterMatchesRefOnlyFilter(NAMED_OWNER_NO_REF, false), true);
  assert.deepEqual(filterDatacentersByRefOnly(null), []);
  assert.deepEqual(filterDatacentersByRefOnly(undefined), []);
});

test('On keeps tags.ref and hides a named owner-only row with empty ref', () => {
  assert.equal(datacenterRefRaw(NAMED_OWNER_NO_REF), null);
  assert.equal(datacenterRefRaw(EMPTY_REF), null);
  assert.equal(datacenterRefRaw(WHITESPACE_REF), null);
  assert.equal(datacenterRefRaw({}), null);
  assert.equal(datacenterHasRef(NAMED_OWNER_NO_REF), false);
  assert.equal(datacenterHasRef(EMPTY_REF), false);
  assert.equal(datacenterHasRef(WHITESPACE_REF), false);
  assert.equal(datacenterMatchesRefOnlyFilter(NAMED_OWNER_NO_REF, true), false);
  assert.equal(datacenterMatchesRefOnlyFilter(EMPTY_REF, true), false);
  assert.equal(datacenterMatchesRefOnlyFilter(WHITESPACE_REF, true), false);
  assert.equal(datacenterMatchesRefOnlyFilter({ ref: null }, true), false);
  assert.equal(datacenterHasRef(REFFED_EQUINIX), true);
  assert.equal(datacenterRefRaw(REFFED_EQUINIX), 'DC12');
  assert.equal(datacenterMatchesRefOnlyFilter(REFFED_EQUINIX, true), true);

  const viaProps = { id: 'via-props', properties: { ref: 'BUE1' } };
  assert.equal(datacenterRefRaw(viaProps), 'BUE1');
  assert.equal(datacenterMatchesRefOnlyFilter(viaProps, true), true);

  const viaTags = { id: 'via-tags', tags: { ref: 'ROS1' } };
  assert.equal(datacenterRefRaw(viaTags), 'ROS1');
  assert.equal(datacenterMatchesRefOnlyFilter(viaTags, true), true);

  const viaPropTags = { id: 'via-prop-tags', properties: { tags: { ref: 'DC SP01' } } };
  assert.equal(datacenterRefRaw(viaPropTags), 'DC SP01');

  const kept = filterDatacentersByRefOnly(
    [REFFED_EQUINIX, NAMED_OWNER_NO_REF, EMPTY_REF, WHITESPACE_REF],
    true,
  );
  assert.deepEqual(kept.map((row) => row.id), [REFFED_EQUINIX.id]);

  const listed = listDatacentersInView({
    enabled: true,
    records: [REFFED_EQUINIX, NAMED_OWNER_NO_REF, EMPTY_REF, WHITESPACE_REF],
    view: AUSTIN_VIEW,
    refOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [REFFED_EQUINIX.id]);
  assert.equal(listed[0].label, 'Equinix DC12');
  assert.equal(listed.some((site) => site.id === NAMED_OWNER_NO_REF.id), false);
});

test('Selected no-ref still lists', () => {
  assert.equal(
    datacenterMatchesRefOnlyFilter(NAMED_OWNER_NO_REF, true, {
      selectedId: NAMED_OWNER_NO_REF.id,
    }),
    true,
  );
  assert.deepEqual(
    filterDatacentersByRefOnly(
      [REFFED_EQUINIX, NAMED_OWNER_NO_REF, EMPTY_REF],
      true,
      NAMED_OWNER_NO_REF.id,
    ).map((row) => row.id),
    [REFFED_EQUINIX.id, NAMED_OWNER_NO_REF.id],
  );
  const listed = listDatacentersInView({
    enabled: true,
    records: [REFFED_EQUINIX, NAMED_OWNER_NO_REF, EMPTY_REF],
    view: AUSTIN_VIEW,
    refOnly: true,
    selectedId: EMPTY_REF.id,
  });
  assert.deepEqual(
    new Set(listed.map((site) => site.id)),
    new Set([REFFED_EQUINIX.id, EMPTY_REF.id]),
  );

  const outOfViewSelected = listDatacentersInView({
    enabled: true,
    records: [REFFED_EQUINIX, LONDON],
    view: AUSTIN_VIEW,
    refOnly: true,
    selectedId: LONDON.id,
  });
  assert.deepEqual(outOfViewSelected.map((site) => site.id), [REFFED_EQUINIX.id]);
});

test('AND with Named only / Owner only / Website only / Dated only / 206', () => {
  const records = [
    REFFED_EQUINIX,
    NAMED_OWNER_NO_REF,
    REFFED_AWS,
    GENERIC_NO_REF,
    GENERIC_REFFED,
  ];
  const afterEquinix = filterDatacentersByListOperator(records, 'equinix');
  assert.deepEqual(
    afterEquinix.map((row) => row.id),
    [
      REFFED_EQUINIX.id,
      NAMED_OWNER_NO_REF.id,
      GENERIC_NO_REF.id,
      GENERIC_REFFED.id,
    ],
    'Equinix keeps named + generic Equinix rows before Named only / Website only / Dated only / Owner only / Ref only',
  );
  const afterNamed = filterDatacentersByNamedOnly(afterEquinix, true);
  assert.deepEqual(
    afterNamed.map((row) => row.id),
    [REFFED_EQUINIX.id, NAMED_OWNER_NO_REF.id],
  );
  const afterWebsite = filterDatacentersByWebsiteOnly(afterNamed, true);
  assert.deepEqual(
    afterWebsite.map((row) => row.id),
    [REFFED_EQUINIX.id, NAMED_OWNER_NO_REF.id],
  );
  const afterDated = filterDatacentersByDatedOnly(afterWebsite, true);
  assert.deepEqual(
    afterDated.map((row) => row.id),
    [REFFED_EQUINIX.id, NAMED_OWNER_NO_REF.id],
  );
  const afterOwner = filterDatacentersByOwnerOnly(afterDated, true);
  assert.deepEqual(
    afterOwner.map((row) => row.id),
    [REFFED_EQUINIX.id, NAMED_OWNER_NO_REF.id],
  );
  assert.deepEqual(
    filterDatacentersByRefOnly(afterOwner, true).map((row) => row.id),
    [REFFED_EQUINIX.id],
    'named owner-only Equinix with empty ref hides when Ref only is on',
  );

  const allReffed = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'all',
    namedOnly: false,
    websiteOnly: false,
    datedOnly: false,
    ownerOnly: false,
    refOnly: true,
  });
  assert.deepEqual(allReffed.map((site) => site.id).sort(), [
    REFFED_AWS.id,
    REFFED_EQUINIX.id,
    GENERIC_REFFED.id,
  ]);

  const equinixNamedWebsiteDatedOwnerRef = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'equinix',
    namedOnly: true,
    websiteOnly: true,
    datedOnly: true,
    ownerOnly: true,
    refOnly: true,
  });
  assert.deepEqual(equinixNamedWebsiteDatedOwnerRef.map((site) => site.id), [REFFED_EQUINIX.id]);

  const awsNamedWebsiteDatedOwnerRef = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'aws',
    namedOnly: true,
    websiteOnly: true,
    datedOnly: true,
    ownerOnly: true,
    refOnly: true,
  });
  assert.deepEqual(awsNamedWebsiteDatedOwnerRef.map((site) => site.id), [REFFED_AWS.id]);

  const selectedThroughAnd = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'equinix',
    namedOnly: true,
    websiteOnly: true,
    datedOnly: true,
    ownerOnly: true,
    refOnly: true,
    selectedId: NAMED_OWNER_NO_REF.id,
  });
  assert.deepEqual(
    new Set(selectedThroughAnd.map((site) => site.id)),
    new Set([REFFED_EQUINIX.id, NAMED_OWNER_NO_REF.id]),
    'selected named owner-only Equinix stays through operator AND Named only AND Website only AND Dated only AND Owner only AND Ref only',
  );

  const selectedFailedOperator = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'aws',
    namedOnly: true,
    websiteOnly: true,
    datedOnly: true,
    ownerOnly: true,
    refOnly: true,
    selectedId: NAMED_OWNER_NO_REF.id,
  });
  assert.deepEqual(
    selectedFailedOperator.map((site) => site.id),
    [REFFED_AWS.id],
    'selected Equinix no-ref does not stay when AWS already dropped it',
  );
});

test('context-store ref counts', () => {
  const originalWindow = globalThis.window;
  globalThis.window = globalThis.window || {};
  try {
    const store = getContextStore();
    store.entities.set('local-datacenters:204971297', {
      properties: { tags: { ref: 'BUE1' } },
    });
    assert.equal(datacenterRefRaw({ id: '204971297' }), 'BUE1');
    assert.equal(datacenterHasRef({ id: '204971297' }), true);
    assert.equal(datacenterMatchesRefOnlyFilter({ id: '204971297' }, true), true);
    const listed = listDatacentersInView({
      enabled: true,
      records: [{
        id: '204971297',
        label: 'BUE1',
        latitude: 30.28,
        longitude: -97.74,
        visible: true,
      }, NAMED_OWNER_NO_REF],
      view: AUSTIN_VIEW,
      refOnly: true,
    });
    assert.deepEqual(listed.map((site) => site.id), ['204971297']);
    store.entities.delete('local-datacenters:204971297');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('Invalid / corrupt storage reads as off', () => {
  assert.equal(DATACENTER_REF_ONLY_STORAGE_KEY, 'meridian.dcRefOnly');
  assert.equal(readDatacenterListRefOnly(memoryStorage()), false);
  assert.equal(readDatacenterListRefOnly(memoryStorage({
    [DATACENTER_REF_ONLY_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readDatacenterListRefOnly(memoryStorage({
    [DATACENTER_REF_ONLY_STORAGE_KEY]: 'bogus',
  })), false);
  assert.equal(readDatacenterListRefOnly(memoryStorage({
    [DATACENTER_REF_ONLY_STORAGE_KEY]: '{}',
  })), false);
  assert.equal(readDatacenterListRefOnly(memoryStorage({
    [DATACENTER_REF_ONLY_STORAGE_KEY]: '2',
  })), false);
  assert.equal(readDatacenterListRefOnly({
    getItem() { throw new Error('blocked'); },
  }), false);
  assert.equal(writeDatacenterListRefOnly('nope', memoryStorage()), false);
});

test('Persist / hydrate, no share-URL write', () => {
  resetDatacenterListRefOnlyForTest();
  const storage = memoryStorage();
  assert.equal(writeDatacenterListRefOnly(true, storage), true);
  assert.equal(storage.getItem(DATACENTER_REF_ONLY_STORAGE_KEY), '1');
  assert.equal(readDatacenterListRefOnly(storage), true);
  const reloaded = memoryStorage(storage.snapshot());
  assert.equal(readDatacenterListRefOnly(reloaded), true);
  assert.equal(setDatacenterListRefOnly(true, { storage }), true);
  assert.equal(getDatacenterListRefOnly(), true);
  const seen = [];
  const unsubscribe = subscribeDatacenterListRefOnly((value) => { seen.push(value); });
  assert.equal(setDatacenterListRefOnly(false, { persist: false }), false);
  assert.deepEqual(seen, [false]);
  unsubscribe();

  resetDatacenterListRefOnlyForTest();
  assert.equal(getDatacenterListRefOnly(), DEFAULT_DATACENTER_REF_ONLY);
  assert.equal(hydrateDatacenterListRefOnly(storage), true);
  assert.equal(getDatacenterListRefOnly(), true);
  assert.equal(writeDatacenterListRefOnly(false, storage), true);
  assert.equal(storage.getItem(DATACENTER_REF_ONLY_STORAGE_KEY), '0');
  assert.equal(readDatacenterListRefOnly(memoryStorage(storage.snapshot())), false);
  assert.equal(Object.keys(storage.snapshot()).join(','), DATACENTER_REF_ONLY_STORAGE_KEY);
  assert.equal(datacenterRefOnlyChipModel(false).params.dcRefOnly, true);
  assert.equal(datacenterRefOnlyChipModel(true).params.dcRefOnly, false);
  assert.equal(datacenterRefOnlyChipModel(false).active, false);
  assert.equal(datacenterRefOnlyChipModel(true).active, true);
  assert.equal(datacenterRefOnlyChipModel(false).label, 'Ref only');

  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['local-datacenters'], undefined);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=d'));
  assert.equal(omitted.options['local-datacenters'], undefined);

  const state = normalizeLayerState({
    enabledLayerIds: ['local-datacenters'],
    options: { 'local-datacenters': { dcRefOnly: true } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /dcRefOnly|d\.r\.|refOnly/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['local-datacenters'], undefined);
  assert.equal(getDatacenterListRefOnly(), true, 'coordinator-style restore of enabled-only keeps the chip');
  resetDatacenterListRefOnlyForTest();
});

test('hosted list applies Ref only from getListPayload session state', () => {
  resetDatacenterListRefOnlyForTest();
  const doc = fakeDocument();
  const root = fakeNode('div');
  const items = fakeNode('div');
  items.ownerDocument = doc;
  const count = fakeNode('output');
  setDatacenterListRefOnly(false, { persist: false });
  const binder = bindDatacenterInViewList({
    root,
    items,
    count,
    getEnabled: () => true,
    getRecords: () => [REFFED_EQUINIX, NAMED_OWNER_NO_REF, LONDON],
    getView: () => AUSTIN_VIEW,
    flyTo() {},
  });
  const offIds = binder.sites().map((site) => site.id);
  assert.deepEqual(offIds, [REFFED_EQUINIX.id, NAMED_OWNER_NO_REF.id]);

  setDatacenterListRefOnly(true, { persist: false });
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), [REFFED_EQUINIX.id]);

  setDatacenterListRefOnly(false, { persist: false });
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), offIds);
  binder.destroy();
  resetDatacenterListRefOnlyForTest();
});

test('distinct from Plan 193 hide-no-operator, Plan 206 operator chips, Plan 270 Named only, Plan 285 Website only, Plan 291 Dated only, and Plan 301 Owner only', () => {
  const counts = bundledRefCount();
  assert.equal(counts.total, 4351);
  assert.equal(counts.reffed, 868, 'bundled OSM / ODbL snapshot already carries tags.ref');

  const helper = src('src/data/datacenterListRefOnlyFilter.js');
  const list = src('src/data/datacenterList.js');
  const named = src('src/data/datacenterListNamedFilter.js');
  const operator = src('src/data/datacenterListOperatorFilter.js');
  const website = src('src/data/datacenterListWebsiteFilter.js');
  const dated = src('src/data/datacenterListDatedOnlyFilter.js');
  const owner = src('src/data/datacenterListOwnerOnlyFilter.js');
  const layer = src('src/data/localGeojson.js');
  const layerState = src('src/data/layerState.js');
  const markup = src('index.html');
  const ui = src('src/ui.js');
  const firstRun = src('src/firstRunExperience.js');
  const sharelink = src('src/sharelink.js');
  const css = src('style.css');
  const license = src('LICENSE');
  const readme = src('README.md');
  const flights = src('src/data/flights.js');
  const militaryFlights = src('src/data/militaryFlights.js');
  const installations = src('src/data/militaryInstallations.js');
  const adsbFallback = src('src/data/adsbLolFallback.js');

  assert.equal(existsSync(path.join(ROOT, 'src/data/datacenterOperatorFilter.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/datacenters/ref-only.js')), false);
  assert.doesNotMatch(helper, /\bfetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.match(helper, /meridian\.dcRefOnly/);
  assert.match(helper, /meridian\.datacenterHideNoOperator/);
  assert.match(helper, /meridian\.dcOperator/);
  assert.match(helper, /meridian\.dcNamedOnly/);
  assert.match(helper, /meridian\.dcWebsiteOnly/);
  assert.match(helper, /meridian\.dcDatedOnly/);
  assert.match(helper, /meridian\.dcOwnerOnly/);
  assert.doesNotMatch(helper, /Hide no operator/);
  assert.doesNotMatch(helper, /dcOperator:|setDatacenterListOperator/);
  assert.doesNotMatch(helper, /setDatacenterListNamedOnly|dcNamedOnly:/);
  assert.doesNotMatch(helper, /setDatacenterListWebsiteOnly|dcWebsiteOnly:/);
  assert.doesNotMatch(helper, /setDatacenterListDatedOnly|dcDatedOnly:/);
  assert.doesNotMatch(helper, /setDatacenterListOwnerOnly|dcOwnerOnly:/);
  assert.match(list, /datacenterMatchesRefOnlyFilter|filterDatacentersByRefOnly/);
  assert.match(list, /datacenterMatchesOwnerOnlyFilter/);
  assert.match(list, /datacenterMatchesDatedOnlyFilter/);
  assert.match(list, /datacenterMatchesWebsiteFilter/);
  assert.match(list, /datacenterMatchesNamedFilter/);
  assert.match(list, /datacenterMatchesListOperator/);
  assert.ok(
    list.indexOf('datacenterMatchesOwnerOnlyFilter') < list.indexOf('datacenterMatchesRefOnlyFilter'),
    'Ref only ANDs after the Plan 301 Owner only matcher',
  );
  assert.ok(
    list.indexOf('datacenterMatchesDatedOnlyFilter') < list.indexOf('datacenterMatchesOwnerOnlyFilter'),
    'Owner only still ANDs after the Plan 291 Dated only matcher',
  );
  assert.ok(
    list.indexOf('datacenterMatchesWebsiteFilter') < list.indexOf('datacenterMatchesDatedOnlyFilter'),
    'Dated only still ANDs after the Plan 285 Website only matcher',
  );
  assert.ok(
    list.indexOf('datacenterMatchesNamedFilter') < list.indexOf('datacenterMatchesWebsiteFilter'),
    'Website only still ANDs after the Plan 270 Named only matcher',
  );
  assert.ok(
    list.indexOf('datacenterMatchesListOperator') < list.indexOf('datacenterMatchesNamedFilter'),
    'Named only still ANDs after the Plan 206 operator matcher',
  );
  assert.doesNotMatch(named, /dcRefOnly|datacenterListRefOnlyFilter|Ref only/);
  assert.doesNotMatch(operator, /dcRefOnly|datacenterListRefOnlyFilter|Ref only/);
  assert.doesNotMatch(website, /dcRefOnly|datacenterListRefOnlyFilter|Ref only/);
  assert.doesNotMatch(dated, /dcRefOnly|datacenterListRefOnlyFilter|Ref only/);
  assert.doesNotMatch(owner, /dcRefOnly|datacenterListRefOnlyFilter|Ref only/);
  assert.doesNotMatch(layer, /datacenterListRefOnlyFilter|dcRefOnly|meridian\.dcRefOnly/);
  assert.doesNotMatch(layerState, /dcRefOnly|meridian\.dcRefOnly/);
  assert.doesNotMatch(flights, /dcRefOnly|datacenterListRefOnlyFilter|meridian\.dcRefOnly/);
  assert.doesNotMatch(militaryFlights, /dcRefOnly|datacenterListRefOnlyFilter/);
  assert.doesNotMatch(installations, /dcRefOnly|datacenterListRefOnlyFilter|Ref only/);
  assert.doesNotMatch(adsbFallback, /dcRefOnly|datacenterListRefOnlyFilter/);
  const panel = markup.match(/<div id="datacenter-in-view"[\s\S]*?<p class="in-view-site-list-credit"/);
  assert.ok(panel, 'datacenter-in-view markup is missing');
  assert.match(panel[0], /id="datacenter-operator-chips"/);
  assert.match(panel[0], /id="datacenter-named-chips"/);
  assert.match(panel[0], /id="datacenter-website-chips"/);
  assert.match(panel[0], /id="datacenter-dated-chips"/);
  assert.match(panel[0], /id="datacenter-owner-chips"/);
  assert.match(panel[0], /id="datacenter-ref-chips"/);
  assert.match(panel[0], /data-dc-named="only"[^>]*>Named only</);
  assert.match(panel[0], /data-dc-website="only"[^>]*>Website only</);
  assert.match(panel[0], /data-dc-dated="only"[^>]*>Dated only</);
  assert.match(panel[0], /data-dc-owner="only"[^>]*>Owner only</);
  assert.match(panel[0], /data-dc-ref="only"[^>]*>Ref only</);
  assert.ok(
    panel[0].indexOf('id="datacenter-owner-chips"') < panel[0].indexOf('id="datacenter-ref-chips"'),
    'Ref only sits after the Plan 301 Owner only chip',
  );
  assert.ok(
    panel[0].indexOf('id="datacenter-ref-chips"') < panel[0].indexOf('id="datacenter-in-view-items"'),
    'Ref only sits above the in-view items',
  );
  assert.match(markup, /DATACENTERS IN VIEW/);
  assert.match(ui, /setDatacenterListRefOnly|hydrateDatacenterListRefOnly/);
  assert.match(ui, /data-dc-ref/);
  assert.match(ui, /_initDatacenterRefChip/);
  assert.doesNotMatch(ui, /hideNoOperator|Hide no operator/);
  const refChipFn = ui.slice(ui.indexOf('_syncDatacenterRefChip() {'));
  assert.match(refChipFn, /data-dc-ref/);
  assert.doesNotMatch(
    refChipFn.slice(0, refChipFn.indexOf('_initFullscreenButton')),
    /getRowControls/,
  );
  assert.match(css, /datacenter-ref-chip/);
  const firstRunFn = firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun'));
  assert.doesNotMatch(firstRunFn, /setDatacenterListRefOnly|writeDatacenterListRefOnly|hydrateDatacenterListRefOnly/);
  assert.doesNotMatch(sharelink, /dcRefOnly|meridian\.dcRefOnly/);
  assert.doesNotMatch(helper, /google\.com\/news|telegeography|quantum-earth|OpenSky/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /Meridian is an \*\*independent commercial product\*\*/);
  assert.match(src('index.html'), /<title>Meridian<\/title>/);
  assert.doesNotMatch(src('index.html'), /God.s Eye View branding/i);

  const localDiff = execSync(
    'git diff -- HEAD -- src/data/localGeojson.js src/data/datacenterListOperatorFilter.js src/data/datacenterListNamedFilter.js src/data/datacenterListWebsiteFilter.js src/data/datacenterListDatedOnlyFilter.js src/data/datacenterListOwnerOnlyFilter.js src/data/flights.js src/data/militaryFlights.js src/data/militaryInstallations.js src/data/adsbLolFallback.js src/firstRunExperience.js',
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  assert.equal(
    localDiff,
    '',
    'Plan 304 must not edit localGeojson.js, Plan 193/206/270/285/291/301 helpers, flights, military flights, installations, adsb fallback, or first-run',
  );
});
