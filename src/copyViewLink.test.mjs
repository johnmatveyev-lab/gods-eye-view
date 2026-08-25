import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HOME_VIEW } from './camera.js';
import { createDefaultLayerState } from './data/layerState.js';
import { decodeShareViewUrl, encodeShareViewUrl, ShareLinkManager } from './sharelink.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const src = (name) => readFileSync(join(__dirname, name), 'utf8');
const root = (name) => readFileSync(join(repoRoot, name), 'utf8');

const HREF = 'https://meridian.example/?ref=hud';

function memoryStorage() {
  const map = new Map();
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
  };
}

function makeManager({
  hash = '',
  href = `${HREF}${hash}`,
  search = '?ref=hud',
  camera,
  storage,
} = {}) {
  const location = {
    hash,
    search,
    href,
  };
  globalThis.window = {
    location,
    localStorage: storage || memoryStorage(),
  };
  globalThis.history = {
    replaceState(_state, _title, next) {
      if (String(next).startsWith('#')) {
        location.hash = next;
        const url = new URL(location.href);
        url.hash = String(next).replace(/^#/, '');
        location.href = url.href;
        return;
      }
      location.hash = new URL(next, location.href).hash;
    },
  };
  const viewer = {
    camera: camera || cameraAt({ lat: 40.7484, lon: -73.9857, alt: 1200, heading: 20, pitch: -35 }),
  };
  return new ShareLinkManager(viewer, { storage: storage || memoryStorage(), lastViewThrottleMs: 0 });
}

function installClipboard() {
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        async writeText(url) {
          copied.push(url);
        },
      },
    },
  });
  return copied;
}

function flightsWithTarget(trackingId = 'ae1fa4') {
  const layers = createDefaultLayerState();
  layers.enabledLayerIds = ['flights', 'cctv'];
  layers.options.flights = {
    ...layers.options.flights,
    selectedFlightsTrackingId: trackingId,
  };
  return layers;
}

