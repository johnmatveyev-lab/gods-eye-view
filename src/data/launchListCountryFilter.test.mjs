// PLAN 295 leftover — Launches panel Hide no country toggle. Client-only
// filter of already-fetched LL2 rows. Distinct from 207 LSP-type, 215
// mapped-only, 223 status, 232 Hide no provider, 239 Hide no site, 248
// Hide no time, 257 Hide no vehicle, 264 Hide no orbit, 272 Webcast only,
// 283 Hide no mission, and 289 Hide no probability. rocketLaunches.js
// stays unchanged as the globe launch layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_COUNTRY,
  LAUNCH_LIST_HIDE_NO_COUNTRY_CHIP_LABEL,
  LAUNCH_LIST_HIDE_NO_COUNTRY_CHIP_TITLE,
  LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY,
  filterLaunchListByCountry,
  launchListCountryName,
  launchListHideNoCountryChipModel,
  launchListRowHasCountry,
  launchListRowMatchesCountryFilter,
  normalizeLaunchListHideNoCountry,
  readLaunchListHideNoCountry,
  writeLaunchListHideNoCountry,
} from './launchListCountryFilter.js';
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
import { filterLaunchListByProbability } from './launchListProbabilityFilter.js';
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

function withPadCountry(launch, countryName, via = 'pad') {
  const pad = { ...(launch.pad || {}) };
  if (via === 'location') {
    pad.location = { ...(pad.location || {}), country: { name: countryName } };
  } else if (via === 'both') {
    pad.country = { name: countryName };
    pad.location = { ...(pad.location || {}), country: { name: 'France' } };
  } else {
    pad.country = { name: countryName };
  }
  return { ...launch, pad };
}

const USA = 'United States';

const RATED_SPACEX_GO = withPadCountry({
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
}, USA);

const RATED_ZERO = withPadCountry({
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
}, USA);

const MISSING_PROB_SPACEX = withPadCountry({
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
}, USA);

const NULL_PROB = withPadCountry({
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
}, USA);

const NAN_PROB = withPadCountry({
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
}, USA);

const RATED_GTO = withPadCountry({
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
}, USA);

const NASA_GO = withPadCountry({
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
}, USA);

const SPACEX_TBD = withPadCountry({
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
}, USA);

const RATED_NO_COORDS = withPadCountry({
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
}, USA);

const RATED_NO_PROVIDER = withPadCountry({
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
}, USA);

const RATED_UNKNOWN_SITE = withPadCountry({
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
}, USA);

const RATED_NO_TIME = withPadCountry({
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
}, USA);

const RATED_NO_VEHICLE = withPadCountry({
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
}, USA);

const RATED_NO_ORBIT = withPadCountry({
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
}, USA);

const RATED_NO_WEBCAST = withPadCountry({
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
}, USA);

const RATED_NO_MISSION = withPadCountry({
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
}, USA);

