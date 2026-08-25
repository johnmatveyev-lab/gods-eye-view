import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  clampPanelPosition,
  leftoverPanelCollapsedStorageKey,
  leftoverPanelPositionStorageKey,
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
  const leftover = leftoverPanelPositionStorageKey('cctv-panel', 'v7');
  const next = panelPositionStorageKey('cctv-panel', 'v7');
  const original = JSON.stringify({ left: -4000, top: -4000 });
  const storage = memoryStorage({
    [leftover]: original,
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
  assert.equal(result[0].key, next);
  assert.equal(storage.getItem(leftover), original);
  assert.equal(storage.getItem(next), JSON.stringify({ left: 6, top: 6 }));
  assert.equal(storage.getItem(panelPositionStorageKey('cctv-panel', 'v8')), null);
  assert.equal(storage.getItem('godsEyeView.voiceCost.tier'), 'standard');
  assert.deepEqual(
    restoredPanelPosition(storage, 'cctv-panel', 'v8', VIEWPORT),
    { left: 6, top: 6 },
  );
});

test('boot sanitize clamps a collapsed-off-screen CCTV panel without renaming leftover versions', () => {
  const leftoverPos = leftoverPanelPositionStorageKey('cctv-panel', 'v6');
  const leftoverCollapsed = leftoverPanelCollapsedStorageKey('cctv-panel');
  const nextPos = panelPositionStorageKey('cctv-panel', 'v6');
  const original = JSON.stringify({ left: -4000, top: -4000 });
  const storage = memoryStorage({
    [leftoverPos]: original,
    [leftoverCollapsed]: '1',
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
  assert.equal(storage.getItem(leftoverPos), original);
  assert.equal(storage.getItem(leftoverCollapsed), '1');
  assert.equal(storage.getItem(nextPos), JSON.stringify({ left: 6, top: 6 }));
  assert.equal(storage.getItem(panelCollapsedStorageKey('cctv-panel')), '1');
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
  assert.equal(
    Object.keys(storage.snapshot()).some((name) => name.startsWith('godsEyeView.')),
    false,
  );
  assert.deepEqual(
    restoredPanelPosition(storage, 'cctv-panel', 'v8', VIEWPORT),
    { left: 80, top: 120 },
  );
});

test('resolveStoredPanelPosition copies leftover versions onto Meridian without inventing a current key', () => {
  const leftover = leftoverPanelPositionStorageKey('pp-toggles', 'v6');
  const next = panelPositionStorageKey('pp-toggles', 'v6');
  const stored = JSON.stringify({ left: 40, top: 60 });
  const storage = memoryStorage({
    [leftover]: stored,
  });
  const resolved = resolveStoredPanelPosition(storage, 'pp-toggles', 'v8');
  assert.equal(resolved.key, next);
  assert.deepEqual(resolved.pos, { left: 40, top: 60 });
  assert.equal(storage.getItem(next), stored);
  assert.equal(storage.getItem(leftover), stored);
  assert.equal(storage.getItem(panelPositionStorageKey('pp-toggles', 'v8')), null);
});

test('boot sanitize resets only the unreadable panel layout keys', () => {
  const leftoverPos = leftoverPanelPositionStorageKey('cctv-panel', 'v7');
  const leftoverCollapsed = leftoverPanelCollapsedStorageKey('cctv-panel');
  const storage = memoryStorage({
    [leftoverPos]: '{not-json',
    [leftoverCollapsed]: '1',
    'godsEyeView.cctv.calibration.v2': '{}',
  });

  const result = sanitizeStoredPanelPositions({
    storage,
    panelIds: ['cctv-panel'],
    currentVersion: 'v8',
    ...VIEWPORT,
  });

  assert.equal(result[0].action, 'reset');
  assert.equal(storage.getItem(leftoverPos), null);
  assert.equal(storage.getItem(leftoverCollapsed), null);
  assert.equal(storage.getItem(panelPositionStorageKey('cctv-panel', 'v7')), null);
  assert.equal(storage.getItem(panelCollapsedStorageKey('cctv-panel')), null);
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
