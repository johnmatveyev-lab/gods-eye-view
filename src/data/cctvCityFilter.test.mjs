import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CCTV_CITY_FILTER_STORAGE_KEY,
  CCTV_HIDE_NO_FEED_DEFAULT,
  CCTV_HIDE_NO_FEED_STORAGE_KEY,
  cctvSelectedFrameSrc,
  cycleFilteredCctvCamera,
  filterCctvSources,
  listCctvCityFilterOptions,
  normalizeCctvCityFilter,
  normalizeCctvHideNoFeed,
  readCctvCityFilter,
  readCctvHideNoFeed,
  sourceMatchesCityFilter,
  sourceMatchesHideNoFeed,
  writeCctvCityFilter,
  writeCctvHideNoFeed,
} from './cctvCityFilter.js';
import {
  CCTV_HIDE_UNHEALTHY_STORAGE_KEY,
  filterVisibleCctvSources,
  readCctvHideUnhealthy,
  writeCctvHideUnhealthy,
} from './cctvHealthFilter.js';
import {
  CCTV_HEADING_CONFIDENCE_STORAGE_KEY,
  readCctvHeadingConfidenceFilter,
  writeCctvHeadingConfidenceFilter,
} from './cctvHeadingConfidenceFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Catalog rows shaped like /api/cctv/sources — city, cityId, provider already present. */
const CATALOG = Object.freeze([
  {
    id: 'atx-1',
    name: 'Congress @ 11th',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    frameUrl: '/api/cctv/frame/atx-1?label=Congress&city=Austin',
  },
  {
    id: 'atx-2',
    name: 'Lamar @ 5th',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    frameUrl: '/api/cctv/frame/atx-2?label=Lamar&city=Austin',
  },
  {
    id: 'ca-d4-tv102',
    name: 'I-580 West (Oakland)',
    city: 'Oakland',
    cityId: 'ca-d4',
    provider: 'Caltrans',
    frameUrl: '/api/cctv/frame/ca-d4-tv102?label=I-580&city=Oakland',
  },
  {
    id: 'ca-d7-tv9',
    name: 'US-101 South (LA)',
    city: 'Los Angeles',
    cityId: 'ca-d7',
    provider: 'Caltrans',
    frameUrl: '/api/cctv/frame/ca-d7-tv9?label=US-101&city=Los%20Angeles',
  },
  {
    id: 'tfl-00002.00865',
    name: 'Oxford Circus',
    city: 'London',
    cityId: 'london',
    provider: 'Transport for London',
    frameUrl: '/api/cctv/frame/tfl-00002.00865?label=Oxford%20Circus&city=London',
  },
]);

/** Rows shaped like the in-memory CCTV catalog: seeds have feedConfigured false. */
const FEED_CATALOG = Object.freeze([
  {
    id: 'seed-1',
    city: 'Austin',
    cityId: 'austin',
    provider: 'OSM Camera Grid',
    feedConfigured: false,
    frameUrl: '/api/cctv/frame/seed-1?label=Seed',
  },
  {
    id: 'live-1',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    feedConfigured: true,
    frameUrl: '/api/cctv/frame/live-1?label=Live',
  },
  {
    id: 'nourl-1',
    city: 'London',
    cityId: 'london',
    provider: 'Transport for London',
    feedConfigured: false,
    frameUrl: '/api/cctv/frame/nourl-1?label=NoUrl',
  },
  {
    id: 'live-2',
    city: 'London',
    cityId: 'london',
    provider: 'Transport for London',
    feedConfigured: true,
    frameUrl: '/api/cctv/frame/live-2?label=Oxford',
  },
]);

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test('filtering one city keeps only those sources; clearing restores the catalog', () => {
  const austin = filterCctvSources(CATALOG, 'austin');
  assert.deepEqual(austin.map((source) => source.id), ['atx-1', 'atx-2']);
  assert.ok(austin.every((source) => source.cityId === 'austin'));

  const caltrans = filterCctvSources(CATALOG, 'Caltrans');
  assert.deepEqual(caltrans.map((source) => source.id), ['ca-d4-tv102', 'ca-d7-tv9']);
  assert.ok(caltrans.every((source) => source.provider === 'Caltrans'));

  const tfl = filterCctvSources(CATALOG, 'london');
  assert.deepEqual(tfl.map((source) => source.id), ['tfl-00002.00865']);

  const cleared = filterCctvSources(CATALOG, '');
  assert.deepEqual(cleared.map((source) => source.id), CATALOG.map((source) => source.id));
  assert.equal(cleared.length, CATALOG.length);
  assert.deepEqual(filterCctvSources(CATALOG, '   ').map((source) => source.id),
    CATALOG.map((source) => source.id));
});

