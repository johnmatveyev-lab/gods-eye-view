import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import {
  DEFAULT_EARTHQUAKE_TIME_WINDOW_HOURS,
  EARTHQUAKE_TIME_WINDOW_LABELS,
  EARTHQUAKE_TIME_WINDOW_TITLES,
  EARTHQUAKE_TIME_WINDOWS_HOURS,
  filterEarthquakeFeaturesByTimeWindow,
  normalizeEarthquakeTimeWindowHours,
} from './earthquakeTimeWindow.js';
import {
  DEFAULT_EARTHQUAKE_TSUNAMI_ONLY,
  EARTHQUAKE_TSUNAMI_CHIP_LABEL,
  EARTHQUAKE_TSUNAMI_CHIP_TITLE,
  filterEarthquakeFeaturesByTsunamiFlag,
  normalizeEarthquakeTsunamiOnly,
} from './earthquakeTsunamiFlag.js';
import {
  DEFAULT_EARTHQUAKE_PAGER_ALERTS,
  EARTHQUAKE_PAGER_ALERTS,
  EARTHQUAKE_PAGER_ALERT_LABELS,
  EARTHQUAKE_PAGER_ALERT_TITLES,
  earthquakePagerAlertFlags,
  filterEarthquakeFeaturesByPagerAlert,
  normalizeEarthquakePagerAlerts,
  toggleEarthquakePagerAlert,
} from './earthquakePagerAlert.js';
import {
  DEFAULT_EARTHQUAKE_REVIEWED_ONLY,
  EARTHQUAKE_REVIEWED_CHIP_LABEL,
  EARTHQUAKE_REVIEWED_CHIP_TITLE,
  filterEarthquakeFeaturesByReviewedStatus,
  normalizeEarthquakeReviewedOnly,
} from './earthquakeReviewedFilter.js';

export {
  DEFAULT_EARTHQUAKE_TIME_WINDOW_HOURS,
  EARTHQUAKE_TIME_WINDOW_LABELS,
  EARTHQUAKE_TIME_WINDOW_TITLES,
  EARTHQUAKE_TIME_WINDOWS_HOURS,
  filterEarthquakeFeaturesByTimeWindow,
  normalizeEarthquakeTimeWindowHours,
} from './earthquakeTimeWindow.js';

export {
  DEFAULT_EARTHQUAKE_TSUNAMI_ONLY,
  EARTHQUAKE_TSUNAMI_CHIP_LABEL,
  EARTHQUAKE_TSUNAMI_CHIP_TITLE,
  filterEarthquakeFeaturesByTsunamiFlag,
  normalizeEarthquakeTsunamiOnly,
} from './earthquakeTsunamiFlag.js';

export {
  DEFAULT_EARTHQUAKE_PAGER_ALERTS,
  EARTHQUAKE_PAGER_ALERTS,
  EARTHQUAKE_PAGER_ALERT_CODES,
  EARTHQUAKE_PAGER_ALERT_LABELS,
  EARTHQUAKE_PAGER_ALERT_TITLES,
  earthquakePagerAlert,
  earthquakePagerAlertFlags,
  filterEarthquakeFeaturesByPagerAlert,
  normalizeEarthquakePagerAlerts,
  toggleEarthquakePagerAlert,
} from './earthquakePagerAlert.js';

export {
  DEFAULT_EARTHQUAKE_REVIEWED_ONLY,
  EARTHQUAKE_REVIEWED_CHIP_LABEL,
  EARTHQUAKE_REVIEWED_CHIP_TITLE,
  earthquakeReviewStatus,
  filterEarthquakeFeaturesByReviewedStatus,
  normalizeEarthquakeReviewedOnly,
} from './earthquakeReviewedFilter.js';

