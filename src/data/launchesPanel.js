/**
 * Hosted Launches panel. Renders the existing Launch Library 2 payload
 * (`/api/launches`) the globe already fetches. No new vendor and no extra
 * `/api`. Click flies to the existing pad/target when coords exist; otherwise
 * the row is only selected. Failed payloads are empty/unavailable, never a hang.
 * Exclusive All | Commercial | Government chips re-filter
 * `launch_service_provider.type` on that already-fetched payload.
 * Mapped only then hides rows missing finite pad lat/lon.
 * Exclusive All | Go | TBD chips then re-filter the copied `status` name.
 * Hide no provider then drops rows whose copied provider is missing.
 * Hide no site then drops rows whose copied launchSite is empty or the
 * Unknown launch site fallback.
 * Hide no time then drops rows whose copied launchTime is missing,
 * null, or unparseable.
 * Hide no vehicle then drops rows whose copied vehicle is missing,
 * empty, or whitespace.
 * Hide no orbit then drops rows whose copied orbit is missing,
 * empty, or whitespace.
 * Webcast only then drops rows whose copied webcast is missing
 * or false.
 * Hide no mission then drops rows whose copied mission is missing,
 * empty, or whitespace.
 * Hide no probability then drops rows whose copied probability is
 * missing, null, or non-finite. Finite 0 stays.
 */

import {
  DEFAULT_LAUNCH_LSP_TYPE_FILTER,
  filterLaunchesByLspType,
} from './launchLspTypeFilter.js';
import {
  DEFAULT_LAUNCH_LIST_MAPPED_ONLY,
  filterLaunchListByMappedOnly,
} from './launchListMappedFilter.js';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_PROVIDER,
  filterLaunchListByProvider,
} from './launchListProviderFilter.js';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_SITE,
  filterLaunchListBySite,
} from './launchListSiteFilter.js';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_TIME,
  filterLaunchListByTime,
} from './launchListTimeFilter.js';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_VEHICLE,
  filterLaunchListByVehicle,
} from './launchListVehicleFilter.js';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_ORBIT,
  filterLaunchListByOrbit,
} from './launchListOrbitFilter.js';
import {
  DEFAULT_LAUNCH_LIST_WEBCAST_ONLY,
  filterLaunchListByWebcast,
  launchListRowHasWebcast,
} from './launchListWebcastFilter.js';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_MISSION,
  filterLaunchListByMission,
} from './launchListMissionFilter.js';
import {
  DEFAULT_LAUNCH_LIST_HIDE_NO_PROBABILITY,
  filterLaunchListByProbability,
} from './launchListProbabilityFilter.js';
import {
  DEFAULT_LAUNCH_LIST_STATUS_FILTER,
  filterLaunchListByStatus,
} from './launchListStatusFilter.js';

export const LAUNCHES_PANEL_ID = 'launches-panel';
export const LAUNCHES_PANEL_TOGGLE_ID = 'launches-panel-toggle';
export const LAUNCHES_PANEL_LIST_ID = 'launches-panel-list';
export const LAUNCHES_PANEL_COUNT_ID = 'launches-panel-count';
export const LAUNCHES_PANEL_LSP_CHIPS_ID = 'launches-panel-lsp-chips';
export const LAUNCHES_PANEL_MAPPED_CHIPS_ID = 'launches-panel-mapped-chips';
export const LAUNCHES_PANEL_STATUS_CHIPS_ID = 'launches-panel-status-chips';
export const LAUNCHES_PANEL_PROVIDER_CHIPS_ID = 'launches-panel-provider-chips';
export const LAUNCHES_PANEL_SITE_CHIPS_ID = 'launches-panel-site-chips';
export const LAUNCHES_PANEL_TIME_CHIPS_ID = 'launches-panel-time-chips';
export const LAUNCHES_PANEL_VEHICLE_CHIPS_ID = 'launches-panel-vehicle-chips';
export const LAUNCHES_PANEL_ORBIT_CHIPS_ID = 'launches-panel-orbit-chips';
export const LAUNCHES_PANEL_WEBCAST_CHIPS_ID = 'launches-panel-webcast-chips';
export const LAUNCHES_PANEL_MISSION_CHIPS_ID = 'launches-panel-mission-chips';
export const LAUNCHES_PANEL_PROBABILITY_CHIPS_ID = 'launches-panel-probability-chips';
/** Same feed the globe layer already uses. Do not invent another route. */
export const LAUNCHES_FEED_URL = '/api/launches';
/** Same close-pad range Space Missions already uses for pad focus. */
export const LAUNCH_PAD_FOCUS_RANGE_M = 12000;

