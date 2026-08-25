// PLAN 66 — CCTV city/provider filter on the existing panel list.
// Uses city, cityId, and provider already on each source. No new /api.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CCTV_CITY_FILTER_ALL,
  CCTV_CITY_STORAGE_KEY,
  cctvSourceFilterGroup,
  cycleFilteredCctvSources,
  filterCctvSources,
  listCctvCityFilters,
  normalizeCctvCityFilter,
  readLastCctvCity,
  writeLastCctvCity,
} from './cctvSourceFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const AUSTIN_1 = Object.freeze({
  id: 'aus-1',
  name: 'Congress Southbound',
  city: 'Austin',
  cityId: 'austin',
  provider: 'Austin Transportation & Public Works',
  frameUrl: '/api/cctv/frame/aus-1?city=Austin',
});
const AUSTIN_2 = Object.freeze({
  id: 'aus-2',
  name: 'Downtown West',
  city: 'Austin',
  cityId: 'austin',
  provider: 'Austin Transportation & Public Works',
  frameUrl: '/api/cctv/frame/aus-2?city=Austin',
});
const CALTRANS_1 = Object.freeze({
  id: 'ca-1',
  name: 'I-5 NB',
  city: 'Los Angeles',
  cityId: 'ca-d7',
  provider: 'Caltrans',
  frameUrl: '/api/cctv/frame/ca-1?city=Los%20Angeles',
});
const CALTRANS_2 = Object.freeze({
  id: 'ca-2',
  name: 'I-8 WB',
  city: 'San Diego',
  cityId: 'ca-d11',
  provider: 'Caltrans',
  frameUrl: '/api/cctv/frame/ca-2?city=San%20Diego',
});
const TFL_1 = Object.freeze({
  id: 'lon-1',
  name: 'JamCam Westminster',
  city: 'London',
  cityId: 'london',
  provider: 'Transport for London',
  frameUrl: '/api/cctv/frame/lon-1?city=London',
});

const CATALOG = Object.freeze([AUSTIN_1, AUSTIN_2, CALTRANS_1, CALTRANS_2, TFL_1]);

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
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
    keys() {
      return [...map.keys()];
    },
  };
}

test('city/provider groups use existing source fields without hardcoding networks', () => {
  assert.deepEqual(cctvSourceFilterGroup(AUSTIN_1), { key: 'city:austin', label: 'Austin' });
  assert.deepEqual(cctvSourceFilterGroup(TFL_1), { key: 'city:london', label: 'London' });
  assert.deepEqual(cctvSourceFilterGroup(CALTRANS_1), { key: 'provider:caltrans', label: 'Caltrans' });
  assert.deepEqual(cctvSourceFilterGroup(CALTRANS_2), { key: 'provider:caltrans', label: 'Caltrans' });
});

test('filter one city returns only those sources', () => {
  const filtered = filterCctvSources(CATALOG, 'city:austin');
  assert.deepEqual(filtered.map((source) => source.id), ['aus-1', 'aus-2']);
  assert.equal(filtered[0], AUSTIN_1);
  assert.equal(filtered[1], AUSTIN_2);
  assert.equal(filterCctvSources(CATALOG, 'provider:caltrans').length, 2);
  assert.deepEqual(filterCctvSources(CATALOG, 'city:london').map((source) => source.id), ['lon-1']);
});

test('clearing the city filter restores the full catalog', () => {
  const keys = listCctvCityFilters(CATALOG).map((option) => option.key);
  assert.deepEqual(
    listCctvCityFilters(CATALOG).map((option) => option.label),
    ['Austin', 'Caltrans', 'London'],
  );
  assert.equal(normalizeCctvCityFilter('', keys), CCTV_CITY_FILTER_ALL);
  assert.equal(normalizeCctvCityFilter('all', keys), CCTV_CITY_FILTER_ALL);
  const cleared = filterCctvSources(CATALOG, CCTV_CITY_FILTER_ALL);
  assert.equal(cleared.length, CATALOG.length);
  assert.deepEqual(cleared, [...CATALOG]);
});

