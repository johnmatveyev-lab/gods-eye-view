// PLAN 200 — AIS last-position freshness chips. Client-only filter of
// already-fetched AISStream rows. Distinct from 157 parked, 162 min-speed,
// 175 dest, 180 unnamed, 189 IMO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AIS_LAST_POS_CHIPS,
  AIS_LAST_POS_STORAGE_KEY,
  DEFAULT_AIS_LAST_POS,
  aisLastPosChipModels,
  aisLastPosMaxAgeSeconds,
  filterVesselsByLastPos,
  normalizeAisLastPos,
  readAisLastPos,
  vesselLastPositionEpochMs,
  vesselMatchesLastPosFilter,
  writeAisLastPos,
} from './aisLastPosFilter.js';
import { filterVesselsByDestination } from './aisDestinationFilter.js';
import { filterVesselsByHideNoDest } from './aisHideNoDestFilter.js';
import { filterVesselsByHideNoImo } from './aisHideNoImoFilter.js';
import { filterVesselsByHideUnnamed } from './aisHideUnnamedFilter.js';
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
    lastPositionEpoch: NOW_SEC - (2 * 60 * 60),
  },
  {
    mmsi: '2',
    type: 'Container Ship',
    name: 'Harbor cargo',
    destination: 'Rotterdam Anchorage',
    speed: 4.9,
    imo: '9321483',
    lastPositionEpoch: NOW_SEC - (8 * 60),
  },
  {
    mmsi: '3',
    type: 'Passenger/Ferry',
    name: 'Singapore ferry',
    destination: 'SINGAPORE',
    speed: 5,
    imo: '9812345',
    lastPositionEpoch: NOW_SEC - (20 * 60),
  },
  {
    mmsi: '4',
    type: 'Fishing',
    name: 'Blank IMO fish',
    destination: 'ROTTERDAM',
    speed: 9.9,
    imo: '',
    lastPositionEpoch: NOW_SEC - (90 * 60),
  },
  {
    mmsi: '5',
    type: 'Tug',
    name: 'Missing stamp tug',
    destination: 'HAMBURG',
    speed: 10,
    imo: '9123456',
  },
  {
    mmsi: '6',
    type: 'Military',
    name: 'Utc-only',
    destination: 'HAMBURG',
    speed: 16.4,
    imo: '9123457',
    lastPositionUtc: new Date(NOW_MS - (5 * 60 * 1000)),
  },
  {
    mmsi: '7',
    type: 'Sailing',
    name: 'Ms-epoch sail',
    destination: 'HAMBURG',
    speed: 12,
    imo: '9123458',
    lastPositionEpoch: NOW_MS - (4 * 60 * 1000),
  },
  {
    mmsi: '8',
    type: 'Dredger',
    name: 'Whitespace IMO',
    destination: 'ROTTERDAM',
    speed: 8,
    imo: '   ',
    lastPositionEpoch: NOW_SEC - (45 * 60),
  },
  {
    mmsi: '9',
    type: 'Pleasure Craft',
    name: 'Yacht no IMO',
    destination: 'SINGAPORE',
    speed: 11,
    imo: '',
    lastPositionUtc: '',
    lastPositionEpoch: null,
  },
]);

