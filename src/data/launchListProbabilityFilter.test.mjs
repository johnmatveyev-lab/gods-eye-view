// PLAN 289 — Launches panel Hide no probability toggle. Client-only filter
// of already-fetched LL2 rows. Distinct from 207 LSP-type, 215 mapped-only,
// 223 status, 232 Hide no provider, 239 Hide no site, 248 Hide no time,
// 257 Hide no vehicle, 264 Hide no orbit, 272 Webcast only, and 283 Hide
// no mission. rocketLaunches.js and launchProbabilityFilter.js stay
// unchanged as the globe 50+ / 80+ floor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_PROBABILITY,
  LAUNCH_LIST_HIDE_NO_PROBABILITY_CHIP_LABEL,
  LAUNCH_LIST_HIDE_NO_PROBABILITY_CHIP_TITLE,
  LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY,
  filterLaunchListByProbability,
  launchListHideNoProbabilityChipModel,
  launchListProbability,
  launchListRowHasProbability,
  launchListRowMatchesProbabilityFilter,
  normalizeLaunchListHideNoProbability,
  readLaunchListHideNoProbability,
  writeLaunchListHideNoProbability,
} from './launchListProbabilityFilter.js';
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
import { filterLaunchListByMission } from './launchListMissionFilter.js';
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

const RATED_SPACEX_GO = {
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
  probability: 80,
};

