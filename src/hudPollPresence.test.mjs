import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

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

function installHudEnvironment(canPollFn) {
  const elements = new Map(
    ['hud-alt', 'hud-summary', 'hud-mgrs', 'hud-latlon', 'hud-bottom-line', 'hud-gsd', 'hud-coll', 'hud-ona', 'hud-mode']
      .map((id) => [id, { textContent: '' }]),
  );
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = {
    hidden: false,
    getElementById: (id) => elements.get(id) ?? null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = {
    setTimeout,
    clearTimeout,
  };
  const viewer = {
    camera: {
      pitch: -Math.PI / 2,
      positionCartographic: { latitude: 0.5, longitude: -1.7, height: 1200 },
      computeViewRectangle: () => undefined,
      moveEnd: { addEventListener() {}, removeEventListener() {} },
    },
  };
  const hud = new IntelHUD(viewer, { canPoll: canPollFn });
  hud._visible = true;
  hud._latestMetrics = {
    latDeg: 30.27,
    lonDeg: -97.74,
    altM: 1200,
    altMslM: 1200,
    sunEl: 42,
    ona: 8,
  };
  hud._summaryContext = async () => ({
    placeLabels: ['Austin'],
    streetLabels: [],
    nearbyPlaceLabels: [],
    enabledLayerLabels: ['Flights'],
  });
  return {
    hud,
    restore() {
      hud.destroy();
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    },
  };
}

function installFetchSpy() {
  const urls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return {
      ok: true,
      json: async () => ({ summary: 'austin flights live' }),
    };
  };
  return {
    urls,
    restore() {
      if (previous) globalThis.fetch = previous;
      else delete globalThis.fetch;
    },
  };
}

test('hide = no new hud-summary; show = one refresh; same summary handle', async () => {
  const allowed = { value: true };
  const fetchSpy = installFetchSpy();
  const env = installHudEnvironment(() => allowed.value);
  const handle = env.hud._summaryInterval;
  assert.notEqual(handle, null);
  fetchSpy.urls.length = 0;

  allowed.value = false;
  await env.hud._updateSummary(true, true);
  assert.equal(fetchSpy.urls.filter((url) => url.includes('/api/openai/hud-summary')).length, 0);

  allowed.value = true;
  await env.hud.resumePausedSummary();
  assert.equal(fetchSpy.urls.filter((url) => url.includes('/api/openai/hud-summary')).length, 1);
  assert.equal(env.hud._summaryInterval, handle);

  env.hud._startTimers();
  assert.equal(env.hud._summaryInterval, handle, 'resume must not arm a second summary timer');

  env.restore();
  fetchSpy.restore();
});

test('offline skips hud-summary; online resume fetches once', async () => {
  const allowed = { value: true };
  const fetchSpy = installFetchSpy();
  const env = installHudEnvironment(() => allowed.value);
  fetchSpy.urls.length = 0;

  allowed.value = false;
  await env.hud.resumePausedSummary();
  assert.equal(fetchSpy.urls.length, 0);

  allowed.value = true;
  await env.hud.resumePausedSummary();
  assert.equal(fetchSpy.urls.filter((url) => url.includes('/api/openai/hud-summary')).length, 1);

  env.restore();
  fetchSpy.restore();
});
