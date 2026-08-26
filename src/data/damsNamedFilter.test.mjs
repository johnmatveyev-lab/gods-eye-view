// PLAN 218 — Dam list Named only toggle. Client-only filter of the
// already-bundled OSM / ODbL snapshot. Distinct from 205 output-floor
// and from 186/193 named/operator hides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAM_FALLBACK_LABEL,
  DAM_NAMED_ONLY_CHIP_LABEL,
  DAM_NAMED_ONLY_CHIP_TITLE,
  DAM_NAMED_ONLY_STORAGE_KEY,
  DEFAULT_DAM_NAMED_ONLY,
  damLabelIsNamed,
  damListLabel,
  damMatchesNamedFilter,
  damsNamedOnlyChipModel,
  filterDamsByNamedOnly,
  normalizeDamNamedOnly,
  readDamNamedOnly,
  writeDamNamedOnly,
} from './damsNamedFilter.js';
import { filterDamsByOutputFloor } from './damsOutputFilter.js';
import { listDamsInView } from './damsList.js';

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

const HOOVER = Object.freeze({
  id: 'dam-hoover',
  label: 'Hoover Dam',
  latitude: 30.28,
  longitude: -97.74,
  visible: true,
  output: '2080 MW',
});

const FALLBACK = Object.freeze({
  id: 'dam-fallback',
  label: 'Dam',
  latitude: 30.30,
  longitude: -97.75,
  visible: true,
  output: '14000 MW',
});

const BLANK = Object.freeze({
  id: 'dam-blank',
  label: '   ',
  latitude: 30.32,
  longitude: -97.76,
  visible: true,
  output: '100 MW',
});

const EMPTY = Object.freeze({
  id: 'dam-empty',
  label: '',
  latitude: 30.26,
  longitude: -97.73,
  visible: true,
});

