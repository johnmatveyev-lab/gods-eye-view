/**
 * Nearby NASA FIRMS fire list — pure helpers over the trailing-24h
 * `/api/firms` payload the heatmap layer already loaded. No Cesium, no
 * NASA fetch, no traffic Live/Sim coupling.
 */

import { greatCircleKm } from './routePlausible.js';
import { fireDetectionKey, satelliteShortName } from './firmsLabels.js';
import {
  FIRMS_LIST_CONF_HIGH_MIN,
  FIRMS_LIST_CONF_NOMINAL_MIN,
  fireMeetsListConf,
  getFirmsListConf,
} from './firmsListConfFilter.js';
import {
  fireMeetsListFrp,
  getFirmsListFrp,
  getFirmsListSelectedId,
} from './firmsListFrpFilter.js';
import {
  fireMeetsListAge,
  getFirmsListAge,
} from './firmsListAgeFilter.js';

/** Hosted list ceiling: nearest detections to the current camera. */
export const FIRMS_LIST_LIMIT = 50;

/** 503 {error:'no_key'} / keyless hosted install. */
export const FIRMS_LIST_UNAVAILABLE_COPY =
  'FIRMS unavailable — NASA map key is not configured.';

/** Key present but the trailing-24h payload is empty. */
export const FIRMS_LIST_EMPTY_COPY =
  'FIRMS unavailable — no trailing-24h detections to list.';

export const FIRMS_LIST_LOADING_COPY = 'Loading NASA FIRMS detections…';

export const FIRMS_LIST_ENABLE_COPY =
  'Enable FIRMS Active Fires to list nearby detections.';

/** Required NASA FIRMS acknowledgement (DATA_SOURCES.md). */
export const FIRMS_ACKNOWLEDGEMENT =
  "We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Earth Observing System Data and Information System (EOSDIS).";

/**
 * Rank fires by great-circle distance to the camera and cap the list.
 * List-confidence, list-FRP, and list-age chips AND before the cap so
 * High / 100+ MW / <1 h can fill the 50 rows from farther detections.
 * A selected fire always stays.
 * @param {?Array<{lat?: number, lon?: number, confidence?: *, frp?: *, acqMs?: *}>} fires
 * @param {{lat?: number, lon?: number}|null} origin
 * @param {number} [limit=FIRMS_LIST_LIMIT]
 * @param {string} [listConf]
 * @param {string} [listFrp]
 * @param {string|null} [selectedId]
 * @param {string} [listAge]
 * @param {number} [now]
 * @returns {Array<object>}
 */
