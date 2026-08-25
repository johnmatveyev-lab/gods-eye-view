import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatCockpitContextScope } from './cockpitMath.js';
import { formatAwarenessDistance } from './data/militaryAwarenessEngine.js';
import {
  DEFAULT_DISTANCE_UNIT,
  UNITS_STORAGE_KEY,
  convertMeters,
  formatDistanceMeters,
  formatHudAltitude,
  getDistanceUnit,
  initDistanceUnits,
  normalizeDistanceUnit,
  resetDistanceUnitsForTests,
  setDistanceUnit,
  subscribeDistanceUnit,
} from './units.js';

const SAME_METERS = 250_000;

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

test.afterEach(() => {
  resetDistanceUnitsForTests();
});

test('one formatter helper prints three outputs for the same meters', () => {
  assert.equal(formatDistanceMeters(SAME_METERS, 'km'), '250 km');
  assert.equal(formatDistanceMeters(SAME_METERS, 'nm'), '135 nmi');
  assert.equal(formatDistanceMeters(SAME_METERS, 'mi'), '155 mi');
  assert.equal(convertMeters(SAME_METERS, 'nm').suffix, 'nmi');
});

test('default first visit matches current production range labels', () => {
  assert.equal(DEFAULT_DISTANCE_UNIT, 'km');
  assert.equal(getDistanceUnit(), 'km');
  assert.equal(formatDistanceMeters(0), '0 m');
  assert.equal(formatDistanceMeters(950), '950 m');
  assert.equal(formatDistanceMeters(1000), '1.0 km');
  assert.equal(formatDistanceMeters(SAME_METERS), '250 km');
  assert.equal(formatAwarenessDistance(0), '0 m');
  assert.equal(formatAwarenessDistance(950), '950 m');
  assert.equal(formatAwarenessDistance(SAME_METERS), '250 km');
  assert.equal(
    formatCockpitContextScope('CONTACTS', SAME_METERS),
    'CONTACTS · 250 KM AIR/SEA WINDOW',
  );
  assert.equal(formatHudAltitude(-15), '-15m');
  assert.equal(formatHudAltitude(-15, { compact: true }), '-15M');
  assert.equal(formatHudAltitude(17), '17m');
  assert.equal(formatHudAltitude(17, { compact: true }), '17M');
  assert.equal(formatHudAltitude(12300, { compact: true }), '12.3KM');
});

test('nm and mi range labels keep the selected unit', () => {
  assert.equal(formatDistanceMeters(1852, 'nm'), '1.0 nmi');
  assert.equal(formatDistanceMeters(1609.344, 'mi'), '1.0 mi');
  assert.equal(formatDistanceMeters(SAME_METERS, 'nm', { style: 'compact' }), '135 NMI');
  assert.equal(formatDistanceMeters(5000, 'km', { style: 'compact' }), '5.0 KM');
  assert.equal(formatHudAltitude(1852, { unit: 'nm', compact: true }), '1.0NMI');
});

test('invalid values stay unavailable and do not invent a distance', () => {
  assert.equal(formatDistanceMeters(Number.NaN), '—');
  assert.equal(formatDistanceMeters(-1), '—');
  assert.equal(normalizeDistanceUnit('fathoms'), null);
  assert.equal(normalizeDistanceUnit('nmi'), 'nm');
});

test('meridian.units persists and reload keeps the choice', () => {
  const storage = memoryStorage();
  assert.equal(initDistanceUnits({ storage }), 'km');
  assert.equal(setDistanceUnit('nm', { storage }), 'nm');
  assert.equal(storage.getItem(UNITS_STORAGE_KEY), 'nm');
  assert.equal(formatDistanceMeters(SAME_METERS, 'nm'), '135 nmi');
  assert.equal(getDistanceUnit(), 'km', 'injected storage must not leak into the live default');

  resetDistanceUnitsForTests();
  assert.equal(initDistanceUnits({ storage }), 'nm');
  assert.equal(formatDistanceMeters(SAME_METERS, 'nm'), '135 nmi');
});

test('subscribers hear a unit change once', () => {
  const seen = [];
  const stop = subscribeDistanceUnit((unit, previous) => seen.push([unit, previous]));
  try {
    setDistanceUnit('mi', { persist: false });
    setDistanceUnit('mi', { persist: false });
    assert.deepEqual(seen, [['mi', 'km']]);
  } finally {
    stop();
    resetDistanceUnitsForTests();
  }
});

test('Display ships a km | nm | mi control wired to meridian.units', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(html, /id="units-row"/);
  assert.match(html, /data-units="km"/);
  assert.match(html, /data-units="nm"/);
  assert.match(html, /data-units="mi"/);
  assert.match(ui, /UNITS_STORAGE_KEY|initDistanceUnits|setDistanceUnit/);
  assert.match(ui, /meridian\.units|initDistanceUnits\(\)/);
});
