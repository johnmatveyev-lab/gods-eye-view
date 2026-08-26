// PLAN 301 leftover — Datacenter list Owner only toggle. Client-only
// filter of the already-bundled OSM / ODbL snapshot. Distinct from Plan
// 193 hide-no-operator, Plan 206 All | AWS | Equinix, Plan 270 Named
// only, Plan 285 Website only, and Plan 291 Dated only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DATACENTER_OWNER_ONLY_CHIP_LABEL,
  DATACENTER_OWNER_ONLY_CHIP_TITLE,
  DATACENTER_OWNER_ONLY_STORAGE_KEY,
  DEFAULT_DATACENTER_OWNER_ONLY,
  datacenterHasOwner,
  datacenterMatchesOwnerOnlyFilter,
  datacenterOwnerOnlyChipModel,
  datacenterOwnerRaw,
  filterDatacentersByOwnerOnly,
  getDatacenterListOwnerOnly,
  hydrateDatacenterListOwnerOnly,
  normalizeDatacenterListOwnerOnly,
  readDatacenterListOwnerOnly,
  resetDatacenterListOwnerOnlyForTest,
  setDatacenterListOwnerOnly,
  subscribeDatacenterListOwnerOnly,
  writeDatacenterListOwnerOnly,
} from './datacenterListOwnerOnlyFilter.js';
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

