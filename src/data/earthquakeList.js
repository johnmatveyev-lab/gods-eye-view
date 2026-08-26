/**
 * Hosted Quakes list — rows from the USGS payload the earthquakes layer
 * already fetched. No new proxy.
 */

import {
  earthquakeListRowMatchesAgeCeiling,
  getEarthquakeListAgeFilter,
  hydrateEarthquakeListAgeFilter,
} from './earthquakeListAgeFilter.js';
import {
  earthquakeListRowMatchesDepthCeiling,
  getEarthquakeListDepthFilter,
  hydrateEarthquakeListDepthFilter,
} from './earthquakeListDepthFilter.js';
import {
  earthquakeListRowMatchesMagFloor,
  getEarthquakeListMagFilter,
  hydrateEarthquakeListMagFilter,
} from './earthquakeListMagFilter.js';

export const EARTHQUAKE_LIST_LIMIT = 50;
export const EARTHQUAKE_LIST_UNAVAILABLE = 'UNAVAILABLE';
export const EARTHQUAKE_LIST_SOURCE = 'USGS';

/**
 * Great-circle distance in kilometres. Used only to rank nearest events.
 * @param {{lat: number, lon: number}} a
 * @param {{lat: number, lon: number}} b
 * @returns {number}
 */
export function earthquakeDistanceKm(a, b) {
  const lat1 = Number(a?.lat);
  const lon1 = Number(a?.lon);
  const lat2 = Number(b?.lat);
  const lon2 = Number(b?.lon);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function finiteCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value) {
  const t = String(value ?? '').trim();
  return t || null;
}

/**
 * Normalize one USGS-backed quake record for the hosted list.
 * Place is the USGS region string, never a person name.
 * @param {object|null|undefined} record
 * @returns {object|null}
 */
export function formatEarthquakeListRow(record) {
  const lat = finiteCoord(record?.lat);
  const lon = finiteCoord(record?.lon);
  const magnitude = finiteCoord(record?.magnitude ?? record?.mag);
  if (lat == null || lon == null || magnitude == null) return null;
  const place = text(record?.place) || EARTHQUAKE_LIST_UNAVAILABLE;
  return {
    id: text(record?.id) || `${lat.toFixed(4)},${lon.toFixed(4)}`,
    lat,
    lon,
    magnitude,
    depthKm: finiteCoord(record?.depthKm ?? record?.depth),
    place,
    timeMs: finiteCoord(record?.timeMs ?? record?.time),
    magnitudeLabel: magnitude == null ? 'M—' : `M${magnitude.toFixed(1)}`,
  };
}

/**
 * Cap to the ~50 most recent events, or the 50 nearest when an origin is given.
 * List magnitude-floor chips (All | 5+ | 6+), depth-ceiling chips
 * (All | <70 km | <20 km), and age-ceiling chips (All | <6 h | <1 h)
 * AND before the cap. The selected row stays through the depth and
 * age ceilings.
 * @param {Array<object>|null|undefined} records
 * @param {{origin?: {lat?: number, lon?: number}|null, limit?: number, magFloor?: unknown, depthCeiling?: unknown, ageCeiling?: unknown, selectedId?: string|null, now?: number}} [options]
 * @returns {Array<object>}
 */
