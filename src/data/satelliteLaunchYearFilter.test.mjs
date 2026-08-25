// PLAN 182 — Satellites: All | 2020s | 2010s | older launch-year chips.
// Persist meridian.satLaunchYear. Re-filter already-fetched CelesTrak satrecs.
// No extra /api. Distinct from period / inclination / eccentricity chips.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { twoline2satrec } from 'satellite.js';
import {
  DEFAULT_SAT_LAUNCH_YEAR,
  SAT_LAUNCH_YEAR_CHIPS,
  SAT_LAUNCH_YEAR_STORAGE_KEY,
  filterSatellitesByLaunchYear,
  getSatLaunchYear,
  attachInternationalDesignator,
  internationalDesignatorFromTleLine1,
  internationalDesignatorYear,
  normalizeSatLaunchYear,
  readSatLaunchYearPreference,
  resetSatLaunchYearCache,
  satelliteLaunchYearBucket,
  satelliteLaunchYearChipModels,
  satellitePassesLaunchYearFilter,
  setSatLaunchYear,
  writeSatLaunchYearPreference,
} from './satelliteLaunchYearFilter.js';
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
const STARLINK_NORAD = 58234;
const NAV_NORAD = 36000;
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

function satrecForDesignator(intldesg) {
  return { intldesg };
}

const ISS_TLE = [
  'ISS (ZARYA)',
  '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927',
  '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537',
].join('\n');

function catalogTle(satnum, name, intldesg) {
  const id = String(satnum).padStart(5, '0');
  const desg = String(intldesg).padEnd(8, ' ');
  const line1 = `1 ${id}U ${desg} 08264.51782528 -.00002182  00000-0 -11606-4 0  2927`;
  const line2 = `2 ${id}  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537`;
  return [name, line1, line2].join('\n');
}

const STARLINK_2024_TLE = catalogTle(STARLINK_NORAD, 'STARLINK-2024', '24001A');
const NAV_2010_TLE = catalogTle(NAV_NORAD, 'NAV-2010', '10001A');

function satrecFromTle(tle) {
  const [, line1, line2] = tle.split('\n');
  return twoline2satrec(line1, line2);
}

function yearChip(id) {
  return satellitesLayer.getRowControls().chips.find((entry) => entry.id === `year-${id}`);
}

function visibleIds() {
  const shows = _satelliteVisualStateForTest().pointShows || {};
  return Object.entries(shows)
    .filter(([, show]) => show !== false)
    .map(([id]) => Number(id))
    .sort((a, b) => a - b);
}

function seedLaunchYearCatalog({ trackedNorad = null } = {}) {
  _setDenseCatalogStateForTest({
    catalog: 'core',
    showPoints: true,
    showOrbits: true,
    trackedNorad,
    coreSats: [
      {
        noradId: STARLINK_NORAD,
        name: 'STARLINK-2024',
        group: 'visual',
        satrec: satrecForDesignator('24001A'),
        point: { id: STARLINK_NORAD, show: true },
      },
      {
        noradId: NAV_NORAD,
        name: 'NAV-2010',
        group: 'gps-ops',
        satrec: satrecForDesignator('10001A'),
        point: { id: NAV_NORAD, show: true },
      },
      {
        noradId: ISS_NORAD,
        name: 'ISS (ZARYA)',
        group: 'stations',
        satrec: satrecForDesignator('98067A'),
        point: { id: ISS_NORAD, show: true },
      },
      {
        noradId: GEO_NORAD,
        name: 'GEO-1',
        group: 'geo',
        satrec: satrecForDesignator('65001A'),
        point: { id: GEO_NORAD, show: true },
      },
      {
        noradId: UNKNOWN_NORAD,
        name: 'UNKNOWN-YEAR',
        group: 'visual',
        satrec: {},
        point: { id: UNKNOWN_NORAD, show: true },
      },
    ],
  });
}

