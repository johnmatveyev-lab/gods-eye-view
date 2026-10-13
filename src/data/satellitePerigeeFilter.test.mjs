// PLAN 199 — Satellites: All | <600km | <400km perigee chips.
// Persist meridian.satPerigee. Re-filter already-fetched CelesTrak satrecs.
// No extra /api. Distinct from period / inclination / eccentricity / year chips.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { constants, twoline2satrec } from 'satellite.js';
import {
  DEFAULT_SAT_PERIGEE,
  SAT_PERIGEE_CHIPS,
  SAT_PERIGEE_STORAGE_KEY,
  SAT_XKMPER_KM,
  filterSatellitesByPerigee,
  getSatPerigee,
  normalizeSatPerigee,
  readSatPerigeePreference,
  resetSatPerigeeCache,
  satellitePassesPerigeeFilter,
  satellitePerigeeChipModels,
  satellitePerigeeKm,
  satellitePerigeeMaxKm,
  setSatPerigee,
  writeSatPerigeePreference,
} from './satellitePerigeeFilter.js';
import {
  DEFAULT_SAT_PERIOD,
  satellitePassesPeriodFilter,
} from './satellitePeriodFilter.js';
import {
  DEFAULT_SAT_INCLINATION,
  satellitePassesInclinationFilter,
} from './satelliteInclinationFilter.js';
import {
  DEFAULT_SAT_ECCENTRICITY,
  satellitePassesEccentricityFilter,
} from './satelliteEccentricityFilter.js';
import {
  DEFAULT_SAT_LAUNCH_YEAR,
  satellitePassesLaunchYearFilter,
} from './satelliteLaunchYearFilter.js';
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
const STARLINK_NORAD = 58234;
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

/** Earth-radii stub so km = altp × 6378.135. */
function satrecForPerigeeKm(km) {
  return { altp: km / SAT_XKMPER_KM };
}

const ISS_TLE = [
  'ISS (ZARYA)',
  '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927',
  '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537',
].join('\n');

function catalogTle(satnum, name, { inc, n, e = '0006703' }) {
  const id = String(satnum).padStart(5, '0');
  const incField = inc.toFixed(4).padStart(8, ' ');
  const nField = n.toFixed(8).padStart(11, ' ');
  const line1 = `1 ${id}U 24001A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927`;
  const line2 = `2 ${id} ${incField} 247.4627 ${e} 130.5360 325.0288 ${nField}563537`;
  return [name, line1, line2].join('\n');
}

const STARLINK_TLE = catalogTle(STARLINK_NORAD, 'STARLINK-TEST', { inc: 53.0, n: 15.064 });
const GPS_TLE = catalogTle(GPS_NORAD, 'GPS BIIR-2', { inc: 55.0, n: 2.0056 });
const GOES_TLE = catalogTle(GEO_NORAD, 'GOES 16', { inc: 0.50, n: 1.00273 });

function satrecFromTle(tle) {
  const [, line1, line2] = tle.split('\n');
  return twoline2satrec(line1, line2);
}

function perigeeChip(id) {
  return satellitesLayer.getRowControls().chips.find((entry) => entry.id === `perigee-${id}`);
}

function visibleIds() {
  const shows = _satelliteVisualStateForTest().pointShows || {};
  return Object.entries(shows)
    .filter(([, show]) => show !== false)
    .map(([id]) => Number(id))
    .sort((a, b) => a - b);
}

function seedPerigeeCatalog({ trackedNorad = null } = {}) {
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
        satrec: satrecForPerigeeKm(350),
        point: { id: ISS_NORAD, show: true },
      },
      {
        noradId: STARLINK_NORAD,
        name: 'STARLINK-TEST',
        group: 'visual',
        satrec: satrecForPerigeeKm(550),
        point: { id: STARLINK_NORAD, show: true },
      },
      {
        noradId: GPS_NORAD,
        name: 'GPS BIIR-2',
        group: 'gps-ops',
        satrec: satrecForPerigeeKm(20200),
        point: { id: GPS_NORAD, show: true },
      },
      {
        noradId: GEO_NORAD,
        name: 'GEO-1',
        group: 'geo',
        satrec: satrecForPerigeeKm(35786),
        point: { id: GEO_NORAD, show: true },
      },
      {
        noradId: UNKNOWN_NORAD,
        name: 'UNKNOWN-PERIGEE',
        group: 'visual',
        satrec: {},
        point: { id: UNKNOWN_NORAD, show: true },
      },
    ],
  });
}

