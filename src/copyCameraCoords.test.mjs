import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CAMERA_COORDS_COPY_ID,
  CAMERA_COORDS_ROOT_ID,
  CAMERA_COORDS_VALUE_ID,
  COORD_DECIMALS,
  cameraCenterCoords,
  copiedCoordsToast,
  copyCameraCenterCoords,
  destroyCameraCoords,
  formatLatLon,
  formatLonLat,
  getCameraCoordsForTest,
  initCameraCoords,
  syncCameraCoords,
} from './copyCameraCoords.js';

/** Settled first-load / Home pose. Same numbers as HOME_VIEW in camera.js. */
const HOME_VIEW = Object.freeze({ lat: 30.2672, lon: -97.7431, alt: 600 });
const HOME_LAT_LON = '30.2672,-97.7431';
const HOME_LON_LAT = '-97.7431,30.2672';
const MOVED = { lat: 51.5074, lon: -0.1278 };

function toCarto(pose) {
  return {
    latitude: pose.lat * Math.PI / 180,
    longitude: pose.lon * Math.PI / 180,
    height: pose.alt ?? 600,
  };
}

class MockButton {
  constructor(id) {
    this.id = id;
    this.textContent = '';
    this.title = '';
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
  }

  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(handler);
  }

  removeEventListener(name, handler) {
    this.listeners.get(name)?.delete(handler);
  }

  click() {
    const event = { preventDefault() {}, stopPropagation() {} };
    let result;
    for (const handler of [...(this.listeners.get('click') || [])]) {
      result = handler(event);
    }
    return result;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

class MockRoot {
  constructor() {
    this.id = CAMERA_COORDS_ROOT_ID;
    this.hidden = false;
    this.dataset = {};
  }
}

function makeCesiumEvent() {
  const listeners = new Set();
  return {
    addEventListener(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    raise() {
      for (const callback of [...listeners]) callback();
    },
  };
}

function installHarness({
  pose = HOME_VIEW,
  clipboardWrites = [],
  toasts = [],
} = {}) {
  const root = new MockRoot();
  const valueButton = new MockButton(CAMERA_COORDS_VALUE_ID);
  const copyButton = new MockButton(CAMERA_COORDS_COPY_ID);
  const changed = makeCesiumEvent();
  const moveEnd = makeCesiumEvent();
  const viewer = {
    camera: {
      positionCartographic: toCarto(pose),
      changed,
      moveEnd,
    },
  };
  initCameraCoords({
    viewer,
    force: true,
    root,
    valueButton,
    copyButton,
    showToast: (text) => toasts.push(text),
    clipboard: { writeText: async (text) => { clipboardWrites.push(text); } },
  });
  return {
    root,
    valueButton,
    copyButton,
    viewer,
    changed,
    moveEnd,
    setPose(next) {
      viewer.camera.positionCartographic = toCarto(next);
    },
    cleanup() {
      destroyCameraCoords();
    },
  };
}

test('camera-center coords are the existing pose lat/lon, formatted lat,lon', () => {
  assert.equal(COORD_DECIMALS, 4);
  assert.deepEqual(cameraCenterCoords({ positionCartographic: toCarto(HOME_VIEW) }), {
    lat: HOME_VIEW.lat,
    lon: HOME_VIEW.lon,
  });
  assert.equal(formatLatLon(HOME_VIEW.lat, HOME_VIEW.lon), HOME_LAT_LON);
  assert.equal(formatLonLat(HOME_VIEW.lat, HOME_VIEW.lon), HOME_LON_LAT);
  assert.equal(copiedCoordsToast(HOME_LAT_LON), `Copied ${HOME_LAT_LON}`);
});

test('copy writes numeric lat,lon of the camera center, not a URL or ident', async () => {
  const clipboardWrites = [];
  const toasts = [];
  const harness = installHarness({ clipboardWrites, toasts });
  try {
    assert.equal(harness.valueButton.textContent, HOME_LAT_LON);
    assert.equal(getCameraCoordsForTest()?.latLon, HOME_LAT_LON);
    await harness.copyButton.click();
    assert.deepEqual(clipboardWrites, [HOME_LAT_LON]);
    assert.deepEqual(toasts, [`Copied ${HOME_LAT_LON}`]);
    assert.match(clipboardWrites[0], /^-?\d+\.\d+,-?\d+\.\d+$/);
    assert.doesNotMatch(clipboardWrites[0], /https?:|UAL|Austin|Texas/i);
  } finally {
    harness.cleanup();
  }
});

test('clicking the shown coords also copies lat,lon', async () => {
  const clipboardWrites = [];
  const harness = installHarness({ clipboardWrites });
  try {
    await harness.valueButton.click();
    assert.deepEqual(clipboardWrites, [HOME_LAT_LON]);
  } finally {
    harness.cleanup();
  }
});

test('move camera, then copy, writes the new camera-center coords', async () => {
  const clipboardWrites = [];
  const harness = installHarness({ clipboardWrites });
  try {
    await harness.copyButton.click();
    assert.deepEqual(clipboardWrites, [HOME_LAT_LON]);

    harness.setPose(MOVED);
    harness.changed.raise();
    syncCameraCoords();
    const movedText = formatLatLon(MOVED.lat, MOVED.lon);
    assert.equal(harness.valueButton.textContent, movedText);
    assert.notEqual(movedText, HOME_LAT_LON);

    clipboardWrites.length = 0;
    await harness.copyButton.click();
    assert.deepEqual(clipboardWrites, [movedText]);
  } finally {
    harness.cleanup();
  }
});

test('Home pose then copy is the default first-load coords', async () => {
  const clipboardWrites = [];
  const harness = installHarness({
    pose: { lat: 41.9, lon: 12.5, alt: 1500 },
    clipboardWrites,
  });
  try {
    assert.equal(harness.valueButton.textContent, formatLatLon(41.9, 12.5));
    harness.setPose(HOME_VIEW);
    harness.moveEnd.raise();
    syncCameraCoords();
    assert.equal(harness.valueButton.textContent, HOME_LAT_LON);
    await harness.copyButton.click();
    assert.deepEqual(clipboardWrites, [HOME_LAT_LON]);
    assert.equal(clipboardWrites[0], formatLatLon(HOME_VIEW.lat, HOME_VIEW.lon));
  } finally {
    harness.cleanup();
  }
});

test('lon,lat is available as the secondary GIS order, but copy prefers share-link lat,lon', async () => {
  const writes = [];
  const ok = await copyCameraCenterCoords(HOME_VIEW, {
    clipboard: { writeText: async (text) => { writes.push(text); } },
  });
  assert.equal(ok, true);
  assert.deepEqual(writes, [HOME_LAT_LON]);
  assert.equal(formatLonLat(HOME_VIEW.lat, HOME_VIEW.lon), HOME_LON_LAT);
});

test('the chrome shows camera-center coords and a copy control; no height, no units, no /api', async () => {
  const markup = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('./copyCameraCoords.js', import.meta.url), 'utf8');
  const ui = await readFile(new URL('./ui.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(markup, new RegExp(`id="${CAMERA_COORDS_ROOT_ID}"`));
  assert.match(markup, new RegExp(`id="${CAMERA_COORDS_VALUE_ID}"`));
  assert.match(markup, new RegExp(`id="${CAMERA_COORDS_COPY_ID}"`));
  assert.match(markup, /id="top-center-actions"[\s\S]*id="copy-view-link"[\s\S]*id="camera-coords"/);
  const coordsBlock = markup.match(/id="camera-coords"[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(coordsBlock, /camera-coords-copy/);
  assert.doesNotMatch(coordsBlock, /units-/);
  assert.doesNotMatch(coordsBlock, /altitude/i);

  assert.match(ui, /initCameraCoords/);
  assert.match(ui, /destroyCameraCoords/);
  assert.match(source, /positionCartographic/);
  assert.doesNotMatch(source, /\/api\//);
  assert.doesNotMatch(source, /geocode|places|person-search|OpenSky|Google News|TeleGeography/i);
  assert.doesNotMatch(source, /Austin|Tokyo|London/i);
  assert.doesNotMatch(source, /formatHudAltitude|getDistanceUnit|meridian\.units/);

  const camera = await readFile(new URL('./camera.js', import.meta.url), 'utf8');
  assert.match(camera, /lat:\s*30\.2672/);
  assert.match(camera, /lon:\s*-97\.7431/);
});
