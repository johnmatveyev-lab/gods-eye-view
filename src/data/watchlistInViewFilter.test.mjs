// PLAN 198 — Watchlist In-view-only toggle. Client-only filter of pins
// already present in the current flights payload. Distinct from 182–197
// (not satellites / quakes / weather HUD / installations / radio / flights
// / AIS / CCTV / launches / FIRMS / local GeoJSON / traffic / bikes / ISS).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_WATCHLIST_IN_VIEW_ONLY,
  WATCHLIST_IN_VIEW_ONLY_CHIP_ID,
  WATCHLIST_IN_VIEW_ONLY_CHIP_LABEL,
  WATCHLIST_IN_VIEW_ONLY_CHIP_TITLE,
  WATCHLIST_IN_VIEW_ONLY_STORAGE_KEY,
  WATCHLIST_NONE_IN_VIEW,
  filterWatchlistByInView,
  getWatchlistInViewOnly,
  hydrateWatchlistInViewOnly,
  normalizeWatchlistInViewOnly,
  readWatchlistInViewOnly,
  resetWatchlistInViewOnlyForTest,
  setWatchlistInViewOnly,
  watchIdentMatchesInViewFilter,
  writeWatchlistInViewOnly,
} from './watchlistInViewFilter.js';
import {
  WATCHLIST_CAP,
  WATCHLIST_NOT_IN_VIEW,
  bindWatchlist,
  highlightedWatchIdents,
  renderWatchlist,
  resetWatchlistForTest,
  setWatchlist,
  shouldHighlightWatchIdent,
} from './watchlist.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

const DAL123 = Object.freeze({
  icao24: 'a00d23',
  callsign: 'DAL123',
  latitude: 33.64,
  longitude: -84.43,
});

