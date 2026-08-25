import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';
import {
  WATCHLIST_CAP,
  WATCHLIST_NOT_IN_VIEW,
  WATCHLIST_STORAGE_KEY,
  addWatchIdent,
  bindWatchlist,
  highlightedWatchIdents,
  hydrateWatchlist,
  isWatchHighlighted,
  matchWatchIdentInPayload,
  normalizeWatchIdent,
  readWatchlist,
  removeWatchIdent,
  renderWatchlist,
  resetWatchlistForTest,
  resolveWatchRowClick,
  shouldHighlightWatchIdent,
  watchIdentFromContact,
  writeWatchlist,
} from './watchlist.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

const UAL123 = Object.freeze({
  icao24: 'a1b2c3',
  callsign: 'UAL123',
  latitude: 30.27,
  longitude: -97.74,
});

const HEX_ONLY = Object.freeze({
  icao24: 'def456',
  callsign: null,
  lat: 33.94,
  lon: -118.41,
});

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
    snapshot() {
      return Object.fromEntries(map);
    },
  };
}

function fakeNode(tag = 'div') {
  const children = [];
  const listeners = new Map();
  const node = {
    tag,
    type: tag === 'button' ? 'button' : '',
    className: '',
    hidden: false,
    disabled: false,
    textContent: '',
    title: '',
    dataset: {},
    children,
    attributes: new Map(),
    ownerDocument: null,
    parent: null,
    appendChild(child) {
      children.push(child);
      child.parent = this;
      return child;
    },
    replaceChildren(...next) {
      children.length = 0;
      for (const child of next) this.appendChild(child);
    },
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === 'hidden') this.hidden = true;
      if (name === 'aria-pressed') this.pressed = String(value);
    },
    removeAttribute(name) {
      this.attributes.delete(name);
      if (name === 'hidden') this.hidden = false;
    },
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    },
    closest(selector) {
      if (selector === '[data-watch-ident]' && this.dataset.watchIdent) return this;
      if (selector === '[data-watch-remove]' && this.dataset.watchRemove) return this;
      return this.parent?.closest?.(selector) || null;
    },
    querySelector(selector) {
      if (selector === '[data-watch-remove]') {
        return children.find((child) => child.dataset.watchRemove) || null;
      }
      return null;
    },
    click(ident, { remove = false } = {}) {
      const target = ident
        ? children.find((child) => child.dataset.watchIdent === ident)
        : children[0];
      if (!target) return;
      const eventTarget = remove
        ? (target.querySelector?.('[data-watch-remove]') || target)
        : target;
      listeners.get('click')?.({
        target: eventTarget,
        preventDefault() {},
        stopPropagation() {},
      });
    },
  };
  return node;
}

function fakeDocument() {
  const doc = {
    createElement(tag) {
      const node = fakeNode(tag);
      node.ownerDocument = doc;
      return node;
    },
  };
  return doc;
}

test('add UAL123 highlights when it is in the flights payload; remove drops the highlight', () => {
  resetWatchlistForTest();
  const payload = [UAL123, HEX_ONLY];
  const added = addWatchIdent([], 'UAL123');
  assert.equal(added.ok, true);
  assert.deepEqual(added.list, ['UAL123']);
  assert.equal(shouldHighlightWatchIdent('UAL123', payload), true);
  assert.deepEqual(highlightedWatchIdents(added.list, payload), ['UAL123']);
  assert.equal(isWatchHighlighted(UAL123, added.list), true);
  assert.equal(isWatchHighlighted(HEX_ONLY, added.list), false);

  const removed = removeWatchIdent(added.list, 'UAL123');
  assert.deepEqual(removed.list, []);
  assert.deepEqual(highlightedWatchIdents(removed.list, payload), []);
  assert.equal(isWatchHighlighted(UAL123, removed.list), false);
  assert.equal(shouldHighlightWatchIdent('UAL123', payload), true);
});

