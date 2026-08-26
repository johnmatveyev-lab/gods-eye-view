// PLAN 232 — Launches panel Hide no provider toggle. Client-only filter of
// already-fetched LL2 rows. Distinct from 207 LSP-type, 215 mapped-only,
// 223 status, and 181 hide-unknown-site (not hide-ground).
// rocketLaunches.js stays unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_PROVIDER,
  LAUNCH_LIST_HIDE_NO_PROVIDER_CHIP_LABEL,
  LAUNCH_LIST_HIDE_NO_PROVIDER_CHIP_TITLE,
  LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY,
  filterLaunchListByProvider,
  launchListHideNoProviderChipModel,
  launchListProviderName,
  launchListRowHasProvider,
  launchListRowMatchesProviderFilter,
  normalizeLaunchListHideNoProvider,
  readLaunchListHideNoProvider,
  writeLaunchListHideNoProvider,
} from './launchListProviderFilter.js';
import { launchesPanelRows } from './launchesPanel.js';
import { filterLaunchesByLspType } from './launchLspTypeFilter.js';
import { filterLaunchListByMappedOnly } from './launchListMappedFilter.js';
import { filterLaunchListByStatus } from './launchListStatusFilter.js';
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

const SPACEX_GO = {
  id: 'll2-starlink',
  name: 'Falcon 9 | Starlink Group 10-1',
  net: '2026-08-20T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'SLC-40' },
};

const MISSING_PROVIDER = {
  id: 'll2-no-provider',
  name: 'Classified Flight',
  net: '2026-08-21T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.4', longitude: '-80.6', name: 'Undisclosed' },
};

const EMPTY_PROVIDER = {
  id: 'll2-empty-provider',
  name: 'Empty Operator',
  net: '2026-08-22T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: '', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.5', longitude: '-80.5', name: 'SLC-41' },
};

