// PLAN 157 — Hide parked toggle. Client-only filter of already-fetched
// AISStream rows. Distinct from 129–156 (not type chips / PAGER / tsunami /
// reviewed / military class / FIRMS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AIS_HIDE_PARKED_CHIP_LABEL,
  AIS_HIDE_PARKED_CHIP_TITLE,
  AIS_PARKED_SPEED_KT,
  DEFAULT_AIS_HIDE_PARKED,
  aisHideParkedChipModel,
  filterVesselsByParked,
  normalizeAisHideParked,
  vesselIsParked,
  vesselMatchesParkedFilter,
  vesselSpeedKnots,
} from './aisParkedFilter.js';
import { filterVesselsByMinSpeed } from './aisMinSpeedFilter.js';
import { filterVesselsByType } from './vesselTypeFilter.js';
import aisLiveVesselsLayer, {
  _applyAisFeedSnapshotForTest,
  _setVesselStateForTest,
} from './aisLiveVessels.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const MIXED = Object.freeze([
  { mmsi: '1', type: 'Crude Oil Tanker', name: 'Parked tanker', speed: 0 },
  { mmsi: '2', type: 'Container Ship', name: 'Slow cargo', speed: 0.4 },
  { mmsi: '3', type: 'Passenger/Ferry', name: 'Threshold', speed: 0.5 },
  { mmsi: '4', type: 'Fishing', name: 'Moving fish', speed: 6.2 },
  { mmsi: '5', type: 'Tug', name: 'Missing speed' },
  { mmsi: '6', type: 'Military', name: 'Null speed', speed: null },
  { mmsi: '7', type: 'Sailing', name: 'NaN speed', speed: Number.NaN },
  { mmsi: '8', type: 'Dredger', name: 'Infinite', speed: Number.POSITIVE_INFINITY },
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

test('Hide parked defaults off and matches the unfiltered set', () => {
  assert.equal(DEFAULT_AIS_HIDE_PARKED, false);
  assert.equal(AIS_PARKED_SPEED_KT, 0.5);
  assert.equal(AIS_HIDE_PARKED_CHIP_LABEL, 'Hide parked');
  assert.equal(AIS_HIDE_PARKED_CHIP_TITLE, 'Hide anchored and parked vessels slower than 0.5 knots');
  assert.equal(normalizeAisHideParked(undefined), false);
  assert.equal(normalizeAisHideParked(null), false);
  assert.equal(normalizeAisHideParked(''), false);
  assert.equal(normalizeAisHideParked(false), false);
  assert.equal(normalizeAisHideParked(true), true);
  assert.equal(normalizeAisHideParked('1'), true);
  assert.equal(normalizeAisHideParked('true'), true);
  assert.equal(normalizeAisHideParked(0), false);
  assert.equal(normalizeAisHideParked('bogus'), null);
  assert.deepEqual(
    filterVesselsByParked(MIXED, false).map((record) => record.mmsi),
    MIXED.map((record) => record.mmsi),
  );
  assert.deepEqual(filterVesselsByParked(null), []);
  assert.deepEqual(filterVesselsByParked(undefined), []);
});

test('on hides finite speed under 0.5 kt and keeps missing or moving vessels', () => {
  assert.equal(vesselSpeedKnots({ speed: 0.4 }), 0.4);
  assert.equal(vesselSpeedKnots({ speed: null }), null);
  assert.equal(vesselSpeedKnots({ speed: Number.NaN }), null);
  assert.equal(vesselIsParked({ speed: 0 }), true);
  assert.equal(vesselIsParked({ speed: 0.49 }), true);
  assert.equal(vesselIsParked({ speed: 0.5 }), false);
  assert.equal(vesselIsParked({ speed: 6.2 }), false);
  assert.equal(vesselIsParked({}), false);
  const kept = filterVesselsByParked(MIXED, true).map((record) => record.mmsi);
  assert.deepEqual(kept, ['3', '4', '5', '6', '7', '8']);
  assert.ok(!kept.includes('1'));
  assert.ok(!kept.includes('2'));
  assert.equal(vesselMatchesParkedFilter({ speed: 0.2 }, true), false);
  assert.equal(vesselMatchesParkedFilter({ speed: 0.5 }, true), true);
  assert.equal(vesselMatchesParkedFilter({ speed: null }, true), true);
});

