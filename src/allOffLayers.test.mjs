import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ALL_OFF_ARIA_LABEL,
  ALL_OFF_BUSY_ARIA_LABEL,
  ALL_OFF_BUTTON_ID,
  ALL_OFF_TITLE,
  LAST_VIEW_KEY,
  LAYER_STATE_STORAGE_KEY,
  allOffLiveLayers,
  hasStoredLayerProfile,
  isBannedLiveLayer,
  shouldApplyFirstVisitLayerDefault,
} from './allOffLayers.js';
import { DataLayerManager } from './data/manager.js';
import {
  LAYER_STATE_REGISTRY,
  LayerStateCoordinator,
  REGISTERED_LAYER_IDS,
  createDefaultLayerState,
  parseStoredLayerState,
  serializeStoredLayerState,
} from './data/layerState.js';
import { writeLastView } from './lastView.js';
import { encodeShareViewUrl } from './shareViewUrl.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const src = (name) => readFileSync(join(__dirname, name), 'utf8');
const root = (name) => readFileSync(join(repoRoot, name), 'utf8');

const HREF = 'https://meridian.example/';
const LAST_VIEW_HASH = 'lat=35.6762&lon=139.6503&alt=1200&heading=40&pitch=-25';
const LIVE_FETCH_LAYERS = Object.freeze(['flights', 'local-firms', 'cctv', 'satellites', 'traffic']);

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    keys() {
      return [...map.keys()];
    },
  };
}

function makeFetchLayer(id, fetches) {
  const calls = { update: 0, enable: 0, disable: 0 };
  return {
    calls,
    module: {
      id,
      name: id,
      icon: '',
      source: 'test',
      updateInterval: 1_000,
      async init() { return true; },
      enable() { calls.enable += 1; },
      disable() { calls.disable += 1; },
      async update() {
        calls.update += 1;
        fetches.push(`/api/${id}`);
        return true;
      },
      getStats() { return { count: calls.update, lastUpdate: Date.now() }; },
    },
  };
}

function makeManager(layerIds = LIVE_FETCH_LAYERS, { registerAll = false } = {}) {
  const fetches = [];
  const layers = new Map();
  const manager = new DataLayerManager({});
  const ids = registerAll ? [...REGISTERED_LAYER_IDS] : layerIds;
  for (const id of ids) {
    const layer = makeFetchLayer(id, fetches);
    layers.set(id, layer);
    manager.register(layer.module);
  }
  const registry = registerAll
    ? LAYER_STATE_REGISTRY
    : LAYER_STATE_REGISTRY.filter((entry) => ids.includes(entry.id));
  manager.finalizeRegistrations(registry);
  return { manager, layers, fetches };
}

function poseSnapshot(camera) {
  return {
    lat: camera.positionCartographic.latitude,
    lon: camera.positionCartographic.longitude,
    alt: camera.positionCartographic.height,
    heading: camera.heading,
    pitch: camera.pitch,
  };
}