test('watchlist caps at 10; the 11th ident is rejected', () => {
  let list = [];
  for (let index = 0; index < WATCHLIST_CAP; index += 1) {
    const result = addWatchIdent(list, `ID${index}`);
    assert.equal(result.ok, true, `ident ${index} should be accepted`);
    list = result.list;
  }
  assert.equal(list.length, 10);
  assert.equal(WATCHLIST_CAP, 10);

  const eleventh = addWatchIdent(list, 'UAL123');
  assert.equal(eleventh.ok, false);
  assert.equal(eleventh.reason, 'full');
  assert.equal(eleventh.list.length, 10);
  assert.equal(eleventh.list.includes('UAL123'), false);
});

test('empty or not-in-view watch row does not invent a position', () => {
  const missing = resolveWatchRowClick('UAL123', []);
  assert.equal(missing.action, 'not-in-view');
  assert.equal(missing.message, WATCHLIST_NOT_IN_VIEW);
  assert.equal(missing.position, null);
  assert.equal(missing.icao24, null);
  assert.equal(missing.latitude, undefined);
  assert.equal(missing.longitude, undefined);

  const emptyIdent = resolveWatchRowClick('', [UAL123]);
  assert.equal(emptyIdent.action, 'not-in-view');
  assert.equal(emptyIdent.position, null);
  assert.equal(emptyIdent.icao24, null);

  const blankPayload = resolveWatchRowClick('UAL123', [{
    icao24: 'a1b2c3',
    callsign: 'UAL123',
  }]);
  assert.equal(blankPayload.action, 'track');
  assert.equal(blankPayload.icao24, 'a1b2c3');
  assert.equal(blankPayload.position, null);

  const present = resolveWatchRowClick('UAL123', [UAL123]);
  assert.equal(present.action, 'track');
  assert.equal(present.icao24, 'a1b2c3');
  assert.deepEqual(present.position, { latitude: 30.27, longitude: -97.74 });
});

test('watch idents come from the selected aircraft callsign or hex only', () => {
  assert.equal(normalizeWatchIdent('  ual123  '), 'UAL123');
  assert.equal(watchIdentFromContact({
    kind: 'aircraft',
    callsign: 'UAL123',
    icao24: 'a1b2c3',
  }), 'UAL123');
  assert.equal(watchIdentFromContact({
    kind: 'aircraft',
    icao24: 'a1b2c3',
  }), 'A1B2C3');
  assert.equal(watchIdentFromContact({
    kind: 'aircraft',
    hex: 'def456',
  }), 'DEF456');
  assert.equal(watchIdentFromContact({
    kind: 'vessel',
    name: 'EVER GIVEN',
    callsign: 'UAL123',
  }), '');
  assert.equal(watchIdentFromContact({
    kind: 'satellite',
    name: 'ISS',
    icao24: 'a1b2c3',
  }), '');
  assert.equal(watchIdentFromContact({
    kind: 'aircraft',
    name: 'John Smith',
  }), '');
});

test('payload match is exact callsign or hex; hex wins a colliding callsign', () => {
  const flights = [
    { icao24: 'aa0001', callsign: 'UAL999' },
    { icao24: 'ual123', callsign: 'N1' },
    UAL123,
  ];
  assert.equal(matchWatchIdentInPayload('UAL999', flights)?.icao24, 'aa0001');
  assert.equal(matchWatchIdentInPayload('a1b2c3', flights)?.callsign, 'UAL123');
  assert.equal(matchWatchIdentInPayload('UAL123', flights)?.icao24, 'ual123');
  assert.equal(matchWatchIdentInPayload('UAL', flights), null);
  assert.equal(matchWatchIdentInPayload('N1AB', flights), null);
});

test('meridian.watchlist persists and reload keeps the idents', () => {
  resetWatchlistForTest();
  assert.equal(WATCHLIST_STORAGE_KEY, 'meridian.watchlist');
  const storage = memoryStorage();
  const written = writeWatchlist(['UAL123', 'DEF456'], storage);
  assert.deepEqual(written, ['UAL123', 'DEF456']);
  assert.equal(storage.getItem(WATCHLIST_STORAGE_KEY), JSON.stringify(['UAL123', 'DEF456']));
  assert.deepEqual(readWatchlist(storage), ['UAL123', 'DEF456']);

  resetWatchlistForTest();
  const hydrated = hydrateWatchlist(storage);
  assert.deepEqual(hydrated, ['UAL123', 'DEF456']);
  assert.equal(isWatchHighlighted(UAL123), true);
});

