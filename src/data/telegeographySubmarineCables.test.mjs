import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DataLayerManager } from './manager.js';
import submarineCablesLayer, {
  CABLE_OVERLAY_COLLISION_CAPACITY,
  CABLE_OVERLAY_SOURCE_ID,
  CABLE_REFERENCE_LABEL_WINNER_CAP,
  createCableOverlayEntry,
  createTeleGeographySubmarineCableLayer,
} from './telegeographySubmarineCables.js';

const DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'local_data',
  'telegeography_submarine_cables',
);

test('TeleGeography cable dataset is not shipped in this commercial fork', () => {
  assert.equal(existsSync(DATA_DIR), false);
});

test('cables layer keeps its registered id but never loads cable data', () => {
  const layer = createTeleGeographySubmarineCableLayer();
  assert.equal(layer.id, 'telegeography-submarine-cables');
  assert.equal(layer.showInTogglePanel, false);
  assert.equal(CABLE_OVERLAY_SOURCE_ID, 'telegeography-submarine-cables');
  assert.equal(CABLE_REFERENCE_LABEL_WINNER_CAP, 160);
  assert.equal(CABLE_OVERLAY_COLLISION_CAPACITY, 96);
  const probeEntry = createCableOverlayEntry({
    id: 'cable-probe',
    kind: 'cable',
    label: 'Probe',
    tip: { x: 0, y: 0, z: 0 },
    distanceM: 200000,
  });
  assert.equal(probeEntry.id, 'cable-probe');
  assert.equal(probeEntry.variant, 'label');
  layer.init();
  layer.enable();
  layer.update();
  const stats = layer.getStats();
  assert.equal(stats.count, 0);
  assert.equal(stats.unavailable, true);
  assert.match(stats.error, /removed/i);
  layer.disable();
  layer.destroy();
});

test('default export is the same no-op layer contract', () => {
  assert.equal(submarineCablesLayer.id, 'telegeography-submarine-cables');
  assert.equal(submarineCablesLayer.getStats().count, 0);
});

test('cables module does not import TeleGeography GeoJSON', () => {
  const source = readFileSync(new URL('./telegeographySubmarineCables.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /cable-geo\.json/);
  assert.doesNotMatch(source, /landing-point-geo\.json/);
  assert.doesNotMatch(source, /telegeography_submarine_cables\//);
});

function makeToggleElement() {
  const element = {
    children: [],
    className: '',
    dataset: {},
    textContent: '',
    disabled: false,
    attributes: {},
    classList: { toggle() {} },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    querySelector(selector) {
      if (selector.startsWith('[data-layer-id="')) {
        const id = selector.slice(16, -2);
        return this.children.find((child) => child.dataset.layerId === id) || null;
      }
      return null;
    },
    set innerHTML(value) { if (value === '') this.children = []; },
    get innerHTML() { return ''; },
  };
  return element;
}

test('UI has no enable control for cables', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: makeToggleElement };
  const manager = new DataLayerManager({});
  const flights = {
    id: 'flights',
    name: 'Live Flights',
    icon: '',
    source: 'test',
    updateInterval: -1,
    init() {},
    enable() {},
    disable() {},
    update() {},
    getStats() { return { count: 0, lastUpdate: null }; },
  };
  manager.register(flights);
  manager.register(createTeleGeographySubmarineCableLayer());
  const container = makeToggleElement();

  try {
    manager.buildTogglePanel(container);
    assert.ok(container.querySelector('[data-layer-id="flights"]'), 'ordinary layers stay visible');
    assert.equal(
      container.querySelector('[data-layer-id="telegeography-submarine-cables"]'),
      null,
      'cables must not expose an enable control',
    );
    assert.equal(await manager.setEnabled('telegeography-submarine-cables', true), false);
    assert.equal(manager.isEnabled('telegeography-submarine-cables'), false);
    manager._refreshTogglePanel();
    assert.equal(container.querySelector('[data-layer-id="telegeography-submarine-cables"]'), null);
  } finally {
    await manager.destroyAll();
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('cables layer id remains a registered no-op and stays unselectable', () => {
  const layer = createTeleGeographySubmarineCableLayer();
  assert.equal(layer.id, 'telegeography-submarine-cables');
  assert.equal(layer.selectable, false);
  assert.equal(layer.showInTogglePanel, false);
  assert.equal(layer.enable(), undefined);
  assert.equal(layer.getStats().count, 0);
});
