import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  BANNED_LAYER_LIST_ALIAS_RE,
  BANNED_LAYER_LIST_IDS,
  LAYER_LIST_ALIASES,
  VOICE_LAYER_ALIASES,
} from './layerAliases.js';
import {
  applyLayerListFilter,
  filterVisibleLayers,
  layerMatchesFilter,
} from './layerListFilter.js';
import { DataLayerManager } from './manager.js';
import { createTeleGeographySubmarineCableLayer } from './telegeographySubmarineCables.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Shipped toggle-panel layers. Names and ids are the live module strings. */
const LEGAL_TOGGLE_LAYERS = Object.freeze([
  { id: 'flights', name: 'Live Flights' },
  { id: 'military', name: 'Military Flights' },
  { id: 'earthquakes', name: 'Earthquakes (24h)' },
  { id: 'satellites', name: 'Satellites' },
  { id: 'rocket-launches', name: 'Space Missions (30d)' },
  { id: 'traffic', name: 'Street Traffic' },
  { id: 'cctv', name: 'CCTV' },
  { id: 'radio', name: 'Radio' },
  { id: 'bikeshare', name: 'Bikeshare' },
  { id: 'ais-live-vessels', name: 'Live AIS Vessels' },
  { id: 'military-installations', name: 'Mapped Installations' },
  { id: 'local-datacenters', name: 'Datacenters' },
  { id: 'local-dams', name: 'Dams' },
  { id: 'local-firms', name: 'FIRMS Active Fires' },
]);

const LAYER_NAME_SOURCES = Object.freeze([
  ['src/data/flights.js', /id:\s*'flights'/, /name:\s*'Live Flights'/],
  ['src/data/militaryFlights.js', /id:\s*'military'/, /name:\s*'Military Flights'/],
  ['src/data/earthquakes.js', /id:\s*'earthquakes'/, /name:\s*'Earthquakes \(24h\)'/],
  ['src/data/satellites.js', /id:\s*'satellites'/, /name:\s*'Satellites'/],
  ['src/data/rocketLaunches.js', /id:\s*'rocket-launches'/, /name:\s*'Space Missions \(30d\)'/],
  ['src/data/traffic.js', /id:\s*'traffic'/, /name:\s*'Street Traffic'/],
  ['src/data/cctv.js', /id:\s*'cctv'/, /name:\s*'CCTV'/],
  ['src/data/radio.js', /id:\s*'radio'/, /name:\s*'Radio'/],
  ['src/data/bikeshare.js', /id:\s*'bikeshare'/, /name:\s*'Bikeshare'/],
  ['src/data/aisLiveVessels.js', /id:\s*'ais-live-vessels'/, /name:\s*'Live AIS Vessels'/],
  ['src/data/militaryInstallations.js', /LAYER_ID = 'military-installations'/, /name:\s*'Mapped Installations'/],
  ['src/data/localLayers.js', /id:\s*'local-datacenters'/, /name:\s*'Datacenters'/],
  ['src/data/localLayers.js', /id:\s*'local-dams'/, /name:\s*'Dams'/],
  ['src/data/localLayers.js', /id:\s*'local-firms'/, /name:\s*'FIRMS Active Fires'/],
]);