const RATED_NO_COUNTRY = {
  id: 'll2-no-country',
  name: 'Falcon 9 | No Country',
  rocketName: 'Falcon 9',
  mission: { name: 'No Country' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T17:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.50', longitude: '-80.70', name: 'SLC-40' },
  webcast_live: true,
  probability: 84,
};

const WS_COUNTRY = withPadCountry({
  id: 'll2-ws-country',
  name: 'Falcon 9 | Blank Country',
  rocketName: 'Falcon 9',
  mission: { name: 'Blank Country' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T18:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.51', longitude: '-80.71', name: 'SLC-40' },
  webcast_live: true,
  probability: 77,
}, '   ');

const TRIM_COUNTRY = withPadCountry({
  id: 'll2-trim-country',
  name: 'Falcon 9 | Trim Country',
  rocketName: 'Falcon 9',
  mission: { name: 'Trim Country' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T19:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.52', longitude: '-80.72', name: 'SLC-40' },
  webcast_live: true,
  probability: 86,
}, '  United States  ');

const LOC_COUNTRY = withPadCountry({
  id: 'll2-loc-country',
  name: 'Ariane 6 | Location Country',
  rocketName: 'Ariane 6',
  mission: { name: 'Location Country' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T20:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'Arianespace', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '5.2', longitude: '-52.7', name: 'ELA-4' },
  webcast_live: true,
  probability: 72,
}, 'France', 'location');

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
  RATED_NO_COUNTRY,
  WS_COUNTRY,
  TRIM_COUNTRY,
  LOC_COUNTRY,
  MISSING_PROB_NO_TIME,
]);

const COUNTRY_IDS = [
  'll2-starlink',
  'll2-zero',
  'll2-no-prob',
  'll2-null-prob',
  'll2-nan-prob',
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
  'll2-trim-country',
  'll2-loc-country',
];

test('off keeps no-country and country rows', () => {
  assert.equal(DEFAULT_LAUNCH_LIST_HIDE_NO_COUNTRY, false);
  assert.equal(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.launchListHideNoCountry');
  assert.equal(LAUNCH_LIST_HIDE_NO_COUNTRY_CHIP_LABEL, 'Hide no country');
  assert.equal(LAUNCH_LIST_HIDE_NO_COUNTRY_CHIP_TITLE, 'Hide missions without a pad country');
  assert.equal(normalizeLaunchListHideNoCountry(undefined), false);
  assert.equal(normalizeLaunchListHideNoCountry(null), false);
  assert.equal(normalizeLaunchListHideNoCountry(''), false);
  assert.equal(normalizeLaunchListHideNoCountry(false), false);

  const rows = launchesPanelRows({ results: MIXED });
  assert.deepEqual(rows.map((row) => row.id), MIXED.map((row) => row.id));
  assert.equal(rows[0].country, USA);
  assert.equal(rows.find((row) => row.id === 'll2-no-country')?.country, null);
  assert.equal(rows.find((row) => row.id === 'll2-ws-country')?.country, null);
  assert.equal(rows.find((row) => row.id === 'll2-trim-country')?.country, USA);
  assert.equal(rows.find((row) => row.id === 'll2-loc-country')?.country, 'France');
  assert.equal(rows.find((row) => row.id === 'll2-ghost')?.country, null);
  assert.equal(launchListRowMatchesCountryFilter(rows.find((row) => row.id === 'll2-no-country'), false), true);
  assert.equal(launchListRowMatchesCountryFilter({ country: null }, false), true);
  assert.equal(launchListRowMatchesCountryFilter({ country: '   ' }, false), true);
  assert.equal(launchListRowMatchesCountryFilter(rows[0], false), true);
  assert.deepEqual(
    filterLaunchListByCountry(rows, false).map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterLaunchListByCountry(null), []);
  assert.deepEqual(filterLaunchListByCountry(undefined), []);
});

test('on drops no-country / whitespace; keeps a trimmed country', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', { hideNoCountry: true });
  assert.deepEqual(rows.map((row) => row.id), COUNTRY_IDS);
  assert.ok(rows.every((row) => typeof row.country === 'string' && row.country.trim() !== ''));
  assert.ok(rows.some((row) => row.id === 'll2-trim-country' && row.country === USA));
  assert.ok(rows.some((row) => row.id === 'll2-loc-country' && row.country === 'France'));
  assert.ok(!rows.some((row) => row.id === 'll2-no-country'));
  assert.ok(!rows.some((row) => row.id === 'll2-ws-country'));
  assert.ok(!rows.some((row) => row.id === 'll2-ghost'));

  const built = launchesPanelRows({ results: MIXED });
  assert.equal(launchListRowHasCountry(built[0]), true);
  assert.equal(launchListRowHasCountry(built.find((row) => row.id === 'll2-no-country')), false);
  assert.equal(launchListRowHasCountry(built.find((row) => row.id === 'll2-ws-country')), false);
  assert.equal(launchListRowHasCountry(built.find((row) => row.id === 'll2-trim-country')), true);
  assert.equal(launchListRowHasCountry(built.find((row) => row.id === 'll2-loc-country')), true);
  assert.equal(launchListRowHasCountry({}), false);
  assert.equal(launchListRowHasCountry({ country: null }), false);
  assert.equal(launchListRowHasCountry({ country: '   ' }), false);
  assert.equal(launchListCountryName({ country: '  United States  ' }), USA);
  assert.equal(launchListCountryName({ country: '   ' }), '');
  assert.equal(launchListCountryName({}), '');
  assert.equal(launchListCountryName({ pad: { country: { name: USA } } }), USA);
  assert.equal(launchListCountryName({ pad: { location: { country: { name: 'France' } } } }), 'France');
  assert.equal(launchListCountryName({
    pad: { country: { name: '   ' }, location: { country: { name: 'France' } } },
  }), 'France');
  assert.equal(launchListCountryName({
    pad: { country: { name: USA }, location: { country: { name: 'France' } } },
  }), USA);
  assert.equal(launchListRowMatchesCountryFilter(built[0], true), true);
  assert.equal(launchListRowMatchesCountryFilter(built.find((row) => row.id === 'll2-no-country'), true), false);
  assert.equal(launchListRowMatchesCountryFilter({ id: 'x', country: null }, true), false);
  assert.equal(launchListRowMatchesCountryFilter({ id: 'x' }, true), false);
  assert.equal(launchListRowMatchesCountryFilter({ id: 'x', country: '   ' }, true), false);
  assert.equal(launchListRowMatchesCountryFilter({ id: 'x', country: USA }, true), true);
  assert.deepEqual(
    filterLaunchListByCountry(built, true).map((row) => row.id),
    COUNTRY_IDS,
  );
});

test('selected no-country still lists', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoCountry: true,
    selectedId: 'll2-no-country',
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    [
      'll2-starlink',
      'll2-zero',
      'll2-no-prob',
      'll2-null-prob',
      'll2-nan-prob',
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
      'll2-no-country',
      'll2-trim-country',
      'll2-loc-country',
    ],
  );
  assert.equal(
    launchListRowMatchesCountryFilter(
      { id: 'll2-no-country', country: null },
      true,
      { selectedId: 'll2-no-country' },
    ),
    true,
  );
  assert.deepEqual(
    filterLaunchListByCountry(
      launchesPanelRows({ results: MIXED }),
      true,
      'll2-ws-country',
    ).map((row) => row.id),
    [
      'll2-starlink',
      'll2-zero',
      'll2-no-prob',
      'll2-null-prob',
      'll2-nan-prob',
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
      'll2-ws-country',
      'll2-trim-country',
      'll2-loc-country',
    ],
  );
});

