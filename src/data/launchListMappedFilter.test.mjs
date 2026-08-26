// PLAN 215 — Launches panel Mapped only toggle. Client-only filter of
// already-fetched LL2 rows. Distinct from 207 LSP-type, 181 hide-unknown-site
// (name string), and 209/212 sites mapped-only. rocketLaunches.js stays
// unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAUNCH_LIST_MAPPED_ONLY,
  LAUNCH_LIST_MAPPED_ONLY_CHIP_LABEL,
  LAUNCH_LIST_MAPPED_ONLY_CHIP_TITLE,
  LAUNCH_LIST_MAPPED_ONLY_STORAGE_KEY,
  filterLaunchListByMappedOnly,
  launchListMappedOnlyChipModel,
  launchListRowHasMappedPad,
  launchListRowMatchesMappedFilter,
  normalizeLaunchListMappedOnly,
  readLaunchListMappedOnly,
  writeLaunchListMappedOnly,
} from './launchListMappedFilter.js';
import { launchesPanelRows } from './launchesPanel.js';
import { filterLaunchesByLspType } from './launchLspTypeFilter.js';
import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
  layerOptionsForRestore,
  normalizeLayerState,
} from './layerState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.hasOwn(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    snapshot() {
      return { ...data };
    },
  };
}

const PADDED = {
  id: 'll2-starlink',
  name: 'Falcon 9 | Starlink Group 10-1',
  net: '2026-08-20T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'SLC-40' },
};

const NO_COORDS = {
  id: 'll2-secret-pad',
  name: 'Classified Flight',
  net: '2026-08-21T08:00:00Z',
  status: { name: 'TBD' },
  launch_service_provider: { name: 'Unknown', type: { id: 3, name: 'Commercial' } },
  pad: { name: 'Undisclosed', location: {} },
};

const NAN_COORDS = {
  id: 'll2-nan-pad',
  name: 'Broken Pad',
  net: '2026-08-22T08:00:00Z',
  status: { name: 'TBD' },
  launch_service_provider: { name: 'NASA', type: { id: 1, name: 'Government' } },
  pad: { latitude: 'NaN', longitude: 'NaN', name: 'Unknown' },
};

const GOVERNMENT_PADDED = {
  id: 'll2-sls',
  name: 'SLS | Artemis',
  net: '2026-08-23T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'NASA', type: { id: 1, name: 'Government' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'LC-39B' },
};

const MIXED = Object.freeze([PADDED, NO_COORDS, NAN_COORDS, GOVERNMENT_PADDED]);

test('off keeps no-coord rows', () => {
  assert.equal(DEFAULT_LAUNCH_LIST_MAPPED_ONLY, false);
  assert.equal(LAUNCH_LIST_MAPPED_ONLY_STORAGE_KEY, 'meridian.launchListMappedOnly');
  assert.equal(LAUNCH_LIST_MAPPED_ONLY_CHIP_LABEL, 'Mapped only');
  assert.equal(LAUNCH_LIST_MAPPED_ONLY_CHIP_TITLE, 'Hide missions without a flyable pad');
  assert.equal(normalizeLaunchListMappedOnly(undefined), false);
  assert.equal(normalizeLaunchListMappedOnly(null), false);
  assert.equal(normalizeLaunchListMappedOnly(''), false);
  assert.equal(normalizeLaunchListMappedOnly(false), false);

  const rows = launchesPanelRows({ results: MIXED });
  assert.deepEqual(rows.map((row) => row.id), MIXED.map((row) => row.id));
  assert.equal(rows[1].lat, null);
  assert.equal(rows[1].lon, null);
  assert.equal(launchListRowMatchesMappedFilter(rows[1], false), true);
  assert.deepEqual(
    filterLaunchListByMappedOnly(rows, false).map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterLaunchListByMappedOnly(null), []);
  assert.deepEqual(filterLaunchListByMappedOnly(undefined), []);
});

test('on drops null/NaN coords', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', { mappedOnly: true });
  assert.deepEqual(rows.map((row) => row.id), ['ll2-starlink', 'll2-sls']);
  assert.ok(!rows.some((row) => row.id === 'll2-secret-pad'));
  assert.ok(!rows.some((row) => row.id === 'll2-nan-pad'));

  const built = launchesPanelRows({ results: MIXED });
  assert.equal(launchListRowHasMappedPad(built[1]), false);
  assert.equal(launchListRowHasMappedPad({ lat: NaN, lon: NaN }), false);
  assert.equal(launchListRowMatchesMappedFilter(built[1], true), false);
  assert.equal(launchListRowMatchesMappedFilter({ id: 'x', lat: NaN, lon: 1 }, true), false);
  assert.deepEqual(
    filterLaunchListByMappedOnly(built, true).map((row) => row.id),
    ['ll2-starlink', 'll2-sls'],
  );
});

