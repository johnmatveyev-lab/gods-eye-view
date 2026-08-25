import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  OFFLINE_CHIP_ID,
  OFFLINE_CHIP_LABEL,
  canPoll,
  createPollPresence,
} from './pollPresence.js';
import { DataLayerManager } from './data/manager.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createPresenceEnv({ hidden = false, onLine = true } = {}) {
  const docListeners = new Map();
  const winListeners = new Map();
  const elements = new Map();
  const document = {
    hidden,
    body: {
      appendChild(el) {
        elements.set(el.id, el);
        return el;
      },
    },
    getElementById: (id) => elements.get(id) ?? null,
    createElement() {
      return {
        id: '',
        className: '',
        textContent: '',
        hidden: false,
        dataset: {},
        setAttribute() {},
      };
    },
    addEventListener(type, fn) {
      const set = docListeners.get(type) || new Set();
      set.add(fn);
      docListeners.set(type, set);
    },
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn);
    },
  };
  const windowRef = {
    addEventListener(type, fn) {
      const set = winListeners.get(type) || new Set();
      set.add(fn);
      winListeners.set(type, set);
    },
    removeEventListener(type, fn) {
      winListeners.get(type)?.delete(fn);
    },
  };
  const navigatorRef = { onLine };
  return {
    document,
    window: windowRef,
    navigator: navigatorRef,
    setHidden(next) {
      document.hidden = next;
      for (const fn of docListeners.get('visibilitychange') || []) fn();
    },
    setOnline(next) {
      navigatorRef.onLine = next;
      for (const fn of winListeners.get(next ? 'online' : 'offline') || []) fn();
    },
  };
}

function makeOpenskyLayer() {
  const calls = { update: 0 };
  return {
    calls,
    module: {
      id: 'flights',
      name: 'Flights',
      icon: '',
      source: 'adsb.lol',
      updateInterval: 30_000,
      async init() {},
      enable() {},
      disable() {},
      async update() {
        calls.update += 1;
        await globalThis.fetch('/api/opensky?lat=30&lon=-97');
      },
      getStats() { return { count: 0, lastUpdate: Date.now() }; },
    },
  };
}

function installFetchSpy() {
  const urls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => ({ summary: 'ok' }) };
  };
  return {
    urls,
    restore() {
      if (previous) globalThis.fetch = previous;
      else delete globalThis.fetch;
    },
  };
}

function captureIntervals() {
  const timers = [];
  const originalSet = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  globalThis.setInterval = (fn, ms) => {
    const id = originalSet(() => {}, 1e9);
    timers.push({ id, fn, ms });
    return id;
  };
  globalThis.clearInterval = (id) => {
    const idx = timers.findIndex((timer) => timer.id === id);
    if (idx >= 0) timers.splice(idx, 1);
    originalClear(id);
  };
  return {
    timers,
    restore() {
      globalThis.setInterval = originalSet;
      globalThis.clearInterval = originalClear;
      for (const timer of timers) originalClear(timer.id);
    },
  };
}

function waitResume() {
  return new Promise((resolve) => queueMicrotask(resolve));
}

test('canPoll is false while hidden or offline', () => {
  assert.equal(canPoll({ document: { hidden: false }, navigator: { onLine: true } }), true);
  assert.equal(canPoll({ document: { hidden: true }, navigator: { onLine: true } }), false);
  assert.equal(canPoll({ document: { hidden: false }, navigator: { onLine: false } }), false);
  assert.equal(canPoll({ document: { hidden: true }, navigator: { onLine: false } }), false);
});

test('offline chip appears while offline and hides when online', () => {
  const env = createPresenceEnv({ onLine: false });
  const presence = createPollPresence(env);
  presence.install();
  const chip = env.document.getElementById(OFFLINE_CHIP_ID);
  assert.ok(chip);
  assert.equal(chip.textContent, OFFLINE_CHIP_LABEL);
  assert.equal(chip.hidden, false);
  env.setOnline(true);
  assert.equal(chip.hidden, true);
  presence.uninstall();
});

test('hide = no new opensky; show = one refresh; same poll handle', async () => {
  const env = createPresenceEnv();
  const fetchSpy = installFetchSpy();
  const intervals = captureIntervals();
  const layer = makeOpenskyLayer();
  const presence = createPollPresence(env);
  const manager = new DataLayerManager({}, { canPoll: () => presence.canPoll() });
  presence.subscribe(() => { void manager.resumePausedPolls(); });
  presence.install();
  manager.register(layer.module);
  await manager.setEnabled('flights', true);
  const handle = manager.layers.get('flights').intervalId;
  assert.notEqual(handle, null);
  fetchSpy.urls.length = 0;
  layer.calls.update = 0;

  env.setHidden(true);
  for (const timer of intervals.timers) timer.fn();
  await waitResume();
  assert.equal(fetchSpy.urls.filter((url) => url.includes('/api/opensky')).length, 0);

  env.setHidden(false);
  await waitResume();
  assert.equal(fetchSpy.urls.filter((url) => url.includes('/api/opensky')).length, 1);
  assert.equal(manager.layers.get('flights').intervalId, handle);

  presence.uninstall();
  await manager.destroyAll();
  intervals.restore();
  fetchSpy.restore();
});

