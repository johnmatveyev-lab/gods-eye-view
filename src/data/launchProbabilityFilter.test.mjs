import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_LAUNCH_PROBABILITY_FILTER,
  LAUNCH_PROBABILITY_CHIP_IDS,
  LAUNCH_PROBABILITY_CHIP_LABELS,
  LAUNCH_PROBABILITY_STORAGE_KEY,
  filterLaunchesByProbability,
  getLaunchProbabilityFilter,
  hydrateLaunchProbabilityFilter,
  launchPassesProbabilityFilter,
  launchProbabilityFloor,
  launchProbabilityFromPayload,
  normalizeLaunchProbabilityFilter,
  readLaunchProbabilityFilter,
  resetLaunchProbabilityFilterForTest,
  setLaunchProbabilityFilter,
  writeLaunchProbabilityFilter,
} from './launchProbabilityFilter.js';
import { filterLaunchesByStatus } from './launchStatusFilter.js';
import { filterLaunchesByProvider, normalizeLaunchProviderFilter } from './launchProviderFilter.js';
import { filterLaunchesByRocket, normalizeLaunchRocketFilter } from './launchRocketFilter.js';
import { filterLaunchesByWebcast } from './launchWebcastFilter.js';
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

const HIGH = {
  id: 'high-80',
  status: 'Go',
  provider: 'SpaceX',
  launchSite: 'KSC',
  rocketName: 'Falcon 9',
  orbit: { name: 'LEO' },
  webcastLive: true,
  probability: 80,
  name: 'High Confidence',
};
const MID = {
  id: 'mid-50',
  status: 'Go',
  provider: 'SpaceX',
  launchSite: 'KSC',
  rocketName: 'Falcon 9',
  orbit: { name: 'LEO' },
  webcastLive: true,
  probability: 50,
  name: 'Fifty Percent',
};
const LOW = {
  id: 'low-20',
  status: 'Go',
  provider: 'ULA',
  launchSite: 'KSC',
  rocketName: 'Atlas V',
  orbit: { name: 'GTO' },
  webcastLive: false,
  probability: 20,
  name: 'Low Confidence',
};
const JUST_UNDER_80 = {
  id: 'under-80',
  status: 'Go',
  provider: 'SpaceX',
  launchSite: 'VAFB',
  rocketName: 'Falcon 9',
  orbit: { name: 'LEO' },
  webcastLive: true,
  probability: 79,
  name: 'Just Under Eighty',
};
const MISSING = {
  id: 'missing-prob',
  status: 'Go',
  provider: 'NASA',
  launchSite: 'KSC',
  rocketName: 'SLS',
  orbit: { name: 'LEO' },
  webcastLive: true,
  name: 'Unknown Odds',
};
const NULL_PROB = {
  id: 'null-prob',
  status: 'TBD',
  provider: 'NASA',
  launchSite: 'KSC',
  rocketName: 'SLS',
  orbit: { name: 'LEO' },
  probability: null,
  name: 'Null Odds',
};
const BAD_PROB = {
  id: 'bad-prob',
  status: 'Hold',
  provider: 'NASA',
  launchSite: 'KSC',
  rocketName: 'SLS',
  orbit: { name: 'LEO' },
  probability: Number.NaN,
  name: 'NaN Odds',
};
const NEGATIVE = {
  id: 'neg-prob',
  status: 'Go',
  provider: 'NASA',
  launchSite: 'KSC',
  rocketName: 'SLS',
  orbit: { name: 'LEO' },
  probability: -1,
  name: 'Unknown Flag',
};
const ROSTER = [HIGH, MID, LOW, JUST_UNDER_80, MISSING, NULL_PROB, BAD_PROB, NEGATIVE];

