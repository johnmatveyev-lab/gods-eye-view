// PLAN 300 leftover — Launches panel Hide no program toggle. Client-only
// filter of already-fetched LL2 rows. Distinct from 207 LSP-type, 215
// mapped-only, 223 status, 232 Hide no provider, 239 Hide no site, 248
// Hide no time, 257 Hide no vehicle, 264 Hide no orbit, 272 Webcast only,
// 283 Hide no mission (mission.name), 289 Hide no probability, and 295
// Hide no country. rocketLaunches.js stays unchanged as the globe launch
// layer. OpenSky stays disabled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_PROGRAM,
  LAUNCH_LIST_HIDE_NO_PROGRAM_CHIP_LABEL,
  LAUNCH_LIST_HIDE_NO_PROGRAM_CHIP_TITLE,
  LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY,
  filterLaunchListByProgram,
  launchListHideNoProgramChipModel,
  launchListProgramName,
  launchListRowHasProgram,
  launchListRowMatchesProgramFilter,
  normalizeLaunchListHideNoProgram,
  readLaunchListHideNoProgram,
  writeLaunchListHideNoProgram,
} from './launchListProgramFilter.js';
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
import { filterLaunchListByCountry } from './launchListCountryFilter.js';
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

function withProgram(launch, program) {
  return { ...launch, program };
}

const USA = 'United States';
const STARLINK = 'Starlink';

const RATED_SPACEX_GO = withProgram(withPadCountry({
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
}, USA), [{ name: STARLINK }]);

const RATED_ZERO = withProgram(withPadCountry({
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
}, USA), [{ name: STARLINK }]);

const MISSING_PROB_SPACEX = withProgram(withPadCountry({
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
}, USA), [{ name: STARLINK }]);

const NULL_PROB = withProgram(withPadCountry({
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
}, USA), [{ name: STARLINK }]);

const NAN_PROB = withProgram(withPadCountry({
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
}, USA), [{ name: STARLINK }]);

const RATED_GTO = withProgram(withPadCountry({
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
}, USA), [{ name: STARLINK }]);

const NASA_GO = withProgram(withPadCountry({
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
}, USA), [{ name: 'Artemis' }]);

const SPACEX_TBD = withProgram(withPadCountry({
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
}, USA), [{ name: STARLINK }]);

const RATED_NO_COORDS = withProgram(withPadCountry({
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
}, USA), [{ name: STARLINK }]);

const RATED_NO_PROVIDER = withProgram(withPadCountry({
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
}, USA), [{ name: STARLINK }]);

const RATED_UNKNOWN_SITE = withProgram(withPadCountry({
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
}, USA), [{ name: STARLINK }]);

const RATED_NO_TIME = withProgram(withPadCountry({
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
}, USA), [{ name: STARLINK }]);

const RATED_NO_VEHICLE = withProgram(withPadCountry({
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
}, USA), [{ name: STARLINK }]);

const RATED_NO_ORBIT = withProgram(withPadCountry({
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
}, USA), [{ name: STARLINK }]);

const RATED_NO_WEBCAST = withProgram(withPadCountry({
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
}, USA), [{ name: STARLINK }]);

const RATED_NO_MISSION = withProgram(withPadCountry({
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
}, USA), [{ name: STARLINK }]);

const RATED_NO_COUNTRY = withProgram({
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
}, [{ name: STARLINK }]);

const WS_COUNTRY = withProgram(withPadCountry({
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
}, '   '), [{ name: STARLINK }]);

const TRIM_COUNTRY = withProgram(withPadCountry({
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
}, '  United States  '), [{ name: STARLINK }]);

const LOC_COUNTRY = withProgram(withPadCountry({
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
}, 'France', 'location'), [{ name: 'Ariane' }]);

