// PLAN 163 — FIRMS satellite chips. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  DEFAULT_FIRMS_SATELLITE_FILTER,
  FIRMS_SATELLITE_OTHER_CHIP_ID,
  compactFirmsSatelliteName,
  decodeFirmsSatelliteFilter,
  encodeFirmsSatelliteFilter,
  filterFiresBySatellite,
  fireMatchesFirmsSatelliteFilter,
  firmsSatelliteChipId,
  firmsSatelliteChipModels,
  firmsSatelliteFilterFlags,
  listFirmsSatelliteChipIds,
  normalizeFirmsSatelliteFilter,
  toggleFirmsSatellite,
} from './firmsSatelliteFilter.js';
import { filterFiresBySensor } from './firmsSensorFilter.js';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';
import { adaptFirmsRecords } from './firmsAdapt.js';
import { unregisterSpriteCollection } from './spriteOrder.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUSTIN = { lon: -97.7, lat: 30.2 };
const TOKYO = { lon: 139.7, lat: 35.7 };
const DETECTION_HEIGHT_M = 1_500_000;

const MIXED = Object.freeze([
  { index: 0, satellite: 'N20', sensor: 'VIIRS', frp: 80, night: false },
  { index: 1, satellite: 'N21', sensor: 'VIIRS', frp: 90, night: true },
  { index: 2, satellite: 'Aqua', sensor: 'MODIS', frp: 70, night: true },
  { index: 3, satellite: '', sensor: 'VIIRS', frp: 60, night: true },
  { index: 4, satellite: 'N20', sensor: 'VIIRS', frp: 8, night: true },
]);
const CHIP_IDS = ['AQUA', 'N20', 'N21', FIRMS_SATELLITE_OTHER_CHIP_ID];

function recentAcqFields(hoursAgo = 2) {
  const date = new Date(Date.now() - hoursAgo * 3600000);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return { acqDate: `${yyyy}-${mm}-${dd}`, acqTime: `${hh}${min}` };
}

function rawFire(lat, lon, frp, overrides = {}) {
  return {
    lat,
    lon,
    frp,
    confidence: 'h',
    brightness: 340,
    daynight: 'D',
    ...recentAcqFields(),
    instrument: 'VIIRS',
    satellite: 'N20',
    ...overrides,
  };
}

function canvasStub() {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop() {} }),
      fillStyle: null,
      fillRect() {},
    }),
    toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=',
  };
}

class MockEvent {
  constructor() { this.listeners = new Set(); }
  addEventListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function createHarness(rawFires, { height = DETECTION_HEIGHT_M } = {}) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalProject = Cesium.SceneTransforms.worldToWindowCoordinates;
  let fetchCount = 0;
  let lastUrl = '';
  let nextResponse = {
    ok: true,
    status: 200,
    json: async () => ({ fires: rawFires, fetchedAt: Date.now() }),
  };

  globalThis.fetch = async (url) => {
    fetchCount += 1;
    lastUrl = String(url);
    if (typeof nextResponse === 'function') return nextResponse();
    return nextResponse;
  };
  globalThis.window = globalThis.window || {};
  globalThis.document = { createElement: () => canvasStub() };

  const slots = new Map();
  Cesium.SceneTransforms.worldToWindowCoordinates = (scene, position, result) => {
    if (!slots.has(position)) slots.set(position, slots.size);
    const slot = slots.get(position);
    const out = result || new Cesium.Cartesian2();
    out.x = 100 + (slot % 10) * 200;
    out.y = 100 + Math.floor(slot / 10) * 200;
    return out;
  };

