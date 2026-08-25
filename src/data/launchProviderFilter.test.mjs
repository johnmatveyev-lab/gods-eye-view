import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_LAUNCH_PROVIDER_FILTER,
  LAUNCH_PROVIDER_FILTER_STORAGE_KEY,
  LAUNCH_PROVIDER_OTHER_CHIP_ID,
  filterLaunchesByProvider,
  getLaunchProviderFilter,
  hydrateLaunchProviderFilter,
  launchPassesProviderFilter,
  launchProviderChipId,
  launchProviderChipLabel,
  listLaunchProviderChipIds,
  normalizeLaunchProviderFilter,
  readLaunchProviderFilter,
  resetLaunchProviderFilterForTest,
  setLaunchProviderFilter,
  toggleLaunchProviderFilter,
  writeLaunchProviderFilter,
} from './launchProviderFilter.js';
import { filterLaunchesByStatus } from './launchStatusFilter.js';
import { filterLaunchesByRocket, normalizeLaunchRocketFilter } from './launchRocketFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const indexHtml = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const rocketLaunchesSource = readFileSync(path.join(ROOT, 'src', 'data', 'rocketLaunches.js'), 'utf8');
const launchesSource = readFileSync(path.join(ROOT, 'src', 'data', 'launches.js'), 'utf8');
const launchesPanelSource = readFileSync(path.join(ROOT, 'src', 'data', 'launchesPanel.js'), 'utf8');
const firstRunSource = readFileSync(path.join(ROOT, 'src', 'firstRunExperience.js'), 'utf8');
const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    snapshot: () => ({ ...data }),
  };
}

const SPACEX = { id: 'sx-1', provider: 'SpaceX', status: 'Go', name: 'Starlink' };
const ULA = { id: 'ula-1', provider: 'ULA', status: 'Go', name: 'Atlas' };
const NASA = { id: 'nasa-1', provider: 'NASA', status: 'TBD', name: 'Science' };
const BLANK = { id: 'blank-1', provider: null, status: 'Go', name: 'Unspecified' };
const EMPTY = { id: 'empty-1', provider: '', status: 'Hold', name: 'Blank Provider' };
const ROSTER = [SPACEX, ULA, NASA, BLANK, EMPTY];
const CHIP_IDS = ['NASA', 'SpaceX', 'ULA', LAUNCH_PROVIDER_OTHER_CHIP_ID];

test('unique in-memory providers plus Other for blank or unspecified', () => {
  assert.equal(launchProviderChipId(SPACEX), 'SpaceX');
  assert.equal(launchProviderChipId({ provider: '  Rocket Lab  ' }), 'Rocket Lab');
  assert.equal(launchProviderChipId({ launch_service_provider: { name: 'Arianespace' } }), 'Arianespace');
  assert.equal(launchProviderChipId(BLANK), LAUNCH_PROVIDER_OTHER_CHIP_ID);
  assert.equal(launchProviderChipId(EMPTY), LAUNCH_PROVIDER_OTHER_CHIP_ID);
  assert.equal(launchProviderChipId({}), LAUNCH_PROVIDER_OTHER_CHIP_ID);
  assert.equal(launchProviderChipId(null), LAUNCH_PROVIDER_OTHER_CHIP_ID);
  assert.deepEqual(listLaunchProviderChipIds(ROSTER), CHIP_IDS);
  assert.equal(launchProviderChipLabel(LAUNCH_PROVIDER_OTHER_CHIP_ID), 'Other');
  assert.equal(launchProviderChipLabel('SpaceX'), 'SpaceX');
});

test('all on matches the current 30-day roster', () => {
  const hidden = filterLaunchesByProvider(ROSTER, normalizeLaunchProviderFilter({ SpaceX: true }, CHIP_IDS), null, CHIP_IDS);
  assert.deepEqual(hidden.map((row) => row.id), ['sx-1']);
  const restored = filterLaunchesByProvider(ROSTER, DEFAULT_LAUNCH_PROVIDER_FILTER);
  assert.deepEqual(restored.map((row) => row.id), ROSTER.map((row) => row.id));
  assert.equal(normalizeLaunchProviderFilter(null, CHIP_IDS), DEFAULT_LAUNCH_PROVIDER_FILTER);
  assert.equal(normalizeLaunchProviderFilter('all', CHIP_IDS), DEFAULT_LAUNCH_PROVIDER_FILTER);
});

