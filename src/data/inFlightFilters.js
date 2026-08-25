/**
 * Operator in-flight view filters. Heading sectors are PLAN 101; later
 * in-flight plans (watchlist / altitude / squawk / airborne / speed /
 * climb / class / stale / airline prefix) compose here as AND predicates
 * when they register, instead of each rewriting billboard.show.
 *
 * Hide stale is feed-health (missed polls), not a kinematic band. It never
 * treats the global feed `_backoff` as stale — a 429 must not blank the fleet.
 */

export const HEADING_SECTORS = Object.freeze(['N', 'E', 'S', 'W']);
export const DEFAULT_HEADING_SECTORS = 'NESW';

const SECTOR_TITLES = Object.freeze({
  N: 'Northbound (315–045°)',
  E: 'Eastbound (045–135°)',
  S: 'Southbound (135–225°)',
  W: 'Westbound (225–315°)',
});

/** @type {string} Canonical NESW string; empty means every sector is off. */
let _headingSectors = DEFAULT_HEADING_SECTORS;

/** Extra AND predicates installed by sibling in-flight filter plans. */
const _extraPredicateHooks = [];
/** Layers re-apply billboard visibility when the shared sector set changes. */
const _visibilityListeners = [];

/** Shared Hide stale flag — one flights-option toggle for both fleets. */
let hideStaleEnabled = false;

const SIBLING_FILTER_EXPORTS = [
  'passesWatchlistFilter',
  'passesAltitudeBandFilter',
  'passesEmergencySquawkFilter',
  'passesAirborneOnlyFilter',
  'passesSpeedBandFilter',
  'passesVerticalRateFilter',
  'passesClassChipFilter',
  'passesCallsignPrefixFilter',
];

export function getHeadingSectors() {
  return _headingSectors;
}

export function onHeadingSectorsChange(listener) {
  if (typeof listener === 'function') _visibilityListeners.push(listener);
}

export function setHeadingSectors(next) {
  const normalized = normalizeHeadingSectors(next);
  if (normalized === null) return _headingSectors;
  _headingSectors = normalized;
  for (const listener of _visibilityListeners) listener(_headingSectors);
  return _headingSectors;
}

export function _resetHeadingSectorsForTest() {
  _headingSectors = DEFAULT_HEADING_SECTORS;
  _extraPredicateHooks.length = 0;
}

export function registerInFlightFilter(predicate) {
  if (typeof predicate === 'function') _extraPredicateHooks.push(predicate);
}

/**
 * Canonical NESW string, or null when the value cannot be read.
 * Empty string is valid (every sector unchecked).
 */
export function normalizeHeadingSectors(value) {
  if (value === '') return '';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return HEADING_SECTORS.filter((sector) => value[sector] === true).join('');
  }
  if (typeof value !== 'string') return null;
  const present = new Set();
  for (const char of value.toUpperCase()) {
    if (char === 'N' || char === 'E' || char === 'S' || char === 'W') present.add(char);
  }
  return HEADING_SECTORS.filter((sector) => present.has(sector)).join('');
}

export function encodeHeadingSectors(value) {
  return value === '' ? '-' : String(value).toLowerCase();
}

export function decodeHeadingSectors(value) {
  if (value === '-') return '';
  if (typeof value !== 'string' || !value) return null;
  if (!/[NESW]/i.test(value)) return null;
  return normalizeHeadingSectors(value);
}

export function toggleHeadingSector(current, sector) {
  const selected = normalizeHeadingSectors(current) ?? DEFAULT_HEADING_SECTORS;
  if (!HEADING_SECTORS.includes(sector)) return selected;
  const next = new Set(selected);
  if (next.has(sector)) next.delete(sector);
  else next.add(sector);
  return HEADING_SECTORS.filter((entry) => next.has(entry)).join('');
}

/**
 * Compass sector from true track degrees (0 = north, clockwise).
 * N wraps 315–045; 045 is E, 135 is S, 225 is W, 315 is N.
 */
export function headingSectorFromTrueTrack(deg) {
  if (!Number.isFinite(deg)) return null;
  const track = ((deg % 360) + 360) % 360;
  if (track >= 315 || track < 45) return 'N';
  if (track < 135) return 'E';
  if (track < 225) return 'S';
  return 'W';
}

