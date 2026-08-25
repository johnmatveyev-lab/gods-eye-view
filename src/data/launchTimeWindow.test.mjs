import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_LAUNCH_TIME_WINDOW,
  LAUNCH_TIME_WINDOW_CHIP_IDS,
  LAUNCH_TIME_WINDOW_CHIP_LABELS,
  LAUNCH_TIME_WINDOW_STORAGE_KEY,
  MS_PER_DAY,
  filterLaunchesByTimeWindow,
  getLaunchTimeWindow,
  hydrateLaunchTimeWindow,
  launchPassesTimeWindow,
  launchTimeWindowDays,
  launchTimeWindowMs,
  normalizeLaunchTimeWindow,
  readLaunchTimeWindow,
  resetLaunchTimeWindowForTest,
  setLaunchTimeWindow,
  writeLaunchTimeWindow,
} from './launchTimeWindow.js';
import { filterLaunchesByStatus } from './launchStatusFilter.js';
import { filterLaunchesByProvider, normalizeLaunchProviderFilter } from './launchProviderFilter.js';
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

const NOW_MS = Date.parse('2026-08-25T12:00:00Z');

function isoDaysFromNow(days) {
  return new Date(NOW_MS + days * MS_PER_DAY).toISOString();
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    snapshot: () => ({ ...data }),
  };
}

const NEAR_GO_KSC = {
  id: 'near-go-ksc',
  status: 'Go',
  provider: 'SpaceX',
  launchSite: 'KSC',
  rocketName: 'Falcon 9',
  launchTime: isoDaysFromNow(-2),
};
const FAR_GO_KSC = {
  id: 'far-go-ksc',
  status: 'Go',
  provider: 'SpaceX',
  launchSite: 'KSC',
  rocketName: 'Falcon 9',
  launchTime: isoDaysFromNow(-20),
};
const NEAR_TBD_KSC = {
  id: 'near-tbd-ksc',
  status: 'TBD',
  provider: 'ULA',
  launchSite: 'KSC',
  rocketName: 'Atlas V',
  launchTime: isoDaysFromNow(-1),
};
const NEAR_GO_VAFB = {
  id: 'near-go-vafb',
  status: 'Go',
  provider: 'ULA',
  launchSite: 'VAFB',
  rocketName: 'Atlas V',
  launchTime: isoDaysFromNow(-3),
};
const MISSING_TIME = {
  id: 'missing-time',
  status: 'Go',
  provider: 'NASA',
  launchSite: 'KSC',
  launchTime: null,
};
const BAD_TIME = {
  id: 'bad-time',
  status: 'Hold',
  provider: 'NASA',
  launchSite: 'KSC',
  launchTime: 'not-a-date',
};
const ROSTER = [NEAR_GO_KSC, FAR_GO_KSC, NEAR_TBD_KSC, NEAR_GO_VAFB, MISSING_TIME, BAD_TIME];

test('30d matches the current 30-day roster', () => {
  assert.equal(DEFAULT_LAUNCH_TIME_WINDOW, '30d');
  assert.deepEqual(LAUNCH_TIME_WINDOW_CHIP_IDS, ['7d', '30d']);
  assert.deepEqual(LAUNCH_TIME_WINDOW_CHIP_LABELS, { '7d': '7d', '30d': '30d' });
  assert.equal(launchTimeWindowDays('30d'), 30);
  assert.equal(launchTimeWindowMs('30d'), 30 * MS_PER_DAY);
  const restored = filterLaunchesByTimeWindow(ROSTER, DEFAULT_LAUNCH_TIME_WINDOW, null, NOW_MS);
  assert.deepEqual(restored.map((row) => row.id), ROSTER.map((row) => row.id));
  assert.equal(normalizeLaunchTimeWindow(null), DEFAULT_LAUNCH_TIME_WINDOW);
  assert.equal(normalizeLaunchTimeWindow(''), DEFAULT_LAUNCH_TIME_WINDOW);
  assert.equal(normalizeLaunchTimeWindow('all'), DEFAULT_LAUNCH_TIME_WINDOW);
  assert.equal(normalizeLaunchTimeWindow('bogus'), DEFAULT_LAUNCH_TIME_WINDOW);
});

