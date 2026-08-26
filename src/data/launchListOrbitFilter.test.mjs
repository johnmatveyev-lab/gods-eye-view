// PLAN 264 — Launches panel Hide no orbit toggle. Client-only filter of
// already-fetched LL2 rows. Distinct from 207 LSP-type, 215 mapped-only,
// 223 status, 232 Hide no provider, 239 Hide no site, 248 Hide no time,
// 257 Hide no vehicle, and globe LEO/MEO/GEO/Polar/Other chips.
// rocketLaunches.js and launchRocketFilter.js stay unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_ORBIT,
  LAUNCH_LIST_HIDE_NO_ORBIT_CHIP_LABEL,
  LAUNCH_LIST_HIDE_NO_ORBIT_CHIP_TITLE,
  LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY,
  filterLaunchListByOrbit,
  launchListHideNoOrbitChipModel,
  launchListOrbitName,
  launchListRowHasOrbit,
  launchListRowMatchesOrbitFilter,
  normalizeLaunchListHideNoOrbit,
  readLaunchListHideNoOrbit,
  writeLaunchListHideNoOrbit,
} from './launchListOrbitFilter.js';
import { launchesPanelRows } from './launchesPanel.js';
import { filterLaunchesByLspType } from './launchLspTypeFilter.js';
import { filterLaunchListByMappedOnly } from './launchListMappedFilter.js';
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

const LEO_SPACEX_GO = {
  id: 'll2-starlink',
  name: 'Falcon 9 | Starlink Group 10-1',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-20T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'SLC-40' },
};

const MISSING_ORBIT_SPACEX = {
  id: 'll2-no-orbit',
  name: 'Undisclosed Orbit',
  rocketName: 'Falcon 9',
  net: '2026-08-21T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.4', longitude: '-80.6', name: 'SLC-40' },
};

const EMPTY_ORBIT = {
  id: 'll2-empty-orbit',
  name: 'Blank Orbit',
  rocketName: 'Falcon 9',
  orbit: '',
  net: '2026-08-21T11:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.41', longitude: '-80.61', name: 'SLC-40' },
};

const WHITESPACE_ORBIT = {
  id: 'll2-blank-orbit',
  name: 'Whitespace Orbit',
  rocketName: 'Falcon 9',
  orbit: '   ',
  net: '2026-08-21T12:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.42', longitude: '-80.62', name: 'SLC-40' },
};

const STRING_ORBIT = {
  id: 'll2-string-orbit',
  name: 'String LEO',
  rocketName: 'Falcon 9',
  orbit: 'Low Earth Orbit',
  net: '2026-08-22T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.5', longitude: '-80.5', name: 'SLC-40' },
};

const MISSION_ORBIT = {
  id: 'll2-mission-orbit',
  name: 'Mission LEO',
  rocketName: 'Falcon 9',
  mission: { orbit: { name: 'Low Earth Orbit' } },
  net: '2026-08-22T09:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.51', longitude: '-80.51', name: 'SLC-40' },
};

const GTO_NAMED = {
  id: 'll2-gto',
  name: 'Falcon 9 | GTO',
  rocketName: 'Falcon 9',
  orbit: { name: 'Geostationary Transfer Orbit' },
  net: '2026-08-23T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.52', longitude: '-80.52', name: 'SLC-40' },
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
};

const NAMED_NO_TIME = {
  id: 'll2-no-time',
  name: 'Falcon 9 | Undated Window',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.45', longitude: '-80.65', name: 'SLC-40' },
};

const NAMED_NO_VEHICLE = {
  id: 'll2-no-vehicle',
  name: 'Undisclosed Vehicle',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T13:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.46', longitude: '-80.66', name: 'SLC-40' },
};

const MISSING_ORBIT_NO_TIME = {
  id: 'll2-ghost',
  name: 'Ghost Flight',
  status: { name: 'Go' },
  pad: { latitude: '28.1', longitude: '-80.1', location: {} },
};