function makeToggleElement() {
  const element = {
    children: [],
    className: '',
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: '',
    classList: {
      toggle() {},
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener() {},
    setAttribute() {},
    querySelector(selector) {
      if (selector.startsWith('[data-layer-id="')) {
        const id = selector.slice(16, -2);
        return this.children.find((child) => child.dataset.layerId === id) || null;
      }
      const className = selector.startsWith('.') ? selector.slice(1) : '';
      const visit = (node) => {
        if (String(node.className).split(/\s+/).includes(className)) return node;
        for (const child of node.children || []) {
          const found = visit(child);
          if (found) return found;
        }
        return null;
      };
      return visit(this);
    },
    set innerHTML(value) {
      if (value === '') this.children = [];
    },
    get innerHTML() {
      return '';
    },
  };
  return element;
}

function makeLayer(id, name, extras = {}) {
  return {
    id,
    name,
    icon: '',
    source: 'test',
    updateInterval: -1,
    init() {},
    enable() {},
    disable() {},
    update() {},
    getStats() {
      return { count: 0, lastUpdate: null };
    },
    ...extras,
  };
}

test('legal toggle fixture uses shipped layer ids and names, not invented rows', () => {
  for (const [rel, idPattern, namePattern] of LAYER_NAME_SOURCES) {
    const source = readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(source, idPattern);
    assert.match(source, namePattern);
  }
  const localLayers = readFileSync(path.join(ROOT, 'src/data/localLayers.js'), 'utf8');
  assert.match(localLayers, /submarineCablesLayer/);
  const awareness = readFileSync(path.join(ROOT, 'src/data/militaryAwareness.js'), 'utf8');
  assert.match(awareness, /showInTogglePanel:\s*false/);
});

test('layer list aliases cover voice common-names minus banned sources', () => {
  assert.ok(VOICE_LAYER_ALIASES.size > 0);
  for (const [alias, id] of VOICE_LAYER_ALIASES) {
    const banned = BANNED_LAYER_LIST_IDS.has(id) || BANNED_LAYER_LIST_ALIAS_RE.test(alias);
    if (banned) {
      assert.equal(LAYER_LIST_ALIASES.has(alias), false, `banned alias must stay out of the list map: ${alias}`);
    } else {
      assert.equal(LAYER_LIST_ALIASES.get(alias), id, alias);
    }
  }

  assert.equal(LAYER_LIST_ALIASES.get('fires'), 'local-firms');
  assert.equal(LAYER_LIST_ALIASES.get('ships'), 'ais-live-vessels');
  assert.equal(LAYER_LIST_ALIASES.get('bikes'), 'bikeshare');
  assert.equal(LAYER_LIST_ALIASES.get('traffic'), 'traffic');
  assert.equal(LAYER_LIST_ALIASES.get('cameras'), 'cctv');

  const aliases = [...LAYER_LIST_ALIASES.keys()].join('\n');
  const ids = [...LAYER_LIST_ALIASES.values()].join('\n');
  assert.doesNotMatch(aliases, /opensky/i);
  assert.doesNotMatch(aliases, /google news/i);
  assert.doesNotMatch(aliases, /telegeography/i);
  assert.doesNotMatch(aliases, /\bcables\b/i);
  assert.doesNotMatch(ids, /opensky/i);
  assert.doesNotMatch(ids, /google.?news/i);
  assert.doesNotMatch(ids, /telegeography/i);
  assert.ok(!LAYER_LIST_ALIASES.has('cables'));
  assert.ok(!ids.includes('telegeography-submarine-cables'));
});

test('voice actions still resolve from the shared alias map', () => {
  const voice = readFileSync(path.join(ROOT, 'src/voice/gevActions.js'), 'utf8');
  assert.match(voice, /VOICE_LAYER_ALIASES as LAYER_ALIASES/);
  assert.doesNotMatch(voice, /const LAYER_ALIASES = new Map/);
});

test('typing fire keeps only the FIRMS row; clearing restores the legal list', () => {
  const fired = filterVisibleLayers(LEGAL_TOGGLE_LAYERS, 'fire');
  assert.deepEqual(fired.map((layer) => layer.id), ['local-firms']);
  assert.equal(fired[0].name, 'FIRMS Active Fires');

  const cleared = filterVisibleLayers(LEGAL_TOGGLE_LAYERS, '');
  assert.deepEqual(cleared.map((layer) => layer.id), LEGAL_TOGGLE_LAYERS.map((layer) => layer.id));
  assert.equal(cleared.length, LEGAL_TOGGLE_LAYERS.length);

  assert.deepEqual(filterVisibleLayers(LEGAL_TOGGLE_LAYERS, '   ').map((layer) => layer.id),
    LEGAL_TOGGLE_LAYERS.map((layer) => layer.id));
});

test('voice common-name filters resolve to the existing legal rows', () => {
  assert.deepEqual(filterVisibleLayers(LEGAL_TOGGLE_LAYERS, 'ships').map((layer) => layer.id), ['ais-live-vessels']);
  assert.deepEqual(filterVisibleLayers(LEGAL_TOGGLE_LAYERS, 'bikes').map((layer) => layer.id), ['bikeshare']);
  assert.deepEqual(filterVisibleLayers(LEGAL_TOGGLE_LAYERS, 'traffic').map((layer) => layer.id), ['traffic']);
  assert.deepEqual(filterVisibleLayers(LEGAL_TOGGLE_LAYERS, 'cameras').map((layer) => layer.id), ['cctv']);
});

test('banned layers never match, even when the query is empty', () => {
  const mixed = [
    ...LEGAL_TOGGLE_LAYERS,
    { id: 'telegeography-submarine-cables', name: 'Submarine Cables', showInTogglePanel: false },
    { id: 'opensky', name: 'OpenSky' },
    { id: 'google-news', name: 'Google News' },
  ];
  const visible = filterVisibleLayers(mixed, '');
  assert.deepEqual(visible.map((layer) => layer.id), LEGAL_TOGGLE_LAYERS.map((layer) => layer.id));
  assert.equal(layerMatchesFilter({ id: 'telegeography-submarine-cables', name: 'Submarine Cables' }, ''), false);
  assert.equal(layerMatchesFilter({ id: 'opensky', name: 'OpenSky' }, 'sky'), false);
  assert.equal(layerMatchesFilter({ id: 'google-news', name: 'Google News' }, 'news'), false);
});

test('data-panel markup has a filter field and no banned source rows', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const panel = html.match(/<div id="data-panel"[\s\S]*?<div id="cctv-panel"/);
  assert.ok(panel, 'data-panel markup is missing');
  assert.match(panel[0], /id="data-layer-filter"/);
  assert.match(panel[0], /id="data-toggles"/);
  assert.ok(
    panel[0].indexOf('id="data-layer-filter"') < panel[0].indexOf('id="data-toggles"'),
    'filter field must sit above the layer list',
  );
  assert.doesNotMatch(panel[0], /OpenSky/i);
  assert.doesNotMatch(panel[0], /Google News/i);
  assert.doesNotMatch(panel[0], /TeleGeography/i);
  assert.doesNotMatch(panel[0], /Submarine Cables/i);
});