/**
 * USGS earthquake discs — last 24 hours, operator floor 2.5+ / 4.0+ / 5.0+ / 6.0+
 * (default 2.5+, the historic hard-skip), Shallow | Intermediate | Deep chips
 * (default all on, same buckets as depthColor), 1h | 6h | 24h chips
 * (default 24h), a Tsunami only toggle (default off), a Reviewed only
 * toggle (default off), and Green | Yellow | Orange | Red | None PAGER
 * chips (default all on). Floor, depth, time, tsunami, reviewed, and
 * PAGER chips re-filter the last all_day GeoJSON in memory; they do not
 * change the USGS product.
 *
 * Ellipse axes are STATIC (plain numbers), redefined only when a poll brings
 * new data. They must never become a `CallbackProperty` again: every entity
 * here is a `CLAMP_TO_GROUND` ellipse, and a per-frame axis re-tessellates its
 * ground primitive on EVERY frame. Measured on the shipped 58-event feed
 * (2026-08-20 QA hunt, parked camera over SF at 40 km):
 *
 *   58 discs, callback axes → 32.4 ms/frame, 30 fps
 *   58 discs, static axes   →  1.4 ms/frame, 60 fps
 *
 * The former ±15 % radius "pulse" was DROPPED to buy that back: an
 * imperceptible breathing wobble on a translucent ground disc is not worth
 * rebuilding 58 ground primitives 60 times a second. With no per-frame
 * animator left, the layer also no longer holds the render governor
 * continuous — the manager's `layer-tick` / `layer-visibility` requests
 * already cover every discrete mutation this layer makes.
 */

export const USGS_ALL_DAY_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const API_URL = USGS_ALL_DAY_URL;

/** Operator floors. 2.5+ is the historic hard-skip; 5.0+ is the isSignificant cohort. */
export const DEFAULT_EARTHQUAKE_MAGNITUDE_FLOOR = 2.5;
export const EARTHQUAKE_MAGNITUDE_FLOORS = Object.freeze([2.5, 4.0, 5.0, 6.0]);

/** Same buckets `depthColor()` already uses for disc fill. */
export const EARTHQUAKE_DEPTH_BANDS = Object.freeze(['shallow', 'intermediate', 'deep']);
export const EARTHQUAKE_DEPTH_BAND_CODES = Object.freeze({
  shallow: 'S',
  intermediate: 'I',
  deep: 'D',
});
export const EARTHQUAKE_DEPTH_BAND_LABELS = Object.freeze({
  shallow: 'Shallow',
  intermediate: 'Intermediate',
  deep: 'Deep',
});
export const EARTHQUAKE_DEPTH_BAND_TITLES = Object.freeze({
  shallow: 'Show shallow earthquakes (shallower than 70 km)',
  intermediate: 'Show intermediate earthquakes (70–300 km)',
  deep: 'Show deep earthquakes (300 km and deeper)',
});
/** Canonical token when every depth chip is on — current unfiltered depth view. */
export const DEFAULT_EARTHQUAKE_DEPTH_BANDS = 'SID';

const DEPTH_CODE_TO_BAND = Object.freeze(
  Object.fromEntries(
    Object.entries(EARTHQUAKE_DEPTH_BAND_CODES).map(([band, code]) => [code, band]),
  ),
);

/** Same cutoff the discs already use for the heavier stroke / fill. */
export function isSignificantEarthquake(mag) {
  return mag >= 5.0;
}

/**
 * Keep events at or above the operator floor. Comparison matches the historic
 * `mag < 2.5` skip so 2.5+ is the current view.
 * @param {Array<object>|null|undefined} features USGS GeoJSON features.
 * @param {number} [floor=DEFAULT_EARTHQUAKE_MAGNITUDE_FLOOR]
 * @returns {Array<object>}
 */
export function filterEarthquakeFeaturesByMagnitudeFloor(
  features,
  floor = DEFAULT_EARTHQUAKE_MAGNITUDE_FLOOR,
) {
  if (!Array.isArray(features)) return [];
  return features.filter((feature) => !(feature?.properties?.mag < floor));
}

/**
 * Same buckets as `depthColor()`: shallow <70 km, intermediate 70–300,
 * deep ≥300. Missing/non-finite depth matches the draw path (`depthKm || 0`).
 * @param {unknown} depthKm
 * @returns {'shallow'|'intermediate'|'deep'}
 */
