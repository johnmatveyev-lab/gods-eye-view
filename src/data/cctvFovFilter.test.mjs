import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CCTV_FOV_CHIP_IDS,
  CCTV_FOV_STORAGE_KEY,
  CCTV_FOV_TIGHT_MAX_DEG,
  CCTV_FOV_WIDE_MIN_DEG,
  DEFAULT_CCTV_FOV_FILTER,
  effectiveCctvFovDeg,
  filterCctvSourcesByFov,
  normalizeCctvFovFilter,
  readCctvFovFilter,
  sourceMatchesCctvFov,
  writeCctvFovFilter,
} from './cctvFovFilter.js';
import { filterVisibleCctvSources } from './cctvHealthFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CATALOG = Object.freeze([
  {
    id: 'wide-1',
    name: 'Shibuya Crossing',
    city: 'Tokyo',
    cityId: 'tokyo',
    provider: 'OSM Camera Grid',
    fovDeg: 82,
    headingConfidence: 'high',
    feedType: 'hls',
    feedConfigured: true,
    sourceStatus: 'ok',
    calSource: null,
    poseSource: 'curated',
  },
  {
    id: 'tight-1',
    name: 'Rue de Rivoli',
    city: 'Paris',
    cityId: 'paris',
    provider: 'OSM Camera Grid',
    fovDeg: 66,
    headingConfidence: 'medium',
    feedType: 'image',
    feedConfigured: true,
    sourceStatus: 'ok',
    calSource: null,
    poseSource: 'curated',
  },
  {
    id: 'mid-1',
    name: 'Market & 5th',
    city: 'San Francisco',
    cityId: 'sf',
    provider: 'OSM Camera Grid',
    fovDeg: 72,
    headingConfidence: 'high',
    feedType: 'mp4',
    feedConfigured: true,
    sourceStatus: 'ok',
    calSource: null,
    poseSource: 'curated',
  },
  {
    id: 'missing-1',
    name: 'Unknown FOV',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    headingConfidence: 'high',
    feedType: 'hls',
    feedConfigured: true,
    sourceStatus: 'ok',
    calSource: 'manual',
    poseSource: 'curated',
  },
  {
    id: 'austin-tight',
    name: 'Downtown West',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    fovDeg: 69,
    headingConfidence: 'high',
    feedType: 'hls',
    feedConfigured: true,
    sourceStatus: 'ok',
    calSource: null,
    poseSource: null,
  },
  {
    id: 'austin-unhealthy',
    name: 'I-35 @ Riverside',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    fovDeg: 80,
    headingConfidence: 'high',
    feedType: 'mp4',
    feedConfigured: true,
    sourceStatus: 'error',
    calSource: null,
    poseSource: 'open-data',
  },
  {
    id: 'austin-no-feed',
    name: 'Seed prior',
    city: 'Austin',
    cityId: 'austin',
    provider: 'OSM Camera Grid',
    fovDeg: 88,
    headingConfidence: 'low',
    feedType: 'hls',
    feedConfigured: false,
    sourceStatus: 'unknown',
    calSource: null,
    poseSource: null,
  },
]);

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.hasOwn(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
  };
}

test('All restores the current catalog and is the default', () => {
  assert.deepEqual(CCTV_FOV_CHIP_IDS, ['all', 'wide', 'tight']);
  assert.equal(DEFAULT_CCTV_FOV_FILTER, 'all');
  assert.equal(normalizeCctvFovFilter(null), 'all');
  assert.equal(normalizeCctvFovFilter(''), 'all');
  assert.equal(normalizeCctvFovFilter('all'), 'all');
  assert.equal(normalizeCctvFovFilter('unknown'), 'all');
  assert.deepEqual(
    filterCctvSourcesByFov(CATALOG, 'all').map((source) => source.id),
    CATALOG.map((source) => source.id),
  );
  assert.deepEqual(
    filterVisibleCctvSources(CATALOG, { fov: 'all' }).map((source) => source.id),
    CATALOG.map((source) => source.id),
  );
});

test('fovDeg 82 matches Wide and fails Tight; fovDeg 66 matches Tight and fails Wide', () => {
  assert.equal(CCTV_FOV_WIDE_MIN_DEG, 75);
  assert.equal(CCTV_FOV_TIGHT_MAX_DEG, 70);
  assert.equal(effectiveCctvFovDeg({ fovDeg: 82 }), 82);
  assert.equal(effectiveCctvFovDeg({ fovDeg: 66 }), 66);
  assert.equal(sourceMatchesCctvFov({ fovDeg: 82 }, 'wide'), true);
  assert.equal(sourceMatchesCctvFov({ fovDeg: 82 }, 'tight'), false);
  assert.equal(sourceMatchesCctvFov({ fovDeg: 66 }, 'tight'), true);
  assert.equal(sourceMatchesCctvFov({ fovDeg: 66 }, 'wide'), false);
  assert.deepEqual(
    filterCctvSourcesByFov(CATALOG, 'wide').map((source) => source.id),
    ['wide-1', 'missing-1', 'austin-unhealthy', 'austin-no-feed'],
  );
  assert.deepEqual(
    filterCctvSourcesByFov(CATALOG, 'tight').map((source) => source.id),
    ['tight-1', 'missing-1', 'austin-tight'],
  );
});

