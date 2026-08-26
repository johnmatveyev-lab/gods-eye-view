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
import {
  filterViewportSitesListClass,
  getSitesListClassFilter,
  hydrateSitesListClassFilter,
  readSitesListClassPref,
  setSitesListClassFilter,
  sitesListClassChipModels,
  subscribeSitesListClassFilter,
} from './installationListClassFilter.js';

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
 * The list-only class chips then keep All, Airfield, or Naval.
 * @param {Array<object>|null|undefined} records Layer `getViewportRecords()` snapshot.
 * @param {{cap?: number, listMappedPref?: unknown, listNamedPref?: unknown, listOsmPref?: unknown, listClassPref?: unknown, selectedId?: string|null}} [options]
 * @returns {Array<{id: string, name: string, type: string, latitude: number, longitude: number}>}
 */
export function listViewportInstallations(records, options = {}) {
  if (Array.isArray(records)) lastListRecords = records;
  if (Object.hasOwn(options, 'selectedId')) lastSelectedId = options.selectedId ?? null;
  const {
    cap = INSTALLATION_VIEWPORT_LIST_CAP,
    listMappedPref = readSitesListMappedPref(),
    listNamedPref = readSitesListNamedPref(),
    listOsmPref = readSitesListOsmPref(),
    listClassPref = getSitesListClassFilter(),
    selectedId = null,
  } = options;
  const limit = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : INSTALLATION_VIEWPORT_LIST_CAP;
  const mapped = filterViewportSitesList(records, listMappedPref);
  const named = filterViewportSitesListNamed(mapped, listNamedPref);
  const osm = filterViewportSitesListOsm(named, listOsmPref, selectedId);
  const source = filterViewportSitesListClass(osm, listClassPref, selectedId);
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

/**
 * Hosted Sites list class chips. Mapped / named / OSM stay in the HTML
 * row from Plans 209 / 220 / 235; class chips are owned here so
 * index.html / ui.js do not re-declare them.
 * @returns {{chips: Array<object>}}
 */
export function getRowControls() {
  return {
    chips: sitesListClassChipModels(getSitesListClassFilter()),
  };
}

/** @returns {{listClass: 'all'|'airfield'|'naval'}} */
export function getParams() {
  return { listClass: getSitesListClassFilter() };
}

/**
 * Apply list-only class chips. Persistence stays on meridian.sitesListClass.
 * @param {{listClass?: unknown}|null|undefined} [params]
 * @returns {boolean}
 */
export function setParams(params = {}) {
  if (!params || typeof params !== 'object') return false;
  if (!Object.hasOwn(params, 'listClass')) return true;
  setSitesListClassFilter(params.listClass);
  return true;
}

export {
  getSitesListClassFilter,
  hydrateSitesListClassFilter,
  readSitesListClassPref,
  setSitesListClassFilter,
  subscribeSitesListClassFilter,
};

let lastListRecords = [];
let lastSelectedId = null;
let lastOpen = false;
let lastPanel = null;
let classChipsHydrated = false;
let classChipsMounted = false;
let classChipsSubscribed = false;

function paintInstallationListRows(panel, rows) {
  if (!panel) return;
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

function createClassChipElement(model, make) {
  const button = make('button');
  button.type = 'button';
  button.className = `installation-list-osm-chip${model.active ? ' active' : ''}`;
  button.dataset.installationListClass = model.params.listClass;
  button.textContent = model.label;
  if (model.title) button.title = model.title;
  button.setAttribute?.('aria-pressed', model.active ? 'true' : 'false');
  return button;
}

function syncSitesListClassChips(panel) {
  const root = panel?.id === 'installation-list-class-chips'
    ? panel
    : panel?.querySelector?.('#installation-list-class-chips');
  if (!root?.querySelectorAll) return;
  const models = getRowControls().chips;
  const chips = root.querySelectorAll('[data-installation-list-class]');
  for (const chip of chips) {
    const active = models.some((model) => (
      model.params.listClass === chip.dataset.installationListClass && model.active
    ));
    chip.classList?.toggle?.('active', active);
    chip.setAttribute?.('aria-pressed', active ? 'true' : 'false');
  }
  const osm = panel?.querySelector?.('#installation-list-osm-chips')
    || root.previousElementSibling;
  if (osm?.id === 'installation-list-osm-chips') {
    root.hidden = osm.hidden === true;
  }
}

/**
 * Inject All | Airfield | Naval after the existing list OSM chips.
 * No-ops on the stub panels used by unit tests (no querySelector).
 * @param {{querySelector?: Function, appendChild?: Function}|null} panel
 * @returns {boolean}
 */
function mountSitesListClassChips(panel) {
  if (typeof panel?.querySelector !== 'function') return false;
  let root = panel.querySelector('#installation-list-class-chips');
  const make = globalThis.document?.createElement?.bind(globalThis.document);
  if (!root && typeof make === 'function') {
    root = make('div');
    root.id = 'installation-list-class-chips';
    root.className = 'installation-list-osm-chips';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Site class (list)');
    const after = panel.querySelector('#installation-list-osm-chips');
    if (typeof after?.insertAdjacentElement === 'function') {
      after.insertAdjacentElement('afterend', root);
    } else {
      const header = panel.querySelector('.installations-viewport-list-header > div') || panel;
      header.appendChild?.(root);
    }
    root.hidden = after?.hidden === true;
  }
  if (!root) return false;
  if (typeof make === 'function' && !root.querySelector?.('[data-installation-list-class]')) {
    const nodes = getRowControls().chips.map((model) => createClassChipElement(model, make));
    if (typeof root.replaceChildren === 'function') root.replaceChildren(...nodes);
    else {
      for (const node of nodes) root.appendChild?.(node);
    }
  }
  if (root.dataset.sitesListClassBound === '1') {
    syncSitesListClassChips(panel);
    return true;
  }
  const onClick = (event) => {
    const chip = event.target?.closest?.('[data-installation-list-class]');
    if (!chip || (typeof root.contains === 'function' && !root.contains(chip))) return;
    setSitesListClassFilter(chip.dataset.installationListClass);
    syncSitesListClassChips(panel);
  };
  root.addEventListener?.('click', onClick);
  root.dataset.sitesListClassBound = '1';
  syncSitesListClassChips(panel);
  return true;
}

function bindSitesListClassChips(panel) {
  if (!classChipsHydrated) {
    hydrateSitesListClassFilter();
    classChipsHydrated = true;
  }
  if (!classChipsMounted) {
    classChipsMounted = mountSitesListClassChips(panel);
  } else {
    syncSitesListClassChips(panel);
  }
  if (classChipsSubscribed) return;
  subscribeSitesListClassFilter(() => {
    syncSitesListClassChips(lastPanel);
    if (lastOpen && typeof lastPanel?.querySelector === 'function'
      && lastPanel.querySelector('[data-installations-list]')) {
      paintInstallationListRows(
        lastPanel,
        listViewportInstallations(lastListRecords, { selectedId: lastSelectedId }),
      );
    }
  });
  classChipsSubscribed = true;
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
  lastOpen = showing;
  lastPanel = panel;
  bindSitesListClassChips(panel);
  if (toggle) {
    toggle.setAttribute('aria-pressed', showing ? 'true' : 'false');
    toggle.classList.toggle('active', showing);
  }
  if (panel) {
    panel.hidden = !showing;
    paintInstallationListRows(panel, rows);
  }
  return { panelHidden: !showing, flyAction: INSTALLATION_VIEWPORT_LIST_FLY_ACTION };
}

hydrateSitesListClassFilter();
classChipsHydrated = true;
