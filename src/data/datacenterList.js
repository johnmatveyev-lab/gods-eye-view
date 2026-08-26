/**
 * In-view datacenter list + fly-to.
 *
 * Reads the already-loaded `local-datacenters` payload (bundled OSM / ODbL
 * snapshot). Does not fetch, does not query Overpass, and does not touch
 * mapped installations or FIRMS. Plan 206 operator chips, Plan 270 Named
 * only, Plan 285 Website only, Plan 291 Dated only, Plan 301 Owner
 * only, and Plan 304 Ref only re-filter this list only — globe stems
 * stay. Named only ANDs after the operator matcher; Website only ANDs
 * after Named only; Dated only ANDs after Website only; Owner only ANDs
 * after Dated only; Ref only ANDs after Owner only.
 */

import {
  DEFAULT_DATACENTER_LIST_OPERATOR,
  datacenterMatchesListOperator,
  getDatacenterListOperator,
} from './datacenterListOperatorFilter.js';
import {
  DEFAULT_DATACENTER_NAMED_ONLY,
  datacenterMatchesNamedFilter,
  getDatacenterListNamedOnly,
} from './datacenterListNamedFilter.js';
import {
  DEFAULT_DATACENTER_WEBSITE_ONLY,
  datacenterMatchesWebsiteFilter,
  getDatacenterListWebsiteOnly,
} from './datacenterListWebsiteFilter.js';
import {
  DEFAULT_DATACENTER_DATED_ONLY,
  datacenterMatchesDatedOnlyFilter,
  getDatacenterListDatedOnly,
} from './datacenterListDatedOnlyFilter.js';
import {
  DEFAULT_DATACENTER_OWNER_ONLY,
  datacenterMatchesOwnerOnlyFilter,
  getDatacenterListOwnerOnly,
} from './datacenterListOwnerOnlyFilter.js';
import {
  DEFAULT_DATACENTER_REF_ONLY,
  datacenterMatchesRefOnlyFilter,
  getDatacenterListRefOnly,
} from './datacenterListRefOnlyFilter.js';

export const DATACENTER_LAYER_ID = 'local-datacenters';
export const DATACENTER_LIST_CAP = 50;
/** Same height the stem click already uses in `localGeojson.js`. */
export const DATACENTER_FLY_HEIGHT_M = 5000;
/** Same duration the stem click already uses in `localGeojson.js`. */
export const DATACENTER_FLY_DURATION_S = 1.5;

const EARTH_R_KM = 6371;

/**
 * Whether a WGS84 point sits inside a camera view rectangle.
 * A missing rectangle is treated as "do not geo-filter".
 * Dateline-wrapping views (west > east) stay inclusive on both sides.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {{west?: number, south?: number, east?: number, north?: number}|null} view
 * @returns {boolean}
 */
export function pointInViewBounds(lat, lon, view) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (!view || !Number.isFinite(view.west) || !Number.isFinite(view.south)
    || !Number.isFinite(view.east) || !Number.isFinite(view.north)) {
    return true;
  }
  if (lat < view.south || lat > view.north) return false;
  if (view.west <= view.east) return lon >= view.west && lon <= view.east;
  return lon >= view.west || lon <= view.east;
}

/**
 * Great-circle distance in km. Non-finite inputs return Infinity so they
 * sort last instead of becoming NaN in the cap window.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
export function datacenterDistanceKm(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const d2r = Math.PI / 180;
  const dLat = (lat2 - lat1) * d2r;
  const dLon = (lon2 - lon1) * d2r;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Sites from the existing datacenter payload that are in the current view.
 * Layer-off or an empty payload returns []. Cap defaults to 50.
 *
 * @param {object} options
 * @param {boolean} options.enabled Layer toggle.
 * @param {Array<object>} options.records Payload from `getListPayload()`.
 * @param {{west?: number, south?: number, east?: number, north?: number, centerLat?: number, centerLon?: number}|null} [options.view]
 * @param {number} [options.cap]
 * @param {unknown} [options.operatorFilter] Exclusive All | AWS | Equinix chip.
 * @param {unknown} [options.namedOnly] Named only toggle. Default off.
 * @param {unknown} [options.websiteOnly] Website only toggle. Default off.
 * @param {unknown} [options.datedOnly] Dated only toggle. Default off.
 * @param {unknown} [options.ownerOnly] Owner only toggle. Default off.
 * @param {unknown} [options.refOnly] Ref only toggle. Default off.
 * @param {string|null} [options.selectedId] Selected list / globe row stays
 *   when it already passed the other matchers.
 * @returns {Array<{id: string, label: string, latitude: number, longitude: number, distanceKm: number}>}
 */
