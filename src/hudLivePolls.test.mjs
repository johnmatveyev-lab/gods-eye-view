import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createLivePollScheduler } from './chrome/scheduler.js';

const MGRS_STUB_URL = 'gev-test-stub:mgrs';
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'mgrs') return { url: MGRS_STUB_URL, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === MGRS_STUB_URL) {
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export function forward() { return "10SEG55776339"; }\nexport default { forward };\n',
      };
    }
    return next(url, context);
  },
});

const { IntelHUD } = await import('./hud.js');
const hudSource = readFileSync(new URL('./hud.js', import.meta.url), 'utf8');
const voiceSource = readFileSync(new URL('./voice/gevRealtime.js', import.meta.url), 'utf8');
const aisSource = readFileSync(new URL('./data/aisLiveVessels.js', import.meta.url), 'utf8');

function makeChrome({ hidden = false, online = true } = {}) {
  const document = new EventTarget();
  const window = new EventTarget();
  document.visibilityState = hidden ? 'hidden' : 'visible';
  document.hidden = hidden;
  window.navigator = { onLine: online };
  return { document, window };
}

function installHudEnvironment() {
  const elements = new Map(
    ['hud-alt', 'hud-summary', 'hud-mgrs', 'hud-latlon', 'hud-bottom-line', 'hud-gsd', 'hud-coll', 'hud-ona', 'hud-mode']
      .map((id) => [id, { textContent: '' }]),
  );
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  globalThis.document = {
    getElementById: (id) => elements.get(id) ?? null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible',
    hidden: false,
  };
  globalThis.window = {
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    navigator: { onLine: true },
  };
  const fetches = [];
  globalThis.fetch = async (url) => {
    fetches.push(String(url));
    return { ok: true, json: async () => ({ summary: 'ok' }) };
  };
  const viewer = {
    camera: {
      pitch: -Math.PI / 2,
      positionCartographic: { latitude: 0, longitude: 0, height: 1000 },
      computeViewRectangle: () => undefined,
      moveEnd: { addEventListener() {}, removeEventListener() {} },
    },
  };
  return {
    elements,
    viewer,
    fetches,
    restore() {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
      if (previousFetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = previousFetch;
    },
  };
}

test('HUD summary fetch is gated before OpenAI or Places work', () => {
  assert.match(hudSource, /if \(this\._livePollsSuspended\) return;/);
  assert.match(hudSource, /attachLiveScheduler/);
  assert.equal(voiceSource.includes('chrome/scheduler'), false, 'voice is not paused by the scheduler');
  assert.equal(aisSource.includes('chrome/scheduler'), false, 'AIS is not wrapped');
});

test('hidden 30s issues no HUD summary fetch; show refreshes once', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const env = installHudEnvironment();
  const chrome = makeChrome();
  const scheduler = createLivePollScheduler(chrome);
  scheduler.attach();
  let hud;
  try {
    hud = new IntelHUD(env.viewer);
    hud._visible = true;
    hud._latestMetrics = { latDeg: 0, lonDeg: 0, altM: 1000, altMslM: 1000, sunEl: 10, ona: 0 };
    let summaryCalls = 0;
    hud._updateSummary = async () => { summaryCalls += 1; };
    hud.attachLiveScheduler(scheduler);
    assert.notEqual(hud._summaryInterval, null);

    chrome.document.visibilityState = 'hidden';
    chrome.document.hidden = true;
    chrome.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(hud._summaryInterval, null);
    t.mock.timers.tick(30_000);
    assert.equal(summaryCalls, 0, 'hide 30s issues no /api/openai/hud-summary');
    assert.equal(env.fetches.length, 0);

    chrome.document.visibilityState = 'visible';
    chrome.document.hidden = false;
    chrome.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(summaryCalls, 1, 'show issues one summary refresh');
    assert.notEqual(hud._summaryInterval, null);
    const armed = hud._summaryInterval;
    chrome.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(hud._summaryInterval, armed, 'no double timers');
    assert.equal(summaryCalls, 1);
  } finally {
    hud?.destroy();
    scheduler.detach();
    env.restore();
    t.mock.timers.reset();
  }
});

test('offline pauses the HUD summary; online refreshes once', async () => {
  const env = installHudEnvironment();
  const chrome = makeChrome();
  const scheduler = createLivePollScheduler(chrome);
  scheduler.attach();
  let hud;
  try {
    hud = new IntelHUD(env.viewer);
    hud._visible = true;
    hud.attachLiveScheduler(scheduler);

    scheduler.apply({ offline: true });
    assert.equal(hud._summaryInterval, null);
    await hud._updateSummary(true, true);
    assert.equal(env.fetches.length, 0, 'offline issues no /api/openai/hud-summary');

    let summaryCalls = 0;
    hud._updateSummary = async () => { summaryCalls += 1; };
    scheduler.apply({ offline: false });
    assert.equal(summaryCalls, 1, 'online issues one summary refresh');
    assert.notEqual(hud._summaryInterval, null);
  } finally {
    hud?.destroy();
    scheduler.detach();
    env.restore();
  }
});
