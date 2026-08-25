// PLAN 189 — Hide no IMO toggle. Client-only filter of already-fetched
// AISStream rows. Distinct from 129–180 (not type chips / Hide parked /
// min-speed / destination field / Hide no dest / Hide unnamed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AIS_HIDE_NO_IMO_CHIP_LABEL,
  AIS_HIDE_NO_IMO_CHIP_TITLE,
  AIS_HIDE_NO_IMO_STORAGE_KEY,
  DEFAULT_AIS_HIDE_NO_IMO,
  aisHideNoImoChipModel,
  filterVesselsByHideNoImo,
  normalizeAisHideNoImo,
  readAisHideNoImo,
  vesselHasImo,
  vesselImoText,
  vesselMatchesHideNoImoFilter,
  writeAisHideNoImo,
} from './aisHideNoImoFilter.js';
import { filterVesselsByDestination } from './aisDestinationFilter.js';
import { filterVesselsByHideNoDest } from './aisHideNoDestFilter.js';
import { filterVesselsByHideUnnamed } from './aisHideUnnamedFilter.js';
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
  { mmsi: '1', type: 'Crude Oil Tanker', name: 'Rotterdam tanker', destination: 'ROTTERDAM', speed: 0, imo: '9732187' },
  { mmsi: '2', type: 'Container Ship', name: 'Harbor cargo', destination: 'Rotterdam Anchorage', speed: 4.9, imo: '9321483' },
  { mmsi: '3', type: 'Passenger/Ferry', name: 'Singapore ferry', destination: 'SINGAPORE', speed: 5, imo: '9812345' },
  { mmsi: '4', type: 'Fishing', name: 'Blank IMO fish', destination: 'ROTTERDAM', speed: 9.9, imo: '' },
  { mmsi: '5', type: 'Tug', name: 'Missing IMO tug', destination: 'HAMBURG', speed: 10 },
  { mmsi: '6', type: 'Military', name: 'Null IMO', destination: 'HAMBURG', speed: 16.4, imo: null },
  { mmsi: '7', type: 'Sailing', name: 'Hamburg sail', destination: 'HAMBURG', speed: 12, imo: '9123456' },
  { mmsi: '8', type: 'Dredger', name: 'Whitespace IMO', destination: 'ROTTERDAM', speed: 8, imo: '   ' },
  { mmsi: '9', type: 'Pleasure Craft', name: 'Yacht no IMO', destination: 'SINGAPORE', speed: 11, imo: '' },
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

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    snapshot: () => ({ ...data }),
  };
}

test('Hide no IMO defaults off and matches the unfiltered set', () => {
  assert.equal(DEFAULT_AIS_HIDE_NO_IMO, false);
  assert.equal(AIS_HIDE_NO_IMO_CHIP_LABEL, 'Hide no IMO');
  assert.equal(AIS_HIDE_NO_IMO_CHIP_TITLE, 'Hide vessels with no IMO');
  assert.equal(AIS_HIDE_NO_IMO_STORAGE_KEY, 'meridian.aisHideNoImo');
  assert.equal(normalizeAisHideNoImo(undefined), false);
  assert.equal(normalizeAisHideNoImo(null), false);
  assert.equal(normalizeAisHideNoImo(''), false);
  assert.equal(normalizeAisHideNoImo(false), false);
  assert.equal(normalizeAisHideNoImo(true), true);
  assert.equal(normalizeAisHideNoImo('1'), true);
  assert.equal(normalizeAisHideNoImo('true'), true);
  assert.equal(normalizeAisHideNoImo(0), false);
  assert.equal(normalizeAisHideNoImo('bogus'), null);
  assert.deepEqual(
    filterVesselsByHideNoImo(MIXED, false).map((record) => record.mmsi),
    MIXED.map((record) => record.mmsi),
  );
  assert.deepEqual(filterVesselsByHideNoImo(null), []);
  assert.deepEqual(filterVesselsByHideNoImo(undefined), []);
  assert.equal(vesselMatchesHideNoImoFilter(MIXED[3], false), true);
  assert.equal(vesselMatchesHideNoImoFilter(MIXED[4], false), true);
  assert.equal(vesselMatchesHideNoImoFilter(MIXED[8], false), true);
});

