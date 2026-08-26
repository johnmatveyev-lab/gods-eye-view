// PLAN 258 — AIS Hide no last pos toggle. Client-only filter of
// already-fetched AISStream rows. Distinct from 153 type / 157 parked /
// 162 min-speed / 170 dest / 175 hide-no-dest / 180 unnamed / 189 IMO /
// 200 last-pos (fail-open when both missing) / 237 heading / 246
// hide-no-type / 254 hide-no-speed. Presence-only, fail-closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AIS_HIDE_NO_LAST_POS_CHIP_LABEL,
  AIS_HIDE_NO_LAST_POS_CHIP_TITLE,
  AIS_HIDE_NO_LAST_POS_STORAGE_KEY,
  DEFAULT_AIS_HIDE_NO_LAST_POS,
  aisHideNoLastPosChipModel,
  filterVesselsByHideNoLastPos,
  normalizeAisHideNoLastPos,
  readAisHideNoLastPos,
  vesselHasLastPosition,
  vesselLastPositionStampMs,
  vesselMatchesHideNoLastPosFilter,
  writeAisHideNoLastPos,
} from './aisHideNoLastPosFilter.js';
import { filterVesselsByDestination } from './aisDestinationFilter.js';
import { filterVesselsByHideNoDest } from './aisHideNoDestFilter.js';
import { filterVesselsByHideNoHeading } from './aisHideNoHeadingFilter.js';
import { filterVesselsByHideNoImo } from './aisHideNoImoFilter.js';
import { filterVesselsByHideNoSpeed } from './aisHideNoSpeedFilter.js';
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
    name: 'Missing-stamp fish',
    destination: 'ROTTERDAM',
    speed: 9,
    imo: '9123400',
    heading: 45,
    course: null,
    lastPositionUtc: '',
    lastPositionEpoch: null,
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
    name: 'Utc-only cargo',
    destination: 'HAMBURG',
    speed: 10,
    imo: '9123457',
    heading: 45,
    course: 50,
    lastPositionUtc: new Date(NOW_MS - (5 * 60 * 1000)),
  },
  {
    mmsi: '7',
    type: 'Sailing',
    name: 'Invalid-utc sail',
    destination: 'HAMBURG',
    speed: 12,
    imo: '9123458',
    heading: 270,
    course: 270,
    lastPositionUtc: 'not-a-date',
    lastPositionEpoch: null,
  },
  {
    mmsi: '8',
    type: 'Cargo',
    name: 'Stale cargo',
    destination: 'ROTTERDAM',
    speed: 11,
    imo: '9123459',
    heading: 10,
    course: null,
    lastPositionEpoch: NOW_SEC - (3 * 60 * 60),
  },
  {
    mmsi: '9',
    type: 'Sailing',
    name: 'ISO-utc sail',
    destination: 'HAMBURG',
    speed: 7,
    imo: '9123460',
    heading: 200,
    course: null,
    lastPositionUtc: new Date(NOW_MS - (6 * 60 * 1000)).toISOString(),
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

test('off keeps missing both timestamps', () => {
  assert.equal(DEFAULT_AIS_HIDE_NO_LAST_POS, false);
  assert.equal(AIS_HIDE_NO_LAST_POS_CHIP_LABEL, 'Hide no last pos');
  assert.equal(AIS_HIDE_NO_LAST_POS_CHIP_TITLE, 'Hide vessels with no last position');
  assert.equal(AIS_HIDE_NO_LAST_POS_STORAGE_KEY, 'meridian.aisHideNoLastPos');
  assert.equal(normalizeAisHideNoLastPos(undefined), false);
  assert.equal(normalizeAisHideNoLastPos(null), false);
  assert.equal(normalizeAisHideNoLastPos(''), false);
  assert.equal(normalizeAisHideNoLastPos(false), false);
  assert.equal(normalizeAisHideNoLastPos(0), false);
  assert.equal(normalizeAisHideNoLastPos('0'), false);
  assert.equal(normalizeAisHideNoLastPos(true), true);
  assert.equal(normalizeAisHideNoLastPos('1'), true);
  assert.equal(normalizeAisHideNoLastPos('true'), true);
  assert.equal(normalizeAisHideNoLastPos('bogus'), null);
  assert.deepEqual(
    filterVesselsByHideNoLastPos(MIXED, false).map((record) => record.mmsi),
    MIXED.map((record) => record.mmsi),
  );
  assert.deepEqual(filterVesselsByHideNoLastPos(null), []);
  assert.deepEqual(filterVesselsByHideNoLastPos(undefined), []);
  assert.equal(vesselMatchesHideNoLastPosFilter(MIXED[3], false), true);
  assert.equal(vesselMatchesHideNoLastPosFilter(MIXED[6], false), true);
  assert.equal(vesselMatchesHideNoLastPosFilter({
    mmsi: 'x',
    lastPositionUtc: '',
    lastPositionEpoch: null,
  }, false), true);
});

test('on keeps a finite epoch or parseable UTC and drops missing both', () => {
  assert.ok(Number.isFinite(vesselLastPositionStampMs(MIXED[0])));
  assert.ok(Number.isFinite(vesselLastPositionStampMs(MIXED[5])));
  assert.ok(Number.isFinite(vesselLastPositionStampMs(MIXED[8])));
  assert.equal(vesselLastPositionStampMs(MIXED[3]), null);
  assert.equal(vesselLastPositionStampMs(MIXED[6]), null);
  assert.equal(vesselLastPositionStampMs({ lastPositionEpoch: Number.NaN }), null);
  assert.equal(vesselLastPositionStampMs({ lastPositionEpoch: Number.POSITIVE_INFINITY }), null);
  assert.equal(vesselHasLastPosition(MIXED[0]), true);
  assert.equal(vesselHasLastPosition(MIXED[5]), true, 'Date lastPositionUtc stays');
  assert.equal(vesselHasLastPosition(MIXED[8]), true, 'ISO lastPositionUtc stays');
  assert.equal(vesselHasLastPosition(MIXED[3]), false);
  assert.equal(vesselHasLastPosition(MIXED[6]), false);
  assert.equal(vesselMatchesHideNoLastPosFilter(MIXED[0], true), true, 'finite epoch stays');
  assert.equal(vesselMatchesHideNoLastPosFilter(MIXED[1], true), true);
  assert.equal(vesselMatchesHideNoLastPosFilter(MIXED[5], true), true, 'parseable Date stays');
  assert.equal(vesselMatchesHideNoLastPosFilter(MIXED[8], true), true, 'parseable ISO stays');
  assert.equal(vesselMatchesHideNoLastPosFilter(MIXED[7], true), true, 'stale epoch still has a stamp');
  assert.equal(vesselMatchesHideNoLastPosFilter(MIXED[3], true), false, 'missing both fails closed');
  assert.equal(vesselMatchesHideNoLastPosFilter(MIXED[6], true), false, 'unparseable UTC fails closed');
  const kept = filterVesselsByHideNoLastPos(MIXED, true).map((record) => record.mmsi);
  assert.deepEqual(kept, ['1', '2', '3', '5', '6', '8', '9']);
  assert.ok(!kept.includes('4'), 'missing both drops');
  assert.ok(!kept.includes('7'), 'invalid UTC drops');
});

test('selected id always kept', () => {
  assert.equal(
    vesselMatchesHideNoLastPosFilter(
      { mmsi: '4', lastPositionUtc: '', lastPositionEpoch: null },
      true,
      { selectedId: '4' },
    ),
    true,
  );
  assert.deepEqual(
    filterVesselsByHideNoLastPos(MIXED, true, '4').map((record) => record.mmsi),
    ['1', '2', '3', '4', '5', '6', '8', '9'],
  );
  assert.deepEqual(
    filterVesselsByHideNoLastPos(MIXED, true, '7').map((record) => record.mmsi),
    ['1', '2', '3', '5', '6', '7', '8', '9'],
  );
});

test('invalid storage reads as off', () => {
  assert.equal(readAisHideNoLastPos(memoryStorage()), false);
  assert.equal(readAisHideNoLastPos(memoryStorage({ 'meridian.aisHideNoLastPos': '' })), false);
  assert.equal(readAisHideNoLastPos(memoryStorage({ 'meridian.aisHideNoLastPos': 'bogus' })), false);
  assert.equal(readAisHideNoLastPos(memoryStorage({ 'meridian.aisHideNoLastPos': 'yes' })), false);
  assert.equal(readAisHideNoLastPos(memoryStorage({ 'meridian.aisHideNoLastPos': '2' })), false);
  assert.equal(readAisHideNoLastPos({
    getItem() { throw new Error('storage exploded'); },
  }), false);
  assert.equal(readAisHideNoLastPos(memoryStorage({ 'meridian.aisHideNoLastPos': '1' })), true);
  assert.equal(readAisHideNoLastPos(memoryStorage({ 'meridian.aisHideNoLastPos': '0' })), false);
});

test('Hide no last pos ANDs with type, parked, min-speed, dest, hide-no-dest, unnamed, IMO, last-pos, heading, hide-no-type, and hide-no-speed', () => {
  assert.deepEqual(
    filterVesselsByLastPos(MIXED, '1h', null, { now: NOW_MS }).map((record) => record.mmsi),
    ['1', '2', '3', '4', '5', '6', '7', '9'],
    'Plan 200 last-pos 1h fail-opens missing both and drops the 3h-stale cargo',
  );
  assert.deepEqual(
    filterVesselsByHideNoLastPos(MIXED, true).map((record) => record.mmsi),
    ['1', '2', '3', '5', '6', '8', '9'],
    'Hide no last pos fail-closes missing both and keeps the stale stamp',
  );
  assert.deepEqual(
    filterVesselsByHideNoLastPos(
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
      ),
      true,
    ).map((record) => record.mmsi),
    ['2', '5', '6', '9'],
    'parked 0, null-speed ferry, missing/invalid stamps, and 3h-stale drop; 8 kt cargo, 10 kt tug, utc-only, and ISO stay',
  );
  assert.deepEqual(
    filterVesselsByHideNoLastPos(
      filterVesselsByHideNoSpeed(
        filterVesselsByHideNoType(
          filterVesselsByHideNoHeading(
            filterVesselsByLastPos(
              filterVesselsByHideNoImo(
                filterVesselsByHideUnnamed(
                  filterVesselsByHideNoDest(
                    filterVesselsByDestination(
                      filterVesselsByMinSpeed(
                        filterVesselsByParked(filterVesselsByType(MIXED, 'TCPFSO', '4'), true, '4'),
                        '10',
                        '4',
                      ),
                      '',
                      '4',
                    ),
                    true,
                    '4',
                  ),
                  true,
                  '4',
                ),
                true,
                '4',
              ),
              '15',
              '4',
              { now: NOW_MS },
            ),
            true,
            '4',
          ),
          true,
          '4',
        ),
        true,
        '4',
      ),
      true,
      '4',
    ).map((record) => record.mmsi),
    ['4', '5', '6'],
    'selected missing-stamp fish stays through type, parked, 10+, dest, unnamed, IMO, 15m, heading, hide-no-type, hide-no-speed, and Hide no last pos',
  );
});

