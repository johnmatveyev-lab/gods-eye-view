/**
 * Client-only Hide no day/night toggle for already-fetched NASA FIRMS
 * detections. Off is the current overlay (D + N + missing). On keeps
 * detections whose daynight is D or N, or whose night flag is a boolean
 * (including a bare `night === false` fixture with no daynight key). Empty,
 * whitespace, X, and other daynight values hide. Empty daynight is a hide
 * when on.
 *
 * Distinct from Day | Night chips (those fail-open on unknown) and from
 * Plan 226 pixel-area. Not hide-ground. The selected detection always
 * stays. Re-applied on the already-fetched `/api/firms` payload — no extra
 * NASA fetch and no new `/api`.
 *
 * Persistence is local only (`meridian.firmsHideNoDaynight`, `1` / `0`).
 * LayerStateCoordinator restore re-reads the key. No share-URL write.
 */

import { classifyFirmsDayNight } from './firmsDayNightFilter.js';

export const FIRMS_HIDE_NO_DAYNIGHT_CHIP_ID = 'hide-no-daynight';
export const FIRMS_HIDE_NO_DAYNIGHT_CHIP_LABEL = 'Hide no day/night';
export const FIRMS_HIDE_NO_DAYNIGHT_CHIP_TITLE =
  'Hide detections that have no Day or Night flag';

export const FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY = 'meridian.firmsHideNoDaynight';

export const DEFAULT_FIRMS_HIDE_NO_DAYNIGHT = false;

function resolveStore(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Normalize an untrusted stored or UI value. Only an explicit on is on;
 * missing or corrupt values keep the product default OFF.
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeFirmsHideNoDaynight(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return DEFAULT_FIRMS_HIDE_NO_DAYNIGHT;
}

/**
 * Whether one detection already carries a Day or Night label. D / N and a
 * boolean night flag count. Empty, whitespace, X, and other values do not.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasLabeledDayNight(fire) {
  const kind = classifyFirmsDayNight(fire);
  switch (kind) {
    case 'day':
    case 'night':
      return true;
    case 'unknown':
      return false;
    default: {
      const _exhaustive = /** @type {never} */ (kind);
      void _exhaustive;
      return false;
    }
  }
}

function fireRecordId(fire) {
  if (fire?.id != null && fire.id !== '') return String(fire.id);
  if (fire?.index != null && fire.index !== '') return String(fire.index);
  return '';
}

function keepSelectedFire(fire, selectedId) {
  if (selectedId == null || selectedId === '') return false;
  const id = fireRecordId(fire);
  return Boolean(id) && id === String(selectedId);
}

function selectedIdFrom(options) {
  if (options == null || options === '') return null;
  if (typeof options === 'object' && !Array.isArray(options)) {
    return options.selectedId ?? null;
  }
  return options;
}

/**
 * Whether Hide no day/night allows this detection to draw. Off is a
 * pass-through. On requires a D / N label (or boolean night). The selected
 * id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hide
 * @param {{selectedId?: string|null}|string|null} [options]
 * @returns {boolean}
 */
export function fireMeetsHideNoDaynight(fire, hide, options) {
  if (keepSelectedFire(fire, selectedIdFrom(options))) return true;
  if (normalizeFirmsHideNoDaynight(hide) !== true) return true;
  return fireHasLabeledDayNight(fire);
}

/**
 * Keep detections that pass Hide no day/night. Off returns a shallow copy
 * when no selected id is forced in. The selected id always stays.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hide=DEFAULT_FIRMS_HIDE_NO_DAYNIGHT]
 * @param {{selectedId?: string|null}|string|null} [selectedId]
 * @returns {Array<Object>}
 */
export function filterFiresByHideNoDaynight(
  fires,
  hide = DEFAULT_FIRMS_HIDE_NO_DAYNIGHT,
  selectedId,
) {
  if (!Array.isArray(fires)) return [];
  const keepId = selectedIdFrom(selectedId);
  if (normalizeFirmsHideNoDaynight(hide) !== true && (keepId == null || keepId === '')) {
    return fires.slice();
  }
  return fires.filter((fire) => fireMeetsHideNoDaynight(fire, hide, keepId));
}

/**
 * Toggle-chip model for the FIRMS data-layer row. Clicking writes the
 * opposite boolean via setParams.
 * @param {unknown} [active=DEFAULT_FIRMS_HIDE_NO_DAYNIGHT]
 * @returns {object}
 */
export function firmsHideNoDaynightChipModel(active = DEFAULT_FIRMS_HIDE_NO_DAYNIGHT) {
  const on = active === true;
  return {
    id: FIRMS_HIDE_NO_DAYNIGHT_CHIP_ID,
    label: FIRMS_HIDE_NO_DAYNIGHT_CHIP_LABEL,
    title: FIRMS_HIDE_NO_DAYNIGHT_CHIP_TITLE,
    active: on,
    params: { hideNoDaynight: !on },
  };
}

/**
 * Read the durable Hide no day/night preference. Storage failures fail
 * closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsHideNoDaynight(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_HIDE_NO_DAYNIGHT;
    return normalizeFirmsHideNoDaynight(raw);
  } catch {
    return DEFAULT_FIRMS_HIDE_NO_DAYNIGHT;
  }
}

/**
 * Persist the Hide no day/night preference as `1` / `0`. Best-effort;
 * never throws.
 * @param {unknown} hide
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsHideNoDaynight(hide, storage) {
  const normalized = normalizeFirmsHideNoDaynight(hide);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_HIDE_NO_DAYNIGHT_STORAGE_KEY, normalized ? '1' : '0');
    }
  } catch {
    // Fail open: the session can still apply the chosen toggle.
  }
  return normalized;
}