const RATED_ZERO = {
  id: 'll2-zero',
  name: 'Falcon 9 | Weather Hold',
  rocketName: 'Falcon 9',
  mission: { name: 'Weather Hold' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-20T12:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.609', longitude: '-80.605', name: 'SLC-40' },
  webcast_live: true,
  probability: 0,
};

const MISSING_PROB_SPACEX = {
  id: 'll2-no-prob',
  name: 'Falcon 9 | Unrated',
  rocketName: 'Falcon 9',
  mission: { name: 'Unrated' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.4', longitude: '-80.6', name: 'SLC-40' },
  webcast_live: true,
};

const NULL_PROB = {
  id: 'll2-null-prob',
  name: 'Falcon 9 | Null Percent',
  rocketName: 'Falcon 9',
  mission: { name: 'Null Percent' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T11:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.41', longitude: '-80.61', name: 'SLC-40' },
  webcast_live: true,
  probability: null,
};

const NAN_PROB = {
  id: 'll2-nan-prob',
  name: 'Falcon 9 | NaN Percent',
  rocketName: 'Falcon 9',
  mission: { name: 'NaN Percent' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T12:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.42', longitude: '-80.62', name: 'SLC-40' },
  webcast_live: true,
  probability: Number.NaN,
};

const RATED_GTO = {
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
  probability: 90,
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
  probability: 70,
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
  probability: 85,
};

const RATED_NO_COORDS = {
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
  probability: 88,
};

const RATED_NO_PROVIDER = {
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
  probability: 75,
};

const RATED_UNKNOWN_SITE = {
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
  probability: 82,
};

const RATED_NO_TIME = {
  id: 'll2-no-time',
  name: 'Falcon 9 | Undated Window',
  rocketName: 'Falcon 9',
  mission: { name: 'Undated Window' },
  orbit: { name: 'Low Earth Orbit' },
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.45', longitude: '-80.65', name: 'SLC-40' },
  webcast_live: true,
  probability: 78,
};

const RATED_NO_VEHICLE = {
  id: 'll2-no-vehicle',
  name: 'Undisclosed Vehicle',
  mission: { name: 'Undisclosed Vehicle' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T13:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.46', longitude: '-80.66', name: 'SLC-40' },
  webcast_live: true,
  probability: 81,
};

const RATED_NO_ORBIT = {
  id: 'll2-no-orbit',
  name: 'Undisclosed Orbit',
  rocketName: 'Falcon 9',
  mission: { name: 'Undisclosed Orbit' },
  net: '2026-08-21T14:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.47', longitude: '-80.67', name: 'SLC-40' },
  webcast_live: true,
  probability: 79,
};

const RATED_NO_WEBCAST = {
  id: 'll2-no-webcast',
  name: 'Silent Falcon',
  rocketName: 'Falcon 9',
  mission: { name: 'Silent Falcon' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T15:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.48', longitude: '-80.68', name: 'SLC-40' },
  probability: 83,
};

const RATED_NO_MISSION = {
  id: 'll2-no-mission',
  name: 'Undisclosed Mission',
  rocketName: 'Falcon 9',
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T16:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.49', longitude: '-80.69', name: 'SLC-40' },
  webcast_live: true,
  probability: 76,
};

const MISSING_PROB_NO_TIME = {
  id: 'll2-ghost',
  name: 'Ghost Flight',
  status: { name: 'Go' },
  pad: { latitude: '28.1', longitude: '-80.1', location: {} },
};

const MIXED = Object.freeze([
  RATED_SPACEX_GO,
  RATED_ZERO,
  MISSING_PROB_SPACEX,
  NULL_PROB,
  NAN_PROB,
  RATED_GTO,
  NASA_GO,
  SPACEX_TBD,
  RATED_NO_COORDS,
  RATED_NO_PROVIDER,
  RATED_UNKNOWN_SITE,
  RATED_NO_TIME,
  RATED_NO_VEHICLE,
  RATED_NO_ORBIT,
  RATED_NO_WEBCAST,
  RATED_NO_MISSION,
  MISSING_PROB_NO_TIME,
]);

const RATED_IDS = [
  'll2-starlink',
  'll2-zero',
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
  'll2-no-mission',
];

test('off keeps no-probability and rated rows', () => {
  assert.equal(DEFAULT_LAUNCH_LIST_HIDE_NO_PROBABILITY, false);
  assert.equal(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchListHideNoProbability');
  assert.equal(LAUNCH_LIST_HIDE_NO_PROBABILITY_CHIP_LABEL, 'Hide no probability');
  assert.equal(LAUNCH_LIST_HIDE_NO_PROBABILITY_CHIP_TITLE, 'Hide missions without a launch probability');
  assert.equal(normalizeLaunchListHideNoProbability(undefined), false);
  assert.equal(normalizeLaunchListHideNoProbability(null), false);
  assert.equal(normalizeLaunchListHideNoProbability(''), false);
  assert.equal(normalizeLaunchListHideNoProbability(false), false);

  const rows = launchesPanelRows({ results: MIXED });
  assert.deepEqual(rows.map((row) => row.id), MIXED.map((row) => row.id));
  assert.equal(rows[0].probability, 80);
  assert.equal(rows[1].probability, 0);
  assert.equal(rows[2].probability, null);
  assert.equal(rows[3].probability, null);
  assert.equal(rows[4].probability, null);
  assert.equal(rows[5].probability, 90);
  assert.equal(launchListRowMatchesProbabilityFilter(rows[2], false), true);
  assert.equal(launchListRowMatchesProbabilityFilter({ probability: null }, false), true);
  assert.equal(launchListRowMatchesProbabilityFilter({ probability: Number.NaN }, false), true);
  assert.equal(launchListRowMatchesProbabilityFilter(rows[0], false), true);
  assert.equal(launchListRowMatchesProbabilityFilter(rows[1], false), true);
  assert.deepEqual(
    filterLaunchListByProbability(rows, false).map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterLaunchListByProbability(null), []);
  assert.deepEqual(filterLaunchListByProbability(undefined), []);
});

test('on drops no-probability, keeps rated including 0', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', { hideNoProbability: true });
  assert.deepEqual(rows.map((row) => row.id), RATED_IDS);
  assert.ok(rows.every((row) => Number.isFinite(row.probability)));
  assert.ok(rows.some((row) => row.id === 'll2-zero' && row.probability === 0));
  assert.ok(!rows.some((row) => row.id === 'll2-no-prob'));
  assert.ok(!rows.some((row) => row.id === 'll2-null-prob'));
  assert.ok(!rows.some((row) => row.id === 'll2-nan-prob'));
  assert.ok(!rows.some((row) => row.id === 'll2-ghost'));
  assert.ok(rows.some((row) => row.probability === 80));
  assert.ok(rows.some((row) => row.probability === 90));

  const built = launchesPanelRows({ results: MIXED });
  assert.equal(launchListRowHasProbability(built[0]), true);
  assert.equal(launchListRowHasProbability(built[1]), true);
  assert.equal(launchListRowHasProbability(built[2]), false);
  assert.equal(launchListRowHasProbability(built[3]), false);
  assert.equal(launchListRowHasProbability(built[4]), false);
  assert.equal(launchListRowHasProbability({}), false);
  assert.equal(launchListRowHasProbability({ probability: null }), false);
  assert.equal(launchListRowHasProbability({ probability: Number.NaN }), false);
  assert.equal(launchListRowHasProbability({ probability: Number.POSITIVE_INFINITY }), false);
  assert.equal(launchListProbability({ probability: 80 }), 80);
  assert.equal(launchListProbability({ probability: 0 }), 0);
  assert.equal(launchListProbability({ probability: null }), null);
  assert.equal(launchListProbability({}), null);
  assert.equal(launchListRowMatchesProbabilityFilter(built[0], true), true);
  assert.equal(launchListRowMatchesProbabilityFilter(built[1], true), true);
  assert.equal(launchListRowMatchesProbabilityFilter(built[2], true), false);
  assert.equal(launchListRowMatchesProbabilityFilter({ id: 'x', probability: null }, true), false);
  assert.equal(launchListRowMatchesProbabilityFilter({ id: 'x' }, true), false);
  assert.equal(launchListRowMatchesProbabilityFilter({ id: 'x', probability: Number.NaN }, true), false);
  assert.equal(launchListRowMatchesProbabilityFilter({ id: 'x', probability: 0 }, true), true);
  assert.deepEqual(
    filterLaunchListByProbability(built, true).map((row) => row.id),
    RATED_IDS,
  );
});

test('selected no-probability still lists', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProbability: true,
    selectedId: 'll2-no-prob',
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-no-prob', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast', 'll2-no-mission'],
  );
  assert.equal(
    launchListRowMatchesProbabilityFilter(
      { id: 'll2-no-prob', probability: null },
      true,
      { selectedId: 'll2-no-prob' },
    ),
    true,
  );
  assert.deepEqual(
    filterLaunchListByProbability(
      launchesPanelRows({ results: MIXED }),
      true,
      'll2-null-prob',
    ).map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-null-prob', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast', 'll2-no-mission'],
  );
});

test('invalid / corrupt storage reads as off', () => {
  assert.equal(normalizeLaunchListHideNoProbability('bogus'), null);
  assert.equal(normalizeLaunchListHideNoProbability('on'), null);
  assert.equal(readLaunchListHideNoProbability(memoryStorage()), DEFAULT_LAUNCH_LIST_HIDE_NO_PROBABILITY);
  assert.equal(readLaunchListHideNoProbability(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readLaunchListHideNoProbability(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY]: 'yes',
  })), false);
  assert.equal(writeLaunchListHideNoProbability('nope', memoryStorage()), false);
});