  const preRender = new MockEvent();
  const moveEnd = new MockEvent();
  const primitives = [];
  const viewer = {
    dataSources: { add: (value) => value, remove: () => {} },
    camera: {
      moveEnd,
      positionWC: Cesium.Cartesian3.fromDegrees(AUSTIN.lon, AUSTIN.lat, height),
      directionWC: new Cesium.Cartesian3(0, 0, -1),
      positionCartographic: { height },
    },
    scene: {
      canvas: { clientWidth: 2000, clientHeight: 2000 },
      preRender,
      primitives: {
        add: (value) => { primitives.push(value); return value; },
        remove: () => {},
        contains: () => false,
      },
      frameState: { mode: Cesium.SceneMode.SCENE3D, mapProjection: new Cesium.GeographicProjection() },
      mapProjection: new Cesium.GeographicProjection(),
    },
  };

  const layer = createFirmsHeatmapLayer({
    id: 'firms',
    name: 'FIRMS',
    overlayHost: {
      setEntries: () => {},
      setVisible: () => {},
      clearSource: () => {},
    },
    screenSpaceEventHandlerFactory: () => ({ setInputAction() {}, destroy() {} }),
  });

  return {
    layer,
    viewer,
    get fetchCount() { return fetchCount; },
    get lastUrl() { return lastUrl; },
    detectionCount() {
      const bb = primitives[0];
      return bb ? bb.length : 0;
    },
    cleanup() {
      layer.destroy(viewer);
      unregisterSpriteCollection('firms');
      Cesium.SceneTransforms.worldToWindowCoordinates = originalProject;
      globalThis.fetch = originalFetch;
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
    },
  };
}

function mixedSatelliteFires() {
  return [
    rawFire(AUSTIN.lat, AUSTIN.lon, 80, { satellite: 'N20', instrument: 'VIIRS', daynight: 'D' }),
    rawFire(AUSTIN.lat + 1, AUSTIN.lon + 1, 90, { satellite: 'N21', instrument: 'VIIRS', daynight: 'N' }),
    rawFire(TOKYO.lat, TOKYO.lon, 70, { satellite: 'Aqua', instrument: 'MODIS', daynight: 'N' }),
    rawFire(TOKYO.lat + 1, TOKYO.lon + 1, 12, { satellite: 'N20', instrument: 'VIIRS', daynight: 'N' }),
    rawFire(TOKYO.lat + 2, TOKYO.lon + 2, 65, { satellite: '', instrument: 'VIIRS', daynight: 'N' }),
  ];
}

test('satellite chips default all on and match the unfiltered set', () => {
  assert.equal(DEFAULT_FIRMS_SATELLITE_FILTER, 'all');
  assert.equal(FIRMS_SATELLITE_OTHER_CHIP_ID, 'other');
  assert.deepEqual(listFirmsSatelliteChipIds(MIXED), CHIP_IDS);
  assert.deepEqual(normalizeFirmsSatelliteFilter(null, CHIP_IDS), 'all');
  assert.deepEqual(firmsSatelliteFilterFlags('all', CHIP_IDS), {
    AQUA: true, N20: true, N21: true, other: true,
  });
  assert.deepEqual(
    filterFiresBySatellite(MIXED, 'all').map((fire) => fire.satellite),
    MIXED.map((fire) => fire.satellite),
  );
});

test('compact names plus Other for missing or unknown spacecraft', () => {
  assert.equal(compactFirmsSatelliteName('N20'), 'N20');
  assert.equal(compactFirmsSatelliteName('NOAA-20'), 'N20');
  assert.equal(compactFirmsSatelliteName('N21'), 'N21');
  assert.equal(compactFirmsSatelliteName('N'), 'SNPP');
  assert.equal(compactFirmsSatelliteName('Aqua'), 'AQUA');
  assert.equal(compactFirmsSatelliteName('Terra'), 'TERRA');
  assert.equal(compactFirmsSatelliteName(''), '');
  assert.equal(firmsSatelliteChipId({ satellite: 'N20' }), 'N20');
  assert.equal(firmsSatelliteChipId({ satellite: 'NOAA-20' }), 'N20');
  assert.equal(firmsSatelliteChipId({ satellite: '' }), FIRMS_SATELLITE_OTHER_CHIP_ID);
  assert.equal(firmsSatelliteChipId({}), FIRMS_SATELLITE_OTHER_CHIP_ID);
  assert.equal(firmsSatelliteChipId(null), FIRMS_SATELLITE_OTHER_CHIP_ID);
});

