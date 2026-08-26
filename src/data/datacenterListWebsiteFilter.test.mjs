// PLAN 285 — Datacenter list Website only toggle. Client-only filter of
// the already-bundled OSM / ODbL snapshot. Distinct from Plan 193
// hide-no-operator, Plan 206 All | AWS | Equinix, and Plan 270 Named only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DATACENTER_WEBSITE_ONLY_CHIP_LABEL,
  DATACENTER_WEBSITE_ONLY_CHIP_TITLE,
  DATACENTER_WEBSITE_ONLY_STORAGE_KEY,
  DEFAULT_DATACENTER_WEBSITE_ONLY,
  datacenterHasWebsite,
  datacenterMatchesWebsiteFilter,
  datacenterWebsiteOnlyChipModel,
  datacenterWebsiteRaw,
  filterDatacentersByWebsiteOnly,
  getDatacenterListWebsiteOnly,
  hydrateDatacenterListWebsiteOnly,
  normalizeDatacenterListWebsiteOnly,
  readDatacenterListWebsiteOnly,
  resetDatacenterListWebsiteOnlyForTest,
  setDatacenterListWebsiteOnly,
  subscribeDatacenterListWebsiteOnly,
  writeDatacenterListWebsiteOnly,
} from './datacenterListWebsiteFilter.js';
import {
  filterDatacentersByListOperator,
} from './datacenterListOperatorFilter.js';
import {
  filterDatacentersByNamedOnly,
} from './datacenterListNamedFilter.js';
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

const TAGGED_EQUINIX = Object.freeze({
  id: 'dc-equinix-web',
  label: 'Equinix DC12',
  latitude: 30.27,
  longitude: -97.74,
  visible: true,
  website: 'https://www.equinix.com/dc12',
  tags: { name: 'Equinix DC12', operator: 'Equinix', website: 'https://www.equinix.com/dc12' },
});
const TAGGED_AWS = Object.freeze({
  id: 'dc-aws-web',
  label: 'AWS DFW-1',
  latitude: 30.24,
  longitude: -97.77,
  visible: true,
  tags: {
    name: 'AWS DFW-1',
    'operator:short': 'AWS',
    operator: 'Amazon Web Services',
    website: 'https://aws.amazon.com/dfw',
  },
});
const NO_WEBSITE = Object.freeze({
  id: 'dc-no-web',
  label: 'Equinix DA1',
  latitude: 30.28,
  longitude: -97.73,
  visible: true,
  tags: { name: 'Equinix DA1', operator: 'Equinix' },
});
const EMPTY_WEBSITE = Object.freeze({
  id: 'dc-empty-web',
  label: 'Empty site',
  latitude: 30.29,
  longitude: -97.72,
  visible: true,
  website: '',
  tags: { website: '' },
});
const WHITESPACE_WEBSITE = Object.freeze({
  id: 'dc-ws-web',
  label: 'Whitespace site',
  latitude: 30.26,
  longitude: -97.75,
  visible: true,
  website: '   ',
  tags: { website: '  ' },
});
const GENERIC_NO_WEB = Object.freeze({
  id: 'dc-generic-no-web',
  label: 'Datacenter',
  latitude: 30.25,
  longitude: -97.76,
  visible: true,
  tags: { operator: 'Equinix' },
});
const GENERIC_WITH_WEB = Object.freeze({
  id: 'dc-generic-web',
  label: 'Datacenter',
  latitude: 30.23,
  longitude: -97.71,
  visible: true,
  website: 'https://example.net/dc',
  tags: { operator: 'Equinix', website: 'https://example.net/dc' },
});
const LONDON = Object.freeze({
  id: 'dc-london',
  label: 'Equinix LD5',
  latitude: 51.5074,
  longitude: -0.1278,
  visible: true,
  website: 'https://www.equinix.com/ld5',
  tags: { operator: 'Equinix', website: 'https://www.equinix.com/ld5' },
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

test('Off keeps no-website and tagged rows', () => {
  resetDatacenterListWebsiteOnlyForTest();
  assert.equal(DEFAULT_DATACENTER_WEBSITE_ONLY, false);
  assert.equal(DATACENTER_WEBSITE_ONLY_CHIP_LABEL, 'Website only');
  assert.equal(
    DATACENTER_WEBSITE_ONLY_CHIP_TITLE,
    'Hide datacenters that have no OSM website',
  );
  assert.equal(normalizeDatacenterListWebsiteOnly(undefined), false);
  assert.equal(normalizeDatacenterListWebsiteOnly(null), false);
  assert.equal(normalizeDatacenterListWebsiteOnly(''), false);
  assert.equal(normalizeDatacenterListWebsiteOnly(false), false);
  assert.equal(normalizeDatacenterListWebsiteOnly(0), false);
  assert.equal(normalizeDatacenterListWebsiteOnly('0'), false);
  assert.equal(normalizeDatacenterListWebsiteOnly(true), true);
  assert.equal(normalizeDatacenterListWebsiteOnly('1'), true);
  assert.equal(normalizeDatacenterListWebsiteOnly('true'), true);
  assert.equal(normalizeDatacenterListWebsiteOnly('bogus'), null);

  const records = [TAGGED_EQUINIX, NO_WEBSITE, EMPTY_WEBSITE, WHITESPACE_WEBSITE];
  assert.deepEqual(
    filterDatacentersByWebsiteOnly(records, false).map((row) => row.id),
    records.map((row) => row.id),
  );
  const listed = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    websiteOnly: false,
  });
  assert.deepEqual(
    new Set(listed.map((site) => site.id)),
    new Set(records.map((row) => row.id)),
  );
  assert.ok(listed.some((site) => site.id === NO_WEBSITE.id));
  assert.ok(listed.some((site) => site.id === TAGGED_EQUINIX.id));
  assert.equal(datacenterMatchesWebsiteFilter(NO_WEBSITE, false), true);
  assert.deepEqual(filterDatacentersByWebsiteOnly(null), []);
  assert.deepEqual(filterDatacentersByWebsiteOnly(undefined), []);
});

