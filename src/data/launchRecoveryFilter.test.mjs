import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_LAUNCH_RECOVERY_ONLY,
  LAUNCH_RECOVERY_ONLY_CHIP_LABEL,
  LAUNCH_RECOVERY_ONLY_STORAGE_KEY,
  filterLaunchesByRecovery,
  getLaunchRecoveryOnly,
  hydrateLaunchRecoveryOnly,
  launchHasRecoveryAttempt,
  launchPassesRecoveryFilter,
  normalizeLaunchRecoveryOnly,
  readLaunchRecoveryOnly,
  resetLaunchRecoveryOnlyForTest,
  setLaunchRecoveryOnly,
  writeLaunchRecoveryOnly,
} from './launchRecoveryFilter.js';
import { filterLaunchesByStatus } from './launchStatusFilter.js';
import { filterLaunchesByProvider, normalizeLaunchProviderFilter } from './launchProviderFilter.js';
import { filterLaunchesByOrbit, normalizeLaunchOrbitFilter } from './launchOrbitFilter.js';
import { filterLaunchesBySite, launchSiteChipIdsFromLaunches, normalizeLaunchSiteFilter } from './launchSiteFilter.js';
import { filterLaunchesByRocket, normalizeLaunchRocketFilter } from './launchRocketFilter.js';
import { filterLaunchesByTimeWindow } from './launchTimeWindow.js';
import { filterLaunchesByWebcast } from './launchWebcastFilter.js';
import { filterLaunchesByProbability } from './launchProbabilityFilter.js';
import { filterLaunchesByUnknownSite } from './launchUnknownSiteFilter.js';
import { missionRosterEntries, normalizeRocketLaunches } from './rocketLaunches.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const indexHtml = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const rocketLaunchesSource = readFileSync(path.join(ROOT, 'src', 'data', 'rocketLaunches.js'), 'utf8');
const launchesSource = readFileSync(path.join(ROOT, 'src', 'data', 'launches.js'), 'utf8');
const launchesPanelSource = readFileSync(path.join(ROOT, 'src', 'data', 'launchesPanel.js'), 'utf8');
const firstRunSource = readFileSync(path.join(ROOT, 'src', 'firstRunExperience.js'), 'utf8');
const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const NOW = new Date('2026-08-01T00:00:00Z');

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
  id: 'falcon-1',
  status: 'Go',
  provider: 'SpaceX',
  launchSite: 'Space Launch Complex 4E',
  rocketName: 'Falcon 9',
  orbit: { name: 'LEO' },
  webcastLive: true,
  probability: 90,
  launchTime: '2026-07-28T00:00:00Z',
  recoveryStages: [{ attempted: true, name: 'Core · B1099' }],
  name: 'Falcon Recovery',
};
const EMPTY = {
  id: 'empty-1',
  status: 'Go',
  provider: 'SpaceX',
  launchSite: 'Space Launch Complex 4E',
  rocketName: 'Falcon 9',
  orbit: { name: 'LEO' },
  webcastLive: true,
  probability: 88,
  launchTime: '2026-07-27T00:00:00Z',
  recoveryStages: [],
  name: 'No Stages',
};
const MISSING = {
  id: 'missing-1',
  status: 'Go',
  provider: 'ULA',
  launchSite: 'Space Launch Complex 41',
  rocketName: 'Atlas V',
  orbit: { name: 'GTO' },
  webcastLive: true,
  probability: 85,
  launchTime: '2026-07-26T00:00:00Z',
  name: 'No Recovery Field',
};
const NO_ATTEMPT = {
  id: 'none-1',
  status: 'Go',
  provider: 'SpaceX',
  launchSite: 'Space Launch Complex 4E',
  rocketName: 'Falcon 9',
  orbit: { name: 'LEO' },
  webcastLive: true,
  probability: 80,
  launchTime: '2026-07-25T00:00:00Z',
  recoveryStages: [{ attempted: false, name: 'Core · expended' }],
  name: 'Expended',
};
const OLD = {
  id: 'old-1',
  status: 'Go',
  provider: 'SpaceX',
  launchSite: 'Space Launch Complex 4E',
  rocketName: 'Falcon 9',
  orbit: { name: 'LEO' },
  webcastLive: true,
  probability: 92,
  launchTime: '2026-07-10T00:00:00Z',
  recoveryStages: [{ attempted: true, name: 'Core · B1080' }],
  name: 'Older Recovery',
};
const TBD = {
  id: 'tbd-1',
  status: 'TBD',
  provider: 'SpaceX',
  launchSite: 'Space Launch Complex 4E',
  rocketName: 'Falcon 9',
  orbit: { name: 'LEO' },
  webcastLive: true,
  probability: 70,
  launchTime: '2026-07-29T00:00:00Z',
  recoveryStages: [{ attempted: true, name: 'Core · B1100' }],
  name: 'TBD Recovery',
};
const ROSTER = [FALCON, EMPTY, MISSING, NO_ATTEMPT, OLD, TBD];