test('city, cityId, and provider fields all match the same filter token', () => {
  assert.equal(sourceMatchesCityFilter(CATALOG[0], 'Austin'), true);
  assert.equal(sourceMatchesCityFilter(CATALOG[0], 'austin'), true);
  assert.equal(sourceMatchesCityFilter(CATALOG[0], 'Austin Transportation & Public Works'), true);
  assert.equal(sourceMatchesCityFilter(CATALOG[2], 'ca-d4'), true);
  assert.equal(sourceMatchesCityFilter(CATALOG[2], 'Caltrans'), true);
  assert.equal(sourceMatchesCityFilter(CATALOG[4], 'Transport for London'), true);
  assert.equal(sourceMatchesCityFilter(CATALOG[0], 'london'), false);
  assert.equal(sourceMatchesCityFilter(CATALOG[0], 'Oakland'), false);
});

test('city/provider options collapse multi-city networks and keep city-scoped packs', () => {
  const options = listCctvCityFilterOptions(CATALOG);
  assert.deepEqual(options.map((option) => option.key), ['austin', 'Caltrans', 'london']);
  assert.deepEqual(options.map((option) => option.label), ['Austin', 'Caltrans', 'London']);
  assert.deepEqual(options.map((option) => option.count), [2, 2, 1]);
});

test('picking a filtered camera keeps the existing frame URL', () => {
  const [camera] = filterCctvSources(CATALOG, 'austin');
  assert.equal(camera.frameUrl, CATALOG[0].frameUrl);
  assert.match(camera.frameUrl, /^\/api\/cctv\/frame\/atx-1\?/);
  assert.equal(cctvSelectedFrameSrc(camera, { enabled: true }), camera.frameUrl);
  assert.equal(cctvSelectedFrameSrc(camera, { enabled: false }), null);
  assert.equal(cctvSelectedFrameSrc(null, { enabled: true }), null);
});

test('last city persists and clears back to the full catalog', () => {
  const storage = memoryStorage();
  assert.equal(normalizeCctvCityFilter('  austin  '), 'austin');
  assert.equal(readCctvCityFilter(storage), '');
  writeCctvCityFilter(storage, 'Caltrans');
  assert.equal(storage.getItem(CCTV_CITY_FILTER_STORAGE_KEY), 'Caltrans');
  assert.equal(readCctvCityFilter(storage), 'Caltrans');
  writeCctvCityFilter(storage, '');
  assert.equal(readCctvCityFilter(storage), '');
});

test('prev/next cycle stays inside the filtered city list', () => {
  const austin = filterCctvSources(CATALOG, 'austin');
  assert.equal(cycleFilteredCctvCamera(austin, 'atx-1', 1), 'atx-2');
  assert.equal(cycleFilteredCctvCamera(austin, 'atx-2', 1), 'atx-1');
  assert.equal(cycleFilteredCctvCamera(austin, 'atx-1', -1), 'atx-2');
  assert.equal(cycleFilteredCctvCamera(austin, 'missing', 1), 'atx-1');
});

test('CCTV panel markup has a city/source filter above the camera list', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const panel = html.match(/<div id="cctv-panel"[\s\S]*?<div id="scene-panel"/);
  assert.ok(panel, 'cctv-panel markup is missing');
  assert.match(panel[0], /id="cctv-city-filter"/);
  assert.match(panel[0], /id="cctv-camera-select"/);
  assert.ok(
    panel[0].indexOf('id="cctv-city-filter"') < panel[0].indexOf('id="cctv-camera-select"'),
    'city filter must sit above the camera list',
  );
  assert.match(panel[0], /aria-label="CCTV city or source"/);
  assert.doesNotMatch(panel[0], /OpenSky/i);
  assert.doesNotMatch(panel[0], /Google News/i);
  assert.doesNotMatch(panel[0], /TeleGeography/i);
  assert.doesNotMatch(panel[0], /person-search/i);
});

