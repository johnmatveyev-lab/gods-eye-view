// PLAN 254 — AIS Hide no speed toggle. Client-only filter of
// already-fetched AISStream rows. Distinct from 153 type / 157 parked /
// 162 min-speed / 170 dest / 175 hide-no-dest / 180 unnamed / 189 IMO /
// 200 last-pos / 237 heading / 246 hide-no-type. Presence-only, not a
// floor. 0 stays (parked, not missing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AIS_HIDE_NO_SPEED_CHIP_LABEL,
  AIS_HIDE_NO_SPEED_CHIP_TITLE,
  AIS_HIDE_NO_SPEED_STORAGE_KEY,
  DEFAULT_AIS_HIDE_NO_SPEED,
  aisHideNoSpeedChipModel,
  filterVesselsByHideNoSpeed,
  normalizeAisHideNoSpeed,
  readAisHideNoSpeed,
  vesselHasFiniteSpeed,
  vesselMatchesHideNoSpeedFilter,
  vesselSpeedKnots,
  writeAisHideNoSpeed,
} from './aisHideNoSpeedFilter.js';
import { filterVesselsByDestination } from './aisDestinationFilter.js';
import { filterVesselsByHideNoDest } from './aisHideNoDestFilter.js';
import { filterVesselsByHideNoHeading } from './aisHideNoHeadingFilter.js';
import { filterVesselsByHideNoImo } from './aisHideNoImoFilter.js';
import { filterVesselsByHideNoType } from './aisHideNoTypeFilter.js';
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
    type: 'Tanker',
    name: 'Parked tanker',
    destination: 'ROTTERDAM',
    speed: 0,
    imo: '9732187',
    heading: 90,
    course: null,
    lastPositionEpoch: NOW_SEC - (2 * 60),
  },
  {
    mmsi: '2',
    type: 'Cargo',
    name: 'Harbor cargo',
    destination: 'Rotterdam Anchorage',
    speed: 8,
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
    speed: null,
    imo: '9812345',
    heading: 180,
    course: 180,
    lastPositionEpoch: NOW_SEC - (20 * 60),
  },
  {
    mmsi: '4',
    type: 'Fishing',
    name: 'Missing-speed fish',
    destination: 'ROTTERDAM',
    imo: '9123400',
    heading: 45,
    course: null,
    lastPositionEpoch: NOW_SEC - (10 * 60),
  },
  {
    mmsi: '5',
    type: 'Tug',
    name: 'Moving tug',
    destination: 'HAMBURG',
    speed: 10,
    imo: '9123456',
    heading: 0,
    course: null,
    lastPositionEpoch: NOW_SEC - (4 * 60),
  },
  {
    mmsi: '6',
    type: 'Cargo',
    name: 'NaN speed cargo',
    destination: 'HAMBURG',
    speed: Number.NaN,
    imo: '9123457',
    heading: 45,
    course: 50,
    lastPositionEpoch: NOW_SEC - (5 * 60),
  },
  {
    mmsi: '7',
    type: 'Sailing',
    name: 'Infinite speed sail',
    destination: 'HAMBURG',
    speed: Number.POSITIVE_INFINITY,
    imo: '9123458',
    heading: 270,
    course: 270,
    lastPositionEpoch: NOW_SEC - (4 * 60),
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

test('off keeps null speed', () => {
  assert.equal(DEFAULT_AIS_HIDE_NO_SPEED, false);
  assert.equal(AIS_HIDE_NO_SPEED_CHIP_LABEL, 'Hide no speed');
  assert.equal(AIS_HIDE_NO_SPEED_CHIP_TITLE, 'Hide vessels with no speed');
  assert.equal(AIS_HIDE_NO_SPEED_STORAGE_KEY, 'meridian.aisHideNoSpeed');
  assert.equal(normalizeAisHideNoSpeed(undefined), false);
  assert.equal(normalizeAisHideNoSpeed(null), false);
  assert.equal(normalizeAisHideNoSpeed(''), false);
  assert.equal(normalizeAisHideNoSpeed(false), false);
  assert.equal(normalizeAisHideNoSpeed(0), false);
  assert.equal(normalizeAisHideNoSpeed('0'), false);
  assert.equal(normalizeAisHideNoSpeed(true), true);
  assert.equal(normalizeAisHideNoSpeed('1'), true);
  assert.equal(normalizeAisHideNoSpeed('true'), true);
  assert.equal(normalizeAisHideNoSpeed('bogus'), null);
  assert.deepEqual(
    filterVesselsByHideNoSpeed(MIXED, false).map((record) => record.mmsi),
    MIXED.map((record) => record.mmsi),
  );
  assert.deepEqual(filterVesselsByHideNoSpeed(null), []);
  assert.deepEqual(filterVesselsByHideNoSpeed(undefined), []);
  assert.equal(vesselMatchesHideNoSpeedFilter(MIXED[2], false), true);
  assert.equal(vesselMatchesHideNoSpeedFilter(MIXED[3], false), true);
  assert.equal(vesselMatchesHideNoSpeedFilter(MIXED[5], false), true);
  assert.equal(vesselMatchesHideNoSpeedFilter({ mmsi: 'x', speed: null }, false), true);
});

test('on keeps 0 and 8 kt, drops null', () => {
  assert.equal(vesselSpeedKnots({ speed: 0 }), 0);
  assert.equal(vesselSpeedKnots({ speed: 8 }), 8);
  assert.equal(vesselSpeedKnots({ speed: null }), null);
  assert.equal(vesselSpeedKnots({}), null);
  assert.equal(vesselSpeedKnots({ speed: Number.NaN }), null);
  assert.equal(vesselSpeedKnots({ speed: Number.POSITIVE_INFINITY }), null);
  assert.equal(vesselHasFiniteSpeed({ speed: 0 }), true);
  assert.equal(vesselHasFiniteSpeed({ speed: 8 }), true);
  assert.equal(vesselHasFiniteSpeed({ speed: null }), false);
  assert.equal(vesselHasFiniteSpeed({}), false);
  assert.equal(vesselHasFiniteSpeed({ speed: Number.NaN }), false);
  assert.equal(vesselMatchesHideNoSpeedFilter(MIXED[0], true), true, '0 stays — parked, not missing');
  assert.equal(vesselMatchesHideNoSpeedFilter(MIXED[1], true), true, '8 kt stays');
  assert.equal(vesselMatchesHideNoSpeedFilter(MIXED[4], true), true);
  assert.equal(vesselMatchesHideNoSpeedFilter(MIXED[2], true), false, 'null speed drops');
  assert.equal(vesselMatchesHideNoSpeedFilter(MIXED[3], true), false, 'missing speed fails closed');
  assert.equal(vesselMatchesHideNoSpeedFilter(MIXED[5], true), false, 'NaN fails closed');
  assert.equal(vesselMatchesHideNoSpeedFilter(MIXED[6], true), false, 'Infinity fails closed');
  const kept = filterVesselsByHideNoSpeed(MIXED, true).map((record) => record.mmsi);
  assert.deepEqual(kept, ['1', '2', '5']);
  assert.ok(kept.includes('1'), '0 stays');
  assert.ok(kept.includes('2'), '8 kt stays');
  assert.ok(!kept.includes('3'), 'null speed drops');
});

test('selected id always kept', () => {
  assert.equal(
    vesselMatchesHideNoSpeedFilter(
      { mmsi: '3', speed: null },
      true,
      { selectedId: '3' },
    ),
    true,
  );
  assert.deepEqual(
    filterVesselsByHideNoSpeed(MIXED, true, '3').map((record) => record.mmsi),
    ['1', '2', '3', '5'],
  );
  assert.deepEqual(
    filterVesselsByHideNoSpeed(MIXED, true, '4').map((record) => record.mmsi),
    ['1', '2', '4', '5'],
  );
});

test('invalid storage reads as off', () => {
  assert.equal(readAisHideNoSpeed(memoryStorage()), false);
  assert.equal(readAisHideNoSpeed(memoryStorage({ 'meridian.aisHideNoSpeed': '' })), false);
  assert.equal(readAisHideNoSpeed(memoryStorage({ 'meridian.aisHideNoSpeed': 'bogus' })), false);
  assert.equal(readAisHideNoSpeed(memoryStorage({ 'meridian.aisHideNoSpeed': 'yes' })), false);
  assert.equal(readAisHideNoSpeed(memoryStorage({ 'meridian.aisHideNoSpeed': '2' })), false);
  assert.equal(readAisHideNoSpeed({
    getItem() { throw new Error('storage exploded'); },
  }), false);
  assert.equal(readAisHideNoSpeed(memoryStorage({ 'meridian.aisHideNoSpeed': '1' })), true);
  assert.equal(readAisHideNoSpeed(memoryStorage({ 'meridian.aisHideNoSpeed': '0' })), false);
});

test('Hide no speed ANDs with type, parked, min-speed, dest, hide-no-dest, unnamed, IMO, last-pos, heading, and hide-no-type', () => {
  assert.deepEqual(
    filterVesselsByMinSpeed(MIXED, '5').map((record) => record.mmsi),
    ['2', '3', '4', '5', '6', '7'],
    'min-speed 5+ fails open on missing / non-finite; Hide no speed is not that floor',
  );
  assert.deepEqual(
    filterVesselsByHideNoSpeed(filterVesselsByMinSpeed(MIXED, '5'), true).map((record) => record.mmsi),
    ['2', '5'],
    'Hide no speed then drops the fail-open missing-speed rows; 0 already left on the 5+ floor',
  );
  assert.deepEqual(
    filterVesselsByParked(MIXED, true).map((record) => record.mmsi),
    ['2', '3', '4', '5', '6', '7'],
    'Hide parked drops 0; Hide no speed would have kept it',
  );
  assert.deepEqual(
    filterVesselsByHideNoSpeed(
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
      ),
      true,
    ).map((record) => record.mmsi),
    ['2', '5'],
    'parked 0, null-speed ferry, missing/NaN/Infinity drop; 8 kt cargo and 10 kt tug stay',
  );
  assert.deepEqual(
    filterVesselsByHideNoSpeed(
      filterVesselsByHideNoType(
        filterVesselsByHideNoHeading(
          filterVesselsByLastPos(
            filterVesselsByHideNoImo(
              filterVesselsByHideUnnamed(
                filterVesselsByHideNoDest(
                  filterVesselsByDestination(
                    filterVesselsByMinSpeed(
                      filterVesselsByParked(filterVesselsByType(MIXED, 'TCPFSO', '3'), true, '3'),
                      '10',
                      '3',
                    ),
                    '',
                    '3',
                  ),
                  true,
                  '3',
                ),
                true,
                '3',
              ),
              true,
              '3',
            ),
            '15',
            '3',
            { now: NOW_MS },
          ),
          true,
          '3',
        ),
        true,
        '3',
      ),
      true,
      '3',
    ).map((record) => record.mmsi),
    ['3', '5'],
    'selected null-speed ferry stays through type, parked, 10+, dest, unnamed, IMO, 15m, heading, hide-no-type, and Hide no speed',
  );
});

