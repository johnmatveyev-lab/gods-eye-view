// PLAN 270 — Datacenter list Named only toggle. Client-only filter of
// the already-bundled OSM / ODbL snapshot. Distinct from Plan 193
// hide-no-operator and Plan 206 All | AWS | Equinix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DATACENTER_FALLBACK_LABEL,
  DATACENTER_NAMED_ONLY_CHIP_LABEL,
  DATACENTER_NAMED_ONLY_CHIP_TITLE,
  DATACENTER_NAMED_ONLY_STORAGE_KEY,
  DEFAULT_DATACENTER_NAMED_ONLY,
  datacenterLabelIsNamed,
  datacenterListLabel,
  datacenterMatchesNamedFilter,
  datacenterNamedOnlyChipModel,
  filterDatacentersByNamedOnly,
  getDatacenterListNamedOnly,
  hydrateDatacenterListNamedOnly,
  normalizeDatacenterListNamedOnly,
  readDatacenterListNamedOnly,
  resetDatacenterListNamedOnlyForTest,
  setDatacenterListNamedOnly,
  subscribeDatacenterListNamedOnly,
  writeDatacenterListNamedOnly,
} from './datacenterListNamedFilter.js';
import {
  filterDatacentersByListOperator,
} from './datacenterListOperatorFilter.js';
import {
  bindDatacenterInViewList,
  listDatacentersInView,
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

const NAMED_EQUINIX = Object.freeze({
  id: 'dc-equinix-named',
  label: 'Equinix DC12',
  latitude: 30.27,
  longitude: -97.74,
  visible: true,
  tags: { name: 'Equinix DC12', operator: 'Equinix' },
});
const GENERIC = Object.freeze({
  id: 'dc-generic',
  label: 'Datacenter',
  latitude: 30.28,
  longitude: -97.73,
  visible: true,
  tags: { operator: 'Equinix' },
});
const BLANK = Object.freeze({
  id: 'dc-blank',
  label: '   ',
  latitude: 30.29,
  longitude: -97.72,
  visible: true,
});
const EMPTY = Object.freeze({
  id: 'dc-empty',
  label: '',
  latitude: 30.26,
  longitude: -97.75,
  visible: true,
});
const MISSING_LABEL = Object.freeze({
  id: 'dc-missing-label',
  latitude: 30.25,
  longitude: -97.76,
  visible: true,
});
const NAMED_AWS = Object.freeze({
  id: 'dc-aws-named',
  label: 'AWS DFW-1',
  latitude: 30.24,
  longitude: -97.77,
  visible: true,
  tags: { name: 'AWS DFW-1', 'operator:short': 'AWS', operator: 'Amazon Web Services' },
});
const GENERIC_AWS = Object.freeze({
  id: 'dc-aws-generic',
  label: 'Datacenter',
  latitude: 30.23,
  longitude: -97.71,
  visible: true,
  tags: { operator: 'Amazon Web Services' },
});
const LONDON = Object.freeze({
  id: 'dc-london',
  label: 'Equinix DC12',
  latitude: 51.5074,
  longitude: -0.1278,
  visible: true,
  tags: { operator: 'Equinix' },
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

test('Off keeps Datacenter / empty', () => {
  resetDatacenterListNamedOnlyForTest();
  assert.equal(DEFAULT_DATACENTER_NAMED_ONLY, false);
  assert.equal(DATACENTER_FALLBACK_LABEL, 'Datacenter');
  assert.equal(DATACENTER_NAMED_ONLY_CHIP_LABEL, 'Named only');
  assert.equal(
    DATACENTER_NAMED_ONLY_CHIP_TITLE,
    'Hide untitled datacenters that only have the Datacenter fallback label',
  );
  assert.equal(normalizeDatacenterListNamedOnly(undefined), false);
  assert.equal(normalizeDatacenterListNamedOnly(null), false);
  assert.equal(normalizeDatacenterListNamedOnly(''), false);
  assert.equal(normalizeDatacenterListNamedOnly(false), false);
  assert.equal(normalizeDatacenterListNamedOnly(0), false);
  assert.equal(normalizeDatacenterListNamedOnly('0'), false);
  assert.equal(normalizeDatacenterListNamedOnly(true), true);
  assert.equal(normalizeDatacenterListNamedOnly('1'), true);
  assert.equal(normalizeDatacenterListNamedOnly('true'), true);
  assert.equal(normalizeDatacenterListNamedOnly('bogus'), null);

  const records = [NAMED_EQUINIX, GENERIC, BLANK, EMPTY, MISSING_LABEL];
  assert.deepEqual(
    filterDatacentersByNamedOnly(records, false).map((row) => row.id),
    records.map((row) => row.id),
  );
  const listed = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    namedOnly: false,
  });
  assert.deepEqual(
    new Set(listed.map((site) => site.id)),
    new Set(records.map((row) => row.id)),
  );
  assert.ok(listed.some((site) => site.id === GENERIC.id && site.label === 'Datacenter'));
  assert.ok(listed.some((site) => site.id === BLANK.id && site.label === 'Datacenter'));
  assert.ok(listed.some((site) => site.id === EMPTY.id && site.label === 'Datacenter'));
  assert.ok(listed.some((site) => site.id === MISSING_LABEL.id && site.label === 'Datacenter'));
  assert.equal(datacenterMatchesNamedFilter(GENERIC, false), true);
  assert.deepEqual(filterDatacentersByNamedOnly(null), []);
  assert.deepEqual(filterDatacentersByNamedOnly(undefined), []);
});

test('On hides Datacenter / empty and keeps Equinix DC12', () => {
  assert.equal(datacenterListLabel(GENERIC), 'Datacenter');
  assert.equal(datacenterListLabel(BLANK), 'Datacenter');
  assert.equal(datacenterListLabel(EMPTY), 'Datacenter');
  assert.equal(datacenterListLabel(MISSING_LABEL), 'Datacenter');
  assert.equal(datacenterListLabel({}), 'Datacenter');
  assert.equal(datacenterLabelIsNamed('Datacenter'), false);
  assert.equal(datacenterLabelIsNamed(''), false);
  assert.equal(datacenterLabelIsNamed('   '), false);
  assert.equal(datacenterMatchesNamedFilter(GENERIC, true), false);
  assert.equal(datacenterMatchesNamedFilter(BLANK, true), false);
  assert.equal(datacenterMatchesNamedFilter(EMPTY, true), false);
  assert.equal(datacenterMatchesNamedFilter({ label: null }, true), false);
  assert.equal(datacenterLabelIsNamed('Equinix DC12'), true);
  assert.equal(datacenterListLabel(NAMED_EQUINIX), 'Equinix DC12');
  assert.equal(datacenterMatchesNamedFilter(NAMED_EQUINIX, true), true);

  const kept = filterDatacentersByNamedOnly(
    [NAMED_EQUINIX, GENERIC, BLANK, EMPTY, MISSING_LABEL],
    true,
  );
  assert.deepEqual(kept.map((row) => row.id), [NAMED_EQUINIX.id]);

  const listed = listDatacentersInView({
    enabled: true,
    records: [NAMED_EQUINIX, GENERIC, BLANK, EMPTY, MISSING_LABEL],
    view: AUSTIN_VIEW,
    namedOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [NAMED_EQUINIX.id]);
  assert.equal(listed[0].label, 'Equinix DC12');
  assert.equal(listed.some((site) => site.label === 'Datacenter'), false);
});

test('Selected id stays when it already passed the other matchers', () => {
  assert.equal(
    datacenterMatchesNamedFilter(GENERIC, true, { selectedId: GENERIC.id }),
    true,
  );
  assert.deepEqual(
    filterDatacentersByNamedOnly(
      [NAMED_EQUINIX, GENERIC, BLANK],
      true,
      GENERIC.id,
    ).map((row) => row.id),
    [NAMED_EQUINIX.id, GENERIC.id],
  );
  const listed = listDatacentersInView({
    enabled: true,
    records: [NAMED_EQUINIX, GENERIC, BLANK],
    view: AUSTIN_VIEW,
    namedOnly: true,
    selectedId: BLANK.id,
  });
  assert.deepEqual(
    new Set(listed.map((site) => site.id)),
    new Set([NAMED_EQUINIX.id, BLANK.id]),
  );
  assert.ok(listed.some((site) => site.id === BLANK.id && site.label === 'Datacenter'));

  const outOfViewSelected = listDatacentersInView({
    enabled: true,
    records: [NAMED_EQUINIX, LONDON],
    view: AUSTIN_VIEW,
    namedOnly: true,
    selectedId: LONDON.id,
  });
  assert.deepEqual(outOfViewSelected.map((site) => site.id), [NAMED_EQUINIX.id]);
});

test('Named only ANDs with Plan 206 All | AWS | Equinix after the operator matcher', () => {
  const records = [NAMED_EQUINIX, GENERIC, NAMED_AWS, GENERIC_AWS, BLANK];
  const afterEquinix = filterDatacentersByListOperator(records, 'equinix');
  assert.deepEqual(
    afterEquinix.map((row) => row.id),
    [NAMED_EQUINIX.id, GENERIC.id],
    'Equinix keeps named + generic Equinix rows before Named only runs',
  );
  assert.deepEqual(
    filterDatacentersByNamedOnly(afterEquinix, true).map((row) => row.id),
    [NAMED_EQUINIX.id],
  );

  const allNamed = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'all',
    namedOnly: true,
  });
  assert.deepEqual(allNamed.map((site) => site.id).sort(), [
    NAMED_AWS.id,
    NAMED_EQUINIX.id,
  ]);

  const equinixNamed = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'equinix',
    namedOnly: true,
  });
  assert.deepEqual(equinixNamed.map((site) => site.id), [NAMED_EQUINIX.id]);

  const awsNamed = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'aws',
    namedOnly: true,
  });
  assert.deepEqual(awsNamed.map((site) => site.id), [NAMED_AWS.id]);

  const selectedThroughAnd = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'equinix',
    namedOnly: true,
    selectedId: GENERIC.id,
  });
  assert.deepEqual(
    new Set(selectedThroughAnd.map((site) => site.id)),
    new Set([NAMED_EQUINIX.id, GENERIC.id]),
    'selected generic Equinix stays through operator AND Named only',
  );

  const selectedFailedOperator = listDatacentersInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    operatorFilter: 'aws',
    namedOnly: true,
    selectedId: GENERIC.id,
  });
  assert.deepEqual(
    selectedFailedOperator.map((site) => site.id),
    [NAMED_AWS.id],
    'selected Equinix generic does not stay when AWS already dropped it',
  );
});