export function listDatacentersInView({
  enabled,
  records,
  view = null,
  cap = DATACENTER_LIST_CAP,
  operatorFilter = DEFAULT_DATACENTER_LIST_OPERATOR,
  namedOnly = DEFAULT_DATACENTER_NAMED_ONLY,
  websiteOnly = DEFAULT_DATACENTER_WEBSITE_ONLY,
  datedOnly = DEFAULT_DATACENTER_DATED_ONLY,
  ownerOnly = DEFAULT_DATACENTER_OWNER_ONLY,
  refOnly = DEFAULT_DATACENTER_REF_ONLY,
  selectedId = null,
} = {}) {
  if (!enabled) return [];
  if (!Array.isArray(records) || records.length === 0) return [];

  const limit = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : DATACENTER_LIST_CAP;
  if (limit === 0) return [];

  const centerLat = Number(view?.centerLat);
  const centerLon = Number(view?.centerLon);
  const listed = [];

  for (const record of records) {
    if (record?.visible === false) continue;
    if (!datacenterMatchesListOperator(record, operatorFilter)) continue;
    const latitude = Number(record?.latitude);
    const longitude = Number(record?.longitude);
    if (!pointInViewBounds(latitude, longitude, view)) continue;
    const id = String(record.id ?? '');
    const label = String(record.label || 'Datacenter').trim() || 'Datacenter';
    if (!datacenterMatchesNamedFilter({ id, label }, namedOnly, { selectedId })) continue;
    if (!datacenterMatchesWebsiteFilter(record, websiteOnly, { selectedId })) continue;
    if (!datacenterMatchesDatedOnlyFilter(record, datedOnly, { selectedId })) continue;
    if (!datacenterMatchesOwnerOnlyFilter(record, ownerOnly, { selectedId })) continue;
    if (!datacenterMatchesRefOnlyFilter(record, refOnly, { selectedId })) continue;
    listed.push({
      id,
      label,
      latitude,
      longitude,
      distanceKm: datacenterDistanceKm(centerLat, centerLon, latitude, longitude),
    });
  }

  listed.sort((a, b) => (
    a.distanceKm - b.distanceKm
    || a.label.localeCompare(b.label)
    || a.id.localeCompare(b.id)
  ));
  return listed.slice(0, limit);
}

/**
 * Fly destination matching the existing datacenter-stem click path.
 * @param {{latitude?: number, longitude?: number}|null} site
 * @returns {{latitude: number, longitude: number, height: number, duration: number}|null}
 */
export function datacenterFlyDestination(site) {
  const latitude = Number(site?.latitude);
  const longitude = Number(site?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    height: DATACENTER_FLY_HEIGHT_M,
    duration: DATACENTER_FLY_DURATION_S,
  };
}

/**
 * Paint the in-view list. Empty payload or layer-off leaves the list empty.
 * @param {HTMLElement|null} items
 * @param {HTMLElement|null} count
 * @param {Array<{id: string, label: string, latitude: number, longitude: number}>} sites
 */
export function renderDatacenterInViewList(items, count, sites) {
  const rows = Array.isArray(sites) ? sites : [];
  if (count) count.textContent = String(rows.length);
  if (!items) return;
  items.replaceChildren();
  if (rows.length === 0) {
    const empty = items.ownerDocument?.createElement?.('div') || globalThis.document?.createElement?.('div');
    if (!empty) return;
    empty.className = 'in-view-site-list-empty';
    empty.textContent = 'No datacenters in view';
    items.appendChild(empty);
    return;
  }
  for (const site of rows) {
    const button = items.ownerDocument?.createElement?.('button')
      || globalThis.document?.createElement?.('button');
    if (!button) return;
    button.type = 'button';
    button.className = 'in-view-site-list-item';
    button.dataset.datacenterId = site.id;
    button.setAttribute('role', 'listitem');
    button.textContent = site.label;
    items.appendChild(button);
  }
}