test('selected parked vessel stays visible when Hide parked is on', () => {
  assert.equal(
    vesselMatchesParkedFilter({ mmsi: '1', speed: 0 }, true, { selectedId: '1' }),
    true,
  );
  assert.deepEqual(
    filterVesselsByParked(MIXED, true, '1').map((record) => record.mmsi),
    ['1', '3', '4', '5', '6', '7', '8'],
  );
});

test('Hide parked ANDs with Plan 153 type chips', () => {
  const afterType = filterVesselsByType(MIXED, 'CPFSO');
  assert.deepEqual(
    afterType.map((record) => record.mmsi),
    ['2', '3', '4', '5', '6', '7', '8'],
    'Tanker off hides the parked tanker before Hide parked runs',
  );
  assert.deepEqual(
    filterVesselsByParked(afterType, true).map((record) => record.mmsi),
    ['3', '4', '5', '6', '7', '8'],
  );
  assert.deepEqual(
    filterVesselsByParked(filterVesselsByType(MIXED, 'CPFSO', '1'), true, '1')
      .map((record) => record.mmsi),
    ['1', '3', '4', '5', '6', '7', '8'],
    'selected parked tanker stays through both filters',
  );
  assert.deepEqual(
    filterVesselsByMinSpeed(
      filterVesselsByParked(filterVesselsByType(MIXED, 'CPFSO', '1'), true, '1'),
      '10',
      '1',
    ).map((record) => record.mmsi),
    ['1', '5', '6', '7', '8'],
    'selected parked tanker stays through type, Hide parked, and 10+',
  );
});

test('helper reads record.speed and the chip sits next to AIS type chips', () => {
  const helper = readFileSync(new URL('./aisParkedFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/aisLiveVessels.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  assert.match(helper, /record\?\.speed/);
  assert.doesNotMatch(helper, /\.sog\b|record\.knots|row\.sog/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.match(source, /hideParked/);
  assert.match(source, /filterVesselsByParked|vesselMatchesParkedFilter/);
  assert.match(html, /id="ais-parked-chips"/);
  assert.match(html, /data-ais-parked="hide"/);
  assert.match(html, /Hide parked/);
  assert.match(html, /id="ais-type-chips"/);
  assert.match(ui, /ais-parked-chips|data-ais-parked/);
  assert.match(ui, /_aisParkedChips\.hidden = !enabled/);
  assert.match(css, /ais-parked-chip/);
  assert.match(layerState, /hideParked/);
  assert.doesNotMatch(source, /\/api\/ais-live\/parked/);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live/parked.js')), false);
  assert.equal(aisHideParkedChipModel(false).params.hideParked, true);
  assert.equal(aisHideParkedChipModel(true).params.hideParked, false);
});

test('layer setParams hides parked chevrons; selected stays; refresh keeps toggle', () => {
  primeAisRecords(MIXED, MIXED[0]);
  try {
    assert.equal(aisLiveVesselsLayer.getParams().hideParked, false);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      MIXED.map((record) => record.mmsi),
    );

    assert.equal(aisLiveVesselsLayer.setParams({ hideParked: true }), true);
    assert.equal(aisLiveVesselsLayer.getParams().hideParked, true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '3', '4', '5', '6', '7', '8'],
      'selected parked tanker stays when Hide parked is on',
    );
    assert.equal(
      aisLiveVesselsLayer.getRowControls().chips.find((chip) => chip.id === 'hide-parked')?.active,
      true,
    );

    assert.equal(aisLiveVesselsLayer.setParams({ vesselTypeFilter: 'CPFSO' }), true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '3', '4', '5', '6', '7', '8'],
      'type chips AND Hide parked; selected parked tanker still stays',
    );

    _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: 1,
      rows: [],
    });
    assert.equal(aisLiveVesselsLayer.getParams().hideParked, true, 'feed refresh keeps the toggle');
    assert.equal(aisLiveVesselsLayer.getParams().vesselTypeFilter, 'CPFSO');
    assert.equal(aisLiveVesselsLayer.setParams({ hideParked: 'nope' }), false);
    assert.equal(aisLiveVesselsLayer.getParams().hideParked, true);
  } finally {
    _setVesselStateForTest({ enabled: false, records: [] });
  }
});
