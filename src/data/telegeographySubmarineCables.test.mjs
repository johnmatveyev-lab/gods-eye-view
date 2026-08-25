import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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
