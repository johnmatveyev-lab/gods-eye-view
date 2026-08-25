import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_LAUNCH_ROCKET_FILTER,
  LAUNCH_ROCKET_FILTER_STORAGE_KEY,
  LAUNCH_ROCKET_OTHER_CHIP_ID,
  compactRocketName,
  filterLaunchesByRocket,
  getLaunchRocketFilter,
  hydrateLaunchRocketFilter,
  launchPassesRocketFilter,
  launchRocketChipId,
  launchRocketChipLabel,
  listLaunchRocketChipIds,
  normalizeLaunchRocketFilter,
  readLaunchRocketFilter,
  resetLaunchRocketFilterForTest,
  setLaunchRocketFilter,
  toggleLaunchRocketFilter,
  writeLaunchRocketFilter,
} from './launchRocketFilter.js';
import { filterLaunchesByStatus } from './launchStatusFilter.js';
import { normalizeLaunchProviderFilter } from './launchProviderFilter.js';
import { missionRosterEntries } from './rocketLaunches.js';

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

const FALCON = {
  id: 'sx-1',
  provider: 'SpaceX',
  status: 'Go',
  orbit: { name: 'LEO' },
  launchSite: 'Space Launch Complex 4E',
  rocketName: 'Falcon 9 Block 5',
  name: 'Starlink',
};
const ATLAS = {
  id: 'ula-1',
  provider: 'ULA',
  status: 'Go',
  orbit: { name: 'GTO' },
  launchSite: 'Space Launch Complex 41',
  rocketName: 'Atlas V 551',
  name: 'Atlas',
};
const ELECTRON = {
  id: 'rl-1',
  provider: 'Rocket Lab',
  status: 'TBD',
  orbit: { name: 'SSO' },
  launchSite: 'Launch Complex 1',
  rocket: { configuration: { name: 'Electron' } },
  name: 'Science',
};
const BLANK = {
  id: 'blank-1',
  provider: 'ULA',
  status: 'Go',
  orbit: { name: 'LEO' },
  launchSite: 'Unknown launch site',
  rocketName: null,
  name: 'Unspecified',
};
const EMPTY = {
  id: 'empty-1',
  provider: 'NASA',
  status: 'Hold',
  orbit: null,
  launchSite: '',
  rocketName: '',
  name: 'Blank Vehicle',
};
const ROSTER = [FALCON, ATLAS, ELECTRON, BLANK, EMPTY];
const CHIP_IDS = ['Atlas V', 'Electron', 'Falcon 9', LAUNCH_ROCKET_OTHER_CHIP_ID];

test('compact names plus Other for blank or unknown vehicles', () => {
  assert.equal(compactRocketName('Falcon 9 Block 5'), 'Falcon 9');
  assert.equal(compactRocketName('Atlas V 551'), 'Atlas V');
  assert.equal(compactRocketName('Atlas V N22'), 'Atlas V');
  assert.equal(compactRocketName('Ariane 5 ECA'), 'Ariane 5');
  assert.equal(compactRocketName('New Glenn 9x4'), 'New Glenn');
  assert.equal(compactRocketName('Electron'), 'Electron');
  assert.equal(compactRocketName('Unknown'), null);
  assert.equal(launchRocketChipId(FALCON), 'Falcon 9');
  assert.equal(launchRocketChipId({ rocketName: '  Falcon 9 Block 5  ' }), 'Falcon 9');
  assert.equal(launchRocketChipId({ rocket: { configuration: { name: 'Atlas V 401' } } }), 'Atlas V');
  assert.equal(launchRocketChipId({ rocket: { name: 'Falcon Heavy' } }), 'Falcon Heavy');
  assert.equal(launchRocketChipId(BLANK), LAUNCH_ROCKET_OTHER_CHIP_ID);
  assert.equal(launchRocketChipId(EMPTY), LAUNCH_ROCKET_OTHER_CHIP_ID);
  assert.equal(launchRocketChipId({}), LAUNCH_ROCKET_OTHER_CHIP_ID);
  assert.equal(launchRocketChipId(null), LAUNCH_ROCKET_OTHER_CHIP_ID);
  assert.deepEqual(listLaunchRocketChipIds(ROSTER), CHIP_IDS);
  assert.equal(launchRocketChipLabel(LAUNCH_ROCKET_OTHER_CHIP_ID), 'Other');
  assert.equal(launchRocketChipLabel('Falcon 9'), 'Falcon 9');
});

test('all on matches the current 30-day roster', () => {
  const hidden = filterLaunchesByRocket(
    ROSTER,
    normalizeLaunchRocketFilter({ 'Falcon 9': true }, CHIP_IDS),
  );
  assert.deepEqual(hidden.map((row) => row.id), ['sx-1']);
  const restored = filterLaunchesByRocket(ROSTER, DEFAULT_LAUNCH_ROCKET_FILTER);
  assert.deepEqual(restored.map((row) => row.id), ROSTER.map((row) => row.id));
  const rosterEntries = missionRosterEntries(ROSTER);
  assert.deepEqual(
    rosterEntries.map((entry) => entry.launch.id).sort(),
    ROSTER.map((row) => row.id).sort(),
  );
  assert.equal(normalizeLaunchRocketFilter(null, CHIP_IDS), DEFAULT_LAUNCH_ROCKET_FILTER);
  assert.equal(normalizeLaunchRocketFilter('all', CHIP_IDS), DEFAULT_LAUNCH_ROCKET_FILTER);
});

