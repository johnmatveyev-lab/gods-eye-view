// PLAN 164 — Satellites: All | <100m | <128m period chips.
// Persist meridian.satPeriod. Re-filter already-fetched CelesTrak satrecs.
// No extra /api. Distinct from Plan 132 class chips.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { twoline2satrec } from 'satellite.js';
import {
  DEFAULT_SAT_PERIOD,
  SAT_PERIOD_CHIPS,
  SAT_PERIOD_STORAGE_KEY,
  filterSatellitesByPeriod,
  getSatPeriod,
  normalizeSatPeriod,
  orbitalPeriodSeconds,
  readSatPeriodPreference,
  resetSatPeriodCache,
  satellitePassesPeriodFilter,
  satellitePeriodChipModels,
  satellitePeriodMaxMinutes,
  satellitePeriodMinutes,
  setSatPeriod,
  writeSatPeriodPreference,
} from './satellitePeriodFilter.js';
import {
  DEFAULT_SATELLITE_CLASS_FILTER,
  satellitePassesClassFilter,
  toggleSatelliteClassFilter,
} from './satelliteClassFilter.js';
import satellitesLayer, {
  _catalogGroupForTest,
  _clearDenseCatalogStateForTest,
  _satelliteVisualStateForTest,
  _setDenseCatalogStateForTest,
  _setSatellitePresentationForTest,
} from './satellites.js';
import { encodeLayerStateParams, normalizeLayerState } from './layerState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ISS_NORAD = 25544;
const GEO_NORAD = 40000;
const GPS_NORAD = 32222;
const UNKNOWN_NORAD = 50000;

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

/** Mean-motion stub so period minutes match the existing orbit helper. */
function satrecForPeriodMinutes(minutes) {
  return { no: (2 * Math.PI) / minutes };
}

const ISS_TLE = [
  'ISS (ZARYA)',
  '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927',
  '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537',
].join('\n');

function weatherTle(satnum, name, { inc, n }) {
  const id = String(satnum).padStart(5, '0');
  const incField = inc.toFixed(4).padStart(8, ' ');
  const nField = n.toFixed(8).padStart(11, ' ');
  const line1 = `1 ${id}U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927`;
  const line2 = `2 ${id} ${incField} 247.4627 0006703 130.5360 325.0288 ${nField}563537`;
  return [name, line1, line2].join('\n');
}

const METOP_B_TLE = weatherTle(38771, 'METOP-B', { inc: 98.7, n: 14.21455 });
const GOES_16_TLE = weatherTle(41866, 'GOES 16', { inc: 0.50, n: 1.00273 });

function satrecFromTle(tle) {
  const [, line1, line2] = tle.split('\n');
  return twoline2satrec(line1, line2);
}

function periodChip(id) {
  return satellitesLayer.getRowControls().chips.find((entry) => entry.id === `period-${id}`);
}

function visibleIds() {
  const shows = _satelliteVisualStateForTest().pointShows || {};
  return Object.entries(shows)
    .filter(([, show]) => show !== false)
    .map(([id]) => Number(id))
    .sort((a, b) => a - b);
}

function seedPeriodCatalog({ trackedNorad = null } = {}) {
  _setDenseCatalogStateForTest({
    catalog: 'core',
    showPoints: true,
    showOrbits: true,
    trackedNorad,
    coreSats: [
      {
        noradId: ISS_NORAD,
        name: 'ISS (ZARYA)',
        group: 'stations',
        satrec: satrecForPeriodMinutes(92),
        point: { id: ISS_NORAD, show: true },
      },
      {
        noradId: GPS_NORAD,
        name: 'GPS BIIR-2',
        group: 'gps-ops',
        satrec: satrecForPeriodMinutes(718),
        point: { id: GPS_NORAD, show: true },
      },
      {
        noradId: GEO_NORAD,
        name: 'GEO-1',
        group: 'geo',
        satrec: satrecForPeriodMinutes(1436),
        point: { id: GEO_NORAD, show: true },
      },
      {
        noradId: UNKNOWN_NORAD,
        name: 'UNKNOWN-PERIOD',
        group: 'visual',
        satrec: {},
        point: { id: UNKNOWN_NORAD, show: true },
      },
    ],
  });
}