const TRIM_PROGRAM = withProgram(withPadCountry({
  id: 'll2-trim-program',
  name: 'Falcon 9 | Trim Program',
  rocketName: 'Falcon 9',
  mission: { name: 'Trim Program' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T21:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.53', longitude: '-80.73', name: 'SLC-40' },
  webcast_live: true,
  probability: 74,
}, USA), [{ name: '  Starlink  ' }]);

const MISSION_NO_PROGRAM = withPadCountry({
  id: 'll2-mission-no-program',
  name: 'Falcon 9 | Starlink Group 11-1',
  rocketName: 'Falcon 9',
  mission: { name: 'Starlink Group 11-1' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T22:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.54', longitude: '-80.74', name: 'SLC-40' },
  webcast_live: true,
  probability: 73,
  program: [],
}, USA);

const WS_PROGRAM = withProgram(withPadCountry({
  id: 'll2-ws-program',
  name: 'Falcon 9 | Blank Program',
  rocketName: 'Falcon 9',
  mission: { name: 'Blank Program' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-21T23:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.55', longitude: '-80.75', name: 'SLC-40' },
  webcast_live: true,
  probability: 71,
}, USA), [{ name: '   ' }]);

const EMPTY_PROGRAM = withProgram(withPadCountry({
  id: 'll2-empty-program',
  name: 'Falcon 9 | Empty Program',
  rocketName: 'Falcon 9',
  mission: { name: 'Empty Program' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-22T00:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.56', longitude: '-80.76', name: 'SLC-40' },
  webcast_live: true,
  probability: 69,
}, USA), []);

const MISSING_PROGRAM = withPadCountry({
  id: 'll2-missing-program',
  name: 'Falcon 9 | Missing Program',
  rocketName: 'Falcon 9',
  mission: { name: 'Missing Program' },
  orbit: { name: 'Low Earth Orbit' },
  net: '2026-08-22T01:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.57', longitude: '-80.77', name: 'SLC-40' },
  webcast_live: true,
  probability: 68,
}, USA);

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
  TRIM_PROGRAM,
  MISSION_NO_PROGRAM,
  WS_PROGRAM,
  EMPTY_PROGRAM,
  MISSING_PROGRAM,
  MISSING_PROB_NO_TIME,
]);

const PROGRAM_IDS = [
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
  'll2-ws-country',
  'll2-trim-country',
  'll2-loc-country',
  'll2-trim-program',
];

test('off keeps current list including no-program rows (current 26)', () => {
  assert.equal(DEFAULT_LAUNCH_LIST_HIDE_NO_PROGRAM, false);
  assert.equal(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.launchListHideNoProgram');
  assert.equal(LAUNCH_LIST_HIDE_NO_PROGRAM_CHIP_LABEL, 'Hide no program');
  assert.equal(LAUNCH_LIST_HIDE_NO_PROGRAM_CHIP_TITLE, 'Hide missions without a named program');
  assert.equal(normalizeLaunchListHideNoProgram(undefined), false);
  assert.equal(normalizeLaunchListHideNoProgram(null), false);
  assert.equal(normalizeLaunchListHideNoProgram(''), false);
  assert.equal(normalizeLaunchListHideNoProgram(false), false);

  const rows = launchesPanelRows({ results: MIXED });
  assert.equal(MIXED.length, 26);
  assert.equal(rows.length, 26);
  assert.deepEqual(rows.map((row) => row.id), MIXED.map((row) => row.id));
  assert.equal(rows[0].program, STARLINK);
  assert.equal(rows.find((row) => row.id === 'll2-mission-no-program')?.program, null);
  assert.equal(rows.find((row) => row.id === 'll2-ws-program')?.program, null);
  assert.equal(rows.find((row) => row.id === 'll2-empty-program')?.program, null);
  assert.equal(rows.find((row) => row.id === 'll2-missing-program')?.program, null);
  assert.equal(rows.find((row) => row.id === 'll2-trim-program')?.program, STARLINK);
  assert.equal(rows.find((row) => row.id === 'll2-ghost')?.program, null);
  assert.equal(rows.find((row) => row.id === 'll2-mission-no-program')?.mission, 'Starlink Group 11-1');
  assert.equal(launchListRowMatchesProgramFilter(rows.find((row) => row.id === 'll2-mission-no-program'), false), true);
  assert.equal(launchListRowMatchesProgramFilter({ program: null }, false), true);
  assert.equal(launchListRowMatchesProgramFilter({ program: [] }, false), true);
  assert.equal(launchListRowMatchesProgramFilter({ program: '   ' }, false), true);
  assert.equal(launchListRowMatchesProgramFilter(rows[0], false), true);
  assert.deepEqual(
    filterLaunchListByProgram(rows, false).map((row) => row.id),
    MIXED.map((row) => row.id),
  );
  assert.deepEqual(filterLaunchListByProgram(null), []);
  assert.deepEqual(filterLaunchListByProgram(undefined), []);
});

test('on keeps a Starlink program row and hides a row with mission.name but empty program', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', { hideNoProgram: true });
  assert.deepEqual(rows.map((row) => row.id), PROGRAM_IDS);
  assert.ok(rows.every((row) => typeof row.program === 'string' && row.program.trim() !== ''));
  assert.ok(rows.some((row) => row.id === 'll2-starlink' && row.program === STARLINK));
  assert.ok(rows.some((row) => row.id === 'll2-trim-program' && row.program === STARLINK));
  assert.ok(!rows.some((row) => row.id === 'll2-mission-no-program'));
  assert.ok(!rows.some((row) => row.id === 'll2-ws-program'));
  assert.ok(!rows.some((row) => row.id === 'll2-empty-program'));
  assert.ok(!rows.some((row) => row.id === 'll2-missing-program'));
  assert.ok(!rows.some((row) => row.id === 'll2-ghost'));

  const built = launchesPanelRows({ results: MIXED });
  assert.equal(launchListRowHasProgram(built[0]), true);
  assert.equal(launchListRowHasProgram(built.find((row) => row.id === 'll2-mission-no-program')), false);
  assert.equal(launchListRowHasProgram(built.find((row) => row.id === 'll2-ws-program')), false);
  assert.equal(launchListRowHasProgram(built.find((row) => row.id === 'll2-empty-program')), false);
  assert.equal(launchListRowHasProgram(built.find((row) => row.id === 'll2-missing-program')), false);
  assert.equal(launchListRowHasProgram(built.find((row) => row.id === 'll2-trim-program')), true);
  assert.equal(launchListRowHasProgram({}), false);
  assert.equal(launchListRowHasProgram({ program: null }), false);
  assert.equal(launchListRowHasProgram({ program: [] }), false);
  assert.equal(launchListRowHasProgram({ program: '   ' }), false);
  assert.equal(launchListProgramName({ program: '  Starlink  ' }), STARLINK);
  assert.equal(launchListProgramName({ program: [{ name: '  Starlink  ' }] }), STARLINK);
  assert.equal(launchListProgramName({ program: [{ name: '   ' }, { name: 'Artemis' }] }), 'Artemis');
  assert.equal(launchListProgramName({ program: [{ name: STARLINK }, { name: 'Commercial Resupply' }] }), STARLINK);
  assert.equal(launchListProgramName({ program: [] }), '');
  assert.equal(launchListProgramName({ program: [{ name: '   ' }] }), '');
  assert.equal(launchListProgramName({}), '');
  assert.equal(launchListRowMatchesProgramFilter(built[0], true), true);
  assert.equal(launchListRowMatchesProgramFilter(built.find((row) => row.id === 'll2-mission-no-program'), true), false);
  assert.equal(launchListRowMatchesProgramFilter({ id: 'x', program: null }, true), false);
  assert.equal(launchListRowMatchesProgramFilter({ id: 'x' }, true), false);
  assert.equal(launchListRowMatchesProgramFilter({ id: 'x', program: [] }, true), false);
  assert.equal(launchListRowMatchesProgramFilter({ id: 'x', program: '   ' }, true), false);
  assert.equal(launchListRowMatchesProgramFilter({ id: 'x', program: STARLINK }, true), true);
  assert.deepEqual(
    filterLaunchListByProgram(built, true).map((row) => row.id),
    PROGRAM_IDS,
  );
});

test('selected no-program still lists', () => {
  const rows = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProgram: true,
    selectedId: 'll2-mission-no-program',
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
      'll2-ws-country',
      'll2-trim-country',
      'll2-loc-country',
      'll2-trim-program',
      'll2-mission-no-program',
    ],
  );
  assert.equal(
    launchListRowMatchesProgramFilter(
      { id: 'll2-mission-no-program', program: null },
      true,
      { selectedId: 'll2-mission-no-program' },
    ),
    true,
  );
  assert.deepEqual(
    filterLaunchListByProgram(
      launchesPanelRows({ results: MIXED }),
      true,
      'll2-ws-program',
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
      'll2-no-country',
      'll2-ws-country',
      'll2-trim-country',
      'll2-loc-country',
      'll2-trim-program',
      'll2-ws-program',
    ],
  );
});

