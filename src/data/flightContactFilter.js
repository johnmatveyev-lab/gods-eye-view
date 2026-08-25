/**
 * In-flight contact membership composer. PLAN 97 owns the vertical-rate
 * toggles. Already-landed sibling plans are imported, not reimplemented:
 * PLAN 93 altitude band, PLAN 96 ground-speed band. Other plans AND via
 * `extraPredicates`.
 */
import { aircraftMatchesAltitudeBand } from './flightAltitudeBand.js';
import { contactMatchesSpeedBand } from './flightSpeedBand.js';
import { contactPassesVerticalRateFilter } from './flightVerticalFilter.js';

function altitudeMFromMeta(meta) {
  if (Number.isFinite(meta?.altitude)) return meta.altitude;
  if (Number.isFinite(meta?.altitudeM)) return meta.altitudeM;
  return null;
}

function speedBandFromOptions(options) {
  if (Object.hasOwn(options, 'speedBand')) return options.speedBand;
  if (Object.hasOwn(options, 'speedMinKt') || Object.hasOwn(options, 'speedMaxKt')) {
    return { minKt: options.speedMinKt ?? null, maxKt: options.speedMaxKt ?? null };
  }
  return null;
}

/**
 * @param {object|null|undefined} meta
 * @param {object} [options] Layer params, including showClimb/Level/Descent.
 * @param {{keepVisible?: boolean, extraPredicates?: Array<Function>}} [extras]
 * @returns {boolean}
 */
export function contactPassesInFlightFilters(meta, options = {}, extras = {}) {
  if (extras.keepVisible === true) return true;
  if (!contactPassesVerticalRateFilter(meta, options)) return false;
  if (Object.hasOwn(options, 'altitudeBand')) {
    if (!aircraftMatchesAltitudeBand({
      altitudeM: altitudeMFromMeta(meta),
      onGround: meta?.onGround === true,
    }, options.altitudeBand)) return false;
  }
  const speedBand = speedBandFromOptions(options);
  if (speedBand) {
    if (!contactMatchesSpeedBand(meta, speedBand)) return false;
  }
  const extrasList = Array.isArray(extras.extraPredicates) ? extras.extraPredicates : [];
  for (const predicate of extrasList) {
    if (typeof predicate !== 'function') continue;
    if (!predicate(meta, options, extras)) return false;
  }
  return true;
}
