/**
 * Hosted data-layer list filter. Matches the visible name plus voice
 * common-names (fires, ships, bikes, traffic, cameras, …). Empty query
 * shows every remaining legal toggle row. Banned sources never match.
 */

import {
  BANNED_LAYER_LIST_IDS,
  LAYER_LIST_ALIASES,
} from './layerAliases.js';

/**
 * Whether a layer id is excluded from the hosted toggle list.
 * @param {string} layerId
 * @returns {boolean}
 */
export function isBannedToggleLayerId(layerId) {
  return BANNED_LAYER_LIST_IDS.has(String(layerId || ''));
}

/**
 * Normalize a filter field value. Whitespace-only is treated as empty.
 * @param {unknown} query
 * @returns {string}
 */
export function normalizeLayerListQuery(query) {
  return String(query || '').trim().toLowerCase();
}

/**
 * Whether one registered layer should stay visible for the current query.
 * @param {{id?: string, name?: string, showInTogglePanel?: boolean}} layer
 * @param {unknown} query
 * @param {Map<string, string>} [aliases]
 * @returns {boolean}
 */
export function layerMatchesFilter(layer, query, aliases = LAYER_LIST_ALIASES) {
  const id = String(layer?.id || '');
  if (!id || isBannedToggleLayerId(id) || layer?.showInTogglePanel === false) {
    return false;
  }
  const needle = normalizeLayerListQuery(query);
  if (!needle) return true;

  const name = String(layer?.name || '').toLowerCase();
  if (name.includes(needle) || id.toLowerCase().includes(needle)) return true;

  for (const [alias, layerId] of aliases) {
    if (layerId === id && alias.includes(needle)) return true;
  }
  return false;
}

/**
 * Legal toggle layers matching the query, in the given order.
 * @param {Array<{id?: string, name?: string, showInTogglePanel?: boolean}>} layers
 * @param {unknown} query
 * @returns {Array<object>}
 */
export function filterVisibleLayers(layers, query) {
  return (Array.isArray(layers) ? layers : []).filter((layer) => layerMatchesFilter(layer, query));
}

/**
 * Hide or show already-rendered toggle rows. Rows are not removed.
 * @param {HTMLElement|null} container
 * @param {unknown} query
 * @param {Array<{id?: string, name?: string, showInTogglePanel?: boolean}>} layers
 */
export function applyLayerListFilter(container, query, layers) {
  if (!container) return;
  for (const layer of Array.isArray(layers) ? layers : []) {
    const row = container.querySelector?.(`[data-layer-id="${layer.id}"]`);
    if (!row) continue;
    row.hidden = !layerMatchesFilter(layer, query);
  }
}
