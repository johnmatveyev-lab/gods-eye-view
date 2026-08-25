import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SELECTED_CONTACT_IDENT_COPY_ID,
  SELECTED_CONTACT_IDENT_ROOT_ID,
  SELECTED_CONTACT_IDENT_VALUE_ID,
  contactKindFromLayerId,
  contactKindFromTrackedId,
  copiedIdentToast,
  copySelectedContactIdent,
  destroySelectedContactIdent,
  getSelectedContactIdentForTest,
  initSelectedContactIdent,
  isCopyableContactKind,
  resolveCopyableSelection,
  stripStaleSuffix,
  visibleContactIdent,
} from './selectedContactIdent.js';

class MockButton {
  constructor(id) {
    this.id = id;
    this.textContent = '';
    this.title = '';
    this.style = {};
    this.listeners = new Map();
    this.attributes = new Map();
  }

  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(handler);
  }

  removeEventListener(name, handler) {
    this.listeners.get(name)?.delete(handler);
  }

  click() {
    const event = {
      preventDefault() {},
      stopPropagation() {},
    };
    let result;
    for (const handler of [...(this.listeners.get('click') || [])]) {
      result = handler(event);
    }
    return result;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

class MockRoot {
  constructor() {
    this.id = SELECTED_CONTACT_IDENT_ROOT_ID;
    this.hidden = true;
    this.dataset = {};
    this.style = {};
    this.attributes = new Map([['hidden', '']]);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

function makeCesiumEvent() {
  const listeners = new Set();
  return {
    addEventListener(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    raise() { for (const callback of [...listeners]) callback(); },
    get size() { return listeners.size; },
  };
}

function installHarness({
  context = null,
  trackedId = null,
  paintRect = { x: 40, y: 80, w: 160, h: 54 },
  clipboardWrites = [],
  toasts = [],
} = {}) {
  const root = new MockRoot();
  const identButton = new MockButton(SELECTED_CONTACT_IDENT_VALUE_ID);
  const copyButton = new MockButton(SELECTED_CONTACT_IDENT_COPY_ID);
  const changed = makeCesiumEvent();
  const postRender = makeCesiumEvent();
  const host = new EventTarget();
  const viewer = {
    trackedEntity: null,
    trackedEntityChanged: changed,
    scene: { postRender },
  };
  initSelectedContactIdent({
    viewer,
    force: true,
    root,
    identButton,
    copyButton,
    windowTarget: host,
    showToast: (text) => toasts.push(text),
    clipboard: { writeText: async (text) => { clipboardWrites.push(text); } },
    getPaintRect: () => paintRect,
    getActiveTrackedId: () => trackedId,
    getSelectedContext: () => context,
  });
  return {
    root,
    identButton,
    copyButton,
    host,
    viewer,
    changed,
    setContext(next) { context = next; },
    setTrackedId(next) { trackedId = next; },
    setPaintRect(next) { paintRect = next; },
    cleanup() { destroySelectedContactIdent(); },
  };
}

test('visible aircraft ident prefers callsign, then registration, then hex', () => {
  assert.equal(visibleContactIdent({
    kind: 'aircraft',
    callsign: 'UAL123',
    registration: 'N12345',
    icao24: 'a1b2c3',
  }), 'UAL123');
  assert.equal(visibleContactIdent({
    kind: 'aircraft',
    registration: 'N12345',
    icao24: 'a1b2c3',
  }), 'N12345');
  assert.equal(visibleContactIdent({
    kind: 'aircraft',
    icao24: 'a1b2c3',
  }), 'a1b2c3');
});

test('tracked card title contributes only the visible primary ident', () => {
  assert.equal(stripStaleSuffix('RCH123 · STALE'), 'RCH123');
  assert.equal(visibleContactIdent({
    kind: 'aircraft',
    title: 'UAL123 · FL350 · 451 kts',
  }), 'UAL123');
  assert.equal(visibleContactIdent({
    kind: 'aircraft',
    title: 'A1B2C3 · 1200 ft · STALE',
  }), 'A1B2C3');
});

test('ship and sat cards copy the visible id already on the card', () => {
  assert.equal(visibleContactIdent({
    kind: 'vessel',
    name: 'EVER GIVEN',
    mmsi: '366123456',
  }), 'EVER GIVEN');
  assert.equal(visibleContactIdent({
    kind: 'vessel',
    mmsi: '366123456',
  }), 'MMSI 366123456');
  assert.equal(visibleContactIdent({
    kind: 'satellite',
    name: 'ISS',
    norad: 25544,
  }), 'ISS');
  assert.equal(visibleContactIdent({
    kind: 'satellite',
    norad: 25544,
  }), 'SAT-25544');
});

test('installations and other non-asset cards are not copyable', () => {
  assert.equal(contactKindFromLayerId('military-installations'), null);
  assert.equal(contactKindFromLayerId('firms'), null);
  assert.equal(contactKindFromLayerId('cctv'), null);
  assert.equal(contactKindFromTrackedId('installations:fort-test'), null);
  assert.equal(isCopyableContactKind('aircraft'), true);
  assert.equal(isCopyableContactKind('vessel'), true);
  assert.equal(isCopyableContactKind('satellite'), true);
  assert.equal(isCopyableContactKind(null), false);
  assert.equal(visibleContactIdent({
    kind: null,
    label: 'FORT TEST',
  }), '');
});

test('toast names the ident that was copied', () => {
  assert.equal(copiedIdentToast('UAL123'), 'Copied UAL123');
  assert.equal(copiedIdentToast('ISS'), 'Copied ISS');
});

test('select a flight, copy, clipboard is the visible ident', async () => {
  const clipboardWrites = [];
  const toasts = [];
  const harness = installHarness({
    context: {
      layerId: 'flights',
      id: 'abc123',
      label: 'UAL123',
      properties: { callsign: 'UAL123', icao24: 'abc123' },
    },
    trackedId: 'flights:abc123',
    clipboardWrites,
    toasts,
  });
  try {
    assert.equal(harness.root.hidden, false);
    assert.equal(harness.identButton.textContent, 'UAL123');
    assert.equal(getSelectedContactIdentForTest()?.ident, 'UAL123');
    await harness.copyButton.click();
    assert.deepEqual(clipboardWrites, ['UAL123']);
    assert.deepEqual(toasts, ['Copied UAL123']);

    clipboardWrites.length = 0;
    toasts.length = 0;
    await harness.identButton.click();
    assert.deepEqual(clipboardWrites, ['UAL123']);
    assert.deepEqual(toasts, ['Copied UAL123']);
  } finally {
    harness.cleanup();
  }
});

test('no selection hides the copy control', () => {
  const harness = installHarness();
  try {
    assert.equal(harness.root.hidden, true);
    assert.equal(harness.identButton.textContent, '');
    assert.equal(getSelectedContactIdentForTest(), null);
  } finally {
    harness.cleanup();
  }
});

test('clearing a flight hides the control again', () => {
  const harness = installHarness({
    context: {
      layerId: 'flights',
      id: 'abc123',
      label: 'UAL123',
      properties: { callsign: 'UAL123' },
    },
    trackedId: 'flights:abc123',
  });
  try {
    assert.equal(harness.root.hidden, false);
    harness.setContext(null);
    harness.host.dispatchEvent(new CustomEvent('gev:entity-selection-cleared', {
      detail: { layerId: 'flights' },
    }));
    assert.equal(harness.root.hidden, true);
    assert.equal(getSelectedContactIdentForTest(), null);
  } finally {
    harness.cleanup();
  }
});

test('selected ship and sat cards copy their visible ids', async () => {
  const clipboardWrites = [];
  const toasts = [];
  const harness = installHarness({
    context: {
      layerId: 'ais-live-vessels',
      id: 'ais-366123456',
      label: 'EVER GIVEN',
      properties: { mmsi: '366123456', name: 'EVER GIVEN' },
    },
    clipboardWrites,
    toasts,
  });
  try {
    assert.equal(harness.root.hidden, false);
    assert.equal(harness.identButton.textContent, 'EVER GIVEN');
    await harness.copyButton.click();
    assert.deepEqual(clipboardWrites, ['EVER GIVEN']);
    assert.deepEqual(toasts, ['Copied EVER GIVEN']);

    harness.setContext({
      layerId: 'satellites',
      id: '25544',
      label: 'ISS',
      properties: { noradId: '25544', name: 'ISS' },
    });
    harness.setTrackedId('satellites:25544');
    harness.host.dispatchEvent(new CustomEvent('gev:awareness-subject-selected'));
    clipboardWrites.length = 0;
    toasts.length = 0;
    assert.equal(harness.identButton.textContent, 'ISS');
    await harness.identButton.click();
    assert.deepEqual(clipboardWrites, ['ISS']);
    assert.deepEqual(toasts, ['Copied ISS']);
  } finally {
    harness.cleanup();
  }
});

test('an installation card does not reveal the copy control', () => {
  const harness = installHarness({
    context: {
      layerId: 'military-installations',
      id: 'fort-test',
      label: 'FORT TEST',
    },
    trackedId: 'installations:fort-test',
  });
  try {
    assert.equal(harness.root.hidden, true);
    assert.equal(resolveCopyableSelection({
      getSelectedContext: () => ({ layerId: 'military-installations', label: 'FORT TEST' }),
      viewer: { trackedEntity: { gevTrackedId: 'installations:fort-test' } },
    }), null);
  } finally {
    harness.cleanup();
  }
});

test('copySelectedContactIdent writes the ident and toasts the same value', async () => {
  const writes = [];
  const toasts = [];
  const ok = await copySelectedContactIdent('UAL123', {
    clipboard: { writeText: async (text) => { writes.push(text); } },
    showToast: (text) => toasts.push(text),
  });
  assert.equal(ok, true);
  assert.deepEqual(writes, ['UAL123']);
  assert.deepEqual(toasts, ['Copied UAL123']);
});

test('the control stays off chrome that is not the selected-contact card', async () => {
  const source = await readFile(new URL('./selectedContactIdent.js', import.meta.url), 'utf8');
  const markup = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(markup.includes(`id="${SELECTED_CONTACT_IDENT_ROOT_ID}"`));
  assert.ok(markup.includes(`id="${SELECTED_CONTACT_IDENT_VALUE_ID}"`));
  assert.ok(markup.includes(`id="${SELECTED_CONTACT_IDENT_COPY_ID}"`));
  assert.match(markup, /<title>Meridian<\/title>/);
  for (const forbidden of [
    'person-search',
    'personSearch',
    'fetch(',
    "fetch '",
    'hud-toggle',
    'share-btn',
    'reset-globe-view',
    'hud-timestamp',
    'hud-units',
    'pp-toggles',
    'OpenSky',
    'Google News',
    'TeleGeography',
  ]) {
    assert.equal(source.includes(forbidden), false, `selected-contact ident touched ${forbidden}`);
  }
  assert.ok(source.includes("layerId === 'ais-live-vessels'") || source.includes("'ais-live-vessels'"));
  assert.ok(source.includes('satellites'));
  const ui = await readFile(new URL('./ui.js', import.meta.url), 'utf8');
  assert.ok(ui.includes('initSelectedContactIdent'));
  assert.ok(ui.includes('destroySelectedContactIdent'));
  assert.equal(contactKindFromLayerId('flights'), 'aircraft');
  assert.equal(contactKindFromTrackedId('flights:abc123'), 'aircraft');
  assert.equal(contactKindFromTrackedId('satellites:25544'), 'satellite');
});

test('sync after a tracked-entity change shows then hides with the card', () => {
  const harness = installHarness();
  try {
    harness.viewer.trackedEntity = {
      gevTrackedId: 'flights:abc123',
      gevLabelModel: { title: 'UAL123 · FL350 · 451 kts' },
    };
    harness.setTrackedId('flights:abc123');
    harness.changed.raise();
    assert.equal(harness.root.hidden, false);
    assert.equal(harness.identButton.textContent, 'UAL123');

    harness.viewer.trackedEntity = null;
    harness.setTrackedId(null);
    harness.changed.raise();
    assert.equal(harness.root.hidden, true);
  } finally {
    harness.cleanup();
  }
});
