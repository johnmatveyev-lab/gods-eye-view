// PLAN 248 — Launches panel Hide no time toggle. Client-only filter of
// already-fetched LL2 rows. Distinct from 207 LSP-type, 215 mapped-only,
// 223 status, 232 Hide no provider, and 239 Hide no site.
// rocketLaunches.js stays unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_TIME,
  LAUNCH_LIST_HIDE_NO_TIME_CHIP_LABEL,
  LAUNCH_LIST_HIDE_NO_TIME_CHIP_TITLE,
  LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY,
  filterLaunchListByTime,
  launchListHideNoTimeChipModel,
  launchListLaunchTime,
  launchListRowHasParseableTime,
  launchListRowMatchesTimeFilter,
  normalizeLaunchListHideNoTime,
  readLaunchListHideNoTime,
  writeLaunchListHideNoTime,
} from './launchListTimeFilter.js';
import { launchesPanelRows } from './launchesPanel.js';
import { filterLaunchesByLspType } from './launchLspTypeFilter.js';
import { filterLaunchListByMappedOnly } from './launchListMappedFilter.js';
import { filterLaunchListByProvider } from './launchListProviderFilter.js';
import { filterLaunchListBySite } from './launchListSiteFilter.js';
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

const TIMED_SPACEX_GO = {
  id: 'll2-starlink',
  name: 'Falcon 9 | Starlink Group 10-1',
  net: '2026-08-20T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'SLC-40' },
};

const NULL_TIME_SPACEX = {
  id: 'll2-no-time',
  name: 'Falcon 9 | Undated Window',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.4', longitude: '-80.6', name: 'SLC-40' },
};

const UNPARSEABLE_NET = {
  id: 'll2-bad-net',
  name: 'Falcon 9 | Bad NET',
  net: 'not-a-date',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.5', longitude: '-80.5', name: 'SLC-40' },
};

const UNPARSEABLE_LAUNCH_TIME = {
  id: 'll2-tbd-time',
  name: 'Falcon 9 | TBD Clock',
  launchTime: 'TBD',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.55', longitude: '-80.55', name: 'SLC-40' },
};

const WINDOW_START_ONLY = {
  id: 'll2-window',
  name: 'Falcon 9 | Window Start',
  window_start: '2026-08-21T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.6', longitude: '-80.4', name: 'SLC-40' },
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

const TIMED_NO_COORDS = {
  id: 'll2-secret-named',
  name: 'Secret Falcon',
  net: '2026-08-26T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { name: 'Undisclosed', location: {} },
};

const TIMED_NO_PROVIDER = {
  id: 'll2-no-provider',
  name: 'Classified Flight',
  net: '2026-08-28T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.2', longitude: '-80.2', name: 'SLC-41' },
};

const TIMED_UNKNOWN_SITE = {
  id: 'll2-unknown-site',
  name: 'Falcon 9 | Undisclosed Pad',
  net: '2026-08-21T09:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.4', longitude: '-80.6', location: {} },
};

const NULL_TIME_UNKNOWN_SITE = {
  id: 'll2-ghost',
  name: 'Ghost Flight',
  status: { name: 'Go' },
  pad: { latitude: '28.1', longitude: '-80.1', location: {} },
};

const MIXED = Object.freeze([
  TIMED_SPACEX_GO,
  NULL_TIME_SPACEX,
  UNPARSEABLE_NET,
  UNPARSEABLE_LAUNCH_TIME,
  WINDOW_START_ONLY,
  NASA_GO,
  SPACEX_TBD,
  TIMED_NO_COORDS,
  TIMED_NO_PROVIDER,
  TIMED_UNKNOWN_SITE,
  NULL_TIME_UNKNOWN_SITE,
]);

test('off keeps null time', () => {
  assert.equal(DEFAULT_LAUNCH_LIST_HIDE_NO_TIME, false);
  assert.equal(LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY, 'meridian.launchListHideNoTime');
  assert.equal(LAUNCH_LIST_HIDE_NO_TIME_CHIP_LABEL, 'Hide no time');
  assert.equal(LAUNCH_LIST_HIDE_NO_TIME_CHIP_TITLE, 'Hide missions without a launch time');
  assert.equal(normalizeLaunchListHideNoTime(undefined), false);
  assert.equal(normalizeLaunchListHideNoTime(null), false);
  assert.equal(normalizeLaunchListHideNoTime(''), false);
  assert.equal(normalizeLaunchListHideNoTime(false), false);

  const rows = launchesPanelRows({ results: MIXED });
  assert.deepEqual(rows.map((row) => row.id), MIXED.map((row) => row.id));
  assert.equal(rows[0].launchTime, '2026-08-20T10:00:00.000Z');
  assert.equal(rows[1].launchTime, null);
  assert.equal(rows[2].launchTime, null);
  assert.equal(rows[3].launchTime, 'TBD');
  assert.equal(rows[4].launchTime, '2026-08-21T08:00:00.000Z');
  assert.equal(launchListRowMatchesTimeFilter(rows[1], false), true);
  assert.equal(launchListRowMatchesTimeFilter({ launchTime: null }, false), true);
  assert.equal(launchListRowMatchesTimeFilter(rows[0], false), true);
  assert.deepEqual(
    filterLaunchListByTime(rows, false).map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterLaunchListByTime(null), []);
  assert.deepEqual(filterLaunchListByTime(undefined), []);
});

