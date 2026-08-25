import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DETECTION_DENSITY_KNOWN_KEYS,
  DETECTION_DENSITY_SESSION_KEY,
  DENSITY_STOPS,
  detectionDensityChromeState,
  detectionDensityControlRequest,
  detectionDensityVoiceRequest,
  persistDetectionDensity,
  readPersistedDetectionDensity,
  resolveDetectionDensityStorage,
} from './detectionDensityChrome.js';
import {
  canonicalizeDensity,
  labelBudgetFor,
  normalizeProfile,
  profileForDensity,
} from './data/detectionPolicy.js';
import {
  getDetectionTuning,
  getMode as getDetectionMode,
  setDetectionTuning,
  setMode as setDetectionMode,
} from './data/detection.js';
import { createGevActionRunner } from './voice/gevActions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const uiSource = fs.readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');
const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
  };
}

function uiBlock(start, end) {
  const startIndex = uiSource.indexOf(start);
  assert.ok(startIndex >= 0, `missing source anchor: ${start}`);
  const endIndex = uiSource.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `missing source anchor: ${end}`);
  return uiSource.slice(startIndex, endIndex);
}

function applyDetectionControl(request) {
  if (Number.isFinite(request.densityPct)) {
    setDetectionTuning({ densityPct: canonicalizeDensity(request.densityPct) });
  }
  if (request.enabled === false) {
    setDetectionMode('OFF');
  } else if (request.mode) {
    setDetectionMode(request.mode);
  } else if (request.enabled === true) {
    setDetectionMode(profileForDensity(request.densityPct ?? getDetectionTuning().densityPct));
  } else if (getDetectionMode() !== 'OFF' && Number.isFinite(request.densityPct)) {
    setDetectionMode(profileForDensity(request.densityPct));
  }
  return {
    detectionMode: getDetectionMode(),
    densityPct: getDetectionTuning().densityPct,
  };
}

test('chrome markup is a five-stop Sparse/Balanced/Dense control', () => {
  assert.deepEqual(DENSITY_STOPS, [0, 25, 50, 75, 100]);
  assert.match(
    indexHtml,
    /id="detection-density-slider"[^>]*\smin="0"[^>]*\smax="100"[^>]*\sstep="25"/,
    'the handle only stops on the five approved snaps',
  );
  assert.match(indexHtml, /class="detection-density-stops"/);
  assert.match(indexHtml, /<span>Sparse<\/span>/);
  assert.match(indexHtml, /<span>Balanced<\/span>/);
  assert.match(indexHtml, /<span>Dense<\/span>/);
  assert.equal(detectionDensityChromeState(50).label, 'Balanced');
  assert.equal(detectionDensityChromeState(25).label, 'Sparse');
  assert.equal(detectionDensityChromeState(75).label, 'Dense');
});

test('slider 25 writes the same state as voice density twenty-five', async () => {
  setDetectionMode('DENSE');
  setDetectionTuning({ densityPct: 75 });

  const chrome = detectionDensityControlRequest(25);
  const voice = detectionDensityVoiceRequest({ densityPct: 25 });
  assert.deepEqual(chrome, { densityPct: 25, enabled: true });
  assert.deepEqual(voice, chrome);

  const chromeState = applyDetectionControl(chrome);
  setDetectionMode('DENSE');
  setDetectionTuning({ densityPct: 75 });
  const voiceState = applyDetectionControl(voice);
  assert.deepEqual(chromeState, { detectionMode: 'SPARSE', densityPct: 25 });
  assert.deepEqual(voiceState, chromeState);

  globalThis.window = globalThis.window || { clearTimeout, setTimeout, requestIdleCallback: null };
  const calls = [];
  const runner = createGevActionRunner({
    viewer: {
      clock: { onTick: { addEventListener: () => () => {} } },
      scene: { canvas: { addEventListener() {}, removeEventListener() {} } },
      camera: { moveEnd: { addEventListener() {} } },
    },
    styleManager: {
      setDetection(args) {
        calls.push(args);
        return { ok: true, ...args };
      },
    },
    dataManager: { layers: new Map() },
  });
  await runner('set_detection', { densityPct: 25 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].densityPct, 25);
  assert.equal(calls[0].enabled, true);
});

