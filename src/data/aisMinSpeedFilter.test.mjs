// PLAN 162 — AIS min-speed chips. Client-only filter of already-fetched
// AISStream rows. Distinct from 129–161 (not type chips / Hide parked /
// PAGER / reviewed / FIRMS / bike min-docks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AIS_MIN_SPEED_CHIPS,
  DEFAULT_AIS_MIN_SPEED,
  aisMinSpeedChipModels,
  aisMinSpeedFloor,
  filterVesselsByMinSpeed,
  normalizeAisMinSpeed,
  vesselMatchesMinSpeedFilter,
  vesselSpeedKnots,
} from './aisMinSpeedFilter.js';
import { filterVesselsByParked } from './aisParkedFilter.js';
import { filterVesselsByType } from './vesselTypeFilter.js';
import aisLiveVesselsLayer, {
  _applyAisFeedSnapshotForTest,
  _setVesselStateForTest,
} from './aisLiveVessels.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const MIXED = Object.freeze([
  { mmsi: '1', type: 'Crude Oil Tanker', name: 'Parked tanker', speed: 0 },
  { mmsi: '2', type: 'Container Ship', name: 'Harbor cargo', speed: 4.9 },
  { mmsi: '3', type: 'Passenger/Ferry', name: 'Five-knot ferry', speed: 5 },
  { mmsi: '4', type: 'Fishing', name: 'Coastal fish', speed: 9.9 },
  { mmsi: '5', type: 'Tug', name: 'Ten-knot tug', speed: 10 },
  { mmsi: '6', type: 'Military', name: 'Transit', speed: 16.4 },
  { mmsi: '7', type: 'Sailing', name: 'Missing speed' },
  { mmsi: '8', type: 'Dredger', name: 'Null speed', speed: null },
  { mmsi: '9', type: 'Pilot', name: 'NaN speed', speed: Number.NaN },
  { mmsi: '10', type: 'Yacht', name: 'Infinite', speed: Number.POSITIVE_INFINITY },
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
      position: { x: 1, y: 2, z: 3 },
      billboard: { position: { x: 1, y: 2, z: 3 }, show: true },
    })),
    selectedRecord,
  });
}

test('All is the default min-speed floor and 5+ / 10+ are the shipped chips', () => {
  assert.equal(DEFAULT_AIS_MIN_SPEED, 'all');
  assert.deepEqual(AIS_MIN_SPEED_CHIPS.map((chip) => chip.id), ['all', '5', '10']);
  assert.deepEqual(AIS_MIN_SPEED_CHIPS.map((chip) => chip.label), ['All', '5+', '10+']);
  assert.equal(aisMinSpeedFloor('all'), 0);
  assert.equal(aisMinSpeedFloor('5'), 5);
  assert.equal(aisMinSpeedFloor('10'), 10);
  assert.equal(aisMinSpeedFloor('nope'), 0);
  assert.equal(normalizeAisMinSpeed(undefined), 'all');
  assert.equal(normalizeAisMinSpeed(null), 'all');
  assert.equal(normalizeAisMinSpeed(''), 'all');
  assert.equal(normalizeAisMinSpeed('all'), 'all');
  assert.equal(normalizeAisMinSpeed(0), 'all');
  assert.equal(normalizeAisMinSpeed('0'), 'all');
  assert.equal(normalizeAisMinSpeed(5), '5');
  assert.equal(normalizeAisMinSpeed('5'), '5');
  assert.equal(normalizeAisMinSpeed(10), '10');
  assert.equal(normalizeAisMinSpeed('10'), '10');
  assert.equal(normalizeAisMinSpeed('bogus'), null);
  assert.equal(normalizeAisMinSpeed(7), null);
  assert.deepEqual(
    filterVesselsByMinSpeed(MIXED, 'all').map((record) => record.mmsi),
    MIXED.map((record) => record.mmsi),
  );
  assert.deepEqual(filterVesselsByMinSpeed(null), []);
  assert.deepEqual(filterVesselsByMinSpeed(undefined), []);
});

test('5+ hides finite speed under 5 kt; 10+ is stricter; missing speed stays', () => {
  assert.equal(vesselSpeedKnots({ speed: 4.9 }), 4.9);
  assert.equal(vesselSpeedKnots({ speed: null }), null);
  assert.equal(vesselSpeedKnots({ speed: Number.NaN }), null);
  assert.equal(vesselMatchesMinSpeedFilter({ speed: 0 }, 'all'), true);
  assert.equal(vesselMatchesMinSpeedFilter({ speed: 4.9 }, '5'), false);
  assert.equal(vesselMatchesMinSpeedFilter({ speed: 5 }, '5'), true);
  assert.equal(vesselMatchesMinSpeedFilter({ speed: 9.9 }, '5'), true);
  assert.equal(vesselMatchesMinSpeedFilter({ speed: 9.9 }, '10'), false, '10+ is stricter than 5+');
  assert.equal(vesselMatchesMinSpeedFilter({ speed: 10 }, '10'), true);
  assert.equal(vesselMatchesMinSpeedFilter({ speed: null }, '10'), true);
  assert.equal(vesselMatchesMinSpeedFilter({}, '5'), true);
  const five = filterVesselsByMinSpeed(MIXED, '5').map((record) => record.mmsi);
  assert.deepEqual(five, ['3', '4', '5', '6', '7', '8', '9', '10']);
  assert.ok(!five.includes('1'));
  assert.ok(!five.includes('2'));
  const ten = filterVesselsByMinSpeed(MIXED, '10').map((record) => record.mmsi);
  assert.deepEqual(ten, ['5', '6', '7', '8', '9', '10']);
  assert.ok(!ten.includes('3'));
  assert.ok(!ten.includes('4'));
});

