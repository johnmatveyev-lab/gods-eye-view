import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { flyToHomeView, HOME_VIEW, HOME_VIEW_FIRST_PAINT } from './camera.js';
import { decodeShareViewUrl, encodeShareViewUrl, ShareLinkManager } from './sharelink.js';
import {
  LAST_VIEW_KEY,
  persistLastViewHash,
  readLastView,
  resolveBootShareHash,
  writeLastView,
} from './lastView.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const src = (name) => readFileSync(join(__dirname, name), 'utf8');
const root = (name) => readFileSync(join(repoRoot, name), 'utf8');

const HREF = 'https://meridian.example/';

function homeHash(pose = HOME_VIEW) {
  return `lat=${pose.lat}&lon=${pose.lon}&alt=${pose.alt}&heading=${pose.heading}&pitch=${pose.pitch}`;
}

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function cameraAt(pose) {
  return {
    positionCartographic: {
      latitude: pose.lat * Math.PI / 180,
      longitude: pose.lon * Math.PI / 180,
      height: pose.alt,
    },
    heading: (pose.heading ?? 0) * Math.PI / 180,
    pitch: (pose.pitch ?? -90) * Math.PI / 180,
    roll: 0,
    changed: { addEventListener() {} },
    moveEnd: { addEventListener() {} },
    cancelFlight() {},
    flyTo(options) {
      this.flights.push(options);
    },
    flights: [],
  };
}

function makeViewer(pose = { lat: 10, lon: 20, alt: 4000, heading: 80, pitch: -20 }) {
  const camera = cameraAt(pose);
  return {
    camera,
    scene: {
      camera,
      globe: { ellipsoid: {} },
    },
  };
}

function makeManager(hash = '', { storage, camera, lastViewThrottleMs = 0 } = {}) {
  globalThis.window = {
    location: { hash, href: `http://localhost/${hash}` },
    localStorage: storage || memoryStorage(),
  };
  globalThis.history = {
    replaceState(_state, _title, nextHash) {
      window.location.hash = nextHash;
    },
  };
  const moveEndListeners = [];
  const viewer = {
    camera: {
      changed: { addEventListener() {} },
      moveEnd: {
        addEventListener(listener) {
          moveEndListeners.push(listener);
          return () => {
            const index = moveEndListeners.indexOf(listener);
            if (index >= 0) moveEndListeners.splice(index, 1);
          };
        },
      },
      positionCartographic: { latitude: 0.528, longitude: -1.706, height: 800 },
      heading: 0.2,
      pitch: -0.6,
      roll: 0,
      ...camera,
    },
  };
  const manager = new ShareLinkManager(viewer, { storage, lastViewThrottleMs });
  manager._fireMoveEnd = () => {
    for (const listener of [...moveEndListeners]) listener();
  };
  return manager;
}

