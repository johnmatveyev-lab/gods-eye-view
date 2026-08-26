import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptFirmsRecords } from './firmsAdapt.js';
import { fireDetectionKey } from './firmsLabels.js';
import {
  FIRMS_ACKNOWLEDGEMENT,
  FIRMS_LIST_EMPTY_COPY,
  FIRMS_LIST_LIMIT,
  FIRMS_LIST_UNAVAILABLE_COPY,
  formatFireListRow,
  listNearestFires,
  resolveFireListView,
} from './firmsList.js';
import { resetFirmsListConfForTest } from './firmsListConfFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
resetFirmsListConfForTest();
const NOW = Date.UTC(2026, 6, 17, 4, 0);

function fire(overrides = {}) {
  return {
    index: 0,
    lat: 30.27,
    lon: -97.74,
    frp: 120,
    confidence: 0.9,
    satellite: 'N20',
    sensor: 'VIIRS',
    acqMs: NOW - 2 * 3600000,
    ...overrides,
  };
}

test('listNearestFires caps at 50 and keeps the closest detections', () => {
  const origin = { lat: 30.27, lon: -97.74 };
  const fires = [];
  for (let i = 0; i < 80; i += 1) {
    fires.push(fire({
      index: i,
      lat: 30.27 + i * 0.2,
      lon: -97.74,
      frp: 10 + i,
    }));
  }
  const nearest = listNearestFires(fires, origin, FIRMS_LIST_LIMIT);
  assert.equal(nearest.length, 50);
  assert.equal(nearest[0].lat, 30.27);
  assert.equal(nearest[49].lat, 30.27 + 49 * 0.2);
  assert.ok(nearest[0].distanceKm < nearest[49].distanceKm);
  assert.ok(!nearest.some((row) => row.lat === 30.27 + 79 * 0.2));
});

test('listNearestFires uses the existing /api/firms lat/lon payload shape', () => {
  const records = adaptFirmsRecords([
    {
      lat: 38.99488,
      lon: -121.67046,
      frp: 0.53,
      confidence: 'n',
      brightness: 303.6,
      daynight: 'N',
      acqDate: '2026-07-16',
      acqTime: '1006',
      satellite: 'N20',
      instrument: 'VIIRS',
    },
    {
      lat: -33.9,
      lon: 18.4,
      frp: 40,
      confidence: 'h',
      daynight: 'D',
      acqDate: '2026-07-16',
      acqTime: '1100',
      satellite: 'N21',
      instrument: 'VIIRS',
    },
  ]);
  const rows = listNearestFires(records, { lat: 39.0, lon: -121.67 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].lat, 38.99488);
  assert.equal(rows[0].lon, -121.67046);
  assert.equal(rows[0].id, fireDetectionKey(records[0]));
  assert.ok(rows[0].distanceKm < rows[1].distanceKm);
});

test('listNearestFires skips non-finite coordinates and an empty payload is empty', () => {
  assert.deepEqual(listNearestFires(null, { lat: 0, lon: 0 }), []);
  assert.deepEqual(listNearestFires([fire({ lat: Number.NaN })], { lat: 0, lon: 0 }), []);
});

test('formatFireListRow carries FRP, distance, confidence, age, and satellite', () => {
  const row = formatFireListRow(fire({ frp: 1520.27 }), { lat: 30.27, lon: -97.74 }, NOW);
  assert.match(row.title, /1520 MW/);
  assert.match(row.detail, /high/);
  assert.match(row.detail, /2h/);
  assert.match(row.detail, /N20/);
  assert.match(row.detail, /km/);
  assert.equal(row.id, fireDetectionKey(fire({ frp: 1520.27 })));
});

test('no-key and empty states are unavailable copy, not a hang', () => {
  const noKey = resolveFireListView({ keyRequired: true, fires: [], loading: false });
  assert.equal(noKey.status, 'unavailable');
  assert.equal(noKey.rows.length, 0);
  assert.equal(noKey.copy, FIRMS_LIST_UNAVAILABLE_COPY);
  assert.match(noKey.copy, /unavailable/i);
  assert.equal(noKey.acknowledgement, FIRMS_ACKNOWLEDGEMENT);

  const empty = resolveFireListView({ keyRequired: false, fires: [], loading: false });
  assert.equal(empty.status, 'unavailable');
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.copy, FIRMS_LIST_EMPTY_COPY);
  assert.match(empty.copy, /unavailable/i);

  const loading = resolveFireListView({ keyRequired: false, fires: [], loading: true });
  assert.equal(loading.status, 'loading');
  assert.equal(loading.rows.length, 0);
  assert.notEqual(loading.copy, FIRMS_LIST_UNAVAILABLE_COPY);
});