function primeAisRecords(records, selectedRecord = null) {
  _setVesselStateForTest({
    viewer: null,
    enabled: true,
    records: records.map((row) => ({
      ...row,
      lat: 1,
      lon: 2,
      course: null,
      heading: null,
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

function matchNow(record, windowId, extra = {}) {
  return vesselMatchesLastPosFilter(record, windowId, { now: NOW_MS, ...extra });
}

test('All is the default last-pos window and 15m / 1h are the shipped chips', () => {
  assert.equal(DEFAULT_AIS_LAST_POS, 'all');
  assert.deepEqual(AIS_LAST_POS_CHIPS.map((chip) => chip.id), ['all', '15', '1h']);
  assert.deepEqual(AIS_LAST_POS_CHIPS.map((chip) => chip.label), ['All', '15m', '1h']);
  assert.equal(aisLastPosMaxAgeSeconds('all'), null);
  assert.equal(aisLastPosMaxAgeSeconds('15'), 15 * 60);
  assert.equal(aisLastPosMaxAgeSeconds('1h'), 60 * 60);
  assert.equal(aisLastPosMaxAgeSeconds('nope'), null);
  assert.equal(normalizeAisLastPos(undefined), 'all');
  assert.equal(normalizeAisLastPos(null), 'all');
  assert.equal(normalizeAisLastPos(''), 'all');
  assert.equal(normalizeAisLastPos('all'), 'all');
  assert.equal(normalizeAisLastPos(0), 'all');
  assert.equal(normalizeAisLastPos('0'), 'all');
  assert.equal(normalizeAisLastPos(15), '15');
  assert.equal(normalizeAisLastPos('15'), '15');
  assert.equal(normalizeAisLastPos('15m'), '15');
  assert.equal(normalizeAisLastPos(60), '1h');
  assert.equal(normalizeAisLastPos('60'), '1h');
  assert.equal(normalizeAisLastPos('60m'), '1h');
  assert.equal(normalizeAisLastPos('1h'), '1h');
  assert.equal(normalizeAisLastPos('bogus'), null);
  assert.equal(normalizeAisLastPos(30), null);
  assert.deepEqual(
    filterVesselsByLastPos(MIXED, 'all', null, { now: NOW_MS }).map((record) => record.mmsi),
    MIXED.map((record) => record.mmsi),
  );
  assert.deepEqual(filterVesselsByLastPos(null), []);
  assert.deepEqual(filterVesselsByLastPos(undefined), []);
});

test('15m hides vessels older than 15 minutes; 1h hides older than 1 hour', () => {
  assert.equal(vesselLastPositionEpochMs({ lastPositionEpoch: NOW_SEC - 60 }), NOW_MS - 60_000);
  assert.equal(vesselLastPositionEpochMs({ lastPositionEpoch: NOW_MS - 60_000 }), NOW_MS - 60_000);
  assert.equal(
    vesselLastPositionEpochMs({ lastPositionUtc: new Date(NOW_MS - 90_000) }),
    NOW_MS - 90_000,
  );
  assert.equal(
    vesselLastPositionEpochMs({ lastPositionUtc: new Date(NOW_MS - 100_000).toISOString() }),
    NOW_MS - 100_000,
  );
  assert.equal(vesselLastPositionEpochMs({}), null);
  assert.equal(vesselLastPositionEpochMs({ lastPositionEpoch: null, lastPositionUtc: '' }), null);

  assert.equal(matchNow(MIXED[1], 'all'), true);
  assert.equal(matchNow(MIXED[0], 'all'), true);
  assert.equal(matchNow(MIXED[1], '15'), true, '8 minutes ago stays on 15m');
  assert.equal(matchNow(MIXED[2], '15'), false, '20 minutes ago hides on 15m');
  assert.equal(matchNow(MIXED[0], '15'), false, 'hours-old parked report hides on 15m');
  assert.equal(matchNow(MIXED[2], '1h'), true, '20 minutes ago stays on 1h');
  assert.equal(matchNow(MIXED[7], '1h'), true, '45 minutes ago stays on 1h');
  assert.equal(matchNow(MIXED[0], '1h'), false, '2 hours ago hides on 1h');
  assert.equal(matchNow(MIXED[3], '1h'), false, '90 minutes ago hides on 1h');
  assert.equal(matchNow(MIXED[4], '15'), true, 'missing both timestamps stays');
  assert.equal(matchNow(MIXED[8], '1h'), true, 'null epoch + empty utc stays');
  assert.equal(matchNow(MIXED[5], '15'), true, 'lastPositionUtc Date fallback stays when fresh');
  assert.equal(matchNow(MIXED[6], '15'), true, 'millisecond lastPositionEpoch stays when fresh');

  const fifteen = filterVesselsByLastPos(MIXED, '15', null, { now: NOW_MS })
    .map((record) => record.mmsi);
  assert.deepEqual(fifteen, ['2', '5', '6', '7', '9']);
  assert.ok(!fifteen.includes('1'));
  assert.ok(!fifteen.includes('3'));
  assert.ok(!fifteen.includes('4'));
  const hour = filterVesselsByLastPos(MIXED, '1h', null, { now: NOW_MS })
    .map((record) => record.mmsi);
  assert.deepEqual(hour, ['2', '3', '5', '6', '7', '8', '9']);
  assert.ok(!hour.includes('1'));
  assert.ok(!hour.includes('4'));
});

test('selected stale vessel stays visible when a freshness chip is on', () => {
  assert.equal(matchNow(MIXED[0], '15', { selectedId: '1' }), true);
  assert.deepEqual(
    filterVesselsByLastPos(MIXED, '15', '1', { now: NOW_MS }).map((record) => record.mmsi),
    ['1', '2', '5', '6', '7', '9'],
  );
  assert.deepEqual(
    filterVesselsByLastPos(MIXED, '1h', '4', { now: NOW_MS }).map((record) => record.mmsi),
    ['2', '3', '4', '5', '6', '7', '8', '9'],
  );
});

test('last-pos ANDs with type chips, Hide parked, min-speed, dest, Hide no dest, Hide unnamed, Hide no IMO', () => {
  const afterType = filterVesselsByType(MIXED, 'CPFSO');
  assert.deepEqual(
    afterType.map((record) => record.mmsi),
    ['2', '3', '4', '5', '6', '7', '8', '9'],
    'Tanker off hides the hours-old parked tanker before freshness runs',
  );
  assert.deepEqual(
    filterVesselsByLastPos(afterType, '15', null, { now: NOW_MS }).map((record) => record.mmsi),
    ['2', '5', '6', '7', '9'],
  );
  assert.deepEqual(
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
      '15',
      null,
      { now: NOW_MS },
    ).map((record) => record.mmsi),
    ['5', '6', '7'],
    'other AIS chips still AND; freshness then drops the 20m ferry',
  );
  assert.deepEqual(
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
    ).map((record) => record.mmsi),
    ['1', '5', '6', '7'],
    'selected stale tanker stays through type, Hide parked, 10+, dest chips, Hide unnamed, Hide no IMO, and 15m',
  );
});

test('helper reads lastPositionEpoch / lastPositionUtc and the chips sit next to AIS IMO chips', () => {
  const helper = readFileSync(new URL('./aisLastPosFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/aisLiveVessels.js'), 'utf8');
  const adapter = readFileSync(path.join(ROOT, 'src/server/liveApiProxies.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const changelog = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.match(helper, /lastPositionEpoch/);
  assert.match(helper, /lastPositionUtc/);
  assert.match(helper, /meridian\.aisLastPos/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.match(adapter, /last_position_epoch:\s*aisEpochSeconds/);
  assert.match(source, /lastPositionEpoch:\s*finiteNumber\(row\.last_position_epoch\)/);
  assert.match(source, /lastPositionUtc:\s*String\(row\.last_position_UTC/);
  assert.match(source, /lastPos/);
  assert.match(source, /filterVesselsByLastPos|vesselMatchesLastPosFilter/);
  assert.match(source, /aisLastPosChipModels/);
  assert.match(html, /id="ais-hide-no-imo-chips"/);
  assert.match(html, /id="ais-min-speed-chips"/);
  assert.doesNotMatch(html, /ais-last-pos|data-ais-last-pos/);
  assert.doesNotMatch(ui, /ais-last-pos|data-ais-last-pos|_aisLastPos/);
  assert.doesNotMatch(css, /ais-last-pos/);
  assert.doesNotMatch(layerState, /lastPos|aisLastPos/);
  assert.match(changelog, /meridian\.aisLastPos/);
  assert.match(changelog, /All \| 15m \| 1h/);
  assert.doesNotMatch(source, /\/api\/ais-live\/last-pos/);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live/last-pos.js')), false);
  assert.deepEqual(
    aisLastPosChipModels('all').map((chip) => chip.params.lastPos),
    ['all', '15', '1h'],
  );
  assert.equal(aisLastPosChipModels('15').find((chip) => chip.params.lastPos === '15')?.active, true);
  assert.equal(aisLastPosChipModels('1h').find((chip) => chip.params.lastPos === 'all')?.active, false);
});

test('layer setParams hides stale vessels; selected stays; refresh keeps the chip', () => {
  _setAisRuntimeForTest({ now: () => NOW_MS, setTimeout, clearTimeout });
  primeAisRecords(MIXED, MIXED[0]);
  try {
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, 'all');
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      MIXED.map((record) => record.mmsi),
      'All matches the current unfiltered view',
    );

    assert.equal(aisLiveVesselsLayer.setParams({ lastPos: '15' }), true);
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, '15');
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '2', '5', '6', '7', '9'],
      'selected hours-old tanker stays on 15m',
    );
    assert.equal(
      aisLiveVesselsLayer.getRowControls().chips.find((chip) => chip.id === 'last-pos-15')?.active,
      true,
    );

    assert.equal(aisLiveVesselsLayer.setParams({ lastPos: '1h' }), true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '2', '3', '5', '6', '7', '8', '9'],
      '1h is looser than 15m; selected hours-old tanker still stays',
    );

    assert.equal(aisLiveVesselsLayer.setParams({
      hideParked: true,
      vesselTypeFilter: 'CPFSO',
      minSpeed: '5',
      destination: '',
      hideNoDestination: true,
      hideUnnamed: true,
      hideNoImo: true,
    }), true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '3', '5', '6', '7'],
      'type chips AND Hide parked AND 5+ AND dest chips AND Hide unnamed AND Hide no IMO AND 1h; selected stale tanker stays',
    );

    _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: 1,
      rows: [],
    });
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, '1h', 'feed refresh keeps the chip set');
    assert.equal(aisLiveVesselsLayer.getParams().hideNoImo, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideUnnamed, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoDestination, true);
    assert.equal(aisLiveVesselsLayer.getParams().destination, '');
    assert.equal(aisLiveVesselsLayer.getParams().hideParked, true);
    assert.equal(aisLiveVesselsLayer.getParams().vesselTypeFilter, 'CPFSO');
    assert.equal(aisLiveVesselsLayer.getParams().minSpeed, '5');
    assert.equal(aisLiveVesselsLayer.setParams({ lastPos: 'nope' }), false);
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, '1h');

    assert.equal(aisLiveVesselsLayer.setParams({
      lastPos: 'all',
      hideParked: false,
      vesselTypeFilter: 'all',
      minSpeed: 'all',
      hideNoDestination: false,
      hideUnnamed: false,
      hideNoImo: false,
    }), true);
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, 'all');
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      MIXED.map((record) => record.mmsi),
      'All restores the current unfiltered view',
    );
  } finally {
    _setAisRuntimeForTest(null);
    _setVesselStateForTest({ enabled: false, records: [] });
  }
});

