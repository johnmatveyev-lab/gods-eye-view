// PLAN 237 — AIS Hide no heading toggle. Client-only filter of
// already-fetched AISStream rows. Distinct from 153 type / 157 parked /
// 162 min-speed / 170 dest / 175 hide-no-dest / 180 unnamed / 189 IMO /
// 200 last-pos. Not hide-ground. Not a clone of flights Hide no heading (234).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AIS_HIDE_NO_HEADING_CHIP_LABEL,
  AIS_HIDE_NO_HEADING_CHIP_TITLE,
  AIS_HIDE_NO_HEADING_STORAGE_KEY,
  DEFAULT_AIS_HIDE_NO_HEADING,
  aisHideNoHeadingChipModel,
  filterVesselsByHideNoHeading,
  normalizeAisHideNoHeading,
  readAisHideNoHeading,
  vesselFiniteDirection,
  vesselHasHeadingOrCourse,
  vesselMatchesHideNoHeadingFilter,
  writeAisHideNoHeading,
} from './aisHideNoHeadingFilter.js';
import { filterVesselsByDestination } from './aisDestinationFilter.js';
import { filterVesselsByHideNoDest } from './aisHideNoDestFilter.js';
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
    type: 'Crude Oil Tanker',
    name: 'Parked tanker',
    destination: 'ROTTERDAM',
    speed: 0,
    imo: '9732187',
    heading: null,
    course: null,
    lastPositionEpoch: NOW_SEC - (2 * 60 * 60),
  },
  {
    mmsi: '2',
    type: 'Container Ship',
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
    type: 'Fishing',
    name: 'Blank IMO fish',
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
    type: 'Military',
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
    type: 'Dredger',
    name: 'Whitespace IMO',
    destination: 'ROTTERDAM',
    speed: 8,
    imo: '   ',
    heading: Number.NaN,
    course: Number.POSITIVE_INFINITY,
    lastPositionEpoch: NOW_SEC - (45 * 60),
  },
  {
    mmsi: '9',
    type: 'Pleasure Craft',
    name: 'Yacht no IMO',
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

test('off keeps heading-null/course-null', () => {
  assert.equal(DEFAULT_AIS_HIDE_NO_HEADING, false);
  assert.equal(AIS_HIDE_NO_HEADING_CHIP_LABEL, 'Hide no heading');
  assert.equal(AIS_HIDE_NO_HEADING_CHIP_TITLE, 'Hide vessels with no heading or course');
  assert.equal(AIS_HIDE_NO_HEADING_STORAGE_KEY, 'meridian.aisHideNoHeading');
  assert.equal(normalizeAisHideNoHeading(undefined), false);
  assert.equal(normalizeAisHideNoHeading(null), false);
  assert.equal(normalizeAisHideNoHeading(''), false);
  assert.equal(normalizeAisHideNoHeading(false), false);
  assert.equal(normalizeAisHideNoHeading(0), false);
  assert.equal(normalizeAisHideNoHeading('0'), false);
  assert.equal(normalizeAisHideNoHeading(true), true);
  assert.equal(normalizeAisHideNoHeading('1'), true);
  assert.equal(normalizeAisHideNoHeading('true'), true);
  assert.equal(normalizeAisHideNoHeading('bogus'), null);
  assert.deepEqual(
    filterVesselsByHideNoHeading(MIXED, false).map((record) => record.mmsi),
    MIXED.map((record) => record.mmsi),
  );
  assert.deepEqual(filterVesselsByHideNoHeading(null), []);
  assert.deepEqual(filterVesselsByHideNoHeading(undefined), []);
  assert.equal(vesselMatchesHideNoHeadingFilter(MIXED[0], false), true);
  assert.equal(vesselMatchesHideNoHeadingFilter(MIXED[3], false), true);
  assert.equal(vesselMatchesHideNoHeadingFilter(MIXED[8], false), true);
  assert.equal(vesselMatchesHideNoHeadingFilter({ mmsi: 'x', heading: null, course: null }, false), true);
});

test('on keeps heading-only and course-only', () => {
  assert.equal(vesselFiniteDirection(90), 90);
  assert.equal(vesselFiniteDirection(0), 0);
  assert.equal(vesselFiniteDirection('180'), 180);
  assert.equal(vesselFiniteDirection(null), null);
  assert.equal(vesselFiniteDirection(undefined), null);
  assert.equal(vesselFiniteDirection(''), null);
  assert.equal(vesselFiniteDirection(Number.NaN), null);
  assert.equal(vesselFiniteDirection(Number.POSITIVE_INFINITY), null);
  assert.equal(vesselHasHeadingOrCourse({ heading: 90, course: null }), true);
  assert.equal(vesselHasHeadingOrCourse({ heading: null, course: 180 }), true);
  assert.equal(vesselHasHeadingOrCourse({ heading: 0, course: null }), true);
  assert.equal(vesselMatchesHideNoHeadingFilter(MIXED[1], true), true, 'heading-only stays');
  assert.equal(vesselMatchesHideNoHeadingFilter(MIXED[2], true), true, 'course-only stays');
  assert.equal(vesselMatchesHideNoHeadingFilter(MIXED[4], true), true, 'heading 0 is finite');
  assert.equal(vesselMatchesHideNoHeadingFilter(MIXED[6], true), true);
  const kept = filterVesselsByHideNoHeading(MIXED, true).map((record) => record.mmsi);
  assert.ok(kept.includes('2'), 'heading-only stays');
  assert.ok(kept.includes('3'), 'course-only stays');
  assert.ok(kept.includes('5'), 'heading 0 stays');
  assert.ok(kept.includes('6'));
  assert.ok(kept.includes('7'), 'course-only sail stays');
});

test('on drops both-null', () => {
  assert.equal(vesselHasHeadingOrCourse({ heading: null, course: null }), false);
  assert.equal(vesselHasHeadingOrCourse({}), false);
  assert.equal(vesselHasHeadingOrCourse({ heading: Number.NaN, course: Number.POSITIVE_INFINITY }), false);
  assert.equal(vesselMatchesHideNoHeadingFilter(MIXED[0], true), false);
  assert.equal(vesselMatchesHideNoHeadingFilter(MIXED[3], true), false);
  assert.equal(vesselMatchesHideNoHeadingFilter(MIXED[7], true), false);
  assert.equal(vesselMatchesHideNoHeadingFilter(MIXED[8], true), false);
  const kept = filterVesselsByHideNoHeading(MIXED, true).map((record) => record.mmsi);
  assert.deepEqual(kept, ['2', '3', '5', '6', '7']);
  assert.ok(!kept.includes('1'));
  assert.ok(!kept.includes('4'));
  assert.ok(!kept.includes('8'), 'NaN heading + Infinity course fail closed');
  assert.ok(!kept.includes('9'));
});

test('selected id always kept', () => {
  assert.equal(
    vesselMatchesHideNoHeadingFilter(
      { mmsi: '1', heading: null, course: null },
      true,
      { selectedId: '1' },
    ),
    true,
  );
  assert.deepEqual(
    filterVesselsByHideNoHeading(MIXED, true, '1').map((record) => record.mmsi),
    ['1', '2', '3', '5', '6', '7'],
  );
  assert.deepEqual(
    filterVesselsByHideNoHeading(MIXED, true, '9').map((record) => record.mmsi),
    ['2', '3', '5', '6', '7', '9'],
  );
});

test('invalid storage reads as off', () => {
  assert.equal(readAisHideNoHeading(memoryStorage()), false);
  assert.equal(readAisHideNoHeading(memoryStorage({ 'meridian.aisHideNoHeading': '' })), false);
  assert.equal(readAisHideNoHeading(memoryStorage({ 'meridian.aisHideNoHeading': 'bogus' })), false);
  assert.equal(readAisHideNoHeading(memoryStorage({ 'meridian.aisHideNoHeading': 'yes' })), false);
  assert.equal(readAisHideNoHeading(memoryStorage({ 'meridian.aisHideNoHeading': '2' })), false);
  assert.equal(readAisHideNoHeading({
    getItem() { throw new Error('storage exploded'); },
  }), false);
  assert.equal(readAisHideNoHeading(memoryStorage({ 'meridian.aisHideNoHeading': '1' })), true);
  assert.equal(readAisHideNoHeading(memoryStorage({ 'meridian.aisHideNoHeading': '0' })), false);
});

test('Hide no heading ANDs with type, parked, min-speed, dest, hide-no-dest, unnamed, IMO, and last-pos', () => {
  const afterType = filterVesselsByType(MIXED, 'CPFSO');
  assert.deepEqual(
    afterType.map((record) => record.mmsi),
    ['2', '3', '4', '5', '6', '7', '8', '9'],
    'Tanker off hides the parked tanker before Hide no heading runs',
  );
  assert.deepEqual(
    filterVesselsByHideNoHeading(afterType, true).map((record) => record.mmsi),
    ['2', '3', '5', '6', '7'],
  );
  assert.deepEqual(
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
    ).map((record) => record.mmsi),
    ['3', '5', '6', '7'],
    'parked tanker, sub-5 kt cargo, blank IMO, and heading-less rows drop; 1h keeps the 20m ferry',
  );
  assert.deepEqual(
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
    ).map((record) => record.mmsi),
    ['1', '5', '6', '7'],
    'selected heading-less tanker stays through type, parked, 10+, dest, unnamed, IMO, 15m, and Hide no heading',
  );
});