test('on hides empty/whitespace IMO; imo 9732187 stays', () => {
  assert.equal(vesselImoText({ imo: '9732187' }), '9732187');
  assert.equal(vesselImoText({ imo: '   ' }), '');
  assert.equal(vesselImoText({ imo: '' }), '');
  assert.equal(vesselImoText({ imo: null }), '');
  assert.equal(vesselImoText({}), '');
  assert.equal(vesselHasImo({ imo: '9732187' }), true);
  assert.equal(vesselHasImo({ imo: '' }), false);
  assert.equal(vesselHasImo({ imo: '   ' }), false);
  assert.equal(vesselHasImo({ imo: null }), false);
  assert.equal(vesselHasImo({}), false);
  const kept = filterVesselsByHideNoImo(MIXED, true).map((record) => record.mmsi);
  assert.deepEqual(kept, ['1', '2', '3', '7']);
  assert.ok(kept.includes('1'), 'imo 9732187 stays');
  assert.ok(!kept.includes('4'), 'imo empty hides when on');
  assert.ok(!kept.includes('5'));
  assert.ok(!kept.includes('6'));
  assert.ok(!kept.includes('8'));
  assert.ok(!kept.includes('9'));
  assert.equal(vesselMatchesHideNoImoFilter(MIXED[0], true), true);
  assert.equal(vesselMatchesHideNoImoFilter(MIXED[3], true), false);
  assert.equal(vesselMatchesHideNoImoFilter(MIXED[4], true), false);
  assert.equal(vesselMatchesHideNoImoFilter(MIXED[5], true), false);
  assert.equal(vesselMatchesHideNoImoFilter(MIXED[7], true), false);
  assert.equal(vesselMatchesHideNoImoFilter(MIXED[8], true), false);
});

test('selected empty-IMO vessel stays visible when Hide no IMO is on', () => {
  assert.equal(
    vesselMatchesHideNoImoFilter({ mmsi: '4', imo: '' }, true, { selectedId: '4' }),
    true,
  );
  assert.deepEqual(
    filterVesselsByHideNoImo(MIXED, true, '4').map((record) => record.mmsi),
    ['1', '2', '3', '4', '7'],
  );
  assert.deepEqual(
    filterVesselsByHideNoImo(MIXED, true, '9').map((record) => record.mmsi),
    ['1', '2', '3', '7', '9'],
  );
});

test('Hide no IMO ANDs with dest field, Hide no dest, Hide unnamed, type chips, Hide parked, and min-speed', () => {
  assert.deepEqual(
    filterVesselsByHideNoImo(filterVesselsByDestination(MIXED, ''), true)
      .map((record) => record.mmsi),
    ['1', '2', '3', '7'],
    'empty dest field + Hide no IMO still hides blank IMO',
  );
  assert.deepEqual(
    filterVesselsByHideNoImo(
      filterVesselsByHideUnnamed(
        filterVesselsByHideNoDest(filterVesselsByDestination(MIXED, 'ROTTERDAM'), true),
        true,
      ),
      true,
    ).map((record) => record.mmsi),
    ['1', '2'],
    'dest field + Hide no dest + Hide unnamed keep Rotterdam-named vessels; Hide no IMO drops blanks',
  );
  const afterType = filterVesselsByType(MIXED, 'CPFSO');
  assert.deepEqual(
    afterType.map((record) => record.mmsi),
    ['2', '3', '4', '5', '6', '7', '8', '9'],
    'Tanker off hides the Rotterdam tanker before Hide no IMO runs',
  );
  assert.deepEqual(
    filterVesselsByHideNoImo(afterType, true).map((record) => record.mmsi),
    ['2', '3', '7'],
  );
  assert.deepEqual(
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
    ).map((record) => record.mmsi),
    ['3', '7'],
    'parked Rotterdam tanker and sub-5 kt cargo drop; blank IMO drop after dest chips stay empty',
  );
  assert.deepEqual(
    filterVesselsByHideNoImo(
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
      ),
      true,
      '4',
    ).map((record) => record.mmsi),
    ['4', '7'],
    'selected empty IMO stays through type, Hide parked, 10+, dest field, Hide no dest, Hide unnamed, and Hide no IMO',
  );
});