const MIXED = Object.freeze([
  LEO_SPACEX_GO,
  MISSING_ORBIT_SPACEX,
  EMPTY_ORBIT,
  WHITESPACE_ORBIT,
  STRING_ORBIT,
  MISSION_ORBIT,
  GTO_NAMED,
  NASA_GO,
  SPACEX_TBD,
  NAMED_NO_COORDS,
  NAMED_NO_PROVIDER,
  NAMED_UNKNOWN_SITE,
  NAMED_NO_TIME,
  NAMED_NO_VEHICLE,
  MISSING_ORBIT_NO_TIME,
]);

const NAMED_IDS = [
  'll2-starlink',
  'll2-string-orbit',
  'll2-mission-orbit',
  'll2-gto',
  'll2-sls',
  'll2-tbd',
  'll2-secret-named',
  'll2-no-provider',
  'll2-unknown-site',
  'll2-no-time',
  'll2-no-vehicle',
];

test('off keeps missing-orbit rows', () => {
  assert.equal(DEFAULT_LAUNCH_LIST_HIDE_NO_ORBIT, false);
  assert.equal(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY, 'meridian.launchListHideNoOrbit');
  assert.equal(LAUNCH_LIST_HIDE_NO_ORBIT_CHIP_LABEL, 'Hide no orbit');
  assert.equal(LAUNCH_LIST_HIDE_NO_ORBIT_CHIP_TITLE, 'Hide missions without a named orbit');
  assert.equal(normalizeLaunchListHideNoOrbit(undefined), false);
  assert.equal(normalizeLaunchListHideNoOrbit(null), false);
  assert.equal(normalizeLaunchListHideNoOrbit(''), false);
  assert.equal(normalizeLaunchListHideNoOrbit(false), false);

  const rows = launchesPanelRows({ results: MIXED });
  assert.deepEqual(rows.map((row) => row.id), MIXED.map((row) => row.id));
  assert.equal(rows[0].orbit, 'Low Earth Orbit');
  assert.equal(rows[1].orbit, null);
  assert.equal(rows[2].orbit, null);
  assert.equal(rows[3].orbit, '   ');
  assert.equal(rows[4].orbit, 'Low Earth Orbit');
  assert.equal(rows[5].orbit, 'Low Earth Orbit');
  assert.equal(rows[6].orbit, 'Geostationary Transfer Orbit');
  assert.equal(launchListRowMatchesOrbitFilter(rows[1], false), true);
  assert.equal(launchListRowMatchesOrbitFilter({ orbit: null }, false), true);
  assert.equal(launchListRowMatchesOrbitFilter({ orbit: '' }, false), true);
  assert.equal(launchListRowMatchesOrbitFilter(rows[0], false), true);
  assert.deepEqual(
    filterLaunchListByOrbit(rows, false).map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterLaunchListByOrbit(null), []);
  assert.deepEqual(filterLaunchListByOrbit(undefined), []);
});

test('on hides null / empty / whitespace and keeps Low Earth Orbit', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', { hideNoOrbit: true });
  assert.deepEqual(rows.map((row) => row.id), NAMED_IDS);
  assert.ok(rows.every((row) => String(row.orbit || '').trim() !== ''));
  assert.ok(!rows.some((row) => row.id === 'll2-no-orbit'));
  assert.ok(!rows.some((row) => row.id === 'll2-empty-orbit'));
  assert.ok(!rows.some((row) => row.id === 'll2-blank-orbit'));
  assert.ok(!rows.some((row) => row.id === 'll2-ghost'));
  assert.ok(rows.some((row) => row.orbit === 'Low Earth Orbit'));
  assert.ok(rows.some((row) => row.orbit === 'Geostationary Transfer Orbit'));

  const built = launchesPanelRows({ results: MIXED });
  assert.equal(launchListRowHasOrbit(built[0]), true);
  assert.equal(launchListRowHasOrbit(built[1]), false);
  assert.equal(launchListRowHasOrbit(built[2]), false);
  assert.equal(launchListRowHasOrbit(built[3]), false);
  assert.equal(launchListRowHasOrbit({}), false);
  assert.equal(launchListRowHasOrbit({ orbit: null }), false);
  assert.equal(launchListOrbitName({ orbit: 'Low Earth Orbit' }), 'Low Earth Orbit');
  assert.equal(launchListOrbitName({ orbit: '   ' }), '');
  assert.equal(launchListOrbitName({ orbit: '' }), '');
  assert.equal(launchListOrbitName({}), '');
  assert.equal(launchListOrbitName({ orbit: { name: 'Low Earth Orbit' } }), 'Low Earth Orbit');
  assert.equal(launchListOrbitName({ mission: { orbit: { name: 'Low Earth Orbit' } } }), 'Low Earth Orbit');
  assert.equal(launchListRowMatchesOrbitFilter(built[0], true), true);
  assert.equal(launchListRowMatchesOrbitFilter(built[1], true), false);
  assert.equal(launchListRowMatchesOrbitFilter({ id: 'x', orbit: null }, true), false);
  assert.equal(launchListRowMatchesOrbitFilter({ id: 'x' }, true), false);
  assert.equal(launchListRowMatchesOrbitFilter({ id: 'x', orbit: '' }, true), false);
  assert.equal(launchListRowMatchesOrbitFilter({ id: 'x', orbit: '   ' }, true), false);
  assert.deepEqual(
    filterLaunchListByOrbit(built, true).map((row) => row.id),
    NAMED_IDS,
  );
});