test('picking a filtered camera keeps the existing frame URL', () => {
  const filtered = filterCctvSources(CATALOG, 'city:austin');
  const picked = filtered[0];
  assert.equal(picked.frameUrl, '/api/cctv/frame/aus-1?city=Austin');
  assert.match(picked.frameUrl, /^\/api\/cctv\/frame\//);
  assert.doesNotMatch(picked.frameUrl, /person-search|opensky|quantum-earth/i);
});

test('last city persists and unknown keys fail open to the full catalog', () => {
  const storage = memoryStorage();
  assert.equal(CCTV_CITY_STORAGE_KEY, 'meridian.cctvCity');
  assert.equal(readLastCctvCity(storage), CCTV_CITY_FILTER_ALL);
  writeLastCctvCity('city:austin', storage);
  assert.equal(storage.getItem(CCTV_CITY_STORAGE_KEY), 'city:austin');
  assert.equal(readLastCctvCity(storage), 'city:austin');
  writeLastCctvCity(CCTV_CITY_FILTER_ALL, storage);
  assert.equal(readLastCctvCity(storage), CCTV_CITY_FILTER_ALL);

  const keys = listCctvCityFilters(CATALOG).map((option) => option.key);
  assert.equal(normalizeCctvCityFilter('city:paris', keys), CCTV_CITY_FILTER_ALL);
  assert.equal(normalizeCctvCityFilter('austin', keys), 'city:austin');
});

test('prev/next cycle only the filtered city list', () => {
  assert.equal(cycleFilteredCctvSources(CATALOG, 'aus-1', 1, 'city:austin'), 'aus-2');
  assert.equal(cycleFilteredCctvSources(CATALOG, 'aus-2', 1, 'city:austin'), 'aus-1');
  assert.equal(cycleFilteredCctvSources(CATALOG, 'aus-1', -1, 'city:austin'), 'aus-2');
});

test('CCTV panel hosts the city filter and still uses the existing stream', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');
  const cctv = readFileSync(path.join(ROOT, 'src', 'data', 'cctv.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');

  assert.match(html, /id="cctv-city-filter"/);
  assert.match(html, /id="cctv-camera-select"/);
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(html, /MIT-licensed God's Eye View project/);
  const cctvPanel = html.slice(html.indexOf('id="cctv-panel"'), html.indexOf('id="radio-panel"'));
  assert.match(cctvPanel, /id="cctv-city-filter"/);
  assert.doesNotMatch(cctvPanel, /quantum-earth|OpenSky/i);

  assert.match(ui, /from '\.\/data\/cctvSourceFilter\.js'/);
  assert.match(ui, /this\._cctvCityFilter = document\.getElementById\('cctv-city-filter'\)/);
  assert.match(ui, /writeLastCctvCity\(/);
  assert.match(ui, /readLastCctvCity\(/);
  assert.match(ui, /filterCctvSources\(/);
  assert.match(ui, /cycleFilteredCctvSources\(/);
  assert.match(ui, /cctvLayer\.selectCamera\(cameraId\)/);
  assert.match(ui, /activeCamera\?\.frameUrl/);
  assert.match(ui, /this\._sanitizeRestoredPanelPositions\(\)/);
  assert.match(ui, /clampPanelPosition\(/);
  assert.doesNotMatch(ui, /\/api\/cctv\/cities|\/api\/cctv\/search|person-search/);

  assert.match(cctv, /cityId: camera\.cityId/);
  assert.match(cctv, /FRAME_ENDPOINT = '\/api\/cctv\/frame'/);
  assert.doesNotMatch(cctv, /quantum-earth|opensky-network\.org|news\.google\.com|telegeography/i);

  assert.match(css, /#cctv-city-filter/);
  assert.match(css, /#cctv-panel\.collapsed \.cctv-controls/);
});

test('panel clamp still applies after the city filter lands', () => {
  const panel = readFileSync(path.join(ROOT, 'src', 'panelPosition.test.mjs'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');
  assert.match(panel, /boot sanitize clamps a CCTV panel stored at -4000,-4000/);
  assert.match(ui, /this\._sanitizeRestoredPanelPositions\(\)/);
  assert.match(ui, /PANEL_POSITION_STORAGE_VERSION = 'v8'/);
  assert.doesNotMatch(ui, /PANEL_POSITION_STORAGE_VERSION = 'v9'/);
});

test('MIT credit and legal exclusions stay intact', () => {
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const filter = readFileSync(path.join(ROOT, 'src', 'data', 'cctvSourceFilter.js'), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(license, /Meridian is an independent commercial product/);
  assert.doesNotMatch(filter, /opensky-network\.org|news\.google\.com|telegeography|quantum-earth|person-search/i);
  assert.doesNotMatch(filter, /\/api\/cctv\/(?!frame|sources|health|media)/);
});
