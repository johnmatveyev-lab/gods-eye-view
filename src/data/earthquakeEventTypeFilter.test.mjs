// PLAN 161 — Event type chips. Client-only filter of USGS all_day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_EARTHQUAKE_EVENT_TYPES,
  EARTHQUAKE_EVENT_TYPES,
  EARTHQUAKE_EVENT_TYPE_LABELS,
  EARTHQUAKE_EVENT_TYPE_TITLES,
  earthquakeEventType,
  earthquakeEventTypeFlags,
  filterEarthquakeFeaturesByEventType,
  normalizeEarthquakeEventTypes,
  toggleEarthquakeEventType,
} from './earthquakeEventTypeFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function typedFeature(id, type) {
  const properties = { mag: 3.2, place: String(id), time: 1_753_600_000_000 };
  if (type !== undefined) properties.type = type;
  return { id, geometry: { coordinates: [-122.4, 37.79, 8.2] }, properties };
}

const MIXED = Object.freeze([
  typedFeature('quake-lower', 'earthquake'),
  typedFeature('quake-upper', 'EARTHQUAKE'),
  typedFeature('explosion-lower', 'explosion'),
  typedFeature('explosion-mixed', 'Explosion'),
  typedFeature('quarry-word', 'quarry'),
  typedFeature('quarry-blast', 'quarry blast'),
  typedFeature('quarry-blast-upper', 'Quarry Blast'),
  typedFeature('ice-quake', 'ice quake'),
  typedFeature('nuclear', 'nuclear explosion'),
  typedFeature('missing'),
  typedFeature('empty', ''),
  typedFeature('nullish', null),
]);

test('event type chips default all on and match the unfiltered set', () => {
  assert.equal(DEFAULT_EARTHQUAKE_EVENT_TYPES, 'QERO');
  assert.deepEqual([...EARTHQUAKE_EVENT_TYPES], ['quake', 'explosion', 'quarry', 'other']);
  assert.equal(EARTHQUAKE_EVENT_TYPE_LABELS.quake, 'Quake');
  assert.equal(EARTHQUAKE_EVENT_TYPE_LABELS.explosion, 'Explosion');
  assert.equal(EARTHQUAKE_EVENT_TYPE_LABELS.quarry, 'Quarry');
  assert.equal(EARTHQUAKE_EVENT_TYPE_LABELS.other, 'Other');
  assert.equal(EARTHQUAKE_EVENT_TYPE_TITLES.quake, 'Show tectonic earthquakes');
  assert.equal(normalizeEarthquakeEventTypes(undefined), 'QERO');
  assert.equal(normalizeEarthquakeEventTypes(null), 'QERO');
  assert.equal(normalizeEarthquakeEventTypes(''), 'QERO');
  assert.equal(normalizeEarthquakeEventTypes('all'), 'QERO');
  assert.equal(normalizeEarthquakeEventTypes('Q'), 'Q');
  assert.equal(normalizeEarthquakeEventTypes('qero'), 'QERO');
  assert.equal(normalizeEarthquakeEventTypes(['quake', 'other']), 'QO');
  assert.equal(normalizeEarthquakeEventTypes({ quake: true, explosion: false, quarry: true, other: false }), 'QR');
  assert.equal(normalizeEarthquakeEventTypes('0'), '0');
  assert.equal(normalizeEarthquakeEventTypes('bogus'), null);
  assert.equal(normalizeEarthquakeEventTypes('QX'), null);
  assert.deepEqual(
    filterEarthquakeFeaturesByEventType(MIXED, DEFAULT_EARTHQUAKE_EVENT_TYPES).map((feature) => feature.id),
    MIXED.map((feature) => feature.id),
  );
  assert.deepEqual(filterEarthquakeFeaturesByEventType(null), []);
  assert.deepEqual(filterEarthquakeFeaturesByEventType(undefined), []);
});

