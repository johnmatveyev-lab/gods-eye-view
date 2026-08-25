// src/data/firmsAdapt.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptFirmsRecords,
  normalizeConfidence,
  normalizeSensor,
  parseAcquisitionMs,
} from './firmsAdapt.js';
import {
  DEFAULT_FIRMS_SENSOR_FILTER,
  filterFiresBySensor,
  fireMatchesFirmsSensorFilter,
  firmsSensorFamily,
} from './firmsSensorFilter.js';
import { filterFiresBySatellite } from './firmsSatelliteFilter.js';

/** A proxy record as served by /api/firms (firmsCsv.js parser shape). */
const proxyRecord = (overrides = {}) => ({
  lat: 38.99488,
  lon: -121.67046,
  frp: 0.53,
  confidence: 'n',
  brightness: 303.6,
  brightnessTi5: 290.73,
  daynight: 'N',
  acqDate: '2026-07-16',
  acqTime: '1006',
  satellite: 'N20',
  instrument: 'VIIRS',
  ...overrides,
});

test('adapter maps a proxy record into the internal fire-record shape', () => {
  const [fire] = adaptFirmsRecords([proxyRecord()]);
  assert.equal(fire.index, 0);
  assert.equal(fire.lat, 38.99488);
  assert.equal(fire.lon, -121.67046);
  assert.equal(fire.frp, 0.53);
  assert.equal(fire.confidence, 0.6); // 'n' (nominal) → 0.6
  assert.equal(fire.brightness, 303.6);
  assert.equal(fire.brightnessTi5, 290.73);
  assert.equal(fire.night, true); // daynight 'N'
  assert.equal(fire.daynight, 'N');
  assert.equal(fire.acqMs, Date.UTC(2026, 6, 16, 10, 6));
  assert.equal(fire.sensor, 'VIIRS');
  assert.equal(fire.satellite, 'N20');
  assert.equal(fire.contextEntity, null);
  assert.equal(fire.position, null);
});

test('categorical confidence → 0..1 (l/n/h and word forms)', () => {
  assert.equal(normalizeConfidence('l'), 0.3);
  assert.equal(normalizeConfidence('n'), 0.6);
  assert.equal(normalizeConfidence('h'), 0.9);
  assert.equal(normalizeConfidence('low'), 0.3);
  assert.equal(normalizeConfidence('nominal'), 0.6);
  assert.equal(normalizeConfidence('high'), 0.9);
});

test('numeric confidence (MODIS-style) → value/100, clamped', () => {
  assert.equal(normalizeConfidence(85), 0.85);
  assert.equal(normalizeConfidence('85'), 0.85);
  assert.equal(normalizeConfidence(120), 1);
  assert.equal(normalizeConfidence('garbage'), 0);
});

test('unpadded acq_time parses in the adapter path ("45" = 00:45Z)', () => {
  const [fire] = adaptFirmsRecords([proxyRecord({ acqTime: '45' })]);
  assert.equal(fire.acqMs, Date.UTC(2026, 6, 16, 0, 45));
});

test('parseAcquisitionMs: memo cache is honored, invalid input → 0', () => {
  const cache = new Map();
  assert.equal(parseAcquisitionMs('2026-07-16', '1006', cache), Date.UTC(2026, 6, 16, 10, 6));
  assert.equal(cache.size, 1);
  assert.equal(parseAcquisitionMs('2026-07-16', '1006', cache), Date.UTC(2026, 6, 16, 10, 6));
  assert.equal(parseAcquisitionMs(undefined, '1006', cache), 0);
});

test('parseAcquisitionMs values compare against a 6h / 12h / 24h age window', () => {
  const now = Date.UTC(2026, 7, 25, 16, 0);
  const recent = parseAcquisitionMs('2026-08-25', '1400'); // 2h before
  const mid = parseAcquisitionMs('2026-08-25', '0600'); // 10h before
  const older = parseAcquisitionMs('2026-08-24', '2000'); // 20h before
  assert.equal(recent, now - 2 * 3600000);
  assert.equal(mid, now - 10 * 3600000);
  assert.equal(older, now - 20 * 3600000);
  assert.ok(recent >= now - 6 * 3600000);
  assert.ok(mid < now - 6 * 3600000);
  assert.ok(mid >= now - 12 * 3600000);
  assert.ok(older < now - 12 * 3600000);
  assert.ok(older >= now - 24 * 3600000);
});

