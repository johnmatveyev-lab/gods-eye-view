// PLAN 194 — Jams only toggle. Client-only filter of already-fetched
// TomTom `road.flow.level`. Reuses flowBucket(). Live only. Independent
// of Live | Sim, Uncovered Sim | Hide, and Jam viz. No extra TomTom
// fetch. No new /api. Preference lives in localStorage
// `meridian.trafficJamsOnly`. Share URLs stay out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { flowBucket } from './trafficFlowStyle.js';
import {
  DEFAULT_TRAFFIC_JAMS_ONLY,
  TRAFFIC_JAMS_ONLY_CHIP_LABEL,
  TRAFFIC_JAMS_ONLY_CHIP_TITLE,
  TRAFFIC_JAMS_ONLY_STORAGE_KEY,
  getTrafficJamsOnly,
  normalizeTrafficJamsOnly,
  readTrafficJamsOnly,
  resetTrafficJamsOnlyCache,
  roadPassesJamFilter,
  setTrafficJamsOnly,
  trafficJamsOnlyControls,
  trafficRoadSpawnsDots,
  writeTrafficJamsOnly,
} from './trafficJamFilter.js';
import trafficLayer from './traffic.js';
import { resetTrafficSourceCache, setTrafficSource } from './trafficSource.js';
import { resetUncoveredRoadsCache } from './uncoveredRoads.js';
import { resetJamVizCache } from './trafficJamViz.js';

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

function restoreTrafficPrefs() {
  resetTrafficJamsOnlyCache();
  resetUncoveredRoadsCache();
  resetTrafficSourceCache();
  resetJamVizCache();
  trafficLayer.setParams({
    jamsOnly: false,
    uncoveredRoads: 'sim',
    trafficSource: 'sim',
    jamViz: 'density',
  });
}

test('the stored key is meridian.trafficJamsOnly and the default is off', () => {
  assert.equal(TRAFFIC_JAMS_ONLY_STORAGE_KEY, 'meridian.trafficJamsOnly');
  assert.equal(DEFAULT_TRAFFIC_JAMS_ONLY, false);
  assert.equal(TRAFFIC_JAMS_ONLY_CHIP_LABEL, 'Jams only');
  assert.equal(
    TRAFFIC_JAMS_ONLY_CHIP_TITLE,
    'Hide free-flow and slow roads — show jammed traffic only',
  );
  assert.equal(normalizeTrafficJamsOnly(undefined), false);
  assert.equal(normalizeTrafficJamsOnly(null), false);
  assert.equal(normalizeTrafficJamsOnly(''), false);
  assert.equal(normalizeTrafficJamsOnly(false), false);
  assert.equal(normalizeTrafficJamsOnly(true), true);
  assert.equal(normalizeTrafficJamsOnly('1'), true);
  assert.equal(normalizeTrafficJamsOnly('true'), true);
  assert.equal(normalizeTrafficJamsOnly(0), false);
  assert.equal(normalizeTrafficJamsOnly('bogus'), null);
});

test('level 0.4 (jam) stays; level 0.9 (free) hides when on; off restores free-flow', () => {
  assert.equal(flowBucket(0.4), 'jam', 'live TomTom scale: 0.4 is jam');
  assert.equal(flowBucket(0.9), 'free', 'live TomTom scale: 0.9 is free');

  const jam = { flow: { level: 0.4 } };
  const free = { flow: { level: 0.9 } };
  const slow = { flow: { level: 0.7 } };
  const missing = { flow: {} };
  const noFlow = {};

  assert.equal(roadPassesJamFilter(jam, { jamsOnly: true, liveMode: true }), true);
  assert.equal(roadPassesJamFilter(free, { jamsOnly: true, liveMode: true }), false);
  assert.equal(roadPassesJamFilter(slow, { jamsOnly: true, liveMode: true }), false);
  assert.equal(roadPassesJamFilter(missing, { jamsOnly: true, liveMode: true }), false,
    'missing level is free, so jams-only hides it');
  assert.equal(roadPassesJamFilter(noFlow, { jamsOnly: true, liveMode: true }), false);
  assert.equal(roadPassesJamFilter({ flow: { level: Number.NaN } }, { jamsOnly: true, liveMode: true }), false);
  assert.equal(roadPassesJamFilter({ flow: { level: undefined } }, { jamsOnly: true, liveMode: true }), false);

  assert.equal(roadPassesJamFilter(free, { jamsOnly: false, liveMode: true }), true,
    'off restores free-flow dots');
  assert.equal(roadPassesJamFilter(slow, { jamsOnly: false, liveMode: true }), true);
  assert.equal(roadPassesJamFilter(jam, { jamsOnly: false, liveMode: true }), true);
  assert.equal(roadPassesJamFilter(noFlow, { jamsOnly: false, liveMode: true }), true);
});

