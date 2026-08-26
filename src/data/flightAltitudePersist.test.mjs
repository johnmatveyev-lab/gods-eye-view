import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { persistAviationAltitudeM } from './aircraftMeta.js';
import { aircraftMatchesAltitudeBand } from './flightAltitudeBand.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const flightsSrc = readFileSync(path.join(ROOT, 'src/data/flights.js'), 'utf8');
const militarySrc = readFileSync(path.join(ROOT, 'src/data/militaryFlights.js'), 'utf8');

test('missing baro + finite geo stores the geo metres (not 10000); missing both stores null', () => {
  assert.equal(
    persistAviationAltitudeM(null, 366),
    366,
    'missing baro + finite geo persists geo metres',
  );
  assert.equal(
    persistAviationAltitudeM(undefined, 366.2),
    366.2,
  );
  assert.equal(
    persistAviationAltitudeM(Number.NaN, 366),
    366,
  );
  assert.notEqual(persistAviationAltitudeM(null, 366), 10000);

  assert.equal(
    persistAviationAltitudeM(null, null),
    null,
    'missing baro + missing geo stores null, not 10000',
  );
  assert.equal(persistAviationAltitudeM(undefined, undefined), null);
  assert.equal(persistAviationAltitudeM(Number.NaN, Number.NaN), null);
  assert.notEqual(persistAviationAltitudeM(null, null), 10000);

  assert.equal(persistAviationAltitudeM(1200, 366), 1200, 'finite baro wins over geo');
  assert.equal(persistAviationAltitudeM(0, 366), 0, '0 baro is a real value');
  assert.equal(
    persistAviationAltitudeM(null, null, { onGround: true }),
    0,
    'on-ground with neither still stores 0',
  );
  assert.equal(
    persistAviationAltitudeM(null, null, { previous: 1800 }),
    1800,
    'sticky previous wins when both ingested fields are missing',
  );

  assert.equal(
    aircraftMatchesAltitudeBand({ altitudeM: persistAviationAltitudeM(null, null), onGround: false }, 'gt30k'),
    false,
    'null altitude fail-closes on gt30k',
  );
  assert.equal(
    aircraftMatchesAltitudeBand({ altitudeM: persistAviationAltitudeM(null, null), onGround: false }, 'lt10k'),
    false,
    'null altitude fail-closes on lt10k',
  );
  assert.equal(
    aircraftMatchesAltitudeBand({ altitudeM: persistAviationAltitudeM(null, 366), onGround: false }, 'gt30k'),
    false,
    '366 m is not gt30k',
  );
  assert.equal(
    aircraftMatchesAltitudeBand({ altitudeM: persistAviationAltitudeM(null, 366), onGround: false }, 'lt10k'),
    true,
    '366 m stays in lt10k',
  );

  assert.match(flightsSrc, /persistAviationAltitudeM\(baro_alt, geo_alt/);
  assert.doesNotMatch(flightsSrc, /onGround \? 0 : 10000/);
  assert.doesNotMatch(militarySrc, /persistAviationAltitudeM/);
  assert.doesNotMatch(flightsSrc, /google\.com\/news|telegeography|quantum-earth/i);
});