test('unparseable acquisition is 0 so an age window can keep it visible', () => {
  assert.equal(parseAcquisitionMs('', '1006'), 0);
  assert.equal(parseAcquisitionMs('not-a-date', '1006'), 0);
  assert.equal(parseAcquisitionMs('2026-08-25', undefined), Date.UTC(2026, 7, 25, 0, 0));
});

test('daynight "D" → night false', () => {
  const [fire] = adaptFirmsRecords([proxyRecord({ daynight: 'D' })]);
  assert.equal(fire.night, false);
  assert.equal(fire.daynight, 'D');
});

test('daynight "N" stays night; missing/unknown daynight is blank', () => {
  const [night] = adaptFirmsRecords([proxyRecord({ daynight: 'N' })]);
  assert.equal(night.night, true);
  assert.equal(night.daynight, 'N');

  const [missing] = adaptFirmsRecords([proxyRecord({ daynight: undefined })]);
  assert.equal(missing.night, false);
  assert.equal(missing.daynight, '');

  const [unknown] = adaptFirmsRecords([proxyRecord({ daynight: 'X' })]);
  assert.equal(unknown.night, false);
  assert.equal(unknown.daynight, '');
});

test('sensor normalization: VIIRS/MODIS detected, junk truncated', () => {
  assert.equal(normalizeSensor('VIIRS'), 'VIIRS');
  assert.equal(normalizeSensor('some_modis_file'), 'MODIS');
  assert.equal(normalizeSensor(''), '');
  assert.equal(normalizeSensor('ABCDEFGHIJKLMNOP'), 'ABCDEFGHIJKL'); // 12-char cap
});

test('sensor chips: empty stays visible; non-empty unknown is Other', () => {
  assert.equal(firmsSensorFamily('VIIRS'), 'viirs');
  assert.equal(firmsSensorFamily('some_modis_file'), 'modis');
  assert.equal(firmsSensorFamily(''), null);
  assert.equal(firmsSensorFamily(null), null);
  assert.equal(firmsSensorFamily('AVHRR'), 'other');
  assert.equal(firmsSensorFamily('ABCDEFGHIJKLMNOP'), 'other');

  const adapted = adaptFirmsRecords([
    proxyRecord({ instrument: 'VIIRS' }),
    proxyRecord({ instrument: 'MODIS' }),
    proxyRecord({ instrument: 'AVHRR' }),
    proxyRecord({ instrument: '' }),
  ]);
  assert.deepEqual(adapted.map((fire) => fire.sensor), ['VIIRS', 'MODIS', 'AVHRR', '']);
  assert.equal(fireMatchesFirmsSensorFilter(adapted[3], { other: false }), true);
  assert.equal(fireMatchesFirmsSensorFilter(adapted[2], { other: false }), false);
  assert.deepEqual(
    filterFiresBySensor(adapted, 'VO').map((fire) => fire.sensor),
    ['VIIRS', 'AVHRR', ''],
  );
  assert.deepEqual(
    filterFiresBySensor(adapted, DEFAULT_FIRMS_SENSOR_FILTER).map((fire) => fire.sensor),
    ['VIIRS', 'MODIS', 'AVHRR', ''],
  );
  assert.deepEqual(
    filterFiresBySatellite(filterFiresBySensor(adapted, 'VO'), 'all').map((fire) => fire.sensor),
    ['VIIRS', 'AVHRR', ''],
    'satellite all-on ANDs with sensor without changing the set',
  );
  assert.deepEqual(
    filterFiresBySatellite(filterFiresBySensor(adapted, 'VO'), 'N20').map((fire) => fire.sensor),
    [],
    'N20 off hides the adapter-stored N20 detections that passed the sensor chips',
  );
});

test('records with non-finite lat/lon are skipped; index stays sequential', () => {
  const fires = adaptFirmsRecords([
    proxyRecord(),
    proxyRecord({ lat: 'nope' }),
    proxyRecord({ lon: Infinity }),
    proxyRecord({ lat: 40.1 }),
  ]);
  assert.equal(fires.length, 2);
  assert.deepEqual(fires.map((f) => f.index), [0, 1]);
});

test('non-finite frp/brightness → 0; empty input → []', () => {
  const [fire] = adaptFirmsRecords([proxyRecord({ frp: 'n/a', brightness: undefined, brightnessTi5: undefined })]);
  assert.equal(fire.frp, 0);
  assert.equal(fire.brightness, 0);
  assert.equal(fire.brightnessTi5, 0);
  assert.deepEqual(adaptFirmsRecords([]), []);
  assert.deepEqual(adaptFirmsRecords(null), []);
});
