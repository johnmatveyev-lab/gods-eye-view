// PLAN 283 — Launches panel Hide no mission toggle. Client-only filter of
// already-fetched LL2 rows. Distinct from 207 LSP-type, 215 mapped-only,
// 223 status, 232 Hide no provider, 239 Hide no site, 248 Hide no time,
// 257 Hide no vehicle, 264 Hide no orbit, and 272 Webcast only.
// rocketLaunches.js and launchRocketFilter.js stay unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_MISSION,
  LAUNCH_LIST_HIDE_NO_MISSION_CHIP_LABEL,
  LAUNCH_LIST_HIDE_NO_MISSION_CHIP_TITLE,
  LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY,
  filterLaunchListByMission,
  launchListHideNoMissionChipModel,
  launchListMissionName,
  launchListRowHasMission,
  launchListRowMatchesMissionFilter,
  normalizeLaunchListHideNoMission,
  readLaunchListHideNoMission,
  writeLaunchListHideNoMission,
} from './launchListMissionFilter.js';
import { launchesPanelRows } from './launchesPanel.js';
import { filterLaunchesByLspType } from './launchLspTypeFilter.js';
import { filterLaunchListByMappedOnly } from './launchListMappedFilter.js';
import { filterLaunchListByOrbit } from './launchListOrbitFilter.js';
import { filterLaunchListByProvider } from './launchListProviderFilter.js';
import { filterLaunchListBySite } from './launchListSiteFilter.js';
import { filterLaunchListByStatus } from './launchListStatusFilter.js';
import { filterLaunchListByTime } from './launchListTimeFilter.js';
import { filterLaunchListByVehicle } from './launchListVehicleFilter.js';
import { filterLaunchListByWebcast } from './launchListWebcastFilter.js';
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
  rocketName: 'Falcon 9',
  mission: { name: 'Starlink Group 10-1' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-20T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'SLC-40' },
  webcast_live: true,
};

const MISSING_MISSION_SPACEX = {
  id: 'll2-no-mission',
  name: 'Undisclosed Mission',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.4', longitude: '-80.6', name: 'SLC-40' },
  webcast_live: true,
};

const EMPTY_MISSION = {
  id: 'll2-empty-mission',
  name: 'Blank Mission',
  rocketName: 'Falcon 9',
  mission: '',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T11:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.41', longitude: '-80.61', name: 'SLC-40' },
  webcast_live: true,
};

const WHITESPACE_MISSION = {
  id: 'll2-blank-mission',
  name: 'Whitespace Mission',
  rocketName: 'Falcon 9',
  mission: '   ',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T12:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.42', longitude: '-80.62', name: 'SLC-40' },
  webcast_live: true,
};

const STRING_MISSION = {
  id: 'll2-string-mission',
  name: 'String Mission',
  rocketName: 'Falcon 9',
  mission: 'Transporter-12',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-22T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.5', longitude: '-80.5', name: 'SLC-40' },
  webcast_live: true,
};

const MISSION_NAME_FIELD = {
  id: 'll2-mission-name',
  name: 'Legacy Mission Name',
  rocketName: 'Falcon 9',
  mission_name: 'NROL-69',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-22T09:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.51', longitude: '-80.51', name: 'SLC-40' },
  webcast_live: true,
};

const GTO_NAMED = {
  id: 'll2-gto',
  name: 'Falcon 9 | USSF-52',
  rocketName: 'Falcon 9',
  mission: { name: 'USSF-52' },
  orbit: { name: 'Geostationary Transfer Orbit' },
  net: '2026-08-23T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.52', longitude: '-80.52', name: 'SLC-40' },
  webcast_live: true,
};

const NASA_GO = {
  id: 'll2-sls',
  name: 'SLS | Artemis',
  rocketName: 'SLS',
  mission: { name: 'Artemis II' },
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
  mission: { name: 'Weather Window' },
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
  mission: { name: 'Classified Mission' },
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
  mission: { name: 'Classified Flight' },
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
  mission: { name: 'Undisclosed Pad' },
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
  mission: { name: 'Undated Window' },
  orbit: { name: 'Low Earth Orbit' },
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.45', longitude: '-80.65', name: 'SLC-40' },
  webcast_live: true,
};

