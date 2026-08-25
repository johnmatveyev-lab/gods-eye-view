import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_LAUNCH_WEBCAST_ONLY,
  LAUNCH_WEBCAST_ONLY_CHIP_LABEL,
  LAUNCH_WEBCAST_ONLY_STORAGE_KEY,
  filterLaunchesByWebcast,
  getLaunchWebcastOnly,
  hydrateLaunchWebcastOnly,
  launchPassesWebcastFilter,
  launchWebcastLiveFromPayload,
  normalizeLaunchWebcastOnly,
  readLaunchWebcastOnly,
  resetLaunchWebcastOnlyForTest,
  setLaunchWebcastOnly,
  writeLaunchWebcastOnly,
} from './launchWebcastFilter.js';
import { filterLaunchesByStatus } from './launchStatusFilter.js';
import { filterLaunchesByProvider, normalizeLaunchProviderFilter } from './launchProviderFilter.js';
import { filterLaunchesByRocket, normalizeLaunchRocketFilter } from './launchRocketFilter.js';
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

const LIVE = {
  id: 'live-1',
  status: 'Go',
  provider: 'SpaceX',
  launchSite: 'KSC',
  rocketName: 'Falcon 9',
  orbit: { name: 'LEO' },
  webcastLive: true,
  name: 'Starlink Webcast',
};
const URLS = {
  id: 'urls-1',
  status: 'Go',
  provider: 'ULA',
  launchSite: 'KSC',
  rocketName: 'Atlas V',
  orbit: { name: 'GTO' },
  webcast_live: false,
  vid_urls: [{ url: 'https://example.com/watch' }],
  name: 'Atlas Stream',
};
const MISSING = {
  id: 'missing-1',
  status: 'Go',
  provider: 'SpaceX',
  launchSite: 'VAFB',
  rocketName: 'Falcon 9',
  orbit: { name: 'LEO' },
  name: 'No Stream',
};
const FALSE_EMPTY = {
  id: 'false-1',
  status: 'TBD',
  provider: 'NASA',
  launchSite: 'KSC',
  rocketName: 'SLS',
  orbit: { name: 'LEO' },
  webcastLive: false,
  vid_urls: [],
  name: 'Silent',
};
const ROSTER = [LIVE, URLS, MISSING, FALSE_EMPTY];

test('webcastLive is true for webcast_live or a non-empty vid_urls list', () => {
  assert.equal(launchWebcastLiveFromPayload({ webcast_live: true }), true);
  assert.equal(launchWebcastLiveFromPayload({ webcast_live: false, vid_urls: [{ url: 'https://x' }] }), true);
  assert.equal(launchWebcastLiveFromPayload({ vidURLs: [{ url: 'https://legacy' }] }), true);
  assert.equal(launchWebcastLiveFromPayload({ webcastLive: true }), true);
  assert.equal(launchWebcastLiveFromPayload({ webcast_live: false, vid_urls: [] }), false);
  assert.equal(launchWebcastLiveFromPayload({ webcast_live: false }), false);
  assert.equal(launchWebcastLiveFromPayload({}), false);
  assert.equal(launchWebcastLiveFromPayload(null), false);
  assert.equal(LAUNCH_WEBCAST_ONLY_CHIP_LABEL, 'Webcast only');
});

test('off matches the current 30-day roster', () => {
  assert.equal(DEFAULT_LAUNCH_WEBCAST_ONLY, false);
  const restored = filterLaunchesByWebcast(ROSTER, DEFAULT_LAUNCH_WEBCAST_ONLY);
  assert.deepEqual(restored.map((row) => row.id), ROSTER.map((row) => row.id));
  assert.equal(normalizeLaunchWebcastOnly(null), DEFAULT_LAUNCH_WEBCAST_ONLY);
  assert.equal(normalizeLaunchWebcastOnly(''), DEFAULT_LAUNCH_WEBCAST_ONLY);
  assert.equal(normalizeLaunchWebcastOnly('bogus'), DEFAULT_LAUNCH_WEBCAST_ONLY);
  assert.equal(normalizeLaunchWebcastOnly(false), false);
  const rosterEntries = missionRosterEntries(ROSTER, { webcastOnly: false });
  assert.deepEqual(
    rosterEntries.map((entry) => entry.launch.id).sort(),
    ROSTER.map((row) => row.id).sort(),
  );
});

test('on keeps only webcastLive and hides missing or false', () => {
  const visible = filterLaunchesByWebcast(ROSTER, true);
  assert.deepEqual(visible.map((row) => row.id), ['live-1', 'urls-1']);
  assert.equal(launchPassesWebcastFilter(LIVE, true), true);
  assert.equal(launchPassesWebcastFilter(URLS, true), true);
  assert.equal(launchPassesWebcastFilter(MISSING, true), false);
  assert.equal(launchPassesWebcastFilter(FALSE_EMPTY, true), false);
  assert.equal(launchPassesWebcastFilter({ id: 'empty' }, true), false);
  assert.equal(launchPassesWebcastFilter({ id: 'flag-false', webcastLive: false }, true), false);
});

test('selected mission stays when it has no webcast', () => {
  assert.equal(launchPassesWebcastFilter(MISSING, true, 'missing-1'), true);
  assert.equal(launchPassesWebcastFilter(FALSE_EMPTY, true, 'missing-1'), false);
  const visible = filterLaunchesByWebcast(ROSTER, true, 'missing-1');
  assert.ok(visible.some((row) => row.id === 'missing-1'));
  assert.ok(visible.some((row) => row.id === 'live-1'));
  assert.ok(!visible.some((row) => row.id === 'false-1'));
  const roster = missionRosterEntries(ROSTER, {
    webcastOnly: true,
    selectedLaunchId: 'missing-1',
  });
  assert.ok(roster.some((entry) => entry.launch.id === 'missing-1'));
});