export function selectEarthquakeListRows(records, {
  origin = null,
  limit = EARTHQUAKE_LIST_LIMIT,
  magFloor = getEarthquakeListMagFilter(),
  depthCeiling = getEarthquakeListDepthFilter(),
  ageCeiling = getEarthquakeListAgeFilter(),
  selectedId = null,
  now = Date.now(),
} = {}) {
  const cap = Math.max(0, Math.min(
    EARTHQUAKE_LIST_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(records) || cap === 0) return [];
  const originLat = finiteCoord(origin?.lat);
  const originLon = finiteCoord(origin?.lon);
  const hasOrigin = originLat != null && originLon != null;
  const rows = [];
  for (const record of records) {
    const row = formatEarthquakeListRow(record);
    if (!row) continue;
    if (!earthquakeListRowMatchesMagFloor(row, magFloor)) continue;
    if (!earthquakeListRowMatchesDepthCeiling(row, depthCeiling, { selectedId })) continue;
    if (!earthquakeListRowMatchesAgeCeiling(row, ageCeiling, { selectedId, now })) continue;
    if (hasOrigin) {
      row.distanceKm = earthquakeDistanceKm({ lat: originLat, lon: originLon }, row);
    }
    rows.push(row);
  }
  rows.sort((a, b) => {
    if (hasOrigin) {
      const byDistance = a.distanceKm - b.distanceKm;
      if (byDistance !== 0) return byDistance;
    }
    const byTime = (b.timeMs ?? 0) - (a.timeMs ?? 0);
    if (byTime !== 0) return byTime;
    return String(a.id).localeCompare(String(b.id));
  });
  return rows.slice(0, cap);
}

/**
 * Sync list presentation. Failed or empty feed → unavailable, never a hang.
 * @param {{records?: Array<object>, error?: unknown, origin?: {lat?: number, lon?: number}|null, magFloor?: unknown, depthCeiling?: unknown, ageCeiling?: unknown, selectedId?: string|null, now?: number}} [input]
 * @returns {{status: 'ready'|'unavailable', rows: Array<object>, message: string|null, source: string}}
 */
export function presentEarthquakeList({ records, error, origin, magFloor, depthCeiling, ageCeiling, selectedId, now } = {}) {
  if (error) {
    return {
      status: 'unavailable',
      rows: [],
      message: EARTHQUAKE_LIST_UNAVAILABLE,
      source: EARTHQUAKE_LIST_SOURCE,
    };
  }
  const rows = selectEarthquakeListRows(records, { origin, magFloor, depthCeiling, ageCeiling, selectedId, now });
  if (!rows.length) {
    return {
      status: 'unavailable',
      rows: [],
      message: EARTHQUAKE_LIST_UNAVAILABLE,
      source: EARTHQUAKE_LIST_SOURCE,
    };
  }
  return {
    status: 'ready',
    rows,
    message: null,
    source: EARTHQUAKE_LIST_SOURCE,
  };
}

/**
 * Camera options for flying to one list row. Null when coords are unusable.
 * @param {object|null|undefined} row
 * @returns {{lat: number, lon: number, range: number, pitch: number, heading: number, buildingHeight: number, duration: number}|null}
 */
export function earthquakeListFlyOptions(row) {
  const formatted = formatEarthquakeListRow(row);
  if (!formatted) return null;
  const mag = formatted.magnitude;
  const scaled = Number.isFinite(mag) ? (2 ** mag) * 1800 : 24000;
  return {
    lat: formatted.lat,
    lon: formatted.lon,
    range: Math.max(18000, Math.min(scaled, 180000)),
    pitch: -45,
    heading: 0,
    buildingHeight: 0,
    duration: 2.2,
  };
}

/**
 * Click → fly. Returns false when the row cannot be flown to.
 * @param {{row?: object, flyTo?: Function}} input
 * @returns {boolean}
 */
export function handleEarthquakeListClick({ row, flyTo } = {}) {
  const options = earthquakeListFlyOptions(row);
  if (!options || typeof flyTo !== 'function') return false;
  flyTo(options);
  return true;
}

function makeStubElement() {
  return {
    hidden: true,
    disabled: false,
    textContent: '',
    className: '',
    children: [],
    dataset: {},
    attributes: {},
    listeners: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    removeEventListener(type) { delete this.listeners[type]; },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    click() { this.listeners.click?.({ preventDefault() {} }); },
  };
}

/**
 * Paint list rows with textContent only (USGS place strings stay unparsed HTML).
 * @param {{replaceChildren?: Function, appendChild?: Function}|null} container
 * @param {{status?: string, rows?: Array<object>, message?: string|null}} presentation
 * @param {{onSelect?: Function, createElement?: Function}} [options]
 */
export function renderEarthquakeList(container, presentation, {
  onSelect,
  createElement = globalThis.document?.createElement?.bind(globalThis.document),
} = {}) {
  if (!container) return;
  const make = typeof createElement === 'function'
    ? createElement
    : () => makeStubElement();
  const nodes = [];
  if (presentation?.status !== 'ready' || !presentation.rows?.length) {
    const empty = make('div');
    empty.className = 'earthquake-list-empty';
    empty.textContent = presentation?.message || EARTHQUAKE_LIST_UNAVAILABLE;
    nodes.push(empty);
  } else {
    for (const row of presentation.rows) {
      const button = make('button');
      button.type = 'button';
      button.className = 'earthquake-list-item';
      button.dataset.earthquakeId = row.id;
      const mag = make('strong');
      mag.textContent = row.magnitudeLabel;
      const place = make('span');
      place.textContent = row.place;
      if (typeof button.append === 'function') button.append(mag, place);
      else {
        button.appendChild?.(mag);
        button.appendChild?.(place);
      }
      button.addEventListener?.('click', (event) => {
        event?.preventDefault?.();
        onSelect?.(row);
      });
      nodes.push(button);
    }
  }
  if (typeof container.replaceChildren === 'function') container.replaceChildren(...nodes);
  else {
    container.children = [];
    for (const node of nodes) container.appendChild?.(node);
  }
}

/**
 * Bind the hosted Quakes chrome to the existing USGS layer snapshot.
 * Opening never awaits a fetch — empty/fail paints UNAVAILABLE immediately.
 * @param {object} options
 * @returns {{open: boolean, refresh: Function, destroy: Function}|null}
 */
export function initEarthquakeListControl({
  button,
  panel,
  list,
  count,
  getRecords,
  getError,
  getOrigin,
  getSelectedId,
  flyTo,
  ensureLayer,
  onSelect,
} = {}) {
  if (!button || !panel || !list) return null;
  hydrateEarthquakeListMagFilter();
  hydrateEarthquakeListDepthFilter();
  hydrateEarthquakeListAgeFilter();
  let open = false;

  const refresh = () => {
    const presentation = presentEarthquakeList({
      records: typeof getRecords === 'function' ? getRecords() : [],
      error: typeof getError === 'function' ? getError() : null,
      origin: typeof getOrigin === 'function' ? getOrigin() : null,
      selectedId: typeof getSelectedId === 'function' ? getSelectedId() : null,
    });
    if (count) {
      count.textContent = presentation.status === 'ready'
        ? String(presentation.rows.length)
        : '—';
    }
    renderEarthquakeList(list, presentation, {
      onSelect: (row) => {
        onSelect?.(row);
        handleEarthquakeListClick({ row, flyTo });
      },
    });
    return presentation;
  };

  const setOpen = (next) => {
    open = Boolean(next);
    panel.hidden = !open;
    button.setAttribute?.('aria-expanded', open ? 'true' : 'false');
    button.setAttribute?.('aria-pressed', open ? 'true' : 'false');
    if (open) {
      try { ensureLayer?.(); } catch { /* enable is best-effort; list still paints */ }
      refresh();
    }
    return open;
  };

  const onToggle = (event) => {
    event?.preventDefault?.();
    setOpen(!open);
  };
  button.addEventListener('click', onToggle);
  setOpen(false);

  return {
    get open() { return open; },
    refresh() { return open ? refresh() : presentEarthquakeList({ records: [], error: null }); },
    setOpen,
    destroy() {
      button.removeEventListener?.('click', onToggle);
      open = false;
    },
  };
}
