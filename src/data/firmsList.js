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
import {
  fireMeetsListHideNoSat,
  firmsListHideNoSatChipModel,
  getFirmsListHideNoSat,
  hydrateFirmsListHideNoSat,
  setFirmsListHideNoSat,
  subscribeFirmsListHideNoSat,
} from './firmsListSatFilter.js';
import {
  fireMeetsListHideNoSensor,
  firmsListHideNoSensorChipModel,
  getFirmsListHideNoSensor,
  hydrateFirmsListHideNoSensor,
  setFirmsListHideNoSensor,
  subscribeFirmsListHideNoSensor,
} from './firmsListHideNoSensorFilter.js';
import {
  fireMeetsListHideNoVersion,
  firmsListHideNoVersionChipModel,
  getFirmsListHideNoVersion,
  hydrateFirmsListHideNoVersion,
  setFirmsListHideNoVersion,
  subscribeFirmsListHideNoVersion,
} from './firmsListHideNoVersionFilter.js';
import {
  fireMeetsListHideNoDaynight,
  firmsListHideNoDaynightChipModel,
  getFirmsListHideNoDaynight,
  hydrateFirmsListHideNoDaynight,
  setFirmsListHideNoDaynight,
  subscribeFirmsListHideNoDaynight,
} from './firmsListHideNoDaynightFilter.js';
import {
  fireMeetsListHideNoAcq,
  firmsListHideNoAcqChipModel,
  getFirmsListHideNoAcq,
  hydrateFirmsListHideNoAcq,
  setFirmsListHideNoAcq,
  subscribeFirmsListHideNoAcq,
} from './firmsListHideNoAcqFilter.js';
import {
  fireMeetsListHideNoScan,
  firmsListHideNoScanChipModel,
  getFirmsListHideNoScan,
  hydrateFirmsListHideNoScan,
  setFirmsListHideNoScan,
  subscribeFirmsListHideNoScan,
} from './firmsListHideNoScanFilter.js';
import {
  fireMeetsListHideNoTrack,
  firmsListHideNoTrackChipModel,
  getFirmsListHideNoTrack,
  hydrateFirmsListHideNoTrack,
  setFirmsListHideNoTrack,
  subscribeFirmsListHideNoTrack,
} from './firmsListHideNoTrackFilter.js';

