// PLAN 147 — FIRMS sensor chips. Client-only filter of already-fetched detections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FIRMS_SENSOR_FILTER,
  FIRMS_SENSOR_IDS,
  decodeFirmsSensorFilter,
  encodeFirmsSensorFilter,
  filterFiresBySensor,
  fireMatchesFirmsSensorFilter,
  firmsSensorChipModels,
  firmsSensorFamily,
  firmsSensorFilterFlags,
  normalizeFirmsSensorFilter,
  toggleFirmsSensor,
} from './firmsSensorFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const MIXED = Object.freeze([
  { index: 0, sensor: 'VIIRS', frp: 80, night: false },
  { index: 1, sensor: 'MODIS', frp: 90, night: true },
  { index: 2, sensor: 'AVHRR', frp: 70, night: true },
  { index: 3, sensor: '', frp: 60, night: true },
  { index: 4, sensor: 'VIIRS', frp: 8, night: true },
]);

test('sensor chips default all on and match the unfiltered set', () => {
  assert.deepEqual([...FIRMS_SENSOR_IDS], ['viirs', 'modis', 'other']);
  assert.equal(DEFAULT_FIRMS_SENSOR_FILTER, 'all');
  assert.deepEqual(normalizeFirmsSensorFilter(null), 'all');
  assert.deepEqual(normalizeFirmsSensorFilter('VMO'), 'all');
  assert.deepEqual(firmsSensorFilterFlags('all'), { viirs: true, modis: true, other: true });
  assert.deepEqual(
    filterFiresBySensor(MIXED, 'all').map((fire) => fire.sensor),
    MIXED.map((fire) => fire.sensor),
  );
});

test('MODIS off hides MODIS and keeps VIIRS; empty stays visible', () => {
  assert.equal(firmsSensorFamily('VIIRS'), 'viirs');
  assert.equal(firmsSensorFamily('MODIS'), 'modis');
  assert.equal(firmsSensorFamily('AVHRR'), 'other');
  assert.equal(firmsSensorFamily(''), null);
  assert.equal(toggleFirmsSensor('all', 'modis'), 'VO');
  assert.equal(toggleFirmsSensor('VO', 'modis'), 'all');
  assert.equal(toggleFirmsSensor('O', 'other'), '0');
  assert.deepEqual(
    filterFiresBySensor(MIXED, 'VO').map((fire) => fire.index),
    [0, 2, 3, 4],
  );
  assert.equal(fireMatchesFirmsSensorFilter({ sensor: 'MODIS' }, 'VO'), false);
  assert.equal(fireMatchesFirmsSensorFilter({ sensor: '' }, '0'), true);
  assert.equal(fireMatchesFirmsSensorFilter({ sensor: 'AVHRR' }, '0'), false);
});

test('bogus sensor tokens are refused; share tokens round-trip', () => {
  assert.equal(normalizeFirmsSensorFilter('bogus'), null);
  assert.equal(decodeFirmsSensorFilter('xyz'), null);
  assert.equal(encodeFirmsSensorFilter('all'), 'a');
  assert.equal(encodeFirmsSensorFilter('VO'), 'vo');
  assert.equal(decodeFirmsSensorFilter('vo'), 'VO');
  assert.equal(decodeFirmsSensorFilter('0'), '0');
});

test('FIRMS panel exposes VIIRS | MODIS | Other chips next to FRP', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const heatmap = readFileSync(path.join(ROOT, 'src/data/firmsHeatmap.js'), 'utf8');
  const panel = html.match(/<div id="fires-panel"[\s\S]*?<p id="fires-list-ack"/);
  assert.ok(panel, 'fires-panel markup is missing');
  assert.match(panel[0], /id="fires-sensor-chips"/);
  assert.match(panel[0], /data-firms-sensor="viirs"[^>]*>VIIRS</);
  assert.match(panel[0], /data-firms-sensor="modis"[^>]*>MODIS</);
  assert.match(panel[0], /data-firms-sensor="other"[^>]*>Other</);
  assert.ok(
    panel[0].indexOf('id="fires-sensor-chips"') < panel[0].indexOf('id="fires-list-meta"'),
    'sensor chips sit on the FIRES panel above the list meta',
  );
  assert.match(ui, /data-firms-sensor/);
  assert.match(ui, /setLayerParams\?\.\('local-firms'/);
  assert.match(heatmap, /FIRMS_FRP_FLOOR_CHIPS/);
  assert.match(heatmap, /firmsSensorChipModels/);
  assert.doesNotMatch(heatmap, /\/api\/firms\/sensor/);
  assert.equal(existsSync(path.join(ROOT, 'api/firms/sensor.js')), false);
});

test('FRP 50+ still ANDs with sensor chips; night detections that pass both stay', () => {
  const above50 = MIXED.filter((fire) => fire.frp >= 50);
  const anded = filterFiresBySensor(above50, 'VO').map((fire) => fire.index);
  assert.deepEqual(anded, [0, 2, 3]);
  assert.ok(!anded.includes(1), 'MODIS is hidden when its chip is off');
  assert.ok(!anded.includes(4), 'VIIRS 8 MW is hidden by the FRP floor');
  assert.ok(
    anded.every((index) => {
      const fire = MIXED.find((row) => row.index === index);
      return fire.frp >= 50 && fire.sensor !== 'MODIS';
    }),
    'FRP 50+ and sensor chips AND; night is not a hide reason on its own',
  );
  assert.equal(MIXED.find((fire) => fire.index === 2).night, true);
  assert.equal(MIXED.find((fire) => fire.index === 3).night, true);
  assert.equal(firmsSensorChipModels('all')[1].params.sensors, 'VO');
});