test('7d hides later missions and keeps nearer ones', () => {
  assert.equal(launchTimeWindowDays('7d'), 7);
  const visible = filterLaunchesByTimeWindow(ROSTER, '7d', null, NOW_MS);
  assert.deepEqual(visible.map((row) => row.id), [
    'near-go-ksc',
    'near-tbd-ksc',
    'near-go-vafb',
    'missing-time',
    'bad-time',
  ]);
  assert.equal(launchPassesTimeWindow(NEAR_GO_KSC, '7d', null, NOW_MS), true);
  assert.equal(launchPassesTimeWindow(FAR_GO_KSC, '7d', null, NOW_MS), false);
  assert.equal(launchPassesTimeWindow(FAR_GO_KSC, '30d', null, NOW_MS), true);
});

test('missing and non-finite launchTime stay visible', () => {
  assert.equal(launchPassesTimeWindow(MISSING_TIME, '7d', null, NOW_MS), true);
  assert.equal(launchPassesTimeWindow(BAD_TIME, '7d', null, NOW_MS), true);
  assert.equal(launchPassesTimeWindow({ id: 'empty', launchTime: '' }, '7d', null, NOW_MS), true);
});

test('selected mission stays when it is outside the 7d chip', () => {
  assert.equal(launchPassesTimeWindow(FAR_GO_KSC, '7d', 'far-go-ksc', NOW_MS), true);
  assert.equal(launchPassesTimeWindow(NEAR_TBD_KSC, '7d', 'far-go-ksc', NOW_MS), true);
  const visible = filterLaunchesByTimeWindow(ROSTER, '7d', 'far-go-ksc', NOW_MS);
  assert.ok(visible.some((row) => row.id === 'far-go-ksc'));
  assert.ok(visible.some((row) => row.id === 'near-go-ksc'));
});

test('Status Go + one site still ANDs with the 7d window', () => {
  const goOnly = filterLaunchesByStatus(ROSTER, { go: true });
  const kscOnly = goOnly.filter((row) => row.launchSite === 'KSC');
  const windowed = filterLaunchesByTimeWindow(kscOnly, '7d', null, NOW_MS);
  assert.deepEqual(windowed.map((row) => row.id), ['near-go-ksc', 'missing-time']);
});

test('Status Go + one provider still ANDs with the 7d window', () => {
  const goOnly = filterLaunchesByStatus(ROSTER, { go: true });
  const spaceXOnly = filterLaunchesByProvider(
    goOnly,
    normalizeLaunchProviderFilter({ SpaceX: true, ULA: false, NASA: false }, ['SpaceX', 'ULA', 'NASA']),
  );
  const windowed = filterLaunchesByTimeWindow(spaceXOnly, '7d', null, NOW_MS);
  assert.deepEqual(windowed.map((row) => row.id), ['near-go-ksc']);
});

test('Status Go + one provider + one rocket still ANDs with the 7d window', () => {
  const goOnly = filterLaunchesByStatus(ROSTER, { go: true });
  const spaceXOnly = filterLaunchesByProvider(
    goOnly,
    normalizeLaunchProviderFilter({ SpaceX: true, ULA: false, NASA: false }, ['SpaceX', 'ULA', 'NASA']),
  );
  const falconOnly = filterLaunchesByRocket(
    spaceXOnly,
    normalizeLaunchRocketFilter({ 'Falcon 9': true, 'Atlas V': false }, ['Atlas V', 'Falcon 9']),
  );
  const windowed = filterLaunchesByTimeWindow(falconOnly, '7d', null, NOW_MS);
  assert.deepEqual(windowed.map((row) => row.id), ['near-go-ksc']);
});