/** Existing roster / proxy language. Do not invent a new empty string. */
export const LAUNCHES_PANEL_LOADING = 'LOADING 30-DAY MISSION INDEX';
export const LAUNCHES_PANEL_EMPTY = 'NO MISSIONS AVAILABLE IN THE CURRENT 30-DAY WINDOW';
export const LAUNCHES_PANEL_UNAVAILABLE = 'Launch Library 2 unavailable';
export const LAUNCHES_PANEL_DATE_UNAVAILABLE = 'DATE UNAVAILABLE';

/**
 * Read pad coordinates from a Launch Library 2 record or a normalized launch.
 * Matches the globe layer: pad.lat/lon first, else location.coordinates "lon,lat".
 * @param {object|null} launch Raw or normalized launch.
 * @returns {{lat: number|null, lon: number|null}}
 */
export function launchPadCoordinates(launch) {
  const pad = launch?.pad || {};
  const location = pad.location || {};
  const parts = String(location.coordinates || '').split(',').map((part) => Number(String(part).trim()));
  const coordinateLon = parts.length === 2 && Number.isFinite(parts[0]) ? parts[0] : null;
  const coordinateLat = parts.length === 2 && Number.isFinite(parts[1]) ? parts[1] : null;
  const lat = Number.isFinite(Number(pad.latitude))
    ? Number(pad.latitude)
    : Number.isFinite(Number(launch?.lat))
      ? Number(launch.lat)
      : coordinateLat;
  const lon = Number.isFinite(Number(pad.longitude))
    ? Number(pad.longitude)
    : Number.isFinite(Number(launch?.lon))
      ? Number(launch.lon)
      : coordinateLon;
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
  };
}

/**
 * Whether the current payload is a Launch Library 2 list (array or `{results}`).
 * @param {*} payload
 * @returns {boolean}
 */
export function isLaunchesPayload(payload) {
  return Array.isArray(payload) || Array.isArray(payload?.results);
}

function launchTimeIso(launch) {
  if (typeof launch?.launchTime === 'string' && launch.launchTime) return launch.launchTime;
  const raw = launch?.net || launch?.window_start || null;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? new Date(date).toISOString() : null;
}

