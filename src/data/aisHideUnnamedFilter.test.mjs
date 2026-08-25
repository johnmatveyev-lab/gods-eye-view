// PLAN 180 — Hide unnamed toggle. Client-only filter of already-fetched
// AISStream rows. Distinct from 129–175 (not type chips / Hide parked /
// min-speed / destination field / Hide no dest / PAGER / reviewed / FIRMS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AIS_GENERIC_VESSEL_LABEL,
  AIS_HIDE_UNNAMED_CHIP_LABEL,
  AIS_HIDE_UNNAMED_CHIP_TITLE,
  DEFAULT_AIS_HIDE_UNNAMED,
  aisHideUnnamedChipModel,
  filterVesselsByHideUnnamed,
  normalizeAisHideUnnamed,
  vesselHasName,
  vesselIsUnnamed,
  vesselMatchesHideUnnamedFilter,
  vesselNameText,
} from './aisHideUnnamedFilter.js';
import { filterVesselsByDestination } from './aisDestinationFilter.js';
import { filterVesselsByHideNoDest } from './aisHideNoDestFilter.js';
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
  { mmsi: '4', type: 'Fishing', name: '', destination: 'ROTTERDAM', speed: 9.9 },
  { mmsi: '5', type: 'Tug', destination: 'HAMBURG', speed: 10 },
  { mmsi: '6', type: 'Military', name: null, destination: 'HAMBURG', speed: 16.4 },
  { mmsi: '7', type: 'Sailing', name: 'Hamburg sail', destination: 'HAMBURG', speed: 12 },
  { mmsi: '8', type: 'Dredger', name: '   ', destination: 'ROTTERDAM', speed: 8 },
  { mmsi: '9', type: 'Pleasure Craft', name: 'VESSEL', destination: 'SINGAPORE', speed: 11 },
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

test('Hide unnamed defaults off and matches the unfiltered set', () => {
  assert.equal(DEFAULT_AIS_HIDE_UNNAMED, false);
  assert.equal(AIS_GENERIC_VESSEL_LABEL, 'VESSEL');
  assert.equal(AIS_HIDE_UNNAMED_CHIP_LABEL, 'Hide unnamed');
  assert.equal(AIS_HIDE_UNNAMED_CHIP_TITLE, 'Hide vessels with no name');
  assert.equal(normalizeAisHideUnnamed(undefined), false);
  assert.equal(normalizeAisHideUnnamed(null), false);
  assert.equal(normalizeAisHideUnnamed(''), false);
  assert.equal(normalizeAisHideUnnamed(false), false);
  assert.equal(normalizeAisHideUnnamed(true), true);
  assert.equal(normalizeAisHideUnnamed('1'), true);
  assert.equal(normalizeAisHideUnnamed('true'), true);
  assert.equal(normalizeAisHideUnnamed(0), false);
  assert.equal(normalizeAisHideUnnamed('bogus'), null);
  assert.deepEqual(
    filterVesselsByHideUnnamed(MIXED, false).map((record) => record.mmsi),
    MIXED.map((record) => record.mmsi),
  );
  assert.deepEqual(filterVesselsByHideUnnamed(null), []);
  assert.deepEqual(filterVesselsByHideUnnamed(undefined), []);
  assert.equal(vesselMatchesHideUnnamedFilter(MIXED[3], false), true);
  assert.equal(vesselMatchesHideUnnamedFilter(MIXED[4], false), true);
  assert.equal(vesselMatchesHideUnnamedFilter(MIXED[8], false), true);
});

test('on hides blank/VESSEL names; named stay', () => {
  assert.equal(vesselNameText({ name: 'Rotterdam tanker' }), 'Rotterdam tanker');
  assert.equal(vesselNameText({ name: '   ' }), '');
  assert.equal(vesselNameText({ name: '' }), '');
  assert.equal(vesselNameText({ name: null }), '');
  assert.equal(vesselNameText({}), '');
  assert.equal(vesselHasName({ name: 'Hamburg sail' }), true);
  assert.equal(vesselHasName({ name: '' }), false);
  assert.equal(vesselHasName({ name: '   ' }), false);
  assert.equal(vesselHasName({ name: null }), false);
  assert.equal(vesselHasName({}), false);
  assert.equal(vesselIsUnnamed({ name: 'VESSEL' }), true);
  assert.equal(vesselIsUnnamed({ name: 'vessel' }), true);
  assert.equal(vesselIsUnnamed({ name: ' Vessel ' }), true);
  assert.equal(vesselIsUnnamed({ name: 'MMSI 353136000' }), true);
  assert.equal(vesselIsUnnamed({ mmsi: '353136000', name: '353136000' }), true);
  assert.equal(vesselIsUnnamed({ name: 'EVER GIVEN' }), false);
  const kept = filterVesselsByHideUnnamed(MIXED, true).map((record) => record.mmsi);
  assert.deepEqual(kept, ['1', '2', '3', '7']);
  assert.ok(!kept.includes('4'));
  assert.ok(!kept.includes('5'));
  assert.ok(!kept.includes('6'));
  assert.ok(!kept.includes('8'));
  assert.ok(!kept.includes('9'));
  assert.equal(vesselMatchesHideUnnamedFilter(MIXED[0], true), true);
  assert.equal(vesselMatchesHideUnnamedFilter(MIXED[3], true), false);
  assert.equal(vesselMatchesHideUnnamedFilter(MIXED[4], true), false);
  assert.equal(vesselMatchesHideUnnamedFilter(MIXED[5], true), false);
  assert.equal(vesselMatchesHideUnnamedFilter(MIXED[7], true), false);
  assert.equal(vesselMatchesHideUnnamedFilter(MIXED[8], true), false);
});

