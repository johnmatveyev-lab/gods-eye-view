// PLAN 207 — Launches panel: exclusive All | Commercial | Government chips
// on launch_service_provider.type. Persist meridian.launchLspType.
// Re-filter the already-fetched Launch Library 2 payload. No extra /api.
// Distinct from rocket / webcast / probability / site / recovery / provider
// / status / orbit chips. rocketLaunches.js stays unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_LAUNCH_LSP_TYPE_FILTER,
  LAUNCH_LSP_TYPE_CHIP_IDS,
  LAUNCH_LSP_TYPE_CHIP_LABELS,
  LAUNCH_LSP_TYPE_STORAGE_KEY,
  filterLaunchesByLspType,
  getLaunchLspTypeFilter,
  hydrateLaunchLspTypeFilter,
  launchLspTypeChipModels,
  launchLspTypeFromPayload,
  launchPassesLspTypeFilter,
  normalizeLaunchLspTypeFilter,
  readLaunchLspTypeFilter,
  resetLaunchLspTypeFilterForTest,
  setLaunchLspTypeFilter,
  writeLaunchLspTypeFilter,
} from './launchLspTypeFilter.js';
import { launchesPanelRows } from './launchesPanel.js';
import { encodeLayerStateParams, normalizeLayerState } from './layerState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
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

const COMMERCIAL = {
  id: 'll2-starlink',
  name: 'Falcon 9 | Starlink Group 10-1',
  net: '2026-08-20T10:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { id: 3, name: 'Commercial' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'SLC-40' },
};

const GOVERNMENT = {
  id: 'll2-sls',
  name: 'SLS | Artemis',
  net: '2026-08-21T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'NASA', type: { id: 1, name: 'Government' } },
  pad: { latitude: '28.608', longitude: '-80.604', name: 'LC-39B' },
};

const MULTINATIONAL = {
  id: 'll2-ariane',
  name: 'Ariane 6 | Ride',
  net: '2026-08-22T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'Arianespace', type: { id: 2, name: 'Multinational' } },
  pad: { latitude: '5.2', longitude: '-52.7', name: 'ELA-4' },
};

const MISSING_TYPE = {
  id: 'll2-secret',
  name: 'Classified Flight',
  net: '2026-08-23T08:00:00Z',
  status: { name: 'TBD' },
  launch_service_provider: { name: 'Unknown' },
  pad: { name: 'Undisclosed', location: {} },
};

const STRING_TYPE = {
  id: 'll2-string',
  name: 'String Type',
  net: '2026-08-24T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'Rocket Lab', type: 'commercial' },
  pad: { latitude: '-39.26', longitude: '177.86', name: 'LC-1' },
};

const MIXED_CASE = {
  id: 'll2-case',
  name: 'Case Flight',
  net: '2026-08-25T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'ULA', type: { name: ' GOVERNMENT ' } },
  pad: { latitude: '28.5', longitude: '-80.5', name: 'SLC-41' },
};

const SPACEX_GOVERNMENT = {
  id: 'll2-name-trap',
  name: 'Name Trap',
  net: '2026-08-26T08:00:00Z',
  status: { name: 'Go' },
  launch_service_provider: { name: 'SpaceX', type: { name: 'Government' } },
  pad: { latitude: '34.6', longitude: '-120.6', name: 'SLC-4E' },
};

const ROSTER = [
  COMMERCIAL,
  GOVERNMENT,
  MULTINATIONAL,
  MISSING_TYPE,
  STRING_TYPE,
  MIXED_CASE,
  SPACEX_GOVERNMENT,
];

test('All is the default LSP-type chip and Commercial | Government are the shipped chips', () => {
  assert.equal(DEFAULT_LAUNCH_LSP_TYPE_FILTER, 'all');
  assert.equal(LAUNCH_LSP_TYPE_STORAGE_KEY, 'meridian.launchLspType');
  assert.deepEqual(LAUNCH_LSP_TYPE_CHIP_IDS, ['all', 'commercial', 'government']);
  assert.deepEqual(LAUNCH_LSP_TYPE_CHIP_LABELS, {
    all: 'All',
    commercial: 'Commercial',
    government: 'Government',
  });
  assert.equal(normalizeLaunchLspTypeFilter(null), DEFAULT_LAUNCH_LSP_TYPE_FILTER);
  assert.equal(normalizeLaunchLspTypeFilter(''), 'all');
  assert.equal(normalizeLaunchLspTypeFilter('all'), 'all');
  assert.equal(normalizeLaunchLspTypeFilter('0'), 'all');
  assert.equal(normalizeLaunchLspTypeFilter('Commercial'), 'commercial');
  assert.equal(normalizeLaunchLspTypeFilter('GOVERNMENT'), 'government');
  assert.equal(normalizeLaunchLspTypeFilter('multinational'), DEFAULT_LAUNCH_LSP_TYPE_FILTER);
  assert.equal(normalizeLaunchLspTypeFilter('bogus'), DEFAULT_LAUNCH_LSP_TYPE_FILTER);
  const models = launchLspTypeChipModels('commercial');
  assert.deepEqual(models.map((chip) => chip.id), ['all', 'commercial', 'government']);
  assert.equal(models.filter((chip) => chip.active).length, 1);
  assert.equal(models.find((chip) => chip.id === 'commercial').active, true);
});

