import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  SATELLITE_CLASSES,
  SATELLITE_CLASS_ORDER,
  satelliteClassColor,
  satelliteClassLabel,
  satelliteClassLegend,
  satelliteClassOf,
  tallySatelliteClasses,
} from './satelliteClass.js';
import {
  DEFAULT_SATELLITE_CLASS_FILTER,
  SATELLITE_CLASS_CHIP_CODES,
  SATELLITE_CLASS_CHIP_IDS,
  SATELLITE_CLASS_CHIP_LABELS,
  filterSatellitesByClass,
  normalizeSatelliteClassFilter,
  satelliteClassFilterFlags,
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
import {
  encodeLayerStateParams,
  normalizeLayerState,
} from './layerState.js';
import { resetSatGroupCache, setSatGroup } from './satGroup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ISS_NORAD = 25544;

const CATALOG = Object.freeze([
  { noradId: ISS_NORAD, name: 'ISS (ZARYA)', group: 'stations' },
  { noradId: 32222, name: 'GPS BIIR-2', group: 'gps-ops' },
  { noradId: 32223, name: 'COSMOS-GLONASS', group: 'glonass' },
  { noradId: 32224, name: 'GALILEO-1', group: 'galileo' },
  { noradId: 40000, name: 'GEO-1', group: 'geo' },
  { noradId: 40001, name: 'VISUAL-1', group: 'visual' },
  { noradId: 44444, name: 'STARLINK-TEST', group: 'dense' },
]);

function seedCatalog({
  catalog = 'core',
  showOrbits = true,
  trackedNorad = null,
  sats = CATALOG.filter((sat) => catalog === 'dense' || sat.group !== 'dense'),
} = {}) {
  _setDenseCatalogStateForTest({
    catalog,
    showPoints: true,
    showOrbits,
    trackedNorad,
    coreSats: sats.map((sat) => ({
      ...sat,
      point: { id: sat.noradId, show: true },
    })),
  });
}

function visibleIds() {
  const shows = _satelliteVisualStateForTest().pointShows || {};
  return Object.entries(shows)
    .filter(([, show]) => show !== false)
    .map(([id]) => Number(id))
    .sort((a, b) => a - b);
}

function classChip(klass) {
  return satellitesLayer.getRowControls().chips.find((entry) => entry.id === `class-${klass}`);
}

/**
 * A real, parseable TLE under an arbitrary 5-digit catalog number, so the dense
 * load exercises the production path. Both fixtures deliberately avoid 25544 —
 * that is the ISS, and the ISS is force-classified as a STATION everywhere.
 * @param {string} satnum Five-digit catalog number.
 * @param {string} name Object name line.
 */
const tleFor = (satnum, name) => [
  name,
  `1 ${satnum}U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927`,
  `2 ${satnum}  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537`,
].join('\n');

const DENSE_TLE = tleFor('44444', 'STARLINK-TEST');
const ALT_TLE = tleFor('33333', 'DRIFTER-1');
const ISS_TLE = tleFor('25544', 'ISS (ZARYA)');

function catalogChip(id) {
  return satellitesLayer.getRowControls().chips.find((entry) => entry.id === id);
}

/** Poll Dense until the async load settles (or give up). */
async function settleChip(maxTicks = 50) {
  for (let i = 0; i < maxTicks; i++) {
    const chip = catalogChip('catalog-dense');
    if (chip && !chip.busy) return chip;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return catalogChip('catalog-dense');
}

/** Every CelesTrak group the catalog ingests, plus the dense-mode tag. */
const INGESTED_GROUPS = ['stations', 'visual', 'gps-ops', 'glonass', 'galileo', 'geo', 'weather', 'dense'];

test('every ingested CelesTrak group resolves to a real class', () => {
  // Guards against drift: adding a group to CATALOG_GROUPS without classifying
  // it would silently dump those satellites into the catch-all bucket.
  for (const group of INGESTED_GROUPS) {
    const { klass } = satelliteClassOf(group);
    assert.ok(SATELLITE_CLASSES[klass], `${group} maps to an unknown class ${klass}`);
    assert.ok(SATELLITE_CLASS_ORDER.includes(klass), `${klass} is missing from the legend order`);
  }
});

test('the three GNSS constellations share one NAV color and split by subtype', () => {
  const navGroups = ['gps-ops', 'glonass', 'galileo'];
  const colors = new Set(navGroups.map(satelliteClassColor));
  assert.equal(colors.size, 1, 'GPS, GLONASS and Galileo must read as one NAV family');
  assert.equal([...colors][0], SATELLITE_CLASSES.nav.color);

  assert.equal(satelliteClassLabel('gps-ops'), 'NAV · GPS');
  assert.equal(satelliteClassLabel('glonass'), 'NAV · GLONASS');
  assert.equal(satelliteClassLabel('galileo'), 'NAV · GALILEO');
});

test('class labels name the type, and the ISS names itself', () => {
  assert.equal(satelliteClassLabel('geo'), 'GEO');
  assert.equal(satelliteClassLabel('weather'), 'GEO · WX');
  assert.equal(satelliteClassLabel('stations'), 'STATION');
  assert.equal(satelliteClassLabel('visual'), 'VISUAL');
  assert.equal(satelliteClassLabel('dense'), 'COMMS · STARLINK');
  assert.equal(satelliteClassLabel('stations', { isIss: true }), 'STATION · ISS');
});

test('the ISS is a STATION whichever group a partial outage ingested it from', () => {
  // CelesTrak lists the ISS in `visual` as well as `stations`, and a rebuild
  // survives a partial group failure. If the stations feed drops, the ISS is
  // ingested as `visual` — its card must not then read "VISUAL · ISS" beside
  // the red station dot.
  assert.equal(satelliteClassLabel('visual', { isIss: true }), 'STATION · ISS');
  assert.equal(satelliteClassLabel('geo', { isIss: true }), 'STATION · ISS');
  assert.equal(satelliteClassLabel(undefined, { isIss: true }), 'STATION · ISS');
  // Non-ISS satellites in those groups are unaffected.
  assert.equal(satelliteClassLabel('visual'), 'VISUAL');
});

test('an unknown group falls back to the neutral bucket instead of vanishing', () => {
  assert.equal(satelliteClassOf('analyst').klass, 'visual');
  assert.equal(satelliteClassOf(undefined).klass, 'visual');
  assert.equal(satelliteClassColor(null), SATELLITE_CLASSES.visual.color);
  assert.equal(satelliteClassLabel('some-new-celestrak-group'), 'VISUAL');
});

test('class colors are distinct, valid, and never borrow the military amber', () => {
  const colors = SATELLITE_CLASS_ORDER.map((k) => SATELLITE_CLASSES[k].color);
  assert.equal(new Set(colors).size, colors.length, 'two classes share a color');
  for (const color of colors) {
    assert.match(color, /^#[0-9a-f]{6}$/, `${color} is not a 6-digit hex`);
  }
  // Amber 40-48deg is the app-wide known-military convention (flights.js
  // MIL_TINT #FFB800 / militaryFlights.js #FFB800 + #FFD166). A satellite
  // class landing there would read as a military air contact.
  const hueOf = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return 0;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return ((h * 60) + 360) % 360;
  };
  const saturationOf = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === 0) return 0;
    return (max - min) / max;
  };
  for (const klass of SATELLITE_CLASS_ORDER) {
    const color = SATELLITE_CLASSES[klass].color;
    const amberish = hueOf(color) >= 35 && hueOf(color) <= 50 && saturationOf(color) > 0.45;
    assert.equal(amberish, false, `${klass} (${color}) sits in the military amber band`);
  }
});

