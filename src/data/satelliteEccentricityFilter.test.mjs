// PLAN 177 — Satellites: All | <0.01 | <0.05 eccentricity chips.
// Persist meridian.satEccentricity. Re-filter already-fetched CelesTrak satrecs.
// No extra /api. Distinct from Plan 164 period chips and Plan 169 inclination chips.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { twoline2satrec } from 'satellite.js';
import {
  DEFAULT_SAT_ECCENTRICITY,
  SAT_ECCENTRICITY_CHIPS,
  SAT_ECCENTRICITY_STORAGE_KEY,
  filterSatellitesByEccentricity,
  getSatEccentricity,
  normalizeSatEccentricity,
  readSatEccentricityPreference,
  resetSatEccentricityCache,
  satelliteEccentricity,
  satelliteEccentricityChipModels,
  satelliteEccentricityMax,
  satellitePassesEccentricityFilter,
  setSatEccentricity,
  writeSatEccentricityPreference,
} from './satelliteEccentricityFilter.js';
import {
  DEFAULT_SAT_PERIOD,
  satellitePassesPeriodFilter,
} from './satellitePeriodFilter.js';
import {
  DEFAULT_SAT_INCLINATION,
  satellitePassesInclinationFilter,
} from './satelliteInclinationFilter.js';
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
const MOLNIYA_NORAD = 32222;
const UNKNOWN_NORAD = 50000;
const MID_ECC_NORAD = 38771;

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

/** Eccentricity stub — satellite.js stores satrec.ecco as unitless 0–1. */
function satrecForEccentricity(ecco) {
  return { ecco };
}

const ISS_TLE = [
  'ISS (ZARYA)',
  '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927',
  '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537',
].join('\n');

function weatherTle(satnum, name, { inc, n, ecc }) {
  const id = String(satnum).padStart(5, '0');
  const incField = inc.toFixed(4).padStart(8, ' ');
  const nField = n.toFixed(8).padStart(11, ' ');
  const eccField = Math.round(ecc * 1e7).toString().padStart(7, '0');
  const line1 = `1 ${id}U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927`;
  const line2 = `2 ${id} ${incField} 247.4627 ${eccField} 130.5360 325.0288 ${nField}563537`;
  return [name, line1, line2].join('\n');
}

const METOP_MID_ECC_TLE = weatherTle(MID_ECC_NORAD, 'METOP-B', {
  inc: 98.7,
  n: 14.21455,
  ecc: 0.02,
});
const MOLNIYA_TLE = weatherTle(MOLNIYA_NORAD, 'MOLNIYA 1-91', {
  inc: 63.4,
  n: 2.006,
  ecc: 0.72,
});
const GOES_16_TLE = weatherTle(41866, 'GOES 16', { inc: 0.50, n: 1.00273, ecc: 0.00015 });

function satrecFromTle(tle) {
  const [, line1, line2] = tle.split('\n');
  return twoline2satrec(line1, line2);
}

function eccChip(id) {
  return satellitesLayer.getRowControls().chips.find((entry) => entry.id === `ecc-${id}`);
}

function visibleIds() {
  const shows = _satelliteVisualStateForTest().pointShows || {};
  return Object.entries(shows)
    .filter(([, show]) => show !== false)
    .map(([id]) => Number(id))
    .sort((a, b) => a - b);
}

function seedEccentricityCatalog({ trackedNorad = null } = {}) {
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
        satrec: satrecForEccentricity(0.0006703),
        point: { id: ISS_NORAD, show: true },
      },
      {
        noradId: MID_ECC_NORAD,
        name: 'METOP-B',
        group: 'weather',
        satrec: satrecForEccentricity(0.02),
        point: { id: MID_ECC_NORAD, show: true },
      },
      {
        noradId: MOLNIYA_NORAD,
        name: 'MOLNIYA 1-91',
        group: 'visual',
        satrec: satrecForEccentricity(0.72),
        point: { id: MOLNIYA_NORAD, show: true },
      },
      {
        noradId: GEO_NORAD,
        name: 'GEO-1',
        group: 'geo',
        satrec: satrecForEccentricity(0.00015),
        point: { id: GEO_NORAD, show: true },
      },
      {
        noradId: UNKNOWN_NORAD,
        name: 'UNKNOWN-ECC',
        group: 'visual',
        satrec: {},
        point: { id: UNKNOWN_NORAD, show: true },
      },
    ],
  });
}

