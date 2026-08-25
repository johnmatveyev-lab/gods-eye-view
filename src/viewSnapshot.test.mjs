import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CESIUM_CREDITS_ID,
  VIEW_SNAPSHOT_BUTTON_ID,
  VIEW_SNAPSHOT_FILENAME,
  VIEW_SNAPSHOT_MIME,
  canvasToPngBlob,
  compositeViewSnapshot,
  copyViewSnapshot,
  creditStripText,
  downloadPngBlob,
  snapshotToast,
} from './viewSnapshot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const src = (name) => readFileSync(join(__dirname, name), 'utf8');
const root = (name) => readFileSync(join(repoRoot, name), 'utf8');

const CREDIT_COPY = 'Google Maps · Cesium ion · Data attribution';

class FakeClipboardItem {
  constructor(items) {
    this.items = items;
    this.types = Object.keys(items);
  }
}

function makeRecordingCanvas(width, height) {
  const ops = [];
  const ctx = {
    fillStyle: '#000',
    font: '',
    textBaseline: 'top',
    textAlign: 'left',
    globalAlpha: 1,
    drawImage(...args) { ops.push({ op: 'drawImage', args }); },
    fillRect(...args) { ops.push({ op: 'fillRect', args }); },
    fillText(text, x, y) { ops.push({ op: 'fillText', text, x, y }); },
    measureText(text) { return { width: String(text).length * 6 }; },
  };
  return {
    width,
    height,
    getContext(type) { return type === '2d' ? ctx : null; },
    toBlob(cb, type = VIEW_SNAPSHOT_MIME) {
      cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type }));
    },
    toDataURL(type = VIEW_SNAPSHOT_MIME) {
      return `data:${type};base64,iVBORw0KGgo=`;
    },
    ops,
    ctx,
    getBoundingClientRect() {
      return { left: 0, top: 0, width, height, right: width, bottom: height };
    },
  };
}

function makeGlobeCanvas() {
  return makeRecordingCanvas(800, 600);
}

function makeCreditsEl(text = CREDIT_COPY, { cleanView = false } = {}) {
  return {
    id: CESIUM_CREDITS_ID,
    innerText: text,
    textContent: text,
    querySelectorAll() { return []; },
    getBoundingClientRect() {
      return { left: 36, top: 560, width: 280, height: 28, right: 316, bottom: 588 };
    },
    offsetWidth: 280,
    offsetHeight: 28,
    ownerDocument: {
      body: {
        classList: {
          contains: (name) => cleanView && name === 'ui-clean-view',
        },
      },
    },
  };
}

function captureEnv(overrides = {}) {
  const written = [];
  const downloads = [];
  const canvases = [];
  return {
    written,
    downloads,
    canvases,
    clipboard: {
      async write(items) { written.push(...items); },
      async writeText() { throw new Error('copyViewSnapshot must not write text'); },
    },
    ClipboardItem: FakeClipboardItem,
    createCanvas(width, height) {
      const canvas = makeRecordingCanvas(width, height);
      canvases.push(canvas);
      return canvas;
    },
    download(blob, filename) { downloads.push({ blob, filename }); },
    ...overrides,
  };
}

