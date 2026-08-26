/**
 * Left-stack FIRES list. Renders the trailing-24h FIRMS payload the
 * heatmap layer already fetched via `/api/firms`. Clicking a row uses
 * the layer's existing world-focus camera helper. Never contacts NASA
 * or traffic Live/Sim.
 */

import * as Cesium from 'cesium';
import { FIRMS_ACKNOWLEDGEMENT, FIRMS_LIST_ENABLE_COPY, resolveFireListView } from './firmsList.js';
import {
  getFirmsListConf,
  hydrateFirmsListConf,
  setFirmsListConf,
  subscribeFirmsListConf,
} from './firmsListConfFilter.js';

/**
 * Bind the FIRES panel to the live FIRMS layer and camera.
 * @param {object} options
 * @param {HTMLElement|null} options.root `#fires-panel`
 * @param {object} [options.viewer]
 * @param {object} [options.dataManager]
 * @param {(id: string, collapsed: boolean) => void} [options.setPanelCollapsed]
 * @returns {() => void} disposer
 */
export function attachFirmsListPanel({
  root,
  viewer = null,
  dataManager = null,
  setPanelCollapsed = null,
} = {}) {
  if (!root) return () => {};

  const list = root.querySelector('#fires-list');
  const meta = root.querySelector('#fires-list-meta');
  const ack = root.querySelector('#fires-list-ack');
  const confChips = root.querySelector('#fires-list-conf-chips');
  let openedForEnable = false;
  hydrateFirmsListConf();

  function firmsModule() {
    return dataManager?.layers?.get('local-firms')?.module || null;
  }

  function cameraOrigin() {
    const carto = viewer?.camera?.positionCartographic;
    if (!carto || !Number.isFinite(carto.latitude) || !Number.isFinite(carto.longitude)) {
      return null;
    }
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
    };
  }

  function syncListConfChips(enabled) {
    if (!confChips) return;
    confChips.hidden = enabled !== true;
    const current = getFirmsListConf();
    for (const chip of confChips.querySelectorAll('[data-firms-list-conf]')) {
      const active = chip.dataset.firmsListConf === current;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
    }
  }

  function render() {
    const layer = firmsModule();
    const enabled = dataManager?.isEnabled?.('local-firms') === true;
    syncListConfChips(enabled);
    const view = typeof layer?.getFireListView === 'function'
      ? layer.getFireListView({ camera: cameraOrigin() })
      : resolveFireListView({
        keyRequired: false,
        loading: false,
        enabled,
        fires: [],
        camera: cameraOrigin(),
      });
    if (meta) meta.textContent = view.copy || FIRMS_LIST_ENABLE_COPY;
    if (ack) ack.textContent = view.acknowledgement || FIRMS_ACKNOWLEDGEMENT;
    if (!list) return;
    list.replaceChildren();
    for (const row of view.rows) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fires-list-item';
      button.dataset.fireId = row.id;
      button.setAttribute('aria-label', `Fly to ${row.title}`);
      const title = document.createElement('strong');
      title.textContent = row.title;
      const detail = document.createElement('small');
      detail.textContent = row.detail;
      button.append(title, detail);
      item.appendChild(button);
      list.appendChild(item);
    }
  }

  function onListClick(event) {
    const button = event.target?.closest?.('[data-fire-id]');
    if (!button) return;
    firmsModule()?.focusFireByKey?.(button.dataset.fireId);
  }

  function onConfChipClick(event) {
    const chip = event.target?.closest?.('[data-firms-list-conf]');
    if (!chip || !confChips?.contains(chip)) return;
    setFirmsListConf(chip.dataset.firmsListConf);
    render();
  }

  function onLayerChange(change) {
    render();
    if (change?.layerId && change.layerId !== 'local-firms') return;
    const enabled = dataManager?.isEnabled?.('local-firms') === true;
    if (enabled && !openedForEnable && typeof setPanelCollapsed === 'function') {
      setPanelCollapsed('fires-panel', false);
      openedForEnable = true;
    }
    if (!enabled) openedForEnable = false;
  }

  list?.addEventListener('click', onListClick);
  confChips?.addEventListener('click', onConfChipClick);
  const unsubscribe = typeof dataManager?.subscribe === 'function'
    ? dataManager.subscribe(onLayerChange)
    : null;
  const unsubscribeConf = subscribeFirmsListConf(() => render());
  const removeMoveEnd = viewer?.camera?.moveEnd?.addEventListener?.(() => {
    if (dataManager?.isEnabled?.('local-firms')) render();
  });

  render();

  return () => {
    list?.removeEventListener('click', onListClick);
    confChips?.removeEventListener('click', onConfChipClick);
    unsubscribe?.();
    unsubscribeConf();
    if (typeof removeMoveEnd === 'function') removeMoveEnd();
  };
}
