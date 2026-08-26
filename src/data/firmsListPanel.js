/**
 * Left-stack FIRES list. Renders the trailing-24h FIRMS payload the
 * heatmap layer already fetched via `/api/firms`. Clicking a row uses
 * the layer's existing world-focus camera helper. Never contacts NASA
 * or traffic Live/Sim.
 */

import * as Cesium from 'cesium';
import {
  FIRMS_ACKNOWLEDGEMENT,
  FIRMS_LIST_ENABLE_COPY,
  attachFirmsListHideNoSat,
  resolveFireListView,
} from './firmsList.js';
import {
  getFirmsListConf,
  hydrateFirmsListConf,
  setFirmsListConf,
  subscribeFirmsListConf,
} from './firmsListConfFilter.js';
import {
  getFirmsListFrp,
  hydrateFirmsListFrp,
  setFirmsListFrp,
  setFirmsListSelectedId,
  subscribeFirmsListFrp,
} from './firmsListFrpFilter.js';
import {
  getFirmsListAge,
  hydrateFirmsListAge,
  setFirmsListAge,
  subscribeFirmsListAge,
} from './firmsListAgeFilter.js';

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
  const frpChips = root.querySelector('#fires-list-frp-chips');
  const ageChips = root.querySelector('#fires-list-age-chips');
  let openedForEnable = false;
  hydrateFirmsListConf();
  hydrateFirmsListFrp();
  hydrateFirmsListAge();
  const satChips = () => root.querySelector('#fires-list-sat-chips');

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

  function syncListFrpChips(enabled) {
    if (!frpChips) return;
    frpChips.hidden = enabled !== true;
    const current = getFirmsListFrp();
    for (const chip of frpChips.querySelectorAll('[data-firms-list-frp]')) {
      const active = chip.dataset.firmsListFrp === current;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
    }
  }

  function syncListAgeChips(enabled) {
    if (!ageChips) return;
    ageChips.hidden = enabled !== true;
    const current = getFirmsListAge();
    for (const chip of ageChips.querySelectorAll('[data-firms-list-age]')) {
      const active = chip.dataset.firmsListAge === current;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
    }
  }

  function render() {
    const layer = firmsModule();
    const enabled = dataManager?.isEnabled?.('local-firms') === true;
    syncListConfChips(enabled);
    syncListFrpChips(enabled);
    syncListAgeChips(enabled);
    const hideNoSatChips = satChips();
    if (hideNoSatChips) hideNoSatChips.hidden = enabled !== true;
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
    setFirmsListSelectedId(button.dataset.fireId);
    firmsModule()?.focusFireByKey?.(button.dataset.fireId);
  }

  function onConfChipClick(event) {
    const chip = event.target?.closest?.('[data-firms-list-conf]');
    if (!chip || !confChips?.contains(chip)) return;
    setFirmsListConf(chip.dataset.firmsListConf);
    render();
  }

  function onFrpChipClick(event) {
    const chip = event.target?.closest?.('[data-firms-list-frp]');
    if (!chip || !frpChips?.contains(chip)) return;
    setFirmsListFrp(chip.dataset.firmsListFrp);
    render();
  }

  function onAgeChipClick(event) {
    const chip = event.target?.closest?.('[data-firms-list-age]');
    if (!chip || !ageChips?.contains(chip)) return;
    setFirmsListAge(chip.dataset.firmsListAge);
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
  frpChips?.addEventListener('click', onFrpChipClick);
  ageChips?.addEventListener('click', onAgeChipClick);
  const unsubscribe = typeof dataManager?.subscribe === 'function'
    ? dataManager.subscribe(onLayerChange)
    : null;
  const unsubscribeConf = subscribeFirmsListConf(() => render());
  const unsubscribeFrp = subscribeFirmsListFrp(() => render());
  const unsubscribeAge = subscribeFirmsListAge(() => render());
  const detachHideNoSat = attachFirmsListHideNoSat(root, () => render());
  const removeMoveEnd = viewer?.camera?.moveEnd?.addEventListener?.(() => {
    if (dataManager?.isEnabled?.('local-firms')) render();
  });

  render();

  return () => {
    list?.removeEventListener('click', onListClick);
    confChips?.removeEventListener('click', onConfChipClick);
    frpChips?.removeEventListener('click', onFrpChipClick);
    ageChips?.removeEventListener('click', onAgeChipClick);
    unsubscribe?.();
    unsubscribeConf();
    unsubscribeFrp();
    unsubscribeAge();
    detachHideNoSat();
    if (typeof removeMoveEnd === 'function') removeMoveEnd();
  };
}
