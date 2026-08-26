// src/data/aircraftMeta.js
/**
 * Sticky per-aircraft metadata merge: once a field has resolved for an
 * aircraft, a later snapshot that MISSES the field (empty/null — OpenSky and
 * adsb.lol both do this intermittently) must not regress it. A later snapshot
 * that CHANGES the field always wins. Pattern from skylight (MIT)
 * server/src/datasource.ts "sticky enrichment".
 */

export function stickyText(next, prev) {
  const n = String(next || '').trim();
  if (n) return n;
  const p = String(prev || '').trim();
  return p || '';
}

export function stickyNumber(next, prev, fallback) {
  if (Number.isFinite(next)) return next;
  if (Number.isFinite(prev)) return prev;
  return fallback;
}

/**
 * Persist aviation altitude from an already-fetched state vector.
 * Finite baro (index 7) wins. Missing baro uses finite geo (index 13).
 * Otherwise null — never invent 10000. On-ground with neither still
 * stores 0. Same sticky-null pattern as velocity and track.
 *
 * @param {unknown} baroAltM
 * @param {unknown} geoAltM
 * @param {{previous?: unknown, onGround?: boolean}} [options]
 * @returns {number|null}
 */
export function persistAviationAltitudeM(baroAltM, geoAltM, {
  previous,
  onGround = false,
} = {}) {
  const ingested = Number.isFinite(baroAltM)
    ? baroAltM
    : (Number.isFinite(geoAltM) ? geoAltM : null);
  return stickyNumber(ingested, previous, onGround === true ? 0 : null);
}
