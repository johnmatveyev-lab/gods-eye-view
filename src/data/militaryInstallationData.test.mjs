import test from 'node:test';
import assert from 'node:assert/strict';
import { filterInstallationsByClass } from './militaryInstallationClassFilter.js';
import {
  filterInstallationsByFootprint,
  installationHasUsableFootprint,
} from './militaryFootprintFilter.js';
import {
  humanizeInstallationClass,
  isValidInstallationBoundingBox,
  normalizeMilitaryInstallations,
} from './militaryInstallationData.js';

test('normalizes allowed OSM installation features and deduplicates ids', () => {
  const result = normalizeMilitaryInstallations({ elements: [
    { type: 'way', id: 7, center: { lat: 12, lon: 77 }, tags: { military: 'airfield', name: 'Example' }, geometry: [{ lat: 12, lon: 77 }, { lat: 12.1, lon: 77 }, { lat: 12, lon: 77.1 }] },
    { type: 'way', id: 7, center: { lat: 12, lon: 77 }, tags: { military: 'airfield' } },
    { type: 'node', id: 8, lat: 0, lon: 179.9, tags: { landuse: 'military' } },
  ] }, '2026-07-21T00:00:00.000Z');
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].class, 'airfield');
  assert.deepEqual(result.records[0].footprint[0], [77, 12]);
  assert.equal(result.records[1].longitude, 179.9);
  assert.equal(result.droppedCount, 1);
});

test('drops malformed and unsupported OSM features', () => {
  const result = normalizeMilitaryInstallations({ elements: [
    { type: 'node', id: 1, lat: 95, lon: 0, tags: { military: 'range' } },
    { type: 'node', id: 2, lat: 1, lon: 2, tags: { military: 'radar' } },
  ] });
  assert.deepEqual(result.records, []);
  assert.equal(result.droppedCount, 2);
});

test('an unnamed feature reads as its class, never as a raw OSM id', () => {
  const result = normalizeMilitaryInstallations({ elements: [
    { type: 'way', id: 10981656305, center: { lat: 30.2, lon: -97.7 }, tags: { military: 'range' } },
    { type: 'way', id: 22, center: { lat: 30.3, lon: -97.6 }, tags: { military: 'airfield' } },
    { type: 'node', id: 33, lat: 30.4, lon: -97.5, tags: { military: 'naval_base' } },
    { type: 'node', id: 44, lat: 30.5, lon: -97.4, tags: { landuse: 'military' } },
    // A blank OSM name must fall through to the class, not to an empty label.
    { type: 'node', id: 55, lat: 30.6, lon: -97.3, tags: { military: 'range', name: '   ' } },
  ] }, '2026-08-18T00:00:00.000Z');

  assert.deepEqual(
    result.records.map((record) => record.name),
    ['Firing range', 'Military airfield', 'Naval base', 'Military land', 'Firing range'],
  );
  for (const record of result.records) {
    assert.doesNotMatch(record.name, /\d/, `label must carry no OSM id: ${record.name}`);
    assert.doesNotMatch(record.name, /[()]/, `label must carry no id parenthetical: ${record.name}`);
  }
  for (const record of result.records) {
    assert.equal(record.hasName, false, `class fallback is not a real name: ${record.name}`);
  }
  // The id is not lost — attribution and the details panel still resolve it.
  assert.equal(result.records[0].id, 'osm:way:10981656305');
  assert.deepEqual(result.records[0].sources, [
    { name: 'OpenStreetMap', id: 'way/10981656305', retrievedAt: '2026-08-18T00:00:00.000Z' },
  ]);
});

test('a real OSM name always wins over the class label', () => {
  const result = normalizeMilitaryInstallations({ elements: [
    { type: 'way', id: 1, center: { lat: 30, lon: -97 }, tags: { military: 'range', name: 'Camp Swift' } },
    { type: 'way', id: 2, center: { lat: 30.1, lon: -97.1 }, tags: { military: 'airfield', 'name:en': 'Bergstrom' } },
  ] });
  assert.deepEqual(result.records.map((record) => record.name), ['Camp Swift', 'Bergstrom']);
  assert.deepEqual(result.records.map((record) => record.hasName), [true, true]);
});

test('an unmapped class title-cases instead of leaking an underscored tag', () => {
  assert.equal(humanizeInstallationClass('danger_area'), 'Danger area');
  assert.equal(humanizeInstallationClass('checkpoint'), 'Checkpoint');
  assert.equal(humanizeInstallationClass('training_area_north'), 'Training area north');
  assert.equal(humanizeInstallationClass(''), 'Mapped installation');
  assert.equal(humanizeInstallationClass(null), 'Mapped installation');
});

test('accepts only small non-dateline request bboxes', () => {
  assert.equal(isValidInstallationBoundingBox({ south: -1, west: 170, north: 1, east: 179 }), true);
  assert.equal(isValidInstallationBoundingBox({ south: -1, west: 179, north: 1, east: -179 }), false);
  assert.equal(isValidInstallationBoundingBox({ south: -20, west: 0, north: 20, east: 1 }), false);
});