test('All is the default eccentricity floor and <0.01 | <0.05 are the shipped chips', () => {
  assert.equal(DEFAULT_SAT_ECCENTRICITY, 'all');
  assert.equal(SAT_ECCENTRICITY_STORAGE_KEY, 'meridian.satEccentricity');
  assert.deepEqual(SAT_ECCENTRICITY_CHIPS.map((chip) => chip.id), ['all', '001', '005']);
  assert.deepEqual(SAT_ECCENTRICITY_CHIPS.map((chip) => chip.label), ['All', '<0.01', '<0.05']);
  assert.equal(satelliteEccentricityMax('all'), null);
  assert.equal(satelliteEccentricityMax('001'), 0.01);
  assert.equal(satelliteEccentricityMax('005'), 0.05);
  assert.equal(satelliteEccentricityMax('nope'), null);
});

test('normalize accepts only All | <0.01 | <0.05 chip ids', () => {
  assert.equal(normalizeSatEccentricity('all'), 'all');
  assert.equal(normalizeSatEccentricity(0), 'all');
  assert.equal(normalizeSatEccentricity('0'), 'all');
  assert.equal(normalizeSatEccentricity(0.01), '001');
  assert.equal(normalizeSatEccentricity('0.01'), '001');
  assert.equal(normalizeSatEccentricity('001'), '001');
  assert.equal(normalizeSatEccentricity(0.05), '005');
  assert.equal(normalizeSatEccentricity('0.05'), '005');
  assert.equal(normalizeSatEccentricity('005'), '005');
  assert.equal(normalizeSatEccentricity('nope'), 'all');
  assert.equal(normalizeSatEccentricity(90), 'all');
  assert.equal(normalizeSatEccentricity(undefined), 'all');
});

test('satrec.ecco is unitless 0–1 eccentricity, not TLE implied-decimal digits', () => {
  const iss = satrecFromTle(ISS_TLE);
  const mid = satrecFromTle(METOP_MID_ECC_TLE);
  const molniya = satrecFromTle(MOLNIYA_TLE);
  const goes = satrecFromTle(GOES_16_TLE);
  assert.ok(iss.ecco > 0 && iss.ecco < 1, 'SGP4 stores ecco as unitless 0–1');
  assert.ok(Math.abs(satelliteEccentricity(iss) - 0.0006703) < 1e-9);
  assert.ok(Math.abs(satelliteEccentricity(mid) - 0.02) < 1e-9);
  assert.ok(Math.abs(satelliteEccentricity(molniya) - 0.72) < 1e-9);
  assert.ok(Math.abs(satelliteEccentricity(goes) - 0.00015) < 1e-9);
  assert.ok(satelliteEccentricity(iss) < 0.01, 'ISS is near-circular');
  assert.ok(satelliteEccentricity(mid) >= 0.01, '0.02 sits above the tight circular floor');
  assert.ok(satelliteEccentricity(mid) < 0.05, '0.02 is still under the looser floor');
  assert.ok(satelliteEccentricity(molniya) >= 0.05, 'Molniya is highly eccentric');
  assert.equal(Number.isFinite(satelliteEccentricity({})), false);
  assert.equal(Number.isFinite(satelliteEccentricity(null)), false);
  assert.equal(Number.isFinite(satelliteEccentricity(undefined)), false);
});