test('All is the default launch-year chip and 2020s | 2010s | older are the shipped chips', () => {
  assert.equal(DEFAULT_SAT_LAUNCH_YEAR, 'all');
  assert.equal(SAT_LAUNCH_YEAR_STORAGE_KEY, 'meridian.satLaunchYear');
  assert.deepEqual(SAT_LAUNCH_YEAR_CHIPS.map((chip) => chip.id), ['all', '2020s', '2010s', 'older']);
  assert.deepEqual(SAT_LAUNCH_YEAR_CHIPS.map((chip) => chip.label), ['All', '2020s', '2010s', 'older']);
});

test('normalize accepts only All | 2020s | 2010s | older chip ids', () => {
  assert.equal(normalizeSatLaunchYear('all'), 'all');
  assert.equal(normalizeSatLaunchYear(0), 'all');
  assert.equal(normalizeSatLaunchYear('0'), 'all');
  assert.equal(normalizeSatLaunchYear('2020s'), '2020s');
  assert.equal(normalizeSatLaunchYear(2020), '2020s');
  assert.equal(normalizeSatLaunchYear('2010s'), '2010s');
  assert.equal(normalizeSatLaunchYear(2010), '2010s');
  assert.equal(normalizeSatLaunchYear('older'), 'older');
  assert.equal(normalizeSatLaunchYear('nope'), 'all');
  assert.equal(normalizeSatLaunchYear('2030s'), 'all');
  assert.equal(normalizeSatLaunchYear(undefined), 'all');
});

test('internationalDesignatorYear decodes satrec.intldesg 57–99 as 1900s else 2000s', () => {
  const issLine1 = ISS_TLE.split('\n')[1];
  const starlinkLine1 = STARLINK_2024_TLE.split('\n')[1];
  const navLine1 = NAV_2010_TLE.split('\n')[1];
  const iss = satrecFromTle(ISS_TLE);
  const starlink = satrecFromTle(STARLINK_2024_TLE);
  const nav = satrecFromTle(NAV_2010_TLE);
  assert.equal(iss.intldesg, undefined, 'satellite.js 6 does not copy TLE columns 10–17');
  assert.equal(internationalDesignatorFromTleLine1(issLine1), '98067A');
  assert.equal(internationalDesignatorFromTleLine1(starlinkLine1), '24001A');
  attachInternationalDesignator(iss, issLine1);
  attachInternationalDesignator(starlink, starlinkLine1);
  attachInternationalDesignator(nav, navLine1);
  assert.match(String(iss.intldesg), /^98067A/);
  assert.match(String(starlink.intldesg), /^24001A/);
  assert.equal(internationalDesignatorYear(iss), 1998);
  assert.equal(internationalDesignatorYear(starlink), 2024);
  assert.equal(internationalDesignatorYear(nav), 2010);
  assert.equal(internationalDesignatorYear(satrecForDesignator('98067A')), 1998);
  assert.equal(internationalDesignatorYear(satrecForDesignator('24001A')), 2024);
  assert.equal(internationalDesignatorYear(satrecForDesignator('57001A')), 1957);
  assert.equal(internationalDesignatorYear(satrecForDesignator('00001A')), 2000);
  assert.equal(internationalDesignatorYear(satrecForDesignator('56001A')), 2056);
  assert.equal(internationalDesignatorYear({}), null);
  assert.equal(internationalDesignatorYear(null), null);
  assert.equal(internationalDesignatorYear({ intldesg: '' }), null);
  assert.equal(internationalDesignatorYear({ intldesg: 'XX001A' }), null);
  assert.equal(satelliteLaunchYearBucket(2024), '2020s');
  assert.equal(satelliteLaunchYearBucket(2010), '2010s');
  assert.equal(satelliteLaunchYearBucket(1998), 'older');
  assert.equal(satelliteLaunchYearBucket(2009), 'older');
  assert.equal(satelliteLaunchYearBucket(2030), null);
  assert.equal(satelliteLaunchYearBucket(null), null);
});