test('panel render filters the camera list and still uses the existing frame URL', () => {
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  assert.match(ui, /from '\.\/data\/cctvCityFilter\.js'/);
  assert.match(ui, /filterVisibleCctvSources/);
  assert.match(ui, /listCctvCityFilterOptions/);
  assert.match(ui, /writeCctvCityFilter/);
  assert.match(ui, /readCctvCityFilter/);
  const renderer = ui.match(/_renderCctvState\(state\) \{[\s\S]*?\n  \}\n/);
  assert.ok(renderer, '_renderCctvState is missing');
  assert.match(renderer[0], /filterVisibleCctvSources/);
  assert.match(renderer[0], /_cctvCityFilter/);
  assert.match(renderer[0], /activeCamera\?\.frameUrl/);
  assert.match(renderer[0], /_syncCctvPanelViewport|_clampToViewport/);
  assert.doesNotMatch(ui, /\/api\/cctv\/cities/);
  assert.doesNotMatch(ui, /\/api\/cctv\/filter/);
});

test('public camera state exposes cityId for the panel filter', () => {
  const source = readFileSync(path.join(ROOT, 'src/data/cctv.js'), 'utf8');
  const publicState = source.match(/function getPublicCameraState\([\s\S]*?\n\}/);
  assert.ok(publicState, 'getPublicCameraState is missing');
  assert.match(publicState[0], /cityId:\s*camera\.cityId/);
  assert.match(publicState[0], /city:\s*camera\.city/);
  assert.match(publicState[0], /provider:\s*camera\.provider/);
  assert.match(publicState[0], /sourceStatus:\s*health\?\.status/);
  assert.match(publicState[0], /feedConfigured:\s*camera\.feedConfigured/);
  assert.match(publicState[0], /frameUrl:\s*frameUrlFor\(camera/);
  assert.match(publicState[0], /feedConfigured:\s*camera\.feedConfigured === true/);
  assert.match(publicState[0], /headingConfidence:\s*camera\.headingConfidence/);
});

test('hide-no-feed off matches the current catalog', () => {
  assert.equal(CCTV_HIDE_NO_FEED_DEFAULT, false);
  assert.equal(normalizeCctvHideNoFeed(undefined), false);
  assert.equal(sourceMatchesHideNoFeed(FEED_CATALOG[0], false), true);
  assert.deepEqual(
    filterCctvSources(CATALOG, '').map((source) => source.id),
    CATALOG.map((source) => source.id),
  );
  assert.deepEqual(
    filterCctvSources(FEED_CATALOG, '', { hideNoFeed: false }).map((source) => source.id),
    FEED_CATALOG.map((source) => source.id),
  );
});

test('hide-no-feed on hides seed/no-url cameras and keeps configured ones', () => {
  assert.equal(sourceMatchesHideNoFeed(FEED_CATALOG[0], true), false);
  assert.equal(sourceMatchesHideNoFeed(FEED_CATALOG[1], true), true);
  assert.equal(sourceMatchesHideNoFeed({ id: 'missing-flag' }, true), true);
  const hidden = filterCctvSources(FEED_CATALOG, '', { hideNoFeed: true });
  assert.deepEqual(hidden.map((source) => source.id), ['live-1', 'live-2']);
  assert.ok(hidden.every((source) => source.feedConfigured === true));
});

test('selected unconfigured camera stays when hide-no-feed is on', () => {
  assert.equal(sourceMatchesHideNoFeed(FEED_CATALOG[0], true, { selectedId: 'seed-1' }), true);
  const kept = filterCctvSources(FEED_CATALOG, '', {
    hideNoFeed: true,
    selectedId: 'nourl-1',
  });
  assert.deepEqual(kept.map((source) => source.id), ['live-1', 'nourl-1', 'live-2']);
});

test('hide-no-feed ANDs with the existing city/source filter', () => {
  const austinHidden = filterCctvSources(FEED_CATALOG, 'austin', { hideNoFeed: true });
  assert.deepEqual(austinHidden.map((source) => source.id), ['live-1']);
  const londonHidden = filterCctvSources(FEED_CATALOG, 'london', {
    hideNoFeed: true,
    selectedId: 'seed-1',
  });
  assert.deepEqual(londonHidden.map((source) => source.id), ['live-2']);
  const austinSelected = filterCctvSources(FEED_CATALOG, 'austin', {
    hideNoFeed: true,
    selectedId: 'seed-1',
  });
  assert.deepEqual(austinSelected.map((source) => source.id), ['seed-1', 'live-1']);
});

test('hide-no-feed persists with existing CCTV prefs and defaults off', () => {
  const storage = memoryStorage();
  assert.equal(readCctvHideNoFeed(storage), false);
  assert.equal(writeCctvHideNoFeed(storage, true), true);
  assert.equal(storage.getItem(CCTV_HIDE_NO_FEED_STORAGE_KEY), '1');
  assert.equal(readCctvHideNoFeed(storage), true);
  assert.equal(writeCctvHideNoFeed(storage, false), false);
  assert.equal(readCctvHideNoFeed(storage), false);
  writeCctvCityFilter(storage, 'austin');
  assert.equal(storage.getItem(CCTV_CITY_FILTER_STORAGE_KEY), 'austin');
  assert.equal(readCctvCityFilter(storage), 'austin');
});

test('CCTV panel has a Hide no feed toggle next to the city/source filter', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const panel = html.match(/<div id="cctv-panel"[\s\S]*?<div id="scene-panel"/);
  assert.ok(panel, 'cctv-panel markup is missing');
  assert.match(panel[0], /id="cctv-hide-no-feed-btn"/);
  assert.match(panel[0], /id="cctv-city-filter"/);
  const cityAt = panel[0].indexOf('id="cctv-city-filter"');
  const hideAt = panel[0].indexOf('id="cctv-hide-no-feed-btn"');
  const cameraAt = panel[0].indexOf('id="cctv-camera-select"');
  assert.ok(cityAt < hideAt && hideAt < cameraAt, 'toggle must sit next to city/source above the camera list');
  assert.match(panel[0], /aria-pressed="false"/);
  assert.match(panel[0], /Hide no feed/i);
  assert.doesNotMatch(panel[0], /OpenSky/i);
  assert.doesNotMatch(panel[0], /Google News/i);
  assert.doesNotMatch(panel[0], /TeleGeography/i);
});