test('keeps finite pad', () => {
  const rows = launchesPanelRows({ results: [PADDED] }, 'all', { mappedOnly: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'll2-starlink');
  assert.equal(rows[0].lat, 28.608);
  assert.equal(rows[0].lon, -80.604);
  assert.equal(launchListRowHasMappedPad(rows[0]), true);
  assert.equal(launchListRowMatchesMappedFilter(rows[0], true), true);
  assert.equal(launchListRowHasMappedPad({ lat: 0, lon: 0 }), true, '0,0 is finite');
});

test('selected id always kept', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', {
    mappedOnly: true,
    selectedId: 'll2-secret-pad',
  });
  assert.deepEqual(rows.map((row) => row.id), ['ll2-starlink', 'll2-secret-pad', 'll2-sls']);
  assert.equal(
    launchListRowMatchesMappedFilter(
      { id: 'll2-secret-pad', lat: null, lon: null },
      true,
      { selectedId: 'll2-secret-pad' },
    ),
    true,
  );
  assert.deepEqual(
    filterLaunchListByMappedOnly(
      launchesPanelRows({ results: MIXED }),
      true,
      'll2-nan-pad',
    ).map((row) => row.id),
    ['ll2-starlink', 'll2-nan-pad', 'll2-sls'],
  );
});

test('invalid storage reads as off', () => {
  assert.equal(normalizeLaunchListMappedOnly('bogus'), null);
  assert.equal(normalizeLaunchListMappedOnly('on'), null);
  assert.equal(readLaunchListMappedOnly(memoryStorage()), DEFAULT_LAUNCH_LIST_MAPPED_ONLY);
  assert.equal(readLaunchListMappedOnly(memoryStorage({
    [LAUNCH_LIST_MAPPED_ONLY_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readLaunchListMappedOnly(memoryStorage({
    [LAUNCH_LIST_MAPPED_ONLY_STORAGE_KEY]: 'yes',
  })), false);
  assert.equal(writeLaunchListMappedOnly('nope', memoryStorage()), false);
});

test('persist flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(readLaunchListMappedOnly(storage), DEFAULT_LAUNCH_LIST_MAPPED_ONLY);
  assert.equal(writeLaunchListMappedOnly(true, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_MAPPED_ONLY_STORAGE_KEY), '1');
  assert.equal(readLaunchListMappedOnly(storage), true);
  assert.equal(readLaunchListMappedOnly(memoryStorage(storage.snapshot())), true, 'reload keeps on');

  const restored = launchesPanelRows({ results: MIXED }, 'all', {
    mappedOnly: readLaunchListMappedOnly(memoryStorage(storage.snapshot())),
  });
  assert.deepEqual(restored.map((row) => row.id), ['ll2-starlink', 'll2-sls']);

  assert.equal(writeLaunchListMappedOnly(false, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_MAPPED_ONLY_STORAGE_KEY), '0');
  assert.equal(readLaunchListMappedOnly(memoryStorage(storage.snapshot())), false, 'reload keeps off');
  assert.equal(writeLaunchListMappedOnly('nope', storage), false);
  assert.equal(storage.getItem(LAUNCH_LIST_MAPPED_ONLY_STORAGE_KEY), '0');
});

test('rocketLaunches.js is unchanged', () => {
  const rocket = read('src/data/rocketLaunches.js');
  assert.doesNotMatch(rocket, /launchListMapped|launchListMappedFilter|meridian\.launchListMappedOnly/);
  assert.doesNotMatch(rocket, /filterLaunchListByMappedOnly|readLaunchListMappedOnly|writeLaunchListMappedOnly/);
});

test('AND with existing LSP-type chips; off still keeps no-coord rows', () => {
  assert.deepEqual(
    filterLaunchesByLspType(MIXED, 'commercial').map((row) => row.id),
    ['ll2-starlink', 'll2-secret-pad'],
  );
  const commercialOff = launchesPanelRows({ results: MIXED }, 'commercial');
  assert.deepEqual(commercialOff.map((row) => row.id), ['ll2-starlink', 'll2-secret-pad']);
  assert.equal(commercialOff[1].lat, null);

  const commercialOn = launchesPanelRows({ results: MIXED }, 'commercial', { mappedOnly: true });
  assert.deepEqual(commercialOn.map((row) => row.id), ['ll2-starlink']);

  const governmentOn = launchesPanelRows({ results: MIXED }, 'government', { mappedOnly: true });
  assert.deepEqual(governmentOn.map((row) => row.id), ['ll2-sls']);
});

test('LayerStateCoordinator restore keeps meridian.launchListMappedOnly and does not write a share URL', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['rocket-launches']?.launchListMappedOnly, undefined);
  assert.equal(defaults.options['rocket-launches']?.mappedOnly, undefined);

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['rocket-launches'],
    options: { 'rocket-launches': { launchListMappedOnly: true, mappedOnly: true } },
  }));
  assert.doesNotMatch(encoded.toString(), /launchListMappedOnly|meridian\.launchListMappedOnly/);
  assert.doesNotMatch(encoded.get('lo') || '', /launchListMappedOnly|mappedOnly|listMapped/);
  const decoded = decodeLayerStateParams(encoded);
  assert.equal(decoded.options['rocket-launches']?.launchListMappedOnly, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'rocket-launches')?.launchListMappedOnly, undefined);

  const storage = memoryStorage({ [LAUNCH_LIST_MAPPED_ONLY_STORAGE_KEY]: '1' });
  assert.equal(readLaunchListMappedOnly(storage), true, 'coordinator restore of layer options does not wipe the list key');
});

