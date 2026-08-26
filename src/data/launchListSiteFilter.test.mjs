// PLAN 239 — Launches panel Hide no site toggle. Client-only filter of
// already-fetched LL2 rows. Distinct from 207 LSP-type, 215 mapped-only,
// 223 status, 232 Hide no provider, and 181 hide-unknown-site.
// rocketLaunches.js stays unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_SITE,
  LAUNCH_LIST_HIDE_NO_SITE_CHIP_LABEL,
  LAUNCH_LIST_HIDE_NO_SITE_CHIP_TITLE,
  LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY,
  LAUNCH_LIST_UNKNOWN_SITE_LABEL,
  filterLaunchListBySite,
  launchListHideNoSiteChipModel,
  launchListRowHasNamedSite,
  launchListRowMatchesSiteFilter,
  launchListSiteName,
  normalizeLaunchListHideNoSite,
  readLaunchListHideNoSite,
  writeLaunchListHideNoSite,
} from './launchListSiteFilter.js';
import { launchesPanelRows } from './launchesPanel.js';
import { filterLaunchesByLspType } from './launchLspTypeFilter.js';
import { filterLaunchListByMappedOnly } from './launchListMappedFilter.js';
import { filterLaunchListByProvider } from './launchListProviderFilter.js';
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

const NAMED_SPACEX_GO = {
  id: 'll2-starlink',
  name: 'Falcon 9 | Starlink Group 10-1',
  net: '2026-08-20T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'SLC-40' },
};

const UNKNOWN_SITE_SPACEX = {
  id: 'll2-unknown-site',
  name: 'Falcon 9 | Undisclosed Pad',
  net: '2026-08-21T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.4', longitude: '-80.6', location: {} },
};

const EMPTY_SITE = {
  id: 'll2-empty-site',
  name: 'Empty Pad',
  net: '2026-08-22T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  launchSite: '',
  pad: { latitude: '28.5', longitude: '-80.5', name: '', location: { name: '' } },
};

