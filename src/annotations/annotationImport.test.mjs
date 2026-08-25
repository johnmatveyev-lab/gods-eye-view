// Slim GeoJSON import — inverse of annotationExport.js.
// Features without coordinates are skipped. Not a FeatureCollection is invalid.
//
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  annotationsToExportCollection,
} from './annotationExport.js';
import {
  IMPORT_INVALID_STATUS,
  featureToAnnotateSpec,
  featureCollectionToAnnotateSpecs,
  parseAnnotationImportText,
} from './annotationImport.js';

test('Point / LineString / Polygon map to pin, arrow|route, and area with ring', () => {
  const pin = featureToAnnotateSpec({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-122.42, 37.77] },
    properties: { id: 'a', type: 'pin', label: 'First', color: 'cyan' },
  });
  assert.deepEqual(pin, {
    type: 'pin',
    label: 'First',
    color: 'cyan',
    latitude: 37.77,
    longitude: -122.42,
  });

  const highlight = featureToAnnotateSpec({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [1, 2] },
    properties: { type: 'highlight', label: 'Palace', color: 'amber' },
  });
  assert.equal(highlight.type, 'highlight');
  assert.equal(highlight.latitude, 2);
  assert.equal(highlight.longitude, 1);

  const arrow = featureToAnnotateSpec({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[-122.45, 37.80], [-122.44, 37.81]] },
    properties: { type: 'arrow', label: 'Connector', color: 'primary' },
  });
  assert.deepEqual(arrow, {
    type: 'arrow',
    label: 'Connector',
    color: 'primary',
    latitude: 37.80,
    longitude: -122.45,
    toLatitude: 37.81,
    toLongitude: -122.44,
  });

  const route = featureToAnnotateSpec({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [[-122.45, 37.80], [-122.47, 37.81], [-122.48, 37.82]],
    },
    properties: { type: 'route', label: 'Crissy Field shoreline', color: 'amber' },
  });
  assert.equal(route.type, 'route');
  assert.equal(route.points.length, 3);
  assert.deepEqual(route.points[0], { latitude: 37.80, longitude: -122.45 });

  const area = featureToAnnotateSpec({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[-122.46, 37.79], [-122.44, 37.81], [-122.43, 37.79], [-122.46, 37.79]]],
    },
    properties: { type: 'area', label: 'The Presidio', color: 'green' },
  });
  assert.equal(area.type, 'area');
  assert.equal(area.footprint, false);
  assert.equal(area.ring.length, 3);
  assert.deepEqual(area.ring[0], [-122.46, 37.79]);
  assert.equal(area.label, 'The Presidio');
});

test('export then import restores pins, lines, and areas with labels', () => {
  const collection = annotationsToExportCollection([
    { type: 'pin', id: 'a', label: 'First', color: 'cyan', anchor: { lon: -122.42, lat: 37.77 } },
    { type: 'pin', id: 'b', label: 'Second', color: 'amber', anchor: { lon: -122.45, lat: 37.80 } },
    {
      type: 'arrow',
      id: 'c',
      label: 'Connector',
      color: 'primary',
      anchor: { lon: -122.45, lat: 37.80 },
      to: { lon: -122.44, lat: 37.81 },
    },
    {
      type: 'area',
      id: 'd',
      label: 'The Presidio',
      color: 'green',
      anchor: { lon: -122.45, lat: 37.80 },
      ring: [[-122.46, 37.79], [-122.44, 37.81], [-122.43, 37.79]],
    },
  ]);
  const specs = featureCollectionToAnnotateSpecs(collection);
  assert.equal(specs.length, 4);
  assert.deepEqual(specs.map((s) => s.type), ['pin', 'pin', 'arrow', 'area']);
  assert.deepEqual(specs.map((s) => s.label), ['First', 'Second', 'Connector', 'The Presidio']);
  assert.equal(specs[0].latitude, 37.77);
  assert.equal(specs[0].longitude, -122.42);
  assert.equal(specs[2].toLatitude, 37.81);
  assert.equal(specs[3].ring.length, 3);
  assert.equal(specs[3].footprint, false);
  for (const spec of specs) {
    assert.equal(spec.target, undefined);
    assert.equal(spec.toTarget, undefined);
  }
});

test('features without coordinates are skipped', () => {
  const specs = featureCollectionToAnnotateSpecs({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { type: 'pin', label: 'Keep' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [NaN, 2] }, properties: { type: 'pin', label: 'Bad' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [] }, properties: { type: 'pin', label: 'Empty' } },
      { type: 'Feature', geometry: null, properties: { type: 'pin', label: 'No geom' } },
      { type: 'Feature', properties: { type: 'pin', label: 'Missing geom' } },
      { type: 'NotAFeature', geometry: { type: 'Point', coordinates: [3, 4] } },
    ],
  });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].label, 'Keep');
});

test('malformed payloads are invalid; a FeatureCollection with no usable features is ok and empty', () => {
  assert.deepEqual(parseAnnotationImportText('not json'), { ok: false, specs: [], error: 'invalid' });
  assert.deepEqual(parseAnnotationImportText('{"type":"Feature"}'), { ok: false, specs: [], error: 'invalid' });
  assert.deepEqual(parseAnnotationImportText('null'), { ok: false, specs: [], error: 'invalid' });
  assert.equal(IMPORT_INVALID_STATUS, 'Invalid GeoJSON');

  const empty = parseAnnotationImportText(JSON.stringify({ type: 'FeatureCollection', features: [] }));
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.specs, []);

  const skipped = parseAnnotationImportText(JSON.stringify({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [] }, properties: {} }],
  }));
  assert.equal(skipped.ok, true);
  assert.deepEqual(skipped.specs, []);
});