// Live Overpass `out center tags geom` prints rings, not `center`. Austin
// Camp Mabry (way 27894251) is this shape: 51 verts, no way lat/lon/center.
const CAMP_MABRY_RING = Object.freeze([
  { lat: 30.3110, lon: -97.7610 },
  { lat: 30.3110, lon: -97.7600 },
  { lat: 30.3120, lon: -97.7600 },
  { lat: 30.3120, lon: -97.7610 },
  { lat: 30.3110, lon: -97.7610 },
]);

test('a geom-only way (no center) becomes a record with a usable footprint', () => {
  const result = normalizeMilitaryInstallations({ elements: [
    {
      type: 'way',
      id: 27894251,
      tags: { landuse: 'military', name: 'Camp Mabry' },
      geometry: CAMP_MABRY_RING,
    },
    {
      type: 'node',
      id: 42,
      lat: 30.27,
      lon: -97.73,
      tags: { military: 'base', name: 'Audie Murphy Training Center' },
    },
  ] }, '2026-08-25T00:00:00.000Z');

  assert.equal(result.droppedCount, 0);
  assert.equal(result.records.length, 2);
  const camp = result.records[0];
  assert.equal(camp.id, 'osm:way:27894251');
  assert.equal(camp.name, 'Camp Mabry');
  assert.equal(camp.osmType, 'way');
  assert.deepEqual(camp.footprint, [
    [-97.7610, 30.3110],
    [-97.7600, 30.3110],
    [-97.7600, 30.3120],
    [-97.7610, 30.3120],
    [-97.7610, 30.3110],
  ]);
  assert.equal(installationHasUsableFootprint(camp), true);
  assert.ok(Number.isFinite(camp.latitude) && Number.isFinite(camp.longitude));
  assert.ok(camp.latitude > 30.311 && camp.latitude < 30.312);
  assert.ok(camp.longitude > -97.761 && camp.longitude < -97.760);
  const node = result.records[1];
  assert.equal(node.id, 'osm:node:42');
  assert.equal(node.footprint, null);
  assert.equal(installationHasUsableFootprint(node), false);
});

test('geom-only ways stay under Footprints only; point nodes hide; selected/class AND unchanged', () => {
  const { records } = normalizeMilitaryInstallations({ elements: [
    {
      type: 'way',
      id: 27894251,
      tags: { landuse: 'military', name: 'Camp Mabry' },
      geometry: CAMP_MABRY_RING,
    },
    {
      type: 'node',
      id: 42,
      lat: 30.27,
      lon: -97.73,
      tags: { military: 'base', name: 'Audie Murphy Training Center' },
    },
    {
      type: 'way',
      id: 9,
      tags: { military: 'airfield', name: 'Bergstrom' },
      geometry: CAMP_MABRY_RING,
    },
  ] });

  assert.deepEqual(
    filterInstallationsByFootprint(records, false).map((record) => record.id),
    ['osm:way:27894251', 'osm:node:42', 'osm:way:9'],
  );
  assert.deepEqual(
    filterInstallationsByFootprint(records, true).map((record) => record.id),
    ['osm:way:27894251', 'osm:way:9'],
    'Footprints only keeps geom-only ways and hides the point node',
  );
  assert.deepEqual(
    filterInstallationsByFootprint(records, true, 'osm:node:42').map((record) => record.id),
    ['osm:way:27894251', 'osm:node:42', 'osm:way:9'],
    'selected point node stays when Footprints only is on',
  );
  const afterClass = filterInstallationsByClass(records, 'LP');
  assert.deepEqual(
    afterClass.map((record) => record.id),
    ['osm:way:27894251', 'osm:node:42'],
    'Airfield off hides Bergstrom before Footprints only runs',
  );
  assert.deepEqual(
    filterInstallationsByFootprint(afterClass, true).map((record) => record.id),
    ['osm:way:27894251'],
    'class chips AND Footprints only; point land node still hides',
  );
  assert.deepEqual(
    filterInstallationsByFootprint(afterClass, true, 'osm:node:42').map((record) => record.id),
    ['osm:way:27894251', 'osm:node:42'],
    'selected point node stays through both filters',
  );
});

test('a way with neither center nor finite geometry is still dropped', () => {
  const result = normalizeMilitaryInstallations({ elements: [
    { type: 'way', id: 1, tags: { military: 'base', name: 'No geometry' } },
    { type: 'way', id: 2, tags: { military: 'base', name: 'Bad verts' }, geometry: [{ lat: 95, lon: 0 }, { lat: 96, lon: 1 }, { lat: 97, lon: 2 }] },
  ] });
  assert.deepEqual(result.records, []);
  assert.equal(result.droppedCount, 2);
});