test('All matches the current catalog; <0.01 keeps near-circular; <0.05 is looser; missing stays', () => {
  const iss = { noradId: ISS_NORAD, satrec: satrecForEccentricity(0.0006703) };
  const mid = { noradId: MID_ECC_NORAD, satrec: satrecFromTle(METOP_MID_ECC_TLE) };
  const molniya = { noradId: MOLNIYA_NORAD, satrec: satrecForEccentricity(0.72) };
  const missing = { noradId: UNKNOWN_NORAD, satrec: {} };

  assert.equal(satellitePassesEccentricityFilter(iss, 'all'), true);
  assert.equal(satellitePassesEccentricityFilter(molniya, 'all'), true);
  assert.equal(satellitePassesEccentricityFilter(missing, 'all'), true);

  assert.equal(satellitePassesEccentricityFilter(iss, '005'), true);
  assert.equal(satellitePassesEccentricityFilter(mid, '005'), true);
  assert.equal(satellitePassesEccentricityFilter(molniya, '005'), false, '<0.05 hides highly eccentric');
  assert.equal(satellitePassesEccentricityFilter(missing, '005'), true, 'missing eccentricity stays');

  assert.equal(satellitePassesEccentricityFilter(iss, '001'), true);
  assert.equal(satellitePassesEccentricityFilter(mid, '001'), false, '<0.01 is tighter than <0.05');
  assert.equal(satellitePassesEccentricityFilter(molniya, '001'), false);
  assert.equal(satellitePassesEccentricityFilter(missing, '001'), true);
  assert.equal(satellitePassesEccentricityFilter({ satrec: { ecco: Number.NaN } }, '001'), true);
  assert.equal(satellitePassesEccentricityFilter({ satrec: null }, '005'), true);
  assert.equal(satellitePassesEccentricityFilter({}, '001'), true);

  const at001 = { noradId: 1, satrec: satrecForEccentricity(0.01) };
  const at005 = { noradId: 2, satrec: satrecForEccentricity(0.05) };
  assert.equal(satellitePassesEccentricityFilter(at001, '001'), false, 'exactly 0.01 hides');
  assert.equal(satellitePassesEccentricityFilter(at001, '005'), true, 'exactly 0.01 stays under <0.05');
  assert.equal(satellitePassesEccentricityFilter(at005, '005'), false, 'exactly 0.05 hides');
});

test('tracked satellite stays when its eccentricity chip is off', () => {
  const molniya = { noradId: MOLNIYA_NORAD, satrec: satrecForEccentricity(0.72) };
  assert.equal(satellitePassesEccentricityFilter(molniya, '001'), false);
  assert.equal(satellitePassesEccentricityFilter(molniya, '001', { trackedNorad: MOLNIYA_NORAD }), true);
  assert.deepEqual(
    filterSatellitesByEccentricity([molniya], '005', MOLNIYA_NORAD).map((sat) => sat.noradId),
    [MOLNIYA_NORAD],
  );
});

test('meridian.satEccentricity persists and reload keeps the floor', () => {
  resetSatEccentricityCache();
  const storage = memoryStorage();
  assert.equal(SAT_ECCENTRICITY_STORAGE_KEY, 'meridian.satEccentricity');
  assert.equal(readSatEccentricityPreference(storage), DEFAULT_SAT_ECCENTRICITY);
  assert.equal(writeSatEccentricityPreference('005', storage), '005');
  assert.equal(storage.getItem(SAT_ECCENTRICITY_STORAGE_KEY), '005');
  resetSatEccentricityCache();
  assert.equal(getSatEccentricity(storage), '005');
  assert.equal(setSatEccentricity('001', storage), '001');
  resetSatEccentricityCache();
  assert.equal(getSatEccentricity(storage), '001');
  setSatEccentricity(DEFAULT_SAT_ECCENTRICITY, storage);
  assert.equal(storage.getItem(SAT_ECCENTRICITY_STORAGE_KEY), DEFAULT_SAT_ECCENTRICITY);
  resetSatEccentricityCache();
});

