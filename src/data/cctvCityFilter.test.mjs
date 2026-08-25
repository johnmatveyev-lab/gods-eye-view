import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CCTV_CITY_FILTER_STORAGE_KEY,
  cctvSelectedFrameSrc,
  cycleFilteredCctvCamera,
  filterCctvSources,
  listCctvCityFilterOptions,
  normalizeCctvCityFilter,
  readCctvCityFilter,
  sourceMatchesCityFilter,
  writeCctvCityFilter,
} from './cctvCityFilter.js';

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
  assert.match(ui, /filterCctvSources/);
  assert.match(ui, /listCctvCityFilterOptions/);
  assert.match(ui, /writeCctvCityFilter/);
  assert.match(ui, /readCctvCityFilter/);
  const renderer = ui.match(/_renderCctvState\(state\) \{[\s\S]*?\n  \}\n/);
  assert.ok(renderer, '_renderCctvState is missing');
  assert.match(renderer[0], /filterCctvSources/);
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
  assert.match(publicState[0], /frameUrl:\s*frameUrlFor\(camera/);
});
