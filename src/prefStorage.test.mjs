import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KNOWN_PREF_SUFFIXES,
  LEGACY_PREF_PREFIX,
  PREF_PREFIX,
  hasPanelPrefix,
  layoutResetNotifiedSuffix,
  legacyPrefKey,
  panelCollapsedSuffix,
  panelPositionSuffix,
  prefKey,
  readPref,
  writePref,
} from './prefStorage.js';

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    keys: () => [...map.keys()],
    dump: () => Object.fromEntries(map),
    [Symbol.iterator]: () => map.keys(),
  };
}

test('fresh writes use meridian.* and never create godsEyeView.* keys', () => {
  const storage = memoryStorage();
  writePref(storage, 'v8.panelPos.cctv-panel', JSON.stringify({ left: 24, top: 48 }));
  writePref(storage, 'voiceCost.tier', 'standard');
  readPref(storage, 'sceneProject.v2');
  const keys = Object.keys(storage.dump());
  assert.deepEqual(keys.sort(), [
    'meridian.v8.panelPos.cctv-panel',
    'meridian.voiceCost.tier',
  ].sort());
  assert.ok(keys.every((key) => key.startsWith(PREF_PREFIX)));
  assert.equal(keys.some((key) => key.startsWith(LEGACY_PREF_PREFIX)), false);
});

test('existing layout keys migrate once and still apply', () => {
  const position = JSON.stringify({ left: 40, top: 80 });
  const storage = memoryStorage({
    [legacyPrefKey(panelPositionSuffix('v8', 'cctv-panel'))]: position,
    [legacyPrefKey(panelCollapsedSuffix('v6', 'pp-toggles'))]: '0',
  });
  assert.equal(readPref(storage, panelPositionSuffix('v8', 'cctv-panel')), position);
  assert.equal(readPref(storage, panelCollapsedSuffix('v6', 'pp-toggles')), '0');
  assert.equal(storage.getItem(prefKey(panelPositionSuffix('v8', 'cctv-panel'))), position);
  assert.equal(storage.getItem(prefKey(panelCollapsedSuffix('v6', 'pp-toggles'))), '0');
  assert.equal(storage.getItem(legacyPrefKey(panelPositionSuffix('v8', 'cctv-panel'))), position);
  assert.equal(storage.getItem(legacyPrefKey(panelCollapsedSuffix('v6', 'pp-toggles'))), '0');
});

test('a meridian key wins over a leftover godsEyeView key', () => {
  const storage = memoryStorage({
    [prefKey('voiceCost.tier')]: 'mini',
    [legacyPrefKey('voiceCost.tier')]: 'standard',
  });
  assert.equal(readPref(storage, 'voiceCost.tier'), 'mini');
  assert.equal(storage.getItem(legacyPrefKey('voiceCost.tier')), 'standard');
});

test('known suffixes and layout helpers stay on the meridian prefix', () => {
  for (const suffix of KNOWN_PREF_SUFFIXES) {
    assert.ok(prefKey(suffix).startsWith(PREF_PREFIX));
    assert.ok(legacyPrefKey(suffix).startsWith(LEGACY_PREF_PREFIX));
  }
  assert.equal(prefKey(layoutResetNotifiedSuffix('v8')), 'meridian.v8.layoutResetNotified');
  assert.equal(
    prefKey(panelPositionSuffix('v8', 'control-panel')),
    'meridian.v8.panelPos.control-panel',
  );
});

test('v6 panel-position leftovers are visible under either prefix', () => {
  const keyed = {
    'godsEyeView.v6.panelPos.cctv-panel': '{}',
    getItem() { return null; },
  };
  assert.equal(hasPanelPrefix(keyed, 'v6.panelPos.'), true);
  assert.equal(hasPanelPrefix({ 'meridian.v6.panelPos.cctv-panel': '{}' }, 'v6.panelPos.'), true);
  assert.equal(hasPanelPrefix({ 'meridian.v8.panelPos.cctv-panel': '{}' }, 'v6.panelPos.'), false);
});
