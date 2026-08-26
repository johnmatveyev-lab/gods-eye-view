// PLAN 223 — Launches panel: exclusive All | Go | TBD chips on
// already-copied launch.status.name. Persist meridian.launchListStatus.
// Re-filter the already-fetched Launch Library 2 payload. No extra /api.
// Distinct from 207 LSP-type, 215 mapped-only, and globe 191 status chips.
// rocketLaunches.js stays unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAUNCH_LIST_STATUS_FILTER,
  LAUNCH_LIST_STATUS_CHIP_IDS,
  LAUNCH_LIST_STATUS_CHIP_LABELS,
  LAUNCH_LIST_STATUS_STORAGE_KEY,
  filterLaunchListByStatus,
  getLaunchListStatusFilter,
  hydrateLaunchListStatusFilter,
  launchListRowMatchesStatusFilter,
  launchListStatusChipModels,
  launchListStatusName,
  normalizeLaunchListStatusFilter,
  readLaunchListStatusFilter,
  resetLaunchListStatusFilterForTest,
  setLaunchListStatusFilter,
  writeLaunchListStatusFilter,
} from './launchListStatusFilter.js';
import { launchesPanelRows } from './launchesPanel.js';
import { filterLaunchesByLspType } from './launchLspTypeFilter.js';
import { filterLaunchListByMappedOnly } from './launchListMappedFilter.js';
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

const GO = {
  id: 'll2-starlink',
  name: 'Falcon 9 | Starlink Group 10-1',
  net: '2026-08-20T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'SLC-40' },
};

const TBD = {
  id: 'll2-tbd',
  name: 'Falcon 9 | Weather Window',
  net: '2026-08-21T10:00:00Z',
  status: { name: 'TBD' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'SLC-40' },
};

const HOLD = {
  id: 'll2-hold',
  name: 'SLS | Hold',
  net: '2026-08-22T08:00:00Z',
  status: { name: 'Hold' },
  launch_service_provider: { name: 'NASA', type: { id: 1, name: 'Government' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'LC-39B' },
};

const TBC = {
  id: 'll2-tbc',
  name: 'Electron | Confirm',
  net: '2026-08-23T08:00:00Z',
  status: { name: 'TBC' },
  launch_service_provider: { name: 'Rocket Lab', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '-39.26', longitude: '177.86', name: 'LC-1' },
};

const MISSING = {
  id: 'll2-missing',
  name: 'Classified Flight',
  net: '2026-08-24T08:00:00Z',
  launch_service_provider: { name: 'Unknown', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.4', longitude: '-80.6', name: 'Undisclosed' },
};

const UNKNOWN = {
  id: 'll2-unknown',
  name: 'Unknown Status',
  net: '2026-08-25T08:00:00Z',
  status: { name: 'Unknown' },
  launch_service_provider: { name: 'ULA', type: { id: 1, name: 'Government' } },
  pad: { latitude: '28.5', longitude: '-80.5', name: 'SLC-41' },
};

const GO_NO_COORDS = {
  id: 'll2-secret-go',
  name: 'Secret Go',
  net: '2026-08-26T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'Unknown', type: { id: 3, name: 'Commercial' } },
  pad: { name: 'Undisclosed', location: {} },
};

const MIXED = Object.freeze([GO, TBD, HOLD, TBC, MISSING, UNKNOWN, GO_NO_COORDS]);

test('All keeps Go/TBD/Hold', () => {
  assert.equal(DEFAULT_LAUNCH_LIST_STATUS_FILTER, 'all');
  assert.equal(LAUNCH_LIST_STATUS_STORAGE_KEY, 'meridian.launchListStatus');
  assert.deepEqual(LAUNCH_LIST_STATUS_CHIP_IDS, ['all', 'go', 'tbd']);
  assert.deepEqual(LAUNCH_LIST_STATUS_CHIP_LABELS, { all: 'All', go: 'Go', tbd: 'TBD' });
  assert.equal(normalizeLaunchListStatusFilter(null), 'all');
  assert.equal(normalizeLaunchListStatusFilter(''), 'all');
  assert.equal(normalizeLaunchListStatusFilter('0'), 'all');
  assert.equal(normalizeLaunchListStatusFilter('All'), 'all');

  const rows = launchesPanelRows({ results: MIXED });
  assert.deepEqual(rows.map((row) => row.id), MIXED.map((row) => row.id));
  assert.equal(rows[0].status, 'Go');
  assert.equal(rows[1].status, 'TBD');
  assert.equal(rows[2].status, 'Hold');
  assert.equal(launchListRowMatchesStatusFilter(rows[0], 'all'), true);
  assert.equal(launchListRowMatchesStatusFilter(rows[1], 'all'), true);
  assert.equal(launchListRowMatchesStatusFilter(rows[2], 'all'), true);
  assert.deepEqual(
    filterLaunchListByStatus(rows, 'all').map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterLaunchListByStatus(null), []);
  assert.deepEqual(filterLaunchListByStatus(undefined), []);
});

test('Go keeps Go drops TBD', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', { statusFilter: 'go' });
  assert.ok(rows.some((row) => row.id === 'll2-starlink'));
  assert.ok(rows.some((row) => row.id === 'll2-secret-go'));
  assert.ok(!rows.some((row) => row.id === 'll2-tbd'));
  assert.ok(!rows.some((row) => row.id === 'll2-tbc'));
  assert.ok(!rows.some((row) => row.id === 'll2-hold'));
  assert.equal(launchListStatusName({ status: ' GO ' }), 'GO');
  assert.equal(launchListRowMatchesStatusFilter({ id: 'x', status: 'go' }, 'go'), true);
  assert.equal(launchListRowMatchesStatusFilter({ id: 'x', status: 'TBD' }, 'go'), false);
  assert.equal(launchListRowMatchesStatusFilter({ id: 'x', status: 'Hold' }, 'go'), false);
  assert.deepEqual(
    filterLaunchListByStatus(launchesPanelRows({ results: MIXED }), 'go').map((row) => row.id),
    ['ll2-starlink', 'll2-missing', 'll2-unknown', 'll2-secret-go'],
  );
});

test('TBD keeps TBD/TBC drops Go', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', { statusFilter: 'tbd' });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['ll2-tbd', 'll2-tbc', 'll2-missing', 'll2-unknown'],
  );
  assert.ok(!rows.some((row) => row.id === 'll2-starlink'));
  assert.ok(!rows.some((row) => row.id === 'll2-hold'));
  assert.equal(launchListRowMatchesStatusFilter({ id: 'x', status: 'tbd' }, 'tbd'), true);
  assert.equal(launchListRowMatchesStatusFilter({ id: 'x', status: 'TBC' }, 'tbd'), true);
  assert.equal(launchListRowMatchesStatusFilter({ id: 'x', status: 'Go' }, 'tbd'), false);
  assert.equal(launchListRowMatchesStatusFilter({ id: 'x', status: 'Hold' }, 'tbd'), false);
});

