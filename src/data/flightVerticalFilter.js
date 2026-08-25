/**
 * Climb / level / descent membership from the stored ADS-B vertical-rate
 * field (m/s, + = climbing). No new heuristic — the poll already stores
 * OpenSky state[11] / adsb.lol baro rate as m/s.
 */

/** Level band: |rate| ≤ 1.0 m/s (~200 fpm). */
export const VERTICAL_RATE_LEVEL_MPS = 1.0;

export const VERTICAL_RATE_PHASES = Object.freeze(['climb', 'level', 'descent']);

export const DEFAULT_VERTICAL_RATE_FILTER = Object.freeze({
  showClimb: true,
  showLevel: true,
  showDescent: true,
});

/**
 * @param {unknown} verticalRate Rate in metres per second.
 * @returns {'climb'|'level'|'descent'|null} Null when the rate is missing.
 */
export function classifyVerticalRate(verticalRate) {
  if (!Number.isFinite(verticalRate)) return null;
  if (verticalRate > VERTICAL_RATE_LEVEL_MPS) return 'climb';
  if (verticalRate < -VERTICAL_RATE_LEVEL_MPS) return 'descent';
  return 'level';
}

/**
 * @param {object} [input]
 * @returns {{showClimb: boolean, showLevel: boolean, showDescent: boolean}}
 */
export function normalizeVerticalRateFilter(input = {}) {
  return {
    showClimb: input.showClimb !== false,
    showLevel: input.showLevel !== false,
    showDescent: input.showDescent !== false,
  };
}

function readVerticalRateMps(meta) {
  if (!meta || typeof meta !== 'object') return null;
  if (Number.isFinite(meta.verticalRate)) return meta.verticalRate;
  if (Number.isFinite(meta.verticalRateMps)) return meta.verticalRateMps;
  return null;
}

/**
 * @param {object|null|undefined} meta Contact meta (`verticalRate` or `verticalRateMps`).
 * @param {object} [filter]
 * @returns {boolean}
 */
/** Alias for the shared inFlightFilters sibling registry. */
export function passesVerticalRateFilter(meta, filter = {}) {
  return contactPassesVerticalRateFilter(meta, filter);
}

export function contactPassesVerticalRateFilter(meta, filter = {}) {
  const phase = classifyVerticalRate(readVerticalRateMps(meta));
  if (phase == null) return true;
  const opts = normalizeVerticalRateFilter(filter);
  switch (phase) {
    case 'climb':
      return opts.showClimb;
    case 'level':
      return opts.showLevel;
    case 'descent':
      return opts.showDescent;
    default: {
      const _exhaustive = phase;
      void _exhaustive;
      return true;
    }
  }
}