test('helper reads heading/course and the chip sits on getRowControls after last-pos', () => {
  const helper = readFileSync(new URL('./aisHideNoHeadingFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/aisLiveVessels.js'), 'utf8');
  const flights = readFileSync(path.join(ROOT, 'src/data/flights.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.match(helper, /record\?\.heading/);
  assert.match(helper, /record\?\.course/);
  assert.match(helper, /meridian\.aisHideNoHeading/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.doesNotMatch(helper, /hide-ground|flightHideNoHeading|meridian\.flightHideNoHeading/);
  assert.match(source, /heading:\s*finiteNumber\(row\.heading\)/);
  assert.match(source, /course:\s*finiteNumber\(row\.course\)/);
  assert.match(source, /hideNoHeading/);
  assert.match(source, /filterVesselsByHideNoHeading|vesselMatchesHideNoHeadingFilter/);
  assert.match(source, /aisHideNoHeadingChipModel/);
  assert.match(source, /aisLastPosChipModels\(state\.lastPos\),\s*\n\s*aisHideNoHeadingChipModel/);
  assert.doesNotMatch(html, /ais-hide-no-heading|data-ais-hide-no-heading/);
  assert.doesNotMatch(ui, /ais-hide-no-heading|data-ais-hide-no-heading|_aisHideNoHeading/);
  assert.doesNotMatch(css, /ais-hide-no-heading/);
  assert.doesNotMatch(layerState, /hideNoHeading|aisHideNoHeading/);
  assert.doesNotMatch(flights, /meridian\.aisHideNoHeading/);
  assert.match(changelog, /meridian\.aisHideNoHeading/);
  assert.match(changelog, /Hide no heading/);
  assert.doesNotMatch(source, /\/api\/ais-live\/hide-no-heading/);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live/hide-no-heading.js')), false);
  assert.equal(aisHideNoHeadingChipModel(false).params.hideNoHeading, true);
  assert.equal(aisHideNoHeadingChipModel(true).params.hideNoHeading, false);
});

test('layer setParams hides heading-less vessels; selected stays; off restores; refresh keeps toggle', () => {
  _setAisRuntimeForTest({ now: () => NOW_MS, setTimeout, clearTimeout });
  primeAisRecords(MIXED, { selectedId: '1' });
  try {
    assert.equal(aisLiveVesselsLayer.getParams().hideNoHeading, false);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      MIXED.map((record) => record.mmsi),
      'off matches the current unfiltered view',
    );

    assert.equal(aisLiveVesselsLayer.setParams({ hideNoHeading: true }), true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoHeading, true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '2', '3', '5', '6', '7'],
      'selected heading-less tanker stays when Hide no heading is on',
    );
    assert.equal(
      aisLiveVesselsLayer.getRowControls().chips.find((chip) => chip.id === 'hide-no-heading')?.active,
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
    }), true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '3', '5', '6', '7'],
      'type chips AND Hide parked AND 5+ AND dest chips AND Hide unnamed AND Hide no IMO AND 1h AND Hide no heading; selected heading-less tanker stays',
    );

    _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: 1,
      rows: [],
    });
    assert.equal(aisLiveVesselsLayer.getParams().hideNoHeading, true, 'feed refresh keeps the toggle');
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, '1h');
    assert.equal(aisLiveVesselsLayer.getParams().hideNoImo, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideUnnamed, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoDestination, true);
    assert.equal(aisLiveVesselsLayer.getParams().destination, '');
    assert.equal(aisLiveVesselsLayer.getParams().hideParked, true);
    assert.equal(aisLiveVesselsLayer.getParams().vesselTypeFilter, 'CPFSO');
    assert.equal(aisLiveVesselsLayer.getParams().minSpeed, '5');
    assert.equal(aisLiveVesselsLayer.setParams({ hideNoHeading: 'nope' }), false);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoHeading, true);

    assert.equal(aisLiveVesselsLayer.setParams({
      hideNoHeading: false,
      hideParked: false,
      vesselTypeFilter: 'all',
      minSpeed: 'all',
      hideNoDestination: false,
      hideUnnamed: false,
      hideNoImo: false,
      lastPos: 'all',
    }), true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoHeading, false);
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

