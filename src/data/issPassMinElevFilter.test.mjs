// PLAN 197 — ISS pass min-elevation chips 10° | 30° | 40°.
// Persist meridian.issPassMinElev. Re-run findNextIssPass on the in-memory
// satrec. No extra CelesTrak fetch. Not an alert service.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { twoline2satrec } from 'satellite.js';
import { findNextIssPass } from './issPass.js';
import {
  DEFAULT_ISS_PASS_MIN_ELEV,
  ISS_PASS_MIN_ELEV_CHIPS,
  ISS_PASS_MIN_ELEV_STORAGE_KEY,
  getIssPassMinElev,
  issPassClearsMinElev,
  issPassMinElevChipModels,
  issPassMinElevDeg,
  normalizeIssPassMinElev,
  readIssPassMinElevPreference,
  resetIssPassMinElevCache,
  setIssPassMinElev,
  writeIssPassMinElevPreference,
} from './issPassMinElevFilter.js';
import {
  ISS_PASS_UNAVAILABLE,
  computeIssPassReadout,
  destroyIssPassReadout,
  initIssPassReadout,
  installIssPassMinElevRowControls,
  syncIssPassReadout,
} from './issPassReadout.js';
import satellitesLayer, {
  getNextIssPass,
  _clearDenseCatalogStateForTest,
  _setDenseCatalogStateForTest,
} from './satellites.js';
import { encodeLayerStateParams, normalizeLayerState } from './layerState.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const L1 = '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927';
const L2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537';
const AUSTIN = { latDeg: 30.2672, lonDeg: -97.7431 };
const FROM_MS = Date.UTC(2008, 8, 20, 12, 30, 0);
const GRAZING_FROM_MS = Date.UTC(2008, 8, 21, 23, 0, 0);

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

function seedIssCatalog() {
  _setDenseCatalogStateForTest({
    coreSats: [{
      noradId: 25544,
      name: 'ISS (ZARYA)',
      satrec: twoline2satrec(L1, L2),
      group: 'stations',
    }],
  });
}

test('10° is the default horizon cut and 10° | 30° | 40° are the shipped chips', () => {
  assert.equal(DEFAULT_ISS_PASS_MIN_ELEV, 10);
  assert.equal(ISS_PASS_MIN_ELEV_STORAGE_KEY, 'meridian.issPassMinElev');
  assert.deepEqual(ISS_PASS_MIN_ELEV_CHIPS.map((chip) => chip.id), [10, 30, 40]);
  assert.deepEqual(ISS_PASS_MIN_ELEV_CHIPS.map((chip) => chip.label), ['10°', '30°', '40°']);
  assert.equal(issPassMinElevDeg(10), 10);
  assert.equal(issPassMinElevDeg(30), 30);
  assert.equal(issPassMinElevDeg(40), 40);
  assert.equal(issPassMinElevDeg('nope'), 10);
});

test('normalize accepts only 10° | 30° | 40° chip floors', () => {
  assert.equal(normalizeIssPassMinElev(10), 10);
  assert.equal(normalizeIssPassMinElev('10'), 10);
  assert.equal(normalizeIssPassMinElev('10°'), 10);
  assert.equal(normalizeIssPassMinElev(30), 30);
  assert.equal(normalizeIssPassMinElev('30'), 30);
  assert.equal(normalizeIssPassMinElev('30°'), 30);
  assert.equal(normalizeIssPassMinElev(40), 40);
  assert.equal(normalizeIssPassMinElev('40'), 40);
  assert.equal(normalizeIssPassMinElev('40°'), 40);
  assert.equal(normalizeIssPassMinElev('nope'), 10);
  assert.equal(normalizeIssPassMinElev(12), 10);
  assert.equal(normalizeIssPassMinElev(undefined), 10);
  assert.equal(normalizeIssPassMinElev(null), 10);
});

