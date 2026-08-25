import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  STOP_TRACKING_BUTTON_ID,
  STOP_TRACKING_LABEL,
  hasTrackedTarget,
  posesEqual,
  readTrackingState,
  snapshotCameraPose,
  stopTrackingInPlace,
  syncStopTrackingButton,
} from './stopTracking.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ui = readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');
const css = readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const chrome = readFileSync(path.join(ROOT, 'src', 'chrome', 'stopTracking.js'), 'utf8');
const awareness = readFileSync(path.join(ROOT, 'src', 'data', 'militaryAwareness.js'), 'utf8');
const license = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');

function makeButton() {
  return {
    hidden: true,
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
  };
}

function makeCamera(overrides = {}) {
  return {
    positionCartographic: {
      latitude: 0.528,
      longitude: -1.706,
      height: 4200,
    },
    heading: 0.2,
    pitch: -0.6,
    roll: 0,
    ...overrides,
  };
}

test('Stop tracking stays hidden until a target is locked', () => {
  assert.equal(hasTrackedTarget({}), false);
  assert.equal(hasTrackedTarget({ trackedEntity: null, trackedInfo: null }), false);

  const idle = makeButton();
  assert.equal(syncStopTrackingButton(idle, {}), false);
  assert.equal(idle.hidden, true);
  assert.equal(idle.attrs['aria-hidden'], 'true');

  const locked = makeButton();
  assert.equal(syncStopTrackingButton(locked, { trackedInfo: { icao24: 'abc123' } }), true);
  assert.equal(locked.hidden, false);
  assert.equal(locked.attrs['aria-hidden'], 'false');

  const entityLocked = makeButton();
  assert.equal(syncStopTrackingButton(entityLocked, { trackedEntity: { id: 'sat:25544' } }), true);
  assert.equal(entityLocked.hidden, false);
});

test('Stop tracking releases the existing clear-target action and leaves pose unchanged', () => {
  const camera = makeCamera();
  const before = snapshotCameraPose(camera);
  let released = 0;
  let flewHome = 0;

  const result = stopTrackingInPlace({
    camera,
    releaseFollow() {
      released += 1;
      return { ok: true, action: 'stop_tracking' };
    },
  });

  assert.equal(released, 1);
  assert.equal(flewHome, 0);
  assert.equal(result.released.action, 'stop_tracking');
  assert.equal(result.poseUnchanged, true);
  assert.deepEqual(result.before, before);
  assert.deepEqual(result.after, before);
  assert.equal(posesEqual(result.before, result.after), true);
});

test('Home still does the full default pose reset; Stop tracking does not', () => {
  const home = ui.slice(ui.indexOf('goHome() {'));
  assert.match(home, /flyToHomeView\(this\.viewer\)/);
  assert.match(ui, /this\._homeViewBtn\?\.addEventListener\('click', \(\) => this\.goHome\(\)\)/);
  assert.match(ui, /if \(e\.key === 'Home'\) \{[\s\S]*?this\.goHome\(\)/);
  assert.match(html, /id="home-view"[^>]*aria-label="Home view"/);

  const stopInitStart = ui.indexOf('_initStopTrackingButton() {');
  const stopInitEnd = ui.indexOf('_initResetGlobeButton() {', stopInitStart);
  assert.ok(stopInitStart >= 0 && stopInitEnd > stopInitStart, 'Stop tracking init is missing');
  const stopInit = ui.slice(stopInitStart, stopInitEnd);
  assert.match(
    stopInit,
    /stopTrackingInPlace\(\{[\s\S]*?releaseFollow: \(\) => this\._releaseFollowCamera\(\{ trackingOrigin: 'user' \}\)/,
  );
  assert.doesNotMatch(stopInit, /goHome|flyToHomeView|resetToGlobeView|flyToGlobeView/, 'Stop tracking must not adopt the Home flight');
  assert.doesNotMatch(chrome, /flyToHomeView|goHome|flyToGlobeView|resetToGlobeView|GLOBE_VIEW|HOME_VIEW/);
});

test('roster click still tracks; Stop tracking is camera chrome only', () => {
  assert.match(
    awareness,
    /return flightsLayer\.refocusTrackedById\?\.\(id, \{ origin \}\) \|\| flightsLayer\.trackById\(id, \{ origin \}\)/,
  );
  assert.match(
    awareness,
    /class="military-awareness-target"[^>]*data-awareness-layer/,
  );
  assert.doesNotMatch(awareness, /stop-tracking|Stop tracking/);
  assert.doesNotMatch(html, /id="cockpit-entry"[\s\S]{0,400}stop-tracking/);
  assert.doesNotMatch(html, /id="contacts-roster-toggle"[^>]*stop-tracking/);

  const topCenter = html.match(/<nav id="top-center-actions"[\s\S]*?<\/nav>/);
  assert.ok(topCenter, 'camera chrome nav is missing');
  assert.match(
    topCenter[0],
    /id="contacts-roster-toggle"[\s\S]*?id="clear-selected-layers"[\s\S]*?id="clear-annotations"[\s\S]*?id="share-btn"[\s\S]*?id="home-view"[\s\S]*?id="stop-tracking"[\s\S]*?id="copy-view-link"[\s\S]*?id="copy-view-snapshot"[\s\S]*?id="fullscreen-view"[\s\S]*?id="reset-globe-view"/,
  );
  assert.match(
    topCenter[0],
    /id="stop-tracking"[^>]*type="button"[^>]*hidden[^>]*aria-label="Stop tracking"/,
  );
  assert.match(topCenter[0], /Stop tracking\s*<\/button>/);
  assert.equal((html.match(/id="stop-tracking"/g) || []).length, 1);
});

test('readTrackingState prefers a live follow target and stays chrome-only', () => {
  const state = readTrackingState({
    viewer: { trackedEntity: { id: 'viewer' } },
    cockpitTrackedEntity: { id: 'cockpit' },
    getFlightInfo: () => ({ icao24: 'a1' }),
    getMilitaryInfo: () => ({ icao24: 'mil' }),
    getSatelliteInfo: () => ({ noradId: 25544 }),
  });
  assert.equal(state.trackedEntity.id, 'viewer');
  assert.equal(state.trackedInfo.icao24, 'a1');

  const idle = readTrackingState({
    viewer: { trackedEntity: null },
    getFlightInfo: () => null,
    getMilitaryInfo: () => null,
    getSatelliteInfo: () => null,
  });
  assert.equal(hasTrackedTarget(idle), false);
});

test('Stop tracking chrome stays legal: Meridian title, MIT credit, no /api', () => {
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.equal(STOP_TRACKING_BUTTON_ID, 'stop-tracking');
  assert.equal(STOP_TRACKING_LABEL, 'Stop tracking');
  assert.doesNotMatch(chrome, /\/api\//);
  assert.doesNotMatch(chrome, /OpenSky|Google News|TeleGeography|quantum-earth|God's Eye View/i);
  assert.match(css, /#top-center-actions #stop-tracking\[hidden\]/);
  assert.match(ui, /this\._initStopTrackingButton\(\)/);
  assert.match(ui, /this\._syncStopTrackingButton\(\)/);
});
