/**
 * Panic All off — disable every live data layer, keep the globe + credits.
 *
 * Home resets the camera. This control does not. lastView stays put so a
 * reload still restores the pose; the next layer enable is manual.
 * Banned commercial sources stay off.
 */

import { BANNED_LAYER_LIST_IDS } from './data/layerAliases.js';
import {
  LAYER_STATE_STORAGE_KEY,
  hasStoredLayerProfile,
  isLayerSelectable,
  shouldApplyFirstVisitLayerDefault,
} from './data/layerState.js';
import { LAST_VIEW_KEY } from './lastView.js';

export const ALL_OFF_BUTTON_ID = 'clear-selected-layers';
export const ALL_OFF_ARIA_LABEL = 'All off — disable every live data layer';
export const ALL_OFF_BUSY_ARIA_LABEL = 'Turning all live layers off';
export const ALL_OFF_TITLE = 'All off — live layers off, camera stays';
export const RESTORE_LIVE_LAYERS_BUTTON_ID = 'restore-live-layers';
export const RESTORE_LIVE_LAYERS_ARIA_LABEL = 'Restore layers from before All off';
export const RESTORE_LIVE_LAYERS_BUSY_ARIA_LABEL = 'Restoring layers from before All off';
export const RESTORE_LIVE_LAYERS_TITLE = 'Restore the layers that were on before All off. Does not move the globe.';

export {
  LAYER_STATE_STORAGE_KEY,
  LAST_VIEW_KEY,
  hasStoredLayerProfile,
  shouldApplyFirstVisitLayerDefault,
};

/**
 * Turn off every live layer the manager currently considers on.
 * Does not move the camera, delete lastView, or enable banned layers.
 * @param {object} dataManager
 * @param {object} [options]
 * @param {string} [options.origin='user']
 * @returns {Promise<{targetIds:string[],items:object[],clearedIds:string[],notClearedIds:string[]}>}
 */
export function allOffLiveLayers(dataManager, { origin = 'user', notificationToken = null } = {}) {
  if (!dataManager?.clearSelectedLayers) {
    return Promise.resolve({
      targetIds: [],
      items: [],
      clearedIds: [],
      notClearedIds: [],
    });
  }
  return dataManager.clearSelectedLayers({
    origin,
    ...(notificationToken ? { notificationToken } : {}),
  });
}

/**
 * Banned commercial-fork layers must remain unselectable after All off.
 * @param {string} layerId
 * @returns {boolean}
 */
export function isBannedLiveLayer(layerId) {
  return BANNED_LAYER_LIST_IDS.has(String(layerId || ''))
    || isLayerSelectable(layerId) === false;
}

/**
 * Copy the live layer ids that All off should be able to put back.
 * Banned commercial sources never enter the snapshot.
 * @param {Iterable<string>|Set<string>|null|undefined} ids
 * @returns {string[]}
 */
export function snapshotEnabledLayerIds(ids) {
  const out = [];
  const seen = new Set();
  for (const id of ids || []) {
    if (typeof id !== 'string' || !id || seen.has(id) || isBannedLiveLayer(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * @param {unknown} snapshot
 * @returns {boolean}
 */
export function hasRestoreSnapshot(snapshot) {
  return Array.isArray(snapshot) && snapshot.length > 0;
}

/**
 * Restore stays hidden until All off has captured a non-empty snapshot
 * this session. A leftover empty snapshot is still nothing to restore.
 * @param {{ snapshot?: unknown, allOffUsedThisSession?: boolean }} [state]
 * @returns {boolean}
 */
export function shouldShowRestoreControl({ snapshot, allOffUsedThisSession } = {}) {
  return allOffUsedThisSession === true || hasRestoreSnapshot(snapshot)
    ? hasRestoreSnapshot(snapshot)
    : false;
}

/**
 * Re-enable the snapped live layers. Banned ids are stripped again so a
 * dirty snapshot cannot turn them on. Does not move the camera.
 * @param {object} dataManager
 * @param {Iterable<string>|null|undefined} snapshot
 * @param {object} [options]
 * @param {string} [options.origin='user']
 * @returns {Promise<{enabledLayerIds:string[], restored:boolean}>}
 */
export function restoreLiveLayers(dataManager, snapshot, { origin = 'user', notificationToken = null } = {}) {
  const enabledLayerIds = snapshotEnabledLayerIds(snapshot);
  if (!dataManager?.restoreEnabledLayerIds || enabledLayerIds.length === 0) {
    return Promise.resolve({ enabledLayerIds, restored: false });
  }
  return dataManager.restoreEnabledLayerIds(enabledLayerIds, {
    origin,
    ...(notificationToken ? { notificationToken } : {}),
  }).then(() => ({ enabledLayerIds, restored: true }));
}