test('on keeps an ISO time, drops null', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', { hideNoTime: true });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['ll2-starlink', 'll2-window', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site'],
  );
  assert.ok(rows.every((row) => Number.isFinite(Date.parse(row.launchTime))));
  assert.ok(!rows.some((row) => row.id === 'll2-no-time'));
  assert.ok(!rows.some((row) => row.id === 'll2-bad-net'));
  assert.ok(!rows.some((row) => row.id === 'll2-tbd-time'));
  assert.ok(!rows.some((row) => row.id === 'll2-ghost'));
  assert.ok(rows.some((row) => row.launchTime === '2026-08-20T10:00:00.000Z'));

  const built = launchesPanelRows({ results: MIXED });
  assert.equal(launchListRowHasParseableTime(built[0]), true);
  assert.equal(launchListRowHasParseableTime(built[1]), false);
  assert.equal(launchListRowHasParseableTime(built[2]), false);
  assert.equal(launchListRowHasParseableTime(built[3]), false);
  assert.equal(launchListRowHasParseableTime({}), false);
  assert.equal(launchListRowHasParseableTime({ launchTime: null }), false);
  assert.equal(launchListLaunchTime({ launchTime: '2026-08-20T10:00:00.000Z' }), '2026-08-20T10:00:00.000Z');
  assert.equal(launchListLaunchTime({ launchTime: '   ' }), '');
  assert.equal(launchListLaunchTime({ launchTime: '' }), '');
  assert.equal(launchListLaunchTime({}), '');
  assert.equal(launchListLaunchTime({ launchTime: 'TBD' }), 'TBD');
  assert.equal(launchListRowMatchesTimeFilter(built[0], true), true);
  assert.equal(launchListRowMatchesTimeFilter(built[1], true), false);
  assert.equal(launchListRowMatchesTimeFilter({ id: 'x', launchTime: null }, true), false);
  assert.equal(launchListRowMatchesTimeFilter({ id: 'x' }, true), false);
  assert.equal(launchListRowMatchesTimeFilter({ id: 'x', launchTime: 'TBD' }, true), false);
  assert.equal(launchListRowMatchesTimeFilter({ id: 'x', launchTime: '   ' }, true), false);
  assert.deepEqual(
    filterLaunchListByTime(built, true).map((row) => row.id),
    ['ll2-starlink', 'll2-window', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site'],
  );
});

test('selected id always kept', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoTime: true,
    selectedId: 'll2-no-time',
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['ll2-starlink', 'll2-no-time', 'll2-window', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site'],
  );
  assert.equal(
    launchListRowMatchesTimeFilter(
      { id: 'll2-no-time', launchTime: null },
      true,
      { selectedId: 'll2-no-time' },
    ),
    true,
  );
  assert.deepEqual(
    filterLaunchListByTime(
      launchesPanelRows({ results: MIXED }),
      true,
      'll2-tbd-time',
    ).map((row) => row.id),
    ['ll2-starlink', 'll2-tbd-time', 'll2-window', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site'],
  );
});

test('invalid storage reads as off', () => {
  assert.equal(normalizeLaunchListHideNoTime('bogus'), null);
  assert.equal(normalizeLaunchListHideNoTime('on'), null);
  assert.equal(readLaunchListHideNoTime(memoryStorage()), DEFAULT_LAUNCH_LIST_HIDE_NO_TIME);
  assert.equal(readLaunchListHideNoTime(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readLaunchListHideNoTime(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY]: 'yes',
  })), false);
  assert.equal(writeLaunchListHideNoTime('nope', memoryStorage()), false);
});

