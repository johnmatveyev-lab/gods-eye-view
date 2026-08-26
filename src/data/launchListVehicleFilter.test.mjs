// PLAN 257 — Launches panel Hide no vehicle toggle. Client-only filter of
// already-fetched LL2 rows. Distinct from 207 LSP-type, 215 mapped-only,
// 223 status, 232 Hide no provider, 239 Hide no site, and 248 Hide no time.
// rocketLaunches.js and launchRocketFilter.js stay unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_VEHICLE,
  LAUNCH_LIST_HIDE_NO_VEHICLE_CHIP_LABEL,
  LAUNCH_LIST_HIDE_NO_VEHICLE_CHIP_TITLE,
  LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY,
  filterLaunchListByVehicle,
  launchListHideNoVehicleChipModel,
  launchListRowHasVehicle,
  launchListRowMatchesVehicleFilter,
  launchListVehicleName,
  normalizeLaunchListHideNoVehicle,
  readLaunchListHideNoVehicle,
  writeLaunchListHideNoVehicle,
} from './launchListVehicleFilter.js';
import { launchesPanelRows } from './launchesPanel.js';
import { filterLaunchesByLspType } from './launchLspTypeFilter.js';
import { filterLaunchListByMappedOnly } from './launchListMappedFilter.js';
import { filterLaunchListByProvider } from './launchListProviderFilter.js';
import { filterLaunchListBySite } from './launchListSiteFilter.js';
import { filterLaunchListByStatus } from './launchListStatusFilter.js';
import { filterLaunchListByTime } from './launchListTimeFilter.js';
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

const FALCON_SPACEX_GO = {
  id: 'll2-starlink',
  name: 'Falcon 9 | Starlink Group 10-1',
  rocketName: 'Falcon 9',
  net: '2026-08-20T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'SLC-40' },
};

const MISSING_VEHICLE_SPACEX = {
  id: 'll2-no-vehicle',
  name: 'Undisclosed Vehicle',
  net: '2026-08-21T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.4', longitude: '-80.6', name: 'SLC-40' },
};

const EMPTY_VEHICLE = {
  id: 'll2-empty-vehicle',
  name: 'Blank Rocket',
  rocketName: '',
  net: '2026-08-21T11:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.41', longitude: '-80.61', name: 'SLC-40' },
};

const WHITESPACE_VEHICLE = {
  id: 'll2-blank-vehicle',
  name: 'Whitespace Rocket',
  rocketName: '   ',
  net: '2026-08-21T12:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.42', longitude: '-80.62', name: 'SLC-40' },
};

const CONFIG_NAME = {
  id: 'll2-config',
  name: 'Config Falcon',
  rocket: { configuration: { name: 'Falcon 9' } },
  net: '2026-08-22T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.5', longitude: '-80.5', name: 'SLC-40' },
};

const NESTED_ROCKET_NAME = {
  id: 'll2-rocket-name',
  name: 'Nested Falcon',
  rocket: { name: 'Falcon 9' },
  net: '2026-08-22T09:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.51', longitude: '-80.51', name: 'SLC-40' },
};

const NASA_GO = {
  id: 'll2-sls',
  name: 'SLS | Artemis',
  rocketName: 'SLS',
  net: '2026-08-24T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'NASA', type: { id: 1, name: 'Government' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'LC-39B' },
};

const SPACEX_TBD = {
  id: 'll2-tbd',
  name: 'Falcon 9 | Weather Window',
  rocketName: 'Falcon 9',
  net: '2026-08-25T08:00:00Z',
  status: { name: 'TBD' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'SLC-40' },
};

const NAMED_NO_COORDS = {
  id: 'll2-secret-named',
  name: 'Secret Falcon',
  rocketName: 'Falcon 9',
  net: '2026-08-26T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { name: 'Undisclosed', location: {} },
};