test('All is the default period floor and <100m | <128m are the shipped chips', () => {
  assert.equal(DEFAULT_SAT_PERIOD, 'all');
  assert.equal(SAT_PERIOD_STORAGE_KEY, 'meridian.satPeriod');
  assert.deepEqual(SAT_PERIOD_CHIPS.map((chip) => chip.id), ['all', '100', '128']);
  assert.deepEqual(SAT_PERIOD_CHIPS.map((chip) => chip.label), ['All', '<100m', '<128m']);
  assert.equal(satellitePeriodMaxMinutes('all'), null);
  assert.equal(satellitePeriodMaxMinutes('100'), 100);
  assert.equal(satellitePeriodMaxMinutes('128'), 128);
  assert.equal(satellitePeriodMaxMinutes('nope'), null);
});

test('normalize accepts only All | <100m | <128m chip ids', () => {
  assert.equal(normalizeSatPeriod('all'), 'all');
  assert.equal(normalizeSatPeriod(0), 'all');
  assert.equal(normalizeSatPeriod('0'), 'all');
  assert.equal(normalizeSatPeriod(100), '100');
  assert.equal(normalizeSatPeriod('100'), '100');
  assert.equal(normalizeSatPeriod(128), '128');
  assert.equal(normalizeSatPeriod('128'), '128');
  assert.equal(normalizeSatPeriod('nope'), 'all');
  assert.equal(normalizeSatPeriod(90), 'all');
  assert.equal(normalizeSatPeriod(undefined), 'all');
});

test('orbitalPeriodSeconds is the existing mean-motion helper, not a new property', () => {
  const leo = satrecForPeriodMinutes(92);
  const geo = satrecForPeriodMinutes(1436);
  assert.ok(Math.abs(satellitePeriodMinutes(leo) - 92) < 1e-9);
  assert.ok(Math.abs(satellitePeriodMinutes(geo) - 1436) < 1e-9);
  assert.equal(orbitalPeriodSeconds(leo) / 60, satellitePeriodMinutes(leo));
  assert.equal(Number.isFinite(orbitalPeriodSeconds({})), false);
  assert.equal(Number.isFinite(orbitalPeriodSeconds(null)), false);
  assert.equal(Number.isFinite(orbitalPeriodSeconds(undefined)), false);

  const iss = satrecFromTle(ISS_TLE);
  const goes = satrecFromTle(GOES_16_TLE);
  const metop = satrecFromTle(METOP_B_TLE);
  assert.ok(satellitePeriodMinutes(iss) < 100, 'ISS is LEO');
  assert.ok(satellitePeriodMinutes(metop) >= 100, 'METOP sits above the tight LEO floor');
  assert.ok(satellitePeriodMinutes(metop) < 128, 'METOP is still under a GEO-period floor');
  assert.ok(satellitePeriodMinutes(goes) >= 128, 'GOES is GEO-period');
  assert.equal(Object.hasOwn(iss, 'orbitalPeriodSeconds'), false);
});

test('<128m hides GEO-period sats; <100m is tighter LEO; missing period stays', () => {
  const iss = { noradId: ISS_NORAD, satrec: satrecForPeriodMinutes(92) };
  const metop = { noradId: 38771, satrec: satrecFromTle(METOP_B_TLE) };
  const geo = { noradId: GEO_NORAD, satrec: satrecForPeriodMinutes(1436) };
  const missing = { noradId: UNKNOWN_NORAD, satrec: {} };

  assert.equal(satellitePassesPeriodFilter(iss, 'all'), true);
  assert.equal(satellitePassesPeriodFilter(geo, 'all'), true);
  assert.equal(satellitePassesPeriodFilter(missing, 'all'), true);

  assert.equal(satellitePassesPeriodFilter(iss, '128'), true);
  assert.equal(satellitePassesPeriodFilter(metop, '128'), true);
  assert.equal(satellitePassesPeriodFilter(geo, '128'), false, '<128m hides GEO-period');
  assert.equal(satellitePassesPeriodFilter(missing, '128'), true, 'missing period stays');

  assert.equal(satellitePassesPeriodFilter(iss, '100'), true);
  assert.equal(satellitePassesPeriodFilter(metop, '100'), false, '<100m is tighter than <128m');
  assert.equal(satellitePassesPeriodFilter(geo, '100'), false);
  assert.equal(satellitePassesPeriodFilter(missing, '100'), true);
  assert.equal(satellitePassesPeriodFilter({ satrec: { no: Number.NaN } }, '100'), true);
  assert.equal(satellitePassesPeriodFilter({ satrec: null }, '128'), true);
  assert.equal(satellitePassesPeriodFilter({}, '100'), true);

  const boundary = { noradId: 1, satrec: satrecForPeriodMinutes(128) };
  assert.equal(satellitePassesPeriodFilter(boundary, '128'), false, 'exactly 128 minutes hides');
  assert.equal(satellitePassesPeriodFilter({
    noradId: 2,
    satrec: satrecForPeriodMinutes(100),
  }, '100'), false, 'exactly 100 minutes hides');
});