test('turning one provider off hides its rows and keeps the others', () => {
  const withoutSpaceX = normalizeLaunchProviderFilter({
    SpaceX: false,
    ULA: true,
    NASA: true,
    [LAUNCH_PROVIDER_OTHER_CHIP_ID]: true,
  }, CHIP_IDS);
  const visible = filterLaunchesByProvider(ROSTER, withoutSpaceX);
  assert.deepEqual(visible.map((row) => row.id).sort(), ['blank-1', 'empty-1', 'nasa-1', 'ula-1']);
  assert.equal(launchPassesProviderFilter(SPACEX, withoutSpaceX), false);
  assert.equal(launchPassesProviderFilter(ULA, withoutSpaceX), true);
  assert.equal(launchPassesProviderFilter(BLANK, withoutSpaceX), true);
});

test('selected mission stays visible when its provider chip is off', () => {
  const withoutSpaceX = normalizeLaunchProviderFilter({
    SpaceX: false,
    ULA: true,
    NASA: true,
    [LAUNCH_PROVIDER_OTHER_CHIP_ID]: true,
  }, CHIP_IDS);
  assert.equal(launchPassesProviderFilter(SPACEX, withoutSpaceX, 'sx-1'), true);
  assert.equal(launchPassesProviderFilter(NASA, withoutSpaceX, 'sx-1'), true);
  const visible = filterLaunchesByProvider(ROSTER, withoutSpaceX, 'sx-1');
  assert.ok(visible.some((row) => row.id === 'sx-1'));
  assert.ok(visible.some((row) => row.id === 'ula-1'));
});

test('Status Go + one provider still ANDs', () => {
  const spaceXOnly = normalizeLaunchProviderFilter({
    SpaceX: true,
    ULA: false,
    NASA: false,
    [LAUNCH_PROVIDER_OTHER_CHIP_ID]: false,
  }, CHIP_IDS);
  const goOnly = filterLaunchesByStatus(ROSTER, { go: true });
  const anded = filterLaunchesByProvider(goOnly, spaceXOnly);
  assert.deepEqual(anded.map((row) => row.id), ['sx-1']);
});

test('Status Go + one provider + one rocket still ANDs', () => {
  const mixed = [
    { id: 'sx-1', provider: 'SpaceX', status: 'Go', rocketName: 'Falcon 9' },
    { id: 'sx-heavy', provider: 'SpaceX', status: 'Go', rocketName: 'Falcon Heavy' },
    { id: 'ula-1', provider: 'ULA', status: 'Go', rocketName: 'Atlas V' },
    { id: 'sx-tbd', provider: 'SpaceX', status: 'TBD', rocketName: 'Falcon 9' },
  ];
  const spaceXOnly = normalizeLaunchProviderFilter({
    SpaceX: true,
    ULA: false,
  }, ['SpaceX', 'ULA']);
  const falconOnly = normalizeLaunchRocketFilter({
    'Falcon 9': true,
    'Falcon Heavy': false,
    'Atlas V': false,
  }, ['Atlas V', 'Falcon 9', 'Falcon Heavy']);
  const goOnly = filterLaunchesByStatus(mixed, { go: true });
  const anded = filterLaunchesByRocket(filterLaunchesByProvider(goOnly, spaceXOnly), falconOnly);
  assert.deepEqual(anded.map((row) => row.id), ['sx-1']);
});

test('toggle chips stay independent and default all on', () => {
  assert.equal(DEFAULT_LAUNCH_PROVIDER_FILTER, 'all');
  assert.equal(LAUNCH_PROVIDER_OTHER_CHIP_ID, 'other');
  const withoutSpaceX = toggleLaunchProviderFilter(DEFAULT_LAUNCH_PROVIDER_FILTER, 'SpaceX', CHIP_IDS);
  assert.equal(launchPassesProviderFilter(SPACEX, withoutSpaceX), false);
  assert.equal(launchPassesProviderFilter(ULA, withoutSpaceX), true);
  assert.equal(
    toggleLaunchProviderFilter(withoutSpaceX, 'SpaceX', CHIP_IDS),
    DEFAULT_LAUNCH_PROVIDER_FILTER,
  );
  const lastOff = CHIP_IDS.reduce(
    (filter, id) => toggleLaunchProviderFilter(filter, id, CHIP_IDS),
    DEFAULT_LAUNCH_PROVIDER_FILTER,
  );
  assert.equal(lastOff, '0');
});

