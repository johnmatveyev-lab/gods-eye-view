/**
 * Hosted Contacts roster toggle. Shows or hides the existing 250 km
 * nearby-aircraft roster (`#military-awareness-panel`). No new range math,
 * no /api, and no people lookup — row clicks keep using the current track action.
 */

import { cockpitEntryAllowed } from '../contextModePolicy.js';
import { AWARENESS_RADIUS_M, summarizeAwarenessCohort } from './militaryAwarenessEngine.js';

export const CONTACTS_ROSTER_TOGGLE_ID = 'contacts-roster-toggle';
export const CONTACTS_ROSTER_PANEL_ID = 'military-awareness-panel';
export const CONTACTS_ROSTER_VIEW_ID = 'context-flights-view';
/** Same window the existing roster already uses. Do not invent another radius. */
export const CONTACTS_ROSTER_RADIUS_M = AWARENESS_RADIUS_M;
/** Existing awareness click handler — `requestFocus` → `trackById`. */
export const CONTACTS_ROSTER_TRACK_ACTION = 'requestFocus';

/**
 * Flip the hosted Contacts roster open/closed.
 * @param {boolean} currentlyOpen Whether the roster is showing.
 * @returns {boolean}
 */
export function nextContactsRosterOpen(currentlyOpen) {
  return !currentlyOpen;
}

/**
 * What opening or closing the toggle should do to existing surfaces.
 * The roster is the current Contacts flights view, not a second list.
 * @param {{open?: boolean}} [input]
 * @returns {{panelHidden: boolean, contextMode: 'flights'|null, expandContext: boolean, trackAction: string}}
 */
export function contactsRosterVisibility({ open = false } = {}) {
  const showing = Boolean(open);
  return {
    panelHidden: !showing,
    contextMode: showing ? 'flights' : null,
    expandContext: showing,
    trackAction: CONTACTS_ROSTER_TRACK_ACTION,
  };
}

/**
 * Empty-sky presentation from the existing cohort summarizer.
 * Unavailable and empty are honest terminals. Neither is a hang.
 * @param {{available?: boolean, stale?: boolean, items?: Array}} [input]
 * @returns {{kind: 'unavailable'|'empty'|'ready', hang: false, reason: string, count: number|null}}
 */
export function contactsRosterEmptyPresentation({
  available = true,
  stale = false,
  items = [],
} = {}) {
  const summary = summarizeAwarenessCohort(items, { available, stale });
  const kind = summary.count === null
    ? 'unavailable'
    : summary.count === 0
      ? 'empty'
      : 'ready';
  return {
    kind,
    hang: false,
    reason: summary.reason,
    count: summary.count,
  };
}

/**
 * Cockpit stay gated on a selected aircraft. Opening the roster is not entry.
 * @param {object} input
 * @param {boolean} [input.selectedAircraft]
 * @param {string|null} [input.contextMode]
 * @param {boolean} [input.contextModeChanging]
 * @param {boolean} [input.flightsEnabled]
 * @param {boolean} [input.militaryEnabled]
 * @returns {boolean}
 */
export function cockpitEntryAllowedFromRoster(input = {}) {
  if (!input.selectedAircraft) return false;
  return cockpitEntryAllowed(input);
}

/**
 * Sync the hosted toggle chrome with the existing roster surfaces.
 * Does not rewrite `#military-awareness-panel` innerHTML — awareness owns that.
 * @param {object} input
 * @param {boolean} input.open
 * @param {HTMLElement|null} [input.toggle]
 * @param {HTMLElement|null} [input.view]
 * @param {(id: string, collapsed: boolean, opts?: object) => void} [input.setPanelCollapsed]
 */
export function applyContactsRosterToggle({
  open,
  toggle = null,
  view = null,
  setPanelCollapsed = null,
} = {}) {
  const showing = Boolean(open);
  if (toggle) {
    toggle.setAttribute('aria-pressed', showing ? 'true' : 'false');
    toggle.classList.toggle('active', showing);
  }
  if (view) view.hidden = !showing;
  if (showing && typeof setPanelCollapsed === 'function') {
    setPanelCollapsed('global-context-panel', false, { explicit: true });
  }
  return contactsRosterVisibility({ open: showing });
}
