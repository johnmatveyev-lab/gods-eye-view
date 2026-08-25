// PLAN 169 — Satellites: Eq | Mid | Polar inclination chips.
// Persist meridian.satInclination. Re-filter already-fetched CelesTrak satrecs.
// No extra /api. Distinct from Plan 164 period chips (minutes, not plane).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { twoline2satrec } from 'satellite.js';
import {
  DEFAULT_SAT_INCLINATION,
  SAT_INCLINATION_CHIPS,
  SAT_INCLINATION_CHIP_IDS,
  SAT_INCLINATION_STORAGE_KEY,
  filterSatellitesByInclination,
  getSatInclination,
  normalizeSatInclination,
  readSatInclinationPreference,
  resetSatInclinationCache,
  satelliteInclinationBucket,
  satelliteInclinationChipModels,
  satelliteInclinationDegrees,
  satelliteInclinationFilterFlags,
  satellitePassesInclinationFilter,
  setSatInclination,
  toggleSatInclination,
  writeSatInclinationPreference,
} from './satelliteInclinationFilter.js';
import {
  DEFAULT_SAT_PERIOD,
  satellitePassesPeriodFilter,
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
const METOP_NORAD = 38771;
const GOES_NORAD = 41866;

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

/** Inclination stub — satellite.js stores satrec.inclo in radians. */
function satrecForInclinationDegrees(degrees) {
  return { inclo: degrees * (Math.PI / 180) };
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

const METOP_B_TLE = weatherTle(METOP_NORAD, 'METOP-B', { inc: 98.7, n: 14.21455 });
const GOES_16_TLE = weatherTle(GOES_NORAD, 'GOES 16', { inc: 0.50, n: 1.00273 });

function satrecFromTle(tle) {
  const [, line1, line2] = tle.split('\n');
  return twoline2satrec(line1, line2);
}

function incChip(id) {
  return satellitesLayer.getRowControls().chips.find((entry) => entry.id === `inc-${id}`);
}

function visibleIds() {
  const shows = _satelliteVisualStateForTest().pointShows || {};
  return Object.entries(shows)
    .filter(([, show]) => show !== false)
    .map(([id]) => Number(id))
    .sort((a, b) => a - b);
}

function seedInclinationCatalog({ trackedNorad = null } = {}) {
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
        satrec: satrecForInclinationDegrees(51.6416),
        point: { id: ISS_NORAD, show: true },
      },
      {
        noradId: GPS_NORAD,
        name: 'GPS BIIR-2',
        group: 'gps-ops',
        satrec: satrecForInclinationDegrees(55.0),
        point: { id: GPS_NORAD, show: true },
      },
      {
        noradId: GEO_NORAD,
        name: 'GEO-1',
        group: 'geo',
        satrec: satrecForInclinationDegrees(0.5),
        point: { id: GEO_NORAD, show: true },
      },
      {
        noradId: METOP_NORAD,
        name: 'METOP-B',
        group: 'weather',
        satrec: satrecForInclinationDegrees(98.7),
        point: { id: METOP_NORAD, show: true },
      },
      {
        noradId: UNKNOWN_NORAD,
        name: 'UNKNOWN-INC',
        group: 'visual',
        satrec: {},
        point: { id: UNKNOWN_NORAD, show: true },
      },
    ],
  });
}

test('Eq | Mid | Polar default all on and persist as meridian.satInclination', () => {
  assert.equal(DEFAULT_SAT_INCLINATION, 'emp');
  assert.equal(SAT_INCLINATION_STORAGE_KEY, 'meridian.satInclination');
  assert.deepEqual(SAT_INCLINATION_CHIP_IDS, ['eq', 'mid', 'polar']);
  assert.deepEqual(SAT_INCLINATION_CHIPS.map((chip) => chip.label), ['Eq', 'Mid', 'Polar']);
  assert.deepEqual(satelliteInclinationFilterFlags('emp'), { eq: true, mid: true, polar: true });
  assert.deepEqual(satelliteInclinationFilterFlags('all'), { eq: true, mid: true, polar: true });
});