const NAMED_NO_PROVIDER = {
  id: 'll2-no-provider',
  name: 'Classified Flight',
  rocketName: 'Falcon 9',
  net: '2026-08-28T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.2', longitude: '-80.2', name: 'SLC-41' },
};

const NAMED_UNKNOWN_SITE = {
  id: 'll2-unknown-site',
  name: 'Falcon 9 | Undisclosed Pad',
  rocketName: 'Falcon 9',
  net: '2026-08-21T09:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.4', longitude: '-80.6', location: {} },
};

const NAMED_NO_TIME = {
  id: 'll2-no-time',
  name: 'Falcon 9 | Undated Window',
  rocketName: 'Falcon 9',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.45', longitude: '-80.65', name: 'SLC-40' },
};

const MISSING_VEHICLE_NO_TIME = {
  id: 'll2-ghost',
  name: 'Ghost Flight',
  status: { name: 'Go' },
  pad: { latitude: '28.1', longitude: '-80.1', location: {} },
};

const MIXED = Object.freeze([
  FALCON_SPACEX_GO,
  MISSING_VEHICLE_SPACEX,
  EMPTY_VEHICLE,
  WHITESPACE_VEHICLE,
  CONFIG_NAME,
  NESTED_ROCKET_NAME,
  NASA_GO,
  SPACEX_TBD,
  NAMED_NO_COORDS,
  NAMED_NO_PROVIDER,
  NAMED_UNKNOWN_SITE,
  NAMED_NO_TIME,
  MISSING_VEHICLE_NO_TIME,
]);

const NAMED_IDS = [
  'll2-starlink',
  'll2-config',
  'll2-rocket-name',
  'll2-sls',
  'll2-tbd',
  'll2-secret-named',
  'll2-no-provider',
  'll2-unknown-site',
  'll2-no-time',
];

test('off keeps missing vehicle', () => {
  assert.equal(DEFAULT_LAUNCH_LIST_HIDE_NO_VEHICLE, false);
  assert.equal(LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY, 'meridian.launchListHideNoVehicle');
  assert.equal(LAUNCH_LIST_HIDE_NO_VEHICLE_CHIP_LABEL, 'Hide no vehicle');
  assert.equal(LAUNCH_LIST_HIDE_NO_VEHICLE_CHIP_TITLE, 'Hide missions without a launch vehicle');
  assert.equal(normalizeLaunchListHideNoVehicle(undefined), false);
  assert.equal(normalizeLaunchListHideNoVehicle(null), false);
  assert.equal(normalizeLaunchListHideNoVehicle(''), false);
  assert.equal(normalizeLaunchListHideNoVehicle(false), false);

  const rows = launchesPanelRows({ results: MIXED });
  assert.deepEqual(rows.map((row) => row.id), MIXED.map((row) => row.id));
  assert.equal(rows[0].vehicle, 'Falcon 9');
  assert.equal(rows[1].vehicle, null);
  assert.equal(rows[2].vehicle, null);
  assert.equal(rows[3].vehicle, '   ');
  assert.equal(rows[4].vehicle, 'Falcon 9');
  assert.equal(rows[5].vehicle, 'Falcon 9');
  assert.equal(launchListRowMatchesVehicleFilter(rows[1], false), true);
  assert.equal(launchListRowMatchesVehicleFilter({ vehicle: null }, false), true);
  assert.equal(launchListRowMatchesVehicleFilter({ vehicle: '' }, false), true);
  assert.equal(launchListRowMatchesVehicleFilter(rows[0], false), true);
  assert.deepEqual(
    filterLaunchListByVehicle(rows, false).map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterLaunchListByVehicle(null), []);
  assert.deepEqual(filterLaunchListByVehicle(undefined), []);
});