test('selected id always kept', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoOrbit: true,
    selectedId: 'll2-no-orbit',
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['ll2-starlink', 'll2-no-orbit', 'll2-string-orbit', 'll2-mission-orbit', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle'],
  );
  assert.equal(
    launchListRowMatchesOrbitFilter(
      { id: 'll2-no-orbit', orbit: null },
      true,
      { selectedId: 'll2-no-orbit' },
    ),
    true,
  );
  assert.deepEqual(
    filterLaunchListByOrbit(
      launchesPanelRows({ results: MIXED }),
      true,
      'll2-empty-orbit',
    ).map((row) => row.id),
    ['ll2-starlink', 'll2-empty-orbit', 'll2-string-orbit', 'll2-mission-orbit', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle'],
  );
});

test('invalid storage reads as off', () => {
  assert.equal(normalizeLaunchListHideNoOrbit('bogus'), null);
  assert.equal(normalizeLaunchListHideNoOrbit('on'), null);
  assert.equal(readLaunchListHideNoOrbit(memoryStorage()), DEFAULT_LAUNCH_LIST_HIDE_NO_ORBIT);
  assert.equal(readLaunchListHideNoOrbit(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readLaunchListHideNoOrbit(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY]: 'yes',
  })), false);
  assert.equal(writeLaunchListHideNoOrbit('nope', memoryStorage()), false);
});

test('Persist flip survives reload', () => {
  const storage = memoryStorage();
  assert.equal(readLaunchListHideNoOrbit(storage), DEFAULT_LAUNCH_LIST_HIDE_NO_ORBIT);
  assert.equal(writeLaunchListHideNoOrbit(true, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY), '1');
  assert.equal(readLaunchListHideNoOrbit(storage), true);
  assert.equal(readLaunchListHideNoOrbit(memoryStorage(storage.snapshot())), true, 'reload keeps on');

  const restored = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoOrbit: readLaunchListHideNoOrbit(memoryStorage(storage.snapshot())),
  });
  assert.deepEqual(restored.map((row) => row.id), NAMED_IDS);

  assert.equal(writeLaunchListHideNoOrbit(false, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY), '0');
  assert.equal(readLaunchListHideNoOrbit(memoryStorage(storage.snapshot())), false, 'reload keeps off');
  assert.equal(writeLaunchListHideNoOrbit('nope', storage), false);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY), '0');
});

test('rocketLaunches.js is unchanged', () => {
  const rocket = read('src/data/rocketLaunches.js');
  const globeRocket = read('src/data/launchRocketFilter.js');
  assert.doesNotMatch(rocket, /launchListOrbit|launchListHideNoOrbit|meridian\.launchListHideNoOrbit/);
  assert.doesNotMatch(rocket, /filterLaunchListByOrbit|readLaunchListHideNoOrbit|writeLaunchListHideNoOrbit/);
  assert.doesNotMatch(globeRocket, /launchListOrbit|launchListHideNoOrbit|meridian\.launchListHideNoOrbit/);
  assert.doesNotMatch(globeRocket, /filterLaunchListByOrbit|readLaunchListHideNoOrbit|writeLaunchListHideNoOrbit/);
});