test('normalize accepts only Eq | Mid | Polar chip tokens', () => {
  assert.equal(normalizeSatInclination('all'), 'emp');
  assert.equal(normalizeSatInclination('emp'), 'emp');
  assert.equal(normalizeSatInclination('eq'), 'e');
  assert.equal(normalizeSatInclination('mid'), 'm');
  assert.equal(normalizeSatInclination('polar'), 'p');
  assert.equal(normalizeSatInclination('p'), 'p');
  assert.equal(normalizeSatInclination('em'), 'em');
  assert.equal(normalizeSatInclination('eq,polar'), 'ep');
  assert.equal(normalizeSatInclination('0'), '0');
  assert.equal(normalizeSatInclination('none'), '0');
  assert.equal(normalizeSatInclination('nope'), 'emp');
  assert.equal(normalizeSatInclination(undefined), 'emp');
  assert.equal(normalizeSatInclination({ eq: false, mid: true, polar: true }), 'mp');
  assert.equal(normalizeSatInclination({ eq: false, mid: false, polar: false }), '0');
});

test('satrec.inclo is radians; buckets are Eq <30, Mid 30–80, Polar ≥80', () => {
  const iss = satrecFromTle(ISS_TLE);
  const goes = satrecFromTle(GOES_16_TLE);
  const metop = satrecFromTle(METOP_B_TLE);
  assert.ok(iss.inclo > 0 && iss.inclo < 2, 'SGP4 stores inclo in radians, not TLE degrees');
  assert.ok(Math.abs(satelliteInclinationDegrees(iss) - 51.6416) < 1e-6);
  assert.ok(Math.abs(satelliteInclinationDegrees(goes) - 0.50) < 1e-6);
  assert.ok(Math.abs(satelliteInclinationDegrees(metop) - 98.7) < 1e-6);
  assert.equal(satelliteInclinationBucket(satelliteInclinationDegrees(iss)), 'mid');
  assert.equal(satelliteInclinationBucket(satelliteInclinationDegrees(goes)), 'eq');
  assert.equal(satelliteInclinationBucket(satelliteInclinationDegrees(metop)), 'polar');
  assert.equal(satelliteInclinationBucket(29.999), 'eq');
  assert.equal(satelliteInclinationBucket(30), 'mid');
  assert.equal(satelliteInclinationBucket(79.999), 'mid');
  assert.equal(satelliteInclinationBucket(80), 'polar');
  assert.equal(Number.isFinite(satelliteInclinationDegrees({})), false);
  assert.equal(Number.isFinite(satelliteInclinationDegrees(null)), false);
  assert.equal(satelliteInclinationBucket(Number.NaN), null);
});

test('all-on matches the current catalog; Eq off hides low-inc; missing stays', () => {
  const iss = { noradId: ISS_NORAD, satrec: satrecForInclinationDegrees(51.6416) };
  const geo = { noradId: GEO_NORAD, satrec: satrecForInclinationDegrees(0.5) };
  const metop = { noradId: METOP_NORAD, satrec: satrecFromTle(METOP_B_TLE) };
  const missing = { noradId: UNKNOWN_NORAD, satrec: {} };

  assert.equal(satellitePassesInclinationFilter(iss, 'emp'), true);
  assert.equal(satellitePassesInclinationFilter(geo, 'all'), true);
  assert.equal(satellitePassesInclinationFilter(metop, DEFAULT_SAT_INCLINATION), true);
  assert.equal(satellitePassesInclinationFilter(missing, 'emp'), true);

  const eqOff = toggleSatInclination(DEFAULT_SAT_INCLINATION, 'eq');
  assert.equal(eqOff, 'mp');
  assert.equal(satellitePassesInclinationFilter(geo, eqOff), false, 'Eq off hides low-inc');
  assert.equal(satellitePassesInclinationFilter(iss, eqOff), true);
  assert.equal(satellitePassesInclinationFilter(metop, eqOff), true);
  assert.equal(satellitePassesInclinationFilter(missing, eqOff), true, 'missing inclination stays');
  assert.equal(satellitePassesInclinationFilter({ satrec: { inclo: Number.NaN } }, 'p'), true);
  assert.equal(satellitePassesInclinationFilter({ satrec: null }, 'e'), true);
  assert.equal(satellitePassesInclinationFilter({}, 'm'), true);

  const polarOnly = 'p';
  assert.equal(satellitePassesInclinationFilter(metop, polarOnly), true);
  assert.equal(satellitePassesInclinationFilter(iss, polarOnly), false);
  assert.equal(satellitePassesInclinationFilter(geo, polarOnly), false);
  assert.equal(satellitePassesInclinationFilter(missing, polarOnly), true);

  const at30 = { noradId: 1, satrec: satrecForInclinationDegrees(30) };
  const at80 = { noradId: 2, satrec: satrecForInclinationDegrees(80) };
  assert.equal(satellitePassesInclinationFilter(at30, 'e'), false, 'exactly 30° is Mid, not Eq');
  assert.equal(satellitePassesInclinationFilter(at30, 'm'), true);
  assert.equal(satellitePassesInclinationFilter(at80, 'm'), false, 'exactly 80° is Polar, not Mid');
  assert.equal(satellitePassesInclinationFilter(at80, 'p'), true);
});

