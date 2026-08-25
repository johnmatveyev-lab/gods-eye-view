// PLAN 139 — Next ISS pass readout on the Satellites row.
// Client-only. Reuses the in-memory satrec. Camera recalc is moveEnd only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { twoline2satrec } from 'satellite.js';
import {
  CLOCK_CHANGE_EVENT,
  formatChromeClock,
  resetClockPreferenceCache,
  setClockMode,
} from '../clockPreference.js';
import { findNextIssPass } from './issPass.js';
import {
  ISS_PASS_READOUT_ID,
  ISS_PASS_READOUT_PARK_ID,
  ISS_PASS_READOUT_TITLE,
  ISS_PASS_UNAVAILABLE,
  computeIssPassReadout,
  destroyIssPassReadout,
  formatIssPassReadout,
  getIssPassReadoutObserverForTest,
  initIssPassReadout,
  observerFromCamera,
  syncIssPassReadout,
} from './issPassReadout.js';
import satellitesLayer, {
  getNextIssPass,
  _clearDenseCatalogStateForTest,
  _setDenseCatalogStateForTest,
} from './satellites.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const L1 = '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927';
const L2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537';
const AUSTIN = { latDeg: 30.2672, lonDeg: -97.7431 };
const TOKYO = { latDeg: 35.6762, lonDeg: 139.6503 };
const FROM_MS = Date.UTC(2008, 8, 20, 12, 30, 0);
const RAD = Math.PI / 180;

function toCarto(latDeg, lonDeg) {
  return { latitude: latDeg * RAD, longitude: lonDeg * RAD, height: 400 };
}

