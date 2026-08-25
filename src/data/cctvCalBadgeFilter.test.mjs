import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CCTV_CAL_SOURCE_STORAGE_KEY,
  DEFAULT_CCTV_CAL_SOURCE_FILTER,
  deriveCalBadge,
  filterCctvSourcesByCalBadge,
  normalizeCctvCalBadgeFilter,
  readCctvCalBadgeFilter,
  sourceMatchesCalBadge,
  writeCctvCalBadgeFilter,
} from './cctvCalBadgeFilter.js';
import { filterVisibleCctvSources } from './cctvHealthFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CATALOG = Object.freeze([
  {
    id: 'manual-1',
    name: 'Congress @ 11th',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    calSource: 'manual',
    poseSource: 'curated',
    headingConfidence: 'high',
    feedType: 'hls',
    feedConfigured: true,
    sourceStatus: 'ok',
  },
  {
    id: 'curated-1',
    name: 'Shinjuku crossing',
    city: 'Tokyo',
    cityId: 'shinjuku',
    provider: 'Shinjuku pack',
    calSource: null,
    poseSource: 'curated',
    headingConfidence: 'medium',
    feedType: 'image',
    feedConfigured: true,
    sourceStatus: 'ok',
  },
  {
    id: 'raw-1',
    name: 'Lamar @ 5th',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    calSource: null,
    poseSource: null,
    headingConfidence: 'high',
    feedType: 'hls',
    feedConfigured: true,
    sourceStatus: 'ok',
  },
  {
    id: 'raw-unhealthy',
    name: 'I-35 @ Riverside',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    calSource: null,
    poseSource: 'open-data',
    headingConfidence: 'high',
    feedType: 'mp4',
    feedConfigured: true,
    sourceStatus: 'error',
  },
  {
    id: 'raw-no-feed',
    name: 'Seed prior',
    city: 'Austin',
    cityId: 'austin',
    provider: 'OSM Camera Grid',
    calSource: null,
    poseSource: null,
    headingConfidence: 'low',
    feedType: 'hls',
    feedConfigured: false,
    sourceStatus: 'unknown',
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

test('all-on calibration chips match the current catalog', () => {
  assert.deepEqual(DEFAULT_CCTV_CAL_SOURCE_FILTER, {
    calibrated: true,
    curated: true,
    'raw-prior': true,
  });
  assert.deepEqual(normalizeCctvCalBadgeFilter(null), {
    calibrated: true,
    curated: true,
    'raw-prior': true,
  });
  assert.deepEqual(normalizeCctvCalBadgeFilter('all'), {
    calibrated: true,
    curated: true,
    'raw-prior': true,
  });
  assert.deepEqual(normalizeCctvCalBadgeFilter({ 'raw-prior': false }), {
    calibrated: true,
    curated: true,
    'raw-prior': false,
  });
  assert.deepEqual(
    filterCctvSourcesByCalBadge(CATALOG, { calibrated: true, curated: true, 'raw-prior': true })
      .map((source) => source.id),
    CATALOG.map((source) => source.id),
  );
  assert.deepEqual(
    filterVisibleCctvSources(CATALOG, {
      calSource: { calibrated: true, curated: true, 'raw-prior': true },
    }).map((source) => source.id),
    CATALOG.map((source) => source.id),
  );
});

test('Raw off hides raw-prior cameras and keeps calibrated plus curated', () => {
  assert.equal(deriveCalBadge({ calSource: 'manual', poseSource: 'curated' }), 'calibrated');
  assert.equal(deriveCalBadge({ calSource: null, poseSource: 'curated' }), 'curated');
  assert.equal(deriveCalBadge({ calSource: null, poseSource: null }), 'raw-prior');
  assert.equal(deriveCalBadge({}), 'raw-prior');
  assert.equal(sourceMatchesCalBadge(CATALOG[2], { 'raw-prior': false }), false);
  assert.equal(sourceMatchesCalBadge(CATALOG[0], { 'raw-prior': false }), true);
  assert.equal(sourceMatchesCalBadge(CATALOG[1], { 'raw-prior': false }), true);
  assert.deepEqual(
    filterCctvSourcesByCalBadge(CATALOG, { calibrated: true, curated: true, 'raw-prior': false })
      .map((source) => source.id),
    ['manual-1', 'curated-1'],
  );
});

test('Calibrated-only keeps manual saves and drops curated plus raw-prior', () => {
  const onlyManual = { calibrated: true, curated: false, 'raw-prior': false };
  assert.deepEqual(normalizeCctvCalBadgeFilter('calibrated'), onlyManual);
  assert.deepEqual(
    filterCctvSourcesByCalBadge(CATALOG, onlyManual).map((source) => source.id),
    ['manual-1'],
  );
  assert.equal(sourceMatchesCalBadge(CATALOG[0], onlyManual), true);
  assert.equal(sourceMatchesCalBadge(CATALOG[1], onlyManual), false);
  assert.equal(sourceMatchesCalBadge(CATALOG[2], onlyManual), false);
});

test('selected raw-prior camera stays when Raw is unchecked', () => {
  const visible = filterCctvSourcesByCalBadge(
    CATALOG,
    { calibrated: true, curated: true, 'raw-prior': false },
    { selectedId: 'raw-1' },
  );
  assert.deepEqual(visible.map((source) => source.id), ['manual-1', 'curated-1', 'raw-1']);
  assert.equal(
    sourceMatchesCalBadge(CATALOG[2], { 'raw-prior': false }, { selectedId: 'raw-1' }),
    true,
  );
});

test('calibration chips AND with city, Hide no feed, feed type, Hide unhealthy, heading-confidence', () => {
  const anded = filterVisibleCctvSources(CATALOG, {
    city: 'austin',
    hideNoFeed: true,
    feedType: 'video',
    hideUnhealthy: true,
    headingConfidence: { high: true, medium: false, low: false },
    calSource: { calibrated: true, curated: true, 'raw-prior': true },
  });
  assert.deepEqual(anded.map((source) => source.id), ['manual-1']);

  const rawOff = filterVisibleCctvSources(CATALOG, {
    city: 'austin',
    hideNoFeed: true,
    feedType: 'video',
    headingConfidence: { high: true, medium: true, low: true },
    calSource: { calibrated: true, curated: true, 'raw-prior': false },
  });
  assert.deepEqual(rawOff.map((source) => source.id), ['manual-1']);
  assert.equal(rawOff.some((source) => deriveCalBadge(source) === 'raw-prior'), false);

  const calibratedOnlyKeepsSelectedRaw = filterVisibleCctvSources(CATALOG, {
    city: 'austin',
    calSource: { calibrated: true, curated: false, 'raw-prior': false },
    selectedId: 'raw-1',
  });
  assert.ok(calibratedOnlyKeepsSelectedRaw.some((source) => source.id === 'manual-1'));
  assert.ok(calibratedOnlyKeepsSelectedRaw.some((source) => source.id === 'raw-1'));
  assert.equal(calibratedOnlyKeepsSelectedRaw.some((source) => source.id === 'curated-1'), false);
});

test('calibration chips persist locally and round-trip', () => {
  assert.equal(CCTV_CAL_SOURCE_STORAGE_KEY, 'meridian.cctv.calSource');
  const storage = memoryStorage();
  assert.deepEqual(readCctvCalBadgeFilter(storage), {
    calibrated: true,
    curated: true,
    'raw-prior': true,
  });
  assert.deepEqual(
    writeCctvCalBadgeFilter(storage, { 'raw-prior': false }),
    { calibrated: true, curated: true, 'raw-prior': false },
  );
  assert.equal(
    storage.getItem(CCTV_CAL_SOURCE_STORAGE_KEY),
    JSON.stringify({ calibrated: true, curated: true, 'raw-prior': false }),
  );
  assert.deepEqual(readCctvCalBadgeFilter(storage), {
    calibrated: true,
    curated: true,
    'raw-prior': false,
  });
});

test('CCTV panel exposes Calibrated | Curated | Raw chips on the visibility row', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const panel = html.match(/<div id="cctv-panel"[\s\S]*?<div id="scene-panel"/);
  assert.ok(panel, 'cctv-panel markup is missing');
  assert.match(panel[0], /id="cctv-cal-source-filter"/);
  assert.match(panel[0], /data-cctv-cal-source="calibrated"[^>]*>Calibrated</);
  assert.match(panel[0], /data-cctv-cal-source="curated"[^>]*>Curated</);
  assert.match(panel[0], /data-cctv-cal-source="raw-prior"[^>]*>Raw</);
  assert.match(panel[0], /aria-label="CCTV calibration source"/);
  const hideAt = panel[0].indexOf('id="cctv-hide-unhealthy-btn"');
  const headingAt = panel[0].indexOf('id="cctv-heading-confidence-filter"');
  const chipsAt = panel[0].indexOf('id="cctv-cal-source-filter"');
  const cameraAt = panel[0].indexOf('id="cctv-camera-select"');
  assert.ok(hideAt < chipsAt && headingAt < chipsAt && chipsAt < cameraAt,
    'calibration chips sit on the visibility row above the camera list');
  assert.match(ui, /data-cctv-cal-source/);
  assert.match(ui, /_cctvCalSource/);
  assert.match(ui, /writeCctvCalBadgeFilter/);
  assert.match(ui, /calSource/);
  assert.match(ui, /_cctvCalSourceFilterEl\.hidden = !enabled/);
  assert.match(panel[0], /id="cctv-cal-source-filter"[^>]*hidden/);
  const visible = ui.match(/_visibleCctvCameras\(\) \{[\s\S]*?\n  \}/);
  assert.ok(visible, '_visibleCctvCameras is missing');
  assert.match(visible[0], /calSource:\s*this\._cctvCalSource/);
});

