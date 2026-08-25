// PLAN 46 — UTC | Local chrome clock. Display-only. Persist meridian.clock.
// Production today paints UTC with a trailing Z. Local uses the browser TZ
// and must not keep that Z. Share URLs, units, compass, and Home stay out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CLOCK_STORAGE_KEY,
  DEFAULT_CLOCK_MODE,
  bindClockToggle,
  formatChromeClock,
  formatHudClock,
  getClockMode,
  normalizeClockMode,
  readClockPreference,
  resetClockPreferenceCache,
  setClockMode,
  syncClockToggleButtons,
  writeClockPreference,
} from './clockPreference.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTANT = new Date('2026-08-25T15:30:45.000Z');

function pad2(value) {
  return String(value).padStart(2, '0');
}

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
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
  };
}

function fakeButton(mode, pressed = 'false') {
  return {
    dataset: { clockMode: mode },
    attrs: { 'aria-pressed': pressed },
    getAttribute(name) {
      return this.attrs[name];
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    closest(selector) {
      return selector === '[data-clock-mode]' ? this : null;
    },
  };
}

function fakeToggleRoot(buttons) {
  const listeners = new Map();
  return {
    buttons,
    contains(node) {
      return buttons.includes(node);
    },
    querySelectorAll(selector) {
      return selector === '[data-clock-mode]' ? buttons : [];
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    click(button) {
      listeners.get('click')?.({ target: button });
    },
  };
}

test('the stored key is meridian.clock and the default stays utc', () => {
  assert.equal(CLOCK_STORAGE_KEY, 'meridian.clock');
  assert.equal(DEFAULT_CLOCK_MODE, 'utc');
  assert.equal(normalizeClockMode('local'), 'local');
  assert.equal(normalizeClockMode('utc'), 'utc');
  assert.equal(normalizeClockMode('bogus'), 'utc');
  assert.equal(normalizeClockMode(null), 'utc');
});

test('empty or unreadable storage keeps the production UTC default', () => {
  resetClockPreferenceCache();
  assert.equal(readClockPreference(memoryStorage()), 'utc');
  assert.equal(readClockPreference(null), 'utc');
  assert.equal(readClockPreference({
    getItem() {
      throw new Error('blocked');
    },
  }), 'utc');
});

test('reload keeps a Local choice and writes utc|local only', () => {
  const storage = memoryStorage();
  assert.equal(writeClockPreference('local', storage), 'local');
  assert.equal(storage.getItem(CLOCK_STORAGE_KEY), 'local');
  resetClockPreferenceCache();
  assert.equal(readClockPreference(storage), 'local');

  assert.equal(writeClockPreference('UTC', storage), 'utc');
  assert.equal(storage.getItem(CLOCK_STORAGE_KEY), 'utc');
});

test('UTC chrome and HUD clocks keep the production Zulu strings', () => {
  assert.equal(formatChromeClock(INSTANT, 'utc'), '15:30:45Z');
  assert.equal(formatHudClock(INSTANT, 'utc'), '2026-08-25 15:30:45Z');
});

test('Local clocks use the browser timezone and drop Z', () => {
  const localChrome = formatChromeClock(INSTANT, 'local');
  const localHud = formatHudClock(INSTANT, 'local');
  const expectedTime = [
    pad2(INSTANT.getHours()),
    pad2(INSTANT.getMinutes()),
    pad2(INSTANT.getSeconds()),
  ].join(':');
  const expectedDate = [
    INSTANT.getFullYear(),
    pad2(INSTANT.getMonth() + 1),
    pad2(INSTANT.getDate()),
  ].join('-');

  assert.equal(localChrome, expectedTime);
  assert.doesNotMatch(localChrome, /Z/);
  assert.equal(localHud, `${expectedDate} ${expectedTime}`);
  assert.doesNotMatch(localHud, /Z/);
});

test('get/setClockMode persist through a cache reset the way a reload would', () => {
  const storage = memoryStorage();
  resetClockPreferenceCache();
  assert.equal(getClockMode(storage), 'utc');
  assert.equal(setClockMode('local', storage), 'local');
  resetClockPreferenceCache();
  assert.equal(getClockMode(storage), 'local');
});

test('the UTC | Local toggle paints pressed state and persists the click', () => {
  const storage = memoryStorage();
  resetClockPreferenceCache();
  const utc = fakeButton('utc', 'true');
  const local = fakeButton('local', 'false');
  const root = fakeToggleRoot([utc, local]);
  const seen = [];

  bindClockToggle(root, {
    storage,
    onChange: (mode) => seen.push(mode),
  });
  assert.equal(utc.getAttribute('aria-pressed'), 'true');
  assert.equal(local.getAttribute('aria-pressed'), 'false');

  root.click(local);
  assert.equal(getClockMode(storage), 'local');
  assert.equal(local.getAttribute('aria-pressed'), 'true');
  assert.equal(utc.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(seen, ['local']);

  syncClockToggleButtons(root, 'utc');
  assert.equal(utc.getAttribute('aria-pressed'), 'true');
  assert.equal(local.getAttribute('aria-pressed'), 'false');
});

test('Intel HUD and cockpit chrome host the toggle next to the existing clock', () => {
  const hud = readFileSync(new URL('./hud.js', import.meta.url), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  assert.match(hud, /import \{[^}]*formatHudClock[^}]*\} from '\.\/clockPreference\.js';/);
  assert.match(hud, /id="hud-timestamp"[\s\S]*?data-clock-mode="utc"[\s\S]*?UTC[\s\S]*?data-clock-mode="local"[\s\S]*?Local/);
  assert.match(hud, /el\.textContent = formatHudClock\(/);

  assert.match(html, /id="cockpit-clock"[\s\S]*?data-clock-mode="utc"[\s\S]*?UTC[\s\S]*?data-clock-mode="local"[\s\S]*?Local/);
  assert.match(ui, /import \{[^}]*formatChromeClock[^}]*\} from '\.\/clockPreference\.js';/);
  assert.match(ui, /this\.clock\.textContent = formatChromeClock\(/);
});

test('share URLs do not carry the clock preference', () => {
  const share = readFileSync(path.join(ROOT, 'src', 'sharelink.js'), 'utf8');
  assert.equal(share.includes('meridian.clock'), false, 'sharelink must not read meridian.clock');
  assert.doesNotMatch(share, /params\.set\('clock'/);
  assert.doesNotMatch(share, /params\.get\('clock'/);
});

test('Units, compass, and Home stay on their existing chrome', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');

  assert.match(html, /id="cockpit-speed-value"[\s\S]*?KTS/);
  assert.match(html, /id="cockpit-altitude-value"[\s\S]*?FT/);
  assert.match(html, /id="cockpit-compass-tape"/);
  assert.match(html, /id="reset-globe-view"[^>]*aria-label="Reset to full globe view"/);
  assert.match(html, /id="cockpit-reset-globe"[^>]*aria-label="Reset cockpit to full globe view"/);

  assert.doesNotMatch(ui, /this\.compassTape\.textContent = formatChromeClock/);
  assert.doesNotMatch(ui, /this\.speed\.textContent = formatChromeClock/);
  assert.doesNotMatch(ui, /this\.altitude\.textContent = formatChromeClock/);
  assert.match(ui, /this\._resetGlobeBtn/);
});