const OWNED_EQUINIX = Object.freeze({
  id: 'dc-equinix-owned',
  label: 'Equinix DC12',
  latitude: 30.27,
  longitude: -97.74,
  visible: true,
  owner: 'Digital Realty',
  start_date: '1976',
  website: 'https://www.equinix.com/dc12',
  tags: {
    name: 'Equinix DC12',
    operator: 'Equinix',
    owner: 'Digital Realty',
    website: 'https://www.equinix.com/dc12',
    start_date: '1976',
  },
});
const OWNED_AWS = Object.freeze({
  id: 'dc-aws-owned',
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
  },
});
const NAMED_OPERATOR_NO_OWNER = Object.freeze({
  id: 'dc-named-operator-no-owner',
  label: 'Equinix DA1',
  latitude: 30.28,
  longitude: -97.73,
  visible: true,
  owner: '',
  website: 'https://www.equinix.com/da1',
  start_date: '2000',
  tags: {
    name: 'Equinix DA1',
    operator: 'Equinix',
    owner: '',
    website: 'https://www.equinix.com/da1',
    start_date: '2000',
  },
});
const EMPTY_OWNER = Object.freeze({
  id: 'dc-empty-owner',
  label: 'Empty owner site',
  latitude: 30.29,
  longitude: -97.72,
  visible: true,
  owner: '',
  tags: { owner: '' },
});
const WHITESPACE_OWNER = Object.freeze({
  id: 'dc-ws-owner',
  label: 'Whitespace owner site',
  latitude: 30.26,
  longitude: -97.75,
  visible: true,
  owner: '   ',
  tags: { owner: '  ' },
});
const GENERIC_NO_OWNER = Object.freeze({
  id: 'dc-generic-no-owner',
  label: 'Datacenter',
  latitude: 30.25,
  longitude: -97.76,
  visible: true,
  tags: { operator: 'Equinix' },
});
const GENERIC_OWNED = Object.freeze({
  id: 'dc-generic-owned',
  label: 'Datacenter',
  latitude: 30.23,
  longitude: -97.71,
  visible: true,
  owner: 'Claro Argentina',
  start_date: '1990',
  website: 'https://example.net/dc',
  tags: {
    operator: 'Equinix',
    owner: 'Claro Argentina',
    website: 'https://example.net/dc',
    start_date: '1990',
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
  tags: {
    operator: 'Equinix',
    owner: 'Equinix Ltd',
    website: 'https://www.equinix.com/ld5',
    start_date: '2010',
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

function bundledOwnerCount() {
  const lines = src('src/data/local_data/datacenters/datacenters.geojsonl').split('\n');
  let total = 0;
  let owned = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    total += 1;
    const feature = JSON.parse(line);
    const raw = feature?.properties?.tags?.owner ?? feature?.properties?.owner;
    if (String(raw || '').trim()) owned += 1;
  }
  return { total, owned };
}

test('Off keeps current draw including no-owner rows', () => {
  resetDatacenterListOwnerOnlyForTest();
  assert.equal(DEFAULT_DATACENTER_OWNER_ONLY, false);
  assert.equal(DATACENTER_OWNER_ONLY_CHIP_LABEL, 'Owner only');
  assert.equal(
    DATACENTER_OWNER_ONLY_CHIP_TITLE,
    'Hide datacenters that have no OSM owner',
  );
  assert.equal(normalizeDatacenterListOwnerOnly(undefined), false);
  assert.equal(normalizeDatacenterListOwnerOnly(null), false);
  assert.equal(normalizeDatacenterListOwnerOnly(''), false);
  assert.equal(normalizeDatacenterListOwnerOnly(false), false);
  assert.equal(normalizeDatacenterListOwnerOnly(0), false);
  assert.equal(normalizeDatacenterListOwnerOnly('0'), false);
  assert.equal(normalizeDatacenterListOwnerOnly(true), true);
  assert.equal(normalizeDatacenterListOwnerOnly('1'), true);
  assert.equal(normalizeDatacenterListOwnerOnly('true'), true);
  assert.equal(normalizeDatacenterListOwnerOnly('bogus'), null);

  const records = [OWNED_EQUINIX, NAMED_OPERATOR_NO_OWNER, EMPTY_OWNER, WHITESPACE_OWNER];
  assert.deepEqual(
    filterDatacentersByOwnerOnly(records, false).map((row) => row.id),
    records.map((row) => row.id),
  );
  const listed = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    ownerOnly: false,
  });
  assert.deepEqual(
    new Set(listed.map((site) => site.id)),
    new Set(records.map((row) => row.id)),
  );
  assert.ok(listed.some((site) => site.id === NAMED_OPERATOR_NO_OWNER.id));
  assert.ok(listed.some((site) => site.id === OWNED_EQUINIX.id));
  assert.equal(datacenterMatchesOwnerOnlyFilter(NAMED_OPERATOR_NO_OWNER, false), true);
  assert.deepEqual(filterDatacentersByOwnerOnly(null), []);
  assert.deepEqual(filterDatacentersByOwnerOnly(undefined), []);
});

test('On keeps tags.owner and hides a named operator-only row with empty owner', () => {
  assert.equal(datacenterOwnerRaw(NAMED_OPERATOR_NO_OWNER), null);
  assert.equal(datacenterOwnerRaw(EMPTY_OWNER), null);
  assert.equal(datacenterOwnerRaw(WHITESPACE_OWNER), null);
  assert.equal(datacenterOwnerRaw({}), null);
  assert.equal(datacenterHasOwner(NAMED_OPERATOR_NO_OWNER), false);
  assert.equal(datacenterHasOwner(EMPTY_OWNER), false);
  assert.equal(datacenterHasOwner(WHITESPACE_OWNER), false);
  assert.equal(datacenterMatchesOwnerOnlyFilter(NAMED_OPERATOR_NO_OWNER, true), false);
  assert.equal(datacenterMatchesOwnerOnlyFilter(EMPTY_OWNER, true), false);
  assert.equal(datacenterMatchesOwnerOnlyFilter(WHITESPACE_OWNER, true), false);
  assert.equal(datacenterMatchesOwnerOnlyFilter({ owner: null }, true), false);
  assert.equal(datacenterHasOwner(OWNED_EQUINIX), true);
  assert.equal(datacenterOwnerRaw(OWNED_EQUINIX), 'Digital Realty');
  assert.equal(datacenterMatchesOwnerOnlyFilter(OWNED_EQUINIX, true), true);

  const viaProps = { id: 'via-props', properties: { owner: 'Vadata Inc' } };
  assert.equal(datacenterOwnerRaw(viaProps), 'Vadata Inc');
  assert.equal(datacenterMatchesOwnerOnlyFilter(viaProps, true), true);

  const viaTags = { id: 'via-tags', tags: { owner: 'Platypus Development LLC' } };
  assert.equal(datacenterOwnerRaw(viaTags), 'Platypus Development LLC');
  assert.equal(datacenterMatchesOwnerOnlyFilter(viaTags, true), true);

  const viaPropTags = { id: 'via-prop-tags', properties: { tags: { owner: 'Digital Realty' } } };
  assert.equal(datacenterOwnerRaw(viaPropTags), 'Digital Realty');

  const kept = filterDatacentersByOwnerOnly(
    [OWNED_EQUINIX, NAMED_OPERATOR_NO_OWNER, EMPTY_OWNER, WHITESPACE_OWNER],
    true,
  );
  assert.deepEqual(kept.map((row) => row.id), [OWNED_EQUINIX.id]);

  const listed = listDatacentersInView({
    enabled: true,
    records: [OWNED_EQUINIX, NAMED_OPERATOR_NO_OWNER, EMPTY_OWNER, WHITESPACE_OWNER],
    view: AUSTIN_VIEW,
    ownerOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [OWNED_EQUINIX.id]);
  assert.equal(listed[0].label, 'Equinix DC12');
  assert.equal(listed.some((site) => site.id === NAMED_OPERATOR_NO_OWNER.id), false);
});

test('Selected no-owner still lists', () => {
  assert.equal(
    datacenterMatchesOwnerOnlyFilter(NAMED_OPERATOR_NO_OWNER, true, {
      selectedId: NAMED_OPERATOR_NO_OWNER.id,
    }),
    true,
  );
  assert.deepEqual(
    filterDatacentersByOwnerOnly(
      [OWNED_EQUINIX, NAMED_OPERATOR_NO_OWNER, EMPTY_OWNER],
      true,
      NAMED_OPERATOR_NO_OWNER.id,
    ).map((row) => row.id),
    [OWNED_EQUINIX.id, NAMED_OPERATOR_NO_OWNER.id],
  );
  const listed = listDatacentersInView({
    enabled: true,
    records: [OWNED_EQUINIX, NAMED_OPERATOR_NO_OWNER, EMPTY_OWNER],
    view: AUSTIN_VIEW,
    ownerOnly: true,
    selectedId: EMPTY_OWNER.id,
  });
  assert.deepEqual(
    new Set(listed.map((site) => site.id)),
    new Set([OWNED_EQUINIX.id, EMPTY_OWNER.id]),
  );

  const outOfViewSelected = listDatacentersInView({
    enabled: true,
    records: [OWNED_EQUINIX, LONDON],
    view: AUSTIN_VIEW,
    ownerOnly: true,
    selectedId: LONDON.id,
  });
  assert.deepEqual(outOfViewSelected.map((site) => site.id), [OWNED_EQUINIX.id]);
});

test('AND with Named only / Website only / Dated only / 206', () => {
  const records = [
    OWNED_EQUINIX,
    NAMED_OPERATOR_NO_OWNER,
    OWNED_AWS,
    GENERIC_NO_OWNER,
    GENERIC_OWNED,
  ];
  const afterEquinix = filterDatacentersByListOperator(records, 'equinix');
  assert.deepEqual(
    afterEquinix.map((row) => row.id),
    [
      OWNED_EQUINIX.id,
      NAMED_OPERATOR_NO_OWNER.id,
      GENERIC_NO_OWNER.id,
      GENERIC_OWNED.id,
    ],
    'Equinix keeps named + generic Equinix rows before Named only / Website only / Dated only / Owner only',
  );
  const afterNamed = filterDatacentersByNamedOnly(afterEquinix, true);
  assert.deepEqual(
    afterNamed.map((row) => row.id),
    [OWNED_EQUINIX.id, NAMED_OPERATOR_NO_OWNER.id],
  );
  const afterWebsite = filterDatacentersByWebsiteOnly(afterNamed, true);
  assert.deepEqual(
    afterWebsite.map((row) => row.id),
    [OWNED_EQUINIX.id, NAMED_OPERATOR_NO_OWNER.id],
  );
  const afterDated = filterDatacentersByDatedOnly(afterWebsite, true);
  assert.deepEqual(
    afterDated.map((row) => row.id),
    [OWNED_EQUINIX.id, NAMED_OPERATOR_NO_OWNER.id],
  );
  assert.deepEqual(
    filterDatacentersByOwnerOnly(afterDated, true).map((row) => row.id),
    [OWNED_EQUINIX.id],
    'named operator-only Equinix with empty owner hides when Owner only is on',
  );

  const allOwned = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'all',
    namedOnly: false,
    websiteOnly: false,
    datedOnly: false,
    ownerOnly: true,
  });
  assert.deepEqual(allOwned.map((site) => site.id).sort(), [
    OWNED_AWS.id,
    OWNED_EQUINIX.id,
    GENERIC_OWNED.id,
  ]);

  const equinixNamedWebsiteDatedOwner = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'equinix',
    namedOnly: true,
    websiteOnly: true,
    datedOnly: true,
    ownerOnly: true,
  });
  assert.deepEqual(equinixNamedWebsiteDatedOwner.map((site) => site.id), [OWNED_EQUINIX.id]);

  const awsNamedWebsiteDatedOwner = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'aws',
    namedOnly: true,
    websiteOnly: true,
    datedOnly: true,
    ownerOnly: true,
  });
  assert.deepEqual(awsNamedWebsiteDatedOwner.map((site) => site.id), [OWNED_AWS.id]);

  const selectedThroughAnd = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'equinix',
    namedOnly: true,
    websiteOnly: true,
    datedOnly: true,
    ownerOnly: true,
    selectedId: NAMED_OPERATOR_NO_OWNER.id,
  });
  assert.deepEqual(
    new Set(selectedThroughAnd.map((site) => site.id)),
    new Set([OWNED_EQUINIX.id, NAMED_OPERATOR_NO_OWNER.id]),
    'selected named operator-only Equinix stays through operator AND Named only AND Website only AND Dated only AND Owner only',
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
    selectedId: NAMED_OPERATOR_NO_OWNER.id,
  });
  assert.deepEqual(
    selectedFailedOperator.map((site) => site.id),
    [OWNED_AWS.id],
    'selected Equinix no-owner does not stay when AWS already dropped it',
  );
});

