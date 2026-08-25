// Slim GeoJSON export — operator download of engine.list().
// Properties are id/type/label/color only. No gev: interchange, no upload.
//
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_FILENAME,
  EXPORT_MIME,
  annotationToExportFeature,
  annotationsToExportCollection,
  downloadAnnotationsGeoJson,
} from './annotationExport.js';

function propertyKeys(feature) {
  return Object.keys(feature.properties).sort();
}

test('pin and highlight become Points with only id/type/label/color', () => {
  const pin = {
    type: 'pin',
    id: 'anno-1',
    label: 'ILM',
    color: 'cyan',
    anchor: { lon: -122.45, lat: 37.80, height: 12 },
    to: null,
    ring: null,
  };
  const feature = annotationToExportFeature(pin);
  assert.equal(feature.type, 'Feature');
  assert.equal(feature.geometry.type, 'Point');
  assert.deepEqual(feature.geometry.coordinates, [-122.45, 37.80]);
  assert.deepEqual(feature.properties, { id: 'anno-1', type: 'pin', label: 'ILM', color: 'cyan' });
  assert.deepEqual(propertyKeys(feature), ['color', 'id', 'label', 'type']);

  const highlight = annotationToExportFeature({
    type: 'highlight',
    id: 'anno-2',
    label: 'Palace',
    color: 'amber',
    anchor: { lon: -122.4486, lat: 37.8029 },
  });
  assert.equal(highlight.geometry.type, 'Point');
  assert.equal(highlight.properties.type, 'highlight');
});

test('arrow uses LineString from path, else anchor → to', () => {
  const fromPath = annotationToExportFeature({
    type: 'arrow',
    id: 'anno-3',
    label: 'via path',
    color: 'primary',
    anchor: { lon: 0, lat: 0 },
    to: { lon: 9, lat: 9 },
    path: [{ lon: 1, lat: 2 }, { lon: 3, lat: 4 }, { lon: 5, lat: 6 }],
  });
  assert.equal(fromPath.geometry.type, 'LineString');
  assert.deepEqual(fromPath.geometry.coordinates, [[1, 2], [3, 4], [5, 6]]);

  const fromEnds = annotationToExportFeature({
    type: 'arrow',
    id: 'anno-4',
    label: 'next to the Marina',
    color: 'primary',
    anchor: { lon: -122.45, lat: 37.80 },
    to: { lon: -122.44, lat: 37.81 },
  });
  assert.equal(fromEnds.geometry.type, 'LineString');
  assert.deepEqual(fromEnds.geometry.coordinates, [[-122.45, 37.80], [-122.44, 37.81]]);
  assert.deepEqual(fromEnds.properties, {
    id: 'anno-4',
    type: 'arrow',
    label: 'next to the Marina',
    color: 'primary',
  });
});

test('route uses LineString from path', () => {
  const route = annotationToExportFeature({
    type: 'route',
    id: 'anno-5',
    label: 'Crissy Field shoreline',
    color: 'amber',
    path: [{ lon: -122.45, lat: 37.80 }, { lon: -122.47, lat: 37.81 }],
  });
  assert.equal(route.geometry.type, 'LineString');
  assert.equal(route.geometry.coordinates.length, 2);
  assert.equal(route.properties.type, 'route');
});

test('area with a ring is a closed Polygon; without a ring it is a Point', () => {
  const area = annotationToExportFeature({
    type: 'area',
    id: 'anno-6',
    label: 'The Presidio',
    color: 'green',
    anchor: { lon: -122.45, lat: 37.80 },
    ring: [[-122.46, 37.79], [-122.44, 37.81], [-122.43, 37.79]],
  });
  assert.equal(area.geometry.type, 'Polygon');
  const ring = area.geometry.coordinates[0];
  assert.equal(ring.length, 4);
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  assert.deepEqual(propertyKeys(area), ['color', 'id', 'label', 'type']);

  const pointArea = annotationToExportFeature({
    type: 'area',
    id: 'anno-7',
    label: 'pending',
    color: 'primary',
    anchor: { lon: 10, lat: 20 },
    ring: null,
  });
  assert.equal(pointArea.geometry.type, 'Point');
  assert.deepEqual(pointArea.geometry.coordinates, [10, 20]);
});

test('two pins + one arrow become a 3-feature FeatureCollection', () => {
  const collection = annotationsToExportCollection([
    { type: 'pin', id: 'a', label: 'First', color: 'cyan', anchor: { lon: 1, lat: 2 } },
    { type: 'pin', id: 'b', label: 'Second', color: 'amber', anchor: { lon: 3, lat: 4 } },
    {
      type: 'arrow',
      id: 'c',
      label: 'Connector',
      color: 'primary',
      anchor: { lon: 5, lat: 6 },
      to: { lon: 7, lat: 8 },
    },
  ]);
  assert.equal(collection.type, 'FeatureCollection');
  assert.equal(collection.features.length, 3);
  assert.deepEqual(collection.features.map((f) => f.geometry.type), ['Point', 'Point', 'LineString']);
  assert.deepEqual(collection.features.map((f) => f.properties.label), ['First', 'Second', 'Connector']);
  JSON.parse(JSON.stringify(collection));
});

test('malformed marks are dropped; empty input is a valid empty collection', () => {
  assert.equal(annotationToExportFeature(null), null);
  assert.equal(annotationToExportFeature({ type: 'blob', anchor: { lon: 0, lat: 0 } }), null);
  assert.equal(annotationToExportFeature({ type: 'pin', label: 'no coords' }), null);
  assert.deepEqual(annotationsToExportCollection([]), { type: 'FeatureCollection', features: [] });
  assert.deepEqual(annotationsToExportCollection('nope'), { type: 'FeatureCollection', features: [] });
});

test('downloadAnnotationsGeoJson writes meridian-annotations.geojson in the same tab', () => {
  const clicks = [];
  const revoked = [];
  const created = [];
  const children = [];
  const collection = annotationsToExportCollection([
    { type: 'pin', id: 'a', label: 'First', color: 'cyan', anchor: { lon: 1, lat: 2 } },
  ]);

  downloadAnnotationsGeoJson(collection, {
    Blob: class {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = opts.type;
      }
    },
    createObjectURL(blob) {
      created.push(blob);
      return 'blob:meridian-test';
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
    createElement() {
      return {
        href: '',
        download: '',
        click() {
          clicks.push({ href: this.href, download: this.download, target: this.target });
        },
        remove() {
          const index = children.indexOf(this);
          if (index >= 0) children.splice(index, 1);
        },
      };
    },
    body: {
      appendChild(el) { children.push(el); },
      removeChild(el) {
        const index = children.indexOf(el);
        if (index >= 0) children.splice(index, 1);
      },
    },
  });

  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].download, EXPORT_FILENAME);
  assert.equal(clicks[0].download, 'meridian-annotations.geojson');
  assert.equal(clicks[0].target, undefined);
  assert.equal(created[0].type, EXPORT_MIME);
  const parsed = JSON.parse(created[0].parts[0]);
  assert.equal(parsed.type, 'FeatureCollection');
  assert.equal(parsed.features.length, 1);
  assert.deepEqual(revoked, ['blob:meridian-test']);
  assert.equal(children.length, 0);
});