test('keyless simulation is unchanged even when the toggle is on', () => {
  const free = { flow: { level: 0.9 } };
  const jam = { flow: { level: 0.4 } };
  const ambient = {};
  for (const road of [free, jam, ambient]) {
    assert.equal(roadPassesJamFilter(road, { jamsOnly: true, liveMode: false }), true);
    assert.equal(trafficRoadSpawnsDots(road, {
      liveMode: false,
      jamsOnly: true,
      uncoveredRoads: 'hide',
    }), true, 'sim still paints every road, including uncovered hide');
  }
});

test('jams-only ANDs with closure skip and uncovered-road hide', () => {
  const jam = { flow: { level: 0.4 } };
  const free = { flow: { level: 0.9 } };
  const closedJam = { flow: { level: 0.4, closure: true } };
  const uncovered = {};

  assert.equal(trafficRoadSpawnsDots(jam, {
    liveMode: true,
    jamsOnly: true,
    uncoveredRoads: 'sim',
  }), true);
  assert.equal(trafficRoadSpawnsDots(free, {
    liveMode: true,
    jamsOnly: true,
    uncoveredRoads: 'sim',
  }), false);
  assert.equal(trafficRoadSpawnsDots(closedJam, {
    liveMode: true,
    jamsOnly: true,
    uncoveredRoads: 'sim',
  }), false, 'closures still spawn nothing');
  assert.equal(trafficRoadSpawnsDots(uncovered, {
    liveMode: true,
    jamsOnly: true,
    uncoveredRoads: 'sim',
  }), false, 'uncovered ambient has no jam level');
  assert.equal(trafficRoadSpawnsDots(uncovered, {
    liveMode: true,
    jamsOnly: false,
    uncoveredRoads: 'hide',
  }), false, 'uncovered hide still applies when jams-only is off');
  assert.equal(trafficRoadSpawnsDots(jam, {
    liveMode: true,
    jamsOnly: false,
    uncoveredRoads: 'hide',
  }), true, 'colored live jam stays under uncovered hide');
  assert.equal(trafficRoadSpawnsDots(free, {
    liveMode: true,
    jamsOnly: false,
    uncoveredRoads: 'sim',
  }), true, 'off + sim uncovered is the current mixed view');
});

test('Jams only chrome is live-only and emits setParams({ jamsOnly }) only', () => {
  const hidden = trafficJamsOnlyControls({ jamsOnly: false, liveMode: false });
  assert.equal(hidden.heading, 'Jams');
  assert.deepEqual(hidden.chips, []);

  const liveOff = trafficJamsOnlyControls({ jamsOnly: false, liveMode: true });
  assert.equal(liveOff.heading, 'Jams');
  assert.equal(liveOff.chips.length, 1);
  assert.equal(liveOff.chips[0].id, 'traffic-jams-only');
  assert.equal(liveOff.chips[0].label, 'Jams only');
  assert.equal(liveOff.chips[0].active, false);
  assert.equal(liveOff.chips[0].group, 'Jams');
  assert.deepEqual(liveOff.chips[0].params, { jamsOnly: true });
  assert.equal(liveOff.chips[0].params.trafficSource, undefined);
  assert.equal(liveOff.chips[0].params.uncoveredRoads, undefined);
  assert.equal(liveOff.chips[0].params.jamViz, undefined);

  const liveOn = trafficJamsOnlyControls({ jamsOnly: true, liveMode: true });
  assert.equal(liveOn.chips[0].active, true);
  assert.deepEqual(liveOn.chips[0].params, { jamsOnly: false });
});

test('reload keeps a Jams only choice and writes 1/0 only', () => {
  const storage = memoryStorage();
  assert.equal(writeTrafficJamsOnly(true, storage), true);
  assert.equal(storage.getItem(TRAFFIC_JAMS_ONLY_STORAGE_KEY), '1');
  resetTrafficJamsOnlyCache();
  assert.equal(readTrafficJamsOnly(storage), true);
  assert.equal(writeTrafficJamsOnly(false, storage), false);
  assert.equal(storage.getItem(TRAFFIC_JAMS_ONLY_STORAGE_KEY), '0');
  assert.equal(writeTrafficJamsOnly('off-please', storage), false);
});

