// PLAN 246 — AIS Hide no type toggle. Client-only filter of
// already-fetched AISStream rows. Distinct from 153 type / 157 parked /
// 162 min-speed / 170 dest / 175 hide-no-dest / 180 unnamed / 189 IMO /
// 200 last-pos / 237 heading. Presence-only, not a class picker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AIS_HIDE_NO_TYPE_CHIP_LABEL,
  AIS_HIDE_NO_TYPE_CHIP_TITLE,
  AIS_HIDE_NO_TYPE_STORAGE_KEY,
  DEFAULT_AIS_HIDE_NO_TYPE,
  aisHideNoTypeChipModel,
  filterVesselsByHideNoType,
  normalizeAisHideNoType,
  readAisHideNoType,
  vesselHasType,
  vesselMatchesHideNoTypeFilter,
  vesselTypeText,
  writeAisHideNoType,
} from './aisHideNoTypeFilter.js';
import { filterVesselsByDestination } from './aisDestinationFilter.js';
import { filterVesselsByHideNoDest } from './aisHideNoDestFilter.js';
import { filterVesselsByHideNoHeading } from './aisHideNoHeadingFilter.js';
import { filterVesselsByHideNoImo } from './aisHideNoImoFilter.js';
import { filterVesselsByHideUnnamed } from './aisHideUnnamedFilter.js';
import { filterVesselsByLastPos } from './aisLastPosFilter.js';
import { filterVesselsByMinSpeed } from './aisMinSpeedFilter.js';
import { filterVesselsByParked } from './aisParkedFilter.js';
import { filterVesselsByType } from './vesselTypeFilter.js';
import aisLiveVesselsLayer, {
  _applyAisFeedSnapshotForTest,
  _setAisRuntimeForTest,
  _setVesselStateForTest,
} from './aisLiveVessels.js';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
  layerOptionsForRestore,
  normalizeLayerState,
} from './layerState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOW_MS = 1_700_000_000_000;
const NOW_SEC = NOW_MS / 1000;

const MIXED = Object.freeze([
  {
    mmsi: '1',
    type: '',
    name: 'Parked untyped',
    destination: 'ROTTERDAM',
    speed: 0,
    imo: '9732187',
    heading: null,
    course: null,
    lastPositionEpoch: NOW_SEC - (2 * 60 * 60),
  },
  {
    mmsi: '2',
    type: 'Cargo',
    name: 'Harbor cargo',
    destination: 'Rotterdam Anchorage',
    speed: 4.9,
    imo: '9321483',
    heading: 90,
    course: null,
    lastPositionEpoch: NOW_SEC - (8 * 60),
  },
  {
    mmsi: '3',
    type: 'Passenger/Ferry',
    name: 'Singapore ferry',
    destination: 'SINGAPORE',
    speed: 5,
    imo: '9812345',
    heading: null,
    course: 180,
    lastPositionEpoch: NOW_SEC - (20 * 60),
  },
  {
    mmsi: '4',
    type: '   ',
    name: 'Whitespace type fish',
    destination: 'ROTTERDAM',
    speed: 9.9,
    imo: '',
    heading: null,
    course: null,
    lastPositionEpoch: NOW_SEC - (90 * 60),
  },
  {
    mmsi: '5',
    type: 'Tug',
    name: 'Missing stamp tug',
    destination: 'HAMBURG',
    speed: 10,
    imo: '9123456',
    heading: 0,
    course: null,
  },
  {
    mmsi: '6',
    name: 'Utc-only',
    destination: 'HAMBURG',
    speed: 16.4,
    imo: '9123457',
    heading: 45,
    course: 50,
    lastPositionUtc: new Date(NOW_MS - (5 * 60 * 1000)),
  },
  {
    mmsi: '7',
    type: 'Sailing',
    name: 'Ms-epoch sail',
    destination: 'HAMBURG',
    speed: 12,
    imo: '9123458',
    heading: null,
    course: 270,
    lastPositionEpoch: NOW_MS - (4 * 60 * 1000),
  },
  {
    mmsi: '8',
    type: '',
    type_specific: 'Cargo',
    name: 'Specific cargo',
    destination: 'ROTTERDAM',
    speed: 8,
    imo: '   ',
    heading: Number.NaN,
    course: Number.POSITIVE_INFINITY,
    lastPositionEpoch: NOW_SEC - (45 * 60),
  },
  {
    mmsi: '9',
    type: '',
    name: 'Yacht no type',
    destination: 'SINGAPORE',
    speed: 11,
    imo: '',
    heading: null,
    course: null,
    lastPositionUtc: '',
    lastPositionEpoch: null,
  },
]);

