import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DataLayerManager } from './data/manager.js';
import {
  isDocumentHidden,
  isVoiceSessionActive,
  shouldDeferBackgroundNetwork,
  subscribePageVisibility,
} from './pageVisibility.js';

function installVisibilityDocument({ hidden = false } = {}) {
  const listeners = new Set();
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const document = {
    visibilityState: hidden ? 'hidden' : 'visible',
    get hidden() { return this.visibilityState === 'hidden'; },
    addEventListener(type, handler) {
      if (type === 'visibilitychange') listeners.add(handler);
    },
    removeEventListener(type, handler) {
      if (type === 'visibilitychange') listeners.delete(handler);
    },
  };
  globalThis.document = document;
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
  return {
    document,
    listeners,
    setHidden(nextHidden) {
      document.visibilityState = nextHidden ? 'hidden' : 'visible';
      for (const handler of [...listeners]) handler();
    },
    restore() {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
    },
  };
}

async function flushAsync() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function makeFetchLayer(id, { updateInterval = 1000 } = {}) {
  const calls = { update: 0, urls: [] };
  return {
    calls,
    module: {
      id,
      name: id,
      icon: '',
      source: 'test',
      updateInterval,
      async init() {},
      enable() {},
      disable() {},
      async update() {
        calls.update += 1;
        await fetch('/api/opensky');
        return true;
      },
      getStats() { return { count: 0, lastUpdate: null }; },
    },
  };
}

test('isDocumentHidden follows visibilityState and document.hidden', () => {
  const env = installVisibilityDocument({ hidden: false });
  try {
    assert.equal(isDocumentHidden(), false);
    env.document.visibilityState = 'hidden';
    assert.equal(isDocumentHidden(), true);
    env.document.visibilityState = 'visible';
    assert.equal(isDocumentHidden(), false);
  } finally {
    env.restore();
  }
  const originalDocument = globalThis.document;
  try {
    globalThis.document = { hidden: true };
    assert.equal(isDocumentHidden(), true);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('background network defers while hidden unless a voice session is mid-call', () => {
  const env = installVisibilityDocument({ hidden: true });
  const previousVoice = globalThis.window.__godsEyeView;
  try {
    assert.equal(shouldDeferBackgroundNetwork(), true);
    globalThis.window.__godsEyeView = { voiceCommands: { isActive: () => true } };
    assert.equal(isVoiceSessionActive(), true);
    assert.equal(shouldDeferBackgroundNetwork(), false, 'Places/OpenAI for an active call may continue');
    globalThis.window.__godsEyeView = { voiceCommands: { isActive: () => false } };
    assert.equal(shouldDeferBackgroundNetwork(), true);
  } finally {
    if (previousVoice === undefined) delete globalThis.window.__godsEyeView;
    else globalThis.window.__godsEyeView = previousVoice;
    env.restore();
  }
});

test('subscribePageVisibility starts and stops on the document listener', () => {
  const env = installVisibilityDocument();
  try {
    const seen = [];
    const unsubscribe = subscribePageVisibility((hidden) => seen.push(hidden));
    assert.equal(env.listeners.size, 1);
    env.setHidden(true);
    env.setHidden(false);
    assert.deepEqual(seen, [true, false]);
    unsubscribe();
    assert.equal(env.listeners.size, 0);
    env.setHidden(true);
    assert.deepEqual(seen, [true, false]);
  } finally {
    env.restore();
  }
});

test('visibility listener starts and stops the existing poll handles', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const env = installVisibilityDocument();
  const layer = makeFetchLayer('flights', { updateInterval: 1000 });
  const requested = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requested.push(String(input));
    return { ok: true, json: async () => ({}) };
  };
  const mgr = new DataLayerManager({});
  try {
    mgr.register(layer.module);
    await mgr.setEnabled('flights', true);
    const entry = mgr.layers.get('flights');
    const liveHandle = entry.intervalId;
    assert.notEqual(liveHandle, null, 'enable arms the existing poll handle');
    const updatesAfterEnable = layer.calls.update;
    const fetchesAfterEnable = requested.length;

    env.setHidden(true);
    assert.equal(entry.intervalId, null, 'hidden tab stops the existing poll handle');
    t.mock.timers.tick(30_000);
    await flushAsync();
    assert.equal(layer.calls.update, updatesAfterEnable, 'no poll ticks while hidden');
    assert.equal(requested.length, fetchesAfterEnable, 'no new /api/opensky requests while hidden');

    env.setHidden(false);
    await flushAsync();
    assert.equal(layer.calls.update, updatesAfterEnable + 1, 'visible tab refreshes once immediately');
    assert.notEqual(entry.intervalId, null, 'visible tab restarts a poll handle');
    assert.notEqual(entry.intervalId, liveHandle, 'the stopped handle is not left running');
    assert.equal(requested.at(-1), '/api/opensky');
    assert.equal(requested.length, fetchesAfterEnable + 1);

    t.mock.timers.tick(1000);
    await flushAsync();
    assert.equal(layer.calls.update, updatesAfterEnable + 2, 'normal cadence resumes after the immediate refresh');
    assert.equal(requested.length, fetchesAfterEnable + 2);
  } finally {
    await mgr.destroyAll();
    globalThis.fetch = originalFetch;
    env.restore();
    t.mock.timers.reset();
  }
});

test('an active voice session does not keep layer poll handles running while hidden', async () => {
  const env = installVisibilityDocument();
  const previousVoice = globalThis.window.__godsEyeView;
  globalThis.window.__godsEyeView = { voiceCommands: { isActive: () => true } };
  const layer = makeFetchLayer('flights', { updateInterval: 5000 });
  const mgr = new DataLayerManager({});
  try {
    mgr.register(layer.module);
    await mgr.setEnabled('flights', true);
    assert.notEqual(mgr.layers.get('flights').intervalId, null);
    env.setHidden(true);
    assert.equal(mgr.layers.get('flights').intervalId, null, 'voice mid-call still pauses poll handles');
    assert.equal(isVoiceSessionActive(), true);
  } finally {
    await mgr.destroyAll();
    if (previousVoice === undefined) delete globalThis.window.__godsEyeView;
    else globalThis.window.__godsEyeView = previousVoice;
    env.restore();
  }
});

test('hidden tab starts no new /api/opensky requests for 30s, then one refresh', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const env = installVisibilityDocument();
  const requested = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requested.push(String(input));
    return { ok: true, json: async () => ({}) };
  };
  const layer = makeFetchLayer('flights', { updateInterval: 10_000 });
  const mgr = new DataLayerManager({});
  try {
    mgr.register(layer.module);
    await mgr.setEnabled('flights', true);
    requested.length = 0;

    env.setHidden(true);
    t.mock.timers.tick(30_000);
    await flushAsync();
    assert.deepEqual(requested, [], 'hide tab 30s: no new /api/opensky requests');

    env.setHidden(false);
    await flushAsync();
    assert.deepEqual(requested, ['/api/opensky'], 'show tab: one immediate refresh');

    t.mock.timers.tick(10_000);
    await flushAsync();
    assert.deepEqual(requested, ['/api/opensky', '/api/opensky'], 'then normal cadence');
  } finally {
    await mgr.destroyAll();
    globalThis.fetch = originalFetch;
    env.restore();
    t.mock.timers.reset();
  }
});