test('turning Falcon 9 off hides those missions and keeps the others', () => {
  const withoutFalcon = normalizeLaunchRocketFilter({
    'Falcon 9': false,
    'Atlas V': true,
    Electron: true,
    [LAUNCH_ROCKET_OTHER_CHIP_ID]: true,
  }, CHIP_IDS);
  const visible = filterLaunchesByRocket(ROSTER, withoutFalcon);
  assert.deepEqual(visible.map((row) => row.id).sort(), ['blank-1', 'empty-1', 'rl-1', 'ula-1']);
  assert.equal(launchPassesRocketFilter(FALCON, withoutFalcon), false);
  assert.equal(launchPassesRocketFilter(ATLAS, withoutFalcon), true);
  assert.equal(launchPassesRocketFilter(BLANK, withoutFalcon), true);
});

test('Other off hides unnamed vehicles', () => {
  const withoutOther = normalizeLaunchRocketFilter({
    'Falcon 9': true,
    'Atlas V': true,
    Electron: true,
    [LAUNCH_ROCKET_OTHER_CHIP_ID]: false,
  }, CHIP_IDS);
  const visible = filterLaunchesByRocket(ROSTER, withoutOther);
  assert.deepEqual(visible.map((row) => row.id).sort(), ['rl-1', 'sx-1', 'ula-1']);
  assert.equal(launchPassesRocketFilter(BLANK, withoutOther), false);
  assert.equal(launchPassesRocketFilter(EMPTY, withoutOther), false);
  assert.equal(launchPassesRocketFilter(FALCON, withoutOther), true);
});

test('selected mission stays visible when its rocket chip is off', () => {
  const withoutFalcon = normalizeLaunchRocketFilter({
    'Falcon 9': false,
    'Atlas V': true,
    Electron: true,
    [LAUNCH_ROCKET_OTHER_CHIP_ID]: true,
  }, CHIP_IDS);
  assert.equal(launchPassesRocketFilter(FALCON, withoutFalcon, 'sx-1'), true);
  assert.equal(launchPassesRocketFilter(ELECTRON, withoutFalcon, 'sx-1'), true);
  const visible = filterLaunchesByRocket(ROSTER, withoutFalcon, 'sx-1');
  assert.ok(visible.some((row) => row.id === 'sx-1'));
  assert.ok(visible.some((row) => row.id === 'ula-1'));
  const roster = missionRosterEntries(ROSTER, {
    rocketFilter: withoutFalcon,
    selectedLaunchId: 'sx-1',
  });
  assert.ok(roster.some((entry) => entry.launch.id === 'sx-1'));
});

test('Status Go + one provider + one rocket still ANDs', () => {
  const falconOnly = normalizeLaunchRocketFilter({
    'Falcon 9': true,
    'Atlas V': false,
    Electron: false,
    [LAUNCH_ROCKET_OTHER_CHIP_ID]: false,
  }, CHIP_IDS);
  const spaceXOnly = normalizeLaunchProviderFilter({
    SpaceX: true,
    ULA: false,
    'Rocket Lab': false,
    NASA: false,
  }, ['NASA', 'Rocket Lab', 'SpaceX', 'ULA']);
  const goOnly = filterLaunchesByStatus(ROSTER, { go: true });
  const anded = filterLaunchesByRocket(goOnly, falconOnly)
    .filter((row) => row.provider === 'SpaceX');
  assert.deepEqual(anded.map((row) => row.id), ['sx-1']);
  const roster = missionRosterEntries(ROSTER, {
    statusFilter: { go: true },
    providerFilter: spaceXOnly,
    rocketFilter: falconOnly,
  });
  assert.deepEqual(roster.map((entry) => entry.launch.id), ['sx-1']);
});

test('toggle chips stay independent and default all on', () => {
  assert.equal(DEFAULT_LAUNCH_ROCKET_FILTER, 'all');
  assert.equal(LAUNCH_ROCKET_OTHER_CHIP_ID, 'other');
  const withoutFalcon = toggleLaunchRocketFilter(DEFAULT_LAUNCH_ROCKET_FILTER, 'Falcon 9', CHIP_IDS);
  assert.equal(launchPassesRocketFilter(FALCON, withoutFalcon), false);
  assert.equal(launchPassesRocketFilter(ATLAS, withoutFalcon), true);
  assert.equal(
    toggleLaunchRocketFilter(withoutFalcon, 'Falcon 9', CHIP_IDS),
    DEFAULT_LAUNCH_ROCKET_FILTER,
  );
  const lastOff = CHIP_IDS.reduce(
    (filter, id) => toggleLaunchRocketFilter(filter, id, CHIP_IDS),
    DEFAULT_LAUNCH_ROCKET_FILTER,
  );
  assert.equal(lastOff, '0');
});