const NAMED_NO_VEHICLE = {
  id: 'll2-no-vehicle',
  name: 'Undisclosed Vehicle',
  mission: { name: 'Undisclosed Vehicle' },
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
  mission: { name: 'Undisclosed Orbit' },
  net: '2026-08-21T14:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.47', longitude: '-80.67', name: 'SLC-40' },
  webcast_live: true,
};

const NAMED_NO_WEBCAST = {
  id: 'll2-no-webcast',
  name: 'Silent Falcon',
  rocketName: 'Falcon 9',
  mission: { name: 'Silent Falcon' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T15:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.48', longitude: '-80.68', name: 'SLC-40' },
};

const MISSING_MISSION_NO_TIME = {
  id: 'll2-ghost',
  name: 'Ghost Flight',
  status: { name: 'Go' },
  pad: { latitude: '28.1', longitude: '-80.1', location: {} },
};

const MIXED = Object.freeze([
  NAMED_SPACEX_GO,
  MISSING_MISSION_SPACEX,
  EMPTY_MISSION,
  WHITESPACE_MISSION,
  STRING_MISSION,
  MISSION_NAME_FIELD,
  GTO_NAMED,
  NASA_GO,
  SPACEX_TBD,
  NAMED_NO_COORDS,
  NAMED_NO_PROVIDER,
  NAMED_UNKNOWN_SITE,
  NAMED_NO_TIME,
  NAMED_NO_VEHICLE,
  NAMED_NO_ORBIT,
  NAMED_NO_WEBCAST,
  MISSING_MISSION_NO_TIME,
]);

const NAMED_IDS = [
  'll2-starlink',
  'll2-string-mission',
  'll2-mission-name',
  'll2-gto',
  'll2-sls',
  'll2-tbd',
  'll2-secret-named',
  'll2-no-provider',
  'll2-unknown-site',
  'll2-no-time',
  'll2-no-vehicle',
  'll2-no-orbit',
  'll2-no-webcast',
];

test('off keeps no-mission and named rows', () => {
  assert.equal(DEFAULT_LAUNCH_LIST_HIDE_NO_MISSION, false);
  assert.equal(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY, 'meridian.launchListHideNoMission');
  assert.equal(LAUNCH_LIST_HIDE_NO_MISSION_CHIP_LABEL, 'Hide no mission');
  assert.equal(LAUNCH_LIST_HIDE_NO_MISSION_CHIP_TITLE, 'Hide missions without a named mission');
  assert.equal(normalizeLaunchListHideNoMission(undefined), false);
  assert.equal(normalizeLaunchListHideNoMission(null), false);
  assert.equal(normalizeLaunchListHideNoMission(''), false);
  assert.equal(normalizeLaunchListHideNoMission(false), false);

  const rows = launchesPanelRows({ results: MIXED });
  assert.deepEqual(rows.map((row) => row.id), MIXED.map((row) => row.id));
  assert.equal(rows[0].mission, 'Starlink Group 10-1');
  assert.equal(rows[1].mission, null);
  assert.equal(rows[2].mission, null);
  assert.equal(rows[3].mission, '   ');
  assert.equal(rows[4].mission, 'Transporter-12');
  assert.equal(rows[5].mission, 'NROL-69');
  assert.equal(rows[6].mission, 'USSF-52');
  assert.equal(launchListRowMatchesMissionFilter(rows[1], false), true);
  assert.equal(launchListRowMatchesMissionFilter({ mission: null }, false), true);
  assert.equal(launchListRowMatchesMissionFilter({ mission: '' }, false), true);
  assert.equal(launchListRowMatchesMissionFilter(rows[0], false), true);
  assert.deepEqual(
    filterLaunchListByMission(rows, false).map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterLaunchListByMission(null), []);
  assert.deepEqual(filterLaunchListByMission(undefined), []);
});

test('on drops no-mission, keeps named missions', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', { hideNoMission: true });
  assert.deepEqual(rows.map((row) => row.id), NAMED_IDS);
  assert.ok(rows.every((row) => String(row.mission || '').trim() !== ''));
  assert.ok(!rows.some((row) => row.id === 'll2-no-mission'));
  assert.ok(!rows.some((row) => row.id === 'll2-empty-mission'));
  assert.ok(!rows.some((row) => row.id === 'll2-blank-mission'));
  assert.ok(!rows.some((row) => row.id === 'll2-ghost'));
  assert.ok(rows.some((row) => row.mission === 'Starlink Group 10-1'));
  assert.ok(rows.some((row) => row.mission === 'USSF-52'));

  const built = launchesPanelRows({ results: MIXED });
  assert.equal(launchListRowHasMission(built[0]), true);
  assert.equal(launchListRowHasMission(built[1]), false);
  assert.equal(launchListRowHasMission(built[2]), false);
  assert.equal(launchListRowHasMission(built[3]), false);
  assert.equal(launchListRowHasMission({}), false);
  assert.equal(launchListRowHasMission({ mission: null }), false);
  assert.equal(launchListMissionName({ mission: 'Starlink Group 10-1' }), 'Starlink Group 10-1');
  assert.equal(launchListMissionName({ mission: '   ' }), '');
  assert.equal(launchListMissionName({ mission: '' }), '');
  assert.equal(launchListMissionName({}), '');
  assert.equal(launchListMissionName({ mission: { name: 'Starlink Group 10-1' } }), 'Starlink Group 10-1');
  assert.equal(launchListMissionName({ mission_name: 'NROL-69' }), 'NROL-69');
  assert.equal(launchListRowMatchesMissionFilter(built[0], true), true);
  assert.equal(launchListRowMatchesMissionFilter(built[1], true), false);
  assert.equal(launchListRowMatchesMissionFilter({ id: 'x', mission: null }, true), false);
  assert.equal(launchListRowMatchesMissionFilter({ id: 'x' }, true), false);
  assert.equal(launchListRowMatchesMissionFilter({ id: 'x', mission: '' }, true), false);
  assert.equal(launchListRowMatchesMissionFilter({ id: 'x', mission: '   ' }, true), false);
  assert.deepEqual(
    filterLaunchListByMission(built, true).map((row) => row.id),
    NAMED_IDS,
  );
});