test('N20 off hides N20 detections; Other off hides unlabeled', () => {
  assert.equal(toggleFirmsSatellite('all', 'N20', CHIP_IDS), 'N20');
  assert.equal(toggleFirmsSatellite('N20', 'N20', CHIP_IDS), 'all');
  assert.equal(toggleFirmsSatellite('other', 'other', CHIP_IDS), 'all');
  const lastOff = CHIP_IDS.reduce(
    (filter, id) => toggleFirmsSatellite(filter, id, CHIP_IDS),
    DEFAULT_FIRMS_SATELLITE_FILTER,
  );
  assert.equal(lastOff, '0');
  assert.deepEqual(
    filterFiresBySatellite(MIXED, 'N20').map((fire) => fire.index),
    [1, 2, 3],
  );
  assert.equal(fireMatchesFirmsSatelliteFilter({ satellite: 'N20' }, 'N20'), false);
  assert.equal(fireMatchesFirmsSatelliteFilter({ satellite: 'NOAA-20' }, 'N20'), false);
  assert.equal(fireMatchesFirmsSatelliteFilter({ satellite: 'N21' }, 'N20'), true);
  assert.deepEqual(
    filterFiresBySatellite(MIXED, 'other').map((fire) => fire.index),
    [0, 1, 2, 4],
  );
  assert.equal(fireMatchesFirmsSatelliteFilter({ satellite: '' }, 'other'), false);
  assert.equal(fireMatchesFirmsSatelliteFilter({ satellite: '' }, '0'), false);
  assert.equal(fireMatchesFirmsSatelliteFilter({ satellite: 'N20' }, '0'), false);
});

test('bogus satellite tokens are refused; share tokens round-trip', () => {
  assert.equal(normalizeFirmsSatelliteFilter('foo.bar'), null);
  assert.equal(normalizeFirmsSatelliteFilter('n20_other'), null);
  assert.equal(decodeFirmsSatelliteFilter('xyz!'), null);
  assert.equal(encodeFirmsSatelliteFilter('all'), 'a');
  assert.equal(encodeFirmsSatelliteFilter('N20'), 'n20');
  assert.equal(encodeFirmsSatelliteFilter('N20,other'), 'n20,other');
  assert.equal(decodeFirmsSatelliteFilter('n20'), 'N20');
  assert.equal(decodeFirmsSatelliteFilter('n20,other'), 'N20,other');
  assert.equal(decodeFirmsSatelliteFilter('0'), '0');
  assert.equal(decodeFirmsSatelliteFilter('a'), 'all');
});

test('FRP 50+ still ANDs with satellite chips; other FIRMS chips still apply', () => {
  const above50 = MIXED.filter((fire) => fire.frp >= 50);
  const anded = filterFiresBySatellite(above50, 'N20').map((fire) => fire.index);
  assert.deepEqual(anded, [1, 2, 3]);
  assert.ok(!anded.includes(0), 'N20 80 MW is hidden when its chip is off');
  assert.ok(!anded.includes(4), 'N20 8 MW is hidden by the FRP floor');
  const sensorAndSat = filterFiresBySatellite(
    filterFiresBySensor(above50, 'VO'),
    'N20',
  ).map((fire) => fire.index);
  assert.deepEqual(sensorAndSat, [1, 3], 'sensor AND satellite AND FRP');
  assert.equal(firmsSatelliteChipModels('all', MIXED)[1].params.satelliteFilter, 'N20');
});

