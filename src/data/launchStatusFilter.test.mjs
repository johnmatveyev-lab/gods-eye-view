import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_LAUNCH_STATUS_FILTER,
  LAUNCH_STATUS_CHIP_IDS,
  LAUNCH_STATUS_CHIP_LABELS,
  LAUNCH_STATUS_FILTER_STORAGE_KEY,
  filterLaunchesByStatus,
  getLaunchStatusFilter,
  hydrateLaunchStatusFilter,
  launchPassesStatusFilter,
  launchStatusChipId,
  normalizeLaunchStatusFilter,
  readLaunchStatusFilter,
  resetLaunchStatusFilterForTest,
  setLaunchStatusFilter,
  toggleLaunchStatusFilter,
  writeLaunchStatusFilter,
} from './launchStatusFilter.js';

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

const GO = { id: 'go-1', status: 'Go', name: 'Go Mission' };
const TBD = { id: 'tbd-1', status: 'TBD', name: 'TBD Mission' };
const HOLD = { id: 'hold-1', status: 'Hold', name: 'Hold Mission' };
const FLIGHT = { id: 'fly-1', status: 'In Flight', name: 'In Flight Mission' };
const SUCCESS = { id: 'ok-1', status: 'Launch Successful', name: 'Success Mission' };
const ROSTER = [GO, TBD, HOLD, FLIGHT, SUCCESS];

test('Launch Library 2 status.name maps onto the five chips', () => {
  assert.equal(launchStatusChipId('Go'), 'go');
  assert.equal(launchStatusChipId('Go for Launch'), 'go');
  assert.equal(launchStatusChipId({ name: 'Go' }), 'go');
  assert.equal(launchStatusChipId('TBD'), 'tbd');
  assert.equal(launchStatusChipId('To Be Determined'), 'tbd');
  assert.equal(launchStatusChipId('Hold'), 'hold');
  assert.equal(launchStatusChipId('In Flight'), 'in-flight');
  assert.equal(launchStatusChipId('Launch Successful'), 'other');
  assert.equal(launchStatusChipId('TBC'), 'other');
  assert.equal(launchStatusChipId('Unknown'), 'other');
  assert.equal(launchStatusChipId(null), 'other');
});

test('Go-only hides TBD/Hold and leaves Go / In Flight out until those chips are on', () => {
  const goOnly = normalizeLaunchStatusFilter({ go: true });
  const visible = filterLaunchesByStatus(ROSTER, goOnly);
  assert.deepEqual(visible.map((row) => row.id), ['go-1']);
  assert.equal(visible.some((row) => row.status === 'TBD' || row.status === 'Hold'), false);
  assert.equal(launchPassesStatusFilter(GO, goOnly), true);
  assert.equal(launchPassesStatusFilter(TBD, goOnly), false);
  assert.equal(launchPassesStatusFilter(HOLD, goOnly), false);
  assert.equal(launchPassesStatusFilter(FLIGHT, goOnly), false);
});

test('all on restores the current roster', () => {
  const goOnly = filterLaunchesByStatus(ROSTER, { go: true });
  assert.equal(goOnly.length, 1);
  const restored = filterLaunchesByStatus(ROSTER, DEFAULT_LAUNCH_STATUS_FILTER);
  assert.deepEqual(restored.map((row) => row.id), ROSTER.map((row) => row.id));
  assert.equal(normalizeLaunchStatusFilter(null), DEFAULT_LAUNCH_STATUS_FILTER);
  assert.equal(normalizeLaunchStatusFilter('gthio'), DEFAULT_LAUNCH_STATUS_FILTER);
});

test('selected mission stays visible when its chip is off', () => {
  const goOnly = normalizeLaunchStatusFilter({ go: true });
  assert.equal(launchPassesStatusFilter(TBD, goOnly, 'tbd-1'), true);
  assert.equal(launchPassesStatusFilter(HOLD, goOnly, 'tbd-1'), false);
  const visible = filterLaunchesByStatus(ROSTER, goOnly, 'tbd-1');
  assert.deepEqual(visible.map((row) => row.id).sort(), ['go-1', 'tbd-1']);
});

