import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_LAUNCH_HIDE_UNKNOWN_SITE,
  LAUNCH_HIDE_UNKNOWN_SITE_CHIP_LABEL,
  LAUNCH_HIDE_UNKNOWN_SITE_STORAGE_KEY,
  UNKNOWN_LAUNCH_SITE_LABEL,
  filterLaunchesByUnknownSite,
  getLaunchHideUnknownSite,
  hydrateLaunchHideUnknownSite,
  isUnknownLaunchSite,
  launchPassesUnknownSiteFilter,
  normalizeLaunchHideUnknownSite,
  readLaunchHideUnknownSite,
  resetLaunchHideUnknownSiteForTest,
  setLaunchHideUnknownSite,
  writeLaunchHideUnknownSite,
} from './launchUnknownSiteFilter.js';
import { filterLaunchesByStatus } from './launchStatusFilter.js';
import { filterLaunchesByProvider, normalizeLaunchProviderFilter } from './launchProviderFilter.js';
import { filterLaunchesByRocket, normalizeLaunchRocketFilter } from './launchRocketFilter.js';
import { filterLaunchesByWebcast } from './launchWebcastFilter.js';
import { filterLaunchesByProbability } from './launchProbabilityFilter.js';
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

const NAMED = {
  id: 'named-1',
  status: 'Go',
  provider: 'SpaceX',
  launchSite: 'Space Launch Complex 4E',
  rocketName: 'Falcon 9',
  orbit: { name: 'LEO' },
  webcastLive: true,
  probability: 90,
  name: 'Named Pad',
};
const FALLBACK = {
  id: 'unknown-1',
  status: 'Go',
  provider: 'SpaceX',
  launchSite: 'Unknown launch site',
  rocketName: 'Falcon 9',
  orbit: { name: 'LEO' },
  webcastLive: true,
  probability: 80,
  name: 'Fallback Site',
};
const MISSING = {
  id: 'missing-1',
  status: 'Go',
  provider: 'ULA',
  rocketName: 'Atlas V',
  orbit: { name: 'GTO' },
  webcastLive: true,
  probability: 70,
  name: 'No Site',
};
const BLANK = {
  id: 'blank-1',
  status: 'Go',
  provider: 'SpaceX',
  launchSite: '',
  rocketName: 'Falcon 9',
  orbit: { name: 'LEO' },
  webcastLive: false,
  probability: 60,
  name: 'Blank Site',
};
const WHITESPACE = {
  id: 'space-1',
  status: 'TBD',
  provider: 'NASA',
  launchSite: '   ',
  rocketName: 'SLS',
  orbit: { name: 'LEO' },
  webcastLive: true,
  probability: 50,
  name: 'Whitespace Site',
};
const CASING = {
  id: 'case-1',
  status: 'Go',
  provider: 'NASA',
  launchSite: ' unknown launch site ',
  rocketName: 'SLS',
  orbit: { name: 'LEO' },
  webcastLive: true,
  probability: 40,
  name: 'Cased Fallback',
};
const ROSTER = [NAMED, FALLBACK, MISSING, BLANK, WHITESPACE, CASING];

test('Hide unknown site defaults off and treats the roster fallback as unlabeled', () => {
  assert.equal(DEFAULT_LAUNCH_HIDE_UNKNOWN_SITE, false);
  assert.equal(LAUNCH_HIDE_UNKNOWN_SITE_CHIP_LABEL, 'Hide unknown site');
  assert.equal(UNKNOWN_LAUNCH_SITE_LABEL, 'Unknown launch site');
  assert.equal(isUnknownLaunchSite('Space Launch Complex 4E'), false);
  assert.equal(isUnknownLaunchSite('LC-39A'), false);
  assert.equal(isUnknownLaunchSite('Unknown launch site'), true);
  assert.equal(isUnknownLaunchSite(' unknown launch site '), true);
  assert.equal(isUnknownLaunchSite('UNKNOWN LAUNCH SITE'), true);
  assert.equal(isUnknownLaunchSite(''), true);
  assert.equal(isUnknownLaunchSite('   '), true);
  assert.equal(isUnknownLaunchSite(null), true);
  assert.equal(isUnknownLaunchSite(undefined), true);
  assert.equal(isUnknownLaunchSite({ launchSite: 'Unknown launch site' }), true);
  assert.equal(isUnknownLaunchSite({ launchSite: 'Vandenberg' }), false);
  assert.equal(normalizeLaunchHideUnknownSite(null), DEFAULT_LAUNCH_HIDE_UNKNOWN_SITE);
  assert.equal(normalizeLaunchHideUnknownSite(''), DEFAULT_LAUNCH_HIDE_UNKNOWN_SITE);
  assert.equal(normalizeLaunchHideUnknownSite('bogus'), DEFAULT_LAUNCH_HIDE_UNKNOWN_SITE);
  assert.equal(normalizeLaunchHideUnknownSite(false), false);
  assert.equal(normalizeLaunchHideUnknownSite(true), true);
  assert.equal(normalizeLaunchHideUnknownSite('1'), true);
});