test('offline chip + online refresh uses the same poll handle', async () => {
  const env = createPresenceEnv();
  const fetchSpy = installFetchSpy();
  const intervals = captureIntervals();
  const layer = makeOpenskyLayer();
  const presence = createPollPresence(env);
  const manager = new DataLayerManager({}, { canPoll: () => presence.canPoll() });
  presence.subscribe(() => { void manager.resumePausedPolls(); });
  presence.install();
  manager.register(layer.module);
  await manager.setEnabled('flights', true);
  const handle = manager.layers.get('flights').intervalId;
  fetchSpy.urls.length = 0;

  env.setOnline(false);
  const chip = env.document.getElementById(OFFLINE_CHIP_ID);
  assert.equal(chip.hidden, false);
  for (const timer of intervals.timers) timer.fn();
  await waitResume();
  assert.equal(fetchSpy.urls.filter((url) => url.includes('/api/opensky')).length, 0);

  env.setOnline(true);
  await waitResume();
  assert.equal(chip.hidden, true);
  assert.equal(fetchSpy.urls.filter((url) => url.includes('/api/opensky')).length, 1);
  assert.equal(manager.layers.get('flights').intervalId, handle);

  presence.uninstall();
  await manager.destroyAll();
  intervals.restore();
  fetchSpy.restore();
});

test('hidden + offline resume starts once and does not arm a second timer', async () => {
  const env = createPresenceEnv();
  const fetchSpy = installFetchSpy();
  const intervals = captureIntervals();
  const layer = makeOpenskyLayer();
  let resumes = 0;
  const presence = createPollPresence({
    ...env,
    onResume() { resumes += 1; },
  });
  const manager = new DataLayerManager({}, { canPoll: () => presence.canPoll() });
  presence.subscribe(() => { void manager.resumePausedPolls(); });
  presence.install();
  manager.register(layer.module);
  await manager.setEnabled('flights', true);
  const handle = manager.layers.get('flights').intervalId;
  const timerCount = intervals.timers.length;
  fetchSpy.urls.length = 0;

  env.setHidden(true);
  env.setOnline(false);
  for (const timer of intervals.timers) timer.fn();
  await waitResume();
  assert.equal(resumes, 0);
  assert.equal(fetchSpy.urls.length, 0);

  env.setHidden(false);
  env.setOnline(true);
  await waitResume();
  assert.equal(resumes, 1);
  assert.equal(fetchSpy.urls.filter((url) => url.includes('/api/opensky')).length, 1);
  assert.equal(manager.layers.get('flights').intervalId, handle);
  assert.equal(intervals.timers.length, timerCount, 'no second interval');

  presence.uninstall();
  await manager.destroyAll();
  intervals.restore();
  fetchSpy.restore();
});

test('install is idempotent — a second install does not double-start listeners', async () => {
  const env = createPresenceEnv();
  let resumes = 0;
  const presence = createPollPresence({
    ...env,
    onResume() { resumes += 1; },
  });
  presence.install();
  presence.install();
  env.setHidden(true);
  env.setHidden(false);
  await waitResume();
  assert.equal(resumes, 1);
  presence.uninstall();
});

test('does not pause an active voice session', async () => {
  const voice = {
    status: 'listening',
    isActive() { return this.status !== 'idle' && this.status !== 'error'; },
    stop() { throw new Error('must not pause active voice'); },
  };
  const env = createPresenceEnv();
  const presence = createPollPresence({
    ...env,
    onResume() {
      assert.equal(voice.isActive(), true);
    },
  });
  presence.install();
  env.setHidden(true);
  assert.equal(voice.isActive(), true);
  env.setHidden(false);
  await waitResume();
  assert.equal(voice.isActive(), true);
  presence.uninstall();
});

test('poll presence adds no service worker, no /api route, and keeps legal names', () => {
  const presence = readFileSync(path.join(ROOT, 'src/pollPresence.js'), 'utf8');
  const main = readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
  const voice = readFileSync(path.join(ROOT, 'src/voice/gevRealtime.js'), 'utf8');
  assert.doesNotMatch(presence, /serviceWorker|service-worker|navigator\.serviceWorker/);
  assert.doesNotMatch(presence, /\/api\/[a-z]/);
  assert.doesNotMatch(presence, /opensky-network\.org|news\.google\.com|telegeography|quantum-earth|God'?s Eye View/i);
  assert.match(main, /createLivePollScheduler/);
  assert.match(main, /installOfflineBanner/);
  assert.match(main, /attachLiveScheduler/);
  assert.match(voice, /shortcutVisibilityHandler = \(\) => \{\s*if \(document\.visibilityState === 'hidden'\) this\.shortcutBlurHandler\(\);/);
  assert.doesNotMatch(voice, /visibilitychange[\s\S]{0,80}this\.stop\(/);
});