test('AND with 207 LSP-type, 215 mapped-only, 223 status, 232 Hide no provider, 239 Hide no site, 248 Hide no time, 257 Hide no vehicle', () => {
  assert.deepEqual(
    filterLaunchesByLspType(MIXED, 'commercial').map((row) => row.id),
    [
      'll2-starlink',
      'll2-no-orbit',
      'll2-empty-orbit',
      'll2-blank-orbit',
      'll2-string-orbit',
      'll2-mission-orbit',
      'll2-gto',
      'll2-tbd',
      'll2-secret-named',
      'll2-no-provider',
      'll2-unknown-site',
      'll2-no-time',
      'll2-no-vehicle',
    ],
  );
  const commercialOff = launchesPanelRows({ results: MIXED }, 'commercial');
  assert.deepEqual(
    commercialOff.map((row) => row.id),
    [
      'll2-starlink',
      'll2-no-orbit',
      'll2-empty-orbit',
      'll2-blank-orbit',
      'll2-string-orbit',
      'll2-mission-orbit',
      'll2-gto',
      'll2-tbd',
      'll2-secret-named',
      'll2-no-provider',
      'll2-unknown-site',
      'll2-no-time',
      'll2-no-vehicle',
    ],
  );

  const commercialOn = launchesPanelRows({ results: MIXED }, 'commercial', { hideNoOrbit: true });
  assert.deepEqual(
    commercialOn.map((row) => row.id),
    ['ll2-starlink', 'll2-string-orbit', 'll2-mission-orbit', 'll2-gto', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle'],
  );

  const governmentOn = launchesPanelRows({ results: MIXED }, 'government', { hideNoOrbit: true });
  assert.deepEqual(governmentOn.map((row) => row.id), ['ll2-sls']);

  const mappedOn = launchesPanelRows({ results: MIXED }, 'all', {
    mappedOnly: true,
    hideNoOrbit: true,
  });
  assert.deepEqual(
    mappedOn.map((row) => row.id),
    ['ll2-starlink', 'll2-string-orbit', 'll2-mission-orbit', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle'],
  );
  assert.ok(!mappedOn.some((row) => row.id === 'll2-secret-named'));

  const statusGo = launchesPanelRows({ results: MIXED }, 'all', {
    statusFilter: 'go',
    hideNoOrbit: true,
  });
  assert.deepEqual(
    statusGo.map((row) => row.id),
    ['ll2-starlink', 'll2-string-orbit', 'll2-mission-orbit', 'll2-gto', 'll2-sls', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle'],
  );
  assert.ok(!statusGo.some((row) => row.id === 'll2-tbd'));

  const providerOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProvider: true,
    hideNoOrbit: true,
  });
  assert.deepEqual(
    providerOn.map((row) => row.id),
    ['ll2-starlink', 'll2-string-orbit', 'll2-mission-orbit', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle'],
  );
  assert.ok(!providerOn.some((row) => row.id === 'll2-no-provider'));

  const siteOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoSite: true,
    hideNoOrbit: true,
  });
  assert.deepEqual(
    siteOn.map((row) => row.id),
    ['ll2-starlink', 'll2-string-orbit', 'll2-mission-orbit', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-no-time', 'll2-no-vehicle'],
  );
  assert.ok(!siteOn.some((row) => row.id === 'll2-unknown-site'));

  const timeOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoTime: true,
    hideNoOrbit: true,
  });
  assert.deepEqual(
    timeOn.map((row) => row.id),
    ['ll2-starlink', 'll2-string-orbit', 'll2-mission-orbit', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-vehicle'],
  );
  assert.ok(!timeOn.some((row) => row.id === 'll2-no-time'));

  const vehicleOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoVehicle: true,
    hideNoOrbit: true,
  });
  assert.deepEqual(
    vehicleOn.map((row) => row.id),
    ['ll2-starlink', 'll2-string-orbit', 'll2-mission-orbit', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time'],
  );
  assert.ok(!vehicleOn.some((row) => row.id === 'll2-no-vehicle'));

  const allSeven = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
    hideNoSite: true,
    hideNoTime: true,
    hideNoVehicle: true,
    hideNoOrbit: true,
  });
  assert.deepEqual(
    allSeven.map((row) => row.id),
    ['ll2-starlink', 'll2-string-orbit', 'll2-mission-orbit', 'll2-gto'],
  );

  const allSevenSelected = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
    hideNoSite: true,
    hideNoTime: true,
    hideNoVehicle: true,
    hideNoOrbit: true,
    selectedId: 'll2-no-orbit',
  });
  assert.deepEqual(
    allSevenSelected.map((row) => row.id),
    ['ll2-starlink', 'll2-no-orbit', 'll2-string-orbit', 'll2-mission-orbit', 'll2-gto'],
  );

  const afterMapped = filterLaunchListByMappedOnly(launchesPanelRows({ results: MIXED }), true);
  const afterStatus = filterLaunchListByStatus(afterMapped, 'go');
  const afterProvider = filterLaunchListByProvider(afterStatus, true);
  const afterSite = filterLaunchListBySite(afterProvider, true);
  const afterTime = filterLaunchListByTime(afterSite, true);
  const afterVehicle = filterLaunchListByVehicle(afterTime, true);
  assert.deepEqual(
    filterLaunchListByOrbit(afterVehicle, true).map((row) => row.id),
    ['ll2-starlink', 'll2-string-orbit', 'll2-mission-orbit', 'll2-gto', 'll2-sls'],
  );
});

