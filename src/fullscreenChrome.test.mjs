import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  enterFullscreen,
  exitFullscreen,
  fullscreenRoot,
  handleFullscreenEscape,
  hideFullscreenButtonIfUnsupported,
  isDocumentFullscreen,
  isFullscreenApiAvailable,
  syncFullscreenButton,
  toggleFullscreen,
} from './fullscreenChrome.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const src = (name) => readFileSync(join(__dirname, name), 'utf8');
const root = (name) => readFileSync(join(repoRoot, name), 'utf8');

function mockDoc({ api = true } = {}) {
  let fsEl = null;
  const listeners = new Map();
  const emit = (type) => {
    for (const fn of listeners.get(type) || []) fn();
  };
  const documentElement = {};
  if (api) {
    documentElement.requestFullscreen = async () => {
      fsEl = documentElement;
      emit('fullscreenchange');
    };
  }
  const credits = {
    id: 'cesium-credits',
    style: {
      opacity: '1',
      visibility: 'visible',
      display: '',
      setProperty(name, value) { this[name] = value; },
      removeProperty(name) { this[name] = ''; },
    },
    getBoundingClientRect: () => ({ width: 180, height: 16, top: 700, left: 36 }),
  };
  const doc = {
    documentElement,
    body: { contains: (node) => node === credits || node === documentElement },
    get fullscreenElement() { return fsEl; },
    getElementById(id) { return id === 'cesium-credits' ? credits : null; },
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = (listeners.get(type) || []).filter((item) => item !== fn);
      listeners.set(type, list);
    },
  };
  if (api) {
    doc.exitFullscreen = async () => {
      fsEl = null;
      emit('fullscreenchange');
    };
  }
  return { doc, documentElement, credits, emit };
}

function makeButton() {
  const icon = { textContent: 'fullscreen' };
  return {
    hidden: false,
    attrs: {},
    querySelector(sel) { return sel === '.material-symbols-outlined' ? icon : null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] ?? null; },
    icon,
  };
}

describe('Fullscreen chrome next to Home/Copy', () => {
  it('sits immediately after #copy-view-link in the top-center camera chrome', () => {
    const html = root('index.html');
    const block = html.match(/id="top-center-actions"[\s\S]*?<\/nav>/)[0];
    assert.match(block, /id="fullscreen-view"/);
    assert.match(block, /copy-view-link[\s\S]*fullscreen-view/);
    assert.match(block, /aria-label="Enter fullscreen"/);
    assert.match(block, /title="Enter fullscreen"/);
    assert.equal((html.match(/id="fullscreen-view"/g) || []).length, 1);
  });

  it('StyleManager wires the button, Escape exit, and fullscreenchange icon', () => {
    const ui = src('ui.js');
    assert.match(ui, /getElementById\('fullscreen-view'\)/);
    assert.match(ui, /toggleGlobeFullscreen\(/);
    assert.match(ui, /handleFullscreenEscape\(/);
    assert.match(ui, /fullscreenchange/);
    assert.match(ui, /syncFullscreenButton\(/);
    assert.match(ui, /pinRequiredCredits\(\)/);
    assert.match(ui, /\/\/ f = data-panel — fullscreen uses the button; Escape exits/);
  });

  it('hides with the other camera chrome in cockpit; recording hides the group', () => {
    const css = root('style.css');
    assert.match(css, /body\.cockpit-mode :is\([^)]*#fullscreen-view/);
    assert.match(css, /body\.recording-mode #top-center-actions/);
  });

  it('does not invent /api or billing hooks', () => {
    const chrome = src('fullscreenChrome.js');
    assert.doesNotMatch(chrome, /\/api\//);
    assert.doesNotMatch(chrome, /clerk/i);
    assert.doesNotMatch(chrome, /entitlement/i);
    assert.doesNotMatch(chrome, /isPro/);
  });
});

describe('enter/exit via button and Escape', () => {
  it('enters and exits on the documentElement (not #cesiumContainer alone)', async () => {
    const { doc, documentElement } = mockDoc();
    assert.equal(fullscreenRoot(doc), documentElement);
    assert.equal(isFullscreenApiAvailable(doc), true);
    assert.equal(isDocumentFullscreen(doc), false);

    assert.equal(await enterFullscreen(doc), true);
    assert.equal(isDocumentFullscreen(doc), true);
    assert.equal(doc.fullscreenElement, documentElement);

    assert.equal(await toggleFullscreen(doc), true);
    assert.equal(isDocumentFullscreen(doc), false);
  });

  it('Escape exits fullscreen without throwing', async () => {
    const { doc } = mockDoc();
    await enterFullscreen(doc);
    assert.equal(isDocumentFullscreen(doc), true);
    const event = { key: 'Escape', preventDefault() { this.prevented = true; } };
    assert.equal(handleFullscreenEscape(event, doc), true);
    await Promise.resolve();
    assert.equal(isDocumentFullscreen(doc), false);
    assert.equal(event.prevented, true);
  });

  it('Escape is a no-op when not fullscreen', () => {
    const { doc } = mockDoc();
    const event = { key: 'Escape', preventDefault() { this.prevented = true; } };
    assert.equal(handleFullscreenEscape(event, doc), false);
    assert.equal(event.prevented, undefined);
    assert.equal(isDocumentFullscreen(doc), false);
  });

  it('icon tracks fullscreenchange', async () => {
    const { doc } = mockDoc();
    const button = makeButton();
    syncFullscreenButton(button, isDocumentFullscreen(doc));
    assert.equal(button.icon.textContent, 'fullscreen');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(button.getAttribute('aria-label'), 'Enter fullscreen');

    await enterFullscreen(doc);
    syncFullscreenButton(button, isDocumentFullscreen(doc));
    assert.equal(button.icon.textContent, 'fullscreen_exit');
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(button.getAttribute('aria-label'), 'Exit fullscreen');

    await exitFullscreen(doc);
    syncFullscreenButton(button, isDocumentFullscreen(doc));
    assert.equal(button.icon.textContent, 'fullscreen');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
  });
});

describe('credits stay on screen', () => {
  it('fullscreen target is the document root so #cesium-credits stays in the tree', () => {
    const chrome = src('fullscreenChrome.js');
    assert.match(chrome, /documentElement/);
    assert.doesNotMatch(chrome, /cesiumContainer/);
    assert.match(chrome, /#cesium-credits/);
  });

  it('CSS keeps #cesium-credits painted in fullscreen', () => {
    const css = root('style.css');
    assert.match(css, /:fullscreen #cesium-credits/);
    const block = css.match(/:fullscreen #cesium-credits[\s\S]*?\{([^}]*)\}/)[1];
    assert.match(block, /opacity:\s*1/);
    assert.match(block, /visibility:\s*visible/);
    assert.doesNotMatch(block, /display\s*:\s*none/);
  });
});

describe('missing Fullscreen API', () => {
  it('does not throw; toggle no-ops; button hides', async () => {
    const { doc } = mockDoc({ api: false });
    const button = makeButton();
    assert.equal(isFullscreenApiAvailable(doc), false);
    assert.equal(hideFullscreenButtonIfUnsupported(button, doc), false);
    assert.equal(button.hidden, true);
    assert.equal(await toggleFullscreen(doc), false);
    assert.equal(await enterFullscreen(doc), false);
    assert.equal(await exitFullscreen(doc), true);
    assert.equal(handleFullscreenEscape({ key: 'Escape', preventDefault() {} }, doc), false);
  });
});