test('maps USGS properties.type onto Quake | Explosion | Quarry | Other', () => {
  assert.equal(earthquakeEventType('earthquake'), 'quake');
  assert.equal(earthquakeEventType('EARTHQUAKE'), 'quake');
  assert.equal(earthquakeEventType('explosion'), 'explosion');
  assert.equal(earthquakeEventType('quarry'), 'quarry');
  assert.equal(earthquakeEventType('quarry blast'), 'quarry');
  assert.equal(earthquakeEventType('Quarry Blast'), 'quarry');
  assert.equal(earthquakeEventType('ice quake'), 'other');
  assert.equal(earthquakeEventType('nuclear explosion'), 'other');
  assert.equal(earthquakeEventType(null), 'other');
  assert.equal(earthquakeEventType(''), 'other');
  assert.equal(earthquakeEventType(undefined), 'other');
});

test('Quarry off hides quarry and quarry blast; Quake-only keeps tectonic events', () => {
  const noQuarry = filterEarthquakeFeaturesByEventType(MIXED, 'QEO').map((feature) => feature.id);
  assert.ok(noQuarry.includes('quake-lower'));
  assert.ok(noQuarry.includes('explosion-lower'));
  assert.ok(noQuarry.includes('ice-quake'));
  assert.ok(!noQuarry.includes('quarry-word'));
  assert.ok(!noQuarry.includes('quarry-blast'));
  assert.ok(!noQuarry.includes('quarry-blast-upper'));

  const quakeOnly = filterEarthquakeFeaturesByEventType(MIXED, 'Q').map((feature) => feature.id);
  assert.deepEqual(quakeOnly, ['quake-lower', 'quake-upper']);
  assert.ok(!quakeOnly.includes('explosion-lower'));
  assert.ok(!quakeOnly.includes('ice-quake'));
  assert.ok(!quakeOnly.includes('missing'));
});

test('selected event stays visible when its type chip is off', () => {
  assert.deepEqual(
    filterEarthquakeFeaturesByEventType(MIXED, 'Q', { selectedId: 'quarry-blast' })
      .map((feature) => feature.id),
    ['quake-lower', 'quake-upper', 'quarry-blast'],
  );
});

test('last-off empties the set except a selected event', () => {
  assert.equal(toggleEarthquakeEventType('QERO', 'quake'), 'ERO');
  assert.equal(toggleEarthquakeEventType('Q', 'quake'), '0');
  assert.equal(toggleEarthquakeEventType('0', 'quake'), 'Q');
  assert.deepEqual(earthquakeEventTypeFlags('0'), {
    quake: false,
    explosion: false,
    quarry: false,
    other: false,
  });
  assert.deepEqual(filterEarthquakeFeaturesByEventType(MIXED, '0').map((feature) => feature.id), []);
  assert.deepEqual(
    filterEarthquakeFeaturesByEventType(MIXED, '0', { selectedId: 'ice-quake' }).map((feature) => feature.id),
    ['ice-quake'],
  );
});

test('helper reads USGS properties.type and the chips sit next to quake filters', () => {
  const helper = readFileSync(new URL('./earthquakeEventTypeFilter.js', import.meta.url), 'utf8');
  const source = readFileSync(path.join(ROOT, 'src/data/earthquakes.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.match(helper, /properties\.type/);
  assert.match(helper, /quarry blast/);
  assert.match(helper, /ice quake/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /quantum-earth|opensky-network|news\.google|telegeography/i);
  assert.match(source, /eventTypes/);
  assert.match(source, /filterEarthquakeFeaturesByEventType/);
  assert.match(html, /id="earthquake-type-chips"/);
  assert.match(html, /data-earthquake-type="quake"/);
  assert.match(html, /data-earthquake-type="explosion"/);
  assert.match(html, /data-earthquake-type="quarry"/);
  assert.match(html, /data-earthquake-type="other"/);
  assert.match(html, /id="earthquake-reviewed-chips"/);
  assert.match(html, /id="earthquake-pager-chips"/);
  assert.match(ui, /earthquake-type-chips|data-earthquake-type/);
  assert.match(ui, /_earthquakeTypeChips\.hidden = !enabled/);
  assert.match(css, /earthquake-type-chip/);
});