test('persist / hydrate, no share-URL write', () => {
  const storage = memoryStorage();
  assert.equal(readLaunchListHideNoProbability(storage), DEFAULT_LAUNCH_LIST_HIDE_NO_PROBABILITY);
  assert.equal(writeLaunchListHideNoProbability(true, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY), '1');
  assert.equal(readLaunchListHideNoProbability(storage), true);
  assert.equal(readLaunchListHideNoProbability(memoryStorage(storage.snapshot())), true, 'reload keeps on');

  const restored = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProbability: readLaunchListHideNoProbability(memoryStorage(storage.snapshot())),
  });
  assert.deepEqual(restored.map((row) => row.id), RATED_IDS);

  assert.equal(writeLaunchListHideNoProbability(false, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY), '0');
  assert.equal(readLaunchListHideNoProbability(memoryStorage(storage.snapshot())), false, 'reload keeps off');
  assert.equal(writeLaunchListHideNoProbability('nope', storage), false);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY), '0');
});

test('rocketLaunches.js is unchanged', () => {
  const rocket = read('src/data/rocketLaunches.js');
  const globeFloor = read('src/data/launchProbabilityFilter.js');
  assert.doesNotMatch(rocket, /launchListProbability|launchListHideNoProbability|meridian\.launchListHideNoProbability/);
  assert.doesNotMatch(rocket, /filterLaunchListByProbability|readLaunchListHideNoProbability|writeLaunchListHideNoProbability/);
  assert.doesNotMatch(globeFloor, /launchListProbability|launchListHideNoProbability|meridian\.launchListHideNoProbability/);
  assert.doesNotMatch(globeFloor, /filterLaunchListByProbability|readLaunchListHideNoProbability|writeLaunchListHideNoProbability/);
});