test('click an in-view row tracks the payload id; a missing row stays not in view', () => {
  const doc = fakeDocument();
  const items = fakeNode('div');
  items.ownerDocument = doc;
  const tracks = [];
  const toasts = [];
  let payload = [UAL123];
  const binder = bindWatchlist({
    items,
    getFlights: () => payload,
    trackById: (icao24) => {
      tracks.push(icao24);
      return true;
    },
    showToast: (text) => toasts.push(text),
    flyTo() {
      throw new Error('watch click must not invent a fly-to');
    },
  });

  renderWatchlist(items, ['UAL123', 'ZZZ999'], payload);
  assert.equal(items.children[0].dataset.watchIdent, 'UAL123');
  assert.match(items.children[0].textContent, /UAL123/);
  assert.doesNotMatch(items.children[0].textContent, /30\.27|-97\.74/);
  items.click('UAL123');
  assert.deepEqual(tracks, ['a1b2c3']);
  assert.deepEqual(toasts, []);

  items.click('ZZZ999');
  assert.deepEqual(tracks, ['a1b2c3']);
  assert.deepEqual(toasts, [WATCHLIST_NOT_IN_VIEW]);

  payload = [];
  items.click('UAL123');
  assert.deepEqual(tracks, ['a1b2c3']);
  assert.deepEqual(toasts, [WATCHLIST_NOT_IN_VIEW, WATCHLIST_NOT_IN_VIEW]);
  binder.destroy();
});

test('hosted Watch chrome adds from the selected card and removes from the list', () => {
  const html = src('index.html');
  const ui = src('src/ui.js');
  const css = src('style.css');
  const moduleSrc = src('src/data/watchlist.js');

  assert.match(html, /id="watchlist-toggle"/);
  assert.match(html, /id="watchlist-panel"/);
  assert.match(html, /id="watchlist-items"/);
  assert.match(html, /id="selected-contact-ident-watch"/);
  assert.match(html, /aria-label="Watch ident"/);
  assert.match(html, />WATCH</);

  const topCenter = html.match(/<nav id="top-center-actions"[\s\S]*?<\/nav>/);
  assert.ok(topCenter, 'top-center chrome is missing');
  assert.match(topCenter[0], /id="watchlist-toggle"/);

  assert.match(ui, /bindWatchlist\(/);
  assert.match(ui, /hydrateWatchlist\(/);
  assert.match(ui, /watchIdentFromContact\(/);
  assert.match(ui, /getElementById\('watchlist-toggle'\)/);
  assert.match(ui, /getElementById\('selected-contact-ident-watch'\)/);
  assert.match(css, /#watchlist-toggle/);
  assert.match(css, /#watchlist-panel/);
  assert.match(css, /#selected-contact-ident-watch/);
  assert.match(moduleSrc, /meridian\.watchlist/);
  assert.match(moduleSrc, /WATCHLIST_CAP = 10/);
});

test('legal pins stay on public aircraft idents and the existing adsb.lol flights payload', () => {
  const license = src('LICENSE');
  const readme = src('README.md');
  const flights = src('src/data/flights.js');
  const moduleSrc = src('src/data/watchlist.js');
  const ui = src('src/ui.js');
  const html = src('index.html');

  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.match(readme, /Watch list/);
  assert.doesNotMatch(readme, /quantum-earth/);
  assert.match(html, /<title>Meridian<\/title>/);
  assert.match(flights, /adsb\.lol/);
  assert.match(flights, /isWatchHighlighted/);
  assert.doesNotMatch(moduleSrc, /\/api\//);
  assert.doesNotMatch(moduleSrc, /OpenSky|Google News|TeleGeography|quantum-earth|person-search|passenger|named person/i);
  assert.doesNotMatch(ui, /\/api\/watch/);
  assert.doesNotMatch(html, /OpenSky|Google News|TeleGeography|quantum-earth/i);
  assert.doesNotMatch(src('src/sharelink.js'), /meridian\.watchlist/);
});
