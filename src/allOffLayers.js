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
