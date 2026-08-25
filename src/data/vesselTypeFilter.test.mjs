// PLAN 153 — AIS vessel type chips. Client-only filter of already-fetched
// AISStream rows. Distinct from 65–152 (not PAGER/tsunami/military class/
// FIRMS sensor/precip).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_VESSEL_TYPE_FILTER,
  VESSEL_TYPE_CHIP_IDS,
  decodeVesselTypeFilter,
  encodeVesselTypeFilter,
  filterVesselsByType,
  normalizeVesselTypeFilter,
  toggleVesselTypeFilter,
  vesselMatchesTypeFilter,
  vesselTypeChipModels,
  vesselTypeFilterFlags,
} from './vesselTypeFilter.js';
import { vesselTypeFamily } from './vesselLabels.js';
import aisLiveVesselsLayer, {
  _applyAisFeedSnapshotForTest,
  _setVesselStateForTest,
} from './aisLiveVessels.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const MIXED = Object.freeze([
  { mmsi: '1', type: 'Crude Oil Tanker', name: 'Tanker' },
  { mmsi: '2', type: 'Container Ship', name: 'Cargo' },
  { mmsi: '3', type: 'Passenger/Ferry', name: 'Passenger' },
  { mmsi: '4', type: 'Fishing', name: 'Fishing' },
  { mmsi: '5', type: 'Tug', name: 'Service' },
  { mmsi: '6', type: '', name: 'Blank' },
  { mmsi: '7', name: 'Missing' },
  { mmsi: '8', type: 'Military', name: 'Unmatched' },
  { mmsi: '9', type: '84', name: 'Numeric tanker' },
  { mmsi: '10', type: '71', name: 'Numeric cargo' },
]);

test('type chips default all on and match the unfiltered set', () => {
  assert.deepEqual([...VESSEL_TYPE_CHIP_IDS], [
    'tanker', 'cargo', 'passenger', 'fishing', 'service', 'other',
  ]);
  assert.equal(DEFAULT_VESSEL_TYPE_FILTER, 'all');
  assert.equal(normalizeVesselTypeFilter(null), 'all');
  assert.equal(normalizeVesselTypeFilter('TCPFSO'), 'all');
  assert.deepEqual(vesselTypeFilterFlags('all'), {
    tanker: true,
    cargo: true,
    passenger: true,
    fishing: true,
    service: true,
    other: true,
  });
  assert.deepEqual(
    filterVesselsByType(MIXED, 'all').map((record) => record.mmsi),
    MIXED.map((record) => record.mmsi),
  );
});

test('Tanker off hides tankers and keeps the other families', () => {
  assert.equal(vesselTypeFamily('Crude Oil Tanker'), 'tanker');
  assert.equal(vesselTypeFamily('Container Ship'), 'cargo');
  assert.equal(vesselTypeFamily('Passenger/Ferry'), 'passenger');
  assert.equal(vesselTypeFamily('Fishing'), 'fishing');
  assert.equal(vesselTypeFamily('Tug'), 'service');
  assert.equal(vesselTypeFamily('Pilot Vessel'), 'service');
  assert.equal(vesselTypeFamily('84'), 'tanker');
  assert.equal(vesselTypeFamily('71'), 'cargo');
  assert.equal(toggleVesselTypeFilter('all', 'tanker'), 'CPFSO');
  assert.equal(toggleVesselTypeFilter('CPFSO', 'tanker'), 'all');
  assert.deepEqual(
    filterVesselsByType(MIXED, 'CPFSO').map((record) => record.mmsi),
    ['2', '3', '4', '5', '6', '7', '8', '10'],
  );
  assert.equal(vesselMatchesTypeFilter({ type: 'Crude Oil Tanker' }, 'CPFSO'), false);
  assert.equal(vesselMatchesTypeFilter({ type: 'Container Ship' }, 'CPFSO'), true);
});

test('Other off hides untyped and unmatched vessels', () => {
  assert.equal(vesselTypeFamily(''), 'other');
  assert.equal(vesselTypeFamily(null), 'other');
  assert.equal(vesselTypeFamily('Military'), 'other');
  assert.equal(vesselTypeFamily('Sailing'), 'other');
  assert.equal(vesselTypeFamily('Dredger'), 'other');
  assert.equal(toggleVesselTypeFilter('all', 'other'), 'TCPFS');
  assert.deepEqual(
    filterVesselsByType(MIXED, 'TCPFS').map((record) => record.mmsi),
    ['1', '2', '3', '4', '5', '9', '10'],
  );
  assert.equal(vesselMatchesTypeFilter({ type: '' }, 'TCPFS'), false);
  assert.equal(vesselMatchesTypeFilter({ type: 'Military' }, 'TCPFS'), false);
  assert.equal(vesselMatchesTypeFilter({ type: 'Tanker' }, 'TCPFS'), true);
  assert.equal(toggleVesselTypeFilter('O', 'other'), '0');
  assert.deepEqual(filterVesselsByType(MIXED, '0').map((record) => record.mmsi), []);
});