test('off matches the current 30-day roster', () => {
  const restored = filterLaunchesByUnknownSite(ROSTER, DEFAULT_LAUNCH_HIDE_UNKNOWN_SITE);
  assert.deepEqual(restored.map((row) => row.id), ROSTER.map((row) => row.id));
  const rosterEntries = missionRosterEntries(ROSTER, { hideUnknownSite: false });
  assert.deepEqual(
    rosterEntries.map((entry) => entry.launch.id).sort(),
    ROSTER.map((row) => row.id).sort(),
  );
});

test('on hides unknown-site missions and keeps named pads', () => {
  const visible = filterLaunchesByUnknownSite(ROSTER, true);
  assert.deepEqual(visible.map((row) => row.id), ['named-1']);
  assert.equal(launchPassesUnknownSiteFilter(NAMED, true), true);
  assert.equal(launchPassesUnknownSiteFilter(FALLBACK, true), false);
  assert.equal(launchPassesUnknownSiteFilter(MISSING, true), false);
  assert.equal(launchPassesUnknownSiteFilter(BLANK, true), false);
  assert.equal(launchPassesUnknownSiteFilter(WHITESPACE, true), false);
  assert.equal(launchPassesUnknownSiteFilter(CASING, true), false);
  assert.equal(launchPassesUnknownSiteFilter({ id: 'empty' }, true), false);
});

test('selected unknown-site mission stays', () => {
  assert.equal(launchPassesUnknownSiteFilter(FALLBACK, true, 'unknown-1'), true);
  assert.equal(launchPassesUnknownSiteFilter(MISSING, true, 'unknown-1'), false);
  const visible = filterLaunchesByUnknownSite(ROSTER, true, 'unknown-1');
  assert.ok(visible.some((row) => row.id === 'unknown-1'));
  assert.ok(visible.some((row) => row.id === 'named-1'));
  assert.ok(!visible.some((row) => row.id === 'blank-1'));
  const roster = missionRosterEntries(ROSTER, {
    hideUnknownSite: true,
    selectedLaunchId: 'unknown-1',
  });
  assert.ok(roster.some((entry) => entry.launch.id === 'unknown-1'));
});

test('Status Go + one provider + one rocket + webcast + 80+ still ANDs with Hide unknown site', () => {
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
  const hidden = filterLaunchesByUnknownSite(floored, true);
  assert.deepEqual(hidden.map((row) => row.id), ['named-1']);
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
    hideUnknownSite: true,
  });
  assert.deepEqual(roster.map((entry) => entry.launch.id), ['named-1']);
});

test('meridian.launchHideUnknownSite persists and reload keeps the choice', () => {
  resetLaunchHideUnknownSiteForTest();
  const storage = memoryStorage();
  assert.equal(LAUNCH_HIDE_UNKNOWN_SITE_STORAGE_KEY, 'meridian.launchHideUnknownSite');
  assert.equal(readLaunchHideUnknownSite(storage), DEFAULT_LAUNCH_HIDE_UNKNOWN_SITE);
  assert.equal(setLaunchHideUnknownSite(true, { storage }), true);
  assert.equal(storage.getItem(LAUNCH_HIDE_UNKNOWN_SITE_STORAGE_KEY), '1');
  assert.equal(getLaunchHideUnknownSite(), true);

  resetLaunchHideUnknownSiteForTest();
  assert.equal(getLaunchHideUnknownSite(), DEFAULT_LAUNCH_HIDE_UNKNOWN_SITE);
  assert.equal(hydrateLaunchHideUnknownSite(storage), true);
  assert.equal(getLaunchHideUnknownSite(), true);
  writeLaunchHideUnknownSite(DEFAULT_LAUNCH_HIDE_UNKNOWN_SITE, storage);
  assert.equal(storage.getItem(LAUNCH_HIDE_UNKNOWN_SITE_STORAGE_KEY), '0');
  resetLaunchHideUnknownSiteForTest();
});

