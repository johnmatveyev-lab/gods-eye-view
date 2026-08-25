import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_LAUNCH_SITE_FILTER,
  LAUNCH_SITE_FILTER_STORAGE_KEY,
  LAUNCH_SITE_OTHER_CHIP_ID,
  compactLaunchSiteName,
  filterLaunchesBySite,
  getLaunchSiteFilter,
  hydrateLaunchSiteFilter,
  launchPassesSiteFilter,
  launchSiteChipId,
  launchSiteChipIdsFromLaunches,
  launchSiteChipLabel,
  normalizeLaunchSiteFilter,
  readLaunchSiteFilter,
  resetLaunchSiteFilterForTest,
  setLaunchSiteFilter,
  toggleLaunchSiteFilter,
  writeLaunchSiteFilter,
} from './launchSiteFilter.js';
import {
  filterLaunchesByStatus,
  launchPassesStatusFilter,
} from './launchStatusFilter.js';
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

const SLC4E = {
  id: 'vandy',
  status: 'Go',
  provider: 'SpaceX',
  orbit: { name: 'LEO' },
  launchSite: 'Space Launch Complex 4E',
  name: 'Vandenberg Mission',
};
const SLC39A = {
  id: 'cape',
  status: 'Go',
  provider: 'SpaceX',
  orbit: { name: 'LEO' },
  launchSite: 'Space Launch Complex 39A',
  name: 'Kennedy Mission',
};
const AREA130 = {
  id: 'jslc',
  status: 'TBD',
  provider: 'CASC',
  orbit: { name: 'SSO' },
  launchSite: 'Launch Area 130',
  name: 'Jiuquan Mission',
};
const UNKNOWN = {
  id: 'blank',
  status: 'Go',
  provider: 'ULA',
  orbit: { name: 'GTO' },
  launchSite: 'Unknown launch site',
  name: 'Unknown Site Mission',
};
const MISSING = {
  id: 'missing',
  status: 'Hold',
  provider: 'Rocket Lab',
  orbit: null,
  launchSite: '',
  name: 'Missing Site Mission',
};
const ROSTER = [SLC4E, SLC39A, AREA130, UNKNOWN, MISSING];
const SITE_CHIPS = ['130', '39A', '4E', 'other'];

function isLeo(launch) {
  const text = String(launch?.orbit?.name || launch?.orbit || '').toLowerCase();
  return /\bleo\b/.test(text) || text.includes('low earth') || text.includes('low-earth');
}

test('compactLaunchSiteName and blank/unknown map onto derived chips plus Other', () => {
  assert.equal(compactLaunchSiteName('Orbital Launch Pad 2'), '2');
  assert.equal(compactLaunchSiteName('Space Launch Complex 4E'), '4E');
  assert.equal(compactLaunchSiteName('Launch Area 130'), '130');
  assert.equal(compactLaunchSiteName('Unknown'), null);
  assert.equal(launchSiteChipId('Space Launch Complex 4E'), '4E');
  assert.equal(launchSiteChipId({ launchSite: 'Space Launch Complex 39A' }), '39A');
  assert.equal(launchSiteChipId({ name: 'Launch Area 130' }), '130');
  assert.equal(launchSiteChipId('Unknown'), 'other');
  assert.equal(launchSiteChipId('Unknown launch site'), 'other');
  assert.equal(launchSiteChipId(''), 'other');
  assert.equal(launchSiteChipId(null), 'other');
  assert.equal(LAUNCH_SITE_OTHER_CHIP_ID, 'other');
  assert.equal(launchSiteChipLabel('4E'), '4E');
  assert.equal(launchSiteChipLabel('other'), 'Other');
  assert.deepEqual(launchSiteChipIdsFromLaunches(ROSTER), SITE_CHIPS);
});

test('all on matches the current 30-day roster', () => {
  const visible = filterLaunchesBySite(ROSTER, DEFAULT_LAUNCH_SITE_FILTER);
  assert.deepEqual(visible.map((row) => row.id), ROSTER.map((row) => row.id));
  const rosterEntries = missionRosterEntries(ROSTER);
  assert.deepEqual(
    rosterEntries.map((entry) => entry.launch.id).sort(),
    ROSTER.map((row) => row.id).sort(),
  );
  assert.equal(normalizeLaunchSiteFilter(null), DEFAULT_LAUNCH_SITE_FILTER);
  assert.equal(normalizeLaunchSiteFilter('all'), DEFAULT_LAUNCH_SITE_FILTER);
  assert.equal(DEFAULT_LAUNCH_SITE_FILTER, 'all');
});

