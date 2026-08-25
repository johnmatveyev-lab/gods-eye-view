// PLAN 109 — Jam: Density | Heatline | Both | Off. Wires existing
// setParams({ jamViz }). Live only. Independent of Live | Sim and
// Uncovered Sim | Hide. No extra TomTom fetch. No new /api.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { flowDensityMult } from './trafficFlowStyle.js';
import {
  DEFAULT_JAM_VIZ,
  JAM_VIZ_MODES,
  JAM_VIZ_STORAGE_KEY,
  getJamViz,
  jamVizControls,
  jamVizEffects,
  normalizeJamViz,
  readJamViz,
  resetJamVizCache,
  setJamViz,
  writeJamViz,
} from './trafficJamViz.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
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
  };
}

test('the stored key is meridian.trafficJamViz and the default is density', () => {
  assert.equal(JAM_VIZ_STORAGE_KEY, 'meridian.trafficJamViz');
  assert.equal(DEFAULT_JAM_VIZ, 'density');
  assert.deepEqual(JAM_VIZ_MODES, ['none', 'density', 'heatline', 'both']);
  assert.equal(normalizeJamViz('heatline'), 'heatline');
  assert.equal(normalizeJamViz('NONE'), 'none');
  assert.equal(normalizeJamViz('bogus'), 'density');
  assert.equal(normalizeJamViz(null), 'density');
});

test('density matches current jam bunching; heatline is corridors only; both is both; off is shipped-main', () => {
  assert.deepEqual(jamVizEffects('density'), {
    jamViz: 'density',
    densityBoost: true,
    heatline: false,
    queuePlatoons: true,
    stopAndGo: true,
  });
  assert.deepEqual(jamVizEffects('heatline'), {
    jamViz: 'heatline',
    densityBoost: false,
    heatline: true,
    queuePlatoons: false,
    stopAndGo: false,
  });
  assert.deepEqual(jamVizEffects('both'), {
    jamViz: 'both',
    densityBoost: true,
    heatline: true,
    queuePlatoons: true,
    stopAndGo: true,
  });
  assert.deepEqual(jamVizEffects('none'), {
    jamViz: 'none',
    densityBoost: false,
    heatline: false,
    queuePlatoons: false,
    stopAndGo: false,
  });
  assert.deepEqual(jamVizEffects('bogus'), jamVizEffects('density'),
    'unknown values keep the current density view');

  // Density / both deepen deep jams; heatline / off keep the shipped 2.5 cap.
  assert.equal(flowDensityMult(0.1, { jamBoost: jamVizEffects('density').densityBoost }), 4);
  assert.equal(flowDensityMult(0.1, { jamBoost: jamVizEffects('both').densityBoost }), 4);
  assert.equal(flowDensityMult(0.1, { jamBoost: jamVizEffects('heatline').densityBoost }), 2.5);
  assert.equal(flowDensityMult(0.1, { jamBoost: jamVizEffects('none').densityBoost }), 2.5);
});

test('Jam chrome is live-only and emits setParams({ jamViz }) only', () => {
  const hidden = jamVizControls({ jamViz: 'density', liveMode: false });
  assert.equal(hidden.heading, 'Jam');
  assert.deepEqual(hidden.chips, []);

  const live = jamVizControls({ jamViz: 'density', liveMode: true });
  assert.equal(live.heading, 'Jam');
  assert.deepEqual(live.chips.map((chip) => chip.label), ['Density', 'Heatline', 'Both', 'Off']);
  assert.deepEqual(live.chips.map((chip) => chip.params), [
    { jamViz: 'density' },
    { jamViz: 'heatline' },
    { jamViz: 'both' },
    { jamViz: 'none' },
  ]);
  for (const chip of live.chips) {
    assert.equal(chip.group, 'Jam');
    assert.deepEqual(Object.keys(chip.params), ['jamViz']);
    assert.equal(chip.params.trafficSource, undefined);
    assert.equal(chip.params.uncoveredRoads, undefined);
  }
  assert.equal(live.chips.find((chip) => chip.id === 'jam-viz-density').active, true);
  assert.equal(live.chips.find((chip) => chip.id === 'jam-viz-off').active, false);

  const heatline = jamVizControls({ jamViz: 'heatline', liveMode: true });
  assert.equal(heatline.chips.find((chip) => chip.id === 'jam-viz-heatline').active, true);
  assert.equal(heatline.chips.find((chip) => chip.id === 'jam-viz-density').active, false);
});

test('reload keeps a Heatline choice and writes the four-mode enum only', () => {
  const storage = memoryStorage();
  assert.equal(writeJamViz('heatline', storage), 'heatline');
  assert.equal(storage.getItem(JAM_VIZ_STORAGE_KEY), 'heatline');
  resetJamVizCache();
  assert.equal(readJamViz(storage), 'heatline');
  assert.equal(writeJamViz('BOTH', storage), 'both');
  assert.equal(storage.getItem(JAM_VIZ_STORAGE_KEY), 'both');
  assert.equal(writeJamViz('off-please', storage), 'density');
});

test('empty or unreadable storage keeps the density default', () => {
  resetJamVizCache();
  assert.equal(readJamViz(memoryStorage()), 'density');
  assert.equal(readJamViz(null), 'density');
  assert.equal(readJamViz({
    getItem() {
      throw new Error('blocked');
    },
  }), 'density');
});

test('get/setJamViz persist through a cache reset the way a reload would', () => {
  const storage = memoryStorage();
  resetJamVizCache();
  assert.equal(getJamViz(storage), 'density');
  assert.equal(setJamViz('none', storage), 'none');
  resetJamVizCache();
  assert.equal(getJamViz(storage), 'none');
  setJamViz('density', storage);
  resetJamVizCache();
});

test('the traffic layer wires setParams({ jamViz }) and does not add an endpoint', () => {
  const traffic = readFileSync(path.join(ROOT, 'src/data/traffic.js'), 'utf8');
  const jam = readFileSync(path.join(ROOT, 'src/data/trafficJamViz.js'), 'utf8');
  assert.match(traffic, /from '\.\/trafficJamViz\.js'/);
  assert.match(traffic, /jamVizControls\(/);
  assert.match(traffic, /jamVizEffects\(/);
  assert.match(traffic, /params\.jamViz/);
  assert.match(traffic, /setJamViz\(/);
  assert.doesNotMatch(traffic, /\/api\/jam/);
  assert.doesNotMatch(jam, /\/api\//);
  assert.doesNotMatch(jam, /\/api\/tomtom/);
});

test('share URLs and layer options stay out of jamViz — no cheap enum slot exists', () => {
  const share = readFileSync(path.join(ROOT, 'src/sharelink.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  assert.equal(share.includes('meridian.trafficJamViz'), false);
  assert.doesNotMatch(share, /params\.set\('jamViz'/);
  assert.match(layerState, /id: 'traffic', token: 't', disposition: 'enabled-only'/);
  assert.doesNotMatch(layerState, /jamViz/);
});
