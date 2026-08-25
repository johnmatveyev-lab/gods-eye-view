/**
 * Normalize the deliberately small, allow-listed installation context returned
 * by `/api/military-installations`. These are mapped features, not assertions
 * about a facility's capability, occupancy, or operational status.
 */

const CLASS_BY_MILITARY_TAG = {
  airfield: 'airfield',
  naval_base: 'naval_base',
  range: 'range',
  barracks: 'military_land',
  base: 'military_land',
};

/**
 * How an UNNAMED feature reads on the map (field test 2026-08-18: the old
 * fallback surfaced "range (10981656305)" — an OSM primary key shown to a human
 * as if it were a place name).
 *
 * Only the classes CLASS_BY_MILITARY_TAG can actually produce need an entry;
 * anything else title-cases its class, which already reads correctly for plain
 * nouns. The OSM id is not lost — it stays on `id` and on `sources[].id`, where
 * attribution and the details panel read it.
 */
const LABEL_BY_CLASS = {
  airfield: 'Military airfield',
  naval_base: 'Naval base',
  range: 'Firing range',
  military_land: 'Military land',
};

const MAX_FOOTPRINT_POINTS = 400;

/**
 * Human-readable label for an unnamed feature's class.
 * @param {string} klass Installation class.
 * @returns {string} Display label, never empty.
 */
export function humanizeInstallationClass(klass) {
  const key = String(klass || '').trim().toLowerCase();
  if (LABEL_BY_CLASS[key]) return LABEL_BY_CLASS[key];
  const words = key.replaceAll('_', ' ').trim();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : 'Mapped installation';
}

function finiteLatitude(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function finiteLongitude(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * Display pin when Overpass omitted lat/lon/center. `out center tags geom N`
 * is one geometry mode per print; `geom` is last, so ways arrive as rings
 * with no `center`. Mean of finite vertices, else the first finite vertex.
 * @param {unknown} geometry
 * @returns {{latitude: number, longitude: number}|null}
 */
function pointFromGeometry(geometry) {
  if (!Array.isArray(geometry) || !geometry.length) return null;
  let latSum = 0;
  let lonSum = 0;
  let count = 0;
  let first = null;
  for (const vertex of geometry) {
    const latitude = Number(vertex?.lat);
    const longitude = Number(vertex?.lon);
    if (!finiteLatitude(latitude) || !finiteLongitude(longitude)) continue;
    if (!first) first = { latitude, longitude };
    latSum += latitude;
    lonSum += longitude;
    count += 1;
  }
  if (!count) return null;
  const latitude = latSum / count;
  const longitude = lonSum / count;
  return finiteLatitude(latitude) && finiteLongitude(longitude) ? { latitude, longitude } : first;
}

function pointFrom(element) {
  const lat = Number(element?.lat ?? element?.center?.lat);
  const longitude = Number(element?.lon ?? element?.center?.lon);
  if (finiteLatitude(lat) && finiteLongitude(longitude)) return { latitude: lat, longitude };
  return pointFromGeometry(element?.geometry);
}

function footprintFrom(element) {
  if (!Array.isArray(element?.geometry) || element.geometry.length < 3 || element.geometry.length > MAX_FOOTPRINT_POINTS) return null;
  const points = [];
  for (const point of element.geometry) {
    const latitude = Number(point?.lat);
    const longitude = Number(point?.lon);
    if (!finiteLatitude(latitude) || !finiteLongitude(longitude)) return null;
    points.push([longitude, latitude]);
  }
  return points;
}

/**
 * Convert a safe, server-filtered Overpass payload into display records.
 * @param {{elements?: Array}} payload
 * @param {string} [retrievedAt]
 * @returns {{records: Array, droppedCount: number}}
 */
export function normalizeMilitaryInstallations(payload, retrievedAt = new Date().toISOString()) {
  const records = [];
  const ids = new Set();
  let droppedCount = 0;
  for (const element of Array.isArray(payload?.elements) ? payload.elements : []) {
    const type = String(element?.type || '');
    const osmId = Number(element?.id);
    if (!['node', 'way', 'relation'].includes(type) || !Number.isSafeInteger(osmId)) {
      droppedCount += 1;
      continue;
    }
    const id = `osm:${type}:${osmId}`;
    const tags = element?.tags || {};
    const klass = CLASS_BY_MILITARY_TAG[String(tags.military || '').toLowerCase()]
      || (tags.landuse === 'military' ? 'military_land' : null);
    const point = pointFrom(element);
    if (!klass || !point || ids.has(id)) {
      droppedCount += 1;
      continue;
    }
    ids.add(id);
    const taggedName = String(tags.name || tags['name:en'] || '').trim();
    records.push({
      id,
      kind: 'installation',
      // Load-bearing for viewport filtering: a node's centre is its whole
      // geometry, while a footprint-less way/relation has unknown extent.
      osmType: type,
      class: klass,
      // hasName is the real OSM label, not the class fallback used on-screen.
      hasName: taggedName.length > 0,
      name: taggedName || humanizeInstallationClass(klass),
      ...point,
      footprint: footprintFrom(element),
      sources: [{ name: 'OpenStreetMap', id: `${type}/${osmId}`, retrievedAt }],
      validation: 'unreviewed',
      retrievedAt,
    });
  }
  return { records, droppedCount };
}

/** @param {unknown} value @returns {boolean} */
export function isValidInstallationBoundingBox(value) {
  const box = value || {};
  const south = Number(box.south);
  const west = Number(box.west);
  const north = Number(box.north);
  const east = Number(box.east);
  return finiteLatitude(south) && finiteLatitude(north) && finiteLongitude(west) && finiteLongitude(east)
    && south < north && west < east && north - south <= 10 && east - west <= 10;
}