test('adapter already stores fire.satellite; chips read that field', () => {
  const adapted = adaptFirmsRecords([
    rawFire(AUSTIN.lat, AUSTIN.lon, 80, { satellite: 'N20' }),
    rawFire(AUSTIN.lat, AUSTIN.lon, 70, { satellite: 'NOAA-20' }),
    rawFire(AUSTIN.lat, AUSTIN.lon, 60, { satellite: '' }),
  ]);
  assert.equal(adapted[0].satellite, 'N20');
  assert.equal(adapted[1].satellite, 'NOAA-20');
  assert.equal(adapted[2].satellite, '');
  assert.deepEqual(listFirmsSatelliteChipIds(adapted), ['N20', FIRMS_SATELLITE_OTHER_CHIP_ID]);
  assert.deepEqual(
    filterFiresBySatellite(adapted, 'N20').map((fire) => fire.frp),
    [60],
  );
});

test('All satellite chips on matches the current overlay; N20 off hides N20', async () => {
  const harness = createHarness(mixedSatelliteFires());
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.getParams().satelliteFilter, 'all');
    assert.equal(harness.layer.getStats().count, 5);
    assert.equal(harness.detectionCount(), 5);
    assert.deepEqual(
      harness.layer.getRowControls().chips.filter((chip) => chip.group === 'Sat').map((chip) => chip.label),
      ['AQUA', 'N20', 'N21', 'Other'],
    );

    assert.equal(harness.layer.setParams({ satelliteFilter: 'N20' }), true);
    assert.equal(harness.layer.getStats().count, 3, 'N20 off keeps N21 / Aqua / unlabeled');
    assert.ok(harness.layer.getNearbyFires({ origin: AUSTIN }).every((fire) => fire.satellite !== 'N20'));
    assert.equal(harness.layer.getNearbyFires({ origin: AUSTIN }).length, 3);
    assert.equal(harness.layer.getFireListView({ camera: AUSTIN }).rows.length, 3);
  } finally {
    harness.cleanup();
  }
});

test('Other off hides unlabeled detections', async () => {
  const harness = createHarness(mixedSatelliteFires());
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.layer.setParams({ satelliteFilter: 'other' }), true);
    assert.equal(harness.layer.getStats().count, 4);
    assert.ok(harness.layer.getNearbyFires({ origin: AUSTIN }).every((fire) => fire.satellite));
    assert.equal(harness.layer.setParams({ satelliteFilter: 'bogus!' }), false);
    assert.equal(harness.layer.getParams().satelliteFilter, 'other');
  } finally {
    harness.cleanup();
  }
});

test('chip change re-filters cached fires without a new /api/firms call', async () => {
  const harness = createHarness(mixedSatelliteFires());
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.fetchCount, 1);
    assert.match(harness.lastUrl, /\/api\/firms$/);

    harness.layer.setParams({ satelliteFilter: 'N20' });
    harness.layer.setParams({ satelliteFilter: 'other' });
    harness.layer.setParams({ satelliteFilter: 'all' });
    assert.equal(harness.fetchCount, 1, 'satellite chips must not refetch NASA FIRMS');
    assert.equal(harness.detectionCount(), 5);
  } finally {
    harness.cleanup();
  }
});

test('FRP 50+ and sensor chips still AND with the satellite chips', async () => {
  const harness = createHarness(mixedSatelliteFires());
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    assert.equal(harness.detectionCount(), 5);

    harness.layer.setParams({ frpFloor: '50' });
    assert.equal(harness.layer.getStats().count, 4, 'FRP 50+ drops the 12 MW N20');

    harness.layer.setParams({ sensors: 'VO' });
    assert.equal(harness.layer.getStats().count, 3, '50+ AND VIIRS|Other drops Aqua MODIS');

    harness.layer.setParams({ satelliteFilter: 'N20' });
    assert.equal(harness.layer.getStats().count, 2, '50+ AND sensor AND N20-off keeps N21 + unlabeled');
    assert.deepEqual(
      harness.layer.getNearbyFires({ origin: AUSTIN }).map((row) => row.satellite).sort(),
      ['', 'N21'],
    );
    assert.equal(harness.fetchCount, 1, 'AND chip changes still do not refetch');
  } finally {
    harness.cleanup();
  }
});