test('30° skips a 12° peak and reports the next ≥30° pass; 10° keeps today\'s default', () => {
  const satrec = twoline2satrec(L1, L2);
  const omitted = findNextIssPass({ satrec, ...AUSTIN, fromMs: FROM_MS });
  const at10 = findNextIssPass({ satrec, ...AUSTIN, fromMs: FROM_MS, minElevDeg: 10 });
  assert.ok(omitted && at10);
  assert.equal(omitted.riseMs, at10.riseMs);
  assert.equal(omitted.maxElevMs, at10.maxElevMs);
  assert.ok(at10.maxElevDeg >= 10);

  const low = { maxElevDeg: 12 };
  const high = { maxElevDeg: 36 };
  assert.equal(issPassClearsMinElev(low, 10), true);
  assert.equal(issPassClearsMinElev(low, 30), false);
  assert.equal(issPassClearsMinElev(high, 30), true);
  assert.equal(issPassClearsMinElev(null, 30), false);

  const grazing = findNextIssPass({
    satrec, ...AUSTIN, fromMs: GRAZING_FROM_MS, minElevDeg: 10, horizonHours: 48,
  });
  const raised = findNextIssPass({
    satrec, ...AUSTIN, fromMs: GRAZING_FROM_MS, minElevDeg: 30, horizonHours: 48,
  });
  assert.ok(grazing, 'expected a 10° pass in the archived window');
  assert.ok(grazing.maxElevDeg > 12 && grazing.maxElevDeg < 13, 'first 10° pass peaks near 12°');
  assert.ok(raised, '30° must report the next ≥30° pass, not invent one');
  assert.ok(raised.riseMs > grazing.riseMs);
  assert.ok(raised.maxElevDeg >= 30);
  assert.equal(issPassClearsMinElev(grazing, 30), false);
  assert.equal(issPassClearsMinElev(raised, 30), true);
});

test('meridian.issPassMinElev persists and reload keeps the chip', () => {
  resetIssPassMinElevCache();
  const storage = memoryStorage();
  assert.equal(ISS_PASS_MIN_ELEV_STORAGE_KEY, 'meridian.issPassMinElev');
  assert.equal(readIssPassMinElevPreference(storage), DEFAULT_ISS_PASS_MIN_ELEV);
  assert.equal(writeIssPassMinElevPreference(30, storage), 30);
  assert.equal(storage.getItem(ISS_PASS_MIN_ELEV_STORAGE_KEY), '30');
  resetIssPassMinElevCache();
  assert.equal(getIssPassMinElev(storage), 30);
  assert.equal(setIssPassMinElev(40, storage), 40);
  resetIssPassMinElevCache();
  assert.equal(getIssPassMinElev(storage), 40);
  setIssPassMinElev(DEFAULT_ISS_PASS_MIN_ELEV, storage);
  assert.equal(storage.getItem(ISS_PASS_MIN_ELEV_STORAGE_KEY), '10');
  resetIssPassMinElevCache();
});

test('readout passes the selected minElevDeg into findNextIssPass and keeps UNAVAILABLE honest', () => {
  const calls = [];
  const low = {
    riseMs: GRAZING_FROM_MS + 60_000,
    maxElevDeg: 12,
    riseAzDeg: 90,
  };
  const high = {
    riseMs: GRAZING_FROM_MS + 3600_000,
    maxElevDeg: 36,
    riseAzDeg: 180,
  };
  const getPass = (args) => {
    calls.push(args.minElevDeg);
    if (issPassClearsMinElev(low, args.minElevDeg)) return { status: 'ok', pass: low };
    if (issPassClearsMinElev(high, args.minElevDeg)) return { status: 'ok', pass: high };
    return { status: 'none' };
  };

  resetIssPassMinElevCache();
  const at10 = computeIssPassReadout({
    ...AUSTIN,
    fromMs: GRAZING_FROM_MS,
    clockMode: 'utc',
    getPass,
    minElevDeg: 10,
  });
  assert.equal(at10.available, true);
  assert.equal(at10.peakElevDeg, 12);
  assert.deepEqual(calls, [10]);

  const at30 = computeIssPassReadout({
    ...AUSTIN,
    fromMs: GRAZING_FROM_MS,
    clockMode: 'utc',
    getPass,
    minElevDeg: 30,
  });
  assert.equal(at30.available, true);
  assert.equal(at30.peakElevDeg, 36);
  assert.deepEqual(calls, [10, 30]);

  assert.equal(computeIssPassReadout({
    ...AUSTIN,
    fromMs: GRAZING_FROM_MS,
    getPass: () => ({ status: 'none' }),
    minElevDeg: 40,
  }).text, ISS_PASS_UNAVAILABLE);
  assert.equal(computeIssPassReadout({
    ...AUSTIN,
    fromMs: GRAZING_FROM_MS,
    getPass: () => ({ status: 'no-tle' }),
    minElevDeg: 30,
  }).text, ISS_PASS_UNAVAILABLE);
});