test('turning one site off hides its pads/rows and keeps others', () => {
  const without4E = normalizeLaunchSiteFilter({
    '4E': false,
    '39A': true,
    130: true,
    other: true,
  }, SITE_CHIPS);
  const visible = filterLaunchesBySite(ROSTER, without4E);
  assert.deepEqual(visible.map((row) => row.id), ['cape', 'jslc', 'blank', 'missing']);
  assert.equal(launchPassesSiteFilter(SLC4E, without4E), false);
  assert.equal(launchPassesSiteFilter(SLC39A, without4E), true);
  assert.equal(launchPassesSiteFilter(UNKNOWN, without4E), true);
  const roster = missionRosterEntries(ROSTER, { siteFilter: without4E });
  assert.equal(roster.some((entry) => entry.launch.id === 'vandy'), false);
  assert.equal(roster.some((entry) => entry.launch.id === 'cape'), true);
});

test('selected mission stays visible when its site chip is off', () => {
  const capeOnly = normalizeLaunchSiteFilter({ '39A': true });
  assert.equal(launchPassesSiteFilter(SLC4E, capeOnly, 'vandy'), true);
  assert.equal(launchPassesSiteFilter(AREA130, capeOnly, 'vandy'), false);
  const visible = filterLaunchesBySite(ROSTER, capeOnly, 'vandy');
  assert.deepEqual(visible.map((row) => row.id).sort(), ['cape', 'vandy']);
  const roster = missionRosterEntries(ROSTER, {
    siteFilter: capeOnly,
    selectedLaunchId: 'vandy',
  });
  assert.deepEqual(roster.map((entry) => entry.launch.id).sort(), ['cape', 'vandy']);
});

test('Status Go + one provider + LEO + one site still AND', () => {
  const mixed = [
    { id: 'keep', status: 'Go', provider: 'SpaceX', orbit: { name: 'LEO' }, launchSite: 'Space Launch Complex 4E' },
    { id: 'geo', status: 'Go', provider: 'SpaceX', orbit: { name: 'GTO' }, launchSite: 'Space Launch Complex 4E' },
    { id: 'tbd', status: 'TBD', provider: 'SpaceX', orbit: { name: 'LEO' }, launchSite: 'Space Launch Complex 4E' },
    { id: 'ula', status: 'Go', provider: 'ULA', orbit: { name: 'LEO' }, launchSite: 'Space Launch Complex 4E' },
    { id: 'cape', status: 'Go', provider: 'SpaceX', orbit: { name: 'LEO' }, launchSite: 'Space Launch Complex 39A' },
  ];
  const goOnly = filterLaunchesByStatus(mixed, { go: true });
  const goLeo = goOnly.filter((launch) => isLeo(launch));
  const goLeoProvider = goLeo.filter((launch) => launch.provider === 'SpaceX');
  const andSite = filterLaunchesBySite(goLeoProvider, { '4E': true });
  assert.deepEqual(andSite.map((row) => row.id), ['keep']);
  assert.equal(launchPassesStatusFilter(mixed[0], { go: true }), true);
  assert.equal(isLeo(mixed[0]), true);
  assert.equal(isLeo(mixed[1]), false);
  assert.equal(launchPassesStatusFilter(mixed[2], { go: true }), false);
  assert.equal(launchPassesSiteFilter(mixed[4], { '4E': true }), false);

  const spaceXOnly = normalizeLaunchProviderFilter({
    SpaceX: true,
    ULA: false,
  }, ['SpaceX', 'ULA']);
  const roster = missionRosterEntries(mixed, {
    statusFilter: { go: true },
    providerFilter: spaceXOnly,
    orbitFilter: { leo: true },
    siteFilter: { '4E': true },
  });
  assert.deepEqual(roster.map((entry) => entry.launch.id), ['keep']);
});

