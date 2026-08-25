import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CCTV_FEED_TYPE_STORAGE_KEY,
  DEFAULT_CCTV_FEED_TYPE_FILTER,
  cctvFeedTypeFamily,
  filterCctvSourcesByFeedType,
  filterVisibleCctvCatalog,
  normalizeCctvFeedTypeFilter,
  readCctvFeedTypeFilter,
  sourceHasCctvFeed,
  sourceMatchesFeedTypeFilter,
  writeCctvFeedTypeFilter,
} from './cctvFeedTypeFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CATALOG = Object.freeze([
  {
    id: 'still-1',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    feedType: 'image',
    feedConfigured: true,
    frameUrl: '/api/cctv/frame/still-1',
  },
  {
    id: 'mjpeg-1',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    feedType: 'mjpeg',
    feedConfigured: true,
    frameUrl: '/api/cctv/frame/mjpeg-1',
  },
  {
    id: 'mp4-1',
    city: 'London',
    cityId: 'london',
    provider: 'Transport for London',
    feedType: 'mp4',
    feedConfigured: true,
    frameUrl: '/api/cctv/frame/mp4-1',
  },
  {
    id: 'hls-1',
    city: 'Oakland',
    cityId: 'ca-d4',
    provider: 'Caltrans',
    feedType: 'hls',
    feedConfigured: true,
    frameUrl: '/api/cctv/frame/hls-1',
  },
  {
    id: 'webm-1',
    city: 'Los Angeles',
    cityId: 'ca-d7',
    provider: 'Caltrans',
    feedType: 'webm',
    feedConfigured: false,
    sourceStatus: 'no-feed',
    frameUrl: '/api/cctv/frame/webm-1',
  },
  {
    id: 'unknown-1',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    feedType: null,
    feedConfigured: true,
    frameUrl: '/api/cctv/frame/unknown-1',
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
    snapshot() {
      return { ...data };
    },
  };
}

test('all feed-type chips default on and match the current catalog', () => {
  assert.deepEqual(DEFAULT_CCTV_FEED_TYPE_FILTER, { image: true, mjpeg: true, video: true });
  assert.deepEqual(normalizeCctvFeedTypeFilter(null), { image: true, mjpeg: true, video: true });
  assert.deepEqual(normalizeCctvFeedTypeFilter('all'), { image: true, mjpeg: true, video: true });
  assert.deepEqual(normalizeCctvFeedTypeFilter({ image: false }), { image: false, mjpeg: true, video: true });
  assert.deepEqual(
    filterCctvSourcesByFeedType(CATALOG, { image: true, mjpeg: true, video: true }).map((source) => source.id),
    CATALOG.map((source) => source.id),
  );
});

test('Image off hides stills and keeps MJPEG and Video', () => {
  assert.equal(cctvFeedTypeFamily('image'), 'image');
  assert.equal(cctvFeedTypeFamily('jpeg'), 'image');
  assert.equal(cctvFeedTypeFamily('mjpeg'), 'mjpeg');
  assert.equal(cctvFeedTypeFamily('mjpg'), 'mjpeg');
  assert.equal(cctvFeedTypeFamily('mp4'), 'video');
  assert.equal(cctvFeedTypeFamily('hls'), 'video');
  assert.equal(cctvFeedTypeFamily('webm'), 'video');
  assert.equal(cctvFeedTypeFamily(null), null);

  const visible = filterCctvSourcesByFeedType(CATALOG, { image: false, mjpeg: true, video: true });
  assert.deepEqual(
    visible.map((source) => source.id),
    ['mjpeg-1', 'mp4-1', 'hls-1', 'webm-1', 'unknown-1'],
  );
  assert.equal(visible.some((source) => source.feedType === 'image'), false);
  assert.equal(sourceMatchesFeedTypeFilter(CATALOG[0], { image: false, mjpeg: true, video: true }), false);
  assert.equal(sourceMatchesFeedTypeFilter(CATALOG[1], { image: false, mjpeg: true, video: true }), true);
});

test('selected image camera stays when Image is off', () => {
  const visible = filterCctvSourcesByFeedType(CATALOG, { image: false, mjpeg: true, video: true }, {
    keepCameraId: 'still-1',
  });
  assert.deepEqual(
    visible.map((source) => source.id),
    ['still-1', 'mjpeg-1', 'mp4-1', 'hls-1', 'webm-1', 'unknown-1'],
  );
  const walkable = filterCctvSourcesByFeedType(CATALOG, { image: false, mjpeg: true, video: true });
  assert.equal(walkable.some((source) => source.id === 'still-1'), false);
});

test('Hide no feed + one city + Video still AND', () => {
  const visible = filterVisibleCctvCatalog(CATALOG, {
    city: 'Caltrans',
    feedTypes: { image: false, mjpeg: false, video: true },
    hideNoFeed: true,
  });
  assert.deepEqual(visible.map((source) => source.id), ['hls-1']);
  assert.equal(sourceHasCctvFeed(CATALOG[4]), false);
  assert.equal(visible.some((source) => source.id === 'webm-1'), false);
  assert.equal(visible.some((source) => source.cityId === 'austin'), false);
});