test('On drops no-website, keeps tagged sites', () => {
  assert.equal(datacenterWebsiteRaw(NO_WEBSITE), null);
  assert.equal(datacenterWebsiteRaw(EMPTY_WEBSITE), null);
  assert.equal(datacenterWebsiteRaw(WHITESPACE_WEBSITE), null);
  assert.equal(datacenterWebsiteRaw({}), null);
  assert.equal(datacenterHasWebsite(NO_WEBSITE), false);
  assert.equal(datacenterHasWebsite(EMPTY_WEBSITE), false);
  assert.equal(datacenterHasWebsite(WHITESPACE_WEBSITE), false);
  assert.equal(datacenterMatchesWebsiteFilter(NO_WEBSITE, true), false);
  assert.equal(datacenterMatchesWebsiteFilter(EMPTY_WEBSITE, true), false);
  assert.equal(datacenterMatchesWebsiteFilter(WHITESPACE_WEBSITE, true), false);
  assert.equal(datacenterMatchesWebsiteFilter({ website: null }, true), false);
  assert.equal(datacenterHasWebsite(TAGGED_EQUINIX), true);
  assert.equal(datacenterWebsiteRaw(TAGGED_EQUINIX), 'https://www.equinix.com/dc12');
  assert.equal(datacenterMatchesWebsiteFilter(TAGGED_EQUINIX, true), true);

  const viaProps = { id: 'via-props', properties: { website: 'https://via.props' } };
  assert.equal(datacenterWebsiteRaw(viaProps), 'https://via.props');
  assert.equal(datacenterMatchesWebsiteFilter(viaProps, true), true);

  const viaTags = { id: 'via-tags', tags: { website: 'https://via.tags' } };
  assert.equal(datacenterWebsiteRaw(viaTags), 'https://via.tags');
  assert.equal(datacenterMatchesWebsiteFilter(viaTags, true), true);

  const viaPropTags = { id: 'via-prop-tags', properties: { tags: { website: 'https://via.prop.tags' } } };
  assert.equal(datacenterWebsiteRaw(viaPropTags), 'https://via.prop.tags');

  const kept = filterDatacentersByWebsiteOnly(
    [TAGGED_EQUINIX, NO_WEBSITE, EMPTY_WEBSITE, WHITESPACE_WEBSITE],
    true,
  );
  assert.deepEqual(kept.map((row) => row.id), [TAGGED_EQUINIX.id]);

  const listed = listDatacentersInView({
    enabled: true,
    records: [TAGGED_EQUINIX, NO_WEBSITE, EMPTY_WEBSITE, WHITESPACE_WEBSITE],
    view: AUSTIN_VIEW,
    websiteOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [TAGGED_EQUINIX.id]);
  assert.equal(listed[0].label, 'Equinix DC12');
  assert.equal(listed.some((site) => site.id === NO_WEBSITE.id), false);
});

test('Selected no-website row still lists', () => {
  assert.equal(
    datacenterMatchesWebsiteFilter(NO_WEBSITE, true, { selectedId: NO_WEBSITE.id }),
    true,
  );
  assert.deepEqual(
    filterDatacentersByWebsiteOnly(
      [TAGGED_EQUINIX, NO_WEBSITE, EMPTY_WEBSITE],
      true,
      NO_WEBSITE.id,
    ).map((row) => row.id),
    [TAGGED_EQUINIX.id, NO_WEBSITE.id],
  );
  const listed = listDatacentersInView({
    enabled: true,
    records: [TAGGED_EQUINIX, NO_WEBSITE, EMPTY_WEBSITE],
    view: AUSTIN_VIEW,
    websiteOnly: true,
    selectedId: EMPTY_WEBSITE.id,
  });
  assert.deepEqual(
    new Set(listed.map((site) => site.id)),
    new Set([TAGGED_EQUINIX.id, EMPTY_WEBSITE.id]),
  );

  const outOfViewSelected = listDatacentersInView({
    enabled: true,
    records: [TAGGED_EQUINIX, LONDON],
    view: AUSTIN_VIEW,
    websiteOnly: true,
    selectedId: LONDON.id,
  });
  assert.deepEqual(outOfViewSelected.map((site) => site.id), [TAGGED_EQUINIX.id]);
});

test('AND with operator chips + named-only', () => {
  const records = [
    TAGGED_EQUINIX,
    NO_WEBSITE,
    TAGGED_AWS,
    GENERIC_NO_WEB,
    GENERIC_WITH_WEB,
  ];
  const afterEquinix = filterDatacentersByListOperator(records, 'equinix');
  assert.deepEqual(
    afterEquinix.map((row) => row.id),
    [TAGGED_EQUINIX.id, NO_WEBSITE.id, GENERIC_NO_WEB.id, GENERIC_WITH_WEB.id],
    'Equinix keeps named + generic Equinix rows before Named only / Website only',
  );
  const afterNamed = filterDatacentersByNamedOnly(afterEquinix, true);
  assert.deepEqual(
    afterNamed.map((row) => row.id),
    [TAGGED_EQUINIX.id, NO_WEBSITE.id],
  );
  assert.deepEqual(
    filterDatacentersByWebsiteOnly(afterNamed, true).map((row) => row.id),
    [TAGGED_EQUINIX.id],
  );

  const allWebsite = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'all',
    namedOnly: false,
    websiteOnly: true,
  });
  assert.deepEqual(allWebsite.map((site) => site.id).sort(), [
    TAGGED_AWS.id,
    TAGGED_EQUINIX.id,
    GENERIC_WITH_WEB.id,
  ]);

  const equinixNamedWebsite = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'equinix',
    namedOnly: true,
    websiteOnly: true,
  });
  assert.deepEqual(equinixNamedWebsite.map((site) => site.id), [TAGGED_EQUINIX.id]);

  const awsNamedWebsite = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'aws',
    namedOnly: true,
    websiteOnly: true,
  });
  assert.deepEqual(awsNamedWebsite.map((site) => site.id), [TAGGED_AWS.id]);

  const selectedThroughAnd = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'equinix',
    namedOnly: true,
    websiteOnly: true,
    selectedId: NO_WEBSITE.id,
  });
  assert.deepEqual(
    new Set(selectedThroughAnd.map((site) => site.id)),
    new Set([TAGGED_EQUINIX.id, NO_WEBSITE.id]),
    'selected no-website Equinix stays through operator AND Named only AND Website only',
  );

  const selectedFailedOperator = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'aws',
    namedOnly: true,
    websiteOnly: true,
    selectedId: NO_WEBSITE.id,
  });
  assert.deepEqual(
    selectedFailedOperator.map((site) => site.id),
    [TAGGED_AWS.id],
    'selected Equinix no-website does not stay when AWS already dropped it',
  );
});

