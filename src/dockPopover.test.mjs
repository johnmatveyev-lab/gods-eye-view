import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  focusLocationSearch,
  isLocationTrayInteractive,
  locationTrayControls,
  syncLocationDockPopover,
} from './dockPopover.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'style.css'), 'utf8');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const ui = readFileSync(join(ROOT, 'src', 'ui.js'), 'utf8');
const license = readFileSync(join(ROOT, 'LICENSE'), 'utf8');

function styleBag(initial = {}) {
  const values = { ...initial };
  return {
    get visibility() { return values.visibility ?? ''; },
    set visibility(value) { values.visibility = value; },
    get pointerEvents() { return values['pointer-events'] ?? ''; },
    set pointerEvents(value) { values['pointer-events'] = value; },
    get display() { return values.display ?? ''; },
    set display(value) { values.display = value; },
    setProperty(name, value) { values[name] = value; },
    removeProperty(name) { delete values[name]; },
    getPropertyValue(name) { return values[name] ?? ''; },
  };
}

function mockComputedStyle(el) {
  const own = el.style || styleBag();
  const parentStyle = el.parent?.style;
  return {
    visibility: own.getPropertyValue('visibility') || parentStyle?.getPropertyValue('visibility') || 'visible',
    pointerEvents: own.getPropertyValue('pointer-events') || parentStyle?.getPropertyValue('pointer-events') || 'auto',
    display: own.getPropertyValue('display') || parentStyle?.getPropertyValue('display') || 'flex',
    getPropertyValue(name) {
      if (name === 'visibility') return this.visibility;
      if (name === 'pointer-events') return this.pointerEvents;
      if (name === 'display') return this.display;
      return '';
    },
  };
}

function makeLocationPanel({ pillCount = 8 } = {}) {
  const listeners = new Map();
  const popover = {
    className: 'dock-popover-content',
    style: styleBag({ visibility: 'hidden', 'pointer-events': 'none' }),
    parent: null,
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) || []).filter((fn) => fn !== handler));
    },
    emit(type, event) {
      for (const handler of listeners.get(type) || []) handler(event);
    },
  };

  const cityRow = {
    className: 'location-city-row',
    style: styleBag({ display: 'none' }),
    parent: popover,
  };

  const pills = Array.from({ length: pillCount }, (_, index) => {
    const clicks = [];
    const pill = {
      tagName: 'BUTTON',
      className: 'location-pill',
      dataset: { locationId: `city-${index}` },
      style: styleBag({ visibility: 'hidden', 'pointer-events': 'none' }),
      parent: cityRow,
      clicks,
      addEventListener(type, handler) {
        if (type === 'click') clicks.push(handler);
      },
      click() {
        const computed = mockComputedStyle(pill);
        const rect = pill.getBoundingClientRect();
        if (computed.visibility === 'hidden' || computed.pointerEvents === 'none') return;
        if (rect.width <= 0 || rect.height <= 0) return;
        for (const handler of clicks) handler();
      },
      getBoundingClientRect() {
        const laidOut = cityRow.style.getPropertyValue('display') !== 'none'
          && popover.style.getPropertyValue('visibility') === 'visible'
          && popover.style.getPropertyValue('pointer-events') === 'auto';
        return laidOut
          ? { width: 72, height: 28, top: 20, left: 40 + index * 80, right: 112 + index * 80, bottom: 48 }
          : { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
      },
    };
    return pill;
  });

  const search = {
    id: 'location-search',
    tagName: 'INPUT',
    className: '',
    classList: {
      tokens: new Set(),
      add(name) { this.tokens.add(name); },
      contains(name) { return this.tokens.has(name); },
    },
    style: styleBag({ visibility: 'hidden', 'pointer-events': 'none' }),
    parent: cityRow,
    focused: false,
    focus({ preventScroll } = {}) {
      this.focused = true;
      this.preventScroll = preventScroll;
    },
    getBoundingClientRect() {
      const laidOut = cityRow.style.getPropertyValue('display') !== 'none'
        && popover.style.getPropertyValue('visibility') === 'visible'
        && popover.style.getPropertyValue('pointer-events') === 'auto';
      return laidOut
        ? { width: 160, height: 28, top: 20, left: 8, right: 168, bottom: 48 }
        : { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
    },
  };

  cityRow.querySelectorAll = (selector) => {
    if (selector === 'button.location-pill' || selector === '.location-pill') return pills;
    return [];
  };
  cityRow.querySelector = (selector) => {
    if (selector === '#location-search') return search;
    return null;
  };

  popover.querySelectorAll = (selector) => cityRow.querySelectorAll(selector);
  popover.querySelector = (selector) => {
    if (selector === '.location-city-row') return cityRow;
    return cityRow.querySelector(selector);
  };

  const panel = {
    id: 'location-bar',
    className: 'collapsed',
    classList: {
      tokens: new Set(['collapsed']),
      contains(name) { return this.tokens.has(name); },
      toggle(name, force) {
        if (force === true) this.tokens.add(name);
        else if (force === false) this.tokens.delete(name);
        else if (this.tokens.has(name)) this.tokens.delete(name);
        else this.tokens.add(name);
        panel.className = [...this.tokens].join(' ');
      },
    },
    querySelector(selector) {
      if (selector === '.dock-popover-content') return popover;
      if (selector === '.location-city-row') return cityRow;
      if (selector === '#location-search') return search;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'button.location-pill') return pills;
      return [];
    },
  };
  popover.parent = panel;
  return { panel, popover, cityRow, pills, search };
}

