// PLAN 272 — Launches panel Webcast only toggle. Client-only filter of
// already-fetched LL2 rows. Distinct from 207 LSP-type, 215 mapped-only,
// 223 status, 232 Hide no provider, 239 Hide no site, 248 Hide no time,
// 257 Hide no vehicle, 264 Hide no orbit, and globe Webcast only.
// rocketLaunches.js and launchRocketFilter.js stay unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAUNCH_LIST_WEBCAST_ONLY,
  LAUNCH_LIST_WEBCAST_ONLY_CHIP_LABEL,
  LAUNCH_LIST_WEBCAST_ONLY_CHIP_TITLE,
  LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY,
  filterLaunchListByWebcast,
  launchListRowHasWebcast,
  launchListRowMatchesWebcastFilter,
  launchListWebcastOnlyChipModel,
  normalizeLaunchListWebcastOnly,
  readLaunchListWebcastOnly,
  writeLaunchListWebcastOnly,
} from './launchListWebcastFilter.js';
import { launchesPanelRows } from './launchesPanel.js';
import { filterLaunchesByLspType } from './launchLspTypeFilter.js';
import { filterLaunchListByMappedOnly } from './launchListMappedFilter.js';
import { filterLaunchListByOrbit } from './launchListOrbitFilter.js';
import { filterLaunchListByProvider } from './launchListProviderFilter.js';
import { filterLaunchListBySite } from './launchListSiteFilter.js';
import { filterLaunchListByStatus } from './launchListStatusFilter.js';
import { filterLaunchListByTime } from './launchListTimeFilter.js';
import { filterLaunchListByVehicle } from './launchListVehicleFilter.js';
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

const LIVE_SPACEX_GO = {
  id: 'll2-starlink',
  name: 'Falcon 9 | Starlink Group 10-1',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-20T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'SLC-40' },
  webcast_live: true,
};

const NO_WEBCAST_SPACEX = {
  id: 'll2-no-webcast',
  name: 'Silent Falcon',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.4', longitude: '-80.6', name: 'SLC-40' },
};

const WEBCAST_FALSE = {
  id: 'll2-webcast-false',
  name: 'Flag False',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T11:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.41', longitude: '-80.61', name: 'SLC-40' },
  webcast_live: false,
};

const EMPTY_VID_URLS = {
  id: 'll2-empty-vids',
  name: 'Empty Vids',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T12:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.42', longitude: '-80.62', name: 'SLC-40' },
  webcast_live: false,
  vid_urls: [],
};

const EMPTY_VID_URLS_LEGACY = {
  id: 'll2-empty-legacy',
  name: 'Empty Legacy Vids',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T13:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.43', longitude: '-80.63', name: 'SLC-40' },
  vidURLs: [],
};

const VID_URLS = {
  id: 'll2-vids',
  name: 'Vid Stream',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-22T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.5', longitude: '-80.5', name: 'SLC-40' },
  webcast_live: false,
  vid_urls: [{ url: 'https://example.test/live' }],
};

const VID_URLS_LEGACY = {
  id: 'll2-legacy-vids',
  name: 'Legacy Vid Stream',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-22T09:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.51', longitude: '-80.51', name: 'SLC-40' },
  vidURLs: [{ url: 'https://example.test/legacy' }],
};

const CAMEL_LIVE = {
  id: 'll2-camel',
  name: 'Camel Live',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-23T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.52', longitude: '-80.52', name: 'SLC-40' },
  webcastLive: true,
};

const NASA_GO = {
  id: 'll2-sls',
  name: 'SLS | Artemis',
  rocketName: 'SLS',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-24T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'NASA', type: { id: 1, name: 'Government' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'LC-39B' },
  webcast_live: true,
};

const SPACEX_TBD = {
  id: 'll2-tbd',
  name: 'Falcon 9 | Weather Window',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-25T08:00:00Z',
  status: { name: 'TBD' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'SLC-40' },
  webcast_live: true,
};