test('Persist flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(readLaunchListHideNoTime(storage), DEFAULT_LAUNCH_LIST_HIDE_NO_TIME);
  assert.equal(writeLaunchListHideNoTime(true, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY), '1');
  assert.equal(readLaunchListHideNoTime(storage), true);
  assert.equal(readLaunchListHideNoTime(memoryStorage(storage.snapshot())), true, 'reload keeps on');

  const restored = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoTime: readLaunchListHideNoTime(memoryStorage(storage.snapshot())),
  });
  assert.deepEqual(
    restored.map((row) => row.id),
    ['ll2-starlink', 'll2-window', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site'],
  );

  assert.equal(writeLaunchListHideNoTime(false, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY), '0');
  assert.equal(readLaunchListHideNoTime(memoryStorage(storage.snapshot())), false, 'reload keeps off');
  assert.equal(writeLaunchListHideNoTime('nope', storage), false);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY), '0');
});

test('rocketLaunches.js is unchanged', () => {
  const rocket = read('src/data/rocketLaunches.js');
  assert.doesNotMatch(rocket, /launchListTime|launchListHideNoTime|meridian\.launchListHideNoTime/);
  assert.doesNotMatch(rocket, /filterLaunchListByTime|readLaunchListHideNoTime|writeLaunchListHideNoTime/);
});

test('AND with 207 LSP-type, 215 mapped-only, 223 status, 232 Hide no provider, 239 Hide no site', () => {
  assert.deepEqual(
    filterLaunchesByLspType(MIXED, 'commercial').map((row) => row.id),
    [
      'll2-starlink',
      'll2-no-time',
      'll2-bad-net',
      'll2-tbd-time',
      'll2-window',
      'll2-tbd',
      'll2-secret-named',
      'll2-no-provider',
      'll2-unknown-site',
    ],
  );
  const commercialOff = launchesPanelRows({ results: MIXED }, 'commercial');
  assert.deepEqual(
    commercialOff.map((row) => row.id),
    [
      'll2-starlink',
      'll2-no-time',
      'll2-bad-net',
      'll2-tbd-time',
      'll2-window',
      'll2-tbd',
      'll2-secret-named',
      'll2-no-provider',
      'll2-unknown-site',
    ],
  );

  const commercialOn = launchesPanelRows({ results: MIXED }, 'commercial', { hideNoTime: true });
  assert.deepEqual(
    commercialOn.map((row) => row.id),
    ['ll2-starlink', 'll2-window', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site'],
  );

  const governmentOn = launchesPanelRows({ results: MIXED }, 'government', { hideNoTime: true });
  assert.deepEqual(governmentOn.map((row) => row.id), ['ll2-sls']);

  const mappedOn = launchesPanelRows({ results: MIXED }, 'all', {
    mappedOnly: true,
    hideNoTime: true,
  });
  assert.deepEqual(
    mappedOn.map((row) => row.id),
    ['ll2-starlink', 'll2-window', 'll2-sls', 'll2-tbd', 'll2-no-provider', 'll2-unknown-site'],
  );
  assert.ok(!mappedOn.some((row) => row.id === 'll2-secret-named'));

  const statusGo = launchesPanelRows({ results: MIXED }, 'all', {
    statusFilter: 'go',
    hideNoTime: true,
  });
  assert.deepEqual(
    statusGo.map((row) => row.id),
    ['ll2-starlink', 'll2-window', 'll2-sls', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site'],
  );
  assert.ok(!statusGo.some((row) => row.id === 'll2-tbd'));

  const providerOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProvider: true,
    hideNoTime: true,
  });
  assert.deepEqual(
    providerOn.map((row) => row.id),
    ['ll2-starlink', 'll2-window', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-unknown-site'],
  );
  assert.ok(!providerOn.some((row) => row.id === 'll2-no-provider'));

  const siteOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoSite: true,
    hideNoTime: true,
  });
  assert.deepEqual(
    siteOn.map((row) => row.id),
    ['ll2-starlink', 'll2-window', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider'],
  );
  assert.ok(!siteOn.some((row) => row.id === 'll2-unknown-site'));

  const allFive = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
    hideNoSite: true,
    hideNoTime: true,
  });
  assert.deepEqual(allFive.map((row) => row.id), ['ll2-starlink', 'll2-window']);

  const allFiveSelected = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
    hideNoSite: true,
    hideNoTime: true,
    selectedId: 'll2-no-time',
  });
  assert.deepEqual(allFiveSelected.map((row) => row.id), ['ll2-starlink', 'll2-no-time', 'll2-window']);

  const afterMapped = filterLaunchListByMappedOnly(launchesPanelRows({ results: MIXED }), true);
  const afterStatus = filterLaunchListByStatus(afterMapped, 'go');
  const afterProvider = filterLaunchListByProvider(afterStatus, true);
  const afterSite = filterLaunchListBySite(afterProvider, true);
  assert.deepEqual(
    filterLaunchListByTime(afterSite, true).map((row) => row.id),
    ['ll2-starlink', 'll2-window', 'll2-sls'],
  );
});