test('visibilitychange does not stop an active voice session mid-call', () => {
  const src = readFileSync(new URL('./voice/gevRealtime.js', import.meta.url), 'utf8');
  const start = src.indexOf('this.shortcutVisibilityHandler = () => {');
  const end = src.indexOf('document.addEventListener(\'visibilitychange\'', start);
  assert.ok(start >= 0 && end > start, 'voice visibility handler must exist');
  const handler = src.slice(start, end);
  assert.match(handler, /document\.visibilityState === 'hidden'/);
  assert.match(handler, /shortcutBlurHandler/);
  assert.doesNotMatch(handler, /\.stop\(/, 'hidden tab must not hang up the realtime call');
});

test('scheduled OpenAI and Google Places call sites defer on the client scheduler', () => {
  const hud = readFileSync(new URL('./hud.js', import.meta.url), 'utf8');
  assert.match(hud, /import \{[^}]*isDocumentHidden[^}]*\} from '\.\/pageVisibility\.js';/);
  assert.match(
    hud,
    /async _updateSummary\([^)]*\) \{\s*if \(isDocumentHidden\(\)\) return;/,
    'HUD summary must not start a new OpenAI call while hidden',
  );
  assert.match(hud, /subscribePageVisibility/);

  const actions = readFileSync(new URL('./voice/gevActions.js', import.meta.url), 'utf8');
  assert.match(actions, /shouldDeferBackgroundNetwork/);
  assert.match(
    actions,
    /if \(shouldDeferBackgroundNetwork\(\)\) return \[\];/,
    'nearby Places must not start a new Google call while hidden',
  );

  const resolver = readFileSync(new URL('./annotations/annotationResolver.js', import.meta.url), 'utf8');
  assert.match(resolver, /shouldDeferBackgroundNetwork/);

  const installations = readFileSync(new URL('./data/militaryInstallations.js', import.meta.url), 'utf8');
  assert.match(installations, /shouldDeferBackgroundNetwork/);

  const manager = readFileSync(new URL('./data/manager.js', import.meta.url), 'utf8');
  assert.match(manager, /subscribePageVisibility/);
  assert.match(manager, /_pausePollHandles/);
  assert.match(manager, /_resumePollHandles/);
});