test('Recovery-attempted defaults off and treats attempted true as keep', () => {
  assert.equal(DEFAULT_LAUNCH_RECOVERY_ONLY, false);
  assert.equal(LAUNCH_RECOVERY_ONLY_CHIP_LABEL, 'Recovery-attempted');
  assert.equal(launchHasRecoveryAttempt(FALCON), true);
  assert.equal(launchHasRecoveryAttempt(EMPTY), false);
  assert.equal(launchHasRecoveryAttempt(MISSING), false);
  assert.equal(launchHasRecoveryAttempt(NO_ATTEMPT), false);
  assert.equal(launchHasRecoveryAttempt({ recoveryStages: null }), false);
  assert.equal(launchHasRecoveryAttempt({}), false);
  assert.equal(normalizeLaunchRecoveryOnly(null), DEFAULT_LAUNCH_RECOVERY_ONLY);
  assert.equal(normalizeLaunchRecoveryOnly(''), DEFAULT_LAUNCH_RECOVERY_ONLY);
  assert.equal(normalizeLaunchRecoveryOnly('bogus'), DEFAULT_LAUNCH_RECOVERY_ONLY);
  assert.equal(normalizeLaunchRecoveryOnly(false), false);
  assert.equal(normalizeLaunchRecoveryOnly(true), true);
  assert.equal(normalizeLaunchRecoveryOnly('1'), true);
});

test('off matches the current 30-day roster', () => {
  const restored = filterLaunchesByRecovery(ROSTER, DEFAULT_LAUNCH_RECOVERY_ONLY);
  assert.deepEqual(restored.map((row) => row.id), ROSTER.map((row) => row.id));
  const rosterEntries = missionRosterEntries(ROSTER, {
    recoveryOnly: false,
    nowMs: NOW.getTime(),
  });
  assert.deepEqual(
    rosterEntries.map((entry) => entry.launch.id).sort(),
    ROSTER.map((row) => row.id).sort(),
  );
});

test('on keeps a Falcon with attempted true and hides empty recoveryStages', () => {
  const visible = filterLaunchesByRecovery(ROSTER, true);
  assert.deepEqual(visible.map((row) => row.id), ['falcon-1', 'old-1', 'tbd-1']);
  assert.equal(launchPassesRecoveryFilter(FALCON, true), true);
  assert.equal(launchPassesRecoveryFilter(EMPTY, true), false);
  assert.equal(launchPassesRecoveryFilter(MISSING, true), false);
  assert.equal(launchPassesRecoveryFilter(NO_ATTEMPT, true), false);
  assert.equal(launchPassesRecoveryFilter({ id: 'empty' }, true), false);
});

test('selected mission stays even without a recovery attempt', () => {
  assert.equal(launchPassesRecoveryFilter(EMPTY, true, 'empty-1'), true);
  assert.equal(launchPassesRecoveryFilter(MISSING, true, 'empty-1'), false);
  const visible = filterLaunchesByRecovery(ROSTER, true, 'empty-1');
  assert.ok(visible.some((row) => row.id === 'empty-1'));
  assert.ok(visible.some((row) => row.id === 'falcon-1'));
  assert.ok(!visible.some((row) => row.id === 'none-1'));
  const roster = missionRosterEntries(ROSTER, {
    recoveryOnly: true,
    selectedLaunchId: 'empty-1',
  });
  assert.ok(roster.some((entry) => entry.launch.id === 'empty-1'));
});