test('All is the default perigee floor and <600km | <400km are the shipped chips', () => {
  assert.equal(DEFAULT_SAT_PERIGEE, 'all');
  assert.equal(SAT_PERIGEE_STORAGE_KEY, 'meridian.satPerigee');
  assert.deepEqual(SAT_PERIGEE_CHIPS.map((chip) => chip.id), ['all', '600', '400']);
  assert.deepEqual(SAT_PERIGEE_CHIPS.map((chip) => chip.label), ['All', '<600km', '<400km']);
  assert.equal(satellitePerigeeMaxKm('all'), null);
  assert.equal(satellitePerigeeMaxKm('600'), 600);
  assert.equal(satellitePerigeeMaxKm('400'), 400);
  assert.equal(satellitePerigeeMaxKm('nope'), null);
});

test('normalize accepts only All | <600km | <400km chip ids', () => {
  assert.equal(normalizeSatPerigee('all'), 'all');
  assert.equal(normalizeSatPerigee(0), 'all');
  assert.equal(normalizeSatPerigee('0'), 'all');
  assert.equal(normalizeSatPerigee(600), '600');
  assert.equal(normalizeSatPerigee('600'), '600');
  assert.equal(normalizeSatPerigee(400), '400');
  assert.equal(normalizeSatPerigee('400'), '400');
  assert.equal(normalizeSatPerigee('nope'), 'all');
  assert.equal(normalizeSatPerigee(350), 'all');
  assert.equal(normalizeSatPerigee(undefined), 'all');
});

test('satrec.altp is Earth-radii; convert with satellite.js xkmper 6378.135 km', () => {
  assert.equal(SAT_XKMPER_KM, 6378.135);
  assert.equal(constants.earthRadius, SAT_XKMPER_KM, 'v6 earthRadius is Vallado xkmper');

  const stub = satrecForPerigeeKm(350);
  assert.ok(Math.abs(satellitePerigeeKm(stub) - 350) < 1e-9);
  assert.equal(Number.isFinite(satellitePerigeeKm({})), false);
  assert.equal(Number.isFinite(satellitePerigeeKm(null)), false);
  assert.equal(Number.isFinite(satellitePerigeeKm(undefined)), false);
  assert.equal(Number.isFinite(satellitePerigeeKm({ altp: Number.NaN })), false);

  const iss = satrecFromTle(ISS_TLE);
  const starlink = satrecFromTle(STARLINK_TLE);
  const gps = satrecFromTle(GPS_TLE);
  const goes = satrecFromTle(GOES_TLE);
  assert.equal(Object.hasOwn(iss, 'altp'), true, 'twoline2satrec stamps altp');
  assert.ok(Number.isFinite(iss.altp));
  assert.ok(satellitePerigeeKm(iss) < 400, 'ISS-class stays under <400km');
  assert.ok(satellitePerigeeKm(starlink) >= 400, 'typical Starlink sits above 400 km');
  assert.ok(satellitePerigeeKm(starlink) < 600, 'typical Starlink stays under 600 km');
  assert.ok(satellitePerigeeKm(gps) >= 600, 'MEO GPS is above 600 km');
  assert.ok(satellitePerigeeKm(goes) >= 600, 'GEO is above 600 km');
  assert.ok(Math.abs(satellitePerigeeKm(iss) - iss.altp * SAT_XKMPER_KM) < 1e-9);
});

