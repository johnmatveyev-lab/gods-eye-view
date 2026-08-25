// Hidden-tab pause for the HUD summary interval. The HUD imports `mgrs`, a
// CommonJS package whose named exports Node's ESM loader cannot see, so this
// file installs the same specifier stub as hudAltitudeDatum.test.mjs before
// importing IntelHUD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const MGRS_STUB_URL = 'gev-test-stub:mgrs-hud-visibility';
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

function installHudVisibilityEnvironment({ hidden = false } = {}) {
  const listeners = new Set();
  const elements = new Map(
    ['hud-alt', 'hud-summary', 'hud-mgrs', 'hud-latlon', 'hud-bottom-line', 'hud-gsd', 'hud-coll', 'hud-ona', 'hud-mode', 'hud-timestamp', 'hud-rec-dot']
      .map((id) => [id, { textContent: '', style: {} }]),
  );
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const requested = [];
  const document = {
    visibilityState: hidden ? 'hidden' : 'visible',
    get hidden() { return this.visibilityState === 'hidden'; },
    getElementById: (id) => elements.get(id) ?? null,
    querySelectorAll: () => [],
    addEventListener(type, handler) {
      if (type === 'visibilitychange') listeners.add(handler);
    },
    removeEventListener(type, handler) {
      if (type === 'visibilitychange') listeners.delete(handler);
    },
  };
  globalThis.document = document;
  globalThis.window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
  globalThis.fetch = async (input) => {
    requested.push(String(input));
    return { ok: true, json: async () => ({ summary: 'LIVE FIVE WORD LINE' }) };
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
    document,
    elements,
    requested,
    viewer,
    setHidden(nextHidden) {
      document.visibilityState = nextHidden ? 'hidden' : 'visible';
      for (const handler of [...listeners]) handler();
    },
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

function armHudSummary(hud) {
  hud._visible = true;
  hud._latestMetrics = {
    latDeg: 30, lonDeg: -97, altM: 1000, altMslM: 1000, sunEl: 45, ona: 10,
  };
  hud._summaryDirty = true;
  hud._summaryContext = async () => ({
    placeLabels: ['Austin'],
    streetLabels: [],
    nearbyPlaceLabels: [],
    enabledLayerLabels: ['Live Flights'],
  });
}

async function flushAsync() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

test('HUD visibility listener starts and stops the existing summary poll handle', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const env = installHudVisibilityEnvironment();
  let hud;
  try {
    hud = new IntelHUD(env.viewer);
    armHudSummary(hud);
    let summaryTicks = 0;
    const originalUpdate = hud._updateSummary.bind(hud);
    hud._updateSummary = async (...args) => {
      summaryTicks += 1;
      return originalUpdate(...args);
    };
    const liveHandle = hud._summaryInterval;
    assert.notEqual(liveHandle, null, 'HUD starts the summary poll handle');

    await hud._updateSummary(false, true);
    await flushAsync();
    env.requested.length = 0;
    const ticksAfterPrime = summaryTicks;

    env.setHidden(true);
    assert.equal(hud._summaryInterval, null, 'hidden tab stops the existing summary handle');
    t.mock.timers.tick(30_000);
    await flushAsync();
    assert.deepEqual(env.requested, [], 'hide tab 30s: no new hud-summary requests');
    assert.equal(summaryTicks, ticksAfterPrime, 'the stopped handle must not tick while hidden');

    env.setHidden(false);
    await flushAsync();
    assert.deepEqual(env.requested, ['/api/openai/hud-summary'], 'show tab: one immediate refresh');
    assert.ok(summaryTicks > ticksAfterPrime, 'visible tab runs one summary refresh');
    assert.notEqual(hud._summaryInterval, null, 'visible tab restarts the summary handle');
    assert.notEqual(hud._summaryInterval, liveHandle);
    const ticksAfterShow = summaryTicks;

    t.mock.timers.tick(15_000);
    await flushAsync();
    assert.ok(summaryTicks > ticksAfterShow, 'then the normal 15s cadence');
    assert.notEqual(hud._summaryInterval, null);
  } finally {
    hud?.destroy();
    env.restore();
    t.mock.timers.reset();
  }
});