test('toggle chips stay independent and default all on', () => {
  const without4E = toggleLaunchSiteFilter(DEFAULT_LAUNCH_SITE_FILTER, '4E', SITE_CHIPS);
  assert.equal(without4E, '-4E');
  assert.equal(toggleLaunchSiteFilter(without4E, '4E', SITE_CHIPS), DEFAULT_LAUNCH_SITE_FILTER);
  assert.equal(toggleLaunchSiteFilter('+4E', '4E', ['4E']), '0');
  assert.equal(normalizeLaunchSiteFilter({ '4E': true }), '+4E');
});

test('meridian.launchSite persists and reload keeps the choice', () => {
  resetLaunchSiteFilterForTest();
  const storage = memoryStorage();
  assert.equal(LAUNCH_SITE_FILTER_STORAGE_KEY, 'meridian.launchSite');
  assert.equal(readLaunchSiteFilter(storage), DEFAULT_LAUNCH_SITE_FILTER);
  assert.equal(setLaunchSiteFilter({ '4E': true }, { storage }), '+4E');
  assert.equal(storage.getItem(LAUNCH_SITE_FILTER_STORAGE_KEY), '+4E');
  assert.equal(getLaunchSiteFilter(), '+4E');

  resetLaunchSiteFilterForTest();
  assert.equal(getLaunchSiteFilter(), DEFAULT_LAUNCH_SITE_FILTER);
  assert.equal(hydrateLaunchSiteFilter(storage), '+4E');
  assert.equal(getLaunchSiteFilter(), '+4E');
  writeLaunchSiteFilter(DEFAULT_LAUNCH_SITE_FILTER, storage);
  assert.equal(storage.getItem(LAUNCH_SITE_FILTER_STORAGE_KEY), DEFAULT_LAUNCH_SITE_FILTER);
  resetLaunchSiteFilterForTest();
});

test('site chips filter the existing Space Missions roster — not a new list or endpoint', () => {
  assert.match(indexHtml, /id="space-mission-roster"/);
  assert.match(indexHtml, /data-mission-status-chip="go"/);
  assert.match(indexHtml, /data-mission-provider-chips/);
  assert.match(indexHtml, /data-mission-site-chips/);
  assert.match(indexHtml, /aria-label="Launch site filters"/);
  assert.match(indexHtml, /AVAILABLE MISSIONS/);
  assert.ok(
    indexHtml.indexOf('data-mission-provider-chips') < indexHtml.indexOf('data-mission-site-chips'),
    'site chips sit next to provider chips on the roster',
  );
  assert.doesNotMatch(indexHtml, /data-mission-site-chips[\s\S]*launches-panel/);
  assert.match(rocketLaunchesSource, /launchPassesSiteFilter|filterLaunchesBySite/);
  assert.match(rocketLaunchesSource, /launchPassesStatusFilter/);
  assert.match(rocketLaunchesSource, /hydrateLaunchSiteFilter|subscribeLaunchSiteFilter|setLaunchSiteFilter/);
  assert.match(rocketLaunchesSource, /compactLaunchSiteName\(launch\.launchSite\)|launchSiteChipId/);
  assert.equal((rocketLaunchesSource.match(/fetch\(/g) || []).length, 2);
  assert.match(rocketLaunchesSource, /const API_URL = '\/api\/launches'/);
  assert.match(rocketLaunchesSource, /fetch\('\/api\/celestrak\/active'\)/);
  assert.doesNotMatch(rocketLaunchesSource, /\/api\/launch-site|\/api\/launches\/site/);
  assert.doesNotMatch(launchesSource, /pad__name|location__ids/);
  assert.doesNotMatch(launchesPanelSource, /data-mission-site-chip|setLaunchSiteFilter/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /OpenStreetMap|Cesium|CC BY/);
  assert.equal(packageJson.name, 'meridian');
  assert.match(readme, /Meridian is an \*\*independent commercial product\*\*/);
  assert.doesNotMatch(rocketLaunchesSource, /opensky-network\.org|google\.com\/news|telegeography|quantum-earth/i);
});

test('first-run missions do not write meridian.launchSite', () => {
  const code = firstRunSource.slice(firstRunSource.indexOf('export function shouldShowFirstRun'));
  assert.match(firstRunSource, /meridian\.launchSite/);
  for (const forbidden of ['setLaunchSiteFilter', 'writeLaunchSiteFilter', 'hydrateLaunchSiteFilter']) {
    assert.doesNotMatch(code, new RegExp(forbidden), `a mission must never touch ${forbidden}`);
  }
});
