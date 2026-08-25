// PLAN 156 — Reviewed only toggle. Client-only filter of USGS all_day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_EARTHQUAKE_REVIEWED_ONLY,
  EARTHQUAKE_REVIEWED_CHIP_LABEL,
  EARTHQUAKE_REVIEWED_CHIP_TITLE,
  earthquakeReviewStatus,
  filterEarthquakeFeaturesByReviewedStatus,
  normalizeEarthquakeReviewedOnly,
} from './earthquakeReviewedFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function reviewedFeature(id, status) {
  const properties = { mag: 3.2, place: String(id), time: 1_753_600_000_000 };
  if (status !== undefined) properties.status = status;
  return { id, geometry: { coordinates: [-122.4, 37.79, 8.2] }, properties };
}

const MIXED = Object.freeze([
  reviewedFeature('reviewed-lower', 'reviewed'),
  reviewedFeature('reviewed-upper', 'REVIEWED'),
  reviewedFeature('reviewed-mixed', 'Reviewed'),
  reviewedFeature('automatic', 'automatic'),
  reviewedFeature('deleted', 'deleted'),
  reviewedFeature('other', 'unknown'),
  reviewedFeature('missing'),
  reviewedFeature('empty', ''),
  reviewedFeature('nullish', null),
]);

test('Reviewed only defaults off and matches the unfiltered set', () => {
  assert.equal(DEFAULT_EARTHQUAKE_REVIEWED_ONLY, false);
  assert.equal(EARTHQUAKE_REVIEWED_CHIP_LABEL, 'Reviewed only');
  assert.equal(EARTHQUAKE_REVIEWED_CHIP_TITLE, 'Show only reviewed earthquakes');
  assert.equal(normalizeEarthquakeReviewedOnly(undefined), false);
  assert.equal(normalizeEarthquakeReviewedOnly(null), false);
  assert.equal(normalizeEarthquakeReviewedOnly(''), false);
  assert.equal(normalizeEarthquakeReviewedOnly(false), false);
  assert.equal(normalizeEarthquakeReviewedOnly(true), true);
  assert.equal(normalizeEarthquakeReviewedOnly('1'), true);
  assert.equal(normalizeEarthquakeReviewedOnly('true'), true);
  assert.equal(normalizeEarthquakeReviewedOnly(0), false);
  assert.equal(normalizeEarthquakeReviewedOnly('bogus'), null);
  assert.deepEqual(
    filterEarthquakeFeaturesByReviewedStatus(MIXED, false).map((feature) => feature.id),
    MIXED.map((feature) => feature.id),
  );
  assert.deepEqual(filterEarthquakeFeaturesByReviewedStatus(null), []);
  assert.deepEqual(filterEarthquakeFeaturesByReviewedStatus(undefined), []);
});

test('on keeps reviewed status (any case) and hides automatic/deleted/missing/other', () => {
  assert.equal(earthquakeReviewStatus('REVIEWED'), 'reviewed');
  assert.equal(earthquakeReviewStatus(null), '');
  const kept = filterEarthquakeFeaturesByReviewedStatus(MIXED, true).map((feature) => feature.id);
  assert.deepEqual(kept, ['reviewed-lower', 'reviewed-upper', 'reviewed-mixed']);
  assert.ok(!kept.includes('automatic'));
  assert.ok(!kept.includes('deleted'));
  assert.ok(!kept.includes('other'));
  assert.ok(!kept.includes('missing'));
  assert.ok(!kept.includes('empty'));
  assert.ok(!kept.includes('nullish'));
});

test('selected event stays visible when Reviewed only hides its status', () => {
  assert.deepEqual(
    filterEarthquakeFeaturesByReviewedStatus(MIXED, true, { selectedId: 'automatic' })
      .map((feature) => feature.id),
    ['reviewed-lower', 'reviewed-upper', 'reviewed-mixed', 'automatic'],
  );
});

test('helper reads USGS properties.status and the chip sits next to quake filters', () => {
  const helper = readFileSync(new URL('./earthquakeReviewedFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/earthquakes.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.match(helper, /properties\.status/);
  assert.match(helper, /reviewed/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.match(source, /reviewedOnly/);
  assert.match(source, /filterEarthquakeFeaturesByReviewedStatus/);
  assert.match(html, /id="earthquake-reviewed-chips"/);
  assert.match(html, /data-earthquake-reviewed="only"/);
  assert.match(html, /Reviewed only/);
  assert.match(html, /id="earthquake-tsunami-chips"/);
  assert.match(html, /id="earthquake-pager-chips"/);
  assert.match(html, /id="earthquake-type-chips"/);
  assert.match(ui, /earthquake-reviewed-chips|data-earthquake-reviewed/);
  assert.match(ui, /_earthquakeReviewedChips\.hidden = !enabled/);
  assert.match(css, /earthquake-reviewed-chip/);
});