function primeAisRecords(records, base = {}) {
  const selectedId = base.selectedId ?? null;
  const selectedRecord = selectedId
    ? records.find((row) => row.mmsi === selectedId) || null
    : (base.selectedRecord || null);
  _setVesselStateForTest({
    viewer: null,
    enabled: true,
    records: records.map((row) => ({
      ...row,
      lat: 1,
      lon: 2,
      course: Object.hasOwn(row, 'course') ? row.course : null,
      heading: Object.hasOwn(row, 'heading') ? row.heading : null,
      lastPositionUtc: row.lastPositionUtc ?? '',
      lastPositionEpoch: row.lastPositionEpoch ?? null,
      position: { x: 1, y: 2, z: 3 },
      billboard: { position: { x: 1, y: 2, z: 3 }, show: true },
    })),
    selectedRecord,
  });
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    snapshot: () => ({ ...data }),
  };
}

test('off keeps empty type', () => {
  assert.equal(DEFAULT_AIS_HIDE_NO_TYPE, false);
  assert.equal(AIS_HIDE_NO_TYPE_CHIP_LABEL, 'Hide no type');
  assert.equal(AIS_HIDE_NO_TYPE_CHIP_TITLE, 'Hide vessels with no type');
  assert.equal(AIS_HIDE_NO_TYPE_STORAGE_KEY, 'meridian.aisHideNoType');
  assert.equal(normalizeAisHideNoType(undefined), false);
  assert.equal(normalizeAisHideNoType(null), false);
  assert.equal(normalizeAisHideNoType(''), false);
  assert.equal(normalizeAisHideNoType(false), false);
  assert.equal(normalizeAisHideNoType(0), false);
  assert.equal(normalizeAisHideNoType('0'), false);
  assert.equal(normalizeAisHideNoType(true), true);
  assert.equal(normalizeAisHideNoType('1'), true);
  assert.equal(normalizeAisHideNoType('true'), true);
  assert.equal(normalizeAisHideNoType('bogus'), null);
  assert.deepEqual(
    filterVesselsByHideNoType(MIXED, false).map((record) => record.mmsi),
    MIXED.map((record) => record.mmsi),
  );
  assert.deepEqual(filterVesselsByHideNoType(null), []);
  assert.deepEqual(filterVesselsByHideNoType(undefined), []);
  assert.equal(vesselMatchesHideNoTypeFilter(MIXED[0], false), true);
  assert.equal(vesselMatchesHideNoTypeFilter(MIXED[3], false), true);
  assert.equal(vesselMatchesHideNoTypeFilter(MIXED[5], false), true);
  assert.equal(vesselMatchesHideNoTypeFilter(MIXED[8], false), true);
  assert.equal(vesselMatchesHideNoTypeFilter({ mmsi: 'x', type: '' }, false), true);
});