test('context-store website counts', () => {
  const originalWindow = globalThis.window;
  globalThis.window = globalThis.window || {};
  try {
    const store = getContextStore();
    store.entities.set('local-datacenters:703242718', {
      properties: { tags: { website: 'https://www.equinix.lat/' } },
    });
    assert.equal(datacenterWebsiteRaw({ id: '703242718' }), 'https://www.equinix.lat/');
    assert.equal(datacenterHasWebsite({ id: '703242718' }), true);
    assert.equal(datacenterMatchesWebsiteFilter({ id: '703242718' }, true), true);
    const listed = listDatacentersInView({
      enabled: true,
      records: [{
        id: '703242718',
        label: 'Equinix ST4',
        latitude: 30.28,
        longitude: -97.74,
        visible: true,
      }, NO_WEBSITE],
      view: AUSTIN_VIEW,
      websiteOnly: true,
    });
    assert.deepEqual(listed.map((site) => site.id), ['703242718']);
    store.entities.delete('local-datacenters:703242718');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('Invalid / corrupt storage reads as off', () => {
  assert.equal(DATACENTER_WEBSITE_ONLY_STORAGE_KEY, 'meridian.dcWebsiteOnly');
  assert.equal(readDatacenterListWebsiteOnly(memoryStorage()), false);
  assert.equal(readDatacenterListWebsiteOnly(memoryStorage({
    [DATACENTER_WEBSITE_ONLY_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readDatacenterListWebsiteOnly(memoryStorage({
    [DATACENTER_WEBSITE_ONLY_STORAGE_KEY]: 'bogus',
  })), false);
  assert.equal(readDatacenterListWebsiteOnly(memoryStorage({
    [DATACENTER_WEBSITE_ONLY_STORAGE_KEY]: '{}',
  })), false);
  assert.equal(readDatacenterListWebsiteOnly(memoryStorage({
    [DATACENTER_WEBSITE_ONLY_STORAGE_KEY]: '2',
  })), false);
  assert.equal(readDatacenterListWebsiteOnly({
    getItem() { throw new Error('blocked'); },
  }), false);
  assert.equal(writeDatacenterListWebsiteOnly('nope', memoryStorage()), false);
});

test('Persist / hydrate, no share-URL write', () => {
  resetDatacenterListWebsiteOnlyForTest();
  const storage = memoryStorage();
  assert.equal(writeDatacenterListWebsiteOnly(true, storage), true);
  assert.equal(storage.getItem(DATACENTER_WEBSITE_ONLY_STORAGE_KEY), '1');
  assert.equal(readDatacenterListWebsiteOnly(storage), true);
  const reloaded = memoryStorage(storage.snapshot());
  assert.equal(readDatacenterListWebsiteOnly(reloaded), true);
  assert.equal(setDatacenterListWebsiteOnly(true, { storage }), true);
  assert.equal(getDatacenterListWebsiteOnly(), true);
  const seen = [];
  const unsubscribe = subscribeDatacenterListWebsiteOnly((value) => { seen.push(value); });
  assert.equal(setDatacenterListWebsiteOnly(false, { persist: false }), false);
  assert.deepEqual(seen, [false]);
  unsubscribe();

  resetDatacenterListWebsiteOnlyForTest();
  assert.equal(getDatacenterListWebsiteOnly(), DEFAULT_DATACENTER_WEBSITE_ONLY);
  assert.equal(hydrateDatacenterListWebsiteOnly(storage), true);
  assert.equal(getDatacenterListWebsiteOnly(), true);
  assert.equal(writeDatacenterListWebsiteOnly(false, storage), true);
  assert.equal(storage.getItem(DATACENTER_WEBSITE_ONLY_STORAGE_KEY), '0');
  assert.equal(readDatacenterListWebsiteOnly(memoryStorage(storage.snapshot())), false);
  assert.equal(Object.keys(storage.snapshot()).join(','), DATACENTER_WEBSITE_ONLY_STORAGE_KEY);
  assert.equal(datacenterWebsiteOnlyChipModel(false).params.dcWebsiteOnly, true);
  assert.equal(datacenterWebsiteOnlyChipModel(true).params.dcWebsiteOnly, false);
  assert.equal(datacenterWebsiteOnlyChipModel(false).active, false);
  assert.equal(datacenterWebsiteOnlyChipModel(true).active, true);
  assert.equal(datacenterWebsiteOnlyChipModel(false).label, 'Website only');

  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['local-datacenters'], undefined);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=d'));
  assert.equal(omitted.options['local-datacenters'], undefined);

  const state = normalizeLayerState({
    enabledLayerIds: ['local-datacenters'],
    options: { 'local-datacenters': { dcWebsiteOnly: true } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /dcWebsiteOnly|d\.w\.|websiteOnly/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['local-datacenters'], undefined);
  assert.equal(getDatacenterListWebsiteOnly(), true, 'coordinator-style restore of enabled-only keeps the chip');
  resetDatacenterListWebsiteOnlyForTest();
});

test('hosted list applies Website only from getListPayload session state', () => {
  resetDatacenterListWebsiteOnlyForTest();
  const doc = fakeDocument();
  const root = fakeNode('div');
  const items = fakeNode('div');
  items.ownerDocument = doc;
  const count = fakeNode('output');
  setDatacenterListWebsiteOnly(false, { persist: false });
  const binder = bindDatacenterInViewList({
    root,
    items,
    count,
    getEnabled: () => true,
    getRecords: () => [TAGGED_EQUINIX, NO_WEBSITE, LONDON],
    getView: () => AUSTIN_VIEW,
    flyTo() {},
  });
  const offIds = binder.sites().map((site) => site.id);
  assert.deepEqual(offIds, [TAGGED_EQUINIX.id, NO_WEBSITE.id]);

  setDatacenterListWebsiteOnly(true, { persist: false });
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), [TAGGED_EQUINIX.id]);

  setDatacenterListWebsiteOnly(false, { persist: false });
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), offIds);
  binder.destroy();
  resetDatacenterListWebsiteOnlyForTest();
});

test('distinct from Plan 193 hide-no-operator, Plan 206 operator chips, and Plan 270 Named only', () => {
  const helper = src('src/data/datacenterListWebsiteFilter.js');
  const list = src('src/data/datacenterList.js');
  const named = src('src/data/datacenterListNamedFilter.js');
  const operator = src('src/data/datacenterListOperatorFilter.js');
  const layer = src('src/data/localGeojson.js');
  const layerState = src('src/data/layerState.js');
  const markup = src('index.html');
  const ui = src('src/ui.js');
  const firstRun = src('src/firstRunExperience.js');
  const sharelink = src('src/sharelink.js');
  const css = src('style.css');
  const license = src('LICENSE');
  const readme = src('README.md');

  assert.equal(existsSync(path.join(ROOT, 'src/data/datacenterOperatorFilter.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/datacenters/website.js')), false);
  assert.doesNotMatch(helper, /\bfetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.match(helper, /meridian\.dcWebsiteOnly/);
  assert.match(helper, /meridian\.datacenterHideNoOperator/);
  assert.match(helper, /meridian\.dcOperator/);
  assert.match(helper, /meridian\.dcNamedOnly/);
  assert.doesNotMatch(helper, /Hide no operator/);
  assert.doesNotMatch(helper, /dcOperator:|setDatacenterListOperator/);
  assert.doesNotMatch(helper, /setDatacenterListNamedOnly|dcNamedOnly:/);
  assert.match(list, /datacenterMatchesWebsiteFilter|filterDatacentersByWebsiteOnly/);
  assert.match(list, /datacenterMatchesNamedFilter/);
  assert.match(list, /datacenterMatchesListOperator/);
  assert.ok(
    list.indexOf('datacenterMatchesNamedFilter') < list.indexOf('datacenterMatchesWebsiteFilter'),
    'Website only ANDs after the Plan 270 Named only matcher',
  );
  assert.ok(
    list.indexOf('datacenterMatchesListOperator') < list.indexOf('datacenterMatchesNamedFilter'),
    'Named only still ANDs after the Plan 206 operator matcher',
  );
  assert.doesNotMatch(named, /dcWebsiteOnly|datacenterListWebsiteFilter|Website only/);
  assert.doesNotMatch(operator, /dcWebsiteOnly|datacenterListWebsiteFilter|Website only/);
  assert.doesNotMatch(layer, /datacenterListWebsiteFilter|dcWebsiteOnly|meridian\.dcWebsiteOnly/);
  assert.doesNotMatch(layerState, /dcWebsiteOnly|meridian\.dcWebsiteOnly/);
  const panel = markup.match(/<div id="datacenter-in-view"[\s\S]*?<p class="in-view-site-list-credit"/);
  assert.ok(panel, 'datacenter-in-view markup is missing');
  assert.match(panel[0], /id="datacenter-operator-chips"/);
  assert.match(panel[0], /id="datacenter-named-chips"/);
  assert.match(panel[0], /id="datacenter-website-chips"/);
  assert.match(panel[0], /data-dc-named="only"[^>]*>Named only</);
  assert.match(panel[0], /data-dc-website="only"[^>]*>Website only</);
  assert.ok(
    panel[0].indexOf('id="datacenter-named-chips"') < panel[0].indexOf('id="datacenter-website-chips"'),
    'Website only sits after the Plan 270 Named only chip',
  );
  assert.ok(
    panel[0].indexOf('id="datacenter-website-chips"') < panel[0].indexOf('id="datacenter-in-view-items"'),
    'Website only sits above the in-view items',
  );
  assert.match(markup, /DATACENTERS IN VIEW/);
  assert.match(ui, /setDatacenterListWebsiteOnly|hydrateDatacenterListWebsiteOnly/);
  assert.match(ui, /data-dc-website/);
  assert.match(ui, /_initDatacenterWebsiteChip/);
  assert.doesNotMatch(ui, /hideNoOperator|Hide no operator/);
  const websiteChipFn = ui.slice(ui.indexOf('_syncDatacenterWebsiteChip() {'));
  assert.match(websiteChipFn, /data-dc-website/);
  assert.doesNotMatch(
    websiteChipFn.slice(0, websiteChipFn.indexOf('_initFullscreenButton')),
    /getRowControls/,
  );
  assert.match(css, /datacenter-website-chip/);
  assert.match(firstRun, /meridian\.dcWebsiteOnly/);
  const firstRunFn = firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun'));
  assert.doesNotMatch(firstRunFn, /setDatacenterListWebsiteOnly|writeDatacenterListWebsiteOnly|hydrateDatacenterListWebsiteOnly/);
  assert.doesNotMatch(sharelink, /dcWebsiteOnly|meridian\.dcWebsiteOnly/);
  assert.doesNotMatch(helper, /google\.com\/news|telegeography|quantum-earth|OpenSky/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /Meridian is an \*\*independent commercial product\*\*/);
  assert.match(src('index.html'), /<title>Meridian<\/title>/);
  assert.doesNotMatch(src('index.html'), /God.s Eye View branding/i);

  const localDiff = execSync(
    'git diff -- HEAD -- src/data/localGeojson.js src/data/datacenterListOperatorFilter.js src/data/datacenterListNamedFilter.js',
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  assert.equal(localDiff, '', 'Plan 285 must not edit localGeojson.js, Plan 206, or Plan 270');
});