test('on keeps Falcon 9 and drops empty', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', { hideNoVehicle: true });
  assert.deepEqual(rows.map((row) => row.id), NAMED_IDS);
  assert.ok(rows.every((row) => String(row.vehicle || '').trim() !== ''));
  assert.ok(!rows.some((row) => row.id === 'll2-no-vehicle'));
  assert.ok(!rows.some((row) => row.id === 'll2-empty-vehicle'));
  assert.ok(!rows.some((row) => row.id === 'll2-blank-vehicle'));
  assert.ok(!rows.some((row) => row.id === 'll2-ghost'));
  assert.ok(rows.some((row) => row.vehicle === 'Falcon 9'));

  const built = launchesPanelRows({ results: MIXED });
  assert.equal(launchListRowHasVehicle(built[0]), true);
  assert.equal(launchListRowHasVehicle(built[1]), false);
  assert.equal(launchListRowHasVehicle(built[2]), false);
  assert.equal(launchListRowHasVehicle(built[3]), false);
  assert.equal(launchListRowHasVehicle({}), false);
  assert.equal(launchListRowHasVehicle({ vehicle: null }), false);
  assert.equal(launchListVehicleName({ vehicle: 'Falcon 9' }), 'Falcon 9');
  assert.equal(launchListVehicleName({ vehicle: '   ' }), '');
  assert.equal(launchListVehicleName({ vehicle: '' }), '');
  assert.equal(launchListVehicleName({}), '');
  assert.equal(launchListVehicleName({ rocketName: 'Falcon 9' }), 'Falcon 9');
  assert.equal(launchListVehicleName({ rocket: { configuration: { name: 'Falcon 9' } } }), 'Falcon 9');
  assert.equal(launchListVehicleName({ rocket: { name: 'Falcon 9' } }), 'Falcon 9');
  assert.equal(launchListRowMatchesVehicleFilter(built[0], true), true);
  assert.equal(launchListRowMatchesVehicleFilter(built[1], true), false);
  assert.equal(launchListRowMatchesVehicleFilter({ id: 'x', vehicle: null }, true), false);
  assert.equal(launchListRowMatchesVehicleFilter({ id: 'x' }, true), false);
  assert.equal(launchListRowMatchesVehicleFilter({ id: 'x', vehicle: '' }, true), false);
  assert.equal(launchListRowMatchesVehicleFilter({ id: 'x', vehicle: '   ' }, true), false);
  assert.deepEqual(
    filterLaunchListByVehicle(built, true).map((row) => row.id),
    NAMED_IDS,
  );
});

test('selected id always kept', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoVehicle: true,
    selectedId: 'll2-no-vehicle',
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['ll2-starlink', 'll2-no-vehicle', 'll2-config', 'll2-rocket-name', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time'],
  );
  assert.equal(
    launchListRowMatchesVehicleFilter(
      { id: 'll2-no-vehicle', vehicle: null },
      true,
      { selectedId: 'll2-no-vehicle' },
    ),
    true,
  );
  assert.deepEqual(
    filterLaunchListByVehicle(
      launchesPanelRows({ results: MIXED }),
      true,
      'll2-empty-vehicle',
    ).map((row) => row.id),
    ['ll2-starlink', 'll2-empty-vehicle', 'll2-config', 'll2-rocket-name', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time'],
  );
});

test('invalid storage reads as off', () => {
  assert.equal(normalizeLaunchListHideNoVehicle('bogus'), null);
  assert.equal(normalizeLaunchListHideNoVehicle('on'), null);
  assert.equal(readLaunchListHideNoVehicle(memoryStorage()), DEFAULT_LAUNCH_LIST_HIDE_NO_VEHICLE);
  assert.equal(readLaunchListHideNoVehicle(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readLaunchListHideNoVehicle(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY]: 'yes',
  })), false);
  assert.equal(writeLaunchListHideNoVehicle('nope', memoryStorage()), false);
});