test('All is the default probability floor and 50+ / 80+ are the shipped chips', () => {
  assert.equal(DEFAULT_LAUNCH_PROBABILITY_FILTER, 'all');
  assert.deepEqual(LAUNCH_PROBABILITY_CHIP_IDS, ['all', '50', '80']);
  assert.deepEqual(LAUNCH_PROBABILITY_CHIP_LABELS, { all: 'All', 50: '50+', 80: '80+' });
  assert.equal(launchProbabilityFloor('all'), null);
  assert.equal(launchProbabilityFloor('50'), 50);
  assert.equal(launchProbabilityFloor('80'), 80);
  assert.equal(normalizeLaunchProbabilityFilter(null), DEFAULT_LAUNCH_PROBABILITY_FILTER);
  assert.equal(normalizeLaunchProbabilityFilter(''), DEFAULT_LAUNCH_PROBABILITY_FILTER);
  assert.equal(normalizeLaunchProbabilityFilter('all'), 'all');
  assert.equal(normalizeLaunchProbabilityFilter('50+'), '50');
  assert.equal(normalizeLaunchProbabilityFilter(50), '50');
  assert.equal(normalizeLaunchProbabilityFilter('80+'), '80');
  assert.equal(normalizeLaunchProbabilityFilter(80), '80');
  assert.equal(normalizeLaunchProbabilityFilter('bogus'), DEFAULT_LAUNCH_PROBABILITY_FILTER);
  const restored = filterLaunchesByProbability(ROSTER, DEFAULT_LAUNCH_PROBABILITY_FILTER);
  assert.deepEqual(restored.map((row) => row.id), ROSTER.map((row) => row.id));
  const rosterEntries = missionRosterEntries(ROSTER, { probabilityFilter: 'all' });
  assert.deepEqual(
    rosterEntries.map((entry) => entry.launch.id).sort(),
    ROSTER.map((row) => row.id).sort(),
  );
});

test('50+ hides finite probability under 50; 80+ is stricter; missing stays', () => {
  assert.equal(launchProbabilityFromPayload({ probability: 49 }), 49);
  assert.equal(launchProbabilityFromPayload({ probability: 50 }), 50);
  assert.equal(launchProbabilityFromPayload({ probability: null }), null);
  assert.equal(launchProbabilityFromPayload({ probability: Number.NaN }), null);
  assert.equal(launchProbabilityFromPayload({ probability: -1 }), null);
  assert.equal(launchProbabilityFromPayload({ probability: 101 }), null);
  assert.equal(launchProbabilityFromPayload({}), null);
  assert.equal(launchPassesProbabilityFilter(LOW, 'all'), true);
  assert.equal(launchPassesProbabilityFilter(LOW, '50'), false);
  assert.equal(launchPassesProbabilityFilter(MID, '50'), true);
  assert.equal(launchPassesProbabilityFilter(JUST_UNDER_80, '50'), true);
  assert.equal(launchPassesProbabilityFilter(JUST_UNDER_80, '80'), false, '80+ is stricter than 50+');
  assert.equal(launchPassesProbabilityFilter(HIGH, '80'), true);
  assert.equal(launchPassesProbabilityFilter(MISSING, '80'), true);
  assert.equal(launchPassesProbabilityFilter(NULL_PROB, '50'), true);
  assert.equal(launchPassesProbabilityFilter(BAD_PROB, '80'), true);
  assert.equal(launchPassesProbabilityFilter(NEGATIVE, '50'), true);
  const fifty = filterLaunchesByProbability(ROSTER, '50').map((row) => row.id);
  assert.deepEqual(fifty, [
    'high-80',
    'mid-50',
    'under-80',
    'missing-prob',
    'null-prob',
    'bad-prob',
    'neg-prob',
  ]);
  assert.ok(!fifty.includes('low-20'));
  const eighty = filterLaunchesByProbability(ROSTER, '80').map((row) => row.id);
  assert.deepEqual(eighty, [
    'high-80',
    'missing-prob',
    'null-prob',
    'bad-prob',
    'neg-prob',
  ]);
  assert.ok(!eighty.includes('mid-50'));
  assert.ok(!eighty.includes('under-80'));
});