const WHITESPACE_SITE = {
  id: 'll2-ws-site',
  name: 'Whitespace Pad',
  net: '2026-08-23T08:00:00Z',
  status: { name: 'TBD' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  launchSite: '   ',
  pad: { latitude: '28.6', longitude: '-80.4', name: '   ' },
};

const EXPLICIT_UNKNOWN = {
  id: 'll2-explicit-unknown',
  name: 'Fallback Pad',
  net: '2026-08-23T09:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  launchSite: 'Unknown launch site',
  pad: { latitude: '28.7', longitude: '-80.3', name: 'Unknown launch site' },
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

const NAMED_NO_COORDS = {
  id: 'll2-secret-named',
  name: 'Secret Falcon',
  net: '2026-08-26T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { name: 'Undisclosed', location: {} },
};

const UNKNOWN_NO_PROVIDER = {
  id: 'll2-ghost',
  name: 'Ghost Flight',
  net: '2026-08-27T08:00:00Z',
  status: { name: 'Go' },
  pad: { latitude: '28.1', longitude: '-80.1', location: {} },
};

const NAMED_NO_PROVIDER = {
  id: 'll2-no-provider',
  name: 'Classified Flight',
  net: '2026-08-28T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.2', longitude: '-80.2', name: 'SLC-41' },
};

const MIXED = Object.freeze([
  NAMED_SPACEX_GO,
  UNKNOWN_SITE_SPACEX,
  EMPTY_SITE,
  WHITESPACE_SITE,
  EXPLICIT_UNKNOWN,
  NASA_GO,
  SPACEX_TBD,
  NAMED_NO_COORDS,
  UNKNOWN_NO_PROVIDER,
  NAMED_NO_PROVIDER,
]);

test('off keeps Unknown launch site', () => {
  assert.equal(DEFAULT_LAUNCH_LIST_HIDE_NO_SITE, false);
  assert.equal(LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY, 'meridian.launchListHideNoSite');
  assert.equal(LAUNCH_LIST_HIDE_NO_SITE_CHIP_LABEL, 'Hide no site');
  assert.equal(LAUNCH_LIST_HIDE_NO_SITE_CHIP_TITLE, 'Hide missions without a named launch site');
  assert.equal(LAUNCH_LIST_UNKNOWN_SITE_LABEL, 'Unknown launch site');
  assert.equal(normalizeLaunchListHideNoSite(undefined), false);
  assert.equal(normalizeLaunchListHideNoSite(null), false);
  assert.equal(normalizeLaunchListHideNoSite(''), false);
  assert.equal(normalizeLaunchListHideNoSite(false), false);

  const rows = launchesPanelRows({ results: MIXED });
  assert.deepEqual(rows.map((row) => row.id), MIXED.map((row) => row.id));
  assert.equal(rows[0].launchSite, 'SLC-40');
  assert.equal(rows[1].launchSite, 'Unknown launch site');
  assert.equal(rows[2].launchSite, 'Unknown launch site');
  assert.equal(rows[3].launchSite, '   ');
  assert.equal(rows[4].launchSite, 'Unknown launch site');
  assert.equal(launchListRowMatchesSiteFilter(rows[1], false), true);
  assert.equal(launchListRowMatchesSiteFilter(rows[0], false), true);
  assert.deepEqual(
    filterLaunchListBySite(rows, false).map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterLaunchListBySite(null), []);
  assert.deepEqual(filterLaunchListBySite(undefined), []);
});

test('on keeps named pad, drops Unknown and empty', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', { hideNoSite: true });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['ll2-starlink', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider'],
  );
  assert.ok(!rows.some((row) => row.id === 'll2-unknown-site'));
  assert.ok(!rows.some((row) => row.id === 'll2-empty-site'));
  assert.ok(!rows.some((row) => row.id === 'll2-ws-site'));
  assert.ok(!rows.some((row) => row.id === 'll2-explicit-unknown'));
  assert.ok(!rows.some((row) => row.id === 'll2-ghost'));
  assert.ok(rows.some((row) => row.launchSite === 'SLC-40'));

  const built = launchesPanelRows({ results: MIXED });
  assert.equal(launchListRowHasNamedSite(built[0]), true);
  assert.equal(launchListRowHasNamedSite(built[1]), false);
  assert.equal(launchListRowHasNamedSite(built[2]), false);
  assert.equal(launchListRowHasNamedSite(built[3]), false);
  assert.equal(launchListRowHasNamedSite(built[4]), false);
  assert.equal(launchListRowHasNamedSite({}), false);
  assert.equal(launchListRowHasNamedSite({ launchSite: null }), false);
  assert.equal(launchListSiteName({ launchSite: ' SLC-40 ' }), 'SLC-40');
  assert.equal(launchListSiteName({ launchSite: '   ' }), '');
  assert.equal(launchListSiteName({ launchSite: '' }), '');
  assert.equal(launchListSiteName({}), '');
  assert.equal(launchListSiteName({ launchSite: 'Unknown launch site' }), 'Unknown launch site');
  assert.equal(launchListRowMatchesSiteFilter(built[0], true), true);
  assert.equal(launchListRowMatchesSiteFilter(built[1], true), false);
  assert.equal(launchListRowMatchesSiteFilter({ id: 'x', launchSite: '   ' }, true), false);
  assert.equal(launchListRowMatchesSiteFilter({ id: 'x' }, true), false);
  assert.equal(launchListRowMatchesSiteFilter({ id: 'x', launchSite: 'unknown launch site' }, true), false);
  assert.deepEqual(
    filterLaunchListBySite(built, true).map((row) => row.id),
    ['ll2-starlink', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider'],
  );
});

test('selected id always kept', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoSite: true,
    selectedId: 'll2-unknown-site',
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['ll2-starlink', 'll2-unknown-site', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider'],
  );
  assert.equal(
    launchListRowMatchesSiteFilter(
      { id: 'll2-unknown-site', launchSite: 'Unknown launch site' },
      true,
      { selectedId: 'll2-unknown-site' },
    ),
    true,
  );
  assert.deepEqual(
    filterLaunchListBySite(
      launchesPanelRows({ results: MIXED }),
      true,
      'll2-ws-site',
    ).map((row) => row.id),
    ['ll2-starlink', 'll2-ws-site', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider'],
  );
});

test('invalid storage reads as off', () => {
  assert.equal(normalizeLaunchListHideNoSite('bogus'), null);
  assert.equal(normalizeLaunchListHideNoSite('on'), null);
  assert.equal(readLaunchListHideNoSite(memoryStorage()), DEFAULT_LAUNCH_LIST_HIDE_NO_SITE);
  assert.equal(readLaunchListHideNoSite(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readLaunchListHideNoSite(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY]: 'yes',
  })), false);
  assert.equal(writeLaunchListHideNoSite('nope', memoryStorage()), false);
});