test('eccentricity chips sit on the Satellites row and write satEccentricity params', () => {
  try {
    seedEccentricityCatalog();
    const chips = satellitesLayer.getRowControls().chips;
    const eccentricity = chips.filter((chip) => String(chip.id).startsWith('ecc-'));
    assert.deepEqual(eccentricity.map((chip) => chip.id), ['ecc-all', 'ecc-001', 'ecc-005']);
    assert.deepEqual(eccentricity.map((chip) => chip.label), ['All', '<0.01', '<0.05']);
    assert.deepEqual(eccentricity.map((chip) => chip.params.satEccentricity), ['all', '001', '005']);
    assert.equal(eccentricity.every((chip) => chip.group === 'Eccentricity'), true);
    assert.equal(eccChip('all').active, true);
    assert.equal(satellitesLayer.getParams().satEccentricity, 'all');
    assert.ok(chips.some((chip) => chip.id === 'catalog-core'));
    assert.ok(chips.some((chip) => chip.id === 'class-station'));
    assert.ok(chips.some((chip) => chip.id === 'period-all'));
    assert.ok(chips.some((chip) => chip.id === 'inc-eq'));
    assert.ok(chips.some((chip) => chip.id === 'points'));
    assert.ok(chips.some((chip) => chip.id === 'orbits'));

    const models = satelliteEccentricityChipModels('001');
    assert.equal(models.find((chip) => chip.params.satEccentricity === '001').active, true);
    assert.equal(models.filter((chip) => chip.active).length, 1);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('All matches the current catalog; <0.05 hides Molniya; <0.01 is tighter', () => {
  try {
    seedEccentricityCatalog();
    const allOn = [ISS_NORAD, MID_ECC_NORAD, MOLNIYA_NORAD, GEO_NORAD, UNKNOWN_NORAD]
      .sort((a, b) => a - b);
    assert.deepEqual(visibleIds(), allOn);

    satellitesLayer.setParams({ satEccentricity: '005' });
    assert.equal(satellitesLayer.getParams().satEccentricity, '005');
    assert.equal(eccChip('005').active, true);
    assert.equal(visibleIds().includes(ISS_NORAD), true);
    assert.equal(visibleIds().includes(MID_ECC_NORAD), true, '<0.05 keeps e=0.02');
    assert.equal(visibleIds().includes(UNKNOWN_NORAD), true, 'missing eccentricity stays');
    assert.equal(visibleIds().includes(MOLNIYA_NORAD), false, '<0.05 hides highly eccentric');
    assert.equal(visibleIds().includes(GEO_NORAD), true);

    satellitesLayer.setParams({ satEccentricity: '001' });
    assert.equal(visibleIds().includes(ISS_NORAD), true);
    assert.equal(visibleIds().includes(GEO_NORAD), true);
    assert.equal(visibleIds().includes(UNKNOWN_NORAD), true);
    assert.equal(visibleIds().includes(MID_ECC_NORAD), false, '<0.01 is tighter than <0.05');
    assert.equal(visibleIds().includes(MOLNIYA_NORAD), false);

    satellitesLayer.setParams({ satEccentricity: 'all' });
    assert.deepEqual(visibleIds(), allOn);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('tracked highly eccentric sat stays when <0.01 is on; untracked point stays hidden', () => {
  try {
    seedEccentricityCatalog({ trackedNorad: MOLNIYA_NORAD });
    satellitesLayer.setParams({ satEccentricity: '001' });
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, MOLNIYA_NORAD);
    assert.equal(_satelliteVisualStateForTest().pointShows[MOLNIYA_NORAD], false,
      'the tracked primitive stays hidden because the entity owns the dot');
    assert.equal(visibleIds().includes(ISS_NORAD), true);
    assert.equal(visibleIds().includes(MID_ECC_NORAD), false);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('eccentricity chips AND with class, period, inclination, POINTS, and ORBITS', () => {
  const geoOff = toggleSatelliteClassFilter(DEFAULT_SATELLITE_CLASS_FILTER, 'geo');
  try {
    _setSatellitePresentationForTest({
      catalog: 'core',
      showPoints: true,
      showOrbits: true,
      points: [ISS_NORAD, GEO_NORAD, MOLNIYA_NORAD],
      orbits: [ISS_NORAD, GEO_NORAD, MOLNIYA_NORAD],
      groups: {
        [ISS_NORAD]: 'stations',
        [GEO_NORAD]: 'geo',
        [MOLNIYA_NORAD]: 'visual',
      },
      satrecs: {
        [ISS_NORAD]: {
          ecco: 0.0006703,
          no: (2 * Math.PI) / 92,
          inclo: 51.6416 * (Math.PI / 180),
        },
        [GEO_NORAD]: {
          ecco: 0.00015,
          no: (2 * Math.PI) / 1436,
          inclo: 0.5 * (Math.PI / 180),
        },
        [MOLNIYA_NORAD]: {
          ecco: 0.72,
          no: (2 * Math.PI) / 718,
          inclo: 63.4 * (Math.PI / 180),
        },
      },
    });

    satellitesLayer.setParams({ satEccentricity: '001' });
    let state = _satelliteVisualStateForTest();
    assert.equal(state.pointShows[ISS_NORAD], true);
    assert.equal(state.pointShows[GEO_NORAD], true);
    assert.equal(state.pointShows[MOLNIYA_NORAD], false);
    assert.equal(state.orbitShows[ISS_NORAD], true);
    assert.equal(state.orbitShows[MOLNIYA_NORAD], false);
    assert.equal(state.showOrbits, true);
    assert.equal(state.showPoints, true);
    assert.equal(state.satEccentricity, '001');
    assert.equal(state.satPeriod, DEFAULT_SAT_PERIOD);
    assert.equal(state.satInclination, DEFAULT_SAT_INCLINATION);
    assert.equal(state.satelliteClassFilter, DEFAULT_SATELLITE_CLASS_FILTER);

    satellitesLayer.setParams({ satelliteClassFilter: geoOff, satEccentricity: 'all' });
    state = _satelliteVisualStateForTest();
    assert.equal(state.pointShows[ISS_NORAD], true);
    assert.equal(state.pointShows[GEO_NORAD], false, 'GEO class off still hides the GEO sat');
    assert.equal(state.satEccentricity, 'all');

    satellitesLayer.setParams({
      satelliteClassFilter: DEFAULT_SATELLITE_CLASS_FILTER,
      satEccentricity: '001',
      satPeriod: '128',
      satInclination: 'mp',
      showOrbits: false,
    });
    state = _satelliteVisualStateForTest();
    assert.equal(state.showOrbits, false);
    assert.equal(state.orbitShows[ISS_NORAD], false);
    assert.equal(state.orbitShows[GEO_NORAD], false);
    assert.equal(state.pointShows[ISS_NORAD], true);
    assert.equal(state.pointShows[GEO_NORAD], false, 'Eq off hides GEO even when near-circular');
    assert.equal(state.pointShows[MOLNIYA_NORAD], false);
    assert.equal(state.satEccentricity, '001');
    assert.equal(state.satPeriod, '128');
    assert.equal(state.satInclination, 'mp');

    satellitesLayer.setParams({ showPoints: false });
    state = _satelliteVisualStateForTest();
    assert.equal(state.showPoints, false);
    assert.equal(state.pointCollectionShow, false);
    assert.equal(state.satEccentricity, '001');
    assert.ok(satellitesLayer.getRowControls().chips.some((chip) => chip.id === 'ecc-001'));
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('an eccentricity chip change re-applies in-memory points and does not refetch CelesTrak', () => {
  const fetches = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      fetches.push(String(url));
      return { ok: true, text: async () => '' };
    };
    seedEccentricityCatalog();
    const before = _satelliteVisualStateForTest().pointIds.slice().sort((a, b) => a - b);
    satellitesLayer.setParams({ satEccentricity: '001' });
    assert.deepEqual(fetches, []);
    assert.deepEqual(
      _satelliteVisualStateForTest().pointIds.slice().sort((a, b) => a - b),
      before,
      'the cached catalog stays in memory',
    );
    assert.equal(_catalogGroupForTest(ISS_NORAD), 'stations');
    assert.equal(_catalogGroupForTest(MOLNIYA_NORAD), 'visual');
  } finally {
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('catalog refresh keeps the eccentricity floor without a new CelesTrak group', async () => {
  const originalFetch = globalThis.fetch;
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  const fetched = [];
  const catalogTle = [ISS_TLE, METOP_MID_ECC_TLE, MOLNIYA_TLE].join('\n');
  try {
    _setDenseCatalogStateForTest({});
    satellitesLayer.setParams({ satEccentricity: '001' }, { storage: memoryStorage() });
    const viewer = { scene: { primitives: { add: (p) => p, remove() {} } } };
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return {
        ok: true,
        text: async () => (String(url).endsWith('/stations') ? catalogTle : ''),
      };
    };
    await satellitesLayer.update(viewer);
    assert.equal(satellitesLayer.getParams().satEccentricity, '001', 'refresh keeps the floor');
    assert.equal(visibleIds().includes(ISS_NORAD), true);
    assert.equal(visibleIds().includes(MID_ECC_NORAD), false, 'e=0.02 hides after refresh');
    assert.equal(visibleIds().includes(MOLNIYA_NORAD), false, 'Molniya hides after refresh');
    assert.ok(fetched.every((url) => url.includes('/api/celestrak/')), 'refresh is the existing group fetch');
    assert.equal(fetched.some((url) => /satEccentricity|eccentricity|ecco/.test(url)), false);
  } finally {
    console.log = log;
    console.warn = warn;
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('eccentricity chips persist as meridian.satEccentricity and are not a share-link field', () => {
  const storage = memoryStorage();
  try {
    seedEccentricityCatalog();
    satellitesLayer.setParams({ satEccentricity: '001' }, { storage });
    assert.equal(storage.getItem(SAT_ECCENTRICITY_STORAGE_KEY), '001');
    resetSatEccentricityCache();
    assert.equal(getSatEccentricity(storage), '001');

    const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
      enabledLayerIds: ['satellites'],
      options: { satellites: { catalog: 'core' } },
    }));
    assert.doesNotMatch(encoded.get('lo') || '', /satEccentricity|s\.ecc/);
    assert.equal(normalizeLayerState({}).options.satellites.satEccentricity, undefined);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('eccentricity chips are client-only and hide with the satellites layer', () => {
  const helper = readFileSync(path.join(ROOT, 'src/data/satelliteEccentricityFilter.js'), 'utf8');
  const satellites = readFileSync(path.join(ROOT, 'src/data/satellites.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const manager = readFileSync(path.join(ROOT, 'src/data/manager.js'), 'utf8');
  const markup = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  assert.match(helper, /meridian\.satEccentricity/);
  assert.match(helper, /satrec\.ecco/);
  assert.match(satellites, /satelliteEccentricityChipModels/);
  assert.match(satellites, /satellitePassesEccentricityFilter/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(satellites, /\/api\/(?!celestrak)/);
  assert.doesNotMatch(layerState, /satEccentricity/);
  assert.doesNotMatch(helper, /opensky|google news|telegeography|quantum-earth|gev rename/i);
  assert.doesNotMatch(satellites, /opensky-network\.org|google\.com\/news|telegeography|quantum-earth/i);
  assert.equal(/satEccentricity|ecc-001|ecc-005/.test(markup), false);
  assert.equal(/satEccentricity|ecc-001|ecc-005/.test(ui), false);
  assert.equal(readdirSync(path.join(ROOT, 'api')).includes('satellites'), false);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
});

test('period, inclination, and class filters still AND independently of eccentricity All', () => {
  const geoOff = toggleSatelliteClassFilter(DEFAULT_SATELLITE_CLASS_FILTER, 'geo');
  const geo = {
    group: 'geo',
    noradId: GEO_NORAD,
    satrec: {
      ecco: 0.00015,
      no: (2 * Math.PI) / 1436,
      inclo: 0.5 * (Math.PI / 180),
    },
  };
  assert.equal(satellitePassesClassFilter(geo, geoOff), false);
  assert.equal(satellitePassesPeriodFilter(geo, '128'), false);
  assert.equal(satellitePassesInclinationFilter(geo, 'p'), false);
  assert.equal(satellitePassesEccentricityFilter(geo, 'all'), true);
  assert.equal(satellitePassesEccentricityFilter(geo, '001'), true);
});