const NAMED_NO_COORDS = {
  id: 'll2-secret-named',
  name: 'Secret Falcon',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-26T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { name: 'Undisclosed', location: {} },
  webcast_live: true,
};

const NAMED_NO_PROVIDER = {
  id: 'll2-no-provider',
  name: 'Classified Flight',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-28T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.2', longitude: '-80.2', name: 'SLC-41' },
  webcast_live: true,
};

const NAMED_UNKNOWN_SITE = {
  id: 'll2-unknown-site',
  name: 'Falcon 9 | Undisclosed Pad',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T09:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.4', longitude: '-80.6', location: {} },
  webcast_live: true,
};

const NAMED_NO_TIME = {
  id: 'll2-no-time',
  name: 'Falcon 9 | Undated Window',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.45', longitude: '-80.65', name: 'SLC-40' },
  webcast_live: true,
};

const NAMED_NO_VEHICLE = {
  id: 'll2-no-vehicle',
  name: 'Undisclosed Vehicle',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T13:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.46', longitude: '-80.66', name: 'SLC-40' },
  webcast_live: true,
};

const NAMED_NO_ORBIT = {
  id: 'll2-no-orbit',
  name: 'Undisclosed Orbit',
  rocketName: 'Falcon 9',
  net: '2026-08-21T14:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.47', longitude: '-80.67', name: 'SLC-40' },
  webcast_live: true,
};

const NO_WEBCAST_NO_TIME = {
  id: 'll2-ghost',
  name: 'Ghost Flight',
  status: { name: 'Go' },
  pad: { latitude: '28.1', longitude: '-80.1', location: {} },
};

const MIXED = Object.freeze([
  LIVE_SPACEX_GO,
  NO_WEBCAST_SPACEX,
  WEBCAST_FALSE,
  EMPTY_VID_URLS,
  EMPTY_VID_URLS_LEGACY,
  VID_URLS,
  VID_URLS_LEGACY,
  CAMEL_LIVE,
  NASA_GO,
  SPACEX_TBD,
  NAMED_NO_COORDS,
  NAMED_NO_PROVIDER,
  NAMED_UNKNOWN_SITE,
  NAMED_NO_TIME,
  NAMED_NO_VEHICLE,
  NAMED_NO_ORBIT,
  NO_WEBCAST_NO_TIME,
]);

const WEBCAST_IDS = [
  'll2-starlink',
  'll2-vids',
  'll2-legacy-vids',
  'll2-camel',
  'll2-sls',
  'll2-tbd',
  'll2-secret-named',
  'll2-no-provider',
  'll2-unknown-site',
  'll2-no-time',
  'll2-no-vehicle',
  'll2-no-orbit',
];

test('off keeps no-webcast rows', () => {
  assert.equal(DEFAULT_LAUNCH_LIST_WEBCAST_ONLY, false);
  assert.equal(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY, 'meridian.launchListWebcastOnly');
  assert.equal(LAUNCH_LIST_WEBCAST_ONLY_CHIP_LABEL, 'Webcast only');
  assert.equal(LAUNCH_LIST_WEBCAST_ONLY_CHIP_TITLE, 'Show only missions with a webcast');
  assert.equal(normalizeLaunchListWebcastOnly(undefined), false);
  assert.equal(normalizeLaunchListWebcastOnly(null), false);
  assert.equal(normalizeLaunchListWebcastOnly(''), false);
  assert.equal(normalizeLaunchListWebcastOnly(false), false);

  const rows = launchesPanelRows({ results: MIXED });
  assert.deepEqual(rows.map((row) => row.id), MIXED.map((row) => row.id));
  assert.equal(rows[0].webcast, true);
  assert.equal(rows[1].webcast, false);
  assert.equal(rows[2].webcast, false);
  assert.equal(rows[3].webcast, false);
  assert.equal(rows[4].webcast, false);
  assert.equal(rows[5].webcast, true);
  assert.equal(rows[6].webcast, true);
  assert.equal(rows[7].webcast, true);
  assert.equal(launchListRowMatchesWebcastFilter(rows[1], false), true);
  assert.equal(launchListRowMatchesWebcastFilter({ webcast: false }, false), true);
  assert.equal(launchListRowMatchesWebcastFilter({ webcast: null }, false), true);
  assert.equal(launchListRowMatchesWebcastFilter(rows[0], false), true);
  assert.deepEqual(
    filterLaunchListByWebcast(rows, false).map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterLaunchListByWebcast(null), []);
  assert.deepEqual(filterLaunchListByWebcast(undefined), []);
});