/**
 * Bind the hosted in-view list. Click flies to the payload coords.
 *
 * @param {object} options
 * @param {HTMLElement|null} options.root
 * @param {HTMLElement|null} options.items
 * @param {HTMLElement|null} [options.count]
 * @param {() => boolean} options.getEnabled
 * @param {() => Array<object>} options.getRecords
 * @param {() => object|null} options.getView
 * @param {() => unknown} [options.getNamedOnly] Persist / chip toggle.
 * @param {() => unknown} [options.getWebsiteOnly] Persist / chip toggle.
 * @param {() => unknown} [options.getDatedOnly] Persist / chip toggle.
 * @param {() => unknown} [options.getOwnerOnly] Persist / chip toggle.
 * @param {() => unknown} [options.getRefOnly] Persist / chip toggle.
 * @param {() => string|null} [options.getSelectedId] Globe / list selection.
 * @param {(site: object) => boolean|void} options.flyTo
 * @returns {{refresh: Function, destroy: Function, sites: () => Array<object>}|null}
 */
export function bindDatacenterInViewList({
  root,
  items,
  count = null,
  getEnabled,
  getRecords,
  getView,
  getNamedOnly,
  getWebsiteOnly,
  getDatedOnly,
  getOwnerOnly,
  getRefOnly,
  getSelectedId,
  flyTo,
} = {}) {
  if (!root || !items || typeof getEnabled !== 'function' || typeof getRecords !== 'function') {
    return null;
  }

  let current = [];
  let selectedId = null;

  const refresh = () => {
    const enabled = Boolean(getEnabled());
    const hostSelected = typeof getSelectedId === 'function' ? getSelectedId() : null;
    current = listDatacentersInView({
      enabled,
      records: getRecords() || [],
      view: typeof getView === 'function' ? getView() : null,
      operatorFilter: getDatacenterListOperator(),
      namedOnly: typeof getNamedOnly === 'function'
        ? getNamedOnly()
        : getDatacenterListNamedOnly(),
      websiteOnly: typeof getWebsiteOnly === 'function'
        ? getWebsiteOnly()
        : getDatacenterListWebsiteOnly(),
      datedOnly: typeof getDatedOnly === 'function'
        ? getDatedOnly()
        : getDatacenterListDatedOnly(),
      ownerOnly: typeof getOwnerOnly === 'function'
        ? getOwnerOnly()
        : getDatacenterListOwnerOnly(),
      refOnly: typeof getRefOnly === 'function'
        ? getRefOnly()
        : getDatacenterListRefOnly(),
      selectedId: hostSelected || selectedId,
    });
    root.hidden = !enabled;
    renderDatacenterInViewList(items, count, current);
    return current;
  };

  const onClick = (event) => {
    const button = event?.target?.closest?.('[data-datacenter-id]');
    if (!button) return;
    const site = current.find((entry) => entry.id === button.dataset.datacenterId);
    if (!site || typeof flyTo !== 'function') return;
    selectedId = site.id;
    flyTo(site);
  };

  items.addEventListener('click', onClick);
  refresh();

  return {
    refresh,
    sites: () => current.slice(),
    destroy() {
      items.removeEventListener?.('click', onClick);
      current = [];
      selectedId = null;
    },
  };
}

/**
 * Camera rectangle in degrees. Missing `computeViewRectangle` falls back to
 * the camera center so the list can still sort nearest-first.
 * @param {object|null} camera
 * @param {{toDegrees?: Function}} [math]
 * @returns {{west?: number, south?: number, east?: number, north?: number, centerLat?: number, centerLon?: number}|null}
 */
export function viewFromCamera(camera, math = null) {
  if (!camera) return null;
  const toDegrees = typeof math?.toDegrees === 'function'
    ? (value) => math.toDegrees(value)
    : (value) => Number(value) * (180 / Math.PI);

  const rect = typeof camera.computeViewRectangle === 'function'
    ? camera.computeViewRectangle()
    : null;
  if (rect && [rect.west, rect.south, rect.east, rect.north].every(Number.isFinite)) {
    return {
      west: toDegrees(rect.west),
      south: toDegrees(rect.south),
      east: toDegrees(rect.east),
      north: toDegrees(rect.north),
      centerLat: toDegrees((Number(rect.south) + Number(rect.north)) / 2),
      centerLon: toDegrees((Number(rect.west) + Number(rect.east)) / 2),
    };
  }

  const carto = camera.positionCartographic;
  if (!carto || !Number.isFinite(carto.latitude) || !Number.isFinite(carto.longitude)) {
    return null;
  }
  return {
    centerLat: toDegrees(carto.latitude),
    centerLon: toDegrees(carto.longitude),
  };
}