test('selected slow vessel stays visible when a floor is on', () => {
  assert.equal(
    vesselMatchesMinSpeedFilter({ mmsi: '1', speed: 0 }, '5', { selectedId: '1' }),
    true,
  );
  assert.deepEqual(
    filterVesselsByMinSpeed(MIXED, '5', '1').map((record) => record.mmsi),
    ['1', '3', '4', '5', '6', '7', '8', '9', '10'],
  );
  assert.deepEqual(
    filterVesselsByMinSpeed(MIXED, '10', '2').map((record) => record.mmsi),
    ['2', '5', '6', '7', '8', '9', '10'],
  );
});

test('min-speed ANDs with Plan 153 type chips and Plan 157 Hide parked', () => {
  const afterType = filterVesselsByType(MIXED, 'CPFSO');
  assert.deepEqual(
    afterType.map((record) => record.mmsi),
    ['2', '3', '4', '5', '6', '7', '8', '9', '10'],
    'Tanker off hides the parked tanker before the speed floor runs',
  );
  assert.deepEqual(
    filterVesselsByMinSpeed(afterType, '5').map((record) => record.mmsi),
    ['3', '4', '5', '6', '7', '8', '9', '10'],
  );
  const parkedThenSpeed = filterVesselsByMinSpeed(
    filterVesselsByParked(MIXED, true),
    '5',
  ).map((record) => record.mmsi);
  assert.deepEqual(parkedThenSpeed, ['3', '4', '5', '6', '7', '8', '9', '10']);
  assert.deepEqual(
    filterVesselsByMinSpeed(
      filterVesselsByParked(filterVesselsByType(MIXED, 'CPFSO', '1'), true, '1'),
      '10',
      '1',
    ).map((record) => record.mmsi),
    ['1', '5', '6', '7', '8', '9', '10'],
    'selected parked tanker stays through type, Hide parked, and 10+',
  );
});

test('helper reads record.speed and the chips sit next to AIS type / parked chips', () => {
  const helper = readFileSync(new URL('./aisMinSpeedFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/aisLiveVessels.js'), 'utf8');
  const adapter = readFileSync(path.join(ROOT, 'src/server/liveApiProxies.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  assert.match(helper, /record\?\.speed/);
  assert.doesNotMatch(helper, /\.sog\b|record\.knots|row\.sog/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.match(adapter, /speed:\s*numberValue\(message\.Sog\s*\?\?\s*message\.SOG\)/);
  assert.match(source, /speed:\s*finiteNumber\(row\.speed\)/);
  assert.match(source, /minSpeed/);
  assert.match(source, /filterVesselsByMinSpeed|vesselMatchesMinSpeedFilter/);
  assert.match(html, /id="ais-min-speed-chips"/);
  assert.match(html, /data-ais-min-speed="all"[^>]*>All</);
  assert.match(html, /data-ais-min-speed="5"[^>]*>5\+</);
  assert.match(html, /data-ais-min-speed="10"[^>]*>10\+</);
  assert.match(html, /id="ais-type-chips"/);
  assert.match(html, /id="ais-parked-chips"/);
  assert.match(ui, /ais-min-speed-chips|data-ais-min-speed/);
  assert.match(ui, /_aisMinSpeedChips\.hidden = !enabled/);
  assert.match(css, /ais-min-speed-chip/);
  assert.match(layerState, /minSpeed/);
  assert.doesNotMatch(source, /\/api\/ais-live\/min-speed/);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live/min-speed.js')), false);
  assert.deepEqual(
    aisMinSpeedChipModels('all').map((chip) => chip.params.minSpeed),
    ['all', '5', '10'],
  );
  assert.equal(aisMinSpeedChipModels('5').find((chip) => chip.params.minSpeed === '5')?.active, true);
  assert.equal(aisMinSpeedChipModels('10').find((chip) => chip.params.minSpeed === 'all')?.active, false);
});

test('layer setParams hides slow vessels; selected stays; refresh keeps the floor', () => {
  primeAisRecords(MIXED, MIXED[0]);
  try {
    assert.equal(aisLiveVesselsLayer.getParams().minSpeed, 'all');
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      MIXED.map((record) => record.mmsi),
      'All matches the current unfiltered view',
    );

    assert.equal(aisLiveVesselsLayer.setParams({ minSpeed: '5' }), true);
    assert.equal(aisLiveVesselsLayer.getParams().minSpeed, '5');
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '3', '4', '5', '6', '7', '8', '9', '10'],
      'selected parked tanker stays on 5+',
    );
    assert.equal(
      aisLiveVesselsLayer.getRowControls().chips.find((chip) => chip.id === 'min-speed-5')?.active,
      true,
    );

    assert.equal(aisLiveVesselsLayer.setParams({ minSpeed: '10' }), true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '5', '6', '7', '8', '9', '10'],
      '10+ is stricter; selected parked tanker still stays',
    );

    assert.equal(aisLiveVesselsLayer.setParams({ hideParked: true, vesselTypeFilter: 'CPFSO' }), true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '5', '6', '7', '8', '9', '10'],
      'type chips AND Hide parked AND 10+; selected parked tanker still stays',
    );

    _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: 1,
      rows: [],
    });
    assert.equal(aisLiveVesselsLayer.getParams().minSpeed, '10', 'feed refresh keeps the floor');
    assert.equal(aisLiveVesselsLayer.getParams().hideParked, true);
    assert.equal(aisLiveVesselsLayer.getParams().vesselTypeFilter, 'CPFSO');
    assert.equal(aisLiveVesselsLayer.setParams({ minSpeed: 'nope' }), false);
    assert.equal(aisLiveVesselsLayer.getParams().minSpeed, '10');
  } finally {
    _setVesselStateForTest({ enabled: false, records: [] });
  }
});