test('70–75 band is neither Wide nor Tight; missing FOV stays visible', () => {
  assert.equal(sourceMatchesCctvFov({ fovDeg: 70 }, 'wide'), false);
  assert.equal(sourceMatchesCctvFov({ fovDeg: 70 }, 'tight'), false);
  assert.equal(sourceMatchesCctvFov({ fovDeg: 74.9 }, 'wide'), false);
  assert.equal(sourceMatchesCctvFov({ fovDeg: 75 }, 'wide'), true);
  assert.equal(sourceMatchesCctvFov({ fovDeg: 72 }, 'all'), true);
  assert.equal(sourceMatchesCctvFov({}, 'wide'), true);
  assert.equal(sourceMatchesCctvFov({ fovDeg: Number.NaN }, 'tight'), true);
  assert.equal(sourceMatchesCctvFov({ fovDeg: null }, 'wide'), true);
  assert.ok(filterCctvSourcesByFov(CATALOG, 'wide').some((source) => source.id === 'missing-1'));
  assert.ok(filterCctvSourcesByFov(CATALOG, 'tight').some((source) => source.id === 'missing-1'));
  assert.equal(filterCctvSourcesByFov(CATALOG, 'wide').some((source) => source.id === 'mid-1'), false);
  assert.equal(filterCctvSourcesByFov(CATALOG, 'tight').some((source) => source.id === 'mid-1'), false);
});

test('effective FOV uses catalog plus calibration offset and does not double-count pose', () => {
  assert.equal(effectiveCctvFovDeg({ fovDeg: 70, calibration: { fovDeg: 12 } }), 82);
  assert.equal(sourceMatchesCctvFov({ fovDeg: 70, calibration: { fovDeg: 12 } }, 'wide'), true);
  assert.equal(sourceMatchesCctvFov({ fovDeg: 70, calibration: { fovDeg: 12 } }, 'tight'), false);
  assert.equal(effectiveCctvFovDeg({
    fovDeg: 82,
    basePose: { fovDeg: 70 },
    calibration: { fovDeg: 12 },
  }), 82);
  assert.equal(sourceMatchesCctvFov({
    fovDeg: 82,
    basePose: { fovDeg: 70 },
    calibration: { fovDeg: 12 },
  }, 'wide'), true);
  assert.equal(effectiveCctvFovDeg({
    fovDeg: 66,
    basePose: { fovDeg: 74 },
    calibration: { fovDeg: -8 },
  }), 66);
  assert.equal(sourceMatchesCctvFov({
    fovDeg: 66,
    basePose: { fovDeg: 74 },
    calibration: { fovDeg: -8 },
  }, 'tight'), true);
});

test('selected camera stays even when its FOV chip is off', () => {
  const visible = filterCctvSourcesByFov(CATALOG, 'wide', { selectedId: 'tight-1' });
  assert.deepEqual(visible.map((source) => source.id), [
    'wide-1',
    'tight-1',
    'missing-1',
    'austin-unhealthy',
    'austin-no-feed',
  ]);
  assert.equal(sourceMatchesCctvFov(CATALOG[1], 'wide', { selectedId: 'tight-1' }), true);
});

test('FOV chips AND with city, Hide no feed, feed type, health, heading-confidence, cal badge', () => {
  const anded = filterVisibleCctvSources(CATALOG, {
    city: 'austin',
    hideNoFeed: true,
    feedType: 'video',
    hideUnhealthy: true,
    headingConfidence: { high: true, medium: true, low: true },
    calSource: { calibrated: true, curated: true, 'raw-prior': true },
    fov: 'wide',
  });
  assert.deepEqual(anded.map((source) => source.id), ['missing-1']);

  const tightAustin = filterVisibleCctvSources(CATALOG, {
    city: 'austin',
    headingConfidence: { high: true, medium: true, low: true },
    calSource: { calibrated: true, curated: true, 'raw-prior': true },
    fov: 'tight',
  });
  assert.deepEqual(tightAustin.map((source) => source.id), ['missing-1', 'austin-tight']);

  const cityStillAnds = filterVisibleCctvSources(CATALOG, {
    city: 'tokyo',
    fov: 'all',
  });
  assert.deepEqual(cityStillAnds.map((source) => source.id), ['wide-1']);

  const keepsSelectedTight = filterVisibleCctvSources(CATALOG, {
    city: 'austin',
    fov: 'wide',
    selectedId: 'austin-tight',
  });
  assert.ok(keepsSelectedTight.some((source) => source.id === 'austin-tight'));
  assert.ok(keepsSelectedTight.some((source) => source.id === 'missing-1'));
  assert.equal(keepsSelectedTight.some((source) => source.id === 'wide-1'), false);
});

