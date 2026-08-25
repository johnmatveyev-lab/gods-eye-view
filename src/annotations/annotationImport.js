/**
 * @module annotationImport
 * @description Slim, operator-facing GeoJSON import for the live whiteboard.
 * Inverse of annotationExport.js: a FeatureCollection becomes annotate() specs
 * that already carry latitude/longitude (and ring/points). Labels stay as
 * written on the file; the file is the geometry.
 *
 * Mapping (same as Plan 114 export):
 *   Point       → pin | highlight | label | degenerate area
 *   LineString  → arrow | route
 *   Polygon     → area with ring
 *
 * Features without usable coordinates are skipped. A payload that is not a
 * FeatureCollection is invalid (the chrome treats that as a no-op + status).
 */

const POINT_TYPES = new Set(['pin', 'highlight', 'label', 'area']);
const LINE_TYPES = new Set(['arrow', 'route']);

export const IMPORT_INVALID_STATUS = 'Invalid GeoJSON';

/** GeoJSON position → {lon,lat}, or null if malformed. */
function fromPosition(c) {
  if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  return { lon: c[0], lat: c[1] };
}

function featureProperties(feature) {
  return feature?.properties && typeof feature.properties === 'object' ? feature.properties : {};
}

/**
 * Convert one slim GeoJSON Feature to an annotate() spec.
 * @param {object} feature
 * @returns {object|null}
 */
export function featureToAnnotateSpec(feature) {
  if (!feature || feature.type !== 'Feature' || !feature.geometry) return null;
  const g = feature.geometry;
  const p = featureProperties(feature);
  const declared = typeof p.type === 'string' ? p.type : null;
  const label = p.label ?? null;
  const color = p.color ?? null;

  if (g.type === 'Point') {
    const pos = fromPosition(g.coordinates);
    if (!pos) return null;
    const type = POINT_TYPES.has(declared) ? declared : 'pin';
    return { type, label, color, latitude: pos.lat, longitude: pos.lon };
  }

  if (g.type === 'LineString') {
    if (!Array.isArray(g.coordinates) || g.coordinates.length < 2) return null;
    const coords = g.coordinates.map(fromPosition);
    if (coords.some((x) => !x)) return null;
    if (declared === 'route' || (!LINE_TYPES.has(declared) && coords.length > 2)) {
      return {
        type: 'route',
        label,
        color,
        points: coords.map((c) => ({ latitude: c.lat, longitude: c.lon })),
      };
    }
    return {
      type: 'arrow',
      label,
      color,
      latitude: coords[0].lat,
      longitude: coords[0].lon,
      toLatitude: coords[coords.length - 1].lat,
      toLongitude: coords[coords.length - 1].lon,
    };
  }

  if (g.type === 'Polygon') {
    if (!Array.isArray(g.coordinates) || !Array.isArray(g.coordinates[0])) return null;
    const raw = g.coordinates[0];
    if (raw.length < 4) return null;
    const ring = [];
    for (const c of raw) {
      if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
      ring.push([c[0], c[1]]);
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (ring.length > 3 && first[0] === last[0] && first[1] === last[1]) ring.pop();
    if (ring.length < 3) return null;
    let lon = 0;
    let lat = 0;
    for (const [x, y] of ring) { lon += x; lat += y; }
    return {
      type: 'area',
      label,
      color,
      latitude: lat / ring.length,
      longitude: lon / ring.length,
      ring,
      footprint: false,
    };
  }

  return null;
}

/**
 * Convert a FeatureCollection to annotate() specs. Malformed features are skipped.
 * @param {object} collection
 * @returns {Array<object>}
 */
export function featureCollectionToAnnotateSpecs(collection) {
  if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    return [];
  }
  return collection.features.map(featureToAnnotateSpec).filter(Boolean);
}

/**
 * Parse operator-facing GeoJSON text. Fail closed on anything that is not a
 * FeatureCollection; skip features that cannot form a mark.
 * @param {string} text
 * @returns {{ok: boolean, specs: Array<object>, error?: string}}
 */
export function parseAnnotationImportText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, specs: [], error: 'invalid' };
  }
  if (!parsed || parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
    return { ok: false, specs: [], error: 'invalid' };
  }
  return { ok: true, specs: featureCollectionToAnnotateSpecs(parsed) };
}