test('selected no-mission row still lists', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoMission: true,
    selectedId: 'll2-no-mission',
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['ll2-starlink', 'll2-no-mission', 'll2-string-mission', 'll2-mission-name', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast'],
  );
  assert.equal(
    launchListRowMatchesMissionFilter(
      { id: 'll2-no-mission', mission: null },
      true,
      { selectedId: 'll2-no-mission' },
    ),
    true,
  );
  assert.deepEqual(
    filterLaunchListByMission(
      launchesPanelRows({ results: MIXED }),
      true,
      'll2-empty-mission',
    ).map((row) => row.id),
    ['ll2-starlink', 'll2-empty-mission', 'll2-string-mission', 'll2-mission-name', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast'],
  );
});

test('invalid / corrupt storage reads as off', () => {
  assert.equal(normalizeLaunchListHideNoMission('bogus'), null);
  assert.equal(normalizeLaunchListHideNoMission('on'), null);
  assert.equal(readLaunchListHideNoMission(memoryStorage()), DEFAULT_LAUNCH_LIST_HIDE_NO_MISSION);
  assert.equal(readLaunchListHideNoMission(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readLaunchListHideNoMission(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY]: 'yes',
  })), false);
  assert.equal(writeLaunchListHideNoMission('nope', memoryStorage()), false);
});

test('persist / hydrate, no share-URL write', () => {
  const storage = memoryStorage();
  assert.equal(readLaunchListHideNoMission(storage), DEFAULT_LAUNCH_LIST_HIDE_NO_MISSION);
  assert.equal(writeLaunchListHideNoMission(true, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY), '1');
  assert.equal(readLaunchListHideNoMission(storage), true);
  assert.equal(readLaunchListHideNoMission(memoryStorage(storage.snapshot())), true, 'reload keeps on');

  const restored = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoMission: readLaunchListHideNoMission(memoryStorage(storage.snapshot())),
  });
  assert.deepEqual(restored.map((row) => row.id), NAMED_IDS);

  assert.equal(writeLaunchListHideNoMission(false, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY), '0');
  assert.equal(readLaunchListHideNoMission(memoryStorage(storage.snapshot())), false, 'reload keeps off');
  assert.equal(writeLaunchListHideNoMission('nope', storage), false);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY), '0');
});

test('rocketLaunches.js is unchanged', () => {
  const rocket = read('src/data/rocketLaunches.js');
  const globeRocket = read('src/data/launchRocketFilter.js');
  assert.doesNotMatch(rocket, /launchListMission|launchListHideNoMission|meridian\.launchListHideNoMission/);
  assert.doesNotMatch(rocket, /filterLaunchListByMission|readLaunchListHideNoMission|writeLaunchListHideNoMission/);
  assert.doesNotMatch(globeRocket, /launchListMission|launchListHideNoMission|meridian\.launchListHideNoMission/);
  assert.doesNotMatch(globeRocket, /filterLaunchListByMission|readLaunchListHideNoMission|writeLaunchListHideNoMission/);
});