test('tracked satellite stays when its period chip is off', () => {
  const geo = { noradId: GEO_NORAD, satrec: satrecForPeriodMinutes(1436) };
  assert.equal(satellitePassesPeriodFilter(geo, '128'), false);
  assert.equal(satellitePassesPeriodFilter(geo, '128', { trackedNorad: GEO_NORAD }), true);
  assert.deepEqual(
    filterSatellitesByPeriod([geo], '128', GEO_NORAD).map((sat) => sat.noradId),
    [GEO_NORAD],
  );
});

test('meridian.satPeriod persists and reload keeps the floor', () => {
  resetSatPeriodCache();
  const storage = memoryStorage();
  assert.equal(SAT_PERIOD_STORAGE_KEY, 'meridian.satPeriod');
  assert.equal(readSatPeriodPreference(storage), DEFAULT_SAT_PERIOD);
  assert.equal(writeSatPeriodPreference('128', storage), '128');
  assert.equal(storage.getItem(SAT_PERIOD_STORAGE_KEY), '128');
  resetSatPeriodCache();
  assert.equal(getSatPeriod(storage), '128');
  assert.equal(setSatPeriod('100', storage), '100');
  resetSatPeriodCache();
  assert.equal(getSatPeriod(storage), '100');
  setSatPeriod(DEFAULT_SAT_PERIOD, storage);
  assert.equal(storage.getItem(SAT_PERIOD_STORAGE_KEY), DEFAULT_SAT_PERIOD);
  resetSatPeriodCache();
});