describe('HOME_VIEW matches first-load Austin settle', () => {
  it('is the cinematic settle pose from flyToAustin (not the 25 km flash)', () => {
    assert.equal(HOME_VIEW.lon, -97.7431);
    assert.equal(HOME_VIEW.lat, 30.2672);
    assert.equal(HOME_VIEW.alt, 600);
    assert.equal(HOME_VIEW.heading, 15);
    assert.equal(HOME_VIEW.pitch, -30);
  });

  it('first-paint flash stays the nadir 25 km Austin setView', () => {
    assert.equal(HOME_VIEW_FIRST_PAINT.alt, 25000);
    assert.equal(HOME_VIEW_FIRST_PAINT.heading, 0);
    assert.equal(HOME_VIEW_FIRST_PAINT.pitch, -90);
    assert.equal(HOME_VIEW_FIRST_PAINT.lon, HOME_VIEW.lon);
    assert.equal(HOME_VIEW_FIRST_PAINT.lat, HOME_VIEW.lat);
  });

  it('flyToAustin reads HOME_VIEW / HOME_VIEW_FIRST_PAINT so Home cannot drift', () => {
    const camera = src('camera.js');
    assert.match(camera, /export const HOME_VIEW = /);
    assert.match(camera, /export const HOME_VIEW_FIRST_PAINT = /);
    assert.match(camera, /destination:\s*Cesium\.Cartesian3\.fromDegrees\(\s*HOME_VIEW_FIRST_PAINT\.lon/);
    assert.match(camera, /destination:\s*Cesium\.Cartesian3\.fromDegrees\(\s*HOME_VIEW\.lon/);
    assert.match(camera, /heading:\s*Cesium\.Math\.toRadians\(HOME_VIEW\.heading\)/);
    assert.match(camera, /pitch:\s*Cesium\.Math\.toRadians\(HOME_VIEW\.pitch\)/);
  });
});

describe('Home from a random pose', () => {
  it('flyToHomeView flies to HOME_VIEW', () => {
    const viewer = makeViewer({ lat: 51.5, lon: -0.1, alt: 12000, heading: 200, pitch: -45 });
    const target = flyToHomeView(viewer, { duration: 0 });
    assert.equal(target.lon, HOME_VIEW.lon);
    assert.equal(target.lat, HOME_VIEW.lat);
    assert.equal(target.alt, HOME_VIEW.alt);
    assert.equal(target.heading, HOME_VIEW.heading);
    assert.equal(target.pitch, HOME_VIEW.pitch);
    assert.equal(viewer.camera.flights.length, 1);
  });

  it('does not delete lastView; moveEnd overwrites as today', () => {
    const storage = memoryStorage();
    const prior = encodeShareViewUrl(HREF, 'lat=40.7&lon=-74&alt=900&heading=12&pitch=-28');
    writeLastView(storage, prior);
    assert.equal(readLastView(storage), prior);

    const ui = src('ui.js');
    assert.match(ui, /goHome\(\)\s*\{/);
    assert.match(ui, /flyToHomeView\(this\.viewer/);
    assert.doesNotMatch(ui, /goHome\(\)[\s\S]{0,400}removeItem\(/);
    assert.doesNotMatch(ui, /goHome\(\)[\s\S]{0,400}LAST_VIEW_KEY/);

    persistLastViewHash(storage, HREF, homeHash());
    const afterMoveEnd = decodeShareViewUrl(readLastView(storage));
    assert.match(afterMoveEnd, /lat=30\.2672/);
    assert.match(afterMoveEnd, /lon=-97\.7431/);
    assert.match(afterMoveEnd, /alt=600/);
  });
});

describe('share URL after Home encodes the default pose', () => {
  it('currentShareUrl encodes HOME_VIEW after the camera is there', () => {
    const storage = memoryStorage();
    const manager = makeManager('', {
      storage,
      camera: cameraAt(HOME_VIEW),
    });
    const url = manager.currentShareUrl();
    assert.ok(url);
    const hash = decodeShareViewUrl(url);
    const params = new URLSearchParams(hash);
    assert.equal(params.get('lat'), HOME_VIEW.lat.toFixed(4));
    assert.equal(params.get('lon'), HOME_VIEW.lon.toFixed(4));
    assert.equal(params.get('alt'), String(HOME_VIEW.alt));
    assert.equal(params.get('heading'), String(HOME_VIEW.heading));
    assert.equal(params.get('pitch'), String(HOME_VIEW.pitch));
  });

  it('sharelink hash builder still writes lat/lon/alt/heading/pitch from the live camera', () => {
    const share = src('sharelink.js');
    assert.match(share, /_buildHashParams\(\)\s*\{/);
    assert.match(share, /params\.set\('lat'/);
    assert.match(share, /params\.set\('lon'/);
    assert.match(share, /params\.set\('alt'/);
  });
});

describe('lastView on boot still works; Home after that returns to default', () => {
  it('clean URL + stored lastView still wins at parseInitialHash', () => {
    const storedHash = 'lat=35.68&lon=139.76&alt=2200&heading=40&pitch=-25';
    const storage = memoryStorage({
      [LAST_VIEW_KEY]: encodeShareViewUrl(HREF, storedHash),
    });
    const manager = makeManager('#', { storage });
    const parsed = manager.parseInitialHash();
    assert.ok(parsed);
    assert.ok(Math.abs(parsed.lat - 35.68) < 0.0001);
    assert.ok(Math.abs(parsed.lon - 139.76) < 0.0001);
    assert.equal(parsed.alt, 2200);
    assert.equal(parsed.heading, 40);
    assert.equal(parsed.pitch, -25);
  });

  it('share URL still beats lastView', () => {
    const storage = memoryStorage({
      [LAST_VIEW_KEY]: encodeShareViewUrl(HREF, 'lat=1&lon=2&alt=100&heading=0&pitch=-90'),
    });
    const manager = makeManager('#lat=48.86&lon=2.35&alt=900&heading=10&pitch=-40', { storage });
    const parsed = manager.parseInitialHash();
    assert.ok(Math.abs(parsed.lat - 48.86) < 0.0001);
    assert.ok(Math.abs(parsed.lon - 2.35) < 0.0001);
  });

  it('Home after a lastView restore still targets HOME_VIEW, not the stored pose', () => {
    const last = { lat: 41.9, lon: 12.5, alt: 1500, heading: 90, pitch: -40 };
    assert.notEqual(last.lat, HOME_VIEW.lat);
    const viewer = makeViewer(last);
    const target = flyToHomeView(viewer, { duration: 0 });
    assert.equal(target.lat, HOME_VIEW.lat);
    assert.equal(target.lon, HOME_VIEW.lon);
    assert.equal(target.alt, HOME_VIEW.alt);
  });

  it('resolveBootShareHash is unchanged by Home chrome', () => {
    const lastView = encodeShareViewUrl(HREF, 'lat=12&lon=34&alt=500&heading=0&pitch=-90');
    const hash = resolveBootShareHash('', lastView);
    assert.match(hash, /lat=12/);
    assert.match(hash, /lon=34/);
  });
});

describe('Home chrome: button, Home key, no /api, no billing', () => {
  it('top-center actions include #home-view next to globe reset', () => {
    const html = root('index.html');
    const block = html.match(/id="top-center-actions"[\s\S]*?<\/nav>/)[0];
    assert.match(block, /id="home-view"/);
    assert.match(block, /id="reset-globe-view"/);
    assert.match(block, /home-view[\s\S]*reset-globe-view/);
    assert.match(block, /aria-keyshortcuts="Home"/);
    assert.match(block, /title="Home view \(Home\)"/);
  });

  it('StyleManager wires click + Home key (not H — HUD already owns H)', () => {
    const ui = src('ui.js');
    assert.match(ui, /getElementById\('home-view'\)/);
    assert.match(ui, /addEventListener\('click',\s*\(\)\s*=>\s*this\.goHome\(\)\)/);
    assert.match(ui, /e\.key === 'Home'/);
    assert.match(ui, /this\.goHome\(\)/);
    assert.match(ui, /\/\/ h = HUD toggle — Home view uses the Home key, not H/);
  });

  it('cockpit / recording / scene-playback hide Home with the other camera chrome', () => {
    const css = root('style.css');
    assert.match(css, /body\.cockpit-mode :is\([^)]*#home-view/);
    assert.match(css, /body\.recording-mode #top-center-actions/);
    assert.match(css, /body\.scene-playback-mode :is\([^)]*#home-view/);
  });

  it('does not invent /api or billing hooks', () => {
    const ui = src('ui.js');
    const homeFn = ui.match(/goHome\(\)\s*\{[\s\S]*?\n  \}/)[0];
    assert.doesNotMatch(homeFn, /\/api\//);
    assert.doesNotMatch(homeFn, /entitlement/i);
    assert.doesNotMatch(homeFn, /isPro/);
    assert.doesNotMatch(src('camera.js'), /\/api\/home/);
  });
});