test('exclusive chips default to 30d', () => {
  assert.equal(normalizeLaunchTimeWindow('7d'), '7d');
  assert.equal(normalizeLaunchTimeWindow('30d'), '30d');
  assert.equal(setLaunchTimeWindow('7d', { persist: false }), '7d');
  assert.equal(getLaunchTimeWindow(), '7d');
  assert.equal(setLaunchTimeWindow('30d', { persist: false }), DEFAULT_LAUNCH_TIME_WINDOW);
  resetLaunchTimeWindowForTest();
  assert.equal(getLaunchTimeWindow(), DEFAULT_LAUNCH_TIME_WINDOW);
});

test('meridian.launchTimeWindow persists and reload keeps the choice', () => {
  resetLaunchTimeWindowForTest();
  const storage = memoryStorage();
  assert.equal(LAUNCH_TIME_WINDOW_STORAGE_KEY, 'meridian.launchTimeWindow');
  assert.equal(readLaunchTimeWindow(storage), DEFAULT_LAUNCH_TIME_WINDOW);
  assert.equal(setLaunchTimeWindow('7d', { storage }), '7d');
  assert.equal(storage.getItem(LAUNCH_TIME_WINDOW_STORAGE_KEY), '7d');
  assert.equal(getLaunchTimeWindow(), '7d');

  resetLaunchTimeWindowForTest();
  assert.equal(getLaunchTimeWindow(), DEFAULT_LAUNCH_TIME_WINDOW);
  assert.equal(hydrateLaunchTimeWindow(storage), '7d');
  assert.equal(getLaunchTimeWindow(), '7d');
  writeLaunchTimeWindow(DEFAULT_LAUNCH_TIME_WINDOW, storage);
  assert.equal(storage.getItem(LAUNCH_TIME_WINDOW_STORAGE_KEY), DEFAULT_LAUNCH_TIME_WINDOW);
  resetLaunchTimeWindowForTest();
});

test('time-window chips filter the existing Space Missions roster — not a new list or endpoint', () => {
  assert.match(indexHtml, /id="space-mission-roster"/);
  assert.match(indexHtml, /data-mission-window-chip="7d"/);
  assert.match(indexHtml, /data-mission-window-chip="30d"/);
  assert.match(indexHtml, /data-mission-status-chip="go"/);
  assert.match(indexHtml, /AVAILABLE MISSIONS/);
  assert.doesNotMatch(indexHtml, /data-mission-window-chip="7d"[\s\S]*launches-panel/);
  assert.match(rocketLaunchesSource, /filterLaunchesByTimeWindow|launchPassesTimeWindow/);
  assert.match(rocketLaunchesSource, /hydrateLaunchTimeWindow|subscribeLaunchTimeWindow|setLaunchTimeWindow/);
  assert.match(rocketLaunchesSource, /const WINDOW_DAYS = 30/);
  assert.equal((rocketLaunchesSource.match(/fetch\(/g) || []).length, 2);
  assert.match(rocketLaunchesSource, /const API_URL = '\/api\/launches'/);
  assert.match(rocketLaunchesSource, /fetch\('\/api\/celestrak\/active'\)/);
  assert.doesNotMatch(rocketLaunchesSource, /\/api\/launch-window|\/api\/launches\/window|\/api\/launch-time/);
  assert.doesNotMatch(launchesSource, /net__gte.*upcoming|status__ids/);
  assert.doesNotMatch(launchesPanelSource, /data-mission-window-chip|setLaunchTimeWindow/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /OpenStreetMap|Cesium|CC BY/);
  assert.equal(packageJson.name, 'meridian');
  assert.doesNotMatch(rocketLaunchesSource, /opensky-network\.org|google\.com\/news|telegeography|quantum-earth/i);
});

test('first-run missions do not write meridian.launchTimeWindow', () => {
  const code = firstRunSource.slice(firstRunSource.indexOf('export function shouldShowFirstRun'));
  assert.match(firstRunSource, /meridian\.launchTimeWindow/);
  for (const forbidden of ['setLaunchTimeWindow', 'writeLaunchTimeWindow', 'hydrateLaunchTimeWindow']) {
    assert.doesNotMatch(code, new RegExp(forbidden), `a mission must never touch ${forbidden}`);
  }
});