test('Status Go + provider + orbit + site + rocket + 7d + webcast + 80+ + hide-unknown-site still ANDs', () => {
  const goOnly = filterLaunchesByStatus(ROSTER, { go: true });
  const spaceXOnly = filterLaunchesByProvider(
    goOnly,
    normalizeLaunchProviderFilter({ SpaceX: true, ULA: false }, ['SpaceX', 'ULA']),
  );
  const leoOnly = filterLaunchesByOrbit(
    spaceXOnly,
    normalizeLaunchOrbitFilter({ leo: true, meo: false, geo: false, polar: false, other: false }),
  );
  const siteIds = launchSiteChipIdsFromLaunches(leoOnly);
  const siteOnly = filterLaunchesBySite(
    leoOnly,
    normalizeLaunchSiteFilter({ '4E': true, '41': false, other: false }, siteIds),
  );
  const falconOnly = filterLaunchesByRocket(
    siteOnly,
    normalizeLaunchRocketFilter({ 'Falcon 9': true, 'Atlas V': false }, ['Atlas V', 'Falcon 9']),
  );
  const windowed = filterLaunchesByTimeWindow(falconOnly, '7d', null, NOW.getTime());
  const webcastOnly = filterLaunchesByWebcast(windowed, true);
  const floored = filterLaunchesByProbability(webcastOnly, '80');
  const named = filterLaunchesByUnknownSite(floored, true);
  const recovered = filterLaunchesByRecovery(named, true);
  assert.deepEqual(recovered.map((row) => row.id), ['falcon-1']);
  const roster = missionRosterEntries(ROSTER, {
    statusFilter: { go: true },
    providerFilter: normalizeLaunchProviderFilter({ SpaceX: true, ULA: false }, ['SpaceX', 'ULA']),
    orbitFilter: normalizeLaunchOrbitFilter({ leo: true, meo: false, geo: false, polar: false, other: false }),
    siteFilter: normalizeLaunchSiteFilter({ '4E': true, '41': false, other: false }, siteIds),
    rocketFilter: normalizeLaunchRocketFilter({ 'Falcon 9': true, 'Atlas V': false }, ['Atlas V', 'Falcon 9']),
    timeWindow: '7d',
    webcastOnly: true,
    probabilityFilter: '80',
    hideUnknownSite: true,
    recoveryOnly: true,
    nowMs: NOW.getTime(),
  });
  assert.deepEqual(roster.map((entry) => entry.launch.id), ['falcon-1']);
});

test('meridian.launchRecoveryOnly persists and reload keeps the choice', () => {
  resetLaunchRecoveryOnlyForTest();
  const storage = memoryStorage();
  assert.equal(LAUNCH_RECOVERY_ONLY_STORAGE_KEY, 'meridian.launchRecoveryOnly');
  assert.equal(readLaunchRecoveryOnly(storage), DEFAULT_LAUNCH_RECOVERY_ONLY);
  assert.equal(setLaunchRecoveryOnly(true, { storage }), true);
  assert.equal(storage.getItem(LAUNCH_RECOVERY_ONLY_STORAGE_KEY), '1');
  assert.equal(getLaunchRecoveryOnly(), true);

  resetLaunchRecoveryOnlyForTest();
  assert.equal(getLaunchRecoveryOnly(), DEFAULT_LAUNCH_RECOVERY_ONLY);
  assert.equal(hydrateLaunchRecoveryOnly(storage), true);
  assert.equal(getLaunchRecoveryOnly(), true);
  writeLaunchRecoveryOnly(DEFAULT_LAUNCH_RECOVERY_ONLY, storage);
  assert.equal(storage.getItem(LAUNCH_RECOVERY_ONLY_STORAGE_KEY), '0');
  resetLaunchRecoveryOnlyForTest();
});