const HEX_ONLY = Object.freeze({
  icao24: 'abcdef',
  callsign: null,
  lat: 40.64,
  lon: -73.78,
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
  const classes = new Set();
  const node = {
    tag,
    type: tag === 'button' ? 'button' : '',
    className: '',
    hidden: false,
    disabled: false,
    _text: '',
    title: '',
    pressed: 'false',
    dataset: {},
    children,
    attributes: new Map(),
    ownerDocument: null,
    parent: null,
    classList: {
      toggle(name, on) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
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
      if (selector === `#${WATCHLIST_IN_VIEW_ONLY_CHIP_ID}` && this.dataset.watchlistInView) {
        return this;
      }
      if (selector === '[data-watchlist-in-view]' && this.dataset.watchlistInView) {
        return this;
      }
      return children.find((child) => child.querySelector?.(selector))
        || children.find((child) => (
          (selector === `#${WATCHLIST_IN_VIEW_ONLY_CHIP_ID}` && child.dataset.watchlistInView)
          || (selector === '[data-watchlist-in-view]' && child.dataset.watchlistInView)
        ))
        || null;
    },
    get textContent() {
      if (children.length === 0) return this._text || '';
      return children.map((child) => child.textContent || '').join('');
    },
    set textContent(value) {
      this._text = String(value ?? '');
    },
    click() {
      listeners.get('click')?.({
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

test('In-view-only defaults off and matches the unfiltered watchlist', () => {
  assert.equal(DEFAULT_WATCHLIST_IN_VIEW_ONLY, false);
  assert.equal(WATCHLIST_IN_VIEW_ONLY_CHIP_LABEL, 'In-view-only');
  assert.equal(WATCHLIST_IN_VIEW_ONLY_CHIP_ID, 'watchlist-in-view-only');
  assert.equal(WATCHLIST_IN_VIEW_ONLY_CHIP_TITLE, 'Hide watched aircraft that are not in the current flights view');
  assert.equal(normalizeWatchlistInViewOnly(undefined), false);
  assert.equal(normalizeWatchlistInViewOnly(null), false);
  assert.equal(normalizeWatchlistInViewOnly(''), false);
  assert.equal(normalizeWatchlistInViewOnly(false), false);
  assert.equal(normalizeWatchlistInViewOnly('bogus'), false);
  assert.equal(normalizeWatchlistInViewOnly(true), true);
  assert.equal(normalizeWatchlistInViewOnly('1'), true);
  assert.equal(normalizeWatchlistInViewOnly('true'), true);
  const list = ['DAL123', 'ABCDEF'];
  assert.deepEqual(filterWatchlistByInView(list, ['DAL123'], false), list);
  assert.deepEqual(filterWatchlistByInView(null, ['DAL123'], true), []);
});

test('a watched DAL123 in the payload stays; a watched hex absent from the payload hides when on', () => {
  const list = ['DAL123', 'ABCDEF'];
  const payload = [DAL123];
  const inView = highlightedWatchIdents(list, payload);
  assert.deepEqual(inView, ['DAL123']);
  assert.equal(shouldHighlightWatchIdent('DAL123', payload), true);
  assert.equal(shouldHighlightWatchIdent('ABCDEF', payload), false);
  assert.equal(watchIdentMatchesInViewFilter('DAL123', inView, true), true);
  assert.equal(watchIdentMatchesInViewFilter('ABCDEF', inView, true), false);
  assert.equal(watchIdentMatchesInViewFilter('ABCDEF', inView, false), true);
  assert.deepEqual(filterWatchlistByInView(list, inView, true), ['DAL123']);
  assert.ok(!filterWatchlistByInView(list, inView, true).includes('ABCDEF'));
});

test('off restores the missing hex as a not-in-view row', () => {
  const doc = fakeDocument();
  const items = fakeNode('div');
  items.ownerDocument = doc;
  const list = ['DAL123', 'ABCDEF'];
  const payload = [DAL123];

  renderWatchlist(items, list, payload, true);
  assert.equal(items.children.length, 1);
  assert.equal(items.children[0].dataset.watchIdent, 'DAL123');
  assert.doesNotMatch(items.children[0].textContent, /not in view/);
  assert.doesNotMatch(items.textContent, /33\.64|-84\.43/);

  renderWatchlist(items, list, payload, false);
  assert.equal(items.children.length, 2);
  assert.equal(items.children[0].dataset.watchIdent, 'DAL123');
  assert.equal(items.children[1].dataset.watchIdent, 'ABCDEF');
  assert.match(items.children[1].textContent, new RegExp(WATCHLIST_NOT_IN_VIEW));
  assert.doesNotMatch(items.children[1].textContent, /33\.64|-84\.43|40\.64|-73\.78/);
});

test('meridian.watchlistInViewOnly persists and reload keeps the choice', () => {
  resetWatchlistInViewOnlyForTest();
  const storage = memoryStorage();
  assert.equal(WATCHLIST_IN_VIEW_ONLY_STORAGE_KEY, 'meridian.watchlistInViewOnly');
  assert.equal(readWatchlistInViewOnly(storage), DEFAULT_WATCHLIST_IN_VIEW_ONLY);
  assert.equal(setWatchlistInViewOnly(true, { storage }), true);
  assert.equal(storage.getItem(WATCHLIST_IN_VIEW_ONLY_STORAGE_KEY), '1');
  assert.equal(getWatchlistInViewOnly(), true);
  assert.equal(writeWatchlistInViewOnly(true, storage), true);

  resetWatchlistInViewOnlyForTest();
  assert.equal(getWatchlistInViewOnly(), DEFAULT_WATCHLIST_IN_VIEW_ONLY);
  assert.equal(hydrateWatchlistInViewOnly(storage), true);
  assert.equal(getWatchlistInViewOnly(), true);
  writeWatchlistInViewOnly(DEFAULT_WATCHLIST_IN_VIEW_ONLY, storage);
  assert.equal(storage.getItem(WATCHLIST_IN_VIEW_ONLY_STORAGE_KEY), '0');
  resetWatchlistInViewOnlyForTest();
});

test('panel off hides the toggle; refresh keeps In-view-only on the already-fetched payload', () => {
  resetWatchlistForTest();
  const doc = fakeDocument();
  const items = fakeNode('div');
  items.ownerDocument = doc;
  const panel = fakeNode('aside');
  panel.hidden = true;
  const inViewToggle = fakeNode('button');
  inViewToggle.dataset.watchlistInView = 'only';
  inViewToggle.hidden = true;
  inViewToggle.textContent = WATCHLIST_IN_VIEW_ONLY_CHIP_LABEL;
  const watchToggle = fakeNode('button');
  const storage = memoryStorage();
  setWatchlist(['DAL123', 'ABCDEF'], { persist: false });
  let payload = [DAL123, HEX_ONLY];

  const binder = bindWatchlist({
    toggle: watchToggle,
    panel,
    items,
    inViewToggle,
    getFlights: () => payload,
    storage,
  });

  assert.equal(inViewToggle.hidden, true, 'closed panel hides the In-view-only toggle');
  assert.equal(getWatchlistInViewOnly(), false);
  assert.equal(items.children.length, 2);

  watchToggle.click();
  assert.equal(panel.hidden, false);
  assert.equal(inViewToggle.hidden, false, 'open panel shows the toggle');

  inViewToggle.click();
  assert.equal(getWatchlistInViewOnly(), true);
  assert.equal(storage.getItem(WATCHLIST_IN_VIEW_ONLY_STORAGE_KEY), '1');
  assert.equal(inViewToggle.pressed, 'true');
  assert.deepEqual(
    items.children.map((row) => row.dataset.watchIdent),
    ['DAL123', 'ABCDEF'],
  );

  payload = [DAL123];
  binder.refresh();
  assert.equal(getWatchlistInViewOnly(), true, 'refresh keeps the toggle');
  assert.equal(inViewToggle.hidden, false);
  assert.equal(inViewToggle.pressed, 'true');
  assert.equal(items.children.length, 1);
  assert.equal(items.children[0].dataset.watchIdent, 'DAL123');
  assert.doesNotMatch(items.textContent, /ABCDEF|not in view/);

  payload = [];
  binder.refresh();
  assert.equal(getWatchlistInViewOnly(), true);
  assert.equal(items.children[0].className, 'watchlist-empty');
  assert.equal(items.textContent, WATCHLIST_NONE_IN_VIEW);

  inViewToggle.click();
  assert.equal(getWatchlistInViewOnly(), false);
  assert.equal(items.children.length, 2);
  assert.match(items.children[0].textContent, new RegExp(WATCHLIST_NOT_IN_VIEW));
  assert.match(items.children[1].textContent, new RegExp(WATCHLIST_NOT_IN_VIEW));

  watchToggle.click();
  assert.equal(panel.hidden, true);
  assert.equal(inViewToggle.hidden, true, 'closing the panel hides the toggle again');
  binder.destroy();
  resetWatchlistForTest();
});

test('In-view-only does not change the 10-ident cap or invent a position', () => {
  assert.equal(WATCHLIST_CAP, 10);
  const helper = src('src/data/watchlistInViewFilter.js');
  const watchlist = src('src/data/watchlist.js');
  assert.match(watchlist, /WATCHLIST_CAP = 10/);
  assert.match(watchlist, /highlightedWatchIdents/);
  assert.match(watchlist, /filterWatchlistByInView/);
  assert.doesNotMatch(helper, /latitude|longitude|flyTo|Cartesian3/);
  assert.doesNotMatch(helper, /\/api\//);
});

test('watchlist chrome ships In-view-only inside the panel; flights.js stays untouched', () => {
  const html = src('index.html');
  const css = src('style.css');
  const flights = src('src/data/flights.js');
  const ui = src('src/ui.js');
  const helper = src('src/data/watchlistInViewFilter.js');
  const watchlist = src('src/data/watchlist.js');
  const panel = html.match(/<aside id="watchlist-panel"[\s\S]*?<\/aside>/);
  assert.ok(panel, 'watchlist panel markup is missing');
  assert.match(panel[0], /id="watchlist-in-view-only"/);
  assert.match(panel[0], /data-watchlist-in-view="only"/);
  assert.match(panel[0], />In-view-only</);
  assert.match(panel[0], /id="watchlist-items"/);
  assert.ok(
    panel[0].indexOf('id="watchlist-in-view-only"') < panel[0].indexOf('id="watchlist-items"'),
    'In-view-only sits in the panel header, hidden when the panel is off',
  );
  assert.match(css, /watchlist-in-view-chip/);
  assert.match(watchlist, /hydrateWatchlistInViewOnly|setWatchlistInViewOnly/);
  assert.doesNotMatch(ui, /watchlist-in-view-only|watchlistInViewOnly/);
  assert.doesNotMatch(flights, /watchlistInView|inViewOnly|highlightedWatchIdents/);
  assert.doesNotMatch(helper, /\/api\//);
  assert.doesNotMatch(helper, /OpenSky|Google News|TeleGeography|quantum-earth/i);
  assert.equal(existsSync(path.join(ROOT, 'api/watchlist/in-view.js')), false);
  assert.doesNotMatch(src('src/sharelink.js'), /meridian\.watchlistInViewOnly/);
});

test('legal pins stay on public aircraft idents and the existing flights payload', () => {
  const license = src('LICENSE');
  const readme = src('README.md');
  const html = src('index.html');
  const helper = src('src/data/watchlistInViewFilter.js');
  assert.match(license, /Copyright \(c\) 2026 Bilawal Sidhu/);
  assert.match(readme, /# Meridian/);
  assert.match(readme, /Watch list/);
  assert.doesNotMatch(readme, /quantum-earth/);
  assert.match(html, /<title>Meridian<\/title>/);
  assert.doesNotMatch(helper, /OpenSky|Google News|TeleGeography|quantum-earth|person-search/i);
});