test('AND with LSP/mapped/status/provider/site/time/vehicle/orbit/webcast', () => {
  assert.deepEqual(
    filterLaunchesByLspType(MIXED, 'commercial').map((row) => row.id),
    [
      'll2-starlink',
      'll2-no-mission',
      'll2-empty-mission',
      'll2-blank-mission',
      'll2-string-mission',
      'll2-mission-name',
      'll2-gto',
      'll2-tbd',
      'll2-secret-named',
      'll2-no-provider',
      'll2-unknown-site',
      'll2-no-time',
      'll2-no-vehicle',
      'll2-no-orbit',
      'll2-no-webcast',
    ],
  );
  const commercialOff = launchesPanelRows({ results: MIXED }, 'commercial');
  assert.deepEqual(
    commercialOff.map((row) => row.id),
    [
      'll2-starlink',
      'll2-no-mission',
      'll2-empty-mission',
      'll2-blank-mission',
      'll2-string-mission',
      'll2-mission-name',
      'll2-gto',
      'll2-tbd',
      'll2-secret-named',
      'll2-no-provider',
      'll2-unknown-site',
      'll2-no-time',
      'll2-no-vehicle',
      'll2-no-orbit',
      'll2-no-webcast',
    ],
  );

  const commercialOn = launchesPanelRows({ results: MIXED }, 'commercial', { hideNoMission: true });
  assert.deepEqual(
    commercialOn.map((row) => row.id),
    ['ll2-starlink', 'll2-string-mission', 'll2-mission-name', 'll2-gto', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast'],
  );

  const governmentOn = launchesPanelRows({ results: MIXED }, 'government', { hideNoMission: true });
  assert.deepEqual(governmentOn.map((row) => row.id), ['ll2-sls']);

  const mappedOn = launchesPanelRows({ results: MIXED }, 'all', {
    mappedOnly: true,
    hideNoMission: true,
  });
  assert.deepEqual(
    mappedOn.map((row) => row.id),
    ['ll2-starlink', 'll2-string-mission', 'll2-mission-name', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast'],
  );
  assert.ok(!mappedOn.some((row) => row.id === 'll2-secret-named'));

  const statusGo = launchesPanelRows({ results: MIXED }, 'all', {
    statusFilter: 'go',
    hideNoMission: true,
  });
  assert.deepEqual(
    statusGo.map((row) => row.id),
    ['ll2-starlink', 'll2-string-mission', 'll2-mission-name', 'll2-gto', 'll2-sls', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast'],
  );
  assert.ok(!statusGo.some((row) => row.id === 'll2-tbd'));

  const providerOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProvider: true,
    hideNoMission: true,
  });
  assert.deepEqual(
    providerOn.map((row) => row.id),
    ['ll2-starlink', 'll2-string-mission', 'll2-mission-name', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast'],
  );
  assert.ok(!providerOn.some((row) => row.id === 'll2-no-provider'));

  const siteOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoSite: true,
    hideNoMission: true,
  });
  assert.deepEqual(
    siteOn.map((row) => row.id),
    ['ll2-starlink', 'll2-string-mission', 'll2-mission-name', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast'],
  );
  assert.ok(!siteOn.some((row) => row.id === 'll2-unknown-site'));

  const timeOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoTime: true,
    hideNoMission: true,
  });
  assert.deepEqual(
    timeOn.map((row) => row.id),
    ['ll2-starlink', 'll2-string-mission', 'll2-mission-name', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast'],
  );
  assert.ok(!timeOn.some((row) => row.id === 'll2-no-time'));

  const vehicleOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoVehicle: true,
    hideNoMission: true,
  });
  assert.deepEqual(
    vehicleOn.map((row) => row.id),
    ['ll2-starlink', 'll2-string-mission', 'll2-mission-name', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-orbit', 'll2-no-webcast'],
  );
  assert.ok(!vehicleOn.some((row) => row.id === 'll2-no-vehicle'));

  const orbitOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoOrbit: true,
    hideNoMission: true,
  });
  assert.deepEqual(
    orbitOn.map((row) => row.id),
    ['ll2-starlink', 'll2-string-mission', 'll2-mission-name', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-webcast'],
  );
  assert.ok(!orbitOn.some((row) => row.id === 'll2-no-orbit'));

  const webcastOn = launchesPanelRows({ results: MIXED }, 'all', {
    webcastOnly: true,
    hideNoMission: true,
  });
  assert.deepEqual(
    webcastOn.map((row) => row.id),
    ['ll2-starlink', 'll2-string-mission', 'll2-mission-name', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit'],
  );
  assert.ok(!webcastOn.some((row) => row.id === 'll2-no-webcast'));

  const allNine = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
    hideNoSite: true,
    hideNoTime: true,
    hideNoVehicle: true,
    hideNoOrbit: true,
    webcastOnly: true,
    hideNoMission: true,
  });
  assert.deepEqual(
    allNine.map((row) => row.id),
    ['ll2-starlink', 'll2-string-mission', 'll2-mission-name', 'll2-gto'],
  );

  const allNineSelected = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
    hideNoSite: true,
    hideNoTime: true,
    hideNoVehicle: true,
    hideNoOrbit: true,
    webcastOnly: true,
    hideNoMission: true,
    selectedId: 'll2-no-mission',
  });
  assert.deepEqual(
    allNineSelected.map((row) => row.id),
    ['ll2-starlink', 'll2-no-mission', 'll2-string-mission', 'll2-mission-name', 'll2-gto'],
  );

  const afterMapped = filterLaunchListByMappedOnly(launchesPanelRows({ results: MIXED }), true);
  const afterStatus = filterLaunchListByStatus(afterMapped, 'go');
  const afterProvider = filterLaunchListByProvider(afterStatus, true);
  const afterSite = filterLaunchListBySite(afterProvider, true);
  const afterTime = filterLaunchListByTime(afterSite, true);
  const afterVehicle = filterLaunchListByVehicle(afterTime, true);
  const afterOrbit = filterLaunchListByOrbit(afterVehicle, true);
  const afterWebcast = filterLaunchListByWebcast(afterOrbit, true);
  assert.deepEqual(
    filterLaunchListByMission(afterWebcast, true).map((row) => row.id),
    ['ll2-starlink', 'll2-string-mission', 'll2-mission-name', 'll2-gto', 'll2-sls'],
  );
});