test('helper reads record.imo and the chip sits next to AIS name/dest controls', () => {
  const helper = readFileSync(new URL('./aisHideNoImoFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/aisLiveVessels.js'), 'utf8');
  const adapter = readFileSync(path.join(ROOT, 'src/server/liveApiProxies.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  assert.match(helper, /record\?\.imo/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.match(adapter, /imo:\s*stringValue\(message\.ImoNumber/);
  assert.match(source, /imo:\s*String\(row\.imo/);
  assert.match(source, /hideNoImo/);
  assert.match(source, /filterVesselsByHideNoImo|vesselMatchesHideNoImoFilter/);
  assert.match(html, /id="ais-hide-no-imo-chips"/);
  assert.match(html, /data-ais-hide-no-imo="hide"/);
  assert.match(html, /Hide no IMO/);
  assert.match(html, /id="ais-hide-unnamed-chips"/);
  assert.match(html, /id="ais-hide-no-dest-chips"/);
  assert.match(html, /id="ais-parked-chips"/);
  assert.match(html, /id="ais-min-speed-chips"/);
  assert.ok(
    html.indexOf('id="ais-hide-unnamed-chips"') < html.indexOf('id="ais-hide-no-imo-chips"'),
    'Hide no IMO sits next to Hide unnamed',
  );
  assert.ok(
    Math.abs(html.indexOf('id="ais-hide-no-imo-chips"') - html.indexOf('id="ais-hide-unnamed-chips"')) < 900,
    'Hide no IMO is next to the AIS name chips',
  );
  assert.match(ui, /ais-hide-no-imo-chips|data-ais-hide-no-imo/);
  assert.match(ui, /_aisHideNoImoChips\.hidden = !enabled/);
  assert.match(css, /ais-hide-no-imo-chip/);
  assert.match(layerState, /hideNoImo/);
  assert.doesNotMatch(source, /\/api\/ais-live\/hide-no-imo/);
  assert.equal(existsSync(path.join(ROOT, 'api/ais-live/hide-no-imo.js')), false);
  assert.equal(aisHideNoImoChipModel(false).params.hideNoImo, true);
  assert.equal(aisHideNoImoChipModel(true).params.hideNoImo, false);
});

test('layer setParams hides empty IMO; selected stays; off restores; refresh keeps toggle', () => {
  primeAisRecords(MIXED, MIXED[3]);
  try {
    assert.equal(aisLiveVesselsLayer.getParams().hideNoImo, false);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      MIXED.map((record) => record.mmsi),
      'off matches the current unfiltered view',
    );

    assert.equal(aisLiveVesselsLayer.setParams({ hideNoImo: true }), true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoImo, true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['1', '2', '3', '4', '7'],
      'selected empty-IMO vessel stays when Hide no IMO is on',
    );
    assert.equal(
      aisLiveVesselsLayer.getRowControls().chips.find((chip) => chip.id === 'hide-no-imo')?.active,
      true,
    );

    assert.equal(aisLiveVesselsLayer.setParams({
      hideParked: true,
      vesselTypeFilter: 'CPFSO',
      minSpeed: '5',
      destination: '',
      hideNoDestination: true,
      hideUnnamed: true,
    }), true);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      ['3', '4', '7'],
      'type chips AND Hide parked AND 5+ AND dest chips AND Hide unnamed AND Hide no IMO; selected empty IMO stays',
    );

    _applyAisFeedSnapshotForTest({}, {
      status: 'open',
      lastMessageAt: 1,
      rows: [],
    });
    assert.equal(aisLiveVesselsLayer.getParams().hideNoImo, true, 'feed refresh keeps the toggle');
    assert.equal(aisLiveVesselsLayer.getParams().hideUnnamed, true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoDestination, true);
    assert.equal(aisLiveVesselsLayer.getParams().destination, '');
    assert.equal(aisLiveVesselsLayer.getParams().hideParked, true);
    assert.equal(aisLiveVesselsLayer.getParams().vesselTypeFilter, 'CPFSO');
    assert.equal(aisLiveVesselsLayer.getParams().minSpeed, '5');
    assert.equal(aisLiveVesselsLayer.setParams({ hideNoImo: 'nope' }), false);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoImo, true);

    assert.equal(aisLiveVesselsLayer.setParams({
      hideNoImo: false,
      hideParked: false,
      vesselTypeFilter: 'all',
      minSpeed: 'all',
      hideNoDestination: false,
      hideUnnamed: false,
    }), true);
    assert.equal(aisLiveVesselsLayer.getParams().hideNoImo, false);
    assert.deepEqual(
      aisLiveVesselsLayer.getAllPositions(20).map((row) => row.id),
      MIXED.map((record) => record.mmsi),
      'off restores the current unfiltered view',
    );
  } finally {
    _setVesselStateForTest({ enabled: false, records: [] });
  }
});