test('normalizeRocketLaunches keeps named pads and the Unknown launch site fallback', () => {
  const named = normalizeRocketLaunches({ results: [{
    id: 'named',
    name: 'GO Flight',
    net: '2026-07-20T10:00:00Z',
    pad: { latitude: '28.608', longitude: '-80.604', name: 'LC-39A' },
  }] }, NOW);
  assert.equal(named[0].launchSite, 'LC-39A');

  const fromLocation = normalizeRocketLaunches({ results: [{
    id: 'loc',
    name: 'Location Flight',
    net: '2026-07-20T10:00:00Z',
    pad: { latitude: '34.632', longitude: '-120.611', location: { name: 'Vandenberg' } },
  }] }, NOW);
  assert.equal(fromLocation[0].launchSite, 'Vandenberg');

  const fallback = normalizeRocketLaunches({ results: [{
    id: 'unknown',
    name: 'Unknown Flight',
    net: '2026-07-20T10:00:00Z',
    pad: { latitude: '28.608', longitude: '-80.604' },
  }] }, NOW);
  assert.equal(fallback[0].launchSite, UNKNOWN_LAUNCH_SITE_LABEL);

  const emptyName = normalizeRocketLaunches({ results: [{
    id: 'empty',
    name: 'Empty Pad',
    net: '2026-07-20T10:00:00Z',
    pad: { latitude: '28.608', longitude: '-80.604', name: '' },
  }] }, NOW);
  assert.equal(emptyName[0].launchSite, UNKNOWN_LAUNCH_SITE_LABEL);
});

test('Hide unknown site filters the existing Space Missions roster — not a new list or endpoint', () => {
  assert.match(indexHtml, /id="space-mission-roster"/);
  assert.match(indexHtml, /id="context-missions-view"[^>]*hidden/);
  assert.match(indexHtml, /data-mission-unknown-site-chip="hide"/);
  assert.match(indexHtml, />Hide unknown site</);
  assert.match(indexHtml, /data-mission-status-chip="go"/);
  assert.match(indexHtml, /AVAILABLE MISSIONS/);
  assert.ok(
    indexHtml.indexOf('id="context-missions-view"') < indexHtml.indexOf('data-mission-unknown-site-chip'),
    'unknown-site toggle lives in the Space Missions view hidden when the launches layer is off',
  );
  assert.ok(
    indexHtml.indexOf('data-mission-probability-chip') < indexHtml.indexOf('data-mission-unknown-site-chip'),
    'unknown-site toggle sits with the launch chip row',
  );
  assert.doesNotMatch(indexHtml, /space-mission-unknown-site-chips[\s\S]*launches-panel/);
  assert.match(rocketLaunchesSource, /filterLaunchesByUnknownSite|launchPassesUnknownSiteFilter/);
  assert.match(rocketLaunchesSource, /hydrateLaunchHideUnknownSite|subscribeLaunchHideUnknownSite|setLaunchHideUnknownSite/);
  assert.match(rocketLaunchesSource, /launchSite:\s*pad\.name \|\| location\.name \|\| 'Unknown launch site'/);
  assert.equal((rocketLaunchesSource.match(/fetch\(/g) || []).length, 2);
  assert.match(rocketLaunchesSource, /const API_URL = '\/api\/launches'/);
  assert.match(rocketLaunchesSource, /fetch\('\/api\/celestrak\/active'\)/);
  assert.match(rocketLaunchesSource, /const WINDOW_DAYS = 30/);
  assert.doesNotMatch(rocketLaunchesSource, /\/api\/launch-unknown-site|\/api\/launches\/unknown-site/);
  assert.doesNotMatch(launchesSource, /Unknown launch site|hideUnknownSite/);
  assert.doesNotMatch(launchesPanelSource, /data-mission-unknown-site-chip|setLaunchHideUnknownSite/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /OpenStreetMap|Cesium|CC BY/);
  assert.equal(packageJson.name, 'meridian');
  assert.match(readme, /Meridian is an \*\*independent commercial product\*\*/);
  assert.doesNotMatch(rocketLaunchesSource, /opensky-network\.org|google\.com\/news|telegeography|quantum-earth/i);
});

test('first-run missions do not write meridian.launchHideUnknownSite', () => {
  const code = firstRunSource.slice(firstRunSource.indexOf('export function shouldShowFirstRun'));
  assert.match(firstRunSource, /meridian\.launchHideUnknownSite/);
  for (const forbidden of [
    'setLaunchHideUnknownSite',
    'writeLaunchHideUnknownSite',
    'hydrateLaunchHideUnknownSite',
  ]) {
    assert.doesNotMatch(code, new RegExp(forbidden), `a mission must never touch ${forbidden}`);
  }
});
