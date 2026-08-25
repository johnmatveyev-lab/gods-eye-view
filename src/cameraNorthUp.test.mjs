import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Cesium from 'cesium';
import { ShareLinkManager } from './sharelink.js';
import {
  applyNorthUp,
  compassNeedleDeg,
  northUpHeadingPitchRange,
  resolveNorthUpTarget,
} from './cameraNorthUp.js';
import { flyToHomeView, HOME_VIEW } from './camera.js';
import { flyToGlobeView, GLOBE_VIEW } from './locations.js';

const ui = fs.readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

const AUSTIN = { lon: -97.7431, lat: 30.2672 };

function stubCamera({
  heading = Cesium.Math.toRadians(48),
  pitch = Cesium.Math.toRadians(-32),
  height = 1200,
  lon = AUSTIN.lon,
  lat = AUSTIN.lat,
} = {}) {
  const positionWC = Cesium.Cartesian3.fromDegrees(lon, lat, height);
  const lookAtCalls = [];
  const setViewCalls = [];
  return {
    heading,
    pitch,
    roll: Cesium.Math.toRadians(6),
    positionWC,
    positionCartographic: Cesium.Cartographic.fromCartesian(positionWC),
    lookAtCalls,
    setViewCalls,
    lookAt(target, hpr) {
      lookAtCalls.push({ target, hpr });
      this.heading = hpr.heading;
      this.pitch = hpr.pitch;
    },
    lookAtTransform() {},
    setView(options) {
      setViewCalls.push(options);
      if (Number.isFinite(options?.orientation?.heading)) this.heading = options.orientation.heading;
      if (Number.isFinite(options?.orientation?.pitch)) this.pitch = options.orientation.pitch;
      if (Number.isFinite(options?.orientation?.roll)) this.roll = options.orientation.roll;
    },
  };
}

function shareManagerForCamera(camera) {
  globalThis.window = { location: { hash: '', href: 'http://localhost/' } };
  globalThis.history = {
    replaceState(_state, _title, nextHash) {
      window.location.hash = nextHash;
    },
  };
  return new ShareLinkManager({
    camera: {
      changed: { addEventListener() {} },
      moveEnd: { addEventListener() { return () => {}; } },
      positionCartographic: camera.positionCartographic,
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll ?? 0,
    },
  });
}

test('the needle tracks heading so N sits up when the camera faces north', () => {
  assert.equal(compassNeedleDeg(0), 0);
  assert.equal(compassNeedleDeg(Cesium.Math.toRadians(90)), -90);
  assert.equal(compassNeedleDeg(Cesium.Math.toRadians(180)), -180);
  assert.equal(compassNeedleDeg(Number.NaN), 0);
});

test('tilt and twist then north-up keeps target, range, and tilt with heading 0', () => {
  const pitch = Cesium.Math.toRadians(-28);
  const camera = stubCamera({ heading: Cesium.Math.toRadians(117), pitch, height: 2400 });
  const target = Cesium.Cartesian3.fromDegrees(AUSTIN.lon, AUSTIN.lat, 0);
  const rangeBefore = Cesium.Cartesian3.distance(camera.positionWC, target);
  const heightBefore = camera.positionCartographic.height;
  const latBefore = camera.positionCartographic.latitude;
  const lonBefore = camera.positionCartographic.longitude;

  const applied = applyNorthUp(camera, target);

  assert.equal(applied.mode, 'lookAt');
  assert.equal(applied.heading, 0);
  assert.equal(applied.pitch, pitch);
  assert.equal(applied.range, rangeBefore);
  assert.equal(camera.heading, 0);
  assert.equal(camera.pitch, pitch);
  assert.equal(camera.lookAtCalls.length, 1);
  assert.equal(camera.lookAtCalls[0].target, target);
  assert.equal(camera.lookAtCalls[0].hpr.heading, 0);
  assert.equal(camera.lookAtCalls[0].hpr.pitch, pitch);
  assert.equal(camera.lookAtCalls[0].hpr.range, rangeBefore);
  assert.equal(camera.setViewCalls.length, 0);
  assert.equal(camera.positionCartographic.height, heightBefore);
  assert.equal(camera.positionCartographic.latitude, latBefore);
  assert.equal(camera.positionCartographic.longitude, lonBefore);
});