export function contactTrueTrack(contact) {
  const raw = contact?.true_track ?? contact?.track ?? contact?.heading;
  const numeric = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

export function passesHeadingSectorFilter(trueTrack, sectors) {
  const sector = headingSectorFromTrueTrack(trueTrack);
  if (sector == null) return true;
  const selected = normalizeHeadingSectors(sectors);
  const flags = selected === null ? DEFAULT_HEADING_SECTORS : selected;
  return flags.includes(sector);
}

/**
 * Whether Hide stale is on. Shared by commercial and military layers so one
 * persisted flights-option toggle governs both fleets.
 * @returns {boolean}
 */
export function getHideStaleEnabled() {
  return hideStaleEnabled;
}

/**
 * Set the shared Hide stale flag.
 * @param {boolean} next
 * @returns {boolean} The stored value.
 */
export function setHideStaleEnabled(next) {
  hideStaleEnabled = next === true;
  return hideStaleEnabled;
}

/** Test seam: restore the default OFF between cases. */
export function resetHideStaleEnabledForTest() {
  hideStaleEnabled = false;
}

/**
 * Per-contact missing-polls stale, never the global feed backoff.
 * `described.stale` ORs `_backoff` and must not be used here — a 429 would
 * blank the whole fleet.
 *
 * @param {object} contact
 * @param {string} contact.icao24
 * @param {Map<string, number>|Set<string>|null} [contact.missingPolls]
 * @param {boolean} [contact.describedStaleFromMissingPolls]
 * @param {string|null} [contact.trackedIcao]
 * @param {string|null} [contact.selectedIcao]
 * @param {boolean} [contact.hideStale]
 * @returns {boolean} True when the contact should still render.
 */
export function passesHideStaleFilter(contact = {}) {
  const hide = contact.hideStale === true || hideStaleEnabled;
  if (!hide) return true;
  const icao24 = String(contact.icao24 || '').trim().toLowerCase();
  if (!icao24) return true;
  const tracked = String(contact.trackedIcao || contact.selectedIcao || '').trim().toLowerCase();
  if (tracked && icao24 === tracked) return true;
  if (contact.describedStaleFromMissingPolls === true) return false;
  const missing = contact.missingPolls;
  if (missing && typeof missing.has === 'function') return !missing.has(icao24);
  return true;
}

function siblingPredicates(mod) {
  return SIBLING_FILTER_EXPORTS
    .map((name) => mod[name])
    .filter((fn) => typeof fn === 'function');
}

/**
 * AND of Hide stale and any sibling in-flight filters that have landed.
 * @param {object} contact
 * @param {object} [options]
 * @param {object} [options.module] Alternate module object (tests / rebase).
 * @returns {boolean}
 */
export function passesInFlightFilters(contact = {}, options = {}) {
  if (!passesHideStaleFilter(contact)) return false;
  const mod = options.module || {};
  for (const pred of siblingPredicates(mod)) {
    if (pred(contact, options) === false) return false;
  }
  return true;
}

/**
 * AND composition for in-flight operator filters.
 * A selected/tracked contact stays visible even when its heading leaves
 * the checked sectors. Missing/non-finite track stays visible.
 */
export function contactPassesInFlightFilters(contact, options = {}, ctx = {}) {
  const id = String(contact?.icao24 || '').trim().toLowerCase();
  const trackedId = ctx.trackedIcao == null ? '' : String(ctx.trackedIcao).trim().toLowerCase();
  if (ctx.tracked === true || (trackedId && id && trackedId === id)) return true;

  if (!passesHeadingSectorFilter(contactTrueTrack(contact), options.headingSectors)) {
    return false;
  }

  const extras = [
    ..._extraPredicateHooks,
    ...(Array.isArray(options.extraPredicates) ? options.extraPredicates : []),
  ];
  for (const predicate of extras) {
    if (typeof predicate === 'function' && !predicate(contact, options, ctx)) return false;
  }
  return true;
}

export function contactVisibleOnFlightLayer(contact, { trackedIcao } = {}) {
  return contactPassesInFlightFilters(
    contact,
    { headingSectors: getHeadingSectors() },
    { trackedIcao },
  );
}

export function headingSectorChipModels(current = getHeadingSectors()) {
  const selected = normalizeHeadingSectors(current) ?? DEFAULT_HEADING_SECTORS;
  return HEADING_SECTORS.map((sector) => ({
    id: `heading-${sector}`,
    label: sector,
    active: selected.includes(sector),
    title: SECTOR_TITLES[sector],
    params: { headingSectors: toggleHeadingSector(selected, sector) },
  }));
}
