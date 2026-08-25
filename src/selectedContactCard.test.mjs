import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SELECTED_CONTACT_CARD_COPY_ID,
  contactCardFieldsFromContext,
  copiedCardToast,
  copySelectedContactCard,
  formatContactCardLatLon,
  formatSelectedContactCard,
  presentCardField,
} from './selectedContactCard.js';
import {
  SELECTED_CONTACT_IDENT_COPY_ID,
  SELECTED_CONTACT_IDENT_ROOT_ID,
  SELECTED_CONTACT_IDENT_VALUE_ID,
  copySelectedContactIdent,
  destroySelectedContactIdent,
  initSelectedContactIdent,
} from './selectedContactIdent.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class MockButton {
  constructor(id) {
    this.id = id;
    this.textContent = '';
    this.title = '';
    this.disabled = false;
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
    if (this.disabled) return undefined;
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
    if (name === 'disabled') this.disabled = true;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'disabled') this.disabled = false;
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

function flightContext(overrides = {}) {
  return {
    layerId: 'flights',
    id: 'abc123',
    label: 'UAL123',
    latitude: 30.2672,
    longitude: -97.7431,
    properties: {
      callsign: 'UAL123',
      registration: 'N12345',
      icao24: 'abc123',
      type: 'Boeing 737-800',
      altitude: '35,000 ft',
      speed: '451 kt',
      heading: '270°',
      route: 'SFO → JFK',
      operator: 'United',
      status: 'live',
    },
    ...overrides,
    properties: {
      callsign: 'UAL123',
      registration: 'N12345',
      icao24: 'abc123',
      type: 'Boeing 737-800',
      altitude: '35,000 ft',
      speed: '451 kt',
      heading: '270°',
      route: 'SFO → JFK',
      operator: 'United',
      status: 'live',
      ...(overrides.properties || {}),
    },
  };
}

function militaryContext(overrides = {}) {
  return flightContext({
    layerId: 'military',
    id: 'ae1fa4',
    label: 'RCH123',
    properties: {
      callsign: 'RCH123',
      registration: '04-8175',
      icao24: 'ae1fa4',
      type: 'C-17A',
      altitude: '28000 ft',
      speed: '420 kt',
      heading: '85°',
    },
    ...overrides,
    properties: {
      callsign: 'RCH123',
      registration: '04-8175',
      icao24: 'ae1fa4',
      type: 'C-17A',
      altitude: '28000 ft',
      speed: '420 kt',
      heading: '85°',
      ...(overrides.properties || {}),
    },
  });
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
  const cardButton = new MockButton(SELECTED_CONTACT_CARD_COPY_ID);
  cardButton.disabled = true;
  cardButton.setAttribute('disabled', '');
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
    cardButton,
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
    cardButton,
    host,
    setContext(next) { context = next; },
    cleanup() { destroySelectedContactIdent(); },
  };
}

test('presentCardField omits empty and unknown placeholders', () => {
  assert.equal(presentCardField('UAL123'), 'UAL123');
  assert.equal(presentCardField(''), '');
  assert.equal(presentCardField('  '), '');
  assert.equal(presentCardField(null), '');
  assert.equal(presentCardField('unknown'), '');
  assert.equal(presentCardField('Alt unknown'), '');
  assert.equal(presentCardField('n/a'), '');
  assert.equal(presentCardField('on ground'), 'on ground');
});

test('select a flight, Copy card pastes the visible describe() fields', () => {
  const text = formatSelectedContactCard(contactCardFieldsFromContext(
    flightContext(),
    'UAL123',
  ));
  assert.equal(text, [
    'Ident: UAL123',
    'Registration: N12345',
    'Hex: abc123',
    'Type: Boeing 737-800',
    'Alt: 35,000 ft',
    'Speed: 451 kt',
    'Heading: 270°',
    'Lat/Lon: 30.2672,-97.7431',
  ].join('\n'));
  assert.doesNotMatch(text, /SFO|JFK|United|news|unknown|live/i);
});

test('missing registration and speed are omitted, not unknown', () => {
  const text = formatSelectedContactCard({
    ident: 'UAL123',
    hex: 'abc123',
    type: 'A320',
    altitude: '12,000 ft',
    heading: '90°',
    registration: '',
    speed: 'unknown',
    latitude: 30.2672,
    longitude: -97.7431,
  });
  assert.equal(text, [
    'Ident: UAL123',
    'Hex: abc123',
    'Type: A320',
    'Alt: 12,000 ft',
    'Heading: 90°',
    'Lat/Lon: 30.2672,-97.7431',
  ].join('\n'));
  assert.doesNotMatch(text, /Registration:|Speed:|unknown/i);
});

test('military selection uses the same card shape', () => {
  const commercial = formatSelectedContactCard(contactCardFieldsFromContext(
    flightContext(),
    'UAL123',
  ));
  const military = formatSelectedContactCard(contactCardFieldsFromContext(
    militaryContext(),
    'RCH123',
  ));
  const labels = (text) => text.split('\n').map((line) => line.split(':')[0]);
  assert.deepEqual(labels(commercial), labels(military));
  assert.match(military, /^Ident: RCH123\nRegistration: 04-8175\nHex: ae1fa4\nType: C-17A\nAlt: 28000 ft\nSpeed: 420 kt\nHeading: 85°\nLat\/Lon: /);
  assert.doesNotMatch(military, /origin|destination|news|unknown/i);
});