const SMALL_NAMED = Object.freeze({
  id: 'dam-small',
  label: 'Podlubnik',
  latitude: 30.27,
  longitude: -97.735,
  visible: true,
  output: '330KW',
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

test('Off keeps fallback "Dam"', () => {
  assert.equal(DEFAULT_DAM_NAMED_ONLY, false);
  assert.equal(DAM_FALLBACK_LABEL, 'Dam');
  assert.equal(DAM_NAMED_ONLY_CHIP_LABEL, 'Named only');
  assert.equal(
    DAM_NAMED_ONLY_CHIP_TITLE,
    'Hide unnamed dams that only have the Dam fallback label',
  );
  assert.equal(normalizeDamNamedOnly(undefined), false);
  assert.equal(normalizeDamNamedOnly(null), false);
  assert.equal(normalizeDamNamedOnly(''), false);
  assert.equal(normalizeDamNamedOnly(false), false);
  assert.equal(normalizeDamNamedOnly(0), false);
  assert.equal(normalizeDamNamedOnly('0'), false);
  assert.equal(normalizeDamNamedOnly(true), true);
  assert.equal(normalizeDamNamedOnly('1'), true);
  assert.equal(normalizeDamNamedOnly('true'), true);
  assert.equal(normalizeDamNamedOnly('bogus'), null);

  const records = [HOOVER, FALLBACK, BLANK, EMPTY];
  assert.deepEqual(
    filterDamsByNamedOnly(records, false).map((row) => row.id),
    records.map((row) => row.id),
  );
  const listed = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    namedOnly: false,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set(records.map((row) => row.id)));
  assert.ok(listed.some((site) => site.id === FALLBACK.id && site.label === 'Dam'));
  assert.ok(listed.some((site) => site.id === BLANK.id && site.label === 'Dam'));
  assert.ok(listed.some((site) => site.id === EMPTY.id && site.label === 'Dam'));
  assert.equal(damMatchesNamedFilter(FALLBACK, false), true);
  assert.deepEqual(filterDamsByNamedOnly(null), []);
  assert.deepEqual(filterDamsByNamedOnly(undefined), []);
});

test('On drops "Dam" / blank', () => {
  assert.equal(damListLabel(FALLBACK), 'Dam');
  assert.equal(damListLabel(BLANK), 'Dam');
  assert.equal(damListLabel(EMPTY), 'Dam');
  assert.equal(damListLabel({}), 'Dam');
  assert.equal(damLabelIsNamed('Dam'), false);
  assert.equal(damLabelIsNamed(''), false);
  assert.equal(damLabelIsNamed('   '), false);
  assert.equal(damMatchesNamedFilter(FALLBACK, true), false);
  assert.equal(damMatchesNamedFilter(BLANK, true), false);
  assert.equal(damMatchesNamedFilter(EMPTY, true), false);
  assert.equal(damMatchesNamedFilter({ label: null }, true), false);

  const kept = filterDamsByNamedOnly([HOOVER, FALLBACK, BLANK, EMPTY], true);
  assert.deepEqual(kept.map((row) => row.id), [HOOVER.id]);

  const listed = listDamsInView({
    enabled: true,
    records: [HOOVER, FALLBACK, BLANK, EMPTY],
    view: AUSTIN_VIEW,
    namedOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [HOOVER.id]);
  assert.equal(listed.some((site) => site.label === 'Dam'), false);
});

test('Keeps "Hoover Dam"', () => {
  assert.equal(damLabelIsNamed('Hoover Dam'), true);
  assert.equal(damListLabel(HOOVER), 'Hoover Dam');
  assert.equal(damMatchesNamedFilter(HOOVER, true), true);
  const listed = listDamsInView({
    enabled: true,
    records: [HOOVER, FALLBACK],
    view: AUSTIN_VIEW,
    namedOnly: true,
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, HOOVER.id);
  assert.equal(listed[0].label, 'Hoover Dam');
});

test('Selected id always kept', () => {
  assert.equal(
    damMatchesNamedFilter(FALLBACK, true, { selectedId: FALLBACK.id }),
    true,
  );
  assert.deepEqual(
    filterDamsByNamedOnly([HOOVER, FALLBACK, BLANK], true, FALLBACK.id).map((row) => row.id),
    [HOOVER.id, FALLBACK.id],
  );
  const listed = listDamsInView({
    enabled: true,
    records: [HOOVER, FALLBACK, BLANK],
    view: AUSTIN_VIEW,
    namedOnly: true,
    selectedId: BLANK.id,
  });
  assert.deepEqual(new Set(listed.map((site) => site.id)), new Set([HOOVER.id, BLANK.id]));
  assert.ok(listed.some((site) => site.id === BLANK.id && site.label === 'Dam'));
});

test('Named only ANDs with Plan 205 output-floor chips after the floor', () => {
  const records = [HOOVER, FALLBACK, SMALL_NAMED, BLANK];
  const afterFloor = filterDamsByOutputFloor(records, '10');
  assert.deepEqual(
    afterFloor.map((row) => row.id),
    [HOOVER.id, FALLBACK.id, BLANK.id],
    '10+ MW hides the named sub-10 MW plant before Named only runs',
  );
  assert.deepEqual(
    filterDamsByNamedOnly(afterFloor, true).map((row) => row.id),
    [HOOVER.id],
  );

  const listed = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    outputFloor: '10',
    namedOnly: true,
  });
  assert.deepEqual(listed.map((site) => site.id), [HOOVER.id]);

  const selectedThroughAnd = listDamsInView({
    enabled: true,
    records,
    view: AUSTIN_VIEW,
    outputFloor: '10',
    namedOnly: true,
    selectedId: FALLBACK.id,
  });
  assert.deepEqual(
    new Set(selectedThroughAnd.map((site) => site.id)),
    new Set([HOOVER.id, FALLBACK.id]),
    'selected fallback Dam stays through output floor AND Named only',
  );
});

test('Invalid storage reads as off', () => {
  assert.equal(DAM_NAMED_ONLY_STORAGE_KEY, 'meridian.damNamedOnly');
  assert.equal(readDamNamedOnly(memoryStorage()), false);
  assert.equal(readDamNamedOnly(memoryStorage({ [DAM_NAMED_ONLY_STORAGE_KEY]: 'nope' })), false);
  assert.equal(readDamNamedOnly(memoryStorage({ [DAM_NAMED_ONLY_STORAGE_KEY]: 'bogus' })), false);
  assert.equal(readDamNamedOnly(memoryStorage({ [DAM_NAMED_ONLY_STORAGE_KEY]: '{}' })), false);
  assert.equal(readDamNamedOnly(memoryStorage({ [DAM_NAMED_ONLY_STORAGE_KEY]: '2' })), false);
  assert.equal(readDamNamedOnly({
    getItem() { throw new Error('blocked'); },
  }), false);
  assert.equal(writeDamNamedOnly('nope', memoryStorage()), false);
});

test('Persist flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(writeDamNamedOnly(true, storage), true);
  assert.equal(storage.getItem(DAM_NAMED_ONLY_STORAGE_KEY), '1');
  assert.equal(readDamNamedOnly(storage), true);
  const reloaded = memoryStorage(storage.snapshot());
  assert.equal(readDamNamedOnly(reloaded), true);
  assert.equal(writeDamNamedOnly(false, storage), true);
  assert.equal(storage.getItem(DAM_NAMED_ONLY_STORAGE_KEY), '0');
  assert.equal(readDamNamedOnly(memoryStorage(storage.snapshot())), false);
  assert.equal(Object.keys(storage.snapshot()).join(','), DAM_NAMED_ONLY_STORAGE_KEY);
  assert.equal(damsNamedOnlyChipModel(false).params.namedOnly, true);
  assert.equal(damsNamedOnlyChipModel(true).params.namedOnly, false);
  assert.equal(damsNamedOnlyChipModel(false).active, false);
  assert.equal(damsNamedOnlyChipModel(true).active, true);
});

