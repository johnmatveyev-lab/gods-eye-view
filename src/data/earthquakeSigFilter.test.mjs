// PLAN 183 — Significance-floor chips. Client-only filter of USGS all_day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_EARTHQUAKE_SIG_FLOOR,
  EARTHQUAKE_SIG_FLOORS,
  EARTHQUAKE_SIG_FLOOR_STORAGE_KEY,
  EARTHQUAKE_SIGNIFICANT_SIG_CUTOFF,
  earthquakeMatchesSigFloor,
  earthquakeSigFloorChipModels,
  earthquakeSigFloorValue,
  earthquakeSignificance,
  filterEarthquakeFeaturesBySigFloor,
  normalizeEarthquakeSigFloor,
  readEarthquakeSigFloor,
  writeEarthquakeSigFloor,
} from './earthquakeSigFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function sigFeature(id, sig, mag = 3.2) {
  const properties = { mag, place: String(id), time: 1_753_600_000_000 };
  if (sig !== undefined) properties.sig = sig;
  return { id, geometry: { coordinates: [-122.4, 37.79, 8.2] }, properties };
}

const MIXED = Object.freeze([
  sigFeature('low-145', 145, 3.1),
  sigFeature('mid-340', 340, 4.7),
  sigFeature('hi-600', 600, 5.2),
  sigFeature('hi-812', 812, 6.1),
  sigFeature('string-300', '300', 4.1),
  sigFeature('missing'),
  sigFeature('empty', ''),
  sigFeature('nullish', null),
  sigFeature('nan', Number.NaN),
  sigFeature('non-finite', Infinity),
  sigFeature('text', 'nope'),
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

test('significance chips default All and match the unfiltered set', () => {
  assert.equal(DEFAULT_EARTHQUAKE_SIG_FLOOR, 'all');
  assert.equal(EARTHQUAKE_SIGNIFICANT_SIG_CUTOFF, 600);
  assert.deepEqual(EARTHQUAKE_SIG_FLOORS.map((chip) => chip.id), ['all', '100', '300', '600']);
  assert.deepEqual(EARTHQUAKE_SIG_FLOORS.map((chip) => chip.label), ['All', '100+', '300+', '600+']);
  assert.equal(EARTHQUAKE_SIG_FLOORS.at(-1)?.floor, 600);
  assert.equal(normalizeEarthquakeSigFloor(undefined), 'all');
  assert.equal(normalizeEarthquakeSigFloor(null), 'all');
  assert.equal(normalizeEarthquakeSigFloor(''), 'all');
  assert.equal(normalizeEarthquakeSigFloor('all'), 'all');
  assert.equal(normalizeEarthquakeSigFloor(0), 'all');
  assert.equal(normalizeEarthquakeSigFloor('0'), 'all');
  assert.equal(normalizeEarthquakeSigFloor(100), '100');
  assert.equal(normalizeEarthquakeSigFloor('100+'), '100');
  assert.equal(normalizeEarthquakeSigFloor('300'), '300');
  assert.equal(normalizeEarthquakeSigFloor(600), '600');
  assert.equal(normalizeEarthquakeSigFloor('600+'), '600');
  assert.equal(normalizeEarthquakeSigFloor('bogus'), null);
  assert.equal(normalizeEarthquakeSigFloor(250), null);
  assert.equal(earthquakeSigFloorValue('all'), 0);
  assert.equal(earthquakeSigFloorValue('300'), 300);
  assert.equal(earthquakeSigFloorValue('600'), 600);
  assert.deepEqual(
    filterEarthquakeFeaturesBySigFloor(MIXED, DEFAULT_EARTHQUAKE_SIG_FLOOR).map((feature) => feature.id),
    MIXED.map((feature) => feature.id),
  );
  assert.deepEqual(filterEarthquakeFeaturesBySigFloor(null), []);
  assert.deepEqual(filterEarthquakeFeaturesBySigFloor(undefined), []);
});

test('300+ hides a sig:145 M3.1 and keeps a sig:340 M4.7; missing sig stays', () => {
  assert.equal(earthquakeSignificance(145), 145);
  assert.equal(earthquakeSignificance('340'), 340);
  assert.equal(earthquakeSignificance(undefined), null);
  assert.equal(earthquakeSignificance(null), null);
  assert.equal(earthquakeSignificance(Number.NaN), null);
  assert.equal(earthquakeSignificance(Infinity), null);
  assert.equal(earthquakeSignificance('nope'), null);

  const kept = filterEarthquakeFeaturesBySigFloor(MIXED, '300').map((feature) => feature.id);
  assert.ok(!kept.includes('low-145'));
  assert.ok(kept.includes('mid-340'));
  assert.ok(kept.includes('hi-600'));
  assert.ok(kept.includes('hi-812'));
  assert.ok(kept.includes('string-300'));
  assert.ok(kept.includes('missing'));
  assert.ok(kept.includes('empty'));
  assert.ok(kept.includes('nullish'));
  assert.ok(kept.includes('nan'));
  assert.ok(kept.includes('non-finite'));
  assert.ok(kept.includes('text'));
  assert.equal(earthquakeMatchesSigFloor(sigFeature('low-145', 145, 3.1), '300'), false);
  assert.equal(earthquakeMatchesSigFloor(sigFeature('mid-340', 340, 4.7), '300'), true);
});

test('All restores the current view; 600+ is the USGS significant cutoff', () => {
  const at300 = filterEarthquakeFeaturesBySigFloor(MIXED, '300').map((feature) => feature.id);
  assert.ok(!at300.includes('low-145'));
  assert.deepEqual(
    filterEarthquakeFeaturesBySigFloor(MIXED, 'all').map((feature) => feature.id),
    MIXED.map((feature) => feature.id),
  );
  const significant = filterEarthquakeFeaturesBySigFloor(MIXED, '600').map((feature) => feature.id);
  assert.ok(significant.includes('hi-600'));
  assert.ok(significant.includes('hi-812'));
  assert.ok(!significant.includes('mid-340'));
  assert.ok(!significant.includes('low-145'));
  assert.ok(significant.includes('missing'));
});

test('selected event stays visible when its significance is below the floor', () => {
  assert.deepEqual(
    filterEarthquakeFeaturesBySigFloor(MIXED, '300', { selectedId: 'low-145' })
      .map((feature) => feature.id)
      .filter((id) => id === 'low-145' || id === 'mid-340'),
    ['low-145', 'mid-340'],
  );
  assert.equal(
    earthquakeMatchesSigFloor(sigFeature('low-145', 145, 3.1), '600', { selectedId: 'low-145' }),
    true,
  );
});

test('persist meridian.earthquakeSigFloor and exclusive chip models', () => {
  assert.equal(EARTHQUAKE_SIG_FLOOR_STORAGE_KEY, 'meridian.earthquakeSigFloor');
  const storage = memoryStorage();
  assert.equal(readEarthquakeSigFloor(storage), 'all');
  assert.equal(writeEarthquakeSigFloor('300', storage), '300');
  assert.equal(readEarthquakeSigFloor(storage), '300');
  assert.equal(storage.snapshot()[EARTHQUAKE_SIG_FLOOR_STORAGE_KEY], '300');
  assert.equal(writeEarthquakeSigFloor('nope', storage), 'all');
  assert.equal(readEarthquakeSigFloor(storage), 'all');
  assert.equal(readEarthquakeSigFloor(memoryStorage({
    [EARTHQUAKE_SIG_FLOOR_STORAGE_KEY]: '"600"',
  })), '600');
  const models = earthquakeSigFloorChipModels('300');
  assert.deepEqual(models.map((chip) => chip.label), ['All', '100+', '300+', '600+']);
  assert.deepEqual(models.map((chip) => chip.params.sigFloor), ['all', '100', '300', '600']);
  assert.deepEqual(models.map((chip) => chip.active), [false, false, true, false]);
  assert.ok(models.every((chip) => chip.group === 'Significance'));
});

test('helper reads USGS properties.sig and the chips sit next to quake filters', () => {
  const helper = readFileSync(new URL('./earthquakeSigFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/earthquakes.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.match(helper, /properties\.sig/);
  assert.match(helper, /meridian\.earthquakeSigFloor/);
  assert.match(helper, /600/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.match(source, /sigFloor/);
  assert.match(source, /filterEarthquakeFeaturesBySigFloor/);
  assert.match(source, /writeEarthquakeSigFloor|readEarthquakeSigFloor/);
  assert.match(html, /id="earthquake-sig-chips"/);
  assert.match(html, /data-earthquake-sig="all"/);
  assert.match(html, /data-earthquake-sig="100"/);
  assert.match(html, /data-earthquake-sig="300"/);
  assert.match(html, /data-earthquake-sig="600"/);
  assert.match(html, /id="earthquake-network-chips"/);
  assert.match(html, /id="earthquake-pager-chips"/);
  assert.match(ui, /earthquake-sig-chips|data-earthquake-sig/);
  assert.match(ui, /_earthquakeSigChips\.hidden = !enabled/);
  assert.match(css, /earthquake-sig-chip/);
});