test('the dense shell stays dimmer than the class it sits among', () => {
  // NVG/FLIR collapse the scene to Rec.601 luma, and DENSE mode puts thousands
  // of COMMS points in the same LEO volume as VISUAL. Luma separation is what
  // keeps the core catalog readable through the dense shell.
  const luma = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };
  assert.ok(
    luma(SATELLITE_CLASSES.visual.color) - luma(SATELLITE_CLASSES.comms.color) > 0.2,
    'COMMS must stay well below VISUAL in luminance',
  );
  assert.ok(
    luma(SATELLITE_CLASSES.station.color) > luma(SATELLITE_CLASSES.visual.color),
    'STATION is the brightest core class',
  );
});

test('tallying groups counts by class, folding the GNSS constellations together', () => {
  const counts = tallySatelliteClasses([
    'gps-ops', 'gps-ops', 'glonass', 'galileo',
    'geo', 'geo', 'geo',
    'stations',
    'visual',
    'dense', 'dense',
  ]);
  assert.equal(counts.nav, 4, 'all three GNSS groups fold into NAV');
  assert.equal(counts.geo, 3);
  assert.equal(counts.station, 1);
  assert.equal(counts.visual, 1);
  assert.equal(counts.comms, 2);
});

test('tallying tolerates an empty or missing input', () => {
  assert.deepEqual({ ...tallySatelliteClasses([]) }, {});
  assert.deepEqual({ ...tallySatelliteClasses(undefined) }, {});
});

