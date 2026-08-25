import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDefaultLayerState } from './data/layerState.js';
import { decodeShareViewUrl, encodeShareViewUrl, ShareLinkManager } from './sharelink.js';
import {
  SHARE_VIEW_QR_BUTTON_ID,
  SHARE_VIEW_QR_POPOVER_ID,
  SHARE_VIEW_QR_SVG_ID,
  SHARE_VIEW_QR_WRAP_ID,
  closeShareViewQr,
  currentShareViewQrFingerprint,
  currentShareViewQrUrl,
  destroyShareViewQr,
  encodeShareViewQr,
  handleShareViewQrEscape,
  initShareViewQr,
  isShareViewQrOpen,
  openShareViewQr,
  qrModuleFingerprint,
  toggleShareViewQr,
} from './shareViewQr.js';

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

function makeDom() {
  const button = {
    attrs: { 'aria-expanded': 'false' },
    listeners: {},
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    getAttribute(name) {
      return this.attrs[name];
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    removeEventListener(type, fn) {
      if (this.listeners[type] === fn) delete this.listeners[type];
    },
    click() {
      this.listeners.click?.({ preventDefault() {} });
    },
  };
  const svg = {
    dataset: {},
    attrs: {},
    innerHTML: '',
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
  };
  const popover = { hidden: true };
  return { button, popover, svg };
}

function flightsLayers(extraIds = []) {
  const layers = createDefaultLayerState();
  layers.enabledLayerIds = ['flights', ...extraIds];
  return layers;
}

describe('Share view QR chrome next to Copy view link', () => {
  it('sits immediately after #copy-view-link in the top-center camera chrome', () => {
    const html = root('index.html');
    const block = html.match(/id="top-center-actions"[\s\S]*?<\/nav>/)[0];
    assert.match(html, /<title>Meridian<\/title>/);
    assert.match(block, new RegExp(`id="${SHARE_VIEW_QR_WRAP_ID}"`));
    assert.match(block, new RegExp(`id="${SHARE_VIEW_QR_BUTTON_ID}"`));
    assert.match(block, new RegExp(`id="${SHARE_VIEW_QR_POPOVER_ID}"`));
    assert.match(block, new RegExp(`id="${SHARE_VIEW_QR_SVG_ID}"`));
    assert.match(block, /copy-view-link[\s\S]*share-view-qr[\s\S]*copy-view-snapshot/);
    assert.match(block, /aria-label="Share view QR"/);
    assert.match(block, /title="Share view QR"/);
    assert.match(block, /aria-controls="share-view-qr-popover"/);
    assert.equal((html.match(/id="share-view-qr"/g) || []).length, 1);
    assert.equal((html.match(/id="share-view-qr-popover"/g) || []).length, 1);
  });

  it('StyleManager wires the popover through initShareViewQr and Escape', () => {
    const ui = src('ui.js');
    assert.match(ui, /from '\.\/shareViewQr\.js'/);
    assert.match(ui, /initShareViewQr\(/);
    assert.match(ui, /destroyShareViewQr\(/);
    assert.match(ui, /handleShareViewQrEscape\(/);
    assert.match(ui, /currentShareUrl/);
    const wire = ui.match(/_initShareViewQrButton\(\)\s*\{[\s\S]*?\n  \}/)[0];
    assert.match(wire, /share-view-qr/);
    assert.match(wire, /currentShareUrl/);
    assert.doesNotMatch(wire, /writeText/);
    assert.doesNotMatch(wire, /copyViewLink/);
    assert.doesNotMatch(wire, /\/api\//);
  });

  it('hides with the other camera chrome in cockpit; recording hides the group', () => {
    const css = root('style.css');
    assert.match(css, /body\.cockpit-mode :is\([^)]*#share-view-qr/);
    assert.match(css, /#share-view-qr-popover/);
    assert.match(css, /body\.recording-mode #top-center-actions/);
  });
});

describe('Open QR encodes the same camera+layers URL Copy view link copies', () => {
  it('popover payload matches currentShareUrl and the clipboard write', async () => {
    const copied = installClipboard();
    const layers = flightsLayers(['cctv']);
    layers.options.flights = {
      ...layers.options.flights,
      selectedFlightsTrackingId: 'ae1fa4',
    };
    const manager = makeManager({ href: HREF, search: '?ref=hud' });
    manager.setLayerStateProvider(() => layers);
    manager.onStyleChange('noir');
    manager._updateHash();

    const shareUrl = manager.currentShareUrl();
    assert.ok(shareUrl);
    assert.equal(await manager.copyViewLink(), true);
    assert.equal(copied.length, 1);
    assert.equal(copied[0], shareUrl);
    assert.equal(copied[0], encodeShareViewUrl(window.location.href, window.location.hash.slice(1)));
    assert.ok(decodeShareViewUrl(shareUrl).includes('lat='));

    const dom = makeDom();
    initShareViewQr({
      ...dom,
      getShareUrl: () => manager.currentShareUrl(),
    });
    assert.equal(openShareViewQr(), true);
    assert.equal(isShareViewQrOpen(), true);
    assert.equal(dom.popover.hidden, false);
    assert.equal(currentShareViewQrUrl(), shareUrl);
    assert.equal(dom.svg.dataset.shareUrl, shareUrl);
    assert.equal(dom.svg.dataset.qrFingerprint, encodeShareViewQr(shareUrl).fingerprint);
    assert.equal(currentShareViewQrFingerprint(), qrModuleFingerprint(encodeShareViewQr(shareUrl).modules));
    const restored = decodeShareViewUrl(currentShareViewQrUrl());
    const params = new URLSearchParams(restored);
    assert.equal(params.get('style'), 'noir');
    assert.ok(restored.includes('l='));
    destroyShareViewQr();
  });
});

describe('Toggle a layer and reopen QR updates the payload', () => {
  it('re-encodes the live share URL after a layer change', () => {
    const live = { layers: flightsLayers() };
    const manager = makeManager({ href: HREF, search: '?ref=hud' });
    manager.setLayerStateProvider(() => live.layers);
    manager._updateHash();

    const dom = makeDom();
    initShareViewQr({
      ...dom,
      getShareUrl: () => manager.currentShareUrl(),
    });
    assert.equal(openShareViewQr(), true);
    const first = currentShareViewQrUrl();
    closeShareViewQr();

    live.layers = flightsLayers(['cctv']);
    manager._updateHash();
    assert.equal(openShareViewQr(), true);
    const second = currentShareViewQrUrl();
    assert.notEqual(second, first);
    assert.equal(second, manager.currentShareUrl());
    assert.ok(decodeShareViewUrl(second).includes('c') || decodeShareViewUrl(second).includes('l='));
    const firstLayers = new URLSearchParams(decodeShareViewUrl(first)).get('l');
    const secondLayers = new URLSearchParams(decodeShareViewUrl(second)).get('l');
    assert.notEqual(secondLayers, firstLayers);
    destroyShareViewQr();
  });
});

describe('Popover closes on second click or Escape', () => {
  it('second click hides the popover without copying', () => {
    const copied = installClipboard();
    const manager = makeManager({ href: HREF, search: '?ref=hud' });
    manager._updateHash();
    const dom = makeDom();
    initShareViewQr({
      ...dom,
      getShareUrl: () => manager.currentShareUrl(),
    });
    dom.button.click();
    assert.equal(isShareViewQrOpen(), true);
    dom.button.click();
    assert.equal(isShareViewQrOpen(), false);
    assert.equal(dom.popover.hidden, true);
    assert.equal(copied.length, 0);
    destroyShareViewQr();
  });

  it('Escape closes an open popover and is a no-op when closed', () => {
    const manager = makeManager({ href: HREF, search: '?ref=hud' });
    manager._updateHash();
    const dom = makeDom();
    initShareViewQr({
      ...dom,
      getShareUrl: () => manager.currentShareUrl(),
    });
    assert.equal(openShareViewQr(), true);
    const event = { key: 'Escape', preventDefault() { this.prevented = true; } };
    assert.equal(handleShareViewQrEscape(event), true);
    assert.equal(event.prevented, true);
    assert.equal(isShareViewQrOpen(), false);
    assert.equal(handleShareViewQrEscape({ key: 'Escape' }), false);
    assert.equal(handleShareViewQrEscape({ key: 'Enter' }), false);
    destroyShareViewQr();
  });

  it('toggleShareViewQr opens then closes', () => {
    const manager = makeManager({ href: HREF, search: '?ref=hud' });
    manager._updateHash();
    const dom = makeDom();
    initShareViewQr({
      ...dom,
      getShareUrl: () => manager.currentShareUrl(),
    });
    assert.equal(toggleShareViewQr(), true);
    assert.equal(toggleShareViewQr(), false);
    assert.equal(isShareViewQrOpen(), false);
    destroyShareViewQr();
  });
});

describe('Copy view link still copies text only; QR does not write the clipboard', () => {
  it('copyViewLink still writeText and QR never copies ident/coords/card/snapshot', async () => {
    const share = src('sharelink.js');
    const fn = share.match(/async copyViewLink\([^)]*\)\s*\{[\s\S]*?\n  \}/)[0];
    assert.match(fn, /clipboard\.writeText/);
    assert.doesNotMatch(fn, /ClipboardItem/);
    assert.doesNotMatch(fn, /image\/png/);
    assert.doesNotMatch(fn, /share-view-qr|encodeShareViewQr|qr_code/);

    const module = src('shareViewQr.js');
    assert.doesNotMatch(module, /writeText/);
    assert.doesNotMatch(module, /copyViewLink/);
    assert.doesNotMatch(module, /copyViewSnapshot/);
    assert.doesNotMatch(module, /copyCameraCenterCoords/);
    assert.doesNotMatch(module, /selected-contact-ident|Copy ident|Copy card/);

    const copied = installClipboard();
    const manager = makeManager({ href: HREF, search: '?ref=hud' });
    manager._updateHash();
    const dom = makeDom();
    initShareViewQr({
      ...dom,
      getShareUrl: () => manager.currentShareUrl(),
    });
    assert.equal(openShareViewQr(), true);
    assert.equal(copied.length, 0);
    assert.equal(await manager.copyViewLink(), true);
    assert.equal(copied.length, 1);
    assert.equal(copied[0], currentShareViewQrUrl());
    destroyShareViewQr();
  });
});

describe('No shortener, upload, new /api, or forbidden sources', () => {
  it('stays client-only and keeps credits on the globe', () => {
    const module = src('shareViewQr.js');
    const ui = src('ui.js');
    const html = root('index.html');
    const css = root('style.css');
    const license = root('LICENSE');

    assert.match(html, /<title>Meridian<\/title>/);
    assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
    assert.doesNotMatch(module, /\/api\//);
    assert.doesNotMatch(module, /fetch\(/);
    assert.doesNotMatch(module, /bit\.ly|tinyurl\.com|is\.gd|FormData|XMLHttpRequest|createObjectURL/);
    assert.doesNotMatch(module, /OpenSky|Google News|TeleGeography|quantum-earth/i);
    assert.doesNotMatch(module, /cesium-credits[\s\S]{0,80}(display|hidden|visibility)/);
    assert.doesNotMatch(css, /#share-view-qr[\s\S]{0,200}#cesium-credits/);
    assert.match(module, /Credits stay on the globe/);

    const apiFiles = readdirSync(join(repoRoot, 'api'), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    assert.equal(apiFiles.includes('share-view-qr.js'), false);
    assert.equal(apiFiles.includes('qr.js'), false);
    assert.equal(apiFiles.includes('shorten.js'), false);

    const wire = ui.match(/_initShareViewQrButton\(\)\s*\{[\s\S]*?\n  \}/)[0];
    assert.doesNotMatch(wire, /\/api\//);
    assert.doesNotMatch(wire, /clerk/i);
    assert.doesNotMatch(wire, /isPro/);
  });
});