test('2020s keeps a 2024 satrec and drops 1998; missing intldesg stays', () => {
  const starlink = { noradId: STARLINK_NORAD, satrec: satrecForDesignator('24001A') };
  const iss = { noradId: ISS_NORAD, satrec: satrecForDesignator('98067A') };
  const nav = { noradId: NAV_NORAD, satrec: satrecForDesignator('10001A') };
  const missing = { noradId: UNKNOWN_NORAD, satrec: {} };

  assert.equal(satellitePassesLaunchYearFilter(starlink, 'all'), true);
  assert.equal(satellitePassesLaunchYearFilter(iss, 'all'), true);
  assert.equal(satellitePassesLaunchYearFilter(missing, 'all'), true);

  assert.equal(satellitePassesLaunchYearFilter(starlink, '2020s'), true, '2024 stays on 2020s');
  assert.equal(satellitePassesLaunchYearFilter(iss, '2020s'), false, '1998 drops on 2020s');
  assert.equal(satellitePassesLaunchYearFilter(nav, '2020s'), false);
  assert.equal(satellitePassesLaunchYearFilter(missing, '2020s'), true, 'missing intldesg stays');

  assert.equal(satellitePassesLaunchYearFilter(nav, '2010s'), true);
  assert.equal(satellitePassesLaunchYearFilter(starlink, '2010s'), false);
  assert.equal(satellitePassesLaunchYearFilter(iss, '2010s'), false);
  assert.equal(satellitePassesLaunchYearFilter(missing, '2010s'), true);

  assert.equal(satellitePassesLaunchYearFilter(iss, 'older'), true);
  assert.equal(satellitePassesLaunchYearFilter(starlink, 'older'), false);
  assert.equal(satellitePassesLaunchYearFilter(nav, 'older'), false);
  assert.equal(satellitePassesLaunchYearFilter(missing, 'older'), true);
  assert.equal(satellitePassesLaunchYearFilter({ satrec: { intldesg: 'nope' } }, '2020s'), true);
  assert.equal(satellitePassesLaunchYearFilter({ satrec: null }, 'older'), true);
  assert.equal(satellitePassesLaunchYearFilter({}, '2010s'), true);
});

test('tracked satellite stays when its launch-year chip is off', () => {
  const iss = { noradId: ISS_NORAD, satrec: satrecForDesignator('98067A') };
  assert.equal(satellitePassesLaunchYearFilter(iss, '2020s'), false);
  assert.equal(satellitePassesLaunchYearFilter(iss, '2020s', { trackedNorad: ISS_NORAD }), true);
  assert.deepEqual(
    filterSatellitesByLaunchYear([iss], '2020s', ISS_NORAD).map((sat) => sat.noradId),
    [ISS_NORAD],
  );
});

test('meridian.satLaunchYear persists and reload keeps the chip set', () => {
  resetSatLaunchYearCache();
  const storage = memoryStorage();
  assert.equal(SAT_LAUNCH_YEAR_STORAGE_KEY, 'meridian.satLaunchYear');
  assert.equal(readSatLaunchYearPreference(storage), DEFAULT_SAT_LAUNCH_YEAR);
  assert.equal(writeSatLaunchYearPreference('2020s', storage), '2020s');
  assert.equal(storage.getItem(SAT_LAUNCH_YEAR_STORAGE_KEY), '2020s');
  resetSatLaunchYearCache();
  assert.equal(getSatLaunchYear(storage), '2020s');
  assert.equal(setSatLaunchYear('older', storage), 'older');
  resetSatLaunchYearCache();
  assert.equal(getSatLaunchYear(storage), 'older');
  setSatLaunchYear(DEFAULT_SAT_LAUNCH_YEAR, storage);
  assert.equal(storage.getItem(SAT_LAUNCH_YEAR_STORAGE_KEY), DEFAULT_SAT_LAUNCH_YEAR);
  resetSatLaunchYearCache();
});