test('panel render ANDs hide-no-feed with the city filter and keeps the selected camera', () => {
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  assert.match(ui, /readCctvHideNoFeed/);
  assert.match(ui, /writeCctvHideNoFeed/);
  assert.match(ui, /_cctvHideNoFeed/);
  const visible = ui.match(/_visibleCctvCameras\(\) \{[\s\S]*?\n  \}/);
  assert.ok(visible, '_visibleCctvCameras is missing');
  assert.match(visible[0], /filterCctvSources/);
  assert.match(visible[0], /hideNoFeed/);
  assert.match(visible[0], /selectedId/);
  const renderer = ui.match(/_renderCctvState\(state\) \{[\s\S]*?\n  \}\n/);
  assert.ok(renderer, '_renderCctvState is missing');
  assert.match(renderer[0], /hideNoFeed:\s*this\._cctvHideNoFeed/);
  assert.doesNotMatch(ui, /\/api\/cctv\/cities/);
  assert.doesNotMatch(ui, /\/api\/cctv\/hide/);
});

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is missing`);
  return source.slice(start, start + 2200);
}

test('catalog visibility re-applies from memory and does not refetch sources', () => {
  const source = readFileSync(path.join(ROOT, 'src/data/cctv.js'), 'utf8');
  assert.match(source, /from '\.\/cctvCityFilter\.js'/);
  assert.match(source, /sourceMatchesHideNoFeed/);
  assert.match(source, /_hideNoFeed/);
  const apply = extractNamedFunction(source, 'applyCatalogVisibility');
  assert.doesNotMatch(apply, /loadCameraSources/);
  assert.doesNotMatch(apply, /SOURCE_ENDPOINT|FRAME_ENDPOINT/);
  assert.doesNotMatch(apply, /\/api\/cctv\/sources/);
  assert.doesNotMatch(apply, /\/api\/cctv\/frame/);
  assert.match(apply, /refreshHorizonCulling/);
  assert.match(apply, /refreshCoverageStyles/);
  assert.match(apply, /refreshAmbientCards/);
  assert.match(extractNamedFunction(source, 'refreshHorizonCulling'), /catalogRecordVisible/);
  assert.match(extractNamedFunction(source, 'refreshAmbientCards'), /catalogRecordVisible/);
  assert.match(extractNamedFunction(source, 'buildCoverageVisibleSet'), /catalogRecordVisible/);
  assert.match(source, /typeof params\.hideNoFeed === 'boolean'/);
  assert.match(source, /applyCatalogVisibility\(\)/);
  assert.doesNotMatch(source, /\/api\/cctv\/hide/);
});

const HEALTH_CATALOG = Object.freeze([
  { ...CATALOG[0], feedType: 'mp4', feedConfigured: true, sourceStatus: 'ok' },
  { ...CATALOG[1], feedType: 'image', feedConfigured: true, sourceStatus: 'error' },
  { ...CATALOG[2], feedType: 'hls', feedConfigured: true, sourceStatus: 'unknown' },
  { ...CATALOG[3], feedType: 'webm', feedConfigured: false, sourceStatus: 'ok' },
  { ...CATALOG[4], feedType: 'mp4', feedConfigured: true, sourceStatus: 'offline' },
]);

test('Hide unhealthy off matches the current city-filtered catalog', () => {
  const off = filterVisibleCctvSources(HEALTH_CATALOG, { hideUnhealthy: false });
  assert.deepEqual(off.map((source) => source.id), HEALTH_CATALOG.map((source) => source.id));
  assert.deepEqual(
    filterVisibleCctvSources(HEALTH_CATALOG, { city: 'austin', hideUnhealthy: false })
      .map((source) => source.id),
    filterCctvSources(HEALTH_CATALOG, 'austin').map((source) => source.id),
  );
});

test('Hide unhealthy on hides known-unhealthy tokens and keeps ok/unknown', () => {
  const visible = filterVisibleCctvSources(HEALTH_CATALOG, { hideUnhealthy: true });
  assert.deepEqual(visible.map((source) => source.id), ['atx-1', 'ca-d4-tv102', 'ca-d7-tv9']);
  assert.equal(visible.some((source) => source.id === 'atx-2'), false);
  assert.equal(visible.some((source) => source.id === 'tfl-00002.00865'), false);
});

test('selected unhealthy camera stays visible', () => {
  const visible = filterVisibleCctvSources(HEALTH_CATALOG, {
    hideUnhealthy: true,
    selectedId: 'atx-2',
  });
  assert.deepEqual(visible.map((source) => source.id), ['atx-1', 'atx-2', 'ca-d4-tv102', 'ca-d7-tv9']);
});

test('city + Hide no feed + Video still AND', () => {
  const visible = filterVisibleCctvSources(HEALTH_CATALOG, {
    city: 'Caltrans',
    hideUnhealthy: true,
    hideNoFeed: true,
    feedType: 'video',
  });
  assert.deepEqual(visible.map((source) => source.id), ['ca-d4-tv102']);
  assert.ok(visible.every((source) => source.provider === 'Caltrans'));
  assert.ok(visible.every((source) => source.feedConfigured === true));
  assert.ok(visible.every((source) => ['mp4', 'hls', 'webm'].includes(source.feedType)));
  assert.ok(visible.every((source) => source.sourceStatus !== 'error'));
});

test('Hide unhealthy persists with existing CCTV prefs', () => {
  const storage = memoryStorage();
  assert.equal(readCctvHideUnhealthy(storage), false);
  writeCctvHideUnhealthy(storage, true);
  assert.equal(storage.getItem(CCTV_HIDE_UNHEALTHY_STORAGE_KEY), '1');
  assert.equal(readCctvHideUnhealthy(storage), true);
  writeCctvCityFilter(storage, 'austin');
  assert.equal(storage.getItem(CCTV_CITY_FILTER_STORAGE_KEY), 'austin');
  writeCctvHideUnhealthy(storage, false);
  assert.equal(readCctvHideUnhealthy(storage), false);
  assert.equal(readCctvCityFilter(storage), 'austin');
});

test('CCTV panel markup has Hide unhealthy next to the city filter', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const panel = html.match(/<div id="cctv-panel"[\s\S]*?<div id="scene-panel"/);
  assert.ok(panel, 'cctv-panel markup is missing');
  assert.match(panel[0], /id="cctv-hide-unhealthy-btn"/);
  assert.match(panel[0], /HIDE UNHEALTHY/);
  assert.ok(
    panel[0].indexOf('id="cctv-city-filter"') < panel[0].indexOf('id="cctv-hide-unhealthy-btn"'),
    'Hide unhealthy must sit with the catalog filters, next to Hide no feed',
  );
  assert.ok(
    panel[0].indexOf('id="cctv-hide-unhealthy-btn"') < panel[0].indexOf('id="cctv-camera-select"'),
    'Hide unhealthy must sit above the camera list',
  );
  assert.match(html, /<title>Meridian<\/title>/);
  assert.doesNotMatch(panel[0], /OpenSky/i);
  assert.doesNotMatch(panel[0], /Google News/i);
  assert.doesNotMatch(panel[0], /TeleGeography/i);
  assert.doesNotMatch(panel[0], /quantum-earth/i);
});

test('Hide unhealthy wiring re-applies the in-memory catalog without a new health fetch', () => {
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const layer = readFileSync(path.join(ROOT, 'src/data/cctv.js'), 'utf8');
  assert.match(ui, /from '\.\/data\/cctvHealthFilter\.js'/);
  assert.match(ui, /readCctvHideUnhealthy/);
  assert.match(ui, /writeCctvHideUnhealthy/);
  assert.match(ui, /hideUnhealthy:\s*this\._cctvHideUnhealthy/);
  const click = ui.match(/_cctvHideUnhealthyBtn\?\.addEventListener\('click'[\s\S]*?\n    \}\);/);
  assert.ok(click, 'Hide unhealthy click handler is missing');
  assert.doesNotMatch(click[0], /\/api\/cctv\/health/);
  assert.doesNotMatch(click[0], /\/api\/cctv\/sources/);
  assert.match(click[0], /setParams\(\{\s*hideUnhealthy:/);
  assert.match(click[0], /_renderCctvState\(this\._cctvState\)/);
  const setParams = layer.match(/if \(typeof params\.hideUnhealthy === 'boolean'\) \{[\s\S]*?\n    \}/);
  assert.ok(setParams, 'setParams hideUnhealthy branch is missing');
  assert.doesNotMatch(setParams[0], /syncHealthState/);
  assert.doesNotMatch(setParams[0], /\/api\/cctv\/health/);
  assert.doesNotMatch(setParams[0], /\/api\/cctv\/sources/);
  assert.match(setParams[0], /applyCctvHealthVisibility/);
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
});

const AND_CATALOG = Object.freeze([
  {
    id: 'austin-high-video',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    headingConfidence: 'high',
    feedType: 'hls',
    feedConfigured: true,
    sourceStatus: 'ok',
    frameUrl: '/api/cctv/frame/austin-high-video',
  },
  {
    id: 'austin-high-image',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    headingConfidence: 'high',
    feedType: 'image',
    feedConfigured: true,
    sourceStatus: 'ok',
    frameUrl: '/api/cctv/frame/austin-high-image',
  },
  {
    id: 'austin-low-video',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    headingConfidence: 'low',
    feedType: 'mp4',
    feedConfigured: true,
    sourceStatus: 'ok',
    frameUrl: '/api/cctv/frame/austin-low-video',
  },
  {
    id: 'austin-high-video-seed',
    city: 'Austin',
    cityId: 'austin',
    provider: 'OSM Camera Grid',
    headingConfidence: 'high',
    feedType: 'hls',
    feedConfigured: false,
    sourceStatus: 'unknown',
    frameUrl: '/api/cctv/frame/austin-high-video-seed',
  },
  {
    id: 'austin-high-video-unhealthy',
    city: 'Austin',
    cityId: 'austin',
    provider: 'Austin Transportation & Public Works',
    headingConfidence: 'high',
    feedType: 'hls',
    feedConfigured: true,
    sourceStatus: 'error',
    frameUrl: '/api/cctv/frame/austin-high-video-unhealthy',
  },
  {
    id: 'london-high-video',
    city: 'London',
    cityId: 'london',
    provider: 'Transport for London',
    headingConfidence: 'high',
    feedType: 'hls',
    feedConfigured: true,
    sourceStatus: 'ok',
    frameUrl: '/api/cctv/frame/london-high-video',
  },
]);

test('all heading-confidence chips on match the current catalog', () => {
  assert.deepEqual(
    filterVisibleCctvSources(AND_CATALOG, {
      headingConfidence: { high: true, medium: true, low: true },
    }).map((source) => source.id),
    AND_CATALOG.map((source) => source.id),
  );
});

test('Low off hides low-confidence headings and keeps high/medium', () => {
  const hidden = filterVisibleCctvSources(AND_CATALOG, {
    headingConfidence: { high: true, medium: true, low: false },
  });
  assert.deepEqual(
    hidden.map((source) => source.id),
    [
      'austin-high-video',
      'austin-high-image',
      'austin-high-video-seed',
      'austin-high-video-unhealthy',
      'london-high-video',
    ],
  );
  assert.equal(hidden.some((source) => source.headingConfidence === 'low'), false);
});

test('selected low-confidence camera stays when Low is off', () => {
  const kept = filterVisibleCctvSources(AND_CATALOG, {
    headingConfidence: { high: true, medium: true, low: false },
    selectedId: 'austin-low-video',
  });
  assert.ok(kept.some((source) => source.id === 'austin-low-video'));
  assert.ok(kept.some((source) => source.headingConfidence === 'high'));
});

test('city + Hide no feed + Video + High still AND', () => {
  const anded = filterVisibleCctvSources(AND_CATALOG, {
    city: 'austin',
    hideNoFeed: true,
    feedType: 'video',
    headingConfidence: { high: true, medium: false, low: false },
  });
  assert.deepEqual(
    anded.map((source) => source.id),
    ['austin-high-video', 'austin-high-video-unhealthy'],
  );
  const withUnhealthy = filterVisibleCctvSources(AND_CATALOG, {
    city: 'austin',
    hideNoFeed: true,
    feedType: 'video',
    hideUnhealthy: true,
    headingConfidence: { high: true, medium: false, low: false },
  });
  assert.deepEqual(withUnhealthy.map((source) => source.id), ['austin-high-video']);
});

test('heading-confidence chips persist next to the existing CCTV city pref', () => {
  const storage = memoryStorage();
  writeCctvCityFilter(storage, 'austin');
  writeCctvHeadingConfidenceFilter(storage, { low: false });
  assert.equal(storage.getItem(CCTV_CITY_FILTER_STORAGE_KEY), 'austin');
  assert.equal(readCctvCityFilter(storage), 'austin');
  assert.deepEqual(readCctvHeadingConfidenceFilter(storage), {
    high: true,
    medium: true,
    low: false,
  });
  assert.ok(storage.getItem(CCTV_HEADING_CONFIDENCE_STORAGE_KEY));
});

test('CCTV panel markup has High | Medium | Low chips next to Hide unhealthy', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const panel = html.match(/<div id="cctv-panel"[\s\S]*?<div id="scene-panel"/);
  assert.ok(panel, 'cctv-panel markup is missing');
  assert.match(panel[0], /id="cctv-heading-confidence-filter"/);
  assert.match(panel[0], /data-cctv-heading-confidence="high"[^>]*>High</);
  assert.match(panel[0], /data-cctv-heading-confidence="medium"[^>]*>Medium</);
  assert.match(panel[0], /data-cctv-heading-confidence="low"[^>]*>Low</);
  assert.match(panel[0], /aria-label="CCTV heading confidence"/);
  const cityAt = panel[0].indexOf('id="cctv-city-filter"');
  const hideAt = panel[0].indexOf('id="cctv-hide-unhealthy-btn"');
  const chipsAt = panel[0].indexOf('id="cctv-heading-confidence-filter"');
  const cameraAt = panel[0].indexOf('id="cctv-camera-select"');
  assert.ok(cityAt < chipsAt && hideAt < chipsAt && chipsAt < cameraAt,
    'heading chips sit on the visibility row above the camera list');
  assert.doesNotMatch(panel[0], /OpenSky/i);
  assert.doesNotMatch(panel[0], /Google News/i);
  assert.doesNotMatch(panel[0], /TeleGeography/i);
});

test('panel render ANDs heading confidence with city/source and keeps the selected camera', () => {
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  assert.match(ui, /from '\.\/data\/cctvHeadingConfidenceFilter\.js'/);
  assert.match(ui, /readCctvHeadingConfidenceFilter/);
  assert.match(ui, /writeCctvHeadingConfidenceFilter/);
  assert.match(ui, /_cctvHeadingConfidence/);
  const visible = ui.match(/_visibleCctvCameras\(\) \{[\s\S]*?\n  \}/);
  assert.ok(visible, '_visibleCctvCameras is missing');
  assert.match(visible[0], /filterVisibleCctvSources/);
  assert.match(visible[0], /headingConfidence/);
  assert.match(visible[0], /selectedId/);
  const renderer = ui.match(/_renderCctvState\(state\) \{[\s\S]*?\n  \}\n/);
  assert.ok(renderer, '_renderCctvState is missing');
  assert.match(renderer[0], /headingConfidence:\s*this\._cctvHeadingConfidence/);
  assert.match(renderer[0], /_cctvCityFilterValue/);
  assert.doesNotMatch(ui, /\/api\/cctv\/heading/);
  assert.doesNotMatch(ui, /\/api\/cctv\/filter/);
});