test('Missing status stays', () => {
  const rows = launchesPanelRows({ results: [MISSING, UNKNOWN, GO, TBD] }, 'all', {
    statusFilter: 'go',
  });
  assert.ok(rows.some((row) => row.id === 'll2-missing'));
  assert.ok(rows.some((row) => row.id === 'll2-unknown'));
  assert.equal(launchListStatusName({}), '');
  assert.equal(launchListStatusName({ status: null }), '');
  assert.equal(launchListRowMatchesStatusFilter({ id: 'x' }, 'go'), true);
  assert.equal(launchListRowMatchesStatusFilter({ id: 'x', status: 'Unknown' }, 'tbd'), true);
  assert.equal(launchListRowMatchesStatusFilter({ id: 'x', status: { name: 'unknown' } }, 'go'), true);
});

test('Selected id always kept', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', {
    statusFilter: 'go',
    selectedId: 'll2-tbd',
  });
  assert.ok(rows.some((row) => row.id === 'll2-tbd'));
  assert.ok(rows.some((row) => row.id === 'll2-starlink'));
  assert.equal(
    launchListRowMatchesStatusFilter(
      { id: 'll2-tbd', status: 'TBD' },
      'go',
      { selectedId: 'll2-tbd' },
    ),
    true,
  );
  assert.deepEqual(
    filterLaunchListByStatus(
      launchesPanelRows({ results: MIXED }),
      'tbd',
      'll2-starlink',
    ).map((row) => row.id),
    ['ll2-starlink', 'll2-tbd', 'll2-tbc', 'll2-missing', 'll2-unknown'],
  );
});