test('density 0 hides detections; 100 is the dense/panoptic alias already in code', () => {
  assert.equal(detectionDensityChromeState(0).hidesDetections, true);
  assert.deepEqual(detectionDensityControlRequest(0), { densityPct: 0, enabled: false });
  assert.deepEqual(
    detectionDensityVoiceRequest({ densityPct: 0 }),
    detectionDensityControlRequest(0),
  );

  setDetectionMode('DENSE');
  setDetectionTuning({ densityPct: 75 });
  const hidden = applyDetectionControl(detectionDensityControlRequest(0));
  assert.deepEqual(hidden, { detectionMode: 'OFF', densityPct: 0 });

  assert.ok(
    labelBudgetFor(1000, 0) < labelBudgetFor(1000, 25),
    'stop 0 is also the lowest remaining budget once the overlay is on again',
  );

  assert.equal(normalizeProfile('panoptic'), 'DENSE');
  assert.equal(normalizeProfile('god'), 'DENSE');
  assert.equal(profileForDensity(100), 'DENSE');
  assert.equal(detectionDensityChromeState(100).label, 'Dense');
  assert.deepEqual(detectionDensityControlRequest(100), { densityPct: 100, enabled: true });

  setDetectionMode('OFF');
  const dense = applyDetectionControl(detectionDensityControlRequest(100));
  assert.deepEqual(dense, { detectionMode: 'DENSE', densityPct: 100 });
  setDetectionMode('OFF');
  const panoptic = applyDetectionControl(detectionDensityVoiceRequest({ mode: 'panoptic' }));
  assert.equal(panoptic.detectionMode, 'DENSE');
});

test('voice and chrome stay on the same setDetection path', () => {
  const slider = uiBlock(
    "this._detectionDensitySlider.addEventListener('input'",
    'for (const button of this._detectionAllocationBtns)',
  );
  assert.match(slider, /this\.setDetection\(detectionDensityControlRequest\(/);
  const gevActions = fs.readFileSync(path.join(ROOT, 'src', 'voice', 'gevActions.js'), 'utf8');
  assert.match(gevActions, /name === 'set_detection'/);
  assert.match(gevActions, /detectionDensityControlRequest\(args\.densityPct\)/);
  assert.match(uiSource, /persistDetectionDensity\(/);
  assert.match(uiSource, /readPersistedDetectionDensity\(/);
  assert.match(uiSource, /_paintDetectionDensityChrome\(/);
  assert.doesNotMatch(
    uiBlock('  _applyDetectionDensityFromUi() {', '  _applyDetectionFadeFromUi() {'),
    /textContent = `\$\{pct}%`/,
    'the live readout must use Sparse/Balanced/Dense, not a raw percent',
  );
});

test('density persists on an existing key, otherwise session', () => {
  const leftoverKey = DETECTION_DENSITY_KNOWN_KEYS[0];
  const leftover = memoryStorage({ [leftoverKey]: '75' });
  const session = memoryStorage();
  const existing = resolveDetectionDensityStorage({
    localStorage: leftover,
    sessionStorage: session,
  });
  assert.equal(existing.kind, 'local');
  assert.equal(existing.key, leftoverKey);
  persistDetectionDensity(25, { localStorage: leftover, sessionStorage: session });
  assert.equal(leftover.getItem(leftoverKey), '25');
  assert.equal(session.getItem(DETECTION_DENSITY_SESSION_KEY), null);

  const emptyLocal = memoryStorage();
  const sessionOnly = memoryStorage();
  const resolved = resolveDetectionDensityStorage({
    localStorage: emptyLocal,
    sessionStorage: sessionOnly,
  });
  assert.equal(resolved.kind, 'session');
  assert.equal(resolved.key, DETECTION_DENSITY_SESSION_KEY);
  persistDetectionDensity(100, { localStorage: emptyLocal, sessionStorage: sessionOnly });
  assert.equal(sessionOnly.getItem(DETECTION_DENSITY_SESSION_KEY), '100');
  assert.equal(emptyLocal.getItem(leftoverKey), null);
  assert.equal(
    readPersistedDetectionDensity({ localStorage: emptyLocal, sessionStorage: sessionOnly }),
    100,
  );
});

test('PLAN 50 stays on existing detection and Meridian credits', () => {
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(indexHtml, /<title>Meridian<\/title>/);
  assert.doesNotMatch(indexHtml, /person[- ]search/i);
  assert.doesNotMatch(uiSource, /new URL\(['"]\/api\//);
  assert.doesNotMatch(
    fs.readFileSync(path.join(ROOT, 'src', 'detectionDensityChrome.js'), 'utf8'),
    /opensky|news\.google|telegeography|quantum-earth/i,
  );
});