test('on hides false / missing / empty vid lists and keeps webcast_live or non-empty vid_urls', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', { webcastOnly: true });
  assert.deepEqual(rows.map((row) => row.id), WEBCAST_IDS);
  assert.ok(rows.every((row) => row.webcast === true));
  assert.ok(!rows.some((row) => row.id === 'll2-no-webcast'));
  assert.ok(!rows.some((row) => row.id === 'll2-webcast-false'));
  assert.ok(!rows.some((row) => row.id === 'll2-empty-vids'));
  assert.ok(!rows.some((row) => row.id === 'll2-empty-legacy'));
  assert.ok(!rows.some((row) => row.id === 'll2-ghost'));
  assert.ok(rows.some((row) => row.id === 'll2-starlink'));
  assert.ok(rows.some((row) => row.id === 'll2-vids'));

  const built = launchesPanelRows({ results: MIXED });
  assert.equal(launchListRowHasWebcast(built[0]), true);
  assert.equal(launchListRowHasWebcast(built[1]), false);
  assert.equal(launchListRowHasWebcast(built[2]), false);
  assert.equal(launchListRowHasWebcast(built[3]), false);
  assert.equal(launchListRowHasWebcast(built[4]), false);
  assert.equal(launchListRowHasWebcast({}), false);
  assert.equal(launchListRowHasWebcast({ webcast: false }), false);
  assert.equal(launchListRowHasWebcast({ webcast: true }), true);
  assert.equal(launchListRowHasWebcast({ webcast_live: true }), true);
  assert.equal(launchListRowHasWebcast({ webcastLive: true }), true);
  assert.equal(launchListRowHasWebcast({ vid_urls: [{ url: 'https://x' }] }), true);
  assert.equal(launchListRowHasWebcast({ vidURLs: [{ url: 'https://x' }] }), true);
  assert.equal(launchListRowHasWebcast({ webcast_live: false, vid_urls: [] }), false);
  assert.equal(launchListRowHasWebcast({ vidURLs: [] }), false);
  assert.equal(launchListRowMatchesWebcastFilter(built[0], true), true);
  assert.equal(launchListRowMatchesWebcastFilter(built[1], true), false);
  assert.equal(launchListRowMatchesWebcastFilter({ id: 'x', webcast: false }, true), false);
  assert.equal(launchListRowMatchesWebcastFilter({ id: 'x' }, true), false);
  assert.equal(launchListRowMatchesWebcastFilter({ id: 'x', webcast: null }, true), false);
  assert.deepEqual(
    filterLaunchListByWebcast(built, true).map((row) => row.id),
    WEBCAST_IDS,
  );
});

test('selected id always kept', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', {
    webcastOnly: true,
    selectedId: 'll2-no-webcast',
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['ll2-starlink', 'll2-no-webcast', 'll2-vids', 'll2-legacy-vids', 'll2-camel', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit'],
  );
  assert.equal(
    launchListRowMatchesWebcastFilter(
      { id: 'll2-no-webcast', webcast: false },
      true,
      { selectedId: 'll2-no-webcast' },
    ),
    true,
  );
  assert.deepEqual(
    filterLaunchListByWebcast(
      launchesPanelRows({ results: MIXED }),
      true,
      'll2-webcast-false',
    ).map((row) => row.id),
    ['ll2-starlink', 'll2-webcast-false', 'll2-vids', 'll2-legacy-vids', 'll2-camel', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit'],
  );
});