test('invalid / corrupt storage reads as off', () => {
  assert.equal(normalizeLaunchListHideNoProgram('bogus'), null);
  assert.equal(normalizeLaunchListHideNoProgram('on'), null);
  assert.equal(readLaunchListHideNoProgram(memoryStorage()), DEFAULT_LAUNCH_LIST_HIDE_NO_PROGRAM);
  assert.equal(readLaunchListHideNoProgram(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY]: 'nope',
  })), false);
  assert.equal(readLaunchListHideNoProgram(memoryStorage({
    [LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY]: 'yes',
  })), false);
  assert.equal(writeLaunchListHideNoProgram('nope', memoryStorage()), false);
});

test('persist / hydrate, no share-URL write', () => {
  const storage = memoryStorage();
  assert.equal(readLaunchListHideNoProgram(storage), DEFAULT_LAUNCH_LIST_HIDE_NO_PROGRAM);
  assert.equal(writeLaunchListHideNoProgram(true, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY), '1');
  assert.equal(readLaunchListHideNoProgram(storage), true);
  assert.equal(readLaunchListHideNoProgram(memoryStorage(storage.snapshot())), true, 'reload keeps on');

  const restored = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProgram: readLaunchListHideNoProgram(memoryStorage(storage.snapshot())),
  });
  assert.deepEqual(restored.map((row) => row.id), PROGRAM_IDS);

  assert.equal(writeLaunchListHideNoProgram(false, storage), true);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY), '0');
  assert.equal(readLaunchListHideNoProgram(memoryStorage(storage.snapshot())), false, 'reload keeps off');
  assert.equal(writeLaunchListHideNoProgram('nope', storage), false);
  assert.equal(storage.getItem(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY), '0');
});