test('<600km hides GEO/MEO; <400km keeps ISS-class and drops Starlink; missing altp stays', () => {
  const iss = { noradId: ISS_NORAD, satrec: satrecForPerigeeKm(350) };
  const starlink = { noradId: STARLINK_NORAD, satrec: satrecForPerigeeKm(550) };
  const gps = { noradId: GPS_NORAD, satrec: satrecForPerigeeKm(20200) };
  const geo = { noradId: GEO_NORAD, satrec: satrecForPerigeeKm(35786) };
  const missing = { noradId: UNKNOWN_NORAD, satrec: {} };

  assert.equal(satellitePassesPerigeeFilter(iss, 'all'), true);
  assert.equal(satellitePassesPerigeeFilter(geo, 'all'), true);
  assert.equal(satellitePassesPerigeeFilter(missing, 'all'), true);

  assert.equal(satellitePassesPerigeeFilter(iss, '600'), true);
  assert.equal(satellitePassesPerigeeFilter(starlink, '600'), true, 'Starlink stays under 600 km');
  assert.equal(satellitePassesPerigeeFilter(gps, '600'), false, '<600km hides MEO');
  assert.equal(satellitePassesPerigeeFilter(geo, '600'), false, '<600km hides GEO');
  assert.equal(satellitePassesPerigeeFilter(missing, '600'), true, 'missing altp stays');

  assert.equal(satellitePassesPerigeeFilter(iss, '400'), true, '<400km keeps ISS-class');
  assert.equal(satellitePassesPerigeeFilter(starlink, '400'), false, '<400km drops typical Starlink');
  assert.equal(satellitePassesPerigeeFilter(gps, '400'), false);
  assert.equal(satellitePassesPerigeeFilter(geo, '400'), false);
  assert.equal(satellitePassesPerigeeFilter(missing, '400'), true);
  assert.equal(satellitePassesPerigeeFilter({ satrec: { altp: Number.NaN } }, '400'), true);
  assert.equal(satellitePassesPerigeeFilter({ satrec: null }, '600'), true);
  assert.equal(satellitePassesPerigeeFilter({}, '400'), true);

  const boundary600 = { noradId: 1, satrec: satrecForPerigeeKm(600) };
  assert.equal(satellitePassesPerigeeFilter(boundary600, '600'), false, 'exactly 600 km hides');
  assert.equal(satellitePassesPerigeeFilter({
    noradId: 2,
    satrec: satrecForPerigeeKm(400),
  }, '400'), false, 'exactly 400 km hides');
});

test('tracked satellite stays when its perigee is above the floor', () => {
  const geo = { noradId: GEO_NORAD, satrec: satrecForPerigeeKm(35786) };
  assert.equal(satellitePassesPerigeeFilter(geo, '600'), false);
  assert.equal(satellitePassesPerigeeFilter(geo, '600', { trackedNorad: GEO_NORAD }), true);
  assert.deepEqual(
    filterSatellitesByPerigee([geo], '400', GEO_NORAD).map((sat) => sat.noradId),
    [GEO_NORAD],
  );
});

test('meridian.satPerigee persists and reload keeps the floor', () => {
  resetSatPerigeeCache();
  const storage = memoryStorage();
  assert.equal(SAT_PERIGEE_STORAGE_KEY, 'meridian.satPerigee');
  assert.equal(readSatPerigeePreference(storage), DEFAULT_SAT_PERIGEE);
  assert.equal(writeSatPerigeePreference('600', storage), '600');
  assert.equal(storage.getItem(SAT_PERIGEE_STORAGE_KEY), '600');
  resetSatPerigeeCache();
  assert.equal(getSatPerigee(storage), '600');
  assert.equal(setSatPerigee('400', storage), '400');
  resetSatPerigeeCache();
  assert.equal(getSatPerigee(storage), '400');
  setSatPerigee(DEFAULT_SAT_PERIGEE, storage);
  assert.equal(storage.getItem(SAT_PERIGEE_STORAGE_KEY), DEFAULT_SAT_PERIGEE);
  resetSatPerigeeCache();
});