test('Polar-only keeps high-inc plus the tracked satellite', () => {
  const geo = { noradId: GEO_NORAD, satrec: satrecForInclinationDegrees(0.5) };
  const metop = { noradId: METOP_NORAD, satrec: satrecForInclinationDegrees(98.7) };
  assert.equal(satellitePassesInclinationFilter(geo, 'p'), false);
  assert.equal(satellitePassesInclinationFilter(geo, 'p', { trackedNorad: GEO_NORAD }), true);
  assert.deepEqual(
    filterSatellitesByInclination([geo, metop], 'p', GEO_NORAD).map((sat) => sat.noradId),
    [GEO_NORAD, METOP_NORAD],
  );
});

test('meridian.satInclination persists and reload keeps the chip set', () => {
  resetSatInclinationCache();
  const storage = memoryStorage();
  assert.equal(SAT_INCLINATION_STORAGE_KEY, 'meridian.satInclination');
  assert.equal(readSatInclinationPreference(storage), DEFAULT_SAT_INCLINATION);
  assert.equal(writeSatInclinationPreference('p', storage), 'p');
  assert.equal(storage.getItem(SAT_INCLINATION_STORAGE_KEY), 'p');
  resetSatInclinationCache();
  assert.equal(getSatInclination(storage), 'p');
  assert.equal(setSatInclination('mp', storage), 'mp');
  resetSatInclinationCache();
  assert.equal(getSatInclination(storage), 'mp');
  setSatInclination(DEFAULT_SAT_INCLINATION, storage);
  assert.equal(storage.getItem(SAT_INCLINATION_STORAGE_KEY), DEFAULT_SAT_INCLINATION);
  resetSatInclinationCache();
});

