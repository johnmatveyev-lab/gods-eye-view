/**
 * Hosted list of mapped installations already returned for the current
 * 10° bbox. Rows come from the layer's in-memory payload. Click flies
 * with the existing `focusById` path — no extra /api and no people lookup.
 */

import { humanizeInstallationClass } from './militaryInstallationData.js';
import {
  filterViewportSitesList,
  readSitesListMappedPref,
} from './installationListMappedFilter.js';
import {
  filterViewportSitesListNamed,
  readSitesListNamedPref,
} from './installationListNamedFilter.js';
import {
  filterViewportSitesListOsm,
  readSitesListOsmPref,
} from './installationListOsmFilter.js';

export const INSTALLATION_VIEWPORT_LIST_TOGGLE_ID = 'installations-list-toggle';
export const INSTALLATION_VIEWPORT_LIST_PANEL_ID = 'installations-viewport-list';
export const INSTALLATION_VIEWPORT_LIST_CAP = 50;
export const INSTALLATION_VIEWPORT_LIST_FLY_ACTION = 'focusById';
/** Same bbox the installations layer already enforces. Do not widen it. */
export const INSTALLATION_VIEWPORT_MAX_DEGREES = 10;

/**
 * Flip the hosted Sites list open/closed.
 * @param {boolean} currentlyOpen Whether the list is showing.
 * @returns {boolean}
 */
export function nextInstallationListOpen(currentlyOpen) {
  return !currentlyOpen;
}

/**
 * Rows for the current payload. Empty bbox / empty payload → [].
 * The list-only Mapped only chip drops Google Places extras when on.
 * The list-only Named only chip then drops class-fallback rows when on.
 * The list-only OSM-type chips then keep All, Node, or Way+relation.
 * @param {Array<object>|null|undefined} records Layer `getViewportRecords()` snapshot.
 * @param {{cap?: number, listMappedPref?: unknown, listNamedPref?: unknown, listOsmPref?: unknown, selectedId?: string|null}} [options]
 * @returns {Array<{id: string, name: string, type: string, latitude: number, longitude: number}>}
 */
export function listViewportInstallations(records, {
  cap = INSTALLATION_VIEWPORT_LIST_CAP,
  listMappedPref = readSitesListMappedPref(),
  listNamedPref = readSitesListNamedPref(),
  listOsmPref = readSitesListOsmPref(),
  selectedId = null,
} = {}) {
  const limit = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : INSTALLATION_VIEWPORT_LIST_CAP;
  const mapped = filterViewportSitesList(records, listMappedPref);
  const named = filterViewportSitesListNamed(mapped, listNamedPref);
  const source = filterViewportSitesListOsm(named, listOsmPref, selectedId);
  if (!source.length || limit === 0) return [];
  const rows = [];
  for (const record of source) {
    const id = String(record?.id || '').trim();
    const latitude = Number(record?.latitude);
    const longitude = Number(record?.longitude);
    if (!id || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const type = humanizeInstallationClass(record.class);
    const name = String(record?.name || '').trim() || type;
    rows.push({ id, name, type, latitude, longitude });
    if (rows.length >= limit) break;
  }
  return rows;
}

/**
 * List open state and measure mode do not share a flag.
 * @param {{listOpen?: boolean, measureMode?: boolean}} [input]
 * @returns {{listOpen: boolean, measureMode: boolean}}
 */
export function installationListIndependentOfMeasure({
  listOpen = false,
  measureMode = false,
} = {}) {
  return {
    listOpen: Boolean(listOpen),
    measureMode: Boolean(measureMode),
  };
}

/**
 * Fly to one listed feature through the layer's existing focus path.
 * @param {{focusById?: (id: string) => boolean}|null} layer
 * @param {string} id
 * @returns {boolean}
 */
export function flyToInstallationFromList(layer, id) {
  const target = String(id || '').trim();
  if (!target || typeof layer?.focusById !== 'function') return false;
  return layer.focusById(target) === true;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Markup for the current payload rows. Empty bbox stays an empty terminal.
 * @param {Array<{id: string, name: string, type: string}>} rows
 * @returns {string}
 */
export function renderInstallationViewportListRows(rows) {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) {
    return '<div class="installations-viewport-list-empty">NO MAPPED SITES IN VIEW</div>';
  }
  return items.map((row) => {
    const name = escapeHtml(row.name);
    const type = escapeHtml(row.type);
    const id = escapeHtml(row.id);
    return `<button type="button" class="installations-viewport-list-item" data-installation-id="${id}" aria-label="Fly to ${name}"><span class="installations-viewport-list-copy"><strong>${name}</strong><small>${type}</small></span><span class="installations-viewport-list-chevron" aria-hidden="true">›</span></button>`;
  }).join('');
}

/**
 * Sync the hosted Sites chrome with the current payload list.
 * @param {object} input
 * @param {boolean} input.open
 * @param {HTMLElement|null} [input.toggle]
 * @param {HTMLElement|null} [input.panel]
 * @param {Array<object>} [input.rows]
 */
export function applyInstallationViewportList({
  open,
  toggle = null,
  panel = null,
  rows = [],
} = {}) {
  const showing = Boolean(open);
  if (toggle) {
    toggle.setAttribute('aria-pressed', showing ? 'true' : 'false');
    toggle.classList.toggle('active', showing);
  }
  if (panel) {
    panel.hidden = !showing;
    const host = typeof panel.querySelector === 'function'
      ? panel.querySelector('[data-installations-list]')
      : null;
    const count = typeof panel.querySelector === 'function'
      ? panel.querySelector('[data-installations-list-count]')
      : null;
    const markup = renderInstallationViewportListRows(rows);
    if (host) host.innerHTML = markup;
    else panel.innerHTML = markup;
    if (count) count.textContent = rows.length ? String(rows.length) : '—';
  }
  return { panelHidden: !showing, flyAction: INSTALLATION_VIEWPORT_LIST_FLY_ACTION };
}