test('exclusive chips sit on the Satellites row after install and write issPassMinElev', () => {
  resetIssPassMinElevCache();
  const storage = memoryStorage();
  const layer = {
    chips: [{ id: 'points', label: 'POINTS' }],
    getRowControls() {
      return { chips: this.chips.slice(), readout: { id: 'iss-pass-readout' } };
    },
    setParams() { return true; },
    getParams() { return { showPoints: true }; },
  };
  installIssPassMinElevRowControls(layer);
  const chips = layer.getRowControls().chips.filter((chip) => String(chip.id).startsWith('iss-elev-'));
  assert.deepEqual(chips.map((chip) => chip.id), ['iss-elev-10', 'iss-elev-30', 'iss-elev-40']);
  assert.deepEqual(chips.map((chip) => chip.label), ['10°', '30°', '40°']);
  assert.deepEqual(chips.map((chip) => chip.params.issPassMinElev), [10, 30, 40]);
  assert.equal(chips.every((chip) => chip.group === 'Elev'), true);
  assert.equal(chips.filter((chip) => chip.active).length, 1);
  assert.equal(chips.find((chip) => chip.id === 'iss-elev-10').active, true);

  layer.setParams({ issPassMinElev: 30 }, { storage });
  assert.equal(getIssPassMinElev(storage), 30);
  assert.equal(layer.getParams().issPassMinElev, 30);
  assert.equal(layer.getRowControls().chips.find((chip) => chip.id === 'iss-elev-30').active, true);
  assert.equal(layer.getRowControls().chips.filter((chip) => (
    String(chip.id).startsWith('iss-elev-') && chip.active
  )).length, 1);

  const models = issPassMinElevChipModels(40);
  assert.equal(models.find((chip) => chip.params.issPassMinElev === 40).active, true);
  assert.equal(models.filter((chip) => chip.active).length, 1);
});

test('a 30° chip re-runs the in-memory satrec and does not refetch CelesTrak', () => {
  const fetches = [];
  const originalFetch = globalThis.fetch;
  resetIssPassMinElevCache();
  const storage = memoryStorage();
  try {
    globalThis.fetch = async (url) => {
      fetches.push(String(url));
      return { ok: false, status: 502 };
    };
    seedIssCatalog();
    setIssPassMinElev(10, storage);
    const at10 = getNextIssPass({ ...AUSTIN, fromMs: GRAZING_FROM_MS, minElevDeg: 10 });
    assert.equal(at10.status, 'ok');
    assert.ok(at10.pass.maxElevDeg < 30);

    setIssPassMinElev(30, storage);
    const painted = computeIssPassReadout({
      ...AUSTIN,
      fromMs: GRAZING_FROM_MS,
      clockMode: 'utc',
      getPass: getNextIssPass,
    });
    assert.equal(painted.available, true);
    assert.ok(painted.peakElevDeg >= 30);
    assert.ok(painted.pass.riseMs > at10.pass.riseMs);
    assert.deepEqual(fetches, []);
  } finally {
    globalThis.fetch = originalFetch;
    resetIssPassMinElevCache();
    _clearDenseCatalogStateForTest();
  }
});

test('refresh keeps the chip set without adding a share-link field', () => {
  const storage = memoryStorage({ [ISS_PASS_MIN_ELEV_STORAGE_KEY]: '40' });
  resetIssPassMinElevCache();
  assert.equal(getIssPassMinElev(storage), 40, 'reload reads the persisted chip');
  const encoded = encodeLayerStateParams(new URLSearchParams('v=2'), normalizeLayerState({
    enabledLayerIds: ['satellites'],
    options: { satellites: { catalog: 'core' } },
  }));
  assert.doesNotMatch(encoded.get('lo') || '', /issPassMinElev|minElev/);
  assert.equal(normalizeLayerState({}).options.satellites.issPassMinElev, undefined);
  resetIssPassMinElevCache();
});