test('lastPos persists as meridian.aisLastPos, LayerStateCoordinator restore keeps it, and share URLs omit it', () => {
  assert.equal(AIS_LAST_POS_STORAGE_KEY, 'meridian.aisLastPos');
  const storage = memoryStorage();
  assert.equal(readAisLastPos(storage), 'all');
  assert.equal(writeAisLastPos('15', storage), '15');
  assert.equal(storage.snapshot()['meridian.aisLastPos'], '15');
  assert.equal(readAisLastPos(storage), '15');
  assert.equal(writeAisLastPos('1h', storage), '1h');
  assert.equal(storage.snapshot()['meridian.aisLastPos'], '1h');
  assert.equal(readAisLastPos(storage), '1h');
  assert.equal(writeAisLastPos('all', storage), 'all');
  assert.equal(readAisLastPos(storage), 'all');
  assert.equal(readAisLastPos(memoryStorage({ 'meridian.aisLastPos': '15' })), '15');
  assert.equal(writeAisLastPos('nope', storage), null);
  assert.equal(storage.snapshot()['meridian.aisLastPos'], 'all');

  _setAisRuntimeForTest({ now: () => NOW_MS, setTimeout, clearTimeout });
  primeAisRecords(MIXED);
  try {
    assert.equal(aisLiveVesselsLayer.setParams({ lastPos: '15' }, { storage }), true);
    assert.equal(storage.snapshot()['meridian.aisLastPos'], '15');
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, '15');
    assert.equal(
      aisLiveVesselsLayer.setParams({ hideNoImo: true, hideParked: true }),
      true,
      'LayerStateCoordinator-style restore of other AIS chips does not wipe lastPos',
    );
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, '15');
    assert.equal(aisLiveVesselsLayer.getParams().hideNoImo, true);
    _setVesselStateForTest({ enabled: true, records: [] });
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, 'all', 'reset starts from All');
    assert.equal(
      aisLiveVesselsLayer.setParams({ lastPos: readAisLastPos(storage) }, { storage }),
      true,
    );
    assert.equal(aisLiveVesselsLayer.getParams().lastPos, '15', 'flip persist survives reload');
  } finally {
    _setAisRuntimeForTest(null);
    _setVesselStateForTest({ enabled: false, records: [] });
  }

  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['ais-live-vessels'].lastPos, undefined);
  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=a'));
  assert.equal(omitted.options['ais-live-vessels'].lastPos, undefined,
    'existing a links keep every last-position age visible');
  const state = normalizeLayerState({
    enabledLayerIds: ['ais-live-vessels'],
    options: { 'ais-live-vessels': { lastPos: '15', hideNoImo: true } },
  });
  assert.equal(state.options['ais-live-vessels'].lastPos, undefined);
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.doesNotMatch(params.get('lo') || '', /lastPos|a\.l\./);
  assert.equal(layerOptionsForRestore(state, 'ais-live-vessels').lastPos, undefined);
  assert.equal(layerOptionsForRestore(state, 'ais-live-vessels').hideNoImo, true);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/aisLastPosFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