export function listNearestFires(
  fires,
  origin,
  limit = FIRMS_LIST_LIMIT,
  listConf,
  listFrp,
  selectedId,
  listAge,
  now = Date.now(),
) {
  if (!Array.isArray(fires)) return [];
  const originLat = Number(origin?.lat);
  const originLon = Number(origin?.lon);
  const hasOrigin = Number.isFinite(originLat) && Number.isFinite(originLon);
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : FIRMS_LIST_LIMIT;
  const conf = listConf === undefined ? getFirmsListConf() : listConf;
  const frp = listFrp === undefined ? getFirmsListFrp() : listFrp;
  const age = listAge === undefined ? getFirmsListAge() : listAge;
  const selected = selectedId === undefined ? getFirmsListSelectedId() : selectedId;
  const selectedKey = selected == null || selected === '' ? '' : String(selected);
  const ranked = [];
  for (const fire of fires) {
    const lat = Number(fire?.lat);
    const lon = Number(fire?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const id = fire?.id || fireDetectionKey(fire);
    const isSelected = Boolean(selectedKey) && String(id) === selectedKey;
    if (!isSelected && !fireMeetsListConf(fire, conf)) continue;
    if (!isSelected && !fireMeetsListFrp(fire, frp, { selectedId: selectedKey })) continue;
    if (!isSelected && !fireMeetsListAge(fire, age, { selectedId: selectedKey, now })) continue;
    const distanceKm = hasOrigin ? greatCircleKm(originLat, originLon, lat, lon) : Number.POSITIVE_INFINITY;
    ranked.push({
      ...fire,
      id,
      lat,
      lon,
      distanceKm,
    });
  }
  ranked.sort((a, b) => a.distanceKm - b.distanceKm || b.frp - a.frp);
  const capped = ranked.slice(0, cap);
  if (!selectedKey) return capped;
  if (capped.some((row) => String(row.id) === selectedKey)) return capped;
  const kept = ranked.find((row) => String(row.id) === selectedKey);
  if (!kept) return capped;
  return [kept, ...capped].slice(0, Math.max(cap, 1));
}

/**
 * One list-row presentation from an adapted fire record.
 * @param {object} fire
 * @param {{lat?: number, lon?: number}|null} origin
 * @param {number} [now=Date.now()]
 * @returns {{id: string, title: string, detail: string, lat: number, lon: number, distanceKm: number}}
 */
export function formatFireListRow(fire, origin, now = Date.now()) {
  const lat = Number(fire?.lat);
  const lon = Number(fire?.lon);
  const originLat = Number(origin?.lat);
  const originLon = Number(origin?.lon);
  const distanceKm = Number.isFinite(fire?.distanceKm)
    ? fire.distanceKm
    : (Number.isFinite(originLat) && Number.isFinite(originLon) && Number.isFinite(lat) && Number.isFinite(lon)
      ? greatCircleKm(originLat, originLon, lat, lon)
      : Number.POSITIVE_INFINITY);
  const age = formatAge(Number(now) - Number(fire?.acqMs));
  const conf = confidenceBucket(fire?.confidence);
  const sat = satelliteShortName(fire?.satellite) || String(fire?.sensor || '').trim();
  const parts = [formatDistanceKm(distanceKm), conf, age, sat].filter(Boolean);
  return {
    id: fire?.id || fireDetectionKey(fire),
    lat,
    lon,
    distanceKm,
    title: `▲ ${formatFrp(fire?.frp)} MW`,
    detail: parts.join(' · '),
  };
}

/**
 * Panel view model: ready rows, loading, or unavailable copy.
 * @param {object} input
 * @returns {{status: 'ready'|'loading'|'unavailable', copy: string, rows: Array<object>, acknowledgement: string}}
 */
export function resolveFireListView({
  keyRequired = false,
  loading = false,
  enabled,
  fires = [],
  camera = null,
  now = Date.now(),
  listConf,
  listFrp,
  selectedId,
  listAge,
} = {}) {
  const acknowledgement = FIRMS_ACKNOWLEDGEMENT;
  if (keyRequired) {
    return { status: 'unavailable', copy: FIRMS_LIST_UNAVAILABLE_COPY, rows: [], acknowledgement };
  }
  if (enabled === false) {
    return { status: 'unavailable', copy: FIRMS_LIST_ENABLE_COPY, rows: [], acknowledgement };
  }
  if (loading && (!Array.isArray(fires) || fires.length === 0)) {
    return { status: 'loading', copy: FIRMS_LIST_LOADING_COPY, rows: [], acknowledgement };
  }
  const nearest = listNearestFires(
    fires,
    camera,
    FIRMS_LIST_LIMIT,
    listConf,
    listFrp,
    selectedId,
    listAge,
    now,
  );
  if (!nearest.length) {
    return { status: 'unavailable', copy: FIRMS_LIST_EMPTY_COPY, rows: [], acknowledgement };
  }
  return {
    status: 'ready',
    copy: `${nearest.length} nearest · trailing 24h`,
    rows: nearest.map((fire) => formatFireListRow(fire, camera, now)),
    acknowledgement,
  };
}

function formatFrp(frp) {
  const value = Number(frp);
  if (!Number.isFinite(value)) return '0';
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function formatAge(deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return '';
  const hours = deltaMs / 3600000;
  if (hours < 1) return '<1h';
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatDistanceKm(distanceKm) {
  if (!Number.isFinite(distanceKm)) return '';
  if (distanceKm < 1) return '<1 km';
  if (distanceKm < 10) return `${distanceKm.toFixed(1)} km`;
  return `${Math.round(distanceKm)} km`;
}

function confidenceBucket(confidence) {
  const value = Number(confidence);
  if (value >= FIRMS_LIST_CONF_HIGH_MIN) return 'high';
  if (value >= FIRMS_LIST_CONF_NOMINAL_MIN) return 'nominal';
  return 'low';
}
