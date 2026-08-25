const AIRCRAFT_LAYER_IDS = new Set(['flights', 'military']);

/**
 * Cockpit rides a tracked aircraft only. People, vessels, sites, and satellites
 * are never eligible — even if some other selection chrome treats them as a
 * "selected contact".
 */
export function isCockpitEligibleSelection(info) {
  return AIRCRAFT_LAYER_IDS.has(info?.layerId);
}

/** Show Enter cockpit when an aircraft is selected and cockpit is not already on. */
export function cockpitEnterControlVisible({
  cockpitActive = false,
  selectedAircraft = null,
} = {}) {
  return !cockpitActive && isCockpitEligibleSelection(selectedAircraft);
}

/** Exit cockpit is the in-cockpit counterpart of the same switcher. */
export function cockpitExitControlVisible({ cockpitActive = false } = {}) {
  return cockpitActive === true;
}

/**
 * Request cockpit entry through the existing `controlCockpit('enter')` action.
 * Contacts is an implementation precondition of that action, not a separate
 * operator-facing camera path.
 */
export async function requestCockpitEnter({
  isEntryAllowed,
  setContextMode,
  controlCockpit,
} = {}) {
  if (typeof controlCockpit !== 'function') {
    return { ok: false, action: 'control_cockpit', error: 'Cockpit control unavailable' };
  }
  if (typeof isEntryAllowed === 'function' && !isEntryAllowed()) {
    const contextResult = typeof setContextMode === 'function'
      ? await setContextMode('flights', { claimVisualAuthority: false })
      : null;
    if (contextResult?.ok !== true) {
      return {
        ok: false,
        action: 'control_cockpit',
        error: contextResult?.error || 'Contacts context could not be established for Cockpit entry',
      };
    }
  }
  return controlCockpit('enter');
}