test('hideNoHeading persists as meridian.aisHideNoHeading, LayerStateCoordinator restore keeps it, and share URLs omit it', () => {
  assert.equal(AIS_HIDE_NO_HEADING_STORAGE_KEY, 'meridian.aisHideNoHeading');
  const storage = memoryStorage();
  assert.equal(readAisHideNoHeading(storage), false);
  assert.equal(writeAisHideNoHeading(true, storage), true);
  assert.equal(storage.snapshot()['meridian.aisHideNoHeading'], '1');
  assert.equal(readAisHideNoHeading(storage), true);
  assert.equal(writeAisHideNoHeading(false, storage), true);
  assert.equal(storage.snapshot()['meridian.aisHideNoHeading'], '0');
  assert.equal(readAisHideNoHeading(storage), false);
  assert.equal(writeAisHideNoHeading('nope', storage), false);
  assert.equal(storage.snapshot()['meridian.aisHideNoHeading'], '0');

  _setAisRuntimeForTest({ now: () => NOW_MS, setTimeout, clearTimeout });
  primeAisRecords(MIXED);
  try {
    assert.equal(aisLiveVesselsLayer.setParams({ hideNoHeading: true }, { storage }), true);
    assert.equal(storage.snapshot()['meridian.aisHideNoHeading'], '1');
    assert.equal(aisLiveVesselsLayer.getParams().hideNoHeading, true);
    assert.equal(
      aisLiveVesselsLayer.setParams({ hideNoImo: true, hideParked: true, lastPos: '15' }),
      true,
      'LayerStateCoordinator-style restore of other AIS chips does not wipe hideNoHeading',
    );
    assert.equal(aisLiveVesselsLayer.getParams().hideNoHeading, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoImo, true);
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, '15');
    _setVesselStateForTest({ enabled: true, records: [] });
    assert.equal(aisLiveVesselsLayer.getParams().hideNoHeading, false, 'reset starts from off');
    assert.equal(
      aisLiveVesselsLayer.setParams({ hideNoHeading: readAisHideNoHeading(storage) }, { storage }),
      true,
    );
    assert.equal(aisLiveVesselsLayer.getParams().hideNoHeading, true, 'flip persist survives reload');
  } finally {
    _setAisRuntimeForTest(null);
    _setVesselStateForTest({ enabled: false, records: [] });
  }

  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['ais-live-vessels'].hideNoHeading, undefined);
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=a'));
  assert.equal(omitted.options['ais-live-vessels'].hideNoHeading, undefined,
    'existing a links keep heading-less vessels visible');
  const state = normalizeLayerState({
    enabledLayerIds: ['ais-live-vessels'],
    options: { 'ais-live-vessels': { hideNoHeading: true, hideNoImo: true } },
  });
  assert.equal(state.options['ais-live-vessels'].hideNoHeading, undefined);
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /hideNoHeading|a\.h\./);
  assert.equal(layerOptionsForRestore(state, 'ais-live-vessels').hideNoHeading, undefined);
  assert.equal(layerOptionsForRestore(state, 'ais-live-vessels').hideNoImo, true);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/aisHideNoHeadingFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