test('inclination chips sit on the Satellites row and toggle satInclination params', () => {
  try {
    seedInclinationCatalog();
    const chips = satellitesLayer.getRowControls().chips;
    const inclination = chips.filter((chip) => String(chip.id).startsWith('inc-'));
    assert.deepEqual(inclination.map((chip) => chip.id), ['inc-eq', 'inc-mid', 'inc-polar']);
    assert.deepEqual(inclination.map((chip) => chip.label), ['Eq', 'Mid', 'Polar']);
    assert.equal(inclination.every((chip) => chip.group === 'Inclination'), true);
    assert.equal(inclination.every((chip) => chip.active), true);
    assert.equal(satellitesLayer.getParams().satInclination, DEFAULT_SAT_INCLINATION);
    assert.ok(chips.some((chip) => chip.id === 'catalog-core'));
    assert.ok(chips.some((chip) => chip.id === 'class-station'));
    assert.ok(chips.some((chip) => chip.id === 'period-all'));
    assert.ok(chips.some((chip) => chip.id === 'points'));
    assert.ok(chips.some((chip) => chip.id === 'orbits'));

    assert.equal(incChip('eq').params.satInclination, 'mp');
    const models = satelliteInclinationChipModels('p');
    assert.equal(models.find((chip) => chip.id === 'inc-polar').active, true);
    assert.equal(models.find((chip) => chip.id === 'inc-eq').active, false);
    assert.equal(models.filter((chip) => chip.active).length, 1);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('all-on is the current view; Polar-only keeps high-inc; Eq off hides low-inc', () => {
  try {
    seedInclinationCatalog();
    const allOn = [ISS_NORAD, GPS_NORAD, GEO_NORAD, METOP_NORAD, UNKNOWN_NORAD]
      .sort((a, b) => a - b);
    assert.deepEqual(visibleIds(), allOn);

    satellitesLayer.setParams({ satInclination: 'p' });
    assert.equal(satellitesLayer.getParams().satInclination, 'p');
    assert.equal(incChip('polar').active, true);
    assert.equal(incChip('eq').active, false);
    assert.equal(incChip('mid').active, false);
    assert.equal(visibleIds().includes(METOP_NORAD), true, 'Polar-only keeps high-inc');
    assert.equal(visibleIds().includes(UNKNOWN_NORAD), true, 'missing inclination stays');
    assert.equal(visibleIds().includes(ISS_NORAD), false);
    assert.equal(visibleIds().includes(GEO_NORAD), false);

    satellitesLayer.setParams({ satInclination: 'mp' });
    assert.equal(visibleIds().includes(ISS_NORAD), true);
    assert.equal(visibleIds().includes(METOP_NORAD), true);
    assert.equal(visibleIds().includes(UNKNOWN_NORAD), true);
    assert.equal(visibleIds().includes(GEO_NORAD), false, 'Eq off hides low-inc');

    satellitesLayer.setParams({ satInclination: DEFAULT_SAT_INCLINATION });
    assert.deepEqual(visibleIds(), allOn);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('tracked equatorial sat stays when Polar-only is on; untracked Eq stays hidden', () => {
  try {
    seedInclinationCatalog({ trackedNorad: GEO_NORAD });
    satellitesLayer.setParams({ satInclination: 'p' });
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, GEO_NORAD);
    assert.equal(_satelliteVisualStateForTest().pointShows[GEO_NORAD], false,
      'the tracked primitive stays hidden because the entity owns the dot');
    assert.equal(visibleIds().includes(METOP_NORAD), true);
    assert.equal(visibleIds().includes(ISS_NORAD), false);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('inclination chips AND with class chips, period chips, POINTS, and ORBITS', () => {
  const geoOff = toggleSatelliteClassFilter(DEFAULT_SATELLITE_CLASS_FILTER, 'geo');
  try {
    _setSatellitePresentationForTest({
      catalog: 'core',
      showPoints: true,
      showOrbits: true,
      points: [ISS_NORAD, GEO_NORAD, METOP_NORAD],
      orbits: [ISS_NORAD, GEO_NORAD, METOP_NORAD],
      groups: {
        [ISS_NORAD]: 'stations',
        [GEO_NORAD]: 'geo',
        [METOP_NORAD]: 'weather',
      },
      satrecs: {
        [ISS_NORAD]: { ...satrecForInclinationDegrees(51.6416), no: (2 * Math.PI) / 92 },
        [GEO_NORAD]: { ...satrecForInclinationDegrees(0.5), no: (2 * Math.PI) / 1436 },
        [METOP_NORAD]: { ...satrecForInclinationDegrees(98.7), no: (2 * Math.PI) / 101 },
      },
    });

    satellitesLayer.setParams({ satInclination: 'p' });
    let state = _satelliteVisualStateForTest();
    assert.equal(state.pointShows[METOP_NORAD], true);
    assert.equal(state.pointShows[ISS_NORAD], false);
    assert.equal(state.pointShows[GEO_NORAD], false);
    assert.equal(state.orbitShows[METOP_NORAD], true);
    assert.equal(state.orbitShows[ISS_NORAD], false);
    assert.equal(state.showOrbits, true);
    assert.equal(state.showPoints, true);
    assert.equal(state.satInclination, 'p');
    assert.equal(state.satPeriod, DEFAULT_SAT_PERIOD);
    assert.equal(state.satelliteClassFilter, DEFAULT_SATELLITE_CLASS_FILTER);

    satellitesLayer.setParams({
      satelliteClassFilter: geoOff,
      satInclination: DEFAULT_SAT_INCLINATION,
    });
    state = _satelliteVisualStateForTest();
    assert.equal(state.pointShows[ISS_NORAD], true);
    assert.equal(state.pointShows[GEO_NORAD], false, 'GEO class off still hides the GEO sat');
    assert.equal(state.satInclination, DEFAULT_SAT_INCLINATION);

    satellitesLayer.setParams({
      satelliteClassFilter: DEFAULT_SATELLITE_CLASS_FILTER,
      satInclination: 'mp',
      satPeriod: '128',
      showOrbits: false,
    });
    state = _satelliteVisualStateForTest();
    assert.equal(state.showOrbits, false);
    assert.equal(state.orbitShows[ISS_NORAD], false);
    assert.equal(state.orbitShows[METOP_NORAD], false);
    assert.equal(state.pointShows[ISS_NORAD], true);
    assert.equal(state.pointShows[METOP_NORAD], true);
    assert.equal(state.pointShows[GEO_NORAD], false, 'Eq off or <128m hides GEO');
    assert.equal(state.satInclination, 'mp');
    assert.equal(state.satPeriod, '128');

    satellitesLayer.setParams({ satPeriod: '100' });
    state = _satelliteVisualStateForTest();
    assert.equal(state.pointShows[ISS_NORAD], true);
    assert.equal(state.pointShows[METOP_NORAD], false, 'period <100m still ANDs with Mid|Polar');
    assert.equal(state.satInclination, 'mp');

    satellitesLayer.setParams({ showPoints: false });
    state = _satelliteVisualStateForTest();
    assert.equal(state.showPoints, false);
    assert.equal(state.pointCollectionShow, false);
    assert.equal(state.satInclination, 'mp');
    assert.ok(satellitesLayer.getRowControls().chips.some((chip) => chip.id === 'inc-polar'));
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('an inclination chip change re-applies in-memory points and does not refetch CelesTrak', () => {
  const fetches = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      fetches.push(String(url));
      return { ok: true, text: async () => '' };
    };
    seedInclinationCatalog();
    const before = _satelliteVisualStateForTest().pointIds.slice().sort((a, b) => a - b);
    satellitesLayer.setParams({ satInclination: 'p' });
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

test('catalog refresh keeps the inclination chips without a new CelesTrak group', async () => {
  const originalFetch = globalThis.fetch;
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  const fetched = [];
  const catalogTle = [ISS_TLE, METOP_B_TLE, GOES_16_TLE].join('\n');
  try {
    _setDenseCatalogStateForTest({});
    satellitesLayer.setParams({ satInclination: 'p' }, { storage: memoryStorage() });
    const viewer = { scene: { primitives: { add: (p) => p, remove() {} } } };
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return {
        ok: true,
        text: async () => (String(url).endsWith('/stations') ? catalogTle : ''),
      };
    };
    await satellitesLayer.update(viewer);
    assert.equal(satellitesLayer.getParams().satInclination, 'p', 'refresh keeps the chip set');
    assert.equal(visibleIds().includes(METOP_NORAD), true, 'METOP stays Polar');
    assert.equal(visibleIds().includes(ISS_NORAD), false, 'ISS Mid hides after refresh');
    assert.equal(visibleIds().includes(GOES_NORAD), false, 'GOES Eq hides after refresh');
    assert.ok(fetched.every((url) => url.includes('/api/celestrak/')), 'refresh is the existing group fetch');
    assert.equal(fetched.some((url) => /satInclination|inclination|inclo/.test(url)), false);
  } finally {
    console.log = log;
    console.warn = warn;
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('inclination chips persist as meridian.satInclination and are not a share-link field', () => {
  const storage = memoryStorage();
  try {
    seedInclinationCatalog();
    satellitesLayer.setParams({ satInclination: 'p' }, { storage });
    assert.equal(storage.getItem(SAT_INCLINATION_STORAGE_KEY), 'p');
    resetSatInclinationCache();
    assert.equal(getSatInclination(storage), 'p');

    const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
      enabledLayerIds: ['satellites'],
      options: { satellites: { catalog: 'core' } },
    }));
    assert.doesNotMatch(encoded.get('lo') || '', /satInclination|s\.inc/);
    assert.equal(normalizeLayerState({}).options.satellites.satInclination, undefined);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('inclination chips are client-only and hide with the satellites layer', () => {
  const helper = readFileSync(path.join(ROOT, 'src/data/satelliteInclinationFilter.js'), 'utf8');
  const satellites = readFileSync(path.join(ROOT, 'src/data/satellites.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const manager = readFileSync(path.join(ROOT, 'src/data/manager.js'), 'utf8');
  const markup = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  assert.match(helper, /meridian\.satInclination/);
  assert.match(helper, /satrec\.inclo/);
  assert.match(helper, /RAD_TO_DEG|180 \/ Math\.PI/);
  assert.match(satellites, /satelliteInclinationChipModels/);
  assert.match(satellites, /satellitePassesInclinationFilter/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(satellites, /\/api\/(?!celestrak)/);
  assert.doesNotMatch(layerState, /satInclination/);
  assert.doesNotMatch(helper, /opensky|google news|telegeography|quantum-earth|gev rename/i);
  assert.doesNotMatch(satellites, /opensky-network\.org|google\.com\/news|telegeography|quantum-earth/i);
  assert.equal(/satInclination|inc-eq|inc-polar/.test(markup), false);
  assert.equal(/satInclination|inc-eq|inc-polar/.test(ui), false);
  assert.equal(readdirSync(path.join(ROOT, 'api')).includes('satellites'), false);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
});

test('period and class filters still AND independently of inclination all-on', () => {
  const geoOff = toggleSatelliteClassFilter(DEFAULT_SATELLITE_CLASS_FILTER, 'geo');
  const geo = {
    group: 'geo',
    noradId: GEO_NORAD,
    satrec: { ...satrecForInclinationDegrees(0.5), no: (2 * Math.PI) / 1436 },
  };
  assert.equal(satellitePassesClassFilter(geo, geoOff), false);
  assert.equal(satellitePassesPeriodFilter(geo, '128'), false);
  assert.equal(satellitePassesInclinationFilter(geo, DEFAULT_SAT_INCLINATION), true);
  assert.equal(satellitePassesInclinationFilter(geo, 'e'), true);
});