export function earthquakeDepthBand(depthKm) {
  const km = Number(depthKm);
  const depth = Number.isFinite(km) ? km : 0;
  if (depth < 70) return 'shallow';
  if (depth < 300) return 'intermediate';
  return 'deep';
}

/**
 * Canonical chip-code token. Invalid input returns null so setParams can refuse.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeEarthquakeDepthBands(value) {
  if (value == null || value === '' || value === true || value === 'all') {
    return DEFAULT_EARTHQUAKE_DEPTH_BANDS;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) return DEFAULT_EARTHQUAKE_DEPTH_BANDS;
    if (trimmed === '0' || trimmed === 'NONE') return '0';
    if (trimmed === DEFAULT_EARTHQUAKE_DEPTH_BANDS || trimmed === 'ALL') {
      return DEFAULT_EARTHQUAKE_DEPTH_BANDS;
    }
    const seen = new Set();
    for (const character of trimmed) {
      const band = DEPTH_CODE_TO_BAND[character];
      if (!band) return null;
      seen.add(band);
    }
    if (!seen.size) return '0';
    const codes = EARTHQUAKE_DEPTH_BANDS
      .filter((band) => seen.has(band))
      .map((band) => EARTHQUAKE_DEPTH_BAND_CODES[band])
      .join('');
    return codes === DEFAULT_EARTHQUAKE_DEPTH_BANDS ? DEFAULT_EARTHQUAKE_DEPTH_BANDS : codes;
  }
  if (Array.isArray(value)) {
    const seen = new Set();
    for (const raw of value) {
      const band = String(raw || '').trim().toLowerCase();
      if (!EARTHQUAKE_DEPTH_BANDS.includes(/** @type {'shallow'|'intermediate'|'deep'} */ (band))) {
        return null;
      }
      seen.add(band);
    }
    if (!seen.size) return '0';
    return normalizeEarthquakeDepthBands(
      Object.fromEntries(EARTHQUAKE_DEPTH_BANDS.map((band) => [band, seen.has(band)])),
    );
  }
  if (typeof value === 'object') {
    const seen = new Set();
    let sawKnown = false;
    for (const band of EARTHQUAKE_DEPTH_BANDS) {
      if (!Object.hasOwn(value, band)) continue;
      sawKnown = true;
      if (value[band] === true) seen.add(band);
    }
    if (!sawKnown) return null;
    if (!seen.size) return '0';
    const codes = EARTHQUAKE_DEPTH_BANDS
      .filter((band) => seen.has(band))
      .map((band) => EARTHQUAKE_DEPTH_BAND_CODES[band])
      .join('');
    return codes === DEFAULT_EARTHQUAKE_DEPTH_BANDS ? DEFAULT_EARTHQUAKE_DEPTH_BANDS : codes;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {Record<'shallow'|'intermediate'|'deep', boolean>}
 */
export function earthquakeDepthBandFlags(value) {
  const token = normalizeEarthquakeDepthBands(value) ?? DEFAULT_EARTHQUAKE_DEPTH_BANDS;
  if (token === '0') {
    return Object.fromEntries(EARTHQUAKE_DEPTH_BANDS.map((band) => [band, false]));
  }
  return Object.fromEntries(
    EARTHQUAKE_DEPTH_BANDS.map((band) => [band, token.includes(EARTHQUAKE_DEPTH_BAND_CODES[band])]),
  );
}

/**
 * Flip one depth chip. Last-off becomes the empty token `0`.
 * @param {unknown} current
 * @param {unknown} band
 * @returns {string}
 */
export function toggleEarthquakeDepthBand(current, band) {
  const id = String(band || '').trim().toLowerCase();
  if (!EARTHQUAKE_DEPTH_BANDS.includes(/** @type {'shallow'|'intermediate'|'deep'} */ (id))) {
    return normalizeEarthquakeDepthBands(current) ?? DEFAULT_EARTHQUAKE_DEPTH_BANDS;
  }
  const token = normalizeEarthquakeDepthBands(current) ?? DEFAULT_EARTHQUAKE_DEPTH_BANDS;
  const enabled = new Set(
    token === '0'
      ? []
      : [...token].map((code) => DEPTH_CODE_TO_BAND[code]).filter(Boolean),
  );
  if (enabled.has(id)) enabled.delete(id);
  else enabled.add(id);
  return normalizeEarthquakeDepthBands(
    Object.fromEntries(EARTHQUAKE_DEPTH_BANDS.map((name) => [name, enabled.has(name)])),
  ) ?? DEFAULT_EARTHQUAKE_DEPTH_BANDS;
}

/**
 * Keep events whose depth falls in an enabled band. Same buckets as discs.
 * @param {Array<object>|null|undefined} features USGS GeoJSON features.
 * @param {unknown} [bands=DEFAULT_EARTHQUAKE_DEPTH_BANDS]
 * @returns {Array<object>}
 */
export function filterEarthquakeFeaturesByDepthBands(
  features,
  bands = DEFAULT_EARTHQUAKE_DEPTH_BANDS,
) {
  if (!Array.isArray(features)) return [];
  const token = normalizeEarthquakeDepthBands(bands) ?? DEFAULT_EARTHQUAKE_DEPTH_BANDS;
  if (token === DEFAULT_EARTHQUAKE_DEPTH_BANDS) return features.slice();
  if (token === '0') return [];
  const enabled = new Set([...token].map((code) => DEPTH_CODE_TO_BAND[code]));
  return features.filter((feature) => {
    const depthKm = feature?.geometry?.coordinates?.[2];
    return enabled.has(earthquakeDepthBand(depthKm));
  });
}

/**
 * AND the operator magnitude floor, depth chips, time window, tsunami flag,
 * reviewed-status toggle, and PAGER alert chips. A selected event stays
 * visible through the tsunami, reviewed, and PAGER gates.
 * @param {Array<object>|null|undefined} features
 * @param {{magnitudeFloor?: number, depthBands?: unknown, timeWindowHours?: unknown, tsunamiOnly?: unknown, reviewedOnly?: unknown, pagerAlerts?: unknown, selectedId?: string|null, now?: number}} [options]
 * @returns {Array<object>}
 */
export function filterEarthquakeFeatures(features, {
  magnitudeFloor = DEFAULT_EARTHQUAKE_MAGNITUDE_FLOOR,
  depthBands = DEFAULT_EARTHQUAKE_DEPTH_BANDS,
  timeWindowHours = DEFAULT_EARTHQUAKE_TIME_WINDOW_HOURS,
  tsunamiOnly = DEFAULT_EARTHQUAKE_TSUNAMI_ONLY,
  reviewedOnly = DEFAULT_EARTHQUAKE_REVIEWED_ONLY,
  pagerAlerts = DEFAULT_EARTHQUAKE_PAGER_ALERTS,
  selectedId = null,
  now = Date.now(),
} = {}) {
  return filterEarthquakeFeaturesByPagerAlert(
    filterEarthquakeFeaturesByReviewedStatus(
      filterEarthquakeFeaturesByTsunamiFlag(
        filterEarthquakeFeaturesByTimeWindow(
          filterEarthquakeFeaturesByDepthBands(
            filterEarthquakeFeaturesByMagnitudeFloor(features, magnitudeFloor),
            depthBands,
          ),
          timeWindowHours,
          now,
        ),
        tsunamiOnly,
        { selectedId },
      ),
      reviewedOnly,
      { selectedId },
    ),
    pagerAlerts,
    { selectedId },
  );
}

export const EARTHQUAKE_OVERLAY_SOURCE_ID = 'earthquakes';
export const EARTHQUAKE_OVERLAY_COHORT_LIMIT = 96;
export const EARTHQUAKE_OVERLAY_COLLISION_CAPACITY = 48;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/**
 * Color by depth:
 *  - Shallow (<70km): Red
 *  - Intermediate (70-300km): Orange
 *  - Deep (>300km): Yellow
 */
function depthColor(depthKm) {
  if (depthKm < 70) return Cesium.Color.RED;
  if (depthKm < 300) return Cesium.Color.ORANGE;
  return Cesium.Color.YELLOW;
}

/**
 * Build the source-owned presentation for one ambient magnitude label.
 * Magnitude formatting deliberately remains here instead of moving into the
 * shared renderer.
 * @param {object} input
 * @param {string} input.id Stable USGS or deterministic fallback id.
 * @param {Cesium.Cartesian3} input.position Ground anchor shared with the pulse.
 * @param {number} input.magnitude USGS magnitude.
 * @param {string} input.accent Source-owned depth-band color.
 * @returns {object}
 */
export function createEarthquakeOverlayEntry({ id, position, magnitude, accent }) {
  const mag = Number(magnitude);
  return {
    id: String(id),
    position,
    variant: 'label',
    title: `M${mag.toFixed(1)}`,
    accent,
    priority: Math.round(mag * 1000),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the largest events, with stable identity as the tie-break. */
export function selectEarthquakeOverlayCohort(
  entries,
  limit = EARTHQUAKE_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(0, Math.min(
    EARTHQUAKE_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Map one earthquake's raw plain values to a JSON-safe analyst record
 * (analyst query engine seam). Pure — no Cesium types. Missing/unknown
 * fields are null, never NaN/undefined. Falls back to an index-based id
 * when the USGS event id is absent.
 * @param {Object|null|undefined} raw - Plain values pulled off the entity:
 *   {id, mag, place, time, depth, lat, lon}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, magnitude: number|null, depthKm: number|null,
 *   lat: number|null, lon: number|null, timeMs: number|null, place: string|null}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `QUAKE-${String(index).padStart(4, '0')}`,
    magnitude: num(raw?.mag),
    depthKm: num(raw?.depth),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    timeMs: num(raw?.time), // USGS epoch ms
    place: text(raw?.place),
  };
}

export function createEarthquakesLayer({ overlayHost = DEFAULT_OVERLAY_HOST } = {}) {
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _listRecords = [];
  let _magnitudeFloor = DEFAULT_EARTHQUAKE_MAGNITUDE_FLOOR;
  let _depthBands = DEFAULT_EARTHQUAKE_DEPTH_BANDS;
  let _timeWindowHours = DEFAULT_EARTHQUAKE_TIME_WINDOW_HOURS;
  let _tsunamiOnly = DEFAULT_EARTHQUAKE_TSUNAMI_ONLY;
  let _reviewedOnly = DEFAULT_EARTHQUAKE_REVIEWED_ONLY;
  let _pagerAlerts = DEFAULT_EARTHQUAKE_PAGER_ALERTS;
  let _selectedId = null;
  let _lastGeojson = null;

  function applyCachedGeojson() {
    if (!_dataSource || !_lastGeojson) return;
    const features = filterEarthquakeFeatures(_lastGeojson.features, {
      magnitudeFloor: _magnitudeFloor,
      depthBands: _depthBands,
      timeWindowHours: _timeWindowHours,
      tsunamiOnly: _tsunamiOnly,
      reviewedOnly: _reviewedOnly,
      pagerAlerts: _pagerAlerts,
      selectedId: _selectedId,
    });
    _dataSource.entities.removeAll();
    let count = 0;
    const overlayEntries = [];
    const listRecords = [];

    for (const feature of features) {
      const [lon, lat, depthKm] = feature.geometry.coordinates;
      const mag = feature.properties.mag;
      const place = feature.properties.place;
      const time = feature.properties.time;

      count++;
      const baseRadius = Math.pow(2, mag) * 1000;
      const color = depthColor(depthKm || 0);
      const isSignificant = isSignificantEarthquake(mag);
      const fillAlpha = isSignificant ? 0.4 : 0.3;
      const outlineAlpha = isSignificant ? 1.0 : 0.8;

      const position = Cesium.Cartesian3.fromDegrees(lon, lat);
      const stableId = feature.id || `event-${count}`;
      _dataSource.entities.add({
        id: `earthquake:${stableId}`,
        position,
        ellipse: {
          // Static axes — see the module header. A CallbackProperty here
          // re-tessellates the clamped ground geometry every frame.
          semiMajorAxis: baseRadius,
          semiMinorAxis: baseRadius,
          material: new Cesium.ColorMaterialProperty(
            color.withAlpha(fillAlpha)
          ),
          outline: true,
          outlineColor: color.withAlpha(outlineAlpha),
          outlineWidth: isSignificant ? 3 : 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        properties: {
          // Analyst seam (additive): the USGS event id (e.g. "us7000abcd").
          usgsId: feature.id ?? null,
          mag,
          place,
          time,
          depth: depthKm,
        },
      });
      overlayEntries.push(createEarthquakeOverlayEntry({
        id: String(stableId),
        position,
        magnitude: mag,
        accent: color.toCssColorString(),
      }));
      listRecords.push(mapAnalystRecord({
        id: feature.id ?? null,
        mag,
        place,
        time,
        depth: depthKm,
        lat,
        lon,
      }, listRecords.length));
    }

    if (_enabled) {
      overlayHost.setEntries(
        EARTHQUAKE_OVERLAY_SOURCE_ID,
        selectEarthquakeOverlayCohort(overlayEntries),
        {
          cohortLimit: EARTHQUAKE_OVERLAY_COHORT_LIMIT,
          collisionCapacity: EARTHQUAKE_OVERLAY_COLLISION_CAPACITY,
          moving: false,
        },
      );
    }

    _count = count;
    _listRecords = listRecords;
    console.log(`[Data:Earthquakes] Updated: ${_count} events (M${_magnitudeFloor.toFixed(1)}+ · ${_depthBands} · ${_timeWindowHours}h${_tsunamiOnly ? ' · tsunami' : ''}${_reviewedOnly ? ' · reviewed' : ''}${_pagerAlerts !== DEFAULT_EARTHQUAKE_PAGER_ALERTS ? ` · pager ${_pagerAlerts}` : ''})`);
  }

  const layer = {
  id: 'earthquakes',
  name: 'Earthquakes (24h)',
  icon: '🌋',
  source: 'USGS',
  updateInterval: 60000,

  init(viewer) {
    _dataSource = new Cesium.CustomDataSource('earthquakes');
    _dataSource.show = false;
    viewer.dataSources.add(_dataSource);
    _count = 0;
    _lastUpdate = null;
    _lastError = null;
    _enabled = false;
    _listRecords = [];
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
    console.log('[Data:Earthquakes] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    // No continuous-render hold: the discs are static geometry now, so the
    // layer has no per-frame animator to keep the render loop alive for.
    if (_dataSource) _dataSource.show = true;
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, true);
  },

  disable(viewer) {
    _enabled = false;
    if (_dataSource) _dataSource.show = false;
    overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID);
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
  },

  async update(viewer) {
    try {
      const response = await fetch(API_URL);
      if (!response.ok) {
        _lastError = `USGS HTTP ${response.status}`;
        _listRecords = [];
        console.warn(`[Data:Earthquakes] API returned ${response.status}`);
        return false;
      }

      const geojson = await response.json();
      if (!geojson || !Array.isArray(geojson.features)) {
        _lastError = 'Malformed USGS response';
        _listRecords = [];
        return false;
      }

      _lastGeojson = geojson;
      applyCachedGeojson();
      _lastUpdate = Date.now();
      _lastError = null;
      return true;

    } catch (e) {
      console.warn('[Data:Earthquakes] Fetch error:', e);
      _lastError = 'USGS network error';
      _listRecords = [];
      return false;
    }
  },

  destroy(viewer) {
    _enabled = false;
    overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID);
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
    if (_dataSource) {
      viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
    }
    _count = 0;
    _lastUpdate = null;
    _lastError = null;
    _listRecords = [];
    _lastGeojson = null;
    _magnitudeFloor = DEFAULT_EARTHQUAKE_MAGNITUDE_FLOOR;
    _depthBands = DEFAULT_EARTHQUAKE_DEPTH_BANDS;
    _timeWindowHours = DEFAULT_EARTHQUAKE_TIME_WINDOW_HOURS;
    _tsunamiOnly = DEFAULT_EARTHQUAKE_TSUNAMI_ONLY;
    _reviewedOnly = DEFAULT_EARTHQUAKE_REVIEWED_ONLY;
    _pagerAlerts = DEFAULT_EARTHQUAKE_PAGER_ALERTS;
    _selectedId = null;
  },

  getParams() {
    return {
      magnitudeFloor: _magnitudeFloor,
      depthBands: _depthBands,
      timeWindowHours: _timeWindowHours,
      tsunamiOnly: _tsunamiOnly,
      reviewedOnly: _reviewedOnly,
      pagerAlerts: _pagerAlerts,
      selectedId: _selectedId,
    };
  },

  setParams(params = {}) {
    if (!params || typeof params !== 'object') return false;
    const hasFloor = Object.hasOwn(params, 'magnitudeFloor');
    const hasDepth = Object.hasOwn(params, 'depthBands');
    const hasTime = Object.hasOwn(params, 'timeWindowHours');
    const hasTsunami = Object.hasOwn(params, 'tsunamiOnly');
    const hasReviewed = Object.hasOwn(params, 'reviewedOnly');
    const hasPager = Object.hasOwn(params, 'pagerAlerts');
    const hasSelected = Object.hasOwn(params, 'selectedId');
    if (!hasFloor && !hasDepth && !hasTime && !hasTsunami && !hasReviewed && !hasPager && !hasSelected) return true;

    let nextFloor = _magnitudeFloor;
    if (hasFloor) {
      const floor = Number(params.magnitudeFloor);
      if (!EARTHQUAKE_MAGNITUDE_FLOORS.includes(floor)) return false;
      nextFloor = floor;
    }

    let nextDepth = _depthBands;
    if (hasDepth) {
      const bands = normalizeEarthquakeDepthBands(params.depthBands);
      if (bands == null) return false;
      nextDepth = bands;
    }

    let nextTime = _timeWindowHours;
    if (hasTime) {
      const hours = normalizeEarthquakeTimeWindowHours(params.timeWindowHours);
      if (hours == null) return false;
      nextTime = hours;
    }

    let nextTsunami = _tsunamiOnly;
    if (hasTsunami) {
      const only = normalizeEarthquakeTsunamiOnly(params.tsunamiOnly);
      if (only == null) return false;
      nextTsunami = only;
    }

    let nextReviewed = _reviewedOnly;
    if (hasReviewed) {
      const only = normalizeEarthquakeReviewedOnly(params.reviewedOnly);
      if (only == null) return false;
      nextReviewed = only;
    }

    let nextPager = _pagerAlerts;
    if (hasPager) {
      const alerts = normalizeEarthquakePagerAlerts(params.pagerAlerts);
      if (alerts == null) return false;
      nextPager = alerts;
    }

    let nextSelected = _selectedId;
    if (hasSelected) {
      nextSelected = params.selectedId == null || params.selectedId === ''
        ? null
        : String(params.selectedId);
    }

    if (
      nextFloor === _magnitudeFloor
      && nextDepth === _depthBands
      && nextTime === _timeWindowHours
      && nextTsunami === _tsunamiOnly
      && nextReviewed === _reviewedOnly
      && nextPager === _pagerAlerts
      && nextSelected === _selectedId
    ) return true;
    _magnitudeFloor = nextFloor;
    _depthBands = nextDepth;
    _timeWindowHours = nextTime;
    _tsunamiOnly = nextTsunami;
    _reviewedOnly = nextReviewed;
    _pagerAlerts = nextPager;
    _selectedId = nextSelected;
    applyCachedGeojson();
    return true;
  },

  getRowControls() {
    return {
      chips: [
        ...EARTHQUAKE_MAGNITUDE_FLOORS.map((floor) => ({
          id: `floor-${floor.toFixed(1)}`,
          label: `${floor.toFixed(1)}+`,
          active: _magnitudeFloor === floor,
          title: `Show M${floor.toFixed(1)}+ earthquakes from the last 24 hours`,
          params: { magnitudeFloor: floor },
        })),
        ...EARTHQUAKE_TIME_WINDOWS_HOURS.map((hours) => ({
          id: `time-${hours}`,
          label: EARTHQUAKE_TIME_WINDOW_LABELS[hours],
          active: _timeWindowHours === hours,
          group: 'Time',
          title: EARTHQUAKE_TIME_WINDOW_TITLES[hours],
          params: { timeWindowHours: hours },
        })),
        ...EARTHQUAKE_DEPTH_BANDS.map((band) => ({
          id: `depth-${band}`,
          label: EARTHQUAKE_DEPTH_BAND_LABELS[band],
          active: earthquakeDepthBandFlags(_depthBands)[band] === true,
          group: 'Depth',
          title: EARTHQUAKE_DEPTH_BAND_TITLES[band],
          params: { depthBands: toggleEarthquakeDepthBand(_depthBands, band) },
        })),
        {
          id: 'tsunami-only',
          label: EARTHQUAKE_TSUNAMI_CHIP_LABEL,
          active: _tsunamiOnly === true,
          group: 'Tsunami',
          title: EARTHQUAKE_TSUNAMI_CHIP_TITLE,
          params: { tsunamiOnly: !_tsunamiOnly },
        },
        {
          id: 'reviewed-only',
          label: EARTHQUAKE_REVIEWED_CHIP_LABEL,
          active: _reviewedOnly === true,
          group: 'Reviewed',
          title: EARTHQUAKE_REVIEWED_CHIP_TITLE,
          params: { reviewedOnly: !_reviewedOnly },
        },
        ...EARTHQUAKE_PAGER_ALERTS.map((alert) => ({
          id: `pager-${alert}`,
          label: EARTHQUAKE_PAGER_ALERT_LABELS[alert],
          active: earthquakePagerAlertFlags(_pagerAlerts)[alert] === true,
          group: 'PAGER',
          title: EARTHQUAKE_PAGER_ALERT_TITLES[alert],
          params: { pagerAlerts: toggleEarthquakePagerAlert(_pagerAlerts, alert) },
        })),
      ],
      legend: [],
    };
  },

  /**
   * Snapshot the layer's in-memory earthquake records as plain JSON-safe
   * objects for the analyst query engine. On-demand only (called at most
   * once per spoken query) — zero per-frame cost, no listeners, no caching.
   * Returns [] while the layer is disabled or empty.
   * @param {number} [maxCount=2000] - Maximum records to return (truncation).
   * @returns {Array<Object>} See mapAnalystRecord for the record shape.
   */
  getAnalystRecords(maxCount = 2000) {
    if (!_dataSource || !_dataSource.show) return [];
    const entities = _dataSource.entities.values;
    if (!entities.length) return [];
    const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
    const now = Cesium.JulianDate.now();
    const result = [];
    for (const entity of entities) {
      if (result.length >= limit) break;
      const cartesian = entity.position ? entity.position.getValue(now) : null;
      const carto = cartesian ? Cesium.Cartographic.fromCartesian(cartesian) : null;
      const p = entity.properties;
      result.push(mapAnalystRecord({
        id: p?.usgsId?.getValue(now) ?? null,
        mag: p?.mag?.getValue(now),
        place: p?.place?.getValue(now),
        time: p?.time?.getValue(now),
        depth: p?.depth?.getValue(now),
        lat: carto ? Cesium.Math.toDegrees(carto.latitude) : null,
        lon: carto ? Cesium.Math.toDegrees(carto.longitude) : null,
      }, result.length));
    }
    return result;
  },

  /**
   * Snapshot for the hosted Quakes list. Same USGS features the discs
   * already parsed — no second fetch — and already clipped to the operator
   * magnitude floor, depth chips, time window, tsunami flag, reviewed
   * status, AND PAGER alert.
   * A failed feed returns []
   * so the list can show UNAVAILABLE instead of stale rows or a hang.
   * @returns {Array<Object>}
   */
  getListRecords() {
    return _lastError ? [] : _listRecords.slice();
  },

  getStats() {
    return {
      count: _count,
      lastUpdate: _lastUpdate,
      error: _lastError,
    };
  },
  };
  return layer;
}

const earthquakesLayer = createEarthquakesLayer();

export default earthquakesLayer;
