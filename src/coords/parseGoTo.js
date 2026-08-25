/**
 * @module parseGoTo
 * @description Parse an operator paste into a camera go-to target.
 *
 * Accepts decimal `lat, lon` (optional height in meters) or an MGRS grid
 * via the existing `mgrs.toPoint`. Copied two-line coords (lat,lon then
 * `MGRS …`) use the lat,lon line. Empty or junk is invalid — the camera
 * must not move. Operator-entered coordinates only; no geocoding.
 */

import * as mgrsNs from 'mgrs';

export const GOTO_INVALID_STATUS = 'Invalid coordinates';

function mgrsToPoint(grid) {
  const toPoint = mgrsNs.toPoint || mgrsNs.default?.toPoint;
  if (typeof toPoint !== 'function') {
    throw new TypeError('mgrs.toPoint is unavailable');
  }
  return toPoint(grid);
}

/**
 * @param {string} text
 * @returns {{ok: true, lat: number, lon: number, kind: 'latlon', alt?: number}|null}
 */
function parseLatLon(text) {
  const match = String(text).trim().match(
    /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*m)?)?$/i,
  );
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const parsed = { ok: true, lat, lon, kind: 'latlon' };
  if (match[3] != null) {
    const alt = Number(match[3]);
    if (!Number.isFinite(alt)) return null;
    parsed.alt = alt;
  }
  return parsed;
}

/**
 * @param {string} text
 * @returns {{ok: true, lat: number, lon: number, kind: 'mgrs'}|null}
 */
function parseMgrs(text) {
  const compact = String(text).trim().replace(/^MGRS\s+/i, '').replace(/\s+/g, '');
  if (!compact) return null;
  try {
    const point = mgrsToPoint(compact);
    const lon = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { ok: true, lat, lon, kind: 'mgrs' };
  } catch {
    return null;
  }
}

/**
 * @param {unknown} raw
 * @returns {{ok: true, lat: number, lon: number, kind: 'latlon'|'mgrs', alt?: number}|{ok: false}}
 */
export function parseGoTo(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false };

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const latlon = parseLatLon(line);
    if (latlon) return latlon;
  }
  for (const line of lines) {
    const mgrs = parseMgrs(line);
    if (mgrs) return mgrs;
  }
  return { ok: false };
}