test('card formatter ignores route, news, operator, and status even if supplied', () => {
  const text = formatSelectedContactCard({
    ident: 'UAL123',
    route: 'SFO → JFK',
    origin: 'SFO',
    destination: 'JFK',
    news: 'Airline in the news',
    operator: 'United',
    status: 'live',
  });
  assert.equal(text, 'Ident: UAL123');
});

test('lat/lon is omitted when either coordinate is missing', () => {
  assert.equal(formatContactCardLatLon(30.2672, Number.NaN), '');
  assert.equal(formatSelectedContactCard({ ident: 'UAL123', latitude: 30.2672 }), 'Ident: UAL123');
});

test('Copy card click writes the block; Copy ident still writes only the ident', async () => {
  const clipboardWrites = [];
  const toasts = [];
  const harness = installHarness({
    context: flightContext(),
    trackedId: 'flights:abc123',
    clipboardWrites,
    toasts,
  });
  try {
    assert.equal(harness.root.hidden, false);
    assert.equal(harness.cardButton.disabled, false);
    await harness.cardButton.click();
    assert.equal(clipboardWrites.length, 1);
    assert.match(clipboardWrites[0], /^Ident: UAL123\nRegistration: N12345\nHex: abc123/);
    assert.match(clipboardWrites[0], /Lat\/Lon: 30\.2672,-97\.7431$/);
    assert.doesNotMatch(clipboardWrites[0], /SFO|news|unknown/i);
    assert.deepEqual(toasts, ['Copied card']);

    clipboardWrites.length = 0;
    toasts.length = 0;
    await harness.copyButton.click();
    assert.deepEqual(clipboardWrites, ['UAL123']);
    assert.deepEqual(toasts, ['Copied UAL123']);

    clipboardWrites.length = 0;
    const identOk = await copySelectedContactIdent('UAL123', {
      clipboard: { writeText: async (text) => { clipboardWrites.push(text); } },
    });
    assert.equal(identOk, true);
    assert.deepEqual(clipboardWrites, ['UAL123']);
  } finally {
    harness.cleanup();
  }
});

test('deselect disables Copy card', async () => {
  const clipboardWrites = [];
  const harness = installHarness({
    context: flightContext(),
    trackedId: 'flights:abc123',
    clipboardWrites,
  });
  try {
    assert.equal(harness.cardButton.disabled, false);
    harness.setContext(null);
    harness.host.dispatchEvent(new CustomEvent('gev:entity-selection-cleared', {
      detail: { layerId: 'flights' },
    }));
    assert.equal(harness.root.hidden, true);
    assert.equal(harness.cardButton.disabled, true);
    await harness.cardButton.click();
    assert.deepEqual(clipboardWrites, []);
  } finally {
    harness.cleanup();
  }
});

test('no selection leaves Copy card disabled', () => {
  const harness = installHarness();
  try {
    assert.equal(harness.root.hidden, true);
    assert.equal(harness.cardButton.disabled, true);
  } finally {
    harness.cleanup();
  }
});

test('copySelectedContactCard writes formatted text via writeText only', async () => {
  const writes = [];
  const toasts = [];
  const ok = await copySelectedContactCard({
    ident: 'UAL123',
    hex: 'abc123',
  }, {
    clipboard: { writeText: async (text) => { writes.push(text); } },
    showToast: (text) => toasts.push(text),
  });
  assert.equal(ok, true);
  assert.deepEqual(writes, ['Ident: UAL123\nHex: abc123']);
  assert.deepEqual(toasts, [copiedCardToast()]);
  assert.equal(copiedCardToast(), 'Copied card');
});

test('Copy card chrome sits next to Copy ident; no new /api and no forbidden sources', async () => {
  const source = await readFile(new URL('./selectedContactCard.js', import.meta.url), 'utf8');
  const ident = await readFile(new URL('./selectedContactIdent.js', import.meta.url), 'utf8');
  const markup = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const ui = await readFile(new URL('./ui.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');

  assert.match(markup, /<title>Meridian<\/title>/);
  assert.match(markup, /id="selected-contact-ident-copy"[^>]*aria-label="Copy ident"/);
  assert.match(markup, /id="selected-contact-card-copy"[^>]*aria-label="Copy card"/);
  assert.match(markup, /id="selected-contact-ident-copy"[\s\S]*id="selected-contact-card-copy"/);
  assert.match(css, /\.selected-contact-card-copy:disabled/);
  assert.ok(ident.includes("from './selectedContactCard.js'"));
  assert.ok(ident.includes('SELECTED_CONTACT_CARD_COPY_ID'));
  assert.ok(ui.includes('initSelectedContactIdent'));

  const apiFiles = readdirSync(path.join(ROOT, 'api'), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  assert.equal(apiFiles.includes('selected-contact-card.js'), false);
  assert.equal(apiFiles.includes('copy-card.js'), false);

  for (const text of [source, ident]) {
    for (const forbidden of [
      'OpenSky',
      'Google News',
      'TeleGeography',
      'quantum-earth',
      "fetch '",
      'fetch(',
      '/api/',
      'person-search',
      'God\'s Eye View',
    ]) {
      assert.equal(text.includes(forbidden), false, `copy card touched ${forbidden}`);
    }
  }
});