const WHITESPACE_PROVIDER = {
  id: 'll2-ws-provider',
  name: 'Whitespace Operator',
  net: '2026-08-23T08:00:00Z',
  status: { name: 'TBD' },
  provider: '   ',
  launch_service_provider: { name: '   ', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.6', longitude: '-80.4', name: 'LC-39A' },
};

const NASA_GO = {
  id: 'll2-sls',
  name: 'SLS | Artemis',
  net: '2026-08-24T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'NASA', type: { id: 1, name: 'Government' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'LC-39B' },
};

const SPACEX_TBD = {
  id: 'll2-tbd',
  name: 'Falcon 9 | Weather Window',
  net: '2026-08-25T08:00:00Z',
  status: { name: 'TBD' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'SLC-40' },
};

const SPACEX_NO_COORDS = {
  id: 'll2-secret-spacex',
  name: 'Secret Falcon',
  net: '2026-08-26T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { name: 'Undisclosed', location: {} },
};

const MISSING_NO_COORDS = {
  id: 'll2-ghost',
  name: 'Ghost Flight',
  net: '2026-08-27T08:00:00Z',
  status: { name: 'Go' },
  pad: { name: 'Undisclosed', location: {} },
};

const MIXED = Object.freeze([
  SPACEX_GO,
  MISSING_PROVIDER,
  EMPTY_PROVIDER,
  WHITESPACE_PROVIDER,
  NASA_GO,
  SPACEX_TBD,
  SPACEX_NO_COORDS,
  MISSING_NO_COORDS,
]);

test('Off keeps missing + present', () => {
  assert.equal(DEFAULT_LAUNCH_LIST_HIDE_NO_PROVIDER, false);
  assert.equal(LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY, 'meridian.launchListHideNoProvider');
  assert.equal(LAUNCH_LIST_HIDE_NO_PROVIDER_CHIP_LABEL, 'Hide no provider');
  assert.equal(LAUNCH_LIST_HIDE_NO_PROVIDER_CHIP_TITLE, 'Hide missions without a named launch service provider');
  assert.equal(normalizeLaunchListHideNoProvider(undefined), false);
  assert.equal(normalizeLaunchListHideNoProvider(null), false);
  assert.equal(normalizeLaunchListHideNoProvider(''), false);
  assert.equal(normalizeLaunchListHideNoProvider(false), false);

  const rows = launchesPanelRows({ results: MIXED });
  assert.deepEqual(rows.map((row) => row.id), MIXED.map((row) => row.id));
  assert.equal(rows[0].provider, 'SpaceX');
  assert.equal(rows[1].provider, null);
  assert.equal(rows[2].provider, null);
  assert.equal(rows[3].provider, '   ');
  assert.equal(launchListRowMatchesProviderFilter(rows[1], false), true);
  assert.equal(launchListRowMatchesProviderFilter(rows[0], false), true);
  assert.deepEqual(
    filterLaunchListByProvider(rows, false).map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterLaunchListByProvider(null), []);
  assert.deepEqual(filterLaunchListByProvider(undefined), []);
});

test('On drops empty/whitespace, keeps SpaceX', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', { hideNoProvider: true });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['ll2-starlink', 'll2-sls', 'll2-tbd', 'll2-secret-spacex'],
  );
  assert.ok(!rows.some((row) => row.id === 'll2-no-provider'));
  assert.ok(!rows.some((row) => row.id === 'll2-empty-provider'));
  assert.ok(!rows.some((row) => row.id === 'll2-ws-provider'));
  assert.ok(!rows.some((row) => row.id === 'll2-ghost'));
  assert.ok(rows.some((row) => row.provider === 'SpaceX'));

  const built = launchesPanelRows({ results: MIXED });
  assert.equal(launchListRowHasProvider(built[0]), true);
  assert.equal(launchListRowHasProvider(built[1]), false);
  assert.equal(launchListRowHasProvider(built[2]), false);
  assert.equal(launchListRowHasProvider(built[3]), false);
  assert.equal(launchListProviderName({ provider: ' SpaceX ' }), 'SpaceX');
  assert.equal(launchListProviderName({ provider: '   ' }), '');
  assert.equal(launchListProviderName({ provider: '' }), '');
  assert.equal(launchListProviderName({}), '');
  assert.equal(launchListRowMatchesProviderFilter(built[0], true), true);
  assert.equal(launchListRowMatchesProviderFilter(built[1], true), false);
  assert.equal(launchListRowMatchesProviderFilter({ id: 'x', provider: '   ' }, true), false);
  assert.deepEqual(
    filterLaunchListByProvider(built, true).map((row) => row.id),
    ['ll2-starlink', 'll2-sls', 'll2-tbd', 'll2-secret-spacex'],
  );
});

test('Selected id always kept', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProvider: true,
    selectedId: 'll2-no-provider',
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['ll2-starlink', 'll2-no-provider', 'll2-sls', 'll2-tbd', 'll2-secret-spacex'],
  );
  assert.equal(
    launchListRowMatchesProviderFilter(
      { id: 'll2-no-provider', provider: null },
      true,
      { selectedId: 'll2-no-provider' },
    ),
    true,
  );
  assert.deepEqual(
    filterLaunchListByProvider(
      launchesPanelRows({ results: MIXED }),
      true,
      'll2-ws-provider',
    ).map((row) => row.id),
    ['ll2-starlink', 'll2-ws-provider', 'll2-sls', 'll2-tbd', 'll2-secret-spacex'],
  );
});

test('Invalid storage reads as off', () => {
  assert.equal(normalizeLaunchListHideNoProvider('bogus'), null);
  assert.equal(normalizeLaunchListHideNoProvider('on'), null);
  assert.equal(readLaunchListHideNoProvider(memoryStorage()), DEFAULT_LAUNCH_LIST_HIDE_NO_PROVIDER);
  assert.equal(readLaunchListHideNoProvider(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readLaunchListHideNoProvider(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY]: 'yes',
  })), false);
  assert.equal(writeLaunchListHideNoProvider('nope', memoryStorage()), false);
});