test('invalid / corrupt storage reads as off', () => {
  assert.equal(normalizeLaunchListHideNoCountry('bogus'), null);
  assert.equal(normalizeLaunchListHideNoCountry('on'), null);
  assert.equal(readLaunchListHideNoCountry(memoryStorage()), DEFAULT_LAUNCH_LIST_HIDE_NO_COUNTRY);
  assert.equal(readLaunchListHideNoCountry(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readLaunchListHideNoCountry(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY]: 'yes',
  })), false);
  assert.equal(writeLaunchListHideNoCountry('nope', memoryStorage()), false);
});

test('persist / hydrate, no share-URL write', () => {
  const storage = memoryStorage();
  assert.equal(readLaunchListHideNoCountry(storage), DEFAULT_LAUNCH_LIST_HIDE_NO_COUNTRY);
  assert.equal(writeLaunchListHideNoCountry(true, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY), '1');
  assert.equal(readLaunchListHideNoCountry(storage), true);
  assert.equal(readLaunchListHideNoCountry(memoryStorage(storage.snapshot())), true, 'reload keeps on');

  const restored = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoCountry: readLaunchListHideNoCountry(memoryStorage(storage.snapshot())),
  });
  assert.deepEqual(restored.map((row) => row.id), COUNTRY_IDS);

  assert.equal(writeLaunchListHideNoCountry(false, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY), '0');
  assert.equal(readLaunchListHideNoCountry(memoryStorage(storage.snapshot())), false, 'reload keeps off');
  assert.equal(writeLaunchListHideNoCountry('nope', storage), false);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY), '0');
});

test('rocketLaunches.js and sibling data sources stay unchanged', () => {
  const rocket = read('src/data/rocketLaunches.js');
  const flights = read('src/data/flights.js');
  const military = read('src/data/militaryFlights.js');
  const dams = read('src/data/damsList.js');
  const datacenters = read('src/data/datacenterList.js');
  const localGeo = read('src/data/localGeojson.js');
  for (const source of [rocket, flights, military, dams, datacenters, localGeo]) {
    assert.doesNotMatch(source, /launchListCountry|launchListHideNoCountry|meridian\.launchListHideNoCountry/);
    assert.doesNotMatch(source, /filterLaunchListByCountry|readLaunchListHideNoCountry|writeLaunchListHideNoCountry/);
  }
});