test('rocketLaunches.js and sibling data sources stay unchanged', () => {
  const rocket = read('src/data/rocketLaunches.js');
  const flights = read('src/data/flights.js');
  const military = read('src/data/militaryFlights.js');
  const dams = read('src/data/damsList.js');
  const datacenters = read('src/data/datacenterList.js');
  const firms = read('src/data/firmsList.js');
  const adsb = read('src/data/adsbLolFallback.js');
  for (const source of [rocket, flights, military, dams, datacenters, firms, adsb]) {
    assert.doesNotMatch(source, /launchListProgram|launchListHideNoProgram|meridian\.launchListHideNoProgram/);
    assert.doesNotMatch(source, /filterLaunchListByProgram|readLaunchListHideNoProgram|writeLaunchListHideNoProgram/);
  }
});

test('AND with hide-no-mission and 207/215/223/232/239/248/257/264/272/283/289/295', () => {
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
      'll2-trim-program',
      'll2-mission-no-program',
      'll2-ws-program',
      'll2-empty-program',
      'll2-missing-program',
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
      'll2-trim-program',
      'll2-mission-no-program',
      'll2-ws-program',
      'll2-empty-program',
      'll2-missing-program',
    ],
  );

  const commercialOn = launchesPanelRows({ results: MIXED }, 'commercial', { hideNoProgram: true });
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
      'll2-no-country',
      'll2-ws-country',
      'll2-trim-country',
      'll2-loc-country',
      'll2-trim-program',
    ],
  );
  assert.ok(!commercialOn.some((row) => row.id === 'll2-mission-no-program'));

  const governmentOn = launchesPanelRows({ results: MIXED }, 'government', { hideNoProgram: true });
  assert.deepEqual(governmentOn.map((row) => row.id), ['ll2-sls']);

  const mappedOn = launchesPanelRows({ results: MIXED }, 'all', {
    mappedOnly: true,
    hideNoProgram: true,
  });
  assert.ok(!mappedOn.some((row) => row.id === 'll2-secret-named'));
  assert.ok(mappedOn.some((row) => row.id === 'll2-starlink'));
  assert.ok(!mappedOn.some((row) => row.id === 'll2-mission-no-program'));

  const statusGo = launchesPanelRows({ results: MIXED }, 'all', {
    statusFilter: 'go',
    hideNoProgram: true,
  });
  assert.ok(!statusGo.some((row) => row.id === 'll2-tbd'));
  assert.ok(statusGo.some((row) => row.id === 'll2-starlink'));
  assert.ok(!statusGo.some((row) => row.id === 'll2-mission-no-program'));

  const providerOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProvider: true,
    hideNoProgram: true,
  });
  assert.ok(!providerOn.some((row) => row.id === 'll2-no-provider'));
  assert.ok(!providerOn.some((row) => row.id === 'll2-mission-no-program'));

  const siteOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoSite: true,
    hideNoProgram: true,
  });
  assert.ok(!siteOn.some((row) => row.id === 'll2-unknown-site'));
  assert.ok(!siteOn.some((row) => row.id === 'll2-mission-no-program'));
  assert.ok(siteOn.some((row) => row.id === 'll2-starlink'));

  const timeOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoTime: true,
    hideNoProgram: true,
  });
  assert.ok(!timeOn.some((row) => row.id === 'll2-no-time'));
  assert.ok(!timeOn.some((row) => row.id === 'll2-mission-no-program'));

  const vehicleOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoVehicle: true,
    hideNoProgram: true,
  });
  assert.ok(!vehicleOn.some((row) => row.id === 'll2-no-vehicle'));
  assert.ok(!vehicleOn.some((row) => row.id === 'll2-mission-no-program'));

  const orbitOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoOrbit: true,
    hideNoProgram: true,
  });
  assert.ok(!orbitOn.some((row) => row.id === 'll2-no-orbit'));
  assert.ok(!orbitOn.some((row) => row.id === 'll2-mission-no-program'));

  const webcastOn = launchesPanelRows({ results: MIXED }, 'all', {
    webcastOnly: true,
    hideNoProgram: true,
  });
  assert.ok(!webcastOn.some((row) => row.id === 'll2-no-webcast'));
  assert.ok(!webcastOn.some((row) => row.id === 'll2-mission-no-program'));

  const missionOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoMission: true,
    hideNoProgram: true,
  });
  assert.ok(!missionOn.some((row) => row.id === 'll2-no-mission'));
  assert.ok(!missionOn.some((row) => row.id === 'll2-mission-no-program'),
    'mission.name present + program missing still hides when this chip is on');
  assert.ok(missionOn.some((row) => row.id === 'll2-starlink'));

  const missionOnly = launchesPanelRows({ results: MIXED }, 'all', { hideNoMission: true });
  assert.ok(missionOnly.some((row) => row.id === 'll2-mission-no-program'),
    'Hide no mission keeps a Starlink Group row whose program is empty');
  assert.ok(!missionOnly.some((row) => row.id === 'll2-no-mission'));

  const programOnly = launchesPanelRows({ results: MIXED }, 'all', { hideNoProgram: true });
  assert.ok(programOnly.some((row) => row.id === 'll2-no-mission'),
    'Hide no program keeps a named-program row that Hide no mission would drop');
  assert.ok(!programOnly.some((row) => row.id === 'll2-mission-no-program'));

  const probabilityOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoProbability: true,
    hideNoProgram: true,
  });
  assert.ok(!probabilityOn.some((row) => row.id === 'll2-no-prob'));
  assert.ok(!probabilityOn.some((row) => row.id === 'll2-mission-no-program'));
  assert.ok(probabilityOn.some((row) => row.id === 'll2-starlink'));
  assert.ok(probabilityOn.some((row) => row.id === 'll2-zero'));
  assert.ok(probabilityOn.some((row) => row.id === 'll2-trim-program'));

  const countryOn = launchesPanelRows({ results: MIXED }, 'all', {
    hideNoCountry: true,
    hideNoProgram: true,
  });
  assert.ok(!countryOn.some((row) => row.id === 'll2-no-country'));
  assert.ok(!countryOn.some((row) => row.id === 'll2-mission-no-program'));
  assert.ok(countryOn.some((row) => row.id === 'll2-starlink'));

  const allTwelve = launchesPanelRows({ results: MIXED }, 'commercial', {
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
    hideNoProgram: true,
  });
  assert.deepEqual(
    allTwelve.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-trim-country', 'll2-loc-country', 'll2-trim-program'],
  );

  const allTwelveSelected = launchesPanelRows({ results: MIXED }, 'commercial', {
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
    hideNoProgram: true,
    selectedId: 'll2-mission-no-program',
  });
  assert.deepEqual(
    allTwelveSelected.map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-trim-country', 'll2-loc-country', 'll2-trim-program', 'll2-mission-no-program'],
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
  const afterCountry = filterLaunchListByCountry(afterProbability, true);
  assert.deepEqual(
    filterLaunchListByProgram(afterCountry, true).map((row) => row.id),
    ['ll2-starlink', 'll2-zero', 'll2-gto', 'll2-sls', 'll2-trim-country', 'll2-loc-country', 'll2-trim-program'],
  );
});