test('localGeojson.js is unchanged', () => {
  const diff = execSync('git diff -- HEAD -- src/data/localGeojson.js', {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(diff, '', 'Plan 218 must not edit localGeojson.js');
  const localGeojson = src('src/data/localGeojson.js');
  assert.doesNotMatch(localGeojson, /damNamedOnly|damsNamedFilter|meridian\.damNamedOnly/);
});

test('list chip sits on the dams in-view surface; persist is local; no share-URL or /api', () => {
  const html = src('index.html');
  const ui = src('src/ui.js');
  const list = src('src/data/damsList.js');
  const helper = src('src/data/damsNamedFilter.js');
  const layerState = src('src/data/layerState.js');
  const firstRun = src('src/firstRunExperience.js');
  const sharelink = src('src/sharelink.js');
  const css = src('style.css');
  const panel = html.match(/<div id="dams-in-view"[\s\S]*?<p class="in-view-site-list-credit"/);
  assert.ok(panel, 'dams-in-view markup is missing');
  assert.match(panel[0], /id="dams-output-chips"/);
  assert.match(panel[0], /id="dams-named-chips"/);
  assert.match(panel[0], /data-dam-named="only"[^>]*>Named only</);
  assert.ok(
    panel[0].indexOf('id="dams-output-chips"') < panel[0].indexOf('id="dams-named-chips"'),
    'Named only sits next to the output-floor chips',
  );
  assert.ok(
    panel[0].indexOf('id="dams-named-chips"') < panel[0].indexOf('id="dams-in-view-items"'),
    'Named only sits above the in-view items',
  );
  assert.match(html, /id="dams-in-view"[\s\S]*?© OpenStreetMap contributors/);
  assert.match(ui, /data-dam-named/);
  assert.match(ui, /writeDamNamedOnly|readDamNamedOnly/);
  assert.match(css, /dams-named-chip/);
  assert.match(list, /damMatchesNamedFilter|filterDamsByNamedOnly|namedOnly/);
  assert.match(list, /damMeetsOutputFloor|outputFloor/);
  assert.match(helper, /meridian\.damNamedOnly/);
  assert.doesNotMatch(helper, /fetch\s*\(/);
  assert.doesNotMatch(list, /fetch\s*\(/);
  assert.doesNotMatch(helper, /\/api\/dams/);
  assert.doesNotMatch(helper, /hideNoOperator|militaryNamedOnly|hasName/);
  assert.doesNotMatch(list, /hideNoOperator|local-datacenters/);
  assert.doesNotMatch(layerState, /damNamedOnly|damsNamed/);
  assert.match(layerState, /id: 'local-dams', token: 'q', disposition: 'enabled-only'/);
  assert.match(firstRun, /meridian\.damNamedOnly/);
  assert.doesNotMatch(firstRun, /writeDamNamedOnly|setDamNamedOnly/);
  assert.doesNotMatch(sharelink, /damNamedOnly|meridian\.damNamedOnly/);
  assert.equal(existsSync(path.join(ROOT, 'api/dams.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/dams/named.js')), false);
});