test('helper reads last-position stamps and the chip sits on getRowControls after Hide no speed', () => {
  const helper = readFileSync(new URL('./aisHideNoLastPosFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/aisLiveVessels.js'), 'utf8');
  const flights = readFileSync(path.join(ROOT, 'src/data/flights.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.match(helper, /lastPositionEpoch|lastPositionUtc/);
  assert.match(helper, /meridian\.aisHideNoLastPos/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.doesNotMatch(helper, /hide-ground|flightHideNo|meridian\.flight/);
  assert.match(source, /lastPositionEpoch:\s*finiteNumber\(row\.last_position_epoch\)/);
  assert.match(source, /hideNoLastPos/);
  assert.match(source, /filterVesselsByHideNoLastPos|vesselMatchesHideNoLastPosFilter/);
  assert.match(source, /aisHideNoLastPosChipModel/);
  assert.match(source, /aisHideNoSpeedChipModel\(state\.hideNoSpeed\),\s*\n\s*aisHideNoLastPosChipModel/);
  assert.doesNotMatch(html, /ais-hide-no-last-pos|data-ais-hide-no-last-pos/);
  assert.doesNotMatch(ui, /ais-hide-no-last-pos|data-ais-hide-no-last-pos|_aisHideNoLastPos/);
  assert.doesNotMatch(css, /ais-hide-no-last-pos/);
  assert.doesNotMatch(layerState, /hideNoLastPos|aisHideNoLastPos/);
  assert.doesNotMatch(flights, /meridian\.aisHideNoLastPos/);
  assert.match(changelog, /meridian\.aisHideNoLastPos/);
  assert.match(changelog, /Hide no last pos/);
  assert.doesNotMatch(source, /\/api\/ais-live\/hide-no-last-pos/);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live/hide-no-last-pos.js')), false);
  assert.equal(aisHideNoLastPosChipModel(false).params.hideNoLastPos, true);
  assert.equal(aisHideNoLastPosChipModel(true).params.hideNoLastPos, false);
});

test('layer setParams hides missing-stamp vessels; selected stays; off restores; refresh keeps toggle', () => {
  _setAisRuntimeForTest({ now: () => NOW_MS, setTimeout, clearTimeout });
  primeAisRecords(MIXED, { selectedId: '4' });
  try {
    assert.equal(aisLiveVesselsLayer.getParams().hideNoLastPos, false);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      MIXED.map((record) => record.mmsi),
      'off matches the current unfiltered view',
    );

    assert.equal(aisLiveVesselsLayer.setParams({ hideNoLastPos: true }), true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoLastPos, true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '2', '3', '4', '5', '6', '8', '9'],
      'selected missing-stamp fish stays when Hide no last pos is on',
    );
    assert.equal(
      aisLiveVesselsLayer.getRowControls().chips.find((chip) => chip.id === 'hide-no-last-pos')?.active,
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
      hideNoSpeed: true,
    }), true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['2', '4', '5', '6', '9'],
      'type chips AND Hide parked AND 5+ AND dest chips AND Hide unnamed AND Hide no IMO AND 1h AND Hide no heading AND Hide no type AND Hide no speed AND Hide no last pos; selected missing-stamp fish stays',
    );

    _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: 1,
      rows: [],
    });
    assert.equal(aisLiveVesselsLayer.getParams().hideNoLastPos, true, 'feed refresh keeps the toggle');
    assert.equal(aisLiveVesselsLayer.getParams().hideNoSpeed, true);
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
    assert.equal(aisLiveVesselsLayer.setParams({ hideNoLastPos: 'nope' }), false);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoLastPos, true);

    assert.equal(aisLiveVesselsLayer.setParams({
      hideNoLastPos: false,
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
    assert.equal(aisLiveVesselsLayer.getParams().hideNoLastPos, false);
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

test('hideNoLastPos persists as meridian.aisHideNoLastPos, LayerStateCoordinator restore keeps it, and share URLs omit it', () => {
  assert.equal(AIS_HIDE_NO_LAST_POS_STORAGE_KEY, 'meridian.aisHideNoLastPos');
  const storage = memoryStorage();
  assert.equal(readAisHideNoLastPos(storage), false);
  assert.equal(writeAisHideNoLastPos(true, storage), true);
  assert.equal(storage.snapshot()['meridian.aisHideNoLastPos'], '1');
  assert.equal(readAisHideNoLastPos(storage), true);
  assert.equal(writeAisHideNoLastPos(false, storage), true);
  assert.equal(storage.snapshot()['meridian.aisHideNoLastPos'], '0');
  assert.equal(readAisHideNoLastPos(storage), false);
  assert.equal(writeAisHideNoLastPos('nope', storage), false);
  assert.equal(storage.snapshot()['meridian.aisHideNoLastPos'], '0');

  _setAisRuntimeForTest({ now: () => NOW_MS, setTimeout, clearTimeout });
  primeAisRecords(MIXED);
  try {
    assert.equal(aisLiveVesselsLayer.setParams({ hideNoLastPos: true }, { storage }), true);
    assert.equal(storage.snapshot()['meridian.aisHideNoLastPos'], '1');
    assert.equal(aisLiveVesselsLayer.getParams().hideNoLastPos, true);
    assert.equal(
      aisLiveVesselsLayer.setParams({ hideNoImo: true, hideParked: true, lastPos: '15', hideNoHeading: true, hideNoType: true, hideNoSpeed: true }),
      true,
      'LayerStateCoordinator-style restore of other AIS chips does not wipe hideNoLastPos',
    );
    assert.equal(aisLiveVesselsLayer.getParams().hideNoLastPos, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoSpeed, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoType, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoHeading, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoImo, true);
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, '15');
    _setVesselStateForTest({ enabled: true, records: [] });
    assert.equal(aisLiveVesselsLayer.getParams().hideNoLastPos, false, 'reset starts from off');
    assert.equal(
      aisLiveVesselsLayer.setParams({ hideNoLastPos: readAisHideNoLastPos(storage) }, { storage }),
      true,
    );
    assert.equal(aisLiveVesselsLayer.getParams().hideNoLastPos, true, 'flip persist survives reload');
  } finally {
    _setAisRuntimeForTest(null);
    _setVesselStateForTest({ enabled: false, records: [] });
  }

  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['ais-live-vessels'].hideNoLastPos, undefined);
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=a'));
  assert.equal(omitted.options['ais-live-vessels'].hideNoLastPos, undefined,
    'existing a links keep stamp-less vessels visible');
  const state = normalizeLayerState({
    enabledLayerIds: ['ais-live-vessels'],
    options: { 'ais-live-vessels': { hideNoLastPos: true, hideNoSpeed: true, hideNoType: true, hideNoHeading: true, hideNoImo: true } },
  });
  assert.equal(state.options['ais-live-vessels'].hideNoLastPos, undefined);
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /hideNoLastPos|a\.v\./);
  assert.equal(layerOptionsForRestore(state, 'ais-live-vessels').hideNoLastPos, undefined);
  assert.equal(layerOptionsForRestore(state, 'ais-live-vessels').hideNoImo, true);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/aisHideNoLastPosFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