test('All keeps the current panel list unchanged', () => {
  const unfiltered = launchesPanelRows({ results: ROSTER }, 'all');
  const defaulted = launchesPanelRows({ results: ROSTER });
  assert.deepEqual(unfiltered.map((row) => row.id), ROSTER.map((row) => row.id));
  assert.deepEqual(defaulted.map((row) => row.id), unfiltered.map((row) => row.id));
  assert.equal(unfiltered[0].provider, 'SpaceX');
  assert.equal(unfiltered[0].lat, 28.608);
  assert.equal(unfiltered[3].lat, null);
  assert.deepEqual(
    filterLaunchesByLspType(ROSTER, DEFAULT_LAUNCH_LSP_TYPE_FILTER).map((row) => row.id),
    ROSTER.map((row) => row.id),
  );
});

test('Commercial keeps Commercial LSPs; Government keeps Government LSPs', () => {
  assert.equal(launchLspTypeFromPayload(COMMERCIAL), 'Commercial');
  assert.equal(launchLspTypeFromPayload(GOVERNMENT), 'Government');
  assert.equal(launchLspTypeFromPayload(STRING_TYPE), 'commercial');
  assert.equal(launchLspTypeFromPayload(MIXED_CASE), 'GOVERNMENT');
  assert.equal(launchLspTypeFromPayload(MISSING_TYPE), '');
  assert.equal(launchLspTypeFromPayload({}), '');
  assert.equal(launchLspTypeFromPayload(null), '');

  assert.equal(launchPassesLspTypeFilter(COMMERCIAL, 'all'), true);
  assert.equal(launchPassesLspTypeFilter(MISSING_TYPE, 'all'), true);
  assert.equal(launchPassesLspTypeFilter(MULTINATIONAL, 'all'), true);

  assert.equal(launchPassesLspTypeFilter(COMMERCIAL, 'commercial'), true);
  assert.equal(launchPassesLspTypeFilter(STRING_TYPE, 'commercial'), true);
  assert.equal(launchPassesLspTypeFilter(GOVERNMENT, 'commercial'), false);
  assert.equal(launchPassesLspTypeFilter(MULTINATIONAL, 'commercial'), false);
  assert.equal(launchPassesLspTypeFilter(MISSING_TYPE, 'commercial'), false, 'missing type drops');

  assert.equal(launchPassesLspTypeFilter(GOVERNMENT, 'government'), true);
  assert.equal(launchPassesLspTypeFilter(MIXED_CASE, 'government'), true);
  assert.equal(launchPassesLspTypeFilter(COMMERCIAL, 'government'), false);
  assert.equal(launchPassesLspTypeFilter(MISSING_TYPE, 'government'), false, 'missing type drops');
  assert.equal(launchPassesLspTypeFilter(MULTINATIONAL, 'government'), false);

  assert.deepEqual(
    launchesPanelRows({ results: ROSTER }, 'commercial').map((row) => row.id),
    ['ll2-starlink', 'll2-string'],
  );
  assert.deepEqual(
    launchesPanelRows({ results: ROSTER }, 'government').map((row) => row.id),
    ['ll2-sls', 'll2-case', 'll2-name-trap'],
  );
});

test('LSP type chips are distinct from provider-name and other launch chips', () => {
  assert.equal(launchPassesLspTypeFilter(SPACEX_GOVERNMENT, 'commercial'), false,
    'provider name SpaceX does not keep a Government LSP on Commercial');
  assert.equal(launchPassesLspTypeFilter(SPACEX_GOVERNMENT, 'government'), true);
  assert.notEqual(LAUNCH_LSP_TYPE_STORAGE_KEY, 'meridian.launchProvider');
  assert.notEqual(LAUNCH_LSP_TYPE_STORAGE_KEY, 'meridian.launchRocket');
  assert.notEqual(LAUNCH_LSP_TYPE_STORAGE_KEY, 'meridian.launchWebcastOnly');
  assert.notEqual(LAUNCH_LSP_TYPE_STORAGE_KEY, 'meridian.launchProbability');
  assert.notEqual(LAUNCH_LSP_TYPE_STORAGE_KEY, 'meridian.launchHideUnknownSite');
  assert.notEqual(LAUNCH_LSP_TYPE_STORAGE_KEY, 'meridian.launchStatus');
  assert.notEqual(LAUNCH_LSP_TYPE_STORAGE_KEY, 'meridian.launchOrbit');
  assert.notEqual(LAUNCH_LSP_TYPE_STORAGE_KEY, 'meridian.launchSite');
});