test('invalid storage reads as off', () => {
  assert.equal(normalizeLaunchListWebcastOnly('bogus'), null);
  assert.equal(normalizeLaunchListWebcastOnly('on'), null);
  assert.equal(readLaunchListWebcastOnly(memoryStorage()), DEFAULT_LAUNCH_LIST_WEBCAST_ONLY);
  assert.equal(readLaunchListWebcastOnly(memoryStorage({
    [LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readLaunchListWebcastOnly(memoryStorage({
    [LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY]: 'yes',
  })), false);
  assert.equal(writeLaunchListWebcastOnly('nope', memoryStorage()), false);
});

test('Persist flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(readLaunchListWebcastOnly(storage), DEFAULT_LAUNCH_LIST_WEBCAST_ONLY);
  assert.equal(writeLaunchListWebcastOnly(true, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY), '1');
  assert.equal(readLaunchListWebcastOnly(storage), true);
  assert.equal(readLaunchListWebcastOnly(memoryStorage(storage.snapshot())), true, 'reload keeps on');

  const restored = launchesPanelRows({ results: MIXED }, 'all', {
    webcastOnly: readLaunchListWebcastOnly(memoryStorage(storage.snapshot())),
  });
  assert.deepEqual(restored.map((row) => row.id), WEBCAST_IDS);

  assert.equal(writeLaunchListWebcastOnly(false, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY), '0');
  assert.equal(readLaunchListWebcastOnly(memoryStorage(storage.snapshot())), false, 'reload keeps off');
  assert.equal(writeLaunchListWebcastOnly('nope', storage), false);
  assert.equal(storage.getItem(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY), '0');
});

test('stay-off modules are unchanged', () => {
  const stayOff = [
    'src/data/rocketLaunches.js',
    'src/data/launchRocketFilter.js',
    'src/data/adsbLolFallback.js',
    'src/data/flights.js',
    'src/data/firmsHeatmap.js',
    'src/data/firmsList.js',
    'src/data/damsList.js',
    'src/data/datacenterList.js',
    'src/data/militaryAwareness.js',
    'src/data/localGeojson.js',
  ];
  for (const rel of stayOff) {
    const source = read(rel);
    assert.doesNotMatch(source, /launchListWebcast|launchListWebcastOnly|meridian\.launchListWebcastOnly/);
    assert.doesNotMatch(source, /filterLaunchListByWebcast|readLaunchListWebcastOnly|writeLaunchListWebcastOnly/);
  }
});

test('AND with 207 LSP-type, 215 mapped-only, 223 status, 232 Hide no provider, 239 Hide no site, 248 Hide no time, 257 Hide no vehicle, 264 Hide no orbit', () => {
  assert.deepEqual(
    filterLaunchesByLspType(MIXED, 'commercial').map((row) => row.id),
    [
      'll2-starlink',
      'll2-no-webcast',
      'll2-webcast-false',
      'll2-empty-vids',
      'll2-empty-legacy',
      'll2-vids',
      'll2-legacy-vids',
      'll2-camel',
      'll2-tbd',
      'll2-secret-named',
      'll2-no-provider',
      'll2-unknown-site',
      'll2-no-time',
      'll2-no-vehicle',
      'll2-no-orbit',
    ],
  );
  const commercialOff = launchesPanelRows({ results: MIXED }, 'commercial');
  assert.deepEqual(
    commercialOff.map((row) => row.id),
    [
      'll2-starlink',
      'll2-no-webcast',
      'll2-webcast-false',
      'll2-empty-vids',
      'll2-empty-legacy',
      'll2-vids',
      'll2-legacy-vids',
      'll2-camel',
      'll2-tbd',
      'll2-secret-named',
      'll2-no-provider',
      'll2-unknown-site',
      'll2-no-time',
      'll2-no-vehicle',
      'll2-no-orbit',
    ],
  );

  const commercialOn = launchesPanelRows({ results: MIXED }, 'commercial', { webcastOnly: true });
  assert.deepEqual(
    commercialOn.map((row) => row.id),
    ['ll2-starlink', 'll2-vids', 'll2-legacy-vids', 'll2-camel', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit'],
  );

  const governmentOn = launchesPanelRows({ results: MIXED }, 'government', { webcastOnly: true });
  assert.deepEqual(governmentOn.map((row) => row.id), ['ll2-sls']);

  const mappedOn = launchesPanelRows({ results: MIXED }, 'all', {
    mappedOnly: true,
    webcastOnly: true,
  });
  assert.deepEqual(
    mappedOn.map((row) => row.id),
    ['ll2-starlink', 'll2-vids', 'll2-legacy-vids', 'll2-camel', 'll2-sls', 'll2-tbd', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit'],
  );
  assert.ok(!mappedOn.some((row) => row.id === 'll2-secret-named'));

  const statusGo = launchesPanelRows({ results: MIXED }, 'all', {
    statusFilter: 'go',
    webcastOnly: true,
  });
  assert.deepEqual(
    statusGo.map((row) => row.id),
    ['ll2-starlink', 'll2-vids', 'll2-legacy-vids', 'll2-camel', 'll2-sls', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit'],
  );
  assert.ok(!statusGo.some((row) => row.id === 'll2-tbd'));

  const providerOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProvider: true,
    webcastOnly: true,
  });
  assert.deepEqual(
    providerOn.map((row) => row.id),
    ['ll2-starlink', 'll2-vids', 'll2-legacy-vids', 'll2-camel', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit'],
  );
  assert.ok(!providerOn.some((row) => row.id === 'll2-no-provider'));

  const siteOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoSite: true,
    webcastOnly: true,
  });
  assert.deepEqual(
    siteOn.map((row) => row.id),
    ['ll2-starlink', 'll2-vids', 'll2-legacy-vids', 'll2-camel', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit'],
  );
  assert.ok(!siteOn.some((row) => row.id === 'll2-unknown-site'));

  const timeOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoTime: true,
    webcastOnly: true,
  });
  assert.deepEqual(
    timeOn.map((row) => row.id),
    ['ll2-starlink', 'll2-vids', 'll2-legacy-vids', 'll2-camel', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-vehicle', 'll2-no-orbit'],
  );
  assert.ok(!timeOn.some((row) => row.id === 'll2-no-time'));

  const vehicleOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoVehicle: true,
    webcastOnly: true,
  });
  assert.deepEqual(
    vehicleOn.map((row) => row.id),
    ['ll2-starlink', 'll2-vids', 'll2-legacy-vids', 'll2-camel', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-orbit'],
  );
  assert.ok(!vehicleOn.some((row) => row.id === 'll2-no-vehicle'));

  const orbitOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoOrbit: true,
    webcastOnly: true,
  });
  assert.deepEqual(
    orbitOn.map((row) => row.id),
    ['ll2-starlink', 'll2-vids', 'll2-legacy-vids', 'll2-camel', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle'],
  );
  assert.ok(!orbitOn.some((row) => row.id === 'll2-no-orbit'));

  const allEight = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
    hideNoSite: true,
    hideNoTime: true,
    hideNoVehicle: true,
    hideNoOrbit: true,
    webcastOnly: true,
  });
  assert.deepEqual(
    allEight.map((row) => row.id),
    ['ll2-starlink', 'll2-vids', 'll2-legacy-vids', 'll2-camel'],
  );

  const allEightSelected = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
    hideNoSite: true,
    hideNoTime: true,
    hideNoVehicle: true,
    hideNoOrbit: true,
    webcastOnly: true,
    selectedId: 'll2-no-webcast',
  });
  assert.deepEqual(
    allEightSelected.map((row) => row.id),
    ['ll2-starlink', 'll2-no-webcast', 'll2-vids', 'll2-legacy-vids', 'll2-camel'],
  );

  const afterMapped = filterLaunchListByMappedOnly(launchesPanelRows({ results: MIXED }), true);
  const afterStatus = filterLaunchListByStatus(afterMapped, 'go');
  const afterProvider = filterLaunchListByProvider(afterStatus, true);
  const afterSite = filterLaunchListBySite(afterProvider, true);
  const afterTime = filterLaunchListByTime(afterSite, true);
  const afterVehicle = filterLaunchListByVehicle(afterTime, true);
  const afterOrbit = filterLaunchListByOrbit(afterVehicle, true);
  assert.deepEqual(
    filterLaunchListByWebcast(afterOrbit, true).map((row) => row.id),
    ['ll2-starlink', 'll2-vids', 'll2-legacy-vids', 'll2-camel', 'll2-sls'],
  );
});