test('Persist flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(readLaunchListHideNoSite(storage), DEFAULT_LAUNCH_LIST_HIDE_NO_SITE);
  assert.equal(writeLaunchListHideNoSite(true, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY), '1');
  assert.equal(readLaunchListHideNoSite(storage), true);
  assert.equal(readLaunchListHideNoSite(memoryStorage(storage.snapshot())), true, 'reload keeps on');

  const restored = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoSite: readLaunchListHideNoSite(memoryStorage(storage.snapshot())),
  });
  assert.deepEqual(
    restored.map((row) => row.id),
    ['ll2-starlink', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider'],
  );

  assert.equal(writeLaunchListHideNoSite(false, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY), '0');
  assert.equal(readLaunchListHideNoSite(memoryStorage(storage.snapshot())), false, 'reload keeps off');
  assert.equal(writeLaunchListHideNoSite('nope', storage), false);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY), '0');
});

test('rocketLaunches.js is unchanged', () => {
  const rocket = read('src/data/rocketLaunches.js');
  assert.doesNotMatch(rocket, /launchListSite|launchListHideNoSite|meridian\.launchListHideNoSite/);
  assert.doesNotMatch(rocket, /filterLaunchListBySite|readLaunchListHideNoSite|writeLaunchListHideNoSite/);
});

test('AND with 207 LSP-type, 215 mapped-only, 223 status, 232 Hide no provider', () => {
  assert.deepEqual(
    filterLaunchesByLspType(MIXED, 'commercial').map((row) => row.id),
    [
      'll2-starlink',
      'll2-unknown-site',
      'll2-empty-site',
      'll2-ws-site',
      'll2-explicit-unknown',
      'll2-tbd',
      'll2-secret-named',
      'll2-no-provider',
    ],
  );
  const commercialOff = launchesPanelRows({ results: MIXED }, 'commercial');
  assert.deepEqual(
    commercialOff.map((row) => row.id),
    [
      'll2-starlink',
      'll2-unknown-site',
      'll2-empty-site',
      'll2-ws-site',
      'll2-explicit-unknown',
      'll2-tbd',
      'll2-secret-named',
      'll2-no-provider',
    ],
  );

  const commercialOn = launchesPanelRows({ results: MIXED }, 'commercial', { hideNoSite: true });
  assert.deepEqual(commercialOn.map((row) => row.id), ['ll2-starlink', 'll2-tbd', 'll2-secret-named', 'll2-no-provider']);

  const governmentOn = launchesPanelRows({ results: MIXED }, 'government', { hideNoSite: true });
  assert.deepEqual(governmentOn.map((row) => row.id), ['ll2-sls']);

  const mappedOn = launchesPanelRows({ results: MIXED }, 'all', {
    mappedOnly: true,
    hideNoSite: true,
  });
  assert.deepEqual(mappedOn.map((row) => row.id), ['ll2-starlink', 'll2-sls', 'll2-tbd', 'll2-no-provider']);
  assert.ok(!mappedOn.some((row) => row.id === 'll2-secret-named'));

  const statusGo = launchesPanelRows({ results: MIXED }, 'all', {
    statusFilter: 'go',
    hideNoSite: true,
  });
  assert.deepEqual(statusGo.map((row) => row.id), ['ll2-starlink', 'll2-sls', 'll2-secret-named', 'll2-no-provider']);
  assert.ok(!statusGo.some((row) => row.id === 'll2-tbd'));

  const providerOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProvider: true,
    hideNoSite: true,
  });
  assert.deepEqual(providerOn.map((row) => row.id), ['ll2-starlink', 'll2-sls', 'll2-tbd', 'll2-secret-named']);
  assert.ok(!providerOn.some((row) => row.id === 'll2-no-provider'));

  const allFour = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
    hideNoSite: true,
  });
  assert.deepEqual(allFour.map((row) => row.id), ['ll2-starlink']);

  const allFourSelected = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
    hideNoSite: true,
    selectedId: 'll2-unknown-site',
  });
  assert.deepEqual(allFourSelected.map((row) => row.id), ['ll2-starlink', 'll2-unknown-site']);

  const afterMapped = filterLaunchListByMappedOnly(launchesPanelRows({ results: MIXED }), true);
  const afterStatus = filterLaunchListByStatus(afterMapped, 'go');
  const afterProvider = filterLaunchListByProvider(afterStatus, true);
  assert.deepEqual(
    filterLaunchListBySite(afterProvider, true).map((row) => row.id),
    ['ll2-starlink', 'll2-sls'],
  );
});