test('toggle panel hides cables and never grows OpenSky or Google News rows', () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: makeToggleElement };
  const mgr = new DataLayerManager({});
  for (const layer of LEGAL_TOGGLE_LAYERS) {
    mgr.register(makeLayer(layer.id, layer.name));
  }
  mgr.register(createTeleGeographySubmarineCableLayer());
  mgr.register(makeLayer('military-awareness', 'Global Context', { showInTogglePanel: false }));
  const container = makeToggleElement();
  const filterInput = {
    value: '',
    listeners: {},
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
  };

  try {
    mgr.buildTogglePanel(container, { filterInput });
    const ids = container.children.map((row) => row.dataset.layerId);
    assert.deepEqual(ids, LEGAL_TOGGLE_LAYERS.map((layer) => layer.id));
    assert.equal(container.querySelector('[data-layer-id="telegeography-submarine-cables"]'), null);
    assert.equal(container.querySelector('[data-layer-id="opensky"]'), null);
    assert.equal(container.querySelector('[data-layer-id="google-news"]'), null);
    assert.equal(container.querySelector('[data-layer-id="military-awareness"]'), null);

    filterInput.value = 'fire';
    filterInput.listeners.input();
    const fireVisible = container.children.filter((row) => !row.hidden).map((row) => row.dataset.layerId);
    assert.deepEqual(fireVisible, ['local-firms']);

    filterInput.value = '';
    filterInput.listeners.input();
    const cleared = container.children.filter((row) => !row.hidden).map((row) => row.dataset.layerId);
    assert.deepEqual(cleared, LEGAL_TOGGLE_LAYERS.map((layer) => layer.id));
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('applyLayerListFilter hides unmatched rows without removing them', () => {
  const container = makeToggleElement();
  for (const layer of LEGAL_TOGGLE_LAYERS) {
    const row = makeToggleElement();
    row.dataset.layerId = layer.id;
    container.appendChild(row);
  }
  applyLayerListFilter(container, 'fire', LEGAL_TOGGLE_LAYERS);
  assert.deepEqual(
    container.children.filter((row) => !row.hidden).map((row) => row.dataset.layerId),
    ['local-firms'],
  );
  applyLayerListFilter(container, '', LEGAL_TOGGLE_LAYERS);
  assert.equal(container.children.filter((row) => row.hidden).length, 0);
  assert.equal(container.children.length, LEGAL_TOGGLE_LAYERS.length);
});

test('cables layer stays registered but is omitted from the toggle panel', () => {
  const layer = createTeleGeographySubmarineCableLayer();
  assert.equal(layer.id, 'telegeography-submarine-cables');
  assert.equal(layer.showInTogglePanel, false);
  assert.equal(BANNED_LAYER_LIST_IDS.has(layer.id), true);
});