test('meridian.launchRocket persists and reload keeps the choice', () => {
  resetLaunchRocketFilterForTest();
  const storage = memoryStorage();
  assert.equal(LAUNCH_ROCKET_FILTER_STORAGE_KEY, 'meridian.launchRocket');
  assert.equal(readLaunchRocketFilter(storage), DEFAULT_LAUNCH_ROCKET_FILTER);
  const falconOnly = normalizeLaunchRocketFilter({
    'Falcon 9': true,
    'Atlas V': false,
    Electron: false,
    [LAUNCH_ROCKET_OTHER_CHIP_ID]: false,
  }, CHIP_IDS);
  assert.equal(setLaunchRocketFilter(falconOnly, { storage, chipIds: CHIP_IDS }), falconOnly);
  assert.equal(storage.getItem(LAUNCH_ROCKET_FILTER_STORAGE_KEY), falconOnly);
  assert.equal(getLaunchRocketFilter(), falconOnly);

  resetLaunchRocketFilterForTest();
  assert.equal(getLaunchRocketFilter(), DEFAULT_LAUNCH_ROCKET_FILTER);
  assert.equal(hydrateLaunchRocketFilter(storage), falconOnly);
  assert.equal(getLaunchRocketFilter(), falconOnly);
  writeLaunchRocketFilter(DEFAULT_LAUNCH_ROCKET_FILTER, storage);
  assert.equal(storage.getItem(LAUNCH_ROCKET_FILTER_STORAGE_KEY), DEFAULT_LAUNCH_ROCKET_FILTER);
  resetLaunchRocketFilterForTest();
});

test('rocket chips filter the existing Space Missions roster — not a new list or endpoint', () => {
  assert.match(indexHtml, /id="space-mission-roster"/);
  assert.match(indexHtml, /id="context-missions-view"[^>]*hidden/);
  assert.match(indexHtml, /data-mission-status-chip="go"/);
  assert.match(indexHtml, /data-mission-provider-chips|space-mission-provider-chips/);
  assert.match(indexHtml, /data-mission-rocket-chips/);
  assert.match(indexHtml, /aria-label="Launch rocket filters"/);
  assert.match(indexHtml, /AVAILABLE MISSIONS/);
  assert.ok(
    indexHtml.indexOf('id="context-missions-view"') < indexHtml.indexOf('data-mission-rocket-chips'),
    'rocket chips live in the Space Missions view hidden when the launches layer is off',
  );
  assert.ok(
    indexHtml.indexOf('data-mission-provider-chips') < indexHtml.indexOf('data-mission-rocket-chips'),
    'rocket chips sit next to provider chips on the roster',
  );
  assert.doesNotMatch(indexHtml, /space-mission-rocket-chips[\s\S]*launches-panel/);
  assert.match(rocketLaunchesSource, /filterLaunchesByRocket|launchPassesRocketFilter/);
  assert.match(rocketLaunchesSource, /hydrateLaunchRocketFilter|subscribeLaunchRocketFilter|setLaunchRocketFilter/);
  assert.match(
    rocketLaunchesSource,
    /rocketName:\s*launch\.rocket\?\.configuration\?\.name\s*\|\|\s*launch\.rocket\?\.name/,
  );
  assert.equal((rocketLaunchesSource.match(/fetch\(/g) || []).length, 2);
  assert.match(rocketLaunchesSource, /const API_URL = '\/api\/launches'/);
  assert.match(rocketLaunchesSource, /fetch\('\/api\/celestrak\/active'\)/);
  assert.match(rocketLaunchesSource, /const WINDOW_DAYS = 30/);
  assert.doesNotMatch(rocketLaunchesSource, /\/api\/launch-rocket|\/api\/launches\/rocket/);
  assert.doesNotMatch(launchesSource, /rocket__name|configuration__name|rocket__ids/);
  assert.doesNotMatch(launchesPanelSource, /data-mission-rocket-chip|setLaunchRocketFilter/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /OpenStreetMap|Cesium|CC BY/);
  assert.equal(packageJson.name, 'meridian');
  assert.match(readme, /Meridian is an \*\*independent commercial product\*\*/);
  assert.doesNotMatch(rocketLaunchesSource, /opensky-network\.org|google\.com\/news|telegeography|quantum-earth/i);
});

test('first-run missions do not write meridian.launchRocket', () => {
  const code = firstRunSource.slice(firstRunSource.indexOf('export function shouldShowFirstRun'));
  assert.match(firstRunSource, /meridian\.launchRocket/);
  for (const forbidden of ['setLaunchRocketFilter', 'writeLaunchRocketFilter', 'hydrateLaunchRocketFilter']) {
    assert.doesNotMatch(code, new RegExp(forbidden), `a mission must never touch ${forbidden}`);
  }
});