test('LayerStateCoordinator restore keeps meridian.launchListHideNoProgram and does not write a share URL', () => {
  const defaults = createDefaultLayerState();
  assert.equal(defaults.options['rocket-launches']?.launchListHideNoProgram, undefined);
  assert.equal(defaults.options['rocket-launches']?.hideNoProgram, undefined);

  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['rocket-launches'],
    options: { 'rocket-launches': { launchListHideNoProgram: true, hideNoProgram: true } },
  }));
  assert.doesNotMatch(encoded.toString(), /launchListHideNoProgram|meridian\.launchListHideNoProgram/);
  assert.doesNotMatch(encoded.get('lo') || '', /launchListHideNoProgram|hideNoProgram|listProgram/);
  const decoded = decodeLayerStateParams(encoded);
  assert.equal(decoded.options['rocket-launches']?.launchListHideNoProgram, undefined);
  assert.equal(layerOptionsForRestore(decoded, 'rocket-launches')?.launchListHideNoProgram, undefined);

  const storage = memoryStorage({ [LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY]: '1' });
  assert.equal(readLaunchListHideNoProgram(storage), true, 'coordinator restore of layer options does not wipe the list key');
});

test('distinct from 207/215/223/232/239/248/257/264/272/283/289/295', () => {
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.launchLspType');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.launchListMappedOnly');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.launchListStatus');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.launchListHideNoProvider');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.launchListHideNoSite');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.launchListHideNoTime');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.launchListHideNoVehicle');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.launchListHideNoOrbit');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.launchListWebcastOnly');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.launchListHideNoMission');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.launchListHideNoProbability');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.launchListHideNoCountry');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.launchHideUnknownSite');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.launchProbability');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.flightHideNoCountry');
  assert.notEqual(LAUNCH_LIST_HIDE_NO_PROGRAM_STORAGE_KEY, 'meridian.flightHideNoPositionTime');

  const namedMissionNoProgram = launchesPanelRows({
    results: [MISSION_NO_PROGRAM],
  }, 'all', { hideNoMission: true, hideNoProgram: true });
  assert.deepEqual(namedMissionNoProgram.map((row) => row.id), []);

  const namedMissionKeep = launchesPanelRows({
    results: [MISSION_NO_PROGRAM],
  }, 'all', { hideNoMission: true });
  assert.deepEqual(namedMissionKeep.map((row) => row.id), ['ll2-mission-no-program']);
  assert.equal(namedMissionKeep[0].mission, 'Starlink Group 11-1');
  assert.equal(namedMissionKeep[0].program, null);

  const namedCountryNoProgram = launchesPanelRows({
    results: [MISSION_NO_PROGRAM],
  }, 'all', { hideNoCountry: true, hideNoProgram: true });
  assert.deepEqual(namedCountryNoProgram.map((row) => row.id), []);

  const namedCountryKeep = launchesPanelRows({
    results: [MISSION_NO_PROGRAM],
  }, 'all', { hideNoCountry: true });
  assert.deepEqual(namedCountryKeep.map((row) => row.id), ['ll2-mission-no-program']);
  assert.equal(namedCountryKeep[0].country, USA);
  assert.equal(namedCountryKeep[0].program, null);

  const programNoCountry = launchesPanelRows({
    results: [RATED_NO_COUNTRY],
  }, 'all', { hideNoCountry: true, hideNoProgram: true });
  assert.deepEqual(programNoCountry.map((row) => row.id), []);

  const programKeepNoCountry = launchesPanelRows({
    results: [RATED_NO_COUNTRY],
  }, 'all', { hideNoProgram: true });
  assert.deepEqual(programKeepNoCountry.map((row) => row.id), ['ll2-no-country']);
  assert.equal(programKeepNoCountry[0].program, STARLINK);
  assert.equal(programKeepNoCountry[0].country, null);
});