function makeCesiumEvent() {
  const listeners = [];
  return {
    listeners,
    addEventListener(fn) {
      listeners.push(fn);
      return () => {
        const index = listeners.indexOf(fn);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    raise() {
      for (const fn of [...listeners]) fn();
    },
  };
}

function seedIssCatalog() {
  _setDenseCatalogStateForTest({
    coreSats: [{
      noradId: 25544,
      name: 'ISS (ZARYA)',
      satrec: twoline2satrec(L1, L2),
      group: 'stations',
    }],
  });
}

function makeRoot(text = ISS_PASS_UNAVAILABLE) {
  return {
    hidden: true,
    textContent: text,
    title: '',
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
  };
}

function installReadout({
  latDeg = AUSTIN.latDeg,
  lonDeg = AUSTIN.lonDeg,
  visible = true,
  getPass = getNextIssPass,
  fetches = null,
} = {}) {
  const originalFetch = globalThis.fetch;
  if (fetches) {
    globalThis.fetch = async (url) => {
      fetches.push(String(url));
      return { ok: false, status: 502 };
    };
  }
  const changed = makeCesiumEvent();
  const moveEnd = makeCesiumEvent();
  const root = makeRoot();
  const viewer = {
    camera: {
      positionCartographic: toCarto(latDeg, lonDeg),
      changed,
      moveEnd,
    },
  };
  const clockTarget = {
    listeners: new Map(),
    addEventListener(name, fn) {
      this.listeners.set(name, fn);
    },
    removeEventListener(name) {
      this.listeners.delete(name);
    },
    dispatch(name) {
      this.listeners.get(name)?.();
    },
  };
  initIssPassReadout({
    viewer,
    getPass,
    isVisible: () => visible,
    root,
    getFromMs: () => FROM_MS,
    clockTarget,
  });
  return {
    root,
    viewer,
    changed,
    moveEnd,
    clockTarget,
    setPose(nextLat, nextLon) {
      viewer.camera.positionCartographic = toCarto(nextLat, nextLon);
    },
    setVisible(next) {
      visible = next;
    },
    cleanup() {
      destroyIssPassReadout();
      _clearDenseCatalogStateForTest();
      globalThis.fetch = originalFetch;
    },
  };
}

test('formatIssPassReadout shows rise, peak elev, and rise azimuth', () => {
  const satrec = twoline2satrec(L1, L2);
  const pass = findNextIssPass({ satrec, ...AUSTIN, fromMs: FROM_MS, minElevDeg: 10 });
  assert.ok(pass);
  const utc = formatIssPassReadout({ status: 'ok', pass, clockMode: 'utc' });
  assert.equal(utc.available, true);
  assert.equal(utc.rise, formatChromeClock(new Date(pass.riseMs), 'utc'));
  assert.ok(utc.rise.endsWith('Z'));
  assert.equal(utc.peakElevDeg, Math.round(pass.maxElevDeg));
  assert.ok(utc.peakElevDeg >= 10);
  assert.equal(utc.riseAzDeg, Math.round(pass.riseAzDeg));
  assert.match(utc.text, new RegExp(`^ISS ${utc.rise.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')} · PEAK ${utc.peakElevDeg}° · AZ ${utc.riseAzDeg}°$`));
  assert.match(utc.title, /Not an alert service/);
});

test('clock UTC | Local reformats the same rise instant', () => {
  const satrec = twoline2satrec(L1, L2);
  const pass = findNextIssPass({ satrec, ...AUSTIN, fromMs: FROM_MS, minElevDeg: 10 });
  const utc = formatIssPassReadout({ status: 'ok', pass, clockMode: 'utc' });
  const local = formatIssPassReadout({ status: 'ok', pass, clockMode: 'local' });
  assert.ok(utc.rise.endsWith('Z'));
  assert.equal(local.rise.endsWith('Z'), false);
  assert.equal(local.rise, formatChromeClock(new Date(pass.riseMs), 'local'));
  assert.equal(utc.peakElevDeg, local.peakElevDeg);
  assert.equal(utc.riseAzDeg, local.riseAzDeg);
});

test('no ISS satrec and no pass both read UNAVAILABLE', () => {
  assert.equal(formatIssPassReadout({ status: 'no-tle' }).text, ISS_PASS_UNAVAILABLE);
  assert.equal(formatIssPassReadout({ status: 'none' }).text, ISS_PASS_UNAVAILABLE);
  assert.equal(formatIssPassReadout({ status: 'ok', pass: null }).available, false);
  const empty = computeIssPassReadout({
    latDeg: AUSTIN.latDeg,
    lonDeg: AUSTIN.lonDeg,
    fromMs: FROM_MS,
    getPass: () => ({ status: 'none' }),
  });
  assert.equal(empty.text, ISS_PASS_UNAVAILABLE);
});

test('with ISS in the catalog the readout shows a future rise and peak elev', () => {
  try {
    seedIssCatalog();
    const result = getNextIssPass({ ...AUSTIN, fromMs: FROM_MS });
    assert.equal(result.status, 'ok');
    assert.ok(result.pass.riseMs > FROM_MS);
    assert.ok(result.pass.maxElevDeg >= 10);
    const painted = computeIssPassReadout({
      ...AUSTIN,
      fromMs: FROM_MS,
      clockMode: 'utc',
      getPass: getNextIssPass,
    });
    assert.equal(painted.available, true);
    assert.match(painted.text, /ISS \d{2}:\d{2}:\d{2}Z · PEAK \d+° · AZ \d+°/);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('camera pan updates after moveEnd, not during the flight', () => {
  seedIssCatalog();
  const harness = installReadout();
  try {
    const first = harness.root.textContent;
    assert.match(first, /^ISS /);
    const firstObserver = getIssPassReadoutObserverForTest();
    assert.equal(Math.round(firstObserver.latDeg), 30);

    harness.setPose(TOKYO.latDeg, TOKYO.lonDeg);
    harness.changed.raise();
    assert.equal(harness.root.textContent, first, 'changed must not recompute mid-flight');
    assert.equal(Math.round(getIssPassReadoutObserverForTest().latDeg), 30);

    harness.moveEnd.raise();
    const second = harness.root.textContent;
    assert.match(second, /^ISS /);
    assert.notEqual(second, first, 'a new hemisphere must change the printed rise');
    assert.equal(Math.round(getIssPassReadoutObserverForTest().latDeg), 36);
    assert.equal(harness.changed.listeners.length, 0, 'no per-frame / changed hook');
    assert.equal(harness.moveEnd.listeners.length, 1);
  } finally {
    harness.cleanup();
  }
});

test('satellites layer off hides the readout', () => {
  seedIssCatalog();
  const harness = installReadout({ visible: true });
  try {
    assert.equal(harness.root.hidden, false);
    assert.match(harness.root.textContent, /^ISS /);
    harness.setVisible(false);
    const hidden = syncIssPassReadout({ recompute: true });
    assert.equal(hidden.visible, false);
    assert.equal(harness.root.hidden, true);
  } finally {
    harness.cleanup();
  }
});

test('no ISS / no pass shows UNAVAILABLE', () => {
  try {
    _setDenseCatalogStateForTest({ coreSats: [] });
    const missing = computeIssPassReadout({
      ...AUSTIN,
      fromMs: FROM_MS,
      getPass: getNextIssPass,
    });
    assert.equal(missing.text, ISS_PASS_UNAVAILABLE);

    seedIssCatalog();
    const none = computeIssPassReadout({
      ...AUSTIN,
      fromMs: FROM_MS,
      getPass: (args) => getNextIssPass({ ...args, minElevDeg: 89.9 }),
    });
    assert.equal(none.text, ISS_PASS_UNAVAILABLE);
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('recalc does not refetch CelesTrak', () => {
  const fetches = [];
  seedIssCatalog();
  const harness = installReadout({ fetches });
  try {
    assert.deepEqual(fetches, []);
    harness.setPose(TOKYO.latDeg, TOKYO.lonDeg);
    harness.moveEnd.raise();
    assert.deepEqual(fetches, []);
    syncIssPassReadout({ recompute: true });
    assert.deepEqual(fetches, []);
  } finally {
    harness.cleanup();
  }
});

test('clock toggle reformats the cached pass without a camera move', () => {
  seedIssCatalog();
  const storage = {
    getItem() { return 'utc'; },
    setItem() {},
  };
  resetClockPreferenceCache();
  const harness = installReadout();
  try {
    const utcText = harness.root.textContent;
    assert.match(utcText, /\d{2}:\d{2}:\d{2}Z/);
    resetClockPreferenceCache();
    setClockMode('local', storage);
    harness.clockTarget.dispatch(CLOCK_CHANGE_EVENT);
    const localText = harness.root.textContent;
    assert.notEqual(localText, utcText);
    assert.doesNotMatch(localText, /\d{2}:\d{2}:\d{2}Z/);
    assert.equal(Math.round(getIssPassReadoutObserverForTest().latDeg), 30);
  } finally {
    harness.cleanup();
    resetClockPreferenceCache();
  }
});

test('observerFromCamera reads cartographic lat/lon', () => {
  const observer = observerFromCamera({ positionCartographic: toCarto(AUSTIN.latDeg, AUSTIN.lonDeg) });
  assert.ok(Math.abs(observer.latDeg - AUSTIN.latDeg) < 1e-9);
  assert.ok(Math.abs(observer.lonDeg - AUSTIN.lonDeg) < 1e-9);
  assert.equal(observerFromCamera(null), null);
});

test('the satellites row declares the readout next to sat class chips', () => {
  try {
    _setDenseCatalogStateForTest({});
    const controls = satellitesLayer.getRowControls();
    assert.equal(controls.readout.id, ISS_PASS_READOUT_ID);
    assert.equal(controls.readout.title, ISS_PASS_READOUT_TITLE);
    assert.ok(controls.chips.some((chip) => chip.id === 'catalog-core'));
    assert.ok(controls.legend === undefined || Array.isArray(controls.legend));
    satellitesLayer.setParams({ showPoints: false });
    assert.equal(
      satellitesLayer.getRowControls().readout?.id,
      ISS_PASS_READOUT_ID,
      'hiding points keeps the Next ISS readout on the row',
    );
  } finally {
    _clearDenseCatalogStateForTest();
  }
});

test('markup, wiring, and legal rails stay in the approved files', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
  const readout = readFileSync(path.join(ROOT, 'src/data/issPassReadout.js'), 'utf8');
  const satellites = readFileSync(path.join(ROOT, 'src/data/satellites.js'), 'utf8');
  const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  const pkg = readFileSync(path.join(ROOT, 'package.json'), 'utf8');

  assert.match(html, new RegExp(`id="${ISS_PASS_READOUT_PARK_ID}"`));
  assert.match(html, new RegExp(`id="${ISS_PASS_READOUT_ID}"`));
  assert.match(html, /id="iss-pass-readout"[\s\S]*UNAVAILABLE/);
  assert.match(html, /Not an alert service/);
  assert.match(ui, /initIssPassReadout/);
  assert.match(ui, /syncIssPassReadout/);
  assert.match(ui, /getNextIssPass/);
  assert.match(ui, /destroyIssPassReadout/);
  assert.doesNotMatch(readout, /\/api\//);
  assert.doesNotMatch(readout, /celestrak/);
  assert.doesNotMatch(readout, /opensky|google news|telegeography|quantum-earth/i);
  assert.match(satellites, /ISS_PASS_READOUT_ID/);
  assert.match(license, /MIT License/);
  assert.match(license, /MERIDIAN NOTICE/);
  assert.match(pkg, /"name": "meridian"/);
});

test('voice and HUD routes stay untouched', () => {
  const realtime = readFileSync(path.join(ROOT, 'api/realtime/token.js'), 'utf8');
  const hud = readFileSync(path.join(ROOT, 'api/openai/hud-summary.js'), 'utf8');
  const actions = readFileSync(path.join(ROOT, 'src/voice/gevActions.js'), 'utf8');
  const tools = readFileSync(path.join(ROOT, 'src/voice/realtimeTools.js'), 'utf8');
  const readout = readFileSync(path.join(ROOT, 'src/data/issPassReadout.js'), 'utf8');
  assert.doesNotMatch(realtime, /issPassReadout|ISS_PASS_READOUT/);
  assert.doesNotMatch(hud, /issPassReadout|ISS_PASS_READOUT/);
  assert.doesNotMatch(actions, /issPassReadout|ISS_PASS_READOUT/);
  assert.doesNotMatch(tools, /issPassReadout|ISS_PASS_READOUT/);
  assert.doesNotMatch(readout, /\/api\/realtime|hud-summary|voice token/);
  assert.match(actions, /function nextIssPass/);
  assert.match(tools, /name: 'next_iss_pass'/);
});