test('Persist flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(readLaunchListHideNoProvider(storage), DEFAULT_LAUNCH_LIST_HIDE_NO_PROVIDER);
  assert.equal(writeLaunchListHideNoProvider(true, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY), '1');
  assert.equal(readLaunchListHideNoProvider(storage), true);
  assert.equal(readLaunchListHideNoProvider(memoryStorage(storage.snapshot())), true, 'reload keeps on');

  const restored = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProvider: readLaunchListHideNoProvider(memoryStorage(storage.snapshot())),
  });
  assert.deepEqual(
    restored.map((row) => row.id),
    ['ll2-starlink', 'll2-sls', 'll2-tbd', 'll2-secret-spacex'],
  );

  assert.equal(writeLaunchListHideNoProvider(false, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY), '0');
  assert.equal(readLaunchListHideNoProvider(memoryStorage(storage.snapshot())), false, 'reload keeps off');
  assert.equal(writeLaunchListHideNoProvider('nope', storage), false);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY), '0');
});

test('rocketLaunches.js is unchanged', () => {
  const rocket = read('src/data/rocketLaunches.js');
  assert.doesNotMatch(rocket, /launchListProvider|launchListHideNoProvider|meridian\.launchListHideNoProvider/);
  assert.doesNotMatch(rocket, /filterLaunchListByProvider|readLaunchListHideNoProvider|writeLaunchListHideNoProvider/);
});

test('AND with 207 LSP-type, 215 mapped-only, 223 status', () => {
  assert.deepEqual(
    filterLaunchesByLspType(MIXED, 'commercial').map((row) => row.id),
    ['ll2-starlink', 'll2-no-provider', 'll2-empty-provider', 'll2-ws-provider', 'll2-tbd', 'll2-secret-spacex'],
  );
  const commercialOff = launchesPanelRows({ results: MIXED }, 'commercial');
  assert.deepEqual(
    commercialOff.map((row) => row.id),
    ['ll2-starlink', 'll2-no-provider', 'll2-empty-provider', 'll2-ws-provider', 'll2-tbd', 'll2-secret-spacex'],
  );

  const commercialOn = launchesPanelRows({ results: MIXED }, 'commercial', { hideNoProvider: true });
  assert.deepEqual(commercialOn.map((row) => row.id), ['ll2-starlink', 'll2-tbd', 'll2-secret-spacex']);

  const governmentOn = launchesPanelRows({ results: MIXED }, 'government', { hideNoProvider: true });
  assert.deepEqual(governmentOn.map((row) => row.id), ['ll2-sls']);

  const mappedOn = launchesPanelRows({ results: MIXED }, 'all', {
    mappedOnly: true,
    hideNoProvider: true,
  });
  assert.deepEqual(mappedOn.map((row) => row.id), ['ll2-starlink', 'll2-sls', 'll2-tbd']);
  assert.ok(!mappedOn.some((row) => row.id === 'll2-secret-spacex'));

  const statusGo = launchesPanelRows({ results: MIXED }, 'all', {
    statusFilter: 'go',
    hideNoProvider: true,
  });
  assert.deepEqual(statusGo.map((row) => row.id), ['ll2-starlink', 'll2-sls', 'll2-secret-spacex']);
  assert.ok(!statusGo.some((row) => row.id === 'll2-tbd'));

  const allThree = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
  });
  assert.deepEqual(allThree.map((row) => row.id), ['ll2-starlink']);

  const allThreeSelected = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
    selectedId: 'll2-no-provider',
  });
  assert.deepEqual(allThreeSelected.map((row) => row.id), ['ll2-starlink', 'll2-no-provider']);

  const afterMapped = filterLaunchListByMappedOnly(launchesPanelRows({ results: MIXED }), true);
  const afterStatus = filterLaunchListByStatus(afterMapped, 'go');
  assert.deepEqual(
    filterLaunchListByProvider(afterStatus, true).map((row) => row.id),
    ['ll2-starlink', 'll2-sls'],
  );
});