test('Invalid / corrupt storage reads as off', () => {
  assert.equal(DATACENTER_NAMED_ONLY_STORAGE_KEY, 'meridian.dcNamedOnly');
  assert.equal(readDatacenterListNamedOnly(memoryStorage()), false);
  assert.equal(readDatacenterListNamedOnly(memoryStorage({
    [DATACENTER_NAMED_ONLY_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readDatacenterListNamedOnly(memoryStorage({
    [DATACENTER_NAMED_ONLY_STORAGE_KEY]: 'bogus',
  })), false);
  assert.equal(readDatacenterListNamedOnly(memoryStorage({
    [DATACENTER_NAMED_ONLY_STORAGE_KEY]: '{}',
  })), false);
  assert.equal(readDatacenterListNamedOnly(memoryStorage({
    [DATACENTER_NAMED_ONLY_STORAGE_KEY]: '2',
  })), false);
  assert.equal(readDatacenterListNamedOnly({
    getItem() { throw new Error('blocked'); },
  }), false);
  assert.equal(writeDatacenterListNamedOnly('nope', memoryStorage()), false);
});

test('Persist / hydrate survives reload; no share-URL write', () => {
  resetDatacenterListNamedOnlyForTest();
  const storage = memoryStorage();
  assert.equal(writeDatacenterListNamedOnly(true, storage), true);
  assert.equal(storage.getItem(DATACENTER_NAMED_ONLY_STORAGE_KEY), '1');
  assert.equal(readDatacenterListNamedOnly(storage), true);
  const reloaded = memoryStorage(storage.snapshot());
  assert.equal(readDatacenterListNamedOnly(reloaded), true);
  assert.equal(setDatacenterListNamedOnly(true, { storage }), true);
  assert.equal(getDatacenterListNamedOnly(), true);
  const seen = [];
  const unsubscribe = subscribeDatacenterListNamedOnly((value) => { seen.push(value); });
  assert.equal(setDatacenterListNamedOnly(false, { persist: false }), false);
  assert.deepEqual(seen, [false]);
  unsubscribe();

  resetDatacenterListNamedOnlyForTest();
  assert.equal(getDatacenterListNamedOnly(), DEFAULT_DATACENTER_NAMED_ONLY);
  assert.equal(hydrateDatacenterListNamedOnly(storage), true);
  assert.equal(getDatacenterListNamedOnly(), true);
  assert.equal(writeDatacenterListNamedOnly(false, storage), true);
  assert.equal(storage.getItem(DATACENTER_NAMED_ONLY_STORAGE_KEY), '0');
  assert.equal(readDatacenterListNamedOnly(memoryStorage(storage.snapshot())), false);
  assert.equal(Object.keys(storage.snapshot()).join(','), DATACENTER_NAMED_ONLY_STORAGE_KEY);
  assert.equal(datacenterNamedOnlyChipModel(false).params.dcNamedOnly, true);
  assert.equal(datacenterNamedOnlyChipModel(true).params.dcNamedOnly, false);
  assert.equal(datacenterNamedOnlyChipModel(false).active, false);
  assert.equal(datacenterNamedOnlyChipModel(true).active, true);
  assert.equal(datacenterNamedOnlyChipModel(false).label, 'Named only');

  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['local-datacenters'], undefined);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=d'));
  assert.equal(omitted.options['local-datacenters'], undefined);

  const state = normalizeLayerState({
    enabledLayerIds: ['local-datacenters'],
    options: { 'local-datacenters': { dcNamedOnly: true } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /dcNamedOnly|d\.n\.|namedOnly/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['local-datacenters'], undefined);
  assert.equal(getDatacenterListNamedOnly(), true, 'coordinator-style restore of enabled-only keeps the chip');
  resetDatacenterListNamedOnlyForTest();
});

test('hosted list applies Named only from getListPayload session state', () => {
  resetDatacenterListNamedOnlyForTest();
  const doc = fakeDocument();
  const root = fakeNode('div');
  const items = fakeNode('div');
  items.ownerDocument = doc;
  const count = fakeNode('output');
  setDatacenterListNamedOnly(false, { persist: false });
  const binder = bindDatacenterInViewList({
    root,
    items,
    count,
    getEnabled: () => true,
    getRecords: () => [NAMED_EQUINIX, GENERIC, LONDON],
    getView: () => AUSTIN_VIEW,
    flyTo() {},
  });
  const offIds = binder.sites().map((site) => site.id);
  assert.deepEqual(offIds, [NAMED_EQUINIX.id, GENERIC.id]);

  setDatacenterListNamedOnly(true, { persist: false });
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), [NAMED_EQUINIX.id]);

  setDatacenterListNamedOnly(false, { persist: false });
  binder.refresh();
  assert.deepEqual(binder.sites().map((site) => site.id), offIds);
  binder.destroy();
  resetDatacenterListNamedOnlyForTest();
});

test('distinct from Plan 193 hide-no-operator and Plan 206 operator chips', () => {
  const helper = src('src/data/datacenterListNamedFilter.js');
  const list = src('src/data/datacenterList.js');
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
  assert.equal(existsSync(path.join(ROOT, 'api/datacenters/named.js')), false);
  assert.doesNotMatch(helper, /\bfetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.match(helper, /meridian\.dcNamedOnly/);
  assert.match(helper, /meridian\.datacenterHideNoOperator/);
  assert.match(helper, /meridian\.dcOperator/);
  assert.doesNotMatch(helper, /Hide no operator/);
  assert.doesNotMatch(helper, /dcOperator:|setDatacenterListOperator/);
  assert.match(list, /datacenterMatchesNamedFilter|filterDatacentersByNamedOnly/);
  assert.match(list, /datacenterMatchesListOperator/);
  assert.ok(
    list.indexOf('datacenterMatchesListOperator') < list.indexOf('datacenterMatchesNamedFilter'),
    'Named only ANDs after the Plan 206 operator matcher',
  );
  assert.doesNotMatch(operator, /dcNamedOnly|datacenterListNamedFilter|Named only/);
  assert.doesNotMatch(layer, /datacenterListNamedFilter|dcNamedOnly|meridian\.dcNamedOnly/);
  assert.doesNotMatch(layerState, /dcNamedOnly|meridian\.dcNamedOnly/);
  const panel = markup.match(/<div id="datacenter-in-view"[\s\S]*?<p class="in-view-site-list-credit"/);
  assert.ok(panel, 'datacenter-in-view markup is missing');
  assert.match(panel[0], /id="datacenter-operator-chips"/);
  assert.match(panel[0], /id="datacenter-named-chips"/);
  assert.match(panel[0], /data-dc-named="only"[^>]*>Named only</);
  assert.ok(
    panel[0].indexOf('id="datacenter-operator-chips"') < panel[0].indexOf('id="datacenter-named-chips"'),
    'Named only sits after the Plan 206 operator chips',
  );
  assert.ok(
    panel[0].indexOf('id="datacenter-named-chips"') < panel[0].indexOf('id="datacenter-in-view-items"'),
    'Named only sits above the in-view items',
  );
  assert.match(markup, /DATACENTERS IN VIEW/);
  assert.match(ui, /setDatacenterListNamedOnly|hydrateDatacenterListNamedOnly/);
  assert.match(ui, /data-dc-named/);
  assert.doesNotMatch(ui, /hideNoOperator|Hide no operator/);
  assert.match(css, /datacenter-named-chip/);
  assert.match(firstRun, /meridian\.dcNamedOnly/);
  const firstRunFn = firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun'));
  assert.doesNotMatch(firstRunFn, /setDatacenterListNamedOnly|writeDatacenterListNamedOnly|hydrateDatacenterListNamedOnly/);
  assert.doesNotMatch(sharelink, /dcNamedOnly|meridian\.dcNamedOnly/);
  assert.doesNotMatch(helper, /google\.com\/news|telegeography|quantum-earth|OpenSky/i);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /Meridian is an \*\*independent commercial product\*\*/);
  assert.match(src('index.html'), /<title>Meridian<\/title>/);
  assert.doesNotMatch(src('index.html'), /God.s Eye View branding/i);

  const localDiff = execSync('git diff -- HEAD -- src/data/localGeojson.js src/data/datacenterListOperatorFilter.js', {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(localDiff, '', 'Plan 270 must not edit localGeojson.js or Plan 206');
});