test('meridian.launchLspType persists and reload keeps the flipped chip', () => {
  resetLaunchLspTypeFilterForTest();
  const storage = memoryStorage();
  assert.equal(readLaunchLspTypeFilter(storage), DEFAULT_LAUNCH_LSP_TYPE_FILTER);
  assert.equal(setLaunchLspTypeFilter('government', { storage }), 'government');
  assert.equal(storage.getItem(LAUNCH_LSP_TYPE_STORAGE_KEY), 'government');
  assert.equal(getLaunchLspTypeFilter(), 'government');

  resetLaunchLspTypeFilterForTest();
  assert.equal(getLaunchLspTypeFilter(), DEFAULT_LAUNCH_LSP_TYPE_FILTER);
  assert.equal(hydrateLaunchLspTypeFilter(storage), 'government');
  assert.equal(getLaunchLspTypeFilter(), 'government');
  writeLaunchLspTypeFilter(DEFAULT_LAUNCH_LSP_TYPE_FILTER, storage);
  assert.equal(storage.getItem(LAUNCH_LSP_TYPE_STORAGE_KEY), DEFAULT_LAUNCH_LSP_TYPE_FILTER);
  resetLaunchLspTypeFilterForTest();
});

test('LayerStateCoordinator restore keeps meridian.launchLspType and does not write a share URL', () => {
  const storage = memoryStorage({ [LAUNCH_LSP_TYPE_STORAGE_KEY]: 'commercial' });
  assert.equal(readLaunchLspTypeFilter(storage), 'commercial');
  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['rocket-launches'],
    options: {},
  }));
  assert.doesNotMatch(encoded.toString(), /launchLspType|meridian\.launchLspType/);
  assert.doesNotMatch(encoded.get('lo') || '', /launchLspType|lspType|lsp/);
  assert.equal(storage.getItem(LAUNCH_LSP_TYPE_STORAGE_KEY), 'commercial');
  resetLaunchLspTypeFilterForTest();
  assert.equal(hydrateLaunchLspTypeFilter(storage), 'commercial');
  resetLaunchLspTypeFilterForTest();
});

test('chips sit on the hosted Launches panel and re-apply the existing /api/launches payload', () => {
  const indexHtml = read('index.html');
  const ui = read('src/ui.js');
  const panel = read('src/data/launchesPanel.js');
  const helper = read('src/data/launchLspTypeFilter.js');
  const rocket = read('src/data/rocketLaunches.js');
  const launches = read('src/data/launches.js');
  const layerState = read('src/data/layerState.js');
  const firstRun = read('src/firstRunExperience.js');
  const license = read('LICENSE');
  const readme = read('README.md');
  const css = read('style.css');

  assert.match(indexHtml, /id="launches-panel"/);
  assert.match(indexHtml, /id="launches-panel-lsp-chips"/);
  assert.match(indexHtml, /data-launch-lsp-type="all"/);
  assert.match(indexHtml, /data-launch-lsp-type="commercial"/);
  assert.match(indexHtml, /data-launch-lsp-type="government"/);
  assert.match(indexHtml, />All</);
  assert.match(indexHtml, />Commercial</);
  assert.match(indexHtml, />Government</);
  assert.ok(
    indexHtml.indexOf('id="launches-panel"') < indexHtml.indexOf('data-launch-lsp-type="all"'),
    'LSP-type chips live inside the hosted Launches panel',
  );
  assert.ok(
    indexHtml.indexOf('data-launch-lsp-type="government"') < indexHtml.indexOf('id="earthquake-list-panel"'),
    'LSP-type chips stay on the launches panel, not later list chrome',
  );
  assert.doesNotMatch(indexHtml, /data-mission-lsp-type|data-mission-provider-type/);

  assert.match(ui, /hydrateLaunchLspTypeFilter/);
  assert.match(ui, /setLaunchLspTypeFilter/);
  assert.match(ui, /launchesPanelRows\(/);
  assert.match(ui, /data-launch-lsp-type/);
  assert.match(panel, /filterLaunchesByLspType|launchPassesLspTypeFilter/);
  assert.match(panel, /launchesPanelRows\(/);
  assert.match(helper, /meridian\.launchLspType/);
  assert.match(helper, /launch_service_provider\.type|launch_service_provider\?\.type/);
  assert.doesNotMatch(helper, /fetch\(/);
  assert.doesNotMatch(helper, /\/api\/(?!launches\b)/);
  assert.doesNotMatch(panel, /\/api\/(?!launches\b)/);
  assert.doesNotMatch(launches, /launchLspType|lsp_type|provider__type/);
  assert.doesNotMatch(layerState, /launchLspType|launchLsp/);
  assert.doesNotMatch(rocket, /launchLspType|meridian\.launchLspType|filterLaunchesByLspType/);
  assert.doesNotMatch(firstRun.slice(firstRun.indexOf('export function shouldShowFirstRun')), /setLaunchLspTypeFilter|writeLaunchLspTypeFilter|hydrateLaunchLspTypeFilter/);
  assert.match(css, /launches-panel-lsp-chip/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.doesNotMatch(helper, /telegeography|quantum-earth/i);
  assert.doesNotMatch(panel, /telegeography|quantum-earth/i);
});
