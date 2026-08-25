import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mgrs from 'mgrs';
import {
  CAMERA_COORDS_COPY_ID,
  CAMERA_COORDS_MGRS_ID,
  CAMERA_COORDS_ROOT_ID,
  CAMERA_COORDS_VALUE_ID,
  COORD_DECIMALS,
  cameraCenterCoords,
  copiedCoordsToast,
  copyCameraCenterCoords,
  destroyCameraCoords,
  formatCopiedCoords,
  formatLatLon,
  formatLonLat,
  formatMgrs,
  getCameraCoordsForTest,
  initCameraCoords,
  syncCameraCoords,
} from './copyCameraCoords.js';

/** Settled first-load / Home pose. Same numbers as HOME_VIEW in camera.js. */
const HOME_VIEW = Object.freeze({ lat: 30.2672, lon: -97.7431, alt: 600 });
const HOME_LAT_LON = '30.2672,-97.7431';
const HOME_LON_LAT = '-97.7431,30.2672';
const MOVED = { lat: 51.5074, lon: -0.1278 };
const POLAR = { lat: 85, lon: 0, alt: 600 };

/** Independent of production formatting — `mgrs.forward([lon, lat], 4)` then spaces. */
function expectedMgrs(lat, lon) {
  const raw = mgrs.forward([lon, lat], 4);
  const match = raw.match(/^(\d{1,2}[A-Z])([A-Z]{2})(\d+)$/);
  assert.ok(match, `mgrs.forward should yield a grid for ${lat},${lon}`);
  const [, zone, square, coords] = match;
  const half = coords.length / 2;
  return `MGRS ${zone} ${square} ${coords.slice(0, half)} ${coords.slice(half)}`;
}

function expectedCopy(lat, lon) {
  const mgrsLine = expectedMgrs(lat, lon);
  return `${formatLatLon(lat, lon)}\n${mgrsLine}`;
}

const HOME_MGRS = expectedMgrs(HOME_VIEW.lat, HOME_VIEW.lon);
const HOME_COPY = expectedCopy(HOME_VIEW.lat, HOME_VIEW.lon);
const MOVED_COPY = expectedCopy(MOVED.lat, MOVED.lon);

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