test('Status Go + one provider + one rocket still ANDs with Webcast only', () => {
  const goOnly = filterLaunchesByStatus(ROSTER, { go: true });
  const spaceXOnly = filterLaunchesByProvider(
    goOnly,
    normalizeLaunchProviderFilter({ SpaceX: true, ULA: false, NASA: false }, ['SpaceX', 'ULA', 'NASA']),
  );
  const falconOnly = filterLaunchesByRocket(
    spaceXOnly,
    normalizeLaunchRocketFilter({ 'Falcon 9': true, 'Atlas V': false, SLS: false }, ['Atlas V', 'Falcon 9', 'SLS']),
  );
  const windowed = filterLaunchesByWebcast(falconOnly, true);
  assert.deepEqual(windowed.map((row) => row.id), ['live-1']);
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
  });
  assert.deepEqual(roster.map((entry) => entry.launch.id), ['live-1']);
});

test('meridian.launchWebcastOnly persists and reload keeps the choice', () => {
  resetLaunchWebcastOnlyForTest();
  const storage = memoryStorage();
  assert.equal(LAUNCH_WEBCAST_ONLY_STORAGE_KEY, 'meridian.launchWebcastOnly');
  assert.equal(readLaunchWebcastOnly(storage), DEFAULT_LAUNCH_WEBCAST_ONLY);
  assert.equal(setLaunchWebcastOnly(true, { storage }), true);
  assert.equal(storage.getItem(LAUNCH_WEBCAST_ONLY_STORAGE_KEY), '1');
  assert.equal(getLaunchWebcastOnly(), true);

  resetLaunchWebcastOnlyForTest();
  assert.equal(getLaunchWebcastOnly(), DEFAULT_LAUNCH_WEBCAST_ONLY);
  assert.equal(hydrateLaunchWebcastOnly(storage), true);
  assert.equal(getLaunchWebcastOnly(), true);
  writeLaunchWebcastOnly(DEFAULT_LAUNCH_WEBCAST_ONLY, storage);
  assert.equal(storage.getItem(LAUNCH_WEBCAST_ONLY_STORAGE_KEY), '0');
  resetLaunchWebcastOnlyForTest();
});

test('Webcast only filters the existing Space Missions roster — not a new list or endpoint', () => {
  assert.match(indexHtml, /id="space-mission-roster"/);
  assert.match(indexHtml, /id="context-missions-view"[^>]*hidden/);
  assert.match(indexHtml, /data-mission-webcast-chip="only"/);
  assert.match(indexHtml, />Webcast only</);
  assert.match(indexHtml, /data-mission-status-chip="go"/);
  assert.match(indexHtml, /AVAILABLE MISSIONS/);
  assert.ok(
    indexHtml.indexOf('id="context-missions-view"') < indexHtml.indexOf('data-mission-webcast-chip'),
    'webcast toggle lives in the Space Missions view hidden when the launches layer is off',
  );
  assert.ok(
    indexHtml.indexOf('data-mission-window-chip="30d"') < indexHtml.indexOf('data-mission-webcast-chip'),
    'webcast toggle sits with the launch chip row',
  );
  assert.doesNotMatch(indexHtml, /space-mission-webcast-chips[\s\S]*launches-panel/);
  assert.match(rocketLaunchesSource, /filterLaunchesByWebcast|launchPassesWebcastFilter/);
  assert.match(rocketLaunchesSource, /hydrateLaunchWebcastOnly|subscribeLaunchWebcastOnly|setLaunchWebcastOnly/);
  assert.match(rocketLaunchesSource, /webcastLive:\s*launchWebcastLiveFromPayload\(launch\)/);
  assert.equal((rocketLaunchesSource.match(/fetch\(/g) || []).length, 2);
  assert.match(rocketLaunchesSource, /const API_URL = '\/api\/launches'/);
  assert.match(rocketLaunchesSource, /fetch\('\/api\/celestrak\/active'\)/);
  assert.match(rocketLaunchesSource, /const WINDOW_DAYS = 30/);
  assert.doesNotMatch(rocketLaunchesSource, /\/api\/launch-webcast|\/api\/launches\/webcast/);
  assert.doesNotMatch(launchesSource, /webcast_live|vid_urls|vidURLs/);
  assert.doesNotMatch(launchesPanelSource, /data-mission-webcast-chip|setLaunchWebcastOnly/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /OpenStreetMap|Cesium|CC BY/);
  assert.equal(packageJson.name, 'meridian');
  assert.match(readme, /Meridian is an \*\*independent commercial product\*\*/);
  assert.doesNotMatch(rocketLaunchesSource, /opensky-network\.org|google\.com\/news|telegeography|quantum-earth/i);
});

test('first-run missions do not write meridian.launchWebcastOnly', () => {
  const code = firstRunSource.slice(firstRunSource.indexOf('export function shouldShowFirstRun'));
  assert.match(firstRunSource, /meridian\.launchWebcastOnly/);
  for (const forbidden of ['setLaunchWebcastOnly', 'writeLaunchWebcastOnly', 'hydrateLaunchWebcastOnly']) {
    assert.doesNotMatch(code, new RegExp(forbidden), `a mission must never touch ${forbidden}`);
  }
});