test('chip change re-filters the cached catalog without another /api/cctv fetch', () => {
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const layer = readFileSync(path.join(ROOT, 'src/data/cctv.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/cctvCalBadgeFilter.js'), 'utf8');
  const chipHandler = ui.match(/for \(const button of this\._cctvCalSourceBtns \|\| \[\]\) \{[\s\S]*?\n    \}/);
  assert.ok(chipHandler, 'calibration-source chip handler is missing');
  assert.match(chipHandler[0], /writeCctvCalBadgeFilter/);
  assert.match(chipHandler[0], /calSource:/);
  assert.doesNotMatch(chipHandler[0], /\/api\/cctv\/sources/);
  assert.doesNotMatch(chipHandler[0], /\/api\/cctv\/health/);
  assert.doesNotMatch(chipHandler[0], /loadCameraSources/);

  assert.match(helper, /deriveCalBadge\(source\)/);
  assert.match(helper, /export function deriveCalBadge/);
  assert.match(layer, /from '\.\/cctvCalBadgeFilter\.js'/);
  assert.match(layer, /sourceMatchesCalBadge/);
  assert.match(layer, /params\.calSource != null/);
  const setter = layer.match(/if \(params\.calSource != null\) \{[\s\S]*?\n    \}/);
  assert.ok(setter, 'setParams calSource branch is missing');
  assert.doesNotMatch(setter[0], /loadCameraSources|SOURCE_ENDPOINT|\/api\/cctv\/sources|\/api\/cctv\/health/);
  assert.match(setter[0], /applyCatalogVisibility\(\)/);
  assert.doesNotMatch(`${helper}\n${ui}`, /\/api\/cctv\/cal-source|\/api\/cctv\/calSource/);
});

test('calibration-source filter adds no /api and stays off banned sources', () => {
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
  assert.equal(existsSync(path.join(ROOT, 'api/cctv/cal-source.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/cctv/calSource.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/cctv/filter.js')), false);

  const helper = readFileSync(path.join(ROOT, 'src/data/cctvCalBadgeFilter.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
  assert.doesNotMatch(helper, /\/api\/cctv\/cal-source|\/api\/cctv\/filter/);
});
