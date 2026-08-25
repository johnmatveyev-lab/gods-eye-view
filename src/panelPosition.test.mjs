import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  clampPanelPosition,
  panelCollapsedStorageKey,
  panelPositionStorageKey,
  resolveStoredPanelPosition,
  restoredPanelPosition,
  sanitizeStoredPanelPositions,
} from './panelPosition.js';

const VIEWPORT = Object.freeze({
  viewportWidth: 1280,
  viewportHeight: 720,
  width: 360,
  height: 240,
});

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (name) => (values.has(name) ? values.get(name) : null),
    setItem: (name, next) => { values.set(name, String(next)); },
    removeItem: (name) => { values.delete(name); },
    snapshot: () => Object.fromEntries(values),
  };
}

test('clampPanelPosition pulls negative coordinates onto the inset', () => {
  assert.deepEqual(clampPanelPosition({
    left: -4000,
    top: -4000,
    ...VIEWPORT,
  }), { left: 6, top: 6 });
});

test('clampPanelPosition pulls huge coordinates onto the far inset', () => {
  assert.deepEqual(clampPanelPosition({
    left: 1e9,
    top: 1e9,
    ...VIEWPORT,
  }), {
    left: 1280 - 360 - 6,
    top: 720 - 240 - 6,
  });
});

test('clampPanelPosition leaves an on-screen position unchanged', () => {
  assert.deepEqual(clampPanelPosition({
    left: 80,
    top: 120,
    ...VIEWPORT,
  }), { left: 80, top: 120 });
});

test('boot sanitize clamps a CCTV panel stored at -4000,-4000 onto the viewport', () => {
  const key = panelPositionStorageKey('cctv-panel', 'v7');
  const storage = memoryStorage({
    [key]: JSON.stringify({ left: -4000, top: -4000 }),
    'godsEyeView.voiceCost.tier': 'standard',
  });

  const result = sanitizeStoredPanelPositions({
    storage,
    panelIds: ['cctv-panel'],
    currentVersion: 'v8',
    ...VIEWPORT,
  });

  assert.equal(result[0].action, 'clamp');
  assert.deepEqual(result[0].position, { left: 6, top: 6 });
  assert.equal(storage.getItem(key), JSON.stringify({ left: 6, top: 6 }));
  assert.equal(storage.getItem(panelPositionStorageKey('cctv-panel', 'v8')), null);
  assert.equal(storage.getItem('godsEyeView.voiceCost.tier'), 'standard');
  assert.deepEqual(
    restoredPanelPosition(storage, 'cctv-panel', 'v8', VIEWPORT),
    { left: 6, top: 6 },
  );
});

test('boot sanitize clamps a collapsed-off-screen CCTV panel without renaming leftover keys', () => {
  const posKey = panelPositionStorageKey('cctv-panel', 'v6');
  const collapsedKey = panelCollapsedStorageKey('cctv-panel');
  const storage = memoryStorage({
    [posKey]: JSON.stringify({ left: -4000, top: -4000 }),
    [collapsedKey]: '1',
  });

  const result = sanitizeStoredPanelPositions({
    storage,
    panelIds: ['cctv-panel'],
    currentVersion: 'v8',
    viewportWidth: 1280,
    viewportHeight: 720,
    collapsedWidth: 176,
    collapsedHeight: 50,
  });

  assert.equal(result[0].action, 'clamp');
  assert.deepEqual(result[0].position, { left: 6, top: 6 });
  assert.equal(storage.getItem(posKey), JSON.stringify({ left: 6, top: 6 }));
  assert.equal(storage.getItem(collapsedKey), '1');
  assert.equal(storage.getItem(panelPositionStorageKey('cctv-panel', 'v8')), null);
});

test('boot sanitize keeps a normal on-screen saved CCTV position', () => {
  const key = panelPositionStorageKey('cctv-panel', 'v8');
  const stored = JSON.stringify({ left: 80, top: 120 });
  const storage = memoryStorage({ [key]: stored });

  const result = sanitizeStoredPanelPositions({
    storage,
    panelIds: ['cctv-panel'],
    currentVersion: 'v8',
    ...VIEWPORT,
  });

  assert.equal(result[0].action, 'keep');
  assert.equal(storage.getItem(key), stored);
  assert.deepEqual(
    restoredPanelPosition(storage, 'cctv-panel', 'v8', VIEWPORT),
    { left: 80, top: 120 },
  );
});

test('resolveStoredPanelPosition reads leftover versions before inventing a current key', () => {
  const leftover = panelPositionStorageKey('pp-toggles', 'v6');
  const storage = memoryStorage({
    [leftover]: JSON.stringify({ left: 40, top: 60 }),
  });
  const resolved = resolveStoredPanelPosition(storage, 'pp-toggles', 'v8');
  assert.equal(resolved.key, leftover);
  assert.deepEqual(resolved.pos, { left: 40, top: 60 });
  assert.equal(storage.getItem(panelPositionStorageKey('pp-toggles', 'v8')), null);
});

test('boot sanitize resets only the unreadable panel layout keys', () => {
  const posKey = panelPositionStorageKey('cctv-panel', 'v7');
  const collapsedKey = panelCollapsedStorageKey('cctv-panel');
  const storage = memoryStorage({
    [posKey]: '{not-json',
    [collapsedKey]: '1',
    'godsEyeView.cctv.calibration.v2': '{}',
  });

  const result = sanitizeStoredPanelPositions({
    storage,
    panelIds: ['cctv-panel'],
    currentVersion: 'v8',
    ...VIEWPORT,
  });

  assert.equal(result[0].action, 'reset');
  assert.equal(storage.getItem(posKey), null);
  assert.equal(storage.getItem(collapsedKey), null);
  assert.equal(storage.getItem('godsEyeView.cctv.calibration.v2'), '{}');
});

test('ui boots the clamp helper for every restored panel without renaming leftover keys', () => {
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(ui, /import \{\n  clampPanelPosition,\n  sanitizeStoredPanelPositions,/);
  assert.match(ui, /PANEL_POSITION_STORAGE_VERSION = 'v8'/);
  assert.match(ui, /this\._sanitizeRestoredPanelPositions\(\)/);
  assert.match(ui, /resolveStoredPanelPosition\(/);
  assert.match(
    ui,
    /_initPanelChrome\(\) \{\n    this\._sanitizeRestoredPanelPositions\(\);/,
  );
  assert.doesNotMatch(ui, /PANEL_POSITION_STORAGE_VERSION = 'v9'/);
  assert.doesNotMatch(ui, /localStorage\.removeItem\('godsEyeView\.v6\.panelPos\.cctv-panel'\)/);
});