test('chip sits on the hosted Launches panel and re-applies the existing /api/launches payload', () => {
  const helper = read('src/data/launchListProgramFilter.js');
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
  const listCountry = read('src/data/launchListCountryFilter.js');

  assert.match(helper, /meridian\.launchListHideNoProgram/);
  assert.match(helper, /program\.name/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /fetch\(/);
  assert.doesNotMatch(helper, /quantum-earth|news\.google|telegeography/i);
  assert.doesNotMatch(helper, /God's Eye View/i);

  assert.match(panel, /filterLaunchListByProgram|launchListRowMatchesProgramFilter/);
  assert.match(panel, /launchesPanelRows\(/);
  assert.match(panel, /launchListProgramName\(launch\)/);
  assert.match(panel, /filterLaunchListByProgram\(\s*filterLaunchListByCountry/);
  assert.doesNotMatch(panel, /\/api\/(?!launches\b)/);

  assert.match(html, /id="launches-panel"/);
  assert.match(html, /id="launches-panel-program-chips"/);
  assert.match(html, /data-launch-list-hide-no-program="only"/);
  assert.match(html, /Hide no program/);
  assert.match(html, /Hide missions without a named program/);
  assert.ok(
    html.indexOf('id="launches-panel-country-chips"') < html.indexOf('id="launches-panel-program-chips"'),
    'Hide no program sits after Hide no country',
  );
  assert.ok(
    html.indexOf('id="launches-panel"') < html.indexOf('id="launches-panel-program-chips"'),
    'Hide no program lives on the hosted Launches panel',
  );
  assert.ok(
    html.indexOf('data-launch-list-hide-no-program="only"') < html.indexOf('id="earthquake-list-panel"'),
    'Hide no program stays on the launches panel, not later list chrome',
  );
  assert.doesNotMatch(html, /data-launch-list-hide-no-program="named"|data-launch-list-hide-no-program="all"/);

  assert.match(ui, /readLaunchListHideNoProgram/);
  assert.match(ui, /writeLaunchListHideNoProgram/);
  assert.match(ui, /data-launch-list-hide-no-program/);
  assert.doesNotMatch(ui, /getRowControls\(\)[\s\S]{0,200}hide-no-program|hide-no-program[\s\S]{0,200}getRowControls\(\)/);
  assert.match(css, /launches-panel-program-chip/);

  assert.doesNotMatch(rocket, /launchListHideNoProgram|meridian\.launchListHideNoProgram/);
  assert.doesNotMatch(launches, /launchListHideNoProgram|meridian\.launchListHideNoProgram/);
  assert.doesNotMatch(layerState, /launchListHideNoProgram|launchListProgram/);
  assert.doesNotMatch(sharelink, /launchListHideNoProgram|meridian\.launchListHideNoProgram/);
  assert.doesNotMatch(
    firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun')),
    /writeLaunchListHideNoProgram|readLaunchListHideNoProgram/,
  );
  assert.doesNotMatch(globeProvider, /meridian\.launchListHideNoProgram|launchListProgramFilter/);
  assert.doesNotMatch(globeRocket, /meridian\.launchListHideNoProgram|launchListProgramFilter/);
  assert.doesNotMatch(globeOrbit, /meridian\.launchListHideNoProgram|launchListProgramFilter/);
  assert.doesNotMatch(globeWebcast, /meridian\.launchListHideNoProgram|launchListProgramFilter/);
  assert.doesNotMatch(globeFloor, /meridian\.launchListHideNoProgram|launchListProgramFilter/);
  assert.doesNotMatch(hideSite, /meridian\.launchListHideNoProgram|launchListProgramFilter/);
  assert.doesNotMatch(hideProvider, /meridian\.launchListHideNoProgram|launchListProgramFilter/);
  assert.doesNotMatch(listSite, /meridian\.launchListHideNoProgram|launchListProgramFilter/);
  assert.doesNotMatch(listTime, /meridian\.launchListHideNoProgram|launchListProgramFilter/);
  assert.doesNotMatch(listVehicle, /meridian\.launchListHideNoProgram|launchListProgramFilter/);
  assert.doesNotMatch(listOrbit, /meridian\.launchListHideNoProgram|launchListProgramFilter/);
  assert.doesNotMatch(listWebcast, /meridian\.launchListHideNoProgram|launchListProgramFilter/);
  assert.doesNotMatch(listMission, /meridian\.launchListHideNoProgram|launchListProgramFilter/);
  assert.doesNotMatch(listProbability, /meridian\.launchListHideNoProgram|launchListProgramFilter/);
  assert.doesNotMatch(listCountry, /meridian\.launchListHideNoProgram|launchListProgramFilter/);

  assert.equal(existsSync(path.join(ROOT, 'api/launches/program.js')), false);
  assert.doesNotMatch(helper, /earthquakes\.js|weather HUD|radio\.js|flights\.js|cctv\.js/);
  assert.doesNotMatch(helper, /hideUnknownSite|launchHideUnknownSite|meridian\.launchHideUnknownSite/);
  assert.doesNotMatch(helper, /LAUNCH_PROBABILITY_STORAGE_KEY|setLaunchProbabilityFilter/);
  assert.doesNotMatch(helper, /militaryInstallations|hide-ground|hideGround/);
  assert.match(read('LICENSE'), /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(read('README.md'), /# Meridian/);
  assert.doesNotMatch(read('README.md'), /quantum-earth/);
  assert.doesNotMatch(read('README.md'), /God's Eye View branding/i);

  assert.equal(launchListHideNoProgramChipModel(false).params.hideNoProgram, true);
  assert.equal(launchListHideNoProgramChipModel(true).params.hideNoProgram, false);
  assert.equal(launchListHideNoProgramChipModel(false).label, 'Hide no program');
});
