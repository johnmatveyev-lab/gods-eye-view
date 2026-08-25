import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_LAUNCH_ORBIT_FILTER,
  LAUNCH_ORBIT_CHIP_IDS,
  LAUNCH_ORBIT_CHIP_LABELS,
  LAUNCH_ORBIT_FILTER_STORAGE_KEY,
  filterLaunchesByOrbit,
  getLaunchOrbitFilter,
  hydrateLaunchOrbitFilter,
  launchOrbitChipId,
  launchPassesOrbitFilter,
  normalizeLaunchOrbitFilter,
  readLaunchOrbitFilter,
  resetLaunchOrbitFilterForTest,
  setLaunchOrbitFilter,
  toggleLaunchOrbitFilter,
  writeLaunchOrbitFilter,
} from './launchOrbitFilter.js';
import {
  filterLaunchesByStatus,
  launchPassesStatusFilter,
} from './launchStatusFilter.js';
import {
  launchPassesProviderFilter,
  normalizeLaunchProviderFilter,
} from './launchProviderFilter.js';
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

const LEO = { id: 'leo-1', status: 'Go', provider: 'SpaceX', orbit: { name: 'Low Earth Orbit' }, name: 'LEO Mission' };
const MEO = { id: 'meo-1', status: 'Go', provider: 'ULA', orbit: { name: 'Medium Earth Orbit' }, name: 'MEO Mission' };
const GEO = { id: 'geo-1', status: 'Go', provider: 'SpaceX', orbit: { name: 'Geostationary Orbit' }, name: 'GEO Mission' };
const GTO = { id: 'gto-1', status: 'Go', provider: 'Arianespace', orbit: { name: 'Geostationary Transfer Orbit' }, name: 'GTO Mission' };
const POLAR = { id: 'polar-1', status: 'Go', provider: 'Rocket Lab', orbit: { name: 'Sun-Synchronous Orbit' }, name: 'SSO Mission' };
const OTHER = { id: 'other-1', status: 'Go', provider: 'CASC', orbit: { name: 'Highly Elliptical Orbit' }, name: 'HEO Mission' };
const MISSING = { id: 'missing-1', status: 'TBD', provider: 'SpaceX', orbit: null, name: 'Unknown Orbit' };
const ROSTER = [LEO, MEO, GEO, GTO, POLAR, OTHER, MISSING];

test('Launch Library 2 orbit.name maps onto the five chips', () => {
  assert.equal(launchOrbitChipId('LEO'), 'leo');
  assert.equal(launchOrbitChipId('Low Earth Orbit'), 'leo');
  assert.equal(launchOrbitChipId({ name: 'Low Earth Orbit' }), 'leo');
  assert.equal(launchOrbitChipId('MEO'), 'meo');
  assert.equal(launchOrbitChipId('Medium Earth Orbit'), 'meo');
  assert.equal(launchOrbitChipId('GEO'), 'geo');
  assert.equal(launchOrbitChipId('Geostationary Orbit'), 'geo');
  assert.equal(launchOrbitChipId('Geosynchronous Orbit'), 'geo');
  assert.equal(launchOrbitChipId('GTO'), 'geo');
  assert.equal(launchOrbitChipId('Geostationary Transfer Orbit'), 'geo');
  assert.equal(launchOrbitChipId('Polar Orbit'), 'polar');
  assert.equal(launchOrbitChipId('Sun-Synchronous Orbit'), 'polar');
  assert.equal(launchOrbitChipId('SSO'), 'polar');
  assert.equal(launchOrbitChipId('Polar LEO'), 'polar');
  assert.equal(launchOrbitChipId('Highly Elliptical Orbit'), 'other');
  assert.equal(launchOrbitChipId('Lunar'), 'other');
  assert.equal(launchOrbitChipId(null), 'other');
  assert.equal(launchOrbitChipId({}), 'other');
});

test('all on matches the current 30-day roster', () => {
  const visible = filterLaunchesByOrbit(ROSTER, DEFAULT_LAUNCH_ORBIT_FILTER);
  assert.deepEqual(visible.map((row) => row.id), ROSTER.map((row) => row.id));
  const rosterEntries = missionRosterEntries(ROSTER);
  assert.deepEqual(
    rosterEntries.map((entry) => entry.launch.id).sort(),
    ROSTER.map((row) => row.id).sort(),
  );
  assert.equal(normalizeLaunchOrbitFilter(null), DEFAULT_LAUNCH_ORBIT_FILTER);
  assert.equal(normalizeLaunchOrbitFilter('lmgpo'), DEFAULT_LAUNCH_ORBIT_FILTER);
});