function compactLaunchLabel(name, maxLength = 27) {
  const text = String(name || 'Unnamed launch').replace(/\s+/g, ' ').trim().split(' | ')[0];
  const compact = text.split(' — ')[0].trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1).trimEnd()}…` : compact;
}

/**
 * Build panel rows from the current Launch Library 2 payload.
 * Keeps records without pad coords so they can still be selected.
 * Exclusive LSP-type chips re-filter `launch_service_provider.type`
 * without another fetch. All leaves the current list unchanged.
 * Mapped only then drops rows missing finite pad coords; off keeps
 * those rows selectable. Exclusive All | Go | TBD chips then re-filter
 * the copied `status` name. Hide no provider then drops rows whose
 * copied provider is missing / empty / whitespace. Hide no site then
 * drops empty / whitespace / Unknown launch site. Hide no time then
 * drops missing / null / unparseable launchTime. Hide no vehicle then
 * drops missing / empty / whitespace vehicle. Hide no orbit then
 * drops missing / empty / whitespace orbit. Webcast only then drops
 * missing / false webcast. Hide no mission then drops missing /
 * empty / whitespace mission. Hide no probability then drops
 * missing / null / non-finite probability. Finite 0 stays.
 * A selected id always stays.
 * @param {object|Array|null} payload `{results:[…]}` or a launch array.
 * @param {unknown} [filter]
 * @param {{mappedOnly?: unknown, selectedId?: string|null, statusFilter?: unknown, hideNoProvider?: unknown, hideNoSite?: unknown, hideNoTime?: unknown, hideNoVehicle?: unknown, hideNoOrbit?: unknown, webcastOnly?: unknown, hideNoMission?: unknown, hideNoProbability?: unknown}} [options]
 * @returns {Array<object>}
 */
export function launchesPanelRows(
  payload,
  filter = DEFAULT_LAUNCH_LSP_TYPE_FILTER,
  {
    mappedOnly = DEFAULT_LAUNCH_LIST_MAPPED_ONLY,
    selectedId = null,
    statusFilter = DEFAULT_LAUNCH_LIST_STATUS_FILTER,
    hideNoProvider = DEFAULT_LAUNCH_LIST_HIDE_NO_PROVIDER,
    hideNoSite = DEFAULT_LAUNCH_LIST_HIDE_NO_SITE,
    hideNoTime = DEFAULT_LAUNCH_LIST_HIDE_NO_TIME,
    hideNoVehicle = DEFAULT_LAUNCH_LIST_HIDE_NO_VEHICLE,
    hideNoOrbit = DEFAULT_LAUNCH_LIST_HIDE_NO_ORBIT,
    webcastOnly = DEFAULT_LAUNCH_LIST_WEBCAST_ONLY,
    hideNoMission = DEFAULT_LAUNCH_LIST_HIDE_NO_MISSION,
    hideNoProbability = DEFAULT_LAUNCH_LIST_HIDE_NO_PROBABILITY,
  } = {},
) {
  const launches = Array.isArray(payload) ? payload : payload?.results;
  if (!Array.isArray(launches)) return [];
  const rows = filterLaunchesByLspType(launches, filter).map((launch, index) => {
    const coords = launchPadCoordinates(launch);
    const pad = launch?.pad || {};
    const location = pad.location || {};
    const launchTime = launchTimeIso(launch);
    return {
      id: String(launch?.id || launch?.slug || launch?.name || `launch-${index}`),
      name: launch?.name || 'Unnamed launch',
      status: launch?.status?.name || launch?.status || 'Unknown',
      launchTime,
      launchSite: launch?.launchSite || pad.name || location.name || 'Unknown launch site',
      provider: launch?.provider || launch?.launch_service_provider?.name || null,
      vehicle: launch.rocketName || launch.rocket?.configuration?.name || launch.rocket?.name || null,
      orbit: (typeof launch.orbit === 'string' ? launch.orbit : launch.orbit?.name)
        || (typeof launch.mission?.orbit === 'string' ? launch.mission.orbit : launch.mission?.orbit?.name)
        || null,
      mission: (typeof launch.mission === 'string' ? launch.mission : launch.mission?.name)
        || launch.mission_name
        || null,
      probability: Number.isFinite(launch.probability) ? launch.probability : null,
      webcast: launchListRowHasWebcast(launch),
      lat: coords.lat,
      lon: coords.lon,
      source: launch?.source || 'Launch Library 2',
    };
  });
  return filterLaunchListByProbability(
    filterLaunchListByMission(
      filterLaunchListByWebcast(
        filterLaunchListByOrbit(
          filterLaunchListByVehicle(
            filterLaunchListByTime(
              filterLaunchListBySite(
                filterLaunchListByProvider(
                  filterLaunchListByStatus(
                    filterLaunchListByMappedOnly(rows, mappedOnly, selectedId),
                    statusFilter,
                    selectedId,
                  ),
                  hideNoProvider,
                  selectedId,
                ),
                hideNoSite,
                selectedId,
              ),
              hideNoTime,
              selectedId,
            ),
            hideNoVehicle,
            selectedId,
          ),
          hideNoOrbit,
          selectedId,
        ),
        webcastOnly,
        selectedId,
      ),
      hideNoMission,
      selectedId,
    ),
    hideNoProbability,
    selectedId,
  );
}

/**
 * Click policy: fly to the existing pad/target when coords exist; else select.
 * @param {object|null} row
 * @returns {{kind: 'fly-to'|'select', selectedId: string|null, flyTo: {lat: number, lon: number, rangeM: number}|null}}
 */
export function launchesPanelRowAction(row) {
  const selectedId = row?.id ? String(row.id) : null;
  const hasCoords = Number.isFinite(row?.lat) && Number.isFinite(row?.lon);
  if (hasCoords) {
    return {
      kind: 'fly-to',
      selectedId,
      flyTo: { lat: row.lat, lon: row.lon, rangeM: LAUNCH_PAD_FOCUS_RANGE_M },
    };
  }
  return { kind: 'select', selectedId, flyTo: null };
}

/**
 * Empty / unavailable / ready presentation. Never a hang.
 * A malformed payload is unavailable, not an infinite load.
 * @param {{available?: boolean, items?: Array, payload?: *}} [input]
 * @returns {{kind: 'unavailable'|'empty'|'ready', hang: false, reason: string, count: number|null, rows: Array}}
 */
export function launchesPanelEmptyPresentation({
  available = true,
  items = [],
  payload,
} = {}) {
  if (available === false || (payload !== undefined && !isLaunchesPayload(payload))) {
    return {
      kind: 'unavailable',
      hang: false,
      reason: LAUNCHES_PANEL_UNAVAILABLE,
      count: null,
      rows: [],
    };
  }
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    return {
      kind: 'empty',
      hang: false,
      reason: LAUNCHES_PANEL_EMPTY,
      count: 0,
      rows: [],
    };
  }
  return {
    kind: 'ready',
    hang: false,
    reason: '',
    count: rows.length,
    rows,
  };
}

/** Loading copy while the existing `/api/launches` request is in flight. */
export function launchesPanelLoadingPresentation() {
  return {
    kind: 'loading',
    hang: false,
    reason: LAUNCHES_PANEL_LOADING,
    count: null,
    rows: [],
  };
}

/**
 * Load the current launches payload. Uses cached globe results when present;
 * otherwise fetches the existing `/api/launches` feed. Failures resolve to
 * unavailable (or stale rows) and never hang.
 * @param {object} [input]
 * @param {typeof fetch} [input.fetchImpl]
 * @param {object|Array|null} [input.cachedPayload]
 * @param {string} [input.url]
 * @param {unknown} [input.filter]
 * @param {unknown} [input.mappedOnly]
 * @param {string|null} [input.selectedId]
 * @param {unknown} [input.statusFilter]
 * @param {unknown} [input.hideNoProvider]
 * @param {unknown} [input.hideNoSite]
 * @param {unknown} [input.hideNoTime]
 * @param {unknown} [input.hideNoVehicle]
 * @param {unknown} [input.hideNoOrbit]
 * @param {unknown} [input.webcastOnly]
 * @param {unknown} [input.hideNoMission]
 * @param {unknown} [input.hideNoProbability]
 * @returns {Promise<object>}
 */
export async function loadLaunchesPanelPayload({
  fetchImpl = globalThis.fetch.bind(globalThis),
  cachedPayload = null,
  url = LAUNCHES_FEED_URL,
  filter = DEFAULT_LAUNCH_LSP_TYPE_FILTER,
  mappedOnly = DEFAULT_LAUNCH_LIST_MAPPED_ONLY,
  selectedId = null,
  statusFilter = DEFAULT_LAUNCH_LIST_STATUS_FILTER,
  hideNoProvider = DEFAULT_LAUNCH_LIST_HIDE_NO_PROVIDER,
  hideNoSite = DEFAULT_LAUNCH_LIST_HIDE_NO_SITE,
  hideNoTime = DEFAULT_LAUNCH_LIST_HIDE_NO_TIME,
  hideNoVehicle = DEFAULT_LAUNCH_LIST_HIDE_NO_VEHICLE,
  hideNoOrbit = DEFAULT_LAUNCH_LIST_HIDE_NO_ORBIT,
  webcastOnly = DEFAULT_LAUNCH_LIST_WEBCAST_ONLY,
  hideNoMission = DEFAULT_LAUNCH_LIST_HIDE_NO_MISSION,
  hideNoProbability = DEFAULT_LAUNCH_LIST_HIDE_NO_PROBABILITY,
} = {}) {
  try {
    const response = await fetchImpl(url);
    if (!response?.ok) throw new Error(`HTTP ${response?.status || 0}`);
    const payload = await response.json();
    const rows = launchesPanelRows(payload, filter, {
      mappedOnly,
      selectedId,
      statusFilter,
      hideNoProvider,
      hideNoSite,
      hideNoTime,
      hideNoVehicle,
      hideNoOrbit,
      webcastOnly,
      hideNoMission,
      hideNoProbability,
    });
    return {
      ...launchesPanelEmptyPresentation({ available: true, items: rows, payload }),
      payload,
    };
  } catch {
    if (cachedPayload != null && isLaunchesPayload(cachedPayload)) {
      const rows = launchesPanelRows(cachedPayload, filter, {
        mappedOnly,
        selectedId,
        statusFilter,
        hideNoProvider,
        hideNoSite,
        hideNoTime,
        hideNoVehicle,
        hideNoOrbit,
        webcastOnly,
        hideNoMission,
        hideNoProbability,
      });
      if (rows.length) {
        return {
          ...launchesPanelEmptyPresentation({ available: true, items: rows, payload: cachedPayload }),
          stale: true,
          payload: cachedPayload,
        };
      }
    }
    return launchesPanelEmptyPresentation({ available: false, items: [] });
  }
}

/**
 * Flip the hosted Launches panel open/closed.
 * @param {boolean} currentlyOpen
 * @returns {boolean}
 */
export function nextLaunchesPanelOpen(currentlyOpen) {
  return !currentlyOpen;
}

/**
 * Sync toggle chrome with the dedicated Launches panel.
 * @param {object} input
 * @param {boolean} input.open
 * @param {HTMLElement|null} [input.toggle]
 * @param {HTMLElement|null} [input.panel]
 * @returns {{open: boolean, panelHidden: boolean}}
 */
export function applyLaunchesPanelToggle({
  open,
  toggle = null,
  panel = null,
} = {}) {
  const showing = Boolean(open);
  if (toggle) {
    toggle.setAttribute('aria-pressed', showing ? 'true' : 'false');
    toggle.classList.toggle('active', showing);
  }
  if (panel) panel.hidden = !showing;
  return { open: showing, panelHidden: !showing };
}

export function escapeLaunchesPanelText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

/**
 * Render the list body from a presentation object. This surface has no
 * existing refresh control, so failed loads stay on the empty language.
 * @param {object} presentation
 * @param {string|null} [selectedId]
 * @returns {string}
 */
export function renderLaunchesPanelList(presentation, selectedId = null) {
  if (presentation?.kind !== 'ready' || !presentation.rows?.length) {
    const reason = presentation?.reason || LAUNCHES_PANEL_EMPTY;
    return `<div class="launches-panel-empty">${escapeLaunchesPanelText(reason)}</div>`;
  }
  return presentation.rows.map((row) => {
    const date = row.launchTime?.slice(0, 10) || LAUNCHES_PANEL_DATE_UNAVAILABLE;
    const provider = row.provider || 'UNSPECIFIED OPERATOR';
    const label = compactLaunchLabel(row.name).toUpperCase();
    const selected = selectedId && selectedId === row.id ? ' aria-pressed="true" class="launches-panel-item selected"' : ' aria-pressed="false" class="launches-panel-item"';
    return `<button type="button"${selected} data-launch-id="${escapeLaunchesPanelText(row.id)}" aria-label="Select ${escapeLaunchesPanelText(label)}"><span class="launches-panel-copy"><strong>${escapeLaunchesPanelText(label)}</strong><small>${escapeLaunchesPanelText(provider)} · ${escapeLaunchesPanelText(date)}</small></span></button>`;
  }).join('');
}