test('open LOCATION makes pills and search hittable immediately', () => {
  const { panel, pills, search } = makeLocationPanel();
  assert.equal(locationTrayControls(panel).length, 9);
  assert.equal(isLocationTrayInteractive(panel, { getComputedStyle: mockComputedStyle }), false);
  assert.deepEqual(pills[0].getBoundingClientRect(), {
    width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0,
  });

  const result = syncLocationDockPopover(panel, {
    open: true,
    getComputedStyle: mockComputedStyle,
  });

  assert.equal(result.open, true, 'non-zero boxes are required before treating the tray as open');
  assert.equal(result.interactive, true);
  assert.equal(isLocationTrayInteractive(panel, { getComputedStyle: mockComputedStyle }), true);

  for (const control of [...pills, search]) {
    const rect = control.getBoundingClientRect();
    assert.ok(rect.width > 0 && rect.height > 0, `${control.className || control.id} must have a box on open`);
    const style = mockComputedStyle(control);
    assert.equal(style.visibility, 'visible');
    assert.equal(style.pointerEvents, 'auto');
  }
});

test('the search field is focused on LOCATION open', () => {
  const { panel, search } = makeLocationPanel();
  syncLocationDockPopover(panel, { open: true, getComputedStyle: mockComputedStyle });
  assert.equal(search.focused, true);
  assert.equal(search.classList.contains('expanded'), true);
  assert.equal(focusLocationSearch(panel), true);
});

test('clicking a city pill after open reaches the fly helper', () => {
  const { panel, pills } = makeLocationPanel();
  const flights = [];
  pills[2].addEventListener('click', () => flights.push('nyc'));

  pills[2].click();
  assert.deepEqual(flights, [], 'a dead pill must not fly before open');

  syncLocationDockPopover(panel, { open: true, getComputedStyle: mockComputedStyle });
  pills[2].click();
  assert.deepEqual(flights, ['nyc']);
  assert.match(ui, /_onCityPillClick\(cityId\) \{[\s\S]*?flyToPresetLocation\(this\.viewer, cityId/);
});

test('close keeps the tray painted until transitionend, then hides it', () => {
  const { panel, popover, pills, search, cityRow } = makeLocationPanel();
  syncLocationDockPopover(panel, { open: true, getComputedStyle: mockComputedStyle });

  syncLocationDockPopover(panel, { open: false, getComputedStyle: mockComputedStyle });
  assert.equal(popover.style.getPropertyValue('pointer-events'), 'none');
  assert.equal(popover.style.getPropertyValue('visibility'), 'visible',
    'visibility stays visible during the close transition');
  assert.equal(cityRow.style.getPropertyValue('display'), 'flex');

  popover.emit('transitionend', { propertyName: 'opacity', target: popover });
  assert.equal(popover.style.getPropertyValue('visibility'), 'hidden');
  assert.equal(pills[0].style.getPropertyValue('visibility'), 'hidden');
  assert.equal(search.style.getPropertyValue('pointer-events'), 'none');
  assert.equal(isLocationTrayInteractive(panel, { getComputedStyle: mockComputedStyle }), false);
});

test('setPanelCollapsed syncs the LOCATION tray on open and close', () => {
  assert.ok(ui.includes("from './dockPopover.js'"), 'ui.js must import the LOCATION tray helper');
  const method = ui.slice(ui.indexOf('setPanelCollapsed(panelId, collapsed, {'));
  assert.match(
    method,
    /panelEl\.classList\.toggle\('collapsed', nextCollapsed\)[\s\S]*?panelId === 'location-bar'[\s\S]*?syncLocationDockPopover\(panelEl/,
  );
});

test('LOCATION open does not invent APIs or cover credits, title, or the MIT line', () => {
  assert.ok(html.includes('<title>Meridian</title>'), 'title stays Meridian');
  assert.ok(license.includes('Copyright (c) 2026 Bilawal Sidhu'), 'MIT copyright stays 2026 Bilawal Sidhu');
  assert.ok(css.includes('#cesium-credits'), 'credits stay in the stylesheet');
  assert.equal(
    /#cesium-credits[^{]*\{[^}]*(visibility:\s*hidden|pointer-events:\s*none|display:\s*none)/.test(css),
    false,
    'the credit line must stay visible and clickable',
  );
  const popoverStart = css.indexOf('#command-dock .dock-popover-content {\n  position: absolute');
  assert.ok(popoverStart >= 0, 'the slide-up LOCATION tray rule must remain');
  const popoverBlock = css.slice(popoverStart, css.indexOf('#command-dock #location-bar:not(.collapsed)', popoverStart));
  assert.ok(/pointer-events:\s*none/.test(popoverBlock), 'the closed tray stays inert');
  assert.equal(
    /transition:[^;]*visibility/.test(popoverBlock),
    false,
    'visibility must not stay mid-transition after the LOCATION bar paints',
  );
  assert.equal(/OpenSky|Google News RSS|TeleGeography|quantum-earth/.test(ui), false);
  assert.equal(readFileSync(join(ROOT, 'src', 'dockPopover.js'), 'utf8').includes('/api/'), false);
});