test('AND with 207/215/223/232/239/248/257/264/272/283/289', () => {
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
      'll2-no-country',
      'll2-ws-country',
      'll2-trim-country',
      'll2-loc-country',
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
      'll2-no-country',
      'll2-ws-country',
      'll2-trim-country',
      'll2-loc-country',
    ],
  );

  const commercialOn = launchesPanelRows({ results: MIXED }, 'commercial', { hideNoCountry: true });
  assert.deepEqual(
    commercialOn.map((row) => row.id),
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
      'll2-trim-country',
      'll2-loc-country',
    ],
  );

  const governmentOn = launchesPanelRows({ results: MIXED }, 'government', { hideNoCountry: true });
  assert.deepEqual(governmentOn.map((row) => row.id), ['ll2-sls']);

  const mappedOn = launchesPanelRows({ results: MIXED }, 'all', {
    mappedOnly: true,
    hideNoCountry: true,
  });
  assert.deepEqual(
    mappedOn.map((row) => row.id),
    [
      'll2-starlink',
      'll2-zero',
      'll2-no-prob',
      'll2-null-prob',
      'll2-nan-prob',
      'll2-gto',
      'll2-sls',
      'll2-tbd',
      'll2-no-provider',
      'll2-unknown-site',
      'll2-no-time',
      'll2-no-vehicle',
      'll2-no-orbit',
      'll2-no-webcast',
      'll2-no-mission',
      'll2-trim-country',
      'll2-loc-country',
    ],
  );
  assert.ok(!mappedOn.some((row) => row.id === 'll2-secret-named'));

  const statusGo = launchesPanelRows({ results: MIXED }, 'all', {
    statusFilter: 'go',
    hideNoCountry: true,
  });
  assert.deepEqual(
    statusGo.map((row) => row.id),
    [
      'll2-starlink',
      'll2-zero',
      'll2-no-prob',
      'll2-null-prob',
      'll2-nan-prob',
      'll2-gto',
      'll2-sls',
      'll2-secret-named',
      'll2-no-provider',
      'll2-unknown-site',
      'll2-no-time',
      'll2-no-vehicle',
      'll2-no-orbit',
      'll2-no-webcast',
      'll2-no-mission',
      'll2-trim-country',
      'll2-loc-country',
    ],
  );
  assert.ok(!statusGo.some((row) => row.id === 'll2-tbd'));

  const providerOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProvider: true,
    hideNoCountry: true,
  });
  assert.ok(!providerOn.some((row) => row.id === 'll2-no-provider'));
  assert.ok(!providerOn.some((row) => row.id === 'll2-no-country'));

  const siteOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoSite: true,
    hideNoCountry: true,
  });
  assert.ok(!siteOn.some((row) => row.id === 'll2-unknown-site'));
  assert.ok(!siteOn.some((row) => row.id === 'll2-no-country'));
  assert.ok(siteOn.some((row) => row.id === 'll2-starlink'));

  const timeOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoTime: true,
    hideNoCountry: true,
  });
  assert.ok(!timeOn.some((row) => row.id === 'll2-no-time'));
  assert.ok(!timeOn.some((row) => row.id === 'll2-no-country'));

  const vehicleOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoVehicle: true,
    hideNoCountry: true,
  });
  assert.ok(!vehicleOn.some((row) => row.id === 'll2-no-vehicle'));
  assert.ok(!vehicleOn.some((row) => row.id === 'll2-no-country'));

  const orbitOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoOrbit: true,
    hideNoCountry: true,
  });
  assert.ok(!orbitOn.some((row) => row.id === 'll2-no-orbit'));
  assert.ok(!orbitOn.some((row) => row.id === 'll2-no-country'));

  const webcastOn = launchesPanelRows({ results: MIXED }, 'all', {
    webcastOnly: true,
    hideNoCountry: true,
  });
  assert.ok(!webcastOn.some((row) => row.id === 'll2-no-webcast'));
  assert.ok(!webcastOn.some((row) => row.id === 'll2-no-country'));

  const missionOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoMission: true,
    hideNoCountry: true,
  });
  assert.ok(!missionOn.some((row) => row.id === 'll2-no-mission'));
  assert.ok(!missionOn.some((row) => row.id === 'll2-no-country'));

  const probabilityOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProbability: true,
    hideNoCountry: true,
  });
  assert.ok(!probabilityOn.some((row) => row.id === 'll2-no-prob'));
  assert.ok(!probabilityOn.some((row) => row.id === 'll2-no-country'));
  assert.ok(!probabilityOn.some((row) => row.id === 'll2-ws-country'));
  assert.ok(probabilityOn.some((row) => row.id === 'll2-starlink'));
  assert.ok(probabilityOn.some((row) => row.id === 'll2-zero'));
  assert.ok(probabilityOn.some((row) => row.id === 'll2-trim-country'));
  assert.ok(probabilityOn.some((row) => row.id === 'll2-loc-country'));

  const allEleven = launchesPanelRows({ results: MIXED }, 'commercial', {
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
    hideNoCountry: true,
  });
  assert.deepEqual(
    allEleven.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-trim-country', 'll2-loc-country'],
  );

  const allElevenSelected = launchesPanelRows({ results: MIXED }, 'commercial', {
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
    hideNoCountry: true,
    selectedId: 'll2-no-country',
  });
  assert.deepEqual(
    allElevenSelected.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-no-country', 'll2-trim-country', 'll2-loc-country'],
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
  const afterProbability = filterLaunchListByProbability(afterMission, true);
  assert.deepEqual(
    filterLaunchListByCountry(afterProbability, true).map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-sls', 'll2-trim-country', 'll2-loc-country'],
  );
});