test('LayerStateCoordinator restore keeps meridian.launchListWebcastOnly and does not write a share URL', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['rocket-launches']?.launchListWebcastOnly, undefined);
  assert.equal(defaults.options['rocket-launches']?.webcastOnly, undefined);

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['rocket-launches'],
    options: { 'rocket-launches': { launchListWebcastOnly: true, webcastOnly: true } },
  }));
  assert.doesNotMatch(encoded.toString(), /launchListWebcastOnly|meridian\.launchListWebcastOnly/);
  assert.doesNotMatch(encoded.get('lo') || '', /launchListWebcastOnly|webcastOnly|listWebcast/);
  const decoded = decodeLayerStateParams(encoded);
  assert.equal(decoded.options['rocket-launches']?.launchListWebcastOnly, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'rocket-launches')?.launchListWebcastOnly, undefined);

  const storage = memoryStorage({ [LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY]: '1' });
  assert.equal(readLaunchListWebcastOnly(storage), true, 'coordinator restore of layer options does not wipe the list key');
});

test('chip sits on the hosted Launches panel and re-applies the existing /api/launches payload', () => {
  const helper = read('src/data/launchListWebcastFilter.js');
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
  const globeRocket = read('src/data/launchRocketFilter.js');
  const globeOrbit = read('src/data/launchOrbitFilter.js');
  const globeWebcast = read('src/data/launchWebcastFilter.js');
  const hideSite = read('src/data/launchUnknownSiteFilter.js');
  const hideProvider = read('src/data/launchListProviderFilter.js');
  const listSite = read('src/data/launchListSiteFilter.js');
  const listTime = read('src/data/launchListTimeFilter.js');
  const listVehicle = read('src/data/launchListVehicleFilter.js');
  const listOrbit = read('src/data/launchListOrbitFilter.js');

  assert.match(helper, /meridian\.launchListWebcastOnly/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(/);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);
  assert.notEqual(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY, 'meridian.launchWebcastOnly');
  assert.notEqual(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY, 'meridian.launchProvider');
  assert.notEqual(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY, 'meridian.launchLspType');
  assert.notEqual(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY, 'meridian.launchListMappedOnly');
  assert.notEqual(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY, 'meridian.launchListStatus');
  assert.notEqual(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY, 'meridian.launchListHideNoProvider');
  assert.notEqual(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY, 'meridian.launchListHideNoSite');
  assert.notEqual(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY, 'meridian.launchListHideNoTime');
  assert.notEqual(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY, 'meridian.launchListHideNoVehicle');
  assert.notEqual(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY, 'meridian.launchListHideNoOrbit');
  assert.notEqual(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY, 'meridian.launchOrbit');
  assert.notEqual(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY, 'meridian.launchRocket');
  assert.notEqual(LAUNCH_LIST_WEBCAST_ONLY_STORAGE_KEY, 'meridian.launchHideUnknownSite');

  assert.match(panel, /filterLaunchListByWebcast|launchListRowMatchesWebcastFilter/);
  assert.match(panel, /launchesPanelRows\(/);
  assert.match(panel, /webcast:\s*launchListRowHasWebcast\(launch\)/);
  assert.doesNotMatch(panel, /\/api\/(?!launches\b)/);

  assert.match(html, /id="launches-panel"/);
  assert.match(html, /id="launches-panel-webcast-chips"/);
  assert.match(html, /data-launch-list-webcast="only"/);
  assert.match(html, /Webcast only/);
  assert.match(html, /Show only missions with a webcast/);
  assert.ok(
    html.indexOf('id="launches-panel-orbit-chips"') < html.indexOf('id="launches-panel-webcast-chips"'),
    'Webcast only sits after Hide no orbit',
  );
  assert.ok(
    html.indexOf('id="launches-panel"') < html.indexOf('id="launches-panel-webcast-chips"'),
    'Webcast only lives on the hosted Launches panel',
  );
  assert.ok(
    html.indexOf('data-launch-list-webcast="only"') < html.indexOf('id="earthquake-list-panel"'),
    'Webcast only stays on the launches panel, not later list chrome',
  );
  assert.doesNotMatch(html, /data-launch-list-webcast="live"|data-launch-list-webcast="all"/);

  assert.match(ui, /readLaunchListWebcastOnly/);
  assert.match(ui, /writeLaunchListWebcastOnly/);
  assert.match(ui, /data-launch-list-webcast/);
  assert.doesNotMatch(ui, /getRowControls\(\)[\s\S]{0,200}webcast|webcast[\s\S]{0,200}getRowControls\(\)/);
  assert.match(css, /launches-panel-webcast-chip/);

  assert.doesNotMatch(rocket, /launchListWebcastOnly|meridian\.launchListWebcastOnly/);
  assert.doesNotMatch(launches, /launchListWebcastOnly|meridian\.launchListWebcastOnly/);
  assert.doesNotMatch(layerState, /launchListWebcastOnly|launchListWebcast/);
  assert.doesNotMatch(sharelink, /launchListWebcastOnly|meridian\.launchListWebcastOnly/);
  assert.match(firstRun, /meridian\.launchListWebcastOnly/);
  assert.doesNotMatch(
    firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun')),
    /writeLaunchListWebcastOnly|readLaunchListWebcastOnly/,
  );
  assert.doesNotMatch(globeProvider, /meridian\.launchListWebcastOnly|launchListWebcastFilter/);
  assert.doesNotMatch(globeRocket, /meridian\.launchListWebcastOnly|launchListWebcastFilter/);
  assert.doesNotMatch(globeOrbit, /meridian\.launchListWebcastOnly|launchListWebcastFilter/);
  assert.doesNotMatch(globeWebcast, /meridian\.launchListWebcastOnly|launchListWebcastFilter/);
  assert.doesNotMatch(hideSite, /meridian\.launchListWebcastOnly|launchListWebcastFilter/);
  assert.doesNotMatch(hideProvider, /meridian\.launchListWebcastOnly|launchListWebcastFilter/);
  assert.doesNotMatch(listSite, /meridian\.launchListWebcastOnly|launchListWebcastFilter/);
  assert.doesNotMatch(listTime, /meridian\.launchListWebcastOnly|launchListWebcastFilter/);
  assert.doesNotMatch(listVehicle, /meridian\.launchListWebcastOnly|launchListWebcastFilter/);
  assert.doesNotMatch(listOrbit, /meridian\.launchListWebcastOnly|launchListWebcastFilter/);

  assert.equal(existsSync(path.join(ROOT, 'api/launches/webcast.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.doesNotMatch(helper, /hideUnknownSite|launchHideUnknownSite|meridian\.launchHideUnknownSite/);
  assert.doesNotMatch(helper, /LAUNCH_WEBCAST_ONLY_STORAGE_KEY|setLaunchWebcastOnly/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(readme, /quantum-earth/);
  assert.doesNotMatch(readme, /God's Eye View branding/i);

  assert.equal(launchListWebcastOnlyChipModel(false).params.webcastOnly, true);
  assert.equal(launchListWebcastOnlyChipModel(true).params.webcastOnly, false);
  assert.equal(launchListWebcastOnlyChipModel(false).label, 'Webcast only');
});