test('without a ground target, north-up only zeros heading and keeps the camera pose', () => {
  const pitch = Cesium.Math.toRadians(-41);
  const camera = stubCamera({ heading: Cesium.Math.toRadians(-75), pitch, height: 880 });
  const before = {
    lat: camera.positionCartographic.latitude,
    lon: camera.positionCartographic.longitude,
    height: camera.positionCartographic.height,
    pitch: camera.pitch,
  };

  const applied = applyNorthUp(camera, null);

  assert.equal(applied.mode, 'inPlace');
  assert.equal(camera.heading, 0);
  assert.equal(camera.pitch, before.pitch);
  assert.equal(camera.roll, 0);
  assert.equal(camera.positionCartographic.latitude, before.lat);
  assert.equal(camera.positionCartographic.longitude, before.lon);
  assert.equal(camera.positionCartographic.height, before.height);
  assert.equal(camera.lookAtCalls.length, 0);
  assert.equal(camera.setViewCalls.length, 1);
  assert.deepEqual(camera.setViewCalls[0].orientation, {
    heading: 0,
    pitch,
    roll: 0,
  });
});

test('Home / Reset Globe still uses the full default globe pose; north-up does not', () => {
  const flights = [];
  const viewer = {
    flights,
    camera: {
      positionCartographic: {
        longitude: Cesium.Math.toRadians(AUSTIN.lon),
        latitude: Cesium.Math.toRadians(AUSTIN.lat),
        height: 1400,
      },
      heading: Cesium.Math.toRadians(80),
      pitch: Cesium.Math.toRadians(-30),
      cancelFlight() {},
      flyTo(options) { flights.push(options); },
    },
  };
  flyToGlobeView(viewer);
  assert.equal(flights.length, 1);
  assert.equal(flights[0].orientation.heading, 0);
  assert.equal(flights[0].orientation.pitch, Cesium.Math.toRadians(GLOBE_VIEW.pitchDeg));
  assert.equal(GLOBE_VIEW.heightM, 18000000);

  const homeFlights = [];
  const homeViewer = {
    camera: {
      cancelFlight() {},
      flyTo(options) { homeFlights.push(options); },
    },
  };
  const homeTarget = flyToHomeView(homeViewer);
  assert.equal(homeTarget.lat, HOME_VIEW.lat);
  assert.equal(homeTarget.lon, HOME_VIEW.lon);
  assert.equal(homeTarget.alt, HOME_VIEW.alt);
  assert.equal(homeTarget.heading, HOME_VIEW.heading);
  assert.equal(homeTarget.pitch, HOME_VIEW.pitch);
  assert.equal(homeFlights[0].orientation.heading, Cesium.Math.toRadians(15));

  const camera = stubCamera({ heading: Cesium.Math.toRadians(80), pitch: Cesium.Math.toRadians(-30), height: 1400 });
  applyNorthUp(camera, null);
  assert.equal(camera.heading, 0);
  assert.equal(camera.pitch, Cesium.Math.toRadians(-30));
  assert.ok(Math.abs(camera.positionCartographic.height - 1400) < 1e-6);

  const resetStart = ui.indexOf('resetToGlobeView() {');
  const reset = ui.slice(resetStart, ui.indexOf('setNorthUp() {', resetStart));
  const homeStart = ui.indexOf('goHome() {');
  const home = ui.slice(homeStart, ui.indexOf('_initResetGlobeButton() {', homeStart));
  const northUpStart = ui.indexOf('setNorthUp() {');
  const northUp = ui.slice(northUpStart, ui.indexOf('_initShareButton() {', northUpStart));
  assert.match(reset, /flyToGlobeView\(this\.viewer/);
  assert.match(reset, /GLOBE_VIEW\.heightM/);
  assert.match(home, /flyToHomeView\(this\.viewer\)/);
  assert.doesNotMatch(northUp, /flyToGlobeView/);
  assert.doesNotMatch(northUp, /flyToHomeView/);
  assert.doesNotMatch(northUp, /GLOBE_VIEW/);
  assert.doesNotMatch(northUp, /HOME_VIEW/);
  assert.match(northUp, /applyNorthUp\(/);
});

test('share URL after north-up encodes heading 0 without adding share fields', () => {
  const camera = stubCamera({
    heading: Cesium.Math.toRadians(206),
    pitch: Cesium.Math.toRadians(-35),
    height: 800,
  });
  applyNorthUp(camera, null);
  const manager = shareManagerForCamera(camera);
  const params = manager._buildHashParams();
  assert.equal(params.get('heading'), '0');
  assert.equal(params.get('pitch'), '-35');
  assert.equal(params.get('alt'), '800');
  assert.equal(params.has('north'), false);
  assert.equal(params.has('compass'), false);
});

test('north-up plan stays in-place when the target is coincident with the eye', () => {
  const camera = stubCamera();
  const plan = northUpHeadingPitchRange(camera, camera.positionWC);
  assert.equal(plan.mode, 'inPlace');
  assert.equal(plan.heading, 0);
});

test('resolveNorthUpTarget rejects empty canvases and non-Earth picks', () => {
  assert.equal(resolveNorthUpTarget(null), null);
  assert.equal(resolveNorthUpTarget({ camera: {}, scene: { canvas: { clientWidth: 0, clientHeight: 0 } } }), null);

  const miss = {
    camera: { pickEllipsoid() { return undefined; } },
    scene: { canvas: { clientWidth: 800, clientHeight: 600 } },
  };
  assert.equal(resolveNorthUpTarget(miss), null);

  const origin = {
    camera: { pickEllipsoid() { return new Cesium.Cartesian3(0, 0, 0); } },
    scene: { canvas: { clientWidth: 800, clientHeight: 600 } },
  };
  assert.equal(resolveNorthUpTarget(origin), null);

  const earth = Cesium.Cartesian3.fromDegrees(AUSTIN.lon, AUSTIN.lat, 0);
  const hit = {
    camera: { pickEllipsoid() { return earth; } },
    scene: { canvas: { clientWidth: 800, clientHeight: 600 } },
  };
  assert.equal(resolveNorthUpTarget(hit), earth);
});

test('the compass is map camera chrome beside Share and Reset Globe', () => {
  const actions = html.match(/<nav id="top-center-actions"[\s\S]*?<\/nav>/);
  assert.ok(actions, 'top-center globe actions are missing');
  assert.match(
    actions[0],
    /id="clear-selected-layers"[\s\S]*?id="share-btn"[\s\S]*?id="north-up-compass"[\s\S]*?id="home-view"[\s\S]*?id="stop-tracking"[\s\S]*?id="copy-view-link"[\s\S]*?id="fullscreen-view"[\s\S]*?id="reset-globe-view"/,
  );
  assert.equal((html.match(/id="north-up-compass"/g) || []).length, 1);
  assert.match(html, /id="north-up-compass"[^>]*aria-label="Set heading north-up"/);
  assert.match(html, /id="north-up-compass"[^>]*aria-keyshortcuts="N"/);
  assert.match(css, /#north-up-compass \.north-up-compass-rose/);
  assert.match(css, /--north-up-heading/);
  assert.match(
    css,
    /body\.cockpit-mode :is\(#clear-selected-layers, #restore-live-layers, #clear-annotations, #share-btn, #north-up-compass, #home-view, #stop-tracking, #copy-view-link, #fullscreen-view, #clean-view-chrome, #reset-globe-view, #earthquake-list-toggle, #earthquake-list-panel\)/,
  );
  assert.match(
    css,
    /body\.scene-playback-mode :is\(#clear-selected-layers, #restore-live-layers, #clear-annotations, #home-view, #north-up-compass, #stop-tracking, #reset-globe-view, #earthquake-list-toggle, #earthquake-list-panel\)/,
  );
  assert.match(ui, /e\.key\.toLowerCase\(\) === 'n'/);
  assert.match(ui, /this\.cockpitView\?\.active/);
  assert.doesNotMatch(ui, /\/api\/.*compass|\/api\/.*north-up/);
});
