// PLAN 175 — Hide no dest toggle. Client-only filter of already-fetched
// AISStream rows. Distinct from 129–174 (not type chips / Hide parked /
// min-speed / destination field / PAGER / reviewed / FIRMS / bike e-bike).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AIS_HIDE_NO_DEST_CHIP_LABEL,
  AIS_HIDE_NO_DEST_CHIP_TITLE,
  DEFAULT_AIS_HIDE_NO_DESTINATION,
  aisHideNoDestChipModel,
  filterVesselsByHideNoDest,
  normalizeAisHideNoDestination,
  vesselDestinationText,
  vesselHasDestination,
  vesselMatchesHideNoDestFilter,
} from './aisHideNoDestFilter.js';
import { filterVesselsByDestination } from './aisDestinationFilter.js';
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

test('Hide no dest defaults off and matches the unfiltered set', () => {
  assert.equal(DEFAULT_AIS_HIDE_NO_DESTINATION, false);
  assert.equal(AIS_HIDE_NO_DEST_CHIP_LABEL, 'Hide no dest');
  assert.equal(AIS_HIDE_NO_DEST_CHIP_TITLE, 'Hide vessels with no destination');
  assert.equal(normalizeAisHideNoDestination(undefined), false);
  assert.equal(normalizeAisHideNoDestination(null), false);
  assert.equal(normalizeAisHideNoDestination(''), false);
  assert.equal(normalizeAisHideNoDestination(false), false);
  assert.equal(normalizeAisHideNoDestination(true), true);
  assert.equal(normalizeAisHideNoDestination('1'), true);
  assert.equal(normalizeAisHideNoDestination('true'), true);
  assert.equal(normalizeAisHideNoDestination(0), false);
  assert.equal(normalizeAisHideNoDestination('bogus'), null);
  assert.deepEqual(
    filterVesselsByHideNoDest(MIXED, false).map((record) => record.mmsi),
    MIXED.map((record) => record.mmsi),
  );
  assert.deepEqual(filterVesselsByHideNoDest(null), []);
  assert.deepEqual(filterVesselsByHideNoDest(undefined), []);
  assert.equal(vesselMatchesHideNoDestFilter(MIXED[3], false), true);
  assert.equal(vesselMatchesHideNoDestFilter(MIXED[4], false), true);
});

test('on hides missing, empty, and whitespace dests; filled dests stay', () => {
  assert.equal(vesselDestinationText({ destination: 'ROTTERDAM' }), 'ROTTERDAM');
  assert.equal(vesselDestinationText({ destination: '   ' }), '');
  assert.equal(vesselDestinationText({ destination: '' }), '');
  assert.equal(vesselDestinationText({ destination: null }), '');
  assert.equal(vesselDestinationText({}), '');
  assert.equal(vesselHasDestination({ destination: 'HAMBURG' }), true);
  assert.equal(vesselHasDestination({ destination: '' }), false);
  assert.equal(vesselHasDestination({ destination: '   ' }), false);
  assert.equal(vesselHasDestination({ destination: null }), false);
  assert.equal(vesselHasDestination({}), false);
  const kept = filterVesselsByHideNoDest(MIXED, true).map((record) => record.mmsi);
  assert.deepEqual(kept, ['1', '2', '3', '7']);
  assert.ok(!kept.includes('4'));
  assert.ok(!kept.includes('5'));
  assert.ok(!kept.includes('6'));
  assert.ok(!kept.includes('8'));
  assert.equal(vesselMatchesHideNoDestFilter(MIXED[0], true), true);
  assert.equal(vesselMatchesHideNoDestFilter(MIXED[3], true), false);
  assert.equal(vesselMatchesHideNoDestFilter(MIXED[4], true), false);
  assert.equal(vesselMatchesHideNoDestFilter(MIXED[5], true), false);
  assert.equal(vesselMatchesHideNoDestFilter(MIXED[7], true), false);
});

test('selected blank-dest vessel stays visible when Hide no dest is on', () => {
  assert.equal(
    vesselMatchesHideNoDestFilter({ mmsi: '4', destination: '' }, true, { selectedId: '4' }),
    true,
  );
  assert.deepEqual(
    filterVesselsByHideNoDest(MIXED, true, '4').map((record) => record.mmsi),
    ['1', '2', '3', '4', '7'],
  );
  assert.deepEqual(
    filterVesselsByHideNoDest(MIXED, true, '5').map((record) => record.mmsi),
    ['1', '2', '3', '5', '7'],
  );
});

test('Hide no dest ANDs with dest field, type chips, Hide parked, and min-speed', () => {
  assert.deepEqual(
    filterVesselsByHideNoDest(filterVesselsByDestination(MIXED, ''), true)
      .map((record) => record.mmsi),
    ['1', '2', '3', '7'],
    'empty dest field + Hide no dest still hides blanks',
  );
  assert.deepEqual(
    filterVesselsByHideNoDest(filterVesselsByDestination(MIXED, 'ROTTERDAM'), true)
      .map((record) => record.mmsi),
    ['1', '2'],
    'non-empty dest field already hides blanks; Hide no dest keeps the match',
  );
  const afterType = filterVesselsByType(MIXED, 'CPFSO');
  assert.deepEqual(
    afterType.map((record) => record.mmsi),
    ['2', '3', '4', '5', '6', '7', '8'],
    'Tanker off hides the Rotterdam tanker before Hide no dest runs',
  );
  assert.deepEqual(
    filterVesselsByHideNoDest(afterType, true).map((record) => record.mmsi),
    ['2', '3', '7'],
  );
  assert.deepEqual(
    filterVesselsByHideNoDest(
      filterVesselsByDestination(
        filterVesselsByMinSpeed(filterVesselsByParked(MIXED, true), '5'),
        '',
      ),
      true,
    ).map((record) => record.mmsi),
    ['3', '7'],
    'parked Rotterdam tanker and sub-5 kt cargo drop; blanks drop after dest field stays empty',
  );
  assert.deepEqual(
    filterVesselsByHideNoDest(
      filterVesselsByDestination(
        filterVesselsByMinSpeed(
          filterVesselsByParked(filterVesselsByType(MIXED, 'CPFSO', '4'), true, '4'),
          '10',
          '4',
        ),
        '',
        '4',
      ),
      true,
      '4',
    ).map((record) => record.mmsi),
    ['4', '7'],
    'selected blank dest stays through type, Hide parked, 10+, empty dest field, and Hide no dest',
  );
});

