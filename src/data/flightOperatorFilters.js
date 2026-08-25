/**
 * @module flightOperatorFilters
 * @description Shared operator visibility for commercial and military flight
 * contacts. Airborne-only hides parked/taxi contacts using the existing
 * `onGround` flag only. Sibling in-flight filters (ident watchlist, altitude
 * band, emergency squawk) compose as AND when the caller supplies their
 * result; omitted means pass-through so this module never reimplements them.
 */

export const AIRBORNE_ONLY_DEFAULT = false;

/**
 * Whether airborne-only allows this contact to draw.
 * Selected/tracked contacts stay visible after they land so follow does not vanish.
 * @param {{onGround?: boolean, airborneOnly?: boolean, isSelectedOrTracked?: boolean}} [input]
 * @returns {boolean}
 */
export function passesAirborneOnlyFilter({
  onGround,
  airborneOnly = AIRBORNE_ONLY_DEFAULT,
  isSelectedOrTracked = false,
} = {}) {
  if (airborneOnly !== true) return true;
  if (onGround !== true) return true;
  return isSelectedOrTracked === true;
}

/**
 * Combined operator visibility. Every supplied sibling filter must pass.
 * Unknown/absent sibling results default to pass so later plans can land
 * without this toggle rewriting their heuristics.
 * @param {{
 *   onGround?: boolean,
 *   airborneOnly?: boolean,
 *   isSelectedOrTracked?: boolean,
 *   passesIdentWatchlist?: boolean,
 *   passesAltitudeBand?: boolean,
 *   passesEmergencySquawk?: boolean,
 * }} [input]
 * @returns {boolean}
 */
export function passesOperatorFlightFilters({
  onGround,
  airborneOnly = AIRBORNE_ONLY_DEFAULT,
  isSelectedOrTracked = false,
  passesIdentWatchlist = true,
  passesAltitudeBand = true,
  passesEmergencySquawk = true,
} = {}) {
  if (!passesAirborneOnlyFilter({ onGround, airborneOnly, isSelectedOrTracked })) {
    return false;
  }
  return passesIdentWatchlist !== false
    && passesAltitudeBand !== false
    && passesEmergencySquawk !== false;
}