test('the tally files the ISS under STATION even when a partial outage moved it', () => {
  // The legend and the card must never disagree. With the stations feed down,
  // the ISS is ingested as `visual`; counting it there would let STATION vanish
  // from the legend while the tracked card still reads "STATION · ISS".
  const outage = tallySatelliteClasses([
    { group: 'visual', isIss: true },
    { group: 'visual' },
    { group: 'visual' },
  ]);
  assert.equal(outage.station, 1, 'the ISS is counted as a STATION');
  assert.equal(outage.visual, 2, 'and is not double-counted under VISUAL');

  const legend = satelliteClassLegend(outage);
  assert.equal(legend.some((row) => row.klass === 'station'), true,
    'STATION stays in the legend, matching the card');

  // Bare group tags still work — the descriptor form is additive.
  assert.deepEqual({ ...tallySatelliteClasses(['visual', 'visual']) }, { visual: 2 });
  assert.equal(satelliteClassOf('visual', { isIss: true }).klass, 'station',
    'one helper owns the rule for every consumer');
});

test('the legend lists present classes in order and omits absent ones', () => {
  const legend = satelliteClassLegend(tallySatelliteClasses(['geo', 'gps-ops', 'stations']));
  assert.deepEqual(legend.map((row) => row.klass), ['station', 'nav', 'geo'],
    'legend follows SATELLITE_CLASS_ORDER, not input order');
  // COMMS only exists in DENSE mode — the legend must not advertise a class
  // that has nothing on screen.
  assert.equal(legend.some((row) => row.klass === 'comms'), false);

  const row = legend.find((entry) => entry.klass === 'nav');
  assert.equal(row.label, 'NAV');
  assert.equal(row.color, SATELLITE_CLASSES.nav.color);
  assert.equal(row.count, 1);
  assert.ok(row.blurb.length > 0, 'every legend row carries a plain-language gloss');
});

test('the legend drops zero and negative counts', () => {
  assert.deepEqual(satelliteClassLegend({ nav: 0, geo: -1, station: 2 }).map((r) => r.klass), ['station']);
  assert.deepEqual(satelliteClassLegend(null), []);
});