class MockMgrs {
  constructor() {
    this.id = CAMERA_COORDS_MGRS_ID;
    this.textContent = '';
    this.hidden = true;
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
  const mgrsEl = new MockMgrs();
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
    mgrsEl,
    showToast: (text) => toasts.push(text),
    clipboard: { writeText: async (text) => { clipboardWrites.push(text); } },
  });
  return {
    root,
    valueButton,
    copyButton,
    mgrsEl,
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

test('copy writes numeric lat,lon plus the MGRS line, not a URL or ident', async () => {
  const clipboardWrites = [];
  const toasts = [];
  const harness = installHarness({ clipboardWrites, toasts });
  try {
    assert.equal(harness.valueButton.textContent, HOME_LAT_LON);
    assert.equal(harness.mgrsEl.textContent, HOME_MGRS);
    assert.equal(harness.mgrsEl.hidden, false);
    assert.equal(getCameraCoordsForTest()?.latLon, HOME_LAT_LON);
    assert.equal(getCameraCoordsForTest()?.mgrs, HOME_MGRS);
    await harness.copyButton.click();
    assert.deepEqual(clipboardWrites, [HOME_COPY]);
    assert.deepEqual(toasts, [`Copied ${HOME_LAT_LON}`]);
    const [latLonLine, mgrsLine] = clipboardWrites[0].split('\n');
    assert.match(latLonLine, /^-?\d+\.\d+,-?\d+\.\d+$/);
    assert.equal(mgrsLine, HOME_MGRS);
    assert.doesNotMatch(clipboardWrites[0], /https?:|UAL|Austin|Texas/i);
  } finally {
    harness.cleanup();
  }
});

test('CONUS pointer MGRS matches the lat/lon already shown', () => {
  const harness = installHarness();
  try {
    assert.equal(harness.valueButton.textContent, HOME_LAT_LON);
    assert.equal(formatMgrs(HOME_VIEW.lat, HOME_VIEW.lon), HOME_MGRS);
    assert.equal(harness.mgrsEl.textContent, formatMgrs(HOME_VIEW.lat, HOME_VIEW.lon));
    assert.equal(formatCopiedCoords(HOME_VIEW.lat, HOME_VIEW.lon), HOME_COPY);
  } finally {
    harness.cleanup();
  }
});

test('clicking the shown coords also copies lat,lon plus MGRS', async () => {
  const clipboardWrites = [];
  const harness = installHarness({ clipboardWrites });
  try {
    await harness.valueButton.click();
    assert.deepEqual(clipboardWrites, [HOME_COPY]);
  } finally {
    harness.cleanup();
  }
});

test('move pointer, then copy, writes the new camera-center coords and MGRS', async () => {
  const clipboardWrites = [];
  const harness = installHarness({ clipboardWrites });
  try {
    await harness.copyButton.click();
    assert.deepEqual(clipboardWrites, [HOME_COPY]);

    harness.setPose(MOVED);
    harness.changed.raise();
    syncCameraCoords();
    const movedText = formatLatLon(MOVED.lat, MOVED.lon);
    const movedMgrs = expectedMgrs(MOVED.lat, MOVED.lon);
    assert.equal(harness.valueButton.textContent, movedText);
    assert.equal(harness.mgrsEl.textContent, movedMgrs);
    assert.notEqual(movedText, HOME_LAT_LON);
    assert.notEqual(movedMgrs, HOME_MGRS);

    clipboardWrites.length = 0;
    await harness.copyButton.click();
    assert.deepEqual(clipboardWrites, [MOVED_COPY]);
  } finally {
    harness.cleanup();
  }
});

test('Home pose then copy is the default first-load coords plus MGRS', async () => {
  const clipboardWrites = [];
  const harness = installHarness({
    pose: { lat: 41.9, lon: 12.5, alt: 1500 },
    clipboardWrites,
  });
  try {
    assert.equal(harness.valueButton.textContent, formatLatLon(41.9, 12.5));
    assert.equal(harness.mgrsEl.textContent, expectedMgrs(41.9, 12.5));
    harness.setPose(HOME_VIEW);
    harness.moveEnd.raise();
    syncCameraCoords();
    assert.equal(harness.valueButton.textContent, HOME_LAT_LON);
    assert.equal(harness.mgrsEl.textContent, HOME_MGRS);
    await harness.copyButton.click();
    assert.deepEqual(clipboardWrites, [HOME_COPY]);
    assert.equal(clipboardWrites[0], formatCopiedCoords(HOME_VIEW.lat, HOME_VIEW.lon));
  } finally {
    harness.cleanup();
  }
});

test('high latitude with no grid stays blank — no fake MGRS', async () => {
  const clipboardWrites = [];
  const harness = installHarness({ pose: POLAR, clipboardWrites });
  try {
    assert.equal(harness.valueButton.textContent, formatLatLon(POLAR.lat, POLAR.lon));
    assert.equal(formatMgrs(POLAR.lat, POLAR.lon), '');
    assert.equal(harness.mgrsEl.textContent, '');
    assert.equal(harness.mgrsEl.hidden, true);
    assert.equal(getCameraCoordsForTest()?.mgrs, '');
    await harness.copyButton.click();
    assert.deepEqual(clipboardWrites, [formatLatLon(POLAR.lat, POLAR.lon)]);
    assert.doesNotMatch(clipboardWrites[0], /MGRS/i);
    assert.equal(formatCopiedCoords(POLAR.lat, POLAR.lon), formatLatLon(POLAR.lat, POLAR.lon));
  } finally {
    harness.cleanup();
  }
});

test('lon,lat is available as the secondary GIS order, but copy prefers share-link lat,lon plus MGRS', async () => {
  const writes = [];
  const ok = await copyCameraCenterCoords(HOME_VIEW, {
    clipboard: { writeText: async (text) => { writes.push(text); } },
  });
  assert.equal(ok, true);
  assert.deepEqual(writes, [HOME_COPY]);
  assert.equal(formatLonLat(HOME_VIEW.lat, HOME_VIEW.lon), HOME_LON_LAT);
});

test('the chrome shows camera-center coords, MGRS, and one copy control; no height, no units, no /api', async () => {
  const markup = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('./copyCameraCoords.js', import.meta.url), 'utf8');
  const ui = await readFile(new URL('./ui.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(markup, new RegExp(`id="${CAMERA_COORDS_ROOT_ID}"`));
  assert.match(markup, new RegExp(`id="${CAMERA_COORDS_VALUE_ID}"`));
  assert.match(markup, new RegExp(`id="${CAMERA_COORDS_MGRS_ID}"`));
  assert.match(markup, new RegExp(`id="${CAMERA_COORDS_COPY_ID}"`));
  assert.match(markup, /id="top-center-actions"[\s\S]*id="copy-view-link"[\s\S]*id="camera-coords"/);
  const coordsBlock = markup.match(/id="camera-coords"[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(coordsBlock, /camera-coords-copy/);
  assert.match(coordsBlock, /camera-coords-mgrs/);
  assert.equal((coordsBlock.match(/id="camera-coords-copy"/g) || []).length, 1);
  assert.doesNotMatch(coordsBlock, /units-/);
  assert.doesNotMatch(coordsBlock, /altitude/i);
  assert.doesNotMatch(coordsBlock, /id="camera-coords-mgrs-copy"/);

  assert.match(ui, /initCameraCoords/);
  assert.match(ui, /destroyCameraCoords/);
  assert.match(source, /positionCartographic/);
  assert.match(source, /from 'mgrs'|from "mgrs"/);
  assert.doesNotMatch(source, /\/api\//);
  assert.doesNotMatch(source, /geocode|places|person-search|OpenSky|Google News|TeleGeography|quantum-earth/i);
  assert.doesNotMatch(source, /Austin|Tokyo|London/i);
  assert.doesNotMatch(source, /formatHudAltitude|getDistanceUnit|meridian\.units/);

  const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);

  const apiDir = join(dirname(fileURLToPath(new URL('../package.json', import.meta.url))), 'api');
  const apiFiles = readdirSync(apiDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  assert.equal(apiFiles.includes('mgrs.js'), false);
  assert.equal(apiFiles.includes('coords.js'), false);

  const camera = await readFile(new URL('./camera.js', import.meta.url), 'utf8');
  assert.match(camera, /lat:\s*30\.2672/);
  assert.match(camera, /lon:\s*-97\.7431/);
});