test('perigee chips sit on the Satellites row and write satPerigee params', () => {
  try {
    seedPerigeeCatalog();
    const chips = satellitesLayer.getRowControls().chips;
    const perigee = chips.filter((chip) => String(chip.id).startsWith('perigee-'));
    assert.deepEqual(perigee.map((chip) => chip.id), ['perigee-all', 'perigee-600', 'perigee-400']);
    assert.deepEqual(perigee.map((chip) => chip.label), ['All', '<600km', '<400km']);
    assert.deepEqual(perigee.map((chip) => chip.params.satPerigee), ['all', '600', '400']);
    assert.equal(perigee.every((chip) => chip.group === 'Perigee'), true);
    assert.equal(perigeeChip('all').active, true);
    assert.equal(satellitesLayer.getParams().satPerigee, 'all');
    assert.ok(chips.some((chip) => chip.id === 'catalog-core'));
    assert.ok(chips.some((chip) => chip.id === 'class-station'));
    assert.ok(chips.some((chip) => chip.id === 'period-all'));
    assert.ok(chips.some((chip) => chip.id === 'inc-eq'));
    assert.ok(chips.some((chip) => chip.id === 'ecc-all'));
    assert.ok(chips.some((chip) => chip.id === 'year-all'));
    assert.ok(chips.some((chip) => chip.id === 'points'));
    assert.ok(chips.some((chip) => chip.id === 'orbits'));

    const models = satellitePerigeeChipModels('400');
    assert.equal(models.find((chip) => chip.params.satPerigee === '400').active, true);
    assert.equal(models.filter((chip) => chip.active).length, 1);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('All keeps the current catalog; <600km hides GEO/MEO; <400km drops Starlink', () => {
  try {
    seedPerigeeCatalog();
    const allOn = [ISS_NORAD, STARLINK_NORAD, GPS_NORAD, GEO_NORAD, UNKNOWN_NORAD]
      .sort((a, b) => a - b);
    assert.deepEqual(visibleIds(), allOn);

    satellitesLayer.setParams({ satPerigee: '600' });
    assert.equal(satellitesLayer.getParams().satPerigee, '600');
    assert.equal(perigeeChip('600').active, true);
    assert.equal(visibleIds().includes(ISS_NORAD), true);
    assert.equal(visibleIds().includes(STARLINK_NORAD), true, 'Starlink stays under 600 km');
    assert.equal(visibleIds().includes(UNKNOWN_NORAD), true, 'missing altp stays');
    assert.equal(visibleIds().includes(GEO_NORAD), false, '<600km hides GEO');
    assert.equal(visibleIds().includes(GPS_NORAD), false, '<600km hides MEO GPS');

    satellitesLayer.setParams({ satPerigee: '400' });
    assert.equal(visibleIds().includes(ISS_NORAD), true, 'ISS-class stays');
    assert.equal(visibleIds().includes(UNKNOWN_NORAD), true);
    assert.equal(visibleIds().includes(STARLINK_NORAD), false, 'typical Starlink drops');
    assert.equal(visibleIds().includes(GEO_NORAD), false);
    assert.equal(visibleIds().includes(GPS_NORAD), false);

    satellitesLayer.setParams({ satPerigee: 'all' });
    assert.deepEqual(visibleIds(), allOn, 'All restores the full catalog');
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('tracked GEO stays when <600km is on; untracked point stays hidden', () => {
  try {
    seedPerigeeCatalog({ trackedNorad: GEO_NORAD });
    satellitesLayer.setParams({ satPerigee: '600' });
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, GEO_NORAD);
    assert.equal(_satelliteVisualStateForTest().pointShows[GEO_NORAD], false,
      'the tracked primitive stays hidden because the entity owns the dot');
    assert.equal(visibleIds().includes(ISS_NORAD), true);
    assert.equal(visibleIds().includes(GPS_NORAD), false);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('perigee chips AND with class, period, inclination, eccentricity, year, POINTS, and ORBITS', () => {
  const geoOff = toggleSatelliteClassFilter(DEFAULT_SATELLITE_CLASS_FILTER, 'geo');
  try {
    _setSatellitePresentationForTest({
      catalog: 'core',
      showPoints: true,
      showOrbits: true,
      points: [ISS_NORAD, GEO_NORAD, STARLINK_NORAD],
      orbits: [ISS_NORAD, GEO_NORAD, STARLINK_NORAD],
      groups: {
        [ISS_NORAD]: 'stations',
        [GEO_NORAD]: 'geo',
        [STARLINK_NORAD]: 'visual',
      },
      satrecs: {
        [ISS_NORAD]: {
          altp: 350 / SAT_XKMPER_KM,
          intldesg: '98067A',
          no: (2 * Math.PI) / 92,
          inclo: 51.6416 * (Math.PI / 180),
          ecco: 0.0006703,
        },
        [GEO_NORAD]: {
          altp: 35786 / SAT_XKMPER_KM,
          intldesg: '65001A',
          no: (2 * Math.PI) / 1436,
          inclo: 0.5 * (Math.PI / 180),
          ecco: 0.00015,
        },
        [STARLINK_NORAD]: {
          altp: 550 / SAT_XKMPER_KM,
          intldesg: '24001A',
          no: (2 * Math.PI) / 92,
          inclo: 53 * (Math.PI / 180),
          ecco: 0.0002,
        },
      },
    });

    satellitesLayer.setParams({ satPerigee: '400' });
    let state = _satelliteVisualStateForTest();
    assert.equal(state.pointShows[ISS_NORAD], true);
    assert.equal(state.pointShows[STARLINK_NORAD], false);
    assert.equal(state.pointShows[GEO_NORAD], false);
    assert.equal(state.orbitShows[ISS_NORAD], true);
    assert.equal(state.orbitShows[STARLINK_NORAD], false);
    assert.equal(state.showOrbits, true);
    assert.equal(state.showPoints, true);
    assert.equal(state.satPerigee, '400');
    assert.equal(state.satPeriod, DEFAULT_SAT_PERIOD);
    assert.equal(state.satInclination, DEFAULT_SAT_INCLINATION);
    assert.equal(state.satEccentricity, DEFAULT_SAT_ECCENTRICITY);
    assert.equal(state.satLaunchYear, DEFAULT_SAT_LAUNCH_YEAR);
    assert.equal(state.satelliteClassFilter, DEFAULT_SATELLITE_CLASS_FILTER);

    satellitesLayer.setParams({ satelliteClassFilter: geoOff, satPerigee: 'all' });
    state = _satelliteVisualStateForTest();
    assert.equal(state.pointShows[ISS_NORAD], true);
    assert.equal(state.pointShows[GEO_NORAD], false, 'GEO class off still hides the GEO sat');
    assert.equal(state.satPerigee, 'all');

    satellitesLayer.setParams({
      satelliteClassFilter: DEFAULT_SATELLITE_CLASS_FILTER,
      satPerigee: '600',
      satPeriod: '128',
      satInclination: 'mp',
      satEccentricity: '001',
      satLaunchYear: 'older',
      showOrbits: false,
    });
    state = _satelliteVisualStateForTest();
    assert.equal(state.showOrbits, false);
    assert.equal(state.orbitShows[ISS_NORAD], false);
    assert.equal(state.orbitShows[GEO_NORAD], false);
    assert.equal(state.pointShows[ISS_NORAD], true);
    assert.equal(state.pointShows[GEO_NORAD], false, 'Eq off hides GEO even when All-year');
    assert.equal(state.pointShows[STARLINK_NORAD], false, '2024 hides on older');
    assert.equal(state.satPerigee, '600');
    assert.equal(state.satPeriod, '128');
    assert.equal(state.satInclination, 'mp');
    assert.equal(state.satEccentricity, '001');
    assert.equal(state.satLaunchYear, 'older');

    satellitesLayer.setParams({ showPoints: false });
    state = _satelliteVisualStateForTest();
    assert.equal(state.showPoints, false);
    assert.equal(state.pointCollectionShow, false);
    assert.equal(state.satPerigee, '600');
    assert.ok(satellitesLayer.getRowControls().chips.some((chip) => chip.id === 'perigee-600'));
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('a perigee chip change re-applies in-memory points and does not refetch CelesTrak', () => {
  const fetches = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      fetches.push(String(url));
      return { ok: true, text: async () => '' };
    };
    seedPerigeeCatalog();
    const before = _satelliteVisualStateForTest().pointIds.slice().sort((a, b) => a - b);
    satellitesLayer.setParams({ satPerigee: '600' });
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

test('catalog refresh keeps the perigee floor without a new CelesTrak group', async () => {
  const originalFetch = globalThis.fetch;
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  const fetched = [];
  const catalogTleText = [ISS_TLE, STARLINK_TLE, GOES_TLE].join('\n');
  try {
    _setDenseCatalogStateForTest({});
    satellitesLayer.setParams({ satPerigee: '600' }, { storage: memoryStorage() });
    const viewer = { scene: { primitives: { add: (p) => p, remove() {} } } };
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return {
        ok: true,
        text: async () => (String(url).endsWith('/stations') ? catalogTleText : ''),
      };
    };
    await satellitesLayer.update(viewer);
    assert.equal(satellitesLayer.getParams().satPerigee, '600', 'refresh keeps the floor');
    assert.equal(visibleIds().includes(ISS_NORAD), true, 'ISS stays after refresh');
    assert.equal(visibleIds().includes(STARLINK_NORAD), true, 'Starlink stays under 600 km');
    assert.equal(visibleIds().includes(GEO_NORAD), false, 'GEO hides after refresh');
    assert.ok(fetched.every((url) => url.includes('/api/celestrak/')), 'refresh is the existing group fetch');
    assert.equal(fetched.some((url) => /satPerigee|perigee|altp/.test(url)), false);
  } finally {
    console.log = log;
    console.warn = warn;
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('perigee chips persist as meridian.satPerigee and are not a share-link field', () => {
  const storage = memoryStorage();
  try {
    seedPerigeeCatalog();
    satellitesLayer.setParams({ satPerigee: '400' }, { storage });
    assert.equal(storage.getItem(SAT_PERIGEE_STORAGE_KEY), '400');
    resetSatPerigeeCache();
    assert.equal(getSatPerigee(storage), '400');

    const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
      enabledLayerIds: ['satellites'],
      options: { satellites: { catalog: 'core' } },
    }));
    assert.doesNotMatch(encoded.get('lo') || '', /satPerigee|s\.perigee/);
    assert.equal(normalizeLayerState({}).options.satellites.satPerigee, undefined);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('perigee chips are client-only and hide with the satellites layer', () => {
  const helper = readFileSync(path.join(ROOT, 'src/data/satellitePerigeeFilter.js'), 'utf8');
  const satellites = readFileSync(path.join(ROOT, 'src/data/satellites.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const manager = readFileSync(path.join(ROOT, 'src/data/manager.js'), 'utf8');
  const markup = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  assert.match(helper, /meridian\.satPerigee/);
  assert.match(helper, /satrec\.altp|altp/);
  assert.match(helper, /6378\.135/);
  assert.match(satellites, /satellitePerigeeChipModels/);
  assert.match(satellites, /satellitePassesPerigeeFilter/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(satellites, /\/api\/(?!celestrak)/);
  assert.doesNotMatch(layerState, /satPerigee/);
  assert.doesNotMatch(helper, /google news|telegeography|quantum-earth|gev rename/i);
  assert.doesNotMatch(satellites, /google\.com\/news|telegeography|quantum-earth/i);
  assert.equal(/satPerigee|perigee-600|perigee-400/.test(markup), false);
  assert.equal(/satPerigee|perigee-600|perigee-400/.test(ui), false);
  assert.equal(readdirSync(path.join(ROOT, 'api')).includes('satellites'), false);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
});

test('period, inclination, eccentricity, year, and class filters still AND independently of perigee All', () => {
  const geoOff = toggleSatelliteClassFilter(DEFAULT_SATELLITE_CLASS_FILTER, 'geo');
  const geo = {
    group: 'geo',
    noradId: GEO_NORAD,
    satrec: {
      altp: 35786 / SAT_XKMPER_KM,
      intldesg: '65001A',
      ecco: 0.00015,
      no: (2 * Math.PI) / 1436,
      inclo: 0.5 * (Math.PI / 180),
    },
  };
  assert.equal(satellitePassesClassFilter(geo, geoOff), false);
  assert.equal(satellitePassesPeriodFilter(geo, '128'), false);
  assert.equal(satellitePassesInclinationFilter(geo, 'p'), false);
  assert.equal(satellitePassesEccentricityFilter(geo, '001'), true);
  assert.equal(satellitePassesLaunchYearFilter(geo, 'older'), true);
  assert.equal(satellitePassesLaunchYearFilter(geo, '2020s'), false);
  assert.equal(satellitePassesPerigeeFilter(geo, 'all'), true);
  assert.equal(satellitePassesPerigeeFilter(geo, '600'), false);
});