test('selected mission stays when its probability is below the floor', () => {
  assert.equal(launchPassesProbabilityFilter(LOW, '50', 'low-20'), true);
  assert.equal(launchPassesProbabilityFilter(MID, '80', 'low-20'), false);
  const visible = filterLaunchesByProbability(ROSTER, '80', 'low-20');
  assert.ok(visible.some((row) => row.id === 'low-20'));
  assert.ok(visible.some((row) => row.id === 'high-80'));
  assert.ok(!visible.some((row) => row.id === 'mid-50'));
  const roster = missionRosterEntries(ROSTER, {
    probabilityFilter: '80',
    selectedLaunchId: 'low-20',
  });
  assert.ok(roster.some((entry) => entry.launch.id === 'low-20'));
});

test('Status Go + one provider + one rocket + webcast still ANDs with 80+', () => {
  const goOnly = filterLaunchesByStatus(ROSTER, { go: true });
  const spaceXOnly = filterLaunchesByProvider(
    goOnly,
    normalizeLaunchProviderFilter({ SpaceX: true, ULA: false, NASA: false }, ['SpaceX', 'ULA', 'NASA']),
  );
  const falconOnly = filterLaunchesByRocket(
    spaceXOnly,
    normalizeLaunchRocketFilter(
      { 'Falcon 9': true, 'Atlas V': false, SLS: false },
      ['Atlas V', 'Falcon 9', 'SLS'],
    ),
  );
  const webcastOnly = filterLaunchesByWebcast(falconOnly, true);
  const floored = filterLaunchesByProbability(webcastOnly, '80');
  assert.deepEqual(floored.map((row) => row.id), ['high-80']);
  const roster = missionRosterEntries(ROSTER, {
    statusFilter: { go: true },
    providerFilter: normalizeLaunchProviderFilter(
      { SpaceX: true, ULA: false, NASA: false },
      ['SpaceX', 'ULA', 'NASA'],
    ),
    rocketFilter: normalizeLaunchRocketFilter(
      { 'Falcon 9': true, 'Atlas V': false, SLS: false },
      ['Atlas V', 'Falcon 9', 'SLS'],
    ),
    webcastOnly: true,
    probabilityFilter: '80',
  });
  assert.deepEqual(roster.map((entry) => entry.launch.id), ['high-80']);
});

test('meridian.launchProbability persists and reload keeps the choice', () => {
  resetLaunchProbabilityFilterForTest();
  const storage = memoryStorage();
  assert.equal(LAUNCH_PROBABILITY_STORAGE_KEY, 'meridian.launchProbability');
  assert.equal(readLaunchProbabilityFilter(storage), DEFAULT_LAUNCH_PROBABILITY_FILTER);
  assert.equal(setLaunchProbabilityFilter('50', { storage }), '50');
  assert.equal(storage.getItem(LAUNCH_PROBABILITY_STORAGE_KEY), '50');
  assert.equal(getLaunchProbabilityFilter(), '50');

  resetLaunchProbabilityFilterForTest();
  assert.equal(getLaunchProbabilityFilter(), DEFAULT_LAUNCH_PROBABILITY_FILTER);
  assert.equal(hydrateLaunchProbabilityFilter(storage), '50');
  assert.equal(getLaunchProbabilityFilter(), '50');
  writeLaunchProbabilityFilter(DEFAULT_LAUNCH_PROBABILITY_FILTER, storage);
  assert.equal(storage.getItem(LAUNCH_PROBABILITY_STORAGE_KEY), DEFAULT_LAUNCH_PROBABILITY_FILTER);
  resetLaunchProbabilityFilterForTest();
});