test('selected vessel stays when its type chip is off', () => {
  assert.equal(
    vesselMatchesTypeFilter({ mmsi: '1', type: 'Crude Oil Tanker' }, 'CPFSO', {
      selectedId: '1',
    }),
    true,
  );
  assert.deepEqual(
    filterVesselsByType(MIXED, 'CPFSO', '1').map((record) => record.mmsi),
    ['1', '2', '3', '4', '5', '6', '7', '8', '10'],
  );
  assert.deepEqual(
    filterVesselsByType(MIXED, '0', '1').map((record) => record.mmsi),
    ['1'],
  );
});

test('bogus type tokens are refused; share tokens round-trip', () => {
  assert.equal(normalizeVesselTypeFilter('bogus'), null);
  assert.equal(decodeVesselTypeFilter('xyz'), null);
  assert.equal(encodeVesselTypeFilter('all'), 'a');
  assert.equal(encodeVesselTypeFilter('CPFSO'), 'cpfso');
  assert.equal(decodeVesselTypeFilter('cpfso'), 'CPFSO');
  assert.equal(decodeVesselTypeFilter('0'), '0');
});

test('AIS layer row and Ships/AIS panel expose Tanker | Cargo | Passenger | Fishing | Service | Other', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const layer = readFileSync(path.join(ROOT, 'src/data/aisLiveVessels.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const panel = html.match(/<div[^>]*id="ais-type-chips"[\s\S]*?<\/div>/);
  assert.ok(panel, 'ais-type-chips markup is missing');
  assert.match(panel[0], /data-ais-type="tanker"[^>]*>Tanker</);
  assert.match(panel[0], /data-ais-type="cargo"[^>]*>Cargo</);
  assert.match(panel[0], /data-ais-type="passenger"[^>]*>Passenger</);
  assert.match(panel[0], /data-ais-type="fishing"[^>]*>Fishing</);
  assert.match(panel[0], /data-ais-type="service"[^>]*>Service</);
  assert.match(panel[0], /data-ais-type="other"[^>]*>Other</);
  assert.match(ui, /data-ais-type/);
  assert.match(ui, /setLayerParams\?\.\('ais-live-vessels'/);
  assert.match(ui, /ais-type-chips/);
  assert.match(layer, /vesselTypeFilter/);
  assert.match(layer, /getRowControls/);
  assert.match(layerState, /id: 'ais-live-vessels', token: 'a', disposition: 'enabled\+options'/);
  assert.match(layerState, /vesselTypeFilter/);
  assert.doesNotMatch(layer, /\/api\/ais-live\/type/);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live/type.js')), false);
  assert.doesNotMatch(layer, /OpenSky|Google News|TeleGeography|quantum-earth|God's Eye View/);
  const filterSrc = readFileSync(path.join(ROOT, 'src/data/vesselTypeFilter.js'), 'utf8');
  assert.doesNotMatch(filterSrc, /earthquakes\.js|satellites\.js|OpenSky|Google News|TeleGeography/);
  assert.equal(aisLiveVesselsLayer.setParams({ vesselTypeFilter: 'all' }), true);
  const chips = aisLiveVesselsLayer.getRowControls().chips;
  const typeChips = chips.filter((chip) => String(chip.id || '').startsWith('type-'));
  assert.deepEqual(typeChips.map((chip) => chip.label), [
    'Tanker', 'Cargo', 'Passenger', 'Fishing', 'Service', 'Other',
  ]);
  assert.ok(typeChips.every((chip) => chip.active === true));
  assert.equal(chips.find((chip) => chip.id === 'hide-parked')?.label, 'Hide parked');
  assert.deepEqual(
    chips.filter((chip) => String(chip.id || '').startsWith('min-speed-')).map((chip) => chip.label),
    ['All', '5+', '10+'],
  );
  assert.equal(vesselTypeChipModels('all')[0].params.vesselTypeFilter, 'CPFSO');
});

test('layer setParams filters in-memory vessels; selected stays; refresh keeps chips', () => {
  const records = MIXED.map((row) => ({
    ...row,
    lat: 1,
    lon: 2,
    speed: null,
    course: null,
    heading: null,
    position: { x: 1, y: 2, z: 3 },
    billboard: { position: { x: 1, y: 2, z: 3 }, show: true },
  }));
  _setVesselStateForTest({
    viewer: null,
    enabled: true,
    records,
    selectedRecord: records[0],
  });
  try {
    assert.equal(aisLiveVesselsLayer.getParams().vesselTypeFilter, 'all');
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      MIXED.map((row) => row.mmsi),
    );

    assert.equal(aisLiveVesselsLayer.setParams({ vesselTypeFilter: 'CPFSO' }), true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '2', '3', '4', '5', '6', '7', '8', '10'],
      'selected tanker stays when Tanker is off',
    );
    assert.equal(
      aisLiveVesselsLayer.getRowControls().chips.find((chip) => chip.id === 'type-tanker')?.active,
      false,
    );

    _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: 1,
      rows: [],
    });
    assert.equal(aisLiveVesselsLayer.getParams().vesselTypeFilter, 'CPFSO',
      'feed refresh keeps the chip set');
    assert.equal(aisLiveVesselsLayer.setParams({ vesselTypeFilter: 'bogus' }), false);
    assert.equal(aisLiveVesselsLayer.getParams().vesselTypeFilter, 'CPFSO');
  } finally {
    _setVesselStateForTest({ enabled: false, records: [] });
  }
});