test('helper reads record.destination and the chip sits next to AIS dest controls', () => {
  const helper = readFileSync(new URL('./aisHideNoDestFilter.js', import.meta.url), 'utf8');
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
  assert.match(source, /hideNoDestination/);
  assert.match(source, /filterVesselsByHideNoDest|vesselMatchesHideNoDestFilter/);
  assert.match(html, /id="ais-hide-no-dest-chips"/);
  assert.match(html, /data-ais-hide-no-dest="hide"/);
  assert.match(html, /Hide no dest/);
  assert.match(html, /id="ais-destination-wrap"/);
  assert.match(html, /id="ais-parked-chips"/);
  assert.match(html, /id="ais-min-speed-chips"/);
  assert.ok(
    html.indexOf('id="ais-destination-wrap"') < html.indexOf('id="ais-hide-no-dest-chips"'),
    'Hide no dest sits next to the destination field',
  );
  assert.ok(
    Math.abs(html.indexOf('id="ais-hide-no-dest-chips"') - html.indexOf('id="ais-destination-wrap"')) < 900,
    'Hide no dest is next to the AIS dest field',
  );
  assert.match(ui, /ais-hide-no-dest-chips|data-ais-hide-no-dest/);
  assert.match(ui, /_aisHideNoDestChips\.hidden = !enabled/);
  assert.match(css, /ais-hide-no-dest-chip/);
  assert.match(layerState, /hideNoDestination/);
  assert.doesNotMatch(source, /\/api\/ais-live\/hide-no-dest/);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live/hide-no-dest.js')), false);
  assert.equal(aisHideNoDestChipModel(false).params.hideNoDestination, true);
  assert.equal(aisHideNoDestChipModel(true).params.hideNoDestination, false);
});

test('layer setParams hides blank dests; selected stays; refresh keeps toggle', () => {
  primeAisRecords(MIXED, MIXED[3]);
  try {
    assert.equal(aisLiveVesselsLayer.getParams().hideNoDestination, false);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      MIXED.map((record) => record.mmsi),
      'off matches the current unfiltered view',
    );

    assert.equal(aisLiveVesselsLayer.setParams({ hideNoDestination: true }), true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoDestination, true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '2', '3', '4', '7'],
      'selected blank-dest vessel stays when Hide no dest is on',
    );
    assert.equal(
      aisLiveVesselsLayer.getRowControls().chips.find((chip) => chip.id === 'hide-no-dest')?.active,
      true,
    );

    assert.equal(aisLiveVesselsLayer.setParams({
      hideParked: true,
      vesselTypeFilter: 'CPFSO',
      minSpeed: '5',
      destination: '',
    }), true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['3', '4'],
      'type chips AND Hide parked AND 5+ AND empty dest field AND Hide no dest; selected blank dest stays',
    );

    _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: 1,
      rows: [],
    });
    assert.equal(aisLiveVesselsLayer.getParams().hideNoDestination, true, 'feed refresh keeps the toggle');
    assert.equal(aisLiveVesselsLayer.getParams().destination, '');
    assert.equal(aisLiveVesselsLayer.getParams().hideParked, true);
    assert.equal(aisLiveVesselsLayer.getParams().vesselTypeFilter, 'CPFSO');
    assert.equal(aisLiveVesselsLayer.getParams().minSpeed, '5');
    assert.equal(aisLiveVesselsLayer.setParams({ hideNoDestination: 'nope' }), false);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoDestination, true);
  } finally {
    _setVesselStateForTest({ enabled: false, records: [] });
  }
});

test('hideNoDestination persists on ais-live-vessels and defaults off', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['ais-live-vessels'].hideNoDestination, false);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=a'));
  assert.equal(omitted.options['ais-live-vessels'].hideNoDestination, false,
    'existing a links keep blank destinations visible');

  const state = normalizeLayerState({
    enabledLayerIds: ['ais-live-vessels'],
    options: { 'ais-live-vessels': { hideNoDestination: true } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.match(params.get('lo'), /a\.n\.1/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['ais-live-vessels'].hideNoDestination, true);
  assert.equal(layerOptionsForRestore(decoded, 'ais-live-vessels').hideNoDestination, true);

  const roundTrip = normalizeLayerState({
    enabledLayerIds: ['ais-live-vessels'],
    options: {
      'ais-live-vessels': {
        hideNoDestination: true,
        hideParked: true,
        destination: 'ROTTERDAM',
      },
    },
  });
  const roundTripParams = encodeLayerStateParams(new URLSearchParams('v=2'), roundTrip);
  const roundTripDecoded = decodeLayerStateParams(roundTripParams);
  assert.equal(roundTripDecoded.options['ais-live-vessels'].hideNoDestination, true);
  assert.equal(roundTripDecoded.options['ais-live-vessels'].hideParked, true);
  assert.equal(roundTripDecoded.options['ais-live-vessels'].destination, 'ROTTERDAM');
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/aisHideNoDestFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