test('ready state lists nearest rows and keeps the FIRMS acknowledgement', () => {
  const view = resolveFireListView({
    keyRequired: false,
    loading: false,
    fires: [fire(), fire({ index: 1, lat: 40, lon: -74, frp: 9 })],
    camera: { lat: 30.27, lon: -97.74 },
    now: NOW,
  });
  assert.equal(view.status, 'ready');
  assert.equal(view.rows.length, 2);
  assert.equal(view.rows[0].lat, 30.27);
  assert.equal(view.acknowledgement, FIRMS_ACKNOWLEDGEMENT);
  assert.match(FIRMS_ACKNOWLEDGEMENT, /NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.match(FIRMS_ACKNOWLEDGEMENT, /earthdata\.nasa\.gov\/firms/);
});

test('clicking a list row requests the current fire camera helper', async () => {
  const Cesium = await import('cesium');
  const { createFirmsHeatmapLayer } = await import('./firmsHeatmap.js');
  const { requestWorldFocus, WORLD_FOCUS_REQUEST_EVENT } = await import('../worldFocus.js');
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const priorWindow = globalThis.window;
  const priorProjection = Cesium.SceneTransforms.worldToWindowCoordinates;
  const target = new EventTarget();
  globalThis.window = target;
  Cesium.SceneTransforms.worldToWindowCoordinates = () => ({ x: 200, y: 300 });
  const requests = [];
  target.addEventListener(WORLD_FOCUS_REQUEST_EVENT, (event) => requests.push(event.detail));

  const layer = createFirmsHeatmapLayer({
    id: 'local-firms',
    name: 'FIRMS Active Fires',
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {}, hitTest() { return null; } },
    screenSpaceEventHandlerFactory: () => ({ setInputAction() {}, destroy() {} }),
  });
  const selected = fire({ index: 3, lat: 34.05, lon: -118.25, frp: 410 });
  layer._bindInteractionForTest({
    scene: {
      pick() { return null; },
      canvas: { clientWidth: 800, clientHeight: 600 },
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
    },
    dataSources: { add() {}, remove() {} },
  }, [selected, fire({ index: 4, lat: 0, lon: 0 })]);

  try {
    const rows = listNearestFires([selected], { lat: 34.05, lon: -118.25 });
    assert.equal(rows.length, 1);
    const focused = layer.focusFireByKey(rows[0].id);
    assert.equal(focused, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].kind, 'fire');
    assert.equal(requests[0].id, fireDetectionKey(selected));
    assert.ok(requests[0].position);
    assert.equal(requestWorldFocus.name, 'requestWorldFocus');
  } finally {
    Cesium.SceneTransforms.worldToWindowCoordinates = priorProjection;
    if (hadWindow) globalThis.window = priorWindow;
    else delete globalThis.window;
  }
});

test('client list path never fetches NASA FIRMS and does not touch traffic Live/Sim', () => {
  const listSrc = readFileSync(path.join(ROOT, 'src/data/firmsList.js'), 'utf8');
  const panelSrc = readFileSync(path.join(ROOT, 'src/data/firmsListPanel.js'), 'utf8');
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  assert.doesNotMatch(listSrc, /firms\.modaps\.eosdis\.nasa\.gov/);
  assert.doesNotMatch(panelSrc, /firms\.modaps\.eosdis\.nasa\.gov/);
  assert.doesNotMatch(listSrc, /opensky-network\.org|news\.google\.com|submarinecablemap/i);
  assert.doesNotMatch(panelSrc, /opensky-network\.org|news\.google\.com|submarinecablemap/i);
  assert.doesNotMatch(listSrc, /from '\.\/traffic\.js'|setLayerParams\('traffic'/);
  assert.doesNotMatch(panelSrc, /from '\.\/traffic\.js'|liveMode|setLayerParams\('traffic'/);
  assert.match(heatmap, /const FIRMS_API_URL = '\/api\/firms'/);
  assert.doesNotMatch(heatmap, /firms\.modaps\.eosdis\.nasa\.gov/);
});

test('Fires list markup is its own left-stack panel, not launches or contacts', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const firesStart = html.indexOf('id="fires-panel"');
  const missionsStart = html.indexOf('id="space-mission-roster"');
  const contactsStart = html.indexOf('id="military-awareness-panel"');
  assert.ok(firesStart > 0, 'fires-panel must exist');
  assert.ok(missionsStart > 0 && contactsStart > 0);
  const firesBlock = html.slice(firesStart, firesStart + 6500);
  assert.match(firesBlock, /panel-title">FIRES</);
  assert.match(firesBlock, /id="fires-list"/);
  assert.match(firesBlock, /NASA's Fire Information for Resource Management System \(FIRMS\)/);
  assert.doesNotMatch(firesBlock, /space-mission-roster|military-awareness|launches-panel|CONTACTS|AVAILABLE MISSIONS/);
  assert.ok(
    html.indexOf('id="left-panel-stack"') < firesStart
      && firesStart < html.indexOf('id="right-context-rail"'),
    'Fires list belongs in the left stack, not Context',
  );
  assert.ok(!existsSync(path.join(ROOT, 'quantum-earth')));
});