test('LayerStateCoordinator restore keeps meridian.launchListHideNoMission and does not write a share URL', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['rocket-launches']?.launchListHideNoMission, undefined);
  assert.equal(defaults.options['rocket-launches']?.hideNoMission, undefined);

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['rocket-launches'],
    options: { 'rocket-launches': { launchListHideNoMission: true, hideNoMission: true } },
  }));
  assert.doesNotMatch(encoded.toString(), /launchListHideNoMission|meridian\.launchListHideNoMission/);
  assert.doesNotMatch(encoded.get('lo') || '', /launchListHideNoMission|hideNoMission|listMission/);
  const decoded = decodeLayerStateParams(encoded);
  assert.equal(decoded.options['rocket-launches']?.launchListHideNoMission, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'rocket-launches')?.launchListHideNoMission, undefined);

  const storage = memoryStorage({ [LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY]: '1' });
  assert.equal(readLaunchListHideNoMission(storage), true, 'coordinator restore of layer options does not wipe the list key');
});

test('chip sits on the hosted Launches panel and re-applies the existing /api/launches payload', () => {
  const helper = read('src/data/launchListMissionFilter.js');
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
  const listWebcast = read('src/data/launchListWebcastFilter.js');

  assert.match(helper, /meridian\.launchListHideNoMission/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(/);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);
  assert.notEqual(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY, 'meridian.launchProvider');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY, 'meridian.launchLspType');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY, 'meridian.launchListMappedOnly');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY, 'meridian.launchListStatus');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY, 'meridian.launchListHideNoProvider');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY, 'meridian.launchListHideNoSite');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY, 'meridian.launchListHideNoTime');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY, 'meridian.launchListHideNoVehicle');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY, 'meridian.launchListHideNoOrbit');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY, 'meridian.launchListWebcastOnly');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY, 'meridian.launchOrbit');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY, 'meridian.launchRocket');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_MISSION_STORAGE_KEY, 'meridian.launchHideUnknownSite');

  assert.match(panel, /filterLaunchListByMission|launchListRowMatchesMissionFilter/);
  assert.match(panel, /launchesPanelRows\(/);
  assert.match(panel, /mission\.name|launch\.mission_name/);
  assert.doesNotMatch(panel, /\/api\/(?!launches\b)/);

  assert.match(html, /id="launches-panel"/);
  assert.match(html, /id="launches-panel-mission-chips"/);
  assert.match(html, /data-launch-list-hide-no-mission="only"/);
  assert.match(html, /Hide no mission/);
  assert.match(html, /Hide missions without a named mission/);
  assert.ok(
    html.indexOf('id="launches-panel-webcast-chips"') < html.indexOf('id="launches-panel-mission-chips"'),
    'Hide no mission sits after Webcast only',
  );
  assert.ok(
    html.indexOf('id="launches-panel"') < html.indexOf('id="launches-panel-mission-chips"'),
    'Hide no mission lives on the hosted Launches panel',
  );
  assert.ok(
    html.indexOf('data-launch-list-hide-no-mission="only"') < html.indexOf('id="earthquake-list-panel"'),
    'Hide no mission stays on the launches panel, not later list chrome',
  );
  assert.doesNotMatch(html, /data-launch-list-hide-no-mission="named"|data-launch-list-hide-no-mission="all"/);

  assert.match(ui, /readLaunchListHideNoMission/);
  assert.match(ui, /writeLaunchListHideNoMission/);
  assert.match(ui, /data-launch-list-hide-no-mission/);
  assert.doesNotMatch(ui, /getRowControls\(\)[\s\S]{0,200}hide-no-mission|hide-no-mission[\s\S]{0,200}getRowControls\(\)/);
  assert.match(css, /launches-panel-mission-chip/);

  assert.doesNotMatch(rocket, /launchListHideNoMission|meridian\.launchListHideNoMission/);
  assert.doesNotMatch(launches, /launchListHideNoMission|meridian\.launchListHideNoMission/);
  assert.doesNotMatch(layerState, /launchListHideNoMission|launchListMission/);
  assert.doesNotMatch(sharelink, /launchListHideNoMission|meridian\.launchListHideNoMission/);
  assert.match(firstRun, /meridian\.launchListHideNoMission/);
  assert.doesNotMatch(
    firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun')),
    /writeLaunchListHideNoMission|readLaunchListHideNoMission/,
  );
  assert.doesNotMatch(globeProvider, /meridian\.launchListHideNoMission|launchListMissionFilter/);
  assert.doesNotMatch(globeRocket, /meridian\.launchListHideNoMission|launchListMissionFilter/);
  assert.doesNotMatch(globeOrbit, /meridian\.launchListHideNoMission|launchListMissionFilter/);
  assert.doesNotMatch(globeWebcast, /meridian\.launchListHideNoMission|launchListMissionFilter/);
  assert.doesNotMatch(hideSite, /meridian\.launchListHideNoMission|launchListMissionFilter/);
  assert.doesNotMatch(hideProvider, /meridian\.launchListHideNoMission|launchListMissionFilter/);
  assert.doesNotMatch(listSite, /meridian\.launchListHideNoMission|launchListMissionFilter/);
  assert.doesNotMatch(listTime, /meridian\.launchListHideNoMission|launchListMissionFilter/);
  assert.doesNotMatch(listVehicle, /meridian\.launchListHideNoMission|launchListMissionFilter/);
  assert.doesNotMatch(listOrbit, /meridian\.launchListHideNoMission|launchListMissionFilter/);
  assert.doesNotMatch(listWebcast, /meridian\.launchListHideNoMission|launchListMissionFilter/);

  assert.equal(existsSync(path.join(ROOT, 'api/launches/mission.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.doesNotMatch(helper, /hideUnknownSite|launchHideUnknownSite|meridian\.launchHideUnknownSite/);
  assert.doesNotMatch(helper, /LAUNCH_WEBCAST_ONLY_STORAGE_KEY|setLaunchWebcastOnly/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(readme, /quantum-earth/);
  assert.doesNotMatch(readme, /God's Eye View branding/i);

  assert.equal(launchListHideNoMissionChipModel(false).params.hideNoMission, true);
  assert.equal(launchListHideNoMissionChipModel(true).params.hideNoMission, false);
  assert.equal(launchListHideNoMissionChipModel(false).label, 'Hide no mission');
});
