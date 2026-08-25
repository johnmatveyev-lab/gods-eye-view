import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MODELS_PREF_DEFAULT,
  MODELS_PREF_STORAGE_KEY,
  modelsPreferenceEnabled,
  normalizeModelsPreference,
  peekModelsPreference,
  readModelsPreference,
  writeModelsPreference,
} from './modelsPreference.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    dump() {
      return Object.fromEntries(values);
    },
  };
}

test('meridian.models defaults on when nothing is stored', () => {
  assert.equal(MODELS_PREF_STORAGE_KEY, 'meridian.models');
  assert.equal(MODELS_PREF_DEFAULT, 'on');
  assert.equal(readModelsPreference(memoryStorage()), 'on');
  assert.equal(peekModelsPreference(memoryStorage()), null);
  assert.equal(modelsPreferenceEnabled(undefined), true);
});

test('meridian.models persists exactly on or off', () => {
  const storage = memoryStorage();
  assert.equal(writeModelsPreference(storage, 'off'), 'off');
  assert.equal(storage.dump()[MODELS_PREF_STORAGE_KEY], 'off');
  assert.equal(readModelsPreference(storage), 'off');
  assert.equal(peekModelsPreference(storage), 'off');
  assert.equal(modelsPreferenceEnabled('off'), false);

  assert.equal(writeModelsPreference(storage, 'on'), 'on');
  assert.equal(storage.dump()[MODELS_PREF_STORAGE_KEY], 'on');
  assert.equal(readModelsPreference(storage), 'on');
  assert.equal(peekModelsPreference(storage), 'on');
});

test('unknown meridian.models values fail open to on', () => {
  assert.equal(normalizeModelsPreference('maybe'), 'on');
  assert.equal(normalizeModelsPreference(''), 'on');
  assert.equal(readModelsPreference(memoryStorage({ [MODELS_PREF_STORAGE_KEY]: 'all' })), 'on');
  assert.equal(peekModelsPreference(memoryStorage({ [MODELS_PREF_STORAGE_KEY]: 'all' })), null);
});

test('a locked store still returns the chosen value without throwing', () => {
  const locked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.equal(readModelsPreference(locked), 'on');
  assert.equal(peekModelsPreference(locked), null);
  assert.equal(writeModelsPreference(locked, 'off'), 'off');
});

test('the Models control writes meridian.models and stays labeled Models', () => {
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(ui, /writeModelsPreference\(/,
    'the DISPLAY-rail Models toggle persists meridian.models');
  assert.match(ui, /peekModelsPreference\(/,
    'a later boot reapplies an explicit meridian.models value');
  assert.match(html, /<span class="pp-label">Models<\/span>/,
    'the control is the Models on/off, not a second 3D widget');
  assert.match(html, /id="models3d-toggle"/,
    'it reuses the existing model/billboard switch');
});