describe('All off chrome', () => {
  it('labels the existing panic control All off without adding a second button', () => {
    const html = root('index.html');
    const block = html.match(/id="top-center-actions"[\s\S]*?<\/nav>/)[0];
    assert.match(block, new RegExp(`id="${ALL_OFF_BUTTON_ID}"`));
    assert.match(block, /data-all-off/);
    assert.match(block, new RegExp(`aria-label="${ALL_OFF_ARIA_LABEL}"`));
    assert.match(block, new RegExp(`title="${ALL_OFF_TITLE}"`));
    assert.match(block, /class="all-off-layers-label">ALL OFF</);
    assert.equal((html.match(/id="clear-selected-layers"/g) || []).length, 1);
    assert.doesNotMatch(html, /id="all-off-layers"/);
  });

  it('wires All off through the existing disable-all path and not Home', () => {
    const ui = src('ui.js');
    assert.match(ui, /getElementById\('clear-selected-layers'\)/);
    assert.match(ui, /allOff\(\)\s*\{\s*return this\.clearSelectedLayers\(\);/);
    assert.match(ui, /void this\.allOff\(\)/);
    assert.match(ui, /addEventListener\('click', this\._clearSelectedLayersHandler\)/);
    const allOffFn = ui.match(/allOff\(\)\s*\{[\s\S]*?\n  \}/)[0];
    assert.doesNotMatch(allOffFn, /flyToHomeView|goHome|resetToGlobeView|setView/);
    const clearFn = ui.match(/clearSelectedLayers\(\)\s*\{[\s\S]*?\n  \}/)[0];
    assert.doesNotMatch(clearFn, /flyToHomeView|goHome|resetToGlobeView|LAST_VIEW_KEY|removeItem/);
    assert.match(clearFn, /ALL_OFF_BUSY_ARIA_LABEL/);
    assert.match(clearFn, /ALL_OFF_ARIA_LABEL/);
    assert.match(ui, /ALL_OFF_BUSY_ARIA_LABEL/);
    assert.match(src('allOffLayers.js'), new RegExp(ALL_OFF_BUSY_ARIA_LABEL));
    assert.match(src('allOffLayers.js'), new RegExp(ALL_OFF_ARIA_LABEL));
  });

  it('hides with the other globe chrome and does not invent /api', () => {
    const css = root('style.css');
    assert.match(css, /#clear-selected-layers \{/);
    assert.match(css, /body\.cockpit-mode :is\([^)]*#clear-selected-layers/);
    assert.match(css, /body\.scene-playback-mode :is\([^)]*#clear-selected-layers/);
    const module = src('allOffLayers.js');
    assert.doesNotMatch(module, /\/api\//);
    assert.doesNotMatch(module, /opensky|google news|telegeography|quantum-earth/i);
    assert.doesNotMatch(src('ui.js').match(/allOff\(\)\s*\{[\s\S]*?\n  \}/)[0], /\/api\//);
    assert.match(root('LICENSE'), /Copyright \(c\) 2026 Bilawal Sidhu/);
  });
});

describe('All off → no layer fetches except globe tiles', () => {
  it('stops live layer updates after All off; globe tiles are not a data layer', async () => {
    const { manager, layers, fetches } = makeManager();
    for (const id of LIVE_FETCH_LAYERS) {
      await manager.setEnabled(id, true, { origin: 'user' });
    }
    const afterEnable = fetches.length;
    assert.equal(afterEnable, LIVE_FETCH_LAYERS.length);
    assert.deepEqual(fetches, LIVE_FETCH_LAYERS.map((id) => `/api/${id}`));

    const result = await allOffLiveLayers(manager);
    assert.deepEqual(new Set(result.clearedIds), new Set(LIVE_FETCH_LAYERS));
    for (const id of LIVE_FETCH_LAYERS) {
      assert.equal(manager.isEnabled(id), false);
      assert.equal(layers.get(id).calls.disable, 1);
      assert.equal(manager.layers.get(id).intervalId, null);
    }

    const afterOff = fetches.length;
    for (const entry of manager.layers.values()) {
      if (entry.intervalId) clearInterval(entry.intervalId);
    }
    await Promise.resolve();
    assert.equal(fetches.length, afterOff, 'disabled layers must not poll again');
    assert.equal(fetches.some((url) => url.includes('opensky')), false);
    await manager.destroyAll();
  });
});

describe('All off leaves the camera pose and lastView alone', () => {
  it('does not mutate camera fields', async () => {
    const camera = {
      positionCartographic: { latitude: 0.62, longitude: 2.44, height: 1800 },
      heading: 0.4,
      pitch: -0.7,
      cancelFlight() { this.cancelled = true; },
      setView() { this.moved = true; },
      flyTo() { this.moved = true; },
    };
    const before = poseSnapshot(camera);
    const { manager } = makeManager(['flights']);
    await manager.setEnabled('flights', true, { origin: 'user' });
    await allOffLiveLayers(manager);
    assert.deepEqual(poseSnapshot(camera), before);
    assert.equal(camera.cancelled, undefined);
    assert.equal(camera.moved, undefined);
    await manager.destroyAll();
  });

  it('does not delete lastView', async () => {
    const storage = memoryStorage();
    const prior = encodeShareViewUrl(HREF, LAST_VIEW_HASH);
    writeLastView(storage, prior);
    const { manager } = makeManager(['flights', 'traffic']);
    const coordinator = new LayerStateCoordinator(manager, null, { storage });
    await coordinator.start();
    await manager.setEnabled('flights', true, { origin: 'user' });
    await manager.setEnabled('traffic', true, { origin: 'user' });
    await allOffLiveLayers(manager);
    assert.equal(storage.getItem(LAST_VIEW_KEY), prior);
    assert.equal(storage.keys().includes(LAST_VIEW_KEY), true);
    coordinator.destroy();
    await manager.destroyAll();
  });
});

describe('Re-enable flights after All off', () => {
  it('turns flights back on and issues one flights fetch', async () => {
    const { manager, layers, fetches } = makeManager(['flights', 'local-firms']);
    await manager.setEnabled('flights', true, { origin: 'user' });
    await manager.setEnabled('local-firms', true, { origin: 'user' });
    await allOffLiveLayers(manager);
    assert.equal(manager.isEnabled('flights'), false);
    const afterOff = fetches.length;

    const enabled = await manager.setEnabled('flights', true, { origin: 'user' });
    assert.equal(enabled, true);
    assert.equal(manager.isEnabled('flights'), true);
    assert.equal(layers.get('flights').calls.enable, 2);
    assert.equal(fetches.length, afterOff + 1);
    assert.equal(fetches.at(-1), '/api/flights');
    assert.equal(manager.isEnabled('local-firms'), false);
    await manager.destroyAll();
  });

  it('keeps banned layers off', async () => {
    const manager = new DataLayerManager({});
    const cables = makeFetchLayer('telegeography-submarine-cables', []);
    cables.module.selectable = false;
    manager.register(cables.module);
    manager.finalizeRegistrations(LAYER_STATE_REGISTRY.filter((entry) => (
      entry.id === 'telegeography-submarine-cables'
    )));
    await allOffLiveLayers(manager);
    assert.equal(await manager.setEnabled('telegeography-submarine-cables', true, { origin: 'user' }), false);
    assert.equal(manager.isEnabled('telegeography-submarine-cables'), false);
    assert.equal(isBannedLiveLayer('telegeography-submarine-cables'), true);
    assert.equal(isBannedLiveLayer('opensky'), true);
    assert.equal(isBannedLiveLayer('google-news-rss'), true);
    assert.equal(isBannedLiveLayer('flights'), false);
    await manager.destroyAll();
  });
});

describe('First-visit default still only applies on a fresh profile', () => {
  it('empty storage is a first visit; All off writes a profile and keeps defaults off', async () => {
    const storage = memoryStorage();
    assert.equal(shouldApplyFirstVisitLayerDefault(storage), true);
    assert.equal(hasStoredLayerProfile(storage), false);

    writeLastView(storage, encodeShareViewUrl(HREF, LAST_VIEW_HASH));
    assert.equal(shouldApplyFirstVisitLayerDefault(storage), true, 'lastView alone is not a layer profile');

    const { manager } = makeManager(['flights', 'local-firms', 'cctv'], { registerAll: true });
    const coordinator = new LayerStateCoordinator(manager, null, { storage });
    await coordinator.start();
    assert.equal(coordinator.source, 'defaults');
    await manager.setEnabled('flights', true, { origin: 'user' });
    await manager.setEnabled('local-firms', true, { origin: 'user' });
    await manager.setEnabled('cctv', true, { origin: 'user' });
    await allOffLiveLayers(manager);

    assert.equal(hasStoredLayerProfile(storage), true);
    assert.equal(shouldApplyFirstVisitLayerDefault(storage), false);
    const stored = parseStoredLayerState(storage.getItem(LAYER_STATE_STORAGE_KEY));
    assert.ok(stored);
    assert.deepEqual(stored.enabledLayerIds, []);
    assert.equal(storage.getItem(LAST_VIEW_KEY).includes('lat=35.6762'), true);

    const { manager: reloaded } = makeManager(['flights', 'local-firms', 'cctv'], { registerAll: true });
    const again = new LayerStateCoordinator(reloaded, null, { storage });
    await again.start();
    assert.equal(again.source, 'local');
    assert.equal(shouldApplyFirstVisitLayerDefault(storage), false);
    assert.deepEqual(again.getDurableState().enabledLayerIds, []);
    assert.equal(reloaded.isEnabled('flights'), false);
    assert.equal(reloaded.isEnabled('local-firms'), false);
    assert.equal(reloaded.isEnabled('cctv'), false);

    coordinator.destroy();
    again.destroy();
    await manager.destroyAll();
    await reloaded.destroyAll();
  });

  it('an explicit empty enabled set is a profile, not a missing first-visit slot', () => {
    const emptyProfile = serializeStoredLayerState(createDefaultLayerState());
    const storage = memoryStorage({ [LAYER_STATE_STORAGE_KEY]: emptyProfile });
    assert.equal(hasStoredLayerProfile(storage), true);
    assert.equal(shouldApplyFirstVisitLayerDefault(storage), false);
    assert.ok(REGISTERED_LAYER_IDS.length > 0);
  });
});
