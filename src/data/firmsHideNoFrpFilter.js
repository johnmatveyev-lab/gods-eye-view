/**
 * Client-only Hide no FRP toggle for already-fetched NASA FIRMS
 * detections. Off is the current overlay (missing + unparseable +
 * real MW). On keeps detections whose `frp` is a finite megawatt
 * greater than 0. Missing, non-finite, and `frp <= 0` hide.
 * Missing FRP fails closed when on.
 *
 * Distinct from the heatmap FRP floor (All | 10+ | 50+ | 100+ —
 * that floor still fails open on missing FRP when All:
 * `filterFiresByFrpFloor` returns a shallow copy at `minMw <= 0`),
 * the TI5 Kelvin floor, Plan 267 Hide no brightness, Plan 277 Hide
 * no scan, Plan 271 list Hide no scan, and Plan 276 list Hide no
 * track. This is presence-only, not a MW ceiling. `adaptFirmsRecords`
 * still writes 0 when FRP is unparseable; this chip hides that
 * sentinel when on. The selected detection always stays if it
 * already passed the other matchers. Re-applied on the
 * already-fetched `/api/firms` payload — no extra NASA fetch and no
 * new `/api`.
 *
 * Persistence is local only (`meridian.firmsHideNoFrp`, `1` / `0`).
 * LayerStateCoordinator restore re-reads the key. No share-URL write.
 */

export const FIRMS_HIDE_NO_FRP_CHIP_ID = 'hide-no-frp';
export const FIRMS_HIDE_NO_FRP_CHIP_LABEL = 'Hide no FRP';
export const FIRMS_HIDE_NO_FRP_CHIP_TITLE =
  'Hide detections that have no fire radiative power';

export const FIRMS_HIDE_NO_FRP_STORAGE_KEY = 'meridian.firmsHideNoFrp';

export const DEFAULT_FIRMS_HIDE_NO_FRP = false;

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
export function normalizeFirmsHideNoFrp(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return DEFAULT_FIRMS_HIDE_NO_FRP;
}

/**
 * Whether one detection already carries a real FRP.
 * Missing, non-finite, and `frp <= 0` fail closed.
 * @param {Object|null|undefined} fire
 * @returns {boolean}
 */
export function fireHasFrp(fire) {
  const frp = Number(fire?.frp);
  return Number.isFinite(frp) && frp > 0;
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
 * Whether Hide no FRP allows this detection to draw. Off is a
 * pass-through. On requires `frp > 0`. The selected id always stays.
 * @param {Object|null|undefined} fire
 * @param {unknown} hide
 * @param {{selectedId?: string|null}|string|null} [options]
 * @returns {boolean}
 */
export function fireMeetsHideNoFrp(fire, hide, options) {
  if (keepSelectedFire(fire, selectedIdFrom(options))) return true;
  if (normalizeFirmsHideNoFrp(hide) !== true) return true;
  return fireHasFrp(fire);
}

/**
 * Keep detections that pass Hide no FRP. Off returns a shallow copy
 * when no selected id is forced in. The selected id always stays.
 * @param {Array<Object>|null|undefined} fires
 * @param {unknown} [hide=DEFAULT_FIRMS_HIDE_NO_FRP]
 * @param {{selectedId?: string|null}|string|null} [selectedId]
 * @returns {Array<Object>}
 */
export function filterFiresByHideNoFrp(
  fires,
  hide = DEFAULT_FIRMS_HIDE_NO_FRP,
  selectedId,
) {
  if (!Array.isArray(fires)) return [];
  const keepId = selectedIdFrom(selectedId);
  if (normalizeFirmsHideNoFrp(hide) !== true && (keepId == null || keepId === '')) {
    return fires.slice();
  }
  return fires.filter((fire) => fireMeetsHideNoFrp(fire, hide, keepId));
}

/**
 * Toggle-chip model for the FIRMS data-layer row. Clicking writes the
 * opposite boolean via setParams.
 * @param {unknown} [active=DEFAULT_FIRMS_HIDE_NO_FRP]
 * @returns {object}
 */
export function firmsHideNoFrpChipModel(active = DEFAULT_FIRMS_HIDE_NO_FRP) {
  const on = active === true;
  return {
    id: FIRMS_HIDE_NO_FRP_CHIP_ID,
    label: FIRMS_HIDE_NO_FRP_CHIP_LABEL,
    title: FIRMS_HIDE_NO_FRP_CHIP_TITLE,
    active: on,
    params: { hideNoFrp: !on },
  };
}

/**
 * Read the durable Hide no FRP preference. Storage failures fail
 * closed to OFF.
 * @param {{getItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function readFirmsHideNoFrp(storage) {
  try {
    const raw = resolveStore(storage)?.getItem?.(FIRMS_HIDE_NO_FRP_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_FIRMS_HIDE_NO_FRP;
    return normalizeFirmsHideNoFrp(raw);
  } catch {
    return DEFAULT_FIRMS_HIDE_NO_FRP;
  }
}

/**
 * Persist the Hide no FRP preference as `1` / `0`. Best-effort;
 * never throws.
 * @param {unknown} hide
 * @param {{setItem?: Function}|null|undefined} [storage]
 * @returns {boolean}
 */
export function writeFirmsHideNoFrp(hide, storage) {
  const normalized = normalizeFirmsHideNoFrp(hide);
  try {
    const store = resolveStore(storage);
    if (typeof store?.setItem === 'function') {
      store.setItem(FIRMS_HIDE_NO_FRP_STORAGE_KEY, normalized ? '1' : '0');
    }
  } catch {
    // Fail open: the session can still apply the chosen toggle.
  }
  return normalized;
}