test('helper reads record.speed and the chip sits on getRowControls after Hide no type', () => {
  const helper = readFileSync(new URL('./aisHideNoSpeedFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/aisLiveVessels.js'), 'utf8');
  const flights = readFileSync(path.join(ROOT, 'src/data/flights.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.match(helper, /record\?\.speed|Number\.isFinite\(speed\)/);
  assert.match(helper, /meridian\.aisHideNoSpeed/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.doesNotMatch(helper, /hide-ground|flightHideNo|meridian\.flight/);
  assert.match(source, /speed:\s*finiteNumber\(row\.speed\)/);
  assert.match(source, /hideNoSpeed/);
  assert.match(source, /filterVesselsByHideNoSpeed|vesselMatchesHideNoSpeedFilter/);
  assert.match(source, /aisHideNoSpeedChipModel/);
  assert.match(source, /aisHideNoTypeChipModel\(state\.hideNoType\),\s*\n\s*aisHideNoSpeedChipModel/);
  assert.doesNotMatch(html, /ais-hide-no-speed|data-ais-hide-no-speed/);
  assert.doesNotMatch(ui, /ais-hide-no-speed|data-ais-hide-no-speed|_aisHideNoSpeed/);
  assert.doesNotMatch(css, /ais-hide-no-speed/);
  assert.doesNotMatch(layerState, /hideNoSpeed|aisHideNoSpeed/);
  assert.doesNotMatch(flights, /meridian\.aisHideNoSpeed/);
  assert.match(changelog, /meridian\.aisHideNoSpeed/);
  assert.match(changelog, /Hide no speed/);
  assert.doesNotMatch(source, /\/api\/ais-live\/hide-no-speed/);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live/hide-no-speed.js')), false);
  assert.equal(aisHideNoSpeedChipModel(false).params.hideNoSpeed, true);
  assert.equal(aisHideNoSpeedChipModel(true).params.hideNoSpeed, false);
});

test('layer setParams hides missing-speed vessels; selected stays; off restores; refresh keeps toggle', () => {
  _setAisRuntimeForTest({ now: () => NOW_MS, setTimeout, clearTimeout });
  primeAisRecords(MIXED, { selectedId: '3' });
  try {
    assert.equal(aisLiveVesselsLayer.getParams().hideNoSpeed, false);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      MIXED.map((record) => record.mmsi),
      'off matches the current unfiltered view',
    );

    assert.equal(aisLiveVesselsLayer.setParams({ hideNoSpeed: true }), true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoSpeed, true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '2', '3', '5'],
      'selected null-speed ferry stays when Hide no speed is on',
    );
    assert.equal(
      aisLiveVesselsLayer.getRowControls().chips.find((chip) => chip.id === 'hide-no-speed')?.active,
      true,
    );

    assert.equal(aisLiveVesselsLayer.setParams({
      hideParked: true,
      vesselTypeFilter: 'TCPFSO',
      minSpeed: '5',
      destination: '',
      hideNoDestination: true,
      hideUnnamed: true,
      hideNoImo: true,
      lastPos: '1h',
      hideNoHeading: true,
      hideNoType: true,
    }), true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['2', '3', '5'],
      'type chips AND Hide parked AND 5+ AND dest chips AND Hide unnamed AND Hide no IMO AND 1h AND Hide no heading AND Hide no type AND Hide no speed; selected null-speed ferry stays',
    );

    _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: 1,
      rows: [],
    });
    assert.equal(aisLiveVesselsLayer.getParams().hideNoSpeed, true, 'feed refresh keeps the toggle');
    assert.equal(aisLiveVesselsLayer.getParams().hideNoType, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoHeading, true);
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, '1h');
    assert.equal(aisLiveVesselsLayer.getParams().hideNoImo, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideUnnamed, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoDestination, true);
    assert.equal(aisLiveVesselsLayer.getParams().destination, '');
    assert.equal(aisLiveVesselsLayer.getParams().hideParked, true);
    assert.equal(aisLiveVesselsLayer.getParams().vesselTypeFilter, 'all');
    assert.equal(aisLiveVesselsLayer.getParams().minSpeed, '5');
    assert.equal(aisLiveVesselsLayer.setParams({ hideNoSpeed: 'nope' }), false);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoSpeed, true);

    assert.equal(aisLiveVesselsLayer.setParams({
      hideNoSpeed: false,
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
    assert.equal(aisLiveVesselsLayer.getParams().hideNoSpeed, false);
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

test('hideNoSpeed persists as meridian.aisHideNoSpeed, LayerStateCoordinator restore keeps it, and share URLs omit it', () => {
  assert.equal(AIS_HIDE_NO_SPEED_STORAGE_KEY, 'meridian.aisHideNoSpeed');
  const storage = memoryStorage();
  assert.equal(readAisHideNoSpeed(storage), false);
  assert.equal(writeAisHideNoSpeed(true, storage), true);
  assert.equal(storage.snapshot()['meridian.aisHideNoSpeed'], '1');
  assert.equal(readAisHideNoSpeed(storage), true);
  assert.equal(writeAisHideNoSpeed(false, storage), true);
  assert.equal(storage.snapshot()['meridian.aisHideNoSpeed'], '0');
  assert.equal(readAisHideNoSpeed(storage), false);
  assert.equal(writeAisHideNoSpeed('nope', storage), false);
  assert.equal(storage.snapshot()['meridian.aisHideNoSpeed'], '0');

  _setAisRuntimeForTest({ now: () => NOW_MS, setTimeout, clearTimeout });
  primeAisRecords(MIXED);
  try {
    assert.equal(aisLiveVesselsLayer.setParams({ hideNoSpeed: true }, { storage }), true);
    assert.equal(storage.snapshot()['meridian.aisHideNoSpeed'], '1');
    assert.equal(aisLiveVesselsLayer.getParams().hideNoSpeed, true);
    assert.equal(
      aisLiveVesselsLayer.setParams({ hideNoImo: true, hideParked: true, lastPos: '15', hideNoHeading: true, hideNoType: true }),
      true,
      'LayerStateCoordinator-style restore of other AIS chips does not wipe hideNoSpeed',
    );
    assert.equal(aisLiveVesselsLayer.getParams().hideNoSpeed, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoType, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoHeading, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoImo, true);
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, '15');
    _setVesselStateForTest({ enabled: true, records: [] });
    assert.equal(aisLiveVesselsLayer.getParams().hideNoSpeed, false, 'reset starts from off');
    assert.equal(
      aisLiveVesselsLayer.setParams({ hideNoSpeed: readAisHideNoSpeed(storage) }, { storage }),
      true,
    );
    assert.equal(aisLiveVesselsLayer.getParams().hideNoSpeed, true, 'flip persist survives reload');
  } finally {
    _setAisRuntimeForTest(null);
    _setVesselStateForTest({ enabled: false, records: [] });
  }

  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['ais-live-vessels'].hideNoSpeed, undefined);
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=a'));
  assert.equal(omitted.options['ais-live-vessels'].hideNoSpeed, undefined,
    'existing a links keep speed-less vessels visible');
  const state = normalizeLayerState({
    enabledLayerIds: ['ais-live-vessels'],
    options: { 'ais-live-vessels': { hideNoSpeed: true, hideNoType: true, hideNoHeading: true, hideNoImo: true } },
  });
  assert.equal(state.options['ais-live-vessels'].hideNoSpeed, undefined);
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /hideNoSpeed|a\.v\./);
  assert.equal(layerOptionsForRestore(state, 'ais-live-vessels').hideNoSpeed, undefined);
  assert.equal(layerOptionsForRestore(state, 'ais-live-vessels').hideNoImo, true);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/aisHideNoSpeedFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