test('AND with LSP/mapped/status/provider/site/time/vehicle/orbit/webcast/mission', () => {
  assert.deepEqual(
    filterLaunchesByLspType(MIXED, 'commercial').map((row) => row.id),
    [
      'll2-starlink',
      'll2-zero',
      'll2-no-prob',
      'll2-null-prob',
      'll2-nan-prob',
      'll2-gto',
      'll2-tbd',
      'll2-secret-named',
      'll2-no-provider',
      'll2-unknown-site',
      'll2-no-time',
      'll2-no-vehicle',
      'll2-no-orbit',
      'll2-no-webcast',
      'll2-no-mission',
    ],
  );
  const commercialOff = launchesPanelRows({ results: MIXED }, 'commercial');
  assert.deepEqual(
    commercialOff.map((row) => row.id),
    [
      'll2-starlink',
      'll2-zero',
      'll2-no-prob',
      'll2-null-prob',
      'll2-nan-prob',
      'll2-gto',
      'll2-tbd',
      'll2-secret-named',
      'll2-no-provider',
      'll2-unknown-site',
      'll2-no-time',
      'll2-no-vehicle',
      'll2-no-orbit',
      'll2-no-webcast',
      'll2-no-mission',
    ],
  );

  const commercialOn = launchesPanelRows({ results: MIXED }, 'commercial', { hideNoProbability: true });
  assert.deepEqual(
    commercialOn.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast', 'll2-no-mission'],
  );

  const governmentOn = launchesPanelRows({ results: MIXED }, 'government', { hideNoProbability: true });
  assert.deepEqual(governmentOn.map((row) => row.id), ['ll2-sls']);

  const mappedOn = launchesPanelRows({ results: MIXED }, 'all', {
    mappedOnly: true,
    hideNoProbability: true,
  });
  assert.deepEqual(
    mappedOn.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast', 'll2-no-mission'],
  );
  assert.ok(!mappedOn.some((row) => row.id === 'll2-secret-named'));

  const statusGo = launchesPanelRows({ results: MIXED }, 'all', {
    statusFilter: 'go',
    hideNoProbability: true,
  });
  assert.deepEqual(
    statusGo.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-sls', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast', 'll2-no-mission'],
  );
  assert.ok(!statusGo.some((row) => row.id === 'll2-tbd'));

  const providerOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProvider: true,
    hideNoProbability: true,
  });
  assert.deepEqual(
    providerOn.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast', 'll2-no-mission'],
  );
  assert.ok(!providerOn.some((row) => row.id === 'll2-no-provider'));

  const siteOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoSite: true,
    hideNoProbability: true,
  });
  assert.deepEqual(
    siteOn.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast', 'll2-no-mission'],
  );
  assert.ok(!siteOn.some((row) => row.id === 'll2-unknown-site'));

  const timeOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoTime: true,
    hideNoProbability: true,
  });
  assert.deepEqual(
    timeOn.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast', 'll2-no-mission'],
  );
  assert.ok(!timeOn.some((row) => row.id === 'll2-no-time'));

  const vehicleOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoVehicle: true,
    hideNoProbability: true,
  });
  assert.deepEqual(
    vehicleOn.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-orbit', 'll2-no-webcast', 'll2-no-mission'],
  );
  assert.ok(!vehicleOn.some((row) => row.id === 'll2-no-vehicle'));

  const orbitOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoOrbit: true,
    hideNoProbability: true,
  });
  assert.deepEqual(
    orbitOn.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-webcast', 'll2-no-mission'],
  );
  assert.ok(!orbitOn.some((row) => row.id === 'll2-no-orbit'));

  const webcastOn = launchesPanelRows({ results: MIXED }, 'all', {
    webcastOnly: true,
    hideNoProbability: true,
  });
  assert.deepEqual(
    webcastOn.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-mission'],
  );
  assert.ok(!webcastOn.some((row) => row.id === 'll2-no-webcast'));

  const missionOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoMission: true,
    hideNoProbability: true,
  });
  assert.deepEqual(
    missionOn.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-sls', 'll2-tbd', 'll2-secret-named', 'll2-no-provider', 'll2-unknown-site', 'll2-no-time', 'll2-no-vehicle', 'll2-no-orbit', 'll2-no-webcast'],
  );
  assert.ok(!missionOn.some((row) => row.id === 'll2-no-mission'));

  const allTen = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
    hideNoSite: true,
    hideNoTime: true,
    hideNoVehicle: true,
    hideNoOrbit: true,
    webcastOnly: true,
    hideNoMission: true,
    hideNoProbability: true,
  });
  assert.deepEqual(
    allTen.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto'],
  );

  const allTenSelected = launchesPanelRows({ results: MIXED }, 'commercial', {
    mappedOnly: true,
    statusFilter: 'go',
    hideNoProvider: true,
    hideNoSite: true,
    hideNoTime: true,
    hideNoVehicle: true,
    hideNoOrbit: true,
    webcastOnly: true,
    hideNoMission: true,
    hideNoProbability: true,
    selectedId: 'll2-no-prob',
  });
  assert.deepEqual(
    allTenSelected.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-no-prob', 'll2-gto'],
  );

  const afterMapped = filterLaunchListByMappedOnly(launchesPanelRows({ results: MIXED }), true);
  const afterStatus = filterLaunchListByStatus(afterMapped, 'go');
  const afterProvider = filterLaunchListByProvider(afterStatus, true);
  const afterSite = filterLaunchListBySite(afterProvider, true);
  const afterTime = filterLaunchListByTime(afterSite, true);
  const afterVehicle = filterLaunchListByVehicle(afterTime, true);
  const afterOrbit = filterLaunchListByOrbit(afterVehicle, true);
  const afterWebcast = filterLaunchListByWebcast(afterOrbit, true);
  const afterMission = filterLaunchListByMission(afterWebcast, true);
  assert.deepEqual(
    filterLaunchListByProbability(afterMission, true).map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-sls'],
  );
});