test('context-store owner counts', () => {
  const originalWindow = globalThis.window;
  globalThis.window = globalThis.window || {};
  try {
    const store = getContextStore();
    store.entities.set('local-datacenters:424945736', {
      properties: { tags: { owner: 'Digital Realty' } },
    });
    assert.equal(datacenterOwnerRaw({ id: '424945736' }), 'Digital Realty');
    assert.equal(datacenterHasOwner({ id: '424945736' }), true);
    assert.equal(datacenterMatchesOwnerOnlyFilter({ id: '424945736' }, true), true);
    const listed = listDatacentersInView({
      enabled: true,
      records: [{
        id: '424945736',
        label: 'Centurylink LAX',
        latitude: 30.28,
        longitude: -97.74,
        visible: true,
      }, NAMED_OPERATOR_NO_OWNER],
      view: AUSTIN_VIEW,
      ownerOnly: true,
    });
    assert.deepEqual(listed.map((site) => site.id), ['424945736']);
    store.entities.delete('local-datacenters:424945736');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('Invalid / corrupt storage reads as off', () => {
  assert.equal(DATACENTER_OWNER_ONLY_STORAGE_KEY, 'meridian.dcOwnerOnly');
  assert.equal(readDatacenterListOwnerOnly(memoryStorage()), false);
  assert.equal(readDatacenterListOwnerOnly(memoryStorage({
    [DATACENTER_OWNER_ONLY_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readDatacenterListOwnerOnly(memoryStorage({
    [DATACENTER_OWNER_ONLY_STORAGE_KEY]: 'bogus',
  })), false);
  assert.equal(readDatacenterListOwnerOnly(memoryStorage({
    [DATACENTER_OWNER_ONLY_STORAGE_KEY]: '{}',
  })), false);
  assert.equal(readDatacenterListOwnerOnly(memoryStorage({
    [DATACENTER_OWNER_ONLY_STORAGE_KEY]: '2',
  })), false);
  assert.equal(readDatacenterListOwnerOnly({
    getItem() { throw new Error('blocked'); },
  }), false);
  assert.equal(writeDatacenterListOwnerOnly('nope', memoryStorage()), false);
});

test('Persist / hydrate, no share-URL write', () => {
  resetDatacenterListOwnerOnlyForTest();
  const storage = memoryStorage();
  assert.equal(writeDatacenterListOwnerOnly(true, storage), true);
  assert.equal(storage.getItem(DATACENTER_OWNER_ONLY_STORAGE_KEY), '1');
  assert.equal(readDatacenterListOwnerOnly(storage), true);
  const reloaded = memoryStorage(storage.snapshot());
  assert.equal(readDatacenterListOwnerOnly(reloaded), true);
  assert.equal(setDatacenterListOwnerOnly(true, { storage }), true);
  assert.equal(getDatacenterListOwnerOnly(), true);
  const seen = [];
  const unsubscribe = subscribeDatacenterListOwnerOnly((value) => { seen.push(value); });
  assert.equal(setDatacenterListOwnerOnly(false, { persist: false }), false);
  assert.deepEqual(seen, [false]);
  unsubscribe();

  resetDatacenterListOwnerOnlyForTest();
  assert.equal(getDatacenterListOwnerOnly(), DEFAULT_DATACENTER_OWNER_ONLY);
  assert.equal(hydrateDatacenterListOwnerOnly(storage), true);
  assert.equal(getDatacenterListOwnerOnly(), true);
  assert.equal(writeDatacenterListOwnerOnly(false, storage), true);
  assert.equal(storage.getItem(DATACENTER_OWNER_ONLY_STORAGE_KEY), '0');
  assert.equal(readDatacenterListOwnerOnly(memoryStorage(storage.snapshot())), false);
  assert.equal(Object.keys(storage.snapshot()).join(','), DATACENTER_OWNER_ONLY_STORAGE_KEY);
  assert.equal(datacenterOwnerOnlyChipModel(false).params.dcOwnerOnly, true);
  assert.equal(datacenterOwnerOnlyChipModel(true).params.dcOwnerOnly, false);
  assert.equal(datacenterOwnerOnlyChipModel(false).active, false);
  assert.equal(datacenterOwnerOnlyChipModel(true).active, true);
  assert.equal(datacenterOwnerOnlyChipModel(false).label, 'Owner only');

  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['local-datacenters'], undefined);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=d'));
  assert.equal(omitted.options['local-datacenters'], undefined);

  const state = normalizeLayerState({
    enabledLayerIds: ['local-datacenters'],
    options: { 'local-datacenters': { dcOwnerOnly: true } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /dcOwnerOnly|d\.o\.|ownerOnly/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['local-datacenters'], undefined);
  assert.equal(getDatacenterListOwnerOnly(), true, 'coordinator-style restore of enabled-only keeps the chip');
  resetDatacenterListOwnerOnlyForTest();
});

test('hosted list applies Owner only from getListPayload session state', () => {
  resetDatacenterListOwnerOnlyForTest();
  const doc = fakeDocument();
  const root = fakeNode('div');
  const items = fakeNode('div');
  items.ownerDocument = doc;
  const count = fakeNode('output');
  setDatacenterListOwnerOnly(false, { persist: false });
  const binder = bindDatacenterInViewList({
    root,
    items,
    count,
    getEnabled: () => true,
    getRecords: () => [OWNED_EQUINIX, NAMED_OPERATOR_NO_OWNER, LONDON],
    getView: () => AUSTIN_VIEW,
    flyTo() {},
  });
  const offIds = binder.sites().map((site) => site.id);
  assert.deepEqual(offIds, [OWNED_EQUINIX.id, NAMED_OPERATOR_NO_OWNER.id]);

  setDatacenterListOwnerOnly(true, { persist: false });
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), [OWNED_EQUINIX.id]);

  setDatacenterListOwnerOnly(false, { persist: false });
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), offIds);
  binder.destroy();
  resetDatacenterListOwnerOnlyForTest();
});

test('distinct from Plan 193 hide-no-operator, Plan 206 operator chips, Plan 270 Named only, Plan 285 Website only, and Plan 291 Dated only', () => {
  const counts = bundledOwnerCount();
  assert.equal(counts.total, 4351);
  assert.equal(counts.owned, 142, 'bundled OSM / ODbL snapshot already carries tags.owner');

  const helper = src('src/data/datacenterListOwnerOnlyFilter.js');
  const list = src('src/data/datacenterList.js');
  const named = src('src/data/datacenterListNamedFilter.js');
  const operator = src('src/data/datacenterListOperatorFilter.js');
  const website = src('src/data/datacenterListWebsiteFilter.js');
  const dated = src('src/data/datacenterListDatedOnlyFilter.js');
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

  assert.equal(existsSync(path.join(ROOT, 'src/data/datacenterOperatorFilter.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/datacenters/owner-only.js')), false);
  assert.doesNotMatch(helper, /\bfetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.match(helper, /meridian\.dcOwnerOnly/);
  assert.match(helper, /meridian\.datacenterHideNoOperator/);
  assert.match(helper, /meridian\.dcOperator/);
  assert.match(helper, /meridian\.dcNamedOnly/);
  assert.match(helper, /meridian\.dcWebsiteOnly/);
  assert.match(helper, /meridian\.dcDatedOnly/);
  assert.doesNotMatch(helper, /Hide no operator/);
  assert.doesNotMatch(helper, /dcOperator:|setDatacenterListOperator/);
  assert.doesNotMatch(helper, /setDatacenterListNamedOnly|dcNamedOnly:/);
  assert.doesNotMatch(helper, /setDatacenterListWebsiteOnly|dcWebsiteOnly:/);
  assert.doesNotMatch(helper, /setDatacenterListDatedOnly|dcDatedOnly:/);
  assert.match(list, /datacenterMatchesOwnerOnlyFilter|filterDatacentersByOwnerOnly/);
  assert.match(list, /datacenterMatchesDatedOnlyFilter/);
  assert.match(list, /datacenterMatchesWebsiteFilter/);
  assert.match(list, /datacenterMatchesNamedFilter/);
  assert.match(list, /datacenterMatchesListOperator/);
  assert.ok(
    list.indexOf('datacenterMatchesDatedOnlyFilter') < list.indexOf('datacenterMatchesOwnerOnlyFilter'),
    'Owner only ANDs after the Plan 291 Dated only matcher',
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
  assert.doesNotMatch(named, /dcOwnerOnly|datacenterListOwnerOnlyFilter|Owner only/);
  assert.doesNotMatch(operator, /dcOwnerOnly|datacenterListOwnerOnlyFilter|Owner only/);
  assert.doesNotMatch(website, /dcOwnerOnly|datacenterListOwnerOnlyFilter|Owner only/);
  assert.doesNotMatch(dated, /dcOwnerOnly|datacenterListOwnerOnlyFilter|Owner only/);
  assert.doesNotMatch(layer, /datacenterListOwnerOnlyFilter|dcOwnerOnly|meridian\.dcOwnerOnly/);
  assert.doesNotMatch(layerState, /dcOwnerOnly|meridian\.dcOwnerOnly/);
  assert.doesNotMatch(flights, /dcOwnerOnly|datacenterListOwnerOnlyFilter|meridian\.dcOwnerOnly/);
  assert.doesNotMatch(militaryFlights, /dcOwnerOnly|datacenterListOwnerOnlyFilter/);
  assert.doesNotMatch(installations, /dcOwnerOnly|datacenterListOwnerOnlyFilter|Owner only/);
  const panel = markup.match(/<div id="datacenter-in-view"[\s\S]*?<p class="in-view-site-list-credit"/);
  assert.ok(panel, 'datacenter-in-view markup is missing');
  assert.match(panel[0], /id="datacenter-operator-chips"/);
  assert.match(panel[0], /id="datacenter-named-chips"/);
  assert.match(panel[0], /id="datacenter-website-chips"/);
  assert.match(panel[0], /id="datacenter-dated-chips"/);
  assert.match(panel[0], /id="datacenter-owner-chips"/);
  assert.match(panel[0], /data-dc-named="only"[^>]*>Named only</);
  assert.match(panel[0], /data-dc-website="only"[^>]*>Website only</);
  assert.match(panel[0], /data-dc-dated="only"[^>]*>Dated only</);
  assert.match(panel[0], /data-dc-owner="only"[^>]*>Owner only</);
  assert.ok(
    panel[0].indexOf('id="datacenter-dated-chips"') < panel[0].indexOf('id="datacenter-owner-chips"'),
    'Owner only sits after the Plan 291 Dated only chip',
  );
  assert.ok(
    panel[0].indexOf('id="datacenter-owner-chips"') < panel[0].indexOf('id="datacenter-in-view-items"'),
    'Owner only sits above the in-view items',
  );
  assert.match(markup, /DATACENTERS IN VIEW/);
  assert.match(ui, /setDatacenterListOwnerOnly|hydrateDatacenterListOwnerOnly/);
  assert.match(ui, /data-dc-owner/);
  assert.match(ui, /_initDatacenterOwnerChip/);
  assert.doesNotMatch(ui, /hideNoOperator|Hide no operator/);
  const ownerChipFn = ui.slice(ui.indexOf('_syncDatacenterOwnerChip() {'));
  assert.match(ownerChipFn, /data-dc-owner/);
  assert.doesNotMatch(
    ownerChipFn.slice(0, ownerChipFn.indexOf('_initFullscreenButton')),
    /getRowControls/,
  );
  assert.match(css, /datacenter-owner-chip/);
  const firstRunFn = firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun'));
  assert.doesNotMatch(firstRunFn, /setDatacenterListOwnerOnly|writeDatacenterListOwnerOnly|hydrateDatacenterListOwnerOnly/);
  assert.doesNotMatch(sharelink, /dcOwnerOnly|meridian\.dcOwnerOnly/);
  assert.doesNotMatch(helper, /google\.com\/news|telegeography|quantum-earth|OpenSky/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /Meridian is an \*\*independent commercial product\*\*/);
  assert.match(src('index.html'), /<title>Meridian<\/title>/);
  assert.doesNotMatch(src('index.html'), /God.s Eye View branding/i);

  const localDiff = execSync(
    'git diff -- HEAD -- src/data/localGeojson.js src/data/datacenterListOperatorFilter.js src/data/datacenterListNamedFilter.js src/data/datacenterListWebsiteFilter.js src/data/datacenterListDatedOnlyFilter.js src/data/flights.js src/data/militaryFlights.js src/data/militaryInstallations.js src/firstRunExperience.js',
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  assert.equal(
    localDiff,
    '',
    'Plan 301 must not edit localGeojson.js, Plan 193/206/270/285/291 helpers, flights, military flights, installations, or first-run',
  );
});