test('refresh keeps the chip set and still does not invent a FIRMS endpoint', async () => {
  const harness = createHarness(mixedSatelliteFires());
  try {
    harness.layer.init(harness.viewer);
    await harness.layer.enable(harness.viewer);
    harness.layer.setParams({ satelliteFilter: 'N20' });
    assert.equal(harness.layer.getParams().satelliteFilter, 'N20');
    assert.deepEqual(
      harness.layer.getRowControls().chips.filter((chip) => chip.group === 'Sat').map((chip) => chip.label),
      ['AQUA', 'N20', 'N21', 'Other'],
    );
    assert.equal(harness.layer.getStats().count, 3);
    await harness.layer.update();
    assert.equal(harness.fetchCount, 2, 'scheduled refresh may refetch the same /api/firms payload');
    assert.match(harness.lastUrl, /\/api\/firms$/);
    assert.equal(harness.layer.getParams().satelliteFilter, 'N20');
    assert.deepEqual(
      harness.layer.getRowControls().chips.filter((chip) => chip.group === 'Sat').map((chip) => chip.label),
      ['AQUA', 'N20', 'N21', 'Other'],
    );
    assert.equal(harness.layer.getStats().count, 3);
    assert.doesNotMatch(harness.lastUrl, /satellite/);
    const n20Chip = harness.layer.getRowControls().chips.find((chip) => chip.id === 'sat-N20');
    assert.equal(n20Chip.active, false);
  } finally {
    harness.cleanup();
  }
});

test('row chips rebuild from in-memory names and write satelliteFilter params', () => {
  const layer = createFirmsHeatmapLayer({ id: 'firms', name: 'FIRMS' });
  const empty = layer.getRowControls().chips.filter((chip) => chip.params.satelliteFilter);
  assert.deepEqual(empty.map((chip) => chip.label), ['Other']);
  assert.equal(empty[0].active, true);
  assert.equal(empty[0].group, 'Sat');
  const models = firmsSatelliteChipModels('all', MIXED);
  assert.deepEqual(models.map((chip) => chip.label), ['AQUA', 'N20', 'N21', 'Other']);
  assert.ok(models.every((chip) => chip.active === true));
  assert.equal(models.find((chip) => chip.id === 'sat-N20').params.satelliteFilter, 'N20');
  layer.setParams({ satelliteFilter: 'N20' });
  const after = layer.getRowControls().chips.filter((chip) => chip.group === 'Sat');
  assert.equal(after.find((chip) => chip.id === 'sat-other').active, true);
  assert.equal(layer.getParams().satelliteFilter, 'N20');
});

test('FIRMS panel exposes satellite chips and hides them when Fires is off', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const panel = html.match(/<div id="fires-panel"[\s\S]*?<p id="fires-list-ack"/);
  assert.ok(panel, 'fires-panel markup is missing');
  assert.match(panel[0], /id="fires-satellite-chips"/);
  assert.match(panel[0], /aria-label="FIRMS satellite"/);
  assert.match(panel[0], /id="fires-satellite-chips"[^>]*hidden/);
  assert.ok(
    panel[0].indexOf('id="fires-sensor-chips"') < panel[0].indexOf('id="fires-satellite-chips"'),
    'satellite chips sit next to sensor chips on the FIRES panel',
  );
  assert.ok(
    panel[0].indexOf('id="fires-satellite-chips"') < panel[0].indexOf('id="fires-list-meta"'),
    'satellite chips sit on the FIRES panel above the list meta',
  );
  assert.match(ui, /data-firms-satellite/);
  assert.match(ui, /setLayerParams\?\.\('local-firms'/);
  assert.match(ui, /satelliteFilter/);
  assert.match(ui, /isEnabled\?\.\('local-firms'\)/);
  assert.match(heatmap, /firmsSatelliteChipModels/);
  assert.match(heatmap, /filterFiresBySatellite/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/satellite/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/satellite.js')), false);
  assert.doesNotMatch(heatmap, /opensky-network\.org|google\.com\/news|telegeography|quantum-earth/i);
});