test('FOV chips persist locally as meridian.cctvFov and round-trip', () => {
  assert.equal(CCTV_FOV_STORAGE_KEY, 'meridian.cctvFov');
  const storage = memoryStorage();
  assert.equal(readCctvFovFilter(storage), 'all');
  assert.equal(writeCctvFovFilter(storage, 'wide'), 'wide');
  assert.equal(storage.getItem(CCTV_FOV_STORAGE_KEY), 'wide');
  assert.equal(readCctvFovFilter(storage), 'wide');
  assert.equal(writeCctvFovFilter(storage, 'tight'), 'tight');
  assert.equal(readCctvFovFilter(storage), 'tight');
  assert.equal(writeCctvFovFilter(storage, 'all'), 'all');
  assert.equal(readCctvFovFilter(storage), 'all');
});

test('CCTV panel exposes exclusive All | Wide 75+ | Tight <70 chips on the visibility row', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const panel = html.match(/<div id="cctv-panel"[\s\S]*?<div id="scene-panel"/);
  assert.ok(panel, 'cctv-panel markup is missing');
  assert.match(panel[0], /id="cctv-fov-filter"/);
  assert.match(panel[0], /data-cctv-fov="all"[^>]*>All</);
  assert.match(panel[0], /data-cctv-fov="wide"[^>]*>Wide 75\+</);
  assert.match(panel[0], /data-cctv-fov="tight"[^>]*>Tight &lt;70</);
  assert.match(panel[0], /aria-label="CCTV field of view"/);
  const calAt = panel[0].indexOf('id="cctv-cal-source-filter"');
  const chipsAt = panel[0].indexOf('id="cctv-fov-filter"');
  const cameraAt = panel[0].indexOf('id="cctv-camera-select"');
  assert.ok(calAt < chipsAt && chipsAt < cameraAt,
    'FOV chips sit on the visibility row above the camera list');
  assert.match(ui, /data-cctv-fov/);
  assert.match(ui, /_cctvFov/);
  assert.match(ui, /writeCctvFovFilter/);
  assert.match(ui, /_cctvFovFilterEl\.hidden = !enabled/);
  assert.match(panel[0], /id="cctv-fov-filter"[^>]*hidden/);
  const visible = ui.match(/_visibleCctvCameras\(\) \{[\s\S]*?\n  \}/);
  assert.ok(visible, '_visibleCctvCameras is missing');
  assert.match(visible[0], /fov:\s*this\._cctvFov/);
});

test('chip change re-filters the cached catalog without another /api/cctv fetch', () => {
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const layer = readFileSync(path.join(ROOT, 'src/data/cctv.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/cctvFovFilter.js'), 'utf8');
  const chipHandler = ui.match(/for \(const button of this\._cctvFovBtns \|\| \[\]\) \{[\s\S]*?\n    \}/);
  assert.ok(chipHandler, 'FOV chip handler is missing');
  assert.match(chipHandler[0], /writeCctvFovFilter/);
  assert.match(chipHandler[0], /fov:/);
  assert.doesNotMatch(chipHandler[0], /\/api\/cctv\/sources/);
  assert.doesNotMatch(chipHandler[0], /\/api\/cctv\/health/);
  assert.doesNotMatch(chipHandler[0], /loadCameraSources/);

  assert.match(helper, /effectiveCctvFovDeg/);
  assert.match(helper, /export function effectiveCctvFovDeg/);
  assert.match(layer, /from '\.\/cctvFovFilter\.js'/);
  assert.match(layer, /sourceMatchesCctvFov/);
  assert.match(layer, /params\.fov != null/);
  const setter = layer.match(/if \(params\.fov != null\) \{[\s\S]*?\n    \}/);
  assert.ok(setter, 'setParams fov branch is missing');
  assert.doesNotMatch(setter[0], /loadCameraSources|SOURCE_ENDPOINT|\/api\/cctv\/sources|\/api\/cctv\/health/);
  assert.match(setter[0], /applyCatalogVisibility\(\)/);
  assert.doesNotMatch(`${helper}\n${ui}`, /\/api\/cctv\/fov|\/api\/cctv\/filter/);
});

test('FOV filter adds no /api and stays off banned sources', () => {
  const apiDir = path.join(ROOT, 'api');
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else files.push(path.relative(apiDir, absolute).split(path.sep).join('/'));
    }
  };
  visit(apiDir);
  assert.ok(files.some((file) => file.startsWith('cctv/')));
  assert.equal(existsSync(path.join(ROOT, 'api/cctv/fov.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/cctv/filter.js')), false);

  const helper = readFileSync(path.join(ROOT, 'src/data/cctvFovFilter.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.doesNotMatch(helper, /news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|TeleGeography/i);
  assert.doesNotMatch(helper, /\/api\/cctv\/fov|\/api\/cctv\/filter/);
});