test('LayerStateCoordinator restore keeps meridian.launchListHideNoProbability and does not write a share URL', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['rocket-launches']?.launchListHideNoProbability, undefined);
  assert.equal(defaults.options['rocket-launches']?.hideNoProbability, undefined);

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['rocket-launches'],
    options: { 'rocket-launches': { launchListHideNoProbability: true, hideNoProbability: true } },
  }));
  assert.doesNotMatch(encoded.toString(), /launchListHideNoProbability|meridian\.launchListHideNoProbability/);
  assert.doesNotMatch(encoded.get('lo') || '', /launchListHideNoProbability|hideNoProbability|listProbability/);
  const decoded = decodeLayerStateParams(encoded);
  assert.equal(decoded.options['rocket-launches']?.launchListHideNoProbability, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'rocket-launches')?.launchListHideNoProbability, undefined);

  const storage = memoryStorage({ [LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY]: '1' });
  assert.equal(readLaunchListHideNoProbability(storage), true, 'coordinator restore of layer options does not wipe the list key');
});

test('chip sits on the hosted Launches panel and re-applies the existing /api/launches payload', () => {
  const helper = read('src/data/launchListProbabilityFilter.js');
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
  const globeFloor = read('src/data/launchProbabilityFilter.js');
  const hideSite = read('src/data/launchUnknownSiteFilter.js');
  const hideProvider = read('src/data/launchListProviderFilter.js');
  const listSite = read('src/data/launchListSiteFilter.js');
  const listTime = read('src/data/launchListTimeFilter.js');
  const listVehicle = read('src/data/launchListVehicleFilter.js');
  const listOrbit = read('src/data/launchListOrbitFilter.js');
  const listWebcast = read('src/data/launchListWebcastFilter.js');
  const listMission = read('src/data/launchListMissionFilter.js');

  assert.match(helper, /meridian\.launchListHideNoProbability/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(/);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchProvider');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchLspType');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchListMappedOnly');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchListStatus');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchListHideNoProvider');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchListHideNoSite');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchListHideNoTime');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchListHideNoVehicle');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchListHideNoOrbit');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchListWebcastOnly');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchListHideNoMission');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchOrbit');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchRocket');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchHideUnknownSite');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROBABILITY_STORAGE_KEY, 'meridian.launchProbability');

  assert.match(panel, /filterLaunchListByProbability|launchListRowMatchesProbabilityFilter/);
  assert.match(panel, /launchesPanelRows\(/);
  assert.match(panel, /Number\.isFinite\(launch\.probability\)/);
  assert.doesNotMatch(panel, /\/api\/(?!launches\b)/);

  assert.match(html, /id="launches-panel"/);
  assert.match(html, /id="launches-panel-probability-chips"/);
  assert.match(html, /data-launch-list-hide-no-probability="only"/);
  assert.match(html, /Hide no probability/);
  assert.match(html, /Hide missions without a launch probability/);
  assert.ok(
    html.indexOf('id="launches-panel-mission-chips"') < html.indexOf('id="launches-panel-probability-chips"'),
    'Hide no probability sits after Hide no mission',
  );
  assert.ok(
    html.indexOf('id="launches-panel"') < html.indexOf('id="launches-panel-probability-chips"'),
    'Hide no probability lives on the hosted Launches panel',
  );
  assert.ok(
    html.indexOf('data-launch-list-hide-no-probability="only"') < html.indexOf('id="earthquake-list-panel"'),
    'Hide no probability stays on the launches panel, not later list chrome',
  );
  assert.doesNotMatch(html, /data-launch-list-hide-no-probability="rated"|data-launch-list-hide-no-probability="all"/);
  assert.doesNotMatch(html, /data-launch-list-hide-no-probability="50"|data-launch-list-hide-no-probability="80"/);

  assert.match(ui, /readLaunchListHideNoProbability/);
  assert.match(ui, /writeLaunchListHideNoProbability/);
  assert.match(ui, /data-launch-list-hide-no-probability/);
  assert.doesNotMatch(ui, /getRowControls\(\)[\s\S]{0,200}hide-no-probability|hide-no-probability[\s\S]{0,200}getRowControls\(\)/);
  assert.match(css, /launches-panel-probability-chip/);

  assert.doesNotMatch(rocket, /launchListHideNoProbability|meridian\.launchListHideNoProbability/);
  assert.doesNotMatch(launches, /launchListHideNoProbability|meridian\.launchListHideNoProbability/);
  assert.doesNotMatch(layerState, /launchListHideNoProbability|launchListProbability/);
  assert.doesNotMatch(sharelink, /launchListHideNoProbability|meridian\.launchListHideNoProbability/);
  assert.match(firstRun, /meridian\.launchListHideNoProbability/);
  assert.doesNotMatch(
    firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun')),
    /writeLaunchListHideNoProbability|readLaunchListHideNoProbability/,
  );
  assert.doesNotMatch(globeProvider, /meridian\.launchListHideNoProbability|launchListProbabilityFilter/);
  assert.doesNotMatch(globeRocket, /meridian\.launchListHideNoProbability|launchListProbabilityFilter/);
  assert.doesNotMatch(globeOrbit, /meridian\.launchListHideNoProbability|launchListProbabilityFilter/);
  assert.doesNotMatch(globeWebcast, /meridian\.launchListHideNoProbability|launchListProbabilityFilter/);
  assert.doesNotMatch(globeFloor, /meridian\.launchListHideNoProbability|launchListProbabilityFilter/);
  assert.doesNotMatch(hideSite, /meridian\.launchListHideNoProbability|launchListProbabilityFilter/);
  assert.doesNotMatch(hideProvider, /meridian\.launchListHideNoProbability|launchListProbabilityFilter/);
  assert.doesNotMatch(listSite, /meridian\.launchListHideNoProbability|launchListProbabilityFilter/);
  assert.doesNotMatch(listTime, /meridian\.launchListHideNoProbability|launchListProbabilityFilter/);
  assert.doesNotMatch(listVehicle, /meridian\.launchListHideNoProbability|launchListProbabilityFilter/);
  assert.doesNotMatch(listOrbit, /meridian\.launchListHideNoProbability|launchListProbabilityFilter/);
  assert.doesNotMatch(listWebcast, /meridian\.launchListHideNoProbability|launchListProbabilityFilter/);
  assert.doesNotMatch(listMission, /meridian\.launchListHideNoProbability|launchListProbabilityFilter/);

  assert.equal(existsSync(path.join(ROOT, 'api/launches/probability.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.doesNotMatch(helper, /hideUnknownSite|launchHideUnknownSite|meridian\.launchHideUnknownSite/);
  assert.doesNotMatch(helper, /LAUNCH_PROBABILITY_STORAGE_KEY|setLaunchProbabilityFilter/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(readme, /quantum-earth/);
  assert.doesNotMatch(readme, /God's Eye View branding/i);

  assert.equal(launchListHideNoProbabilityChipModel(false).params.hideNoProbability, true);
  assert.equal(launchListHideNoProbabilityChipModel(true).params.hideNoProbability, false);
  assert.equal(launchListHideNoProbabilityChipModel(false).label, 'Hide no probability');
});