test('normalizeRocketLaunches keeps finite 0–100 probability and drops unknown', () => {
  const kept = normalizeRocketLaunches({ results: [{
    id: 'kept',
    name: 'GO Flight',
    net: '2026-07-20T10:00:00Z',
    pad: { latitude: '28.608', longitude: '-80.604', name: 'LC-39A' },
    probability: 70,
  }] }, NOW);
  assert.equal(kept[0].probability, 70);

  const zero = normalizeRocketLaunches({ results: [{
    id: 'zero',
    name: 'Zero Flight',
    net: '2026-07-20T10:00:00Z',
    pad: { latitude: '28.608', longitude: '-80.604', name: 'LC-39A' },
    probability: 0,
  }] }, NOW);
  assert.equal(zero[0].probability, 0);

  const unknown = normalizeRocketLaunches({ results: [{
    id: 'unknown',
    name: 'Unknown Flight',
    net: '2026-07-20T10:00:00Z',
    pad: { latitude: '28.608', longitude: '-80.604', name: 'LC-39A' },
    probability: -1,
  }] }, NOW);
  assert.equal(unknown[0].probability, null);

  const missing = normalizeRocketLaunches({ results: [{
    id: 'missing',
    name: 'Silent Flight',
    net: '2026-07-20T10:00:00Z',
    pad: { latitude: '28.608', longitude: '-80.604', name: 'LC-39A' },
  }] }, NOW);
  assert.equal(missing[0].probability, null);

  const over = normalizeRocketLaunches({ results: [{
    id: 'over',
    name: 'Over Flight',
    net: '2026-07-20T10:00:00Z',
    pad: { latitude: '28.608', longitude: '-80.604', name: 'LC-39A' },
    probability: 150,
  }] }, NOW);
  assert.equal(over[0].probability, null);
});

test('probability chips filter the existing Space Missions roster — not a new list or endpoint', () => {
  assert.match(indexHtml, /id="space-mission-roster"/);
  assert.match(indexHtml, /id="context-missions-view"[^>]*hidden/);
  assert.match(indexHtml, /data-mission-probability-chip="all"/);
  assert.match(indexHtml, /data-mission-probability-chip="50"/);
  assert.match(indexHtml, /data-mission-probability-chip="80"/);
  assert.match(indexHtml, />All</);
  assert.match(indexHtml, />50\+</);
  assert.match(indexHtml, />80\+</);
  assert.match(indexHtml, /data-mission-status-chip="go"/);
  assert.match(indexHtml, /AVAILABLE MISSIONS/);
  assert.ok(
    indexHtml.indexOf('id="context-missions-view"') < indexHtml.indexOf('data-mission-probability-chip'),
    'probability chips live in the Space Missions view hidden when the launches layer is off',
  );
  assert.ok(
    indexHtml.indexOf('data-mission-webcast-chip') < indexHtml.indexOf('data-mission-probability-chip'),
    'probability chips sit with the launch chip row',
  );
  assert.doesNotMatch(indexHtml, /space-mission-probability-chips[\s\S]*launches-panel/);
  assert.match(rocketLaunchesSource, /filterLaunchesByProbability|launchPassesProbabilityFilter/);
  assert.match(rocketLaunchesSource, /hydrateLaunchProbabilityFilter|subscribeLaunchProbabilityFilter|setLaunchProbabilityFilter/);
  assert.match(rocketLaunchesSource, /probability:\s*launchProbabilityFromPayload\(launch\)/);
  assert.equal((rocketLaunchesSource.match(/fetch\(/g) || []).length, 2);
  assert.match(rocketLaunchesSource, /const API_URL = '\/api\/launches'/);
  assert.match(rocketLaunchesSource, /fetch\('\/api\/celestrak\/active'\)/);
  assert.match(rocketLaunchesSource, /const WINDOW_DAYS = 30/);
  assert.doesNotMatch(rocketLaunchesSource, /\/api\/launch-probability|\/api\/launches\/probability/);
  assert.doesNotMatch(launchesSource, /probability/);
  assert.doesNotMatch(launchesPanelSource, /data-mission-probability-chip|setLaunchProbabilityFilter/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /OpenStreetMap|Cesium|CC BY/);
  assert.equal(packageJson.name, 'meridian');
  assert.match(readme, /Meridian is an \*\*independent commercial product\*\*/);
  assert.doesNotMatch(rocketLaunchesSource, /opensky-network\.org|google\.com\/news|telegeography|quantum-earth/i);
});

test('first-run missions do not write meridian.launchProbability', () => {
  const code = firstRunSource.slice(firstRunSource.indexOf('export function shouldShowFirstRun'));
  assert.match(firstRunSource, /meridian\.launchProbability/);
  for (const forbidden of [
    'setLaunchProbabilityFilter',
    'writeLaunchProbabilityFilter',
    'hydrateLaunchProbabilityFilter',
  ]) {
    assert.doesNotMatch(code, new RegExp(forbidden), `a mission must never touch ${forbidden}`);
  }
});