test('hideNoImo persists as meridian.aisHideNoImo and on ais-live-vessels, default off', () => {
  assert.equal(AIS_HIDE_NO_IMO_STORAGE_KEY, 'meridian.aisHideNoImo');
  const storage = memoryStorage();
  assert.equal(readAisHideNoImo(storage), false);
  assert.equal(writeAisHideNoImo(true, storage), true);
  assert.equal(storage.snapshot()['meridian.aisHideNoImo'], '1');
  assert.equal(readAisHideNoImo(storage), true);
  assert.equal(writeAisHideNoImo(false, storage), true);
  assert.equal(storage.snapshot()['meridian.aisHideNoImo'], '0');
  assert.equal(readAisHideNoImo(storage), false);
  assert.equal(readAisHideNoImo(memoryStorage({ 'meridian.aisHideNoImo': '1' })), true);

  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['ais-live-vessels'].hideNoImo, false);

  const omitted = decodeLayerStateParams(new URLSearchParams('v=2&l=a'));
  assert.equal(omitted.options['ais-live-vessels'].hideNoImo, false,
    'existing a links keep no-IMO vessels visible');

  const state = normalizeLayerState({
    enabledLayerIds: ['ais-live-vessels'],
    options: { 'ais-live-vessels': { hideNoImo: true } },
  });
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), state);
  assert.match(params.get('lo'), /a\.i\.1/);
  const decoded = decodeLayerStateParams(params);
  assert.equal(decoded.options['ais-live-vessels'].hideNoImo, true);
  assert.equal(layerOptionsForRestore(decoded, 'ais-live-vessels').hideNoImo, true);

  const roundTrip = normalizeLayerState({
    enabledLayerIds: ['ais-live-vessels'],
    options: {
      'ais-live-vessels': {
        hideNoImo: true,
        hideUnnamed: true,
        hideNoDestination: true,
        hideParked: true,
        destination: 'ROTTERDAM',
      },
    },
  });
  const roundTripParams = encodeLayerStateParams(new URLSearchParams('v=2'), roundTrip);
  const roundTripDecoded = decodeLayerStateParams(roundTripParams);
  assert.equal(roundTripDecoded.options['ais-live-vessels'].hideNoImo, true);
  assert.equal(roundTripDecoded.options['ais-live-vessels'].hideUnnamed, true);
  assert.equal(roundTripDecoded.options['ais-live-vessels'].hideNoDestination, true);
  assert.equal(roundTripDecoded.options['ais-live-vessels'].hideParked, true);
  assert.equal(roundTripDecoded.options['ais-live-vessels'].destination, 'ROTTERDAM');
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/aisHideNoImoFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