test('turning GEO off hides GEO/GTO rows and keeps LEO', () => {
  const withoutGeo = normalizeLaunchOrbitFilter({
    leo: true,
    meo: true,
    geo: false,
    polar: true,
    other: true,
  });
  const visible = filterLaunchesByOrbit(ROSTER, withoutGeo);
  assert.deepEqual(visible.map((row) => row.id), ['leo-1', 'meo-1', 'polar-1', 'other-1', 'missing-1']);
  assert.equal(launchPassesOrbitFilter(LEO, withoutGeo), true);
  assert.equal(launchPassesOrbitFilter(GEO, withoutGeo), false);
  assert.equal(launchPassesOrbitFilter(GTO, withoutGeo), false);
  const roster = missionRosterEntries(ROSTER, { orbitFilter: withoutGeo });
  assert.equal(roster.some((entry) => entry.launch.id === 'geo-1' || entry.launch.id === 'gto-1'), false);
  assert.equal(roster.some((entry) => entry.launch.id === 'leo-1'), true);
});

test('selected mission stays visible when its orbit chip is off', () => {
  const leoOnly = normalizeLaunchOrbitFilter({ leo: true });
  assert.equal(launchPassesOrbitFilter(GTO, leoOnly, 'gto-1'), true);
  assert.equal(launchPassesOrbitFilter(GEO, leoOnly, 'gto-1'), false);
  const visible = filterLaunchesByOrbit(ROSTER, leoOnly, 'gto-1');
  assert.deepEqual(visible.map((row) => row.id).sort(), ['gto-1', 'leo-1']);
  const roster = missionRosterEntries(ROSTER, {
    orbitFilter: leoOnly,
    selectedLaunchId: 'gto-1',
  });
  assert.deepEqual(roster.map((entry) => entry.launch.id).sort(), ['gto-1', 'leo-1']);
});

test('Status Go + one provider + LEO still AND', () => {
  const mixed = [
    { id: 'keep', status: 'Go', provider: 'SpaceX', orbit: { name: 'LEO' } },
    { id: 'geo', status: 'Go', provider: 'SpaceX', orbit: { name: 'GTO' } },
    { id: 'tbd', status: 'TBD', provider: 'SpaceX', orbit: { name: 'LEO' } },
    { id: 'ula', status: 'Go', provider: 'ULA', orbit: { name: 'LEO' } },
  ];
  const spaceXOnly = normalizeLaunchProviderFilter({
    SpaceX: true,
    ULA: false,
  }, ['SpaceX', 'ULA']);
  const goOnly = filterLaunchesByStatus(mixed, { go: true });
  const goLeo = filterLaunchesByOrbit(goOnly, { leo: true });
  const andProvider = goLeo.filter((launch) => launchPassesProviderFilter(launch, spaceXOnly));
  assert.deepEqual(andProvider.map((row) => row.id), ['keep']);
  assert.equal(launchPassesStatusFilter(mixed[0], { go: true }), true);
  assert.equal(launchPassesOrbitFilter(mixed[0], { leo: true }), true);
  assert.equal(launchPassesOrbitFilter(mixed[1], { leo: true }), false);
  assert.equal(launchPassesStatusFilter(mixed[2], { go: true }), false);

  const roster = missionRosterEntries(mixed, {
    statusFilter: { go: true },
    orbitFilter: { leo: true },
    providerFilter: spaceXOnly,
  });
  assert.deepEqual(roster.map((entry) => entry.launch.id), ['keep']);
});

test('toggle chips stay independent and default all on', () => {
  assert.deepEqual(LAUNCH_ORBIT_CHIP_IDS, ['leo', 'meo', 'geo', 'polar', 'other']);
  assert.deepEqual(LAUNCH_ORBIT_CHIP_LABELS, {
    leo: 'LEO',
    meo: 'MEO',
    geo: 'GEO',
    polar: 'Polar',
    other: 'Other',
  });
  assert.equal(DEFAULT_LAUNCH_ORBIT_FILTER, 'lmgpo');
  const withoutGeo = toggleLaunchOrbitFilter(DEFAULT_LAUNCH_ORBIT_FILTER, 'geo');
  assert.equal(withoutGeo, 'lmpo');
  assert.equal(toggleLaunchOrbitFilter(withoutGeo, 'geo'), DEFAULT_LAUNCH_ORBIT_FILTER);
  assert.equal(toggleLaunchOrbitFilter('l', 'leo'), '0');
});