test('Persist flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(readLaunchListHideNoVehicle(storage), DEFAULT_LAUNCH_LIST_HIDE_NO_VEHICLE);
  assert.equal(writeLaunchListHideNoVehicle(true, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY), '1');
  assert.equal(readLaunchListHideNoVehicle(storage), true);
  assert.equal(readLaunchListHideNoVehicle(memoryStorage(storage.snapshot())), true, 'reload keeps on');

  const restored = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoVehicle: readLaunchListHideNoVehicle(memoryStorage(storage.snapshot())),
  });
  assert.deepEqual(restored.map((row) => row.id), NAMED_IDS);

  assert.equal(writeLaunchListHideNoVehicle(false, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY), '0');
  assert.equal(readLaunchListHideNoVehicle(memoryStorage(storage.snapshot())), false, 'reload keeps off');
  assert.equal(writeLaunchListHideNoVehicle('nope', storage), false);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY), '0');
});

test('rocketLaunches.js is unchanged', () => {
  const rocket = read('src/data/rocketLaunches.js');
  const globeRocket = read('src/data/launchRocketFilter.js');
  assert.doesNotMatch(rocket, /launchListVehicle|launchListHideNoVehicle|meridian\.launchListHideNoVehicle/);
  assert.doesNotMatch(rocket, /filterLaunchListByVehicle|readLaunchListHideNoVehicle|writeLaunchListHideNoVehicle/);
  assert.doesNotMatch(globeRocket, /launchListVehicle|launchListHideNoVehicle|meridian\.launchListHideNoVehicle/);
  assert.doesNotMatch(globeRocket, /filterLaunchListByVehicle|readLaunchListHideNoVehicle|writeLaunchListHideNoVehicle/);
});

test('AND with 207 LSP-type, 215 mapped-only, 223 status, 232 Hide no provider, 239 Hide no site, 248 Hide no time', () => {
  assert.deepEqual(
    filterLaunchesByLspType(MIXED, 'commercial').map((row) => row.id),
    [
      'll2-starlink',
      'll2-no-vehicle',
      'll2-empty-vehicle',
      'll2-blank-vehicle',
      'll2-config',
      'll2-rocket-name',
      'll2-tbd',
      'll2-secret-named',
      'll2-no-provider',
      'll2-unknown-site',
      'll2-no-time',
    ],
  );
  const commercialOff = launchesPanelRows({ results: MIXED }, 'commercial');
  assert.deepEqual(
    commercialOff.map((row) => row.id),
    [
      'll2-starlink',
      'll2-no-vehicle',
      'll2-empty-vehicle',
      'll2-blank-vehicle',
      'll2-config',
      'll2-rocket-name',
      'll2-tbd',
      'll2-secret-named',
      'll2-no-provider',
      'll2-unknown-site',
      'll2-no-time',
    ],
  );

  const commercialOn = launchesPanelRows({ results: MIXED }, 'commercial', { hideNoVehicle: true });
  assert.deepEqual(
    commercialOn.map((row) => row.id),
    ['ll2-starlink', 'll2-config', 'll2-rocket-name', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time'],
  );

  const governmentOn = launchesPanelRows({ results: MIXED }, 'government', { hideNoVehicle: true });
  assert.deepEqual(governmentOn.map((row) => row.id), ['ll2-sls']);

  const mappedOn = launchesPanelRows({ results: MIXED }, 'all', {
    mappedOnly: true,
    hideNoVehicle: true,
  });
  assert.deepEqual(
    mappedOn.map((row) => row.id),
    ['ll2-starlink', 'll2-config', 'll2-rocket-name', 'll2-sls', 'll2-tbd', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time'],
  );
  assert.ok(!mappedOn.some((row) => row.id === 'll2-secret-named'));

  const statusGo = launchesPanelRows({ results: MIXED }, 'all', {
    statusFilter: 'go',
    hideNoVehicle: true,
  });
  assert.deepEqual(
    statusGo.map((row) => row.id),
    ['ll2-starlink', 'll2-config', 'll2-rocket-name', 'll2-sls', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time'],
  );
  assert.ok(!statusGo.some((row) => row.id === 'll2-tbd'));

  const providerOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProvider: true,
    hideNoVehicle: true,
  });
  assert.deepEqual(
    providerOn.map((row) => row.id),
    ['ll2-starlink', 'll2-config', 'll2-rocket-name', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-unknown-site', 'll2-no-time'],
  );
  assert.ok(!providerOn.some((row) => row.id === 'll2-no-provider'));

  const siteOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoSite: true,
    hideNoVehicle: true,
  });
  assert.deepEqual(
    siteOn.map((row) => row.id),
    ['ll2-starlink', 'll2-config', 'll2-rocket-name', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-no-time'],
  );
  assert.ok(!siteOn.some((row) => row.id === 'll2-unknown-site'));

  const timeOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoTime: true,
    hideNoVehicle: true,
  });
  assert.deepEqual(
    timeOn.map((row) => row.id),
    ['ll2-starlink', 'll2-config', 'll2-rocket-name', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site'],
  );
  assert.ok(!timeOn.some((row) => row.id === 'll2-no-time'));

  const allSix = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
    hideNoSite: true,
    hideNoTime: true,
    hideNoVehicle: true,
  });
  assert.deepEqual(allSix.map((row) => row.id), ['ll2-starlink', 'll2-config', 'll2-rocket-name']);

  const allSixSelected = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
    hideNoSite: true,
    hideNoTime: true,
    hideNoVehicle: true,
    selectedId: 'll2-no-vehicle',
  });
  assert.deepEqual(
    allSixSelected.map((row) => row.id),
    ['ll2-starlink', 'll2-no-vehicle', 'll2-config', 'll2-rocket-name'],
  );

  const afterMapped = filterLaunchListByMappedOnly(launchesPanelRows({ results: MIXED }), true);
  const afterStatus = filterLaunchListByStatus(afterMapped, 'go');
  const afterProvider = filterLaunchListByProvider(afterStatus, true);
  const afterSite = filterLaunchListBySite(afterProvider, true);
  const afterTime = filterLaunchListByTime(afterSite, true);
  assert.deepEqual(
    filterLaunchListByVehicle(afterTime, true).map((row) => row.id),
    ['ll2-starlink', 'll2-config', 'll2-rocket-name', 'll2-sls'],
  );
});