test('Invalid storage reads as All', () => {
  assert.equal(normalizeLaunchListStatusFilter('bogus'), 'all');
  assert.equal(normalizeLaunchListStatusFilter('hold'), 'all');
  assert.equal(normalizeLaunchListStatusFilter('in-flight'), 'all');
  assert.equal(normalizeLaunchListStatusFilter('tbc'), 'all');
  assert.equal(readLaunchListStatusFilter(memoryStorage()), DEFAULT_LAUNCH_LIST_STATUS_FILTER);
  assert.equal(readLaunchListStatusFilter(memoryStorage({
    [LAUNCH_LIST_STATUS_STORAGE_KEY]: 'nope',
  })), 'all');
  assert.equal(readLaunchListStatusFilter(memoryStorage({
    [LAUNCH_LIST_STATUS_STORAGE_KEY]: 'hold',
  })), 'all');
  assert.equal(writeLaunchListStatusFilter('go', memoryStorage()), true);
});

test('Persist flip survives reload', () => {
  resetLaunchListStatusFilterForTest();
  const storage = memoryStorage();
  assert.equal(readLaunchListStatusFilter(storage), DEFAULT_LAUNCH_LIST_STATUS_FILTER);
  assert.equal(setLaunchListStatusFilter('go', { storage }), 'go');
  assert.equal(storage.getItem(LAUNCH_LIST_STATUS_STORAGE_KEY), 'go');
  assert.equal(getLaunchListStatusFilter(), 'go');

  resetLaunchListStatusFilterForTest();
  assert.equal(getLaunchListStatusFilter(), DEFAULT_LAUNCH_LIST_STATUS_FILTER);
  assert.equal(hydrateLaunchListStatusFilter(storage), 'go');
  assert.equal(getLaunchListStatusFilter(), 'go');
  assert.equal(readLaunchListStatusFilter(memoryStorage(storage.snapshot())), 'go', 'reload keeps Go');

  const restored = launchesPanelRows({ results: MIXED }, 'all', {
    statusFilter: readLaunchListStatusFilter(memoryStorage(storage.snapshot())),
  });
  assert.ok(restored.every((row) => row.status === 'Go' || row.status === 'Unknown'));
  assert.ok(!restored.some((row) => row.id === 'll2-tbd'));

  writeLaunchListStatusFilter(DEFAULT_LAUNCH_LIST_STATUS_FILTER, storage);
  assert.equal(storage.getItem(LAUNCH_LIST_STATUS_STORAGE_KEY), 'all');
  assert.equal(readLaunchListStatusFilter(memoryStorage(storage.snapshot())), 'all', 'reload keeps All');
  resetLaunchListStatusFilterForTest();
});

test('rocketLaunches.js is unchanged', () => {
  const rocket = read('src/data/rocketLaunches.js');
  assert.doesNotMatch(rocket, /launchListStatus|launchListStatusFilter|meridian\.launchListStatus/);
  assert.doesNotMatch(rocket, /filterLaunchListByStatus|readLaunchListStatusFilter|writeLaunchListStatusFilter/);
  assert.doesNotMatch(rocket, /data-launch-list-status|launches-panel-status-chip/);
});

test('AND with existing LSP-type and mapped-only chips', () => {
  assert.deepEqual(
    filterLaunchesByLspType(MIXED, 'commercial').map((row) => row.id),
    ['ll2-starlink', 'll2-tbd', 'll2-tbc', 'll2-missing', 'll2-secret-go'],
  );
  const commercialAll = launchesPanelRows({ results: MIXED }, 'commercial');
  assert.deepEqual(
    commercialAll.map((row) => row.id),
    ['ll2-starlink', 'll2-tbd', 'll2-tbc', 'll2-missing', 'll2-secret-go'],
  );

  const commercialGo = launchesPanelRows({ results: MIXED }, 'commercial', { statusFilter: 'go' });
  assert.deepEqual(commercialGo.map((row) => row.id), ['ll2-starlink', 'll2-missing', 'll2-secret-go']);

  const mappedGo = launchesPanelRows({ results: MIXED }, 'all', {
    mappedOnly: true,
    statusFilter: 'go',
  });
  assert.deepEqual(mappedGo.map((row) => row.id), ['ll2-starlink', 'll2-missing', 'll2-unknown']);
  assert.ok(!mappedGo.some((row) => row.id === 'll2-secret-go'));

  const mappedTbdSelected = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'tbd',
    selectedId: 'll2-secret-go',
  });
  assert.deepEqual(
    mappedTbdSelected.map((row) => row.id),
    ['ll2-tbd', 'll2-tbc', 'll2-missing', 'll2-secret-go'],
  );

  const afterMapped = filterLaunchListByMappedOnly(
    launchesPanelRows({ results: MIXED }),
    true,
  );
  assert.deepEqual(
    filterLaunchListByStatus(afterMapped, 'go').map((row) => row.id),
    ['ll2-starlink', 'll2-missing', 'll2-unknown'],
  );
});