test('period chips sit on the Satellites row and write satPeriod params', () => {
  try {
    seedPeriodCatalog();
    const chips = satellitesLayer.getRowControls().chips;
    const period = chips.filter((chip) => String(chip.id).startsWith('period-'));
    assert.deepEqual(period.map((chip) => chip.id), ['period-all', 'period-100', 'period-128']);
    assert.deepEqual(period.map((chip) => chip.label), ['All', '<100m', '<128m']);
    assert.deepEqual(period.map((chip) => chip.params.satPeriod), ['all', '100', '128']);
    assert.equal(period.every((chip) => chip.group === 'Period'), true);
    assert.equal(periodChip('all').active, true);
    assert.equal(satellitesLayer.getParams().satPeriod, 'all');
    assert.ok(chips.some((chip) => chip.id === 'catalog-core'));
    assert.ok(chips.some((chip) => chip.id === 'class-station'));
    assert.ok(chips.some((chip) => chip.id === 'points'));
    assert.ok(chips.some((chip) => chip.id === 'orbits'));

    const models = satellitePeriodChipModels('100');
    assert.equal(models.find((chip) => chip.params.satPeriod === '100').active, true);
    assert.equal(models.filter((chip) => chip.active).length, 1);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('All matches the current catalog; <128m hides GEO; <100m is tighter', () => {
  try {
    seedPeriodCatalog();
    assert.deepEqual(visibleIds(), [ISS_NORAD, GPS_NORAD, GEO_NORAD, UNKNOWN_NORAD].sort((a, b) => a - b));

    satellitesLayer.setParams({ satPeriod: '128' });
    assert.equal(satellitesLayer.getParams().satPeriod, '128');
    assert.equal(periodChip('128').active, true);
    assert.equal(visibleIds().includes(ISS_NORAD), true);
    assert.equal(visibleIds().includes(UNKNOWN_NORAD), true, 'missing period stays');
    assert.equal(visibleIds().includes(GEO_NORAD), false, '<128m hides GEO-period');
    assert.equal(visibleIds().includes(GPS_NORAD), false, 'MEO GPS is also above 128 minutes');

    satellitesLayer.setParams({ satPeriod: '100' });
    assert.equal(visibleIds().includes(ISS_NORAD), true);
    assert.equal(visibleIds().includes(UNKNOWN_NORAD), true);
    assert.equal(visibleIds().includes(GEO_NORAD), false);
    assert.equal(visibleIds().includes(GPS_NORAD), false);

    satellitesLayer.setParams({ satPeriod: 'all' });
    assert.deepEqual(visibleIds(), [ISS_NORAD, GPS_NORAD, GEO_NORAD, UNKNOWN_NORAD].sort((a, b) => a - b));
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('tracked GEO stays when <128m is on; untracked point stays hidden', () => {
  try {
    seedPeriodCatalog({ trackedNorad: GEO_NORAD });
    satellitesLayer.setParams({ satPeriod: '128' });
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, GEO_NORAD);
    assert.equal(_satelliteVisualStateForTest().pointShows[GEO_NORAD], false,
      'the tracked primitive stays hidden because the entity owns the dot');
    assert.equal(visibleIds().includes(ISS_NORAD), true);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('period chips AND with class chips, POINTS, and ORBITS', () => {
  const geoOff = toggleSatelliteClassFilter(DEFAULT_SATELLITE_CLASS_FILTER, 'geo');
  try {
    _setSatellitePresentationForTest({
      catalog: 'core',
      showPoints: true,
      showOrbits: true,
      points: [ISS_NORAD, GEO_NORAD],
      orbits: [ISS_NORAD, GEO_NORAD],
      groups: { [ISS_NORAD]: 'stations', [GEO_NORAD]: 'geo' },
      satrecs: {
        [ISS_NORAD]: satrecForPeriodMinutes(92),
        [GEO_NORAD]: satrecForPeriodMinutes(1436),
      },
    });

    satellitesLayer.setParams({ satPeriod: '128' });
    let state = _satelliteVisualStateForTest();
    assert.equal(state.pointShows[ISS_NORAD], true);
    assert.equal(state.pointShows[GEO_NORAD], false);
    assert.equal(state.orbitShows[ISS_NORAD], true);
    assert.equal(state.orbitShows[GEO_NORAD], false);
    assert.equal(state.showOrbits, true);
    assert.equal(state.showPoints, true);
    assert.equal(state.satelliteClassFilter, DEFAULT_SATELLITE_CLASS_FILTER);

    satellitesLayer.setParams({ satelliteClassFilter: geoOff, satPeriod: 'all' });
    state = _satelliteVisualStateForTest();
    assert.equal(state.pointShows[ISS_NORAD], true);
    assert.equal(state.pointShows[GEO_NORAD], false, 'GEO class off still hides the GEO sat');
    assert.equal(state.satPeriod, 'all');

    satellitesLayer.setParams({
      satelliteClassFilter: DEFAULT_SATELLITE_CLASS_FILTER,
      satPeriod: '128',
      showOrbits: false,
    });
    state = _satelliteVisualStateForTest();
    assert.equal(state.showOrbits, false);
    assert.equal(state.orbitShows[ISS_NORAD], false);
    assert.equal(state.orbitShows[GEO_NORAD], false);
    assert.equal(state.pointShows[ISS_NORAD], true);
    assert.equal(state.pointShows[GEO_NORAD], false);
    assert.equal(state.satPeriod, '128');

    satellitesLayer.setParams({ showPoints: false });
    state = _satelliteVisualStateForTest();
    assert.equal(state.showPoints, false);
    assert.equal(state.pointCollectionShow, false);
    assert.equal(state.satPeriod, '128');
    assert.ok(satellitesLayer.getRowControls().chips.some((chip) => chip.id === 'period-128'));
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('a period chip change re-applies in-memory points and does not refetch CelesTrak', () => {
  const fetches = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      fetches.push(String(url));
      return { ok: true, text: async () => '' };
    };
    seedPeriodCatalog();
    const before = _satelliteVisualStateForTest().pointIds.slice().sort((a, b) => a - b);
    satellitesLayer.setParams({ satPeriod: '128' });
    assert.deepEqual(fetches, []);
    assert.deepEqual(
      _satelliteVisualStateForTest().pointIds.slice().sort((a, b) => a - b),
      before,
      'the cached catalog stays in memory',
    );
    assert.equal(_catalogGroupForTest(ISS_NORAD), 'stations');
    assert.equal(_catalogGroupForTest(GEO_NORAD), 'geo');
  } finally {
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('catalog refresh keeps the period floor without a new CelesTrak group', async () => {
  const originalFetch = globalThis.fetch;
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  const fetched = [];
  const catalogTle = [ISS_TLE, METOP_B_TLE, GOES_16_TLE].join('\n');
  try {
    _setDenseCatalogStateForTest({});
    satellitesLayer.setParams({ satPeriod: '128' }, { storage: memoryStorage() });
    const viewer = { scene: { primitives: { add: (p) => p, remove() {} } } };
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return {
        ok: true,
        text: async () => (String(url).endsWith('/stations') ? catalogTle : ''),
      };
    };
    await satellitesLayer.update(viewer);
    assert.equal(satellitesLayer.getParams().satPeriod, '128', 'refresh keeps the floor');
    assert.equal(visibleIds().includes(ISS_NORAD), true);
    assert.equal(visibleIds().includes(38771), true, 'METOP stays under 128 minutes');
    assert.equal(visibleIds().includes(41866), false, 'GOES hides after refresh');
    assert.ok(fetched.every((url) => url.includes('/api/celestrak/')), 'refresh is the existing group fetch');
    assert.equal(fetched.some((url) => /satPeriod|period/.test(url)), false);
  } finally {
    console.log = log;
    console.warn = warn;
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('period chips persist as meridian.satPeriod and are not a share-link field', () => {
  const storage = memoryStorage();
  try {
    seedPeriodCatalog();
    satellitesLayer.setParams({ satPeriod: '100' }, { storage });
    assert.equal(storage.getItem(SAT_PERIOD_STORAGE_KEY), '100');
    resetSatPeriodCache();
    assert.equal(getSatPeriod(storage), '100');

    const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
      enabledLayerIds: ['satellites'],
      options: { satellites: { catalog: 'core' } },
    }));
    assert.doesNotMatch(encoded.get('lo') || '', /satPeriod|s\.period/);
    assert.equal(normalizeLayerState({}).options.satellites.satPeriod, undefined);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('period chips are client-only and hide with the satellites layer', () => {
  const helper = readFileSync(path.join(ROOT, 'src/data/satellitePeriodFilter.js'), 'utf8');
  const satellites = readFileSync(path.join(ROOT, 'src/data/satellites.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const manager = readFileSync(path.join(ROOT, 'src/data/manager.js'), 'utf8');
  const markup = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  assert.match(helper, /meridian\.satPeriod/);
  assert.match(helper, /orbitalPeriodSeconds/);
  assert.match(satellites, /satellitePeriodChipModels/);
  assert.match(satellites, /satellitePassesPeriodFilter/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(satellites, /\/api\/(?!celestrak)/);
  assert.doesNotMatch(layerState, /satPeriod/);
  assert.doesNotMatch(helper, /opensky|google news|telegeography|quantum-earth|gev rename/i);
  assert.doesNotMatch(satellites, /opensky-network\.org|google\.com\/news|telegeography|quantum-earth/i);
  assert.equal(/satPeriod|period-100|period-128/.test(markup), false);
  assert.equal(/satPeriod|period-100|period-128/.test(ui), false);
  assert.equal(readdirSync(path.join(ROOT, 'api')).includes('satellites'), false);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
});

test('class filter still applies independently of period All', () => {
  const geoOff = toggleSatelliteClassFilter(DEFAULT_SATELLITE_CLASS_FILTER, 'geo');
  const geo = { group: 'geo', noradId: GEO_NORAD, satrec: satrecForPeriodMinutes(1436) };
  assert.equal(satellitePassesClassFilter(geo, geoOff), false);
  assert.equal(satellitePassesPeriodFilter(geo, 'all'), true);
});
