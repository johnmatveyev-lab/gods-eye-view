import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRAILS_DEFAULT_ENABLED,
  TRAILS_STORAGE_KEY,
  getTrailsEnabled,
  hydrateTrailsEnabled,
  normalizeTrailsEnabled,
  readTrailsEnabled,
  resetTrailsEnabledForTest,
  setTrailsEnabled,
  subscribeTrailsEnabled,
  trailDrawingVisible,
  writeTrailsEnabled,
} from './trailPreference.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.hasOwn(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    snapshot() {
      return { ...data };
    },
  };
}

test('trails default on, and only an explicit off is off', () => {
  assert.equal(TRAILS_DEFAULT_ENABLED, true);
  assert.equal(TRAILS_STORAGE_KEY, 'meridian.trails');
  assert.equal(normalizeTrailsEnabled(undefined), true);
  assert.equal(normalizeTrailsEnabled(null), true);
  assert.equal(normalizeTrailsEnabled('nope'), true);
  assert.equal(normalizeTrailsEnabled('0'), false);
  assert.equal(normalizeTrailsEnabled(false), false);
  assert.equal(normalizeTrailsEnabled('1'), true);
});

test('reload keeps the persisted meridian.trails preference', () => {
  const storage = memoryStorage();
  assert.equal(readTrailsEnabled(storage), true, 'absent key is the default ON');

  assert.equal(writeTrailsEnabled(false, storage), true);
  assert.deepEqual(storage.snapshot(), { 'meridian.trails': '0' });
  assert.equal(readTrailsEnabled(storage), false, 'a later session reads the stored off');

  assert.equal(writeTrailsEnabled(true, storage), true);
  assert.equal(readTrailsEnabled(storage), true);
});

test('hostile or missing storage fails open to trails on', () => {
  assert.equal(readTrailsEnabled(null), true);
  assert.equal(readTrailsEnabled({
    getItem() { throw new Error('blocked'); },
  }), true);
  assert.equal(writeTrailsEnabled(false, {
    setItem() { throw new Error('blocked'); },
  }), false);
});

test('trail drawing hides without implying stop-tracking or cockpit changes', () => {
  assert.equal(trailDrawingVisible(), true, 'default on draws the existing trail');
  assert.equal(trailDrawingVisible({ trailsEnabled: true, cockpitContactMode: false }), true);
  assert.equal(trailDrawingVisible({ trailsEnabled: false, cockpitContactMode: false }), false);
  assert.equal(trailDrawingVisible({ trailsEnabled: true, cockpitContactMode: true }), false,
    'cockpit still hides trails independently of the hosted toggle');
  assert.equal(trailDrawingVisible({ trailsEnabled: false, cockpitContactMode: true }), false);
});

test('the live preference hydrates from storage and notifies subscribers', () => {
  resetTrailsEnabledForTest();
  const seen = [];
  const unsubscribe = subscribeTrailsEnabled((enabled) => seen.push(enabled));
  try {
    assert.equal(getTrailsEnabled(), true);
    const storage = memoryStorage({ 'meridian.trails': '0' });
    assert.equal(hydrateTrailsEnabled(storage), false);
    assert.equal(getTrailsEnabled(), false);
    assert.deepEqual(storage.snapshot(), { 'meridian.trails': '0' },
      'hydrate must not rewrite the stored preference');

    assert.equal(setTrailsEnabled(true, { storage }), true);
    assert.equal(storage.snapshot()['meridian.trails'], '1');
    assert.deepEqual(seen, [false, true]);
  } finally {
    unsubscribe();
    resetTrailsEnabledForTest();
  }
});
