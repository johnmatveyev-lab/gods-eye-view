import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createLivePollScheduler,
  isLivePollSuspended,
  readDocumentHidden,
  readWindowOffline,
} from './scheduler.js';
import { installOfflineBanner, syncOfflineBanner, OFFLINE_CHIP_TEXT } from './offlineBanner.js';

function makeChrome({ hidden = false, online = true } = {}) {
  const document = new EventTarget();
  const window = new EventTarget();
  document.visibilityState = hidden ? 'hidden' : 'visible';
  document.hidden = hidden;
  window.navigator = { onLine: online };
  return { document, window };
}

function makeHandle() {
  const calls = { start: 0, stop: 0, refresh: 0 };
  return {
    calls,
    spec: {
      start() { calls.start += 1; },
      stop() { calls.stop += 1; },
      refresh() { calls.refresh += 1; },
    },
  };
}

test('chrome flags treat missing hosts as visible and online', () => {
  assert.equal(readDocumentHidden(undefined), false);
  assert.equal(readWindowOffline(undefined), false);
  assert.equal(isLivePollSuspended({}), false);
  assert.equal(isLivePollSuspended({ hidden: true }), true);
  assert.equal(isLivePollSuspended({ offline: true }), true);
  assert.equal(isLivePollSuspended({ hidden: true, offline: true }), true);
});

test('hide for 30s issues no poll ticks; show refreshes once', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const chrome = makeChrome();
  const scheduler = createLivePollScheduler(chrome);
  scheduler.attach();
  let ticks = 0;
  let intervalId = null;
  scheduler.register('flights', {
    start() {
      if (intervalId != null) return;
      intervalId = setInterval(() => { ticks += 1; }, 30_000);
    },
    stop() {
      clearInterval(intervalId);
      intervalId = null;
    },
    refresh() { ticks += 1; },
  });

  t.mock.timers.tick(30_000);
  assert.equal(ticks, 1, 'first interval tick while visible');

  chrome.document.visibilityState = 'hidden';
  chrome.document.hidden = true;
  chrome.document.dispatchEvent(new Event('visibilitychange'));
  const hiddenTicks = ticks;
  t.mock.timers.tick(30_000);
  assert.equal(ticks, hiddenTicks, 'hide 30s issues no /api/opensky-style poll');
  assert.equal(scheduler.isHandleRunning('flights'), false);

  chrome.document.visibilityState = 'visible';
  chrome.document.hidden = false;
  chrome.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(ticks, hiddenTicks + 1, 'show issues one refresh');
  assert.equal(scheduler.isHandleRunning('flights'), true);
  t.mock.timers.reset();
});

test('offline shows the last-data chip; online hides it and refreshes once', () => {
  const chrome = makeChrome();
  const scheduler = createLivePollScheduler(chrome);
  scheduler.attach();
  const handle = makeHandle();
  scheduler.register('hud-summary', handle.spec);
  assert.equal(handle.calls.start, 1);
  assert.equal(handle.calls.refresh, 0);

  const chip = {
    hidden: true,
    textContent: OFFLINE_CHIP_TEXT,
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
  };
  const root = { getElementById: (id) => (id === 'offline-chip' ? chip : null) };
  const dispose = installOfflineBanner(scheduler, root);
  assert.equal(chip.hidden, true);

  chrome.window.navigator.onLine = false;
  chrome.window.dispatchEvent(new Event('offline'));
  assert.equal(syncOfflineBanner(chip, scheduler.getState()), true);
  assert.equal(chip.hidden, false);
  assert.equal(chip.textContent, 'Offline — showing last data');
  assert.equal(handle.calls.stop, 1);
  assert.equal(handle.calls.start, 1);

  chrome.window.navigator.onLine = true;
  chrome.window.dispatchEvent(new Event('online'));
  assert.equal(chip.hidden, true);
  assert.equal(handle.calls.refresh, 1, 'back online issues one refresh');
  assert.equal(handle.calls.start, 2);
  dispose();
});

test('hidden then offline then recover does not double-start timers', () => {
  const chrome = makeChrome();
  const scheduler = createLivePollScheduler(chrome);
  scheduler.attach();
  const handle = makeHandle();
  scheduler.register('layer-polls', handle.spec);
  assert.equal(handle.calls.start, 1);

  scheduler.apply({ hidden: true });
  scheduler.apply({ offline: true });
  assert.equal(handle.calls.stop, 1, 'second suspend is a no-op stop');
  assert.equal(handle.calls.start, 1);
  assert.equal(handle.calls.refresh, 0);
  assert.equal(scheduler.getState().suspended, true);

  scheduler.apply({ hidden: false });
  assert.equal(scheduler.getState().suspended, true, 'still offline');
  assert.equal(handle.calls.start, 1, 'visible+offline must not restart');
  assert.equal(handle.calls.refresh, 0);

  scheduler.apply({ offline: false });
  assert.equal(scheduler.getState().suspended, false);
  assert.equal(handle.calls.refresh, 1);
  assert.equal(handle.calls.start, 2, 'one start on the first fully-active edge');

  scheduler.apply({ hidden: false, offline: false });
  assert.equal(handle.calls.start, 2, 'already-active apply must not start again');
  assert.equal(handle.calls.refresh, 1);
});

test('registering while already running does not start a second timer', () => {
  const chrome = makeChrome();
  const scheduler = createLivePollScheduler(chrome);
  const handle = makeHandle();
  scheduler.register('hud-summary', { ...handle.spec, running: true });
  assert.equal(handle.calls.start, 0);
  assert.equal(scheduler.isHandleRunning('hud-summary'), true);
});

test('voice and AIS are not chrome poll handles', () => {
  const source = readFileSync(new URL('./scheduler.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(source, /Voice sessions and AIS streams are not registered here/);
  assert.equal(source.includes('serviceWorker'), false);
  assert.equal(html.includes('serviceWorker'), false);
  assert.match(html, /id="offline-chip"/);
  assert.match(html, /Offline — showing last data/);
  assert.match(main, /createLivePollScheduler/);
  assert.match(main, /installOfflineBanner/);
  const scheduler = createLivePollScheduler(makeChrome());
  scheduler.register('layer-polls', makeHandle().spec);
  scheduler.register('hud-summary', makeHandle().spec);
  assert.deepEqual(scheduler.handleIds(), ['layer-polls', 'hud-summary']);
});