test('on keeps Cargo, drops empty', () => {
  assert.equal(vesselTypeText({ type: 'Cargo' }), 'Cargo');
  assert.equal(vesselTypeText({ type_specific: 'Cargo', type: '' }), 'Cargo');
  assert.equal(vesselTypeText({ type: '   ' }), '');
  assert.equal(vesselTypeText({ type: '' }), '');
  assert.equal(vesselTypeText({ type: null }), '');
  assert.equal(vesselTypeText({}), '');
  assert.equal(vesselHasType({ type: 'Cargo' }), true);
  assert.equal(vesselHasType({ type_specific: 'Cargo', type: '' }), true);
  assert.equal(vesselHasType({ type: '' }), false);
  assert.equal(vesselHasType({ type: '   ' }), false);
  assert.equal(vesselHasType({}), false);
  assert.equal(vesselMatchesHideNoTypeFilter(MIXED[1], true), true, 'Cargo stays');
  assert.equal(vesselMatchesHideNoTypeFilter(MIXED[2], true), true);
  assert.equal(vesselMatchesHideNoTypeFilter(MIXED[4], true), true);
  assert.equal(vesselMatchesHideNoTypeFilter(MIXED[6], true), true);
  assert.equal(vesselMatchesHideNoTypeFilter(MIXED[7], true), true, 'type_specific Cargo stays');
  assert.equal(vesselMatchesHideNoTypeFilter(MIXED[0], true), false);
  assert.equal(vesselMatchesHideNoTypeFilter(MIXED[3], true), false);
  assert.equal(vesselMatchesHideNoTypeFilter(MIXED[5], true), false);
  assert.equal(vesselMatchesHideNoTypeFilter(MIXED[8], true), false);
  const kept = filterVesselsByHideNoType(MIXED, true).map((record) => record.mmsi);
  assert.deepEqual(kept, ['2', '3', '5', '7', '8']);
  assert.ok(kept.includes('2'), 'Cargo stays');
  assert.ok(kept.includes('8'), 'type_specific Cargo stays');
  assert.ok(!kept.includes('1'), 'empty type drops');
  assert.ok(!kept.includes('4'), 'whitespace-only type fails closed');
  assert.ok(!kept.includes('6'), 'missing type fails closed');
  assert.ok(!kept.includes('9'), 'empty type drops');
});

test('selected id always kept', () => {
  assert.equal(
    vesselMatchesHideNoTypeFilter(
      { mmsi: '1', type: '' },
      true,
      { selectedId: '1' },
    ),
    true,
  );
  assert.deepEqual(
    filterVesselsByHideNoType(MIXED, true, '1').map((record) => record.mmsi),
    ['1', '2', '3', '5', '7', '8'],
  );
  assert.deepEqual(
    filterVesselsByHideNoType(MIXED, true, '9').map((record) => record.mmsi),
    ['2', '3', '5', '7', '8', '9'],
  );
});

test('invalid storage reads as off', () => {
  assert.equal(readAisHideNoType(memoryStorage()), false);
  assert.equal(readAisHideNoType(memoryStorage({ 'meridian.aisHideNoType': '' })), false);
  assert.equal(readAisHideNoType(memoryStorage({ 'meridian.aisHideNoType': 'bogus' })), false);
  assert.equal(readAisHideNoType(memoryStorage({ 'meridian.aisHideNoType': 'yes' })), false);
  assert.equal(readAisHideNoType(memoryStorage({ 'meridian.aisHideNoType': '2' })), false);
  assert.equal(readAisHideNoType({
    getItem() { throw new Error('storage exploded'); },
  }), false);
  assert.equal(readAisHideNoType(memoryStorage({ 'meridian.aisHideNoType': '1' })), true);
  assert.equal(readAisHideNoType(memoryStorage({ 'meridian.aisHideNoType': '0' })), false);
});

test('Hide no type ANDs with type, parked, min-speed, dest, hide-no-dest, unnamed, IMO, last-pos, and heading', () => {
  const afterType = filterVesselsByType(MIXED, 'CPFSO');
  assert.deepEqual(
    afterType.map((record) => record.mmsi),
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    'empty type is Other; Tanker off does not drop the untyped parked row',
  );
  assert.deepEqual(
    filterVesselsByHideNoType(afterType, true).map((record) => record.mmsi),
    ['2', '3', '5', '7', '8'],
  );
  assert.deepEqual(
    filterVesselsByHideNoType(
      filterVesselsByHideNoHeading(
        filterVesselsByLastPos(
          filterVesselsByHideNoImo(
            filterVesselsByHideUnnamed(
              filterVesselsByHideNoDest(
                filterVesselsByDestination(
                  filterVesselsByMinSpeed(filterVesselsByParked(MIXED, true), '5'),
                  '',
                ),
                true,
              ),
              true,
            ),
            true,
          ),
          '1h',
          null,
          { now: NOW_MS },
        ),
        true,
      ),
      true,
    ).map((record) => record.mmsi),
    ['3', '5', '7'],
    'parked untyped, sub-5 kt cargo, blank IMO, heading-less, and untyped rows drop; 1h keeps the 20m ferry',
  );
  assert.deepEqual(
    filterVesselsByHideNoType(
      filterVesselsByHideNoHeading(
        filterVesselsByLastPos(
          filterVesselsByHideNoImo(
            filterVesselsByHideUnnamed(
              filterVesselsByHideNoDest(
                filterVesselsByDestination(
                  filterVesselsByMinSpeed(
                    filterVesselsByParked(filterVesselsByType(MIXED, 'CPFSO', '1'), true, '1'),
                    '10',
                    '1',
                  ),
                  '',
                  '1',
                ),
                true,
                '1',
              ),
              true,
              '1',
            ),
            true,
            '1',
          ),
          '15',
          '1',
          { now: NOW_MS },
        ),
        true,
        '1',
      ),
      true,
      '1',
    ).map((record) => record.mmsi),
    ['1', '5', '7'],
    'selected empty-type tanker stays through type, parked, 10+, dest, unnamed, IMO, 15m, heading, and Hide no type',
  );
});