test('LayerStateCoordinator restore keeps meridian.launchListHideNoCountry and does not write a share URL', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['rocket-launches']?.launchListHideNoCountry, undefined);
  assert.equal(defaults.options['rocket-launches']?.hideNoCountry, undefined);

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['rocket-launches'],
    options: { 'rocket-launches': { launchListHideNoCountry: true, hideNoCountry: true } },
  }));
  assert.doesNotMatch(encoded.toString(), /launchListHideNoCountry|meridian\.launchListHideNoCountry/);
  assert.doesNotMatch(encoded.get('lo') || '', /launchListHideNoCountry|hideNoCountry|listCountry/);
  const decoded = decodeLayerStateParams(encoded);
  assert.equal(decoded.options['rocket-launches']?.launchListHideNoCountry, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'rocket-launches')?.launchListHideNoCountry, undefined);

  const storage = memoryStorage({ [LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY]: '1' });
  assert.equal(readLaunchListHideNoCountry(storage), true, 'coordinator restore of layer options does not wipe the list key');
});

test('distinct from 207/215/223/232/239/248/257/264/272/283/289', () => {
  assert.notEqual(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.launchLspType');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.launchListMappedOnly');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.launchListStatus');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.launchListHideNoProvider');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.launchListHideNoSite');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.launchListHideNoTime');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.launchListHideNoVehicle');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.launchListHideNoOrbit');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.launchListWebcastOnly');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.launchListHideNoMission');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.launchListHideNoProbability');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.launchHideUnknownSite');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.launchProbability');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.flightHideNoCountry');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_COUNTRY_STORAGE_KEY, 'meridian.flightHideNoPositionTime');

  const namedSiteNoCountry = launchesPanelRows({
    results: [RATED_NO_COUNTRY],
  }, 'all', { hideNoSite: true, hideNoCountry: true });
  assert.deepEqual(namedSiteNoCountry.map((row) => row.id), []);

  const namedSiteKeep = launchesPanelRows({
    results: [RATED_NO_COUNTRY],
  }, 'all', { hideNoSite: true });
  assert.deepEqual(namedSiteKeep.map((row) => row.id), ['ll2-no-country']);
  assert.equal(namedSiteKeep[0].launchSite, 'SLC-40');
  assert.equal(namedSiteKeep[0].country, null);

  const ratedNoCountry = launchesPanelRows({
    results: [RATED_NO_COUNTRY],
  }, 'all', { hideNoProbability: true, hideNoCountry: true });
  assert.deepEqual(ratedNoCountry.map((row) => row.id), []);
});