test('chip sits on the hosted Launches panel and re-applies the existing /api/launches payload', () => {
  const helper = read('src/data/launchListMappedFilter.js');
  const panel = read('src/data/launchesPanel.js');
  const html = read('index.html');
  const ui = read('src/ui.js');
  const css = read('style.css');
  const rocket = read('src/data/rocketLaunches.js');
  const launches = read('src/data/launches.js');
  const layerState = read('src/data/layerState.js');
  const sharelink = read('src/sharelink.js');
  const firstRun = read('src/firstRunExperience.js');
  const license = read('LICENSE');
  const readme = read('README.md');

  assert.match(helper, /meridian\.launchListMappedOnly/);
  assert.match(helper, /Number\.isFinite/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(/);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);

  assert.match(panel, /filterLaunchListByMappedOnly|launchListRowMatchesMappedFilter/);
  assert.match(panel, /launchesPanelRows\(/);
  assert.doesNotMatch(panel, /\/api\/(?!launches\b)/);

  assert.match(html, /id="launches-panel"/);
  assert.match(html, /id="launches-panel-lsp-chips"/);
  assert.match(html, /id="launches-panel-mapped-chips"/);
  assert.match(html, /data-launch-list-mapped="only"/);
  assert.match(html, /Hide missions without a flyable pad/);
  assert.ok(
    html.indexOf('id="launches-panel-lsp-chips"') < html.indexOf('id="launches-panel-mapped-chips"'),
    'Mapped only sits after the LSP-type chips',
  );
  assert.ok(
    html.indexOf('id="launches-panel"') < html.indexOf('id="launches-panel-mapped-chips"'),
    'Mapped only lives on the hosted Launches panel',
  );
  assert.ok(
    html.indexOf('data-launch-list-mapped="only"') < html.indexOf('id="earthquake-list-panel"'),
    'Mapped only stays on the launches panel, not later list chrome',
  );

  assert.match(ui, /readLaunchListMappedOnly/);
  assert.match(ui, /writeLaunchListMappedOnly/);
  assert.match(ui, /data-launch-list-mapped/);
  assert.match(css, /launches-panel-mapped-chip/);

  assert.doesNotMatch(rocket, /launchListMapped|meridian\.launchListMappedOnly/);
  assert.doesNotMatch(launches, /launchListMapped|meridian\.launchListMappedOnly/);
  assert.doesNotMatch(layerState, /launchListMappedOnly|launchListMapped/);
  assert.doesNotMatch(sharelink, /launchListMappedOnly|meridian\.launchListMappedOnly/);
  assert.match(firstRun, /meridian\.launchListMappedOnly/);
  assert.doesNotMatch(
    firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun')),
    /writeLaunchListMappedOnly|readLaunchListMappedOnly/,
  );

  assert.equal(existsSync(path.join(ROOT, 'api/launches/mapped.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(readme, /quantum-earth/);

  assert.equal(launchListMappedOnlyChipModel(false).params.mappedOnly, true);
  assert.equal(launchListMappedOnlyChipModel(true).params.mappedOnly, false);
  assert.equal(launchListMappedOnlyChipModel(false).label, 'Mapped only');
});