test('helper reads type_specific || type and the chip sits on getRowControls after heading', () => {
  const helper = readFileSync(new URL('./aisHideNoTypeFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/aisLiveVessels.js'), 'utf8');
  const flights = readFileSync(path.join(ROOT, 'src/data/flights.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.match(helper, /type_specific \|\| type|record\?\.type_specific \|\| record\?\.type/);
  assert.match(helper, /meridian\.aisHideNoType/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.doesNotMatch(helper, /hide-ground|flightHideNoType|meridian\.flightHideNoType/);
  assert.match(source, /type:\s*String\(row\.type_specific \|\| row\.type \|\| ''\)/);
  assert.match(source, /hideNoType/);
  assert.match(source, /filterVesselsByHideNoType|vesselMatchesHideNoTypeFilter/);
  assert.match(source, /aisHideNoTypeChipModel/);
  assert.match(source, /aisHideNoHeadingChipModel\(state\.hideNoHeading\),\s*\n\s*aisHideNoTypeChipModel/);
  assert.doesNotMatch(html, /ais-hide-no-type|data-ais-hide-no-type/);
  assert.doesNotMatch(ui, /ais-hide-no-type|data-ais-hide-no-type|_aisHideNoType/);
  assert.doesNotMatch(css, /ais-hide-no-type/);
  assert.doesNotMatch(layerState, /hideNoType|aisHideNoType/);
  assert.doesNotMatch(flights, /meridian\.aisHideNoType/);
  assert.match(changelog, /meridian\.aisHideNoType/);
  assert.match(changelog, /Hide no type/);
  assert.doesNotMatch(source, /\/api\/ais-live\/hide-no-type/);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live/hide-no-type.js')), false);
  assert.equal(aisHideNoTypeChipModel(false).params.hideNoType, true);
  assert.equal(aisHideNoTypeChipModel(true).params.hideNoType, false);
});

test('layer setParams hides empty-type vessels; selected stays; off restores; refresh keeps toggle', () => {
  _setAisRuntimeForTest({ now: () => NOW_MS, setTimeout, clearTimeout });
  primeAisRecords(MIXED, { selectedId: '1' });
  try {
    assert.equal(aisLiveVesselsLayer.getParams().hideNoType, false);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      MIXED.map((record) => record.mmsi),
      'off matches the current unfiltered view',
    );

    assert.equal(aisLiveVesselsLayer.setParams({ hideNoType: true }), true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoType, true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '2', '3', '5', '7', '8'],
      'selected empty-type tanker stays when Hide no type is on',
    );
    assert.equal(
      aisLiveVesselsLayer.getRowControls().chips.find((chip) => chip.id === 'hide-no-type')?.active,
      true,
    );

    assert.equal(aisLiveVesselsLayer.setParams({
      hideParked: true,
      vesselTypeFilter: 'CPFSO',
      minSpeed: '5',
      destination: '',
      hideNoDestination: true,
      hideUnnamed: true,
      hideNoImo: true,
      lastPos: '1h',
      hideNoHeading: true,
    }), true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '3', '5', '7'],
      'type chips AND Hide parked AND 5+ AND dest chips AND Hide unnamed AND Hide no IMO AND 1h AND Hide no heading AND Hide no type; selected empty-type tanker stays',
    );

    _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: 1,
      rows: [],
    });
    assert.equal(aisLiveVesselsLayer.getParams().hideNoType, true, 'feed refresh keeps the toggle');
    assert.equal(aisLiveVesselsLayer.getParams().hideNoHeading, true);
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, '1h');
    assert.equal(aisLiveVesselsLayer.getParams().hideNoImo, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideUnnamed, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoDestination, true);
    assert.equal(aisLiveVesselsLayer.getParams().destination, '');
    assert.equal(aisLiveVesselsLayer.getParams().hideParked, true);
    assert.equal(aisLiveVesselsLayer.getParams().vesselTypeFilter, 'CPFSO');
    assert.equal(aisLiveVesselsLayer.getParams().minSpeed, '5');
    assert.equal(aisLiveVesselsLayer.setParams({ hideNoType: 'nope' }), false);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoType, true);

    assert.equal(aisLiveVesselsLayer.setParams({
      hideNoType: false,
      hideNoHeading: false,
      hideParked: false,
      vesselTypeFilter: 'all',
      minSpeed: 'all',
      hideNoDestination: false,
      hideUnnamed: false,
      hideNoImo: false,
      lastPos: 'all',
    }), true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoType, false);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      MIXED.map((record) => record.mmsi),
      'off restores the current unfiltered view',
    );
  } finally {
    _setAisRuntimeForTest(null);
    _setVesselStateForTest({ enabled: false, records: [] });
  }
});