test('LayerStateCoordinator restore keeps meridian.launchListHideNoTime and does not write a share URL', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['rocket-launches']?.launchListHideNoTime, undefined);
  assert.equal(defaults.options['rocket-launches']?.hideNoTime, undefined);

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['rocket-launches'],
    options: { 'rocket-launches': { launchListHideNoTime: true, hideNoTime: true } },
  }));
  assert.doesNotMatch(encoded.toString(), /launchListHideNoTime|meridian\.launchListHideNoTime/);
  assert.doesNotMatch(encoded.get('lo') || '', /launchListHideNoTime|hideNoTime|listTime/);
  const decoded = decodeLayerStateParams(encoded);
  assert.equal(decoded.options['rocket-launches']?.launchListHideNoTime, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'rocket-launches')?.launchListHideNoTime, undefined);

  const storage = memoryStorage({ [LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY]: '1' });
  assert.equal(readLaunchListHideNoTime(storage), true, 'coordinator restore of layer options does not wipe the list key');
});

test('chip sits on the hosted Launches panel and re-applies the existing /api/launches payload', () => {
  const helper = read('src/data/launchListTimeFilter.js');
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
  const hideProvider = read('src/data/launchListProviderFilter.js');
  const listSite = read('src/data/launchListSiteFilter.js');

  assert.match(helper, /meridian\.launchListHideNoTime/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(/);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);
  assert.notEqual(LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY, 'meridian.launchProvider');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY, 'meridian.launchLspType');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY, 'meridian.launchListMappedOnly');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY, 'meridian.launchListStatus');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY, 'meridian.launchListHideNoProvider');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY, 'meridian.launchListHideNoSite');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_TIME_STORAGE_KEY, 'meridian.launchHideUnknownSite');

  assert.match(panel, /filterLaunchListByTime|launchListRowMatchesTimeFilter/);
  assert.match(panel, /launchesPanelRows\(/);
  assert.doesNotMatch(panel, /\/api\/(?!launches\b)/);

  assert.match(html, /id="launches-panel"/);
  assert.match(html, /id="launches-panel-time-chips"/);
  assert.match(html, /data-launch-list-hide-no-time="only"/);
  assert.match(html, /Hide no time/);
  assert.match(html, /Hide missions without a launch time/);
  assert.ok(
    html.indexOf('id="launches-panel-site-chips"') < html.indexOf('id="launches-panel-time-chips"'),
    'Hide no time sits after Hide no site',
  );
  assert.ok(
    html.indexOf('id="launches-panel"') < html.indexOf('id="launches-panel-time-chips"'),
    'Hide no time lives on the hosted Launches panel',
  );
  assert.ok(
    html.indexOf('data-launch-list-hide-no-time="only"') < html.indexOf('id="earthquake-list-panel"'),
    'Hide no time stays on the launches panel, not later list chrome',
  );

  assert.match(ui, /readLaunchListHideNoTime/);
  assert.match(ui, /writeLaunchListHideNoTime/);
  assert.match(ui, /data-launch-list-hide-no-time/);
  assert.match(css, /launches-panel-time-chip/);

  assert.doesNotMatch(rocket, /launchListHideNoTime|meridian\.launchListHideNoTime/);
  assert.doesNotMatch(launches, /launchListHideNoTime|meridian\.launchListHideNoTime/);
  assert.doesNotMatch(layerState, /launchListHideNoTime|launchListTime/);
  assert.doesNotMatch(sharelink, /launchListHideNoTime|meridian\.launchListHideNoTime/);
  assert.match(firstRun, /meridian\.launchListHideNoTime/);
  assert.doesNotMatch(
    firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun')),
    /writeLaunchListHideNoTime|readLaunchListHideNoTime/,
  );
  assert.doesNotMatch(globeProvider, /meridian\.launchListHideNoTime|launchListTimeFilter/);
  assert.doesNotMatch(hideSite, /meridian\.launchListHideNoTime|launchListTimeFilter/);
  assert.doesNotMatch(hideProvider, /meridian\.launchListHideNoTime|launchListTimeFilter/);
  assert.doesNotMatch(listSite, /meridian\.launchListHideNoTime|launchListTimeFilter/);

  assert.equal(existsSync(path.join(ROOT, 'api/launches/time.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.doesNotMatch(helper, /hideUnknownSite|launchHideUnknownSite|meridian\.launchHideUnknownSite/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(readme, /quantum-earth/);

  assert.equal(launchListHideNoTimeChipModel(false).params.hideNoTime, true);
  assert.equal(launchListHideNoTimeChipModel(true).params.hideNoTime, false);
  assert.equal(launchListHideNoTimeChipModel(false).label, 'Hide no time');
});