describe('Copy view link chrome next to Home', () => {
  it('sits immediately after #home-view in the top-center camera chrome', () => {
    const html = root('index.html');
    const block = html.match(/id="top-center-actions"[\s\S]*?<\/nav>/)[0];
    assert.match(block, /id="copy-view-link"/);
    assert.match(block, /home-view[\s\S]*copy-view-link/);
    assert.match(block, /aria-label="Copy view link"/);
    assert.match(block, /title="Copy view link"/);
    assert.equal((html.match(/id="copy-view-link"/g) || []).length, 1);
  });

  it('StyleManager copies via copyViewLink and toasts Link copied', () => {
    const ui = src('ui.js');
    assert.match(ui, /getElementById\('copy-view-link'\)/);
    assert.match(ui, /copyViewLink\(/);
    assert.match(ui, /_showToast\(success \? 'Link copied' : 'Copy failed'\)/);
    assert.doesNotMatch(ui, /copyViewLink[\s\S]{0,200}Link copied!/);
  });

  it('uses the same encodeShareViewUrl helper as lastView and saved views', () => {
    const share = src('sharelink.js');
    assert.match(share, /async copyViewLink\(/);
    const fn = share.match(/async copyViewLink\([^)]*\)\s*\{[\s\S]*?\n  \}/)[0];
    assert.match(fn, /currentShareUrl\(/);
    assert.doesNotMatch(fn, /includeCreatedAt:\s*true/);
    assert.match(share, /encodeShareViewUrl\(window\.location\.href/);
  });

  it('hides with the other camera chrome in cockpit; recording hides the group', () => {
    const css = root('style.css');
    assert.match(css, /body\.cockpit-mode :is\([^)]*#copy-view-link/);
    assert.match(css, /body\.recording-mode #top-center-actions/);
  });

  it('does not invent /api, Clerk, or billing gates', () => {
    const share = src('sharelink.js');
    const fn = share.match(/async copyViewLink\([^)]*\)\s*\{[\s\S]*?\n  \}/)[0];
    assert.doesNotMatch(fn, /\/api\//);
    assert.doesNotMatch(fn, /clerk/i);
    assert.doesNotMatch(fn, /entitlement/i);
    assert.doesNotMatch(fn, /isPro/);
    const ui = src('ui.js');
    const wire = ui.match(/_initCopyViewLinkButton\(\)\s*\{[\s\S]*?\n  \}/)[0];
    assert.doesNotMatch(wire, /\/api\//);
    assert.doesNotMatch(wire, /clerk/i);
    assert.doesNotMatch(wire, /isPro/);
  });
});

describe('clipboard matches current search/hash', () => {
  it('copied URL keeps the live search string and hash from encodeShareViewUrl', async () => {
    const copied = installClipboard();
    const manager = makeManager({
      hash: '',
      href: `${HREF}`,
      search: '?ref=hud',
    });
    manager.onStyleChange('noir');
    manager._updateHash();
    const liveHash = window.location.hash.slice(1);
    assert.ok(liveHash.includes('lat='));

    const ok = await manager.copyViewLink();
    assert.equal(ok, true);
    assert.equal(copied.length, 1);

    const url = copied[0];
    assert.equal(url, encodeShareViewUrl(window.location.href, liveHash));
    assert.equal(decodeShareViewUrl(url), liveHash);
    assert.equal(new URL(url).search, '?ref=hud');
    assert.equal(new URLSearchParams(decodeShareViewUrl(url)).get('style'), 'noir');
    assert.equal(new URLSearchParams(decodeShareViewUrl(url)).has('at'), false);
  });
});

describe('new tab restores the same camera, layers, and target', () => {
  it('parseInitialHash of the copied URL returns camera, layers, and tracking target', async () => {
    const copied = installClipboard();
    const pose = { lat: 37.8199, lon: -122.4783, alt: 1400, heading: 45, pitch: -20 };
    const layers = flightsWithTarget('ae1fa4');
    const manager = makeManager({ camera: cameraAt(pose), href: HREF, search: '?ref=hud' });
    manager.setLayerStateProvider(() => layers);
    manager._updateHash();

    assert.equal(await manager.copyViewLink(), true);
    const hash = decodeShareViewUrl(copied[0]);

    const other = makeManager({
      hash: `#${hash}`,
      href: `https://meridian.example/${`#${hash}`}`,
      camera: cameraAt({ lat: 1, lon: 2, alt: 100, heading: 0, pitch: -90 }),
    });
    const restored = other.parseInitialHash();
    assert.ok(restored);
    assert.ok(Math.abs(restored.lat - pose.lat) < 0.0001);
    assert.ok(Math.abs(restored.lon - pose.lon) < 0.0001);
    assert.equal(restored.alt, pose.alt);
    assert.equal(restored.heading, pose.heading);
    assert.equal(restored.pitch, pose.pitch);
    assert.ok(restored.layerState);
    assert.ok(restored.layerState.enabledLayerIds.includes('flights'));
    assert.ok(restored.layerState.enabledLayerIds.includes('cctv'));
    assert.equal(restored.layerState.options.flights.selectedFlightsTrackingId, 'ae1fa4');
  });
});

describe('after Home, copy is the default pose URL', () => {
  it('copyViewLink encodes HOME_VIEW when the camera is there', async () => {
    const copied = installClipboard();
    const manager = makeManager({
      camera: cameraAt(HOME_VIEW),
      href: HREF,
      search: '?ref=hud',
    });
    manager._updateHash();
    assert.equal(await manager.copyViewLink(), true);
    const params = new URLSearchParams(decodeShareViewUrl(copied[0]));
    assert.equal(params.get('lat'), HOME_VIEW.lat.toFixed(4));
    assert.equal(params.get('lon'), HOME_VIEW.lon.toFixed(4));
    assert.equal(params.get('alt'), String(HOME_VIEW.alt));
    assert.equal(params.get('heading'), String(HOME_VIEW.heading));
    assert.equal(params.get('pitch'), String(HOME_VIEW.pitch));
  });
});
