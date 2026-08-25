import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataLayerManager } from './manager.js';
import { createLivePollScheduler } from '../chrome/scheduler.js';

function makeChrome({ hidden = false, online = true } = {}) {
  const document = new EventTarget();
  const window = new EventTarget();
  document.visibilityState = hidden ? 'hidden' : 'visible';
  document.hidden = hidden;
  window.navigator = { onLine: online };
  return { document, window };
}

function makeCountingLayer(id, { updateInterval = 30_000 } = {}) {
  const calls = { update: 0, enable: 0 };
  return {
    calls,
    module: {
      id,
      name: id,
      icon: '',
      source: 'test',
      updateInterval,
      async init() {},
      enable() { calls.enable += 1; },
      disable() {},
      async update() { calls.update += 1; },
      getStats() { return { count: calls.update, lastUpdate: Date.now() }; },
    },
  };
}

test('hidden 30s issues no further flight polls; show refreshes once', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const chrome = makeChrome();
  const scheduler = createLivePollScheduler(chrome);
  scheduler.attach();
  const mgr = new DataLayerManager({});
  mgr.attachLiveScheduler(scheduler);
  const layer = makeCountingLayer('flights', { updateInterval: 30_000 });
  mgr.register(layer.module);
  await mgr.setEnabled('flights', true, { origin: 'programmatic' });
  const afterEnable = layer.calls.update;
  assert.equal(afterEnable, 1);
  assert.notEqual(mgr.layers.get('flights').intervalId, null);

  chrome.document.visibilityState = 'hidden';
  chrome.document.hidden = true;
  chrome.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(mgr.areLivePollsSuspended(), true);
  assert.equal(mgr.layers.get('flights').intervalId, null);

  t.mock.timers.tick(30_000);
  await Promise.resolve();
  assert.equal(layer.calls.update, afterEnable, 'hide 30s issues no /api/opensky poll');

  chrome.document.visibilityState = 'visible';
  chrome.document.hidden = false;
  chrome.document.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();
  assert.equal(layer.calls.update, afterEnable + 1, 'show issues one refresh');
  assert.equal(mgr.areLivePollsSuspended(), false);
  assert.notEqual(mgr.layers.get('flights').intervalId, null);
  const armedId = mgr.layers.get('flights').intervalId;

  chrome.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(mgr.layers.get('flights').intervalId, armedId, 'no double timers');
  clearInterval(armedId);
  scheduler.detach();
  mgr.detachLiveScheduler();
  t.mock.timers.reset();
});

test('offline then online refreshes once and does not double-arm with hidden', async () => {
  const chrome = makeChrome();
  const scheduler = createLivePollScheduler(chrome);
  scheduler.attach();
  const mgr = new DataLayerManager({});
  mgr.attachLiveScheduler(scheduler);
  const flights = makeCountingLayer('flights', { updateInterval: 15_000 });
  const ais = makeCountingLayer('ais-live-vessels', { updateInterval: 60_000 });
  mgr.register(flights.module);
  mgr.register(ais.module);
  await mgr.setEnabled('flights', true, { origin: 'programmatic' });
  await mgr.setEnabled('ais-live-vessels', true, { origin: 'programmatic' });
  const flightUpdates = flights.calls.update;
  const aisInterval = mgr.layers.get('ais-live-vessels').intervalId;

  scheduler.apply({ hidden: true, offline: true });
  assert.equal(mgr.layers.get('flights').intervalId, null);
  assert.equal(
    mgr.layers.get('ais-live-vessels').intervalId,
    aisInterval,
    'AIS is not a chrome poll handle',
  );

  scheduler.apply({ hidden: false });
  assert.equal(mgr.areLivePollsSuspended(), true);
  assert.equal(flights.calls.update, flightUpdates);

  scheduler.apply({ offline: false });
  await Promise.resolve();
  assert.equal(flights.calls.update, flightUpdates + 1);
  assert.notEqual(mgr.layers.get('flights').intervalId, null);
  const id = mgr.layers.get('flights').intervalId;
  scheduler.apply({ hidden: false, offline: false });
  assert.equal(mgr.layers.get('flights').intervalId, id);
  assert.equal(flights.calls.update, flightUpdates + 1);

  clearInterval(id);
  clearInterval(mgr.layers.get('ais-live-vessels').intervalId);
  scheduler.detach();
  mgr.detachLiveScheduler();
});

test('enabling a layer while suspended does not arm a poll until resume', async () => {
  const chrome = makeChrome({ hidden: true });
  const scheduler = createLivePollScheduler(chrome);
  scheduler.attach();
  const mgr = new DataLayerManager({});
  mgr.attachLiveScheduler(scheduler);
  const layer = makeCountingLayer('military', { updateInterval: 15_000 });
  mgr.register(layer.module);
  await mgr.setEnabled('military', true, { origin: 'voice' });
  assert.equal(layer.calls.update, 1, 'voice enable still does one update');
  assert.equal(mgr.layers.get('military').intervalId, null);

  scheduler.apply({ hidden: false });
  await Promise.resolve();
  assert.equal(layer.calls.update, 2);
  assert.notEqual(mgr.layers.get('military').intervalId, null);
  clearInterval(mgr.layers.get('military').intervalId);
  scheduler.detach();
  mgr.detachLiveScheduler();
});