test('LayerStateCoordinator restore keeps meridian.launchListStatus and does not write a share URL', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['rocket-launches']?.launchListStatus, undefined);
  assert.equal(defaults.options['rocket-launches']?.statusFilter, undefined);

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['rocket-launches'],
    options: { 'rocket-launches': { launchListStatus: 'go', statusFilter: 'go' } },
  }));
  assert.doesNotMatch(encoded.toString(), /launchListStatus|meridian\.launchListStatus/);
  assert.doesNotMatch(encoded.get('lo') || '', /launchListStatus|listStatus|statusFilter/);
  const decoded = decodeLayerStateParams(encoded);
  assert.equal(decoded.options['rocket-launches']?.launchListStatus, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'rocket-launches')?.launchListStatus, undefined);

  const storage = memoryStorage({ [LAUNCH_LIST_STATUS_STORAGE_KEY]: 'tbd' });
  assert.equal(readLaunchListStatusFilter(storage), 'tbd', 'coordinator restore of layer options does not wipe the list key');
  resetLaunchListStatusFilterForTest();
  assert.equal(hydrateLaunchListStatusFilter(storage), 'tbd');
  resetLaunchListStatusFilterForTest();
});

test('chips sit on the hosted Launches panel and re-apply the existing /api/launches payload', () => {
  const helper = read('src/data/launchListStatusFilter.js');
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
  const globeStatus = read('src/data/launchStatusFilter.js');

  assert.match(helper, /meridian\.launchListStatus/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(/);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);
  assert.notEqual(LAUNCH_LIST_STATUS_STORAGE_KEY, 'meridian.launchStatus');
  assert.notEqual(LAUNCH_LIST_STATUS_STORAGE_KEY, 'meridian.launchLspType');
  assert.notEqual(LAUNCH_LIST_STATUS_STORAGE_KEY, 'meridian.launchListMappedOnly');

  assert.match(panel, /filterLaunchListByStatus|launchListRowMatchesStatusFilter/);
  assert.match(panel, /launchesPanelRows\(/);
  assert.doesNotMatch(panel, /\/api\/(?!launches\b)/);

  assert.match(html, /id="launches-panel"/);
  assert.match(html, /id="launches-panel-status-chips"/);
  assert.match(html, /data-launch-list-status="all"/);
  assert.match(html, /data-launch-list-status="go"/);
  assert.match(html, /data-launch-list-status="tbd"/);
  assert.ok(
    html.indexOf('id="launches-panel-mapped-chips"') < html.indexOf('id="launches-panel-status-chips"'),
    'Status chips sit after Mapped only',
  );
  assert.ok(
    html.indexOf('id="launches-panel"') < html.indexOf('id="launches-panel-status-chips"'),
    'Status chips live on the hosted Launches panel',
  );
  assert.ok(
    html.indexOf('data-launch-list-status="tbd"') < html.indexOf('id="earthquake-list-panel"'),
    'Status chips stay on the launches panel, not later list chrome',
  );

  assert.match(ui, /hydrateLaunchListStatusFilter/);
  assert.match(ui, /setLaunchListStatusFilter/);
  assert.match(ui, /data-launch-list-status/);
  assert.match(css, /launches-panel-status-chip/);

  assert.doesNotMatch(rocket, /launchListStatus|meridian\.launchListStatus/);
  assert.doesNotMatch(launches, /launchListStatus|meridian\.launchListStatus/);
  assert.doesNotMatch(layerState, /launchListStatus|launchListStatusFilter/);
  assert.doesNotMatch(sharelink, /launchListStatus|meridian\.launchListStatus/);
  assert.match(firstRun, /meridian\.launchListStatus/);
  assert.doesNotMatch(
    firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun')),
    /setLaunchListStatusFilter|writeLaunchListStatusFilter|hydrateLaunchListStatusFilter|readLaunchListStatusFilter/,
  );
  assert.doesNotMatch(globeStatus, /meridian\.launchListStatus|launchListStatusFilter/);

  assert.equal(existsSync(path.join(ROOT, 'api/launches/status.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(readme, /quantum-earth/);

  const models = launchListStatusChipModels('go');
  assert.deepEqual(models.map((chip) => chip.id), ['all', 'go', 'tbd']);
  assert.equal(models.filter((chip) => chip.active).length, 1);
  assert.equal(models.find((chip) => chip.id === 'go').active, true);
});