test('LayerStateCoordinator restore keeps meridian.launchListHideNoVehicle and does not write a share URL', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['rocket-launches']?.launchListHideNoVehicle, undefined);
  assert.equal(defaults.options['rocket-launches']?.hideNoVehicle, undefined);

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['rocket-launches'],
    options: { 'rocket-launches': { launchListHideNoVehicle: true, hideNoVehicle: true } },
  }));
  assert.doesNotMatch(encoded.toString(), /launchListHideNoVehicle|meridian\.launchListHideNoVehicle/);
  assert.doesNotMatch(encoded.get('lo') || '', /launchListHideNoVehicle|hideNoVehicle|listVehicle/);
  const decoded = decodeLayerStateParams(encoded);
  assert.equal(decoded.options['rocket-launches']?.launchListHideNoVehicle, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'rocket-launches')?.launchListHideNoVehicle, undefined);

  const storage = memoryStorage({ [LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY]: '1' });
  assert.equal(readLaunchListHideNoVehicle(storage), true, 'coordinator restore of layer options does not wipe the list key');
});

test('chip sits on the hosted Launches panel and re-applies the existing /api/launches payload', () => {
  const helper = read('src/data/launchListVehicleFilter.js');
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
  const hideSite = read('src/data/launchUnknownSiteFilter.js');
  const hideProvider = read('src/data/launchListProviderFilter.js');
  const listSite = read('src/data/launchListSiteFilter.js');
  const listTime = read('src/data/launchListTimeFilter.js');

  assert.match(helper, /meridian\.launchListHideNoVehicle/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(/);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);
  assert.notEqual(LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY, 'meridian.launchProvider');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY, 'meridian.launchLspType');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY, 'meridian.launchListMappedOnly');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY, 'meridian.launchListStatus');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY, 'meridian.launchListHideNoProvider');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY, 'meridian.launchListHideNoSite');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY, 'meridian.launchListHideNoTime');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY, 'meridian.launchRocket');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_VEHICLE_STORAGE_KEY, 'meridian.launchHideUnknownSite');

  assert.match(panel, /filterLaunchListByVehicle|launchListRowMatchesVehicleFilter/);
  assert.match(panel, /launchesPanelRows\(/);
  assert.match(panel, /rocketName \|\| launch\.rocket\?\.configuration\?\.name \|\| launch\.rocket\?\.name/);
  assert.doesNotMatch(panel, /\/api\/(?!launches\b)/);

  assert.match(html, /id="launches-panel"/);
  assert.match(html, /id="launches-panel-vehicle-chips"/);
  assert.match(html, /data-launch-list-hide-no-vehicle="only"/);
  assert.match(html, /Hide no vehicle/);
  assert.match(html, /Hide missions without a launch vehicle/);
  assert.ok(
    html.indexOf('id="launches-panel-time-chips"') < html.indexOf('id="launches-panel-vehicle-chips"'),
    'Hide no vehicle sits after Hide no time',
  );
  assert.ok(
    html.indexOf('id="launches-panel"') < html.indexOf('id="launches-panel-vehicle-chips"'),
    'Hide no vehicle lives on the hosted Launches panel',
  );
  assert.ok(
    html.indexOf('data-launch-list-hide-no-vehicle="only"') < html.indexOf('id="earthquake-list-panel"'),
    'Hide no vehicle stays on the launches panel, not later list chrome',
  );

  assert.match(ui, /readLaunchListHideNoVehicle/);
  assert.match(ui, /writeLaunchListHideNoVehicle/);
  assert.match(ui, /data-launch-list-hide-no-vehicle/);
  assert.doesNotMatch(ui, /getRowControls\(\)[\s\S]{0,200}hide-no-vehicle|hide-no-vehicle[\s\S]{0,200}getRowControls\(\)/);
  assert.match(css, /launches-panel-vehicle-chip/);

  assert.doesNotMatch(rocket, /launchListHideNoVehicle|meridian\.launchListHideNoVehicle/);
  assert.doesNotMatch(launches, /launchListHideNoVehicle|meridian\.launchListHideNoVehicle/);
  assert.doesNotMatch(layerState, /launchListHideNoVehicle|launchListVehicle/);
  assert.doesNotMatch(sharelink, /launchListHideNoVehicle|meridian\.launchListHideNoVehicle/);
  assert.match(firstRun, /meridian\.launchListHideNoVehicle/);
  assert.doesNotMatch(
    firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun')),
    /writeLaunchListHideNoVehicle|readLaunchListHideNoVehicle/,
  );
  assert.doesNotMatch(globeProvider, /meridian\.launchListHideNoVehicle|launchListVehicleFilter/);
  assert.doesNotMatch(globeRocket, /meridian\.launchListHideNoVehicle|launchListVehicleFilter/);
  assert.doesNotMatch(hideSite, /meridian\.launchListHideNoVehicle|launchListVehicleFilter/);
  assert.doesNotMatch(hideProvider, /meridian\.launchListHideNoVehicle|launchListVehicleFilter/);
  assert.doesNotMatch(listSite, /meridian\.launchListHideNoVehicle|launchListVehicleFilter/);
  assert.doesNotMatch(listTime, /meridian\.launchListHideNoVehicle|launchListVehicleFilter/);

  assert.equal(existsSync(path.join(ROOT, 'api/launches/vehicle.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.doesNotMatch(helper, /hideUnknownSite|launchHideUnknownSite|meridian\.launchHideUnknownSite/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(readme, /quantum-earth/);

  assert.equal(launchListHideNoVehicleChipModel(false).params.hideNoVehicle, true);
  assert.equal(launchListHideNoVehicleChipModel(true).params.hideNoVehicle, false);
  assert.equal(launchListHideNoVehicleChipModel(false).label, 'Hide no vehicle');
});