test('launch-year chips sit on the Satellites row and write satLaunchYear params', () => {
  try {
    seedLaunchYearCatalog();
    const chips = satellitesLayer.getRowControls().chips;
    const year = chips.filter((chip) => String(chip.id).startsWith('year-'));
    assert.deepEqual(year.map((chip) => chip.id), ['year-all', 'year-2020s', 'year-2010s', 'year-older']);
    assert.deepEqual(year.map((chip) => chip.label), ['All', '2020s', '2010s', 'older']);
    assert.deepEqual(year.map((chip) => chip.params.satLaunchYear), ['all', '2020s', '2010s', 'older']);
    assert.equal(year.every((chip) => chip.group === 'Year'), true);
    assert.equal(yearChip('all').active, true);
    assert.equal(satellitesLayer.getParams().satLaunchYear, 'all');
    assert.ok(chips.some((chip) => chip.id === 'catalog-core'));
    assert.ok(chips.some((chip) => chip.id === 'class-station'));
    assert.ok(chips.some((chip) => chip.id === 'period-all'));
    assert.ok(chips.some((chip) => chip.id === 'inc-eq'));
    assert.ok(chips.some((chip) => chip.id === 'ecc-all'));
    assert.ok(chips.some((chip) => chip.id === 'points'));
    assert.ok(chips.some((chip) => chip.id === 'orbits'));

    const models = satelliteLaunchYearChipModels('2020s');
    assert.equal(models.find((chip) => chip.params.satLaunchYear === '2020s').active, true);
    assert.equal(models.filter((chip) => chip.active).length, 1);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('All restores the full catalog; 2020s drops 1998; missing intldesg stays', () => {
  try {
    seedLaunchYearCatalog();
    const allOn = [STARLINK_NORAD, NAV_NORAD, ISS_NORAD, GEO_NORAD, UNKNOWN_NORAD]
      .sort((a, b) => a - b);
    assert.deepEqual(visibleIds(), allOn);

    satellitesLayer.setParams({ satLaunchYear: '2020s' });
    assert.equal(satellitesLayer.getParams().satLaunchYear, '2020s');
    assert.equal(yearChip('2020s').active, true);
    assert.equal(visibleIds().includes(STARLINK_NORAD), true, '2024 stays');
    assert.equal(visibleIds().includes(UNKNOWN_NORAD), true, 'missing intldesg stays');
    assert.equal(visibleIds().includes(ISS_NORAD), false, '1998 drops on 2020s');
    assert.equal(visibleIds().includes(NAV_NORAD), false);
    assert.equal(visibleIds().includes(GEO_NORAD), false);

    satellitesLayer.setParams({ satLaunchYear: '2010s' });
    assert.equal(visibleIds().includes(NAV_NORAD), true);
    assert.equal(visibleIds().includes(UNKNOWN_NORAD), true);
    assert.equal(visibleIds().includes(STARLINK_NORAD), false);
    assert.equal(visibleIds().includes(ISS_NORAD), false);

    satellitesLayer.setParams({ satLaunchYear: 'older' });
    assert.equal(visibleIds().includes(ISS_NORAD), true);
    assert.equal(visibleIds().includes(GEO_NORAD), true);
    assert.equal(visibleIds().includes(UNKNOWN_NORAD), true);
    assert.equal(visibleIds().includes(STARLINK_NORAD), false);
    assert.equal(visibleIds().includes(NAV_NORAD), false);

    satellitesLayer.setParams({ satLaunchYear: 'all' });
    assert.deepEqual(visibleIds(), allOn, 'All restores the full catalog');
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('tracked older sat stays when 2020s is on; untracked point stays hidden', () => {
  try {
    seedLaunchYearCatalog({ trackedNorad: ISS_NORAD });
    satellitesLayer.setParams({ satLaunchYear: '2020s' });
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, ISS_NORAD);
    assert.equal(_satelliteVisualStateForTest().pointShows[ISS_NORAD], false,
      'the tracked primitive stays hidden because the entity owns the dot');
    assert.equal(visibleIds().includes(STARLINK_NORAD), true);
    assert.equal(visibleIds().includes(NAV_NORAD), false);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('launch-year chips AND with class, period, inclination, eccentricity, POINTS, and ORBITS', () => {
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
          intldesg: '98067A',
          no: (2 * Math.PI) / 92,
          inclo: 51.6416 * (Math.PI / 180),
          ecco: 0.0006703,
        },
        [GEO_NORAD]: {
          intldesg: '65001A',
          no: (2 * Math.PI) / 1436,
          inclo: 0.5 * (Math.PI / 180),
          ecco: 0.00015,
        },
        [STARLINK_NORAD]: {
          intldesg: '24001A',
          no: (2 * Math.PI) / 92,
          inclo: 53 * (Math.PI / 180),
          ecco: 0.0002,
        },
      },
    });

    satellitesLayer.setParams({ satLaunchYear: '2020s' });
    let state = _satelliteVisualStateForTest();
    assert.equal(state.pointShows[STARLINK_NORAD], true);
    assert.equal(state.pointShows[ISS_NORAD], false);
    assert.equal(state.pointShows[GEO_NORAD], false);
    assert.equal(state.orbitShows[STARLINK_NORAD], true);
    assert.equal(state.orbitShows[ISS_NORAD], false);
    assert.equal(state.showOrbits, true);
    assert.equal(state.showPoints, true);
    assert.equal(state.satLaunchYear, '2020s');
    assert.equal(state.satPeriod, DEFAULT_SAT_PERIOD);
    assert.equal(state.satInclination, DEFAULT_SAT_INCLINATION);
    assert.equal(state.satEccentricity, DEFAULT_SAT_ECCENTRICITY);
    assert.equal(state.satelliteClassFilter, DEFAULT_SATELLITE_CLASS_FILTER);

    satellitesLayer.setParams({ satelliteClassFilter: geoOff, satLaunchYear: 'all' });
    state = _satelliteVisualStateForTest();
    assert.equal(state.pointShows[ISS_NORAD], true);
    assert.equal(state.pointShows[GEO_NORAD], false, 'GEO class off still hides the GEO sat');
    assert.equal(state.satLaunchYear, 'all');

    satellitesLayer.setParams({
      satelliteClassFilter: DEFAULT_SATELLITE_CLASS_FILTER,
      satLaunchYear: 'older',
      satPeriod: '128',
      satInclination: 'mp',
      satEccentricity: '001',
      showOrbits: false,
    });
    state = _satelliteVisualStateForTest();
    assert.equal(state.showOrbits, false);
    assert.equal(state.orbitShows[ISS_NORAD], false);
    assert.equal(state.orbitShows[GEO_NORAD], false);
    assert.equal(state.pointShows[ISS_NORAD], true);
    assert.equal(state.pointShows[GEO_NORAD], false, 'Eq off hides GEO even when older');
    assert.equal(state.pointShows[STARLINK_NORAD], false, '2024 hides on older');
    assert.equal(state.satLaunchYear, 'older');
    assert.equal(state.satPeriod, '128');
    assert.equal(state.satInclination, 'mp');
    assert.equal(state.satEccentricity, '001');

    satellitesLayer.setParams({ showPoints: false });
    state = _satelliteVisualStateForTest();
    assert.equal(state.showPoints, false);
    assert.equal(state.pointCollectionShow, false);
    assert.equal(state.satLaunchYear, 'older');
    assert.ok(satellitesLayer.getRowControls().chips.some((chip) => chip.id === 'year-older'));
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('a launch-year chip change re-applies in-memory points and does not refetch CelesTrak', () => {
  const fetches = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      fetches.push(String(url));
      return { ok: true, text: async () => '' };
    };
    seedLaunchYearCatalog();
    const before = _satelliteVisualStateForTest().pointIds.slice().sort((a, b) => a - b);
    satellitesLayer.setParams({ satLaunchYear: '2020s' });
    assert.deepEqual(fetches, []);
    assert.deepEqual(
      _satelliteVisualStateForTest().pointIds.slice().sort((a, b) => a - b),
      before,
      'the cached catalog stays in memory',
    );
    assert.equal(_catalogGroupForTest(STARLINK_NORAD), 'visual');
    assert.equal(_catalogGroupForTest(ISS_NORAD), 'stations');
  } finally {
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('catalog refresh keeps the launch-year chip without a new CelesTrak group', async () => {
  const originalFetch = globalThis.fetch;
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  const fetched = [];
  const catalogTleText = [ISS_TLE, STARLINK_2024_TLE, NAV_2010_TLE].join('\n');
  try {
    _setDenseCatalogStateForTest({});
    satellitesLayer.setParams({ satLaunchYear: '2020s' }, { storage: memoryStorage() });
    const viewer = { scene: { primitives: { add: (p) => p, remove() {} } } };
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return {
        ok: true,
        text: async () => (String(url).endsWith('/stations') ? catalogTleText : ''),
      };
    };
    await satellitesLayer.update(viewer);
    assert.equal(satellitesLayer.getParams().satLaunchYear, '2020s', 'refresh keeps the chip set');
    assert.equal(visibleIds().includes(STARLINK_NORAD), true, '2024 stays after refresh');
    assert.equal(visibleIds().includes(ISS_NORAD), false, '1998 hides after refresh');
    assert.equal(visibleIds().includes(NAV_NORAD), false, '2010 hides after refresh');
    assert.ok(fetched.every((url) => url.includes('/api/celestrak/')), 'refresh is the existing group fetch');
    assert.equal(fetched.some((url) => /satLaunchYear|launchYear|intldesg/.test(url)), false);
  } finally {
    console.log = log;
    console.warn = warn;
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('launch-year chips persist as meridian.satLaunchYear and are not a share-link field', () => {
  const storage = memoryStorage();
  try {
    seedLaunchYearCatalog();
    satellitesLayer.setParams({ satLaunchYear: '2020s' }, { storage });
    assert.equal(storage.getItem(SAT_LAUNCH_YEAR_STORAGE_KEY), '2020s');
    resetSatLaunchYearCache();
    assert.equal(getSatLaunchYear(storage), '2020s');

    const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
      enabledLayerIds: ['satellites'],
      options: { satellites: { catalog: 'core' } },
    }));
    assert.doesNotMatch(encoded.get('lo') || '', /satLaunchYear|s\.year/);
    assert.equal(normalizeLayerState({}).options.satellites.satLaunchYear, undefined);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('launch-year chips are client-only and hide with the satellites layer', () => {
  const helper = readFileSync(path.join(ROOT, 'src/data/satelliteLaunchYearFilter.js'), 'utf8');
  const satellites = readFileSync(path.join(ROOT, 'src/data/satellites.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const manager = readFileSync(path.join(ROOT, 'src/data/manager.js'), 'utf8');
  const markup = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  assert.match(helper, /meridian\.satLaunchYear/);
  assert.match(helper, /satrec\.intldesg|intldesg/);
  assert.match(helper, /57–99|57-99|shortYear >= 57/);
  assert.match(satellites, /satelliteLaunchYearChipModels/);
  assert.match(satellites, /satellitePassesLaunchYearFilter/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(satellites, /\/api\/(?!celestrak)/);
  assert.doesNotMatch(layerState, /satLaunchYear/);
  assert.doesNotMatch(helper, /google news|telegeography|quantum-earth|gev rename/i);
  assert.doesNotMatch(satellites, /google\.com\/news|telegeography|quantum-earth/i);
  assert.equal(/satLaunchYear|year-2020s|year-2010s/.test(markup), false);
  assert.equal(/satLaunchYear|year-2020s|year-2010s/.test(ui), false);
  assert.equal(readdirSync(path.join(ROOT, 'api')).includes('satellites'), false);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
});

test('period, inclination, eccentricity, and class filters still AND independently of launch-year All', () => {
  const geoOff = toggleSatelliteClassFilter(DEFAULT_SATELLITE_CLASS_FILTER, 'geo');
  const geo = {
    group: 'geo',
    noradId: GEO_NORAD,
    satrec: {
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
  assert.equal(satellitePassesLaunchYearFilter(geo, 'all'), true);
  assert.equal(satellitePassesLaunchYearFilter(geo, 'older'), true);
  assert.equal(satellitePassesLaunchYearFilter(geo, '2020s'), false);
});