test('meridian.launchOrbit persists and reload keeps the choice', () => {
  resetLaunchOrbitFilterForTest();
  const storage = memoryStorage();
  assert.equal(LAUNCH_ORBIT_FILTER_STORAGE_KEY, 'meridian.launchOrbit');
  assert.equal(readLaunchOrbitFilter(storage), DEFAULT_LAUNCH_ORBIT_FILTER);
  assert.equal(setLaunchOrbitFilter({ leo: true }, { storage }), 'l');
  assert.equal(storage.getItem(LAUNCH_ORBIT_FILTER_STORAGE_KEY), 'l');
  assert.equal(getLaunchOrbitFilter(), 'l');

  resetLaunchOrbitFilterForTest();
  assert.equal(getLaunchOrbitFilter(), DEFAULT_LAUNCH_ORBIT_FILTER);
  assert.equal(hydrateLaunchOrbitFilter(storage), 'l');
  assert.equal(getLaunchOrbitFilter(), 'l');
  writeLaunchOrbitFilter(DEFAULT_LAUNCH_ORBIT_FILTER, storage);
  assert.equal(storage.getItem(LAUNCH_ORBIT_FILTER_STORAGE_KEY), DEFAULT_LAUNCH_ORBIT_FILTER);
  resetLaunchOrbitFilterForTest();
});

test('orbit chips filter the existing Space Missions roster — not a new list or endpoint', () => {
  assert.match(indexHtml, /id="space-mission-roster"/);
  assert.match(indexHtml, /data-mission-status-chip="go"/);
  assert.match(indexHtml, /data-mission-provider-chips/);
  assert.match(indexHtml, /data-mission-orbit-chip="leo"/);
  assert.match(indexHtml, /data-mission-orbit-chip="meo"/);
  assert.match(indexHtml, /data-mission-orbit-chip="geo"/);
  assert.match(indexHtml, /data-mission-orbit-chip="polar"/);
  assert.match(indexHtml, /data-mission-orbit-chip="other"/);
  assert.match(indexHtml, /AVAILABLE MISSIONS/);
  assert.ok(
    indexHtml.indexOf('data-mission-status-chip') < indexHtml.indexOf('data-mission-orbit-chip'),
    'orbit chips sit next to status chips on the roster',
  );
  assert.doesNotMatch(indexHtml, /data-mission-orbit-chip="leo"[\s\S]*launches-panel/);
  assert.match(rocketLaunchesSource, /launchPassesOrbitFilter|filterLaunchesByOrbit/);
  assert.match(rocketLaunchesSource, /launchPassesStatusFilter/);
  assert.match(rocketLaunchesSource, /launchPassesProviderFilter/);
  assert.match(rocketLaunchesSource, /hydrateLaunchOrbitFilter|subscribeLaunchOrbitFilter|setLaunchOrbitFilter/);
  assert.match(rocketLaunchesSource, /orbit: launch\.mission\?\.orbit \|\| launch\.orbit/);
  assert.equal((rocketLaunchesSource.match(/fetch\(/g) || []).length, 2);
  assert.match(rocketLaunchesSource, /const API_URL = '\/api\/launches'/);
  assert.match(rocketLaunchesSource, /fetch\('\/api\/celestrak\/active'\)/);
  assert.doesNotMatch(rocketLaunchesSource, /\/api\/launch-orbit|\/api\/launches\/orbit/);
  assert.doesNotMatch(launchesSource, /orbit__ids|orbit__name/);
  assert.doesNotMatch(launchesPanelSource, /data-mission-orbit-chip|setLaunchOrbitFilter/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /OpenStreetMap|Cesium|CC BY/);
  assert.equal(packageJson.name, 'meridian');
  assert.match(readme, /Meridian is an \*\*independent commercial product\*\*/);
  assert.doesNotMatch(rocketLaunchesSource, /opensky-network\.org|google\.com\/news|telegeography|quantum-earth/i);
});

test('first-run missions do not write meridian.launchOrbit', () => {
  const code = firstRunSource.slice(firstRunSource.indexOf('export function shouldShowFirstRun'));
  assert.match(firstRunSource, /meridian\.launchOrbit/);
  for (const forbidden of ['setLaunchOrbitFilter', 'writeLaunchOrbitFilter', 'hydrateLaunchOrbitFilter']) {
    assert.doesNotMatch(code, new RegExp(forbidden), `a mission must never touch ${forbidden}`);
  }
});