test('selected unnamed vessel stays visible when Hide unnamed is on', () => {
  assert.equal(
    vesselMatchesHideUnnamedFilter({ mmsi: '4', name: '' }, true, { selectedId: '4' }),
    true,
  );
  assert.deepEqual(
    filterVesselsByHideUnnamed(MIXED, true, '4').map((record) => record.mmsi),
    ['1', '2', '3', '4', '7'],
  );
  assert.deepEqual(
    filterVesselsByHideUnnamed(MIXED, true, '9').map((record) => record.mmsi),
    ['1', '2', '3', '7', '9'],
  );
});

test('Hide unnamed ANDs with dest field, Hide no dest, type chips, Hide parked, and min-speed', () => {
  assert.deepEqual(
    filterVesselsByHideUnnamed(filterVesselsByDestination(MIXED, ''), true)
      .map((record) => record.mmsi),
    ['1', '2', '3', '7'],
    'empty dest field + Hide unnamed still hides blank names',
  );
  assert.deepEqual(
    filterVesselsByHideUnnamed(
      filterVesselsByHideNoDest(filterVesselsByDestination(MIXED, 'ROTTERDAM'), true),
      true,
    ).map((record) => record.mmsi),
    ['1', '2'],
    'dest field + Hide no dest keep Rotterdam-named vessels; Hide unnamed drops blanks',
  );
  const afterType = filterVesselsByType(MIXED, 'CPFSO');
  assert.deepEqual(
    afterType.map((record) => record.mmsi),
    ['2', '3', '4', '5', '6', '7', '8', '9'],
    'Tanker off hides the Rotterdam tanker before Hide unnamed runs',
  );
  assert.deepEqual(
    filterVesselsByHideUnnamed(afterType, true).map((record) => record.mmsi),
    ['2', '3', '7'],
  );
  assert.deepEqual(
    filterVesselsByHideUnnamed(
      filterVesselsByHideNoDest(
        filterVesselsByDestination(
          filterVesselsByMinSpeed(filterVesselsByParked(MIXED, true), '5'),
          '',
        ),
        true,
      ),
      true,
    ).map((record) => record.mmsi),
    ['3', '7'],
    'parked Rotterdam tanker and sub-5 kt cargo drop; unnamed drop after dest chips stay empty',
  );
  assert.deepEqual(
    filterVesselsByHideUnnamed(
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
      ),
      true,
      '4',
    ).map((record) => record.mmsi),
    ['4', '7'],
    'selected unnamed stays through type, Hide parked, 10+, dest field, Hide no dest, and Hide unnamed',
  );
});