test('LayerStateCoordinator restore keeps meridian.launchListHideNoSite and does not write a share URL', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['rocket-launches']?.launchListHideNoSite, undefined);
  assert.equal(defaults.options['rocket-launches']?.hideNoSite, undefined);

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['rocket-launches'],
    options: { 'rocket-launches': { launchListHideNoSite: true, hideNoSite: true } },
  }));
  assert.doesNotMatch(encoded.toString(), /launchListHideNoSite|meridian\.launchListHideNoSite/);
  assert.doesNotMatch(encoded.get('lo') || '', /launchListHideNoSite|hideNoSite|listSite/);
  const decoded = decodeLayerStateParams(encoded);
  assert.equal(decoded.options['rocket-launches']?.launchListHideNoSite, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'rocket-launches')?.launchListHideNoSite, undefined);

  const storage = memoryStorage({ [LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY]: '1' });
  assert.equal(readLaunchListHideNoSite(storage), true, 'coordinator restore of layer options does not wipe the list key');
});

test('chip sits on the hosted Launches panel and re-applies the existing /api/launches payload', () => {
  const helper = read('src/data/launchListSiteFilter.js');
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

  assert.match(helper, /meridian\.launchListHideNoSite/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(/);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);
  assert.notEqual(LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY, 'meridian.launchProvider');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY, 'meridian.launchLspType');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY, 'meridian.launchListMappedOnly');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY, 'meridian.launchListStatus');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY, 'meridian.launchListHideNoProvider');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_SITE_STORAGE_KEY, 'meridian.launchHideUnknownSite');

  assert.match(panel, /filterLaunchListBySite|launchListRowMatchesSiteFilter/);
  assert.match(panel, /launchesPanelRows\(/);
  assert.doesNotMatch(panel, /\/api\/(?!launches\b)/);

  assert.match(html, /id="launches-panel"/);
  assert.match(html, /id="launches-panel-site-chips"/);
  assert.match(html, /data-launch-list-hide-no-site="only"/);
  assert.match(html, /Hide no site/);
  assert.match(html, /Hide missions without a named launch site/);
  assert.ok(
    html.indexOf('id="launches-panel-provider-chips"') < html.indexOf('id="launches-panel-site-chips"'),
    'Hide no site sits after Hide no provider',
  );
  assert.ok(
    html.indexOf('id="launches-panel"') < html.indexOf('id="launches-panel-site-chips"'),
    'Hide no site lives on the hosted Launches panel',
  );
  assert.ok(
    html.indexOf('data-launch-list-hide-no-site="only"') < html.indexOf('id="earthquake-list-panel"'),
    'Hide no site stays on the launches panel, not later list chrome',
  );

  assert.match(ui, /readLaunchListHideNoSite/);
  assert.match(ui, /writeLaunchListHideNoSite/);
  assert.match(ui, /data-launch-list-hide-no-site/);
  assert.match(css, /launches-panel-site-chip/);

  assert.doesNotMatch(rocket, /launchListHideNoSite|meridian\.launchListHideNoSite/);
  assert.doesNotMatch(launches, /launchListHideNoSite|meridian\.launchListHideNoSite/);
  assert.doesNotMatch(layerState, /launchListHideNoSite|launchListSite/);
  assert.doesNotMatch(sharelink, /launchListHideNoSite|meridian\.launchListHideNoSite/);
  assert.match(firstRun, /meridian\.launchListHideNoSite/);
  assert.doesNotMatch(
    firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun')),
    /writeLaunchListHideNoSite|readLaunchListHideNoSite/,
  );
  assert.doesNotMatch(globeProvider, /meridian\.launchListHideNoSite|launchListSiteFilter/);
  assert.doesNotMatch(hideSite, /meridian\.launchListHideNoSite|launchListSiteFilter/);
  assert.doesNotMatch(hideProvider, /meridian\.launchListHideNoSite|launchListSiteFilter/);

  assert.equal(existsSync(path.join(ROOT, 'api/launches/site.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.doesNotMatch(helper, /hideUnknownSite|launchHideUnknownSite|meridian\.launchHideUnknownSite/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(readme, /quantum-earth/);

  assert.equal(launchListHideNoSiteChipModel(false).params.hideNoSite, true);
  assert.equal(launchListHideNoSiteChipModel(true).params.hideNoSite, false);
  assert.equal(launchListHideNoSiteChipModel(false).label, 'Hide no site');
});