test('empty or unreadable storage keeps the off default', () => {
  resetTrafficJamsOnlyCache();
  assert.equal(readTrafficJamsOnly(memoryStorage()), false);
  assert.equal(readTrafficJamsOnly(null), false);
  assert.equal(readTrafficJamsOnly({
    getItem() {
      throw new Error('blocked');
    },
  }), false);
});

test('get/setTrafficJamsOnly persist through a cache reset the way a reload would', () => {
  const storage = memoryStorage();
  resetTrafficJamsOnlyCache();
  assert.equal(getTrafficJamsOnly(storage), false);
  assert.equal(setTrafficJamsOnly(true, storage), true);
  resetTrafficJamsOnlyCache();
  assert.equal(getTrafficJamsOnly(storage), true);
  setTrafficJamsOnly(false, storage);
  resetTrafficJamsOnlyCache();
});

test('setParams({ jamsOnly }) is independent of Uncovered, Jam viz, and Live | Sim', () => {
  restoreTrafficPrefs();
  const tilesBefore = trafficLayer.getStats().tilesFetched;
  assert.equal(trafficLayer.getParams().jamsOnly, false);

  trafficLayer.setParams({ jamsOnly: true });
  const afterOn = trafficLayer.getParams();
  assert.equal(afterOn.jamsOnly, true);
  assert.equal(afterOn.uncoveredRoads, 'sim');
  assert.equal(afterOn.jamViz, 'density');
  assert.equal(afterOn.trafficSource, 'sim');
  assert.equal(trafficLayer.getStats().jamsOnly, true);
  assert.equal(trafficLayer.getStats().tilesFetched, tilesBefore, 'no extra TomTom fetch');

  trafficLayer.setParams({ uncoveredRoads: 'hide' });
  assert.equal(trafficLayer.getParams().jamsOnly, true);
  assert.equal(trafficLayer.getParams().uncoveredRoads, 'hide');

  trafficLayer.setParams({ jamViz: 'heatline' });
  assert.equal(trafficLayer.getParams().jamsOnly, true);
  assert.equal(trafficLayer.getParams().jamViz, 'heatline');

  trafficLayer.setParams({ jamsOnly: 'nope' });
  assert.equal(trafficLayer.getParams().jamsOnly, true, 'invalid input is refused');

  trafficLayer.setParams({ jamsOnly: false });
  assert.equal(trafficLayer.getParams().jamsOnly, false);
  restoreTrafficPrefs();
});

test('the shipped layer hides Jams only in keyless sim and does not add an endpoint', () => {
  restoreTrafficPrefs();
  const controls = trafficLayer.getRowControls();
  assert.equal(controls.chips.some((chip) => chip.id === 'traffic-jams-only'), false,
    'jams-only chrome stays off in sim — those paths have no road.flow');

  const traffic = readFileSync(path.join(ROOT, 'src/data/traffic.js'), 'utf8');
  const filter = readFileSync(path.join(ROOT, 'src/data/trafficJamFilter.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const share = readFileSync(path.join(ROOT, 'src/sharelink.js'), 'utf8');
  const layerState = readFileSync(path.join(ROOT, 'src/data/layerState.js'), 'utf8');
  const manager = readFileSync(path.join(ROOT, 'src/data/manager.js'), 'utf8');

  assert.match(traffic, /from '\.\/trafficJamFilter\.js'/);
  assert.match(traffic, /trafficJamsOnlyControls\(/);
  assert.match(traffic, /trafficRoadSpawnsDots\(/);
  assert.match(traffic, /params\.jamsOnly/);
  assert.match(traffic, /setTrafficJamsOnly\(/);
  assert.match(filter, /flowBucket\(/);
  assert.doesNotMatch(filter, /\/api\//);
  assert.doesNotMatch(filter, /\/api\/tomtom/);
  assert.doesNotMatch(traffic, /\/api\/jam/);
  assert.equal(/jams-only|jamsOnly|Jams only/.test(html), false);
  assert.equal(/jams-only|jamsOnly|Jams only/.test(ui), false);
  assert.equal(share.includes('meridian.trafficJamsOnly'), false);
  assert.doesNotMatch(share, /params\.set\('jamsOnly'/);
  assert.match(layerState, /id: 'traffic', token: 't', disposition: 'enabled-only'/);
  assert.doesNotMatch(layerState, /jamsOnly/);
  assert.match(manager, /layer\.enabled \? \(declared\?\.chips \|\| \[\]\) : \[\]/);
  restoreTrafficPrefs();
});