test('meridian.launchProvider persists and reload keeps the choice', () => {
  resetLaunchProviderFilterForTest();
  const storage = memoryStorage();
  assert.equal(LAUNCH_PROVIDER_FILTER_STORAGE_KEY, 'meridian.launchProvider');
  assert.equal(readLaunchProviderFilter(storage), DEFAULT_LAUNCH_PROVIDER_FILTER);
  const spaceXOnly = normalizeLaunchProviderFilter({
    SpaceX: true,
    ULA: false,
    NASA: false,
    [LAUNCH_PROVIDER_OTHER_CHIP_ID]: false,
  }, CHIP_IDS);
  assert.equal(setLaunchProviderFilter(spaceXOnly, { storage, chipIds: CHIP_IDS }), spaceXOnly);
  assert.equal(storage.getItem(LAUNCH_PROVIDER_FILTER_STORAGE_KEY), spaceXOnly);
  assert.equal(getLaunchProviderFilter(), spaceXOnly);

  resetLaunchProviderFilterForTest();
  assert.equal(getLaunchProviderFilter(), DEFAULT_LAUNCH_PROVIDER_FILTER);
  assert.equal(hydrateLaunchProviderFilter(storage), spaceXOnly);
  assert.equal(getLaunchProviderFilter(), spaceXOnly);
  writeLaunchProviderFilter(DEFAULT_LAUNCH_PROVIDER_FILTER, storage);
  assert.equal(storage.getItem(LAUNCH_PROVIDER_FILTER_STORAGE_KEY), DEFAULT_LAUNCH_PROVIDER_FILTER);
  resetLaunchProviderFilterForTest();
});

test('provider chips filter the existing Space Missions roster — not a new list or endpoint', () => {
  assert.match(indexHtml, /id="space-mission-roster"/);
  assert.match(indexHtml, /data-mission-status-chip="go"/);
  assert.match(indexHtml, /data-mission-provider-chips|space-mission-provider-chips/);
  assert.match(indexHtml, /AVAILABLE MISSIONS/);
  assert.doesNotMatch(indexHtml, /space-mission-provider-chips[\s\S]*launches-panel/);
  assert.match(rocketLaunchesSource, /filterLaunchesByProvider|launchPassesProviderFilter/);
  assert.match(rocketLaunchesSource, /hydrateLaunchProviderFilter|subscribeLaunchProviderFilter|setLaunchProviderFilter/);
  assert.match(rocketLaunchesSource, /provider: launch\.launch_service_provider\?\.name/);
  assert.equal((rocketLaunchesSource.match(/fetch\(/g) || []).length, 2);
  assert.match(rocketLaunchesSource, /const API_URL = '\/api\/launches'/);
  assert.match(rocketLaunchesSource, /fetch\('\/api\/celestrak\/active'\)/);
  assert.doesNotMatch(rocketLaunchesSource, /\/api\/launch-provider|\/api\/launches\/provider/);
  assert.doesNotMatch(launchesSource, /net__gte.*upcoming|status__ids|provider__name/);
  assert.doesNotMatch(launchesPanelSource, /data-mission-provider-chip|setLaunchProviderFilter/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /OpenStreetMap|Cesium|CC BY/);
  assert.equal(packageJson.name, 'meridian');
  assert.doesNotMatch(rocketLaunchesSource, /opensky-network\.org|google\.com\/news|telegeography|quantum-earth/i);
});

test('first-run missions do not write meridian.launchProvider', () => {
  const code = firstRunSource.slice(firstRunSource.indexOf('export function shouldShowFirstRun'));
  assert.match(firstRunSource, /meridian\.launchProvider/);
  for (const forbidden of ['setLaunchProviderFilter', 'writeLaunchProviderFilter', 'hydrateLaunchProviderFilter']) {
    assert.doesNotMatch(code, new RegExp(forbidden), `a mission must never touch ${forbidden}`);
  }
});