test('toggle chips stay independent and default all on', () => {
  assert.deepEqual(LAUNCH_STATUS_CHIP_IDS, ['go', 'tbd', 'hold', 'in-flight', 'other']);
  assert.deepEqual(LAUNCH_STATUS_CHIP_LABELS, {
    go: 'Go',
    tbd: 'TBD',
    hold: 'Hold',
    'in-flight': 'In Flight',
    other: 'Other',
  });
  assert.equal(DEFAULT_LAUNCH_STATUS_FILTER, 'gthio');
  const withoutTbd = toggleLaunchStatusFilter(DEFAULT_LAUNCH_STATUS_FILTER, 'tbd');
  assert.equal(withoutTbd, 'ghio');
  assert.equal(toggleLaunchStatusFilter(withoutTbd, 'tbd'), DEFAULT_LAUNCH_STATUS_FILTER);
  assert.equal(toggleLaunchStatusFilter('g', 'go'), '0');
});

test('meridian.launchStatus persists and reload keeps the choice', () => {
  resetLaunchStatusFilterForTest();
  const storage = memoryStorage();
  assert.equal(LAUNCH_STATUS_FILTER_STORAGE_KEY, 'meridian.launchStatus');
  assert.equal(readLaunchStatusFilter(storage), DEFAULT_LAUNCH_STATUS_FILTER);
  assert.equal(setLaunchStatusFilter({ go: true }, { storage }), 'g');
  assert.equal(storage.getItem(LAUNCH_STATUS_FILTER_STORAGE_KEY), 'g');
  assert.equal(getLaunchStatusFilter(), 'g');

  resetLaunchStatusFilterForTest();
  assert.equal(getLaunchStatusFilter(), DEFAULT_LAUNCH_STATUS_FILTER);
  assert.equal(hydrateLaunchStatusFilter(storage), 'g');
  assert.equal(getLaunchStatusFilter(), 'g');
  writeLaunchStatusFilter(DEFAULT_LAUNCH_STATUS_FILTER, storage);
  assert.equal(storage.getItem(LAUNCH_STATUS_FILTER_STORAGE_KEY), DEFAULT_LAUNCH_STATUS_FILTER);
  resetLaunchStatusFilterForTest();
});

test('status chips filter the existing Space Missions roster — not a new list or endpoint', () => {
  assert.match(indexHtml, /id="space-mission-roster"/);
  assert.match(indexHtml, /data-mission-status-chip="go"/);
  assert.match(indexHtml, /data-mission-status-chip="tbd"/);
  assert.match(indexHtml, /data-mission-status-chip="hold"/);
  assert.match(indexHtml, /data-mission-status-chip="in-flight"/);
  assert.match(indexHtml, /data-mission-status-chip="other"/);
  assert.match(indexHtml, /AVAILABLE MISSIONS/);
  assert.doesNotMatch(indexHtml, /data-mission-status-chip="go"[\s\S]*launches-panel/);
  assert.match(rocketLaunchesSource, /filterLaunchesByStatus|launchPassesStatusFilter/);
  assert.match(rocketLaunchesSource, /hydrateLaunchStatusFilter|subscribeLaunchStatusFilter|setLaunchStatusFilter/);
  assert.match(rocketLaunchesSource, /status: launch\.status\?\.name/);
  assert.equal((rocketLaunchesSource.match(/fetch\(/g) || []).length, 2);
  assert.match(rocketLaunchesSource, /const API_URL = '\/api\/launches'/);
  assert.match(rocketLaunchesSource, /fetch\('\/api\/celestrak\/active'\)/);
  assert.doesNotMatch(rocketLaunchesSource, /\/api\/launch-status|\/api\/launches\/status/);
  assert.doesNotMatch(launchesSource, /net__gte.*upcoming|status__ids/);
  assert.doesNotMatch(launchesPanelSource, /data-mission-status-chip|setLaunchStatusFilter/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /OpenStreetMap|Cesium|CC BY/);
  assert.equal(packageJson.name, 'meridian');
  assert.doesNotMatch(rocketLaunchesSource, /opensky-network\.org|google\.com\/news|telegeography|quantum-earth/i);
});

test('first-run missions do not write meridian.launchStatus', () => {
  const code = firstRunSource.slice(firstRunSource.indexOf('export function shouldShowFirstRun'));
  assert.match(firstRunSource, /meridian\.launchStatus/);
  for (const forbidden of ['setLaunchStatusFilter', 'writeLaunchStatusFilter', 'hydrateLaunchStatusFilter']) {
    assert.doesNotMatch(code, new RegExp(forbidden), `a mission must never touch ${forbidden}`);
  }
});