export {
  firmsListHideNoSatChipModel,
  hydrateFirmsListHideNoSat,
  firmsListHideNoSensorChipModel,
  hydrateFirmsListHideNoSensor,
  firmsListHideNoVersionChipModel,
  getFirmsListHideNoVersion,
  hydrateFirmsListHideNoVersion,
  setFirmsListHideNoVersion,
  firmsListHideNoDaynightChipModel,
  getFirmsListHideNoDaynight,
  hydrateFirmsListHideNoDaynight,
  setFirmsListHideNoDaynight,
  firmsListHideNoAcqChipModel,
  getFirmsListHideNoAcq,
  hydrateFirmsListHideNoAcq,
  setFirmsListHideNoAcq,
  firmsListHideNoScanChipModel,
  getFirmsListHideNoScan,
  hydrateFirmsListHideNoScan,
  setFirmsListHideNoScan,
  firmsListHideNoTrackChipModel,
  getFirmsListHideNoTrack,
  hydrateFirmsListHideNoTrack,
  setFirmsListHideNoTrack,
};

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
 * List-confidence, list-FRP, list-age, Hide no satellite, Hide no
 * sensor, list version-presence, list daynight-presence, list
 * acq-presence, list scan-presence, and list track-presence AND before
 * the cap so High / 100+ MW / <1 h / labeled detections can fill the
 * 50 rows from farther detections. A selected fire always stays.
 * @param {?Array<{lat?: number, lon?: number, confidence?: *, frp?: *, acqMs?: *, satellite?: *, sensor?: *, version?: *, daynight?: *, scanKm?: *, trackKm?: *}>} fires
 * @param {{lat?: number, lon?: number}|null} origin
 * @param {number} [limit=FIRMS_LIST_LIMIT]
 * @param {string} [listConf]
 * @param {string} [listFrp]
 * @param {string|null} [selectedId]
 * @param {string} [listAge]
 * @param {number} [now]
 * @param {boolean} [hideNoSat]
 * @param {boolean} [hideNoSensor]
 * @param {boolean} [listHideNoVersion]
 * @param {boolean} [listHideNoDaynight]
 * @param {boolean} [listHideNoAcq]
 * @param {boolean} [listHideNoScan]
 * @param {boolean} [listHideNoTrack]
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
  hideNoSat,
  hideNoSensor,
  listHideNoVersion,
  listHideNoDaynight,
  listHideNoAcq,
  listHideNoScan,
  listHideNoTrack,
) {
  if (!Array.isArray(fires)) return [];
  const originLat = Number(origin?.lat);
  const originLon = Number(origin?.lon);
  const hasOrigin = Number.isFinite(originLat) && Number.isFinite(originLon);
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : FIRMS_LIST_LIMIT;
  const conf = listConf === undefined ? getFirmsListConf() : listConf;
  const frp = listFrp === undefined ? getFirmsListFrp() : listFrp;
  const age = listAge === undefined ? getFirmsListAge() : listAge;
  const hideSat = hideNoSat === undefined ? getFirmsListHideNoSat() : hideNoSat;
  const hideSensor = hideNoSensor === undefined ? getFirmsListHideNoSensor() : hideNoSensor;
  const hideVersion = listHideNoVersion === undefined ? getFirmsListHideNoVersion() : listHideNoVersion;
  const hideDaynight = listHideNoDaynight === undefined ? getFirmsListHideNoDaynight() : listHideNoDaynight;
  const hideAcq = listHideNoAcq === undefined ? getFirmsListHideNoAcq() : listHideNoAcq;
  const hideScan = listHideNoScan === undefined ? getFirmsListHideNoScan() : listHideNoScan;
  const hideTrack = listHideNoTrack === undefined ? getFirmsListHideNoTrack() : listHideNoTrack;
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
    if (!isSelected && !fireMeetsListHideNoSat(fire, hideSat, { selectedId: selectedKey })) continue;
    if (!isSelected && !fireMeetsListHideNoSensor(fire, hideSensor, { selectedId: selectedKey })) continue;
    if (!isSelected && !fireMeetsListHideNoVersion(fire, hideVersion, { selectedId: selectedKey })) continue;
    if (!isSelected && !fireMeetsListHideNoDaynight(fire, hideDaynight, { selectedId: selectedKey })) continue;
    if (!isSelected && !fireMeetsListHideNoAcq(fire, hideAcq, { selectedId: selectedKey })) continue;
    if (!isSelected && !fireMeetsListHideNoScan(fire, hideScan, { selectedId: selectedKey })) continue;
    if (!isSelected && !fireMeetsListHideNoTrack(fire, hideTrack, { selectedId: selectedKey })) continue;
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
  hideNoSat,
  hideNoSensor,
  listHideNoVersion,
  listHideNoDaynight,
  listHideNoAcq,
  listHideNoScan,
  listHideNoTrack,
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
    hideNoSat,
    hideNoSensor,
    listHideNoVersion,
    listHideNoDaynight,
    listHideNoAcq,
    listHideNoScan,
    listHideNoTrack,
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

/**
 * Hosted FIRES list chips. Confidence / FRP / age stay in the HTML row
 * from Plans 210 / 219 / 225; Hide no satellite, Hide no sensor, list
 * version-presence, list daynight-presence, list acq-presence, list
 * scan-presence, and list track-presence are owned here so index.html /
 * ui.js do not re-declare them.
 * @returns {{hideNoSat: object, hideNoSensor: object, listHideNoVersion: object, listHideNoDaynight: object, listHideNoAcq: object, listHideNoScan: object, listHideNoTrack: object}}
 */
export function getRowControls() {
  return {
    hideNoSat: firmsListHideNoSatChipModel(getFirmsListHideNoSat()),
    hideNoSensor: firmsListHideNoSensorChipModel(getFirmsListHideNoSensor()),
    listHideNoVersion: firmsListHideNoVersionChipModel(getFirmsListHideNoVersion()),
    listHideNoDaynight: firmsListHideNoDaynightChipModel(getFirmsListHideNoDaynight()),
    listHideNoAcq: firmsListHideNoAcqChipModel(getFirmsListHideNoAcq()),
    listHideNoScan: firmsListHideNoScanChipModel(getFirmsListHideNoScan()),
    listHideNoTrack: firmsListHideNoTrackChipModel(getFirmsListHideNoTrack()),
  };
}

function createHideNoSatChipElement(model, make) {
  const button = make('button');
  button.type = 'button';
  button.className = `fires-sensor-chip${model.active ? ' active' : ''}`;
  button.dataset.firmsListHideNoSat = model.active ? '1' : '0';
  button.textContent = model.label;
  if (model.title) button.title = model.title;
  button.setAttribute?.('aria-pressed', model.active ? 'true' : 'false');
  return button;
}

function syncFirmsListHideNoSatChip(root) {
  if (!root?.querySelectorAll) return;
  const model = getRowControls().hideNoSat;
  const chips = root.querySelectorAll('[data-firms-list-hide-no-sat]');
  for (const chip of chips) {
    chip.classList?.toggle?.('active', model.active === true);
    chip.dataset.firmsListHideNoSat = model.active ? '1' : '0';
    chip.setAttribute?.('aria-pressed', model.active ? 'true' : 'false');
  }
}

/**
 * Inject Hide no satellite next to the existing list chips.
 * No-ops on the stub panels used by unit tests (no querySelector).
 * @param {{querySelector?: Function, appendChild?: Function}|null} panel
 * @returns {() => void}
 */
function mountFirmsListHideNoSatChip(panel) {
  if (typeof panel?.querySelector !== 'function') return () => {};
  let root = panel.querySelector('#fires-list-sat-chips');
  const make = globalThis.document?.createElement?.bind(globalThis.document);
  if (!root && typeof make === 'function') {
    root = make('div');
    root.id = 'fires-list-sat-chips';
    root.className = 'fires-sensor-chips';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Hide listed detections with no satellite');
    const after = panel.querySelector('#fires-list-age-chips');
    if (typeof after?.insertAdjacentElement === 'function') {
      after.insertAdjacentElement('afterend', root);
    } else {
      const header = panel.querySelector('.fires-panel-inner') || panel;
      header.appendChild?.(root);
    }
  }
  if (!root) return () => {};
  if (typeof make === 'function' && !root.querySelector?.('[data-firms-list-hide-no-sat]')) {
    const node = createHideNoSatChipElement(getRowControls().hideNoSat, make);
    if (typeof root.replaceChildren === 'function') root.replaceChildren(node);
    else root.appendChild?.(node);
  }
  const onClick = (event) => {
    const chip = event.target?.closest?.('[data-firms-list-hide-no-sat]');
    if (!chip || (typeof root.contains === 'function' && !root.contains(chip))) return;
    setFirmsListHideNoSat(getRowControls().hideNoSat.params.firmsListHideNoSat);
    syncFirmsListHideNoSatChip(root);
  };
  root.addEventListener?.('click', onClick);
  syncFirmsListHideNoSatChip(root);
  return () => {
    root.removeEventListener?.('click', onClick);
  };
}

/**
 * Hydrate, mount, and subscribe Hide no satellite on the FIRES panel.
 * @param {{querySelector?: Function}|null} panel
 * @param {() => void} [onChange]
 * @returns {() => void}
 */
export function attachFirmsListHideNoSat(panel, onChange) {
  hydrateFirmsListHideNoSat();
  const unmount = mountFirmsListHideNoSatChip(panel);
  const unsubscribe = subscribeFirmsListHideNoSat(() => {
    syncFirmsListHideNoSatChip(panel?.querySelector?.('#fires-list-sat-chips') || panel);
    if (typeof onChange === 'function') onChange();
  });
  const detachSensor = attachFirmsListHideNoSensor(panel, onChange);
  return () => {
    detachSensor();
    unsubscribe();
    unmount();
  };
}

function createHideNoSensorChipElement(model, make) {
  const button = make('button');
  button.type = 'button';
  button.className = `fires-sensor-chip${model.active ? ' active' : ''}`;
  button.dataset.firmsListHideNoSensor = model.active ? '1' : '0';
  button.textContent = model.label;
  if (model.title) button.title = model.title;
  button.setAttribute?.('aria-pressed', model.active ? 'true' : 'false');
  return button;
}

function syncFirmsListHideNoSensorChip(root) {
  if (!root?.querySelectorAll) return;
  const model = getRowControls().hideNoSensor;
  const chips = root.querySelectorAll('[data-firms-list-hide-no-sensor]');
  for (const chip of chips) {
    chip.classList?.toggle?.('active', model.active === true);
    chip.dataset.firmsListHideNoSensor = model.active ? '1' : '0';
    chip.setAttribute?.('aria-pressed', model.active ? 'true' : 'false');
  }
}

/**
 * Inject Hide no sensor next to the existing list chips.
 * No-ops on the stub panels used by unit tests (no querySelector).
 * @param {{querySelector?: Function, appendChild?: Function}|null} panel
 * @returns {() => void}
 */
function mountFirmsListHideNoSensorChip(panel) {
  if (typeof panel?.querySelector !== 'function') return () => {};
  let root = panel.querySelector('#fires-list-sat-chips')
    || panel.querySelector('#fires-list-sensor-chips');
  const make = globalThis.document?.createElement?.bind(globalThis.document);
  if (!root && typeof make === 'function') {
    root = make('div');
    root.id = 'fires-list-sensor-chips';
    root.className = 'fires-sensor-chips';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Hide listed detections with no sensor');
    const after = panel.querySelector('#fires-list-age-chips');
    if (typeof after?.insertAdjacentElement === 'function') {
      after.insertAdjacentElement('afterend', root);
    } else {
      const header = panel.querySelector('.fires-panel-inner') || panel;
      header.appendChild?.(root);
    }
  }
  if (!root) return () => {};
  if (typeof make === 'function' && !root.querySelector?.('[data-firms-list-hide-no-sensor]')) {
    const node = createHideNoSensorChipElement(getRowControls().hideNoSensor, make);
    root.appendChild?.(node);
  }
  const onClick = (event) => {
    const chip = event.target?.closest?.('[data-firms-list-hide-no-sensor]');
    if (!chip || (typeof root.contains === 'function' && !root.contains(chip))) return;
    setFirmsListHideNoSensor(getRowControls().hideNoSensor.params.firmsListHideNoSensor);
    syncFirmsListHideNoSensorChip(root);
  };
  root.addEventListener?.('click', onClick);
  syncFirmsListHideNoSensorChip(root);
  return () => {
    root.removeEventListener?.('click', onClick);
  };
}

/**
 * Hydrate, mount, and subscribe Hide no sensor on the FIRES panel.
 * @param {{querySelector?: Function}|null} panel
 * @param {() => void} [onChange]
 * @returns {() => void}
 */
export function attachFirmsListHideNoSensor(panel, onChange) {
  hydrateFirmsListHideNoSensor();
  const unmount = mountFirmsListHideNoSensorChip(panel);
  const unsubscribe = subscribeFirmsListHideNoSensor(() => {
    syncFirmsListHideNoSensorChip(
      panel?.querySelector?.('#fires-list-sensor-chips')
      || panel?.querySelector?.('#fires-list-sat-chips')
      || panel,
    );
    if (typeof onChange === 'function') onChange();
  });
  const detachVersion = attachFirmsListHideNoVersion(panel, onChange);
  return () => {
    detachVersion();
    unsubscribe();
    unmount();
  };
}

function createHideNoVersionChipElement(model, make) {
  const button = make('button');
  button.type = 'button';
  button.className = `fires-sensor-chip${model.active ? ' active' : ''}`;
  button.dataset.firmsListHideNoVersion = model.active ? '1' : '0';
  button.textContent = model.label;
  if (model.title) button.title = model.title;
  button.setAttribute?.('aria-pressed', model.active ? 'true' : 'false');
  return button;
}

function syncFirmsListHideNoVersionChip(root) {
  if (!root?.querySelectorAll) return;
  const model = getRowControls().listHideNoVersion;
  const chips = root.querySelectorAll('[data-firms-list-hide-no-version]');
  for (const chip of chips) {
    chip.classList?.toggle?.('active', model.active === true);
    chip.dataset.firmsListHideNoVersion = model.active ? '1' : '0';
    chip.setAttribute?.('aria-pressed', model.active ? 'true' : 'false');
  }
}

/**
 * Inject list version-presence next to the existing list chips.
 * No-ops on the stub panels used by unit tests (no querySelector).
 * @param {{querySelector?: Function, appendChild?: Function}|null} panel
 * @returns {() => void}
 */
function mountFirmsListHideNoVersionChip(panel) {
  if (typeof panel?.querySelector !== 'function') return () => {};
  let root = panel.querySelector('#fires-list-sat-chips')
    || panel.querySelector('#fires-list-sensor-chips')
    || panel.querySelector('#fires-list-version-chips');
  const make = globalThis.document?.createElement?.bind(globalThis.document);
  if (!root && typeof make === 'function') {
    root = make('div');
    root.id = 'fires-list-version-chips';
    root.className = 'fires-sensor-chips';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Hide listed detections with no product version');
    const after = panel.querySelector('#fires-list-age-chips');
    if (typeof after?.insertAdjacentElement === 'function') {
      after.insertAdjacentElement('afterend', root);
    } else {
      const header = panel.querySelector('.fires-panel-inner') || panel;
      header.appendChild?.(root);
    }
  }
  if (!root) return () => {};
  if (typeof make === 'function' && !root.querySelector?.('[data-firms-list-hide-no-version]')) {
    const node = createHideNoVersionChipElement(getRowControls().listHideNoVersion, make);
    root.appendChild?.(node);
  }
  const onClick = (event) => {
    const chip = event.target?.closest?.('[data-firms-list-hide-no-version]');
    if (!chip || (typeof root.contains === 'function' && !root.contains(chip))) return;
    setFirmsListHideNoVersion(getRowControls().listHideNoVersion.params.firmsListHideNoVersion);
    syncFirmsListHideNoVersionChip(root);
  };
  root.addEventListener?.('click', onClick);
  syncFirmsListHideNoVersionChip(root);
  return () => {
    root.removeEventListener?.('click', onClick);
  };
}

/**
 * Hydrate, mount, and subscribe list version-presence on the FIRES panel.
 * @param {{querySelector?: Function}|null} panel
 * @param {() => void} [onChange]
 * @returns {() => void}
 */
export function attachFirmsListHideNoVersion(panel, onChange) {
  hydrateFirmsListHideNoVersion();
  const unmount = mountFirmsListHideNoVersionChip(panel);
  const unsubscribe = subscribeFirmsListHideNoVersion(() => {
    syncFirmsListHideNoVersionChip(
      panel?.querySelector?.('#fires-list-version-chips')
      || panel?.querySelector?.('#fires-list-sensor-chips')
      || panel?.querySelector?.('#fires-list-sat-chips')
      || panel,
    );
    if (typeof onChange === 'function') onChange();
  });
  const detachDaynight = attachFirmsListHideNoDaynight(panel, onChange);
  return () => {
    detachDaynight();
    unsubscribe();
    unmount();
  };
}

function createHideNoDaynightChipElement(model, make) {
  const button = make('button');
  button.type = 'button';
  button.className = `fires-sensor-chip${model.active ? ' active' : ''}`;
  button.dataset.firmsListHideNoDaynight = model.active ? '1' : '0';
  button.textContent = model.label;
  if (model.title) button.title = model.title;
  button.setAttribute?.('aria-pressed', model.active ? 'true' : 'false');
  return button;
}

function syncFirmsListHideNoDaynightChip(root) {
  if (!root?.querySelectorAll) return;
  const model = getRowControls().listHideNoDaynight;
  const chips = root.querySelectorAll('[data-firms-list-hide-no-daynight]');
  for (const chip of chips) {
    chip.classList?.toggle?.('active', model.active === true);
    chip.dataset.firmsListHideNoDaynight = model.active ? '1' : '0';
    chip.setAttribute?.('aria-pressed', model.active ? 'true' : 'false');
  }
}

/**
 * Inject list daynight-presence next to the existing list chips.
 * No-ops on the stub panels used by unit tests (no querySelector).
 * @param {{querySelector?: Function, appendChild?: Function}|null} panel
 * @returns {() => void}
 */
function mountFirmsListHideNoDaynightChip(panel) {
  if (typeof panel?.querySelector !== 'function') return () => {};
  let root = panel.querySelector('#fires-list-sat-chips')
    || panel.querySelector('#fires-list-sensor-chips')
    || panel.querySelector('#fires-list-version-chips')
    || panel.querySelector('#fires-list-daynight-chips');
  const make = globalThis.document?.createElement?.bind(globalThis.document);
  if (!root && typeof make === 'function') {
    root = make('div');
    root.id = 'fires-list-daynight-chips';
    root.className = 'fires-sensor-chips';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Hide listed detections with no daynight flag');
    const after = panel.querySelector('#fires-list-age-chips');
    if (typeof after?.insertAdjacentElement === 'function') {
      after.insertAdjacentElement('afterend', root);
    } else {
      const header = panel.querySelector('.fires-panel-inner') || panel;
      header.appendChild?.(root);
    }
  }
  if (!root) return () => {};
  if (typeof make === 'function' && !root.querySelector?.('[data-firms-list-hide-no-daynight]')) {
    const node = createHideNoDaynightChipElement(getRowControls().listHideNoDaynight, make);
    root.appendChild?.(node);
  }
  const onClick = (event) => {
    const chip = event.target?.closest?.('[data-firms-list-hide-no-daynight]');
    if (!chip || (typeof root.contains === 'function' && !root.contains(chip))) return;
    setFirmsListHideNoDaynight(getRowControls().listHideNoDaynight.params.firmsListHideNoDaynight);
    syncFirmsListHideNoDaynightChip(root);
  };
  root.addEventListener?.('click', onClick);
  syncFirmsListHideNoDaynightChip(root);
  return () => {
    root.removeEventListener?.('click', onClick);
  };
}

/**
 * Hydrate, mount, and subscribe list daynight-presence on the FIRES panel.
 * @param {{querySelector?: Function}|null} panel
 * @param {() => void} [onChange]
 * @returns {() => void}
 */
export function attachFirmsListHideNoDaynight(panel, onChange) {
  hydrateFirmsListHideNoDaynight();
  const unmount = mountFirmsListHideNoDaynightChip(panel);
  const unsubscribe = subscribeFirmsListHideNoDaynight(() => {
    syncFirmsListHideNoDaynightChip(
      panel?.querySelector?.('#fires-list-daynight-chips')
      || panel?.querySelector?.('#fires-list-version-chips')
      || panel?.querySelector?.('#fires-list-sensor-chips')
      || panel?.querySelector?.('#fires-list-sat-chips')
      || panel,
    );
    if (typeof onChange === 'function') onChange();
  });
  const detachAcq = attachFirmsListHideNoAcq(panel, onChange);
  return () => {
    detachAcq();
    unsubscribe();
    unmount();
  };
}

function createHideNoAcqChipElement(model, make) {
  const button = make('button');
  button.type = 'button';
  button.className = `fires-sensor-chip${model.active ? ' active' : ''}`;
  button.dataset.firmsListHideNoAcq = model.active ? '1' : '0';
  button.textContent = model.label;
  if (model.title) button.title = model.title;
  button.setAttribute?.('aria-pressed', model.active ? 'true' : 'false');
  return button;
}

function syncFirmsListHideNoAcqChip(root) {
  if (!root?.querySelectorAll) return;
  const model = getRowControls().listHideNoAcq;
  const chips = root.querySelectorAll('[data-firms-list-hide-no-acq]');
  for (const chip of chips) {
    chip.classList?.toggle?.('active', model.active === true);
    chip.dataset.firmsListHideNoAcq = model.active ? '1' : '0';
    chip.setAttribute?.('aria-pressed', model.active ? 'true' : 'false');
  }
}

/**
 * Inject list acq-presence next to Hide no day/night.
 * No-ops on the stub panels used by unit tests (no querySelector).
 * @param {{querySelector?: Function, appendChild?: Function}|null} panel
 * @returns {() => void}
 */
function mountFirmsListHideNoAcqChip(panel) {
  if (typeof panel?.querySelector !== 'function') return () => {};
  let root = panel.querySelector('#fires-list-sat-chips')
    || panel.querySelector('#fires-list-sensor-chips')
    || panel.querySelector('#fires-list-version-chips')
    || panel.querySelector('#fires-list-daynight-chips')
    || panel.querySelector('#fires-list-acq-chips');
  const make = globalThis.document?.createElement?.bind(globalThis.document);
  if (!root && typeof make === 'function') {
    root = make('div');
    root.id = 'fires-list-acq-chips';
    root.className = 'fires-sensor-chips';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Hide listed detections with no acquisition time');
    const after = panel.querySelector('#fires-list-age-chips');
    if (typeof after?.insertAdjacentElement === 'function') {
      after.insertAdjacentElement('afterend', root);
    } else {
      const header = panel.querySelector('.fires-panel-inner') || panel;
      header.appendChild?.(root);
    }
  }
  if (!root) return () => {};
  if (typeof make === 'function' && !root.querySelector?.('[data-firms-list-hide-no-acq]')) {
    const node = createHideNoAcqChipElement(getRowControls().listHideNoAcq, make);
    root.appendChild?.(node);
  }
  const onClick = (event) => {
    const chip = event.target?.closest?.('[data-firms-list-hide-no-acq]');
    if (!chip || (typeof root.contains === 'function' && !root.contains(chip))) return;
    setFirmsListHideNoAcq(getRowControls().listHideNoAcq.params.firmsListHideNoAcq);
    syncFirmsListHideNoAcqChip(root);
  };
  root.addEventListener?.('click', onClick);
  syncFirmsListHideNoAcqChip(root);
  return () => {
    root.removeEventListener?.('click', onClick);
  };
}

/**
 * Hydrate, mount, and subscribe list acq-presence on the FIRES panel.
 * @param {{querySelector?: Function}|null} panel
 * @param {() => void} [onChange]
 * @returns {() => void}
 */
export function attachFirmsListHideNoAcq(panel, onChange) {
  hydrateFirmsListHideNoAcq();
  const unmount = mountFirmsListHideNoAcqChip(panel);
  const unsubscribe = subscribeFirmsListHideNoAcq(() => {
    syncFirmsListHideNoAcqChip(
      panel?.querySelector?.('#fires-list-acq-chips')
      || panel?.querySelector?.('#fires-list-daynight-chips')
      || panel?.querySelector?.('#fires-list-version-chips')
      || panel?.querySelector?.('#fires-list-sensor-chips')
      || panel?.querySelector?.('#fires-list-sat-chips')
      || panel,
    );
    if (typeof onChange === 'function') onChange();
  });
  const detachScan = attachFirmsListHideNoScan(panel, onChange);
  return () => {
    detachScan();
    unsubscribe();
    unmount();
  };
}

function createHideNoScanChipElement(model, make) {
  const button = make('button');
  button.type = 'button';
  button.className = `fires-sensor-chip${model.active ? ' active' : ''}`;
  button.dataset.firmsListHideNoScan = model.active ? '1' : '0';
  button.textContent = model.label;
  if (model.title) button.title = model.title;
  button.setAttribute?.('aria-pressed', model.active ? 'true' : 'false');
  return button;
}

function syncFirmsListHideNoScanChip(root) {
  if (!root?.querySelectorAll) return;
  const model = getRowControls().listHideNoScan;
  const chips = root.querySelectorAll('[data-firms-list-hide-no-scan]');
  for (const chip of chips) {
    chip.classList?.toggle?.('active', model.active === true);
    chip.dataset.firmsListHideNoScan = model.active ? '1' : '0';
    chip.setAttribute?.('aria-pressed', model.active ? 'true' : 'false');
  }
}

/**
 * Inject list scan-presence next to Hide no acq.
 * No-ops on the stub panels used by unit tests (no querySelector).
 * @param {{querySelector?: Function, appendChild?: Function}|null} panel
 * @returns {() => void}
 */
function mountFirmsListHideNoScanChip(panel) {
  if (typeof panel?.querySelector !== 'function') return () => {};
  let root = panel.querySelector('#fires-list-sat-chips')
    || panel.querySelector('#fires-list-sensor-chips')
    || panel.querySelector('#fires-list-version-chips')
    || panel.querySelector('#fires-list-daynight-chips')
    || panel.querySelector('#fires-list-acq-chips')
    || panel.querySelector('#fires-list-scan-chips');
  const make = globalThis.document?.createElement?.bind(globalThis.document);
  if (!root && typeof make === 'function') {
    root = make('div');
    root.id = 'fires-list-scan-chips';
    root.className = 'fires-sensor-chips';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Hide listed detections with no scan size');
    const after = panel.querySelector('#fires-list-age-chips');
    if (typeof after?.insertAdjacentElement === 'function') {
      after.insertAdjacentElement('afterend', root);
    } else {
      const header = panel.querySelector('.fires-panel-inner') || panel;
      header.appendChild?.(root);
    }
  }
  if (!root) return () => {};
  if (typeof make === 'function' && !root.querySelector?.('[data-firms-list-hide-no-scan]')) {
    const node = createHideNoScanChipElement(getRowControls().listHideNoScan, make);
    root.appendChild?.(node);
  }
  const onClick = (event) => {
    const chip = event.target?.closest?.('[data-firms-list-hide-no-scan]');
    if (!chip || (typeof root.contains === 'function' && !root.contains(chip))) return;
    setFirmsListHideNoScan(getRowControls().listHideNoScan.params.firmsListHideNoScan);
    syncFirmsListHideNoScanChip(root);
  };
  root.addEventListener?.('click', onClick);
  syncFirmsListHideNoScanChip(root);
  return () => {
    root.removeEventListener?.('click', onClick);
  };
}

/**
 * Hydrate, mount, and subscribe list scan-presence on the FIRES panel.
 * @param {{querySelector?: Function}|null} panel
 * @param {() => void} [onChange]
 * @returns {() => void}
 */
export function attachFirmsListHideNoScan(panel, onChange) {
  hydrateFirmsListHideNoScan();
  const unmount = mountFirmsListHideNoScanChip(panel);
  const unsubscribe = subscribeFirmsListHideNoScan(() => {
    syncFirmsListHideNoScanChip(
      panel?.querySelector?.('#fires-list-scan-chips')
      || panel?.querySelector?.('#fires-list-acq-chips')
      || panel?.querySelector?.('#fires-list-daynight-chips')
      || panel?.querySelector?.('#fires-list-version-chips')
      || panel?.querySelector?.('#fires-list-sensor-chips')
      || panel?.querySelector?.('#fires-list-sat-chips')
      || panel,
    );
    if (typeof onChange === 'function') onChange();
  });
  const detachTrack = attachFirmsListHideNoTrack(panel, onChange);
  return () => {
    detachTrack();
    unsubscribe();
    unmount();
  };
}

function createHideNoTrackChipElement(model, make) {
  const button = make('button');
  button.type = 'button';
  button.className = `fires-sensor-chip${model.active ? ' active' : ''}`;
  button.dataset.firmsListHideNoTrack = model.active ? '1' : '0';
  button.textContent = model.label;
  if (model.title) button.title = model.title;
  button.setAttribute?.('aria-pressed', model.active ? 'true' : 'false');
  return button;
}

function syncFirmsListHideNoTrackChip(root) {
  if (!root?.querySelectorAll) return;
  const model = getRowControls().listHideNoTrack;
  const chips = root.querySelectorAll('[data-firms-list-hide-no-track]');
  for (const chip of chips) {
    chip.classList?.toggle?.('active', model.active === true);
    chip.dataset.firmsListHideNoTrack = model.active ? '1' : '0';
    chip.setAttribute?.('aria-pressed', model.active ? 'true' : 'false');
  }
}

/**
 * Inject list track-presence next to Hide no scan.
 * No-ops on the stub panels used by unit tests (no querySelector).
 * @param {{querySelector?: Function, appendChild?: Function}|null} panel
 * @returns {() => void}
 */
function mountFirmsListHideNoTrackChip(panel) {
  if (typeof panel?.querySelector !== 'function') return () => {};
  let root = panel.querySelector('#fires-list-sat-chips')
    || panel.querySelector('#fires-list-sensor-chips')
    || panel.querySelector('#fires-list-version-chips')
    || panel.querySelector('#fires-list-daynight-chips')
    || panel.querySelector('#fires-list-acq-chips')
    || panel.querySelector('#fires-list-scan-chips')
    || panel.querySelector('#fires-list-track-chips');
  const make = globalThis.document?.createElement?.bind(globalThis.document);
  if (!root && typeof make === 'function') {
    root = make('div');
    root.id = 'fires-list-track-chips';
    root.className = 'fires-sensor-chips';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Hide listed detections with no track size');
    const after = panel.querySelector('#fires-list-age-chips');
    if (typeof after?.insertAdjacentElement === 'function') {
      after.insertAdjacentElement('afterend', root);
    } else {
      const header = panel.querySelector('.fires-panel-inner') || panel;
      header.appendChild?.(root);
    }
  }
  if (!root) return () => {};
  if (typeof make === 'function' && !root.querySelector?.('[data-firms-list-hide-no-track]')) {
    const node = createHideNoTrackChipElement(getRowControls().listHideNoTrack, make);
    root.appendChild?.(node);
  }
  const onClick = (event) => {
    const chip = event.target?.closest?.('[data-firms-list-hide-no-track]');
    if (!chip || (typeof root.contains === 'function' && !root.contains(chip))) return;
    setFirmsListHideNoTrack(getRowControls().listHideNoTrack.params.firmsListHideNoTrack);
    syncFirmsListHideNoTrackChip(root);
  };
  root.addEventListener?.('click', onClick);
  syncFirmsListHideNoTrackChip(root);
  return () => {
    root.removeEventListener?.('click', onClick);
  };
}

/**
 * Hydrate, mount, and subscribe list track-presence on the FIRES panel.
 * @param {{querySelector?: Function}|null} panel
 * @param {() => void} [onChange]
 * @returns {() => void}
 */
export function attachFirmsListHideNoTrack(panel, onChange) {
  hydrateFirmsListHideNoTrack();
  const unmount = mountFirmsListHideNoTrackChip(panel);
  const unsubscribe = subscribeFirmsListHideNoTrack(() => {
    syncFirmsListHideNoTrackChip(
      panel?.querySelector?.('#fires-list-track-chips')
      || panel?.querySelector?.('#fires-list-scan-chips')
      || panel?.querySelector?.('#fires-list-acq-chips')
      || panel?.querySelector?.('#fires-list-daynight-chips')
      || panel?.querySelector?.('#fires-list-version-chips')
      || panel?.querySelector?.('#fires-list-sensor-chips')
      || panel?.querySelector?.('#fires-list-sat-chips')
      || panel,
    );
    if (typeof onChange === 'function') onChange();
  });
  return () => {
    unsubscribe();
    unmount();
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