test('the Core | Dense chips are stateless and declare the params to apply', () => {
  // The chips never carry their own state: they declare the params to apply, so
  // whatever else drives the catalog param (Space Missions capture/restore)
  // stays authoritative. Whether Dense reads ACTIVE is decided by the dense
  // LOAD, not the param — see the load-lifecycle tests below.
  try {
    _setDenseCatalogStateForTest({});
    const core = catalogChip('catalog-core');
    const dense = catalogChip('catalog-dense');
    assert.equal(core.label, 'Core');
    assert.equal(core.active, true);
    assert.deepEqual(core.params, { catalog: 'core' });
    assert.equal(dense.id, 'catalog-dense');
    assert.equal(dense.label, 'Dense');
    assert.equal(dense.active, false);
    assert.equal(dense.busy, false);
    assert.equal(dense.state, 'idle');
    assert.deepEqual(dense.params, { catalog: 'dense' }, 'clicking Dense requests dense');
    assert.ok(dense.title.length > 0, 'the chip explains itself on hover');
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('an invalid catalog mode is rejected without disturbing the chip', () => {
  satellitesLayer.setParams({ catalog: 'core' });
  satellitesLayer.setParams({ catalog: 'everything' });
  assert.equal(satellitesLayer.getParams().catalog, 'core');
  const chip = catalogChip('catalog-dense');
  assert.equal(chip.active, false);
});

test('DENSE reports loading, then ACTIVE only once the points exist', async () => {
  const originalFetch = globalThis.fetch;
  const refreshes = [];
  try {
    globalThis.fetch = async () => ({ ok: true, text: async () => DENSE_TLE });
    _setDenseCatalogStateForTest({});
    satellitesLayer.setRowControlsListener(() => refreshes.push(satellitesLayer.getRowControls()));

    satellitesLayer.setParams({ catalog: 'dense' });
    // The param flips synchronously, but the shell has not arrived yet — the
    // chip must say BUSY, never ACTIVE.
    const pending = catalogChip('catalog-dense');
    assert.equal(pending.busy, true);
    assert.equal(pending.disabled, true);
    assert.equal(pending.active, false, 'never active before the points exist');
    assert.equal(pending.state, 'loading');
    assert.equal(catalogChip('catalog-core').active, false, 'Core is not active while Dense is loading');

    const settled = await settleChip();
    assert.equal(settled.active, true, 'active once the dense points are on screen');
    assert.equal(settled.state, 'active');
    assert.equal(settled.label, 'Dense');
    assert.deepEqual(settled.params, { catalog: 'dense' }, 'a settled Dense chip still requests dense');
    assert.equal(catalogChip('catalog-core').active, false);

    // The completion pushed a refresh, and the legend gained COMMS with it —
    // without that push the row would keep the pre-load counts for 5 minutes.
    assert.ok(refreshes.length >= 2, 'load start and load completion each pushed a refresh');
    const legend = satellitesLayer.getRowControls().legend;
    assert.equal(legend.some((row) => row.klass === 'comms'), true);
  } finally {
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('a failed DENSE load reverts the mode rather than leaving an active chip', async () => {
  const originalFetch = globalThis.fetch;
  const warn = console.warn;
  console.warn = () => {};
  try {
    globalThis.fetch = async () => ({ ok: false, status: 502 });
    _setDenseCatalogStateForTest({});
    let pushes = 0;
    satellitesLayer.setRowControlsListener(() => { pushes += 1; });

    satellitesLayer.setParams({ catalog: 'dense' });
    const settled = await settleChip();

    assert.equal(settled.active, false, 'a 502 must never present as a live dense catalog');
    assert.equal(settled.state, 'error');
    assert.equal(settled.label, 'Dense ✕');
    assert.match(settled.title, /502/, 'the chip explains why');
    assert.equal(satellitesLayer.getParams().catalog, 'core', 'the mode reverts to reality');
    assert.deepEqual(settled.params, { catalog: 'dense' }, 'clicking retries');
    assert.equal(
      satellitesLayer.getRowControls().legend.some((row) => row.klass === 'comms'),
      false,
      'no COMMS class is advertised when nothing loaded',
    );
    assert.ok(pushes >= 2, 'the failure pushed its own refresh');

    // Retrying against a healthy feed clears the error — it does not latch.
    globalThis.fetch = async () => ({ ok: true, text: async () => DENSE_TLE });
    satellitesLayer.setParams(settled.params);
    const recovered = await settleChip();
    assert.equal(recovered.state, 'active');
    assert.equal(recovered.active, true);
    assert.doesNotMatch(recovered.title, /502/, 'the stale failure reason is gone');
  } finally {
    console.warn = warn;
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('a 200 that yields no usable satellites is a failure, not a live catalog', async () => {
  // The round-1 fix caught the 502. A healthy response carrying an empty body,
  // an HTML error page the proxy passed through, or only satellites the core
  // catalog already owns reaches the same lie through a different door.
  const originalFetch = globalThis.fetch;
  const warn = console.warn;
  console.warn = () => {};
  const bodies = {
    empty: '',
    html: '<!DOCTYPE html><html><body>502 Bad Gateway</body></html>',
    junk: 'NOT-A-TLE\nstill not a tle\nnope',
  };
  try {
    for (const [name, body] of Object.entries(bodies)) {
      globalThis.fetch = async () => ({ ok: true, text: async () => body });
      _setDenseCatalogStateForTest({});
      satellitesLayer.setParams({ catalog: 'dense' });
      const chip = await settleChip();
      assert.equal(chip.active, false, `${name}: never active with zero dense points`);
      assert.equal(chip.state, 'error', `${name}: reported as a failure`);
      assert.equal(satellitesLayer.getParams().catalog, 'core', `${name}: mode reverted`);
      assert.match(chip.title, /no satellites/, `${name}: says why`);
      _clearDenseCatalogStateForTest();
    }

    // The same guard fires when every TLE is already in the core catalog, so
    // "added nothing" can never masquerade as "loaded".
    globalThis.fetch = async () => ({ ok: true, text: async () => DENSE_TLE });
    _setDenseCatalogStateForTest({});
    satellitesLayer.setParams({ catalog: 'dense' });
    assert.equal((await settleChip()).state, 'active', 'a real feed still loads');
    _clearDenseCatalogStateForTest();
  } finally {
    console.warn = warn;
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('an explicit return to core clears a failure the user never caused', async () => {
  // Space Missions forces dense; if that load fails it reverts the param to
  // core itself. The mission's restore of an already-core snapshot then changes
  // nothing — and used to leave DENSE ✕ latched on the user's row.
  const originalFetch = globalThis.fetch;
  const warn = console.warn;
  console.warn = () => {};
  try {
    globalThis.fetch = async () => ({ ok: false, status: 502 });
    _setDenseCatalogStateForTest({});
    satellitesLayer.setParams({ catalog: 'dense' });
    assert.equal((await settleChip()).state, 'error');
    assert.equal(satellitesLayer.getParams().catalog, 'core', 'the failure already reverted it');

    // A no-op restore of the pre-mission snapshot.
    satellitesLayer.setParams({ catalog: 'core', showPoints: true, showOrbits: true });
    const restored = catalogChip('catalog-dense');
    assert.equal(restored.state, 'idle', 'the error does not survive the restore');
    assert.equal(restored.label, 'Dense');
    assert.doesNotMatch(restored.title, /502/);
    assert.equal(catalogChip('catalog-core').active, true);
  } finally {
    console.warn = warn;
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('a real stations-feed outage keeps STATION in the legend, matching the card', async () => {
  // End-to-end version of the tally rule: drive a real rebuild in which only
  // the `visual` group answers, so the ISS is genuinely ingested as `visual`.
  // The legend must still file it under STATION or it disagrees with the card.
  const originalFetch = globalThis.fetch;
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    resetSatGroupCache();
    setSatGroup('visual', { getItem: () => 'visual', setItem() {} });
    _setDenseCatalogStateForTest({});
    const viewer = { scene: { primitives: { add: (p) => p, remove() {} } } };
    globalThis.fetch = async (url) => ({
      ok: true,
      text: async () => (String(url).endsWith('/visual') ? ISS_TLE : ''),
    });

    await satellitesLayer.update(viewer);
    assert.equal(_catalogGroupForTest(25544), 'visual',
      'the outage really did ingest the ISS from the visual group');

    const legend = satellitesLayer.getRowControls().legend;
    assert.equal(legend.find((row) => row.klass === 'station')?.count, 1,
      'STATION survives the outage because the ISS is counted there');
    assert.equal(legend.some((row) => row.klass === 'visual'), false,
      'and it is not also counted under VISUAL');
    assert.equal(satelliteClassLabel('visual', { isIss: true }), 'STATION · ISS',
      'the card says the same thing the legend does');
  } finally {
    console.log = log;
    console.warn = warn;
    globalThis.fetch = originalFetch;
    resetSatGroupCache();
    _clearDenseCatalogStateForTest();
  }
});

test('a catalog rebuild refreshes the detection overlay class strings', async () => {
  // The overlay caches one record per satellite and stamps id/class at
  // creation. A rebuild can re-tag a satellite (whichever group survives an
  // outage wins dedupe), so a cache that outlives the catalog shows the old
  // class forever.
  const originalFetch = globalThis.fetch;
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    resetSatGroupCache();
    const storage = {
      getItem: () => currentGroup,
      setItem(_key, value) { currentGroup = String(value); },
    };
    let currentGroup = 'geo';
    setSatGroup('geo', storage);
    _setDenseCatalogStateForTest({});
    const viewer = { scene: { primitives: { remove() {} } } };
    globalThis.fetch = async (url) => ({
      ok: true,
      text: async () => (String(url).endsWith(`/${currentGroup}`) ? ALT_TLE : ''),
    });

    await satellitesLayer.update(viewer);
    const first = satellitesLayer.getDetectableObjects().find((o) => o.sourceId === 33333);
    assert.ok(first, 'the seeded satellite is collectable');
    assert.equal(first.klass, 'GEO');

    setSatGroup('visual', storage);
    await satellitesLayer.update(viewer);
    const second = satellitesLayer.getDetectableObjects().find((o) => o.sourceId === 33333);
    assert.equal(second.klass, 'VISUAL', 'the cached record does not outlive its catalog');
  } finally {
    console.log = log;
    console.warn = warn;
    globalThis.fetch = originalFetch;
    resetSatGroupCache();
    _clearDenseCatalogStateForTest();
  }
});

test('a dependency owner hiding the points surrenders the whole row', async () => {
  try {
    _setDenseCatalogStateForTest({});
    assert.equal(satellitesLayer.getRowControls().chips.length, 8);

    // Space Missions borrows this layer for TLE lookup with showPoints:false.
    satellitesLayer.setParams({ showPoints: false });
    const owned = satellitesLayer.getRowControls();
    assert.deepEqual(owned.chips, [], 'no chip to click while the owner holds the params');
    assert.deepEqual(owned.legend, [], 'no legend describing an empty sky');
    assert.equal(owned.readout, undefined, 'ISS readout leaves with the surrendered row');

    satellitesLayer.setParams({ showPoints: true });
    assert.equal(satellitesLayer.getRowControls().chips.length, 8, 'released on restore');
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('class chips follow SATELLITE_CLASS_ORDER and default all on', () => {
  assert.deepEqual(SATELLITE_CLASS_CHIP_IDS, SATELLITE_CLASS_ORDER);
  assert.deepEqual(SATELLITE_CLASS_CHIP_LABELS, {
    station: 'STATION',
    nav: 'NAV',
    geo: 'GEO',
    visual: 'VISUAL',
    comms: 'COMMS',
  });
  assert.equal(DEFAULT_SATELLITE_CLASS_FILTER, 'sngvc');
  assert.deepEqual(SATELLITE_CLASS_CHIP_CODES, {
    station: 's',
    nav: 'n',
    geo: 'g',
    visual: 'v',
    comms: 'c',
  });
  assert.equal(normalizeSatelliteClassFilter(null), DEFAULT_SATELLITE_CLASS_FILTER);
  assert.equal(toggleSatelliteClassFilter(DEFAULT_SATELLITE_CLASS_FILTER, 'nav'), 'sgvc');
  assert.equal(toggleSatelliteClassFilter('sgvc', 'nav'), DEFAULT_SATELLITE_CLASS_FILTER);
  assert.equal(toggleSatelliteClassFilter('s', 'station'), '0');
});

test('all-on class chips match the current catalog', () => {
  try {
    seedCatalog();
    const ids = CATALOG.filter((sat) => sat.group !== 'dense').map((sat) => sat.noradId);
    assert.equal(satellitesLayer.getParams().satelliteClassFilter, DEFAULT_SATELLITE_CLASS_FILTER);
    assert.deepEqual(visibleIds(), ids.sort((a, b) => a - b));
    assert.deepEqual(
      filterSatellitesByClass(CATALOG.filter((sat) => sat.group !== 'dense'), DEFAULT_SATELLITE_CLASS_FILTER)
        .map((sat) => sat.noradId)
        .sort((a, b) => a - b),
      ids.sort((a, b) => a - b),
    );
    for (const klass of SATELLITE_CLASS_ORDER) {
      const chip = classChip(klass);
      assert.ok(chip, `${klass} chip sits on the satellite row`);
      assert.equal(chip.label, SATELLITE_CLASSES[klass].label);
      assert.equal(chip.active, true);
    }
    const chips = satellitesLayer.getRowControls().chips.map((chip) => chip.id);
    assert.deepEqual(
      chips.slice(0, 2),
      ['catalog-core', 'catalog-dense'],
      'class chips sit next to Core | Dense',
    );
    assert.deepEqual(
      SATELLITE_CLASS_ORDER.map((klass) => `class-${klass}`),
      chips.slice(2, 7),
    );
    assert.equal(chips[7], 'orbits');
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('NAV off hides GPS/GLONASS/Galileo and keeps STATION/GEO', () => {
  const navOff = toggleSatelliteClassFilter(DEFAULT_SATELLITE_CLASS_FILTER, 'nav');
  assert.equal(satelliteClassFilterFlags(navOff).nav, false);
  assert.equal(satellitePassesClassFilter({ group: 'gps-ops', noradId: 32222 }, navOff), false);
  assert.equal(satellitePassesClassFilter({ group: 'glonass', noradId: 32223 }, navOff), false);
  assert.equal(satellitePassesClassFilter({ group: 'galileo', noradId: 32224 }, navOff), false);
  assert.equal(satellitePassesClassFilter({ group: 'stations', noradId: ISS_NORAD }, navOff, {
    isIss: true,
  }), true);
  assert.equal(satellitePassesClassFilter({ group: 'geo', noradId: 40000 }, navOff), true);

  try {
    seedCatalog();
    satellitesLayer.setParams({ satelliteClassFilter: navOff });
    const visible = visibleIds();
    assert.equal(visible.includes(32222), false);
    assert.equal(visible.includes(32223), false);
    assert.equal(visible.includes(32224), false);
    assert.equal(visible.includes(ISS_NORAD), true);
    assert.equal(visible.includes(40000), true);
    assert.equal(classChip('nav').active, false);
    assert.equal(classChip('station').active, true);
    assert.equal(classChip('geo').active, true);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('a class chip change re-applies in-memory points and does not refetch CelesTrak', () => {
  const fetches = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      fetches.push(String(url));
      return { ok: true, text: async () => '' };
    };
    seedCatalog();
    const before = _satelliteVisualStateForTest().pointIds.slice().sort((a, b) => a - b);
    satellitesLayer.setParams({ satelliteClassFilter: toggleSatelliteClassFilter(DEFAULT_SATELLITE_CLASS_FILTER, 'nav') });
    assert.deepEqual(fetches, []);
    assert.deepEqual(
      _satelliteVisualStateForTest().pointIds.slice().sort((a, b) => a - b),
      before,
      'the cached catalog stays in memory',
    );
    assert.equal(_catalogGroupForTest(ISS_NORAD), 'stations');
    assert.equal(_catalogGroupForTest(32222), 'gps-ops');
  } finally {
    globalThis.fetch = originalFetch;
    _clearDenseCatalogStateForTest();
  }
});

test('tracked ISS stays when STATION is off', () => {
  const stationOff = toggleSatelliteClassFilter(DEFAULT_SATELLITE_CLASS_FILTER, 'station');
  assert.equal(satellitePassesClassFilter({ group: 'stations', noradId: ISS_NORAD }, stationOff, {
    isIss: true,
  }), false);
  assert.equal(satellitePassesClassFilter({ group: 'stations', noradId: ISS_NORAD }, stationOff, {
    isIss: true,
    trackedNorad: ISS_NORAD,
  }), true);

  try {
    seedCatalog({ trackedNorad: ISS_NORAD });
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, ISS_NORAD);
    satellitesLayer.setParams({ satelliteClassFilter: stationOff });
    assert.equal(satellitesLayer.getParams().selectedSatTrackingId, ISS_NORAD,
      'class chips never drop the tracked satellite');
    assert.equal(_catalogGroupForTest(ISS_NORAD), 'stations');
    assert.equal(_satelliteVisualStateForTest().pointShows[ISS_NORAD], false,
      'the tracked primitive stays hidden because the entity owns the dot');
    assert.equal(visibleIds().includes(40000), true, 'untracked GEO stays');
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('COMMS is a no-op in Core and hides the Starlink shell in Dense', () => {
  const commsOff = toggleSatelliteClassFilter(DEFAULT_SATELLITE_CLASS_FILTER, 'comms');
  try {
    seedCatalog({ catalog: 'core' });
    const coreBefore = visibleIds();
    satellitesLayer.setParams({ satelliteClassFilter: commsOff });
    assert.deepEqual(visibleIds(), coreBefore, 'Core has no COMMS class to hide');
    assert.equal(classChip('comms').active, false);
    assert.equal(_catalogGroupForTest(44444), undefined);

    seedCatalog({ catalog: 'dense' });
    satellitesLayer.setParams({ satelliteClassFilter: DEFAULT_SATELLITE_CLASS_FILTER });
    assert.equal(visibleIds().includes(44444), true);
    satellitesLayer.setParams({ satelliteClassFilter: commsOff });
    assert.equal(visibleIds().includes(44444), false, 'Dense + COMMS off hides Starlink');
    assert.equal(visibleIds().includes(ISS_NORAD), true);
    assert.equal(_catalogGroupForTest(44444), 'dense', 'the shell stays cached');
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('orbits on/off stay independent of class chips', () => {
  const navOff = toggleSatelliteClassFilter(DEFAULT_SATELLITE_CLASS_FILTER, 'nav');
  try {
    _setSatellitePresentationForTest({
      catalog: 'core',
      showPoints: true,
      showOrbits: true,
      points: [ISS_NORAD, 32222],
      orbits: [ISS_NORAD],
      groups: { [32222]: 'gps-ops' },
    });
    satellitesLayer.setParams({ satelliteClassFilter: navOff });
    let state = _satelliteVisualStateForTest();
    assert.equal(state.showOrbits, true);
    assert.equal(state.orbitShows[ISS_NORAD], true);
    assert.equal(state.pointShows[32222], false);
    assert.equal(state.pointShows[ISS_NORAD], true);

    satellitesLayer.setParams({ showOrbits: false });
    state = _satelliteVisualStateForTest();
    assert.equal(state.showOrbits, false);
    assert.equal(state.orbitShows[ISS_NORAD], false);
    assert.equal(state.pointShows[32222], false);
    assert.equal(state.pointShows[ISS_NORAD], true);
    assert.equal(state.satelliteClassFilter, navOff);

    satellitesLayer.setParams({ showOrbits: true });
    state = _satelliteVisualStateForTest();
    assert.equal(state.showOrbits, true);
    assert.equal(state.orbitShows[ISS_NORAD], true);
    assert.equal(state.pointShows[32222], false);
    assert.equal(satellitesLayer.getParams().catalog, 'core');
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('class chips persist through the existing satellites layerState option', () => {
  assert.equal(
    normalizeLayerState({}).options.satellites.satelliteClassFilter,
    DEFAULT_SATELLITE_CLASS_FILTER,
  );
  const hiddenNav = normalizeLayerState({
    enabledLayerIds: ['satellites'],
    options: { satellites: { satelliteClassFilter: 'sgvc' } },
  });
  assert.equal(hiddenNav.options.satellites.satelliteClassFilter, 'sgvc');
  const params = encodeLayerStateParams(new URLSearchParams('v=2'), hiddenNav);
  assert.match(params.get('lo') || '', /s\.k\.sgvc/);

  const allOn = normalizeLayerState({
    enabledLayerIds: ['satellites'],
    options: { satellites: { satelliteClassFilter: DEFAULT_SATELLITE_CLASS_FILTER } },
  });
  const omitted = encodeLayerStateParams(new URLSearchParams('v=2'), allOn);
  assert.doesNotMatch(omitted.get('lo') || '', /s\.k\./, 'all-on is the omitted default');
});

test('class chips do not add an endpoint and keep Meridian / MIT credit', () => {
  const satellites = readFileSync(path.join(ROOT, 'src/data/satellites.js'), 'utf8');
  const filter = readFileSync(path.join(ROOT, 'src/data/satelliteClassFilter.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(satellites, /satelliteClassFilter/);
  assert.match(layerState, /satelliteClassFilter/);
  assert.doesNotMatch(satellites, /\/api\/(?!celestrak)/);
  assert.doesNotMatch(filter, /\/api\//);
  assert.doesNotMatch(filter, /opensky|google news|telegeography|quantum-earth|gev rename/i);
  assert.doesNotMatch(satellites, /opensky-network\.org|google\.com\/news|telegeography|quantum-earth/i);
  assert.ok(readdirSync(path.join(ROOT, 'api')).includes('celestrak'));
  assert.equal(readdirSync(path.join(ROOT, 'api')).includes('satellites'), false);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.equal(packageJson.name, 'meridian');
});