test('helper reads record.name and the chip sits next to AIS dest controls', () => {
  const helper = readFileSync(new URL('./aisHideUnnamedFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/aisLiveVessels.js'), 'utf8');
  const adapter = readFileSync(path.join(ROOT, 'src/server/liveApiProxies.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  assert.match(helper, /record\?\.name/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.match(adapter, /name:\s*vesselNameFromAis/);
  assert.match(source, /name:\s*String\(row\.name/);
  assert.match(source, /hideUnnamed/);
  assert.match(source, /filterVesselsByHideUnnamed|vesselMatchesHideUnnamedFilter/);
  assert.match(html, /id="ais-hide-unnamed-chips"/);
  assert.match(html, /data-ais-hide-unnamed="hide"/);
  assert.match(html, /Hide unnamed/);
  assert.match(html, /id="ais-hide-no-dest-chips"/);
  assert.match(html, /id="ais-parked-chips"/);
  assert.match(html, /id="ais-min-speed-chips"/);
  assert.ok(
    html.indexOf('id="ais-hide-no-dest-chips"') < html.indexOf('id="ais-hide-unnamed-chips"'),
    'Hide unnamed sits next to Hide no dest',
  );
  assert.ok(
    Math.abs(html.indexOf('id="ais-hide-unnamed-chips"') - html.indexOf('id="ais-hide-no-dest-chips"')) < 900,
    'Hide unnamed is next to the AIS dest chips',
  );
  assert.match(ui, /ais-hide-unnamed-chips|data-ais-hide-unnamed/);
  assert.match(ui, /_aisHideUnnamedChips\.hidden = !enabled/);
  assert.match(css, /ais-hide-unnamed-chip/);
  assert.match(layerState, /hideUnnamed/);
  assert.doesNotMatch(source, /\/api\/ais-live\/hide-unnamed/);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live/hide-unnamed.js')), false);
  assert.equal(aisHideUnnamedChipModel(false).params.hideUnnamed, true);
  assert.equal(aisHideUnnamedChipModel(true).params.hideUnnamed, false);
});

test('layer setParams hides unnamed; selected stays; refresh keeps toggle', () => {
  primeAisRecords(MIXED, MIXED[3]);
  try {
    assert.equal(aisLiveVesselsLayer.getParams().hideUnnamed, false);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      MIXED.map((record) => record.mmsi),
      'off matches the current unfiltered view',
    );

    assert.equal(aisLiveVesselsLayer.setParams({ hideUnnamed: true }), true);
    assert.equal(aisLiveVesselsLayer.getParams().hideUnnamed, true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '2', '3', '4', '7'],
      'selected unnamed vessel stays when Hide unnamed is on',
    );
    assert.equal(
      aisLiveVesselsLayer.getRowControls().chips.find((chip) => chip.id === 'hide-unnamed')?.active,
      true,
    );

    assert.equal(aisLiveVesselsLayer.setParams({
      hideParked: true,
      vesselTypeFilter: 'CPFSO',
      minSpeed: '5',
      destination: '',
      hideNoDestination: true,
    }), true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['3', '4', '7'],
      'type chips AND Hide parked AND 5+ AND dest chips AND Hide unnamed; selected unnamed stays',
    );

    _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: 1,
      rows: [],
    });
    assert.equal(aisLiveVesselsLayer.getParams().hideUnnamed, true, 'feed refresh keeps the toggle');
    assert.equal(aisLiveVesselsLayer.getParams().hideNoDestination, true);
    assert.equal(aisLiveVesselsLayer.getParams().destination, '');
    assert.equal(aisLiveVesselsLayer.getParams().hideParked, true);
    assert.equal(aisLiveVesselsLayer.getParams().vesselTypeFilter, 'CPFSO');
    assert.equal(aisLiveVesselsLayer.getParams().minSpeed, '5');
    assert.equal(aisLiveVesselsLayer.setParams({ hideUnnamed: 'nope' }), false);
    assert.equal(aisLiveVesselsLayer.getParams().hideUnnamed, true);
  } finally {
    _setVesselStateForTest({ enabled: false, records: [] });
  }
});

test('hideUnnamed persists on ais-live-vessels and defaults off', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['ais-live-vessels'].hideUnnamed, false);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=a'));
  assert.equal(omitted.options['ais-live-vessels'].hideUnnamed, false,
    'existing a links keep unnamed vessels visible');

  const state = normalizeLayerState({
    enabledLayerIds: ['ais-live-vessels'],
    options: { 'ais-live-vessels': { hideUnnamed: true } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.match(params.get('lo'), /a\.u\.1/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['ais-live-vessels'].hideUnnamed, true);
  assert.equal(layerOptionsForRestore(decoded, 'ais-live-vessels').hideUnnamed, true);

  const roundTrip = normalizeLayerState({
    enabledLayerIds: ['ais-live-vessels'],
    options: {
      'ais-live-vessels': {
        hideUnnamed: true,
        hideNoDestination: true,
        hideParked: true,
        destination: 'ROTTERDAM',
      },
    },
  });
  const roundTripParams = encodeLayerStateParams(new URLSearchParams('v=2'), roundTrip);
  const roundTripDecoded = decodeLayerStateParams(roundTripParams);
  assert.equal(roundTripDecoded.options['ais-live-vessels'].hideUnnamed, true);
  assert.equal(roundTripDecoded.options['ais-live-vessels'].hideNoDestination, true);
  assert.equal(roundTripDecoded.options['ais-live-vessels'].hideParked, true);
  assert.equal(roundTripDecoded.options['ais-live-vessels'].destination, 'ROTTERDAM');
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/aisHideUnnamedFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