test('hideNoType persists as meridian.aisHideNoType, LayerStateCoordinator restore keeps it, and share URLs omit it', () => {
  assert.equal(AIS_HIDE_NO_TYPE_STORAGE_KEY, 'meridian.aisHideNoType');
  const storage = memoryStorage();
  assert.equal(readAisHideNoType(storage), false);
  assert.equal(writeAisHideNoType(true, storage), true);
  assert.equal(storage.snapshot()['meridian.aisHideNoType'], '1');
  assert.equal(readAisHideNoType(storage), true);
  assert.equal(writeAisHideNoType(false, storage), true);
  assert.equal(storage.snapshot()['meridian.aisHideNoType'], '0');
  assert.equal(readAisHideNoType(storage), false);
  assert.equal(writeAisHideNoType('nope', storage), false);
  assert.equal(storage.snapshot()['meridian.aisHideNoType'], '0');

  _setAisRuntimeForTest({ now: () => NOW_MS, setTimeout, clearTimeout });
  primeAisRecords(MIXED);
  try {
    assert.equal(aisLiveVesselsLayer.setParams({ hideNoType: true }, { storage }), true);
    assert.equal(storage.snapshot()['meridian.aisHideNoType'], '1');
    assert.equal(aisLiveVesselsLayer.getParams().hideNoType, true);
    assert.equal(
      aisLiveVesselsLayer.setParams({ hideNoImo: true, hideParked: true, lastPos: '15', hideNoHeading: true }),
      true,
      'LayerStateCoordinator-style restore of other AIS chips does not wipe hideNoType',
    );
    assert.equal(aisLiveVesselsLayer.getParams().hideNoType, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoHeading, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoImo, true);
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, '15');
    _setVesselStateForTest({ enabled: true, records: [] });
    assert.equal(aisLiveVesselsLayer.getParams().hideNoType, false, 'reset starts from off');
    assert.equal(
      aisLiveVesselsLayer.setParams({ hideNoType: readAisHideNoType(storage) }, { storage }),
      true,
    );
    assert.equal(aisLiveVesselsLayer.getParams().hideNoType, true, 'flip persist survives reload');
  } finally {
    _setAisRuntimeForTest(null);
    _setVesselStateForTest({ enabled: false, records: [] });
  }

  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['ais-live-vessels'].hideNoType, undefined);
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=a'));
  assert.equal(omitted.options['ais-live-vessels'].hideNoType, undefined,
    'existing a links keep empty-type vessels visible');
  const state = normalizeLayerState({
    enabledLayerIds: ['ais-live-vessels'],
    options: { 'ais-live-vessels': { hideNoType: true, hideNoHeading: true, hideNoImo: true } },
  });
  assert.equal(state.options['ais-live-vessels'].hideNoType, undefined);
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /hideNoType|a\.t\./);
  assert.equal(layerOptionsForRestore(state, 'ais-live-vessels').hideNoType, undefined);
  assert.equal(layerOptionsForRestore(state, 'ais-live-vessels').hideNoImo, true);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/aisHideNoTypeFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
