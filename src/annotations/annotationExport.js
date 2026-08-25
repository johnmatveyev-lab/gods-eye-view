/**
 * @module annotationExport
 * @description Slim, operator-facing GeoJSON export of the live whiteboard.
 * Built from `engine.list()` in the browser. Same-tab download only.
 *
 * This is NOT the gev: interchange in annotationGeoJson.js. The download
 * carries only id, type, label, and color. Geometry:
 *   pin | highlight | label  →  Point      (anchor)
 *   arrow | route            →  LineString (path, else anchor → to)
 *   area with a ring         →  Polygon
 *   area without a ring      →  Point
 *
 * Coordinates are 2D GeoJSON positions `[lon, lat]`. Marks that cannot form
 * a valid geometry are dropped.
 */

export const EXPORT_FILENAME = 'meridian-annotations.geojson';
export const EXPORT_MIME = 'application/geo+json';

const POINT_TYPES = new Set(['pin', 'highlight', 'label', 'area']);
const LINE_TYPES = new Set(['arrow', 'route']);

/** {lon,lat} → [lon, lat], or null if not finite. */
function toLonLat(point) {
  if (!point || !Number.isFinite(point.lon) || !Number.isFinite(point.lat)) return null;
  return [point.lon, point.lat];
}

function exportProperties(anno) {
  return {
    id: anno.id ?? null,
    type: anno.type,
    label: anno.label ?? null,
    color: anno.color ?? null,
  };
}

function lineGeometry(anno) {
  const path = (Array.isArray(anno.path) ? anno.path : []).map(toLonLat).filter(Boolean);
  if (path.length >= 2) return { type: 'LineString', coordinates: path };
  const from = toLonLat(anno.anchor);
  const to = toLonLat(anno.to);
  if (!from || !to) return null;
  return { type: 'LineString', coordinates: [from, to] };
}

function polygonGeometry(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const coords = [];
  for (const pair of ring) {
    if (!Array.isArray(pair) || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1])) return null;
    coords.push([pair[0], pair[1]]);
  }
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
  return { type: 'Polygon', coordinates: [coords] };
}

/**
 * Convert one runtime annotation to a slim GeoJSON Feature.
 * @param {object} anno
 * @returns {object|null}
 */
export function annotationToExportFeature(anno) {
  if (!anno || typeof anno !== 'object') return null;
  const type = anno.type;
  let geometry = null;

  if (LINE_TYPES.has(type)) {
    geometry = lineGeometry(anno);
  } else if (type === 'area' && Array.isArray(anno.ring) && anno.ring.length >= 3) {
    geometry = polygonGeometry(anno.ring);
  } else if (POINT_TYPES.has(type)) {
    const anchor = toLonLat(anno.anchor);
    if (anchor) geometry = { type: 'Point', coordinates: anchor };
  }

  if (!geometry) return null;
  return { type: 'Feature', geometry, properties: exportProperties(anno) };
}

/**
 * Convert `engine.list()` (or any annotation array) to a FeatureCollection.
 * @param {Array<object>} annotations
 * @returns {{type:'FeatureCollection', features: object[]}}
 */
export function annotationsToExportCollection(annotations) {
  const features = (Array.isArray(annotations) ? annotations : [])
    .map(annotationToExportFeature)
    .filter(Boolean);
  return { type: 'FeatureCollection', features };
}

/**
 * Same-tab download of `meridian-annotations.geojson`. Inject `deps` in tests.
 * @param {object} collection
 * @param {object} [deps]
 */
export function downloadAnnotationsGeoJson(collection, deps = {}) {
  const json = JSON.stringify(collection, null, 2);
  const BlobCtor = deps.Blob || globalThis.Blob;
  const createObjectURL = deps.createObjectURL || globalThis.URL.createObjectURL.bind(globalThis.URL);
  const revokeObjectURL = deps.revokeObjectURL || globalThis.URL.revokeObjectURL.bind(globalThis.URL);
  const createElement = deps.createElement || document.createElement.bind(document);
  const body = deps.body || document.body;

  const blob = new BlobCtor([json], { type: EXPORT_MIME });
  const href = createObjectURL(blob);
  const link = createElement('a');
  link.href = href;
  link.download = EXPORT_FILENAME;
  body.appendChild(link);
  link.click();
  if (typeof link.remove === 'function') link.remove();
  else body.removeChild(link);
  revokeObjectURL(href);
}