describe('Copy snapshot chrome next to Copy view link', () => {
  it('sits immediately after #copy-view-link in the top-center camera chrome', () => {
    const html = root('index.html');
    const block = html.match(/id="top-center-actions"[\s\S]*?<\/nav>/)[0];
    assert.match(block, new RegExp(`id="${VIEW_SNAPSHOT_BUTTON_ID}"`));
    assert.match(block, /copy-view-link[\s\S]*copy-view-snapshot/);
    assert.match(block, /copy-view-snapshot[\s\S]*camera-coords/);
    assert.match(block, /aria-label="Copy snapshot"/);
    assert.match(block, /title="Copy snapshot"/);
    assert.equal((html.match(/id="copy-view-snapshot"/g) || []).length, 1);
  });

  it('StyleManager copies via copyViewSnapshot and toasts Snapshot copied', () => {
    const ui = src('ui.js');
    assert.match(ui, /from '\.\/viewSnapshot\.js'/);
    assert.match(ui, /getElementById\('copy-view-snapshot'\)/);
    assert.match(ui, /copyViewSnapshot\(/);
    assert.match(ui, /snapshotToast\(/);
    const wire = ui.match(/_initCopyViewSnapshotButton\(\)\s*\{[\s\S]*?\n  \}/)[0];
    assert.match(wire, /cesium-credits/);
    assert.match(wire, /scene\?\.canvas/);
    assert.doesNotMatch(wire, /copyViewLink/);
    assert.doesNotMatch(wire, /writeText/);
    assert.doesNotMatch(wire, /\/api\//);
  });

  it('hides with the other camera chrome in cockpit; recording hides the group', () => {
    const css = root('style.css');
    assert.match(css, /body\.cockpit-mode :is\([^)]*#copy-view-snapshot/);
    assert.match(css, /body\.recording-mode #top-center-actions/);
  });

  it('does not invent /api, Clerk, or billing gates', () => {
    const module = src('viewSnapshot.js');
    assert.doesNotMatch(module, /\/api\//);
    assert.doesNotMatch(module, /fetch\(/);
    assert.doesNotMatch(module, /clerk/i);
    assert.doesNotMatch(module, /entitlement/i);
    assert.doesNotMatch(module, /isPro/);
    assert.doesNotMatch(module, /OpenSky/);
    assert.doesNotMatch(module, /Google News/);
    assert.doesNotMatch(module, /TeleGeography/);
  });
});

describe('click copies a PNG of the current view', () => {
  it('writes a PNG ClipboardItem, not a URL', async () => {
    const env = captureEnv();
    const globe = makeGlobeCanvas();
    const result = await copyViewSnapshot({
      globeCanvas: globe,
      creditsEl: makeCreditsEl(),
      ...env,
    });
    assert.equal(result.ok, true);
    assert.equal(result.method, 'clipboard');
    assert.equal(result.blob.type, VIEW_SNAPSHOT_MIME);
    assert.equal(env.written.length, 1);
    assert.deepEqual(env.written[0].types, [VIEW_SNAPSHOT_MIME]);
    assert.equal(env.written[0].items[VIEW_SNAPSHOT_MIME].type, VIEW_SNAPSHOT_MIME);
    assert.equal(env.downloads.length, 0);
  });

  it('composites the Cesium canvas into the PNG', async () => {
    const globe = makeGlobeCanvas();
    const { canvas } = compositeViewSnapshot({
      globeCanvas: globe,
      creditsEl: makeCreditsEl(),
      createCanvas: (width, height) => makeRecordingCanvas(width, height),
    });
    assert.equal(canvas.width, 800);
    assert.equal(canvas.height, 600);
    assert.ok(canvas.ops.some((op) => op.op === 'drawImage' && op.args[0] === globe));
  });
});

describe('credits stay readable in the PNG', () => {
  it('paints the on-screen #cesium-credits text into the composite', () => {
    assert.equal(creditStripText(makeCreditsEl()), CREDIT_COPY);
    const { canvas, creditText } = compositeViewSnapshot({
      globeCanvas: makeGlobeCanvas(),
      creditsEl: makeCreditsEl(),
      createCanvas: (width, height) => makeRecordingCanvas(width, height),
    });
    assert.equal(creditText, CREDIT_COPY);
    const painted = canvas.ops.filter((op) => op.op === 'fillText').map((op) => op.text).join(' ');
    assert.match(painted, /Google Maps/);
    assert.match(painted, /Cesium/);
    assert.match(painted, /Data attribution/);
  });

  it('keeps credits in a clean-view snapshot', async () => {
    const env = captureEnv();
    const result = await copyViewSnapshot({
      globeCanvas: makeGlobeCanvas(),
      creditsEl: makeCreditsEl(CREDIT_COPY, { cleanView: true }),
      ...env,
    });
    assert.equal(result.ok, true);
    assert.match(result.creditText, /Google Maps/);
    assert.match(result.creditText, /Data attribution/);
    const painted = env.canvases[0].ops
      .filter((op) => op.op === 'fillText')
      .map((op) => op.text)
      .join(' ');
    assert.match(painted, /Google Maps/);
  });
});

describe('Copy view link still copies the URL only', () => {
  it('snapshot write never uses writeText or copyViewLink', async () => {
    const module = src('viewSnapshot.js');
    assert.doesNotMatch(module, /writeText/);
    assert.doesNotMatch(module, /copyViewLink/);
    assert.doesNotMatch(module, /copyLink\(/);

    const share = src('sharelink.js');
    const fn = share.match(/async copyViewLink\([^)]*\)\s*\{[\s\S]*?\n  \}/)[0];
    assert.match(fn, /clipboard\.writeText/);
    assert.doesNotMatch(fn, /ClipboardItem/);
    assert.doesNotMatch(fn, /image\/png/);

    const env = captureEnv();
    await copyViewSnapshot({
      globeCanvas: makeGlobeCanvas(),
      creditsEl: makeCreditsEl(),
      ...env,
    });
    assert.equal(env.written.length, 1);
    assert.ok(!env.written[0].types.includes('text/plain'));
  });
});

describe('clipboard-denied browsers get a local download', () => {
  it('falls back to a same-tab PNG download when clipboard image write fails', async () => {
    const env = captureEnv({
      clipboard: {
        async write() { throw new Error('NotAllowedError'); },
        async writeText() { throw new Error('copyViewSnapshot must not write text'); },
      },
    });
    const result = await copyViewSnapshot({
      globeCanvas: makeGlobeCanvas(),
      creditsEl: makeCreditsEl(),
      ...env,
    });
    assert.equal(result.ok, true);
    assert.equal(result.method, 'download');
    assert.equal(env.downloads.length, 1);
    assert.equal(env.downloads[0].filename, VIEW_SNAPSHOT_FILENAME);
    assert.equal(env.downloads[0].blob.type, VIEW_SNAPSHOT_MIME);
  });

  it('downloadPngBlob uses a same-tab anchor, not navigation or upload', () => {
    const clicks = [];
    const created = [];
    const documentRef = {
      createElement(tag) {
        const el = {
          tagName: tag,
          rel: '',
          href: '',
          download: '',
          click() { clicks.push({ href: this.href, download: this.download }); },
          remove() { this.removed = true; },
        };
        created.push(el);
        return el;
      },
      body: {
        appendChild(node) { this.child = node; return node; },
      },
    };
    const blob = new Blob(['png'], { type: VIEW_SNAPSHOT_MIME });
    downloadPngBlob(blob, VIEW_SNAPSHOT_FILENAME, {
      documentRef,
      createObjectURL: () => 'blob:meridian-view',
      revokeObjectURL() {},
    });
    assert.equal(created[0].download, VIEW_SNAPSHOT_FILENAME);
    assert.equal(clicks[0].download, VIEW_SNAPSHOT_FILENAME);
    assert.equal(clicks[0].href, 'blob:meridian-view');
  });
});

describe('snapshot helpers', () => {
  it('toasts distinguish clipboard, download, and failure', () => {
    assert.equal(snapshotToast({ method: 'clipboard' }), 'Snapshot copied');
    assert.equal(snapshotToast({ method: 'download' }), 'Snapshot downloaded');
    assert.equal(snapshotToast({ method: 'failed' }), 'Snapshot failed');
    assert.equal(snapshotToast(null), 'Snapshot failed');
  });

  it('canvasToPngBlob prefers toBlob then toDataURL', async () => {
    const blob = await canvasToPngBlob(makeRecordingCanvas(4, 4));
    assert.equal(blob.type, VIEW_SNAPSHOT_MIME);
  });

  it('fails closed when the globe canvas is missing', async () => {
    const result = await copyViewSnapshot({
      globeCanvas: null,
      creditsEl: makeCreditsEl(),
      ...captureEnv(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.method, 'failed');
  });
});
