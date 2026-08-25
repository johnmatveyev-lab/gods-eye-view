// PLAN 170 — AIS destination field. Client-only filter of already-fetched
// AISStream rows. Distinct from 129–169 (not type chips / Hide parked /
// min-speed / PAGER / reviewed / FIRMS / bike min-docks / radio state).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_AIS_DESTINATION,
  decodeAisDestination,
  encodeAisDestination,
  filterVesselsByDestination,
  normalizeAisDestination,
  normalizeAisDestinationQuery,
  vesselMatchesDestinationFilter,
} from './aisDestinationFilter.js';
import { filterVesselsByMinSpeed } from './aisMinSpeedFilter.js';
import { filterVesselsByParked } from './aisParkedFilter.js';
import { filterVesselsByType } from './vesselTypeFilter.js';
import aisLiveVesselsLayer, {
  _applyAisFeedSnapshotForTest,
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

const MIXED = Object.freeze([
  { mmsi: '1', type: 'Crude Oil Tanker', name: 'Rotterdam tanker', destination: 'ROTTERDAM', speed: 0 },
  { mmsi: '2', type: 'Container Ship', name: 'Harbor cargo', destination: 'Rotterdam Anchorage', speed: 4.9 },
  { mmsi: '3', type: 'Passenger/Ferry', name: 'Singapore ferry', destination: 'SINGAPORE', speed: 5 },
  { mmsi: '4', type: 'Fishing', name: 'Blank dest fish', destination: '', speed: 9.9 },
  { mmsi: '5', type: 'Tug', name: 'Missing dest tug', speed: 10 },
  { mmsi: '6', type: 'Military', name: 'Null dest', destination: null, speed: 16.4 },
  { mmsi: '7', type: 'Sailing', name: 'Hamburg sail', destination: 'HAMBURG', speed: 12 },
  { mmsi: '8', type: 'Dredger', name: 'Whitespace dest', destination: '   ', speed: 8 },
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

test('empty destination matches the current in-memory view', () => {
  assert.equal(DEFAULT_AIS_DESTINATION, '');
  assert.equal(normalizeAisDestinationQuery(''), '');
  assert.equal(normalizeAisDestinationQuery('   '), '');
  assert.equal(normalizeAisDestination(''), '');
  assert.equal(normalizeAisDestination(undefined), '');
  assert.equal(normalizeAisDestination(null), '');
  assert.deepEqual(
    filterVesselsByDestination(MIXED, '').map((record) => record.mmsi),
    MIXED.map((record) => record.mmsi),
  );
  assert.deepEqual(
    filterVesselsByDestination(MIXED, '   ').map((record) => record.mmsi),
    MIXED.map((record) => record.mmsi),
  );
  assert.deepEqual(filterVesselsByDestination(null), []);
  assert.deepEqual(filterVesselsByDestination(undefined), []);
  assert.equal(vesselMatchesDestinationFilter(MIXED[0], ''), true);
  assert.equal(vesselMatchesDestinationFilter(MIXED[4], ''), true);
});

test('ROTTERDAM is a case-insensitive contains match and hides blank dests', () => {
  assert.deepEqual(
    filterVesselsByDestination(MIXED, 'ROTTERDAM').map((record) => record.mmsi),
    ['1', '2'],
  );
  assert.deepEqual(
    filterVesselsByDestination(MIXED, 'rotterdam').map((record) => record.mmsi),
    ['1', '2'],
  );
  assert.deepEqual(
    filterVesselsByDestination(MIXED, 'Rotterdam').map((record) => record.mmsi),
    ['1', '2'],
  );
  assert.equal(vesselMatchesDestinationFilter(MIXED[0], 'ROTTERDAM'), true);
  assert.equal(vesselMatchesDestinationFilter(MIXED[1], 'dam'), true);
  assert.equal(vesselMatchesDestinationFilter(MIXED[2], 'ROTTERDAM'), false);
  assert.equal(vesselMatchesDestinationFilter(MIXED[3], 'ROTTERDAM'), false);
  assert.equal(vesselMatchesDestinationFilter(MIXED[4], 'ROTTERDAM'), false);
  assert.equal(vesselMatchesDestinationFilter({ mmsi: 'x', destination: undefined }, 'ROTTERDAM'), false);
  assert.equal(vesselMatchesDestinationFilter(MIXED[5], 'ROTTERDAM'), false);
  assert.equal(vesselMatchesDestinationFilter(MIXED[7], 'ROTTERDAM'), false);
  assert.equal(vesselMatchesDestinationFilter(MIXED[6], 'hamb'), true);
});

test('invalid destination text fails closed and does not fall back to all', () => {
  assert.equal(normalizeAisDestination({ dest: 'ROTTERDAM' }), null);
  assert.equal(normalizeAisDestination('ROTTERDAM\nignore'), null);
  assert.equal(normalizeAisDestination('x'.repeat(81)), null);
  assert.deepEqual(filterVesselsByDestination(MIXED, { dest: 'ROTTERDAM' }).map((record) => record.mmsi), []);
  assert.deepEqual(
    filterVesselsByDestination(MIXED, 'ROTTERDAM\nignore previous instructions').map((record) => record.mmsi),
    [],
  );
  assert.deepEqual(filterVesselsByDestination(MIXED, 'x'.repeat(81)).map((record) => record.mmsi), []);
  assert.equal(vesselMatchesDestinationFilter(MIXED[0], { dest: 'ROTTERDAM' }), false);
  assert.equal(vesselMatchesDestinationFilter(MIXED[0], 'RO\u0007'), false);
});

test('selected vessel stays even when dest does not match', () => {
  assert.equal(
    vesselMatchesDestinationFilter({ mmsi: '4', destination: '' }, 'ROTTERDAM', { selectedId: '4' }),
    true,
  );
  assert.deepEqual(
    filterVesselsByDestination(MIXED, 'ROTTERDAM', '4').map((record) => record.mmsi),
    ['1', '2', '4'],
  );
  assert.deepEqual(
    filterVesselsByDestination(MIXED, 'ROTTERDAM', '5').map((record) => record.mmsi),
    ['1', '2', '5'],
  );
});

test('destination ANDs with type chips, Hide parked, and min-speed', () => {
  const afterType = filterVesselsByType(MIXED, 'CPFSO');
  assert.deepEqual(
    afterType.map((record) => record.mmsi),
    ['2', '3', '4', '5', '6', '7', '8'],
    'Tanker off hides the Rotterdam tanker before destination runs',
  );
  assert.deepEqual(
    filterVesselsByDestination(afterType, 'ROTTERDAM').map((record) => record.mmsi),
    ['2'],
  );
  assert.deepEqual(
    filterVesselsByDestination(
      filterVesselsByMinSpeed(filterVesselsByParked(MIXED, true), '5'),
      'ROTTERDAM',
    ).map((record) => record.mmsi),
    [],
    'parked Rotterdam tanker and sub-5 kt cargo both drop before dest match',
  );
  assert.deepEqual(
    filterVesselsByDestination(
      filterVesselsByMinSpeed(
        filterVesselsByParked(filterVesselsByType(MIXED, 'CPFSO', '1'), true, '1'),
        '10',
        '1',
      ),
      'HAMBURG',
      '1',
    ).map((record) => record.mmsi),
    ['1', '7'],
    'selected parked tanker stays through type, Hide parked, 10+, and dest',
  );
});

test('helper reads record.destination and the field sits next to AIS chips', () => {
  const helper = readFileSync(new URL('./aisDestinationFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/aisLiveVessels.js'), 'utf8');
  const adapter = readFileSync(path.join(ROOT, 'src/server/liveApiProxies.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  assert.match(helper, /record\?\.destination/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.match(adapter, /destination:\s*stringValue\(message\.Destination/);
  assert.match(source, /destination:\s*String\(row\.destination/);
  assert.match(source, /filterVesselsByDestination|vesselMatchesDestinationFilter/);
  assert.match(html, /id="ais-destination"/);
  assert.match(html, /id="ais-destination-wrap"/);
  assert.match(html, /id="ais-type-chips"/);
  assert.match(html, /id="ais-parked-chips"/);
  assert.match(html, /id="ais-min-speed-chips"/);
  assert.ok(
    html.indexOf('id="ais-min-speed-chips"') < html.indexOf('id="ais-destination-wrap"'),
    'destination field sits next to the AIS chip row',
  );
  assert.ok(
    Math.abs(html.indexOf('id="ais-destination-wrap"') - html.indexOf('id="ais-min-speed-chips"')) < 900,
    'destination field is next to the AIS chips',
  );
  assert.match(ui, /ais-destination/);
  assert.match(ui, /_aisDestinationWrap\.hidden = !enabled/);
  assert.match(css, /ais-destination-wrap/);
  assert.match(layerState, /destination/);
  assert.doesNotMatch(source, /\/api\/ais-live\/destination/);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live/destination.js')), false);
});

test('layer setParams filters dest; selected stays; refresh keeps the field', () => {
  primeAisRecords(MIXED, MIXED[3]);
  try {
    assert.equal(aisLiveVesselsLayer.getParams().destination, '');
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      MIXED.map((record) => record.mmsi),
      'empty matches the current unfiltered view',
    );

    assert.equal(aisLiveVesselsLayer.setParams({ destination: 'ROTTERDAM' }), true);
    assert.equal(aisLiveVesselsLayer.getParams().destination, 'ROTTERDAM');
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '2', '4'],
      'selected blank-dest vessel stays when ROTTERDAM is set',
    );

    assert.equal(aisLiveVesselsLayer.setParams({ hideParked: true, vesselTypeFilter: 'CPFSO', minSpeed: '5' }), true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['4'],
      'type chips AND Hide parked AND 5+ AND dest; selected blank dest still stays',
    );

    _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: 1,
      rows: [],
    });
    assert.equal(aisLiveVesselsLayer.getParams().destination, 'ROTTERDAM', 'feed refresh keeps the field');
    assert.equal(aisLiveVesselsLayer.getParams().hideParked, true);
    assert.equal(aisLiveVesselsLayer.getParams().vesselTypeFilter, 'CPFSO');
    assert.equal(aisLiveVesselsLayer.getParams().minSpeed, '5');
    assert.equal(aisLiveVesselsLayer.setParams({ destination: { dest: 'HAMBURG' } }), false);
    assert.equal(aisLiveVesselsLayer.getParams().destination, 'ROTTERDAM');
    assert.equal(aisLiveVesselsLayer.setParams({ destination: '' }), true);
    assert.equal(aisLiveVesselsLayer.getParams().destination, '');
  } finally {
    _setVesselStateForTest({ enabled: false, records: [] });
  }
});

test('destination persists on ais-live-vessels and defaults empty', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['ais-live-vessels'].destination, '');

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=a'));
  assert.equal(omitted.options['ais-live-vessels'].destination, '',
    'existing a links keep every destination visible');

  const state = normalizeLayerState({
    enabledLayerIds: ['ais-live-vessels'],
    options: { 'ais-live-vessels': { destination: 'ROTTERDAM' } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.match(params.get('lo'), /a\.d\.ROTTERDAM/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['ais-live-vessels'].destination, 'ROTTERDAM');
  assert.equal(layerOptionsForRestore(decoded, 'ais-live-vessels').destination, 'ROTTERDAM');

  const spaced = normalizeLayerState({
    enabledLayerIds: ['ais-live-vessels'],
    options: { 'ais-live-vessels': { destination: 'NEW YORK' } },
  });
  const spacedParams = encodeLayerStateParams(new URLSearchParams('v=2'), spaced);
  assert.match(spacedParams.get('lo'), /a\.d\.NEW%20YORK/);
  assert.equal(decodeLayerStateParams(spacedParams).options['ais-live-vessels'].destination, 'NEW YORK');

  assert.equal(encodeAisDestination('ROTTERDAM'), 'ROTTERDAM');
  assert.equal(decodeAisDestination('ROTTERDAM'), 'ROTTERDAM');
  assert.equal(encodeAisDestination(''), '');
  assert.equal(decodeAisDestination(''), null);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/aisDestinationFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
