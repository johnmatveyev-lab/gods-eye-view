import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { labelBudgetFor } from './data/detectionPolicy.js';
import {
  CONTACT_LABELS_CHANGED_EVENT,
  CONTACT_LABELS_KEY,
  applyContactLabelShow,
  contactLabelsEnabledFromStoredValue,
  getContactLabelsEnabled,
  isProtectedIdentSurface,
  readContactLabelsEnabled,
  resetContactLabelsForTest,
  setContactLabelsEnabled,
  shouldPaintContactLabelText,
  writeContactLabelsEnabled,
} from './contactLabels.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    keys() {
      return [...map.keys()];
    },
  };
}

test('contact label preference defaults on and persists meridian.contactLabels', () => {
  resetContactLabelsForTest();
  const storage = memoryStorage();
  assert.equal(CONTACT_LABELS_KEY, 'meridian.contactLabels');
  assert.equal(readContactLabelsEnabled(storage), true);
  assert.equal(readContactLabelsEnabled(null), true);
  assert.equal(contactLabelsEnabledFromStoredValue(null), true);
  assert.equal(contactLabelsEnabledFromStoredValue(''), true);
  assert.equal(contactLabelsEnabledFromStoredValue('nope'), true);
  assert.equal(contactLabelsEnabledFromStoredValue('0'), false);
  assert.equal(contactLabelsEnabledFromStoredValue('off'), false);
  assert.equal(contactLabelsEnabledFromStoredValue('1'), true);

  assert.equal(getContactLabelsEnabled(storage), true);
  assert.equal(setContactLabelsEnabled(false, storage), false);
  assert.equal(storage.getItem(CONTACT_LABELS_KEY), '0');
  assert.equal(getContactLabelsEnabled(storage), false);
  assert.equal(setContactLabelsEnabled(true, storage), true);
  assert.equal(storage.getItem(CONTACT_LABELS_KEY), '1');
  assert.equal(writeContactLabelsEnabled(storage, false), true);
  resetContactLabelsForTest();
  assert.equal(readContactLabelsEnabled(storage), false);
  resetContactLabelsForTest();
});

test('toggling labels emits a display-only change event', () => {
  resetContactLabelsForTest();
  const storage = memoryStorage();
  const events = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };
  try {
    setContactLabelsEnabled(false, storage);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, CONTACT_LABELS_CHANGED_EVENT);
    assert.equal(events[0].detail.enabled, false);
    setContactLabelsEnabled(false, storage);
    assert.equal(events.length, 1, 'an unchanged write must not re-emit');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    resetContactLabelsForTest();
  }
});

test('existing label.show and skipLabel hide ambient text; selected ident stays', () => {
  assert.equal(isProtectedIdentSurface({ variant: 'selected' }), true);
  assert.equal(isProtectedIdentSurface({ variant: 'tracked' }), true);
  assert.equal(isProtectedIdentSurface({ selected: true, variant: 'label' }), true);
  assert.equal(isProtectedIdentSurface({ variant: 'label' }), false);

  const graphic = { label: { show: true, text: 'UAL123' } };
  assert.equal(applyContactLabelShow(graphic, false), true);
  assert.equal(graphic.label.show, false);
  assert.equal(applyContactLabelShow({ billboard: { show: true } }, false), false);
  assert.equal(applyContactLabelShow(null, false), false);

  assert.equal(shouldPaintContactLabelText({ skipLabel: true }, true), false);
  assert.equal(shouldPaintContactLabelText({ label: { show: false } }, true), false);
  assert.equal(shouldPaintContactLabelText({ source: 'flights' }, false), false);
  assert.equal(shouldPaintContactLabelText({ source: 'satellites', variant: 'label' }, false), false);
  assert.equal(shouldPaintContactLabelText({ source: 'satellites-iss', variant: 'label' }, false), false);
  assert.equal(
    shouldPaintContactLabelText({ source: 'flights', variant: 'selected', title: 'UAL123' }, false),
    true,
    'selected contact card keeps ident',
  );
  assert.equal(
    shouldPaintContactLabelText({ source: 'tracked', variant: 'tracked', title: 'UAL123' }, false),
    true,
  );
  assert.equal(
    shouldPaintContactLabelText({ source: 'local-firms', variant: 'card' }, false),
    true,
    'FIRMS/WX cards are not contact billboards',
  );
});

test('density budgets stay independent of the labels preference', () => {
  resetContactLabelsForTest();
  const storage = memoryStorage();
  const street50 = labelBudgetFor(800, 50);
  const street100 = labelBudgetFor(800, 100);
  assert.ok(street100 > street50, 'density still changes the detection label budget');
  setContactLabelsEnabled(false, storage);
  assert.equal(labelBudgetFor(800, 50), street50);
  assert.equal(labelBudgetFor(800, 100), street100);
  setContactLabelsEnabled(true, storage);
  assert.equal(labelBudgetFor(800, 50), street50);
  resetContactLabelsForTest();
});

test('contact label declutter is display-only and does not add an API', () => {
  const source = readFileSync(new URL('./contactLabels.js', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const detection = readFileSync(new URL('./data/detection.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\/api\//);
  assert.doesNotMatch(source, /opensky|google news|telegeography|quantum-earth/i);
  assert.doesNotMatch(source, /firstName|lastName|fullName|personName/);
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(html, /id="contact-labels-toggle"/);
  assert.match(html, /id="detection-density-slider"/);
  assert.match(ui, /CONTACT_LABELS_KEY|setContactLabelsEnabled/);
  assert.match(
    detection,
    /if \(obj\.skipLabel\) \{/,
    'detection must keep the existing skipLabel flag for tracked ident',
  );
  assert.match(
    detection,
    /if \(!getContactLabelsEnabled\(\)\) return;/,
    'labels off must skip the callout glyph lane only',
  );
  assert.match(
    detection,
    /appendCornerBracket\([\s\S]*?if \(obj\.skipLabel\)/,
    'brackets must still be drawn before the label gate',
  );
});