test('LayerStateCoordinator restore keeps meridian.launchListHideNoProvider and does not write a share URL', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['rocket-launches']?.launchListHideNoProvider, undefined);
  assert.equal(defaults.options['rocket-launches']?.hideNoProvider, undefined);

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['rocket-launches'],
    options: { 'rocket-launches': { launchListHideNoProvider: true, hideNoProvider: true } },
  }));
  assert.doesNotMatch(encoded.toString(), /launchListHideNoProvider|meridian\.launchListHideNoProvider/);
  assert.doesNotMatch(encoded.get('lo') || '', /launchListHideNoProvider|hideNoProvider|listProvider/);
  const decoded = decodeLayerStateParams(encoded);
  assert.equal(decoded.options['rocket-launches']?.launchListHideNoProvider, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'rocket-launches')?.launchListHideNoProvider, undefined);

  const storage = memoryStorage({ [LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY]: '1' });
  assert.equal(readLaunchListHideNoProvider(storage), true, 'coordinator restore of layer options does not wipe the list key');
});

test('chip sits on the hosted Launches panel and re-applies the existing /api/launches payload', () => {
  const helper = read('src/data/launchListProviderFilter.js');
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
  const globeProvider = read('src/data/launchProviderFilter.js');
  const hideSite = read('src/data/launchUnknownSiteFilter.js');

  assert.match(helper, /meridian\.launchListHideNoProvider/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(/);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY, 'meridian.launchProvider');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY, 'meridian.launchLspType');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY, 'meridian.launchListMappedOnly');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY, 'meridian.launchListStatus');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROVIDER_STORAGE_KEY, 'meridian.launchHideUnknownSite');

  assert.match(panel, /filterLaunchListByProvider|launchListRowMatchesProviderFilter/);
  assert.match(panel, /launchesPanelRows\(/);
  assert.doesNotMatch(panel, /\/api\/(?!launches\b)/);

  assert.match(html, /id="launches-panel"/);
  assert.match(html, /id="launches-panel-provider-chips"/);
  assert.match(html, /data-launch-list-hide-no-provider="only"/);
  assert.match(html, /Hide no provider/);
  assert.match(html, /Hide missions without a named launch service provider/);
  assert.ok(
    html.indexOf('id="launches-panel-status-chips"') < html.indexOf('id="launches-panel-provider-chips"'),
    'Hide no provider sits after the status chips',
  );
  assert.ok(
    html.indexOf('id="launches-panel"') < html.indexOf('id="launches-panel-provider-chips"'),
    'Hide no provider lives on the hosted Launches panel',
  );
  assert.ok(
    html.indexOf('data-launch-list-hide-no-provider="only"') < html.indexOf('id="earthquake-list-panel"'),
    'Hide no provider stays on the launches panel, not later list chrome',
  );

  assert.match(ui, /readLaunchListHideNoProvider/);
  assert.match(ui, /writeLaunchListHideNoProvider/);
  assert.match(ui, /data-launch-list-hide-no-provider/);
  assert.match(css, /launches-panel-provider-chip/);

  assert.doesNotMatch(rocket, /launchListHideNoProvider|meridian\.launchListHideNoProvider/);
  assert.doesNotMatch(launches, /launchListHideNoProvider|meridian\.launchListHideNoProvider/);
  assert.doesNotMatch(layerState, /launchListHideNoProvider|launchListProvider/);
  assert.doesNotMatch(sharelink, /launchListHideNoProvider|meridian\.launchListHideNoProvider/);
  assert.match(firstRun, /meridian\.launchListHideNoProvider/);
  assert.doesNotMatch(
    firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun')),
    /writeLaunchListHideNoProvider|readLaunchListHideNoProvider/,
  );
  assert.doesNotMatch(globeProvider, /meridian\.launchListHideNoProvider|launchListProviderFilter/);
  assert.doesNotMatch(hideSite, /meridian\.launchListHideNoProvider|launchListProviderFilter/);

  assert.equal(existsSync(path.join(ROOT, 'api/launches/provider.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js|hide-ground/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(readme, /quantum-earth/);

  assert.equal(launchListHideNoProviderChipModel(false).params.hideNoProvider, true);
  assert.equal(launchListHideNoProviderChipModel(true).params.hideNoProvider, false);
  assert.equal(launchListHideNoProviderChipModel(false).label, 'Hide no provider');
});
