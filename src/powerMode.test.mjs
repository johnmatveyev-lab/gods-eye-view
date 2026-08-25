import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_POWER_MODE,
  POWER_LOW,
  POWER_NORMAL,
  POWER_STORAGE_KEY,
  TARGET_FRAME_RATE_LOW,
  TARGET_FRAME_RATE_NORMAL,
  applyPowerMode,
  getPowerMode,
  installPowerMode,
  normalizePowerMode,
  readStoredPowerMode,
  setPowerMode,
  targetFrameRateForPowerMode,
  writeStoredPowerMode,
} from './powerMode.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function mockViewer(targetFrameRate = TARGET_FRAME_RATE_NORMAL) {
  return {
    targetFrameRate,
    scene: { requestRenderMode: false },
    creditContainer: { hidden: false, style: { display: '' } },
  };
}

test('Low sets targetFrameRate to 30; Normal restores the current 60 default', () => {
  const viewer = mockViewer();
  assert.equal(TARGET_FRAME_RATE_NORMAL, 60);
  assert.equal(TARGET_FRAME_RATE_LOW, 30);
  assert.equal(applyPowerMode(viewer, POWER_LOW), POWER_LOW);
  assert.equal(viewer.targetFrameRate, 30);
  assert.equal(getPowerMode(viewer), POWER_LOW);
  assert.equal(applyPowerMode(viewer, POWER_NORMAL), POWER_NORMAL);
  assert.equal(viewer.targetFrameRate, 60);
  assert.equal(getPowerMode(viewer), POWER_NORMAL);
});

test('Low does not flip requestRenderMode or invent a renderer', () => {
  const viewer = mockViewer();
  applyPowerMode(viewer, POWER_LOW);
  assert.equal(viewer.scene.requestRenderMode, false, 'the idle governor owns requestRenderMode');
  const source = readFileSync(new URL('./powerMode.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /requestRenderMode\s*=/);
  assert.doesNotMatch(source, /new\s+\w*Renderer|createRenderer|WebGLRenderer/);
});

test('meridian.power persists and reload reapplies the cap', () => {
  const storage = memoryStorage();
  const viewer = mockViewer();
  assert.equal(POWER_STORAGE_KEY, 'meridian.power');
  assert.equal(DEFAULT_POWER_MODE, POWER_NORMAL);
  assert.equal(installPowerMode(viewer, { storage }), POWER_NORMAL);
  assert.equal(viewer.targetFrameRate, 60);
  assert.equal(setPowerMode(viewer, 'low', { storage }), POWER_LOW);
  assert.equal(storage.getItem(POWER_STORAGE_KEY), POWER_LOW);
  assert.equal(viewer.targetFrameRate, 30);

  const reloaded = mockViewer();
  assert.equal(installPowerMode(reloaded, { storage }), POWER_LOW);
  assert.equal(reloaded.targetFrameRate, 30);
  assert.equal(readStoredPowerMode(storage), POWER_LOW);
});

test('unknown meridian.power values fail open to Normal', () => {
  assert.equal(normalizePowerMode('turbo'), POWER_NORMAL);
  assert.equal(normalizePowerMode(''), POWER_NORMAL);
  assert.equal(targetFrameRateForPowerMode('nope'), 60);
  assert.equal(readStoredPowerMode(memoryStorage({ [POWER_STORAGE_KEY]: 'max' })), POWER_NORMAL);
  assert.equal(writeStoredPowerMode('LOW', memoryStorage()), POWER_LOW);
});

test('power mode never changes data polls', () => {
  const source = readFileSync(new URL('./powerMode.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /pollInterval|POLL_|setInterval|OpenSky|opensky|TeleGeography|Google News/);
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const powerBlock = ui.slice(
    ui.indexOf('setPowerMode(mode)'),
    ui.indexOf('setPowerMode(mode)') + 500,
  );
  assert.doesNotMatch(powerBlock, /pollInterval|livePollScheduler|setInterval/);
});

test('Display ships a Power: Normal | Low control wired to meridian.power', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  const share = readFileSync(new URL('./sharelink.js', import.meta.url), 'utf8');
  assert.match(html, /id="power-row"/);
  assert.match(html, /<span class="pp-slider-mini-label">Power<\/span>/);
  assert.match(html, /data-power="normal"[^>]*>Normal</);
  assert.match(html, /data-power="low"[^>]*>Low</);
  assert.match(ui, /installPowerMode|setPowerMode/);
  assert.match(ui, /meridian\.power|installPowerMode\(/);
  assert.match(main, /installPowerMode\(viewer\)/);
  assert.doesNotMatch(share, /meridian\.power|POWER_STORAGE_KEY/);
});

test('Clean view + Low still keeps credits on', () => {
  const viewer = mockViewer();
  applyPowerMode(viewer, POWER_LOW);
  assert.equal(viewer.targetFrameRate, 30);
  assert.equal(viewer.creditContainer.hidden, false);
  assert.notEqual(viewer.creditContainer.style.display, 'none');

  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const powerSource = readFileSync(new URL('./powerMode.js', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const powerUi = ui.slice(ui.indexOf('setPowerMode(mode)'), ui.indexOf('getContextModeState()'));
  assert.match(css, /body\.ui-clean-view #cesium-credits/);
  assert.match(css, /body\.ui-clean-view #cesium-credits,\s*\n\s*body\.recording-mode #cesium-credits \{[^}]*opacity:\s*1/);
  assert.doesNotMatch(css, /power-low[\s\S]{0,120}#cesium-credits/);
  assert.doesNotMatch(powerSource, /cesium-credits|display:\s*none|visibility:\s*hidden/);
  assert.doesNotMatch(powerUi, /cesium-credits|display:\s*none|visibility:\s*hidden/);
});