test('normalizeRocketLaunches keeps recoveryStages.attempted from landing.attempt', () => {
  const falcon = normalizeRocketLaunches({ results: [{
    id: 'falcon',
    name: 'Falcon 9 | Starlink',
    net: '2026-07-20T10:00:00Z',
    pad: { latitude: '28.608', longitude: '-80.604', name: 'LC-39A' },
    rocket: {
      configuration: { name: 'Falcon 9' },
      launcher_stage: [{
        id: 77,
        type: 'Core',
        launcher: { serial_number: 'B1099' },
        landing: { attempt: true, success: true },
      }],
    },
  }] }, NOW);
  assert.equal(falcon[0].recoveryStages[0].attempted, true);
  assert.equal(launchHasRecoveryAttempt(falcon[0]), true);

  const empty = normalizeRocketLaunches({ results: [{
    id: 'empty',
    name: 'Expendable',
    net: '2026-07-20T10:00:00Z',
    pad: { latitude: '28.608', longitude: '-80.604', name: 'LC-39A' },
    rocket: {},
  }] }, NOW);
  assert.deepEqual(empty[0].recoveryStages, []);
  assert.equal(launchHasRecoveryAttempt(empty[0]), false);

  const expended = normalizeRocketLaunches({ results: [{
    id: 'expended',
    name: 'No Attempt',
    net: '2026-07-20T10:00:00Z',
    pad: { latitude: '28.608', longitude: '-80.604', name: 'LC-39A' },
    rocket: {
      launcher_stage: [{
        id: 1,
        type: 'Core',
        landing: { attempt: false },
      }],
    },
  }] }, NOW);
  assert.equal(expended[0].recoveryStages[0].attempted, false);
  assert.equal(launchHasRecoveryAttempt(expended[0]), false);
});

test('Recovery-attempted filters the existing Space Missions roster — not a new list or endpoint', () => {
  assert.match(indexHtml, /id="space-mission-roster"/);
  assert.match(indexHtml, /id="context-missions-view"[^>]*hidden/);
  assert.match(indexHtml, /data-mission-recovery-chip="attempted"/);
  assert.match(indexHtml, />Recovery-attempted</);
  assert.match(indexHtml, /data-mission-status-chip="go"/);
  assert.match(indexHtml, /AVAILABLE MISSIONS/);
  assert.ok(
    indexHtml.indexOf('id="context-missions-view"') < indexHtml.indexOf('data-mission-recovery-chip'),
    'recovery toggle lives in the Space Missions view hidden when the launches layer is off',
  );
  assert.ok(
    indexHtml.indexOf('data-mission-unknown-site-chip') < indexHtml.indexOf('data-mission-recovery-chip'),
    'recovery toggle sits with the launch chip row',
  );
  assert.doesNotMatch(indexHtml, /space-mission-recovery-chips[\s\S]*launches-panel/);
  assert.match(rocketLaunchesSource, /filterLaunchesByRecovery|launchPassesRecoveryFilter/);
  assert.match(rocketLaunchesSource, /hydrateLaunchRecoveryOnly|subscribeLaunchRecoveryOnly|setLaunchRecoveryOnly/);
  assert.match(rocketLaunchesSource, /recoveryStages:\s*normalizeRecoveryStages\(launch, payloads\)/);
  assert.equal((rocketLaunchesSource.match(/fetch\(/g) || []).length, 2);
  assert.match(rocketLaunchesSource, /const API_URL = '\/api\/launches'/);
  assert.match(rocketLaunchesSource, /fetch\('\/api\/celestrak\/active'\)/);
  assert.match(rocketLaunchesSource, /const WINDOW_DAYS = 30/);
  assert.doesNotMatch(rocketLaunchesSource, /\/api\/launch-recovery|\/api\/launches\/recovery/);
  assert.doesNotMatch(launchesSource, /recoveryStages|launchRecoveryOnly/);
  assert.doesNotMatch(launchesPanelSource, /data-mission-recovery-chip|setLaunchRecoveryOnly/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /OpenStreetMap|Cesium|CC BY/);
  assert.equal(packageJson.name, 'meridian');
  assert.match(readme, /Meridian is an \*\*independent commercial product\*\*/);
  assert.doesNotMatch(rocketLaunchesSource, /google\.com\/news|telegeography|quantum-earth/i);
});

test('first-run missions do not write meridian.launchRecoveryOnly', () => {
  const code = firstRunSource.slice(firstRunSource.indexOf('export function shouldShowFirstRun'));
  assert.match(firstRunSource, /meridian\.launchRecoveryOnly/);
  for (const forbidden of [
    'setLaunchRecoveryOnly',
    'writeLaunchRecoveryOnly',
    'hydrateLaunchRecoveryOnly',
  ]) {
    assert.doesNotMatch(code, new RegExp(forbidden), `a mission must never touch ${forbidden}`);
  }
});