test('chip sits on the hosted Launches panel and re-applies the existing /api/launches payload', () => {
  const helper = read('src/data/launchListCountryFilter.js');
  const panel = read('src/data/launchesPanel.js');
  const html = read('index.html');
  const ui = read('src/ui.js');
  const css = read('style.css');
  const rocket = read('src/data/rocketLaunches.js');
  const launches = read('src/data/launches.js');
  const layerState = read('src/data/layerState.js');
  const sharelink = read('src/sharelink.js');
  const firstRun = read('src/firstRunExperience.js');
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
  const listProbability = read('src/data/launchListProbabilityFilter.js');

  assert.match(helper, /meridian\.launchListHideNoCountry/);
  assert.match(helper, /pad\.country\.name/);
  assert.match(helper, /pad\.location\.country\.name/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(/);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);

  assert.match(panel, /filterLaunchListByCountry|launchListRowMatchesCountryFilter/);
  assert.match(panel, /launchesPanelRows\(/);
  assert.match(panel, /launchListCountryName\(launch\)/);
  assert.match(panel, /filterLaunchListByCountry\(\s*filterLaunchListByProbability/);
  assert.doesNotMatch(panel, /\/api\/(?!launches\b)/);

  assert.match(html, /id="launches-panel"/);
  assert.match(html, /id="launches-panel-country-chips"/);
  assert.match(html, /data-launch-list-hide-no-country="only"/);
  assert.match(html, /Hide no country/);
  assert.match(html, /Hide missions without a pad country/);
  assert.ok(
    html.indexOf('id="launches-panel-probability-chips"') < html.indexOf('id="launches-panel-country-chips"'),
    'Hide no country sits after Hide no probability',
  );
  assert.ok(
    html.indexOf('id="launches-panel"') < html.indexOf('id="launches-panel-country-chips"'),
    'Hide no country lives on the hosted Launches panel',
  );
  assert.ok(
    html.indexOf('data-launch-list-hide-no-country="only"') < html.indexOf('id="earthquake-list-panel"'),
    'Hide no country stays on the launches panel, not later list chrome',
  );
  assert.doesNotMatch(html, /data-launch-list-hide-no-country="named"|data-launch-list-hide-no-country="all"/);

  assert.match(ui, /readLaunchListHideNoCountry/);
  assert.match(ui, /writeLaunchListHideNoCountry/);
  assert.match(ui, /data-launch-list-hide-no-country/);
  assert.doesNotMatch(ui, /getRowControls\(\)[\s\S]{0,200}hide-no-country|hide-no-country[\s\S]{0,200}getRowControls\(\)/);
  assert.match(css, /launches-panel-country-chip/);

  assert.doesNotMatch(rocket, /launchListHideNoCountry|meridian\.launchListHideNoCountry/);
  assert.doesNotMatch(launches, /launchListHideNoCountry|meridian\.launchListHideNoCountry/);
  assert.doesNotMatch(layerState, /launchListHideNoCountry|launchListCountry/);
  assert.doesNotMatch(sharelink, /launchListHideNoCountry|meridian\.launchListHideNoCountry/);
  assert.doesNotMatch(
    firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun')),
    /writeLaunchListHideNoCountry|readLaunchListHideNoCountry/,
  );
  assert.doesNotMatch(globeProvider, /meridian\.launchListHideNoCountry|launchListCountryFilter/);
  assert.doesNotMatch(globeRocket, /meridian\.launchListHideNoCountry|launchListCountryFilter/);
  assert.doesNotMatch(globeOrbit, /meridian\.launchListHideNoCountry|launchListCountryFilter/);
  assert.doesNotMatch(globeWebcast, /meridian\.launchListHideNoCountry|launchListCountryFilter/);
  assert.doesNotMatch(globeFloor, /meridian\.launchListHideNoCountry|launchListCountryFilter/);
  assert.doesNotMatch(hideSite, /meridian\.launchListHideNoCountry|launchListCountryFilter/);
  assert.doesNotMatch(hideProvider, /meridian\.launchListHideNoCountry|launchListCountryFilter/);
  assert.doesNotMatch(listSite, /meridian\.launchListHideNoCountry|launchListCountryFilter/);
  assert.doesNotMatch(listTime, /meridian\.launchListHideNoCountry|launchListCountryFilter/);
  assert.doesNotMatch(listVehicle, /meridian\.launchListHideNoCountry|launchListCountryFilter/);
  assert.doesNotMatch(listOrbit, /meridian\.launchListHideNoCountry|launchListCountryFilter/);
  assert.doesNotMatch(listWebcast, /meridian\.launchListHideNoCountry|launchListCountryFilter/);
  assert.doesNotMatch(listMission, /meridian\.launchListHideNoCountry|launchListCountryFilter/);
  assert.doesNotMatch(listProbability, /meridian\.launchListHideNoCountry|launchListCountryFilter/);

  assert.equal(existsSync(path.join(ROOT, 'api/launches/country.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.doesNotMatch(helper, /hideUnknownSite|launchHideUnknownSite|meridian\.launchHideUnknownSite/);
  assert.doesNotMatch(helper, /LAUNCH_PROBABILITY_STORAGE_KEY|setLaunchProbabilityFilter/);
  assert.match(read('LICENSE'), /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(read('README.md'), /# Meridian/);
  assert.doesNotMatch(read('README.md'), /quantum-earth/);
  assert.doesNotMatch(read('README.md'), /God's Eye View branding/i);

  assert.equal(launchListHideNoCountryChipModel(false).params.hideNoCountry, true);
  assert.equal(launchListHideNoCountryChipModel(true).params.hideNoCountry, false);
  assert.equal(launchListHideNoCountryChipModel(false).label, 'Hide no country');
});