test('CCTV panel exposes Image | MJPEG | Video chips next to city / Hide no feed', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const panel = html.match(/<div id="cctv-panel"[\s\S]*?<div id="scene-panel"/);
  assert.ok(panel, 'cctv-panel markup is missing');
  assert.match(panel[0], /id="cctv-feed-type-filter"/);
  assert.match(panel[0], /data-cctv-feed-type="image"[^>]*>Image</);
  assert.match(panel[0], /data-cctv-feed-type="mjpeg"[^>]*>MJPEG</);
  assert.match(panel[0], /data-cctv-feed-type="video"[^>]*>Video</);
  assert.match(panel[0], /id="cctv-city-filter"/);
  assert.ok(
    panel[0].indexOf('id="cctv-city-filter"') < panel[0].indexOf('id="cctv-feed-type-filter"'),
    'chips sit next to the city filter',
  );
  assert.ok(
    panel[0].indexOf('id="cctv-feed-type-filter"') < panel[0].indexOf('id="cctv-camera-select"'),
    'chips stay with city / Hide no feed, not after the camera list',
  );
  assert.match(ui, /data-cctv-feed-type/);
  assert.match(ui, /setFeedTypes\(/);
  assert.match(ui, /filterVisibleCctvSources/);
  assert.match(ui, /feedTypes/);
});

test('chip change re-filters the cached catalog without another /api/cctv/sources fetch', () => {
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const layer = readFileSync(path.join(ROOT, 'src/data/cctv.js'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/cctvFeedTypeFilter.js'), 'utf8');
  const chipHandler = ui.match(/for \(const button of this\._cctvFeedTypeBtns\) \{[\s\S]*?\n    \}/);
  assert.ok(chipHandler, 'feed-type chip handler is missing');
  assert.match(chipHandler[0], /setFeedTypes/);
  assert.doesNotMatch(chipHandler[0], /\/api\/cctv\/sources/);
  assert.doesNotMatch(chipHandler[0], /\/api\/cctv\/frame/);
  assert.doesNotMatch(chipHandler[0], /loadCameraSources/);

  const setter = layer.match(/export function setCctvFeedTypes\([\s\S]*?\n\}/);
  assert.ok(setter, 'setCctvFeedTypes is missing');
  assert.doesNotMatch(setter[0], /loadCameraSources/);
  assert.doesNotMatch(setter[0], /SOURCE_ENDPOINT/);
  assert.doesNotMatch(setter[0], /\/api\/cctv\/sources/);
  assert.doesNotMatch(setter[0], /\/api\/cctv\/frame/);
  assert.match(layer, /SOURCE_ENDPOINT = '\/api\/cctv\/sources'/);
  assert.doesNotMatch(`${helper}\n${ui}`, /\/api\/cctv\/feed-type/);
});

test('cctv.js applies feed-type visibility without refetching sources', () => {
  const layer = readFileSync(path.join(ROOT, 'src/data/cctv.js'), 'utf8');
  assert.match(layer, /from '\.\/cctvFeedTypeFilter\.js'/);
  assert.match(layer, /function applyFeedTypeVisibility/);
  assert.match(layer, /cctvRecordMatchesFeedType/);
  assert.match(layer, /setCctvFeedTypes/);
  assert.match(layer, /feedTypes: \{ \.\.\._feedTypeFilter \}/);
  const setter = layer.match(/export function setCctvFeedTypes\([\s\S]*?\n\}/);
  assert.ok(setter, 'setCctvFeedTypes is missing');
  assert.doesNotMatch(setter[0], /loadCameraSources|SOURCE_ENDPOINT|\/api\/cctv\/sources|\/api\/cctv\/frame/);
  const horizon = layer.match(/function refreshHorizonCulling\([\s\S]*?\n\}/);
  assert.ok(horizon, 'refreshHorizonCulling is missing');
  assert.match(horizon[0], /catalogRecordVisible/);
});

test('feed-type chips persist locally and add no /api', () => {
  assert.equal(CCTV_FEED_TYPE_STORAGE_KEY, 'meridian.cctvFeedTypes');
  const storage = memoryStorage();
  assert.deepEqual(readCctvFeedTypeFilter(storage), { image: true, mjpeg: true, video: true });
  assert.deepEqual(writeCctvFeedTypeFilter({ image: false }, storage), {
    image: false,
    mjpeg: true,
    video: true,
  });
  assert.deepEqual(readCctvFeedTypeFilter(storage), { image: false, mjpeg: true, video: true });

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
  assert.ok(files.some((file) => file.startsWith('cctv')));
  assert.equal(existsSync(path.join(ROOT, 'api/cctv/feed-type.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'api/cctv/filter.js')), false);

  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  assert.doesNotMatch(layerState, /feedTypes|cctvFeedTypes|feedTypeFilter/);
});

test('legal surfaces stay Meridian, MIT-credited, and off banned sources', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const helper = readFileSync(path.join(ROOT, 'src/data/cctvFeedTypeFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(pkg.name, 'meridian');
  assert.match(html, /Meridian is independent/);
  assert.doesNotMatch(helper, /opensky|news\.google|telegeography|quantum-earth|gods-eye-view series/i);
  assert.doesNotMatch(helper, /Google News|OpenSky|TeleGeography/i);
});
