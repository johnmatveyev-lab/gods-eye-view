// PLAN 168 — Felt only toggle. Client-only filter of USGS all_day DYFI counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_EARTHQUAKE_FELT_ONLY,
  EARTHQUAKE_FELT_CHIP_LABEL,
  EARTHQUAKE_FELT_CHIP_TITLE,
  earthquakeFeltReportCount,
  filterEarthquakeFeaturesByFeltReports,
  normalizeEarthquakeFeltOnly,
} from './earthquakeFeltFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function feltFeature(id, felt) {
  const properties = { mag: 3.2, place: String(id), time: 1_753_600_000_000 };
  if (felt !== undefined) properties.felt = felt;
  return { id, geometry: { coordinates: [-122.4, 37.79, 8.2] }, properties };
}

const MIXED = Object.freeze([
  feltFeature('felt-int', 4),
  feltFeature('felt-string', '12'),
  feltFeature('felt-one', 1),
  feltFeature('zero', 0),
  feltFeature('string-zero', '0'),
  feltFeature('missing'),
  feltFeature('empty', ''),
  feltFeature('nullish', null),
  feltFeature('nan', 'nope'),
]);

test('Felt only defaults off and matches the unfiltered set', () => {
  assert.equal(DEFAULT_EARTHQUAKE_FELT_ONLY, false);
  assert.equal(EARTHQUAKE_FELT_CHIP_LABEL, 'Felt only');
  assert.equal(EARTHQUAKE_FELT_CHIP_TITLE, 'Show only earthquakes people reported as felt');
  assert.equal(normalizeEarthquakeFeltOnly(undefined), false);
  assert.equal(normalizeEarthquakeFeltOnly(null), false);
  assert.equal(normalizeEarthquakeFeltOnly(''), false);
  assert.equal(normalizeEarthquakeFeltOnly(false), false);
  assert.equal(normalizeEarthquakeFeltOnly(true), true);
  assert.equal(normalizeEarthquakeFeltOnly('1'), true);
  assert.equal(normalizeEarthquakeFeltOnly('true'), true);
  assert.equal(normalizeEarthquakeFeltOnly(0), false);
  assert.equal(normalizeEarthquakeFeltOnly('bogus'), null);
  assert.deepEqual(
    filterEarthquakeFeaturesByFeltReports(MIXED, false).map((feature) => feature.id),
    MIXED.map((feature) => feature.id),
  );
  assert.deepEqual(filterEarthquakeFeaturesByFeltReports(null), []);
  assert.deepEqual(filterEarthquakeFeaturesByFeltReports(undefined), []);
});

test('on keeps felt > 0 and hides missing/0/NaN', () => {
  assert.equal(earthquakeFeltReportCount(4), 4);
  assert.equal(earthquakeFeltReportCount('12'), 12);
  assert.ok(Number.isNaN(earthquakeFeltReportCount(undefined)));
  assert.equal(earthquakeFeltReportCount(null), 0);
  const kept = filterEarthquakeFeaturesByFeltReports(MIXED, true).map((feature) => feature.id);
  assert.deepEqual(kept, ['felt-int', 'felt-string', 'felt-one']);
  assert.ok(!kept.includes('zero'));
  assert.ok(!kept.includes('string-zero'));
  assert.ok(!kept.includes('missing'));
  assert.ok(!kept.includes('empty'));
  assert.ok(!kept.includes('nullish'));
  assert.ok(!kept.includes('nan'));
});

test('selected event stays visible when Felt only hides its report count', () => {
  assert.deepEqual(
    filterEarthquakeFeaturesByFeltReports(MIXED, true, { selectedId: 'zero' })
      .map((feature) => feature.id),
    ['felt-int', 'felt-string', 'felt-one', 'zero'],
  );
  assert.deepEqual(
    filterEarthquakeFeaturesByFeltReports(MIXED, true, { selectedId: 'missing' })
      .map((feature) => feature.id),
    ['felt-int', 'felt-string', 'felt-one', 'missing'],
  );
});

test('helper reads USGS properties.felt and the chip sits next to quake filters', () => {
  const helper = readFileSync(new URL('./earthquakeFeltFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/earthquakes.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.match(helper, /properties\.felt/);
  assert.match(helper, /Number\(.*felt.*\)\s*>\s*0|earthquakeFeltReportCount/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.match(source, /feltOnly/);
  assert.match(source, /filterEarthquakeFeaturesByFeltReports/);
  assert.match(html, /id="earthquake-felt-chips"/);
  assert.match(html, /data-earthquake-felt="only"/);
  assert.match(html, /Felt only/);
  assert.match(html, /id="earthquake-reviewed-chips"/);
  assert.match(html, /id="earthquake-tsunami-chips"/);
  assert.match(html, /id="earthquake-pager-chips"/);
  assert.match(html, /id="earthquake-type-chips"/);
  assert.match(ui, /earthquake-felt-chips|data-earthquake-felt/);
  assert.match(ui, /_earthquakeFeltChips\.hidden = !enabled/);
  assert.match(css, /earthquake-felt-chip/);
});