test('satellites.js is unchanged and chips are client-only', () => {
  const helper = readFileSync(path.join(ROOT, 'src/data/issPassMinElevFilter.js'), 'utf8');
  const readout = readFileSync(path.join(ROOT, 'src/data/issPassReadout.js'), 'utf8');
  const satellites = readFileSync(path.join(ROOT, 'src/data/satellites.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const markup = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  assert.match(helper, /meridian\.issPassMinElev/);
  assert.match(helper, /issPassClearsMinElev/);
  assert.match(readout, /issPassMinElevChipModels/);
  assert.match(readout, /minElevDeg/);
  assert.match(ui, /layer: satellitesLayer/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(readout, /\/api\//);
  assert.doesNotMatch(helper, /\/api\/celestrak|celestrak\.com/i);
  assert.doesNotMatch(readout, /\/api\/celestrak|celestrak\.com/i);
  assert.doesNotMatch(helper, /opensky|google news|telegeography|quantum-earth|gev rename/i);
  assert.doesNotMatch(readout, /opensky|google news|telegeography|quantum-earth/i);
  assert.doesNotMatch(satellites, /issPassMinElev|ISS_PASS_MIN_ELEV|iss-elev-|issPassMinElevFilter/);
  assert.doesNotMatch(layerState, /issPassMinElev/);
  assert.doesNotMatch(markup, /issPassMinElev|iss-elev-10|iss-elev-30/);
  assert.doesNotMatch(ui, /issPassMinElev|iss-elev-10|iss-elev-30/);
  assert.equal(readdirSync(path.join(ROOT, 'api')).includes('iss-pass'), false);
  assert.match(license, /MIT License/);
  assert.match(license, /MERIDIAN NOTICE/);
  assert.match(pkg, /"name": "meridian"/);
  assert.match(readme, /# Meridian/);
});

test('installing chips on a satellites-row proxy does not change satellites.js source', () => {
  resetIssPassMinElevCache();
  try {
    const before = satellitesLayer.getRowControls().chips.map((chip) => chip.id);
    assert.equal(before.some((id) => String(id).startsWith('iss-elev-')), false,
      'satellites.js itself must not declare the elev chips');
    const layer = {
      getRowControls: () => satellitesLayer.getRowControls(),
      setParams: (params, options) => satellitesLayer.setParams(params, options),
      getParams: () => satellitesLayer.getParams(),
    };
    installIssPassMinElevRowControls(layer);
    const after = layer.getRowControls().chips;
    assert.deepEqual(after.filter((chip) => String(chip.id).startsWith('iss-elev-')).map((chip) => chip.id), [
      'iss-elev-10', 'iss-elev-30', 'iss-elev-40',
    ]);
    assert.ok(after.some((chip) => chip.id === 'points'));
    assert.ok(after.some((chip) => chip.id === 'catalog-core'));
    assert.equal(after.filter((chip) => String(chip.id).startsWith('iss-elev-') && chip.active).length, 1);
    assert.equal(
      satellitesLayer.getRowControls().chips.some((chip) => String(chip.id).startsWith('iss-elev-')),
      false,
      'the unpatched satellites module must stay chip-free',
    );
  } finally {
    resetIssPassMinElevCache();
    _clearDenseCatalogStateForTest();
  }
});

test('chip change on a row proxy recomputes from the loaded satrec', () => {
  const fetches = [];
  const originalFetch = globalThis.fetch;
  resetIssPassMinElevCache();
  const storage = memoryStorage();
  const root = {
    hidden: true,
    textContent: ISS_PASS_UNAVAILABLE,
    title: '',
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
  };
  const layer = {
    getRowControls: () => satellitesLayer.getRowControls(),
    setParams: (params, options) => satellitesLayer.setParams(params, options),
    getParams: () => satellitesLayer.getParams(),
  };
  try {
    globalThis.fetch = async (url) => {
      fetches.push(String(url));
      return { ok: false, status: 502 };
    };
    seedIssCatalog();
    installIssPassMinElevRowControls(layer);
    initIssPassReadout({
      viewer: {
        camera: {
          positionCartographic: {
            latitude: AUSTIN.latDeg * Math.PI / 180,
            longitude: AUSTIN.lonDeg * Math.PI / 180,
            height: 400,
          },
        },
      },
      getPass: getNextIssPass,
      isVisible: () => true,
      root,
      getFromMs: () => GRAZING_FROM_MS,
      layer,
      storage,
    });
    assert.match(root.textContent, /^ISS /);
    const first = root.textContent;
    layer.setParams({ issPassMinElev: 30 }, { storage });
    const second = syncIssPassReadout({ recompute: true });
    assert.equal(getIssPassMinElev(storage), 30);
    assert.ok(second.peakElevDeg >= 30);
    assert.notEqual(second.text, first);
    assert.deepEqual(fetches, []);
    assert.equal(
      satellitesLayer.getRowControls().chips.some((chip) => String(chip.id).startsWith('iss-elev-')),
      false,
    );
  } finally {
    destroyIssPassReadout();
    resetIssPassMinElevCache();
    _clearDenseCatalogStateForTest();
    globalThis.fetch = originalFetch;
  }
});
