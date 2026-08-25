/**
 * Ground-speed band for commercial and military flight layers.
 *
 * Compares existing `meta.velocity` / `speedMps` (m/s) against an optional
 * min/max. Default OFF shows every contact. Display follows the PLAN 44
 * distance-unit toggle: km → km/h, nm → kt, mi → mph.
 */

import {
  DEFAULT_DISTANCE_UNIT,
  getDistanceUnit,
  normalizeDistanceUnit,
} from '../units.js';

/** HUD / label conversion used across the fleet (m/s → kt). */
export const KT_PER_MPS = 1.94384;
const KMH_PER_KT = 1.852;
const MPH_PER_KT = 1.150779448;
const SPEED_MAX_KT = 9999;

/**
 * @typedef {{minKt: number|null, maxKt: number|null}} SpeedBand
 * @typedef {'km/h'|'kt'|'mph'} SpeedUnit
 */

/**
 * Resolve a contact's already-ingested ground speed in m/s.
 * @param {{velocity?: unknown, velocityMps?: unknown, speedMps?: unknown}|null|undefined} contact
 * @returns {number|null}
 */
export function contactVelocityMps(contact) {
  const raw = contact?.velocity ?? contact?.velocityMps ?? contact?.speedMps;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
export function normalizeSpeedKt(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  if (rounded < 0 || rounded > SPEED_MAX_KT) return null;
  return rounded;
}

/**
 * @param {unknown} candidate
 * @returns {SpeedBand}
 */
export function normalizeSpeedBand(candidate = {}) {
  const input = candidate && typeof candidate === 'object' ? candidate : {};
  let minKt = normalizeSpeedKt(input.minKt ?? input.speedMinKt);
  let maxKt = normalizeSpeedKt(input.maxKt ?? input.speedMaxKt);
  if (minKt != null && maxKt != null && minKt > maxKt) {
    const swapped = minKt;
    minKt = maxKt;
    maxKt = swapped;
  }
  return { minKt, maxKt };
}

/** @param {SpeedBand|null|undefined} band */
export function isSpeedBandActive(band) {
  const normalized = normalizeSpeedBand(band);
  return normalized.minKt != null || normalized.maxKt != null;
}

/**
 * Speed suffix for the current PLAN 44 distance unit.
 * @param {unknown} [unit]
 * @returns {SpeedUnit}
 */
export function speedUnitSuffix(unit = getDistanceUnit()) {
  const resolved = normalizeDistanceUnit(unit) || DEFAULT_DISTANCE_UNIT;
  switch (resolved) {
    case 'km': return 'km/h';
    case 'nm': return 'kt';
    case 'mi': return 'mph';
    default: {
      const _exhaustive = /** @type {never} */ (resolved);
      void _exhaustive;
      return 'km/h';
    }
  }
}

/**
 * @param {number} kt
 * @param {unknown} [unit]
 * @returns {number}
 */
export function ktToDisplaySpeed(kt, unit = getDistanceUnit()) {
  const resolved = normalizeDistanceUnit(unit) || DEFAULT_DISTANCE_UNIT;
  switch (resolved) {
    case 'km': return kt * KMH_PER_KT;
    case 'nm': return kt;
    case 'mi': return kt * MPH_PER_KT;
    default: {
      const _exhaustive = /** @type {never} */ (resolved);
      void _exhaustive;
      return kt * KMH_PER_KT;
    }
  }
}

/**
 * @param {unknown} value
 * @param {unknown} [unit]
 * @returns {number|null}
 */
export function displaySpeedToKt(value, unit = getDistanceUnit()) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  const resolved = normalizeDistanceUnit(unit) || DEFAULT_DISTANCE_UNIT;
  switch (resolved) {
    case 'km': return numeric / KMH_PER_KT;
    case 'nm': return numeric;
    case 'mi': return numeric / MPH_PER_KT;
    default: {
      const _exhaustive = /** @type {never} */ (resolved);
      void _exhaustive;
      return numeric / KMH_PER_KT;
    }
  }
}

/**
 * @param {{id?: string, icao24?: string}|null|undefined} contact
 * @param {{id?: string, trackedId?: string|null, selectedId?: string|null, keepVisibleIds?: Iterable<string>}} [ctx]
 * @returns {boolean}
 */
export function contactIsKeptVisible(contact, ctx = {}) {
  const ids = new Set(
    [ctx.id, contact?.id, contact?.icao24]
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
  if (!ids.size) return false;
  if (ctx.trackedId && ids.has(String(ctx.trackedId))) return true;
  if (ctx.selectedId && ids.has(String(ctx.selectedId))) return true;
  if (ctx.keepVisibleIds) {
    for (const keep of ctx.keepVisibleIds) {
      if (ids.has(String(keep))) return true;
    }
  }
  return false;
}

/**
 * @param {object|null|undefined} contact
 * @param {SpeedBand|null|undefined} band
 * @param {{id?: string, trackedId?: string|null, selectedId?: string|null, keepVisibleIds?: Iterable<string>}} [ctx]
 * @returns {boolean}
 */
export function contactMatchesSpeedBand(contact, band, ctx = {}) {
  if (!isSpeedBandActive(band)) return true;
  if (contactIsKeptVisible(contact, ctx)) return true;
  const mps = contactVelocityMps(contact);
  if (mps == null) return true;
  const speedKt = mps * KT_PER_MPS;
  const { minKt, maxKt } = normalizeSpeedBand(band);
  if (minKt != null && speedKt < minKt) return false;
  if (maxKt != null && speedKt > maxKt) return false;
  return true;
}

/**
 * Speed band AND any already-landed sibling in-flight matchers.
 * Missing sibling plans are not reimplemented here.
 * @param {object|null|undefined} contact
 * @param {{
 *   speedBand?: SpeedBand|null,
 *   id?: string,
 *   trackedId?: string|null,
 *   selectedId?: string|null,
 *   keepVisibleIds?: Iterable<string>,
 *   andMatchers?: Array<(contact: object, ctx: object) => boolean>,
 * }} [ctx]
 * @returns {boolean}
 */
export function contactPassesInFlightFilters(contact, ctx = {}) {
  if (contactIsKeptVisible(contact, ctx)) return true;
  if (!contactMatchesSpeedBand(contact, ctx.speedBand, ctx)) return false;
  for (const matcher of ctx.andMatchers || []) {
    if (typeof matcher === 'function' && !matcher(contact, ctx)) return false;
  }
  return true;
}

/**
 * @param {Array<object>|null|undefined} contacts
 * @param {SpeedBand|null|undefined} band
 * @param {object} [ctx]
 * @returns {Array<object>}
 */
export function filterFlightContacts(contacts, band, ctx = {}) {
  return (Array.isArray(contacts) ? contacts : []).filter((contact) => (
    contactPassesInFlightFilters(contact, { ...ctx, speedBand: band, id: ctx.id || contact?.id || contact?.icao24 })
  ));
}