test('LayerStateCoordinator restore keeps meridian.launchListHideNoOrbit and does not write a share URL', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['rocket-launches']?.launchListHideNoOrbit, undefined);
  assert.equal(defaults.options['rocket-launches']?.hideNoOrbit, undefined);

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['rocket-launches'],
    options: { 'rocket-launches': { launchListHideNoOrbit: true, hideNoOrbit: true } },
  }));
  assert.doesNotMatch(encoded.toString(), /launchListHideNoOrbit|meridian\.launchListHideNoOrbit/);
  assert.doesNotMatch(encoded.get('lo') || '', /launchListHideNoOrbit|hideNoOrbit|listOrbit/);
  const decoded = decodeLayerStateParams(encoded);
  assert.equal(decoded.options['rocket-launches']?.launchListHideNoOrbit, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'rocket-launches')?.launchListHideNoOrbit, undefined);

  const storage = memoryStorage({ [LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY]: '1' });
  assert.equal(readLaunchListHideNoOrbit(storage), true, 'coordinator restore of layer options does not wipe the list key');
});

test('chip sits on the hosted Launches panel and re-applies the existing /api/launches payload', () => {
  const helper = read('src/data/launchListOrbitFilter.js');
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
  const hideSite = read('src/data/launchUnknownSiteFilter.js');
  const hideProvider = read('src/data/launchListProviderFilter.js');
  const listSite = read('src/data/launchListSiteFilter.js');
  const listTime = read('src/data/launchListTimeFilter.js');
  const listVehicle = read('src/data/launchListVehicleFilter.js');

  assert.match(helper, /meridian\.launchListHideNoOrbit/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(/);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);
  assert.notEqual(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY, 'meridian.launchProvider');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY, 'meridian.launchLspType');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY, 'meridian.launchListMappedOnly');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY, 'meridian.launchListStatus');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY, 'meridian.launchListHideNoProvider');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY, 'meridian.launchListHideNoSite');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY, 'meridian.launchListHideNoTime');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY, 'meridian.launchListHideNoVehicle');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY, 'meridian.launchOrbit');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY, 'meridian.launchRocket');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_ORBIT_STORAGE_KEY, 'meridian.launchHideUnknownSite');

  assert.match(panel, /filterLaunchListByOrbit|launchListRowMatchesOrbitFilter/);
  assert.match(panel, /launchesPanelRows\(/);
  assert.match(panel, /orbit\.name|launch\.orbit/);
  assert.doesNotMatch(panel, /\/api\/(?!launches\b)/);

  assert.match(html, /id="launches-panel"/);
  assert.match(html, /id="launches-panel-orbit-chips"/);
  assert.match(html, /data-launch-list-hide-no-orbit="only"/);
  assert.match(html, /Hide no orbit/);
  assert.match(html, /Hide missions without a named orbit/);
  assert.ok(
    html.indexOf('id="launches-panel-vehicle-chips"') < html.indexOf('id="launches-panel-orbit-chips"'),
    'Hide no orbit sits after Hide no vehicle',
  );
  assert.ok(
    html.indexOf('id="launches-panel"') < html.indexOf('id="launches-panel-orbit-chips"'),
    'Hide no orbit lives on the hosted Launches panel',
  );
  assert.ok(
    html.indexOf('data-launch-list-hide-no-orbit="only"') < html.indexOf('id="earthquake-list-panel"'),
    'Hide no orbit stays on the launches panel, not later list chrome',
  );
  assert.doesNotMatch(html, /data-launch-list-hide-no-orbit="leo"|data-launch-list-hide-no-orbit="other"/);

  assert.match(ui, /readLaunchListHideNoOrbit/);
  assert.match(ui, /writeLaunchListHideNoOrbit/);
  assert.match(ui, /data-launch-list-hide-no-orbit/);
  assert.doesNotMatch(ui, /getRowControls\(\)[\s\S]{0,200}hide-no-orbit|hide-no-orbit[\s\S]{0,200}getRowControls\(\)/);
  assert.match(css, /launches-panel-orbit-chip/);

  assert.doesNotMatch(rocket, /launchListHideNoOrbit|meridian\.launchListHideNoOrbit/);
  assert.doesNotMatch(launches, /launchListHideNoOrbit|meridian\.launchListHideNoOrbit/);
  assert.doesNotMatch(layerState, /launchListHideNoOrbit|launchListOrbit/);
  assert.doesNotMatch(sharelink, /launchListHideNoOrbit|meridian\.launchListHideNoOrbit/);
  assert.match(firstRun, /meridian\.launchListHideNoOrbit/);
  assert.doesNotMatch(
    firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun')),
    /writeLaunchListHideNoOrbit|readLaunchListHideNoOrbit/,
  );
  assert.doesNotMatch(globeProvider, /meridian\.launchListHideNoOrbit|launchListOrbitFilter/);
  assert.doesNotMatch(globeRocket, /meridian\.launchListHideNoOrbit|launchListOrbitFilter/);
  assert.doesNotMatch(globeOrbit, /meridian\.launchListHideNoOrbit|launchListOrbitFilter/);
  assert.doesNotMatch(hideSite, /meridian\.launchListHideNoOrbit|launchListOrbitFilter/);
  assert.doesNotMatch(hideProvider, /meridian\.launchListHideNoOrbit|launchListOrbitFilter/);
  assert.doesNotMatch(listSite, /meridian\.launchListHideNoOrbit|launchListOrbitFilter/);
  assert.doesNotMatch(listTime, /meridian\.launchListHideNoOrbit|launchListOrbitFilter/);
  assert.doesNotMatch(listVehicle, /meridian\.launchListHideNoOrbit|launchListOrbitFilter/);

  assert.equal(existsSync(path.join(ROOT, 'api/launches/orbit.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.doesNotMatch(helper, /hideUnknownSite|launchHideUnknownSite|meridian\.launchHideUnknownSite/);
  assert.doesNotMatch(helper, /LAUNCH_ORBIT_CHIP_IDS|launchOrbitChipId/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(readme, /quantum-earth/);
  assert.doesNotMatch(readme, /God's Eye View branding/i);

  assert.equal(launchListHideNoOrbitChipModel(false).params.hideNoOrbit, true);
  assert.equal(launchListHideNoOrbitChipModel(true).params.hideNoOrbit, false);
  assert.equal(launchListHideNoOrbitChipModel(false).label, 'Hide no orbit');
});
